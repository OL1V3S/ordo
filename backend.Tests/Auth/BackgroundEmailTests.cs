using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using BudgetPlanner.Models;
using BudgetPlanner.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

/// <summary>
/// Resend-confirmation and forgot-password send in the background (#319), so the
/// request does not wait for, or reveal, the send. No test uses sleeps; they wait on
/// the test-only queue-idle helper and on gated sends.
/// </summary>
public sealed class BackgroundEmailTests
{
    private static readonly TimeSpan SafetyTimeout = TimeSpan.FromSeconds(30);

    public static TheoryData<string> Endpoints => new() { "resend-confirmation", "forgot-password" };

    [Fact]
    public void Queue_never_waits_and_rejects_when_full()
    {
        var queue = new BackgroundEmailQueue(capacity: 1);
        var job = new BackgroundEmailJob("user", EmailLanguage.English, BackgroundEmailKind.PasswordReset);

        Assert.True(queue.TryEnqueue(job));
        Assert.False(queue.TryEnqueue(job));
        Assert.True(queue.Reader.TryRead(out _));
        Assert.True(queue.TryEnqueue(job));
        Assert.Equal(256, BackgroundEmailQueue.DefaultCapacity);
    }

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Request_returns_while_the_send_is_blocked_with_identical_responses(string endpoint)
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("known@example.com", confirmed: false);
        app.EmailSender.BlockSends();

        var known = await PostAsync(app, endpoint, "known@example.com");
        await app.EmailSender.WaitForSendEnteredAsync();
        var unknown = await PostAsync(app, endpoint, "unknown@example.com");

        // The known account's send is still blocked here, yet both requests returned.
        Assert.Equal(1, app.EmailSender.AttemptCount);
        Assert.Empty(app.EmailSender.Messages);
        Assert.Equal(await Snapshot(known), await Snapshot(unknown));

        app.EmailSender.ReleaseSends();
        await app.WaitForEmailQueueIdleAsync();
        Assert.Equal("known@example.com", Assert.Single(app.EmailSender.Messages).ToEmail);
    }

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Limiter_429_is_the_same_for_known_and_unknown_accounts_while_sends_are_blocked(
        string endpoint)
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("known@example.com", confirmed: false);
        app.EmailSender.BlockSends();
        HttpResponseMessage? knownLimited = null;
        HttpResponseMessage? unknownLimited = null;

        for (var attempt = 0; attempt <= 3; attempt++)
        {
            knownLimited = await PostAsync(app, endpoint, "known@example.com");
            unknownLimited = await PostAsync(app, endpoint, "unknown@example.com");
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, knownLimited!.StatusCode);
        Assert.Equal(await Snapshot(knownLimited), await Snapshot(unknownLimited!));
        app.EmailSender.ReleaseSends();
        await app.WaitForEmailQueueIdleAsync();
    }

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Delivery_failure_is_swallowed_and_logged_by_user_id_without_the_email(string endpoint)
    {
        var logs = new CapturingLoggerProvider();
        await using var app = await TestApplication.StartAsync(
            EmailFailureMode.DeliveryFailure,
            loggerProvider: logs);
        var user = await app.CreateUserAsync("private.person@example.com", confirmed: false);

        var response = await PostAsync(app, endpoint, "private.person@example.com");
        await app.WaitForEmailQueueIdleAsync();

        Assert.True(response.IsSuccessStatusCode);
        Assert.Equal(1, app.EmailSender.AttemptCount);
        var failure = Assert.Single(logs.Entries, entry =>
            entry.Category.EndsWith(nameof(BackgroundEmailWorker)) && entry.Level == LogLevel.Warning);
        Assert.Contains(user.Id, failure.Text);
        Assert.DoesNotContain(
            logs.Entries,
            entry => entry.Text.Contains("private.person", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Non_delivery_exception_and_cancellation_give_the_normal_response(string endpoint)
    {
        foreach (var mode in new[] { EmailFailureMode.UnexpectedFailure, EmailFailureMode.Cancellation })
        {
            var logs = new CapturingLoggerProvider();
            await using var app = await TestApplication.StartAsync(mode, loggerProvider: logs);
            await app.CreateUserAsync("known@example.com", confirmed: false);

            var known = await PostAsync(app, endpoint, "known@example.com");
            var unknown = await PostAsync(app, endpoint, "unknown@example.com");
            await app.WaitForEmailQueueIdleAsync();

            Assert.True(known.IsSuccessStatusCode);
            Assert.Equal(await Snapshot(known), await Snapshot(unknown));
            Assert.Equal(1, app.EmailSender.AttemptCount);
            Assert.True(app.EmailSender.ReceivedCancellableToken);
            Assert.DoesNotContain(logs.Entries, entry => entry.Text.Contains("known@example.com"));
        }
    }

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Worker_keeps_running_after_a_thrown_exception(string endpoint)
    {
        await using var app = await TestApplication.StartAsync(EmailFailureMode.UnexpectedFailure);
        await app.CreateUserAsync("first@example.com", confirmed: false);
        await app.CreateUserAsync("second@example.com", confirmed: false);

        await PostAsync(app, endpoint, "first@example.com");
        await app.WaitForEmailQueueIdleAsync();
        app.EmailSender.FailureMode = EmailFailureMode.None;
        await PostAsync(app, endpoint, "second@example.com");
        await app.WaitForEmailQueueIdleAsync();

        Assert.Equal(2, app.EmailSender.AttemptCount);
        Assert.Equal("second@example.com", Assert.Single(app.EmailSender.Messages).ToEmail);
    }

    [Fact]
    public async Task Worker_survives_every_failure_before_the_send_and_logs_the_user_id_only()
    {
        var logs = new CapturingLoggerProvider();
        using var loggerFactory = LoggerFactory.Create(builder => builder.AddProvider(logs));
        var scopes = new ThrowingScopeFactory();
        var queue = new BackgroundEmailQueue();
        var worker = new BackgroundEmailWorker(
            queue,
            scopes,
            new ConfigurationBuilder().Build(),
            loggerFactory.CreateLogger<BackgroundEmailWorker>());
        await worker.StartAsync(CancellationToken.None);

        Assert.True(queue.TryEnqueue(new BackgroundEmailJob(
            "user-one", EmailLanguage.English, BackgroundEmailKind.PasswordReset)));
        await scopes.WaitForCallAsync();
        Assert.True(queue.TryEnqueue(new BackgroundEmailJob(
            "user-two", EmailLanguage.English, BackgroundEmailKind.ConfirmationResend)));
        await scopes.WaitForCallAsync();
        await worker.StopAsync(CancellationToken.None);

        Assert.Equal(2, scopes.Calls);
        Assert.Equal(TaskStatus.RanToCompletion, worker.ExecuteTask!.Status);
        Assert.Contains(logs.Entries, entry =>
            entry.Level == LogLevel.Error && entry.Text.Contains("user-one") && entry.Text.Contains("InvalidOperationException"));
    }

    [Fact]
    public async Task Full_queue_drops_the_item_with_a_warning_by_user_id_and_the_same_response()
    {
        var logs = new CapturingLoggerProvider();
        await using var app = await TestApplication.StartAsync(
            loggerProvider: logs,
            configureServices: services =>
            {
                services.RemoveAll<IBackgroundEmailQueue>();
                services.AddSingleton<IBackgroundEmailQueue>(new TrackingBackgroundEmailQueue(capacity: 1));
            });
        await app.CreateUserAsync("a@example.com", confirmed: true);
        await app.CreateUserAsync("b@example.com", confirmed: true);
        var dropped = await app.CreateUserAsync("c@example.com", confirmed: true);
        app.EmailSender.BlockSends();

        var first = await PostAsync(app, "forgot-password", "a@example.com");
        await app.EmailSender.WaitForSendEnteredAsync(); // worker holds item 1
        var second = await PostAsync(app, "forgot-password", "b@example.com"); // fills the queue
        var third = await PostAsync(app, "forgot-password", "c@example.com"); // dropped
        var unknown = await PostAsync(app, "forgot-password", "unknown@example.com");

        Assert.Equal(1, app.EmailQueue.DroppedCount);
        Assert.Equal(await Snapshot(first), await Snapshot(second));
        Assert.Equal(await Snapshot(first), await Snapshot(third));
        Assert.Equal(await Snapshot(first), await Snapshot(unknown));
        var warning = Assert.Single(logs.Entries, entry =>
            entry.Level == LogLevel.Warning && entry.Text.Contains("queue is full"));
        Assert.Contains(dropped.Id, warning.Text);
        Assert.DoesNotContain("c@example.com", warning.Text);

        app.EmailSender.ReleaseSends();
        await app.WaitForEmailQueueIdleAsync();
        Assert.Equal(
            new[] { "a@example.com", "b@example.com" },
            app.EmailSender.Messages.Select(message => message.ToEmail).Order().ToArray());
    }

    [Fact]
    public async Task Resend_sends_only_when_the_account_is_still_unconfirmed_when_the_worker_runs()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("blocker@example.com", confirmed: false);
        var raced = await app.CreateUserAsync("raced@example.com", confirmed: false);
        await app.CreateUserAsync("confirmed@example.com", confirmed: true);
        await app.CreateUserAsync("pending@example.com", confirmed: false);
        app.EmailSender.BlockSends();

        await PostAsync(app, "resend-confirmation", "blocker@example.com");
        await app.EmailSender.WaitForSendEnteredAsync();
        await PostAsync(app, "resend-confirmation", "raced@example.com");
        await PostAsync(app, "resend-confirmation", "confirmed@example.com");
        await PostAsync(app, "resend-confirmation", "missing@example.com");
        await PostAsync(app, "resend-confirmation", "pending@example.com");
        await ConfirmAsync(app, raced.Id); // confirmed after queueing, before the worker runs
        app.EmailSender.ReleaseSends();
        await app.WaitForEmailQueueIdleAsync();

        Assert.Equal(
            new[] { "blocker@example.com", "pending@example.com" },
            app.EmailSender.Messages.Select(message => message.ToEmail).Order().ToArray());
    }

    [Fact]
    public async Task A_user_deleted_after_queueing_is_skipped_and_the_worker_carries_on()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("blocker@example.com", confirmed: true);
        var deleted = await app.CreateUserAsync("deleted@example.com", confirmed: true);
        await app.CreateUserAsync("after@example.com", confirmed: true);
        app.EmailSender.BlockSends();

        await PostAsync(app, "forgot-password", "blocker@example.com");
        await app.EmailSender.WaitForSendEnteredAsync();
        await PostAsync(app, "forgot-password", "deleted@example.com");
        await PostAsync(app, "forgot-password", "after@example.com");
        using (var scope = app.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            Assert.True((await users.DeleteAsync((await users.FindByIdAsync(deleted.Id))!)).Succeeded);
        }

        app.EmailSender.ReleaseSends();
        await app.WaitForEmailQueueIdleAsync();

        Assert.Equal(
            new[] { "after@example.com", "blocker@example.com" },
            app.EmailSender.Messages.Select(message => message.ToEmail).Order().ToArray());
    }

    [Fact]
    public async Task Forgot_password_sends_to_and_links_the_stored_address()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("Mixed.Case@Example.com", confirmed: true);

        var response = await PostAsync(app, "forgot-password", "mixed.case@example.com");
        await app.WaitForEmailQueueIdleAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var sent = Assert.Single(app.EmailSender.Messages);
        Assert.Equal("Mixed.Case@Example.com", sent.ToEmail);
        var href = Regex.Match(sent.HtmlBody, "href=\"([^\"]+)\"").Groups[1].Value;
        var query = QueryHelpers.ParseQuery(new Uri(WebUtility.HtmlDecode(href)).Query);
        Assert.Equal("Mixed.Case@Example.com", query["email"].ToString());
    }

    [Fact]
    public async Task Stopping_the_host_with_a_send_in_flight_is_a_normal_stop()
    {
        var logs = new CapturingLoggerProvider();
        var app = await TestApplication.StartAsync(loggerProvider: logs);
        await app.CreateUserAsync("known@example.com", confirmed: true);
        app.EmailSender.BlockSends();
        await PostAsync(app, "forgot-password", "known@example.com");
        await app.EmailSender.WaitForSendEnteredAsync();

        await app.DisposeAsync();

        Assert.DoesNotContain(logs.Entries, entry =>
            entry.Category.EndsWith(nameof(BackgroundEmailWorker)) && entry.Level >= LogLevel.Warning);
    }

    private static Task<HttpResponseMessage> PostAsync(TestApplication app, string endpoint, string email) =>
        app.Client.PostAsJsonAsync($"/api/auth/{endpoint}", new { email });

    private static async Task<(HttpStatusCode Status, string? ContentType, string Body)> Snapshot(
        HttpResponseMessage response) =>
        (response.StatusCode, response.Content.Headers.ContentType?.ToString(),
            // The 429 problem body carries per-request trace and request IDs; nothing else differs.
            Regex.Replace(await response.Content.ReadAsStringAsync(), "\"(traceId|requestId)\":\"[^\"]*\"", "\"$1\":\"-\""));

    private static async Task ConfirmAsync(TestApplication app, string userId)
    {
        using var scope = app.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = (await users.FindByIdAsync(userId))!;
        var token = await users.GenerateEmailConfirmationTokenAsync(user);
        Assert.True((await users.ConfirmEmailAsync(user, token)).Succeeded);
    }

    private sealed class ThrowingScopeFactory : IServiceScopeFactory
    {
        private readonly SemaphoreSlim _called = new(0);
        private int _calls;

        public int Calls => Volatile.Read(ref _calls);

        public Task WaitForCallAsync() => _called.WaitAsync(SafetyTimeout);

        public IServiceScope CreateScope()
        {
            Interlocked.Increment(ref _calls);
            _called.Release();
            throw new InvalidOperationException("Simulated scope failure.");
        }
    }
}
