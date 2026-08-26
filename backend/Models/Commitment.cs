namespace BudgetPlanner.Models;

public enum CommitmentLifecycle
{
    Active,
    Paused,
    Ended
}

public enum CommitmentCadence
{
    Weekly,
    Monthly,
    Yearly
}

public enum CommitmentTimingKind
{
    Weekday,
    DayOfMonth,
    MonthEnd,
    MonthAndDay
}

public enum CommitmentAmountMode
{
    Fixed,
    Range
}

public class Commitment
{
    public Guid Id { get; set; }
    public string OwnerId { get; set; } = "";
    public ApplicationUser? Owner { get; set; }
    public string Name { get; set; } = "";
    public string Category { get; set; } = "";
    public CommitmentLifecycle Lifecycle { get; set; }
    public CommitmentCadence Cadence { get; set; }
    public CommitmentTimingKind TimingKind { get; set; }
    public DayOfWeek? ExpectedDayOfWeek { get; set; }
    public int? ExpectedDay { get; set; }
    public int? ExpectedMonth { get; set; }
    public int WindowBeforeDays { get; set; }
    public int WindowAfterDays { get; set; }
    public CommitmentAmountMode AmountMode { get; set; }
    public decimal? ExpectedAmount { get; set; }
    public decimal? ExpectedMinimumAmount { get; set; }
    public decimal? ExpectedMaximumAmount { get; set; }
    public string? OriginAlgorithmVersion { get; set; }
    public byte[]? OriginEvidenceFingerprint { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<CommitmentOccurrence> Occurrences { get; set; } = [];
}
