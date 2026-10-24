using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BudgetPlanner.Models;
using BudgetPlanner.Tests.Financial;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

/// <summary>
/// Account lockout (#299) on PostgreSQL, where the atomic reservation path runs:
/// attempts are reserved before hashing, so parallel guesses stay within the budget.
/// </summary>
[Collection("Environment variable tests")]
[Trait("Category", "PostgreSQL")]
public sealed class PostgreSqlSignInLockoutTests
{
    private const string Password = "Password1!";
    private const string WrongPassword = "Wrong-password1!";
    private const string Login = "/api/auth/login";
    private const string DeviceSession = "/api/auth/device-sessions";
    private const int MaxAttempts = 5;

    [PostgreSqlFact]
    public async Task Sequential_failures_lock_and_success_resets_through_the_relational_path()
    {
        await using var app = new CountingApplication();
        using var user = await app.CreateAuthenticatedUserAsync("pg-lock@example.com");

        for (var i = 0; i < 4; i++)
            Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(app, Login, "pg-lock@example.com", WrongPassword));
        Assert.Equal(4, (await FindAsync(app, user.Id)).AccessFailedCount);
        Assert.Equal(HttpStatusCode.OK, await StatusAsync(app, Login, "pg-lock@example.com", Password));
        Assert.Equal(0, (await FindAsync(app, user.Id)).AccessFailedCount);

        for (var i = 0; i < 5; i++)
            await StatusAsync(app, i % 2 == 0 ? Login : DeviceSession, "pg-lock@example.com", WrongPassword);

        var locked = await FindAsync(app, user.Id);
        Assert.Equal(0, locked.AccessFailedCount);
        Assert.True(locked.LockoutEnd > DateTimeOffset.UtcNow.AddMinutes(9));

        app.Counter.Reset();
        var wrong = await SnapshotAsync(app, Login, "pg-lock@example.com", WrongPassword);
        var right = await SnapshotAsync(app, Login, "pg-lock@example.com", Password);
        var unknown = await SnapshotAsync(app, Login, "pg-nobody@example.com", Password);
        Assert.Equal(0, app.Counter.Value);
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.Status);
        Assert.Equal(wrong, right);
        Assert.Equal(wrong, unknown);

        await SetLockoutEndAsync(app, user.Id, DateTimeOffset.UtcNow.AddMinutes(-1));
        Assert.Equal(HttpStatusCode.OK, await StatusAsync(app, DeviceSession, "pg-lock@example.com", Password));
    }

    [PostgreSqlFact]
    public async Task Parallel_wrong_guesses_are_bounded_by_the_attempt_budget_and_lock_the_account()
    {
        const int parallel = 20;
        await using var app = new CountingApplication();
        using var user = await app.CreateAuthenticatedUserAsync("pg-race@example.com");
        app.Counter.Reset();

        var results = await RaceAsync(app, parallel, _ => (DeviceSession, WrongPassword), "pg-race@example.com");

        Assert.All(results, status => Assert.Equal(HttpStatusCode.Unauthorized, status));
        Assert.Equal(MaxAttempts, app.Counter.Value);
        var stored = await FindAsync(app, user.Id);
        Assert.True(stored.LockoutEnd > DateTimeOffset.UtcNow);

        Assert.Equal(HttpStatusCode.Unauthorized, await StatusAsync(app, DeviceSession, "pg-race@example.com", Password));
        Assert.Equal(MaxAttempts, app.Counter.Value);
    }

    [PostgreSqlFact]
    public async Task A_parallel_batch_with_the_right_password_cannot_sign_in_after_the_budget_is_used()
    {
        await using var app = new CountingApplication();
        using var user = await app.CreateAuthenticatedUserAsync("pg-mixed@example.com");
        await RaceAsync(app, 12, _ => (Login, WrongPassword), "pg-mixed@example.com");
        app.Counter.Reset();

        var results = await RaceAsync(
            app,
            20,
            index => (index % 2 == 0 ? Login : DeviceSession, index % 3 == 0 ? WrongPassword : Password),
            "pg-mixed@example.com");

        Assert.All(results, status => Assert.Equal(HttpStatusCode.Unauthorized, status));
        Assert.Equal(0, app.Counter.Value);
        Assert.Equal(0, await CountSessionsAsync(app, user.Id));
    }

    [PostgreSqlFact]
    public async Task Lockout_disabled_users_are_never_locked_and_unconfirmed_users_see_confirmation_only_when_unlocked()
    {
        await using var app = new CountingApplication();
        using var noLock = await app.CreateAuthenticatedUserAsync("pg-nolock@example.com");
        using (var scope = app.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            Assert.True((await users.SetLockoutEnabledAsync((await users.FindByIdAsync(noLock.Id))!, false)).Succeeded);
            var pending = new ApplicationUser { UserName = "pg-pending@example.com", Email = "pg-pending@example.com" };
            Assert.True((await users.CreateAsync(pending, Password)).Succeeded);
        }

        for (var i = 0; i < 8; i++)
            await StatusAsync(app, Login, "pg-nolock@example.com", WrongPassword);
        var noLockStored = await FindAsync(app, noLock.Id);
        Assert.Null(noLockStored.LockoutEnd);
        Assert.Equal(0, noLockStored.AccessFailedCount);
        Assert.Equal(HttpStatusCode.OK, await StatusAsync(app, Login, "pg-nolock@example.com", Password));

        var wrong = await SnapshotAsync(app, DeviceSession, "pg-pending@example.com", WrongPassword);
        for (var i = 0; i < 4; i++)
            await StatusAsync(app, DeviceSession, "pg-pending@example.com", WrongPassword);
        Assert.Equal(wrong, await SnapshotAsync(app, DeviceSession, "pg-pending@example.com", Password));

        var pendingId = (await FindByEmailAsync(app, "pg-pending@example.com")).Id;
        await SetLockoutEndAsync(app, pendingId, DateTimeOffset.UtcNow.AddMinutes(-1));
        var confirm = await SnapshotAsync(app, DeviceSession, "pg-pending@example.com", Password);
        Assert.Equal("{\"code\":\"email_not_confirmed\"}", confirm.Body);
        Assert.Equal(0, (await FindAsync(app, pendingId)).AccessFailedCount);
    }

    [PostgreSqlFact]
    public async Task Resetting_the_count_keeps_the_security_stamp_and_sessions_refresh()
    {
        await using var app = new CountingApplication();
        using var user = await app.CreateAuthenticatedUserAsync("pg-stamp@example.com");
        var stampBefore = (await FindAsync(app, user.Id)).SecurityStamp;

        for (var i = 0; i < 3; i++)
            await StatusAsync(app, DeviceSession, "pg-stamp@example.com", WrongPassword);
        using var client = app.CreateTestClient();
        using var signIn = await client.PostAsJsonAsync(DeviceSession, new { email = "pg-stamp@example.com", password = Password });
        Assert.Equal(HttpStatusCode.OK, signIn.StatusCode);
        var credential = (await signIn.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("refreshToken").GetString();

        var stored = await FindAsync(app, user.Id);
        Assert.Equal(stampBefore, stored.SecurityStamp);
        Assert.Equal(0, stored.AccessFailedCount);
        using var refresh = await client.PostAsJsonAsync("/api/auth/device-sessions/refresh", new { refreshToken = credential });
        Assert.Equal(HttpStatusCode.OK, refresh.StatusCode);
    }

    [PostgreSqlFact]
    public async Task A_row_stuck_at_the_max_count_without_a_lock_heals_into_a_timed_lock()
    {
        await using var app = new CountingApplication();
        using var user = await app.CreateAuthenticatedUserAsync("pg-stuck@example.com");
        await SeedStuckCountAsync(app, user.Id, MaxAttempts);
        app.Counter.Reset();

        var unknown = await SnapshotAsync(app, Login, "pg-nobody@example.com", Password);
        var first = await SnapshotAsync(app, Login, "pg-stuck@example.com", Password);
        Assert.Equal(0, app.Counter.Value);
        Assert.Equal(HttpStatusCode.Unauthorized, first.Status);
        Assert.Equal(unknown, first);

        var healed = await FindAsync(app, user.Id);
        Assert.Equal(0, healed.AccessFailedCount);
        Assert.True(healed.LockoutEnd > DateTimeOffset.UtcNow.AddMinutes(9));

        await SetLockoutEndAsync(app, user.Id, DateTimeOffset.UtcNow.AddMinutes(-1));
        Assert.Equal(HttpStatusCode.OK, await StatusAsync(app, Login, "pg-stuck@example.com", Password));
    }

    private sealed class CountingApplication : PostgreSqlFinancialApiTestApplication
    {
        public PasswordCheckCounter Counter { get; } = new();

        protected override void ConfigureAdditionalServices(IServiceCollection services)
        {
            services.RemoveAll<IPasswordHasher<ApplicationUser>>();
            services.AddScoped<IPasswordHasher<ApplicationUser>>(provider => new CountingPasswordHasher(
                new PasswordHasher<ApplicationUser>(provider.GetRequiredService<IOptions<PasswordHasherOptions>>()),
                Counter));
        }
    }

    internal sealed class PasswordCheckCounter
    {
        private int _value;
        public int Value => Volatile.Read(ref _value);
        public void Increment() => Interlocked.Increment(ref _value);
        public void Reset() => Interlocked.Exchange(ref _value, 0);
    }

    private sealed class CountingPasswordHasher(IPasswordHasher<ApplicationUser> inner, PasswordCheckCounter counter)
        : IPasswordHasher<ApplicationUser>
    {
        public string HashPassword(ApplicationUser user, string password) => inner.HashPassword(user, password);

        public PasswordVerificationResult VerifyHashedPassword(ApplicationUser user, string hashedPassword, string providedPassword)
        {
            counter.Increment();
            return inner.VerifyHashedPassword(user, hashedPassword, providedPassword);
        }
    }

    private sealed record ResponseSnapshot(HttpStatusCode Status, string? ContentType, string Body);

    private static async Task<HttpStatusCode> StatusAsync(
        PostgreSqlFinancialApiTestApplication app, string endpoint, string email, string password) =>
        (await SnapshotAsync(app, endpoint, email, password)).Status;

    private static async Task<ResponseSnapshot> SnapshotAsync(
        PostgreSqlFinancialApiTestApplication app, string endpoint, string email, string password)
    {
        using var client = app.CreateTestClient();
        using var response = await client.PostAsJsonAsync(endpoint, new { email, password });
        return new(response.StatusCode, response.Content.Headers.ContentType?.ToString(), await response.Content.ReadAsStringAsync());
    }

    private static async Task<List<HttpStatusCode>> RaceAsync(
        PostgreSqlFinancialApiTestApplication app,
        int parallel,
        Func<int, (string Endpoint, string Password)> attempt,
        string email)
    {
        var clients = Enumerable.Range(0, parallel).Select(_ => app.CreateTestClient()).ToList();
        try
        {
            var gate = new TaskCompletionSource();
            var tasks = clients.Select((client, index) => Task.Run(async () =>
            {
                await gate.Task;
                var (endpoint, password) = attempt(index);
                using var response = await client.PostAsJsonAsync(endpoint, new { email, password });
                return response.StatusCode;
            })).ToList();
            gate.SetResult();
            var results = (await Task.WhenAll(tasks)).ToList();
            Assert.DoesNotContain(results, status => (int)status >= 500);
            return results;
        }
        finally
        {
            foreach (var client in clients) client.Dispose();
        }
    }

    private static async Task<ApplicationUser> FindAsync(PostgreSqlFinancialApiTestApplication app, string userId)
    {
        using var scope = app.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        return (await users.FindByIdAsync(userId))!;
    }

    private static async Task<ApplicationUser> FindByEmailAsync(PostgreSqlFinancialApiTestApplication app, string email)
    {
        using var scope = app.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        return (await users.FindByEmailAsync(email))!;
    }

    private static async Task SetLockoutEndAsync(PostgreSqlFinancialApiTestApplication app, string userId, DateTimeOffset end)
    {
        using var scope = app.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        Assert.True((await users.SetLockoutEndDateAsync((await users.FindByIdAsync(userId))!, end)).Succeeded);
    }

    private static async Task SeedStuckCountAsync(PostgreSqlFinancialApiTestApplication app, string userId, int count)
    {
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetPlanner.Data.BudgetContext>();
        var updated = await context.Users
            .Where(value => value.Id == userId)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(value => value.AccessFailedCount, count)
                .SetProperty(value => value.LockoutEnd, (DateTimeOffset?)null));
        Assert.Equal(1, updated);
    }

    private static async Task<int> CountSessionsAsync(PostgreSqlFinancialApiTestApplication app, string ownerId)
    {
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetPlanner.Data.BudgetContext>();
        return context.DeviceSessions.Count(value => value.OwnerId == ownerId);
    }
}
