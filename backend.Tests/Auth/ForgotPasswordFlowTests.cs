using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using BudgetPlanner.Authentication;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

public sealed class ForgotPasswordFlowTests
{
    private const string ExistingEmail = "reset@example.com";
    private const string MalformedToken = "A";

    [Fact]
    public async Task Existing_account_gets_neutral_response_and_working_reset_email()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync(ExistingEmail, confirmed: true);

        var response = await PostForgotPasswordAsync(app, ExistingEmail);

        await AssertNeutralSuccessAsync(response);
        var sent = Assert.Single(app.EmailSender.Messages);
        Assert.Equal(ExistingEmail, sent.ToEmail);
        Assert.Equal("Reset your Ordo password", sent.Subject);
        Assert.Contains(">Ordo</h2>", sent.HtmlBody);

        var href = Regex.Match(sent.HtmlBody, "href=\"([^\"]+)\"").Groups[1].Value;
        var resetUri = new Uri(WebUtility.HtmlDecode(href));
        var query = QueryHelpers.ParseQuery(resetUri.Query);
        Assert.Equal(ExistingEmail, query["email"].ToString());

        var reset = await app.Client.PostAsJsonAsync(
            "/api/auth/reset-password",
            new
            {
                email = query["email"].ToString(),
                token = query["token"].ToString(),
                newPassword = "NewPassword1!"
            });

        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
    }

    [Fact]
    public async Task Malformed_reset_token_returns_identity_invalid_token()
    {
        Assert.Throws<FormatException>(() => WebEncoders.Base64UrlDecode(MalformedToken));
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync(ExistingEmail, confirmed: true);

        var response = await PostResetPasswordAsync(app, ExistingEmail, MalformedToken);

        await AssertInvalidTokenAsync(response);
    }

    [Fact]
    public async Task Decodable_identity_invalid_reset_token_returns_identity_invalid_token()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync(ExistingEmail, confirmed: true);
        var encodedToken = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes("not-an-identity-token"));

        var response = await PostResetPasswordAsync(app, ExistingEmail, encodedToken);

        await AssertInvalidTokenAsync(response);
    }

    [Fact]
    public async Task Successfully_used_reset_token_cannot_be_reused()
    {
        await using var app = await TestApplication.StartAsync();
        var token = await CreateResetTokenAsync(app, ExistingEmail);

        var first = await PostResetPasswordAsync(app, ExistingEmail, token);
        var replay = await PostResetPasswordAsync(app, ExistingEmail, token, "AnotherPassword1!");

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        await AssertInvalidTokenAsync(replay);
    }

    [Fact]
    public async Task Expired_reset_token_returns_identity_invalid_token()
    {
        await using var app = await TestApplication.StartAsync(tokenLifespan: TimeSpan.FromTicks(-1));
        var token = await CreateResetTokenAsync(app, ExistingEmail, confirmed: false);

        var response = await PostResetPasswordAsync(app, ExistingEmail, token);

        await AssertInvalidTokenAsync(response);
    }

    [Fact]
    public async Task Missing_account_gets_same_neutral_response_without_email_attempt()
    {
        await using var app = await TestApplication.StartAsync();

        var response = await PostForgotPasswordAsync(app, "missing@example.com");

        await AssertNeutralSuccessAsync(response);
        Assert.Equal(0, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Expected_delivery_failure_gets_same_neutral_response()
    {
        await using var app = await TestApplication.StartAsync(EmailFailureMode.DeliveryFailure);
        await app.CreateUserAsync(ExistingEmail, confirmed: true);

        var response = await PostForgotPasswordAsync(app, ExistingEmail);

        await AssertNeutralSuccessAsync(response);
        Assert.Equal(1, app.EmailSender.AttemptCount);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not-an-email")]
    public async Task Invalid_email_is_rejected_before_limiter_or_email_work(string? email)
    {
        var limiter = new RecordingForgotPasswordLimiter(acquireGlobal: true);
        await using var app = await TestApplication.StartAsync(forgotPasswordLimiterOverride: limiter);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/forgot-password",
            new { email });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, limiter.GlobalAttempts);
        Assert.Equal(0, limiter.RecipientAttempts);
        Assert.Equal(0, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Missing_email_property_is_rejected_before_limiter_or_email_work()
    {
        var limiter = new RecordingForgotPasswordLimiter(acquireGlobal: true);
        await using var app = await TestApplication.StartAsync(forgotPasswordLimiterOverride: limiter);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/forgot-password",
            new { });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, limiter.GlobalAttempts);
        Assert.Equal(0, limiter.RecipientAttempts);
        Assert.Equal(0, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Overlong_email_is_rejected_before_limiter_or_email_work()
    {
        var limiter = new RecordingForgotPasswordLimiter(acquireGlobal: true);
        await using var app = await TestApplication.StartAsync(forgotPasswordLimiterOverride: limiter);
        var email = $"{new string('a', 243)}@example.com";
        Assert.True(email.Length > 254);

        var response = await PostForgotPasswordAsync(app, email);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, limiter.GlobalAttempts);
        Assert.Equal(0, limiter.RecipientAttempts);
        Assert.Equal(0, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Casing_variations_share_one_recipient_bucket()
    {
        await using var app = await TestApplication.StartAsync();
        var variants = new[]
        {
            "CaseSensitive@example.com",
            "casesensitive@example.com",
            "CASESENSITIVE@EXAMPLE.COM"
        };

        foreach (var email in variants)
            await AssertNeutralSuccessAsync(await PostForgotPasswordAsync(app, email));

        var limited = await PostForgotPasswordAsync(app, "CaSeSeNsItIvE@Example.Com");
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
    }

    [Fact]
    public async Task Different_recipients_have_independent_buckets()
    {
        await using var app = await TestApplication.StartAsync();

        for (var attempt = 0; attempt < ForgotPasswordLimiterOptions.DefaultRecipientPermitLimit; attempt++)
            await AssertNeutralSuccessAsync(await PostForgotPasswordAsync(app, "first@example.com"));

        await AssertNeutralSuccessAsync(await PostForgotPasswordAsync(app, "second@example.com"));
    }

    [Fact]
    public async Task Global_limiter_rejects_after_configured_process_allowance()
    {
        const int globalLimit = 5;
        await using var app = await TestApplication.StartAsync(
            forgotPasswordLimiterSettings: new ForgotPasswordLimiterTestSettings(globalLimit));

        for (var attempt = 0; attempt < globalLimit; attempt++)
            await AssertNeutralSuccessAsync(await PostForgotPasswordAsync(app, $"global-{attempt}@example.com"));

        var limited = await PostForgotPasswordAsync(app, "global-final@example.com");
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.Equal(0, app.EmailSender.AttemptCount);
    }

    [Theory]
    [InlineData(false, 0)]
    [InlineData(true, 3)]
    public async Task Existing_and_missing_accounts_have_equivalent_limiter_mechanics(
        bool existing,
        int expectedEmailAttempts)
    {
        await using var app = await TestApplication.StartAsync();
        const string email = "rate-limited@example.com";
        if (existing)
            await app.CreateUserAsync(email, confirmed: true);

        for (var attempt = 0; attempt < ForgotPasswordLimiterOptions.DefaultRecipientPermitLimit; attempt++)
            await AssertNeutralSuccessAsync(await PostForgotPasswordAsync(app, email));

        var limited = await PostForgotPasswordAsync(app, email);
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.Equal(expectedEmailAttempts, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Global_rejection_skips_recipient_and_downstream_work()
    {
        var limiter = new RecordingForgotPasswordLimiter(acquireGlobal: false);
        await using var app = await TestApplication.StartAsync(forgotPasswordLimiterOverride: limiter);
        await app.CreateUserAsync(ExistingEmail, confirmed: true);

        var response = await PostForgotPasswordAsync(app, ExistingEmail);

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.Equal(1, limiter.GlobalAttempts);
        Assert.Equal(0, limiter.RecipientAttempts);
        Assert.Equal(0, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Recipient_rejection_skips_account_dependent_work()
    {
        var limiter = new RecordingForgotPasswordLimiter(acquireGlobal: true, acquireRecipient: false);
        await using var app = await TestApplication.StartAsync(forgotPasswordLimiterOverride: limiter);
        await app.CreateUserAsync(ExistingEmail, confirmed: true);

        var response = await PostForgotPasswordAsync(app, ExistingEmail);

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.Equal(1, limiter.GlobalAttempts);
        Assert.Equal(1, limiter.RecipientAttempts);
        Assert.Equal(0, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Concurrent_requests_cannot_exceed_recipient_allowance()
    {
        await using var app = await TestApplication.StartAsync();

        var responses = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ =>
            PostForgotPasswordAsync(app, "concurrent@example.com")));

        Assert.Equal(
            ForgotPasswordLimiterOptions.DefaultRecipientPermitLimit,
            responses.Count(response => response.StatusCode == HttpStatusCode.OK));
        Assert.Equal(
            responses.Length - ForgotPasswordLimiterOptions.DefaultRecipientPermitLimit,
            responses.Count(response => response.StatusCode == HttpStatusCode.TooManyRequests));
    }

    [Fact]
    public async Task Unexpected_email_exception_propagates()
    {
        await using var app = await TestApplication.StartAsync(EmailFailureMode.UnexpectedFailure);
        await app.CreateUserAsync(ExistingEmail, confirmed: true);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            PostForgotPasswordAsync(app, ExistingEmail));

        Assert.Equal("Simulated programming failure.", exception.Message);
        Assert.Equal(1, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Cancellation_propagates_and_request_token_reaches_email_boundary()
    {
        await using var app = await TestApplication.StartAsync(EmailFailureMode.Cancellation);
        await app.CreateUserAsync(ExistingEmail, confirmed: true);
        using var cancellation = new CancellationTokenSource();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            app.Client.PostAsJsonAsync(
                "/api/auth/forgot-password",
                new { email = ExistingEmail },
                cancellation.Token));

        Assert.Equal(1, app.EmailSender.AttemptCount);
        Assert.True(app.EmailSender.ReceivedCancellableToken);
    }

    [Fact]
    public async Task Production_composition_resolves_forgot_password_limiter_and_defaults()
    {
        await using var app = await TestApplication.StartAsync();
        using var scope = app.Services.CreateScope();
        var services = scope.ServiceProvider;

        Assert.IsType<ForgotPasswordLimiter>(services.GetRequiredService<IForgotPasswordLimiter>());
        var options = services.GetRequiredService<IOptions<ForgotPasswordLimiterOptions>>().Value;
        Assert.Equal(60, options.GlobalPermitLimit);
        Assert.Equal(3, options.RecipientPermitLimit);
        Assert.Equal(TimeSpan.FromMinutes(1), options.Window);
    }

    private static Task<HttpResponseMessage> PostForgotPasswordAsync(
        TestApplication app,
        string email) =>
        app.Client.PostAsJsonAsync("/api/auth/forgot-password", new { email });

    private static Task<HttpResponseMessage> PostResetPasswordAsync(
        TestApplication app,
        string email,
        string token,
        string newPassword = "NewPassword1!") =>
        app.Client.PostAsJsonAsync(
            "/api/auth/reset-password",
            new { email, token, newPassword });

    private static async Task<string> CreateResetTokenAsync(
        TestApplication app,
        string email,
        bool confirmed = true)
    {
        await app.CreateUserAsync(email, confirmed);
        var forgot = await PostForgotPasswordAsync(app, email);
        await AssertNeutralSuccessAsync(forgot);

        var sent = Assert.Single(app.EmailSender.Messages);
        var href = Regex.Match(sent.HtmlBody, "href=\"([^\"]+)\"").Groups[1].Value;
        var resetUri = new Uri(WebUtility.HtmlDecode(href));
        return QueryHelpers.ParseQuery(resetUri.Query)["token"].ToString();
    }

    private static async Task AssertInvalidTokenAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = await response.Content.ReadFromJsonAsync<JsonElement>();
        var error = Assert.Single(errors.EnumerateArray());
        Assert.Equal("InvalidToken", error.GetProperty("code").GetString());
        Assert.Equal("Invalid token.", error.GetProperty("description").GetString());
    }

    private static async Task AssertNeutralSuccessAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(
            TestApplication.GenericForgotPasswordMessage,
            body.GetProperty("message").GetString());
    }
}
