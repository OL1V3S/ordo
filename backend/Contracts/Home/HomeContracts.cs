namespace BudgetPlanner.Contracts.Home;

public sealed record HomeSectionAvailabilityResponse(
    string State,
    string? ReasonCode);

public sealed record HomeEvaluationsResponse(
    DateOnly ActivityThroughDate,
    DateOnly UpcomingEvaluatedOn);

public sealed record HomeAttentionSectionResponse(
    HomeSectionAvailabilityResponse Availability,
    IReadOnlyList<string> KindsEvaluated,
    IReadOnlyList<HomeAttentionItemResponse>? Items,
    IReadOnlyList<HomeBudgetAttentionItemResponse>? BudgetItems,
    IReadOnlyDictionary<string, HomeSectionAvailabilityResponse> FamilyAvailability,
    DateOnly EvaluatedOn)
{
    public static HomeAttentionSectionResponse Unavailable(DateOnly evaluatedOn) => new(
        new HomeSectionAvailabilityResponse("unavailable", "source_unavailable"),
        [],
        null,
        null,
        new Dictionary<string, HomeSectionAvailabilityResponse>
        {
            ["commitment_change_review"] = new("unavailable", "source_unavailable"),
            ["budget_attention"] = new("unavailable", "source_unavailable")
        },
        evaluatedOn);
}

public sealed record HomeAttentionItemResponse(
    string Kind,
    Guid CommitmentId,
    string CommitmentName,
    IReadOnlyList<HomeCommitmentReviewResponse> Reviews);

public sealed record HomeCommitmentReviewResponse(
    string Dimension,
    string State);

public sealed record HomeBudgetAttentionItemResponse(
    string Kind,
    string Category,
    string State,
    string SpentAmount,
    string LimitAmount);

public sealed record HomePaycheckRelationResponse(
    Guid ProfileId,
    string Relation);

public sealed record HomeActivityItemResponse(
    string Kind,
    int RecordId,
    DateOnly Date,
    string Amount,
    string Description,
    string? Category,
    HomePaycheckRelationResponse? Paycheck);

public sealed record HomeRecentActivitySectionResponse(
    HomeSectionAvailabilityResponse Availability,
    IReadOnlyList<HomeActivityItemResponse>? Items);

public sealed record HomeUpcomingHorizonResponse(
    DateOnly From,
    DateOnly Through);

public sealed record HomeUpcomingAmountResponse(
    string Mode,
    string? FixedAmount,
    string? MinimumAmount,
    string? MaximumAmount);

public sealed record HomeUpcomingItemResponse(
    string Kind,
    Guid PaycheckProfileId,
    string DisplayName,
    string Cadence,
    DateOnly AnchorDate,
    DateOnly EarliestExpectedDate,
    DateOnly LatestExpectedDate,
    HomeUpcomingAmountResponse Amount);

public sealed record HomeUpcomingSectionResponse(
    HomeSectionAvailabilityResponse Availability,
    HomeUpcomingHorizonResponse Horizon,
    IReadOnlyList<HomeUpcomingItemResponse>? Items);

public sealed record HomeResponse(
    DateTimeOffset GeneratedAt,
    string CurrencyCode,
    HomeEvaluationsResponse Evaluations,
    HomeAttentionSectionResponse Attention,
    HomeRecentActivitySectionResponse RecentActivity,
    HomeUpcomingSectionResponse Upcoming);
