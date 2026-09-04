using BudgetPlanner.Paychecks;

namespace BudgetPlanner.Models;

public class PaycheckCandidateDismissal
{
    public Guid Id { get; set; }
    public string OwnerId { get; set; } = "";
    public ApplicationUser? Owner { get; set; }
    public string AlgorithmVersion { get; set; } = "";
    public PaycheckCadence Cadence { get; set; }
    public byte[] EvidenceFingerprint { get; set; } = [];
    public DateTime DismissedAt { get; set; }
}
