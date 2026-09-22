namespace BudgetPlanner.Contracts.Expenses;

public sealed record UpdateExpenseRequest(
    int Id,
    string? Description,
    ExpenseAmountInput? Amount,
    DateOnly Date,
    string? Category);
