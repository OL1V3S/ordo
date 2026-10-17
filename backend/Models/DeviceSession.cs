namespace BudgetPlanner.Models;

/// <summary>
/// A long-lived, revocable sign-in for a native client. Only a SHA-256 hash of
/// the current credential secret is stored. Ending a session deletes its row.
/// </summary>
public class DeviceSession
{
    public Guid Id { get; set; }
    public string OwnerId { get; set; } = "";
    public ApplicationUser? Owner { get; set; }
    public byte[] SecretHash { get; set; } = [];
    public byte[] SecurityStampHash { get; set; } = [];
    public DateTime CreatedAt { get; set; }
    public DateTime LastUsedAt { get; set; }
    public DateTime AbsoluteExpiresAt { get; set; }
}
