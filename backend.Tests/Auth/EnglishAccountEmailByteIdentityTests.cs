using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

public sealed class EnglishAccountEmailByteIdentityTests
{
    private static string MaskLink(string html) =>
        Regex.Replace(html, "href=\"[^\"]+\"", "href=\"{LINK}\"");

    [Fact]
    public async Task Registration_email_is_byte_identical_to_golden_english()
    {
        await using var app = await TestApplication.StartAsync();

        await app.Client.PostAsJsonAsync(
            "/api/auth/register",
            new { email = "golden@example.com", password = "Password1!" });

        var sent = Assert.Single(app.EmailSender.Messages);
        Assert.Equal(EnglishAccountEmailGolden.ConfirmationSubject, sent.Subject);
        Assert.Equal(EnglishAccountEmailGolden.ConfirmationBody, MaskLink(sent.HtmlBody));
    }

    [Fact]
    public async Task Resend_email_is_byte_identical_to_golden_english()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("golden@example.com", confirmed: false);

        await app.Client.PostAsJsonAsync(
            "/api/auth/resend-confirmation",
            new { email = "golden@example.com" });

        var sent = Assert.Single(app.EmailSender.Messages);
        Assert.Equal(EnglishAccountEmailGolden.ConfirmationSubject, sent.Subject);
        Assert.Equal(EnglishAccountEmailGolden.ConfirmationBody, MaskLink(sent.HtmlBody));
    }

    [Fact]
    public async Task Reset_email_is_byte_identical_to_golden_english()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("golden@example.com", confirmed: true);

        await app.Client.PostAsJsonAsync(
            "/api/auth/forgot-password",
            new { email = "golden@example.com" });

        var sent = Assert.Single(app.EmailSender.Messages);
        Assert.Equal(EnglishAccountEmailGolden.ResetSubject, sent.Subject);
        Assert.Equal(EnglishAccountEmailGolden.ResetBody, MaskLink(sent.HtmlBody));
    }
}
