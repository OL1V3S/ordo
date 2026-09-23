using System.Data;
using System.Globalization;
using BudgetPlanner.Contracts.Home;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using Microsoft.EntityFrameworkCore;

namespace BudgetPlanner.Home;

public sealed class HomeActivityReader(BudgetContext context) : IHomeActivityReader
{
    private const int Limit = 3;

    public async Task<HomeRecentActivitySectionResponse> ReadAsync(
        string ownerId,
        DateOnly throughDate,
        CancellationToken cancellationToken)
    {
        await using var transaction = context.Database.IsRelational()
            ? await context.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken)
            : null;
        if (context.Database.IsNpgsql())
            await context.Database.ExecuteSqlRawAsync("SET TRANSACTION READ ONLY", cancellationToken);

        var expenses = await context.Expenses.AsNoTracking().TagWith("Home:expenses")
            .Where(value => value.UserId == ownerId && value.Date <= throughDate)
            .OrderByDescending(value => value.Date)
            .ThenByDescending(value => value.Id)
            .Take(Limit)
            .Select(value => new ActivityRow(
                "expense", 0, value.Id, value.Date, value.Amount,
                value.Description, value.Category))
            .ToListAsync(cancellationToken);

        var inflows = await context.AccountInflows.AsNoTracking().TagWith("Home:inflows")
            .Where(value => value.OwnerId == ownerId && value.Date <= throughDate)
            .OrderByDescending(value => value.Date)
            .ThenByDescending(value => value.Id)
            .Take(Limit)
            .Select(value => new ActivityRow(
                "account_inflow", 1, value.Id, value.Date, value.Amount,
                value.Description, null))
            .ToListAsync(cancellationToken);

        var selected = expenses.Concat(inflows)
            .OrderByDescending(value => value.Date)
            .ThenBy(value => value.KindRank)
            .ThenByDescending(value => value.Id)
            .Take(Limit)
            .ToArray();

        var inflowIds = selected
            .Where(value => value.Kind == "account_inflow")
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
                .TagWith("Home:paycheck-membership")
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
            value.Kind == "account_inflow"
                ? relations.GetValueOrDefault(value.Id)
                : null)).ToArray();

        if (transaction is not null)
            await transaction.CommitAsync(cancellationToken);

        return new HomeRecentActivitySectionResponse(
            new HomeSectionAvailabilityResponse("available", null),
            items);
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
