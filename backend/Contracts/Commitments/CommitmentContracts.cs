namespace BudgetPlanner.Contracts.Commitments;

public sealed record CommitmentError(string Code, string Message);

public sealed record CommitmentEvidenceResponse(
    int ExpenseId,
    DateOnly Date,
    decimal Amount,
    string Description,
    string Category,
    string Source);

public sealed record CommitmentCandidateResponse(
    string Fingerprint,
    string AlgorithmVersion,
    string Description,
    string Category,
    string Cadence,
    string TimingKind,
    string? ExpectedDayOfWeek,
    int? ExpectedDay,
    int? ExpectedMonth,
    int WindowBeforeDays,
    int WindowAfterDays,
    string ObservedAmountMode,
    decimal ObservedMedianAmount,
    decimal ObservedMinimumAmount,
    decimal ObservedMaximumAmount,
    DateOnly CoveredFrom,
    DateOnly CoveredTo,
    int OccurrenceCount,
    string EvidenceRule,
    IReadOnlyList<CommitmentEvidenceResponse> Evidence);

public sealed record CommitmentCandidatesResponse(
    IReadOnlyList<CommitmentCandidateResponse> Candidates,
    IReadOnlyList<CommitmentCandidateResponse> DismissedCandidates);

public sealed record CandidateDecisionRequest(string? Fingerprint);

public sealed record ConfirmCommitmentRequest(
    string? Fingerprint,
    string? Name,
    string? Category,
    string? Cadence,
    string? TimingKind,
    string? ExpectedDayOfWeek,
    int? ExpectedDay,
    int? ExpectedMonth,
    int WindowBeforeDays,
    int WindowAfterDays,
    string? AmountMode,
    decimal? ExpectedAmount,
    decimal? ExpectedMinimumAmount,
    decimal? ExpectedMaximumAmount);

public sealed record UpdateCommitmentRequest(
    string? Name,
    string? Category,
    string? Cadence,
    string? TimingKind,
    string? ExpectedDayOfWeek,
    int? ExpectedDay,
    int? ExpectedMonth,
    int WindowBeforeDays,
    int WindowAfterDays,
    string? AmountMode,
    decimal? ExpectedAmount,
    decimal? ExpectedMinimumAmount,
    decimal? ExpectedMaximumAmount);

public sealed record UpdateCommitmentLifecycleRequest(string? Lifecycle);

public sealed record CommitmentResponse(
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
    decimal? ExpectedMaximumAmount,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    IReadOnlyList<CommitmentEvidenceResponse> Evidence);

public sealed record ConfirmCommitmentResponse(
    CommitmentResponse Commitment,
    bool AlreadyConfirmed);
