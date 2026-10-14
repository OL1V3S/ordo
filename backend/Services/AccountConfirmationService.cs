using System.Net;
using System.Text;
using BudgetPlanner.Configuration;
using BudgetPlanner.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;

namespace BudgetPlanner.Services;

public sealed class AccountConfirmationService(
    UserManager<ApplicationUser> userManager,
    IEmailService emailService,
    IOptions<FrontendOptions> frontendOptions,
    ILogger<AccountConfirmationService> logger) : IAccountConfirmationService
{
    public async Task SendConfirmationEmailAsync(
        ApplicationUser user,
        ConfirmationEmailReason reason,
        EmailLanguage language,
        CancellationToken cancellationToken = default)
    {
        var token = await userManager.GenerateEmailConfirmationTokenAsync(user);
        var encodedToken = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));
        var confirmationUrl = QueryHelpers.AddQueryString(
            $"{frontendOptions.Value.BaseUrl.TrimEnd('/')}/confirm-email",
            new Dictionary<string, string?>
            {
                ["userId"] = user.Id,
                ["token"] = encodedToken
            });

        logger.LogInformation(
            "Attempting confirmation email delivery for user {UserId}; reason {Reason}",
            user.Id,
            reason);

        try
        {
            var content = AccountEmailTemplates.ConfirmationEmail(
                language,
                WebUtility.HtmlEncode(confirmationUrl));

            await emailService.SendEmailAsync(
                user.Email ?? throw new InvalidOperationException("User email is missing."),
                content.Subject,
                content.HtmlBody,
                cancellationToken);

            logger.LogInformation(
                "Confirmation email accepted by the email provider for user {UserId}; reason {Reason}",
                user.Id,
                reason);
        }
        catch (EmailDeliveryException exception)
        {
            logger.LogError(
                exception,
                "Confirmation email delivery failed for user {UserId}; reason {Reason}",
                user.Id,
                reason);
            throw;
        }
    }
}
