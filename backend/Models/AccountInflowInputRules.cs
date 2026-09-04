namespace BudgetPlanner.Models;

public static class AccountInflowInputRules
{
    public const decimal MaximumAmount = 9999999999999999.99m;

    public static string NormalizeDescription(string? value) => (value ?? "").Trim();

    public static IReadOnlyList<string> Validate(
        decimal? amount,
        DateOnly? date,
        string? description)
    {
        var errors = new List<string>();
        if (date is null) errors.Add("date_required");
        if (amount is null || amount <= 0m) errors.Add("amount_must_be_positive");
        else
        {
            if (amount > MaximumAmount) errors.Add("amount_out_of_range");
            if (decimal.Round(amount.Value, 2) != amount.Value)
                errors.Add("amount_precision_invalid");
        }

        var normalizedDescription = NormalizeDescription(description);
        if (normalizedDescription.Length == 0) errors.Add("description_required");
        else if (normalizedDescription.Length > 500) errors.Add("description_too_long");

        return errors;
    }
}
