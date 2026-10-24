using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using BudgetPlanner.Data;
using BudgetPlanner.Home;
using BudgetPlanner.Tests.Auth;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Xunit;

namespace BudgetPlanner.Tests.Diagnostics;

public sealed class ExceptionHandlingAndHealthTests
{
    private const string Secret = "synthetic-secret amount 123.45 user@example.com";
    private const string Password = "Password1!";
    private const string HomeRoute = "/api/home?activityThroughDate=2026-10-23";

    private sealed class ThrowingHomeReadService : IHomeReadService
    {
        public Task<HomeReadResult> GetAsync(
            string ownerId, DateOnly activityThroughDate, CancellationToken cancellationToken) =>
            throw new InvalidOperationException(Secret);
    }

    private static async Task<HttpResponseMessage> GetHomeAsync(TestApplication app)
    {
        await app.CreateUserAsync("boom@example.com", confirmed: true);
        var login = await app.Client.PostAsJsonAsync(
            "/api/auth/device-sessions", new { email = "boom@example.com", password = Password });
        var token = (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        using var request = new HttpRequestMessage(HttpMethod.Get, HomeRoute);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.TryAddWithoutValidation("Cookie", "session=cookie-secret");
        return await app.Client.SendAsync(request);
    }

    private static void UseThrowingHome(IServiceCollection services)
    {
        services.RemoveAll<IHomeReadService>();
        services.AddScoped<IHomeReadService, ThrowingHomeReadService>();
    }

    [Theory]
    [InlineData("Testing")]
    [InlineData("Production")]
    public async Task Unhandled_exception_returns_fixed_privacy_safe_500_and_one_safe_log(string environment)
    {
        var logs = new CapturingLoggerProvider();
        await using var app = await TestApplication.StartAsync(
            loggerProvider: logs, environment: environment, configureServices: UseThrowingHome);

        using var response = await GetHomeAsync(app);

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var raw = await response.Content.ReadAsStringAsync();
        var body = JsonDocument.Parse(raw).RootElement;
        Assert.Equal("internal_error", body.GetProperty("code").GetString());
        Assert.Equal("Unexpected error", body.GetProperty("title").GetString());
        Assert.Equal("The request could not be completed.", body.GetProperty("detail").GetString());
        Assert.Equal("https://ordo.invalid/problems/internal_error", body.GetProperty("type").GetString());
        Assert.Equal(500, body.GetProperty("status").GetInt32());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("traceId").GetString()));
        foreach (var forbidden in new[]
                 { "synthetic-secret", "123.45", "user@example.com", "InvalidOperation", "   at ", "Exception" })
            Assert.DoesNotContain(forbidden, raw);

        var errors = logs.Entries.Where(entry => entry.Level >= LogLevel.Error).ToList();
        var error = Assert.Single(errors);
        Assert.Equal("BudgetPlanner.Diagnostics.UnhandledExceptionHandler", error.Category);
        Assert.False(error.HadException);
        Assert.Contains("InvalidOperationException", error.Text);
        Assert.Contains("GET", error.Text);
        Assert.Contains("api/home", error.Text);
        Assert.DoesNotContain("activityThroughDate", error.Text);
        foreach (var forbidden in new[]
                 { "synthetic-secret", "123.45", "user@example.com", "cookie-secret", "Bearer", "   at " })
            Assert.DoesNotContain(forbidden, error.Text);
        Assert.DoesNotContain(
            logs.Entries,
            entry => entry.Text.Contains("synthetic-secret")
                     || entry.Category.EndsWith("ExceptionHandlerMiddleware"));
    }

    [Fact]
    public async Task Health_is_anonymous_ok_and_healthy_in_every_variant()
    {
        await using var app = await TestApplication.StartAsync(environment: "Production");

        using var plain = await app.Client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, plain.StatusCode);
        Assert.Equal("Healthy", await plain.Content.ReadAsStringAsync());

        using var badBearer = new HttpRequestMessage(HttpMethod.Get, "/health");
        badBearer.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "not-a-token");
        using var badBearerResponse = await app.Client.SendAsync(badBearer);
        Assert.Equal(HttpStatusCode.OK, badBearerResponse.StatusCode);

        using var crossOrigin = new HttpRequestMessage(HttpMethod.Get, "/health");
        crossOrigin.Headers.Add("Origin", "https://elsewhere.example");
        using var crossOriginResponse = await app.Client.SendAsync(crossOrigin);
        Assert.Equal(HttpStatusCode.OK, crossOriginResponse.StatusCode);

        // The test server is plain HTTP; a redirect would not be a 200.
        Assert.Equal("http", plain.RequestMessage!.RequestUri!.Scheme);
    }

    [Fact]
    public async Task Health_does_not_touch_the_database()
    {
        var resolved = 0;
        await using var app = await TestApplication.StartAsync(configureServices: services =>
            services.AddScoped<BudgetContext>(_ =>
            {
                Interlocked.Increment(ref resolved);
                throw new InvalidOperationException("database must not be used");
            }));

        // Host startup may resolve the context once; only the request itself is under test.
        Volatile.Write(ref resolved, 0);

        using var response = await app.Client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(0, Volatile.Read(ref resolved));
    }

    [Fact]
    public async Task Existing_error_shapes_are_unchanged()
    {
        await using var app = await TestApplication.StartAsync();

        using var anonymous = await app.Client.GetAsync(HomeRoute);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        Assert.Equal(string.Empty, await anonymous.Content.ReadAsStringAsync());

        await app.CreateUserAsync("shape@example.com", confirmed: true);
        var login = await app.Client.PostAsJsonAsync(
            "/api/auth/device-sessions", new { email = "shape@example.com", password = Password });
        var token = (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/home?activityThroughDate=bad");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var badDate = await app.Client.SendAsync(request);
        Assert.Equal(HttpStatusCode.BadRequest, badDate.StatusCode);
        var body = await badDate.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("home_activity_through_date_invalid", body.GetProperty("code").GetString());
    }
}
