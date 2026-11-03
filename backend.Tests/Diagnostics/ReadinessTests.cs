using System.Diagnostics;
using System.Net;
using BudgetPlanner.Data;
using BudgetPlanner.Diagnostics;
using BudgetPlanner.Tests.Auth;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Xunit;

namespace BudgetPlanner.Tests.Diagnostics;

public sealed class ReadinessTests
{
    private const string Secret = "synthetic-secret Host=db.example.com Password=hunter2";
    private const string Healthy = "{\"status\":\"Healthy\",\"checks\":{\"database\":\"Healthy\"}}";
    private const string Unhealthy = "{\"status\":\"Unhealthy\",\"checks\":{\"database\":\"Unhealthy\"}}";

    private sealed class ThrowingCheck : IHealthCheck
    {
        public Task<HealthCheckResult> CheckHealthAsync(
            HealthCheckContext context, CancellationToken cancellationToken = default) =>
            Task.FromResult(HealthCheckResult.Unhealthy(Secret, new InvalidOperationException(Secret)));
    }

    private sealed class HangingCheck : IHealthCheck
    {
        public async Task<HealthCheckResult> CheckHealthAsync(
            HealthCheckContext context, CancellationToken cancellationToken = default)
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return HealthCheckResult.Healthy();
        }
    }

    private static Action<IServiceCollection> Replace<T>(TimeSpan? timeout = null) where T : class, IHealthCheck =>
        services => services.Configure<HealthCheckServiceOptions>(options =>
        {
            options.Registrations.Clear();
            options.Registrations.Add(new HealthCheckRegistration(
                DatabaseReadinessCheck.Name,
                sp => ActivatorUtilities.CreateInstance<T>(sp),
                HealthStatus.Unhealthy,
                [DatabaseReadinessCheck.ReadyTag],
                timeout));
        });

    private static async Task AssertFixedUnhealthy(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal(Unhealthy, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Ready_is_200_with_exact_body_and_no_cookies_when_database_ok()
    {
        await using var app = await TestApplication.StartAsync(environment: "Production");

        using var response = await app.Client.GetAsync("/health/ready");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(Healthy, await response.Content.ReadAsStringAsync());
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        Assert.False(response.Headers.Contains("Set-Cookie"));
    }

    [Fact]
    public async Task Ready_is_503_with_fixed_body_and_no_secret_when_check_fails()
    {
        await using var app = await TestApplication.StartAsync(configureServices: Replace<ThrowingCheck>());

        using var response = await app.Client.GetAsync("/health/ready");

        await AssertFixedUnhealthy(response);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
    }

    [Fact]
    public async Task Ready_is_503_quickly_when_check_hangs()
    {
        await using var app = await TestApplication.StartAsync(
            configureServices: Replace<HangingCheck>(TimeSpan.FromMilliseconds(200)));

        var clock = Stopwatch.StartNew();
        using var response = await app.Client.GetAsync("/health/ready");

        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(5));
        await AssertFixedUnhealthy(response);
    }

    [Fact]
    public async Task Real_check_reports_unhealthy_without_leaking_database_errors()
    {
        var logs = new CapturingLoggerProvider();
        await using var app = await TestApplication.StartAsync(
            loggerProvider: logs,
            configureServices: services => services.AddScoped<BudgetContext>(
                _ => throw new InvalidOperationException(Secret)));

        using var response = await app.Client.GetAsync("/health/ready");

        await AssertFixedUnhealthy(response);
        // Startup (data protection) also resolves the broken context; only the probe is under test.
        var probeLogs = logs.Entries.Where(entry => entry.Category.Contains("HealthChecks")).ToList();
        Assert.NotEmpty(probeLogs);
        Assert.DoesNotContain(probeLogs, entry => entry.Text.Contains("hunter2") || entry.HadException);
    }

    [Fact]
    public async Task Liveness_is_unchanged_and_runs_no_checks()
    {
        await using var app = await TestApplication.StartAsync(configureServices: Replace<ThrowingCheck>());

        using var response = await app.Client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync());
    }
}
