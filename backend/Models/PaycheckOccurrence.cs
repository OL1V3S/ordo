namespace BudgetPlanner.Models;

public enum PaycheckOccurrenceKind
{
    ConfirmationEvidence
}

public class PaycheckOccurrence
{
    public Guid PaycheckProfileId { get; set; }
    public PaycheckProfile? PaycheckProfile { get; set; }
    public int AccountInflowId { get; set; }
    public AccountInflow? AccountInflow { get; set; }
    public string OwnerId { get; set; } = "";
    public PaycheckOccurrenceKind Kind { get; set; }
    public Guid EvidenceRevisionAtAssignment { get; set; }
    public DateOnly SlotAnchor { get; set; }
    public short TimingOffsetDays { get; set; }
    public DateTime LinkedAt { get; set; }
}
