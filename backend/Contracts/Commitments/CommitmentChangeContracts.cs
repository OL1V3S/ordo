namespace BudgetPlanner.Contracts.Commitments;

public sealed record CommitmentChangesResponse(
    DateOnly EvaluatedOn,
    IReadOnlyList<CommitmentChangeResponse> Changes);

public sealed record CommitmentChangeResponse(
    CommitmentChangeSnapshotResponse Commitment,
    string AlgorithmVersion,
    bool IsMatchingAvailable,
    string? UnavailableReason,
    string? NormalizedDescription,
    string? CanonicalCategory,
    IReadOnlyList<CommitmentChangeObservationResponse> Observations,
    CommitmentAmountChangeResponse Amount,
    CommitmentTimingChangeResponse Timing,
    CommitmentMissingResponse Missing);

public sealed record CommitmentChangeSnapshotResponse(
    Guid Id,
    string Name,
    string Category,
    string Lifecycle,
    string Cadence,
    string TimingKind,
    string? ExpectedDayOfWeek,
    int? ExpectedDay,
    int? ExpectedMonth,
    int WindowBeforeDays,
    int WindowAfterDays,
    string AmountMode,
    decimal? ExpectedAmount,
    decimal? ExpectedMinimumAmount,
    decimal? ExpectedMaximumAmount);

public sealed record CommitmentChangeObservationResponse(
    int ExpenseId,
    DateOnly Date,
    decimal Amount,
    string Description,
    string Category,
    string Source,
    DateOnly SlotAnchor,
    int TimingOffsetDays,
    bool IsWithinTimingWindow);

public sealed record CommitmentAmountChangeResponse(
    string State,
    string? Fingerprint,
    string? ProposedMode,
    decimal? ProposedAmount,
    decimal? ProposedMinimumAmount,
    decimal? ProposedMaximumAmount,
    decimal? ObservedMedianAmount,
    IReadOnlyList<int> EvidenceExpenseIds);

public sealed record CommitmentTimingChangeResponse(
    string State,
    string? Fingerprint,
    string? ProposedTimingKind,
    string? ProposedDayOfWeek,
    int? ProposedDay,
    int? ProposedMonth,
    int? ProposedWindowBeforeDays,
    int? ProposedWindowAfterDays,
    IReadOnlyList<int> EvidenceExpenseIds);

public sealed record CommitmentMissingResponse(
    string State,
    string? Fingerprint,
    IReadOnlyList<DateOnly> MissedSlotAnchors);
