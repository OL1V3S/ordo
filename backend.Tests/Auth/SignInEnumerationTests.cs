using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using BudgetPlanner.Authentication;
using BudgetPlanner.Models;
using BudgetPlanner.Services;
using BudgetPlanner.Tests.Financial;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

/// <summary>Shared request and assertion helpers for the #318 sign-in enumeration tests.</summary>
internal static class SignInEnumeration
{
    public const string Password = "Password1!";
    public const string WrongPassword = "Wrong-password1!";
    public const string Login = "/api/auth/login";
    public const string DeviceSession = "/api/auth/device-sessions";
    public const string WebSession = "/api/auth/web-session";
    public const string WebRefresh = "/api/auth/web-session/refresh";
    public const string Origin = "https://frontend.test";
    public const string CookieName = "__Secure-ordo-web-session";

    public static readonly string[] Endpoints = [Login, DeviceSession, WebSession];

    public sealed record RawResponse(HttpStatusCode Status, string? ContentType, byte[] Body, bool SetsCookie);

    public static async Task<RawResponse> SignInAsync(
        HttpClient client, string endpoint, string email, string password, string? cookie = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = new StringContent(JsonSerializer.Serialize(new { email, password }), Encoding.UTF8, "application/json")
        };
        if (endpoint == WebSession)
        {
            request.Headers.Add("Origin", Origin);
            request.Headers.Add("X-Ordo-Web-Session", "1");
        }
        if (cookie != null) request.Headers.Add("Cookie", $"{CookieName}={cookie}");

        using var response = await client.SendAsync(request);
        return await SnapshotAsync(response);
    }

    public static async Task<RawResponse> SnapshotAsync(HttpResponseMessage response) =>
        new(
            response.StatusCode,
            response.Content.Headers.ContentType?.ToString(),
            await response.Content.ReadAsByteArrayAsync(),
            response.Headers.Contains("Set-Cookie"));

    /// <summary>Signs in on the web session endpoint and returns the new cookie value.</summary>
    public static async Task<string> WebCookieAsync(HttpClient client, string email)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, WebSession)
        {
            Content = new StringContent(JsonSerializer.Serialize(new { email, password = Password }), Encoding.UTF8, "application/json")
        };
        request.Headers.Add("Origin", Origin);
        request.Headers.Add("X-Ordo-Web-Session", "1");
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var line = response.Headers.GetValues("Set-Cookie").Single(value => value.StartsWith(CookieName + "=", StringComparison.Ordinal));
        return line.Split(';')[0][(CookieName.Length + 1)..];
    }

    public static async Task<HttpStatusCode> RefreshWebAsync(HttpClient client, string cookie)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, WebRefresh);
        request.Headers.Add("Origin", Origin);
        request.Headers.Add("X-Ordo-Web-Session", "1");
        request.Headers.Add("Cookie", $"{CookieName}={cookie}");
        using var response = await client.SendAsync(request);
        return response.StatusCode;
    }

    /// <summary>Byte-equal status, content type and body; never a cookie or a token.</summary>
    public static void AssertSameFailure(RawResponse expected, RawResponse actual)
    {
        Assert.Equal(HttpStatusCode.Unauthorized, actual.Status);
        Assert.Equal(expected.Status, actual.Status);
        Assert.Equal(expected.ContentType, actual.ContentType);
        Assert.Equal(expected.Body, actual.Body);
        Assert.False(actual.SetsCookie);
        var text = Encoding.UTF8.GetString(actual.Body);
        Assert.DoesNotContain("token", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("confirm", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("@", text, StringComparison.Ordinal);
    }

    public static void AssertNoEmailAddressLogged(IEnumerable<string> messages)
    {
        Assert.DoesNotContain(messages, message => message.Contains("example.com", StringComparison.OrdinalIgnoreCase));
    }

    public static async Task SetLockoutEndAsync(IServiceProvider services, string email, DateTimeOffset end)
    {
        using var scope = services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = (await users.FindByEmailAsync(email))!;
        Assert.True((await users.SetLockoutEndDateAsync(user, end)).Succeeded);
    }

    public static async Task CreateUnconfirmedAsync(IServiceProvider services, string email)
    {
        using var scope = services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        Assert.True((await users.CreateAsync(new ApplicationUser { UserName = email, Email = email }, Password)).Succeeded);
    }

    public static async Task<ApplicationUser> FindAsync(IServiceProvider services, string email)
    {
        using var scope = services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        return (await users.FindByEmailAsync(email))!;
    }
}

/// <summary>
/// #318: sign-in never reveals that an account exists or is unconfirmed. An
/// unconfirmed account with the right password gets exactly the invalid-credentials
/// response on every endpoint (in-memory provider, Identity lockout path).
/// </summary>
public sealed class SignInEnumerationTests
{
    private const string Password = SignInEnumeration.Password;
    private const string WrongPassword = SignInEnumeration.WrongPassword;

    public static TheoryData<string> Endpoints => new(SignInEnumeration.Endpoints);

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Every_failure_returns_the_same_bytes_and_leaves_no_trace(string endpoint)
    {
        var logs = new CapturingLoggerProvider();
        var resend = new RecordingConfirmationResendLimiter(acquireGlobal: true);
        var forgot = new RecordingForgotPasswordLimiter(acquireGlobal: true);
        await using var app = await TestApplication.StartAsync(
            limiterOverride: resend, forgotPasswordLimiterOverride: forgot, loggerProvider: logs);
        await app.CreateUserAsync("known@example.com", confirmed: true);
        await app.CreateUserAsync("locked@example.com", confirmed: true);
        await app.CreateUserAsync("pending@example.com", confirmed: false);
        await app.CreateUserAsync("pending-locked@example.com", confirmed: false);
        await SignInEnumeration.SetLockoutEndAsync(app.Services, "locked@example.com", DateTimeOffset.UtcNow.AddMinutes(10));
        await SignInEnumeration.SetLockoutEndAsync(app.Services, "pending-locked@example.com", DateTimeOffset.UtcNow.AddMinutes(10));
        var logsBefore = logs.Messages.Count;

        var unknown = await SignInEnumeration.SignInAsync(app.Client, endpoint, "nobody@example.com", Password);
        var failures = new[]
        {
            await SignInEnumeration.SignInAsync(app.Client, endpoint, "known@example.com", WrongPassword),
            await SignInEnumeration.SignInAsync(app.Client, endpoint, "locked@example.com", Password),
            await SignInEnumeration.SignInAsync(app.Client, endpoint, "pending@example.com", Password),
            await SignInEnumeration.SignInAsync(app.Client, endpoint, "pending@example.com", WrongPassword),
            await SignInEnumeration.SignInAsync(app.Client, endpoint, "pending-locked@example.com", Password),
        };

        foreach (var failure in failures.Prepend(unknown))
            SignInEnumeration.AssertSameFailure(unknown, failure);
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
        Assert.Empty(app.EmailSender.Messages);
        Assert.Equal(0, resend.GlobalAttempts + resend.RecipientAttempts);
        Assert.Equal(0, forgot.GlobalAttempts + forgot.RecipientAttempts);
        SignInEnumeration.AssertNoEmailAddressLogged(logs.Messages.Skip(logsBefore));

        var confirmed = await SignInEnumeration.SignInAsync(app.Client, endpoint, "known@example.com", Password);
        Assert.Equal(HttpStatusCode.OK, confirmed.Status);
    }

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task The_right_password_on_an_unconfirmed_account_resets_the_count_with_the_same_response(string endpoint)
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("pending@example.com", confirmed: false);

        var wrong = await SignInEnumeration.SignInAsync(app.Client, endpoint, "pending@example.com", WrongPassword);
        for (var i = 0; i < 2; i++)
            await SignInEnumeration.SignInAsync(app.Client, endpoint, "pending@example.com", WrongPassword);
        Assert.Equal(3, (await app.FindUserByEmailAsync("pending@example.com"))!.AccessFailedCount);

        var right = await SignInEnumeration.SignInAsync(app.Client, endpoint, "pending@example.com", Password);

        SignInEnumeration.AssertSameFailure(wrong, right);
        Assert.Equal(0, (await app.FindUserByEmailAsync("pending@example.com"))!.AccessFailedCount);
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
    }

    [Fact]
    public async Task Web_session_failures_keep_an_existing_cookie_session()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("known@example.com", confirmed: true);
        await app.CreateUserAsync("pending@example.com", confirmed: false);
        var cookie = await SignInEnumeration.WebCookieAsync(app.Client, "known@example.com");

        var unknown = await SignInEnumeration.SignInAsync(app.Client, SignInEnumeration.WebSession, "nobody@example.com", Password, cookie);
        var wrong = await SignInEnumeration.SignInAsync(app.Client, SignInEnumeration.WebSession, "known@example.com", WrongPassword, cookie);
        var unconfirmed = await SignInEnumeration.SignInAsync(app.Client, SignInEnumeration.WebSession, "pending@example.com", Password, cookie);

        SignInEnumeration.AssertSameFailure(unknown, wrong);
        SignInEnumeration.AssertSameFailure(unknown, unconfirmed);
        Assert.Equal(1, await app.CountDeviceSessionsAsync());
        Assert.Equal(HttpStatusCode.OK, await SignInEnumeration.RefreshWebAsync(app.Client, cookie));
    }

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Registering_a_new_or_taken_address_then_signing_in_looks_the_same(string endpoint)
    {
        const string attackerPassword = "Attacker1!";
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("taken@example.com", confirmed: true);
        await app.CreateUserAsync("taken-pending@example.com", confirmed: false);

        async Task<SignInEnumeration.RawResponse> RegisterThenSignInAsync(string email)
        {
            var register = await app.Client.PostAsJsonAsync(
                "/api/auth/register", new { email, password = attackerPassword });
            Assert.Equal(HttpStatusCode.OK, register.StatusCode);
            return await SignInEnumeration.SignInAsync(app.Client, endpoint, email, attackerPassword);
        }

        var fresh = await RegisterThenSignInAsync("fresh@example.com");
        var taken = await RegisterThenSignInAsync("taken@example.com");
        var takenPending = await RegisterThenSignInAsync("taken-pending@example.com");

        SignInEnumeration.AssertSameFailure(fresh, taken);
        SignInEnumeration.AssertSameFailure(fresh, takenPending);
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
    }
}

/// <summary>#318 on PostgreSQL, where the atomic lockout reservation path runs.</summary>
[Collection("Environment variable tests")]
[Trait("Category", "PostgreSQL")]
public sealed class PostgreSqlSignInEnumerationTests
{
    private const string Password = SignInEnumeration.Password;
    private const string WrongPassword = SignInEnumeration.WrongPassword;

    [PostgreSqlFact]
    public async Task Every_failure_returns_the_same_bytes_and_leaves_no_trace_on_the_atomic_path()
    {
        await using var app = new RecordingApplication();
        using var known = await app.CreateAuthenticatedUserAsync("pg-known@example.com");
        using var locked = await app.CreateAuthenticatedUserAsync("pg-locked@example.com");
        await SignInEnumeration.CreateUnconfirmedAsync(app.Services, "pg-pending@example.com");
        await SignInEnumeration.CreateUnconfirmedAsync(app.Services, "pg-pending-locked@example.com");
        await SignInEnumeration.SetLockoutEndAsync(app.Services, "pg-locked@example.com", DateTimeOffset.UtcNow.AddMinutes(10));
        await SignInEnumeration.SetLockoutEndAsync(app.Services, "pg-pending-locked@example.com", DateTimeOffset.UtcNow.AddMinutes(10));
        var sessionsBefore = await CountSessionsAsync(app);
        var logsBefore = app.Logs.Messages.Count;
        using var client = app.CreateTestClient();

        foreach (var endpoint in SignInEnumeration.Endpoints)
        {
            var unknown = await SignInEnumeration.SignInAsync(client, endpoint, "pg-nobody@example.com", Password);
            var failures = new[]
            {
                await SignInEnumeration.SignInAsync(client, endpoint, "pg-known@example.com", WrongPassword),
                await SignInEnumeration.SignInAsync(client, endpoint, "pg-locked@example.com", Password),
                await SignInEnumeration.SignInAsync(client, endpoint, "pg-pending@example.com", Password),
                await SignInEnumeration.SignInAsync(client, endpoint, "pg-pending@example.com", WrongPassword),
                await SignInEnumeration.SignInAsync(client, endpoint, "pg-pending-locked@example.com", Password),
            };
            foreach (var failure in failures.Prepend(unknown))
                SignInEnumeration.AssertSameFailure(unknown, failure);
        }

        Assert.Equal(sessionsBefore, await CountSessionsAsync(app));
        Assert.Empty(app.Email.Messages);
        Assert.Equal(0, app.Resend.GlobalAttempts + app.Resend.RecipientAttempts);
        Assert.Equal(0, app.Forgot.GlobalAttempts + app.Forgot.RecipientAttempts);
        SignInEnumeration.AssertNoEmailAddressLogged(app.Logs.Messages.Skip(logsBefore));
        Assert.Equal(HttpStatusCode.OK,
            (await SignInEnumeration.SignInAsync(client, SignInEnumeration.DeviceSession, "pg-known@example.com", Password)).Status);
    }

    [PostgreSqlFact]
    public async Task The_right_password_on_an_unconfirmed_account_resets_the_count_with_the_same_response()
    {
        await using var app = new RecordingApplication();
        using var client = app.CreateTestClient();
        await SignInEnumeration.CreateUnconfirmedAsync(app.Services, "pg-reset@example.com");

        foreach (var endpoint in SignInEnumeration.Endpoints)
        {
            var wrong = await SignInEnumeration.SignInAsync(client, endpoint, "pg-reset@example.com", WrongPassword);
            await SignInEnumeration.SignInAsync(client, endpoint, "pg-reset@example.com", WrongPassword);
            Assert.Equal(2, (await SignInEnumeration.FindAsync(app.Services, "pg-reset@example.com")).AccessFailedCount);

            var right = await SignInEnumeration.SignInAsync(client, endpoint, "pg-reset@example.com", Password);

            SignInEnumeration.AssertSameFailure(wrong, right);
            Assert.Equal(0, (await SignInEnumeration.FindAsync(app.Services, "pg-reset@example.com")).AccessFailedCount);
        }

        Assert.Equal(0, await CountSessionsAsync(app));
    }

    [PostgreSqlFact]
    public async Task Web_session_failures_keep_an_existing_cookie_session_on_the_atomic_path()
    {
        await using var app = new RecordingApplication();
        using var known = await app.CreateAuthenticatedUserAsync("pg-web@example.com");
        await SignInEnumeration.CreateUnconfirmedAsync(app.Services, "pg-web-pending@example.com");
        using var client = app.CreateTestClient();
        var cookie = await SignInEnumeration.WebCookieAsync(client, "pg-web@example.com");
        var sessions = await CountSessionsAsync(app);

        var unknown = await SignInEnumeration.SignInAsync(client, SignInEnumeration.WebSession, "pg-nobody@example.com", Password, cookie);
        var wrong = await SignInEnumeration.SignInAsync(client, SignInEnumeration.WebSession, "pg-web@example.com", WrongPassword, cookie);
        var unconfirmed = await SignInEnumeration.SignInAsync(client, SignInEnumeration.WebSession, "pg-web-pending@example.com", Password, cookie);

        SignInEnumeration.AssertSameFailure(unknown, wrong);
        SignInEnumeration.AssertSameFailure(unknown, unconfirmed);
        Assert.Equal(sessions, await CountSessionsAsync(app));
        Assert.Equal(HttpStatusCode.OK, await SignInEnumeration.RefreshWebAsync(client, cookie));
    }

    private sealed class RecordingApplication : PostgreSqlFinancialApiTestApplication
    {
        public FakeEmailService Email { get; } = new(EmailFailureMode.None);
        public RecordingConfirmationResendLimiter Resend { get; } = new(acquireGlobal: true);
        public RecordingForgotPasswordLimiter Forgot { get; } = new(acquireGlobal: true);
        public CapturingLoggerProvider Logs { get; } = new();

        protected override void ConfigureAdditionalServices(IServiceCollection services)
        {
            services.RemoveAll<IEmailService>();
            services.AddSingleton<IEmailService>(Email);
            services.RemoveAll<IConfirmationResendLimiter>();
            services.AddSingleton<IConfirmationResendLimiter>(Resend);
            services.RemoveAll<IForgotPasswordLimiter>();
            services.AddSingleton<IForgotPasswordLimiter>(Forgot);
            services.AddSingleton<ILoggerProvider>(Logs);
        }
    }

    private static async Task<int> CountSessionsAsync(PostgreSqlFinancialApiTestApplication app)
    {
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetPlanner.Data.BudgetContext>();
        return context.DeviceSessions.Count();
    }
}
