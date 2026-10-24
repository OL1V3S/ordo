using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using BudgetPlanner.Authentication;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

/// <summary>
/// #301 phase 1: every issued access token carries <c>iss</c> and <c>aud</c>,
/// while validation stays off so older tokens keep working.
/// </summary>
public sealed class AccessTokenClaimsTests
{
    private const string Password = "Password1!";
    private const string Origin = "https://frontend.test";
    private const string WebCookie = "__Secure-ordo-web-session";
    private const string TestKey = "test-only-signing-key-that-is-at-least-thirty-two-bytes-long";

    [Fact]
    public async Task Login_token_carries_issuer_and_audience()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("claims-login@example.com", confirmed: true);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/login", new { email = "claims-login@example.com", password = Password });

        AssertClaims(await TokenOfAsync(response));
    }

    [Fact]
    public async Task Device_session_create_and_refresh_tokens_carry_issuer_and_audience()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("claims-device@example.com", confirmed: true);

        var created = await app.Client.PostAsJsonAsync(
            "/api/auth/device-sessions", new { email = "claims-device@example.com", password = Password });
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var body = await created.Content.ReadFromJsonAsync<JsonElement>();
        AssertClaims(body.GetProperty("token").GetString()!);

        var refreshed = await app.Client.PostAsJsonAsync(
            "/api/auth/device-sessions/refresh",
            new { refreshToken = body.GetProperty("refreshToken").GetString() });
        AssertClaims(await TokenOfAsync(refreshed));
    }

    [Fact]
    public async Task Web_session_create_and_refresh_tokens_carry_issuer_and_audience()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("claims-web@example.com", confirmed: true);

        var created = await SendWebAsync(
            app, "/api/auth/web-session",
            JsonSerializer.Serialize(new { email = "claims-web@example.com", password = Password }),
            cookie: null);
        var cookie = CookieOf(created);
        AssertClaims(await TokenOfAsync(created));
        Assert.NotNull(cookie);

        var refreshed = await SendWebAsync(app, "/api/auth/web-session/refresh", json: null, cookie);
        AssertClaims(await TokenOfAsync(refreshed));
    }

    // Phase-1 compatibility only: replaced in phase 2, when a token without iss/aud must get 401.
    [Fact]
    public async Task Token_without_issuer_or_audience_is_still_accepted_in_phase_1()
    {
        await using var app = await TestApplication.StartAsync();
        var user = await app.CreateUserAsync("claims-legacy@example.com", confirmed: true);

        var legacy = new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
            claims: new[]
            {
                new Claim(ClaimTypes.NameIdentifier, user.Id),
                new Claim(ClaimTypes.Email, user.Email!),
                new Claim(ClaimTypes.Name, user.UserName!)
            },
            expires: DateTime.UtcNow.AddHours(1),
            signingCredentials: new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TestKey)),
                SecurityAlgorithms.HmacSha256)));
        var parsed = new JwtSecurityTokenHandler().ReadJwtToken(legacy);
        Assert.Null(parsed.Payload.Iss);
        Assert.Empty(parsed.Audiences);

        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/expenses");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", legacy);
        var response = await app.Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static void AssertClaims(string token)
    {
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);
        Assert.Equal("ordo-api", jwt.Issuer);
        Assert.Equal("ordo-api", AccessTokenClaims.Issuer);
        Assert.Equal(new[] { "ordo-clients" }, jwt.Audiences);
        Assert.Equal("ordo-clients", AccessTokenClaims.Audience);
    }

    private static async Task<string> TokenOfAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("token").GetString()!;
    }

    private static Task<HttpResponseMessage> SendWebAsync(
        TestApplication app, string route, string? json, string? cookie)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, route);
        if (json != null) request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        request.Headers.Add("Origin", Origin);
        request.Headers.Add("X-Ordo-Web-Session", "1");
        if (cookie != null) request.Headers.Add("Cookie", $"{WebCookie}={cookie}");
        return app.Client.SendAsync(request);
    }

    private static string? CookieOf(HttpResponseMessage response)
    {
        if (!response.Headers.TryGetValues("Set-Cookie", out var values)) return null;
        var line = values.SingleOrDefault(value => value.StartsWith(WebCookie + "=", StringComparison.Ordinal));
        var value = line?.Split(';')[0][(WebCookie.Length + 1)..];
        return string.IsNullOrEmpty(value) ? null : value;
    }
}
