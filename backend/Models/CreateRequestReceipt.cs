namespace BudgetPlanner.Models;

/// <summary>
/// Durable record that a client-supplied create request key was used by one owner.
/// It outlives the created expense or cash-in so a replay can never recreate deleted money.
/// </summary>
public class CreateRequestReceipt
{
    public const string ExpenseKind = "Expense";
    public const string AccountInflowKind = "AccountInflow";

    public string OwnerId { get; set; } = "";
    public ApplicationUser? Owner { get; set; }
    public Guid RequestKey { get; set; }
    public string RecordKind { get; set; } = "";
    public byte[] RequestFingerprint { get; set; } = [];
    public int? ExpenseId { get; set; }
    public Expense? Expense { get; set; }
    public int? AccountInflowId { get; set; }
    public string? AccountInflowOwnerId { get; set; }
    public AccountInflow? AccountInflow { get; set; }
    public DateTime CreatedAt { get; set; }
}
