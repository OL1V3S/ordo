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
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

/// <summary>
/// Pins the exact web login responses so the device-session work (#252) cannot
/// change them accidentally. These tests describe behavior that existed before
/// device sessions and must keep passing unchanged.
/// </summary>
public sealed class LoginCharacterizationTests
{
    private const string Password = "Password1!";

    [Fact]
    public async Task Unknown_email_returns_401_with_plain_invalid_credentials_text()
    {
        await using var app = await TestApplication.StartAsync();

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email = "nobody@example.com", password = Password });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("Invalid email or password", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Wrong_password_returns_the_same_401_body_as_an_unknown_email()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("wrong-password@example.com", confirmed: true);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email = "wrong-password@example.com", password = "Wrong-password1!" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("Invalid email or password", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Unconfirmed_account_with_the_right_password_returns_the_confirmation_text()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("unconfirmed-login@example.com", confirmed: false);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email = "unconfirmed-login@example.com", password = Password });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(
            "Please confirm your email before logging in.",
            await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Success_returns_only_token_and_email_and_creates_no_device_session()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("login-shape@example.com", confirmed: true);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email = "login-shape@example.com", password = Password });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(
            new[] { "email", "token" },
            body.EnumerateObject().Select(property => property.Name).OrderBy(name => name));
        Assert.Equal("login-shape@example.com", body.GetProperty("email").GetString());
        Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("token").GetString()));
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
    }
}

public sealed class DeviceSessionFlowTests
{
    private const string Password = "Password1!";
    private const string Create = "/api/auth/device-sessions";
    private const string Refresh = "/api/auth/device-sessions/refresh";
    private const string SignOut = "/api/auth/device-sessions/sign-out";
    private static readonly DateTimeOffset Start = new(2026, 10, 16, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Create_returns_a_working_access_token_and_a_hashed_stored_credential()
    {
        await using var app = await TestApplication.StartAsync(timeProvider: new TestClock(Start));
        var user = await app.CreateUserAsync("create@example.com", confirmed: true);

        var response = await app.Client.PostAsJsonAsync(
            Create, new { email = "create@example.com", password = Password });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(
            new[] { "email", "refreshToken", "token" },
            body.EnumerateObject().Select(property => property.Name).OrderBy(name => name));
        Assert.Equal("create@example.com", body.GetProperty("email").GetString());
        var credential = body.GetProperty("refreshToken").GetString()!;
        Assert.True(DeviceSessionCredential.TryParse(credential, out var sessionId, out var secret));
        Assert.Equal(user.Id, UserIdOf(body.GetProperty("token").GetString()!));

        using var protectedRequest = new HttpRequestMessage(HttpMethod.Get, "/api/expenses");
        protectedRequest.Headers.Authorization =
            new AuthenticationHeaderValue("Bearer", body.GetProperty("token").GetString());
        using var protectedResponse = await app.Client.SendAsync(protectedRequest);
        Assert.Equal(HttpStatusCode.OK, protectedResponse.StatusCode);

        var stored = Assert.Single(await app.GetDeviceSessionsAsync());
        Assert.Equal(sessionId, stored.Id);
        Assert.Equal(user.Id, stored.OwnerId);
        Assert.Equal(SHA256.HashData(secret), stored.SecretHash);
        Assert.Equal(
            SHA256.HashData(Encoding.UTF8.GetBytes(user.SecurityStamp!)),
            stored.SecurityStampHash);
        Assert.NotEqual(secret, stored.SecretHash);
        Assert.Equal(Start.UtcDateTime, stored.CreatedAt);
        Assert.Equal(Start.UtcDateTime, stored.LastUsedAt);
        Assert.Equal(Start.UtcDateTime.AddDays(180), stored.AbsoluteExpiresAt);
        Assert.DoesNotContain(
            credential,
            JsonSerializer.Serialize(new
            {
                stored.Id,
                stored.OwnerId,
                SecretHash = Convert.ToBase64String(stored.SecretHash),
                SecurityStampHash = Convert.ToBase64String(stored.SecurityStampHash)
            }),
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task Unknown_email_and_wrong_password_return_identical_bodies()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("identical@example.com", confirmed: true);

        var unknown = await app.Client.PostAsJsonAsync(
            Create, new { email = "nobody@example.com", password = Password });
        var wrong = await app.Client.PostAsJsonAsync(
            Create, new { email = "identical@example.com", password = "Wrong-password1!" });

        Assert.Equal(HttpStatusCode.Unauthorized, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        var unknownBody = await unknown.Content.ReadAsStringAsync();
        Assert.Equal(unknownBody, await wrong.Content.ReadAsStringAsync());
        Assert.Equal("invalid_credentials", JsonDocument.Parse(unknownBody).RootElement.GetProperty("code").GetString());
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
    }

    [Fact]
    public async Task Unconfirmed_account_is_told_so_only_after_a_valid_password()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("unconfirmed-device@example.com", confirmed: false);

        var wrong = await app.Client.PostAsJsonAsync(
            Create, new { email = "unconfirmed-device@example.com", password = "Wrong-password1!" });
        var right = await app.Client.PostAsJsonAsync(
            Create, new { email = "unconfirmed-device@example.com", password = Password });

        Assert.Equal("invalid_credentials", await CodeAsync(wrong));
        Assert.Equal(HttpStatusCode.Unauthorized, right.StatusCode);
        Assert.Equal("email_not_confirmed", await CodeAsync(right));
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"email\":\"a@example.com\"}")]
    [InlineData("{\"password\":\"Password1!\"}")]
    [InlineData("{\"email\":\"\",\"password\":\"Password1!\"}")]
    [InlineData("{\"email\":\"a@example.com\",\"password\":\"\"}")]
    public async Task Create_rejects_missing_fields_with_400(string json)
    {
        await using var app = await TestApplication.StartAsync();

        var response = await app.Client.PostAsync(
            Create, new StringContent(json, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
    }

    [Fact]
    public async Task Create_rejects_an_oversized_email_with_400()
    {
        await using var app = await TestApplication.StartAsync();

        var response = await app.Client.PostAsJsonAsync(
            Create, new { email = new string('a', 250) + "@example.com", password = Password });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Refresh_rotates_the_credential_and_keeps_the_same_owner()
    {
        await using var app = await TestApplication.StartAsync(timeProvider: new TestClock(Start));
        var user = await app.CreateUserAsync("refresh@example.com", confirmed: true);
        var first = await CreateSessionAsync(app, "refresh@example.com");

        var response = await app.Client.PostAsJsonAsync(Refresh, new { refreshToken = first.Credential });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString());
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(
            new[] { "email", "refreshToken", "token" },
            body.EnumerateObject().Select(property => property.Name).OrderBy(name => name));
        var second = body.GetProperty("refreshToken").GetString()!;
        Assert.NotEqual(first.Credential, second);
        Assert.Equal(user.Id, UserIdOf(body.GetProperty("token").GetString()!));
        Assert.Equal("refresh@example.com", body.GetProperty("email").GetString());
        var stored = Assert.Single(await app.GetDeviceSessionsAsync());
        Assert.True(DeviceSessionCredential.TryParse(second, out _, out var secret));
        Assert.Equal(SHA256.HashData(secret), stored.SecretHash);
    }

    [Fact]
    public async Task Reusing_a_rotated_credential_ends_the_whole_session()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("reuse@example.com", confirmed: true);
        var first = await CreateSessionAsync(app, "reuse@example.com");
        var second = await RefreshAsync(app, first.Credential);

        var reuse = await app.Client.PostAsJsonAsync(Refresh, new { refreshToken = first.Credential });
        var current = await app.Client.PostAsJsonAsync(Refresh, new { refreshToken = second });

        Assert.Equal(HttpStatusCode.Unauthorized, reuse.StatusCode);
        Assert.Equal("session_invalid", await CodeAsync(reuse));
        Assert.Equal(HttpStatusCode.Unauthorized, current.StatusCode);
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
    }

    [Fact]
    public async Task Presenting_a_credential_older_than_the_previous_one_also_ends_the_session()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("older@example.com", confirmed: true);
        var first = await CreateSessionAsync(app, "older@example.com");
        var second = await RefreshAsync(app, first.Credential);
        var third = await RefreshAsync(app, second);

        var oldest = await app.Client.PostAsJsonAsync(Refresh, new { refreshToken = first.Credential });
        var newest = await app.Client.PostAsJsonAsync(Refresh, new { refreshToken = third });

        Assert.Equal(HttpStatusCode.Unauthorized, oldest.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, newest.StatusCode);
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
    }

    [Fact]
    public async Task Idle_expiry_counts_from_the_last_refresh_and_deletes_the_row()
    {
        var clock = new TestClock(Start);
        await using var app = await TestApplication.StartAsync(timeProvider: clock);
        await app.CreateUserAsync("idle@example.com", confirmed: true);
        var first = await CreateSessionAsync(app, "idle@example.com");

        clock.Advance(TimeSpan.FromDays(60) - TimeSpan.FromSeconds(1));
        var second = await RefreshAsync(app, first.Credential);
        var stored = Assert.Single(await app.GetDeviceSessionsAsync());
        Assert.Equal(clock.GetUtcNow().UtcDateTime, stored.LastUsedAt);

        clock.Advance(TimeSpan.FromDays(60) - TimeSpan.FromSeconds(1));
        var third = await RefreshAsync(app, second);

        clock.Advance(TimeSpan.FromDays(60));
        var expired = await app.Client.PostAsJsonAsync(Refresh, new { refreshToken = third });

        Assert.Equal(HttpStatusCode.Unauthorized, expired.StatusCode);
        Assert.Equal("session_invalid", await CodeAsync(expired));
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
    }

    [Fact]
    public async Task A_session_that_was_never_refreshed_expires_exactly_at_the_idle_limit()
    {
        var clock = new TestClock(Start);
        await using var app = await TestApplication.StartAsync(timeProvider: clock);
        await app.CreateUserAsync("idle-exact@example.com", confirmed: true);
        var first = await CreateSessionAsync(app, "idle-exact@example.com");

        clock.Advance(TimeSpan.FromDays(60));
        var response = await app.Client.PostAsJsonAsync(Refresh, new { refreshToken = first.Credential });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
    }

    [Fact]
    public async Task Absolute_lifetime_is_never_extended_by_refreshing()
    {
        var clock = new TestClock(Start);
        await using var app = await TestApplication.StartAsync(timeProvider: clock);
        await app.CreateUserAsync("absolute@example.com", confirmed: true);
        var credential = (await CreateSessionAsync(app, "absolute@example.com")).Credential;
        var absolute = Assert.Single(await app.GetDeviceSessionsAsync()).AbsoluteExpiresAt;

        for (var day = 30; day < 180; day += 30)
        {
            clock.Advance(TimeSpan.FromDays(30));
            credential = await RefreshAsync(app, credential);
            Assert.Equal(absolute, Assert.Single(await app.GetDeviceSessionsAsync()).AbsoluteExpiresAt);
        }

        clock.Advance(TimeSpan.FromDays(30));
        var response = await app.Client.PostAsJsonAsync(Refresh, new { refreshToken = credential });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
    }

    [Fact]
    public async Task Sign_out_ends_only_the_named_session()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("signout@example.com", confirmed: true);
        await app.CreateUserAsync("signout-other@example.com", confirmed: true);
        var phone = await CreateSessionAsync(app, "signout@example.com");
        var tablet = await CreateSessionAsync(app, "signout@example.com");
        var stranger = await CreateSessionAsync(app, "signout-other@example.com");

        var response = await app.Client.PostAsJsonAsync(SignOut, new { refreshToken = phone.Credential });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var afterSignOut = await app.Client.PostAsJsonAsync(Refresh, new { refreshToken = phone.Credential });
        Assert.Equal(HttpStatusCode.Unauthorized, afterSignOut.StatusCode);
        await RefreshAsync(app, tablet.Credential);
        await RefreshAsync(app, stranger.Credential);
        Assert.Equal(2, await app.CountDeviceSessionsAsync());
    }

    [Fact]
    public async Task Sign_out_is_idempotent_and_reveals_nothing_for_garbage()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("signout-garbage@example.com", confirmed: true);
        var session = await CreateSessionAsync(app, "signout-garbage@example.com");
        var unknown = DeviceSessionCredential.Format(Guid.NewGuid(), DeviceSessionCredential.NewSecret());

        foreach (var credential in new[] { session.Credential, session.Credential, unknown, "garbage", "a.b" })
        {
            var response = await app.Client.PostAsJsonAsync(SignOut, new { refreshToken = credential });
            Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
            Assert.Equal(0, response.Content.Headers.ContentLength ?? 0);
        }

        Assert.Equal(0, await app.CountDeviceSessionsAsync());
    }

    [Fact]
    public async Task Sign_out_with_a_rotated_credential_still_ends_the_session()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("signout-stale@example.com", confirmed: true);
        var first = await CreateSessionAsync(app, "signout-stale@example.com");
        await RefreshAsync(app, first.Credential);

        var response = await app.Client.PostAsJsonAsync(SignOut, new { refreshToken = first.Credential });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"refreshToken\":\"\"}")]
    public async Task Refresh_and_sign_out_reject_a_missing_credential_with_400(string json)
    {
        await using var app = await TestApplication.StartAsync();

        foreach (var route in new[] { Refresh, SignOut })
        {
            var response = await app.Client.PostAsync(
                route, new StringContent(json, Encoding.UTF8, "application/json"));
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
    }

    [Fact]
    public async Task Refresh_and_sign_out_reject_an_oversized_credential_with_400()
    {
        await using var app = await TestApplication.StartAsync();
        var oversized = new string('A', 257);

        foreach (var route in new[] { Refresh, SignOut })
        {
            var response = await app.Client.PostAsJsonAsync(route, new { refreshToken = oversized });
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
    }

    [Fact]
    public async Task Password_reset_ends_every_session_of_that_user_only()
    {
        await using var app = await TestApplication.StartAsync();
        var user = await app.CreateUserAsync("reset@example.com", confirmed: true);
        await app.CreateUserAsync("reset-other@example.com", confirmed: true);
        var phone = await CreateSessionAsync(app, "reset@example.com");
        var tablet = await CreateSessionAsync(app, "reset@example.com");
        var stranger = await CreateSessionAsync(app, "reset-other@example.com");
        var token = await ResetTokenAsync(app, user.Id);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/reset-password",
            new { email = "reset@example.com", token, newPassword = "New-password1!" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(
            "{\"message\":\"Password reset successfully\"}",
            await response.Content.ReadAsStringAsync());
        Assert.Equal(0, await app.CountDeviceSessionsAsync(user.Id));
        foreach (var gone in new[] { phone, tablet })
        {
            var refreshed = await app.Client.PostAsJsonAsync(Refresh, new { refreshToken = gone.Credential });
            Assert.Equal(HttpStatusCode.Unauthorized, refreshed.StatusCode);
        }
        await RefreshAsync(app, stranger.Credential);
    }

    [Fact]
    public async Task A_changed_security_stamp_ends_the_session_on_the_next_refresh()
    {
        await using var app = await TestApplication.StartAsync();
        var user = await app.CreateUserAsync("stamp@example.com", confirmed: true);
        var session = await CreateSessionAsync(app, "stamp@example.com");
        using (var scope = app.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var tracked = await users.FindByIdAsync(user.Id);
            Assert.True((await users.UpdateSecurityStampAsync(tracked!)).Succeeded);
        }

        var response = await app.Client.PostAsJsonAsync(Refresh, new { refreshToken = session.Credential });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("session_invalid", await CodeAsync(response));
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
    }

    [Fact]
    public async Task A_deleted_user_cannot_refresh()
    {
        await using var app = await TestApplication.StartAsync();
        var user = await app.CreateUserAsync("deleted@example.com", confirmed: true);
        var session = await CreateSessionAsync(app, "deleted@example.com");
        using (var scope = app.Services.CreateScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            context.Users.Remove(context.Users.Single(candidate => candidate.Id == user.Id));
            await context.SaveChangesAsync();
        }

        var response = await app.Client.PostAsJsonAsync(Refresh, new { refreshToken = session.Credential });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
    }

    [Fact]
    public async Task Each_credential_only_ever_produces_its_own_accounts_tokens()
    {
        await using var app = await TestApplication.StartAsync();
        var alice = await app.CreateUserAsync("alice@example.com", confirmed: true);
        var bob = await app.CreateUserAsync("bob@example.com", confirmed: true);
        var aliceSession = await CreateSessionAsync(app, "alice@example.com");
        var bobSession = await CreateSessionAsync(app, "bob@example.com");

        var aliceRefresh = await RefreshBodyAsync(app, aliceSession.Credential);
        var bobRefresh = await RefreshBodyAsync(app, bobSession.Credential);

        Assert.Equal(alice.Id, UserIdOf(aliceRefresh.GetProperty("token").GetString()!));
        Assert.Equal(bob.Id, UserIdOf(bobRefresh.GetProperty("token").GetString()!));
        Assert.Equal("alice@example.com", aliceRefresh.GetProperty("email").GetString());
        Assert.Equal("bob@example.com", bobRefresh.GetProperty("email").GetString());

        await app.Client.PostAsJsonAsync(SignOut, new { refreshToken = aliceRefresh.GetProperty("refreshToken").GetString() });
        Assert.Equal(0, await app.CountDeviceSessionsAsync(alice.Id));
        Assert.Equal(1, await app.CountDeviceSessionsAsync(bob.Id));
        await RefreshAsync(app, bobRefresh.GetProperty("refreshToken").GetString()!);
    }

    [Fact]
    public async Task Malformed_and_unknown_credentials_return_session_invalid_without_leaking()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("malformed@example.com", confirmed: true);
        var real = await CreateSessionAsync(app, "malformed@example.com");
        var parts = real.Credential.Split('.');
        var unknownId = DeviceSessionCredential.Format(Guid.NewGuid(), DeviceSessionCredential.NewSecret());
        var wrongSecret = parts[0] + "." + WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));

        var attempts = new[]
        {
            "garbage", "a.b", ".", "!!!!.????", new string('A', 66), parts[0], parts[1] + "." + parts[0],
            real.Credential + "A", unknownId, wrongSecret
        };

        foreach (var attempt in attempts)
        {
            var response = await app.Client.PostAsJsonAsync(Refresh, new { refreshToken = attempt });
            var text = await response.Content.ReadAsStringAsync();
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            Assert.Equal("{\"code\":\"session_invalid\"}", text);
            Assert.DoesNotContain(attempt, text, StringComparison.Ordinal);
            Assert.DoesNotContain("malformed@example.com", text, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Logs_never_contain_credentials_secrets_or_emails()
    {
        var logs = new CapturingLoggerProvider();
        await using var app = await TestApplication.StartAsync(loggerProvider: logs);
        await app.CreateUserAsync("logging@example.com", confirmed: true);
        var created = await CreateSessionAsync(app, "logging@example.com");
        var rotated = await RefreshAsync(app, created.Credential);
        var attempts = new List<string> { created.Credential, rotated, "garbage" };

        await app.Client.PostAsJsonAsync(Refresh, new { refreshToken = created.Credential });
        await app.Client.PostAsJsonAsync(Refresh, new { refreshToken = "garbage" });
        await app.Client.PostAsJsonAsync(SignOut, new { refreshToken = rotated });
        await app.Client.PostAsJsonAsync(Create, new { email = "logging@example.com", password = "Wrong-password1!" });

        var secrets = attempts
            .Where(value => DeviceSessionCredential.TryParse(value, out _, out _))
            .Select(value => value.Split('.')[1])
            .ToList();
        Assert.NotEmpty(logs.Messages);
        foreach (var message in logs.Messages)
        {
            foreach (var attempt in attempts)
                Assert.DoesNotContain(attempt, message, StringComparison.Ordinal);
            foreach (var secret in secrets)
                Assert.DoesNotContain(secret, message, StringComparison.Ordinal);
            Assert.DoesNotContain("Password1!", message, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Per_account_cap_evicts_the_least_recently_used_session()
    {
        var clock = new TestClock(Start);
        await using var app = await TestApplication.StartAsync(
            timeProvider: clock, configureDeviceSessions: options => options.MaxSessionsPerAccount = 3);
        await app.CreateUserAsync("cap@example.com", confirmed: true);
        await app.CreateUserAsync("cap-other@example.com", confirmed: true);
        var other = await CreateSessionAsync(app, "cap-other@example.com");
        var first = await CreateSessionAsync(app, "cap@example.com");
        clock.Advance(TimeSpan.FromMinutes(1));
        var second = await CreateSessionAsync(app, "cap@example.com");
        clock.Advance(TimeSpan.FromMinutes(1));
        var third = await CreateSessionAsync(app, "cap@example.com");
        clock.Advance(TimeSpan.FromMinutes(1));
        var firstRefreshed = await RefreshAsync(app, first.Credential);
        clock.Advance(TimeSpan.FromMinutes(1));

        var fourth = await CreateSessionAsync(app, "cap@example.com");

        // "second" is now the least recently used (first was refreshed after it).
        var evicted = await app.Client.PostAsJsonAsync(Refresh, new { refreshToken = second.Credential });
        Assert.Equal(HttpStatusCode.Unauthorized, evicted.StatusCode);
        await RefreshAsync(app, firstRefreshed);
        await RefreshAsync(app, third.Credential);
        await RefreshAsync(app, fourth.Credential);
        await RefreshAsync(app, other.Credential);
        Assert.Equal(1, await app.CountDeviceSessionsAsync(other.UserId));
    }

    [Fact]
    public async Task Creating_a_session_deletes_at_most_one_batch_of_expired_rows_across_accounts()
    {
        var clock = new TestClock(Start);
        await using var app = await TestApplication.StartAsync(
            timeProvider: clock, configureDeviceSessions: options => options.ExpiredCleanupBatchSize = 100);
        var owner = await app.CreateUserAsync("cleanup@example.com", confirmed: true);
        var other = await app.CreateUserAsync("cleanup-other@example.com", confirmed: true);
        var live = await CreateSessionAsync(app, "cleanup-other@example.com");
        using (var scope = app.Services.CreateScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            var created = Start.UtcDateTime.AddDays(-200);
            for (var index = 0; index < 105; index++)
            {
                context.DeviceSessions.Add(new DeviceSession
                {
                    Id = Guid.NewGuid(),
                    OwnerId = index % 2 == 0 ? owner.Id : other.Id,
                    SecretHash = new byte[32],
                    SecurityStampHash = new byte[32],
                    CreatedAt = created,
                    LastUsedAt = created.AddMinutes(index),
                    AbsoluteExpiresAt = created.AddDays(180)
                });
            }
            await context.SaveChangesAsync();
        }

        await CreateSessionAsync(app, "cleanup@example.com");

        var remaining = await app.GetDeviceSessionsAsync();
        Assert.Equal(5, remaining.Count(value => value.AbsoluteExpiresAt <= Start.UtcDateTime));
        Assert.Equal(1, remaining.Count(value => value.OwnerId == owner.Id && value.AbsoluteExpiresAt > Start.UtcDateTime));
        Assert.Contains(remaining, value => value.AbsoluteExpiresAt > Start.UtcDateTime && value.OwnerId == other.Id);
        await RefreshAsync(app, live.Credential);
    }

    private static string UserIdOf(string accessToken) =>
        new JwtSecurityTokenHandler().ReadJwtToken(accessToken).Claims
            .Single(claim => claim.Type is ClaimTypes.NameIdentifier or "nameid").Value;

    private static async Task<string> CodeAsync(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString()!;

    private static async Task<CreatedSession> CreateSessionAsync(TestApplication app, string email)
    {
        var response = await app.Client.PostAsJsonAsync(Create, new { email, password = Password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var credential = body.GetProperty("refreshToken").GetString()!;
        return new CreatedSession(UserIdOf(body.GetProperty("token").GetString()!), credential);
    }

    private static async Task<JsonElement> RefreshBodyAsync(TestApplication app, string credential)
    {
        var response = await app.Client.PostAsJsonAsync(Refresh, new { refreshToken = credential });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<string> RefreshAsync(TestApplication app, string credential) =>
        (await RefreshBodyAsync(app, credential)).GetProperty("refreshToken").GetString()!;

    private static async Task<string> ResetTokenAsync(TestApplication app, string userId)
    {
        using var scope = app.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = await users.FindByIdAsync(userId);
        var token = await users.GeneratePasswordResetTokenAsync(user!);
        return WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));
    }

    private sealed record CreatedSession(string UserId, string Credential);
}
