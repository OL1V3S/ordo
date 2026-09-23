using System.Data;
using System.Globalization;
using BudgetPlanner.Contracts.Home;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using BudgetPlanner.Paychecks;
using Microsoft.EntityFrameworkCore;

namespace BudgetPlanner.Home;

public sealed class HomeUpcomingReader(
    BudgetContext context,
    PaycheckProjector projector) : IHomeUpcomingReader
{
    private const int Limit = 2;

    public async Task<HomeUpcomingSectionResponse> ReadAsync(
        string ownerId,
        DateOnly evaluatedOn,
        CancellationToken cancellationToken)
    {
        HomeUpcomingHorizonResponse horizon;
        try
        {
            horizon = new(evaluatedOn, evaluatedOn.AddDays(13));
        }
        catch (ArgumentOutOfRangeException exception)
        {
            throw new HomeSectionUnavailableException("The upcoming horizon is not representable.", exception);
        }

        await using var transaction = context.Database.IsRelational()
            ? await context.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken)
            : null;
        if (context.Database.IsNpgsql())
            await context.Database.ExecuteSqlRawAsync("SET TRANSACTION READ ONLY", cancellationToken);

        var profiles = await context.PaycheckProfiles.AsNoTracking().TagWith("Home:paycheck-profiles")
            .Where(value => value.OwnerId == ownerId && value.Lifecycle == PaycheckLifecycle.Active)
            .ToListAsync(cancellationToken);

        var latestAnchors = await (
            from occurrence in context.PaycheckOccurrences.AsNoTracking()
            join profile in context.PaycheckProfiles.AsNoTracking()
                on occurrence.PaycheckProfileId equals profile.Id
            join inflow in context.AccountInflows.AsNoTracking()
                on occurrence.AccountInflowId equals inflow.Id
            where occurrence.OwnerId == ownerId
                && profile.OwnerId == ownerId
                && profile.Lifecycle == PaycheckLifecycle.Active
                && inflow.OwnerId == ownerId
            group occurrence by occurrence.PaycheckProfileId into occurrences
            select new
            {
                ProfileId = occurrences.Key,
                SlotAnchor = occurrences.Max(value => value.SlotAnchor)
            })
            .TagWith("Home:paycheck-latest-slots")
            .ToDictionaryAsync(
                value => value.ProfileId,
                value => value.SlotAnchor,
                cancellationToken);

        var projected = new List<(PaycheckProfile Profile, PaycheckProjection Projection)>();
        foreach (var profile in profiles)
        {
            try
            {
                var latestAnchor = latestAnchors.TryGetValue(profile.Id, out var anchor)
                    ? anchor
                    : (DateOnly?)null;
                var pattern = new ConfirmedPaycheckPattern(
                    PaycheckProfileRules.ReadSchedule(profile),
                    profile.WindowBeforeDays,
                    profile.WindowAfterDays,
                    PaycheckProfileRules.ReadAmount(profile),
                    latestAnchor);
                projected.Add((profile, projector.Project(pattern, evaluatedOn)));
            }
            catch (ArgumentOutOfRangeException)
            {
                // A single legacy profile can be unrepresentable at this evaluation date.
                // Keep the section available and continue projecting other active profiles.
            }
        }

        var items = projected
            .Where(value => value.Projection.LatestExpectedDate >= horizon.From
                && value.Projection.EarliestExpectedDate <= horizon.Through)
            .OrderBy(value => value.Projection.EarliestExpectedDate)
            .ThenBy(value => value.Projection.LatestExpectedDate)
            .ThenBy(value => value.Profile.Id)
            .Take(Limit)
            .Select(value => ToResponse(value.Profile, value.Projection))
            .ToArray();

        if (transaction is not null)
            await transaction.CommitAsync(cancellationToken);

        return new HomeUpcomingSectionResponse(
            new HomeSectionAvailabilityResponse("available", null),
            horizon,
            items);
    }

    private static HomeUpcomingItemResponse ToResponse(
        PaycheckProfile profile,
        PaycheckProjection projection) => new(
        "paycheck_projection",
        profile.Id,
        profile.DisplayName,
        profile.Cadence.ToString().ToLowerInvariant(),
        projection.Anchor,
        projection.EarliestExpectedDate,
        projection.LatestExpectedDate,
        projection.Amount switch
        {
            FixedConfirmedPaycheckAmount fixedAmount => new HomeUpcomingAmountResponse(
                "fixed", FormatMoney(fixedAmount.Amount), null, null),
            RangeConfirmedPaycheckAmount range => new HomeUpcomingAmountResponse(
                "range", null, FormatMoney(range.Minimum), FormatMoney(range.Maximum)),
            _ => throw new InvalidOperationException("Unsupported confirmed paycheck amount.")
        });

    private static string FormatMoney(decimal amount) =>
        amount.ToString("0.00", CultureInfo.InvariantCulture);
}
