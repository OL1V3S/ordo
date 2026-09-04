namespace BudgetPlanner.Contracts.Paychecks;

public sealed record PaycheckError(string Code, string Message);

public sealed record PaycheckMonthAnchorDto(string? Kind, int? Day);

public sealed record PaycheckScheduleDto(
    string? Cadence,
    DateOnly? ReferenceAnchorDate,
    PaycheckMonthAnchorDto? FirstMonthAnchor,
    PaycheckMonthAnchorDto? SecondMonthAnchor);

public sealed record ConfirmedPaycheckAmountDto(
    string? Mode, decimal? FixedAmount, decimal? MinimumAmount, decimal? MaximumAmount);

public sealed record ObservedPaycheckAmountDto(
    string Mode, decimal? FixedAmount, decimal? MinimumAmount,
    decimal? MaximumAmount, decimal LowerMedianAmount);

public sealed record PaycheckCandidateDecisionRequest(
    string? AlgorithmVersion, string? Cadence, string? Fingerprint);

public sealed record CreatePaycheckRequest(
    string? DisplayName, PaycheckScheduleDto? Schedule,
    int? WindowBeforeDays, int? WindowAfterDays, ConfirmedPaycheckAmountDto? Amount);

public sealed record ConfirmPaycheckRequest(
    string? AlgorithmVersion, string? Fingerprint, string? DisplayName,
    PaycheckScheduleDto? Schedule, int? WindowBeforeDays, int? WindowAfterDays,
    ConfirmedPaycheckAmountDto? Amount);

public sealed record UpdatePaycheckRequest(
    string? DisplayName, int? WindowBeforeDays, int? WindowAfterDays,
    ConfirmedPaycheckAmountDto? Amount);

public sealed record UpdatePaycheckLifecycleRequest(string? Lifecycle);

public sealed record PaycheckCandidateEvidenceDto(
    int AccountInflowId, DateOnly PostedDate, decimal Amount, string Description,
    string Source, DateOnly SlotAnchor, int TimingOffsetDays);

public sealed record PaycheckCandidateDto(
    string Fingerprint, string AlgorithmVersion, string NormalizedDescriptionIdentity,
    PaycheckScheduleDto Schedule, int WindowBeforeDays, int WindowAfterDays,
    ObservedPaycheckAmountDto ObservedAmount, DateOnly CoveredFrom, DateOnly CoveredTo,
    int OccurrenceCount, IReadOnlyList<PaycheckCandidateEvidenceDto> Evidence);

public sealed record PaycheckCandidatesResponse(
    DateOnly EvaluatedOn, IReadOnlyList<PaycheckCandidateDto> Candidates,
    IReadOnlyList<PaycheckCandidateDto> DismissedCandidates);

public sealed record PaycheckOriginDto(string AlgorithmVersion, string Fingerprint);

public sealed record PaycheckProfileEvidenceDto(
    int AccountInflowId, DateOnly PostedDate, decimal Amount, string Description,
    string Source, DateOnly SlotAnchor, int TimingOffsetDays, DateTime LinkedAt,
    bool EditedSinceConfirmation);

public sealed record PaycheckProjectionDto(
    string AlgorithmVersion, DateOnly EvaluatedOn, DateOnly Anchor,
    DateOnly EarliestExpectedDate, DateOnly LatestExpectedDate,
    ConfirmedPaycheckAmountDto Amount);

public sealed record PaycheckProfileDto(
    Guid Id, string DisplayName, string Lifecycle, PaycheckScheduleDto Schedule,
    int WindowBeforeDays, int WindowAfterDays, ConfirmedPaycheckAmountDto Amount,
    string Source, PaycheckOriginDto? Origin, DateTime CreatedAt, DateTime UpdatedAt,
    IReadOnlyList<PaycheckProfileEvidenceDto> Evidence, PaycheckProjectionDto? NextProjection);

public sealed record PaychecksResponse(DateOnly EvaluatedOn, IReadOnlyList<PaycheckProfileDto> Paychecks);

public sealed record ConfirmPaycheckResponse(PaycheckProfileDto Paycheck, bool AlreadyConfirmed);
