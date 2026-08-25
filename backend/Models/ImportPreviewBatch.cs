namespace BudgetPlanner.Models;

public enum ImportPreviewLifecycle
{
    Open,
    Expired,
    Confirmed
}

public class ImportPreviewBatch
{
    public Guid Id { get; set; }
    public string OwnerId { get; set; } = "";
    public ApplicationUser? Owner { get; set; }
    public string SourceType { get; set; } = "";
    public string ParserRuleVersion { get; set; } = "";
    public byte[] DocumentDigest { get; set; } = [];
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public ImportPreviewLifecycle Lifecycle { get; set; }
    public DateTime? ConfirmedAt { get; set; }
    public List<ImportPreviewRow> Rows { get; set; } = [];
    public List<ImportExpenseProvenance> Provenance { get; set; } = [];
}
