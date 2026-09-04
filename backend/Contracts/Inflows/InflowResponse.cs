namespace BudgetPlanner.Contracts.Inflows;

public sealed record InflowResponse(
    int Id,
    string Description,
    decimal Amount,
    DateOnly Date);
