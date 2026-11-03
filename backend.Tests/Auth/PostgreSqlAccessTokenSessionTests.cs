using System.Collections.Concurrent;
using System.Data.Common;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using BudgetPlanner.Tests.Financial;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

/// <summary>
/// #337 on Npgsql: revoked access tokens get 401, the per-request check is one
/// read-only SELECT, and a refresh racing authenticated requests never gives a 500.
/// </summary>
[Collection("Environment variable tests")]
[Trait("Category", "PostgreSQL")]
public sealed class PostgreSqlAccessTokenSessionTests
{
    private const string Password = "Password1!";
    private const string Create = "/api/auth/device-sessions";
    private const string Refresh = "/api/auth/device-sessions/refresh";
    private const string SignOut = "/api/auth/device-sessions/sign-out";
    private const string Protected = "/api/expenses";

    [PostgreSqlFact]
    public async Task Sign_out_reuse_and_password_reset_give_401_while_another_session_still_works()
    {
        const string email = "at-revoke@example.com";
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var user = await app.CreateAuthenticatedUserAsync(email);
        using var client = app.CreateTestClient();

        var signedOut = await SignInAsync(client, email, Password);
        var reused = await SignInAsync(client, email, Password);
        var survivor = await SignInAsync(client, email, Password);
        Assert.Equal(HttpStatusCode.OK, await GetAsync(client, signedOut.Token, Protected));
        Assert.Equal(HttpStatusCode.OK, await GetAsync(client, reused.Token, Protected));

        using (var response = await client.PostAsJsonAsync(SignOut, new { refreshToken = signedOut.Credential }))
            Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, await GetAsync(client, signedOut.Token, Protected));

        var rotated = await RefreshAsync(client, reused.Credential);
        Assert.Equal(HttpStatusCode.OK, await GetAsync(client, reused.Token, Protected));
        Assert.Equal(HttpStatusCode.OK, await GetAsync(client, rotated.Token, Protected));
        using (var replay = await client.PostAsJsonAsync(Refresh, new { refreshToken = reused.Credential }))
            Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, await GetAsync(client, reused.Token, Protected));
        Assert.Equal(HttpStatusCode.Unauthorized, await GetAsync(client, rotated.Token, Protected));

        Assert.Equal(HttpStatusCode.OK, await GetAsync(client, survivor.Token, Protected));
        using (var loginTokenBefore = await user.Client.GetAsync(Protected))
            Assert.Equal(HttpStatusCode.OK, loginTokenBefore.StatusCode);

        using (var reset = await client.PostAsJsonAsync("/api/auth/reset-password", new
               {
                   email,
                   token = await ResetTokenAsync(app, user.Id),
                   newPassword = "New-password1!"
               }))
            Assert.Equal(HttpStatusCode.OK, reset.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, await GetAsync(client, survivor.Token, Protected));
        using var loginTokenAfter = await user.Client.GetAsync(Protected);
        Assert.Equal(HttpStatusCode.Unauthorized, loginTokenAfter.StatusCode);
    }

    [PostgreSqlFact]
    public async Task The_check_sends_exactly_one_read_only_select()
    {
        const string email = "at-select@example.com";
        await using var app = new RecordingApplication();
        using var user = await app.CreateAuthenticatedUserAsync(email);
        using var client = app.CreateTestClient();
        var live = await SignInAsync(client, email, Password);
        var revoked = await SignInAsync(client, email, Password);
        using (var response = await client.PostAsJsonAsync(SignOut, new { refreshToken = revoked.Credential }))
            Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        // /health is anonymous and touches no data, so the only SQL is the token check.
        // Warm up first so the Data Protection key ring is already loaded.
        Assert.Equal(HttpStatusCode.OK, await GetAsync(client, live.Token, "/health"));

        foreach (var (name, token) in new[]
                 {
                     ("live session token", live.Token),
                     ("revoked session token", revoked.Token),
                     ("login token", user.Client.DefaultRequestHeaders.Authorization!.Parameter!)
                 })
        {
            app.Recorder.Start();
            var status = await GetAsync(client, token, "/health");
            var commands = app.Recorder.Stop();

            Assert.True(status == HttpStatusCode.OK, $"{name}: /health returned {(int)status}");
            var command = Assert.Single(commands);
            Assert.StartsWith("SELECT", command.TrimStart(), StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("FOR UPDATE", command, StringComparison.OrdinalIgnoreCase);
        }
    }

    [PostgreSqlFact]
    public async Task A_refresh_racing_authenticated_requests_gives_no_server_error()
    {
        const string email = "at-race@example.com";
        const int readers = 8;
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var user = await app.CreateAuthenticatedUserAsync(email);
        using var client = app.CreateTestClient();

        for (var round = 0; round < 5; round++)
        {
            var session = await SignInAsync(client, email, Password);
            var gate = new TaskCompletionSource();
            var refresh = Task.Run(async () =>
            {
                await gate.Task;
                using var response = await client.PostAsJsonAsync(Refresh, new { refreshToken = session.Credential });
                return response.StatusCode;
            });
            var reads = Enumerable.Range(0, readers).Select(_ => Task.Run(async () =>
            {
                await gate.Task;
                return await GetAsync(client, session.Token, Protected);
            })).ToList();
            gate.SetResult();

            var refreshStatus = await refresh;
            var readStatuses = await Task.WhenAll(reads);

            Assert.Equal(HttpStatusCode.OK, refreshStatus);
            Assert.All(readStatuses, status => Assert.Equal(HttpStatusCode.OK, status));
            Assert.Equal(HttpStatusCode.OK, await GetAsync(client, session.Token, Protected));
        }
    }

    private sealed record Issued(string Token, string Credential);

    private static async Task<Issued> SignInAsync(HttpClient client, string email, string password)
    {
        using var response = await client.PostAsJsonAsync(Create, new { email, password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return new Issued(body.GetProperty("token").GetString()!, body.GetProperty("refreshToken").GetString()!);
    }

    private static async Task<Issued> RefreshAsync(HttpClient client, string credential)
    {
        using var response = await client.PostAsJsonAsync(Refresh, new { refreshToken = credential });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return new Issued(body.GetProperty("token").GetString()!, body.GetProperty("refreshToken").GetString()!);
    }

    private static async Task<HttpStatusCode> GetAsync(HttpClient client, string token, string route)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, route);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await client.SendAsync(request);
        return response.StatusCode;
    }

    private static async Task<string> ResetTokenAsync(PostgreSqlFinancialApiTestApplication app, string userId)
    {
        using var scope = app.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var token = await users.GeneratePasswordResetTokenAsync((await users.FindByIdAsync(userId))!);
        return WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));
    }

    private sealed class RecordingApplication : PostgreSqlFinancialApiTestApplication
    {
        public CommandRecorder Recorder { get; } = new();

        // Adds the interceptor on top of the Npgsql options registered by ConfigureDatabase.
        protected override void ConfigureAdditionalServices(IServiceCollection services) =>
            services.ConfigureDbContext<BudgetContext>(options => options.AddInterceptors(Recorder));
    }

    private sealed class CommandRecorder : DbCommandInterceptor
    {
        private readonly ConcurrentQueue<string> _commands = new();
        private volatile bool _recording;

        public void Start()
        {
            _commands.Clear();
            _recording = true;
        }

        public IReadOnlyList<string> Stop()
        {
            _recording = false;
            return _commands.ToArray();
        }

        private void Record(DbCommand command)
        {
            if (_recording) _commands.Enqueue(command.CommandText);
        }

        public override InterceptionResult<DbDataReader> ReaderExecuting(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
        {
            Record(command);
            return result;
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            Record(command);
            return ValueTask.FromResult(result);
        }

        public override InterceptionResult<int> NonQueryExecuting(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result)
        {
            Record(command);
            return result;
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            Record(command);
            return ValueTask.FromResult(result);
        }

        public override InterceptionResult<object> ScalarExecuting(
            DbCommand command, CommandEventData eventData, InterceptionResult<object> result)
        {
            Record(command);
            return result;
        }

        public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<object> result,
            CancellationToken cancellationToken = default)
        {
            Record(command);
            return ValueTask.FromResult(result);
        }
    }
}
