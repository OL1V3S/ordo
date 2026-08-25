namespace BudgetPlanner.Models;

public class ImportExpenseProvenance
{
    public Guid BatchId { get; set; }
    public ImportPreviewBatch? Batch { get; set; }
    public int SourceRowOrdinal { get; set; }
    public int? ExpenseId { get; set; }
    public Expense? Expense { get; set; }
}
