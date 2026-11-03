using BudgetPlanner.Models;

namespace BudgetPlanner.Contracts.BudgetLimits;

public sealed record BudgetLimitResponse(
    int Id,
    string Category,
    decimal LimitAmount,
    DateTime MonthYear,
    string UserId)
{
    public static BudgetLimitResponse From(BudgetLimit limit) =>
        new(limit.Id, limit.Category, limit.LimitAmount, limit.MonthYear, limit.UserId);
}
