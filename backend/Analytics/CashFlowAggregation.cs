using System.Globalization;
using System.Numerics;
using BudgetPlanner.Contracts.Analytics;

namespace BudgetPlanner.Analytics;

public sealed record CashFlowInflowRow(int Id, DateOnly Date, decimal Amount, Guid EvidenceRevision);
public sealed record CashFlowExpenseRow(int Id, DateOnly Date, decimal Amount, string Category);
public sealed record CashFlowMembershipRow(int AccountInflowId, Guid ProfileId, Guid EvidenceRevisionAtAssignment);

public static class CashFlowAggregation
{
    public static CashFlowResponse Aggregate(
        CashFlowPeriod period, IReadOnlyList<CashFlowInflowRow> inflows,
        IReadOnlyList<CashFlowExpenseRow> expenses, IReadOnlyList<CashFlowMembershipRow> memberships,
        IEnumerable<DateOnly> availableDates)
    {
        var buckets = new Dictionary<string, MonthTotals>(StringComparer.Ordinal);
        for (var start = period.TrendFrom; ; start = start.AddMonths(1))
        {
            var end = CashFlowPeriod.MonthEnd(start);
            if (end > period.To) end = period.To;
            buckets.Add(CashFlowPeriod.MonthKey(start), new(start, end));
            // Do not add a month beyond the representable calendar ceiling.
            if (start == period.MonthStart) break;
        }

        var links = memberships.ToLookup(value => value.AccountInflowId);
        foreach (var inflow in inflows)
        {
            if (inflow.Date < period.TrendFrom || inflow.Date > period.To) continue;
            var bucket = buckets[CashFlowPeriod.MonthKey(inflow.Date)];
            var amount = ToMinor(inflow.Amount);
            bucket.CashIn += amount;
            bucket.InflowCount++;
            var assigned = links[inflow.Id].ToArray();
            if (assigned.Length == 0) continue;
            // Membership is a predicate, not another source of money. Even a repeated
            // membership row must never multiply the underlying observed amount.
            bucket.PaycheckCashIn += amount;
            bucket.PaycheckInflowCount++;
            foreach (var link in assigned) bucket.Profiles.Add(link.ProfileId);
            if (assigned.Any(value => value.EvidenceRevisionAtAssignment != inflow.EvidenceRevision))
                bucket.EditedPaycheckInflowCount++;
        }

        foreach (var expense in expenses)
        {
            if (expense.Date < period.TrendFrom || expense.Date > period.To) continue;
            var key = CashFlowPeriod.MonthKey(expense.Date);
            var amount = ToMinor(expense.Amount);
            buckets[key].AddExpense(expense.Date, expense.Category, amount);
        }

        var months = buckets.Values.Select(value => value.ToDto()).ToArray();
        var availableMonths = availableDates.Where(value => value <= period.ThroughDate)
            .Select(CashFlowPeriod.MonthKey).Append(CashFlowPeriod.MonthKey(period.ThroughDate))
            .Distinct(StringComparer.Ordinal).OrderByDescending(value => value, StringComparer.Ordinal).ToArray();
        return new(period.Month, period.ThroughDate, period.MonthStart, period.To,
            availableMonths, months[^1], months,
            months[^1].Categories);
    }

    private static BigInteger ToMinor(decimal amount)
    {
        var minor = checked(amount * 100m);
        if (amount <= 0m || minor != decimal.Truncate(minor))
            throw new InvalidOperationException("A recorded cash-flow amount is invalid.");
        return new BigInteger(minor);
    }

    private static string Format(BigInteger amount) => amount.ToString(CultureInfo.InvariantCulture);

    private sealed class MonthTotals(DateOnly from, DateOnly to)
    {
        public BigInteger CashIn;
        public BigInteger PaycheckCashIn;
        public BigInteger Spent;
        public int InflowCount;
        public int PaycheckInflowCount;
        public int ExpenseCount;
        public int EditedPaycheckInflowCount;
        public HashSet<Guid> Profiles { get; } = [];
        private readonly BigInteger[] _days = new BigInteger[to.Day - from.Day + 1];
        private readonly Dictionary<string, BigInteger> _categories = new(StringComparer.Ordinal);

        public void AddExpense(DateOnly date, string category, BigInteger amount)
        {
            Spent += amount;
            ExpenseCount++;
            _days[date.Day - from.Day] += amount;
            _categories[category] = _categories.GetValueOrDefault(category) + amount;
        }

        public CashFlowMonthDto ToDto() => new(
            CashFlowPeriod.MonthKey(from), from, to,
            Format(CashIn), Format(PaycheckCashIn), Format(CashIn - PaycheckCashIn),
            Format(Spent), Format(CashIn - Spent), InflowCount, PaycheckInflowCount,
            InflowCount - PaycheckInflowCount, ExpenseCount, Profiles.Count, EditedPaycheckInflowCount,
            _days.Select((value, index) => new CashFlowDayDto(from.AddDays(index), Format(value))).ToArray(),
            _categories.OrderByDescending(value => value.Value).ThenBy(value => value.Key, StringComparer.Ordinal)
                .Select(value => new CashFlowCategoryDto(value.Key, Format(value.Value))).ToArray());
    }
}
