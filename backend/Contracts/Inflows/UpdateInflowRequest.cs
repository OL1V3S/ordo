namespace BudgetPlanner.Contracts.Inflows;

public sealed record UpdateInflowRequest(
    int Id,
    string? Description,
    decimal Amount,
    DateOnly? Date);
