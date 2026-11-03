using System.Net;
using System.Net.Http.Json;
using System.Text;
using BudgetPlanner.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

/// <summary>
/// reset-password does not reveal whether an account exists (#319): an unknown email
/// gets byte-identical output to a known email with a bad or malformed token.
/// </summary>
public sealed class ResetPasswordEnumerationTests
{
    private const string Email = "reset-enum@example.com";
    private const string Password = "Password1!";
    private const string MalformedToken = "not valid base64url!";
    private const string ResetEndpoint = "/api/auth/reset-password";

    private sealed record ResponseSnapshot(HttpStatusCode Status, string? ContentType, string Body);

    [Fact]
    public async Task Unknown_email_matches_known_email_with_a_bad_or_malformed_token()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync(Email, confirmed: true);
        var badToken = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes("not-an-identity-token"));

        var unknownBad = await ResetAsync(app, "nobody@example.com", badToken);
        var unknownMalformed = await ResetAsync(app, "nobody@example.com", MalformedToken);
        var knownBad = await ResetAsync(app, Email, badToken);
        var knownMalformed = await ResetAsync(app, Email, MalformedToken);

        Assert.Equal(HttpStatusCode.BadRequest, knownBad.Status);
        Assert.Contains("InvalidToken", knownBad.Body);
        Assert.Equal(knownBad, unknownBad);
        Assert.Equal(knownBad, unknownMalformed);
        Assert.Equal(knownBad, knownMalformed);
    }

    [Fact]
    public async Task Unknown_email_with_a_weak_password_matches_a_known_email_with_a_bad_token()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync(Email, confirmed: true);
        var badToken = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes("not-an-identity-token"));

        var known = await ResetAsync(app, Email, badToken, "weak");
        var unknown = await ResetAsync(app, "nobody@example.com", badToken, "weak");

        Assert.Equal(HttpStatusCode.BadRequest, known.Status);
        Assert.Equal(known, unknown);
    }

    [Fact]
    public async Task A_valid_token_with_a_weak_password_still_returns_the_policy_errors()
    {
        await using var app = await TestApplication.StartAsync();
        var user = await app.CreateUserAsync(Email, confirmed: true);
        var token = await CreateTokenAsync(app, user.Id);

        var weak = await ResetAsync(app, Email, token, "weak");

        Assert.Equal(HttpStatusCode.BadRequest, weak.Status);
        Assert.Contains("PasswordTooShort", weak.Body);
        Assert.DoesNotContain("InvalidToken", weak.Body);
    }

    [Fact]
    public async Task A_valid_reset_still_succeeds_changes_the_password_and_revokes_device_sessions()
    {
        await using var app = await TestApplication.StartAsync();
        var user = await app.CreateUserAsync(Email, confirmed: true);
        using (var signIn = await app.Client.PostAsJsonAsync("/api/auth/device-sessions", new { email = Email, password = Password }))
            Assert.Equal(HttpStatusCode.OK, signIn.StatusCode);
        Assert.Equal(1, await app.CountDeviceSessionsAsync(user.Id));
        var token = await CreateTokenAsync(app, user.Id);

        var reset = await ResetAsync(app, Email, token, "NewPassword1!");

        Assert.Equal(HttpStatusCode.OK, reset.Status);
        Assert.Equal(0, await app.CountDeviceSessionsAsync(user.Id));
        using var oldPassword = await app.Client.PostAsJsonAsync("/api/auth/login", new { email = Email, password = Password });
        Assert.Equal(HttpStatusCode.Unauthorized, oldPassword.StatusCode);
        using var newPassword = await app.Client.PostAsJsonAsync("/api/auth/login", new { email = Email, password = "NewPassword1!" });
        Assert.Equal(HttpStatusCode.OK, newPassword.StatusCode);
    }

    private static async Task<ResponseSnapshot> ResetAsync(
        TestApplication app, string email, string token, string newPassword = "NewPassword1!")
    {
        using var response = await app.Client.PostAsJsonAsync(ResetEndpoint, new { email, token, newPassword });
        return new(response.StatusCode, response.Content.Headers.ContentType?.ToString(), await response.Content.ReadAsStringAsync());
    }

    private static async Task<string> CreateTokenAsync(TestApplication app, string userId)
    {
        using var scope = app.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var token = await users.GeneratePasswordResetTokenAsync((await users.FindByIdAsync(userId))!);
        return WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));
    }
}
