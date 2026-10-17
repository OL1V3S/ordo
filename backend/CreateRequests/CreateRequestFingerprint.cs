using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BudgetPlanner.Models;

namespace BudgetPlanner.CreateRequests;

/// <summary>
/// SHA-256 over the normalized values that would actually be stored. The request key is
/// never an input. The serialized form is part of the stored contract: do not change it
/// without bumping <see cref="Version"/>.
/// </summary>
public static class CreateRequestFingerprint
{
    public const string Version = "v1";

    public static byte[] ForExpense(string description, decimal amount, DateOnly date, string category) =>
        Compute(CreateRequestReceipt.ExpenseKind, description, amount, date, category);

    public static byte[] ForAccountInflow(string description, decimal amount, DateOnly date) =>
        Compute(CreateRequestReceipt.AccountInflowKind, description, amount, date, "");

    internal static string Serialize(
        string kind,
        string? description,
        decimal amount,
        DateOnly date,
        string? category) =>
        JsonSerializer.Serialize(new[]
        {
            Version,
            kind,
            description ?? "",
            amount.ToString("0.00", CultureInfo.InvariantCulture),
            date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            category ?? ""
        });

    private static byte[] Compute(
        string kind,
        string? description,
        decimal amount,
        DateOnly date,
        string? category) =>
        SHA256.HashData(Encoding.UTF8.GetBytes(Serialize(kind, description, amount, date, category)));
}
