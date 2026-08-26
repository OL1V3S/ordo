namespace BudgetPlanner.Models;

public class CommitmentCandidateDismissal
{
    public Guid Id { get; set; }
    public string OwnerId { get; set; } = "";
    public ApplicationUser? Owner { get; set; }
    public string AlgorithmVersion { get; set; } = "";
    public CommitmentCadence Cadence { get; set; }
    public byte[] EvidenceFingerprint { get; set; } = [];
    public DateTime DismissedAt { get; set; }
}
