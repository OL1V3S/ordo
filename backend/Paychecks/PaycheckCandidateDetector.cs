using System.Buffers.Binary;
using System.Collections.ObjectModel;
using System.Security.Cryptography;
using System.Text;
using BudgetPlanner.Models;

namespace BudgetPlanner.Paychecks;

public sealed class PaycheckCandidateDetector
{
    public const string AlgorithmVersion = "paycheck-candidate-v1";
    private static readonly byte[] FingerprintDomain = "ordo.paycheck-candidate.v1\0"u8.ToArray();

    public IReadOnlyList<PaycheckCandidate> Detect(IEnumerable<AccountInflow> inflows, DateOnly evaluatedOn)
    {
        ArgumentNullException.ThrowIfNull(inflows);

        var horizonStart = new DateOnly(evaluatedOn.Year, evaluatedOn.Month, 1).AddMonths(-17);
        var horizonRows = inflows
            .Where(inflow => inflow is null || inflow.Date >= horizonStart && inflow.Date <= evaluatedOn)
            .ToArray();
        if (horizonRows.Any(inflow => inflow is null)) return [];

        var owners = horizonRows.Select(inflow => inflow.OwnerId).Distinct(StringComparer.Ordinal).ToArray();
        if (owners.Length > 1 || owners.Any(string.IsNullOrWhiteSpace)) return [];

        var duplicateIds = horizonRows
            .GroupBy(inflow => inflow.Id)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToHashSet();

        var groups = horizonRows
            .GroupBy(inflow => AccountInflowIdentity.NormalizeDescription(inflow.Description))
            .OrderBy(group => group.Key, StringComparer.Ordinal);

        var candidates = new List<PaycheckCandidate>();
        foreach (var group in groups)
        {
            var evidence = group.OrderBy(inflow => inflow.Date).ThenBy(inflow => inflow.Id).ToArray();
            if (string.IsNullOrWhiteSpace(group.Key) || evidence.Any(inflow => !IsValid(inflow, duplicateIds)))
                continue;

            var candidate = DetectIdentity(group.Key, evidence, horizonStart, evaluatedOn);
            if (candidate is not null) candidates.Add(candidate);
        }

        return new ReadOnlyCollection<PaycheckCandidate>(candidates);
    }

    private static bool IsValid(AccountInflow inflow, IReadOnlySet<int> duplicateIds) =>
        inflow.Id > 0
        && !duplicateIds.Contains(inflow.Id)
        && inflow.PaycheckEvidenceRevision != Guid.Empty
        && !string.IsNullOrWhiteSpace(inflow.Description)
        && inflow.Description.Length <= 500
        && PaycheckContractRules.IsValidAmount(inflow.Amount);

    private static PaycheckCandidate? DetectIdentity(
        string identity,
        IReadOnlyList<AccountInflow> evidence,
        DateOnly horizonStart,
        DateOnly evaluatedOn)
    {
        var generationStart = new DateOnly(horizonStart.Year, horizonStart.Month, 1).AddMonths(-1);
        var generationEnd = new DateOnly(evaluatedOn.Year, evaluatedOn.Month, 1).AddMonths(2).AddDays(-1);
        var fits = new List<CandidateFit>();

        foreach (var hypothesis in EnumerateHypotheses(generationStart, generationEnd))
            fits.AddRange(FitRuns(hypothesis, evidence));

        if (fits.Count == 0) return null;
        var latestDate = fits.Max(fit => fit.FinalEvidenceDate);
        var finalists = fits.Where(fit => fit.FinalEvidenceDate == latestDate).ToArray();
        var greatestCount = finalists.Max(fit => fit.Evidence.Count);
        finalists = finalists.Where(fit => fit.Evidence.Count == greatestCount).ToArray();
        var smallestOffset = finalists.Min(fit => fit.TotalAbsoluteOffset);
        finalists = finalists.Where(fit => fit.TotalAbsoluteOffset == smallestOffset).ToArray();
        finalists = finalists
            .GroupBy(CanonicalFitKey, StringComparer.Ordinal)
            .Select(group => group.First())
            .ToArray();
        if (finalists.Length != 1) return null;

        var selected = finalists[0];
        var amounts = selected.Evidence.Select(value => value.Inflow.Amount).Order().ToArray();
        ObservedPaycheckAmountSummary amount = amounts[0] == amounts[^1]
            ? new FixedObservedPaycheckAmount(amounts[0])
            : new VariableObservedPaycheckAmount(amounts[0], amounts[(amounts.Length - 1) / 2], amounts[^1]);
        var snapshots = selected.Evidence
            .OrderBy(value => value.Inflow.Date)
            .ThenBy(value => value.Inflow.Id)
            .Select(value => new PaycheckCandidateEvidence(
                value.Inflow.Id,
                value.Inflow.PaycheckEvidenceRevision,
                value.Inflow.Description,
                value.Inflow.Date,
                value.Inflow.Amount,
                value.Anchor,
                value.Offset))
            .ToArray();
        var fingerprint = Fingerprint(
            selected.Schedule,
            selected.WindowBeforeDays,
            selected.WindowAfterDays,
            identity,
            snapshots);
        return new PaycheckCandidate(
            AlgorithmVersion,
            identity,
            selected.Schedule,
            selected.WindowBeforeDays,
            selected.WindowAfterDays,
            amount,
            fingerprint,
            snapshots);
    }

    private static IEnumerable<ScheduleHypothesis> EnumerateHypotheses(DateOnly start, DateOnly end)
    {
        for (var phase = 0; phase < 7; phase++)
        {
            var reference = FirstDayWithPhase(start, phase, 7);
            var schedule = new WeeklyPaycheckSchedule(reference);
            yield return new(schedule, PaycheckScheduleEngine.GenerateAnchors(schedule, start, end));
        }

        for (var phase = 0; phase < 14; phase++)
        {
            var reference = FirstDayWithPhase(start, phase, 14);
            var schedule = new BiweeklyPaycheckSchedule(reference);
            yield return new(schedule, PaycheckScheduleEngine.GenerateAnchors(schedule, start, end));
        }

        foreach (var anchor in PaycheckScheduleEngine.CanonicalMonthAnchors)
        {
            var schedule = new MonthlyPaycheckSchedule(anchor);
            yield return new(schedule, PaycheckScheduleEngine.GenerateAnchors(schedule, start, end));
        }

        foreach (var first in PaycheckScheduleEngine.CanonicalMonthAnchors)
        {
            foreach (var second in PaycheckScheduleEngine.CanonicalMonthAnchors)
            {
                if (!PaycheckScheduleEngine.IsValidSemimonthlyPair(first, second)) continue;
                var schedule = new SemimonthlyPaycheckSchedule(first, second);
                yield return new(schedule, PaycheckScheduleEngine.GenerateAnchors(schedule, start, end));
            }
        }
    }

    private static DateOnly FirstDayWithPhase(DateOnly start, int phase, int interval)
    {
        var adjustment = Mod(phase - Mod(start.DayNumber, interval), interval);
        return DateOnly.FromDayNumber(start.DayNumber + adjustment);
    }

    private static IEnumerable<CandidateFit> FitRuns(
        ScheduleHypothesis hypothesis,
        IReadOnlyList<AccountInflow> evidence)
    {
        var assignments = new int?[evidence.Count];
        for (var evidenceIndex = 0; evidenceIndex < evidence.Count; evidenceIndex++)
        {
            var bestDistance = 4;
            var bestAnchorIndex = -1;
            var tied = false;
            for (var anchorIndex = 0; anchorIndex < hypothesis.Anchors.Count; anchorIndex++)
            {
                var distance = Math.Abs(evidence[evidenceIndex].Date.DayNumber - hypothesis.Anchors[anchorIndex].DayNumber);
                if (distance > 3) continue;
                if (distance < bestDistance)
                {
                    bestDistance = distance;
                    bestAnchorIndex = anchorIndex;
                    tied = false;
                }
                else if (distance == bestDistance)
                {
                    tied = true;
                }
            }
            if (bestAnchorIndex >= 0 && !tied) assignments[evidenceIndex] = bestAnchorIndex;
        }

        var assignedBySlot = assignments
            .Select((slot, evidenceIndex) => (slot, evidenceIndex))
            .Where(value => value.slot.HasValue)
            .GroupBy(value => value.slot!.Value)
            .ToDictionary(group => group.Key, group => group.Select(value => value.evidenceIndex).ToArray());

        var run = new List<AssignedEvidence>();
        var fits = new List<CandidateFit>();
        for (var anchorIndex = 0; anchorIndex < hypothesis.Anchors.Count; anchorIndex++)
        {
            if (!assignedBySlot.TryGetValue(anchorIndex, out var slotEvidence) || slotEvidence.Length != 1)
            {
                AddFitIfQualifying(hypothesis.Schedule, run, fits);
                run.Clear();
                continue;
            }

            var evidenceIndex = slotEvidence[0];
            if (run.Count > 0 && evidenceIndex != run[^1].EvidenceIndex + 1)
            {
                AddFitIfQualifying(hypothesis.Schedule, run, fits);
                run.Clear();
            }

            var anchor = hypothesis.Anchors[anchorIndex];
            run.Add(new(
                evidenceIndex,
                evidence[evidenceIndex],
                anchor,
                evidence[evidenceIndex].Date.DayNumber - anchor.DayNumber));
        }
        AddFitIfQualifying(hypothesis.Schedule, run, fits);
        return fits;
    }

    private static void AddFitIfQualifying(
        PaycheckSchedule hypothesisSchedule,
        IReadOnlyList<AssignedEvidence> run,
        ICollection<CandidateFit> fits)
    {
        var qualifies = hypothesisSchedule.Cadence switch
        {
            PaycheckCadence.Weekly => run.Count >= 6,
            PaycheckCadence.Biweekly => run.Count >= 4
                && run[^1].Anchor.DayNumber - run[0].Anchor.DayNumber >= 42,
            PaycheckCadence.Monthly => run.Count >= 3,
            PaycheckCadence.Semimonthly => run.Count >= 6
                && run.Select(value => (value.Inflow.Date.Year, value.Inflow.Date.Month)).Distinct().Count() >= 3,
            _ => false
        };
        if (!qualifies) return;

        PaycheckSchedule schedule = hypothesisSchedule switch
        {
            WeeklyPaycheckSchedule => new WeeklyPaycheckSchedule(run[0].Anchor),
            BiweeklyPaycheckSchedule => new BiweeklyPaycheckSchedule(run[0].Anchor),
            _ => hypothesisSchedule
        };
        var offsets = run.Select(value => value.Offset).ToArray();
        fits.Add(new(
            schedule,
            Math.Max(0, -offsets.Min()),
            Math.Max(0, offsets.Max()),
            new ReadOnlyCollection<AssignedEvidence>(run.ToArray()),
            run.Max(value => value.Inflow.Date),
            offsets.Sum(Math.Abs)));
    }

    private static string CanonicalFitKey(CandidateFit fit)
    {
        var schedule = fit.Schedule switch
        {
            WeeklyPaycheckSchedule weekly => $"w:{weekly.ReferenceAnchor.DayNumber}",
            BiweeklyPaycheckSchedule biweekly => $"b:{biweekly.ReferenceAnchor.DayNumber}",
            MonthlyPaycheckSchedule monthly => $"m:{AnchorKey(monthly.Anchor)}",
            SemimonthlyPaycheckSchedule semimonthly => $"s:{AnchorKey(semimonthly.First)}:{AnchorKey(semimonthly.Second)}",
            _ => throw new InvalidOperationException("Unsupported paycheck schedule.")
        };
        return $"{schedule}|{fit.WindowBeforeDays}|{fit.WindowAfterDays}|{string.Join(',', fit.Evidence.Select(value => value.Inflow.Id))}";
    }

    private static string AnchorKey(PaycheckMonthAnchor anchor) =>
        $"{PaycheckScheduleEngine.AnchorKindCode(anchor)}:{PaycheckScheduleEngine.AnchorDayCode(anchor)}";

    private static string Fingerprint(
        PaycheckSchedule schedule,
        int windowBeforeDays,
        int windowAfterDays,
        string identity,
        IReadOnlyList<PaycheckCandidateEvidence> evidence)
    {
        using var stream = new MemoryStream();
        stream.Write(FingerprintDomain);
        WriteString(stream, AlgorithmVersion);
        stream.WriteByte(CadenceCode(schedule.Cadence));
        WriteSchedule(stream, schedule);
        WriteInt32(stream, windowBeforeDays);
        WriteInt32(stream, windowAfterDays);
        WriteString(stream, identity);
        WriteInt32(stream, evidence.Count);
        Span<byte> revision = stackalloc byte[16];
        foreach (var item in evidence)
        {
            WriteInt32(stream, item.AccountInflowId);
            item.PaycheckEvidenceRevision.TryWriteBytes(revision, bigEndian: true, out _);
            stream.Write(revision);
        }
        return Convert.ToHexStringLower(SHA256.HashData(stream.ToArray()));
    }

    private static byte CadenceCode(PaycheckCadence cadence) => cadence switch
    {
        PaycheckCadence.Weekly => 1,
        PaycheckCadence.Biweekly => 2,
        PaycheckCadence.Semimonthly => 3,
        PaycheckCadence.Monthly => 4,
        _ => throw new InvalidOperationException("Unsupported paycheck cadence.")
    };

    private static void WriteSchedule(Stream stream, PaycheckSchedule schedule)
    {
        switch (schedule)
        {
            case WeeklyPaycheckSchedule weekly:
                WriteInt32(stream, weekly.ReferenceAnchor.DayNumber);
                break;
            case BiweeklyPaycheckSchedule biweekly:
                WriteInt32(stream, biweekly.ReferenceAnchor.DayNumber);
                break;
            case MonthlyPaycheckSchedule monthly:
                WriteAnchor(stream, monthly.Anchor);
                break;
            case SemimonthlyPaycheckSchedule semimonthly:
                WriteAnchor(stream, semimonthly.First);
                WriteAnchor(stream, semimonthly.Second);
                break;
            default:
                throw new InvalidOperationException("Unsupported paycheck schedule.");
        }
    }

    private static void WriteAnchor(Stream stream, PaycheckMonthAnchor anchor)
    {
        WriteInt32(stream, PaycheckScheduleEngine.AnchorKindCode(anchor));
        WriteInt32(stream, PaycheckScheduleEngine.AnchorDayCode(anchor));
    }

    private static void WriteString(Stream stream, string value)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        WriteInt32(stream, bytes.Length);
        stream.Write(bytes);
    }

    private static void WriteInt32(Stream stream, int value)
    {
        Span<byte> bytes = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(bytes, value);
        stream.Write(bytes);
    }

    private static int Mod(int value, int divisor) => ((value % divisor) + divisor) % divisor;

    private sealed record ScheduleHypothesis(PaycheckSchedule Schedule, IReadOnlyList<DateOnly> Anchors);
    private sealed record AssignedEvidence(
        int EvidenceIndex,
        AccountInflow Inflow,
        DateOnly Anchor,
        int Offset);
    private sealed record CandidateFit(
        PaycheckSchedule Schedule,
        int WindowBeforeDays,
        int WindowAfterDays,
        IReadOnlyList<AssignedEvidence> Evidence,
        DateOnly FinalEvidenceDate,
        int TotalAbsoluteOffset);
}
