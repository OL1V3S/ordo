using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using BudgetPlanner.Import;
using BudgetPlanner.Models;

namespace BudgetPlanner.Commitments;

public enum CommitmentChangeState
{
    WithinExpectation,
    IsolatedOutlier,
    PossibleChange,
    ProposedChange,
    NotSeenRecently,
    PossiblyEnded,
    MatchingUnavailable
}

public enum CommitmentMatchingUnavailableReason
{
    InsufficientConfirmationEvidence,
    InconsistentConfirmationIdentity,
    SharedActiveIdentity
}

public sealed record CommitmentChangeObservation(
    Expense Expense,
    DateOnly SlotAnchor,
    int TimingOffsetDays,
    bool IsWithinTimingWindow);

public sealed record CommitmentAmountChangeAssessment(
    CommitmentChangeState State,
    string? Fingerprint,
    CommitmentAmountMode? ProposedMode,
    decimal? ProposedAmount,
    decimal? ProposedMinimumAmount,
    decimal? ProposedMaximumAmount,
    decimal? ObservedMedianAmount,
    IReadOnlyList<CommitmentChangeObservation> Evidence);

public sealed record CommitmentTimingChangeAssessment(
    CommitmentChangeState State,
    string? Fingerprint,
    CommitmentTimingKind? ProposedTimingKind,
    DayOfWeek? ProposedDayOfWeek,
    int? ProposedDay,
    int? ProposedMonth,
    int? ProposedWindowBeforeDays,
    int? ProposedWindowAfterDays,
    IReadOnlyList<CommitmentChangeObservation> Evidence);

public sealed record CommitmentMissingAssessment(
    CommitmentChangeState State,
    string? Fingerprint,
    IReadOnlyList<DateOnly> MissedSlotAnchors);

public sealed record CommitmentChangeDetection(
    Guid CommitmentId,
    string AlgorithmVersion,
    bool IsMatchingAvailable,
    CommitmentMatchingUnavailableReason? UnavailableReason,
    string? NormalizedDescription,
    string? CanonicalCategory,
    IReadOnlyList<CommitmentChangeObservation> Observations,
    CommitmentAmountChangeAssessment Amount,
    CommitmentTimingChangeAssessment Timing,
    CommitmentMissingAssessment Missing);

public interface ICommitmentChangeDetector
{
    IReadOnlyList<CommitmentChangeDetection> Detect(
        string ownerId,
        IEnumerable<Commitment> commitments,
        IEnumerable<Expense> expenses,
        DateOnly today);
}

public sealed class CommitmentChangeDetector : ICommitmentChangeDetector
{
    public const string AlgorithmVersion = "commitment-change-v1";
    private static readonly byte[] FingerprintDomain = "ordo.commitment-change.v1\0"u8.ToArray();

    public IReadOnlyList<CommitmentChangeDetection> Detect(
        string ownerId,
        IEnumerable<Commitment> commitments,
        IEnumerable<Expense> expenses,
        DateOnly today)
    {
        var ownedActive = commitments
            .Where(value => value.OwnerId == ownerId && value.Lifecycle == CommitmentLifecycle.Active)
            .OrderBy(value => value.Id)
            .ToArray();
        var ownedExpenses = expenses
            .Where(value => value.UserId == ownerId && value.Date <= today)
            .ToArray();
        var identities = ownedActive.ToDictionary(value => value.Id, DeriveIdentity);
        var shared = identities
            .Where(value => value.Value.Identity is not null)
            .GroupBy(value => value.Value.Identity!)
            .Where(group => group.Count() > 1)
            .SelectMany(group => group.Select(value => value.Key))
            .ToHashSet();

        return ownedActive.Select(commitment =>
        {
            var identityResult = identities[commitment.Id];
            if (identityResult.Identity is null)
                return Unavailable(commitment, identityResult.Reason!.Value);
            if (shared.Contains(commitment.Id))
                return Unavailable(commitment, CommitmentMatchingUnavailableReason.SharedActiveIdentity);
            return DetectOne(commitment, identityResult.Identity, ownedExpenses, today);
        }).ToArray();
    }

    private static IdentityResult DeriveIdentity(Commitment commitment)
    {
        var evidence = commitment.Occurrences
            .Where(value => value.Kind == CommitmentOccurrenceKind.ConfirmationEvidence && value.Expense is not null)
            .Select(value => value.Expense!)
            .Where(value => value.UserId == commitment.OwnerId)
            .OrderBy(value => value.Date).ThenBy(value => value.Id)
            .ToArray();
        if (evidence.Length < 2)
            return new(null, CommitmentMatchingUnavailableReason.InsufficientConfirmationEvidence);
        var identities = evidence.Select(value => new ObservationIdentity(
                ExpenseInputRules.NormalizeDescriptionForComparison(value.Description),
                ExpenseInputRules.NormalizeCategory(value.Category)))
            .Distinct()
            .ToArray();
        return identities.Length == 1
            ? new IdentityResult(identities[0], null)
            : new IdentityResult(null, CommitmentMatchingUnavailableReason.InconsistentConfirmationIdentity);
    }

    private static CommitmentChangeDetection DetectOne(
        Commitment commitment,
        ObservationIdentity identity,
        IReadOnlyList<Expense> ownedExpenses,
        DateOnly today)
    {
        var confirmation = commitment.Occurrences
            .Where(value => value.Kind == CommitmentOccurrenceKind.ConfirmationEvidence && value.Expense is not null)
            .Select(value => value.Expense!)
            .Where(value => value.UserId == commitment.OwnerId)
            .OrderBy(value => value.Date).ThenBy(value => value.Id)
            .ToArray();
        var latestConfirmationDate = confirmation[^1].Date;
        var slots = BuildSlots(commitment, latestConfirmationDate, today).ToArray();
        var eligible = ownedExpenses
            .Where(value => value.Date > latestConfirmationDate)
            .Where(value => ExpenseInputRules.NormalizeDescriptionForComparison(value.Description) == identity.Description
                && ExpenseInputRules.NormalizeCategory(value.Category) == identity.Category)
            .OrderBy(value => value.Date).ThenBy(value => value.Id)
            .ToArray();

        AssignExpenses(commitment, slots, eligible);
        var observations = slots
            .Where(value => !value.IsAmbiguous && value.Expenses.Count == 1)
            .Select(value => ToObservation(commitment, value, value.Expenses[0]))
            .ToArray();
        var amount = AssessAmount(commitment, identity, confirmation, slots, observations, today);
        var timing = AssessTiming(commitment, identity, confirmation, slots, observations, today);
        var missing = AssessMissing(commitment, identity, confirmation, slots, observations, today);
        return new CommitmentChangeDetection(
            commitment.Id,
            AlgorithmVersion,
            true,
            null,
            identity.Description,
            identity.Category,
            observations,
            amount,
            timing,
            missing);
    }

    private static IEnumerable<OccurrenceSlot> BuildSlots(
        Commitment commitment,
        DateOnly latestConfirmationDate,
        DateOnly today)
    {
        var anchor = NextAnchor(commitment, latestConfirmationDate);
        var guard = 0;
        while (PlausibilityStart(commitment, anchor) <= today && guard++ < 10000)
        {
            yield return new OccurrenceSlot(anchor);
            anchor = NextAnchor(commitment, anchor);
        }
    }

    private static DateOnly NextAnchor(Commitment commitment, DateOnly after)
    {
        return commitment.Cadence switch
        {
            CommitmentCadence.Weekly => NextWeekday(after, commitment.ExpectedDayOfWeek!.Value),
            CommitmentCadence.Monthly => MonthlyAnchor(
                after.Month == 12 ? after.Year + 1 : after.Year,
                after.Month == 12 ? 1 : after.Month + 1,
                commitment),
            CommitmentCadence.Yearly => YearlyAnchor(after.Year + 1, commitment),
            _ => throw new InvalidOperationException("Unsupported commitment cadence.")
        };
    }

    private static DateOnly NextWeekday(DateOnly after, DayOfWeek weekday)
    {
        var days = ((int)weekday - (int)after.DayOfWeek + 7) % 7;
        return after.AddDays(days == 0 ? 7 : days);
    }

    private static DateOnly MonthlyAnchor(int year, int month, Commitment commitment)
    {
        var day = commitment.TimingKind == CommitmentTimingKind.MonthEnd
            ? DateTime.DaysInMonth(year, month)
            : Math.Min(commitment.ExpectedDay!.Value, DateTime.DaysInMonth(year, month));
        return new DateOnly(year, month, day);
    }

    private static DateOnly YearlyAnchor(int year, Commitment commitment)
    {
        var month = commitment.ExpectedMonth!.Value;
        var day = Math.Min(commitment.ExpectedDay!.Value, DateTime.DaysInMonth(year, month));
        return new DateOnly(year, month, day);
    }

    private static DateOnly PlausibilityStart(Commitment commitment, DateOnly anchor) =>
        anchor.AddDays(-Math.Max(commitment.WindowBeforeDays, DefaultPlausibilityDays(commitment.Cadence)));

    private static DateOnly PlausibilityEnd(Commitment commitment, DateOnly anchor) =>
        anchor.AddDays(Math.Max(commitment.WindowAfterDays, DefaultPlausibilityDays(commitment.Cadence)));

    private static int DefaultPlausibilityDays(CommitmentCadence cadence) =>
        cadence == CommitmentCadence.Weekly ? 3 : 6;

    private static void AssignExpenses(
        Commitment commitment,
        IReadOnlyList<OccurrenceSlot> slots,
        IReadOnlyList<Expense> expenses)
    {
        foreach (var expense in expenses)
        {
            var candidates = slots
                .Where(slot => expense.Date >= PlausibilityStart(commitment, slot.Anchor)
                    && expense.Date <= PlausibilityEnd(commitment, slot.Anchor))
                .Select(slot => (Slot: slot, Distance: Math.Abs(expense.Date.DayNumber - slot.Anchor.DayNumber)))
                .OrderBy(value => value.Distance)
                .ToArray();
            if (candidates.Length == 0) continue;
            if (candidates.Length > 1 && candidates[0].Distance == candidates[1].Distance)
            {
                foreach (var candidate in candidates.Where(value => value.Distance == candidates[0].Distance))
                    candidate.Slot.IsAmbiguous = true;
                continue;
            }
            candidates[0].Slot.Expenses.Add(expense);
        }
        foreach (var slot in slots.Where(value => value.Expenses.Count > 1))
            slot.IsAmbiguous = true;
    }

    private static CommitmentChangeObservation ToObservation(
        Commitment commitment,
        OccurrenceSlot slot,
        Expense expense)
    {
        var offset = expense.Date.DayNumber - slot.Anchor.DayNumber;
        return new CommitmentChangeObservation(
            expense,
            slot.Anchor,
            offset,
            offset >= -commitment.WindowBeforeDays && offset <= commitment.WindowAfterDays);
    }

    private static CommitmentAmountChangeAssessment AssessAmount(
        Commitment commitment,
        ObservationIdentity identity,
        IReadOnlyList<Expense> confirmation,
        IReadOnlyList<OccurrenceSlot> slots,
        IReadOnlyList<CommitmentChangeObservation> observations,
        DateOnly today)
    {
        var byAnchor = observations.ToDictionary(value => value.SlotAnchor);
        var run = new List<CommitmentChangeObservation>();
        foreach (var slot in slots)
        {
            if (slot.IsAmbiguous || !byAnchor.TryGetValue(slot.Anchor, out var observation))
            {
                if (slot.IsAmbiguous || AcceptedWindowEnd(commitment, slot.Anchor) < today) run.Clear();
                continue;
            }
            if (AmountWithin(commitment, observation.Expense.Amount)) run.Clear();
            else run.Add(observation);
        }
        var state = RunState(run.Count);
        if (state == CommitmentChangeState.WithinExpectation)
            return new(state, null, null, null, null, null, null, []);
        var evidence = run.TakeLast(6).ToArray();
        var amounts = evidence.Select(value => value.Expense.Amount).Order().ToArray();
        var median = LowerMedian(amounts);
        var proposedMode = amounts[0] == amounts[^1] ? CommitmentAmountMode.Fixed : CommitmentAmountMode.Range;
        var result = new CommitmentAmountChangeAssessment(
            state,
            null,
            state == CommitmentChangeState.ProposedChange ? proposedMode : null,
            state == CommitmentChangeState.ProposedChange && proposedMode == CommitmentAmountMode.Fixed ? amounts[0] : null,
            state == CommitmentChangeState.ProposedChange && proposedMode == CommitmentAmountMode.Range ? amounts[0] : null,
            state == CommitmentChangeState.ProposedChange && proposedMode == CommitmentAmountMode.Range ? amounts[^1] : null,
            median,
            evidence);
        return result with { Fingerprint = Fingerprint(commitment, identity, confirmation, slots, observations, "amount", result, today) };
    }

    private static CommitmentTimingChangeAssessment AssessTiming(
        Commitment commitment,
        ObservationIdentity identity,
        IReadOnlyList<Expense> confirmation,
        IReadOnlyList<OccurrenceSlot> slots,
        IReadOnlyList<CommitmentChangeObservation> observations,
        DateOnly today)
    {
        var byAnchor = observations.ToDictionary(value => value.SlotAnchor);
        var run = new List<CommitmentChangeObservation>();
        var direction = 0;
        foreach (var slot in slots)
        {
            if (slot.IsAmbiguous || !byAnchor.TryGetValue(slot.Anchor, out var observation))
            {
                if (slot.IsAmbiguous || AcceptedWindowEnd(commitment, slot.Anchor) < today)
                {
                    run.Clear();
                    direction = 0;
                }
                continue;
            }
            var currentDirection = observation.TimingOffsetDays < -commitment.WindowBeforeDays ? -1
                : observation.TimingOffsetDays > commitment.WindowAfterDays ? 1 : 0;
            if (currentDirection == 0)
            {
                run.Clear();
                direction = 0;
            }
            else if (direction == 0 || direction == currentDirection)
            {
                direction = currentDirection;
                run.Add(observation);
            }
            else
            {
                run.Clear();
                run.Add(observation);
                direction = currentDirection;
            }
        }
        var state = RunState(run.Count);
        if (state == CommitmentChangeState.WithinExpectation)
            return new(state, null, null, null, null, null, null, null, []);
        var evidence = run.TakeLast(6).ToArray();
        var proposal = state == CommitmentChangeState.ProposedChange
            ? DeriveTimingProposal(commitment, evidence)
            : default;
        var result = new CommitmentTimingChangeAssessment(
            state,
            null,
            proposal?.Kind,
            proposal?.DayOfWeek,
            proposal?.Day,
            proposal?.Month,
            proposal?.WindowBefore,
            proposal?.WindowAfter,
            evidence);
        return result with { Fingerprint = Fingerprint(commitment, identity, confirmation, slots, observations, "timing", result, today) };
    }

    private static CommitmentMissingAssessment AssessMissing(
        Commitment commitment,
        ObservationIdentity identity,
        IReadOnlyList<Expense> confirmation,
        IReadOnlyList<OccurrenceSlot> slots,
        IReadOnlyList<CommitmentChangeObservation> observations,
        DateOnly today)
    {
        var observed = observations.Select(value => value.SlotAnchor).ToHashSet();
        var missed = new List<DateOnly>();
        foreach (var slot in slots)
        {
            if (AcceptedWindowEnd(commitment, slot.Anchor) >= today) continue;
            if (slot.IsAmbiguous || observed.Contains(slot.Anchor)) missed.Clear();
            else missed.Add(slot.Anchor);
        }
        var threshold = commitment.Cadence == CommitmentCadence.Yearly ? (NotSeen: 1, Ended: 2) : (NotSeen: 2, Ended: 3);
        var state = missed.Count >= threshold.Ended ? CommitmentChangeState.PossiblyEnded
            : missed.Count >= threshold.NotSeen ? CommitmentChangeState.NotSeenRecently
            : CommitmentChangeState.WithinExpectation;
        if (state == CommitmentChangeState.WithinExpectation)
            return new(state, null, missed);
        var result = new CommitmentMissingAssessment(state, null, missed);
        return result with { Fingerprint = Fingerprint(commitment, identity, confirmation, slots, observations, "missing", result, today) };
    }

    private static DateOnly AcceptedWindowEnd(Commitment commitment, DateOnly anchor) =>
        anchor.AddDays(commitment.WindowAfterDays);

    private static bool AmountWithin(Commitment commitment, decimal amount) =>
        commitment.AmountMode == CommitmentAmountMode.Fixed
            ? amount == commitment.ExpectedAmount
            : amount >= commitment.ExpectedMinimumAmount && amount <= commitment.ExpectedMaximumAmount;

    private static CommitmentChangeState RunState(int count) => count switch
    {
        0 => CommitmentChangeState.WithinExpectation,
        1 => CommitmentChangeState.IsolatedOutlier,
        2 => CommitmentChangeState.PossibleChange,
        _ => CommitmentChangeState.ProposedChange
    };

    private static decimal LowerMedian(IReadOnlyList<decimal> values) => values[(values.Count - 1) / 2];

    private static TimingProposal DeriveTimingProposal(
        Commitment commitment,
        IReadOnlyList<CommitmentChangeObservation> evidence)
    {
        var offsets = evidence.Select(value => value.TimingOffsetDays).Order().ToArray();
        var medianOffset = offsets[(offsets.Length - 1) / 2];
        if (commitment.Cadence == CommitmentCadence.Weekly)
        {
            var day = (DayOfWeek)(((int)commitment.ExpectedDayOfWeek!.Value + medianOffset % 7 + 7) % 7);
            return WithWindows(CommitmentTimingKind.Weekday, day, null, null, evidence,
                value => SignedWeekdayOffset(day, value.Expense.Date.DayOfWeek));
        }
        if (commitment.Cadence == CommitmentCadence.Monthly)
        {
            var monthEndOffsets = evidence.Select(value => DateTime.DaysInMonth(
                value.Expense.Date.Year, value.Expense.Date.Month) - value.Expense.Date.Day).ToArray();
            if (monthEndOffsets.All(value => value <= 3) && monthEndOffsets.Max() - monthEndOffsets.Min() <= 2)
                return WithWindows(CommitmentTimingKind.MonthEnd, null, null, null, evidence,
                    value => value.Expense.Date.DayNumber - new DateOnly(
                        value.Expense.Date.Year,
                        value.Expense.Date.Month,
                        DateTime.DaysInMonth(value.Expense.Date.Year, value.Expense.Date.Month)).DayNumber);
            var days = evidence.Select(value => value.Expense.Date.Day).Order().ToArray();
            var day = days[(days.Length - 1) / 2];
            return WithWindows(CommitmentTimingKind.DayOfMonth, null, day, null, evidence,
                value => value.Expense.Date.DayNumber - new DateOnly(
                    value.Expense.Date.Year,
                    value.Expense.Date.Month,
                    Math.Min(day, DateTime.DaysInMonth(value.Expense.Date.Year, value.Expense.Date.Month))).DayNumber);
        }
        var reference = YearlyAnchor(2000, commitment).AddDays(medianOffset);
        return WithWindows(CommitmentTimingKind.MonthAndDay, null, reference.Day, reference.Month, evidence,
            value => value.Expense.Date.DayNumber - new DateOnly(
                value.Expense.Date.Year,
                reference.Month,
                Math.Min(reference.Day, DateTime.DaysInMonth(value.Expense.Date.Year, reference.Month))).DayNumber);
    }

    private static TimingProposal WithWindows(
        CommitmentTimingKind kind,
        DayOfWeek? weekday,
        int? day,
        int? month,
        IReadOnlyList<CommitmentChangeObservation> evidence,
        Func<CommitmentChangeObservation, int> offset)
    {
        var offsets = evidence.Select(offset).ToArray();
        return new TimingProposal(kind, weekday, day, month, Math.Max(0, -offsets.Min()), Math.Max(0, offsets.Max()));
    }

    private static int SignedWeekdayOffset(DayOfWeek expected, DayOfWeek actual) =>
        ((int)actual - (int)expected + 10) % 7 - 3;

    private static string Fingerprint(
        Commitment commitment,
        ObservationIdentity identity,
        IReadOnlyList<Expense> confirmation,
        IReadOnlyList<OccurrenceSlot> slots,
        IReadOnlyList<CommitmentChangeObservation> observations,
        string kind,
        object result,
        DateOnly today)
    {
        using var stream = new MemoryStream();
        stream.Write(FingerprintDomain);
        Write(stream, AlgorithmVersion);
        stream.Write(commitment.Id.ToByteArray());
        Write(stream, kind);
        Write(stream, commitment.Lifecycle.ToString());
        Write(stream, commitment.Cadence.ToString());
        Write(stream, commitment.TimingKind.ToString());
        Write(stream, commitment.ExpectedDayOfWeek?.ToString() ?? "");
        Write(stream, commitment.ExpectedDay ?? -1);
        Write(stream, commitment.ExpectedMonth ?? -1);
        Write(stream, commitment.WindowBeforeDays);
        Write(stream, commitment.WindowAfterDays);
        Write(stream, commitment.AmountMode.ToString());
        Write(stream, commitment.ExpectedAmount);
        Write(stream, commitment.ExpectedMinimumAmount);
        Write(stream, commitment.ExpectedMaximumAmount);
        Write(stream, identity.Description);
        Write(stream, identity.Category);
        Write(stream, confirmation.Count);
        foreach (var expense in confirmation)
        {
            Write(stream, expense.Id);
            stream.Write(expense.CommitmentEvidenceRevision.ToByteArray());
        }
        Write(stream, observations.Count);
        foreach (var observation in observations.OrderBy(value => value.SlotAnchor).ThenBy(value => value.Expense.Id))
        {
            Write(stream, observation.Expense.Id);
            stream.Write(observation.Expense.CommitmentEvidenceRevision.ToByteArray());
        }
        if (kind == "missing")
        {
            var relevantSlots = slots.Where(value =>
                    AcceptedWindowEnd(commitment, value.Anchor) < today
                    && (value.IsAmbiguous || value.Expenses.Count == 0))
                .ToArray();
            Write(stream, relevantSlots.Length);
            foreach (var slot in relevantSlots)
                Write(stream, slot.Anchor.DayNumber);
        }
        WriteResult(stream, result);
        return Convert.ToHexStringLower(SHA256.HashData(stream.ToArray()));
    }

    private static void WriteResult(Stream stream, object result)
    {
        switch (result)
        {
            case CommitmentAmountChangeAssessment amount:
                Write(stream, amount.State.ToString());
                Write(stream, amount.ProposedMode?.ToString() ?? "");
                Write(stream, amount.ProposedAmount);
                Write(stream, amount.ProposedMinimumAmount);
                Write(stream, amount.ProposedMaximumAmount);
                Write(stream, amount.ObservedMedianAmount);
                break;
            case CommitmentTimingChangeAssessment timing:
                Write(stream, timing.State.ToString());
                Write(stream, timing.ProposedTimingKind?.ToString() ?? "");
                Write(stream, timing.ProposedDayOfWeek?.ToString() ?? "");
                Write(stream, timing.ProposedDay ?? -1);
                Write(stream, timing.ProposedMonth ?? -1);
                Write(stream, timing.ProposedWindowBeforeDays ?? -1);
                Write(stream, timing.ProposedWindowAfterDays ?? -1);
                break;
            case CommitmentMissingAssessment missing:
                Write(stream, missing.State.ToString());
                foreach (var anchor in missing.MissedSlotAnchors) Write(stream, anchor.DayNumber);
                break;
            default:
                throw new InvalidOperationException("Unsupported commitment change fingerprint result.");
        }
    }

    private static void Write(Stream stream, string value)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        Write(stream, bytes.Length);
        stream.Write(bytes);
    }

    private static void Write(Stream stream, int value)
    {
        Span<byte> bytes = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(bytes, value);
        stream.Write(bytes);
    }

    private static void Write(Stream stream, decimal? value)
    {
        Write(stream, value?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "");
    }

    private static CommitmentChangeDetection Unavailable(
        Commitment commitment,
        CommitmentMatchingUnavailableReason reason) => new(
        commitment.Id,
        AlgorithmVersion,
        false,
        reason,
        null,
        null,
        [],
        new(CommitmentChangeState.MatchingUnavailable, null, null, null, null, null, null, []),
        new(CommitmentChangeState.MatchingUnavailable, null, null, null, null, null, null, null, []),
        new(CommitmentChangeState.MatchingUnavailable, null, []));

    private sealed record ObservationIdentity(string Description, string Category);
    private sealed record IdentityResult(
        ObservationIdentity? Identity,
        CommitmentMatchingUnavailableReason? Reason);
    private sealed class OccurrenceSlot(DateOnly anchor)
    {
        public DateOnly Anchor { get; } = anchor;
        public List<Expense> Expenses { get; } = [];
        public bool IsAmbiguous { get; set; }
    }
    private sealed record TimingProposal(
        CommitmentTimingKind Kind,
        DayOfWeek? DayOfWeek,
        int? Day,
        int? Month,
        int WindowBefore,
        int WindowAfter);
}
