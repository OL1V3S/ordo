using System.Data;
using System.Data.Common;
using System.Globalization;
using BudgetPlanner.Commitments;
using BudgetPlanner.Contracts.Commitments;
using BudgetPlanner.Contracts.Home;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using Microsoft.EntityFrameworkCore;

namespace BudgetPlanner.Home;

public sealed class HomeAttentionReader(
    BudgetContext context,
    ICommitmentChangeReadService changes) : IHomeAttentionReader
{
    private const long MaximumCents = 999_999_999_999_999_999L;
    private const decimal MaximumAmount = 9_999_999_999_999_999.99m;

    public async Task<HomeAttentionSectionResponse> ReadAsync(
        string ownerId,
        DateOnly evaluatedOn,
        DateOnly activityThroughDate,
        CancellationToken cancellationToken)
    {
        var commitmentFamily = await ReadCommitmentFamilySafelyAsync(
            ownerId, evaluatedOn, cancellationToken);
        var budgetFamily = await ReadBudgetFamilySafelyAsync(
            ownerId, activityThroughDate, cancellationToken);

        var familyAvailability = new Dictionary<string, HomeSectionAvailabilityResponse>
        {
            ["commitment_change_review"] = commitmentFamily.IsAvailable
                ? Available()
                : Unavailable(),
            ["budget_attention"] = budgetFamily.IsAvailable
                ? Available()
                : Unavailable()
        };
        var kindsEvaluated = new List<string>(2);
        if (commitmentFamily.IsAvailable) kindsEvaluated.Add("commitment_change_review");
        if (budgetFamily.IsAvailable) kindsEvaluated.Add("budget_attention");

        var sectionAvailable = commitmentFamily.IsAvailable || budgetFamily.IsAvailable;
        return new HomeAttentionSectionResponse(
            sectionAvailable ? Available() : Unavailable(),
            kindsEvaluated,
            commitmentFamily.Items,
            budgetFamily.Items,
            familyAvailability,
            evaluatedOn);
    }

    private async Task<FamilyResult<IReadOnlyList<HomeAttentionItemResponse>>> ReadCommitmentFamilySafelyAsync(
        string ownerId,
        DateOnly evaluatedOn,
        CancellationToken cancellationToken)
    {
        try
        {
            await using var transaction = await BeginReadOnlyTransactionAsync(cancellationToken);
            var response = await changes.EvaluateChangesAsync(ownerId, evaluatedOn, cancellationToken);
            var items = response.Changes
                .Select(change => new HomeAttentionItemResponse(
                    "commitment_change_review",
                    change.Commitment.Id,
                    change.Commitment.Name,
                    PendingReviews(change)))
                .Where(item => item.Reviews.Count > 0)
                .ToArray();

            if (transaction is not null)
                await transaction.CommitAsync(cancellationToken);

            return FamilyResult<IReadOnlyList<HomeAttentionItemResponse>>.Available(items);
        }
        catch (Exception exception) when (IsRecoverable(exception))
        {
            return FamilyResult<IReadOnlyList<HomeAttentionItemResponse>>.Unavailable;
        }
    }

    private async Task<FamilyResult<IReadOnlyList<HomeBudgetAttentionItemResponse>>> ReadBudgetFamilySafelyAsync(
        string ownerId,
        DateOnly activityThroughDate,
        CancellationToken cancellationToken)
    {
        try
        {
            await using var transaction = await BeginReadOnlyTransactionAsync(cancellationToken);
            var items = await ReadBudgetItemsAsync(ownerId, activityThroughDate, cancellationToken);

            if (transaction is not null)
                await transaction.CommitAsync(cancellationToken);

            return FamilyResult<IReadOnlyList<HomeBudgetAttentionItemResponse>>.Available(items);
        }
        catch (Exception exception) when (IsRecoverable(exception))
        {
            return FamilyResult<IReadOnlyList<HomeBudgetAttentionItemResponse>>.Unavailable;
        }
    }

    private async Task<IReadOnlyList<HomeBudgetAttentionItemResponse>> ReadBudgetItemsAsync(
        string ownerId,
        DateOnly activityThroughDate,
        CancellationToken cancellationToken)
    {
        var monthStart = new DateOnly(activityThroughDate.Year, activityThroughDate.Month, 1);
        var limits = await context.BudgetLimits.AsNoTracking()
            .Where(limit => limit.UserId == ownerId
                && limit.MonthYear.Year == activityThroughDate.Year
                && limit.MonthYear.Month == activityThroughDate.Month)
            .ToListAsync(cancellationToken);

        var expenses = await context.Expenses.AsNoTracking()
            .Where(expense => expense.UserId == ownerId
                && expense.Date >= monthStart
                && expense.Date <= activityThroughDate)
            .ToListAsync(cancellationToken);

        var limitsByCategory = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var limit in limits)
        {
            if (limit.Category is null)
                throw InvalidBudgetData("A budget category is unavailable.");
            if (limit.LimitAmount < 0)
                throw InvalidBudgetData("A budget amount is negative.");

            var limitCents = ToCents(limit.LimitAmount);
            if (!limitsByCategory.TryAdd(limit.Category, limitCents))
                throw InvalidBudgetData("Duplicate category budgets are ambiguous.");
        }

        var spentByCategory = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var expense in expenses)
        {
            if (expense.Category is null)
                throw InvalidBudgetData("An expense category is unavailable.");
            if (expense.Amount <= 0)
                throw InvalidBudgetData("A recorded expense amount is not positive.");

            var expenseCents = ToCents(expense.Amount);
            if (!limitsByCategory.ContainsKey(expense.Category))
                continue;

            spentByCategory.TryGetValue(expense.Category, out var priorCents);
            if (priorCents > MaximumCents - expenseCents)
                throw InvalidBudgetData("The recorded expense total is outside the supported range.");
            spentByCategory[expense.Category] = priorCents + expenseCents;
        }

        return limitsByCategory
            .Select(limit => CreateBudgetItem(
                limit.Key,
                spentByCategory.GetValueOrDefault(limit.Key),
                limit.Value))
            .Where(item => item is not null)
            .Cast<RankedBudgetItem>()
            .OrderBy(item => item.IsActionable ? 0 : 1)
            .ThenByDescending(item => item.RankCents)
            .ThenBy(item => item.Response.Category, StringComparer.Ordinal)
            .Take(2)
            .Select(item => item.Response)
            .ToArray();
    }

    private static RankedBudgetItem? CreateBudgetItem(string category, long spentCents, long limitCents)
    {
        string? state = null;
        long rankCents = 0;
        if (limitCents == 0)
        {
            if (spentCents > 0)
            {
                state = "zero_limit_spending";
                rankCents = spentCents;
            }
        }
        else if (spentCents == limitCents)
        {
            state = "at_limit";
        }
        else if (spentCents > limitCents)
        {
            state = "over_limit";
            rankCents = spentCents - limitCents;
        }

        if (state is null) return null;
        return new RankedBudgetItem(
            new HomeBudgetAttentionItemResponse(
                "budget_attention",
                category,
                state,
                FormatCents(spentCents),
                FormatCents(limitCents)),
            state != "at_limit",
            rankCents);
    }

    private static long ToCents(decimal amount)
    {
        if (amount < 0 || amount > MaximumAmount)
            throw InvalidBudgetData("A monetary value is outside the supported range.");

        try
        {
            var cents = amount * 100m;
            if (cents != decimal.Truncate(cents) || cents > MaximumCents)
                throw InvalidBudgetData("A monetary value cannot be represented in exact cents.");
            return decimal.ToInt64(cents);
        }
        catch (OverflowException exception)
        {
            throw InvalidBudgetData("A monetary value cannot be represented in exact cents.", exception);
        }
    }

    private static string FormatCents(long cents) => string.Create(
        CultureInfo.InvariantCulture,
        $"{cents / 100}.{cents % 100:00}");

    private async ValueTask<Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction?>
        BeginReadOnlyTransactionAsync(CancellationToken cancellationToken)
    {
        var transaction = context.Database.IsRelational()
            ? await context.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken)
            : null;
        try
        {
            if (context.Database.IsNpgsql())
                await context.Database.ExecuteSqlRawAsync("SET TRANSACTION READ ONLY", cancellationToken);
            return transaction;
        }
        catch
        {
            if (transaction is not null)
                await transaction.DisposeAsync();
            throw;
        }
    }

    private static HomeSectionAvailabilityResponse Available() => new("available", null);

    private static HomeSectionAvailabilityResponse Unavailable() => new("unavailable", "source_unavailable");

    private static bool IsRecoverable(Exception exception) =>
        exception is DbException or TimeoutException or HomeSectionUnavailableException;

    private static HomeSectionUnavailableException InvalidBudgetData(string message) =>
        new(message, new InvalidOperationException("Budget attention data is not authoritative."));

    private static HomeSectionUnavailableException InvalidBudgetData(string message, Exception innerException) =>
        new(message, innerException);

    private static IReadOnlyList<HomeCommitmentReviewResponse> PendingReviews(
        CommitmentChangeResponse change)
    {
        var reviews = new List<HomeCommitmentReviewResponse>(3);
        AddIfPending(reviews, "amount", change.Amount.State, change.Amount.Fingerprint,
            change.Amount.DecisionState, change.Amount.State == "proposed_change");
        AddIfPending(reviews, "timing", change.Timing.State, change.Timing.Fingerprint,
            change.Timing.DecisionState, change.Timing.State == "proposed_change");
        AddIfPending(reviews, "missing", change.Missing.State, change.Missing.Fingerprint,
            change.Missing.DecisionState,
            change.Missing.State is "not_seen_recently" or "possibly_ended");
        return reviews;
    }

    private static void AddIfPending(
        ICollection<HomeCommitmentReviewResponse> reviews,
        string dimension,
        string state,
        string? fingerprint,
        string? decisionState,
        bool actionableState)
    {
        if (actionableState && fingerprint is not null && decisionState == "pending")
            reviews.Add(new HomeCommitmentReviewResponse(dimension, state));
    }

    private sealed record RankedBudgetItem(
        HomeBudgetAttentionItemResponse Response,
        bool IsActionable,
        long RankCents);

    private sealed record FamilyResult<T>(bool IsAvailable, T? Items)
    {
        public static FamilyResult<T> Available(T items) => new(true, items);
        public static FamilyResult<T> Unavailable { get; } = new(false, default);
    }
}
