namespace BudgetPlanner.Models;

public class ImportInflowProvenance
{
    public Guid BatchId { get; set; }
    public ImportPreviewBatch? Batch { get; set; }
    public string OwnerId { get; set; } = "";
    public int SourceRowOrdinal { get; set; }
    public int? AccountInflowId { get; set; }
    public string? AccountInflowOwnerId { get; set; }
    public AccountInflow? AccountInflow { get; set; }
}
