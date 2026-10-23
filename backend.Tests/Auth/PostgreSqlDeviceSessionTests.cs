using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using BudgetPlanner.Authentication;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using BudgetPlanner.Tests.Financial;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

[Collection("Environment variable tests")]
[Trait("Category", "PostgreSQL")]
public sealed class PostgreSqlDeviceSessionTests
{
    private const string Password = "Password1!";
    private const string Create = "/api/auth/device-sessions";
    private const string Refresh = "/api/auth/device-sessions/refresh";
    private const string SignOut = "/api/auth/device-sessions/sign-out";

    [PostgreSqlFact]
    public async Task Schema_has_the_table_cascading_foreign_key_checks_and_owner_index()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var user = await app.CreateAuthenticatedUserAsync("device-schema@example.com");
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();

        var columns = await context.Database.SqlQueryRaw<string>(
            """
            SELECT column_name || ':' || data_type || ':' || is_nullable AS "Value"
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'DeviceSessions'
            ORDER BY column_name
            """).ToListAsync();
        Assert.Equal(
            new[]
            {
                "AbsoluteExpiresAt:timestamp with time zone:NO",
                "CreatedAt:timestamp with time zone:NO",
                "Id:uuid:NO",
                "LastUsedAt:timestamp with time zone:NO",
                "OwnerId:text:NO",
                "SecretHash:bytea:NO",
                "SecurityStampHash:bytea:NO"
            },
            columns);

        var foreignKeyRule = await context.Database.SqlQueryRaw<string>(
            """
            SELECT rc.delete_rule AS "Value"
            FROM information_schema.referential_constraints rc
            WHERE rc.constraint_name = 'FK_DeviceSessions_AspNetUsers_OwnerId'
            """).SingleAsync();
        Assert.Equal("CASCADE", foreignKeyRule);

        var checks = await context.Database.SqlQueryRaw<string>(
            """
            SELECT conname AS "Value" FROM pg_constraint
            WHERE conrelid = '"DeviceSessions"'::regclass AND contype = 'c'
            ORDER BY conname
            """).ToListAsync();
        Assert.Equal(
            new[]
            {
                "CK_DeviceSession_Expiry", "CK_DeviceSession_LastUsed",
                "CK_DeviceSession_SecretHash", "CK_DeviceSession_StampHash"
            },
            checks);

        var indexes = await context.Database.SqlQueryRaw<string>(
            """
            SELECT indexname AS "Value" FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = 'DeviceSessions' ORDER BY indexname
            """).ToListAsync();
        Assert.Equal(new[] { "IX_DeviceSessions_OwnerId", "PK_DeviceSessions" }, indexes);

        var now = DateTime.UtcNow;
        await AssertCheckViolationAsync(context, user.Id, new byte[31], new byte[32], now, now, now.AddDays(1));
        await AssertCheckViolationAsync(context, user.Id, new byte[32], new byte[31], now, now, now.AddDays(1));
        await AssertCheckViolationAsync(context, user.Id, new byte[32], new byte[32], now, now, now);
        await AssertCheckViolationAsync(
            context, user.Id, new byte[32], new byte[32], now, now.AddSeconds(-1), now.AddDays(1));
    }

    [PostgreSqlFact]
    public async Task Deleting_the_user_cascades_to_their_sessions()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("device-cascade@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("device-cascade-other@example.com");
        await CreateSessionAsync(app, "device-cascade@example.com");
        await CreateSessionAsync(app, "device-cascade@example.com");
        await CreateSessionAsync(app, "device-cascade-other@example.com");

        using (var scope = app.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            Assert.True((await users.DeleteAsync((await users.FindByIdAsync(owner.Id))!)).Succeeded);
        }

        Assert.Equal(0, await CountAsync(app, owner.Id));
        Assert.Equal(1, await CountAsync(app, other.Id));
    }

    [PostgreSqlFact]
    public Task Two_concurrent_renewals_with_one_credential_yield_one_success_and_no_server_errors() =>
        ConcurrentRenewalsAsync(2);

    [PostgreSqlFact]
    public Task Eight_concurrent_renewals_with_one_credential_yield_one_success_and_no_server_errors() =>
        ConcurrentRenewalsAsync(8);

    private static async Task ConcurrentRenewalsAsync(int parallel)
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var user = await app.CreateAuthenticatedUserAsync($"device-race-{parallel}@example.com");

        for (var round = 0; round < 5; round++)
        {
            var credential = await CreateSessionAsync(app, $"device-race-{parallel}@example.com");

            var results = await RaceAsync(parallel, _ => app.CreateTestClient(), async client =>
            {
                using var response = await client.PostAsJsonAsync(Refresh, new { refreshToken = credential });
                var body = response.StatusCode == HttpStatusCode.OK
                    ? (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("refreshToken").GetString()
                    : null;
                return (response.StatusCode, Next: body);
            });

            Assert.DoesNotContain(results, result => (int)result.StatusCode >= 500);
            Assert.Single(results, result => result.StatusCode == HttpStatusCode.OK);
            Assert.Equal(parallel - 1, results.Count(result => result.StatusCode == HttpStatusCode.Unauthorized));
            Assert.Equal(0, await CountAsync(app, user.Id));

            var winnerCredential = results.Single(result => result.StatusCode == HttpStatusCode.OK).Next!;
            using var client = app.CreateTestClient();
            using var late = await client.PostAsJsonAsync(Refresh, new { refreshToken = winnerCredential });
            Assert.Equal(HttpStatusCode.Unauthorized, late.StatusCode);
        }
    }

    [PostgreSqlFact]
    public async Task Parallel_web_refreshes_with_one_cookie_yield_one_success_and_no_server_errors()
    {
        const int parallel = 8;
        const string email = "web-race@example.com";
        const string cookieName = "__Secure-ordo-web-session";
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var user = await app.CreateAuthenticatedUserAsync(email);

        static HttpRequestMessage WebRequest(string route, object? body, string? cookie)
        {
            var request = new HttpRequestMessage(HttpMethod.Post, route);
            if (body != null) request.Content = JsonContent.Create(body);
            request.Headers.Add("Origin", "https://frontend.test");
            request.Headers.Add("X-Ordo-Web-Session", "1");
            if (cookie != null) request.Headers.Add("Cookie", $"{cookieName}={cookie}");
            return request;
        }

        for (var round = 0; round < 5; round++)
        {
            string cookie;
            using (var client = app.CreateTestClient())
            {
                using var signIn = await client.SendAsync(
                    WebRequest("/api/auth/web-session", new { email, password = Password }, null));
                Assert.Equal(HttpStatusCode.OK, signIn.StatusCode);
                var line = signIn.Headers.GetValues("Set-Cookie")
                    .Single(value => value.StartsWith(cookieName + "=", StringComparison.Ordinal));
                cookie = line.Split(';')[0][(cookieName.Length + 1)..];
            }

            var results = await RaceAsync(parallel, _ => app.CreateTestClient(), async client =>
            {
                using var response = await client.SendAsync(
                    WebRequest("/api/auth/web-session/refresh", null, cookie));
                return response.StatusCode;
            });

            Assert.DoesNotContain(results, status => (int)status >= 500);
            Assert.Single(results, status => status == HttpStatusCode.OK);
            Assert.Equal(parallel - 1, results.Count(status => status == HttpStatusCode.Unauthorized));
            Assert.Equal(0, await CountAsync(app, user.Id));
        }
    }

    [PostgreSqlFact]
    public async Task Refresh_racing_a_password_reset_leaves_no_usable_session_and_reset_still_returns_200()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var user = await app.CreateAuthenticatedUserAsync("device-reset-race@example.com");
        var currentPassword = Password;

        for (var round = 0; round < 8; round++)
        {
            var credential = await CreateSessionAsync(app, "device-reset-race@example.com", currentPassword);
            var newPassword = $"New-password{round}!";
            var resetToken = await ResetTokenAsync(app, user.Id);

            using var refreshClient = app.CreateTestClient();
            using var resetClient = app.CreateTestClient();
            var gate = new TaskCompletionSource();
            var refresh = Task.Run(async () =>
            {
                await gate.Task;
                using var response = await refreshClient.PostAsJsonAsync(Refresh, new { refreshToken = credential });
                return (response.StatusCode,
                    Next: response.StatusCode == HttpStatusCode.OK
                        ? (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("refreshToken").GetString()
                        : null);
            });
            var reset = Task.Run(async () =>
            {
                await gate.Task;
                using var response = await resetClient.PostAsJsonAsync(
                    "/api/auth/reset-password",
                    new { email = "device-reset-race@example.com", token = resetToken, newPassword });
                return (response.StatusCode, Body: await response.Content.ReadAsStringAsync());
            });
            gate.SetResult();
            var refreshResult = await refresh;
            var resetResult = await reset;

            Assert.Equal(HttpStatusCode.OK, resetResult.StatusCode);
            Assert.Equal("{\"message\":\"Password reset successfully\"}", resetResult.Body);
            currentPassword = newPassword;
            Assert.Contains(refreshResult.StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.Unauthorized });
            Assert.Equal(0, await CountAsync(app, user.Id));

            using var check = app.CreateTestClient();
            foreach (var attempt in new[] { credential, refreshResult.Next }.Where(value => value != null))
            {
                using var response = await check.PostAsJsonAsync(Refresh, new { refreshToken = attempt });
                Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            }
        }
    }

    [PostgreSqlFact]
    public async Task Refresh_racing_sign_out_ends_the_session()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var user = await app.CreateAuthenticatedUserAsync("device-signout-race@example.com");

        for (var round = 0; round < 8; round++)
        {
            var credential = await CreateSessionAsync(app, "device-signout-race@example.com");
            using var refreshClient = app.CreateTestClient();
            using var signOutClient = app.CreateTestClient();
            var gate = new TaskCompletionSource();
            var refresh = Task.Run(async () =>
            {
                await gate.Task;
                using var response = await refreshClient.PostAsJsonAsync(Refresh, new { refreshToken = credential });
                return (response.StatusCode,
                    Next: response.StatusCode == HttpStatusCode.OK
                        ? (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("refreshToken").GetString()
                        : null);
            });
            var signOut = Task.Run(async () =>
            {
                await gate.Task;
                using var response = await signOutClient.PostAsJsonAsync(SignOut, new { refreshToken = credential });
                return response.StatusCode;
            });
            gate.SetResult();
            var refreshResult = await refresh;

            Assert.Equal(HttpStatusCode.NoContent, await signOut);
            Assert.Contains(refreshResult.StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.Unauthorized });
            Assert.Equal(0, await CountAsync(app, user.Id));

            using var check = app.CreateTestClient();
            foreach (var attempt in new[] { credential, refreshResult.Next }.Where(value => value != null))
            {
                using var response = await check.PostAsJsonAsync(Refresh, new { refreshToken = attempt });
                Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            }
        }
    }

    [PostgreSqlFact]
    public async Task Cap_eviction_and_expired_cleanup_work_through_relational_bulk_deletes()
    {
        await using var app = new CappedPostgreSqlApplication();
        using var user = await app.CreateAuthenticatedUserAsync("device-cap@example.com");
        using (var scope = app.Services.CreateScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            var created = DateTime.UtcNow.AddDays(-400);
            context.DeviceSessions.Add(new DeviceSession
            {
                Id = Guid.NewGuid(),
                OwnerId = user.Id,
                SecretHash = new byte[32],
                SecurityStampHash = new byte[32],
                CreatedAt = created,
                LastUsedAt = created,
                AbsoluteExpiresAt = created.AddDays(180)
            });
            await context.SaveChangesAsync();
        }
        Assert.Equal(1, await CountAsync(app, user.Id));

        var first = await CreateSessionAsync(app, "device-cap@example.com");
        var second = await CreateSessionAsync(app, "device-cap@example.com");
        var third = await CreateSessionAsync(app, "device-cap@example.com");

        Assert.Equal(2, await CountAsync(app, user.Id));
        using var client = app.CreateTestClient();
        using var evicted = await client.PostAsJsonAsync(Refresh, new { refreshToken = first });
        Assert.Equal(HttpStatusCode.Unauthorized, evicted.StatusCode);
        using var keptSecond = await client.PostAsJsonAsync(Refresh, new { refreshToken = second });
        using var keptThird = await client.PostAsJsonAsync(Refresh, new { refreshToken = third });
        Assert.Equal(HttpStatusCode.OK, keptSecond.StatusCode);
        Assert.Equal(HttpStatusCode.OK, keptThird.StatusCode);
    }

    private sealed class CappedPostgreSqlApplication : PostgreSqlFinancialApiTestApplication
    {
        protected override void ConfigureAdditionalServices(IServiceCollection services) =>
            services.Configure<DeviceSessionOptions>(options => options.MaxSessionsPerAccount = 2);
    }

    private static async Task<List<TResult>> RaceAsync<TClient, TResult>(
        int parallel, Func<int, TClient> createClient, Func<TClient, Task<TResult>> action)
        where TClient : IDisposable
    {
        var clients = Enumerable.Range(0, parallel).Select(createClient).ToList();
        try
        {
            var gate = new TaskCompletionSource();
            var tasks = clients.Select(client => Task.Run(async () =>
            {
                await gate.Task;
                return await action(client);
            })).ToList();
            gate.SetResult();
            return (await Task.WhenAll(tasks)).ToList();
        }
        finally
        {
            foreach (var client in clients) client.Dispose();
        }
    }

    private static async Task<string> CreateSessionAsync(
        PostgreSqlFinancialApiTestApplication app, string email, string password = Password)
    {
        using var client = app.CreateTestClient();
        using var response = await client.PostAsJsonAsync(Create, new { email, password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("refreshToken").GetString()!;
    }

    private static async Task<int> CountAsync(PostgreSqlFinancialApiTestApplication app, string ownerId)
    {
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        return await context.DeviceSessions.CountAsync(value => value.OwnerId == ownerId);
    }

    private static async Task<string> ResetTokenAsync(PostgreSqlFinancialApiTestApplication app, string userId)
    {
        using var scope = app.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var token = await users.GeneratePasswordResetTokenAsync((await users.FindByIdAsync(userId))!);
        return WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));
    }

    private static async Task AssertCheckViolationAsync(
        BudgetContext context,
        string ownerId,
        byte[] secretHash,
        byte[] stampHash,
        DateTime createdAt,
        DateTime lastUsedAt,
        DateTime absoluteExpiresAt)
    {
        var exception = await Assert.ThrowsAnyAsync<Exception>(() => context.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO "DeviceSessions"
                ("Id", "OwnerId", "SecretHash", "SecurityStampHash", "CreatedAt", "LastUsedAt", "AbsoluteExpiresAt")
            VALUES ({Guid.NewGuid()}, {ownerId}, {secretHash}, {stampHash}, {createdAt}, {lastUsedAt}, {absoluteExpiresAt})
            """));
        var postgres = exception as PostgresException ?? exception.InnerException as PostgresException;
        Assert.NotNull(postgres);
        Assert.Equal(PostgresErrorCodes.CheckViolation, postgres.SqlState);
    }
}
