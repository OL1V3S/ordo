using System.Collections.Concurrent;
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

    private TestApplication(
        EmailFailureMode emailFailureMode,
        LimiterTestSettings? limiterSettings,
        IConfirmationResendLimiter? limiterOverride,
        ForgotPasswordLimiterTestSettings? forgotPasswordLimiterSettings,
        IForgotPasswordLimiter? forgotPasswordLimiterOverride,
        TimeSpan? tokenLifespan)
    {
        EmailSender = new FakeEmailService(emailFailureMode);
        _limiterSettings = limiterSettings;
        _limiterOverride = limiterOverride;
        _forgotPasswordLimiterSettings = forgotPasswordLimiterSettings;
        _forgotPasswordLimiterOverride = forgotPasswordLimiterOverride;
        _tokenLifespan = tokenLifespan;
    }

    public HttpClient Client { get; private set; } = null!;
    public FakeEmailService EmailSender { get; }

    public static Task<TestApplication> StartAsync(
        EmailFailureMode emailFailureMode = EmailFailureMode.None,
        LimiterTestSettings? limiterSettings = null,
        IConfirmationResendLimiter? limiterOverride = null,
        ForgotPasswordLimiterTestSettings? forgotPasswordLimiterSettings = null,
        IForgotPasswordLimiter? forgotPasswordLimiterOverride = null,
        TimeSpan? tokenLifespan = null)
    {
        var application = new TestApplication(
            emailFailureMode,
            limiterSettings,
            limiterOverride,
            forgotPasswordLimiterSettings,
            forgotPasswordLimiterOverride,
            tokenLifespan);
        lock (HostStartupLock)
        {
            var originalEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
            var originalJwtKey = Environment.GetEnvironmentVariable("Jwt__Key");
            try
            {
                Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Testing");
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
        builder.UseEnvironment("Testing");
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<BudgetContext>>();
            services.RemoveAll<IDbContextOptionsConfiguration<BudgetContext>>();
            services.AddDbContext<BudgetContext>(options =>
                options.UseInMemoryDatabase(_databaseName));

            services.RemoveAll<IEmailService>();
            services.AddSingleton<IEmailService>(EmailSender);

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
        });
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
    private int _attemptCount;
    private readonly ConcurrentQueue<SentEmail> _messages = new();
    private int _receivedCancellableToken;

    public int AttemptCount => _attemptCount;
    public IReadOnlyCollection<SentEmail> Messages => _messages.ToArray();
    public bool ReceivedCancellableToken => Volatile.Read(ref _receivedCancellableToken) == 1;

    public Task SendEmailAsync(
        string toEmail,
        string subject,
        string htmlBody,
        CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref _attemptCount);
        if (cancellationToken.CanBeCanceled)
            Interlocked.Exchange(ref _receivedCancellableToken, 1);

        switch (failureMode)
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
        return Task.CompletedTask;
    }
}

internal sealed record SentEmail(string ToEmail, string Subject, string HtmlBody);
