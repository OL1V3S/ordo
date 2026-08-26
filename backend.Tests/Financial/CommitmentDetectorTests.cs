using BudgetPlanner.Commitments;
using BudgetPlanner.Models;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

public sealed class CommitmentDetectorTests
{
    private static readonly DateOnly Today = new(2026, 8, 26);
    private readonly CommitmentDetector _detector = new();

    [Fact]
    public void Monthly_candidate_uses_normalized_identity_and_fixed_amount_evidence()
    {
        var expenses = new[]
        {
            Expense(1, new DateOnly(2026, 5, 14), 20m, "  Gym   Club ", " Health "),
            Expense(2, new DateOnly(2026, 6, 15), 20m, "gym club", "health"),
            Expense(3, new DateOnly(2026, 7, 16), 20m, "GYM CLUB", "health")
        };

        var candidate = Assert.Single(_detector.Detect(expenses, Today));

        Assert.Equal(CommitmentCadence.Monthly, candidate.Cadence);
        Assert.Equal(CommitmentTimingKind.DayOfMonth, candidate.TimingKind);
        Assert.Equal(15, candidate.ExpectedDay);
        Assert.Equal(1, candidate.WindowBeforeDays);
        Assert.Equal(1, candidate.WindowAfterDays);
        Assert.True(candidate.HasFixedObservedAmount);
        Assert.Equal(20m, candidate.ObservedMedianAmount);
        Assert.Equal(32, candidate.EvidenceFingerprint.Length);
    }

    [Fact]
    public void Monthly_candidate_uses_month_end_anchor_and_variable_median_range()
    {
        var candidate = Assert.Single(_detector.Detect(
        [
            Expense(1, new DateOnly(2026, 4, 28), 10m),
            Expense(2, new DateOnly(2026, 5, 30), 30m),
            Expense(3, new DateOnly(2026, 6, 29), 20m)
        ], Today));

        Assert.Equal(CommitmentTimingKind.MonthEnd, candidate.TimingKind);
        Assert.Equal(2, candidate.WindowBeforeDays);
        Assert.False(candidate.HasFixedObservedAmount);
        Assert.Equal(20m, candidate.ObservedMedianAmount);
        Assert.Equal(10m, candidate.ObservedMinimumAmount);
        Assert.Equal(30m, candidate.ObservedMaximumAmount);
    }

    [Fact]
    public void Weekly_candidate_requires_four_distinct_weeks_and_six_to_eight_day_gaps()
    {
        var candidate = Assert.Single(_detector.Detect(
        [
            Expense(1, new DateOnly(2026, 7, 6), 10m),
            Expense(2, new DateOnly(2026, 7, 13), 10m),
            Expense(3, new DateOnly(2026, 7, 21), 10m),
            Expense(4, new DateOnly(2026, 7, 27), 10m)
        ], Today));

        Assert.Equal(CommitmentCadence.Weekly, candidate.Cadence);
        Assert.Equal(CommitmentTimingKind.Weekday, candidate.TimingKind);
        Assert.Equal(DayOfWeek.Monday, candidate.ExpectedDayOfWeek);
        Assert.Equal(1, candidate.WindowAfterDays);
    }

    [Fact]
    public void Yearly_candidate_requires_three_consecutive_years_and_same_month()
    {
        var candidate = Assert.Single(_detector.Detect(
        [
            Expense(1, new DateOnly(2024, 2, 28), 100m),
            Expense(2, new DateOnly(2025, 2, 28), 100m),
            Expense(3, new DateOnly(2026, 2, 28), 100m)
        ], Today));

        Assert.Equal(CommitmentCadence.Yearly, candidate.Cadence);
        Assert.Equal(2, candidate.ExpectedMonth);
        Assert.Equal(28, candidate.ExpectedDay);
    }

    [Fact]
    public void Ambiguous_or_gapped_groups_are_withheld()
    {
        var expenses = new[]
        {
            Expense(1, new DateOnly(2026, 4, 10), 10m, "ambiguous"),
            Expense(2, new DateOnly(2026, 4, 20), 10m, "ambiguous"),
            Expense(3, new DateOnly(2026, 5, 10), 10m, "ambiguous"),
            Expense(4, new DateOnly(2026, 6, 10), 10m, "ambiguous"),
            Expense(5, new DateOnly(2026, 3, 10), 10m, "gapped"),
            Expense(6, new DateOnly(2026, 5, 10), 10m, "gapped"),
            Expense(7, new DateOnly(2026, 6, 10), 10m, "gapped")
        };

        Assert.Empty(_detector.Detect(expenses, Today));
    }

    [Fact]
    public void Lookback_excludes_evidence_before_the_latest_thirty_six_calendar_months()
    {
        var expenses = new[]
        {
            Expense(1, new DateOnly(2023, 8, 31), 10m),
            Expense(2, new DateOnly(2023, 9, 15), 10m),
            Expense(3, new DateOnly(2023, 10, 15), 10m),
            Expense(4, new DateOnly(2023, 11, 15), 10m)
        };

        var candidate = Assert.Single(_detector.Detect(expenses, Today));
        Assert.Equal(new[] { 2, 3, 4 }, candidate.Evidence.Select(expense => expense.Id));
    }

    [Fact]
    public void Fingerprint_is_stable_for_ordering_but_changes_with_evidence_revision()
    {
        var expenses = new[]
        {
            Expense(3, new DateOnly(2026, 7, 15), 10m),
            Expense(1, new DateOnly(2026, 5, 15), 10m),
            Expense(2, new DateOnly(2026, 6, 15), 10m)
        };
        var first = Assert.Single(_detector.Detect(expenses, Today));
        var reordered = Assert.Single(_detector.Detect(expenses.Reverse(), Today));
        Assert.Equal(first.EvidenceFingerprint, reordered.EvidenceFingerprint);

        expenses[1].CommitmentEvidenceRevision = Guid.NewGuid();
        var changed = Assert.Single(_detector.Detect(expenses, Today));
        Assert.NotEqual(first.EvidenceFingerprint, changed.EvidenceFingerprint);
    }

    [Fact]
    public void Same_amount_different_description_or_category_never_groups()
    {
        var expenses = new[]
        {
            Expense(1, new DateOnly(2026, 5, 15), 10m, "one", "bills"),
            Expense(2, new DateOnly(2026, 6, 15), 10m, "two", "bills"),
            Expense(3, new DateOnly(2026, 7, 15), 10m, "one", "other bills")
        };

        Assert.Empty(_detector.Detect(expenses, Today));
    }

    [Fact]
    public void Invalid_legacy_expenses_are_not_candidate_evidence()
    {
        var expenses = new[]
        {
            Expense(1, new DateOnly(2026, 5, 15), 10.001m),
            Expense(2, new DateOnly(2026, 6, 15), 10.001m),
            Expense(3, new DateOnly(2026, 7, 15), 10.001m)
        };

        Assert.Empty(_detector.Detect(expenses, Today));
    }

    private static Expense Expense(
        int id,
        DateOnly date,
        decimal amount,
        string description = "membership",
        string category = "bills") => new()
    {
        Id = id,
        Date = date,
        Amount = amount,
        Description = description,
        Category = category,
        CommitmentEvidenceRevision = Guid.Parse($"00000000-0000-0000-0000-{id:D12}")
    };
}
