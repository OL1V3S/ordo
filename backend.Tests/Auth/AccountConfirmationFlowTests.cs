using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using BudgetPlanner.Authentication;
using BudgetPlanner.Configuration;
using BudgetPlanner.Data;
using BudgetPlanner.Services;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

public sealed class AccountConfirmationFlowTests
{
    private const string Password = "Password1!";
    private const string MalformedToken = "A";

    [Fact]
    public async Task Register_creates_user_and_sends_one_confirmation_email()
    {
        await using var app = await TestApplication.StartAsync();

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/register",
            new { email = "new@example.com", password = Password });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotNull(await app.FindUserByEmailAsync("new@example.com"));
        var sent = Assert.Single(app.EmailSender.Messages);
        Assert.Equal("new@example.com", sent.ToEmail);
        Assert.Equal("Confirm your Ordo account", sent.Subject);
        Assert.Contains(">Ordo</h2>", sent.HtmlBody);
        Assert.Contains("https://frontend.test/confirm-email?", sent.HtmlBody);
    }

    [Fact]
    public async Task Register_email_failure_leaves_user_persisted_and_returns_recovery_response()
    {
        await using var app = await TestApplication.StartAsync(EmailFailureMode.DeliveryFailure);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/register",
            new { email = "stranded@example.com", password = Password });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("confirmation_email_delivery_failed", body.GetProperty("code").GetString());
        var user = await app.FindUserByEmailAsync("stranded@example.com");
        Assert.NotNull(user);
        Assert.False(user.EmailConfirmed);
        Assert.Equal(1, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Register_creation_failure_is_distinct_and_does_not_send_email()
    {
        await using var app = await TestApplication.StartAsync();

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/register",
            new { email = "invalid@example.com", password = "weak" });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(JsonValueKind.Array, body.ValueKind);
        Assert.Null(await app.FindUserByEmailAsync("invalid@example.com"));
        Assert.Empty(app.EmailSender.Messages);
    }

    [Fact]
    public async Task Resend_sends_confirmation_for_existing_unconfirmed_account()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("unconfirmed@example.com", confirmed: false);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/resend-confirmation",
            new { email = "unconfirmed@example.com" });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal(TestApplication.GenericResendMessage, body.GetProperty("message").GetString());
        Assert.Single(app.EmailSender.Messages);
    }

    [Theory]
    [InlineData("missing@example.com", false)]
    [InlineData("confirmed@example.com", true)]
    public async Task Resend_has_same_public_response_without_sending_when_not_eligible(
        string email,
        bool createConfirmedUser)
    {
        await using var app = await TestApplication.StartAsync();
        if (createConfirmedUser)
            await app.CreateUserAsync(email, confirmed: true);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/resend-confirmation",
            new { email });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal(TestApplication.GenericResendMessage, body.GetProperty("message").GetString());
        Assert.Empty(app.EmailSender.Messages);
    }

    [Fact]
    public async Task Resend_does_not_reveal_delivery_failure()
    {
        await using var app = await TestApplication.StartAsync(EmailFailureMode.DeliveryFailure);
        await app.CreateUserAsync("unconfirmed@example.com", confirmed: false);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/resend-confirmation",
            new { email = "unconfirmed@example.com" });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal(TestApplication.GenericResendMessage, body.GetProperty("message").GetString());
        Assert.Equal(1, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Unexpected_email_boundary_exception_is_not_reported_as_delivery_failure()
    {
        await using var app = await TestApplication.StartAsync(EmailFailureMode.UnexpectedFailure);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            app.Client.PostAsJsonAsync(
                "/api/auth/register",
                new { email = "unexpected@example.com", password = Password }));

        Assert.Equal("Simulated programming failure.", exception.Message);
        Assert.Equal(1, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Email_boundary_cancellation_is_not_swallowed()
    {
        await using var app = await TestApplication.StartAsync(EmailFailureMode.Cancellation);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            app.Client.PostAsJsonAsync(
                "/api/auth/register",
                new { email = "cancelled@example.com", password = Password }));

        Assert.Equal(1, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Registration_email_contains_valid_confirmation_link_that_confirms_account()
    {
        await using var app = await TestApplication.StartAsync();
        var registration = await app.Client.PostAsJsonAsync(
            "/api/auth/register",
            new { email = "confirm@example.com", password = Password });
        Assert.Equal(HttpStatusCode.OK, registration.StatusCode);

        var sent = Assert.Single(app.EmailSender.Messages);
        var href = Regex.Match(sent.HtmlBody, "href=\"([^\"]+)\"").Groups[1].Value;
        var confirmationUri = new Uri(WebUtility.HtmlDecode(href));
        var query = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(confirmationUri.Query);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/confirm-email",
            new { userId = query["userId"].ToString(), token = query["token"].ToString() });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var createdUser = await app.FindUserByEmailAsync("confirm@example.com");
        Assert.NotNull(createdUser);
        var confirmedUser = await app.FindUserByIdAsync(createdUser.Id);
        Assert.NotNull(confirmedUser);
        Assert.True(confirmedUser.EmailConfirmed);
    }

    [Fact]
    public async Task Malformed_confirmation_token_returns_identity_invalid_token()
    {
        Assert.Throws<FormatException>(() => WebEncoders.Base64UrlDecode(MalformedToken));
        await using var app = await TestApplication.StartAsync();
        var user = await app.CreateUserAsync("malformed-confirmation@example.com", confirmed: false);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/confirm-email",
            new { userId = user.Id, token = MalformedToken });

        await AssertInvalidTokenAsync(response);
    }

    [Fact]
    public async Task Decodable_identity_invalid_confirmation_token_returns_identity_invalid_token()
    {
        await using var app = await TestApplication.StartAsync();
        var user = await app.CreateUserAsync("invalid-confirmation@example.com", confirmed: false);
        var encodedToken = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes("not-an-identity-token"));

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/confirm-email",
            new { userId = user.Id, token = encodedToken });

        await AssertInvalidTokenAsync(response);
    }

    [Fact]
    public async Task Confirmation_token_replay_preserves_current_identity_behavior()
    {
        await using var app = await TestApplication.StartAsync();
        var (userId, token) = await RegisterAndReadConfirmationLinkAsync(app, "replay-confirmation@example.com");

        var first = await app.Client.PostAsJsonAsync(
            "/api/auth/confirm-email",
            new { userId, token });
        var replay = await app.Client.PostAsJsonAsync(
            "/api/auth/confirm-email",
            new { userId, token });

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
    }

    [Fact]
    public async Task Expired_confirmation_token_returns_identity_invalid_token()
    {
        await using var app = await TestApplication.StartAsync(tokenLifespan: TimeSpan.FromTicks(-1));
        var (userId, token) = await RegisterAndReadConfirmationLinkAsync(app, "expired-confirmation@example.com");

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/confirm-email",
            new { userId, token });

        await AssertInvalidTokenAsync(response);
    }

    [Fact]
    public async Task Unconfirmed_user_cannot_log_in()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("unconfirmed@example.com", confirmed: false);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email = "unconfirmed@example.com", password = Password });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Confirmed_user_can_log_in()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("confirmed@example.com", confirmed: true);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email = "confirmed@example.com", password = Password });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static async Task<(string UserId, string Token)> RegisterAndReadConfirmationLinkAsync(
        TestApplication app,
        string email)
    {
        var registration = await app.Client.PostAsJsonAsync(
            "/api/auth/register",
            new { email, password = Password });
        Assert.Equal(HttpStatusCode.OK, registration.StatusCode);

        var sent = Assert.Single(app.EmailSender.Messages);
        var href = Regex.Match(sent.HtmlBody, "href=\"([^\"]+)\"").Groups[1].Value;
        var confirmationUri = new Uri(WebUtility.HtmlDecode(href));
        var query = QueryHelpers.ParseQuery(confirmationUri.Query);
        return (query["userId"].ToString(), query["token"].ToString());
    }

    private static async Task AssertInvalidTokenAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = await response.Content.ReadFromJsonAsync<JsonElement>();
        var error = Assert.Single(errors.EnumerateArray());
        Assert.Equal("InvalidToken", error.GetProperty("code").GetString());
        Assert.Equal("Invalid token.", error.GetProperty("description").GetString());
    }

    [Fact]
    public async Task Fourth_resend_for_same_normalized_email_is_rate_limited()
    {
        await using var app = await TestApplication.StartAsync();
        const string email = "target@example.com";

        for (var attempt = 0; attempt < ConfirmationResendLimiterOptions.DefaultRecipientPermitLimit; attempt++)
        {
            var allowed = await app.Client.PostAsJsonAsync(
                "/api/auth/resend-confirmation",
                new { email });
            Assert.Equal(HttpStatusCode.Accepted, allowed.StatusCode);
        }

        var limited = await app.Client.PostAsJsonAsync(
            "/api/auth/resend-confirmation",
            new { email });

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
    }

    [Fact]
    public async Task Email_casing_variations_share_one_rate_limit_bucket()
    {
        await using var app = await TestApplication.StartAsync();
        var variants = new[]
        {
            "CaseSensitive@example.com",
            "casesensitive@example.com",
            "CASESENSITIVE@EXAMPLE.COM"
        };

        foreach (var email in variants)
        {
            var allowed = await app.Client.PostAsJsonAsync(
                "/api/auth/resend-confirmation",
                new { email });
            Assert.Equal(HttpStatusCode.Accepted, allowed.StatusCode);
        }

        var limited = await app.Client.PostAsJsonAsync(
            "/api/auth/resend-confirmation",
            new { email = "CaSeSeNsItIvE@Example.Com" });

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
    }

    [Fact]
    public async Task Different_email_addresses_have_independent_rate_limit_buckets()
    {
        await using var app = await TestApplication.StartAsync();

        for (var attempt = 0; attempt < ConfirmationResendLimiterOptions.DefaultRecipientPermitLimit; attempt++)
        {
            var allowed = await app.Client.PostAsJsonAsync(
                "/api/auth/resend-confirmation",
                new { email = "first@example.com" });
            Assert.Equal(HttpStatusCode.Accepted, allowed.StatusCode);
        }

        var otherAddress = await app.Client.PostAsJsonAsync(
            "/api/auth/resend-confirmation",
            new { email = "second@example.com" });

        Assert.Equal(HttpStatusCode.Accepted, otherAddress.StatusCode);
    }

    [Theory]
    [InlineData("missing", 0)]
    [InlineData("confirmed", 0)]
    [InlineData("unconfirmed", 3)]
    public async Task Account_states_have_same_rate_limit_mechanics(
        string accountState,
        int expectedDeliveryAttempts)
    {
        await using var app = await TestApplication.StartAsync();
        const string email = "rate-limited@example.com";
        if (accountState == "confirmed")
            await app.CreateUserAsync(email, confirmed: true);
        else if (accountState == "unconfirmed")
            await app.CreateUserAsync(email, confirmed: false);

        for (var attempt = 0; attempt < ConfirmationResendLimiterOptions.DefaultRecipientPermitLimit; attempt++)
        {
            var allowed = await app.Client.PostAsJsonAsync(
                "/api/auth/resend-confirmation",
                new { email });
            Assert.Equal(HttpStatusCode.Accepted, allowed.StatusCode);
            var body = await allowed.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(TestApplication.GenericResendMessage, body.GetProperty("message").GetString());
        }

        var limited = await app.Client.PostAsJsonAsync(
            "/api/auth/resend-confirmation",
            new { email });

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.Equal(expectedDeliveryAttempts, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Concurrent_resends_cannot_exceed_email_bucket_allowance()
    {
        await using var app = await TestApplication.StartAsync();

        var requests = Enumerable.Range(0, 10).Select(_ =>
            app.Client.PostAsJsonAsync(
                "/api/auth/resend-confirmation",
                new { email = "concurrent@example.com" }));
        var responses = await Task.WhenAll(requests);

        Assert.Equal(
            ConfirmationResendLimiterOptions.DefaultRecipientPermitLimit,
            responses.Count(response => response.StatusCode == HttpStatusCode.Accepted));
        Assert.Equal(
            responses.Length - ConfirmationResendLimiterOptions.DefaultRecipientPermitLimit,
            responses.Count(response => response.StatusCode == HttpStatusCode.TooManyRequests));
    }

    [Fact]
    public async Task Global_limiter_rejects_after_configured_process_allowance()
    {
        const int globalLimit = 5;
        await using var app = await TestApplication.StartAsync(
            limiterSettings: new LimiterTestSettings(globalLimit));

        for (var attempt = 0; attempt < globalLimit; attempt++)
        {
            var allowed = await app.Client.PostAsJsonAsync(
                "/api/auth/resend-confirmation",
                new { email = $"global-{attempt}@example.com" });
            Assert.Equal(HttpStatusCode.Accepted, allowed.StatusCode);
        }

        var limited = await app.Client.PostAsJsonAsync(
            "/api/auth/resend-confirmation",
            new { email = "global-final@example.com" });

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.Empty(app.EmailSender.Messages);
    }

    [Fact]
    public async Task Global_rejection_skips_recipient_limiter_and_delivery()
    {
        var limiter = new RecordingConfirmationResendLimiter(acquireGlobal: false);
        await using var app = await TestApplication.StartAsync(limiterOverride: limiter);
        await app.CreateUserAsync("protected@example.com", confirmed: false);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/resend-confirmation",
            new { email = "protected@example.com" });

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.Equal(1, limiter.GlobalAttempts);
        Assert.Equal(0, limiter.RecipientAttempts);
        Assert.Equal(0, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Overlong_email_is_rejected_before_any_limiter_acquisition()
    {
        var limiter = new RecordingConfirmationResendLimiter(acquireGlobal: true);
        await using var app = await TestApplication.StartAsync(limiterOverride: limiter);
        var email = $"{new string('a', 243)}@example.com";
        Assert.True(email.Length > 254);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/resend-confirmation",
            new { email });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, limiter.GlobalAttempts);
        Assert.Equal(0, limiter.RecipientAttempts);
        Assert.Equal(0, app.EmailSender.AttemptCount);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not-an-email")]
    public async Task Missing_whitespace_and_malformed_email_have_controlled_boundary_response(
        string? email)
    {
        var limiter = new RecordingConfirmationResendLimiter(acquireGlobal: true);
        await using var app = await TestApplication.StartAsync(limiterOverride: limiter);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/resend-confirmation",
            new { email });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, limiter.GlobalAttempts);
        Assert.Equal(0, limiter.RecipientAttempts);
        Assert.Equal(0, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Missing_email_property_has_controlled_boundary_response()
    {
        var limiter = new RecordingConfirmationResendLimiter(acquireGlobal: true);
        await using var app = await TestApplication.StartAsync(limiterOverride: limiter);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/resend-confirmation",
            new { });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, limiter.GlobalAttempts);
        Assert.Equal(0, limiter.RecipientAttempts);
        Assert.Equal(0, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Production_composition_resolves_issue_services_and_validated_options()
    {
        await using var app = await TestApplication.StartAsync();
        using var scope = app.Services.CreateScope();
        var services = scope.ServiceProvider;

        Assert.NotNull(services.GetRequiredService<IAccountConfirmationService>());
        Assert.NotNull(services.GetRequiredService<IConfirmationResendLimiter>());
        Assert.Contains(
            services.GetServices<IValidateOptions<EmailSettingsOptions>>(),
            validator => validator is EmailSettingsOptionsValidator);
        Assert.Contains(
            services.GetServices<IValidateOptions<GoogleEmailOptions>>(),
            validator => validator is GoogleEmailOptionsValidator);
        Assert.Contains(
            services.GetServices<IValidateOptions<FrontendOptions>>(),
            validator => validator is FrontendOptionsValidator);
        Assert.Equal("sender@example.com", services.GetRequiredService<IOptions<EmailSettingsOptions>>().Value.FromEmail);
        Assert.Equal("test-client-id", services.GetRequiredService<IOptions<GoogleEmailOptions>>().Value.ClientId);
        Assert.IsType<GmailApiClient>(services.GetRequiredService<IGmailApiClient>());
        var limiterOptions = services.GetRequiredService<IOptions<ConfirmationResendLimiterOptions>>().Value;
        Assert.Equal(60, limiterOptions.GlobalPermitLimit);
        Assert.Equal(3, limiterOptions.RecipientPermitLimit);
        Assert.Equal(
            "Microsoft.EntityFrameworkCore.InMemory",
            services.GetRequiredService<BudgetContext>().Database.ProviderName);
    }
}

public sealed class AccountConfirmationConfigurationTests
{
    [Fact]
    public void Sender_configuration_rejects_missing_and_malformed_values()
    {
        var validator = new EmailSettingsOptionsValidator();

        var empty = validator.Validate(null, new EmailSettingsOptions());
        var malformed = validator.Validate(null, new EmailSettingsOptions
        {
            FromName = "Ordo",
            FromEmail = "not-an-email"
        });
        var valid = validator.Validate(null, new EmailSettingsOptions
        {
            FromName = "Ordo",
            FromEmail = "sender@example.com"
        });

        Assert.True(empty.Failed);
        Assert.True(malformed.Failed);
        Assert.True(valid.Succeeded);
    }

    [Fact]
    public void Google_email_configuration_requires_each_oauth_credential()
    {
        var validator = new GoogleEmailOptionsValidator();
        var valid = new GoogleEmailOptions
        {
            ClientId = "client-id",
            ClientSecret = "client-secret",
            RefreshToken = "refresh-token"
        };

        Assert.True(validator.Validate(null, new GoogleEmailOptions
        {
            ClientSecret = valid.ClientSecret,
            RefreshToken = valid.RefreshToken
        }).Failed);
        Assert.True(validator.Validate(null, new GoogleEmailOptions
        {
            ClientId = valid.ClientId,
            RefreshToken = valid.RefreshToken
        }).Failed);
        Assert.True(validator.Validate(null, new GoogleEmailOptions
        {
            ClientId = valid.ClientId,
            ClientSecret = valid.ClientSecret
        }).Failed);
        Assert.True(validator.Validate(null, valid).Succeeded);
    }

    [Fact]
    public void Frontend_configuration_requires_absolute_https_url_in_production()
    {
        var validator = new FrontendOptionsValidator(new TestHostEnvironment("Production"));

        Assert.True(validator.Validate(null, new FrontendOptions()).Failed);
        Assert.True(validator.Validate(null, new FrontendOptions { BaseUrl = "relative/path" }).Failed);
        Assert.True(validator.Validate(null, new FrontendOptions { BaseUrl = "http://example.com" }).Failed);
        Assert.True(validator.Validate(null, new FrontendOptions { BaseUrl = "https://example.com?bad=value" }).Failed);
        Assert.True(validator.Validate(null, new FrontendOptions { BaseUrl = "https://example.com" }).Succeeded);
    }
}

internal sealed class TestHostEnvironment(string environmentName) : IHostEnvironment
{
    public string EnvironmentName { get; set; } = environmentName;
    public string ApplicationName { get; set; } = "BudgetPlanner.Tests";
    public string ContentRootPath { get; set; } = Directory.GetCurrentDirectory();
    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
}
