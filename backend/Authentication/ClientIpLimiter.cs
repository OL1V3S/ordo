using System.Net;
using System.Threading.RateLimiting;
using Microsoft.Extensions.Options;

namespace BudgetPlanner.Authentication;

/// <summary>Per-client-IP groups that share one limit (#332).</summary>
public enum ClientIpGroup
{
    /// <summary>login, device-sessions, web-session.</summary>
    SignIn,

    /// <summary>register, resend-confirmation, forgot-password.</summary>
    Email
}

/// <summary>
/// Per-client-IP throttle checked before any hashing or account lookup, so the
/// same 429 applies whether or not the account exists (#332). Code defaults only.
/// A request with no known IP shares one "unknown" partition.
/// </summary>
public interface IClientIpLimiter
{
    bool TryAcquire(ClientIpGroup group, IPAddress? clientIp);
}

public sealed class ClientIpLimiterOptions
{
    public const int DefaultSignInPermitLimit = 20;
    public const int DefaultEmailPermitLimit = 10;

    public int SignInPermitLimit { get; set; } = DefaultSignInPermitLimit;
    public int EmailPermitLimit { get; set; } = DefaultEmailPermitLimit;
    public TimeSpan Window { get; set; } = TimeSpan.FromMinutes(1);
}

public sealed class ClientIpLimiter : IClientIpLimiter, IDisposable
{
    private readonly PartitionedRateLimiter<string> _limiter;

    public ClientIpLimiter(IOptions<ClientIpLimiterOptions> options)
    {
        var settings = options.Value;
        _limiter = PartitionedRateLimiter.Create<string, string>(key =>
            RateLimitPartition.GetFixedWindowLimiter(
                key,
                _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = key.StartsWith("sign-in:", StringComparison.Ordinal)
                        ? settings.SignInPermitLimit
                        : settings.EmailPermitLimit,
                    Window = settings.Window,
                    QueueLimit = 0,
                    AutoReplenishment = true
                }));
    }

    public bool TryAcquire(ClientIpGroup group, IPAddress? clientIp)
    {
        var name = group == ClientIpGroup.SignIn ? "sign-in" : "email";
        var ip = clientIp?.ToString() ?? "unknown";
        using var lease = _limiter.AttemptAcquire($"{name}:{ip}");
        return lease.IsAcquired;
    }

    public void Dispose() => _limiter.Dispose();
}
