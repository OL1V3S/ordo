using System.Collections.ObjectModel;
using BudgetPlanner.Models;

namespace BudgetPlanner.Paychecks;

public enum PaycheckCadence
{
    Weekly,
    Biweekly,
    Semimonthly,
    Monthly
}

public enum PaycheckMonthAnchorKind
{
    DayOfMonth,
    MonthEnd
}

public sealed record PaycheckMonthAnchor
{
    private PaycheckMonthAnchor(PaycheckMonthAnchorKind kind, int? day)
    {
        Kind = kind;
        Day = day;
    }

    public PaycheckMonthAnchorKind Kind { get; }
    public int? Day { get; }

    public static PaycheckMonthAnchor DayOfMonth(int day)
    {
        if (day is < 1 or > 31)
            throw new ArgumentOutOfRangeException(nameof(day), "A month anchor day must be between 1 and 31.");

        return day == 31 ? MonthEnd : new(PaycheckMonthAnchorKind.DayOfMonth, day);
    }

    public static PaycheckMonthAnchor MonthEnd { get; } = new(PaycheckMonthAnchorKind.MonthEnd, null);
}

public abstract record PaycheckSchedule
{
    protected PaycheckSchedule(PaycheckCadence cadence) => Cadence = cadence;

    public PaycheckCadence Cadence { get; }
}

public sealed record WeeklyPaycheckSchedule : PaycheckSchedule
{
    public WeeklyPaycheckSchedule(DateOnly referenceAnchor) : base(PaycheckCadence.Weekly) =>
        ReferenceAnchor = referenceAnchor;

    public DateOnly ReferenceAnchor { get; }
}

public sealed record BiweeklyPaycheckSchedule : PaycheckSchedule
{
    public BiweeklyPaycheckSchedule(DateOnly referenceAnchor) : base(PaycheckCadence.Biweekly) =>
        ReferenceAnchor = referenceAnchor;

    public DateOnly ReferenceAnchor { get; }
}

public sealed record MonthlyPaycheckSchedule : PaycheckSchedule
{
    public MonthlyPaycheckSchedule(PaycheckMonthAnchor anchor) : base(PaycheckCadence.Monthly)
    {
        ArgumentNullException.ThrowIfNull(anchor);
        Anchor = anchor;
    }

    public PaycheckMonthAnchor Anchor { get; }
}

public sealed record SemimonthlyPaycheckSchedule : PaycheckSchedule
{
    public SemimonthlyPaycheckSchedule(PaycheckMonthAnchor first, PaycheckMonthAnchor second)
        : base(PaycheckCadence.Semimonthly)
    {
        ArgumentNullException.ThrowIfNull(first);
        ArgumentNullException.ThrowIfNull(second);
        if (!PaycheckScheduleEngine.IsValidSemimonthlyPair(first, second))
            throw new ArgumentException("Semimonthly anchors must be canonical, ordered, distinct, and always at least seven days apart.");

        First = first;
        Second = second;
    }

    public PaycheckMonthAnchor First { get; }
    public PaycheckMonthAnchor Second { get; }
}

public sealed record PaycheckCandidateEvidence
{
    public PaycheckCandidateEvidence(
        int accountInflowId,
        Guid paycheckEvidenceRevision,
        string description,
        DateOnly postedDate,
        decimal amount,
        DateOnly slotAnchor,
        int timingOffsetDays)
    {
        if (accountInflowId <= 0) throw new ArgumentOutOfRangeException(nameof(accountInflowId));
        if (paycheckEvidenceRevision == Guid.Empty) throw new ArgumentException("Evidence revision is required.", nameof(paycheckEvidenceRevision));
        if (string.IsNullOrWhiteSpace(description) || description.Length > 500)
            throw new ArgumentException("A stored description between 1 and 500 characters is required.", nameof(description));
        PaycheckContractRules.RequireAmount(amount, nameof(amount));
        if (timingOffsetDays is < -3 or > 3 || postedDate.DayNumber - slotAnchor.DayNumber != timingOffsetDays)
            throw new ArgumentOutOfRangeException(nameof(timingOffsetDays));

        AccountInflowId = accountInflowId;
        PaycheckEvidenceRevision = paycheckEvidenceRevision;
        Description = description;
        PostedDate = postedDate;
        Amount = amount;
        SlotAnchor = slotAnchor;
        TimingOffsetDays = timingOffsetDays;
    }

    public int AccountInflowId { get; }
    public Guid PaycheckEvidenceRevision { get; }
    public string Description { get; }
    public DateOnly PostedDate { get; }
    public decimal Amount { get; }
    public DateOnly SlotAnchor { get; }
    public int TimingOffsetDays { get; }
}

public abstract record ObservedPaycheckAmountSummary;

public sealed record FixedObservedPaycheckAmount : ObservedPaycheckAmountSummary
{
    public FixedObservedPaycheckAmount(decimal amount)
    {
        PaycheckContractRules.RequireAmount(amount, nameof(amount));
        Amount = amount;
    }

    public decimal Amount { get; }
}

public sealed record VariableObservedPaycheckAmount : ObservedPaycheckAmountSummary
{
    public VariableObservedPaycheckAmount(decimal minimum, decimal lowerMedian, decimal maximum)
    {
        PaycheckContractRules.RequireAmount(minimum, nameof(minimum));
        PaycheckContractRules.RequireAmount(lowerMedian, nameof(lowerMedian));
        PaycheckContractRules.RequireAmount(maximum, nameof(maximum));
        if (minimum >= maximum || lowerMedian < minimum || lowerMedian > maximum)
            throw new ArgumentException("A variable amount requires minimum < maximum and a median within that range.");

        Minimum = minimum;
        LowerMedian = lowerMedian;
        Maximum = maximum;
    }

    public decimal Minimum { get; }
    public decimal LowerMedian { get; }
    public decimal Maximum { get; }
}

public sealed record PaycheckCandidate
{
    public PaycheckCandidate(
        string algorithmVersion,
        string normalizedDescriptionIdentity,
        PaycheckSchedule schedule,
        int windowBeforeDays,
        int windowAfterDays,
        ObservedPaycheckAmountSummary observedAmount,
        string evidenceFingerprint,
        IEnumerable<PaycheckCandidateEvidence> evidence)
    {
        if (string.IsNullOrWhiteSpace(algorithmVersion)) throw new ArgumentException("Algorithm version is required.", nameof(algorithmVersion));
        if (string.IsNullOrWhiteSpace(normalizedDescriptionIdentity)
            || normalizedDescriptionIdentity != AccountInflowIdentity.NormalizeDescription(normalizedDescriptionIdentity))
            throw new ArgumentException("A normalized description identity is required.", nameof(normalizedDescriptionIdentity));
        ArgumentNullException.ThrowIfNull(schedule);
        PaycheckContractRules.RequireWindow(windowBeforeDays, nameof(windowBeforeDays));
        PaycheckContractRules.RequireWindow(windowAfterDays, nameof(windowAfterDays));
        ArgumentNullException.ThrowIfNull(observedAmount);
        if (string.IsNullOrEmpty(evidenceFingerprint)
            || evidenceFingerprint.Length != 64
            || evidenceFingerprint.Any(character => character is not (>= '0' and <= '9') and not (>= 'a' and <= 'f')))
            throw new ArgumentException("The evidence fingerprint must be lowercase SHA-256 hex.", nameof(evidenceFingerprint));
        ArgumentNullException.ThrowIfNull(evidence);
        var snapshot = evidence.ToArray();
        if (snapshot.Length == 0) throw new ArgumentException("Candidate evidence is required.", nameof(evidence));

        AlgorithmVersion = algorithmVersion;
        NormalizedDescriptionIdentity = normalizedDescriptionIdentity;
        Schedule = schedule;
        WindowBeforeDays = windowBeforeDays;
        WindowAfterDays = windowAfterDays;
        ObservedAmount = observedAmount;
        EvidenceFingerprint = evidenceFingerprint;
        Evidence = Array.AsReadOnly(snapshot);
    }

    public string AlgorithmVersion { get; }
    public string NormalizedDescriptionIdentity { get; }
    public PaycheckSchedule Schedule { get; }
    public int WindowBeforeDays { get; }
    public int WindowAfterDays { get; }
    public ObservedPaycheckAmountSummary ObservedAmount { get; }
    public string EvidenceFingerprint { get; }
    public IReadOnlyList<PaycheckCandidateEvidence> Evidence { get; }
}

public abstract record ConfirmedPaycheckAmount;

public sealed record FixedConfirmedPaycheckAmount : ConfirmedPaycheckAmount
{
    public FixedConfirmedPaycheckAmount(decimal amount)
    {
        PaycheckContractRules.RequireAmount(amount, nameof(amount));
        Amount = amount;
    }

    public decimal Amount { get; }
}

public sealed record RangeConfirmedPaycheckAmount : ConfirmedPaycheckAmount
{
    public RangeConfirmedPaycheckAmount(decimal minimum, decimal maximum)
    {
        PaycheckContractRules.RequireAmount(minimum, nameof(minimum));
        PaycheckContractRules.RequireAmount(maximum, nameof(maximum));
        if (minimum >= maximum) throw new ArgumentException("A range requires minimum < maximum.");
        Minimum = minimum;
        Maximum = maximum;
    }

    public decimal Minimum { get; }
    public decimal Maximum { get; }
}

public sealed record ConfirmedPaycheckPattern
{
    public ConfirmedPaycheckPattern(
        PaycheckSchedule schedule,
        int windowBeforeDays,
        int windowAfterDays,
        ConfirmedPaycheckAmount amount,
        DateOnly? latestConfirmedSlotAnchor = null)
    {
        ArgumentNullException.ThrowIfNull(schedule);
        PaycheckContractRules.RequireWindow(windowBeforeDays, nameof(windowBeforeDays));
        PaycheckContractRules.RequireWindow(windowAfterDays, nameof(windowAfterDays));
        ArgumentNullException.ThrowIfNull(amount);
        if (latestConfirmedSlotAnchor is { } latest && !PaycheckScheduleEngine.IsAnchor(schedule, latest))
            throw new ArgumentException("The latest confirmed slot must be an anchor of the schedule.", nameof(latestConfirmedSlotAnchor));

        Schedule = schedule;
        WindowBeforeDays = windowBeforeDays;
        WindowAfterDays = windowAfterDays;
        Amount = amount;
        LatestConfirmedSlotAnchor = latestConfirmedSlotAnchor;
    }

    public PaycheckSchedule Schedule { get; }
    public int WindowBeforeDays { get; }
    public int WindowAfterDays { get; }
    public ConfirmedPaycheckAmount Amount { get; }
    public DateOnly? LatestConfirmedSlotAnchor { get; }
}

public sealed record PaycheckProjection(
    string AlgorithmVersion,
    DateOnly EvaluatedOn,
    DateOnly Anchor,
    DateOnly EarliestExpectedDate,
    DateOnly LatestExpectedDate,
    ConfirmedPaycheckAmount Amount);

internal static class PaycheckContractRules
{
    internal const decimal MaximumAmount = 9999999999999999.99m;

    internal static void RequireAmount(decimal amount, string parameterName)
    {
        if (amount <= 0m || amount > MaximumAmount || decimal.Round(amount, 2) != amount)
            throw new ArgumentOutOfRangeException(parameterName, "Amounts must be positive, representable numeric(18,2) values.");
    }

    internal static bool IsValidAmount(decimal amount) =>
        amount > 0m && amount <= MaximumAmount && decimal.Round(amount, 2) == amount;

    internal static void RequireWindow(int value, string parameterName)
    {
        if (value is < 0 or > 3)
            throw new ArgumentOutOfRangeException(parameterName, "Paycheck windows must be between zero and three days.");
    }
}

internal static class PaycheckScheduleEngine
{
    private static readonly IReadOnlyList<PaycheckMonthAnchor> MonthAnchors =
        new ReadOnlyCollection<PaycheckMonthAnchor>(
            Enumerable.Range(1, 30).Select(PaycheckMonthAnchor.DayOfMonth)
                .Append(PaycheckMonthAnchor.MonthEnd)
                .ToArray());

    private static readonly HashSet<(int First, int Second)> ValidSemimonthlyPairs = BuildValidSemimonthlyPairs();

    internal static IReadOnlyList<PaycheckMonthAnchor> CanonicalMonthAnchors => MonthAnchors;

    internal static bool IsValidSemimonthlyPair(PaycheckMonthAnchor first, PaycheckMonthAnchor second) =>
        AnchorRank(first) < AnchorRank(second)
        && ValidSemimonthlyPairs.Contains((AnchorRank(first), AnchorRank(second)));

    internal static DateOnly CalendarAnchor(int year, int month, PaycheckMonthAnchor anchor)
    {
        var day = anchor.Kind == PaycheckMonthAnchorKind.MonthEnd
            ? DateTime.DaysInMonth(year, month)
            : Math.Min(anchor.Day!.Value, DateTime.DaysInMonth(year, month));
        return new DateOnly(year, month, day);
    }

    internal static IReadOnlyList<DateOnly> GenerateAnchors(PaycheckSchedule schedule, DateOnly start, DateOnly end)
    {
        if (end < start) return [];

        return schedule switch
        {
            WeeklyPaycheckSchedule weekly => GenerateIntervalAnchors(weekly.ReferenceAnchor, 7, start, end),
            BiweeklyPaycheckSchedule biweekly => GenerateIntervalAnchors(biweekly.ReferenceAnchor, 14, start, end),
            MonthlyPaycheckSchedule monthly => GenerateCalendarAnchors([monthly.Anchor], start, end),
            SemimonthlyPaycheckSchedule semimonthly => GenerateCalendarAnchors([semimonthly.First, semimonthly.Second], start, end),
            _ => throw new ArgumentException("Unsupported paycheck schedule.", nameof(schedule))
        };
    }

    internal static bool IsAnchor(PaycheckSchedule schedule, DateOnly date) => schedule switch
    {
        WeeklyPaycheckSchedule weekly => Mod(date.DayNumber - weekly.ReferenceAnchor.DayNumber, 7) == 0,
        BiweeklyPaycheckSchedule biweekly => Mod(date.DayNumber - biweekly.ReferenceAnchor.DayNumber, 14) == 0,
        MonthlyPaycheckSchedule monthly => CalendarAnchor(date.Year, date.Month, monthly.Anchor) == date,
        SemimonthlyPaycheckSchedule semimonthly =>
            CalendarAnchor(date.Year, date.Month, semimonthly.First) == date
            || CalendarAnchor(date.Year, date.Month, semimonthly.Second) == date,
        _ => false
    };

    internal static DateOnly FirstAnchorOnOrAfter(PaycheckSchedule schedule, DateOnly target) => schedule switch
    {
        WeeklyPaycheckSchedule weekly => FirstIntervalAnchorOnOrAfter(weekly.ReferenceAnchor, 7, target),
        BiweeklyPaycheckSchedule biweekly => FirstIntervalAnchorOnOrAfter(biweekly.ReferenceAnchor, 14, target),
        MonthlyPaycheckSchedule monthly => FirstCalendarAnchorOnOrAfter([monthly.Anchor], target),
        SemimonthlyPaycheckSchedule semimonthly => FirstCalendarAnchorOnOrAfter([semimonthly.First, semimonthly.Second], target),
        _ => throw new ArgumentException("Unsupported paycheck schedule.", nameof(schedule))
    };

    internal static int AnchorKindCode(PaycheckMonthAnchor anchor) =>
        anchor.Kind == PaycheckMonthAnchorKind.DayOfMonth ? 1 : 2;

    internal static int AnchorDayCode(PaycheckMonthAnchor anchor) => anchor.Day ?? 0;

    private static IReadOnlyList<DateOnly> GenerateIntervalAnchors(
        DateOnly reference,
        int intervalDays,
        DateOnly start,
        DateOnly end)
    {
        var first = FirstPhaseAnchorOnOrAfter(reference, intervalDays, start);
        var anchors = new List<DateOnly>();
        for (var dayNumber = first.DayNumber; dayNumber <= end.DayNumber; dayNumber += intervalDays)
            anchors.Add(DateOnly.FromDayNumber(dayNumber));
        return anchors;
    }

    private static DateOnly FirstPhaseAnchorOnOrAfter(DateOnly reference, int intervalDays, DateOnly target)
    {
        var adjustment = Mod(reference.DayNumber - target.DayNumber, intervalDays);
        return DateOnly.FromDayNumber(target.DayNumber + adjustment);
    }

    private static DateOnly FirstIntervalAnchorOnOrAfter(DateOnly reference, int intervalDays, DateOnly target)
    {
        if (target <= reference) return reference;
        return FirstPhaseAnchorOnOrAfter(reference, intervalDays, target);
    }

    private static IReadOnlyList<DateOnly> GenerateCalendarAnchors(
        IReadOnlyList<PaycheckMonthAnchor> anchors,
        DateOnly start,
        DateOnly end)
    {
        var results = new List<DateOnly>();
        var month = new DateOnly(start.Year, start.Month, 1);
        var finalMonth = new DateOnly(end.Year, end.Month, 1);
        while (month <= finalMonth)
        {
            foreach (var anchor in anchors)
            {
                var date = CalendarAnchor(month.Year, month.Month, anchor);
                if (date >= start && date <= end) results.Add(date);
            }
            month = month.AddMonths(1);
        }
        results.Sort();
        return results;
    }

    private static DateOnly FirstCalendarAnchorOnOrAfter(
        IReadOnlyList<PaycheckMonthAnchor> anchors,
        DateOnly target)
    {
        var month = new DateOnly(target.Year, target.Month, 1);
        while (true)
        {
            foreach (var anchor in anchors)
            {
                var date = CalendarAnchor(month.Year, month.Month, anchor);
                if (date >= target) return date;
            }
            month = month.AddMonths(1);
        }
    }

    private static HashSet<(int First, int Second)> BuildValidSemimonthlyPairs()
    {
        var valid = new HashSet<(int, int)>();
        foreach (var first in MonthAnchors)
        {
            foreach (var second in MonthAnchors)
            {
                if (AnchorRank(first) >= AnchorRank(second)) continue;
                var pairIsValid = true;
                for (var year = 2000; year < 2400 && pairIsValid; year++)
                {
                    for (var month = 1; month <= 12 && pairIsValid; month++)
                    {
                        var firstDate = CalendarAnchor(year, month, first);
                        var secondDate = CalendarAnchor(year, month, second);
                        var nextMonth = new DateOnly(year, month, 1).AddMonths(1);
                        var nextFirstDate = CalendarAnchor(nextMonth.Year, nextMonth.Month, first);
                        pairIsValid = secondDate.DayNumber - firstDate.DayNumber >= 7
                            && nextFirstDate.DayNumber - secondDate.DayNumber >= 7;
                    }
                }
                if (pairIsValid) valid.Add((AnchorRank(first), AnchorRank(second)));
            }
        }
        return valid;
    }

    private static int AnchorRank(PaycheckMonthAnchor anchor) => anchor.Day ?? 31;

    private static int Mod(int value, int divisor) => ((value % divisor) + divisor) % divisor;
}
