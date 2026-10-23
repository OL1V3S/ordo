using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using BudgetPlanner.Authentication;
using BudgetPlanner.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

/// <summary>Web sessions (#292): the long-lived credential lives only in an HttpOnly cookie.</summary>
public sealed class WebSessionFlowTests
{
    private const string Password = "Password1!";
    private const string Origin = "https://frontend.test";
    private const string SignIn = "/api/auth/web-session";
    private const string Refresh = "/api/auth/web-session/refresh";
    private const string SignOut = "/api/auth/web-session/sign-out";
    private const string CookieName = "__Secure-ordo-web-session";
    private static readonly DateTimeOffset Start = new(2026, 10, 23, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Sign_in_sets_a_hardened_cookie_and_keeps_the_credential_out_of_the_body()
    {
        await using var app = await TestApplication.StartAsync(timeProvider: new TestClock(Start));
        var user = await app.CreateUserAsync("web@example.com", confirmed: true);

        var response = await PostAsync(app, SignIn, new { email = "web@example.com", password = Password });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        var raw = await response.Content.ReadAsStringAsync();
        var body = JsonDocument.Parse(raw).RootElement;
        Assert.Equal(
            new[] { "email", "token" },
            body.EnumerateObject().Select(property => property.Name).OrderBy(name => name));
        var cookie = CookieOf(response)!;
        Assert.DoesNotContain(cookie, raw, StringComparison.Ordinal);

        var setCookie = Assert.Single(response.Headers.GetValues("Set-Cookie"));
        Assert.StartsWith(CookieName + "=", setCookie);
        Assert.Contains("httponly", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("secure", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/api/auth/web-session", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains($"max-age={(int)TimeSpan.FromDays(60).TotalSeconds}", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("domain=", setCookie, StringComparison.OrdinalIgnoreCase);

        Assert.True(DeviceSessionCredential.TryParse(cookie, out var sessionId, out _));
        var stored = Assert.Single(await app.GetDeviceSessionsAsync());
        Assert.Equal(sessionId, stored.Id);
        Assert.Equal(user.Id, stored.OwnerId);
    }

    [Fact]
    public async Task Sign_in_errors_match_login_exactly()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("errors@example.com", confirmed: true);
        await app.CreateUserAsync("errors-unconfirmed@example.com", confirmed: false);

        var unknown = await PostAsync(app, SignIn, new { email = "nobody@example.com", password = Password });
        var wrong = await PostAsync(app, SignIn, new { email = "errors@example.com", password = "Wrong-password1!" });
        var unconfirmed = await PostAsync(app, SignIn, new { email = "errors-unconfirmed@example.com", password = Password });

        foreach (var response in new[] { unknown, wrong, unconfirmed })
        {
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            Assert.Null(CookieOf(response));
        }
        Assert.Equal("Invalid email or password", await unknown.Content.ReadAsStringAsync());
        Assert.Equal("Invalid email or password", await wrong.Content.ReadAsStringAsync());
        Assert.Equal("Please confirm your email before logging in.", await unconfirmed.Content.ReadAsStringAsync());
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
    }

    [Fact]
    public async Task Sign_in_with_an_existing_cookie_ends_that_session_first()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("replace@example.com", confirmed: true);
        var first = await SignInAsync(app, "replace@example.com");

        var response = await PostAsync(app, SignIn, new { email = "replace@example.com", password = Password }, cookie: first);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotEqual(first, CookieOf(response));
        Assert.Equal(1, await app.CountDeviceSessionsAsync());
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(app, Refresh, null, cookie: first)).StatusCode);
    }

    [Fact]
    public async Task Refresh_rotates_the_cookie_and_returns_a_working_access_token()
    {
        await using var app = await TestApplication.StartAsync();
        var user = await app.CreateUserAsync("rotate@example.com", confirmed: true);
        var first = await SignInAsync(app, "rotate@example.com");

        var response = await PostAsync(app, Refresh, null, cookie: first);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        var raw = await response.Content.ReadAsStringAsync();
        var body = JsonDocument.Parse(raw).RootElement;
        Assert.Equal(
            new[] { "email", "token" },
            body.EnumerateObject().Select(property => property.Name).OrderBy(name => name));
        var second = CookieOf(response)!;
        Assert.NotEqual(first, second);
        Assert.DoesNotContain(second, raw, StringComparison.Ordinal);

        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/expenses");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", body.GetProperty("token").GetString());
        Assert.Equal(HttpStatusCode.OK, (await app.Client.SendAsync(request)).StatusCode);
        Assert.Equal(1, await app.CountDeviceSessionsAsync(user.Id));
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(app, Refresh, null, cookie: second)).StatusCode);
    }

    [Fact]
    public async Task Refresh_ignores_a_body_credential()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("body@example.com", confirmed: true);
        var cookie = await SignInAsync(app, "body@example.com");

        var response = await PostAsync(app, Refresh, new { refreshToken = cookie });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(1, await app.CountDeviceSessionsAsync());
    }

    [Fact]
    public async Task Reusing_the_old_cookie_returns_401_ends_the_session_and_clears_the_cookie()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("reuse@example.com", confirmed: true);
        var first = await SignInAsync(app, "reuse@example.com");
        var second = CookieOf(await PostAsync(app, Refresh, null, cookie: first))!;

        var reuse = await PostAsync(app, Refresh, null, cookie: first);

        await AssertSessionInvalidAsync(reuse);
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(app, Refresh, null, cookie: second)).StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("garbage")]
    [InlineData("AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")]
    public async Task Missing_or_garbage_cookie_returns_401_session_invalid(string? cookie)
    {
        await using var app = await TestApplication.StartAsync();

        await AssertSessionInvalidAsync(await PostAsync(app, Refresh, null, cookie: cookie));
    }

    [Fact]
    public async Task Idle_and_absolute_expiry_end_the_session()
    {
        var clock = new TestClock(Start);
        await using var app = await TestApplication.StartAsync(timeProvider: clock);
        await app.CreateUserAsync("expiry@example.com", confirmed: true);
        var idle = await SignInAsync(app, "expiry@example.com");
        clock.Advance(TimeSpan.FromDays(60));
        await AssertSessionInvalidAsync(await PostAsync(app, Refresh, null, cookie: idle));

        var cookie = await SignInAsync(app, "expiry@example.com");
        for (var day = 0; day < 3; day++)
        {
            clock.Advance(TimeSpan.FromDays(59));
            cookie = CookieOf(await PostAsync(app, Refresh, null, cookie: cookie))!;
        }
        clock.Advance(TimeSpan.FromDays(10));
        await AssertSessionInvalidAsync(await PostAsync(app, Refresh, null, cookie: cookie));
    }

    [Fact]
    public async Task Sign_out_deletes_the_row_clears_the_cookie_and_always_returns_204()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("out@example.com", confirmed: true);
        var cookie = await SignInAsync(app, "out@example.com");

        var response = await PostAsync(app, SignOut, null, cookie: cookie);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        AssertCleared(response);
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
        Assert.Equal(HttpStatusCode.NoContent, (await PostAsync(app, SignOut, null, cookie: cookie)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await PostAsync(app, SignOut, null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await PostAsync(app, SignOut, null, cookie: "garbage")).StatusCode);
    }

    [Theory]
    [InlineData(SignIn)]
    [InlineData(Refresh)]
    [InlineData(SignOut)]
    public async Task Missing_header_or_wrong_origin_is_403_before_validation_and_changes_nothing(string route)
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("csrf@example.com", confirmed: true);
        var cookie = await SignInAsync(app, "csrf@example.com");
        var valid = "{\"email\":\"csrf@example.com\",\"password\":\"Password1!\"}";

        var variants = new (string? Origin, string? Header)[]
        {
            (Origin, null),
            (Origin, "0"),
            (null, "1"),
            ("null", "1"),
            ("https://evil.test", "1"),
            ("http://frontend.test", "1"),
            ("https://frontend.test:8443", "1"),
            ("https://frontend.test.evil.test", "1"),
            ("https://frontend.test/path", "1")
        };
        foreach (var (origin, header) in variants)
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(app, route, valid, cookie, origin, header)).StatusCode);
            // A malformed body must still be 403, not 400.
            Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(app, route, "{not json", cookie, origin, header)).StatusCode);
        }
        Assert.Equal(1, await app.CountDeviceSessionsAsync());
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(app, Refresh, null, cookie: cookie)).StatusCode);
    }

    [Fact]
    public async Task Origin_comparison_is_by_parsed_scheme_host_and_port()
    {
        await using var app = await TestApplication.StartAsync();

        foreach (var origin in new[] { "https://frontend.test", "https://FRONTEND.test", "https://frontend.test:443" })
            Assert.Equal(
                HttpStatusCode.Unauthorized,
                (await SendAsync(app, Refresh, null, null, origin, "1")).StatusCode);
    }

    [Fact]
    public async Task Sign_in_rejects_a_bad_body_with_400_once_the_guard_passes()
    {
        await using var app = await TestApplication.StartAsync();

        Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync(app, SignIn, new { })).StatusCode);
    }

    [Fact]
    public async Task Cors_does_not_allow_credentials_or_unknown_origins()
    {
        await using var app = await TestApplication.StartAsync();

        using var allowed = new HttpRequestMessage(HttpMethod.Post, Refresh);
        allowed.Headers.Add("Origin", "https://oli-budget-planner.vercel.app");
        var allowedResponse = await app.Client.SendAsync(allowed);
        Assert.False(allowedResponse.Headers.Contains("Access-Control-Allow-Credentials"));

        using var disallowed = new HttpRequestMessage(HttpMethod.Post, Refresh);
        disallowed.Headers.Add("Origin", "https://evil.test");
        var disallowedResponse = await app.Client.SendAsync(disallowed);
        Assert.False(disallowedResponse.Headers.Contains("Access-Control-Allow-Origin"));
        Assert.False(disallowedResponse.Headers.Contains("Access-Control-Allow-Credentials"));
    }

    [Fact]
    public async Task The_cookie_alone_does_not_authenticate_a_protected_api()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("alone@example.com", confirmed: true);
        var cookie = await SignInAsync(app, "alone@example.com");

        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/expenses");
        request.Headers.Add("Cookie", $"{CookieName}={cookie}");

        Assert.Equal(HttpStatusCode.Unauthorized, (await app.Client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task Channels_are_isolated()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("channels@example.com", confirmed: true);
        var webCookie = await SignInAsync(app, "channels@example.com");
        var device = await app.Client.PostAsJsonAsync(
            "/api/auth/device-sessions", new { email = "channels@example.com", password = Password });
        var deviceCredential = (await device.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("refreshToken").GetString()!;

        // The cookie never reaches the device-session endpoints.
        using var viaCookie = new HttpRequestMessage(HttpMethod.Post, "/api/auth/device-sessions/refresh")
        {
            Content = JsonContent.Create(new { refreshToken = "garbage" })
        };
        viaCookie.Headers.Add("Cookie", $"{CookieName}={webCookie}");
        Assert.Equal(HttpStatusCode.Unauthorized, (await app.Client.SendAsync(viaCookie)).StatusCode);

        // A device credential in a body (or cookie) does not work on the web endpoints.
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(app, Refresh, new { refreshToken = deviceCredential })).StatusCode);
        Assert.Equal(2, await app.CountDeviceSessionsAsync());
    }

    [Fact]
    public async Task Password_reset_ends_web_sessions()
    {
        await using var app = await TestApplication.StartAsync();
        var user = await app.CreateUserAsync("reset-web@example.com", confirmed: true);
        var cookie = await SignInAsync(app, "reset-web@example.com");
        string token;
        using (var scope = app.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var fresh = await users.FindByIdAsync(user.Id);
            token = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(await users.GeneratePasswordResetTokenAsync(fresh!)));
        }

        var reset = await app.Client.PostAsJsonAsync(
            "/api/auth/reset-password",
            new { email = "reset-web@example.com", token, newPassword = "New-password1!" });

        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
        await AssertSessionInvalidAsync(await PostAsync(app, Refresh, null, cookie: cookie));
    }

    [Fact]
    public async Task Logs_never_contain_the_credential()
    {
        var logs = new CapturingLoggerProvider();
        await using var app = await TestApplication.StartAsync(loggerProvider: logs);
        await app.CreateUserAsync("logs@example.com", confirmed: true);
        var cookie = await SignInAsync(app, "logs@example.com");
        var rotated = CookieOf(await PostAsync(app, Refresh, null, cookie: cookie))!;
        await PostAsync(app, Refresh, null, cookie: cookie);
        await PostAsync(app, SignOut, null, cookie: rotated);

        var secret = cookie.Split('.')[1];
        Assert.DoesNotContain(logs.Messages, message =>
            message.Contains(secret, StringComparison.Ordinal)
            || message.Contains(rotated.Split('.')[1], StringComparison.Ordinal)
            || message.Contains(Password, StringComparison.Ordinal));
    }

    private static Task<HttpResponseMessage> PostAsync(
        TestApplication app, string route, object? body, string? cookie = null) =>
        SendAsync(app, route, body is null ? null : JsonSerializer.Serialize(body), cookie, Origin, "1");

    private static async Task<string> SignInAsync(TestApplication app, string email)
    {
        var response = await PostAsync(app, SignIn, new { email, password = Password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return CookieOf(response)!;
    }

    private static Task<HttpResponseMessage> SendAsync(
        TestApplication app, string route, string? json, string? cookie, string? origin, string? header)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, route);
        if (json != null) request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        if (origin != null) request.Headers.Add("Origin", origin);
        if (header != null) request.Headers.Add("X-Ordo-Web-Session", header);
        if (cookie != null) request.Headers.Add("Cookie", $"{CookieName}={cookie}");
        return app.Client.SendAsync(request);
    }

    /// <summary>The cookie value a response sets, or null when it sets none or clears it.</summary>
    private static string? CookieOf(HttpResponseMessage response)
    {
        if (!response.Headers.TryGetValues("Set-Cookie", out var values)) return null;
        var line = values.SingleOrDefault(value => value.StartsWith(CookieName + "=", StringComparison.Ordinal));
        var value = line?.Split(';')[0][(CookieName.Length + 1)..];
        return string.IsNullOrEmpty(value) ? null : value;
    }

    private static void AssertCleared(HttpResponseMessage response)
    {
        var line = Assert.Single(response.Headers.GetValues("Set-Cookie"));
        Assert.StartsWith(CookieName + "=;", line);
        Assert.Contains("expires=Thu, 01 Jan 1970", line, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/api/auth/web-session", line, StringComparison.OrdinalIgnoreCase);
    }

    private static async Task AssertSessionInvalidAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("session_invalid", body.GetProperty("code").GetString());
        AssertCleared(response);
    }
}
