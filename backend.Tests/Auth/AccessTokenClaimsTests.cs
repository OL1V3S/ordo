using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using BudgetPlanner.Authentication;
using BudgetPlanner.Models;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

/// <summary>
/// #301: every issued access token carries <c>iss</c> and <c>aud</c>, and the
/// validator rejects tokens whose issuer, audience, lifetime or signature is wrong.
/// </summary>
public sealed class AccessTokenClaimsTests
{
    private const string Password = "Password1!";
    private const string Origin = "https://frontend.test";
    private const string WebCookie = "__Secure-ordo-web-session";
    private const string TestKey = "test-only-signing-key-that-is-at-least-thirty-two-bytes-long";
    private const string OtherKey = "another-signing-key-that-is-also-at-least-thirty-two-bytes";

    [Fact]
    public async Task Login_token_carries_issuer_and_audience_and_is_accepted()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("claims-login@example.com", confirmed: true);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/login", new { email = "claims-login@example.com", password = Password });

        await AssertAcceptedAsync(app, await TokenOfAsync(response));
    }

    [Fact]
    public async Task Device_session_create_and_refresh_tokens_carry_issuer_and_audience_and_are_accepted()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("claims-device@example.com", confirmed: true);

        var created = await app.Client.PostAsJsonAsync(
            "/api/auth/device-sessions", new { email = "claims-device@example.com", password = Password });
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var body = await created.Content.ReadFromJsonAsync<JsonElement>();
        await AssertAcceptedAsync(app, body.GetProperty("token").GetString()!);

        var refreshed = await app.Client.PostAsJsonAsync(
            "/api/auth/device-sessions/refresh",
            new { refreshToken = body.GetProperty("refreshToken").GetString() });
        await AssertAcceptedAsync(app, await TokenOfAsync(refreshed));
    }

    [Fact]
    public async Task Web_session_create_and_refresh_tokens_carry_issuer_and_audience_and_are_accepted()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("claims-web@example.com", confirmed: true);

        var created = await SendWebAsync(
            app, "/api/auth/web-session",
            JsonSerializer.Serialize(new { email = "claims-web@example.com", password = Password }),
            cookie: null);
        var cookie = CookieOf(created);
        await AssertAcceptedAsync(app, await TokenOfAsync(created));
        Assert.NotNull(cookie);

        var refreshed = await SendWebAsync(app, "/api/auth/web-session/refresh", json: null, cookie);
        await AssertAcceptedAsync(app, await TokenOfAsync(refreshed));
    }

    public static TheoryData<string, string?, string?, int, bool, HttpStatusCode> SignedTokenCases => new()
    {
        { "correct issuer and audience", AccessTokenClaims.Issuer, AccessTokenClaims.Audience, 60, true, HttpStatusCode.OK },
        { "issuer missing", null, AccessTokenClaims.Audience, 60, true, HttpStatusCode.Unauthorized },
        { "audience missing", AccessTokenClaims.Issuer, null, 60, true, HttpStatusCode.Unauthorized },
        { "both missing (pre-#301 token)", null, null, 60, true, HttpStatusCode.Unauthorized },
        { "wrong issuer", "someone-else", AccessTokenClaims.Audience, 60, true, HttpStatusCode.Unauthorized },
        { "wrong audience", AccessTokenClaims.Issuer, "someone-else", 60, true, HttpStatusCode.Unauthorized },
        { "expired beyond clock skew", AccessTokenClaims.Issuer, AccessTokenClaims.Audience, -10, true, HttpStatusCode.Unauthorized },
        { "different signing key", AccessTokenClaims.Issuer, AccessTokenClaims.Audience, 60, false, HttpStatusCode.Unauthorized },
    };

    [Theory]
    [MemberData(nameof(SignedTokenCases))]
    public async Task Hand_signed_token_is_validated(
        string name, string? issuer, string? audience, int expiresInMinutes, bool testKey, HttpStatusCode expected)
    {
        await using var app = await TestApplication.StartAsync();
        var user = await app.CreateUserAsync("claims-matrix@example.com", confirmed: true);
        var claims = UserClaims(user);
        if (audience != null) claims.Add(new Claim(JwtRegisteredClaimNames.Aud, audience));

        var token = Sign(claims, issuer, expiresInMinutes, testKey ? TestKey : OtherKey);

        var actual = await GetProtectedAsync(app, token);
        Assert.True(actual == expected, $"{name}: expected {expected}, got {actual}");
    }

    [Fact]
    public async Task Audience_array_containing_ordo_clients_is_accepted()
    {
        await using var app = await TestApplication.StartAsync();
        var user = await app.CreateUserAsync("claims-aud-array@example.com", confirmed: true);
        var claims = UserClaims(user);
        claims.Add(new Claim(JwtRegisteredClaimNames.Aud, "someone-else"));
        claims.Add(new Claim(JwtRegisteredClaimNames.Aud, AccessTokenClaims.Audience));

        var token = Sign(claims, AccessTokenClaims.Issuer, 60, TestKey);
        Assert.Equal(2, new JwtSecurityTokenHandler().ReadJwtToken(token).Audiences.Count());

        Assert.Equal(HttpStatusCode.OK, await GetProtectedAsync(app, token));
    }

    [Fact]
    public async Task Unsigned_alg_none_token_is_rejected()
    {
        await using var app = await TestApplication.StartAsync();
        var user = await app.CreateUserAsync("claims-alg-none@example.com", confirmed: true);
        var claims = UserClaims(user);
        claims.Add(new Claim(JwtRegisteredClaimNames.Aud, AccessTokenClaims.Audience));

        var payload = new JwtPayload(
            AccessTokenClaims.Issuer, null, claims, null, DateTime.UtcNow.AddHours(1));
        var token = Base64UrlEncoder.Encode("{\"alg\":\"none\",\"typ\":\"JWT\"}")
            + "." + payload.Base64UrlEncode() + ".";

        Assert.Equal(HttpStatusCode.Unauthorized, await GetProtectedAsync(app, token));
    }

    // Carries a valid stamp binding (#337) so each case fails only for its stated reason.
    private static List<Claim> UserClaims(ApplicationUser user) => new()
    {
        new Claim(ClaimTypes.NameIdentifier, user.Id),
        new Claim(ClaimTypes.Email, user.Email!),
        new Claim(ClaimTypes.Name, user.UserName!),
        new Claim(AccessTokenClaims.StampHash, AccessTokenClaims.StampHashValue(user.SecurityStamp))
    };

    private static string Sign(List<Claim> claims, string? issuer, int expiresInMinutes, string key) =>
        new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
            issuer: issuer,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(expiresInMinutes),
            signingCredentials: new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
                SecurityAlgorithms.HmacSha256)));

    private static async Task<HttpStatusCode> GetProtectedAsync(TestApplication app, string token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/expenses");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await app.Client.SendAsync(request);
        return response.StatusCode;
    }

    private static async Task AssertAcceptedAsync(TestApplication app, string token)
    {
        Assert.Equal(HttpStatusCode.OK, await GetProtectedAsync(app, token));
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
