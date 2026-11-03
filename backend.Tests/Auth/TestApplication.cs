using System.Collections.Concurrent;
using System.Threading.Channels;
using BudgetPlanner.Authentication;
using BudgetPlanner.Configuration;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using BudgetPlanner.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BudgetPlanner.Tests.Auth;

internal sealed class TestApplication : WebApplicationFactory<Program>
{
    private static readonly object HostStartupLock = new();

    public const string GenericResendMessage =
        "If an unconfirmed account exists for that email, a confirmation link has been sent.";
    public const string GenericForgotPasswordMessage =
        "If the email exists, a reset link was sent.";

    private readonly string _databaseName = $"confirmation-tests-{Guid.NewGuid()}";
    private readonly LimiterTestSettings? _limiterSettings;
    private readonly IConfirmationResendLimiter? _limiterOverride;
    private readonly ForgotPasswordLimiterTestSettings? _forgotPasswordLimiterSettings;
    private readonly IForgotPasswordLimiter? _forgotPasswordLimiterOverride;
    private readonly TimeSpan? _tokenLifespan;
    private readonly TimeProvider? _timeProvider;
    private readonly Action<DeviceSessionOptions>? _configureDeviceSessions;
    private readonly ILoggerProvider? _loggerProvider;
    private readonly RegistrationLimiterTestSettings? _registrationLimiterSettings;
    private readonly string _environment;
    private readonly Action<IServiceCollection>? _configureServices;

    private TestApplication(
        EmailFailureMode emailFailureMode,
        LimiterTestSettings? limiterSettings,
        IConfirmationResendLimiter? limiterOverride,
        ForgotPasswordLimiterTestSettings? forgotPasswordLimiterSettings,
        IForgotPasswordLimiter? forgotPasswordLimiterOverride,
        TimeSpan? tokenLifespan,
        TimeProvider? timeProvider,
        Action<DeviceSessionOptions>? configureDeviceSessions,
        ILoggerProvider? loggerProvider,
        RegistrationLimiterTestSettings? registrationLimiterSettings,
        string environment,
        Action<IServiceCollection>? configureServices)
    {
        _environment = environment;
        _configureServices = configureServices;
        EmailSender = new FakeEmailService(emailFailureMode);
        _limiterSettings = limiterSettings;
        _limiterOverride = limiterOverride;
        _forgotPasswordLimiterSettings = forgotPasswordLimiterSettings;
        _forgotPasswordLimiterOverride = forgotPasswordLimiterOverride;
        _tokenLifespan = tokenLifespan;
        _timeProvider = timeProvider;
        _configureDeviceSessions = configureDeviceSessions;
        _loggerProvider = loggerProvider;
        _registrationLimiterSettings = registrationLimiterSettings;
    }

    public HttpClient Client { get; private set; } = null!;
    public FakeEmailService EmailSender { get; }

    public static Task<TestApplication> StartAsync(
        EmailFailureMode emailFailureMode = EmailFailureMode.None,
        LimiterTestSettings? limiterSettings = null,
        IConfirmationResendLimiter? limiterOverride = null,
        ForgotPasswordLimiterTestSettings? forgotPasswordLimiterSettings = null,
        IForgotPasswordLimiter? forgotPasswordLimiterOverride = null,
        TimeSpan? tokenLifespan = null,
        TimeProvider? timeProvider = null,
        Action<DeviceSessionOptions>? configureDeviceSessions = null,
        ILoggerProvider? loggerProvider = null,
        RegistrationLimiterTestSettings? registrationLimiterSettings = null,
        string environment = "Testing",
        Action<IServiceCollection>? configureServices = null)
    {
        var application = new TestApplication(
            emailFailureMode,
            limiterSettings,
            limiterOverride,
            forgotPasswordLimiterSettings,
            forgotPasswordLimiterOverride,
            tokenLifespan,
            timeProvider,
            configureDeviceSessions,
            loggerProvider,
            registrationLimiterSettings,
            environment,
            configureServices);
        lock (HostStartupLock)
        {
            var originalEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
            var originalJwtKey = Environment.GetEnvironmentVariable("Jwt__Key");
            try
            {
                Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", environment);
                Environment.SetEnvironmentVariable(
                    "Jwt__Key",
                    "test-only-signing-key-that-is-at-least-thirty-two-bytes-long");
                application.Client = application.CreateClient();
            }
            finally
            {
                Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", originalEnvironment);
                Environment.SetEnvironmentVariable("Jwt__Key", originalJwtKey);
            }
        }
        return Task.FromResult(application);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(_environment);
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<BudgetContext>>();
            services.RemoveAll<IDbContextOptionsConfiguration<BudgetContext>>();
            services.AddDbContext<BudgetContext>(options =>
                options.UseInMemoryDatabase(_databaseName));

            services.RemoveAll<IEmailService>();
            services.AddSingleton<IEmailService>(EmailSender);

            // Test-only: wraps the real queue so tests can wait until the worker has
            // finished every queued email (no sleeps, no production API).
            services.RemoveAll<IBackgroundEmailQueue>();
            services.AddSingleton<IBackgroundEmailQueue>(new TrackingBackgroundEmailQueue());

            if (_tokenLifespan != null)
            {
                services.Configure<DataProtectionTokenProviderOptions>(options =>
                    options.TokenLifespan = _tokenLifespan.Value);
            }

            if (_limiterSettings != null)
            {
                services.Configure<ConfirmationResendLimiterOptions>(options =>
                {
                    options.GlobalPermitLimit = _limiterSettings.GlobalPermitLimit;
                    options.RecipientPermitLimit = _limiterSettings.RecipientPermitLimit;
                });
            }

            if (_limiterOverride != null)
            {
                services.RemoveAll<IConfirmationResendLimiter>();
                services.AddSingleton(_limiterOverride);
            }

            if (_forgotPasswordLimiterSettings != null)
            {
                services.Configure<ForgotPasswordLimiterOptions>(options =>
                {
                    options.GlobalPermitLimit = _forgotPasswordLimiterSettings.GlobalPermitLimit;
                    options.RecipientPermitLimit = _forgotPasswordLimiterSettings.RecipientPermitLimit;
                });
            }

            if (_forgotPasswordLimiterOverride != null)
            {
                services.RemoveAll<IForgotPasswordLimiter>();
                services.AddSingleton(_forgotPasswordLimiterOverride);
            }

            if (_registrationLimiterSettings != null)
            {
                services.Configure<RegistrationLimiterOptions>(options =>
                {
                    options.GlobalPermitLimit = _registrationLimiterSettings.GlobalPermitLimit;
                    options.RecipientPermitLimit = _registrationLimiterSettings.RecipientPermitLimit;
                });
            }

            if (_timeProvider != null)
            {
                services.RemoveAll<TimeProvider>();
                services.AddSingleton(_timeProvider);
            }

            if (_configureDeviceSessions != null)
                services.Configure(_configureDeviceSessions);

            // Per-IP limiter (#332) is covered in ClientIpThrottleTests; other tests send many requests from one IP.
            services.Configure<BudgetPlanner.Authentication.ClientIpLimiterOptions>(o =>
            {
                o.SignInPermitLimit = int.MaxValue;
                o.EmailPermitLimit = int.MaxValue;
            });
            _configureServices?.Invoke(services);
        });

        if (_loggerProvider != null)
            builder.ConfigureLogging(logging => logging.AddProvider(_loggerProvider));
    }

    protected override IHost CreateHost(IHostBuilder builder)
    {
        builder.ConfigureAppConfiguration(configuration =>
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = "Host=unused-by-tests",
                ["Jwt:Key"] = "test-only-signing-key-that-is-at-least-thirty-two-bytes-long",
                ["EmailSettings:FromName"] = "Ordo Tests",
                ["EmailSettings:FromEmail"] = "sender@example.com",
                ["GoogleEmail:ClientId"] = "test-client-id",
                ["GoogleEmail:ClientSecret"] = "test-client-secret",
                ["GoogleEmail:RefreshToken"] = "test-refresh-token",
                ["Frontend:BaseUrl"] = "https://frontend.test"
            }));

        return base.CreateHost(builder);
    }

    public TrackingBackgroundEmailQueue EmailQueue =>
        (TrackingBackgroundEmailQueue)Services.GetRequiredService<IBackgroundEmailQueue>();

    /// <summary>Waits until the background worker has finished every email queued so far.</summary>
    public Task WaitForEmailQueueIdleAsync() => EmailQueue.WaitForIdleAsync();

    public async Task<ApplicationUser> CreateUserAsync(string email, bool confirmed)
    {
        using var scope = Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = new ApplicationUser { UserName = email, Email = email };
        var createResult = await users.CreateAsync(user, "Password1!");
        if (!createResult.Succeeded)
            throw new InvalidOperationException(string.Join(", ", createResult.Errors.Select(error => error.Description)));

        if (confirmed)
        {
            var token = await users.GenerateEmailConfirmationTokenAsync(user);
            var confirmResult = await users.ConfirmEmailAsync(user, token);
            if (!confirmResult.Succeeded)
                throw new InvalidOperationException("Unable to confirm test user.");
        }

        return user;
    }

    public async Task<ApplicationUser?> FindUserByEmailAsync(string email)
    {
        using var scope = Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        return await users.FindByEmailAsync(email);
    }

    public async Task<ApplicationUser?> FindUserByIdAsync(string userId)
    {
        using var scope = Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        return await users.FindByIdAsync(userId);
    }

    public async Task<IReadOnlyList<DeviceSession>> GetDeviceSessionsAsync()
    {
        using var scope = Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        return await context.DeviceSessions.AsNoTracking().OrderBy(value => value.CreatedAt).ToListAsync();
    }

    public async Task<int> CountDeviceSessionsAsync(string? ownerId = null)
    {
        using var scope = Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        return await context.DeviceSessions.CountAsync(value => ownerId == null || value.OwnerId == ownerId);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
            Client?.Dispose();
        base.Dispose(disposing);
    }
}

internal enum EmailFailureMode
{
    None,
    DeliveryFailure,
    UnexpectedFailure,
    Cancellation
}

internal sealed record LimiterTestSettings(
    int GlobalPermitLimit,
    int RecipientPermitLimit = ConfirmationResendLimiterOptions.DefaultRecipientPermitLimit);

internal sealed record ForgotPasswordLimiterTestSettings(
    int GlobalPermitLimit,
    int RecipientPermitLimit = ForgotPasswordLimiterOptions.DefaultRecipientPermitLimit);

internal sealed record RegistrationLimiterTestSettings(
    int GlobalPermitLimit = RegistrationLimiterOptions.DefaultGlobalPermitLimit,
    int RecipientPermitLimit = RegistrationLimiterOptions.DefaultRecipientPermitLimit);

internal sealed class RecordingConfirmationResendLimiter(
    bool acquireGlobal,
    bool acquireRecipient = true) : IConfirmationResendLimiter
{
    private int _globalAttempts;
    private int _recipientAttempts;

    public int GlobalAttempts => _globalAttempts;
    public int RecipientAttempts => _recipientAttempts;
    public ConcurrentQueue<string> RecipientEmails { get; } = new();

    public bool TryAcquireGlobal()
    {
        Interlocked.Increment(ref _globalAttempts);
        return acquireGlobal;
    }

    public bool TryAcquireRecipient(string requestedEmail)
    {
        Interlocked.Increment(ref _recipientAttempts);
        RecipientEmails.Enqueue(requestedEmail);
        return acquireRecipient;
    }
}

internal sealed class RecordingForgotPasswordLimiter(
    bool acquireGlobal,
    bool acquireRecipient = true) : IForgotPasswordLimiter
{
    private int _globalAttempts;
    private int _recipientAttempts;

    public int GlobalAttempts => _globalAttempts;
    public int RecipientAttempts => _recipientAttempts;
    public ConcurrentQueue<string> RecipientEmails { get; } = new();

    public bool TryAcquireGlobal()
    {
        Interlocked.Increment(ref _globalAttempts);
        return acquireGlobal;
    }

    public bool TryAcquireRecipient(string requestedEmail)
    {
        Interlocked.Increment(ref _recipientAttempts);
        RecipientEmails.Enqueue(requestedEmail);
        return acquireRecipient;
    }
}

internal sealed class FakeEmailService(EmailFailureMode failureMode) : IEmailService
{
    private static readonly TimeSpan SafetyTimeout = TimeSpan.FromSeconds(30);

    private int _attemptCount;
    private readonly ConcurrentQueue<SentEmail> _messages = new();
    private int _receivedCancellableToken;
    private readonly SemaphoreSlim _sendEntered = new(0);
    private volatile TaskCompletionSource? _gate;
    private volatile EmailFailureMode _failureMode = failureMode;

    public int AttemptCount => _attemptCount;
    public IReadOnlyCollection<SentEmail> Messages => _messages.ToArray();
    public bool ReceivedCancellableToken => Volatile.Read(ref _receivedCancellableToken) == 1;

    /// <summary>Changes how later sends behave. Change it only while the queue is idle.</summary>
    public EmailFailureMode FailureMode
    {
        get => _failureMode;
        set => _failureMode = value;
    }

    /// <summary>Makes every later send wait until <see cref="ReleaseSends"/>.</summary>
    public void BlockSends() =>
        _gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

    public void ReleaseSends() => _gate?.TrySetResult();

    /// <summary>Completes once a send has started (one per send).</summary>
    public Task WaitForSendEnteredAsync() => _sendEntered.WaitAsync(SafetyTimeout);

    public async Task SendEmailAsync(
        string toEmail,
        string subject,
        string htmlBody,
        CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref _attemptCount);
        if (cancellationToken.CanBeCanceled)
            Interlocked.Exchange(ref _receivedCancellableToken, 1);

        _sendEntered.Release();
        var gate = _gate;
        if (gate != null)
            await gate.Task.WaitAsync(SafetyTimeout, cancellationToken);

        switch (_failureMode)
        {
            case EmailFailureMode.DeliveryFailure:
                throw new EmailDeliveryException(
                    "Simulated delivery failure.",
                    new IOException("Simulated provider failure."));
            case EmailFailureMode.UnexpectedFailure:
                throw new InvalidOperationException("Simulated programming failure.");
            case EmailFailureMode.Cancellation:
                throw new OperationCanceledException(cancellationToken);
        }

        _messages.Enqueue(new SentEmail(toEmail, subject, htmlBody));
    }
}

/// <summary>
/// Test-only wrapper over the real queue. Counts queued and finished items so tests
/// can wait for the single-reader worker to be idle. An item counts as finished when
/// the worker next asks the reader for more.
/// </summary>
internal sealed class TrackingBackgroundEmailQueue : IBackgroundEmailQueue
{
    private static readonly TimeSpan SafetyTimeout = TimeSpan.FromSeconds(30);

    private readonly BackgroundEmailQueue _inner;
    private readonly object _lock = new();
    private TaskCompletionSource _changed = NewSignal();
    private int _enqueued;
    private int _taken;
    private int _finished;
    private int _dropped;

    public TrackingBackgroundEmailQueue(int capacity = BackgroundEmailQueue.DefaultCapacity)
    {
        _inner = new BackgroundEmailQueue(capacity);
        Reader = new TrackingReader(this, _inner.Reader);
    }

    public ChannelReader<BackgroundEmailJob> Reader { get; }

    public int DroppedCount
    {
        get { lock (_lock) return _dropped; }
    }

    public bool TryEnqueue(BackgroundEmailJob job)
    {
        lock (_lock)
            _enqueued++;

        var accepted = _inner.TryEnqueue(job);
        if (!accepted)
        {
            lock (_lock)
            {
                _enqueued--;
                _dropped++;
                Signal();
            }
        }

        return accepted;
    }

    public async Task WaitForIdleAsync()
    {
        while (true)
        {
            Task changed;
            lock (_lock)
            {
                if (_finished == _enqueued)
                    return;
                changed = _changed.Task;
            }

            await changed.WaitAsync(SafetyTimeout);
        }
    }

    private static TaskCompletionSource NewSignal() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    private void Signal()
    {
        _changed.TrySetResult();
        _changed = NewSignal();
    }

    private void WorkerAsksForMore()
    {
        lock (_lock)
        {
            if (_finished == _taken)
                return;
            _finished = _taken;
            Signal();
        }
    }

    private void ItemTaken()
    {
        lock (_lock)
            _taken++;
    }

    private sealed class TrackingReader(
        TrackingBackgroundEmailQueue owner,
        ChannelReader<BackgroundEmailJob> inner) : ChannelReader<BackgroundEmailJob>
    {
        public override bool TryRead(out BackgroundEmailJob item)
        {
            owner.WorkerAsksForMore();
            if (!inner.TryRead(out item))
                return false;
            owner.ItemTaken();
            return true;
        }

        public override ValueTask<bool> WaitToReadAsync(CancellationToken cancellationToken = default)
        {
            owner.WorkerAsksForMore();
            return inner.WaitToReadAsync(cancellationToken);
        }
    }
}

internal sealed record SentEmail(string ToEmail, string Subject, string HtmlBody);

/// <summary>A clock tests can move, so idle and absolute expiry are exercised without waiting.</summary>
internal sealed class TestClock(DateTimeOffset start) : TimeProvider
{
    private DateTimeOffset _now = start;

    public override DateTimeOffset GetUtcNow() => _now;

    public void Advance(TimeSpan by) => _now += by;
}

internal sealed class CapturingLoggerProvider : ILoggerProvider, ISupportExternalScope
{
    private readonly ConcurrentQueue<string> _messages = new();

    private readonly ConcurrentQueue<CapturedLog> _entries = new();

    private IExternalScopeProvider? _scopes;

    public IReadOnlyCollection<string> Messages => _messages.ToArray();
    public IReadOnlyCollection<CapturedLog> Entries => _entries.ToArray();

    public void SetScopeProvider(IExternalScopeProvider scopeProvider) => _scopes = scopeProvider;

    public ILogger CreateLogger(string categoryName) =>
        new CapturingLogger(categoryName, _messages, _entries, () => _scopes);

    public void Dispose() { }

    private sealed class CapturingLogger(
        string category,
        ConcurrentQueue<string> messages,
        ConcurrentQueue<CapturedLog> entries,
        Func<IExternalScopeProvider?> scopes) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => scopes()?.Push(state);

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter) =>
            Record(logLevel, state, exception, formatter);

        private void Record<TState>(
            LogLevel logLevel,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            var text = $"{category}: {formatter(state, exception)} {exception}";
            var activeScopes = new List<object?>();
            scopes()?.ForEachScope(static (scope, list) => list.Add(scope), activeScopes);
            messages.Enqueue(text);
            entries.Enqueue(new CapturedLog(category, logLevel, text, exception is not null, activeScopes));
        }
    }
}

internal sealed record CapturedLog(
    string Category,
    LogLevel Level,
    string Text,
    bool HadException,
    IReadOnlyList<object?>? Scopes = null);
