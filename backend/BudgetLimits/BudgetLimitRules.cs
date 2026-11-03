using BudgetPlanner.Import;

namespace BudgetPlanner.BudgetLimits;

/// <summary>
/// Budget limit input rules. Categories use the same canonical form as expenses; amounts may be
/// zero but never negative, at most two decimals, and within the supported monetary range.
/// </summary>
public static class BudgetLimitRules
{
    public static string NormalizeCategory(string? value) => ExpenseInputRules.NormalizeCategory(value);

    public static IReadOnlyList<(string Field, string Code)> Validate(decimal amount, string normalizedCategory)
    {
        var errors = new List<(string, string)>();
        if (amount < 0m) errors.Add(("limitAmount", "limit_amount_negative"));
        else
        {
            if (amount > ExpenseInputRules.MaximumAmount) errors.Add(("limitAmount", "limit_amount_out_of_range"));
            if (decimal.Round(amount, 2) != amount) errors.Add(("limitAmount", "limit_amount_precision_invalid"));
        }

        if (normalizedCategory.Length > 100) errors.Add(("category", "category_too_long"));
        else if (normalizedCategory == "other") errors.Add(("category", "category_reserved"));
        return errors;
    }
}
