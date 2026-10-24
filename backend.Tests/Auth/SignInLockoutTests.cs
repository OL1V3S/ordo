using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using BudgetPlanner.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

/// <summary>Account lockout on the three password sign-in endpoints (#299), in-memory provider.</summary>
public sealed class SignInLockoutTests
{
    private const string Password = "Password1!";
    private const string WrongPassword = "Wrong-password1!";
    private const string Login = "/api/auth/login";
    private const string DeviceSession = "/api/auth/device-sessions";
    private const string WebSession = "/api/auth/web-session";
    private const string Origin = "https://frontend.test";

    public static TheoryData<string> Endpoints => new() { Login, DeviceSession, WebSession };

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Four_failures_then_the_right_password_signs_in(string endpoint)
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("four@example.com", confirmed: true);

        for (var i = 0; i < 4; i++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await SignInAsync(app, endpoint, "four@example.com", WrongPassword)).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await SignInAsync(app, endpoint, "four@example.com", Password)).StatusCode);
        Assert.Equal(0, (await app.FindUserByEmailAsync("four@example.com"))!.AccessFailedCount);
    }

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Five_failures_lock_the_account_with_a_response_identical_to_a_wrong_password(string endpoint)
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("locked@example.com", confirmed: true);

        var wrong = await Snapshot(await SignInAsync(app, endpoint, "locked@example.com", WrongPassword));
        for (var i = 0; i < 4; i++)
            await SignInAsync(app, endpoint, "locked@example.com", WrongPassword);

        var stored = (await app.FindUserByEmailAsync("locked@example.com"))!;
        Assert.NotNull(stored.LockoutEnd);
        Assert.True(stored.LockoutEnd > DateTimeOffset.UtcNow.AddMinutes(9));

        var locked = await Snapshot(await SignInAsync(app, endpoint, "locked@example.com", Password));
        var lockedWrong = await Snapshot(await SignInAsync(app, endpoint, "locked@example.com", WrongPassword));
        var unknown = await Snapshot(await SignInAsync(app, endpoint, "nobody@example.com", Password));

        Assert.Equal(HttpStatusCode.Unauthorized, wrong.Status);
        Assert.Equal(wrong, locked);
        Assert.Equal(wrong, lockedWrong);
        Assert.Equal(wrong, unknown);
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
    }

    [Fact]
    public async Task An_expired_lockout_lets_the_right_password_sign_in_again()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("expired@example.com", confirmed: true);
        for (var i = 0; i < 5; i++)
            await SignInAsync(app, Login, "expired@example.com", WrongPassword);
        Assert.Equal(HttpStatusCode.Unauthorized, (await SignInAsync(app, Login, "expired@example.com", Password)).StatusCode);

        await SetLockoutEndAsync(app, "expired@example.com", DateTimeOffset.UtcNow.AddMinutes(-1));

        Assert.Equal(HttpStatusCode.OK, (await SignInAsync(app, Login, "expired@example.com", Password)).StatusCode);
    }

    [Fact]
    public async Task A_successful_sign_in_resets_the_failure_count()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("reset@example.com", confirmed: true);

        for (var i = 0; i < 4; i++)
            await SignInAsync(app, Login, "reset@example.com", WrongPassword);
        Assert.Equal(HttpStatusCode.OK, (await SignInAsync(app, Login, "reset@example.com", Password)).StatusCode);
        for (var i = 0; i < 4; i++)
            await SignInAsync(app, Login, "reset@example.com", WrongPassword);

        var stored = (await app.FindUserByEmailAsync("reset@example.com"))!;
        Assert.Equal(4, stored.AccessFailedCount);
        Assert.Null(stored.LockoutEnd);
        Assert.Equal(HttpStatusCode.OK, (await SignInAsync(app, Login, "reset@example.com", Password)).StatusCode);
    }

    [Fact]
    public async Task Failures_are_counted_across_all_three_endpoints()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("shared@example.com", confirmed: true);

        for (var i = 0; i < 3; i++)
            await SignInAsync(app, Login, "shared@example.com", WrongPassword);
        for (var i = 0; i < 2; i++)
            await SignInAsync(app, DeviceSession, "shared@example.com", WrongPassword);

        foreach (var endpoint in new[] { WebSession, Login, DeviceSession })
            Assert.Equal(HttpStatusCode.Unauthorized, (await SignInAsync(app, endpoint, "shared@example.com", Password)).StatusCode);
        Assert.Equal(0, await app.CountDeviceSessionsAsync());
    }

    [Theory]
    [InlineData(Login, "Please confirm your email before logging in.")]
    [InlineData(DeviceSession, "{\"code\":\"email_not_confirmed\"}")]
    [InlineData(WebSession, "Please confirm your email before logging in.")]
    public async Task An_unconfirmed_account_locks_and_only_reveals_confirmation_after_unlock(string endpoint, string confirmBody)
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("unconfirmed@example.com", confirmed: false);

        var wrong = await Snapshot(await SignInAsync(app, endpoint, "unconfirmed@example.com", WrongPassword));
        for (var i = 0; i < 4; i++)
            await SignInAsync(app, endpoint, "unconfirmed@example.com", WrongPassword);

        Assert.Equal(wrong, await Snapshot(await SignInAsync(app, endpoint, "unconfirmed@example.com", Password)));

        await SetLockoutEndAsync(app, "unconfirmed@example.com", DateTimeOffset.UtcNow.AddMinutes(-1));
        await SignInAsync(app, endpoint, "unconfirmed@example.com", WrongPassword);
        Assert.Equal(1, (await app.FindUserByEmailAsync("unconfirmed@example.com"))!.AccessFailedCount);

        var confirm = await SignInAsync(app, endpoint, "unconfirmed@example.com", Password);
        Assert.Equal(HttpStatusCode.Unauthorized, confirm.StatusCode);
        Assert.Equal(confirmBody, await confirm.Content.ReadAsStringAsync());
        Assert.Equal(0, (await app.FindUserByEmailAsync("unconfirmed@example.com"))!.AccessFailedCount);
    }

    [Fact]
    public async Task A_user_with_lockout_disabled_is_never_locked()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("nolock@example.com", confirmed: true);
        using (var scope = app.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = (await users.FindByEmailAsync("nolock@example.com"))!;
            Assert.True((await users.SetLockoutEnabledAsync(user, false)).Succeeded);
        }

        for (var i = 0; i < 12; i++)
            await SignInAsync(app, i % 2 == 0 ? Login : DeviceSession, "nolock@example.com", WrongPassword);

        var stored = (await app.FindUserByEmailAsync("nolock@example.com"))!;
        Assert.Null(stored.LockoutEnd);
        Assert.Equal(0, stored.AccessFailedCount);
        Assert.Equal(HttpStatusCode.OK, (await SignInAsync(app, Login, "nolock@example.com", Password)).StatusCode);
    }

    [Fact]
    public async Task Guard_rejected_web_sign_ins_do_not_count()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("guard@example.com", confirmed: true);

        for (var i = 0; i < 3; i++)
        {
            var badOrigin = await WebSignInAsync(app, "guard@example.com", WrongPassword, "https://evil.test", "1");
            var noHeader = await WebSignInAsync(app, "guard@example.com", WrongPassword, Origin, null);
            Assert.Equal(HttpStatusCode.Forbidden, badOrigin.StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, noHeader.StatusCode);
        }

        Assert.Equal(0, (await app.FindUserByEmailAsync("guard@example.com"))!.AccessFailedCount);
        Assert.Equal(HttpStatusCode.OK, (await SignInAsync(app, WebSession, "guard@example.com", Password)).StatusCode);
    }

    [Fact]
    public async Task Resetting_the_count_keeps_the_security_stamp_and_sessions_refresh()
    {
        await using var app = await TestApplication.StartAsync();
        var created = await app.CreateUserAsync("stamp@example.com", confirmed: true);
        var stampBefore = (await app.FindUserByIdAsync(created.Id))!.SecurityStamp;

        for (var i = 0; i < 2; i++)
            await SignInAsync(app, DeviceSession, "stamp@example.com", WrongPassword);
        var signIn = await SignInAsync(app, DeviceSession, "stamp@example.com", Password);
        Assert.Equal(HttpStatusCode.OK, signIn.StatusCode);
        var credential = (await signIn.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("refreshToken").GetString();

        var stored = (await app.FindUserByIdAsync(created.Id))!;
        Assert.Equal(stampBefore, stored.SecurityStamp);
        Assert.Equal(0, stored.AccessFailedCount);

        var refresh = await app.Client.PostAsJsonAsync("/api/auth/device-sessions/refresh", new { refreshToken = credential });
        Assert.Equal(HttpStatusCode.OK, refresh.StatusCode);
    }

    [Fact]
    public async Task Registered_users_have_lockout_enabled()
    {
        await using var app = await TestApplication.StartAsync();

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/register", new { email = "registered@example.com", password = Password });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True((await app.FindUserByEmailAsync("registered@example.com"))!.LockoutEnabled);
    }

    private sealed record ResponseSnapshot(HttpStatusCode Status, string? ContentType, string Body);

    private static async Task<ResponseSnapshot> Snapshot(HttpResponseMessage response) =>
        new(response.StatusCode, response.Content.Headers.ContentType?.ToString(), await response.Content.ReadAsStringAsync());

    private static Task<HttpResponseMessage> SignInAsync(TestApplication app, string endpoint, string email, string password) =>
        endpoint == WebSession
            ? WebSignInAsync(app, email, password, Origin, "1")
            : app.Client.PostAsJsonAsync(endpoint, new { email, password });

    private static Task<HttpResponseMessage> WebSignInAsync(
        TestApplication app, string email, string password, string origin, string? header)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, WebSession)
        {
            Content = new StringContent(JsonSerializer.Serialize(new { email, password }), Encoding.UTF8, "application/json")
        };
        request.Headers.Add("Origin", origin);
        if (header != null) request.Headers.Add("X-Ordo-Web-Session", header);
        return app.Client.SendAsync(request);
    }

    private static async Task SetLockoutEndAsync(TestApplication app, string email, DateTimeOffset end)
    {
        using var scope = app.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = (await users.FindByEmailAsync(email))!;
        Assert.True((await users.SetLockoutEndDateAsync(user, end)).Succeeded);
    }
}
