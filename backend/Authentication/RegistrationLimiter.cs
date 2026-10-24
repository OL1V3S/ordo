using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace BudgetPlanner.Authentication;

/// <summary>
/// Limits every registration (new or taken email) before the account check, so
/// the same 429 applies regardless of account state (#300). Code defaults only.
/// </summary>
public interface IRegistrationLimiter
{
    bool TryAcquireGlobal();
    bool TryAcquireRecipient(string requestedEmail);
}

public sealed class RegistrationLimiterOptions
{
    public const int DefaultGlobalPermitLimit = 120;
    public const int DefaultRecipientPermitLimit = 3;

    public int GlobalPermitLimit { get; set; } = DefaultGlobalPermitLimit;
    public int RecipientPermitLimit { get; set; } = DefaultRecipientPermitLimit;
    public TimeSpan Window { get; set; } = TimeSpan.FromMinutes(1);
}

public sealed class RegistrationLimiter : IRegistrationLimiter, IDisposable
{
    private static readonly ILookupNormalizer EmailNormalizer = new UpperInvariantLookupNormalizer();

    private readonly FixedWindowRateLimiter _globalLimiter;
    private readonly PartitionedRateLimiter<string> _recipientLimiter;

    public RegistrationLimiter(IOptions<RegistrationLimiterOptions> options)
    {
        var settings = options.Value;
        _globalLimiter = new FixedWindowRateLimiter(new FixedWindowRateLimiterOptions
        {
            PermitLimit = settings.GlobalPermitLimit,
            Window = settings.Window,
            QueueLimit = 0,
            AutoReplenishment = true
        });
        _recipientLimiter = PartitionedRateLimiter.Create<string, string>(normalizedEmail =>
            RateLimitPartition.GetFixedWindowLimiter(
                normalizedEmail,
                _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = settings.RecipientPermitLimit,
                    Window = settings.Window,
                    QueueLimit = 0,
                    AutoReplenishment = true
                }));
    }

    public bool TryAcquireGlobal()
    {
        using var lease = _globalLimiter.AttemptAcquire();
        return lease.IsAcquired;
    }

    public bool TryAcquireRecipient(string requestedEmail)
    {
        var normalizedEmail = EmailNormalizer.NormalizeEmail(
            requestedEmail.Trim()) ?? string.Empty;
        using var lease = _recipientLimiter.AttemptAcquire(normalizedEmail);
        return lease.IsAcquired;
    }

    public void Dispose()
    {
        _globalLimiter.Dispose();
        _recipientLimiter.Dispose();
    }
}
