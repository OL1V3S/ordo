namespace BudgetPlanner.Contracts.Inflows;

public sealed record CreateInflowRequest(
    string? Description,
    decimal Amount,
    DateOnly? Date);
