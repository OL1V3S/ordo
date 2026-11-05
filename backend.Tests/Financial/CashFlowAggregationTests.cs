using BudgetPlanner.Analytics;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

public sealed class CashFlowAggregationTests
{
    [Theory]
    [InlineData(null, "2026-09-10")]
    [InlineData("2026-09", null)]
    [InlineData("2026-9", "2026-09-10")]
    [InlineData("2026-09-01", "2026-09-10")]
    [InlineData("2026-00", "2026-09-10")]
    [InlineData("2026-13", "2026-09-10")]
    [InlineData("0000-01", "2026-09-10")]
    [InlineData("10000-01", "2026-09-10")]
    [InlineData("2026-09", "2026-9-10")]
    [InlineData("2026-09", "2026-09-10T00:00:00Z")]
    [InlineData("2026-09", " 2026-09-10")]
    [InlineData("2026-02", "2026-02-29")]
    [InlineData("2026-04", "2026-04-31")]
    [InlineData("2026-10", "2026-09-30")]
    public void Invalid_or_noncanonical_periods_are_rejected(string? month, string? cutoff)
    {
        Assert.False(CashFlowPeriod.TryCreate(month, cutoff, out var period));
        Assert.Null(period);
    }

    [Theory]
    [InlineData("2024-02", "2024-02-29", "2023-09-01", "2024-02-29", 6)]
    [InlineData("2024-02", "2026-09-10", "2023-09-01", "2024-02-29", 6)]
    [InlineData("2026-01", "2026-01-10", "2025-08-01", "2026-01-10", 6)]
    [InlineData("0001-01", "0001-01-01", "0001-01-01", "0001-01-01", 1)]
    [InlineData("0001-03", "0001-03-31", "0001-01-01", "0001-03-31", 3)]
    [InlineData("9999-12", "9999-12-31", "9999-07-01", "9999-12-31", 6)]
    public void Calendar_periods_have_explicit_inclusive_bounds_without_overflow(
        string month, string cutoff, string trendStart, string selectedEnd, int count)
    {
        var period = Period(month, cutoff);
        var response = CashFlowAggregation.Aggregate(period, [], [], [], []);

        Assert.Equal(DateOnly.Parse(trendStart), period.TrendFrom);
        Assert.Equal(DateOnly.Parse(selectedEnd), response.To);
        Assert.Equal(count, response.Months.Count);
        Assert.Equal(response.Selected, response.Months[^1]);
        Assert.Equal(month, response.Selected.Month);
        Assert.All(response.Months, value =>
        {
            Assert.Equal("0", value.CashInMinor);
            Assert.Equal("0", value.PaycheckCashInMinor);
            Assert.Equal("0", value.OtherCashInMinor);
            Assert.Equal("0", value.SpentMinor);
            Assert.Equal("0", value.NetMinor);
            Assert.Equal(0, value.InflowCount);
            Assert.Equal(0, value.ExpenseCount);
            Assert.Empty(value.Categories);
            Assert.Equal(value.To.Day - value.From.Day + 1, value.Days.Count);
            Assert.All(value.Days, day => Assert.Equal("0", day.SpentMinor));
            Assert.Equal(value.From, value.Days[0].Date);
            Assert.Equal(value.To, value.Days[^1].Date);
        });
        Assert.Empty(response.Categories);
    }

    [Fact]
    public void Partition_uses_observed_values_and_membership_without_multiplying_money()
    {
        var revision = Guid.NewGuid();
        var profile = Guid.NewGuid();
        CashFlowInflowRow[] inflows =
        [
            new(1, new(2026, 9, 1), 100.01m, revision),
            new(2, new(2026, 9, 1), 100.01m, revision), // Separate, identical-looking saved observation.
            new(3, new(2026, 9, 10), 20m, Guid.NewGuid()),
            new(4, new(2026, 9, 11), 999m, revision)
        ];
        CashFlowMembershipRow[] memberships =
        [
            new(1, profile, revision), new(1, profile, revision),
            new(3, Guid.NewGuid(), revision), new(4, profile, revision)
        ];
        CashFlowExpenseRow[] expenses =
        [
            new(1, new(2026, 9, 1), 200m, "transfers"),
            new(2, new(2026, 9, 10), 40m, "uncategorized"),
            new(3, new(2026, 9, 11), 900m, "future")
        ];

        var response = CashFlowAggregation.Aggregate(Period(), inflows, expenses, memberships, inflows.Select(value => value.Date));

        Assert.Equal("22002", response.Selected.CashInMinor);
        Assert.Equal("12001", response.Selected.PaycheckCashInMinor);
        Assert.Equal("10001", response.Selected.OtherCashInMinor);
        Assert.Equal("24000", response.Selected.SpentMinor);
        Assert.Equal("-1998", response.Selected.NetMinor);
        Assert.Equal(3, response.Selected.InflowCount);
        Assert.Equal(2, response.Selected.PaycheckInflowCount);
        Assert.Equal(1, response.Selected.OtherInflowCount);
        Assert.Equal(2, response.Selected.PaycheckProfileCount);
        Assert.Equal(1, response.Selected.EditedPaycheckInflowCount);
        Assert.Equal(2, response.Selected.ExpenseCount);
        Assert.Equal(["transfers", "uncategorized"], response.Categories.Select(value => value.Category));
        Assert.Equal(["20000", "4000"], response.Categories.Select(value => value.AmountMinor));
    }

    [Fact]
    public void Maximum_amounts_aggregate_exactly_beyond_one_record_and_javascript_ranges()
    {
        var revision = Guid.NewGuid();
        var maximum = 9999999999999999.99m;
        var response = CashFlowAggregation.Aggregate(Period(),
            [new(1, new(2026, 9, 1), maximum, revision), new(2, new(2026, 9, 1), maximum, revision), new(3, new(2026, 9, 1), 0.01m, revision)],
            [new(1, new(2026, 9, 1), maximum, "food")],
            [new(1, Guid.NewGuid(), revision)], []);

        Assert.Equal("1999999999999999999", response.Selected.CashInMinor);
        Assert.Equal("999999999999999999", response.Selected.PaycheckCashInMinor);
        Assert.Equal("1000000000000000000", response.Selected.OtherCashInMinor);
        Assert.Equal("999999999999999999", response.Selected.SpentMinor);
        Assert.Equal("1000000000000000000", response.Selected.NetMinor);
    }

    [Fact]
    public void Tiny_or_absent_cash_in_preserves_expenses_and_signed_net_without_a_ratio()
    {
        var expense = new CashFlowExpenseRow(1, new(2026, 9, 1), 9999999999999999.99m, "food");
        var empty = CashFlowAggregation.Aggregate(Period(), [], [expense], [], []);
        var tiny = CashFlowAggregation.Aggregate(Period(),
            [new(1, new(2026, 9, 1), 0.01m, Guid.NewGuid())], [expense], [], []);

        Assert.Equal("0", empty.Selected.CashInMinor);
        Assert.Equal("-999999999999999999", empty.Selected.NetMinor);
        Assert.Equal("1", tiny.Selected.CashInMinor);
        Assert.Equal("-999999999999999998", tiny.Selected.NetMinor);
    }

    [Fact]
    public void Empty_buckets_and_month_metadata_include_all_inflows_and_stable_category_ties()
    {
        CashFlowInflowRow[] inflows =
        [
            new(1, new(2026, 4, 1), 12m, Guid.NewGuid()),
            new(2, new(2026, 8, 31), 15m, Guid.NewGuid())
        ];
        CashFlowExpenseRow[] expenses =
        [
            new(1, new(2026, 9, 1), 1m, "zebra"),
            new(2, new(2026, 9, 2), 1m, "custom category"),
            new(3, new(2026, 9, 3), 1m, "custom category"),
            new(4, new(2026, 9, 4), 1m, "apple")
        ];
        var response = CashFlowAggregation.Aggregate(Period(), inflows, expenses, [],
            [new(2020, 1, 1), new(2026, 4, 1), new(2026, 4, 2), new(2026, 8, 31), new(2026, 10, 1)]);

        Assert.Equal(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"], response.Months.Select(value => value.Month));
        Assert.Equal(["1200", "0", "0", "0", "1500", "0"], response.Months.Select(value => value.CashInMinor));
        Assert.Equal(["2026-09", "2026-08", "2026-04", "2020-01"], response.AvailableMonths);
        Assert.Equal(["custom category", "apple", "zebra"], response.Categories.Select(value => value.Category));
        Assert.Equal("400", response.Selected.SpentMinor);
        Assert.All(response.Months.Take(5), value => Assert.Empty(value.Categories));
        Assert.All(response.Months, value => Assert.Equal(value.To.Day - value.From.Day + 1, value.Days.Count));
    }

    [Fact]
    public void Days_and_month_categories_partition_spent_exactly()
    {
        var maximum = 9999999999999999.99m;
        CashFlowExpenseRow[] expenses =
        [
            new(1, new(2026, 7, 1), 5m, "food"),
            new(2, new(2026, 7, 31), 2m, "rent"),
            new(3, new(2026, 8, 15), maximum, "food"),
            new(4, new(2026, 8, 15), 0.01m, "food"),
            new(5, new(2026, 9, 1), 1m, "zebra"),
            new(6, new(2026, 9, 1), 1m, "apple"),
            new(7, new(2026, 9, 4), 3m, "food"),
            new(8, new(2026, 9, 10), 0.5m, "apple")
        ];
        var response = CashFlowAggregation.Aggregate(Period(), [], expenses, [], []);

        foreach (var month in response.Months)
        {
            var spent = System.Numerics.BigInteger.Parse(month.SpentMinor);
            Assert.Equal(spent, month.Days.Aggregate(System.Numerics.BigInteger.Zero, (sum, day) => sum + System.Numerics.BigInteger.Parse(day.SpentMinor)));
            Assert.Equal(spent, month.Categories.Aggregate(System.Numerics.BigInteger.Zero, (sum, row) => sum + System.Numerics.BigInteger.Parse(row.AmountMinor)));
        }
        var august = response.Months.Single(value => value.Month == "2026-08");
        Assert.Equal(31, august.Days.Count);
        Assert.Equal("1000000000000000000", august.Days[14].SpentMinor);
        Assert.Equal("0", august.Days[13].SpentMinor);
        var selected = response.Selected;
        Assert.Equal(10, selected.Days.Count);
        Assert.Equal(["200", "0", "0", "300", "0", "0", "0", "0", "0", "50"], selected.Days.Select(value => value.SpentMinor));
        Assert.Equal(["food", "apple", "zebra"], selected.Categories.Select(value => value.Category));
        Assert.Equal(["300", "150", "100"], selected.Categories.Select(value => value.AmountMinor));
        Assert.Equal(selected.Categories, response.Categories);
    }

    [Fact]
    public void Month_to_date_excludes_expenses_after_the_cutoff_from_days_categories_and_spent()
    {
        var response = CashFlowAggregation.Aggregate(Period(), [],
            [new(1, new(2026, 9, 10), 2m, "food"), new(2, new(2026, 9, 11), 9m, "future")], [], []);

        Assert.Equal("200", response.Selected.SpentMinor);
        Assert.Equal(10, response.Selected.Days.Count);
        Assert.DoesNotContain(response.Selected.Days, day => day.Date > new DateOnly(2026, 9, 10));
        Assert.Equal(["food"], response.Selected.Categories.Select(value => value.Category));
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("1.001")]
    public void Invalid_recorded_amounts_are_not_silently_dropped_or_rounded(string amount)
    {
        Assert.Throws<InvalidOperationException>(() => CashFlowAggregation.Aggregate(Period(),
            [new(1, new(2026, 9, 1), decimal.Parse(amount, System.Globalization.CultureInfo.InvariantCulture), Guid.NewGuid())], [], [], []));
    }

    private static CashFlowPeriod Period(string month = "2026-09", string cutoff = "2026-09-10")
    {
        Assert.True(CashFlowPeriod.TryCreate(month, cutoff, out var period));
        return period!;
    }
}
