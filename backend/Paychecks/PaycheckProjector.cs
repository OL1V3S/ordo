namespace BudgetPlanner.Paychecks;

public sealed class PaycheckProjector
{
    public const string AlgorithmVersion = "paycheck-projector-v1";

    public PaycheckProjection Project(ConfirmedPaycheckPattern pattern, DateOnly evaluatedOn)
    {
        ArgumentNullException.ThrowIfNull(pattern);

        var targetDayNumber = evaluatedOn.DayNumber - pattern.WindowAfterDays;
        if (pattern.LatestConfirmedSlotAnchor is { } latest)
            targetDayNumber = Math.Max(targetDayNumber, latest.DayNumber + 1);
        var anchor = PaycheckScheduleEngine.FirstAnchorOnOrAfter(
            pattern.Schedule,
            DateOnly.FromDayNumber(targetDayNumber));

        return new PaycheckProjection(
            AlgorithmVersion,
            evaluatedOn,
            anchor,
            anchor.AddDays(-pattern.WindowBeforeDays),
            anchor.AddDays(pattern.WindowAfterDays),
            pattern.Amount);
    }
}
