using System.Data.Common;
using BudgetPlanner.Contracts.Home;

namespace BudgetPlanner.Home;

public sealed record HomeReadResult(HomeResponse? Response)
{
    public bool IsUnavailable => Response is null;
}

public interface IHomeReadService
{
    Task<HomeReadResult> GetAsync(
        string ownerId,
        DateOnly activityThroughDate,
        CancellationToken cancellationToken);
}

public interface IHomeActivityReader
{
    Task<HomeRecentActivitySectionResponse> ReadAsync(
        string ownerId,
        DateOnly throughDate,
        CancellationToken cancellationToken);
}

public interface IHomeUpcomingReader
{
    Task<HomeUpcomingSectionResponse> ReadAsync(
        string ownerId,
        DateOnly evaluatedOn,
        CancellationToken cancellationToken);
}

public sealed class HomeReadService(
    IHomeActivityReader activity,
    IHomeUpcomingReader upcoming,
    TimeProvider clock,
    ILogger<HomeReadService> logger) : IHomeReadService
{
    public async Task<HomeReadResult> GetAsync(
        string ownerId,
        DateOnly activityThroughDate,
        CancellationToken cancellationToken)
    {
        var generatedAt = clock.GetUtcNow();
        var upcomingEvaluatedOn = DateOnly.FromDateTime(generatedAt.UtcDateTime);

        var recentActivity = await ReadActivityAsync(ownerId, activityThroughDate, cancellationToken);
        var comingUp = await ReadUpcomingAsync(ownerId, upcomingEvaluatedOn, cancellationToken);

        if (recentActivity.Items is null && comingUp.Items is null)
            return new HomeReadResult(null);

        var available = new HomeSectionAvailabilityResponse("available", null);
        return new HomeReadResult(new HomeResponse(
            generatedAt,
            "USD",
            new HomeEvaluationsResponse(activityThroughDate, upcomingEvaluatedOn),
            new HomeAttentionSectionResponse(available, [], []),
            recentActivity,
            comingUp));
    }

    private async Task<HomeRecentActivitySectionResponse> ReadActivityAsync(
        string ownerId,
        DateOnly throughDate,
        CancellationToken cancellationToken)
    {
        try
        {
            return await activity.ReadAsync(ownerId, throughDate, cancellationToken);
        }
        catch (Exception exception) when (IsRecoverable(exception))
        {
            logger.LogWarning(
                "Home section {Section} is unavailable after {FailureType}.",
                "recent_activity",
                exception.GetType().Name);
            return new HomeRecentActivitySectionResponse(Unavailable(), null);
        }
    }

    private async Task<HomeUpcomingSectionResponse> ReadUpcomingAsync(
        string ownerId,
        DateOnly evaluatedOn,
        CancellationToken cancellationToken)
    {
        try
        {
            return await upcoming.ReadAsync(ownerId, evaluatedOn, cancellationToken);
        }
        catch (Exception exception) when (IsRecoverable(exception))
        {
            logger.LogWarning(
                "Home section {Section} is unavailable after {FailureType}.",
                "upcoming",
                exception.GetType().Name);
            return new HomeUpcomingSectionResponse(
                Unavailable(),
                SafeHorizon(evaluatedOn),
                null);
        }
    }

    private static bool IsRecoverable(Exception exception) =>
        exception is DbException or TimeoutException or HomeSectionUnavailableException;

    private static HomeSectionAvailabilityResponse Unavailable() =>
        new("unavailable", "source_unavailable");

    private static HomeUpcomingHorizonResponse SafeHorizon(DateOnly evaluatedOn)
    {
        try
        {
            return new(evaluatedOn, evaluatedOn.AddDays(13));
        }
        catch (ArgumentOutOfRangeException exception)
        {
            throw new InvalidOperationException("The captured Home evaluation date cannot form a 14-day horizon.", exception);
        }
    }
}

public sealed class HomeSectionUnavailableException : Exception
{
    public HomeSectionUnavailableException(string message, Exception innerException)
        : base(message, innerException) { }
}
