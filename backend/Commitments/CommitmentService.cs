using System.Data;
using System.Security.Cryptography;
using BudgetPlanner.Contracts.Commitments;
using BudgetPlanner.Data;
using BudgetPlanner.Import;
using BudgetPlanner.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace BudgetPlanner.Commitments;

public sealed record CommitmentOperation<T>(T? Value, CommitmentError? Error)
{
    public bool IsSuccess => Error is null;
    public static CommitmentOperation<T> Success(T value) => new(value, null);
    public static CommitmentOperation<T> Failure(string code, string message) =>
        new(default, new CommitmentError(code, message));
}

public interface ICommitmentService
{
    Task<CommitmentCandidatesResponse> GetCandidatesAsync(string ownerId, CancellationToken cancellationToken);
    Task<CommitmentOperation<bool>> DismissAsync(string ownerId, CandidateDecisionRequest request, CancellationToken cancellationToken);
    Task<CommitmentOperation<bool>> ReconsiderAsync(string ownerId, CandidateDecisionRequest request, CancellationToken cancellationToken);
    Task<CommitmentOperation<ConfirmCommitmentResponse>> ConfirmAsync(string ownerId, ConfirmCommitmentRequest request, CancellationToken cancellationToken);
    Task<IReadOnlyList<CommitmentResponse>> GetCommitmentsAsync(string ownerId, CancellationToken cancellationToken);
    Task<CommitmentChangesResponse> GetChangesAsync(string ownerId, CancellationToken cancellationToken);
    Task<CommitmentOperation<CommitmentResponse>> UpdateAsync(string ownerId, Guid id, UpdateCommitmentRequest request, CancellationToken cancellationToken);
    Task<CommitmentOperation<CommitmentResponse>> UpdateLifecycleAsync(string ownerId, Guid id, UpdateCommitmentLifecycleRequest request, CancellationToken cancellationToken);
}

public sealed class CommitmentService(
    BudgetContext context,
    ICommitmentDetector detector,
    ICommitmentChangeDetector changeDetector,
    TimeProvider clock) : ICommitmentService
{
    public async Task<CommitmentCandidatesResponse> GetCandidatesAsync(
        string ownerId,
        CancellationToken cancellationToken)
    {
        var state = await LoadCandidateStateAsync(ownerId, cancellationToken);
        var available = state.Detected
            .Where(candidate => candidate.Evidence.All(expense => !state.LinkedExpenseIds.Contains(expense.Id)))
            .ToArray();
        var currentFingerprints = available
            .Select(candidate => FingerprintKey(candidate.EvidenceFingerprint)).ToHashSet();
        var obsolete = state.Dismissals
            .Where(dismissal => !currentFingerprints.Contains(FingerprintKey(dismissal.EvidenceFingerprint)))
            .ToArray();
        if (obsolete.Length > 0)
        {
            context.CommitmentCandidateDismissals.RemoveRange(obsolete);
            await context.SaveChangesAsync(cancellationToken);
        }

        var dismissedKeys = state.Dismissals.Except(obsolete)
            .Select(dismissal => FingerprintKey(dismissal.EvidenceFingerprint)).ToHashSet();
        return new CommitmentCandidatesResponse(
            available.Where(candidate => !dismissedKeys.Contains(FingerprintKey(candidate.EvidenceFingerprint)))
                .Select(candidate => ToCandidateResponse(candidate, state.ImportedExpenseIds)).ToArray(),
            available.Where(candidate => dismissedKeys.Contains(FingerprintKey(candidate.EvidenceFingerprint)))
                .Select(candidate => ToCandidateResponse(candidate, state.ImportedExpenseIds)).ToArray());
    }

    public async Task<CommitmentOperation<bool>> DismissAsync(
        string ownerId,
        CandidateDecisionRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryParseFingerprint(request.Fingerprint, out var fingerprint)) return InvalidFingerprint<bool>();
        await using var transaction = await BeginSerializableTransactionAsync(cancellationToken);
        try
        {
            var state = await LoadCandidateStateAsync(ownerId, cancellationToken);
            var candidate = FindAvailableCandidate(state, fingerprint);
            if (candidate is null)
            {
                await RollbackAsync(transaction);
                return CandidateChanged<bool>();
            }
            if (state.Dismissals.Any(value => FingerprintsEqual(value.EvidenceFingerprint, fingerprint)))
            {
                await CommitAsync(transaction, cancellationToken);
                return CommitmentOperation<bool>.Success(true);
            }
            context.CommitmentCandidateDismissals.Add(new CommitmentCandidateDismissal
            {
                Id = Guid.NewGuid(),
                OwnerId = ownerId,
                AlgorithmVersion = candidate.AlgorithmVersion,
                Cadence = candidate.Cadence,
                EvidenceFingerprint = candidate.EvidenceFingerprint,
                DismissedAt = clock.GetUtcNow().UtcDateTime
            });
            await context.SaveChangesAsync(cancellationToken);
            await CommitAsync(transaction, cancellationToken);
            return CommitmentOperation<bool>.Success(true);
        }
        catch (Exception exception) when (IsConcurrencyConflict(exception))
        {
            await RollbackAsync(transaction);
            context.ChangeTracker.Clear();
            var persisted = await context.CommitmentCandidateDismissals.AsNoTracking().AnyAsync(value =>
                value.OwnerId == ownerId
                && value.EvidenceFingerprint.SequenceEqual(fingerprint),
                cancellationToken);
            return persisted
                ? CommitmentOperation<bool>.Success(true)
                : CandidateChanged<bool>();
        }
    }

    public async Task<CommitmentOperation<bool>> ReconsiderAsync(
        string ownerId,
        CandidateDecisionRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryParseFingerprint(request.Fingerprint, out var fingerprint)) return InvalidFingerprint<bool>();
        await using var transaction = await BeginSerializableTransactionAsync(cancellationToken);
        try
        {
            var state = await LoadCandidateStateAsync(ownerId, cancellationToken);
            if (FindAvailableCandidate(state, fingerprint) is null)
            {
                await RollbackAsync(transaction);
                return CandidateChanged<bool>();
            }
            var dismissal = state.Dismissals.SingleOrDefault(value =>
                FingerprintsEqual(value.EvidenceFingerprint, fingerprint));
            if (dismissal is not null)
            {
                context.CommitmentCandidateDismissals.Remove(dismissal);
                await context.SaveChangesAsync(cancellationToken);
            }
            await CommitAsync(transaction, cancellationToken);
            return CommitmentOperation<bool>.Success(true);
        }
        catch (Exception exception) when (IsConcurrencyConflict(exception))
        {
            await RollbackAsync(transaction);
            context.ChangeTracker.Clear();
            var state = await LoadCandidateStateAsync(ownerId, cancellationToken);
            return FindAvailableCandidate(state, fingerprint) is not null
                && state.Dismissals.All(value => !FingerprintsEqual(value.EvidenceFingerprint, fingerprint))
                ? CommitmentOperation<bool>.Success(true)
                : CandidateChanged<bool>();
        }
    }

    public async Task<CommitmentOperation<ConfirmCommitmentResponse>> ConfirmAsync(
        string ownerId,
        ConfirmCommitmentRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryParseFingerprint(request.Fingerprint, out var fingerprint))
            return InvalidFingerprint<ConfirmCommitmentResponse>();
        var expectation = ValidateExpectation(request);
        if (!expectation.IsSuccess)
            return CommitmentOperation<ConfirmCommitmentResponse>.Failure(
                expectation.Error!.Code,
                expectation.Error.Message);

        await using var transaction = await BeginSerializableTransactionAsync(cancellationToken);
        try
        {
            var existing = await FindByOriginAsync(ownerId, fingerprint, cancellationToken);
            if (existing is not null)
            {
                await CommitAsync(transaction, cancellationToken);
                return CommitmentOperation<ConfirmCommitmentResponse>.Success(
                    new ConfirmCommitmentResponse(await ToCommitmentResponseAsync(existing, cancellationToken), true));
            }

            var state = await LoadCandidateStateAsync(ownerId, cancellationToken);
            var candidate = FindAvailableCandidate(state, fingerprint);
            if (candidate is null)
            {
                await RollbackAsync(transaction);
                return CandidateChanged<ConfirmCommitmentResponse>();
            }
            if (state.Dismissals.Any(value => FingerprintsEqual(value.EvidenceFingerprint, fingerprint)))
            {
                await RollbackAsync(transaction);
                return CommitmentOperation<ConfirmCommitmentResponse>.Failure(
                    "candidate_dismissed",
                    "Reconsider this candidate before confirming it.");
            }

            var values = expectation.Value!;
            var now = clock.GetUtcNow().UtcDateTime;
            var commitment = new Commitment
            {
                Id = Guid.NewGuid(),
                OwnerId = ownerId,
                Name = values.Name,
                Category = values.Category,
                Lifecycle = CommitmentLifecycle.Active,
                Cadence = values.Cadence,
                TimingKind = values.TimingKind,
                ExpectedDayOfWeek = values.ExpectedDayOfWeek,
                ExpectedDay = values.ExpectedDay,
                ExpectedMonth = values.ExpectedMonth,
                WindowBeforeDays = values.WindowBeforeDays,
                WindowAfterDays = values.WindowAfterDays,
                AmountMode = values.AmountMode,
                ExpectedAmount = values.ExpectedAmount,
                ExpectedMinimumAmount = values.ExpectedMinimumAmount,
                ExpectedMaximumAmount = values.ExpectedMaximumAmount,
                OriginAlgorithmVersion = candidate.AlgorithmVersion,
                OriginEvidenceFingerprint = candidate.EvidenceFingerprint,
                CreatedAt = now,
                UpdatedAt = now,
                Occurrences = candidate.Evidence.Select(expense => new CommitmentOccurrence
                {
                    ExpenseId = expense.Id,
                    Kind = CommitmentOccurrenceKind.ConfirmationEvidence,
                    LinkedAt = now
                }).ToList()
            };
            context.Commitments.Add(commitment);
            await context.SaveChangesAsync(cancellationToken);
            await CommitAsync(transaction, cancellationToken);
            return CommitmentOperation<ConfirmCommitmentResponse>.Success(
                new ConfirmCommitmentResponse(await ToCommitmentResponseAsync(commitment, cancellationToken), false));
        }
        catch (Exception exception) when (IsConcurrencyConflict(exception))
        {
            await RollbackAsync(transaction);
            context.ChangeTracker.Clear();
            var existing = await FindByOriginAsync(ownerId, fingerprint, cancellationToken);
            return existing is null
                ? CommitmentOperation<ConfirmCommitmentResponse>.Failure(
                    "confirmation_conflict",
                    "The candidate was changed or confirmed by another request.")
                : CommitmentOperation<ConfirmCommitmentResponse>.Success(
                    new ConfirmCommitmentResponse(await ToCommitmentResponseAsync(existing, cancellationToken), true));
        }
    }

    public async Task<IReadOnlyList<CommitmentResponse>> GetCommitmentsAsync(
        string ownerId,
        CancellationToken cancellationToken)
    {
        var commitments = await context.Commitments.AsNoTracking()
            .Where(value => value.OwnerId == ownerId)
            .Include(value => value.Occurrences).ThenInclude(value => value.Expense)
            .OrderBy(value => value.Name).ThenBy(value => value.Id)
            .ToListAsync(cancellationToken);
        var importedIds = await LoadImportedExpenseIdsAsync(ownerId, cancellationToken);
        return commitments.Select(value => ToCommitmentResponse(value, importedIds)).ToArray();
    }

    public async Task<CommitmentChangesResponse> GetChangesAsync(
        string ownerId,
        CancellationToken cancellationToken)
    {
        var evaluatedOn = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var commitments = await context.Commitments.AsNoTracking()
            .Where(value => value.OwnerId == ownerId)
            .Include(value => value.Occurrences)
            .OrderBy(value => value.Id)
            .ToListAsync(cancellationToken);
        var expenses = await context.Expenses.AsNoTracking()
            .Where(value => value.UserId == ownerId && value.Date <= evaluatedOn)
            .ToListAsync(cancellationToken);
        var expensesById = expenses.ToDictionary(value => value.Id);
        foreach (var occurrence in commitments.SelectMany(value => value.Occurrences))
            occurrence.Expense = expensesById.GetValueOrDefault(occurrence.ExpenseId);

        var detections = changeDetector.Detect(ownerId, commitments, expenses, evaluatedOn);
        var commitmentsById = commitments.ToDictionary(value => value.Id);
        var importedIds = await LoadImportedExpenseIdsAsync(ownerId, cancellationToken);
        return new CommitmentChangesResponse(
            evaluatedOn,
            detections.Select(detection => ToChangeResponse(
                detection,
                commitmentsById[detection.CommitmentId],
                importedIds)).ToArray());
    }

    public async Task<CommitmentOperation<CommitmentResponse>> UpdateAsync(
        string ownerId,
        Guid id,
        UpdateCommitmentRequest request,
        CancellationToken cancellationToken)
    {
        var commitment = await context.Commitments
            .Include(value => value.Occurrences).ThenInclude(value => value.Expense)
            .SingleOrDefaultAsync(value => value.Id == id && value.OwnerId == ownerId, cancellationToken);
        if (commitment is null) return NotFound<CommitmentResponse>();
        var expectation = ValidateExpectation(request);
        if (!expectation.IsSuccess)
            return CommitmentOperation<CommitmentResponse>.Failure(expectation.Error!.Code, expectation.Error.Message);
        var values = expectation.Value!;
        ApplyExpectation(commitment, values);
        commitment.UpdatedAt = clock.GetUtcNow().UtcDateTime;
        await context.SaveChangesAsync(cancellationToken);
        return CommitmentOperation<CommitmentResponse>.Success(
            ToCommitmentResponse(commitment, await LoadImportedExpenseIdsAsync(ownerId, cancellationToken)));
    }

    public async Task<CommitmentOperation<CommitmentResponse>> UpdateLifecycleAsync(
        string ownerId,
        Guid id,
        UpdateCommitmentLifecycleRequest request,
        CancellationToken cancellationToken)
    {
        var commitment = await context.Commitments
            .Include(value => value.Occurrences).ThenInclude(value => value.Expense)
            .SingleOrDefaultAsync(value => value.Id == id && value.OwnerId == ownerId, cancellationToken);
        if (commitment is null) return NotFound<CommitmentResponse>();
        if (!TryParseEnumName(request.Lifecycle, out CommitmentLifecycle lifecycle))
            return CommitmentOperation<CommitmentResponse>.Failure(
                "lifecycle_invalid",
                "Lifecycle must be active, paused, or ended.");
        commitment.Lifecycle = lifecycle;
        commitment.UpdatedAt = clock.GetUtcNow().UtcDateTime;
        await context.SaveChangesAsync(cancellationToken);
        return CommitmentOperation<CommitmentResponse>.Success(
            ToCommitmentResponse(commitment, await LoadImportedExpenseIdsAsync(ownerId, cancellationToken)));
    }

    private async Task<CandidateState> LoadCandidateStateAsync(string ownerId, CancellationToken cancellationToken)
    {
        var expenses = await context.Expenses.AsNoTracking()
            .Where(expense => expense.UserId == ownerId)
            .ToListAsync(cancellationToken);
        var detected = detector.Detect(expenses, DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime));
        var linked = await context.CommitmentOccurrences.AsNoTracking()
            .Where(value => value.Commitment!.OwnerId == ownerId)
            .Select(value => value.ExpenseId)
            .ToHashSetAsync(cancellationToken);
        var dismissals = await context.CommitmentCandidateDismissals
            .Where(value => value.OwnerId == ownerId)
            .ToListAsync(cancellationToken);
        return new CandidateState(
            detected,
            linked,
            dismissals,
            await LoadImportedExpenseIdsAsync(ownerId, cancellationToken));
    }

    private async Task<HashSet<int>> LoadImportedExpenseIdsAsync(string ownerId, CancellationToken cancellationToken) =>
        await context.ImportExpenseProvenances.AsNoTracking()
            .Where(value => value.ExpenseId != null
                && value.Batch!.OwnerId == ownerId
                && value.Expense!.UserId == ownerId)
            .Select(value => value.ExpenseId!.Value)
            .ToHashSetAsync(cancellationToken);

    private static CommitmentCandidate? FindAvailableCandidate(CandidateState state, byte[] fingerprint) =>
        state.Detected.SingleOrDefault(candidate =>
            candidate.Evidence.All(expense => !state.LinkedExpenseIds.Contains(expense.Id))
            && FingerprintsEqual(candidate.EvidenceFingerprint, fingerprint));

    private async Task<Commitment?> FindByOriginAsync(
        string ownerId,
        byte[] fingerprint,
        CancellationToken cancellationToken) =>
        await context.Commitments
            .Include(value => value.Occurrences).ThenInclude(value => value.Expense)
            .SingleOrDefaultAsync(value =>
                value.OwnerId == ownerId
                && value.OriginEvidenceFingerprint != null
                && value.OriginEvidenceFingerprint.SequenceEqual(fingerprint),
                cancellationToken);

    private async Task<CommitmentResponse> ToCommitmentResponseAsync(
        Commitment commitment,
        CancellationToken cancellationToken)
    {
        var loaded = await context.Commitments.AsNoTracking()
            .Include(value => value.Occurrences).ThenInclude(value => value.Expense)
            .SingleAsync(value => value.Id == commitment.Id, cancellationToken);
        return ToCommitmentResponse(
            loaded,
            await LoadImportedExpenseIdsAsync(commitment.OwnerId, cancellationToken));
    }

    private static CommitmentCandidateResponse ToCandidateResponse(
        CommitmentCandidate candidate,
        IReadOnlySet<int> importedExpenseIds) => new(
        FingerprintKey(candidate.EvidenceFingerprint),
        candidate.AlgorithmVersion,
        candidate.Description,
        candidate.Category,
        candidate.Cadence.ToString().ToLowerInvariant(),
        candidate.TimingKind.ToString().ToLowerInvariant(),
        candidate.ExpectedDayOfWeek?.ToString().ToLowerInvariant(),
        candidate.ExpectedDay,
        candidate.ExpectedMonth,
        candidate.WindowBeforeDays,
        candidate.WindowAfterDays,
        candidate.HasFixedObservedAmount ? "fixed" : "variable",
        candidate.ObservedMedianAmount,
        candidate.ObservedMinimumAmount,
        candidate.ObservedMaximumAmount,
        candidate.Evidence[0].Date,
        candidate.Evidence[^1].Date,
        candidate.Evidence.Count,
        candidate.Cadence switch
        {
            CommitmentCadence.Monthly => "consecutive_calendar_months",
            CommitmentCadence.Weekly => "weekly_six_to_eight_day_gaps",
            CommitmentCadence.Yearly => "consecutive_years_same_month",
            _ => throw new InvalidOperationException("Unsupported commitment cadence.")
        },
        candidate.Evidence.Select(expense => ToEvidenceResponse(expense, importedExpenseIds)).ToArray());

    private static CommitmentResponse ToCommitmentResponse(
        Commitment commitment,
        IReadOnlySet<int> importedExpenseIds) => new(
        commitment.Id,
        commitment.Name,
        commitment.Category,
        commitment.Lifecycle.ToString().ToLowerInvariant(),
        commitment.Cadence.ToString().ToLowerInvariant(),
        commitment.TimingKind.ToString().ToLowerInvariant(),
        commitment.ExpectedDayOfWeek?.ToString().ToLowerInvariant(),
        commitment.ExpectedDay,
        commitment.ExpectedMonth,
        commitment.WindowBeforeDays,
        commitment.WindowAfterDays,
        commitment.AmountMode.ToString().ToLowerInvariant(),
        commitment.ExpectedAmount,
        commitment.ExpectedMinimumAmount,
        commitment.ExpectedMaximumAmount,
        commitment.CreatedAt,
        commitment.UpdatedAt,
        commitment.Occurrences
            .Where(value => value.Expense is not null)
            .OrderBy(value => value.Expense!.Date).ThenBy(value => value.ExpenseId)
            .Select(value => ToEvidenceResponse(value.Expense!, importedExpenseIds)).ToArray());

    private static CommitmentChangeResponse ToChangeResponse(
        CommitmentChangeDetection detection,
        Commitment commitment,
        IReadOnlySet<int> importedExpenseIds) => new(
        new CommitmentChangeSnapshotResponse(
            commitment.Id,
            commitment.Name,
            commitment.Category,
            EnumName(commitment.Lifecycle),
            EnumName(commitment.Cadence),
            EnumName(commitment.TimingKind),
            commitment.ExpectedDayOfWeek is null ? null : EnumName(commitment.ExpectedDayOfWeek.Value),
            commitment.ExpectedDay,
            commitment.ExpectedMonth,
            commitment.WindowBeforeDays,
            commitment.WindowAfterDays,
            EnumName(commitment.AmountMode),
            commitment.ExpectedAmount,
            commitment.ExpectedMinimumAmount,
            commitment.ExpectedMaximumAmount),
        detection.AlgorithmVersion,
        detection.IsMatchingAvailable,
        detection.UnavailableReason is null ? null : MatchingUnavailableReasonName(detection.UnavailableReason.Value),
        detection.NormalizedDescription,
        detection.CanonicalCategory,
        detection.Observations.Select(value => ToChangeObservationResponse(value, importedExpenseIds)).ToArray(),
        new CommitmentAmountChangeResponse(
            ChangeStateName(detection.Amount.State),
            detection.Amount.Fingerprint,
            detection.Amount.ProposedMode is null ? null : EnumName(detection.Amount.ProposedMode.Value),
            detection.Amount.ProposedAmount,
            detection.Amount.ProposedMinimumAmount,
            detection.Amount.ProposedMaximumAmount,
            detection.Amount.ObservedMedianAmount,
            detection.Amount.Evidence.Select(value => value.Expense.Id).ToArray()),
        new CommitmentTimingChangeResponse(
            ChangeStateName(detection.Timing.State),
            detection.Timing.Fingerprint,
            detection.Timing.ProposedTimingKind is null ? null : EnumName(detection.Timing.ProposedTimingKind.Value),
            detection.Timing.ProposedDayOfWeek is null ? null : EnumName(detection.Timing.ProposedDayOfWeek.Value),
            detection.Timing.ProposedDay,
            detection.Timing.ProposedMonth,
            detection.Timing.ProposedWindowBeforeDays,
            detection.Timing.ProposedWindowAfterDays,
            detection.Timing.Evidence.Select(value => value.Expense.Id).ToArray()),
        new CommitmentMissingResponse(
            ChangeStateName(detection.Missing.State),
            detection.Missing.Fingerprint,
            detection.Missing.MissedSlotAnchors));

    private static CommitmentChangeObservationResponse ToChangeObservationResponse(
        CommitmentChangeObservation observation,
        IReadOnlySet<int> importedExpenseIds) => new(
        observation.Expense.Id,
        observation.Expense.Date,
        observation.Expense.Amount,
        observation.Expense.Description,
        observation.Expense.Category,
        importedExpenseIds.Contains(observation.Expense.Id) ? "sunflower_pdf" : "manual",
        observation.SlotAnchor,
        observation.TimingOffsetDays,
        observation.IsWithinTimingWindow);

    private static string EnumName<T>(T value) where T : struct, Enum =>
        value.ToString().ToLowerInvariant();

    private static string ChangeStateName(CommitmentChangeState value) => value switch
    {
        CommitmentChangeState.WithinExpectation => "within_expectation",
        CommitmentChangeState.IsolatedOutlier => "isolated_outlier",
        CommitmentChangeState.PossibleChange => "possible_change",
        CommitmentChangeState.ProposedChange => "proposed_change",
        CommitmentChangeState.NotSeenRecently => "not_seen_recently",
        CommitmentChangeState.PossiblyEnded => "possibly_ended",
        CommitmentChangeState.MatchingUnavailable => "matching_unavailable",
        _ => throw new InvalidOperationException($"Unsupported commitment change value '{value}'.")
    };

    private static string MatchingUnavailableReasonName(CommitmentMatchingUnavailableReason value) => value switch
    {
        CommitmentMatchingUnavailableReason.InsufficientConfirmationEvidence => "insufficient_confirmation_evidence",
        CommitmentMatchingUnavailableReason.InconsistentConfirmationIdentity => "inconsistent_confirmation_identity",
        CommitmentMatchingUnavailableReason.SharedActiveIdentity => "shared_active_identity",
        _ => throw new InvalidOperationException($"Unsupported matching-unavailable reason '{value}'.")
    };

    private static CommitmentEvidenceResponse ToEvidenceResponse(Expense expense, IReadOnlySet<int> importedExpenseIds) =>
        new(expense.Id, expense.Date, expense.Amount, expense.Description, expense.Category,
            importedExpenseIds.Contains(expense.Id) ? "sunflower_pdf" : "manual");

    private static CommitmentOperation<Expectation> ValidateExpectation(ConfirmCommitmentRequest request) =>
        ValidateExpectation(
            request.Name, request.Category, request.Cadence, request.TimingKind,
            request.ExpectedDayOfWeek, request.ExpectedDay, request.ExpectedMonth,
            request.WindowBeforeDays, request.WindowAfterDays, request.AmountMode,
            request.ExpectedAmount, request.ExpectedMinimumAmount, request.ExpectedMaximumAmount);

    private static CommitmentOperation<Expectation> ValidateExpectation(UpdateCommitmentRequest request) =>
        ValidateExpectation(
            request.Name, request.Category, request.Cadence, request.TimingKind,
            request.ExpectedDayOfWeek, request.ExpectedDay, request.ExpectedMonth,
            request.WindowBeforeDays, request.WindowAfterDays, request.AmountMode,
            request.ExpectedAmount, request.ExpectedMinimumAmount, request.ExpectedMaximumAmount);

    private static CommitmentOperation<Expectation> ValidateExpectation(
        string? name,
        string? category,
        string? cadenceText,
        string? timingText,
        string? weekdayText,
        int? day,
        int? month,
        int windowBefore,
        int windowAfter,
        string? amountModeText,
        decimal? expectedAmount,
        decimal? minimumAmount,
        decimal? maximumAmount)
    {
        var normalizedName = ExpenseInputRules.NormalizeDescription(name);
        var normalizedCategory = ExpenseInputRules.NormalizeCategory(category);
        if (normalizedName.Length is 0 or > 500)
            return InvalidExpectation("name_invalid", "Name is required and must be 500 characters or fewer.");
        if (normalizedCategory.Length is 0 or > 100 || normalizedCategory == "other")
            return InvalidExpectation("category_invalid", "Category is invalid.");
        if (!TryParseEnumName(cadenceText, out CommitmentCadence cadence))
            return InvalidExpectation("cadence_invalid", "Cadence must be weekly, monthly, or yearly.");
        if (!TryParseEnumName(timingText, out CommitmentTimingKind timingKind))
            return InvalidExpectation("timing_invalid", "Timing kind is invalid.");
        DayOfWeek? weekday = null;
        if (weekdayText is not null)
        {
            if (!TryParseEnumName(weekdayText, out DayOfWeek parsedWeekday))
                return InvalidExpectation("timing_invalid", "Expected weekday is invalid.");
            weekday = parsedWeekday;
        }
        if (!IsValidTiming(cadence, timingKind, weekday, day, month) || windowBefore < 0 || windowAfter < 0)
            return InvalidExpectation("timing_invalid", "Timing fields do not match the selected cadence.");
        if (!TryParseEnumName(amountModeText, out CommitmentAmountMode amountMode)
            || !IsValidAmount(amountMode, expectedAmount, minimumAmount, maximumAmount))
            return InvalidExpectation("amount_invalid", "Amount fields do not match the selected amount mode.");
        return CommitmentOperation<Expectation>.Success(new Expectation(
            normalizedName, normalizedCategory, cadence, timingKind, weekday, day, month,
            windowBefore, windowAfter, amountMode, expectedAmount, minimumAmount, maximumAmount));
    }

    private static bool IsValidTiming(
        CommitmentCadence cadence,
        CommitmentTimingKind timing,
        DayOfWeek? weekday,
        int? day,
        int? month) =>
        cadence switch
        {
            CommitmentCadence.Weekly => timing == CommitmentTimingKind.Weekday
                && weekday is not null && day is null && month is null,
            CommitmentCadence.Monthly when timing == CommitmentTimingKind.DayOfMonth =>
                weekday is null && day is >= 1 and <= 31 && month is null,
            CommitmentCadence.Monthly when timing == CommitmentTimingKind.MonthEnd =>
                weekday is null && day is null && month is null,
            CommitmentCadence.Yearly => timing == CommitmentTimingKind.MonthAndDay
                && weekday is null && month is >= 1 and <= 12 && day is not null
                && day >= 1 && day <= DateTime.DaysInMonth(2000, month.Value),
            _ => false
        };

    private static bool IsValidAmount(
        CommitmentAmountMode mode,
        decimal? expected,
        decimal? minimum,
        decimal? maximum) => mode switch
    {
        CommitmentAmountMode.Fixed => IsValidMoney(expected) && minimum is null && maximum is null,
        CommitmentAmountMode.Range => expected is null && IsValidMoney(minimum) && IsValidMoney(maximum)
            && maximum >= minimum,
        _ => false
    };

    private static bool IsValidMoney(decimal? amount) =>
        amount is > 0m and <= ExpenseInputRules.MaximumAmount && decimal.Round(amount.Value, 2) == amount;

    private static void ApplyExpectation(Commitment commitment, Expectation values)
    {
        commitment.Name = values.Name;
        commitment.Category = values.Category;
        commitment.Cadence = values.Cadence;
        commitment.TimingKind = values.TimingKind;
        commitment.ExpectedDayOfWeek = values.ExpectedDayOfWeek;
        commitment.ExpectedDay = values.ExpectedDay;
        commitment.ExpectedMonth = values.ExpectedMonth;
        commitment.WindowBeforeDays = values.WindowBeforeDays;
        commitment.WindowAfterDays = values.WindowAfterDays;
        commitment.AmountMode = values.AmountMode;
        commitment.ExpectedAmount = values.ExpectedAmount;
        commitment.ExpectedMinimumAmount = values.ExpectedMinimumAmount;
        commitment.ExpectedMaximumAmount = values.ExpectedMaximumAmount;
    }

    private async Task<IDbContextTransaction?> BeginSerializableTransactionAsync(CancellationToken cancellationToken) =>
        context.Database.IsRelational()
            ? await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken)
            : null;

    private static Task CommitAsync(IDbContextTransaction? transaction, CancellationToken cancellationToken) =>
        transaction is null ? Task.CompletedTask : transaction.CommitAsync(cancellationToken);

    private static Task RollbackAsync(IDbContextTransaction? transaction) =>
        transaction is null ? Task.CompletedTask : transaction.RollbackAsync(CancellationToken.None);

    private static bool TryParseFingerprint(string? value, out byte[] fingerprint)
    {
        fingerprint = [];
        if (value is null || value.Length != 64) return false;
        try
        {
            fingerprint = Convert.FromHexString(value);
            return fingerprint.Length == 32;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static bool TryParseEnumName<T>(string? value, out T parsed)
        where T : struct, Enum
    {
        parsed = default;
        return value is not null
            && Enum.GetNames<T>().Any(name => name.Equals(value, StringComparison.OrdinalIgnoreCase))
            && Enum.TryParse(value, true, out parsed);
    }

    private static string FingerprintKey(byte[] fingerprint) => Convert.ToHexStringLower(fingerprint);
    private static bool FingerprintsEqual(byte[] left, byte[] right) =>
        left.Length == right.Length && CryptographicOperations.FixedTimeEquals(left, right);
    private static bool IsConcurrencyConflict(Exception exception) =>
        FindPostgresException(exception)?.SqlState is
            PostgresErrorCodes.UniqueViolation or PostgresErrorCodes.SerializationFailure;

    private static PostgresException? FindPostgresException(Exception? exception)
    {
        while (exception is not null)
        {
            if (exception is PostgresException postgres) return postgres;
            exception = exception.InnerException;
        }
        return null;
    }

    private static CommitmentOperation<T> InvalidFingerprint<T>() =>
        CommitmentOperation<T>.Failure("fingerprint_invalid", "Candidate fingerprint is invalid.");
    private static CommitmentOperation<T> CandidateChanged<T>() =>
        CommitmentOperation<T>.Failure("candidate_changed", "The candidate changed or is no longer available.");
    private static CommitmentOperation<T> NotFound<T>() =>
        CommitmentOperation<T>.Failure("commitment_not_found", "Commitment was not found.");
    private static CommitmentOperation<Expectation> InvalidExpectation(string code, string message) =>
        CommitmentOperation<Expectation>.Failure(code, message);

    private sealed record CandidateState(
        IReadOnlyList<CommitmentCandidate> Detected,
        HashSet<int> LinkedExpenseIds,
        IReadOnlyList<CommitmentCandidateDismissal> Dismissals,
        HashSet<int> ImportedExpenseIds);

    private sealed record Expectation(
        string Name,
        string Category,
        CommitmentCadence Cadence,
        CommitmentTimingKind TimingKind,
        DayOfWeek? ExpectedDayOfWeek,
        int? ExpectedDay,
        int? ExpectedMonth,
        int WindowBeforeDays,
        int WindowAfterDays,
        CommitmentAmountMode AmountMode,
        decimal? ExpectedAmount,
        decimal? ExpectedMinimumAmount,
        decimal? ExpectedMaximumAmount);
}
