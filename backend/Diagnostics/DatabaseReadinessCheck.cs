using BudgetPlanner.Data;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace BudgetPlanner.Diagnostics;

/// <summary>
/// Readiness probe: can the app reach its database. Results never carry
/// exception text, so nothing sensitive can reach the anonymous response.
/// </summary>
public sealed class DatabaseReadinessCheck(IServiceScopeFactory scopeFactory) : IHealthCheck
{
    public const string Name = "database";
    public const string ReadyTag = "ready";
    public static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(3);

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            return await db.Database.CanConnectAsync(cancellationToken)
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Unhealthy();
        }
        catch
        {
            // Timeout, client abort or database failure: report up/down only.
            return HealthCheckResult.Unhealthy();
        }
    }
}
