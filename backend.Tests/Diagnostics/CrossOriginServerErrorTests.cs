using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using BudgetPlanner.Home;
using BudgetPlanner.Tests.Auth;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace BudgetPlanner.Tests.Diagnostics;

/// <summary>
/// A cross-origin 500 must keep its CORS headers, or the browser hides the status and
/// the support reference (#340). The exception handler runs before UseCors; this guards that the
/// CORS headers the CORS middleware already set survive the handler's response reset (they do on
/// .NET 9, so no CORS code was added to the handler).
/// </summary>
public sealed class CrossOriginServerErrorTests
{
    private const string AllowedOrigin = "https://oli-budget-planner.vercel.app";

    private sealed class ThrowingHomeReadService : IHomeReadService
    {
        public Task<HomeReadResult> GetAsync(
            string ownerId, DateOnly activityThroughDate, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("synthetic-secret");
    }

    private static void UseThrowingHome(IServiceCollection services)
    {
        services.RemoveAll<IHomeReadService>();
        services.AddScoped<IHomeReadService, ThrowingHomeReadService>();
    }

    private static async Task<HttpResponseMessage> GetHomeAsync(TestApplication app, string? origin)
    {
        await app.CreateUserAsync("cors500@example.com", confirmed: true);
        var login = await app.Client.PostAsJsonAsync(
            "/api/auth/device-sessions", new { email = "cors500@example.com", password = "Password1!" });
        var token = (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/home?activityThroughDate=2026-10-23");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (origin is not null)
            request.Headers.Add("Origin", origin);
        return await app.Client.SendAsync(request);
    }

    [Fact]
    public async Task Cross_origin_500_from_an_allowed_origin_keeps_its_cors_headers()
    {
        await using var app = await TestApplication.StartAsync(configureServices: UseThrowingHome);

        using var response = await GetHomeAsync(app, AllowedOrigin);

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal(AllowedOrigin, Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.False(response.Headers.Contains("Access-Control-Allow-Credentials"));
        // The browser can only read the support reference if the header is exposed.
        Assert.Contains("X-Request-Id", Assert.Single(response.Headers.GetValues("Access-Control-Expose-Headers")));
        Assert.Matches("^[0-9a-f]{16}$", Assert.Single(response.Headers.GetValues("X-Request-Id")));
    }

    [Fact]
    public async Task Cross_origin_500_from_a_disallowed_origin_gets_no_cors_headers()
    {
        await using var app = await TestApplication.StartAsync(configureServices: UseThrowingHome);

        using var response = await GetHomeAsync(app, "https://elsewhere.example");

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
        Assert.False(response.Headers.Contains("Access-Control-Expose-Headers"));
    }
}
