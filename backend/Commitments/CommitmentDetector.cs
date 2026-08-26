using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using BudgetPlanner.Import;
using BudgetPlanner.Models;

namespace BudgetPlanner.Commitments;

public sealed record CommitmentCandidate(
    string AlgorithmVersion,
    CommitmentCadence Cadence,
    string Description,
    string Category,
    CommitmentTimingKind TimingKind,
    DayOfWeek? ExpectedDayOfWeek,
    int? ExpectedDay,
    int? ExpectedMonth,
    int WindowBeforeDays,
    int WindowAfterDays,
    bool HasFixedObservedAmount,
    decimal ObservedMedianAmount,
    decimal ObservedMinimumAmount,
    decimal ObservedMaximumAmount,
    byte[] EvidenceFingerprint,
    IReadOnlyList<Expense> Evidence);

public interface ICommitmentDetector
{
    IReadOnlyList<CommitmentCandidate> Detect(IEnumerable<Expense> expenses, DateOnly today);
}

public sealed class CommitmentDetector : ICommitmentDetector
{
    public const string AlgorithmVersion = "commitment-v1";
    private static readonly byte[] FingerprintDomain = "ordo.commitment-candidate.v1\0"u8.ToArray();

    public IReadOnlyList<CommitmentCandidate> Detect(IEnumerable<Expense> expenses, DateOnly today)
    {
        var currentMonth = new DateOnly(today.Year, today.Month, 1);
        var cutoff = currentMonth.AddMonths(-35);
        var groups = expenses
            .Where(expense => expense.Date >= cutoff && expense.Date <= today)
            .Where(expense => ExpenseInputRules.Validate(
                expense.Amount,
                expense.Date,
                expense.Description,
                expense.Category).Count == 0)
            .GroupBy(expense => new CandidateGroupKey(
                ExpenseInputRules.NormalizeDescriptionForComparison(expense.Description),
                ExpenseInputRules.NormalizeCategory(expense.Category)))
            .OrderBy(group => group.Key.Description, StringComparer.Ordinal)
            .ThenBy(group => group.Key.Category, StringComparer.Ordinal);

        var candidates = new List<CommitmentCandidate>();
        foreach (var group in groups)
        {
            var evidence = group.OrderBy(expense => expense.Date).ThenBy(expense => expense.Id).ToArray();
            if (TryMonthly(evidence, out var monthlyTiming))
                candidates.Add(Create(group.Key, evidence, CommitmentCadence.Monthly, monthlyTiming));
            if (TryWeekly(evidence, out var weeklyTiming))
                candidates.Add(Create(group.Key, evidence, CommitmentCadence.Weekly, weeklyTiming));
            if (TryYearly(evidence, out var yearlyTiming))
                candidates.Add(Create(group.Key, evidence, CommitmentCadence.Yearly, yearlyTiming));
        }

        return candidates
            .OrderBy(candidate => candidate.Description, StringComparer.Ordinal)
            .ThenBy(candidate => candidate.Category, StringComparer.Ordinal)
            .ThenBy(candidate => candidate.Cadence)
            .ToArray();
    }

    private static bool TryMonthly(IReadOnlyList<Expense> evidence, out CandidateTiming timing)
    {
        timing = default;
        if (evidence.Count < 3) return false;
        var periods = evidence.Select(expense => expense.Date.Year * 12 + expense.Date.Month).ToArray();
        if (periods.Distinct().Count() != evidence.Count) return false;
        if (periods.Zip(periods.Skip(1)).Any(pair => pair.Second - pair.First != 1)) return false;
        return TryCalendarDayTiming(evidence.Select(expense => expense.Date).ToArray(), false, out timing);
    }

    private static bool TryWeekly(IReadOnlyList<Expense> evidence, out CandidateTiming timing)
    {
        timing = default;
        if (evidence.Count < 4 || evidence[^1].Date.DayNumber - evidence[0].Date.DayNumber < 21) return false;
        var weeks = evidence.Select(expense =>
            (ISOWeek.GetYear(expense.Date.ToDateTime(TimeOnly.MinValue)),
             ISOWeek.GetWeekOfYear(expense.Date.ToDateTime(TimeOnly.MinValue)))).ToArray();
        if (weeks.Distinct().Count() != evidence.Count) return false;
        var gaps = evidence.Zip(evidence.Skip(1), (left, right) => right.Date.DayNumber - left.Date.DayNumber).ToArray();
        if (gaps.Any(gap => gap is < 6 or > 8)) return false;

        var weekday = evidence
            .GroupBy(expense => expense.Date.DayOfWeek)
            .OrderByDescending(group => group.Count())
            .ThenBy(group => (int)group.Key)
            .First().Key;
        var offsets = evidence.Select(expense => SignedWeekdayOffset(weekday, expense.Date.DayOfWeek)).ToArray();
        timing = new CandidateTiming(
            CommitmentTimingKind.Weekday,
            weekday,
            null,
            null,
            Math.Max(0, -offsets.Min()),
            Math.Max(0, offsets.Max()));
        return true;
    }

    private static bool TryYearly(IReadOnlyList<Expense> evidence, out CandidateTiming timing)
    {
        timing = default;
        if (evidence.Count < 3) return false;
        var years = evidence.Select(expense => expense.Date.Year).ToArray();
        if (years.Distinct().Count() != evidence.Count) return false;
        if (years.Zip(years.Skip(1)).Any(pair => pair.Second - pair.First != 1)) return false;
        if (evidence.Select(expense => expense.Date.Month).Distinct().Count() != 1) return false;
        return TryCalendarDayTiming(evidence.Select(expense => expense.Date).ToArray(), true, out timing);
    }

    private static bool TryCalendarDayTiming(
        IReadOnlyList<DateOnly> dates,
        bool yearly,
        out CandidateTiming timing)
    {
        timing = default;
        var monthEndOffsets = dates.Select(date => DateTime.DaysInMonth(date.Year, date.Month) - date.Day).ToArray();
        if (monthEndOffsets.All(offset => offset <= 3) && monthEndOffsets.Max() - monthEndOffsets.Min() <= 2)
        {
            timing = new CandidateTiming(
                CommitmentTimingKind.MonthEnd,
                null,
                null,
                yearly ? dates[0].Month : null,
                monthEndOffsets.Max(),
                0);
            if (yearly)
                timing = timing with { Kind = CommitmentTimingKind.MonthAndDay, Day = dates.Max(date => date.Day) };
            return true;
        }

        var days = dates.Select(date => date.Day).Order().ToArray();
        if (days[^1] - days[0] > 6) return false;
        var expectedDay = days[(days.Length - 1) / 2];
        timing = new CandidateTiming(
            yearly ? CommitmentTimingKind.MonthAndDay : CommitmentTimingKind.DayOfMonth,
            null,
            expectedDay,
            yearly ? dates[0].Month : null,
            expectedDay - days[0],
            days[^1] - expectedDay);
        return true;
    }

    private static CommitmentCandidate Create(
        CandidateGroupKey key,
        IReadOnlyList<Expense> evidence,
        CommitmentCadence cadence,
        CandidateTiming timing)
    {
        var amounts = evidence.Select(expense => expense.Amount).Order().ToArray();
        var median = amounts.Length % 2 == 1
            ? amounts[amounts.Length / 2]
            : (amounts[amounts.Length / 2 - 1] + amounts[amounts.Length / 2]) / 2m;
        return new CommitmentCandidate(
            AlgorithmVersion,
            cadence,
            evidence[^1].Description,
            key.Category,
            timing.Kind,
            timing.DayOfWeek,
            timing.Day,
            timing.Month,
            timing.WindowBeforeDays,
            timing.WindowAfterDays,
            amounts[0] == amounts[^1],
            median,
            amounts[0],
            amounts[^1],
            ComputeFingerprint(cadence, evidence),
            evidence);
    }

    private static byte[] ComputeFingerprint(CommitmentCadence cadence, IReadOnlyList<Expense> evidence)
    {
        using var stream = new MemoryStream();
        stream.Write(FingerprintDomain);
        var version = Encoding.UTF8.GetBytes(AlgorithmVersion);
        WriteInt32(stream, version.Length);
        stream.Write(version);
        stream.WriteByte((byte)cadence);
        WriteInt32(stream, evidence.Count);
        Span<byte> revision = stackalloc byte[16];
        foreach (var expense in evidence)
        {
            WriteInt32(stream, expense.Id);
            expense.CommitmentEvidenceRevision.TryWriteBytes(revision, bigEndian: true, out _);
            stream.Write(revision);
        }
        return SHA256.HashData(stream.ToArray());
    }

    private static void WriteInt32(Stream stream, int value)
    {
        Span<byte> bytes = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(bytes, value);
        stream.Write(bytes);
    }

    private static int SignedWeekdayOffset(DayOfWeek expected, DayOfWeek actual) =>
        ((int)actual - (int)expected + 10) % 7 - 3;

    private sealed record CandidateGroupKey(string Description, string Category);
    private readonly record struct CandidateTiming(
        CommitmentTimingKind Kind,
        DayOfWeek? DayOfWeek,
        int? Day,
        int? Month,
        int WindowBeforeDays,
        int WindowAfterDays);
}
