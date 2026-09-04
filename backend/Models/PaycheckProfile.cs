using BudgetPlanner.Paychecks;

namespace BudgetPlanner.Models;

public enum PaycheckLifecycle
{
    Active,
    Paused,
    Ended
}

public enum PaycheckAmountMode
{
    Fixed,
    Range
}

public class PaycheckProfile
{
    public Guid Id { get; set; }
    public string OwnerId { get; set; } = "";
    public ApplicationUser? Owner { get; set; }
    public string DisplayName { get; set; } = "";
    public PaycheckLifecycle Lifecycle { get; set; }
    public PaycheckCadence Cadence { get; set; }
    public DateOnly? ReferenceAnchorDate { get; set; }
    // Canonical Stage 2 anchors: 1..30 are calendar days; 31 is month end.
    public short? FirstMonthAnchor { get; set; }
    public short? SecondMonthAnchor { get; set; }
    public short WindowBeforeDays { get; set; }
    public short WindowAfterDays { get; set; }
    public PaycheckAmountMode AmountMode { get; set; }
    public decimal? ExpectedAmount { get; set; }
    public decimal? ExpectedMinimumAmount { get; set; }
    public decimal? ExpectedMaximumAmount { get; set; }
    public string? OriginAlgorithmVersion { get; set; }
    public byte[]? OriginEvidenceFingerprint { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<PaycheckOccurrence> Occurrences { get; set; } = [];
}
