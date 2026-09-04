using BudgetPlanner.Contracts.Paychecks;
using BudgetPlanner.Models;

namespace BudgetPlanner.Paychecks;

internal sealed record PaycheckExpectation(
    string DisplayName, short WindowBeforeDays, short WindowAfterDays,
    ConfirmedPaycheckAmount Amount);

internal static class PaycheckProfileRules
{
    internal static PaycheckError? ValidateExpectation(
        string? displayName, int? before, int? after, ConfirmedPaycheckAmountDto? amount,
        out PaycheckExpectation? expectation)
    {
        expectation = null;
        var name = displayName?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > 500)
            return new("name_invalid", "Display name must contain between 1 and 500 characters.");
        if (before is null or < 0 or > 3 || after is null or < 0 or > 3)
            return new("timing_invalid", "Both timing windows must be between zero and three days.");

        ConfirmedPaycheckAmount? confirmedAmount = amount switch
        {
            { Mode: "fixed", FixedAmount: { } value, MinimumAmount: null, MaximumAmount: null }
                when PaycheckContractRules.IsValidAmount(value) => new FixedConfirmedPaycheckAmount(value),
            { Mode: "range", FixedAmount: null, MinimumAmount: { } minimum, MaximumAmount: { } maximum }
                when PaycheckContractRules.IsValidAmount(minimum)
                    && PaycheckContractRules.IsValidAmount(maximum) && minimum < maximum =>
                new RangeConfirmedPaycheckAmount(minimum, maximum),
            _ => null
        };
        if (confirmedAmount is null)
            return new("amount_invalid", "Provide a positive fixed amount or an explicit increasing range with at most two decimal places.");

        expectation = new(name, (short)before.Value, (short)after.Value, confirmedAmount);
        return null;
    }

    internal static bool TrySchedule(PaycheckScheduleDto? dto, out PaycheckSchedule? schedule)
    {
        schedule = null;
        if (dto is null) return false;
        switch (dto.Cadence)
        {
            case "weekly" or "biweekly" when dto.ReferenceAnchorDate is { } reference
                && dto.FirstMonthAnchor is null && dto.SecondMonthAnchor is null:
                schedule = dto.Cadence == "weekly"
                    ? new WeeklyPaycheckSchedule(reference) : new BiweeklyPaycheckSchedule(reference);
                return true;
            case "monthly" when dto.ReferenceAnchorDate is null && dto.SecondMonthAnchor is null
                && TryMonthAnchor(dto.FirstMonthAnchor, out var monthly):
                schedule = new MonthlyPaycheckSchedule(monthly!);
                return true;
            case "semimonthly" when dto.ReferenceAnchorDate is null
                && TryMonthAnchor(dto.FirstMonthAnchor, out var first)
                && TryMonthAnchor(dto.SecondMonthAnchor, out var second)
                && PaycheckScheduleEngine.IsValidSemimonthlyPair(first!, second!):
                schedule = new SemimonthlyPaycheckSchedule(first!, second!);
                return true;
            default:
                return false;
        }
    }

    private static bool TryMonthAnchor(PaycheckMonthAnchorDto? dto, out PaycheckMonthAnchor? anchor)
    {
        anchor = dto switch
        {
            { Kind: "day_of_month", Day: >= 1 and <= 30 } => PaycheckMonthAnchor.DayOfMonth(dto.Day.Value),
            { Kind: "month_end", Day: null } => PaycheckMonthAnchor.MonthEnd,
            _ => null
        };
        return anchor is not null;
    }

    internal static bool TryCadence(string? value, out PaycheckCadence cadence)
    {
        cadence = value switch
        {
            "weekly" => PaycheckCadence.Weekly,
            "biweekly" => PaycheckCadence.Biweekly,
            "semimonthly" => PaycheckCadence.Semimonthly,
            "monthly" => PaycheckCadence.Monthly,
            _ => (PaycheckCadence)(-1)
        };
        return Enum.IsDefined(cadence);
    }

    internal static bool TryLifecycle(string? value, out PaycheckLifecycle lifecycle)
    {
        lifecycle = value switch
        {
            "active" => PaycheckLifecycle.Active,
            "paused" => PaycheckLifecycle.Paused,
            "ended" => PaycheckLifecycle.Ended,
            _ => (PaycheckLifecycle)(-1)
        };
        return Enum.IsDefined(lifecycle);
    }

    internal static PaycheckSchedule ReadSchedule(PaycheckProfile profile) => profile.Cadence switch
    {
        PaycheckCadence.Weekly => new WeeklyPaycheckSchedule(profile.ReferenceAnchorDate!.Value),
        PaycheckCadence.Biweekly => new BiweeklyPaycheckSchedule(profile.ReferenceAnchorDate!.Value),
        PaycheckCadence.Monthly => new MonthlyPaycheckSchedule(ReadAnchor(profile.FirstMonthAnchor!.Value)),
        PaycheckCadence.Semimonthly => new SemimonthlyPaycheckSchedule(
            ReadAnchor(profile.FirstMonthAnchor!.Value), ReadAnchor(profile.SecondMonthAnchor!.Value)),
        _ => throw new InvalidOperationException("Unsupported persisted paycheck schedule.")
    };

    private static PaycheckMonthAnchor ReadAnchor(short value) =>
        value == 31 ? PaycheckMonthAnchor.MonthEnd : PaycheckMonthAnchor.DayOfMonth(value);

    internal static ConfirmedPaycheckAmount ReadAmount(PaycheckProfile profile) => profile.AmountMode switch
    {
        PaycheckAmountMode.Fixed => new FixedConfirmedPaycheckAmount(profile.ExpectedAmount!.Value),
        PaycheckAmountMode.Range => new RangeConfirmedPaycheckAmount(
            profile.ExpectedMinimumAmount!.Value, profile.ExpectedMaximumAmount!.Value),
        _ => throw new InvalidOperationException("Unsupported persisted paycheck amount.")
    };

    internal static void ApplyExpectation(PaycheckProfile profile, PaycheckExpectation value)
    {
        profile.DisplayName = value.DisplayName;
        profile.WindowBeforeDays = value.WindowBeforeDays;
        profile.WindowAfterDays = value.WindowAfterDays;
        profile.AmountMode = value.Amount is FixedConfirmedPaycheckAmount ? PaycheckAmountMode.Fixed : PaycheckAmountMode.Range;
        profile.ExpectedAmount = (value.Amount as FixedConfirmedPaycheckAmount)?.Amount;
        profile.ExpectedMinimumAmount = (value.Amount as RangeConfirmedPaycheckAmount)?.Minimum;
        profile.ExpectedMaximumAmount = (value.Amount as RangeConfirmedPaycheckAmount)?.Maximum;
    }

    internal static void ApplySchedule(PaycheckProfile profile, PaycheckSchedule schedule)
    {
        profile.Cadence = schedule.Cadence;
        profile.ReferenceAnchorDate = schedule switch
        {
            WeeklyPaycheckSchedule weekly => weekly.ReferenceAnchor,
            BiweeklyPaycheckSchedule biweekly => biweekly.ReferenceAnchor,
            _ => null
        };
        profile.FirstMonthAnchor = schedule switch
        {
            MonthlyPaycheckSchedule monthly => (short)(monthly.Anchor.Day ?? 31),
            SemimonthlyPaycheckSchedule semimonthly => (short)(semimonthly.First.Day ?? 31),
            _ => null
        };
        profile.SecondMonthAnchor = schedule is SemimonthlyPaycheckSchedule semi
            ? (short)(semi.Second.Day ?? 31) : null;
    }

    internal static PaycheckScheduleDto ToDto(PaycheckSchedule schedule) => schedule switch
    {
        WeeklyPaycheckSchedule weekly => new("weekly", weekly.ReferenceAnchor, null, null),
        BiweeklyPaycheckSchedule biweekly => new("biweekly", biweekly.ReferenceAnchor, null, null),
        MonthlyPaycheckSchedule monthly => new("monthly", null, ToDto(monthly.Anchor), null),
        SemimonthlyPaycheckSchedule semi => new("semimonthly", null, ToDto(semi.First), ToDto(semi.Second)),
        _ => throw new InvalidOperationException("Unsupported paycheck schedule.")
    };

    private static PaycheckMonthAnchorDto ToDto(PaycheckMonthAnchor anchor) =>
        new(anchor.Kind == PaycheckMonthAnchorKind.MonthEnd ? "month_end" : "day_of_month", anchor.Day);

    internal static ConfirmedPaycheckAmountDto ToDto(ConfirmedPaycheckAmount amount) => amount switch
    {
        FixedConfirmedPaycheckAmount fixedAmount => new("fixed", fixedAmount.Amount, null, null),
        RangeConfirmedPaycheckAmount range => new("range", null, range.Minimum, range.Maximum),
        _ => throw new InvalidOperationException("Unsupported paycheck amount.")
    };

    internal static ObservedPaycheckAmountDto ToDto(ObservedPaycheckAmountSummary amount) => amount switch
    {
        FixedObservedPaycheckAmount fixedAmount => new("fixed", fixedAmount.Amount, null, null, fixedAmount.Amount),
        VariableObservedPaycheckAmount variable => new("variable", null, variable.Minimum, variable.Maximum, variable.LowerMedian),
        _ => throw new InvalidOperationException("Unsupported observed paycheck amount.")
    };
}
