using System.Data;
using BudgetPlanner.Contracts.Paychecks;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace BudgetPlanner.Paychecks;

public sealed record PaycheckOperation<T>(T? Value, PaycheckError? Error)
{
    public bool IsSuccess => Error is null;
    public static PaycheckOperation<T> Success(T value) => new(value, null);
    public static PaycheckOperation<T> Failure(PaycheckError error) => new(default, error);
}

public interface IPaycheckService
{
    Task<PaycheckCandidatesResponse> GetCandidatesAsync(string ownerId, CancellationToken cancellationToken);
    Task<PaycheckOperation<bool>> DismissAsync(string ownerId, PaycheckCandidateDecisionRequest request, CancellationToken cancellationToken);
    Task<PaycheckOperation<bool>> ReconsiderAsync(string ownerId, PaycheckCandidateDecisionRequest request, CancellationToken cancellationToken);
    Task<PaycheckOperation<ConfirmPaycheckResponse>> ConfirmAsync(string ownerId, ConfirmPaycheckRequest request, CancellationToken cancellationToken);
    Task<PaycheckOperation<PaycheckProfileDto>> CreateAsync(string ownerId, CreatePaycheckRequest request, CancellationToken cancellationToken);
    Task<PaychecksResponse> GetPaychecksAsync(string ownerId, CancellationToken cancellationToken);
    Task<PaycheckOperation<PaycheckProfileDto>> GetAsync(string ownerId, Guid id, CancellationToken cancellationToken);
    Task<PaycheckOperation<PaycheckProfileDto>> UpdateAsync(string ownerId, Guid id, UpdatePaycheckRequest request, CancellationToken cancellationToken);
    Task<PaycheckOperation<PaycheckProfileDto>> UpdateLifecycleAsync(string ownerId, Guid id, UpdatePaycheckLifecycleRequest request, CancellationToken cancellationToken);
    Task<PaycheckOperation<RecordPaycheckReceiptResponse>> RecordReceiptAsync(string ownerId, Guid id, RecordPaycheckReceiptRequest request, CancellationToken cancellationToken);
    Task<PaycheckOperation<PaycheckProfileDto>> RemoveReceiptAsync(string ownerId, Guid id, int accountInflowId, CancellationToken cancellationToken);
}

public sealed class PaycheckService(
    BudgetContext context, PaycheckCandidateDetector detector, PaycheckProjector projector,
    TimeProvider clock) : IPaycheckService
{
    public async Task<PaycheckCandidatesResponse> GetCandidatesAsync(string ownerId, CancellationToken cancellationToken)
    {
        var evaluatedOn = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var candidates = await DetectAsync(ownerId, evaluatedOn, cancellationToken);
        var dismissals = await context.PaycheckCandidateDismissals.AsNoTracking()
            .Where(value => value.OwnerId == ownerId).ToListAsync(cancellationToken);
        var imported = await ImportedIdsAsync(ownerId, cancellationToken);
        var ordered = candidates.OrderBy(value => value.NormalizedDescriptionIdentity, StringComparer.Ordinal)
            .ThenBy(value => value.EvidenceFingerprint, StringComparer.Ordinal).ToArray();
        return new(evaluatedOn,
            ordered.Where(value => !IsDismissed(value, dismissals)).Select(value => ToDto(value, imported)).ToArray(),
            ordered.Where(value => IsDismissed(value, dismissals)).Select(value => ToDto(value, imported)).ToArray());
    }

    public async Task<PaycheckOperation<bool>> DismissAsync(
        string ownerId, PaycheckCandidateDecisionRequest request, CancellationToken cancellationToken)
    {
        var error = ValidateDecision(request, out var cadence, out var fingerprint);
        if (error is not null) return PaycheckOperation<bool>.Failure(error);
        var now = clock.GetUtcNow().UtcDateTime;
        await using var transaction = await BeginAsync(cancellationToken);
        try
        {
            if (await DismissalQuery(ownerId, request.AlgorithmVersion!, cadence, fingerprint).AnyAsync(cancellationToken))
            {
                await CommitAsync(transaction, cancellationToken);
                return PaycheckOperation<bool>.Success(true);
            }
            var candidates = await DetectAsync(ownerId, DateOnly.FromDateTime(now), cancellationToken);
            if (!candidates.Any(value => Matches(value, request.AlgorithmVersion!, cadence, request.Fingerprint!)))
                return Changed<bool>();

            context.PaycheckCandidateDismissals.Add(new PaycheckCandidateDismissal
            {
                Id = Guid.NewGuid(), OwnerId = ownerId, AlgorithmVersion = request.AlgorithmVersion!,
                Cadence = cadence, EvidenceFingerprint = fingerprint, DismissedAt = now
            });
            await context.SaveChangesAsync(cancellationToken);
            await CommitAsync(transaction, cancellationToken);
            return PaycheckOperation<bool>.Success(true);
        }
        catch (Exception exception) when (IsConflict(exception))
        {
            await ResetAsync(transaction);
            return await DismissalQuery(ownerId, request.AlgorithmVersion!, cadence, fingerprint).AnyAsync(cancellationToken)
                ? PaycheckOperation<bool>.Success(true) : Changed<bool>();
        }
    }

    public async Task<PaycheckOperation<bool>> ReconsiderAsync(
        string ownerId, PaycheckCandidateDecisionRequest request, CancellationToken cancellationToken)
    {
        var error = ValidateDecision(request, out var cadence, out var fingerprint);
        if (error is not null) return PaycheckOperation<bool>.Failure(error);
        await using var transaction = await BeginAsync(cancellationToken);
        try
        {
            var dismissal = await DismissalQuery(ownerId, request.AlgorithmVersion!, cadence, fingerprint)
                .SingleOrDefaultAsync(cancellationToken);
            if (dismissal is not null)
            {
                context.PaycheckCandidateDismissals.Remove(dismissal);
                await context.SaveChangesAsync(cancellationToken);
            }
            await CommitAsync(transaction, cancellationToken);
            return PaycheckOperation<bool>.Success(true);
        }
        catch (Exception exception) when (IsConflict(exception))
        {
            await ResetAsync(transaction);
            return !await DismissalQuery(ownerId, request.AlgorithmVersion!, cadence, fingerprint).AnyAsync(cancellationToken)
                ? PaycheckOperation<bool>.Success(true) : Changed<bool>();
        }
    }

    public async Task<PaycheckOperation<ConfirmPaycheckResponse>> ConfirmAsync(
        string ownerId, ConfirmPaycheckRequest request, CancellationToken cancellationToken)
    {
        if (!TryFingerprint(request.Fingerprint, out var fingerprint)) return InvalidFingerprint<ConfirmPaycheckResponse>();
        if (!ValidVersion(request.AlgorithmVersion)) return Fail<ConfirmPaycheckResponse>("algorithm_version_invalid", "Algorithm version is invalid.");
        var error = PaycheckProfileRules.ValidateExpectation(request.DisplayName, request.WindowBeforeDays,
            request.WindowAfterDays, request.Amount, out var expectation);
        if (error is not null) return PaycheckOperation<ConfirmPaycheckResponse>.Failure(error);
        if (!PaycheckProfileRules.TrySchedule(request.Schedule, out var schedule))
            return InvalidSchedule<ConfirmPaycheckResponse>();

        var now = clock.GetUtcNow().UtcDateTime;
        var evaluatedOn = DateOnly.FromDateTime(now);
        await using var transaction = await BeginAsync(cancellationToken);
        try
        {
            var existing = await FindOriginAsync(ownerId, request.AlgorithmVersion!, fingerprint, cancellationToken);
            if (existing is not null)
            {
                var response = await ProfileDtoAsync(existing, evaluatedOn, cancellationToken);
                await CommitAsync(transaction, cancellationToken);
                return PaycheckOperation<ConfirmPaycheckResponse>.Success(new(response, true));
            }

            var candidates = await DetectAsync(ownerId, evaluatedOn, cancellationToken);
            var candidate = candidates.SingleOrDefault(value =>
                value.AlgorithmVersion == request.AlgorithmVersion && value.EvidenceFingerprint == request.Fingerprint);
            if (candidate is null) return Changed<ConfirmPaycheckResponse>();
            if (candidate.Schedule != schedule)
                return Fail<ConfirmPaycheckResponse>("candidate_schedule_mismatch", "Accept the candidate schedule or create a paycheck manually.");
            if (await DismissalQuery(ownerId, candidate.AlgorithmVersion, candidate.Schedule.Cadence, fingerprint)
                    .AnyAsync(cancellationToken))
                return Fail<ConfirmPaycheckResponse>("candidate_dismissed", "Reconsider the candidate before confirming it.");
            if (candidate.ObservedAmount is VariableObservedPaycheckAmount
                && expectation!.Amount is not RangeConfirmedPaycheckAmount)
                return Fail<ConfirmPaycheckResponse>("amount_invalid", "Variable evidence requires an explicit accepted amount range.");

            if (!await LockAndValidateEvidenceAsync(ownerId, candidate, cancellationToken))
                return Changed<ConfirmPaycheckResponse>();

            var profile = NewProfile(ownerId, schedule!, expectation!, now);
            profile.OriginAlgorithmVersion = candidate.AlgorithmVersion;
            profile.OriginEvidenceFingerprint = fingerprint;
            profile.Occurrences = candidate.Evidence.Select(evidence => new PaycheckOccurrence
            {
                PaycheckProfileId = profile.Id, AccountInflowId = evidence.AccountInflowId, OwnerId = ownerId,
                Kind = PaycheckOccurrenceKind.ConfirmationEvidence,
                EvidenceRevisionAtAssignment = evidence.PaycheckEvidenceRevision,
                SlotAnchor = evidence.SlotAnchor, TimingOffsetDays = (short)evidence.TimingOffsetDays, LinkedAt = now
            }).ToList();
            context.PaycheckProfiles.Add(profile);
            await context.SaveChangesAsync(cancellationToken);
            var created = await ProfileDtoAsync(profile, evaluatedOn, cancellationToken);
            await CommitAsync(transaction, cancellationToken);
            return PaycheckOperation<ConfirmPaycheckResponse>.Success(new(created, false));
        }
        catch (Exception exception) when (IsConflict(exception))
        {
            await ResetAsync(transaction);
            var existing = await FindOriginAsync(ownerId, request.AlgorithmVersion!, fingerprint, cancellationToken);
            return existing is not null
                ? PaycheckOperation<ConfirmPaycheckResponse>.Success(new(
                    await ProfileDtoAsync(existing, evaluatedOn, cancellationToken), true))
                : Fail<ConfirmPaycheckResponse>("confirmation_conflict", "The evidence changed or was already assigned. Refresh the candidates.");
        }
        catch (ArgumentOutOfRangeException)
        {
            await ResetAsync(transaction);
            return InvalidSchedule<ConfirmPaycheckResponse>();
        }
        catch (DbUpdateException)
        {
            await ResetAsync(transaction);
            return Fail<ConfirmPaycheckResponse>("confirmation_failed", "Paycheck confirmation could not be completed.");
        }
        catch
        {
            await ResetAsync(transaction);
            throw;
        }
    }

    public async Task<PaycheckOperation<PaycheckProfileDto>> CreateAsync(
        string ownerId, CreatePaycheckRequest request, CancellationToken cancellationToken)
    {
        var error = PaycheckProfileRules.ValidateExpectation(request.DisplayName, request.WindowBeforeDays,
            request.WindowAfterDays, request.Amount, out var expectation);
        if (error is not null) return PaycheckOperation<PaycheckProfileDto>.Failure(error);
        if (!PaycheckProfileRules.TrySchedule(request.Schedule, out var schedule)) return InvalidSchedule<PaycheckProfileDto>();
        var now = clock.GetUtcNow().UtcDateTime;
        var profile = NewProfile(ownerId, schedule!, expectation!, now);
        var response = await ProspectiveProfileDtoAsync(profile, DateOnly.FromDateTime(now), cancellationToken);
        if (!response.IsSuccess) return response;
        context.PaycheckProfiles.Add(profile);
        await context.SaveChangesAsync(cancellationToken);
        return response;
    }

    public async Task<PaychecksResponse> GetPaychecksAsync(string ownerId, CancellationToken cancellationToken)
    {
        var evaluatedOn = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var profiles = await context.PaycheckProfiles.AsNoTracking().Where(value => value.OwnerId == ownerId)
            .ToListAsync(cancellationToken);
        var ordered = profiles.OrderBy(value => value.Lifecycle).ThenBy(value => value.DisplayName, StringComparer.Ordinal)
            .ThenBy(value => value.Id).ToArray();
        return new(evaluatedOn, await ProfileDtosAsync(ownerId, ordered, evaluatedOn, cancellationToken));
    }

    public async Task<PaycheckOperation<PaycheckProfileDto>> GetAsync(string ownerId, Guid id, CancellationToken cancellationToken)
    {
        var evaluatedOn = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var profile = await context.PaycheckProfiles.AsNoTracking()
            .SingleOrDefaultAsync(value => value.OwnerId == ownerId && value.Id == id, cancellationToken);
        return profile is null ? NotFound<PaycheckProfileDto>()
            : PaycheckOperation<PaycheckProfileDto>.Success(await ProfileDtoAsync(profile, evaluatedOn, cancellationToken));
    }

    public async Task<PaycheckOperation<PaycheckProfileDto>> UpdateAsync(
        string ownerId, Guid id, UpdatePaycheckRequest request, CancellationToken cancellationToken)
    {
        var profile = await context.PaycheckProfiles.SingleOrDefaultAsync(
            value => value.OwnerId == ownerId && value.Id == id, cancellationToken);
        if (profile is null) return NotFound<PaycheckProfileDto>();
        var error = PaycheckProfileRules.ValidateExpectation(request.DisplayName, request.WindowBeforeDays,
            request.WindowAfterDays, request.Amount, out var expectation);
        if (error is not null) return PaycheckOperation<PaycheckProfileDto>.Failure(error);
        var now = clock.GetUtcNow().UtcDateTime;
        var original = context.Entry(profile).CurrentValues.Clone();
        PaycheckProfileRules.ApplyExpectation(profile, expectation!);
        profile.UpdatedAt = now;
        var response = await ProspectiveProfileDtoAsync(profile, DateOnly.FromDateTime(now), cancellationToken);
        if (!response.IsSuccess)
        {
            context.Entry(profile).CurrentValues.SetValues(original);
            return response;
        }
        await context.SaveChangesAsync(cancellationToken);
        return response;
    }

    public async Task<PaycheckOperation<PaycheckProfileDto>> UpdateLifecycleAsync(
        string ownerId, Guid id, UpdatePaycheckLifecycleRequest request, CancellationToken cancellationToken)
    {
        var profile = await context.PaycheckProfiles.SingleOrDefaultAsync(
            value => value.OwnerId == ownerId && value.Id == id, cancellationToken);
        if (profile is null) return NotFound<PaycheckProfileDto>();
        if (!PaycheckProfileRules.TryLifecycle(request.Lifecycle, out var lifecycle))
            return Fail<PaycheckProfileDto>("lifecycle_invalid", "Lifecycle must be active, paused, or ended.");
        var now = clock.GetUtcNow().UtcDateTime;
        var original = context.Entry(profile).CurrentValues.Clone();
        profile.Lifecycle = lifecycle;
        profile.UpdatedAt = now;
        var response = await ProspectiveProfileDtoAsync(profile, DateOnly.FromDateTime(now), cancellationToken);
        if (!response.IsSuccess)
        {
            context.Entry(profile).CurrentValues.SetValues(original);
            return response;
        }
        await context.SaveChangesAsync(cancellationToken);
        return response;
    }

    public async Task<PaycheckOperation<RecordPaycheckReceiptResponse>> RecordReceiptAsync(
        string ownerId, Guid id, RecordPaycheckReceiptRequest request, CancellationToken cancellationToken)
    {
        if (request.SlotAnchor is null)
            return Fail<RecordPaycheckReceiptResponse>("receipt_slot_invalid", "Choose an available paycheck slot.");
        var hasExisting = request.ExistingInflowId is > 0;
        var hasNew = request.NewInflow is not null;
        if (hasExisting == hasNew)
            return Fail<RecordPaycheckReceiptResponse>("receipt_source_invalid", "Choose either existing cash in or new cash in.");

        var normalizedDescription = hasNew ? AccountInflowInputRules.NormalizeDescription(request.NewInflow!.Description) : null;
        if (hasNew && AccountInflowInputRules.Validate(request.NewInflow!.Amount, request.NewInflow.Date, normalizedDescription).Count > 0)
            return Fail<RecordPaycheckReceiptResponse>("receipt_inflow_invalid", "Enter a valid positive amount, date, and description.");

        var evaluatedOn = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        await using var transaction = await BeginAsync(cancellationToken);
        try
        {
            var profile = await LockProfileAsync(ownerId, id, cancellationToken);
            if (profile is null) return NotFound<RecordPaycheckReceiptResponse>();
            if (profile.Lifecycle != PaycheckLifecycle.Active)
                return Fail<RecordPaycheckReceiptResponse>("paycheck_not_active", "Only an active paycheck can record a new receipt.");

            var existingSlot = await ReceiptAtSlotAsync(ownerId, id, request.SlotAnchor.Value, cancellationToken);
            if (existingSlot is not null)
            {
                var matches = hasExisting
                    ? existingSlot.Inflow.Id == request.ExistingInflowId
                    : existingSlot.Inflow.Date == request.NewInflow!.Date
                      && existingSlot.Inflow.Amount == request.NewInflow.Amount
                      && existingSlot.Inflow.Description == normalizedDescription;
                if (existingSlot.Occurrence.Kind == PaycheckOccurrenceKind.RecordedReceipt && matches)
                {
                    var dto = await ProfileDtoAsync(profile, evaluatedOn, cancellationToken);
                    await CommitAsync(transaction, cancellationToken);
                    return PaycheckOperation<RecordPaycheckReceiptResponse>.Success(new(
                        dto, dto.Evidence.Single(value => value.AccountInflowId == existingSlot.Inflow.Id), true));
                }
                return Fail<RecordPaycheckReceiptResponse>("receipt_conflict", "That paycheck slot already has a different linked deposit.");
            }

            var allowed = await ReceiptSlotsAsync(profile, evaluatedOn, cancellationToken);
            if (!PaycheckScheduleEngine.IsAnchor(PaycheckProfileRules.ReadSchedule(profile), request.SlotAnchor.Value))
                return Fail<RecordPaycheckReceiptResponse>("receipt_slot_invalid", "The selected date is not a paycheck schedule anchor.");
            if (!allowed.Any(value => value.Anchor == request.SlotAnchor.Value))
                return Fail<RecordPaycheckReceiptResponse>("receipt_slot_unavailable", "That paycheck slot is no longer available. Refresh and choose again.");

            AccountInflow inflow;
            if (hasExisting)
            {
                inflow = await LockInflowAsync(ownerId, request.ExistingInflowId!.Value, cancellationToken)
                    ?? throw new ReceiptUnavailableException();
                if (await context.PaycheckOccurrences.AnyAsync(value => value.AccountInflowId == inflow.Id, cancellationToken))
                    throw new ReceiptUnavailableException();
            }
            else
            {
                inflow = new AccountInflow
                {
                    OwnerId = ownerId, Description = normalizedDescription!, Amount = request.NewInflow!.Amount!.Value,
                    Date = request.NewInflow.Date!.Value, PaycheckEvidenceRevision = Guid.NewGuid()
                };
                context.AccountInflows.Add(inflow);
            }

            var offset = inflow.Date.DayNumber - request.SlotAnchor.Value.DayNumber;
            if (offset is < short.MinValue or > short.MaxValue)
                return Fail<RecordPaycheckReceiptResponse>("receipt_date_invalid", "The observed date is too far from the selected paycheck slot.");
            var occurrence = new PaycheckOccurrence
            {
                PaycheckProfileId = profile.Id, AccountInflow = inflow, AccountInflowId = inflow.Id, OwnerId = ownerId,
                Kind = PaycheckOccurrenceKind.RecordedReceipt, EvidenceRevisionAtAssignment = inflow.PaycheckEvidenceRevision,
                SlotAnchor = request.SlotAnchor.Value, TimingOffsetDays = (short)offset, LinkedAt = clock.GetUtcNow().UtcDateTime
            };
            context.PaycheckOccurrences.Add(occurrence);
            await context.SaveChangesAsync(cancellationToken);
            var result = await ProfileDtoAsync(profile, evaluatedOn, cancellationToken);
            await CommitAsync(transaction, cancellationToken);
            return PaycheckOperation<RecordPaycheckReceiptResponse>.Success(new(
                result, result.Evidence.Single(value => value.AccountInflowId == inflow.Id), false));
        }
        catch (ReceiptUnavailableException)
        {
            await ResetAsync(transaction);
            return Fail<RecordPaycheckReceiptResponse>("receipt_inflow_unavailable", "That cash-in record is unavailable. Refresh and choose again.");
        }
        catch (Exception exception) when (IsConflict(exception))
        {
            await ResetAsync(transaction);
            var reconciled = await ReconcileReceiptAsync(
                ownerId, id, request, normalizedDescription, evaluatedOn, cancellationToken);
            if (reconciled is not null)
                return PaycheckOperation<RecordPaycheckReceiptResponse>.Success(reconciled);
            return Fail<RecordPaycheckReceiptResponse>("receipt_conflict", "The receipt changed or was claimed. Refresh and review the paycheck.");
        }
        catch (DbUpdateException)
        {
            await ResetAsync(transaction);
            return Fail<RecordPaycheckReceiptResponse>("receipt_failed", "The paycheck receipt could not be recorded.");
        }
    }

    public async Task<PaycheckOperation<PaycheckProfileDto>> RemoveReceiptAsync(
        string ownerId, Guid id, int accountInflowId, CancellationToken cancellationToken)
    {
        var evaluatedOn = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        await using var transaction = await BeginAsync(cancellationToken);
        try
        {
            var profile = await LockProfileAsync(ownerId, id, cancellationToken);
            if (profile is null) return NotFound<PaycheckProfileDto>();
            var occurrence = await context.PaycheckOccurrences.SingleOrDefaultAsync(value =>
                value.OwnerId == ownerId && value.PaycheckProfileId == id && value.AccountInflowId == accountInflowId,
                cancellationToken);
            if (occurrence is not null)
            {
                if (occurrence.Kind != PaycheckOccurrenceKind.RecordedReceipt)
                    return Fail<PaycheckProfileDto>("receipt_link_protected", "Confirmation evidence cannot be removed from this workflow.");
                context.PaycheckOccurrences.Remove(occurrence);
                await context.SaveChangesAsync(cancellationToken);
            }
            var result = await ProfileDtoAsync(profile, evaluatedOn, cancellationToken);
            await CommitAsync(transaction, cancellationToken);
            return PaycheckOperation<PaycheckProfileDto>.Success(result);
        }
        catch (Exception exception) when (IsConflict(exception))
        {
            await ResetAsync(transaction);
            var profile = await context.PaycheckProfiles.AsNoTracking().SingleOrDefaultAsync(
                value => value.OwnerId == ownerId && value.Id == id, cancellationToken);
            if (profile is null) return NotFound<PaycheckProfileDto>();
            var occurrence = await context.PaycheckOccurrences.AsNoTracking().SingleOrDefaultAsync(value =>
                value.OwnerId == ownerId && value.PaycheckProfileId == id && value.AccountInflowId == accountInflowId,
                cancellationToken);
            if (occurrence is null)
                return PaycheckOperation<PaycheckProfileDto>.Success(await ProfileDtoAsync(profile, evaluatedOn, cancellationToken));
            if (occurrence.Kind != PaycheckOccurrenceKind.RecordedReceipt)
                return Fail<PaycheckProfileDto>("receipt_link_protected", "Confirmation evidence cannot be removed from this workflow.");
            return Fail<PaycheckProfileDto>("receipt_conflict", "The receipt changed during removal. Refresh and review the paycheck.");
        }
        catch (DbUpdateException)
        {
            await ResetAsync(transaction);
            return Fail<PaycheckProfileDto>("receipt_failed", "The paycheck receipt link could not be removed.");
        }
    }

    private async Task<IReadOnlyList<PaycheckCandidate>> DetectAsync(
        string ownerId, DateOnly evaluatedOn, CancellationToken cancellationToken)
    {
        var claimed = context.PaycheckOccurrences.Where(value => value.OwnerId == ownerId).Select(value => value.AccountInflowId);
        var inflows = await context.AccountInflows.AsNoTracking()
            .Where(value => value.OwnerId == ownerId && !claimed.Contains(value.Id)).ToListAsync(cancellationToken);
        return detector.Detect(inflows, evaluatedOn);
    }

    private async Task<bool> LockAndValidateEvidenceAsync(string ownerId, PaycheckCandidate candidate, CancellationToken cancellationToken)
    {
        var ids = candidate.Evidence.Select(value => value.AccountInflowId).Order().ToArray();
        var current = context.Database.IsNpgsql()
            ? await context.AccountInflows.FromSqlInterpolated($"""
                SELECT * FROM "AccountInflows"
                WHERE "OwnerId" = {ownerId} AND "Id" = ANY({ids})
                ORDER BY "Id" FOR UPDATE
                """).AsNoTracking().ToListAsync(cancellationToken)
            : await context.AccountInflows.AsNoTracking().Where(value => value.OwnerId == ownerId && ids.Contains(value.Id))
                .ToListAsync(cancellationToken);
        if (current.Count != ids.Length || await context.PaycheckOccurrences.AnyAsync(
                value => value.OwnerId == ownerId && ids.Contains(value.AccountInflowId), cancellationToken)) return false;
        var byId = current.ToDictionary(value => value.Id);
        return candidate.Evidence.All(value => byId.TryGetValue(value.AccountInflowId, out var inflow)
            && inflow.PaycheckEvidenceRevision == value.PaycheckEvidenceRevision
            && inflow.Date == value.PostedDate && inflow.Amount == value.Amount
            && AccountInflowIdentity.NormalizeDescription(inflow.Description) == candidate.NormalizedDescriptionIdentity
            && PaycheckScheduleEngine.IsAnchor(candidate.Schedule, value.SlotAnchor)
            && value.PostedDate.DayNumber - value.SlotAnchor.DayNumber == value.TimingOffsetDays);
    }

    private Task<PaycheckProfile?> LockProfileAsync(
        string ownerId, Guid id, CancellationToken cancellationToken) => context.Database.IsNpgsql()
        ? context.PaycheckProfiles.FromSqlInterpolated($"""
            SELECT * FROM "PaycheckProfiles"
            WHERE "OwnerId" = {ownerId} AND "Id" = {id}
            FOR UPDATE
            """).SingleOrDefaultAsync(cancellationToken)
        : context.PaycheckProfiles.SingleOrDefaultAsync(
            value => value.OwnerId == ownerId && value.Id == id, cancellationToken);

    private Task<AccountInflow?> LockInflowAsync(
        string ownerId, int id, CancellationToken cancellationToken) => context.Database.IsNpgsql()
        ? context.AccountInflows.FromSqlInterpolated($"""
            SELECT * FROM "AccountInflows"
            WHERE "OwnerId" = {ownerId} AND "Id" = {id}
            FOR UPDATE
            """).SingleOrDefaultAsync(cancellationToken)
        : context.AccountInflows.SingleOrDefaultAsync(
            value => value.OwnerId == ownerId && value.Id == id, cancellationToken);

    private async Task<ReceiptLink?> ReceiptAtSlotAsync(
        string ownerId, Guid profileId, DateOnly slotAnchor, CancellationToken cancellationToken)
    {
        var occurrence = await context.PaycheckOccurrences.AsNoTracking().SingleOrDefaultAsync(value =>
            value.OwnerId == ownerId && value.PaycheckProfileId == profileId && value.SlotAnchor == slotAnchor,
            cancellationToken);
        if (occurrence is null) return null;
        var inflow = await context.AccountInflows.AsNoTracking().SingleAsync(value =>
            value.OwnerId == ownerId && value.Id == occurrence.AccountInflowId, cancellationToken);
        return new(occurrence, inflow);
    }

    private async Task<IReadOnlyList<PaycheckReceiptSlotDto>> ReceiptSlotsAsync(
        PaycheckProfile profile, DateOnly evaluatedOn, CancellationToken cancellationToken) =>
        (await ProfileDtoAsync(profile, evaluatedOn, cancellationToken)).ReceiptSlots;

    private async Task<RecordPaycheckReceiptResponse?> ReconcileReceiptAsync(
        string ownerId, Guid profileId, RecordPaycheckReceiptRequest request,
        string? normalizedDescription, DateOnly evaluatedOn, CancellationToken cancellationToken)
    {
        var linked = await ReceiptAtSlotAsync(ownerId, profileId, request.SlotAnchor!.Value, cancellationToken);
        if (linked?.Occurrence.Kind != PaycheckOccurrenceKind.RecordedReceipt) return null;
        var matches = request.ExistingInflowId is > 0
            ? linked.Inflow.Id == request.ExistingInflowId
            : linked.Inflow.Date == request.NewInflow!.Date
              && linked.Inflow.Amount == request.NewInflow.Amount
              && linked.Inflow.Description == normalizedDescription;
        if (!matches) return null;
        var profile = await context.PaycheckProfiles.AsNoTracking().SingleOrDefaultAsync(
            value => value.OwnerId == ownerId && value.Id == profileId, cancellationToken);
        if (profile is null) return null;
        var dto = await ProfileDtoAsync(profile, evaluatedOn, cancellationToken);
        return new(dto, dto.Evidence.Single(value => value.AccountInflowId == linked.Inflow.Id), true);
    }

    private IQueryable<PaycheckCandidateDismissal> DismissalQuery(
        string ownerId, string version, PaycheckCadence cadence, byte[] fingerprint) =>
        context.PaycheckCandidateDismissals.Where(value => value.OwnerId == ownerId
            && value.AlgorithmVersion == version && value.Cadence == cadence
            && value.EvidenceFingerprint.SequenceEqual(fingerprint));

    private Task<PaycheckProfile?> FindOriginAsync(string ownerId, string version, byte[] fingerprint, CancellationToken cancellationToken) =>
        context.PaycheckProfiles.AsNoTracking().SingleOrDefaultAsync(value => value.OwnerId == ownerId
            && value.OriginAlgorithmVersion == version && value.OriginEvidenceFingerprint != null
            && value.OriginEvidenceFingerprint.SequenceEqual(fingerprint), cancellationToken);

    private async Task<HashSet<int>> ImportedIdsAsync(string ownerId, CancellationToken cancellationToken) =>
        await context.ImportInflowProvenances.AsNoTracking().Where(value => value.OwnerId == ownerId
            && value.AccountInflowId != null && value.AccountInflowOwnerId == ownerId
            && value.Batch!.OwnerId == ownerId && value.AccountInflow!.OwnerId == ownerId)
            .Select(value => value.AccountInflowId!.Value).ToHashSetAsync(cancellationToken);

    private async Task<PaycheckProfileDto> ProfileDtoAsync(PaycheckProfile profile, DateOnly evaluatedOn, CancellationToken cancellationToken) =>
        (await ProfileDtosAsync(profile.OwnerId, [profile], evaluatedOn, cancellationToken))[0];

    private async Task<PaycheckOperation<PaycheckProfileDto>> ProspectiveProfileDtoAsync(
        PaycheckProfile profile, DateOnly evaluatedOn, CancellationToken cancellationToken)
    {
        try
        {
            return PaycheckOperation<PaycheckProfileDto>.Success(await ProfileDtoAsync(profile, evaluatedOn, cancellationToken));
        }
        catch (ArgumentOutOfRangeException)
        {
            // Valid DateOnly inputs can still place the expected window beyond
            // the representable calendar. Reject before persisting that state.
            return InvalidSchedule<PaycheckProfileDto>();
        }
    }

    private async Task<IReadOnlyList<PaycheckProfileDto>> ProfileDtosAsync(
        string ownerId, IReadOnlyList<PaycheckProfile> profiles, DateOnly evaluatedOn, CancellationToken cancellationToken)
    {
        var ids = profiles.Select(value => value.Id).ToArray();
        // Filter every side before mapping; even anomalous foreign links must not disclose another owner's inflow.
        var evidence = await (
            from occurrence in context.PaycheckOccurrences.AsNoTracking()
            join inflow in context.AccountInflows.AsNoTracking() on occurrence.AccountInflowId equals inflow.Id
            where occurrence.OwnerId == ownerId && inflow.OwnerId == ownerId && ids.Contains(occurrence.PaycheckProfileId)
            select new { Occurrence = occurrence, Inflow = inflow }).ToListAsync(cancellationToken);
        var imported = await ImportedIdsAsync(ownerId, cancellationToken);
        return profiles.Select(profile =>
        {
            var linked = evidence.Where(value => value.Occurrence.PaycheckProfileId == profile.Id)
                .OrderBy(value => value.Inflow.Date).ThenBy(value => value.Inflow.Id).ToArray();
            var schedule = PaycheckProfileRules.ReadSchedule(profile);
            var amount = PaycheckProfileRules.ReadAmount(profile);
            PaycheckProjectionDto? projection = null;
            if (profile.Lifecycle == PaycheckLifecycle.Active)
            {
                var pattern = new ConfirmedPaycheckPattern(schedule, profile.WindowBeforeDays, profile.WindowAfterDays,
                    amount, linked.Select(value => (DateOnly?)value.Occurrence.SlotAnchor).Max());
                var projected = projector.Project(pattern, evaluatedOn);
                projection = new(projected.AlgorithmVersion, projected.EvaluatedOn, projected.Anchor,
                    projected.EarliestExpectedDate, projected.LatestExpectedDate, PaycheckProfileRules.ToDto(projected.Amount));
            }
            var occupied = linked.Select(value => value.Occurrence.SlotAnchor).ToHashSet();
            var receiptSlots = projection is null
                ? Array.Empty<PaycheckReceiptSlotDto>()
                : BuildReceiptSlots(schedule, profile.WindowBeforeDays, profile.WindowAfterDays, projection.Anchor, occupied);
            return new PaycheckProfileDto(profile.Id, profile.DisplayName, profile.Lifecycle.ToString().ToLowerInvariant(),
                PaycheckProfileRules.ToDto(schedule), profile.WindowBeforeDays, profile.WindowAfterDays,
                PaycheckProfileRules.ToDto(amount), profile.OriginEvidenceFingerprint is null ? "manual" : "candidate",
                profile.OriginEvidenceFingerprint is null ? null : new(profile.OriginAlgorithmVersion!, Convert.ToHexStringLower(profile.OriginEvidenceFingerprint)),
                profile.CreatedAt, profile.UpdatedAt, linked.Select(value => new PaycheckProfileEvidenceDto(
                    value.Inflow.Id, value.Inflow.Date, value.Inflow.Amount, value.Inflow.Description,
                    imported.Contains(value.Inflow.Id) ? "imported" : "manual", value.Occurrence.SlotAnchor,
                    value.Occurrence.TimingOffsetDays, value.Occurrence.LinkedAt,
                    value.Inflow.PaycheckEvidenceRevision != value.Occurrence.EvidenceRevisionAtAssignment,
                    value.Occurrence.Kind == PaycheckOccurrenceKind.RecordedReceipt ? "recorded_receipt" : "confirmation_evidence"))
                    .ToArray(), receiptSlots, projection);
        }).ToArray();
    }

    private static IReadOnlyList<PaycheckReceiptSlotDto> BuildReceiptSlots(
        PaycheckSchedule schedule, int before, int after, DateOnly current, IReadOnlySet<DateOnly> occupied)
    {
        var slots = new List<PaycheckReceiptSlotDto>();
        if (!occupied.Contains(current))
            slots.Add(new("current", current, current.AddDays(-before), current.AddDays(after)));
        var previous = PaycheckScheduleEngine.PreviousAnchorBefore(schedule, current);
        if (previous is { } anchor && !occupied.Contains(anchor))
            slots.Add(new("previous", anchor, anchor.AddDays(-before), anchor.AddDays(after)));
        return slots;
    }

    private static PaycheckProfile NewProfile(string ownerId, PaycheckSchedule schedule, PaycheckExpectation expectation, DateTime now)
    {
        var profile = new PaycheckProfile { Id = Guid.NewGuid(), OwnerId = ownerId,
            Lifecycle = PaycheckLifecycle.Active, CreatedAt = now, UpdatedAt = now };
        PaycheckProfileRules.ApplySchedule(profile, schedule);
        PaycheckProfileRules.ApplyExpectation(profile, expectation);
        return profile;
    }

    private static PaycheckCandidateDto ToDto(PaycheckCandidate candidate, IReadOnlySet<int> imported)
    {
        var evidence = candidate.Evidence.OrderBy(value => value.PostedDate).ThenBy(value => value.AccountInflowId).ToArray();
        return new(candidate.EvidenceFingerprint, candidate.AlgorithmVersion, candidate.NormalizedDescriptionIdentity,
            PaycheckProfileRules.ToDto(candidate.Schedule), candidate.WindowBeforeDays, candidate.WindowAfterDays,
            PaycheckProfileRules.ToDto(candidate.ObservedAmount), evidence[0].PostedDate, evidence[^1].PostedDate,
            evidence.Length, evidence.Select(value => new PaycheckCandidateEvidenceDto(value.AccountInflowId,
                value.PostedDate, value.Amount, value.Description, imported.Contains(value.AccountInflowId) ? "imported" : "manual",
                value.SlotAnchor, value.TimingOffsetDays)).ToArray());
    }

    private static bool IsDismissed(PaycheckCandidate candidate, IEnumerable<PaycheckCandidateDismissal> dismissals) =>
        dismissals.Any(value => Matches(candidate, value.AlgorithmVersion, value.Cadence, Convert.ToHexStringLower(value.EvidenceFingerprint)));

    private static bool Matches(PaycheckCandidate candidate, string version, PaycheckCadence cadence, string fingerprint) =>
        candidate.AlgorithmVersion == version && candidate.Schedule.Cadence == cadence && candidate.EvidenceFingerprint == fingerprint;

    private static PaycheckError? ValidateDecision(PaycheckCandidateDecisionRequest request, out PaycheckCadence cadence, out byte[] fingerprint)
    {
        cadence = default;
        if (!TryFingerprint(request.Fingerprint, out fingerprint)) return new("fingerprint_invalid", "Candidate fingerprint is invalid.");
        if (!ValidVersion(request.AlgorithmVersion)) return new("algorithm_version_invalid", "Algorithm version is invalid.");
        return PaycheckProfileRules.TryCadence(request.Cadence, out cadence)
            ? null : new("cadence_invalid", "Cadence is invalid.");
    }

    private static bool ValidVersion(string? value) => !string.IsNullOrWhiteSpace(value) && value.Length <= 100;

    private static bool TryFingerprint(string? value, out byte[] fingerprint)
    {
        fingerprint = [];
        if (value is null || value.Length != 64 || value.Any(character =>
                character is not (>= '0' and <= '9') and not (>= 'a' and <= 'f'))) return false;
        fingerprint = Convert.FromHexString(value);
        return true;
    }

    private async Task<IDbContextTransaction?> BeginAsync(CancellationToken cancellationToken) =>
        context.Database.IsRelational() ? await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken) : null;

    private static Task CommitAsync(IDbContextTransaction? transaction, CancellationToken cancellationToken) =>
        transaction?.CommitAsync(cancellationToken) ?? Task.CompletedTask;

    private async Task ResetAsync(IDbContextTransaction? transaction)
    {
        if (transaction is not null)
        {
            await transaction.RollbackAsync(CancellationToken.None);
            await transaction.DisposeAsync();
        }
        context.ChangeTracker.Clear();
    }

    private static bool IsConflict(Exception exception)
    {
        if (exception is DbUpdateConcurrencyException) return true;
        for (Exception? current = exception; current is not null; current = current.InnerException)
            if (current is PostgresException postgres)
                return postgres.SqlState is PostgresErrorCodes.UniqueViolation or PostgresErrorCodes.SerializationFailure or PostgresErrorCodes.DeadlockDetected;
        return false;
    }

    private static PaycheckOperation<T> Fail<T>(string code, string message) => PaycheckOperation<T>.Failure(new(code, message));
    private static PaycheckOperation<T> Changed<T>() => Fail<T>("candidate_changed", "The candidate changed or is no longer available.");
    private static PaycheckOperation<T> NotFound<T>() => Fail<T>("paycheck_not_found", "Paycheck was not found.");
    private static PaycheckOperation<T> InvalidFingerprint<T>() => Fail<T>("fingerprint_invalid", "Candidate fingerprint is invalid.");
    private static PaycheckOperation<T> InvalidSchedule<T>() => Fail<T>("schedule_invalid", "Provide a valid paycheck schedule with only its required fields.");

    private sealed record ReceiptLink(PaycheckOccurrence Occurrence, AccountInflow Inflow);
    private sealed class ReceiptUnavailableException : Exception;
}
