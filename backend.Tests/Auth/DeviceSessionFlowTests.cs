using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

/// <summary>
/// Pins the exact web login responses so the device-session work (#252) cannot
/// change them accidentally. These tests describe behavior that existed before
/// device sessions and must keep passing unchanged.
/// </summary>
public sealed class LoginCharacterizationTests
{
    private const string Password = "Password1!";

    [Fact]
    public async Task Unknown_email_returns_401_with_plain_invalid_credentials_text()
    {
        await using var app = await TestApplication.StartAsync();

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email = "nobody@example.com", password = Password });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("Invalid email or password", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Wrong_password_returns_the_same_401_body_as_an_unknown_email()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("wrong-password@example.com", confirmed: true);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email = "wrong-password@example.com", password = "Wrong-password1!" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("Invalid email or password", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Unconfirmed_account_with_the_right_password_returns_the_confirmation_text()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("unconfirmed-login@example.com", confirmed: false);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email = "unconfirmed-login@example.com", password = Password });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(
            "Please confirm your email before logging in.",
            await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Success_returns_only_token_and_email()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("login-shape@example.com", confirmed: true);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email = "login-shape@example.com", password = Password });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(
            new[] { "email", "token" },
            body.EnumerateObject().Select(property => property.Name).OrderBy(name => name));
        Assert.Equal("login-shape@example.com", body.GetProperty("email").GetString());
        Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("token").GetString()));
    }
}
