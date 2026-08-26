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
            await emailService.SendEmailAsync(
                user.Email ?? throw new InvalidOperationException("User email is missing."),
                "Confirm your Ordo account",
                BuildEmailBody(WebUtility.HtmlEncode(confirmationUrl)),
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

    private static string BuildEmailBody(string confirmationUrl) =>
        $"""
        <div style="background:#0f172a; padding:40px 20px; font-family:Arial, sans-serif;">
          <div style="max-width:500px; margin:auto; background:#020617; border-radius:14px; padding:24px; border:1px solid #1f2933;">
            <h2 style="color:#e5e7eb; margin:0 0 10px;">Ordo</h2>
            <p style="color:rgba(255,255,255,0.7); margin:0 0 20px;">
              Confirm your email to finish creating your account.
            </p>
            <a href="{confirmationUrl}"
               style="display:inline-block; padding:12px 20px; background:#2e6dd3; color:white; text-decoration:none; border-radius:12px; font-weight:600;">
              Confirm Email
            </a>
            <p style="color:rgba(255,255,255,0.5); margin-top:25px; font-size:13px;">
              If you didn’t create this account, you can safely ignore this email.
            </p>
          </div>
        </div>
        """;
}
