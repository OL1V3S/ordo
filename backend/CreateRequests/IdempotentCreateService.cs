using System.Security.Cryptography;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BudgetPlanner.CreateRequests;

public enum IdempotentCreateStatus
{
    Created,
    Replayed,
    KeyReused,
    RecordDeleted,
    Conflict
}

public sealed record IdempotentCreateResult(
    IdempotentCreateStatus Status,
    Expense? Expense = null,
    AccountInflow? AccountInflow = null);

/// <summary>
/// Creates an expense or cash-in together with a request receipt in one SaveChanges.
/// Runs only when the caller supplied a valid Idempotency-Key. Nothing here logs keys or values.
/// </summary>
public sealed class IdempotentCreateService(BudgetContext context, TimeProvider timeProvider)
{
    internal const string ReceiptKeyConstraintName = "PK_CreateRequestReceipts";
    private const int MaxAttempts = 2;

    public Task<IdempotentCreateResult> CreateExpenseAsync(
        string ownerId,
        Guid key,
        Func<Expense> create,
        byte[] fingerprint,
        CancellationToken cancellationToken) =>
        RunAsync(
            ownerId,
            key,
            CreateRequestReceipt.ExpenseKind,
            fingerprint,
            receipt => receipt.Expense = create(),
            cancellationToken);

    public Task<IdempotentCreateResult> CreateInflowAsync(
        string ownerId,
        Guid key,
        Func<AccountInflow> create,
        byte[] fingerprint,
        CancellationToken cancellationToken) =>
        RunAsync(
            ownerId,
            key,
            CreateRequestReceipt.AccountInflowKind,
            fingerprint,
            receipt => receipt.AccountInflow = create(),
            cancellationToken);

    private async Task<IdempotentCreateResult> RunAsync(
        string ownerId,
        Guid key,
        string kind,
        byte[] fingerprint,
        Action<CreateRequestReceipt> attachRecord,
        CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < MaxAttempts; attempt++)
        {
            var existing = await FindReceiptAsync(ownerId, key, cancellationToken);
            if (existing is not null)
            {
                return await ResolveAsync(existing, ownerId, kind, fingerprint, cancellationToken);
            }

            var receipt = new CreateRequestReceipt
            {
                OwnerId = ownerId,
                RequestKey = key,
                RecordKind = kind,
                RequestFingerprint = fingerprint,
                CreatedAt = timeProvider.GetUtcNow().UtcDateTime
            };
            attachRecord(receipt);
            context.CreateRequestReceipts.Add(receipt);

            try
            {
                await context.SaveChangesAsync(cancellationToken);
                return new IdempotentCreateResult(
                    IdempotentCreateStatus.Created,
                    receipt.Expense,
                    receipt.AccountInflow);
            }
            catch (DbUpdateException exception) when (IsReceiptKeyViolation(exception))
            {
                // The whole SaveChanges rolled back, including the record insert. A concurrent
                // request with the same key committed first; re-read what it stored.
                context.ChangeTracker.Clear();
                var winner = await FindReceiptAsync(ownerId, key, cancellationToken);
                if (winner is not null)
                {
                    return await ResolveAsync(winner, ownerId, kind, fingerprint, cancellationToken);
                }
            }
        }

        return new IdempotentCreateResult(IdempotentCreateStatus.Conflict);
    }

    private Task<CreateRequestReceipt?> FindReceiptAsync(
        string ownerId,
        Guid key,
        CancellationToken cancellationToken) =>
        context.CreateRequestReceipts.AsNoTracking().SingleOrDefaultAsync(
            value => value.OwnerId == ownerId && value.RequestKey == key,
            cancellationToken);

    private async Task<IdempotentCreateResult> ResolveAsync(
        CreateRequestReceipt receipt,
        string ownerId,
        string kind,
        byte[] fingerprint,
        CancellationToken cancellationToken)
    {
        if (receipt.RecordKind != kind
            || !CryptographicOperations.FixedTimeEquals(receipt.RequestFingerprint, fingerprint))
        {
            return new IdempotentCreateResult(IdempotentCreateStatus.KeyReused);
        }

        if (kind == CreateRequestReceipt.ExpenseKind)
        {
            var expense = receipt.ExpenseId is { } expenseId
                ? await context.Expenses.AsNoTracking().SingleOrDefaultAsync(
                    value => value.Id == expenseId && value.UserId == ownerId,
                    cancellationToken)
                : null;
            return expense is null
                ? new IdempotentCreateResult(IdempotentCreateStatus.RecordDeleted)
                : new IdempotentCreateResult(IdempotentCreateStatus.Replayed, Expense: expense);
        }

        var inflow = receipt.AccountInflowId is { } inflowId
            ? await context.AccountInflows.AsNoTracking().SingleOrDefaultAsync(
                value => value.Id == inflowId && value.OwnerId == ownerId,
                cancellationToken)
            : null;
        return inflow is null
            ? new IdempotentCreateResult(IdempotentCreateStatus.RecordDeleted)
            : new IdempotentCreateResult(IdempotentCreateStatus.Replayed, AccountInflow: inflow);
    }

    internal static bool IsReceiptKeyViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: ReceiptKeyConstraintName
        };
}
