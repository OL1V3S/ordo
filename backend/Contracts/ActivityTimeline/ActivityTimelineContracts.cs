using BudgetPlanner.Contracts.Home;

namespace BudgetPlanner.Contracts.ActivityTimeline;

public sealed record ActivityTimelinePageResponse(
    int Limit,
    bool HasMore,
    string? NextCursor);

public sealed record ActivityTimelineResponse(
    string CurrencyCode,
    IReadOnlyList<HomeActivityItemResponse> Items,
    ActivityTimelinePageResponse Page);
