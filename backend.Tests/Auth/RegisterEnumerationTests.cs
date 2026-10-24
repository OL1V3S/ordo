using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BudgetPlanner.Authentication;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

/// <summary>#300: registration answers the same for new and taken emails.</summary>
public sealed class RegisterEnumerationTests
{
    private const string Password = "Password1!";
    private const string ExistingSubject = "Someone tried to create an Ordo account with your email";

    private sealed record RawResponse(HttpStatusCode Status, string? ContentType, byte[] Body);

    private static async Task<RawResponse> RegisterAsync(
        TestApplication app,
        string email,
        string password = Password,
        string? language = null)
    {
        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/register",
            new { email, password, language });
        return new RawResponse(
            response.StatusCode,
            response.Content.Headers.ContentType?.ToString(),
            await response.Content.ReadAsByteArrayAsync());
    }

    private static void AssertSameResponse(RawResponse expected, RawResponse actual)
    {
        Assert.Equal(expected.Status, actual.Status);
        Assert.Equal(expected.ContentType, actual.ContentType);
        Assert.Equal(expected.Body, actual.Body);
    }

    // The framework's 429 problem details carry a per-request traceId; every
    // other byte must match.
    private static void AssertSameProblemResponse(RawResponse expected, RawResponse actual)
    {
        Assert.Equal(expected.Status, actual.Status);
        Assert.Equal(expected.ContentType, actual.ContentType);
        Assert.Equal(WithoutTraceId(expected.Body), WithoutTraceId(actual.Body));
    }

    private static string WithoutTraceId(byte[] body) =>
        System.Text.RegularExpressions.Regex.Replace(
            System.Text.Encoding.UTF8.GetString(body),
            "\"traceId\":\"[^\"]*\"",
            "\"traceId\":\"\"");

    private static async Task<int> CountUsersAsync(TestApplication app)
    {
        using var scope = app.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<BudgetContext>().Users.CountAsync();
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Taken_email_returns_the_new_registration_response_and_emails_the_owner(bool confirmed)
    {
        await using var app = await TestApplication.StartAsync();
        var newResponse = await RegisterAsync(app, "fresh@example.com");
        var existing = await app.CreateUserAsync("Owner@Example.com", confirmed);
        var before = await app.FindUserByIdAsync(existing.Id);
        var usersBefore = await CountUsersAsync(app);
        var messagesBefore = app.EmailSender.Messages.Count;

        var takenResponse = await RegisterAsync(app, "owner@EXAMPLE.com", "Different1!");

        Assert.Equal(HttpStatusCode.OK, newResponse.Status);
        AssertSameResponse(newResponse, takenResponse);
        var sent = Assert.Single(app.EmailSender.Messages.Skip(messagesBefore));
        Assert.Equal("Owner@Example.com", sent.ToEmail);
        Assert.Equal(ExistingSubject, sent.Subject);
        Assert.Contains("href=\"https://frontend.test/\"", sent.HtmlBody);
        Assert.Contains("href=\"https://frontend.test/forgot-password\"", sent.HtmlBody);
        Assert.DoesNotContain("confirm-email", sent.HtmlBody);
        Assert.DoesNotContain("reset-password", sent.HtmlBody);
        Assert.DoesNotContain("token", sent.HtmlBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(existing.Id, sent.HtmlBody);

        var after = await app.FindUserByIdAsync(existing.Id);
        Assert.NotNull(before);
        Assert.NotNull(after);
        Assert.Equal(before.PasswordHash, after.PasswordHash);
        Assert.Equal(before.SecurityStamp, after.SecurityStamp);
        Assert.Equal(before.ConcurrencyStamp, after.ConcurrencyStamp);
        Assert.Equal(confirmed, after.EmailConfirmed);
        Assert.Equal(usersBefore, await CountUsersAsync(app));
    }

    [Fact]
    public async Task Taken_email_uses_the_requested_language()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("owner@example.com", confirmed: true);

        var response = await RegisterAsync(app, "owner@example.com", language: "es");

        Assert.Equal(HttpStatusCode.OK, response.Status);
        Assert.Equal(
            "Alguien intentó crear una cuenta de Ordo con tu correo",
            Assert.Single(app.EmailSender.Messages).Subject);
    }

    [Fact]
    public async Task Taken_email_delivery_failure_returns_the_new_registration_503()
    {
        await using var app = await TestApplication.StartAsync(EmailFailureMode.DeliveryFailure);
        await app.CreateUserAsync("owner@example.com", confirmed: true);

        var newResponse = await RegisterAsync(app, "fresh@example.com");
        var takenResponse = await RegisterAsync(app, "owner@example.com");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, newResponse.Status);
        Assert.Equal(
            "confirmation_email_delivery_failed",
            JsonDocument.Parse(newResponse.Body).RootElement.GetProperty("code").GetString());
        AssertSameResponse(newResponse, takenResponse);
        Assert.Equal(2, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Weak_password_with_taken_email_returns_only_password_errors_and_no_email()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("owner@example.com", confirmed: true);

        var response = await RegisterAsync(app, "owner@example.com", "weak");
        var codes = JsonDocument.Parse(response.Body).RootElement
            .EnumerateArray()
            .Select(item => item.GetProperty("code").GetString())
            .ToList();

        Assert.Equal(HttpStatusCode.BadRequest, response.Status);
        Assert.NotEmpty(codes);
        Assert.All(codes, code => Assert.StartsWith("Password", code));
        Assert.DoesNotContain("DuplicateUserName", codes);
        Assert.DoesNotContain("DuplicateEmail", codes);
        Assert.Equal(0, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Duplicate_codes_mixed_with_other_errors_are_stripped_and_return_400()
    {
        await using var app = await TestApplication.StartAsync(
            configureServices: services => services.AddScoped<IUserValidator<ApplicationUser>>(_ =>
                new FixedErrorsUserValidator("mixed@example.com", "DuplicateEmail", "InvalidEmail")));

        var response = await RegisterAsync(app, "mixed@example.com");
        var codes = JsonDocument.Parse(response.Body).RootElement
            .EnumerateArray()
            .Select(item => item.GetProperty("code").GetString())
            .ToList();

        Assert.Equal(HttpStatusCode.BadRequest, response.Status);
        Assert.Equal(["InvalidEmail"], codes);
        Assert.Equal(0, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Duplicate_result_without_a_stored_account_returns_200_without_email()
    {
        await using var app = await TestApplication.StartAsync(
            configureServices: services => services.AddScoped<IUserValidator<ApplicationUser>>(_ =>
                new FixedErrorsUserValidator("ghost@example.com", "DuplicateUserName", "DuplicateEmail")));
        var newResponse = await RegisterAsync(app, "fresh@example.com");

        var ghostResponse = await RegisterAsync(app, "ghost@example.com");

        AssertSameResponse(newResponse, ghostResponse);
        Assert.Equal(1, app.EmailSender.AttemptCount);
        Assert.Null(await app.FindUserByEmailAsync("ghost@example.com"));
    }

    [Fact]
    public async Task Recipient_limit_returns_the_same_bare_429_for_new_and_taken_emails()
    {
        await using var app = await TestApplication.StartAsync(
            registrationLimiterSettings: new RegistrationLimiterTestSettings(RecipientPermitLimit: 1));
        await app.CreateUserAsync("owner@example.com", confirmed: true);

        Assert.Equal(HttpStatusCode.OK, (await RegisterAsync(app, "fresh@example.com")).Status);
        Assert.Equal(HttpStatusCode.OK, (await RegisterAsync(app, "owner@example.com")).Status);
        var messagesBefore = app.EmailSender.AttemptCount;

        var newLimited = await RegisterAsync(app, "other-new@example.com");
        Assert.Equal(HttpStatusCode.OK, newLimited.Status);
        var newBlocked = await RegisterAsync(app, " Other-New@example.com ");
        var takenBlocked = await RegisterAsync(app, "OWNER@example.com");

        Assert.Equal(HttpStatusCode.TooManyRequests, newBlocked.Status);
        AssertSameProblemResponse(newBlocked, takenBlocked);
        Assert.Equal(messagesBefore + 1, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Global_limit_applies_to_every_registration_before_the_account_check()
    {
        await using var app = await TestApplication.StartAsync(
            registrationLimiterSettings: new RegistrationLimiterTestSettings(GlobalPermitLimit: 1));
        await app.CreateUserAsync("owner@example.com", confirmed: true);

        Assert.Equal(HttpStatusCode.OK, (await RegisterAsync(app, "fresh@example.com")).Status);
        var newBlocked = await RegisterAsync(app, "second@example.com");
        var takenBlocked = await RegisterAsync(app, "owner@example.com");

        Assert.Equal(HttpStatusCode.TooManyRequests, newBlocked.Status);
        AssertSameProblemResponse(newBlocked, takenBlocked);
        Assert.Null(await app.FindUserByEmailAsync("second@example.com"));
        Assert.Equal(1, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Registration_logs_never_contain_the_email()
    {
        var logs = new CapturingLoggerProvider();
        await using var app = await TestApplication.StartAsync(loggerProvider: logs);
        await app.CreateUserAsync("owner-private@example.com", confirmed: true);

        await RegisterAsync(app, "new-private@example.com");
        await RegisterAsync(app, "owner-private@example.com");

        Assert.Contains(logs.Messages, message => message.Contains("Existing-account email accepted"));
        Assert.DoesNotContain(logs.Messages, message =>
            message.Contains("private@example.com", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Delivery_failure_logs_never_contain_the_email()
    {
        var logs = new CapturingLoggerProvider();
        await using var app = await TestApplication.StartAsync(
            EmailFailureMode.DeliveryFailure,
            loggerProvider: logs);
        await app.CreateUserAsync("owner-private@example.com", confirmed: true);

        await RegisterAsync(app, "owner-private@example.com");

        Assert.Contains(logs.Messages, message => message.Contains("Existing-account email delivery failed"));
        Assert.DoesNotContain(logs.Messages, message =>
            message.Contains("private@example.com", StringComparison.OrdinalIgnoreCase));
    }

    private sealed class FixedErrorsUserValidator(string email, params string[] codes)
        : IUserValidator<ApplicationUser>
    {
        public Task<IdentityResult> ValidateAsync(UserManager<ApplicationUser> manager, ApplicationUser user) =>
            Task.FromResult(string.Equals(user.Email, email, StringComparison.OrdinalIgnoreCase)
                ? IdentityResult.Failed(codes.Select(code => new IdentityError { Code = code, Description = code }).ToArray())
                : IdentityResult.Success);
    }
}

public sealed class RegistrationLimiterTests
{
    private static RegistrationLimiter Create(int global = 100, int recipient = 2) =>
        new(Options.Create(new RegistrationLimiterOptions
        {
            GlobalPermitLimit = global,
            RecipientPermitLimit = recipient
        }));

    [Fact]
    public void Defaults_are_code_constants()
    {
        var options = new RegistrationLimiterOptions();
        Assert.Equal(120, options.GlobalPermitLimit);
        Assert.Equal(3, options.RecipientPermitLimit);
        Assert.Equal(TimeSpan.FromMinutes(1), options.Window);
    }

    [Fact]
    public void Recipient_limit_is_per_normalized_email()
    {
        using var limiter = Create(recipient: 2);

        Assert.True(limiter.TryAcquireRecipient("a@example.com"));
        Assert.True(limiter.TryAcquireRecipient(" A@EXAMPLE.com "));
        Assert.False(limiter.TryAcquireRecipient("a@example.com"));
        Assert.True(limiter.TryAcquireRecipient("b@example.com"));
    }

    [Fact]
    public void Global_limit_is_shared()
    {
        using var limiter = Create(global: 2);

        Assert.True(limiter.TryAcquireGlobal());
        Assert.True(limiter.TryAcquireGlobal());
        Assert.False(limiter.TryAcquireGlobal());
    }
}
