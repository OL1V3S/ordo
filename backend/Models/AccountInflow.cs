using System.Text.RegularExpressions;

namespace BudgetPlanner.Models;

public partial class AccountInflow
{
    public int Id { get; set; }
    public string OwnerId { get; set; } = "";
    public ApplicationUser? Owner { get; set; }
    public string Description { get; set; } = "";
    public decimal Amount { get; set; }
    public DateOnly Date { get; set; }
    public Guid PaycheckEvidenceRevision { get; set; } = Guid.NewGuid();

    public bool UpdateEvidence(string description, decimal amount, DateOnly date)
    {
        var trimmedDescription = description.Trim();
        var materiallyChanged = Amount != amount
            || Date != date
            || NormalizeDescriptionIdentity(Description) != NormalizeDescriptionIdentity(trimmedDescription);

        Description = trimmedDescription;
        Amount = amount;
        Date = date;
        if (materiallyChanged)
        {
            PaycheckEvidenceRevision = Guid.NewGuid();
        }

        return materiallyChanged;
    }

    private static string NormalizeDescriptionIdentity(string? value) =>
        WhitespaceRegex().Replace((value ?? "").Trim(), " ").ToLowerInvariant();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();
}
