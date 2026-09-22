namespace BudgetPlanner.Contracts.Expenses;

public sealed record CreateExpenseRequest(
    string? Description,
    ExpenseAmountInput? Amount,
    DateOnly Date,
    string? Category);
