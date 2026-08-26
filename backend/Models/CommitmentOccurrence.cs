namespace BudgetPlanner.Models;

public enum CommitmentOccurrenceKind
{
    ConfirmationEvidence
}

public class CommitmentOccurrence
{
    public Guid CommitmentId { get; set; }
    public Commitment? Commitment { get; set; }
    public int ExpenseId { get; set; }
    public Expense? Expense { get; set; }
    public CommitmentOccurrenceKind Kind { get; set; }
    public DateTime LinkedAt { get; set; }
}
