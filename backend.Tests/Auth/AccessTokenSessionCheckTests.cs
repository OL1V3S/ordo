using System.Collections.Concurrent;
using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BudgetPlanner.Authentication;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

/// <summary>
/// #337: every authenticated request checks that the access token still belongs to a
/// live session (<c>sid</c>) or, for <c>/login</c> tokens, to the user's current
/// security stamp (<c>ordo_stamp</c>). Revoked tokens get the normal bearer 401.
/// </summary>
public sealed class AccessTokenSessionCheckTests
{
    private const string Password = "Password1!";
    private const string Origin = "https://frontend.test";
    private const string WebCookie = "__Secure-ordo-web-session";
    private const string TestKey = "test-only-signing-key-that-is-at-least-thirty-two-bytes-long";
    private const string Protected = "/api/expenses";
    private static readonly DateTimeOffset Start = new(2026, 10, 16, 12, 0, 0, TimeSpan.Zero);

    // ---- Issued claims -------------------------------------------------------------

    [Fact]
    public void Claim_names_are_pinned()
    {
        Assert.Equal("sid", AccessTokenClaims.SessionId);
        Assert.Equal("ordo_stamp", AccessTokenClaims.StampHash);
    }

    [Fact]
    public async Task Native_create_and_refresh_tokens_carry_only_a_protected_session_id()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("sid-native@example.com", confirmed: true);

        var created = await DeviceSignInAsync(app, "sid-native@example.com");
        var refreshed = await DeviceRefreshAsync(app, created.Credential);

        foreach (var session in new[] { created, refreshed })
            await AssertProtectedSessionClaimAsync(app, session);
    }

    [Fact]
    public async Task Web_create_and_refresh_tokens_carry_only_a_protected_session_id()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("sid-web@example.com", confirmed: true);

        var created = await WebSignInAsync(app, "sid-web@example.com");
        var refreshed = await WebRefreshAsync(app, created.Credential);

        foreach (var session in new[] { created, refreshed })
            await AssertProtectedSessionClaimAsync(app, session);
    }

    [Fact]
    public async Task Login_token_carries_only_the_stamp_hash()
    {
        await using var app = await TestApplication.StartAsync();
        var user = await app.CreateUserAsync("stamp-login@example.com", confirmed: true);

        var token = await LoginAsync(app, "stamp-login@example.com");

        var claims = new JwtSecurityTokenHandler().ReadJwtToken(token).Claims.ToList();
        Assert.DoesNotContain(claims, claim => claim.Type == AccessTokenClaims.SessionId);
        var stamp = Assert.Single(claims, claim => claim.Type == AccessTokenClaims.StampHash);
        var current = await app.FindUserByIdAsync(user.Id);
        Assert.Equal(AccessTokenClaims.StampHashValue(current!.SecurityStamp), stamp.Value);
        Assert.DoesNotContain(current.SecurityStamp!, PayloadOf(token));
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, token));
    }

    [Fact]
    public async Task Validated_principal_exposes_the_claims_by_their_literal_names()
    {
        var seen = new ConcurrentQueue<List<(string Type, string Value)>>();
        await using var app = await TestApplication.StartAsync(configureServices: services =>
            services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
            {
                var inner = options.Events.OnTokenValidated;
                options.Events.OnTokenValidated = context =>
                {
                    seen.Enqueue(context.Principal!.Claims.Select(claim => (claim.Type, claim.Value)).ToList());
                    return inner(context);
                };
            }));
        var user = await app.CreateUserAsync("pin-claims@example.com", confirmed: true);
        var session = await DeviceSignInAsync(app, "pin-claims@example.com");
        var login = await LoginAsync(app, "pin-claims@example.com");

        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, session.Token));
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, login));

        var sessionPrincipal = seen.ToArray()[0];
        var rawSid = new JwtSecurityTokenHandler().ReadJwtToken(session.Token).Claims
            .Single(claim => claim.Type == "sid").Value;
        Assert.Contains(("sid", rawSid), sessionPrincipal);
        Assert.DoesNotContain(sessionPrincipal, claim => claim.Type == "ordo_stamp");
        Assert.Contains((ClaimTypes.NameIdentifier, user.Id), sessionPrincipal);

        var loginPrincipal = seen.ToArray()[1];
        Assert.Contains(loginPrincipal, claim => claim.Type == "ordo_stamp");
        Assert.DoesNotContain(loginPrincipal, claim => claim.Type == "sid");
        Assert.Contains((ClaimTypes.NameIdentifier, user.Id), loginPrincipal);
    }

    // ---- Invalidates immediately ---------------------------------------------------

    [Fact]
    public async Task Native_sign_out_ends_that_token_while_another_session_still_works()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("native-out@example.com", confirmed: true);
        var first = await DeviceSignInAsync(app, "native-out@example.com");
        var second = await DeviceSignInAsync(app, "native-out@example.com");
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, first.Token));

        using var signOut = await app.Client.PostAsJsonAsync(
            "/api/auth/device-sessions/sign-out", new { refreshToken = first.Credential });
        Assert.Equal(HttpStatusCode.NoContent, signOut.StatusCode);

        await AssertBearerRejectedAsync(app, first.Token);
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, second.Token));
    }

    [Fact]
    public async Task Web_sign_out_ends_that_token_while_another_session_still_works()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("web-out@example.com", confirmed: true);
        var web = await WebSignInAsync(app, "web-out@example.com");
        var native = await DeviceSignInAsync(app, "web-out@example.com");

        using var signOut = await SendWebAsync(app, "/api/auth/web-session/sign-out", json: null, web.Credential);
        Assert.Equal(HttpStatusCode.NoContent, signOut.StatusCode);

        await AssertBearerRejectedAsync(app, web.Token);
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, native.Token));
    }

    [Fact]
    public async Task Web_sign_in_that_replaces_a_cookie_ends_the_old_session_token()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("web-replace@example.com", confirmed: true);
        var old = await WebSignInAsync(app, "web-replace@example.com");

        var replacement = await WebSignInAsync(app, "web-replace@example.com", existingCookie: old.Credential);

        await AssertBearerRejectedAsync(app, old.Token);
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, replacement.Token));
    }

    [Fact]
    public async Task Password_reset_ends_session_tokens_and_login_tokens()
    {
        await using var app = await TestApplication.StartAsync();
        var user = await app.CreateUserAsync("reset-ends@example.com", confirmed: true);
        var native = await DeviceSignInAsync(app, "reset-ends@example.com");
        var web = await WebSignInAsync(app, "reset-ends@example.com");
        var login = await LoginAsync(app, "reset-ends@example.com");
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, login));

        using var reset = await app.Client.PostAsJsonAsync("/api/auth/reset-password", new
        {
            email = "reset-ends@example.com",
            token = await ResetTokenAsync(app, user.Id),
            newPassword = "New-password1!"
        });
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);

        await AssertBearerRejectedAsync(app, native.Token);
        await AssertBearerRejectedAsync(app, web.Token);
        await AssertBearerRejectedAsync(app, login);

        using var again = await app.Client.PostAsJsonAsync(
            "/api/auth/device-sessions", new { email = "reset-ends@example.com", password = "New-password1!" });
        var body = await again.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, body.GetProperty("token").GetString()!));
    }

    [Fact]
    public async Task Any_other_security_stamp_change_ends_session_and_login_tokens()
    {
        await using var app = await TestApplication.StartAsync();
        var user = await app.CreateUserAsync("stamp-change@example.com", confirmed: true);
        var native = await DeviceSignInAsync(app, "stamp-change@example.com");
        var login = await LoginAsync(app, "stamp-change@example.com");
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, native.Token));
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, login));

        using (var scope = app.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            Assert.True((await users.UpdateSecurityStampAsync((await users.FindByIdAsync(user.Id))!)).Succeeded);
        }

        await AssertBearerRejectedAsync(app, native.Token);
        await AssertBearerRejectedAsync(app, login);
    }

    [Fact]
    public async Task Reuse_detection_ends_the_session_and_its_newest_token()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("reuse@example.com", confirmed: true);
        var first = await DeviceSignInAsync(app, "reuse@example.com");
        var second = await DeviceRefreshAsync(app, first.Credential);
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, second.Token));

        using var replay = await app.Client.PostAsJsonAsync(
            "/api/auth/device-sessions/refresh", new { refreshToken = first.Credential });
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);

        await AssertBearerRejectedAsync(app, second.Token);
        await AssertBearerRejectedAsync(app, first.Token);
    }

    [Fact]
    public async Task Eviction_past_the_session_cap_ends_the_evicted_sessions_token()
    {
        var clock = new TestClock(DateTimeOffset.UtcNow);
        await using var app = await TestApplication.StartAsync(
            timeProvider: clock,
            configureDeviceSessions: options => options.MaxSessionsPerAccount = 2);
        await app.CreateUserAsync("evict@example.com", confirmed: true);
        var first = await DeviceSignInAsync(app, "evict@example.com");
        clock.Advance(TimeSpan.FromMinutes(1));
        var second = await DeviceSignInAsync(app, "evict@example.com");
        clock.Advance(TimeSpan.FromMinutes(1));
        var third = await DeviceSignInAsync(app, "evict@example.com");

        await AssertBearerRejectedAsync(app, first.Token);
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, second.Token));
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, third.Token));
    }

    [Fact]
    public async Task Idle_expiry_ends_the_token_even_though_the_jwt_has_not_expired()
    {
        var clock = new TestClock(DateTimeOffset.UtcNow);
        await using var app = await TestApplication.StartAsync(timeProvider: clock);
        await app.CreateUserAsync("idle-token@example.com", confirmed: true);
        var session = await DeviceSignInAsync(app, "idle-token@example.com");

        clock.Advance(TimeSpan.FromDays(60) - TimeSpan.FromSeconds(1));
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, session.Token));

        clock.Advance(TimeSpan.FromSeconds(1));
        await AssertBearerRejectedAsync(app, session.Token);
    }

    [Fact]
    public async Task Absolute_expiry_ends_the_token_of_a_session_that_kept_refreshing()
    {
        var clock = new TestClock(DateTimeOffset.UtcNow);
        await using var app = await TestApplication.StartAsync(timeProvider: clock);
        await app.CreateUserAsync("absolute-token@example.com", confirmed: true);
        var session = await DeviceSignInAsync(app, "absolute-token@example.com");

        for (var step = 0; step < 3; step++)
        {
            clock.Advance(TimeSpan.FromDays(59));
            session = await DeviceRefreshAsync(app, session.Credential);
        }

        clock.Advance(TimeSpan.FromDays(2));
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, session.Token));

        clock.Advance(TimeSpan.FromDays(1));
        await AssertBearerRejectedAsync(app, session.Token);
    }

    // ---- Does not invalidate -------------------------------------------------------

    [Fact]
    public async Task Rotation_keeps_the_earlier_access_token_valid()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("rotation@example.com", confirmed: true);
        var first = await DeviceSignInAsync(app, "rotation@example.com");
        var second = await DeviceRefreshAsync(app, first.Credential);
        var web = await WebSignInAsync(app, "rotation@example.com");
        var webRefreshed = await WebRefreshAsync(app, web.Credential);

        foreach (var token in new[] { first.Token, second.Token, web.Token, webRefreshed.Token })
            Assert.Equal(HttpStatusCode.OK, await GetAsync(app, token));
    }

    [Fact]
    public async Task Lockout_does_not_revoke_existing_tokens()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("lockout-token@example.com", confirmed: true);
        var session = await DeviceSignInAsync(app, "lockout-token@example.com");
        var login = await LoginAsync(app, "lockout-token@example.com");

        for (var attempt = 0; attempt < 6; attempt++)
        {
            using var wrong = await app.Client.PostAsJsonAsync(
                "/api/auth/login", new { email = "lockout-token@example.com", password = "Wrong-password1!" });
            Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        }

        using var locked = await app.Client.PostAsJsonAsync(
            "/api/auth/login", new { email = "lockout-token@example.com", password = Password });
        Assert.Equal(HttpStatusCode.Unauthorized, locked.StatusCode);

        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, session.Token));
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, login));
    }

    [Fact]
    public async Task A_revoked_bearer_on_a_public_endpoint_does_not_break_sign_in_or_refresh()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("public-bearer@example.com", confirmed: true);
        var native = await DeviceSignInAsync(app, "public-bearer@example.com");
        var web = await WebSignInAsync(app, "public-bearer@example.com");
        var revoked = await DeviceSignInAsync(app, "public-bearer@example.com");
        using (var signOut = await app.Client.PostAsJsonAsync(
                   "/api/auth/device-sessions/sign-out", new { refreshToken = revoked.Credential }))
            Assert.Equal(HttpStatusCode.NoContent, signOut.StatusCode);
        await AssertBearerRejectedAsync(app, revoked.Token);

        // The web client attaches its (now stale) bearer to the public auth calls too.
        using var refresh = new HttpRequestMessage(HttpMethod.Post, "/api/auth/web-session/refresh");
        refresh.Headers.Add("Origin", Origin);
        refresh.Headers.Add("X-Ordo-Web-Session", "1");
        refresh.Headers.Add("Cookie", $"{WebCookie}={web.Credential}");
        refresh.Headers.Authorization = new AuthenticationHeaderValue("Bearer", revoked.Token);
        using var refreshed = await app.Client.SendAsync(refresh);
        Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode);

        using var signIn = new HttpRequestMessage(HttpMethod.Post, "/api/auth/device-sessions")
        {
            Content = JsonContent.Create(new { email = "public-bearer@example.com", password = Password })
        };
        signIn.Headers.Authorization = new AuthenticationHeaderValue("Bearer", revoked.Token);
        using var signedIn = await app.Client.SendAsync(signIn);
        Assert.Equal(HttpStatusCode.OK, signedIn.StatusCode);

        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, native.Token));
    }

    // ---- Rejected token shapes -----------------------------------------------------

    [Fact]
    public async Task Tokens_without_a_valid_session_or_stamp_binding_are_rejected()
    {
        await using var app = await TestApplication.StartAsync();
        var owner = await app.CreateUserAsync("shapes-owner@example.com", confirmed: true);
        await app.CreateUserAsync("shapes-other@example.com", confirmed: true);
        var otherSession = await DeviceSignInAsync(app, "shapes-other@example.com");
        var ownerSession = await DeviceSignInAsync(app, "shapes-owner@example.com");
        var protector = app.Services.GetRequiredService<AccessTokenSessionIdProtector>();
        var ownerSessionId = Assert.Single(
            await app.GetDeviceSessionsAsync(), row => row.OwnerId == owner.Id).Id;
        var currentStamp = AccessTokenClaims.StampHashValue((await app.FindUserByIdAsync(owner.Id))!.SecurityStamp);
        var otherSid = SidOf(otherSession.Token);
        var tampered = Tamper(SidOf(ownerSession.Token));
        var foreignPurpose = WebEncoders.Base64UrlEncode(
            app.Services.GetRequiredService<IDataProtectionProvider>()
                .CreateProtector("some other purpose").Protect(ownerSessionId.ToByteArray()));

        var cases = new (string Name, Claim[] Binding)[]
        {
            ("no binding claim (pre-#337 token)", []),
            ("both claims", [new Claim("sid", SidOf(ownerSession.Token)), new Claim("ordo_stamp", currentStamp)]),
            ("two sid claims", [new Claim("sid", SidOf(ownerSession.Token)), new Claim("sid", SidOf(ownerSession.Token))]),
            ("bare session id", [new Claim("sid", ownerSessionId.ToString("N"))]),
            ("bare session id, dashed", [new Claim("sid", ownerSessionId.ToString())]),
            ("bare session id, base64url", [new Claim("sid", WebEncoders.Base64UrlEncode(ownerSessionId.ToByteArray()))]),
            ("not base64", [new Claim("sid", "not base64 !!")]),
            ("empty sid", [new Claim("sid", "")]),
            ("tampered protected sid", [new Claim("sid", tampered)]),
            ("sid protected for another purpose", [new Claim("sid", foreignPurpose)]),
            ("another user's session id", [new Claim("sid", otherSid)]),
            ("unknown session id", [new Claim("sid", protector.Protect(Guid.NewGuid()))]),
            ("empty session id", [new Claim("sid", protector.Protect(Guid.Empty))]),
            ("wrong stamp hash", [new Claim("ordo_stamp", AccessTokenClaims.StampHashValue("another stamp"))]),
            ("raw stamp, not hashed", [new Claim("ordo_stamp", (await app.FindUserByIdAsync(owner.Id))!.SecurityStamp!)]),
            ("empty stamp claim", [new Claim("ordo_stamp", "")]),
        };

        foreach (var (name, binding) in cases)
        {
            var token = Sign(owner, binding);
            var status = await GetAsync(app, token);
            Assert.True(status == HttpStatusCode.Unauthorized, $"{name}: expected 401, got {(int)status}");
        }

        // Controls: the same hand-signed shape is accepted with a good binding.
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, Sign(owner, [new Claim("sid", protector.Protect(ownerSessionId))])));
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, Sign(owner, [new Claim("ordo_stamp", currentStamp)])));
    }

    [Fact]
    public async Task A_token_for_a_deleted_user_is_rejected()
    {
        await using var app = await TestApplication.StartAsync();
        var user = await app.CreateUserAsync("deleted-user@example.com", confirmed: true);
        var session = await DeviceSignInAsync(app, "deleted-user@example.com");
        var login = await LoginAsync(app, "deleted-user@example.com");

        using (var scope = app.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            Assert.True((await users.DeleteAsync((await users.FindByIdAsync(user.Id))!)).Succeeded);
        }

        await AssertBearerRejectedAsync(app, session.Token);
        await AssertBearerRejectedAsync(app, login);
    }

    [Fact]
    public async Task Rejection_is_the_normal_bearer_401_and_no_handler_runs()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("no-handler@example.com", confirmed: true);
        var session = await DeviceSignInAsync(app, "no-handler@example.com");
        var expense = new { description = "should not exist", amount = 1m, date = "2026-08-15", category = "food" };

        using (var ok = await PostAsync(app, "/api/expenses", expense, session.Token))
            Assert.True(ok.IsSuccessStatusCode, $"control create failed with {(int)ok.StatusCode}");
        Assert.Equal(1, await CountExpensesAsync(app));

        using var signOut = await app.Client.PostAsJsonAsync(
            "/api/auth/device-sessions/sign-out", new { refreshToken = session.Credential });
        Assert.Equal(HttpStatusCode.NoContent, signOut.StatusCode);

        using var rejected = await PostAsync(app, "/api/expenses", expense, session.Token);
        Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);
        var challenge = Assert.Single(rejected.Headers.WwwAuthenticate);
        Assert.Equal("Bearer", challenge.Scheme);
        Assert.Contains("error=\"invalid_token\"", challenge.Parameter);
        Assert.DoesNotContain(SidOf(session.Token), challenge.Parameter);
        Assert.Equal(1, await CountExpensesAsync(app));
    }

    // ---- Failure handling ----------------------------------------------------------

    [Fact]
    public async Task A_failing_check_is_a_safe_500_not_a_401_and_logs_no_token()
    {
        var logs = new CapturingLoggerProvider();
        await using var app = await TestApplication.StartAsync(
            loggerProvider: logs,
            configureServices: services =>
            {
                services.RemoveAll<IDeviceSessionService>();
                services.AddScoped<IDeviceSessionService, ThrowingDeviceSessionService>();
            });
        await app.CreateUserAsync("db-error@example.com", confirmed: true);
        var token = await LoginAsync(app, "db-error@example.com");

        using var response = await app.Client.SendAsync(Authorized(HttpMethod.Get, Protected, token));

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("internal_error", body);
        Assert.DoesNotContain(token, body);

        var signature = token.Split('.')[2];
        foreach (var text in logs.Messages)
        {
            Assert.DoesNotContain(token, text);
            Assert.DoesNotContain(signature, text);
        }
    }

    [Fact]
    public void Protector_round_trips_and_rejects_everything_else()
    {
        var provider = new EphemeralDataProtectionProvider();
        var protector = new AccessTokenSessionIdProtector(provider);
        var other = new AccessTokenSessionIdProtector(new EphemeralDataProtectionProvider());
        var id = Guid.NewGuid();
        var value = protector.Protect(id);

        Assert.True(protector.TryUnprotect(value, out var roundTripped));
        Assert.Equal(id, roundTripped);
        Assert.DoesNotContain(id.ToString("N"), value);
        Assert.False(other.TryUnprotect(value, out _));
        Assert.False(protector.TryUnprotect(Tamper(value), out _));
        Assert.False(protector.TryUnprotect(null, out _));
        Assert.False(protector.TryUnprotect("", out _));
        Assert.False(protector.TryUnprotect(id.ToString("N"), out _));
        Assert.False(protector.TryUnprotect("%%%", out _));
    }

    [Fact]
    public void Protector_does_not_hide_a_failure_to_read_the_key_ring()
    {
        var protector = new AccessTokenSessionIdProtector(new FaultyProvider(
            new CryptographicException("wrapped", new InvalidOperationException("database is down"))));
        var invalid = new AccessTokenSessionIdProtector(new FaultyProvider(
            new CryptographicException("The payload was invalid.")));
        var value = WebEncoders.Base64UrlEncode(new byte[40]);

        Assert.Throws<CryptographicException>(() => protector.TryUnprotect(value, out _));
        Assert.False(invalid.TryUnprotect(value, out _));
    }

    // ---- Helpers -------------------------------------------------------------------

    private sealed record Issued(string Token, string Credential);

    private static async Task<Issued> DeviceSignInAsync(TestApplication app, string email)
    {
        using var response = await app.Client.PostAsJsonAsync(
            "/api/auth/device-sessions", new { email, password = Password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return new Issued(body.GetProperty("token").GetString()!, body.GetProperty("refreshToken").GetString()!);
    }

    private static async Task<Issued> DeviceRefreshAsync(TestApplication app, string credential)
    {
        using var response = await app.Client.PostAsJsonAsync(
            "/api/auth/device-sessions/refresh", new { refreshToken = credential });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return new Issued(body.GetProperty("token").GetString()!, body.GetProperty("refreshToken").GetString()!);
    }

    private static async Task<Issued> WebSignInAsync(TestApplication app, string email, string? existingCookie = null)
    {
        using var response = await SendWebAsync(
            app, "/api/auth/web-session",
            JsonSerializer.Serialize(new { email, password = Password }), existingCookie);
        return await WebIssuedAsync(response);
    }

    private static async Task<Issued> WebRefreshAsync(TestApplication app, string cookie)
    {
        using var response = await SendWebAsync(app, "/api/auth/web-session/refresh", json: null, cookie);
        return await WebIssuedAsync(response);
    }

    private static async Task<Issued> WebIssuedAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var line = response.Headers.GetValues("Set-Cookie")
            .Single(value => value.StartsWith(WebCookie + "=", StringComparison.Ordinal));
        return new Issued(
            body.GetProperty("token").GetString()!,
            line.Split(';')[0][(WebCookie.Length + 1)..]);
    }

    private static async Task<string> LoginAsync(TestApplication app, string email)
    {
        using var response = await app.Client.PostAsJsonAsync("/api/auth/login", new { email, password = Password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
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

    private static HttpRequestMessage Authorized(HttpMethod method, string route, string token)
    {
        var request = new HttpRequestMessage(method, route);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return request;
    }

    private static async Task<HttpStatusCode> GetAsync(TestApplication app, string token)
    {
        using var response = await app.Client.SendAsync(Authorized(HttpMethod.Get, Protected, token));
        return response.StatusCode;
    }

    private static Task<HttpResponseMessage> PostAsync(TestApplication app, string route, object body, string token)
    {
        var request = Authorized(HttpMethod.Post, route, token);
        request.Content = JsonContent.Create(body);
        return app.Client.SendAsync(request);
    }

    private static async Task AssertBearerRejectedAsync(TestApplication app, string token)
    {
        using var response = await app.Client.SendAsync(Authorized(HttpMethod.Get, Protected, token));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains(response.Headers.WwwAuthenticate, challenge =>
            challenge.Scheme == "Bearer" && challenge.Parameter!.Contains("error=\"invalid_token\""));
    }

    private static async Task AssertProtectedSessionClaimAsync(TestApplication app, Issued session)
    {
        var token = new JwtSecurityTokenHandler().ReadJwtToken(session.Token);
        Assert.DoesNotContain(token.Claims, claim => claim.Type == AccessTokenClaims.StampHash);
        var sid = Assert.Single(token.Claims, claim => claim.Type == AccessTokenClaims.SessionId).Value;
        var row = Assert.Single(await app.GetDeviceSessionsAsync());

        Assert.True(app.Services.GetRequiredService<AccessTokenSessionIdProtector>().TryUnprotect(sid, out var unprotected));
        Assert.Equal(row.Id, unprotected);

        // The raw session id never appears in the JWT, in any common encoding.
        var payload = PayloadOf(session.Token);
        Assert.DoesNotContain(row.Id.ToString(), payload, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(row.Id.ToString("N"), payload, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(WebEncoders.Base64UrlEncode(row.Id.ToByteArray()), payload);
        Assert.DoesNotContain(session.Credential.Split('.')[0], payload);
        Assert.Equal(HttpStatusCode.OK, await GetAsync(app, session.Token));
    }

    private static string PayloadOf(string jwt) =>
        Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(jwt.Split('.')[1]));

    private static string SidOf(string jwt) =>
        new JwtSecurityTokenHandler().ReadJwtToken(jwt).Claims
            .Single(claim => claim.Type == AccessTokenClaims.SessionId).Value;

    private static string Tamper(string value)
    {
        var bytes = WebEncoders.Base64UrlDecode(value);
        bytes[^1] ^= 0x01;
        return WebEncoders.Base64UrlEncode(bytes);
    }

    private static string Sign(ApplicationUser user, params Claim[] binding)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id),
            new(ClaimTypes.Email, user.Email!),
            new(ClaimTypes.Name, user.UserName!)
        };
        claims.AddRange(binding);
        return new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
            issuer: AccessTokenClaims.Issuer,
            audience: AccessTokenClaims.Audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(60),
            signingCredentials: new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TestKey)),
                SecurityAlgorithms.HmacSha256)));
    }

    private static async Task<string> ResetTokenAsync(TestApplication app, string userId)
    {
        using var scope = app.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var token = await users.GeneratePasswordResetTokenAsync((await users.FindByIdAsync(userId))!);
        return WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));
    }

    private static async Task<int> CountExpensesAsync(TestApplication app)
    {
        using var scope = app.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<BudgetContext>().Expenses.CountAsync();
    }

    private sealed class ThrowingDeviceSessionService : IDeviceSessionService
    {
        private static InvalidOperationException Outage() => new("Simulated database outage.");

        public Task<DeviceSessionCreated> CreateAsync(string userId, string? securityStamp, CancellationToken cancellationToken) =>
            throw Outage();

        public Task<DeviceSessionIssue?> RefreshAsync(string credential, CancellationToken cancellationToken) =>
            throw Outage();

        public Task SignOutAsync(string credential, CancellationToken cancellationToken) => throw Outage();

        public Task RevokeAllAsync(string userId, CancellationToken cancellationToken) => throw Outage();

        public Task<bool> IsAccessTokenCurrentAsync(
            string userId, Guid? sessionId, string? stampClaim, CancellationToken cancellationToken) =>
            throw Outage();
    }

    private sealed class FaultyProvider(CryptographicException failure) : IDataProtectionProvider
    {
        public IDataProtector CreateProtector(string purpose) => new Faulty(failure);

        private sealed class Faulty(CryptographicException failure) : IDataProtector
        {
            public IDataProtector CreateProtector(string purpose) => this;
            public byte[] Protect(byte[] plaintext) => throw failure;
            public byte[] Unprotect(byte[] protectedData) => throw failure;
        }
    }
}
