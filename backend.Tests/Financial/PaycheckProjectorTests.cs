using BudgetPlanner.Paychecks;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

public sealed class PaycheckProjectorTests
{
    private readonly PaycheckProjector projector = new();

    [Theory]
    [InlineData(2026, 8, 31)]
    [InlineData(2026, 9, 1)]
    [InlineData(2026, 9, 5)]
    public void Weekly_returns_current_slot_before_and_inside_its_inclusive_window(int year, int month, int day)
    {
        var amount = new FixedConfirmedPaycheckAmount(1000m);
        var pattern = new ConfirmedPaycheckPattern(
            new WeeklyPaycheckSchedule(new(2026, 9, 4)), 3, 1, amount);

        var result = projector.Project(pattern, new(year, month, day));

        Assert.Equal(PaycheckProjector.AlgorithmVersion, result.AlgorithmVersion);
        Assert.Equal(new DateOnly(2026, 9, 4), result.Anchor);
        Assert.Equal(new DateOnly(2026, 9, 1), result.EarliestExpectedDate);
        Assert.Equal(new DateOnly(2026, 9, 5), result.LatestExpectedDate);
        Assert.Same(amount, result.Amount);
    }

    [Fact]
    public void Weekly_advances_on_first_day_after_window_closes_and_never_precedes_reference()
    {
        var pattern = Pattern(new WeeklyPaycheckSchedule(new(2026, 9, 4)), before: 3, after: 1);

        Assert.Equal(new DateOnly(2026, 9, 4), projector.Project(pattern, new(2020, 1, 1)).Anchor);
        Assert.Equal(new DateOnly(2026, 9, 11), projector.Project(pattern, new(2026, 9, 6)).Anchor);
    }

    [Fact]
    public void Latest_confirmed_slot_is_skipped_even_while_its_window_is_open()
    {
        var pattern = new ConfirmedPaycheckPattern(
            new BiweeklyPaycheckSchedule(new(2026, 8, 28)),
            3,
            3,
            new FixedConfirmedPaycheckAmount(1000m),
            new DateOnly(2026, 8, 28));

        var result = projector.Project(pattern, new(2026, 8, 27));

        Assert.Equal(new DateOnly(2026, 9, 11), result.Anchor);
    }

    [Fact]
    public void Biweekly_preserves_phase_across_year_boundary()
    {
        var pattern = Pattern(new BiweeklyPaycheckSchedule(new(2025, 12, 26)));

        Assert.Equal(new DateOnly(2026, 1, 9), projector.Project(pattern, new(2025, 12, 27)).Anchor);
    }

    [Fact]
    public void Monthly_day_anchor_clamps_through_leap_and_nonleap_february()
    {
        var pattern = Pattern(new MonthlyPaycheckSchedule(PaycheckMonthAnchor.DayOfMonth(30)));

        Assert.Equal(new DateOnly(2024, 2, 29), projector.Project(pattern, new(2024, 2, 1)).Anchor);
        Assert.Equal(new DateOnly(2025, 2, 28), projector.Project(pattern, new(2025, 2, 1)).Anchor);
    }

    [Fact]
    public void Month_end_can_return_previous_month_slot_while_its_window_is_open()
    {
        var pattern = Pattern(new MonthlyPaycheckSchedule(PaycheckMonthAnchor.MonthEnd), after: 3);

        var result = projector.Project(pattern, new(2026, 3, 2));

        Assert.Equal(new DateOnly(2026, 2, 28), result.Anchor);
        Assert.Equal(new DateOnly(2026, 3, 3), result.LatestExpectedDate);
    }

    [Fact]
    public void Semimonthly_moves_within_and_across_months_without_interval_approximation()
    {
        var pattern = Pattern(new SemimonthlyPaycheckSchedule(
            PaycheckMonthAnchor.DayOfMonth(15), PaycheckMonthAnchor.MonthEnd));

        Assert.Equal(new DateOnly(2026, 1, 31), projector.Project(pattern, new(2026, 1, 16)).Anchor);
        Assert.Equal(new DateOnly(2026, 2, 15), projector.Project(pattern, new(2026, 2, 1)).Anchor);
    }

    [Fact]
    public void Confirmed_range_is_passed_through_unchanged()
    {
        var amount = new RangeConfirmedPaycheckAmount(900m, 1100m);
        var pattern = new ConfirmedPaycheckPattern(
            new MonthlyPaycheckSchedule(PaycheckMonthAnchor.DayOfMonth(10)), 0, 0, amount);

        Assert.Same(amount, projector.Project(pattern, new(2026, 9, 1)).Amount);
    }

    [Fact]
    public void Invalid_schedule_window_amount_and_latest_slot_shapes_are_rejected()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => PaycheckMonthAnchor.DayOfMonth(0));
        Assert.Throws<ArgumentOutOfRangeException>(() => new FixedConfirmedPaycheckAmount(0m));
        Assert.Throws<ArgumentException>(() => new RangeConfirmedPaycheckAmount(1000m, 1000m));
        Assert.Throws<ArgumentOutOfRangeException>(() => new ConfirmedPaycheckPattern(
            new WeeklyPaycheckSchedule(new(2026, 9, 4)), 4, 0, new FixedConfirmedPaycheckAmount(1000m)));
        Assert.Throws<ArgumentException>(() => new ConfirmedPaycheckPattern(
            new WeeklyPaycheckSchedule(new(2026, 9, 4)),
            0,
            0,
            new FixedConfirmedPaycheckAmount(1000m),
            new DateOnly(2026, 9, 5)));
    }

    private static ConfirmedPaycheckPattern Pattern(
        PaycheckSchedule schedule,
        int before = 0,
        int after = 0) => new(schedule, before, after, new FixedConfirmedPaycheckAmount(1000m));
}
