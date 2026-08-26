using BudgetPlanner.Configuration;
using BudgetPlanner.Services;
using Microsoft.Extensions.Options;
using MimeKit;
using Xunit;

namespace BudgetPlanner.Tests.Auth;

public sealed class GmailEmailServiceTests
{
    private static readonly EmailSettingsOptions SenderSettings = new()
    {
        FromName = "Ordo",
        FromEmail = "budgetplanner26@gmail.com"
    };

    [Fact]
    public async Task Send_constructs_base64url_mime_message_and_targets_authenticated_user()
    {
        var client = new RecordingGmailApiClient();
        var service = CreateService(client);
        using var cancellation = new CancellationTokenSource();

        await service.SendEmailAsync(
            "recipient@example.com",
            "Confirm your account",
            "<p>Confirm <strong>now</strong>.</p>",
            cancellation.Token);

        Assert.Equal("me", client.UserId);
        Assert.Equal(cancellation.Token, client.CancellationToken);
        Assert.NotNull(client.RawMessage);
        Assert.DoesNotContain('+', client.RawMessage);
        Assert.DoesNotContain('/', client.RawMessage);
        Assert.DoesNotContain('=', client.RawMessage);

        using var decoded = new MemoryStream(DecodeBase64Url(client.RawMessage));
        var message = MimeMessage.Load(decoded);
        Assert.Equal("Ordo", message.From.Mailboxes.Single().Name);
        Assert.Equal("budgetplanner26@gmail.com", message.From.Mailboxes.Single().Address);
        Assert.Equal("recipient@example.com", message.To.Mailboxes.Single().Address);
        Assert.Equal("Confirm your account", message.Subject);
        Assert.Equal("<p>Confirm <strong>now</strong>.</p>", message.HtmlBody?.TrimEnd());
    }

    [Fact]
    public async Task Expected_provider_failure_becomes_email_delivery_exception()
    {
        var providerFailure = new HttpRequestException("Provider unavailable.");
        var service = CreateService(new RecordingGmailApiClient(providerFailure));

        var exception = await Assert.ThrowsAsync<EmailDeliveryException>(() =>
            service.SendEmailAsync("recipient@example.com", "Subject", "<p>Body</p>"));

        Assert.Same(providerFailure, exception.InnerException);
    }

    [Fact]
    public async Task Caller_cancellation_propagates_without_translation()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        var client = new RecordingGmailApiClient(new OperationCanceledException(cancellation.Token));
        var service = CreateService(client);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            service.SendEmailAsync(
                "recipient@example.com",
                "Subject",
                "<p>Body</p>",
                cancellation.Token));

    }

    [Fact]
    public async Task Unexpected_programming_exception_is_not_translated()
    {
        var programmingFailure = new InvalidOperationException("Unexpected defect.");
        var service = CreateService(new RecordingGmailApiClient(programmingFailure));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.SendEmailAsync("recipient@example.com", "Subject", "<p>Body</p>"));

        Assert.Same(programmingFailure, exception);
    }

    private static EmailService CreateService(IGmailApiClient client) =>
        new(Options.Create(SenderSettings), client);

    private static byte[] DecodeBase64Url(string rawMessage)
    {
        var padded = rawMessage.Replace('-', '+').Replace('_', '/');
        padded += new string('=', (4 - padded.Length % 4) % 4);
        return Convert.FromBase64String(padded);
    }
}

internal sealed class RecordingGmailApiClient(Exception? exception = null) : IGmailApiClient
{
    public string? UserId { get; private set; }
    public string? RawMessage { get; private set; }
    public CancellationToken CancellationToken { get; private set; }

    public Task SendRawMessageAsync(
        string userId,
        string rawMessage,
        CancellationToken cancellationToken = default)
    {
        UserId = userId;
        RawMessage = rawMessage;
        CancellationToken = cancellationToken;

        return exception == null
            ? Task.CompletedTask
            : Task.FromException(exception);
    }
}
