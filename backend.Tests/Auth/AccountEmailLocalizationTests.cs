using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using BudgetPlanner.Services;
using MimeKit;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

public sealed class EmailLanguageParserTests
{
    [Theory]
    [InlineData("es", EmailLanguage.Spanish)]
    [InlineData("ES", EmailLanguage.Spanish)]
    [InlineData(" es ", EmailLanguage.Spanish)]
    [InlineData("en", EmailLanguage.English)]
    [InlineData("En", EmailLanguage.English)]
    [InlineData(null, EmailLanguage.English)]
    [InlineData("", EmailLanguage.English)]
    [InlineData("   ", EmailLanguage.English)]
    [InlineData("es-MX", EmailLanguage.English)]
    [InlineData("fr", EmailLanguage.English)]
    [InlineData("garbage<script>", EmailLanguage.English)]
    public void Parse_recognizes_only_exact_en_and_es(string? value, EmailLanguage expected) =>
        Assert.Equal(expected, EmailLanguageParser.Parse(value));

    [Fact]
    public void Parse_falls_back_to_english_for_very_long_input() =>
        Assert.Equal(EmailLanguage.English, EmailLanguageParser.Parse(new string('x', 100_000)));
}

public sealed class AccountEmailTemplatesTests
{
    private const string ConfirmLink = "https://frontend.test/confirm-email?userId=U&amp;token=T";
    private const string ResetLink = "https://frontend.test/reset-password?email=a%40b.com&token=T";

    [Fact]
    public void English_confirmation_matches_golden()
    {
        var content = AccountEmailTemplates.ConfirmationEmail(EmailLanguage.English, ConfirmLink);

        Assert.Equal(EnglishAccountEmailGolden.ConfirmationSubject, content.Subject);
        Assert.Equal(
            EnglishAccountEmailGolden.ConfirmationBody.Replace("{LINK}", ConfirmLink),
            content.HtmlBody);
    }

    [Fact]
    public void English_reset_matches_golden()
    {
        var content = AccountEmailTemplates.PasswordResetEmail(EmailLanguage.English, ResetLink);

        Assert.Equal(EnglishAccountEmailGolden.ResetSubject, content.Subject);
        Assert.Equal(
            EnglishAccountEmailGolden.ResetBody.Replace("{LINK}", ResetLink),
            content.HtmlBody);
    }

    [Fact]
    public void Spanish_confirmation_uses_approved_copy_and_keeps_markup_and_link()
    {
        var content = AccountEmailTemplates.ConfirmationEmail(EmailLanguage.Spanish, ConfirmLink);

        Assert.Equal("Confirma tu cuenta de Ordo", content.Subject);
        Assert.Contains(">Ordo</h2>", content.HtmlBody);
        Assert.Contains("Confirma tu correo para terminar de crear tu cuenta.", content.HtmlBody);
        Assert.Contains("Confirmar correo", content.HtmlBody);
        Assert.Contains("Si no creaste esta cuenta, puedes ignorar este correo sin problema.", content.HtmlBody);
        Assert.Contains($"href=\"{ConfirmLink}\"", content.HtmlBody);
        Assert.DoesNotContain("Budget Planner", content.Subject + content.HtmlBody);
        Assert.Equal(
            EnglishAccountEmailGolden.ConfirmationBody.Split('\n').Length,
            content.HtmlBody.Split('\n').Length);
    }

    [Fact]
    public void Spanish_reset_uses_approved_copy_and_keeps_markup_and_link()
    {
        var content = AccountEmailTemplates.PasswordResetEmail(EmailLanguage.Spanish, ResetLink);

        Assert.Equal("Restablece tu contraseña de Ordo", content.Subject);
        Assert.Contains(">Ordo</h2>", content.HtmlBody);
        Assert.Contains("Restablece tu contraseña con el botón de abajo.", content.HtmlBody);
        Assert.Contains("Restablecer contraseña", content.HtmlBody);
        Assert.Contains("Si no solicitaste esto, puedes ignorar este correo.", content.HtmlBody);
        Assert.Contains($"href=\"{ResetLink}\"", content.HtmlBody);
        Assert.DoesNotContain("Budget Planner", content.Subject + content.HtmlBody);
        Assert.Equal(
            EnglishAccountEmailGolden.ResetBody.Split('\n').Length,
            content.HtmlBody.Split('\n').Length);
    }

    [Fact]
    public async Task Spanish_subject_and_body_survive_mime_encoding()
    {
        var client = new RecordingGmailApiClient();
        var service = new EmailService(
            Microsoft.Extensions.Options.Options.Create(new BudgetPlanner.Configuration.EmailSettingsOptions
            {
                FromName = "Ordo",
                FromEmail = "budgetplanner26@gmail.com"
            }),
            client);
        var content = AccountEmailTemplates.PasswordResetEmail(EmailLanguage.Spanish, ResetLink);

        await service.SendEmailAsync("recipient@example.com", content.Subject, content.HtmlBody);

        var padded = client.RawMessage!.Replace('-', '+').Replace('_', '/');
        padded += new string('=', (4 - padded.Length % 4) % 4);
        using var decoded = new MemoryStream(Convert.FromBase64String(padded));
        var message = MimeMessage.Load(decoded);
        Assert.Equal("Restablece tu contraseña de Ordo", message.Subject);
        Assert.Equal(content.HtmlBody, message.HtmlBody?.TrimEnd());
    }
}

public sealed class AccountEmailLocalizationFlowTests
{
    private const string Password = "Password1!";

    private static StringContent Json(string json) =>
        new(json, Encoding.UTF8, "application/json");

    [Theory]
    [InlineData("es", "Confirma tu cuenta de Ordo")]
    [InlineData("en", "Confirm your Ordo account")]
    public async Task Register_uses_requested_language(string language, string subject)
    {
        await using var app = await TestApplication.StartAsync();

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/register",
            new { email = "lang@example.com", password = Password, language });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var sent = Assert.Single(app.EmailSender.Messages);
        Assert.Equal(subject, sent.Subject);
        Assert.Contains(">Ordo</h2>", sent.HtmlBody);
        Assert.Contains("https://frontend.test/confirm-email?", sent.HtmlBody);
        Assert.DoesNotContain("Budget Planner", sent.Subject + sent.HtmlBody);
    }

    [Theory]
    [InlineData("es", "Confirma tu cuenta de Ordo")]
    [InlineData("en", "Confirm your Ordo account")]
    public async Task Resend_uses_requested_language_with_unchanged_response(string language, string subject)
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("lang@example.com", confirmed: false);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/resend-confirmation",
            new { email = "lang@example.com", language });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal(TestApplication.GenericResendMessage, body.GetProperty("message").GetString());
        Assert.Equal(subject, Assert.Single(app.EmailSender.Messages).Subject);
    }

    [Theory]
    [InlineData("es", "Restablece tu contraseña de Ordo")]
    [InlineData("en", "Reset your Ordo password")]
    public async Task ForgotPassword_uses_requested_language_with_unchanged_response(string language, string subject)
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("lang@example.com", confirmed: true);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/forgot-password",
            new { email = "lang@example.com", language });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("If the email exists, a reset link was sent.", body.GetProperty("message").GetString());
        var sent = Assert.Single(app.EmailSender.Messages);
        Assert.Equal(subject, sent.Subject);
        Assert.Contains("https://frontend.test/reset-password?email=lang%40example.com&token=", sent.HtmlBody);
    }

    [Theory]
    [InlineData("\"language\":\"ES\"", "Confirma tu cuenta de Ordo")]
    [InlineData("\"language\":\" es \"", "Confirma tu cuenta de Ordo")]
    [InlineData("\"language\":\"En\"", "Confirm your Ordo account")]
    [InlineData("\"language\":null", "Confirm your Ordo account")]
    [InlineData("\"language\":\"\"", "Confirm your Ordo account")]
    [InlineData("\"language\":\"fr\"", "Confirm your Ordo account")]
    [InlineData("\"language\":\"es-MX\"", "Confirm your Ordo account")]
    [InlineData("\"language\":\"garbage\"", "Confirm your Ordo account")]
    [InlineData("\"language\":5", "Confirm your Ordo account")]
    [InlineData("\"language\":true", "Confirm your Ordo account")]
    [InlineData("\"language\":{\"a\":[1,2]}", "Confirm your Ordo account")]
    [InlineData("\"language\":[\"es\"]", "Confirm your Ordo account")]
    [InlineData("\"other\":1", "Confirm your Ordo account")]
    public async Task Register_language_edge_values_never_fail_and_default_to_english(
        string languageFragment,
        string subject)
    {
        await using var app = await TestApplication.StartAsync();

        var response = await app.Client.PostAsync(
            "/api/auth/register",
            Json($"{{\"email\":\"edge@example.com\",\"password\":\"{Password}\",{languageFragment}}}"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(subject, Assert.Single(app.EmailSender.Messages).Subject);
    }

    [Fact]
    public async Task Register_very_long_language_defaults_to_english_without_failing()
    {
        await using var app = await TestApplication.StartAsync();

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/register",
            new { email = "long@example.com", password = Password, language = new string('x', 50_000) });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Confirm your Ordo account", Assert.Single(app.EmailSender.Messages).Subject);
    }

    [Theory]
    [InlineData("\"language\":5")]
    [InlineData("\"language\":true")]
    [InlineData("\"language\":{\"a\":1}")]
    [InlineData("\"language\":\"fr\"")]
    public async Task Resend_non_string_or_unknown_language_defaults_to_english(string languageFragment)
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("edge@example.com", confirmed: false);

        var response = await app.Client.PostAsync(
            "/api/auth/resend-confirmation",
            Json($"{{\"email\":\"edge@example.com\",{languageFragment}}}"));

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal("Confirm your Ordo account", Assert.Single(app.EmailSender.Messages).Subject);
    }

    [Theory]
    [InlineData("\"language\":5")]
    [InlineData("\"language\":true")]
    [InlineData("\"language\":{\"a\":1}")]
    [InlineData("\"language\":\"fr\"")]
    public async Task ForgotPassword_non_string_or_unknown_language_defaults_to_english(string languageFragment)
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("edge@example.com", confirmed: true);

        var response = await app.Client.PostAsync(
            "/api/auth/forgot-password",
            Json($"{{\"email\":\"edge@example.com\",{languageFragment}}}"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Reset your Ordo password", Assert.Single(app.EmailSender.Messages).Subject);
    }

    [Fact]
    public async Task Spanish_resend_for_missing_or_confirmed_accounts_sends_nothing_with_identical_response()
    {
        await using var app = await TestApplication.StartAsync();
        await app.CreateUserAsync("confirmed@example.com", confirmed: true);

        foreach (var email in new[] { "missing@example.com", "confirmed@example.com" })
        {
            var response = await app.Client.PostAsJsonAsync(
                "/api/auth/resend-confirmation",
                new { email, language = "es" });
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();

            Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
            Assert.Equal(TestApplication.GenericResendMessage, body.GetProperty("message").GetString());
        }

        Assert.Empty(app.EmailSender.Messages);
    }

    [Fact]
    public async Task Spanish_forgot_password_for_missing_account_sends_nothing_with_identical_response()
    {
        await using var app = await TestApplication.StartAsync();

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/forgot-password",
            new { email = "missing@example.com", language = "es" });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("If the email exists, a reset link was sent.", body.GetProperty("message").GetString());
        Assert.Equal(0, app.EmailSender.AttemptCount);
    }

    [Fact]
    public async Task Spanish_register_delivery_failure_keeps_english_503_response()
    {
        await using var app = await TestApplication.StartAsync(EmailFailureMode.DeliveryFailure);

        var response = await app.Client.PostAsJsonAsync(
            "/api/auth/register",
            new { email = "fail@example.com", password = Password, language = "es" });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("confirmation_email_delivery_failed", body.GetProperty("code").GetString());
        Assert.Equal(
            "Your account was created, but we couldn't send the confirmation email. Please request a new confirmation email.",
            body.GetProperty("message").GetString());
    }
}
