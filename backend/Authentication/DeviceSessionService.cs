using System.Data;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace BudgetPlanner.Authentication;

public sealed class DeviceSessionOptions
{
    public const int DefaultMaxSessionsPerAccount = 20;
    public const int DefaultExpiredCleanupBatchSize = 100;

    /// <summary>A session expires when now &gt;= LastUsedAt + IdleTimeout.</summary>
    public TimeSpan IdleTimeout { get; set; } = TimeSpan.FromDays(60);

    /// <summary>A session expires when now &gt;= CreatedAt + AbsoluteLifetime; refresh never extends it.</summary>
    public TimeSpan AbsoluteLifetime { get; set; } = TimeSpan.FromDays(180);

    public int MaxSessionsPerAccount { get; set; } = DefaultMaxSessionsPerAccount;
    public int ExpiredCleanupBatchSize { get; set; } = DefaultExpiredCleanupBatchSize;
}

/// <summary>The owner of a device session and the credential that now identifies it.</summary>
public sealed record DeviceSessionIssue(ApplicationUser User, string Credential);

public interface IDeviceSessionService
{
    /// <summary>
    /// Starts a session for a user whose password has just been verified.
    /// <paramref name="securityStamp"/> must be read from the same tracked user
    /// immediately after the password check succeeded.
    /// </summary>
    Task<string> CreateAsync(string userId, string? securityStamp, CancellationToken cancellationToken);

    /// <summary>Rotates the credential. Returns null for every kind of failure.</summary>
    Task<DeviceSessionIssue?> RefreshAsync(string credential, CancellationToken cancellationToken);

    /// <summary>Ends the session the credential names, if any. Never reveals whether it existed.</summary>
    Task SignOutAsync(string credential, CancellationToken cancellationToken);

    /// <summary>Ends every session of a user.</summary>
    Task RevokeAllAsync(string userId, CancellationToken cancellationToken);
}

public sealed class DeviceSessionService(
    BudgetContext context,
    TimeProvider clock,
    Microsoft.Extensions.Options.IOptions<DeviceSessionOptions> options) : IDeviceSessionService
{
    public async Task<string> CreateAsync(
        string userId, string? securityStamp, CancellationToken cancellationToken)
    {
        var settings = options.Value;
        var now = clock.GetUtcNow().UtcDateTime;
        var secret = DeviceSessionCredential.NewSecret();
        var session = new DeviceSession
        {
            Id = Guid.NewGuid(),
            OwnerId = userId,
            SecretHash = DeviceSessionCredential.HashSecret(secret),
            SecurityStampHash = DeviceSessionCredential.HashSecurityStamp(securityStamp),
            CreatedAt = now,
            LastUsedAt = now,
            AbsoluteExpiresAt = now + settings.AbsoluteLifetime
        };

        await using var transaction = await BeginTransactionAsync(cancellationToken);

        await DeleteExpiredBatchAsync(now, settings, cancellationToken);
        await EvictLeastRecentlyUsedAsync(userId, settings, cancellationToken);

        context.DeviceSessions.Add(session);
        await context.SaveChangesAsync(cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);

        return DeviceSessionCredential.Format(session.Id, secret);
    }

    public async Task<DeviceSessionIssue?> RefreshAsync(
        string credential, CancellationToken cancellationToken)
    {
        if (!DeviceSessionCredential.TryParse(credential, out var sessionId, out var secret))
            return null;

        var settings = options.Value;
        var now = clock.GetUtcNow().UtcDateTime;

        await using var transaction = await BeginTransactionAsync(cancellationToken);

        var session = await LockSessionAsync(sessionId, cancellationToken);
        if (session is null) return null;

        if (IsExpired(session, now, settings))
            return await EndAsync(session, transaction, cancellationToken);

        var user = await context.Users.AsNoTracking()
            .SingleOrDefaultAsync(candidate => candidate.Id == session.OwnerId, cancellationToken);
        if (user is null
            || !DeviceSessionCredential.HashesEqual(
                session.SecurityStampHash,
                DeviceSessionCredential.HashSecurityStamp(user.SecurityStamp)))
            return await EndAsync(session, transaction, cancellationToken);

        // A real session id with a secret that is no longer current means the
        // credential was already rotated (or forged): treat it as reuse and end
        // the whole session so every credential for it, including the newest, dies.
        if (!DeviceSessionCredential.HashesEqual(
                session.SecretHash, DeviceSessionCredential.HashSecret(secret)))
            return await EndAsync(session, transaction, cancellationToken);

        var newSecret = DeviceSessionCredential.NewSecret();
        session.SecretHash = DeviceSessionCredential.HashSecret(newSecret);
        session.LastUsedAt = now;

        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Second line of defense should the row lock ever be removed: someone
            // else rotated the row first, so this is reuse.
            return await EndAsync(session, transaction, cancellationToken);
        }

        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        return new DeviceSessionIssue(user, DeviceSessionCredential.Format(session.Id, newSecret));
    }

    public async Task SignOutAsync(string credential, CancellationToken cancellationToken)
    {
        if (!DeviceSessionCredential.TryParse(credential, out var sessionId, out _))
            return;

        await using var transaction = await BeginTransactionAsync(cancellationToken);

        // Any credential whose session id exists ends that session: it either
        // matches the current secret or counts as reuse.
        var session = await LockSessionAsync(sessionId, cancellationToken);
        if (session is null) return;

        await EndAsync(session, transaction, cancellationToken);
    }

    public async Task RevokeAllAsync(string userId, CancellationToken cancellationToken)
    {
        if (context.Database.IsRelational())
        {
            // ExecuteDelete ignores the SecretHash concurrency token, so a refresh
            // that rotates a row concurrently cannot make the deletion throw.
            await context.DeviceSessions
                .Where(value => value.OwnerId == userId)
                .ExecuteDeleteAsync(cancellationToken);
            return;
        }

        var sessions = await context.DeviceSessions
            .Where(value => value.OwnerId == userId)
            .ToListAsync(cancellationToken);
        await RemoveTrackedAsync(sessions, cancellationToken);
    }

    private static bool IsExpired(DeviceSession session, DateTime now, DeviceSessionOptions settings) =>
        now >= session.LastUsedAt + settings.IdleTimeout || now >= session.AbsoluteExpiresAt;

    /// <summary>Deletes the session, commits and reports a failed refresh.</summary>
    private async Task<DeviceSessionIssue?> EndAsync(
        DeviceSession session, IDbContextTransaction? transaction, CancellationToken cancellationToken)
    {
        await DeleteByIdsAsync([session.Id], cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        return null;
    }

    private async Task DeleteExpiredBatchAsync(
        DateTime now, DeviceSessionOptions settings, CancellationToken cancellationToken)
    {
        var idleCutoff = now - settings.IdleTimeout;
        var expiredIds = await context.DeviceSessions
            .Where(value => value.LastUsedAt <= idleCutoff || value.AbsoluteExpiresAt <= now)
            .OrderBy(value => value.LastUsedAt)
            .Select(value => value.Id)
            .Take(settings.ExpiredCleanupBatchSize)
            .ToListAsync(cancellationToken);
        await DeleteByIdsAsync(expiredIds, cancellationToken);
    }

    private async Task EvictLeastRecentlyUsedAsync(
        string userId, DeviceSessionOptions settings, CancellationToken cancellationToken)
    {
        var cap = Math.Max(1, settings.MaxSessionsPerAccount);
        var existing = await context.DeviceSessions.CountAsync(
            value => value.OwnerId == userId, cancellationToken);
        var excess = existing - (cap - 1);
        if (excess <= 0) return;

        var evictIds = await context.DeviceSessions
            .Where(value => value.OwnerId == userId)
            .OrderBy(value => value.LastUsedAt)
            .ThenBy(value => value.CreatedAt)
            .Select(value => value.Id)
            .Take(excess)
            .ToListAsync(cancellationToken);
        await DeleteByIdsAsync(evictIds, cancellationToken);
    }

    private async Task DeleteByIdsAsync(IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken)
    {
        if (ids.Count == 0) return;

        if (context.Database.IsRelational())
        {
            var idList = ids.ToList();
            await context.DeviceSessions
                .Where(value => idList.Contains(value.Id))
                .ExecuteDeleteAsync(cancellationToken);
            foreach (var entry in context.ChangeTracker.Entries<DeviceSession>()
                         .Where(entry => ids.Contains(entry.Entity.Id)).ToList())
                entry.State = EntityState.Detached;
            return;
        }

        var sessions = await context.DeviceSessions
            .Where(value => ids.Contains(value.Id))
            .ToListAsync(cancellationToken);
        await RemoveTrackedAsync(sessions, cancellationToken);
    }

    private async Task RemoveTrackedAsync(List<DeviceSession> sessions, CancellationToken cancellationToken)
    {
        if (sessions.Count == 0) return;
        context.DeviceSessions.RemoveRange(sessions);
        await context.SaveChangesAsync(cancellationToken);
    }

    private Task<DeviceSession?> LockSessionAsync(Guid sessionId, CancellationToken cancellationToken) =>
        context.Database.IsNpgsql()
            ? context.DeviceSessions.FromSqlInterpolated($"""
                SELECT * FROM "DeviceSessions"
                WHERE "Id" = {sessionId}
                FOR UPDATE
                """).SingleOrDefaultAsync(cancellationToken)
            : context.DeviceSessions.SingleOrDefaultAsync(
                value => value.Id == sessionId, cancellationToken);

    // Explicit Read Committed: under Serializable (used by other services) the
    // waiting loser of a FOR UPDATE race would get a serialization failure (500)
    // instead of observing the committed rotation and returning 401.
    private async Task<IDbContextTransaction?> BeginTransactionAsync(CancellationToken cancellationToken) =>
        context.Database.IsRelational()
            ? await context.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken)
            : null;
}
