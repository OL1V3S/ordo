namespace BudgetPlanner.Models;

public enum CommitmentChangeDimension
{
    Amount,
    Timing,
    Missing
}

public class CommitmentChangeDismissal
{
    public Guid Id { get; set; }
    public string OwnerId { get; set; } = "";
    public ApplicationUser? Owner { get; set; }
    public Guid CommitmentId { get; set; }
    public Commitment? Commitment { get; set; }
    public string AlgorithmVersion { get; set; } = "";
    public CommitmentChangeDimension Dimension { get; set; }
    public byte[] EvidenceFingerprint { get; set; } = [];
    public DateTime DismissedAt { get; set; }
}
