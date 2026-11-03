using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using BudgetPlanner.Authentication;
using BudgetPlanner.Diagnostics;
using BudgetPlanner.Home;
using BudgetPlanner.Tests.Auth;
using Microsoft.AspNetCore.HttpsPolicy;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Logging;
using Xunit;

namespace BudgetPlanner.Tests.Diagnostics;

/// <summary>Request IDs, the requestId ProblemDetails field and the completion log line (#340).</summary>
public sealed class RequestCorrelationTests
{
    private const string Secret = "synthetic-secret amount 123.45 user@example.com";
    private const string Header = "X-Request-Id";
    private const string AllowedOrigin = "https://oli-budget-planner.vercel.app";
    private const string IdPattern = "^[0-9a-f]{16}$";

    private sealed class ThrowingHomeReadService : IHomeReadService
    {
        public Task<HomeReadResult> GetAsync(
            string ownerId, DateOnly activityThroughDate, CancellationToken cancellationToken) =>
            throw new InvalidOperationException(Secret);
    }

    private sealed class FailingCheck : IHealthCheck
    {
        public Task<HealthCheckResult> CheckHealthAsync(
            HealthCheckContext context, CancellationToken cancellationToken = default) =>
            Task.FromResult(HealthCheckResult.Unhealthy(Secret));
    }

    private static void UseThrowingHome(IServiceCollection services)
    {
        services.RemoveAll<IHomeReadService>();
        services.AddScoped<IHomeReadService, ThrowingHomeReadService>();
    }

    private static string IdOf(HttpResponseMessage response) =>
        Assert.Single(response.Headers.GetValues(Header));

    private static async Task<string> SignInAsync(TestApplication app, string email = "ids@example.com")
    {
        await app.CreateUserAsync(email, confirmed: true);
        var login = await app.Client.PostAsJsonAsync(
            "/api/auth/device-sessions", new { email, password = "Password1!" });
        return (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
    }

    private static Task<HttpResponseMessage> SendAsync(
        TestApplication app, HttpMethod method, string uri, string? token = null, HttpContent? content = null,
        Action<HttpRequestMessage>? configure = null)
    {
        var request = new HttpRequestMessage(method, uri) { Content = content };
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        configure?.Invoke(request);
        return app.Client.SendAsync(request);
    }

    private static List<CapturedLog> CompletionLines(CapturingLoggerProvider logs) =>
        logs.Entries.Where(entry => entry.Text.Contains("request_complete")).ToList();

    [Fact]
    public async Task Every_kind_of_response_carries_a_server_generated_request_id()
    {
        await using var app = await TestApplication.StartAsync(configureServices: services =>
        {
            services.Configure<ClientIpLimiterOptions>(o => o.SignInPermitLimit = 1);
            services.Configure<HealthCheckServiceOptions>(options =>
            {
                options.Registrations.Clear();
                options.Registrations.Add(new HealthCheckRegistration(
                    DatabaseReadinessCheck.Name, _ => new FailingCheck(), HealthStatus.Unhealthy,
                    [DatabaseReadinessCheck.ReadyTag], null));
            });
        });
        var token = await SignInAsync(app);
        var cases = new List<(string Name, HttpStatusCode Expected, HttpResponseMessage Response)>
        {
            ("health 200", HttpStatusCode.OK, await SendAsync(app, HttpMethod.Get, "/health")),
            ("ready 503", HttpStatusCode.ServiceUnavailable, await SendAsync(app, HttpMethod.Get, "/health/ready")),
            ("401", HttpStatusCode.Unauthorized, await SendAsync(app, HttpMethod.Get, "/api/home?activityThroughDate=2026-10-23")),
            ("404", HttpStatusCode.NotFound, await SendAsync(app, HttpMethod.Get, "/no-such-route", token)),
            ("400", HttpStatusCode.BadRequest, await SendAsync(app, HttpMethod.Get, "/api/home?activityThroughDate=bad", token)),
            ("200", HttpStatusCode.OK, await SendAsync(app, HttpMethod.Get, "/api/home?activityThroughDate=2026-10-23", token)),
            ("preflight", HttpStatusCode.NoContent, await SendAsync(app, HttpMethod.Options, "/api/home", configure: request =>
            {
                request.Headers.Add("Origin", AllowedOrigin);
                request.Headers.Add("Access-Control-Request-Method", "GET");
            })),
        };
        // The sign-in bucket already holds the SignInAsync call, so the next one is limited.
        cases.Add(("429", HttpStatusCode.TooManyRequests, await app.Client.PostAsJsonAsync(
            "/api/auth/device-sessions", new { email = "ids@example.com", password = "Password1!" })));

        foreach (var (name, expected, response) in cases)
        {
            using (response)
            {
                Assert.True(expected == response.StatusCode, $"{name}: got {(int)response.StatusCode}");
                Assert.Matches(IdPattern, IdOf(response));
            }
        }

        Assert.Equal(cases.Count, cases.Select(c => IdOf(c.Response)).Distinct().Count());
    }

    [Fact]
    public async Task Redirect_to_https_carries_a_request_id()
    {
        await using var app = await TestApplication.StartAsync(configureServices: services =>
            services.Configure<HttpsRedirectionOptions>(options => options.HttpsPort = 443));
        using var client = app.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        using var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.TemporaryRedirect, response.StatusCode);
        Assert.Matches(IdPattern, IdOf(response));
    }

    [Fact]
    public async Task Request_ids_are_unique_across_requests()
    {
        await using var app = await TestApplication.StartAsync();
        var ids = new HashSet<string>();
        for (var i = 0; i < 100; i++)
        {
            using var response = await app.Client.GetAsync("/health");
            Assert.True(ids.Add(IdOf(response)));
        }
    }

    [Fact]
    public async Task Inbound_request_ids_are_ignored_and_never_logged()
    {
        var logs = new CapturingLoggerProvider();
        await using var app = await TestApplication.StartAsync(loggerProvider: logs, configureServices: UseThrowingHome);
        var token = await SignInAsync(app);
        var hostile = new[]
        {
            "deadbeefdeadbeef",
            new string('a', 5000),
            "injected-line forged-secret-value",
            "x\r\nSet-Cookie: forged=1",
        };

        foreach (var inbound in hostile)
        {
            // Both a request that completes and one that fails with a 500.
            foreach (var uri in new[] { "/health", "/api/home?activityThroughDate=2026-10-23" })
            {
                using var response = await SendAsync(app, HttpMethod.Get, uri, token,
                    configure: request => request.Headers.TryAddWithoutValidation(Header, inbound));
                var id = IdOf(response);
                Assert.Matches(IdPattern, id);
                Assert.NotEqual(inbound, id);
                Assert.False(response.Headers.Contains("Set-Cookie"));
            }
        }

        // Split the CRLF case so each part is checked on its own (a short fragment like "x" would match anything).
        foreach (var marker in hostile.SelectMany(value => value.Split("\r\n")).Where(part => part.Length > 3))
            Assert.DoesNotContain(logs.Entries, entry =>
                entry.Text.Contains(marker) || (entry.Scopes ?? []).Any(scope => $"{scope}".Contains(marker)));
    }

    [Fact]
    public async Task Unhandled_500_body_and_header_share_the_request_id_and_trace_id_is_unchanged()
    {
        var logs = new CapturingLoggerProvider();
        await using var app = await TestApplication.StartAsync(loggerProvider: logs, configureServices: UseThrowingHome);
        var token = await SignInAsync(app);

        using var response = await SendAsync(app, HttpMethod.Get, "/api/home?activityThroughDate=2026-10-23", token);

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        var id = IdOf(response);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(id, body.GetProperty("requestId").GetString());
        Assert.Equal("internal_error", body.GetProperty("code").GetString());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("traceId").GetString()));
        Assert.NotEqual(id, body.GetProperty("traceId").GetString());

        var error = Assert.Single(logs.Entries, entry => entry.Level >= LogLevel.Error);
        Assert.Contains($"request {id}", error.Text);
        Assert.DoesNotContain("trace ", error.Text);
    }

    [Fact]
    public async Task Manual_validation_and_binding_problem_bodies_carry_the_request_id()
    {
        await using var app = await TestApplication.StartAsync();
        var token = await SignInAsync(app);
        // Manual new ProblemDetails (Analytics), framework ValidationProblemDetails (Expenses),
        // and the Paychecks filter that replaces the validation result with its own ProblemDetails.
        var cases = new (string Name, HttpMethod Method, string Uri, HttpContent? Content, string? Code)[]
        {
            ("manual", HttpMethod.Get, "/api/analytics/cash-flow?month=bad&throughDate=bad", null, "cash_flow_period_invalid"),
            ("validation", HttpMethod.Post, "/api/expenses", new StringContent("{\"amount\":\"not-a-number\"}", System.Text.Encoding.UTF8, "application/json"), null),
            ("paycheck binding", HttpMethod.Post, "/api/paychecks", new StringContent("{\"amount\":\"not-a-number\"}", System.Text.Encoding.UTF8, "application/json"), "request_invalid"),
        };
        foreach (var (name, method, uri, content, code) in cases)
        {
            using var response = await SendAsync(app, method, uri, token, content);
            Assert.True(response.StatusCode == HttpStatusCode.BadRequest, $"{name}: got {(int)response.StatusCode}");
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(IdOf(response), body.GetProperty("requestId").GetString());
            Assert.False(string.IsNullOrEmpty(body.GetProperty("status").ToString()));
            if (code is not null) Assert.Equal(code, body.GetProperty("code").GetString());
            if (name == "validation") Assert.True(body.TryGetProperty("errors", out _));
            else Assert.False(body.TryGetProperty("errors", out _));
            Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        }
    }

    [Fact]
    public async Task Throttle_429_problem_body_carries_the_request_id_and_keeps_its_trace_id()
    {
        await using var app = await TestApplication.StartAsync(configureServices: services =>
            services.Configure<ClientIpLimiterOptions>(o => o.SignInPermitLimit = 1));
        var credentials = new { email = "nobody@example.com", password = "Password1!" };
        using var first = await app.Client.PostAsJsonAsync("/api/auth/device-sessions", credentials);
        Assert.NotEqual(HttpStatusCode.TooManyRequests, first.StatusCode);

        using var limited = await app.Client.PostAsJsonAsync("/api/auth/device-sessions", credentials);

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        var body = await limited.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(IdOf(limited), body.GetProperty("requestId").GetString());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("traceId").GetString()));
    }

    [Fact]
    public async Task Responses_without_a_problem_body_get_only_the_header()
    {
        await using var app = await TestApplication.StartAsync();

        using var response = await app.Client.GetAsync("/api/home?activityThroughDate=2026-10-23");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Matches(IdPattern, IdOf(response));
        Assert.Equal(string.Empty, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Completion_line_has_exactly_five_allowlisted_fields_and_no_request_data()
    {
        var logs = new CapturingLoggerProvider();
        await using var app = await TestApplication.StartAsync(loggerProvider: logs, configureServices: UseThrowingHome);
        var token = await SignInAsync(app);

        using var failing = await SendAsync(
            app, HttpMethod.Get, "/api/home?activityThroughDate=2026-10-23&q=query-secret", token,
            configure: request => request.Headers.TryAddWithoutValidation("Cookie", "session=cookie-secret"));
        using var missing = await SendAsync(app, HttpMethod.Get, "/no-such/path-id-4242", token);
        using var odd = await SendAsync(app, new HttpMethod("BREW"), "/no-such-either", token);
        using var ok = await SendAsync(app, HttpMethod.Get, "/api/home?activityThroughDate=2026-10-25", token);

        var lines = CompletionLines(logs);
        var failingId = IdOf(failing);
        var line500 = Assert.Single(lines, l => l.Text.Contains($"request={failingId} "));
        // A handled 500 lost its endpoint to the exception handler; the template still comes through.
        Assert.Matches(
            $@"request_complete request={failingId} method=GET route=api/home status=500 duration_ms=\d+\s*$", line500.Text);
        Assert.Equal(LogLevel.Warning, line500.Level);
        Assert.Equal("BudgetPlanner.Diagnostics.RequestCorrelationMiddleware", line500.Category);

        var line404 = Assert.Single(lines, l => l.Text.Contains($"request={IdOf(missing)} "));
        Assert.Matches(@"method=GET route=unmatched status=404 duration_ms=\d+\s*$", line404.Text);
        Assert.Equal(LogLevel.Information, line404.Level);

        var lineOther = Assert.Single(lines, l => l.Text.Contains($"request={IdOf(odd)} "));
        Assert.Matches(@"method=OTHER route=unmatched status=404 ", lineOther.Text);

        // A matched route logs its template, not the concrete path.
        var line200 = Assert.Single(lines, l => l.Text.Contains($"request={IdOf(ok)} "));
        Assert.Matches(@"method=GET route=api/home status=\d{3} duration_ms=\d+\s*$", line200.Text);

        foreach (var line in lines)
        {
            var fields = Regex.Matches(line.Text, @"(request|method|route|status|duration_ms)=").Count;
            Assert.Equal(5, fields);
            foreach (var forbidden in new[]
                     { "query-secret", "cookie-secret", "Bearer", "path-id-4242", "activityThroughDate", "BREW", Secret, "synthetic-secret", "ids@example.com", "127.0.0.1", "?" })
                Assert.DoesNotContain(forbidden, line.Text);
        }
    }

    [Fact]
    public async Task Health_success_is_not_logged_and_failure_is()
    {
        var logs = new CapturingLoggerProvider();
        await using var app = await TestApplication.StartAsync(loggerProvider: logs, configureServices: services =>
            services.Configure<HealthCheckServiceOptions>(options =>
            {
                options.Registrations.Clear();
                options.Registrations.Add(new HealthCheckRegistration(
                    DatabaseReadinessCheck.Name, _ => new FailingCheck(), HealthStatus.Unhealthy,
                    [DatabaseReadinessCheck.ReadyTag], null));
            }));

        using var live = await app.Client.GetAsync("/health");
        using var ready = await app.Client.GetAsync("/health/ready");

        Assert.Equal(HttpStatusCode.OK, live.StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, ready.StatusCode);
        var line = Assert.Single(CompletionLines(logs));
        Assert.Contains($"request={IdOf(ready)} ", line.Text);
        Assert.Contains("route=/health/ready status=503", line.Text);
        Assert.Equal(LogLevel.Warning, line.Level);
        Assert.DoesNotContain("synthetic-secret", line.Text);
    }

    [Fact]
    public async Task Log_entries_inside_the_request_carry_a_RequestId_scope()
    {
        var logs = new CapturingLoggerProvider();
        await using var app = await TestApplication.StartAsync(loggerProvider: logs, configureServices: UseThrowingHome);
        var token = await SignInAsync(app);

        using var response = await SendAsync(app, HttpMethod.Get, "/api/home?activityThroughDate=2026-10-23", token);

        var id = IdOf(response);
        var scoped = logs.Entries.Where(entry => entry.Text.Contains($"request {id}") || entry.Text.Contains($"request={id} ")).ToList();
        Assert.Equal(2, scoped.Count); // the handler's Error line and the completion line
        foreach (var entry in scoped)
        {
            var pairs = (entry.Scopes ?? []).OfType<IEnumerable<KeyValuePair<string, object>>>().SelectMany(p => p);
            Assert.Contains(pairs, pair => pair.Key == "RequestId" && (string?)pair.Value == id);
        }
    }

    [Fact]
    public async Task Exposed_header_is_sent_to_the_allowed_origin_only()
    {
        await using var app = await TestApplication.StartAsync();

        using var allowed = await SendAsync(app, HttpMethod.Get, "/health", configure: r => r.Headers.Add("Origin", AllowedOrigin));
        using var other = await SendAsync(app, HttpMethod.Get, "/health", configure: r => r.Headers.Add("Origin", "https://elsewhere.example"));

        Assert.Contains("X-Request-Id", Assert.Single(allowed.Headers.GetValues("Access-Control-Expose-Headers")));
        Assert.Equal(AllowedOrigin, Assert.Single(allowed.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.False(allowed.Headers.Contains("Access-Control-Allow-Credentials"));
        Assert.False(other.Headers.Contains("Access-Control-Expose-Headers"));
        Assert.False(other.Headers.Contains("Access-Control-Allow-Origin"));
    }
}
