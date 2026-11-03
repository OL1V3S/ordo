namespace BudgetPlanner.Contracts.BudgetLimits;

public sealed record UpsertBudgetLimitRequest
{
    public string Category { get; init; } = "";
    public decimal LimitAmount { get; init; }
    public DateTime MonthYear { get; init; }
}
