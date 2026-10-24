using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.Json.Serialization;
using System.ComponentModel.DataAnnotations;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using BudgetPlanner.Services;
using BudgetPlanner.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
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
    private readonly IDeviceSessionService _deviceSessions;
    private readonly BudgetContext _context;
    private readonly ILogger<AuthController> _logger;

    public AuthController(
        UserManager<ApplicationUser> userManager,
        IConfiguration configuration,
        IEmailService emailService,
        IAccountConfirmationService accountConfirmationService,
        IConfirmationResendLimiter confirmationResendLimiter,
        IForgotPasswordLimiter forgotPasswordLimiter,
        IDeviceSessionService deviceSessions,
        BudgetContext context,
        ILogger<AuthController> logger)
    {
        _userManager = userManager;
        _configuration = configuration;
        _emailService = emailService;
        _accountConfirmationService = accountConfirmationService;
        _confirmationResendLimiter = confirmationResendLimiter;
        _forgotPasswordLimiter = forgotPasswordLimiter;
        _deviceSessions = deviceSessions;
        _context = context;
        _logger = logger;
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
                EmailLanguageParser.Parse(request.Language),
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
                    EmailLanguageParser.Parse(request.Language),
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
        // Shared sign-in checks (#299): unknown email, wrong password and locked
        // out all return the same response.
        var signIn = await CheckPasswordWithLockoutAsync(request.Email, request.Password);

        if (signIn == null)
            return Unauthorized("Invalid email or password");

        var user = signIn.User;

        if (!await _userManager.IsEmailConfirmedAsync(user))
            return Unauthorized("Please confirm your email before logging in.");

        var token = GenerateJwtToken(user);

        return Ok(new
        {
            token,
            email = user.Email
        });
    }

    // Device sessions for native clients (#252). Proof is the password (create) or the
    // session credential (refresh, sign-out); none of these use cookies or an access token.
    [HttpPost("device-sessions")]
    public async Task<IActionResult> CreateDeviceSession(
        CreateDeviceSessionRequest request,
        CancellationToken cancellationToken)
    {
        // Same shared sign-in checks as Login (#299).
        var signIn = await CheckPasswordWithLockoutAsync(request.Email!, request.Password!);

        if (signIn == null)
            return Unauthorized(new { code = "invalid_credentials" });

        var user = signIn.User;
        var securityStamp = signIn.SecurityStamp;

        if (!await _userManager.IsEmailConfirmedAsync(user))
            return Unauthorized(new { code = "email_not_confirmed" });

        var credential = await _deviceSessions.CreateAsync(user.Id, securityStamp, cancellationToken);

        Response.Headers.CacheControl = "no-store";
        return Ok(new
        {
            token = GenerateJwtToken(user),
            email = user.Email,
            refreshToken = credential
        });
    }

    [HttpPost("device-sessions/refresh")]
    public async Task<IActionResult> RefreshDeviceSession(
        DeviceSessionCredentialRequest request,
        CancellationToken cancellationToken)
    {
        var issued = await _deviceSessions.RefreshAsync(request.RefreshToken!, cancellationToken);

        if (issued == null)
            return Unauthorized(new { code = "session_invalid" });

        Response.Headers.CacheControl = "no-store";
        return Ok(new
        {
            token = GenerateJwtToken(issued.User),
            email = issued.User.Email,
            refreshToken = issued.Credential
        });
    }

    [HttpPost("device-sessions/sign-out")]
    public async Task<IActionResult> SignOutDeviceSession(
        DeviceSessionCredentialRequest request,
        CancellationToken cancellationToken)
    {
        await _deviceSessions.SignOutAsync(request.RefreshToken!, cancellationToken);
        return NoContent();
    }

    // Web sessions (#292): the same session as device sessions, but the credential
    // travels only in an HttpOnly cookie and never in a body. Every action is behind
    // WebSessionGuard (Origin + custom header) and none reads an access token.
    [HttpPost("web-session")]
    [WebSessionGuard]
    public async Task<IActionResult> CreateWebSession(
        LoginRequest request,
        CancellationToken cancellationToken)
    {
        // Same shared sign-in checks and error bodies as Login (#299).
        var signIn = await CheckPasswordWithLockoutAsync(request.Email, request.Password);

        if (signIn == null)
            return Unauthorized("Invalid email or password");

        var user = signIn.User;
        var securityStamp = signIn.SecurityStamp;

        if (!await _userManager.IsEmailConfirmedAsync(user))
            return Unauthorized("Please confirm your email before logging in.");

        // End the session of a cookie being replaced, so orphaned rows cannot
        // use up the shared per-account session cap.
        var existing = WebSessionCookie.Read(Request);
        if (existing != null)
            await _deviceSessions.SignOutAsync(existing, cancellationToken);

        var credential = await _deviceSessions.CreateAsync(user.Id, securityStamp, cancellationToken);

        WebSessionCookie.Write(HttpContext, credential);
        return Ok(new
        {
            token = GenerateJwtToken(user),
            email = user.Email
        });
    }

    [HttpPost("web-session/refresh")]
    [WebSessionGuard]
    public async Task<IActionResult> RefreshWebSession(CancellationToken cancellationToken)
    {
        var credential = WebSessionCookie.Read(Request);
        var issued = credential == null
            ? null
            : await _deviceSessions.RefreshAsync(credential, cancellationToken);

        if (issued == null)
        {
            WebSessionCookie.Clear(HttpContext);
            return Unauthorized(new { code = "session_invalid" });
        }

        WebSessionCookie.Write(HttpContext, issued.Credential);
        return Ok(new
        {
            token = GenerateJwtToken(issued.User),
            email = issued.User.Email
        });
    }

    [HttpPost("web-session/sign-out")]
    [WebSessionGuard]
    public async Task<IActionResult> SignOutWebSession(CancellationToken cancellationToken)
    {
        var credential = WebSessionCookie.Read(Request);
        if (credential != null)
            await _deviceSessions.SignOutAsync(credential, cancellationToken);

        WebSessionCookie.Clear(HttpContext);
        return NoContent();
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
                var content = AccountEmailTemplates.PasswordResetEmail(
                    EmailLanguageParser.Parse(request.Language),
                    resetLink);

                await _emailService.SendEmailAsync(
                    request.Email!,
                    content.Subject,
                    content.HtmlBody,
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

        // The password has already changed, so finish ending device sessions even if
        // the client disconnects. The security-stamp binding is the fallback.
        await _deviceSessions.RevokeAllAsync(user.Id, CancellationToken.None);

        return Ok(new { message = "Password reset successfully" });
    }

    private sealed record PasswordSignIn(ApplicationUser User, string? SecurityStamp);

    /// <summary>
    /// Password sign-in with account lockout (#299), shared by Login, CreateDeviceSession
    /// and CreateWebSession. Returns null for an unknown email, a wrong password or a
    /// locked account, so callers return one identical response for all three. The
    /// confirmed-email check stays with the caller and runs only after this succeeds.
    /// </summary>
    private async Task<PasswordSignIn?> CheckPasswordWithLockoutAsync(string email, string password)
    {
        var user = await _userManager.FindByEmailAsync(email);

        if (user == null)
            return null;

        if (!await _userManager.GetLockoutEnabledAsync(user))
        {
            // Lockout disabled for this account: never count failures or write LockoutEnd.
            if (!await _userManager.CheckPasswordAsync(user, password))
                return null;

            return new PasswordSignIn(user, user.SecurityStamp);
        }

        return _context.Database.IsRelational()
            ? await CheckPasswordWithAtomicLockoutAsync(user, password)
            : await CheckPasswordWithIdentityLockoutAsync(user, password);
    }

    // Relational providers: reserve the attempt atomically BEFORE hashing, so parallel
    // guesses cannot exceed MaxFailedAccessAttempts password checks per lockout window.
    // ConcurrencyStamp is left untouched on purpose, so a password re-hash during a
    // successful sign-in still saves (and keeps the security stamp read below).
    private async Task<PasswordSignIn?> CheckPasswordWithAtomicLockoutAsync(ApplicationUser user, string password)
    {
        var lockout = _userManager.Options.Lockout;
        var userId = user.Id;
        var now = DateTimeOffset.UtcNow;

        var reserved = await _context.Users
            .Where(value => value.Id == userId
                && value.LockoutEnabled
                && (value.LockoutEnd == null || value.LockoutEnd <= now)
                && value.AccessFailedCount < lockout.MaxFailedAccessAttempts)
            .ExecuteUpdateAsync(setters => setters.SetProperty(
                value => value.AccessFailedCount,
                value => value.AccessFailedCount + 1));

        // Locked out or out of attempts: reject without checking the password.
        if (reserved == 0)
            return null;

        if (!await _userManager.CheckPasswordAsync(user, password))
        {
            // The reservation already counted this failure; lock once the budget is used.
            var lockedUntil = DateTimeOffset.UtcNow.Add(lockout.DefaultLockoutTimeSpan);
            await _context.Users
                .Where(value => value.Id == userId
                    && value.LockoutEnabled
                    && value.AccessFailedCount >= lockout.MaxFailedAccessAttempts)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(value => value.LockoutEnd, lockedUntil)
                    .SetProperty(value => value.AccessFailedCount, 0));
            return null;
        }

        // Read from the same tracked user right after the password check, so a password
        // re-hash during this sign-in cannot end the session being created.
        var securityStamp = user.SecurityStamp;

        var reset = await _context.Users
            .Where(value => value.Id == userId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(value => value.AccessFailedCount, 0));
        if (reset == 0)
            _logger.LogWarning("Could not reset the failed sign-in count for user {UserId}.", userId);

        return new PasswordSignIn(user, securityStamp);
    }

    // In-memory provider (tests): ExecuteUpdate is unavailable, so use the Identity
    // primitives in the same order. Not atomic under parallel requests.
    private async Task<PasswordSignIn?> CheckPasswordWithIdentityLockoutAsync(ApplicationUser user, string password)
    {
        if (await _userManager.IsLockedOutAsync(user))
            return null;

        if (!await _userManager.CheckPasswordAsync(user, password))
        {
            var failed = await _userManager.AccessFailedAsync(user);
            if (!failed.Succeeded)
                _logger.LogWarning("Could not record a failed sign-in for user {UserId}.", user.Id);
            return null;
        }

        var securityStamp = user.SecurityStamp;

        var reset = await _userManager.ResetAccessFailedCountAsync(user);
        if (!reset.Succeeded)
            _logger.LogWarning("Could not reset the failed sign-in count for user {UserId}.", user.Id);

        return new PasswordSignIn(user, securityStamp);
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

public record RegisterRequest(
    string Email,
    string Password,
    [property: JsonConverter(typeof(LenientLanguageJsonConverter))] string? Language = null);
public record LoginRequest(string Email, string Password);
public record ResendConfirmationRequest(
    [Required, StringLength(254), EmailAddress] string? Email,
    [property: JsonConverter(typeof(LenientLanguageJsonConverter))] string? Language = null);
public record ConfirmEmailRequest(string UserId, string Token);
public record ForgotPasswordRequest(
    [Required, StringLength(254), EmailAddress] string? Email,
    [property: JsonConverter(typeof(LenientLanguageJsonConverter))] string? Language = null);
public record ResetPasswordRequest(string Email, string Token, string NewPassword);
public record CreateDeviceSessionRequest(
    [Required, StringLength(254)] string? Email,
    [Required] string? Password);
public record DeviceSessionCredentialRequest(
    [Required, StringLength(256)] string? RefreshToken);
