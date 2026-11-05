namespace BudgetPlanner.Contracts.Analytics;

public sealed record CashFlowMonthDto(
    string Month, DateOnly From, DateOnly To,
    string CashInMinor, string PaycheckCashInMinor, string OtherCashInMinor,
    string SpentMinor, string NetMinor,
    int InflowCount, int PaycheckInflowCount, int OtherInflowCount,
    int ExpenseCount, int PaycheckProfileCount, int EditedPaycheckInflowCount,
    IReadOnlyList<CashFlowDayDto> Days, IReadOnlyList<CashFlowCategoryDto> Categories);

public sealed record CashFlowDayDto(DateOnly Date, string SpentMinor);

public sealed record CashFlowCategoryDto(string Category, string AmountMinor);

public sealed record CashFlowResponse(
    string Month, DateOnly ThroughDate, DateOnly From, DateOnly To,
    IReadOnlyList<string> AvailableMonths, CashFlowMonthDto Selected,
    IReadOnlyList<CashFlowMonthDto> Months, IReadOnlyList<CashFlowCategoryDto> Categories);
