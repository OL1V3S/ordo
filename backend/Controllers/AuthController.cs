using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.ComponentModel.DataAnnotations;
using BudgetPlanner.Models;
using BudgetPlanner.Services;
using BudgetPlanner.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.IdentityModel.Tokens;

namespace BudgetPlanner.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly IConfiguration _configuration;
    private readonly IEmailService _emailService;
    private readonly IAccountConfirmationService _accountConfirmationService;
    private readonly IConfirmationResendLimiter _confirmationResendLimiter;
    private readonly IForgotPasswordLimiter _forgotPasswordLimiter;

    public AuthController(
        UserManager<ApplicationUser> userManager,
        IConfiguration configuration,
        IEmailService emailService,
        IAccountConfirmationService accountConfirmationService,
        IConfirmationResendLimiter confirmationResendLimiter,
        IForgotPasswordLimiter forgotPasswordLimiter)
    {
        _userManager = userManager;
        _configuration = configuration;
        _emailService = emailService;
        _accountConfirmationService = accountConfirmationService;
        _confirmationResendLimiter = confirmationResendLimiter;
        _forgotPasswordLimiter = forgotPasswordLimiter;
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register(
        RegisterRequest request,
        CancellationToken cancellationToken)
    {
        var user = new ApplicationUser
        {
            UserName = request.Email,
            Email = request.Email
        };

        var result = await _userManager.CreateAsync(user, request.Password);

        if (!result.Succeeded)
            return BadRequest(result.Errors);

        try
        {
            await _accountConfirmationService.SendConfirmationEmailAsync(
                user,
                ConfirmationEmailReason.Registration,
                cancellationToken);
        }
        catch (EmailDeliveryException)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                code = "confirmation_email_delivery_failed",
                message = "Your account was created, but we couldn't send the confirmation email. Please request a new confirmation email."
            });
        }

        return Ok(new
        {
            message = "User registered successfully. Please check your email to confirm your account."
        });
    }

    [HttpPost("resend-confirmation")]
    public async Task<IActionResult> ResendConfirmation(
        ResendConfirmationRequest request,
        CancellationToken cancellationToken)
    {
        if (!_confirmationResendLimiter.TryAcquireGlobal())
            return StatusCode(StatusCodes.Status429TooManyRequests);

        if (!_confirmationResendLimiter.TryAcquireRecipient(request.Email!))
            return StatusCode(StatusCodes.Status429TooManyRequests);

        var user = await _userManager.FindByEmailAsync(request.Email!);

        if (user != null && !await _userManager.IsEmailConfirmedAsync(user))
        {
            try
            {
                await _accountConfirmationService.SendConfirmationEmailAsync(
                    user,
                    ConfirmationEmailReason.Resend,
                    cancellationToken);
            }
            catch (EmailDeliveryException)
            {
                // Preserve the same public response for missing, confirmed, and
                // delivery-failed accounts to avoid account enumeration.
            }
        }

        return Accepted(new
        {
            message = "If an unconfirmed account exists for that email, a confirmation link has been sent."
        });
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginRequest request)
    {
        var user = await _userManager.FindByEmailAsync(request.Email);

        if (user == null)
            return Unauthorized("Invalid email or password");

        var passwordValid = await _userManager.CheckPasswordAsync(user, request.Password);

        if (!passwordValid)
            return Unauthorized("Invalid email or password");

        if (!await _userManager.IsEmailConfirmedAsync(user))
            return Unauthorized("Please confirm your email before logging in.");

        var token = GenerateJwtToken(user);

        return Ok(new
        {
            token,
            email = user.Email
        });
    }

    [HttpPost("confirm-email")]
    public async Task<IActionResult> ConfirmEmail(ConfirmEmailRequest request)
    {
        var user = await _userManager.FindByIdAsync(request.UserId);

        if (user == null)
            return BadRequest("Invalid user");

        if (!TryDecodeIdentityToken(request.Token, out var decodedToken))
            return BadRequest(new[] { _userManager.ErrorDescriber.InvalidToken() });

        var result = await _userManager.ConfirmEmailAsync(user, decodedToken);

        if (!result.Succeeded)
            return BadRequest(result.Errors);

        return Ok(new { message = "Email confirmed successfully" });
    }

    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword(
        ForgotPasswordRequest request,
        CancellationToken cancellationToken)
    {
        if (!_forgotPasswordLimiter.TryAcquireGlobal())
            return StatusCode(StatusCodes.Status429TooManyRequests);

        if (!_forgotPasswordLimiter.TryAcquireRecipient(request.Email!))
            return StatusCode(StatusCodes.Status429TooManyRequests);

        var user = await _userManager.FindByEmailAsync(request.Email!);

        if (user != null)
        {
            var token = await _userManager.GeneratePasswordResetTokenAsync(user);
            var encodedToken = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));

            var frontendBaseUrl = _configuration["Frontend:BaseUrl"];

            var resetLink =
                $"{frontendBaseUrl}/reset-password?email={Uri.EscapeDataString(request.Email!)}&token={encodedToken}";

            try
            {
                await _emailService.SendEmailAsync(
                    request.Email!,
                    "Reset your Ordo password",
                    $"""
                    <div style="background:#0f172a; padding:40px 20px; font-family:Arial, sans-serif;">
                      <div style="max-width:500px; margin:auto; background:#020617; border-radius:14px; padding:24px; border:1px solid #1f2933;">

                        <h2 style="color:#e5e7eb; margin:0 0 10px;">Ordo</h2>

                        <p style="color:rgba(255,255,255,0.7); margin:0 0 20px;">
                          Reset your password using the button below.
                        </p>

                        <a href="{resetLink}"
                           style="display:inline-block; padding:12px 20px; background:#ef4444; color:white; text-decoration:none; border-radius:12px; font-weight:600;">
                          Reset Password
                        </a>

                        <p style="color:rgba(255,255,255,0.5); margin-top:25px; font-size:13px;">
                          If you didn’t request this, you can ignore this email.
                        </p>
                      </div>
                    </div>
                    """,
                    cancellationToken);
            }
            catch (EmailDeliveryException)
            {
                // Preserve the same public response for missing and
                // delivery-failed accounts to reduce account enumeration.
            }
        }

        return Ok(new
        {
            message = "If the email exists, a reset link was sent."
        });
    }

    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword(ResetPasswordRequest request)
    {
        var user = await _userManager.FindByEmailAsync(request.Email);

        if (user == null)
            return BadRequest("Invalid request");

        if (!TryDecodeIdentityToken(request.Token, out var decodedToken))
            return BadRequest(new[] { _userManager.ErrorDescriber.InvalidToken() });

        var result = await _userManager.ResetPasswordAsync(
            user,
            decodedToken,
            request.NewPassword
        );

        if (!result.Succeeded)
            return BadRequest(result.Errors);

        return Ok(new { message = "Password reset successfully" });
    }

    private static bool TryDecodeIdentityToken(string encodedToken, out string decodedToken)
    {
        try
        {
            var tokenBytes = WebEncoders.Base64UrlDecode(encodedToken);
            decodedToken = Encoding.UTF8.GetString(tokenBytes);
            return true;
        }
        catch (FormatException)
        {
            decodedToken = string.Empty;
            return false;
        }
    }

    private string GenerateJwtToken(ApplicationUser user)
    {
        var jwtKey = _configuration["Jwt:Key"]
            ?? throw new InvalidOperationException("JWT key is missing");

        var claims = new List<Claim>
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id),
            new Claim(ClaimTypes.Email, user.Email ?? ""),
            new Claim(ClaimTypes.Name, user.UserName ?? "")
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));

        var credentials = new SigningCredentials(
            key,
            SecurityAlgorithms.HmacSha256
        );

        var token = new JwtSecurityToken(
            claims: claims,
            expires: DateTime.UtcNow.AddHours(2),
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

public record RegisterRequest(string Email, string Password);
public record LoginRequest(string Email, string Password);
public record ResendConfirmationRequest(
    [Required, StringLength(254), EmailAddress] string? Email);
public record ConfirmEmailRequest(string UserId, string Token);
public record ForgotPasswordRequest(
    [Required, StringLength(254), EmailAddress] string? Email);
public record ResetPasswordRequest(string Email, string Token, string NewPassword);
