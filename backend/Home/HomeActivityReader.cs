using BudgetPlanner.ActivityTimeline;
using BudgetPlanner.Contracts.Home;

namespace BudgetPlanner.Home;

/// <summary>
/// Home recent activity: the newest three rows through the supplied date from the shared
/// activity feed reader, which owns the ordering rule, owner scoping, paycheck-membership
/// join, formatting, and the repeatable-read read-only transaction.
/// </summary>
public sealed class HomeActivityReader(IActivityFeedReader feed) : IHomeActivityReader
{
    private const int Limit = 3;

    public async Task<HomeRecentActivitySectionResponse> ReadAsync(
        string ownerId,
        DateOnly throughDate,
        CancellationToken cancellationToken)
    {
        var page = await feed.ReadAsync(
            new ActivityFeedRequest(ownerId, Limit, null, throughDate, ActivityFeedQueryTags.Home),
            cancellationToken);

        return new HomeRecentActivitySectionResponse(
            new HomeSectionAvailabilityResponse("available", null),
            page.Items);
    }
}
