using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using BudgetPlanner.Authentication;
using BudgetPlanner.Models;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

/// <summary>
/// #338: <c>Jwt:Key</c> signs and validates; optional <c>Jwt:PreviousKey</c> only validates,
/// so a key swap does not 401 tokens signed with the old key until they expire.
/// </summary>
public sealed class JwtKeyRotationTests
{
    private const string Password = "Password1!";
    private const string Origin = "https://frontend.test";
    private const string WebCookie = "__Secure-ordo-web-session";

    // Synthetic, test-only keys (32+ bytes). Never real secrets.
    private const string K1 = "rotation-old-signing-key-that-is-at-least-thirty-two-bytes";
    private const string K2 = "rotation-new-signing-key-that-is-at-least-thirty-two-bytes";
    private const string K3 = "rotation-other-signing-key-that-is-at-least-thirty-two-bytes";

    // ---- Overlap: current K2, previous K1 ----------------------------------------

    [Fact]
    public async Task Overlap_accepts_previous_and_current_key_and_rejects_any_other()
    {
        await using var app = await TestApplication.StartAsync(jwtKey: K2, jwtPreviousKey: K1);
        var user = await app.CreateUserAsync("rotation-overlap@example.com", confirmed: true);

        Assert.Equal(HttpStatusCode.OK, await GetProtectedAsync(app, Sign(user, K1)));
        Assert.Equal(HttpStatusCode.OK, await GetProtectedAsync(app, Sign(user, K2)));
        Assert.Equal(HttpStatusCode.Unauthorized, await GetProtectedAsync(app, Sign(user, K3)));
    }

    [Theory]
    [InlineData("someone-else", AccessTokenClaims.Audience, 60, "wrong issuer")]
    [InlineData(AccessTokenClaims.Issuer, "someone-else", 60, "wrong audience")]
    [InlineData(null, null, 60, "no issuer or audience")]
    [InlineData(AccessTokenClaims.Issuer, AccessTokenClaims.Audience, -10, "expired beyond clock skew")]
    public async Task Previous_key_token_must_still_pass_every_other_check(
        string? issuer, string? audience, int expiresInMinutes, string name)
    {
        await using var app = await TestApplication.StartAsync(jwtKey: K2, jwtPreviousKey: K1);
        var user = await app.CreateUserAsync("rotation-other-checks@example.com", confirmed: true);

        var token = Sign(user, K1, issuer, audience, expiresInMinutes);

        var actual = await GetProtectedAsync(app, token);
        Assert.True(actual == HttpStatusCode.Unauthorized, $"{name}: expected 401, got {actual}");
    }

    [Fact]
    public async Task Previous_key_does_not_make_an_unsigned_alg_none_token_valid()
    {
        await using var app = await TestApplication.StartAsync(jwtKey: K2, jwtPreviousKey: K1);
        var user = await app.CreateUserAsync("rotation-alg-none@example.com", confirmed: true);
        var claims = UserClaims(user);
        claims.Add(new Claim(JwtRegisteredClaimNames.Aud, AccessTokenClaims.Audience));

        var payload = new JwtPayload(
            AccessTokenClaims.Issuer, null, claims, null, DateTime.UtcNow.AddHours(1));
        var token = Base64UrlEncoder.Encode("{\"alg\":\"none\",\"typ\":\"JWT\"}")
            + "." + payload.Base64UrlEncode() + ".";

        Assert.Equal(HttpStatusCode.Unauthorized, await GetProtectedAsync(app, token));
    }

    [Fact]
    public async Task Issued_tokens_are_signed_with_the_current_key_only()
    {
        await using var app = await TestApplication.StartAsync(jwtKey: K2, jwtPreviousKey: K1);
        await app.CreateUserAsync("rotation-issued@example.com", confirmed: true);

        var login = await app.Client.PostAsJsonAsync(
            "/api/auth/login", new { email = "rotation-issued@example.com", password = Password });
        AssertSignedWithCurrentKeyOnly(await TokenOfAsync(login));

        var created = await app.Client.PostAsJsonAsync(
            "/api/auth/device-sessions", new { email = "rotation-issued@example.com", password = Password });
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var body = await created.Content.ReadFromJsonAsync<JsonElement>();
        AssertSignedWithCurrentKeyOnly(body.GetProperty("token").GetString()!);

        var refreshed = await app.Client.PostAsJsonAsync(
            "/api/auth/device-sessions/refresh",
            new { refreshToken = body.GetProperty("refreshToken").GetString() });
        AssertSignedWithCurrentKeyOnly(await TokenOfAsync(refreshed));

        var webCreated = await SendWebAsync(
            app, "/api/auth/web-session",
            JsonSerializer.Serialize(new { email = "rotation-issued@example.com", password = Password }),
            cookie: null);
        var cookie = CookieOf(webCreated);
        AssertSignedWithCurrentKeyOnly(await TokenOfAsync(webCreated));
        Assert.NotNull(cookie);

        var webRefreshed = await SendWebAsync(app, "/api/auth/web-session/refresh", json: null, cookie);
        AssertSignedWithCurrentKeyOnly(await TokenOfAsync(webRefreshed));
    }

    [Fact]
    public async Task A_previous_key_token_keeps_working_until_the_previous_key_is_removed()
    {
        // Overlap (K2 + K1) accepts K1; after step 5 (K2 only) the same kind of K1 token gets 401.
        await using var overlap = await TestApplication.StartAsync(jwtKey: K2, jwtPreviousKey: K1);
        var overlapUser = await overlap.CreateUserAsync("rotation-removed@example.com", confirmed: true);
        var oldToken = Sign(overlapUser, K1);
        Assert.Equal(HttpStatusCode.OK, await GetProtectedAsync(overlap, oldToken));

        await using var removed = await TestApplication.StartAsync(jwtKey: K2);
        var removedUser = await removed.CreateUserAsync("rotation-removed@example.com", confirmed: true);

        Assert.Equal(HttpStatusCode.Unauthorized, await GetProtectedAsync(removed, Sign(removedUser, K1)));
        Assert.Equal(HttpStatusCode.OK, await GetProtectedAsync(removed, Sign(removedUser, K2)));
    }

    // ---- Host start ----------------------------------------------------------------

    [Fact]
    public async Task Without_a_previous_key_the_validation_parameters_are_the_single_key_defaults()
    {
        await using var app = await TestApplication.StartAsync();

        var parameters = ValidationParameters(app);

        Assert.Null(parameters.IssuerSigningKeys);
        var current = Assert.IsType<SymmetricSecurityKey>(parameters.IssuerSigningKey);
        Assert.Equal(Encoding.UTF8.GetBytes(TestApplication.DefaultJwtKey), current.Key);
    }

    [Fact]
    public async Task With_a_previous_key_it_is_a_validation_only_second_key()
    {
        await using var app = await TestApplication.StartAsync(jwtKey: K2, jwtPreviousKey: K1);

        var parameters = ValidationParameters(app);

        var current = Assert.IsType<SymmetricSecurityKey>(parameters.IssuerSigningKey);
        Assert.Equal(Encoding.UTF8.GetBytes(K2), current.Key);
        var previous = Assert.IsType<SymmetricSecurityKey>(Assert.Single(parameters.IssuerSigningKeys));
        Assert.Equal(Encoding.UTF8.GetBytes(K1), previous.Key);
    }

    [Fact]
    public async Task Whitespace_previous_key_starts_the_host_on_the_single_key_path()
    {
        await using var app = await TestApplication.StartAsync(jwtPreviousKey: "   ");

        Assert.Null(ValidationParameters(app).IssuerSigningKeys);
    }

    [Theory]
    [InlineData("short-previous-VALUE-1", K2, "Jwt:PreviousKey")]
    [InlineData(K1, "short-current-VALUE-2", "Jwt:Key")]
    [InlineData(K2, K2, "Jwt:PreviousKey")]
    public async Task A_bad_previous_key_stops_the_host_and_leaks_no_key_value(
        string previousKey, string currentKey, string expectedConfigKey)
    {
        var failure = await Assert.ThrowsAnyAsync<Exception>(
            () => TestApplication.StartAsync(jwtKey: currentKey, jwtPreviousKey: previousKey));

        var text = failure.ToString();
        Assert.Contains(expectedConfigKey, text);
        Assert.DoesNotContain(previousKey, text);
        Assert.DoesNotContain(currentKey, text);
        // The failed start restored the process environment.
        Assert.NotEqual(previousKey, Environment.GetEnvironmentVariable("Jwt__PreviousKey"));
        Assert.NotEqual(currentKey, Environment.GetEnvironmentVariable("Jwt__Key"));
    }

    // ---- JwtSigningKeys ----------------------------------------------------------------

    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("   ", null)]
    [InlineData(null, K1)]
    [InlineData("   ", K1)]
    public void Missing_current_key_fails_with_the_unchanged_message(string? current, string? previous)
    {
        var failure = Assert.Throws<InvalidOperationException>(() => JwtSigningKeys.Read(current, previous));

        Assert.Equal("JWT key is missing", failure.Message);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t\n")]
    public void Empty_or_whitespace_previous_key_is_not_configured(string? previous)
    {
        var keys = JwtSigningKeys.Read(K2, previous);

        Assert.Null(keys.Previous);
        Assert.Equal(Encoding.UTF8.GetBytes(K2), keys.Current);
        var parameters = new TokenValidationParameters();
        keys.ApplyTo(parameters);
        Assert.Null(parameters.IssuerSigningKeys);
        Assert.Equal(Encoding.UTF8.GetBytes(K2), Assert.IsType<SymmetricSecurityKey>(parameters.IssuerSigningKey).Key);
    }

    [Fact]
    public void A_short_current_key_without_a_previous_key_is_unchanged_from_before()
    {
        var keys = JwtSigningKeys.Read("short", previousKey: null);

        Assert.Equal(Encoding.UTF8.GetBytes("short"), keys.Current);
        Assert.Null(keys.Previous);
    }

    [Fact]
    public void Previous_key_shorter_than_32_bytes_fails_and_names_the_config_key_only()
    {
        var previous = new string('p', 31);

        var failure = Assert.Throws<InvalidOperationException>(() => JwtSigningKeys.Read(K2, previous));

        Assert.Contains("Jwt:PreviousKey", failure.Message);
        AssertNoKeyValue(failure.Message, previous, K2);
    }

    [Fact]
    public void Current_key_shorter_than_32_bytes_fails_when_a_previous_key_is_set()
    {
        var current = new string('c', 31);

        var failure = Assert.Throws<InvalidOperationException>(() => JwtSigningKeys.Read(current, K1));

        Assert.Contains("Jwt:Key", failure.Message);
        AssertNoKeyValue(failure.Message, current, K1);
    }

    [Fact]
    public void Previous_key_equal_to_current_key_fails()
    {
        var failure = Assert.Throws<InvalidOperationException>(() => JwtSigningKeys.Read(K1, K1));

        Assert.Contains("Jwt:PreviousKey", failure.Message);
        AssertNoKeyValue(failure.Message, K1);
    }

    [Fact]
    public void Key_length_is_counted_in_utf8_bytes_and_keys_are_not_trimmed()
    {
        var sixteenTwoByteChars = new string('é', 16);
        var padded = " " + K1 + " ";

        var keys = JwtSigningKeys.Read(K2, sixteenTwoByteChars);
        var paddedKeys = JwtSigningKeys.Read(K2, padded);

        Assert.Equal(32, keys.Previous!.Length);
        Assert.Equal(Encoding.UTF8.GetBytes(padded), paddedKeys.Previous);
        Assert.NotEqual(Encoding.UTF8.GetBytes(K1), paddedKeys.Previous);
    }

    [Fact]
    public void A_32_byte_previous_key_is_accepted()
    {
        var keys = JwtSigningKeys.Read(K2, new string('p', 32));

        Assert.Equal(32, keys.Previous!.Length);
    }

    [Fact]
    public void Reads_both_keys_from_configuration()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = K2,
                ["Jwt:PreviousKey"] = K1
            })
            .Build();

        var keys = JwtSigningKeys.Read(configuration);

        Assert.Equal(Encoding.UTF8.GetBytes(K2), keys.Current);
        Assert.Equal(Encoding.UTF8.GetBytes(K1), keys.Previous);
    }

    // ---- Helpers -----------------------------------------------------------------------

    private static void AssertNoKeyValue(string message, params string[] keys)
    {
        foreach (var key in keys)
            Assert.DoesNotContain(key, message);
    }

    private static TokenValidationParameters ValidationParameters(TestApplication app) =>
        app.Services.GetRequiredService<IOptionsMonitor<JwtBearerOptions>>()
            .Get(JwtBearerDefaults.AuthenticationScheme).TokenValidationParameters;

    // Carries a valid stamp binding (#337) so each case fails only for its stated reason.
    private static List<Claim> UserClaims(ApplicationUser user) => new()
    {
        new Claim(ClaimTypes.NameIdentifier, user.Id),
        new Claim(ClaimTypes.Email, user.Email!),
        new Claim(ClaimTypes.Name, user.UserName!),
        new Claim(AccessTokenClaims.StampHash, AccessTokenClaims.StampHashValue(user.SecurityStamp))
    };

    private static string Sign(
        ApplicationUser user,
        string key,
        string? issuer = AccessTokenClaims.Issuer,
        string? audience = AccessTokenClaims.Audience,
        int expiresInMinutes = 60)
    {
        var claims = UserClaims(user);
        if (audience != null) claims.Add(new Claim(JwtRegisteredClaimNames.Aud, audience));

        return new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
            issuer: issuer,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(expiresInMinutes),
            signingCredentials: new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
                SecurityAlgorithms.HmacSha256)));
    }

    // Signature only: the token verifies with K2 and fails with K1.
    private static void AssertSignedWithCurrentKeyOnly(string token)
    {
        Assert.True(VerifiesSignature(token, K2), "token must verify with the current key");
        Assert.False(VerifiesSignature(token, K1), "token must not verify with the previous key");
    }

    private static bool VerifiesSignature(string token, string key)
    {
        var parameters = new TokenValidationParameters
        {
            ValidateIssuer = false,
            ValidateAudience = false,
            ValidateLifetime = false,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key))
        };
        try
        {
            new JwtSecurityTokenHandler().ValidateToken(token, parameters, out _);
            return true;
        }
        catch (SecurityTokenException)
        {
            return false;
        }
    }

    private static async Task<HttpStatusCode> GetProtectedAsync(TestApplication app, string token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/expenses");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await app.Client.SendAsync(request);
        return response.StatusCode;
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
