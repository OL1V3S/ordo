using System.Text.RegularExpressions;

namespace BudgetPlanner.Models;

public static partial class AccountInflowIdentity
{
    public static string NormalizeDescription(string? value) =>
        WhitespaceRegex().Replace((value ?? "").Trim(), " ").ToLowerInvariant();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();
}
