namespace BudgetPlanner.Contracts.Expenses;

public sealed record ExpenseResponse(
    int Id,
    string Description,
    string Amount,
    DateOnly Date,
    string Category);
