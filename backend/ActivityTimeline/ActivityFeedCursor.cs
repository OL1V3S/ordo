using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;

namespace BudgetPlanner.ActivityTimeline;

/// <summary>
/// Position of one activity row in the shared ordering (date descending, expense before
/// cash-in, id descending). The encoded form is opaque and position-only: it carries no
/// owner, secret, or filter, so it can never widen the owner-scoped read.
/// </summary>
public sealed record ActivityFeedCursor(DateOnly Date, int Rank, int Id)
{
    private const string Version = "1";
    private const int MaxEncodedLength = 64;

    public string Encode() => WebEncoders.Base64UrlEncode(Encoding.ASCII.GetBytes(
        string.Create(CultureInfo.InvariantCulture, $"{Version}.{Date:yyyy-MM-dd}.{Rank}.{Id}")));

    public static bool TryDecode(string? value, out ActivityFeedCursor? cursor)
    {
        cursor = null;
        if (string.IsNullOrEmpty(value) || value.Length > MaxEncodedLength) return false;

        string text;
        try
        {
            text = new UTF8Encoding(false, true).GetString(WebEncoders.Base64UrlDecode(value));
        }
        catch (Exception exception) when (exception is FormatException or ArgumentException)
        {
            return false;
        }

        var parts = text.Split('.');
        if (parts.Length != 4 || parts[0] != Version) return false;
        if (!DateOnly.TryParseExact(
                parts[1], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            return false;
        if (!int.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out var rank)
            || rank is not (ActivityFeedOrdering.ExpenseRank or ActivityFeedOrdering.InflowRank))
            return false;
        if (!int.TryParse(parts[3], NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id < 1)
            return false;

        var decoded = new ActivityFeedCursor(date, rank, id);
        // Reject any non-canonical spelling of an otherwise valid position.
        if (!string.Equals(decoded.Encode(), value, StringComparison.Ordinal)) return false;

        cursor = decoded;
        return true;
    }
}
