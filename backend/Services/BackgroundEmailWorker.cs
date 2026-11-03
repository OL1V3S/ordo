using System.Text;
using BudgetPlanner.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;

namespace BudgetPlanner.Services;

/// <summary>
/// Sends queued resend-confirmation and password-reset emails (#319). One item at a
/// time. Nothing an item does may stop the host, and logs carry the user ID only,
/// never the email address.
/// </summary>
public sealed class BackgroundEmailWorker(
    IBackgroundEmailQueue queue,
    IServiceScopeFactory scopeFactory,
    IConfiguration configuration,
    ILogger<BackgroundEmailWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await foreach (var job in queue.Reader.ReadAllAsync(stoppingToken))
                await ProcessAsync(job, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutdown is a normal stop.
        }
    }

    private async Task ProcessAsync(BackgroundEmailJob job, CancellationToken stoppingToken)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();

            var user = await users.FindByIdAsync(job.UserId);
            if (user == null)
                return;

            switch (job.Kind)
            {
                case BackgroundEmailKind.ConfirmationResend:
                    if (await users.IsEmailConfirmedAsync(user))
                        return;

                    await scope.ServiceProvider
                        .GetRequiredService<IAccountConfirmationService>()
                        .SendConfirmationEmailAsync(
                            user,
                            ConfirmationEmailReason.Resend,
                            job.Language,
                            stoppingToken);
                    break;

                case BackgroundEmailKind.PasswordReset:
                    await SendPasswordResetAsync(
                        users,
                        scope.ServiceProvider.GetRequiredService<IEmailService>(),
                        user,
                        job.Language,
                        stoppingToken);
                    break;
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (EmailDeliveryException)
        {
            // Same as before #319: delivery failure is not surfaced. Log the user ID
            // only; the exception text is not logged here.
            logger.LogWarning(
                "Background {Kind} email delivery failed for user {UserId}",
                job.Kind,
                job.UserId);
        }
        catch (Exception exception)
        {
            // Catch-all: the default host behavior would stop the app. Log the
            // exception type only because some messages can quote the address.
            logger.LogError(
                "Background {Kind} email failed for user {UserId}: {ExceptionType}",
                job.Kind,
                job.UserId,
                exception.GetType().Name);
        }
    }

    private async Task SendPasswordResetAsync(
        UserManager<ApplicationUser> users,
        IEmailService emailService,
        ApplicationUser user,
        EmailLanguage language,
        CancellationToken stoppingToken)
    {
        var email = user.Email ?? throw new InvalidOperationException("User email is missing.");
        var token = await users.GeneratePasswordResetTokenAsync(user);
        var encodedToken = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));
        var frontendBaseUrl = configuration["Frontend:BaseUrl"];
        var resetLink =
            $"{frontendBaseUrl}/reset-password?email={Uri.EscapeDataString(email)}&token={encodedToken}";

        var content = AccountEmailTemplates.PasswordResetEmail(language, resetLink);

        await emailService.SendEmailAsync(
            email,
            content.Subject,
            content.HtmlBody,
            stoppingToken);
    }
}
