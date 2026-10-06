using System.Data;
using System.Globalization;
using BudgetPlanner.Contracts.Home;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using Microsoft.EntityFrameworkCore;

namespace BudgetPlanner.ActivityTimeline;

/// <summary>
/// The single definition of the activity ordering rule shared by Home recent activity and
/// the Activity timeline: date descending, expense before cash-in, then id descending.
/// </summary>
public static class ActivityFeedOrdering
{
    public const int ExpenseRank = 0;
    public const int InflowRank = 1;
    public const string ExpenseKind = "expense";
    public const string InflowKind = "account_inflow";
    public const int MaxLimit = 100;
    public const int MaxSearchLength = 100;

    /// <summary>Date descending, then id descending: the single-source projection of the ordering rule.</summary>
    public static IOrderedQueryable<Expense> OrderNewestFirst(this IQueryable<Expense> query) =>
        query.OrderByDescending(value => value.Date).ThenByDescending(value => value.Id);

    /// <summary>Date descending, then id descending: the single-source projection of the ordering rule.</summary>
    public static IOrderedQueryable<AccountInflow> OrderNewestFirst(this IQueryable<AccountInflow> query) =>
        query.OrderByDescending(value => value.Date).ThenByDescending(value => value.Id);
}

/// <summary>
/// Optional narrowing filters. Search is a case-insensitive substring over the description and,
/// for expenses, the category. Dates are inclusive stored-date bounds. Kind is one of the
/// ActivityFeedOrdering kind constants; null means both.
/// </summary>
public sealed record ActivityFeedFilter(
    string? Search = null,
    string? Kind = null,
    DateOnly? From = null,
    DateOnly? To = null);

public sealed record ActivityFeedQueryTags(
    string Expenses,
    string Inflows,
    string PaycheckMembership)
{
    public static ActivityFeedQueryTags Home { get; } = new(
        "Home:expenses", "Home:inflows", "Home:paycheck-membership");

    public static ActivityFeedQueryTags Timeline { get; } = new(
        "ActivityTimeline:expenses", "ActivityTimeline:inflows", "ActivityTimeline:paycheck-membership");
}

public sealed record ActivityFeedRequest(
    string OwnerId,
    int Limit,
    ActivityFeedCursor? After,
    DateOnly? ThroughDate,
    ActivityFeedQueryTags Tags,
    ActivityFeedFilter? Filter = null);

public sealed record ActivityFeedPage(
    IReadOnlyList<HomeActivityItemResponse> Items,
    bool HasMore,
    ActivityFeedCursor? Next);

public interface IActivityFeedReader
{
    Task<ActivityFeedPage> ReadAsync(
        ActivityFeedRequest request,
        CancellationToken cancellationToken);
}

public sealed class ActivityFeedReader(BudgetContext context) : IActivityFeedReader
{
    public async Task<ActivityFeedPage> ReadAsync(
        ActivityFeedRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(request.Limit, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(request.Limit, ActivityFeedOrdering.MaxLimit);

        var ownerId = request.OwnerId;
        var fetch = request.Limit + 1;

        await using var transaction = context.Database.IsRelational()
            ? await context.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken)
            : null;
        if (context.Database.IsNpgsql())
            await context.Database.ExecuteSqlRawAsync("SET TRANSACTION READ ONLY", cancellationToken);

        var expenseQuery = context.Expenses.AsNoTracking().TagWith(request.Tags.Expenses)
            .Where(value => value.UserId == ownerId);
        var inflowQuery = context.AccountInflows.AsNoTracking().TagWith(request.Tags.Inflows)
            .Where(value => value.OwnerId == ownerId);

        if (request.ThroughDate is { } through)
        {
            expenseQuery = expenseQuery.Where(value => value.Date <= through);
            inflowQuery = inflowQuery.Where(value => value.Date <= through);
        }

        var includeExpenses = true;
        var includeInflows = true;
        if (request.Filter is { } filter)
        {
            includeExpenses = filter.Kind is null || filter.Kind == ActivityFeedOrdering.ExpenseKind;
            includeInflows = filter.Kind is null || filter.Kind == ActivityFeedOrdering.InflowKind;
            if (filter.From is { } from)
            {
                expenseQuery = expenseQuery.Where(value => value.Date >= from);
                inflowQuery = inflowQuery.Where(value => value.Date >= from);
            }

            if (filter.To is { } to)
            {
                expenseQuery = expenseQuery.Where(value => value.Date <= to);
                inflowQuery = inflowQuery.Where(value => value.Date <= to);
            }

            if (!string.IsNullOrEmpty(filter.Search))
            {
                var term = filter.Search.ToLowerInvariant();
                expenseQuery = expenseQuery.Where(value =>
                    value.Description.ToLower().Contains(term)
                    || (value.Category != null && value.Category.ToLower().Contains(term)));
                inflowQuery = inflowQuery.Where(value => value.Description.ToLower().Contains(term));
            }
        }

        if (request.After is { } after)
        {
            // A row (d, r, id) follows cursor (D, K, I) iff d < D, or d == D and
            // (r > K or (r == K and id < I)). Expenses have rank 0 and inflows rank 1.
            var afterDate = after.Date;
            var afterId = after.Id;
            expenseQuery = after.Rank == ActivityFeedOrdering.ExpenseRank
                ? expenseQuery.Where(value =>
                    value.Date < afterDate || (value.Date == afterDate && value.Id < afterId))
                : expenseQuery.Where(value => value.Date < afterDate);
            inflowQuery = after.Rank == ActivityFeedOrdering.InflowRank
                ? inflowQuery.Where(value =>
                    value.Date < afterDate || (value.Date == afterDate && value.Id < afterId))
                : inflowQuery.Where(value => value.Date <= afterDate);
        }

        var expenses = includeExpenses
            ? await expenseQuery
                .OrderNewestFirst()
                .Take(fetch)
                .Select(value => new ActivityRow(
                    ActivityFeedOrdering.ExpenseKind, ActivityFeedOrdering.ExpenseRank, value.Id, value.Date,
                    value.Amount, value.Description, value.Category))
                .ToListAsync(cancellationToken)
            : [];

        var inflows = includeInflows
            ? await inflowQuery
                .OrderNewestFirst()
                .Take(fetch)
                .Select(value => new ActivityRow(
                    ActivityFeedOrdering.InflowKind, ActivityFeedOrdering.InflowRank, value.Id, value.Date,
                    value.Amount, value.Description, null))
                .ToListAsync(cancellationToken)
            : [];

        var merged = expenses.Concat(inflows)
            .OrderByDescending(value => value.Date)
            .ThenBy(value => value.KindRank)
            .ThenByDescending(value => value.Id)
            .Take(fetch)
            .ToArray();
        var hasMore = merged.Length > request.Limit;
        var selected = merged.Take(request.Limit).ToArray();

        var inflowIds = selected
            .Where(value => value.Kind == ActivityFeedOrdering.InflowKind)
            .Select(value => value.Id)
            .ToArray();

        var relations = inflowIds.Length == 0
            ? new Dictionary<int, HomePaycheckRelationResponse>()
            : await (
                from occurrence in context.PaycheckOccurrences.AsNoTracking()
                join profile in context.PaycheckProfiles.AsNoTracking()
                    on occurrence.PaycheckProfileId equals profile.Id
                join inflow in context.AccountInflows.AsNoTracking()
                    on occurrence.AccountInflowId equals inflow.Id
                where occurrence.OwnerId == ownerId
                    && profile.OwnerId == ownerId
                    && inflow.OwnerId == ownerId
                    && inflowIds.Contains(inflow.Id)
                select new
                {
                    inflow.Id,
                    ProfileId = profile.Id,
                    occurrence.Kind
                })
                .TagWith(request.Tags.PaycheckMembership)
                .ToDictionaryAsync(
                    value => value.Id,
                    value => new HomePaycheckRelationResponse(
                        value.ProfileId,
                        RelationName(value.Kind)),
                    cancellationToken);

        var items = selected.Select(value => new HomeActivityItemResponse(
            value.Kind,
            value.Id,
            value.Date,
            FormatMoney(value.Amount),
            value.Description,
            value.Category,
            value.Kind == ActivityFeedOrdering.InflowKind
                ? relations.GetValueOrDefault(value.Id)
                : null)).ToArray();

        if (transaction is not null)
            await transaction.CommitAsync(cancellationToken);

        var last = selected.Length == 0 ? null : selected[^1];
        return new ActivityFeedPage(
            items,
            hasMore,
            hasMore && last is not null
                ? new ActivityFeedCursor(last.Date, last.KindRank, last.Id)
                : null);
    }

    private static string FormatMoney(decimal amount) =>
        amount.ToString("0.00", CultureInfo.InvariantCulture);

    private static string RelationName(PaycheckOccurrenceKind kind) => kind switch
    {
        PaycheckOccurrenceKind.ConfirmationEvidence => "confirmation_evidence",
        PaycheckOccurrenceKind.RecordedReceipt => "recorded_receipt",
        _ => throw new InvalidOperationException("Unsupported paycheck occurrence kind.")
    };

    private sealed record ActivityRow(
        string Kind,
        int KindRank,
        int Id,
        DateOnly Date,
        decimal Amount,
        string Description,
        string? Category);
}
