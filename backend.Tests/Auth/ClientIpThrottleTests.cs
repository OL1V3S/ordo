using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using BudgetPlanner.Authentication;
using BudgetPlanner.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Xunit;
using Xunit.Abstractions;

namespace BudgetPlanner.Tests.Auth;

/// <summary>
/// Per-client-IP throttling on the six unauthenticated auth endpoints (#332).
/// Tests run in the "Testing" environment, so the forwarded-headers setup is
/// the same non-Development path used in production. Every test sets explicit
/// IPs through X-Forwarded-For and never relies on the shared "unknown" bucket.
/// </summary>
public sealed class ClientIpThrottleTests(ITestOutputHelper output)
{
    private const string Password = "Password1!";
    private const string Origin = "https://frontend.test";
    private const string Login = "/api/auth/login";
    private const string DeviceSession = "/api/auth/device-sessions";
    private const string WebSession = "/api/auth/web-session";
    private const string Register = "/api/auth/register";
    private const string Resend = "/api/auth/resend-confirmation";
    private const string Forgot = "/api/auth/forgot-password";

    public static TheoryData<string> AllEndpoints => new()
    {
        Login, DeviceSession, WebSession, Register, Resend, Forgot
    };

    public static TheoryData<string> SignInEndpoints => new() { Login, DeviceSession, WebSession };

    private static Action<IServiceCollection> Limits(int signIn, int email) => services =>
        services.Configure<ClientIpLimiterOptions>(options =>
        {
            options.SignInPermitLimit = signIn;
            options.EmailPermitLimit = email;
        });

    [Theory]
    [MemberData(nameof(AllEndpoints))]
    public async Task Requests_over_the_limit_get_429_and_other_ips_are_unaffected(string endpoint)
    {
        await using var app = await TestApplication.StartAsync(configureServices: Limits(2, 2));

        for (var i = 0; i < 2; i++)
            Assert.NotEqual(HttpStatusCode.TooManyRequests, (await PostAsync(app, endpoint, "10.0.0.1", $"u{i}@example.com")).StatusCode);

        var limited = await PostAsync(app, endpoint, "10.0.0.1", "u9@example.com");
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);

        Assert.NotEqual(HttpStatusCode.TooManyRequests, (await PostAsync(app, endpoint, "10.0.0.2", "u8@example.com")).StatusCode);
    }

    [Fact]
    public async Task Sign_in_endpoints_share_one_bucket_and_email_endpoints_share_another()
    {
        await using var app = await TestApplication.StartAsync(configureServices: Limits(3, 3));

        Assert.NotEqual(HttpStatusCode.TooManyRequests, (await PostAsync(app, Login, "10.0.1.1", "a@example.com")).StatusCode);
        Assert.NotEqual(HttpStatusCode.TooManyRequests, (await PostAsync(app, DeviceSession, "10.0.1.1", "b@example.com")).StatusCode);
        Assert.NotEqual(HttpStatusCode.TooManyRequests, (await PostAsync(app, WebSession, "10.0.1.1", "c@example.com")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await PostAsync(app, Login, "10.0.1.1", "d@example.com")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await PostAsync(app, WebSession, "10.0.1.1", "d@example.com")).StatusCode);

        // The email group is a separate bucket for the same IP.
        Assert.NotEqual(HttpStatusCode.TooManyRequests, (await PostAsync(app, Register, "10.0.1.1", "e@example.com")).StatusCode);
        Assert.NotEqual(HttpStatusCode.TooManyRequests, (await PostAsync(app, Resend, "10.0.1.1", "f@example.com")).StatusCode);
        Assert.NotEqual(HttpStatusCode.TooManyRequests, (await PostAsync(app, Forgot, "10.0.1.1", "g@example.com")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await PostAsync(app, Register, "10.0.1.1", "h@example.com")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await PostAsync(app, Forgot, "10.0.1.1", "h@example.com")).StatusCode);
    }

    [Theory]
    [MemberData(nameof(SignInEndpoints))]
    public async Task Per_ip_429_costs_no_hash_and_does_not_count_toward_lockout(string endpoint)
    {
        var counter = new PasswordCheckCounter();
        await using var app = await TestApplication.StartAsync(configureServices: services =>
        {
            Limits(2, 10)(services);
            services.RemoveAll<IPasswordHasher<ApplicationUser>>();
            services.AddScoped<IPasswordHasher<ApplicationUser>>(provider => new CountingPasswordHasher(
                new PasswordHasher<ApplicationUser>(provider.GetRequiredService<IOptions<PasswordHasherOptions>>()),
                counter));
        });
        await app.CreateUserAsync("limited@example.com", confirmed: true);

        counter.Reset();
        for (var i = 0; i < 2; i++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(app, endpoint, "10.0.2.1", "limited@example.com", "Wrong-password1!")).StatusCode);
        Assert.Equal(2, counter.Value);

        for (var i = 0; i < 6; i++)
            Assert.Equal(HttpStatusCode.TooManyRequests, (await PostAsync(app, endpoint, "10.0.2.1", "limited@example.com", "Wrong-password1!")).StatusCode);

        Assert.Equal((2, 0), (counter.Value, counter.Dummy));
        var stored = (await app.FindUserByEmailAsync("limited@example.com"))!;
        Assert.Equal(2, stored.AccessFailedCount);
        Assert.Null(stored.LockoutEnd);
    }

    [Fact]
    public async Task Per_ip_rejection_does_not_use_up_global_or_per_email_limits()
    {
        var forgot = new RecordingForgotPasswordLimiter(acquireGlobal: true);
        var resend = new RecordingConfirmationResendLimiter(acquireGlobal: true);
        await using var app = await TestApplication.StartAsync(
            forgotPasswordLimiterOverride: forgot,
            limiterOverride: resend,
            configureServices: Limits(10, 1));

        Assert.NotEqual(HttpStatusCode.TooManyRequests, (await PostAsync(app, Forgot, "10.0.3.1", "x@example.com")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await PostAsync(app, Forgot, "10.0.3.1", "x@example.com")).StatusCode);
        Assert.Equal(1, forgot.GlobalAttempts);
        Assert.Equal(1, forgot.RecipientAttempts);

        Assert.Equal(HttpStatusCode.TooManyRequests, (await PostAsync(app, Resend, "10.0.3.1", "x@example.com")).StatusCode);
        Assert.Equal((0, 0), (resend.GlobalAttempts, resend.RecipientAttempts));
    }

    [Fact]
    public async Task The_rightmost_forwarded_entry_is_the_client_and_a_spoofed_left_entry_is_ignored()
    {
        await using var app = await TestApplication.StartAsync(configureServices: Limits(1, 10));

        Assert.NotEqual(HttpStatusCode.TooManyRequests, (await PostAsync(app, Login, "9.9.9.9, 10.0.4.1", "s@example.com")).StatusCode);
        // Different spoofed left entry, same edge-appended IP: same bucket.
        Assert.Equal(HttpStatusCode.TooManyRequests, (await PostAsync(app, Login, "8.8.8.8, 10.0.4.1", "s@example.com")).StatusCode);
        // Same left entry, different edge-appended IP: separate bucket.
        Assert.NotEqual(HttpStatusCode.TooManyRequests, (await PostAsync(app, Login, "9.9.9.9, 10.0.4.2", "s@example.com")).StatusCode);
    }

    // Measurement for #332 criterion 6; opt in with ORDO_MEASURE_TIMING=1.
    [Fact]
    public async Task Measure_known_wrong_password_versus_unknown_email_timing()
    {
        if (Environment.GetEnvironmentVariable("ORDO_MEASURE_TIMING") != "1")
            return;

        const int warmUp = 20;
        const int runs = 200;
        await using var app = await TestApplication.StartAsync(
            configureServices: Limits(int.MaxValue, int.MaxValue));
        await app.CreateUserAsync("known@example.com", confirmed: true);

        async Task<double> TimeOnce(string email)
        {
            using var scope = app.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = await users.FindByEmailAsync("known@example.com");
            await users.ResetAccessFailedCountAsync(user!);

            var watch = Stopwatch.StartNew();
            var response = await PostAsync(app, Login, "10.0.9.9", email, "Wrong-password1!");
            watch.Stop();
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            return watch.Elapsed.TotalMilliseconds;
        }

        for (var i = 0; i < warmUp; i++)
        {
            await TimeOnce("known@example.com");
            await TimeOnce("nobody@example.com");
        }

        var known = new List<double>();
        var unknown = new List<double>();
        for (var i = 0; i < runs; i++)
        {
            known.Add(await TimeOnce("known@example.com"));
            unknown.Add(await TimeOnce("nobody@example.com"));
        }

        var knownMedian = Median(known);
        var unknownMedian = Median(unknown);
        output.WriteLine(
            $"TIMING runs={runs} warmup={warmUp} os={Environment.OSVersion} cpus={Environment.ProcessorCount} " +
            $"runtime={Environment.Version} provider=InMemory hasher=PasswordHasher(default)");
        output.WriteLine(
            $"TIMING known-wrong-password median={knownMedian:F2}ms unknown-email median={unknownMedian:F2}ms " +
            $"diff={Math.Abs(knownMedian - unknownMedian) / knownMedian * 100:F2}% of known median");
    }

    private static double Median(List<double> values)
    {
        var sorted = values.OrderBy(value => value).ToList();
        return sorted.Count % 2 == 1
            ? sorted[sorted.Count / 2]
            : (sorted[sorted.Count / 2 - 1] + sorted[sorted.Count / 2]) / 2;
    }

    private static Task<HttpResponseMessage> PostAsync(
        TestApplication app, string endpoint, string forwardedFor, string email, string password = Password)
    {
        object body = endpoint switch
        {
            Register => new { email, password, language = "en" },
            Resend or Forgot => new { email },
            _ => new { email, password }
        };
        var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = JsonContent.Create(body)
        };
        request.Headers.Add("X-Forwarded-For", forwardedFor);
        if (endpoint == WebSession)
        {
            request.Headers.Add("Origin", Origin);
            request.Headers.Add("X-Ordo-Web-Session", "1");
        }
        return app.Client.SendAsync(request);
    }
}
