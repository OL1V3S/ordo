using System.IdentityModel.Tokens.Jwt;
using System.Net;
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
    private readonly IRegistrationLimiter _registrationLimiter;
    private readonly IClientIpLimiter _clientIpLimiter;
    private readonly IBackgroundEmailQueue _backgroundEmails;
    private readonly IDeviceSessionService _deviceSessions;
    private readonly AccessTokenSessionIdProtector _sessionIds;
    private readonly PasswordTimingEqualizer _passwordTiming;
    private readonly BudgetContext _context;
    private readonly ILogger<AuthController> _logger;

    public AuthController(
        UserManager<ApplicationUser> userManager,
        IConfiguration configuration,
        IEmailService emailService,
        IAccountConfirmationService accountConfirmationService,
        IConfirmationResendLimiter confirmationResendLimiter,
        IForgotPasswordLimiter forgotPasswordLimiter,
        IRegistrationLimiter registrationLimiter,
        IClientIpLimiter clientIpLimiter,
        IBackgroundEmailQueue backgroundEmails,
        IDeviceSessionService deviceSessions,
        AccessTokenSessionIdProtector sessionIds,
        PasswordTimingEqualizer passwordTiming,
        BudgetContext context,
        ILogger<AuthController> logger)
    {
        _userManager = userManager;
        _configuration = configuration;
        _emailService = emailService;
        _accountConfirmationService = accountConfirmationService;
        _confirmationResendLimiter = confirmationResendLimiter;
        _forgotPasswordLimiter = forgotPasswordLimiter;
        _registrationLimiter = registrationLimiter;
        _clientIpLimiter = clientIpLimiter;
        _backgroundEmails = backgroundEmails;
        _deviceSessions = deviceSessions;
        _sessionIds = sessionIds;
        _passwordTiming = passwordTiming;
        _context = context;
        _logger = logger;
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register(
        RegisterRequest request,
        CancellationToken cancellationToken)
    {
        // #332: per-IP first, before any account lookup or other limiter.
        if (!_clientIpLimiter.TryAcquire(ClientIpGroup.Email, HttpContext.Connection.RemoteIpAddress))
            return StatusCode(StatusCodes.Status429TooManyRequests);

        // #300: one limiter for every registration, checked before the account
        // check, so the same 429 applies whether or not the email is taken.
        if (!_registrationLimiter.TryAcquireGlobal())
            return StatusCode(StatusCodes.Status429TooManyRequests);

        if (!_registrationLimiter.TryAcquireRecipient(request.Email ?? string.Empty))
            return StatusCode(StatusCodes.Status429TooManyRequests);

        var user = new ApplicationUser
        {
            UserName = request.Email,
            Email = request.Email
        };

        var result = await _userManager.CreateAsync(user, request.Password);

        if (!result.Succeeded)
        {
            var errors = result.Errors.ToList();

            // A taken email answers exactly like a new registration (#300).
            if (errors.Count > 0 && errors.All(IsDuplicateAccountError))
                return await NotifyExistingAccountAsync(request, cancellationToken);

            return BadRequest(errors.Where(error => !IsDuplicateAccountError(error)).ToList());
        }

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
            return RegistrationDeliveryFailed();
        }

        return RegistrationAccepted();
    }

    private static bool IsDuplicateAccountError(IdentityError error) =>
        error.Code is nameof(IdentityErrorDescriber.DuplicateUserName)
            or nameof(IdentityErrorDescriber.DuplicateEmail);

    private ObjectResult RegistrationAccepted() => Ok(new
    {
        message = "User registered successfully. Please check your email to confirm your account."
    });

    private ObjectResult RegistrationDeliveryFailed() => StatusCode(
        StatusCodes.Status503ServiceUnavailable,
        new
        {
            code = "confirmation_email_delivery_failed",
            message = "Your account was created, but we couldn't send the confirmation email. Please request a new confirmation email."
        });

    /// <summary>
    /// Emails the existing owner (stored address, no token, record unchanged)
    /// and returns the same response as a new registration. Logs the user ID
    /// only, never the email.
    /// </summary>
    private async Task<IActionResult> NotifyExistingAccountAsync(
        RegisterRequest request,
        CancellationToken cancellationToken)
    {
        var existingUser = await _userManager.FindByEmailAsync(request.Email);

        if (existingUser?.Email == null)
        {
            _logger.LogInformation("Registration matched a taken email but no account was found; no email sent.");
            return RegistrationAccepted();
        }

        var frontendBaseUrl = (_configuration["Frontend:BaseUrl"] ?? string.Empty).TrimEnd('/');
        var content = AccountEmailTemplates.ExistingAccountEmail(
            EmailLanguageParser.Parse(request.Language),
            WebUtility.HtmlEncode($"{frontendBaseUrl}/"),
            WebUtility.HtmlEncode($"{frontendBaseUrl}/forgot-password"));

        _logger.LogInformation(
            "Attempting existing-account email delivery for user {UserId}",
            existingUser.Id);

        try
        {
            await _emailService.SendEmailAsync(
                existingUser.Email,
                content.Subject,
                content.HtmlBody,
                cancellationToken);

            _logger.LogInformation(
                "Existing-account email accepted by the email provider for user {UserId}",
                existingUser.Id);
        }
        catch (EmailDeliveryException exception)
        {
            _logger.LogError(
                exception,
                "Existing-account email delivery failed for user {UserId}",
                existingUser.Id);
            return RegistrationDeliveryFailed();
        }

        return RegistrationAccepted();
    }

    [HttpPost("resend-confirmation")]
    public async Task<IActionResult> ResendConfirmation(ResendConfirmationRequest request)
    {
        // #332: per-IP first, before any account lookup or other limiter.
        if (!_clientIpLimiter.TryAcquire(ClientIpGroup.Email, HttpContext.Connection.RemoteIpAddress))
            return StatusCode(StatusCodes.Status429TooManyRequests);

        if (!_confirmationResendLimiter.TryAcquireGlobal())
            return StatusCode(StatusCodes.Status429TooManyRequests);

        if (!_confirmationResendLimiter.TryAcquireRecipient(request.Email!))
            return StatusCode(StatusCodes.Status429TooManyRequests);

        var user = await _userManager.FindByEmailAsync(request.Email!);

        // #319: the confirmed-state check, token, link and send run in the
        // background so response time and status do not depend on the account.
        if (user != null)
        {
            QueueBackgroundEmail(
                user,
                BackgroundEmailKind.ConfirmationResend,
                EmailLanguageParser.Parse(request.Language));
        }

        return Accepted(new
        {
            message = "If an unconfirmed account exists for that email, a confirmation link has been sent."
        });
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginRequest request)
    {
        // #332: per-IP first, so rejected requests cost no hash and do not
        // count toward lockout.
        if (!_clientIpLimiter.TryAcquire(ClientIpGroup.SignIn, HttpContext.Connection.RemoteIpAddress))
            return StatusCode(StatusCodes.Status429TooManyRequests);

        // Shared sign-in checks (#299): unknown email, wrong password and locked
        // out all return the same response.
        var signIn = await CheckPasswordWithLockoutAsync(request.Email, request.Password);

        if (signIn == null)
            return Unauthorized("Invalid email or password");

        var user = signIn.User;

        // An unconfirmed account gets exactly the invalid-credentials response,
        // even with the right password, so sign-in never reveals that the
        // account exists or is unconfirmed (#318). Clients offer a resend.
        if (!await _userManager.IsEmailConfirmedAsync(user))
            return Unauthorized("Invalid email or password");

        // No session: the token carries the stamp hash instead of a session id (#337).
        var token = GenerateJwtToken(user, new Claim(AccessTokenClaims.StampHash, AccessTokenClaims.StampHashValue(signIn.SecurityStamp)));

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
        // #332: per-IP first, so rejected requests cost no hash and do not
        // count toward lockout.
        if (!_clientIpLimiter.TryAcquire(ClientIpGroup.SignIn, HttpContext.Connection.RemoteIpAddress))
            return StatusCode(StatusCodes.Status429TooManyRequests);

        // Same shared sign-in checks as Login (#299).
        var signIn = await CheckPasswordWithLockoutAsync(request.Email!, request.Password!);

        if (signIn == null)
            return Unauthorized(new { code = "invalid_credentials" });

        var user = signIn.User;
        var securityStamp = signIn.SecurityStamp;

        // Unconfirmed: same response as invalid credentials (#318).
        if (!await _userManager.IsEmailConfirmedAsync(user))
            return Unauthorized(new { code = "invalid_credentials" });

        var created = await _deviceSessions.CreateAsync(user.Id, securityStamp, cancellationToken);

        Response.Headers.CacheControl = "no-store";
        return Ok(new
        {
            token = GenerateSessionJwtToken(user, created.SessionId),
            email = user.Email,
            refreshToken = created.Credential
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
            token = GenerateSessionJwtToken(issued.User, issued.SessionId),
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
        // #332: per-IP first, so rejected requests cost no hash and do not
        // count toward lockout.
        if (!_clientIpLimiter.TryAcquire(ClientIpGroup.SignIn, HttpContext.Connection.RemoteIpAddress))
            return StatusCode(StatusCodes.Status429TooManyRequests);

        // Same shared sign-in checks and error bodies as Login (#299).
        var signIn = await CheckPasswordWithLockoutAsync(request.Email, request.Password);

        if (signIn == null)
            return Unauthorized("Invalid email or password");

        var user = signIn.User;
        var securityStamp = signIn.SecurityStamp;

        // Unconfirmed: same response as invalid credentials (#318). Checked
        // before the existing-cookie sign-out so the current session survives.
        if (!await _userManager.IsEmailConfirmedAsync(user))
            return Unauthorized("Invalid email or password");

        // End the session of a cookie being replaced, so orphaned rows cannot
        // use up the shared per-account session cap.
        var existing = WebSessionCookie.Read(Request);
        if (existing != null)
            await _deviceSessions.SignOutAsync(existing, cancellationToken);

        var created = await _deviceSessions.CreateAsync(user.Id, securityStamp, cancellationToken);

        WebSessionCookie.Write(HttpContext, created.Credential);
        return Ok(new
        {
            token = GenerateSessionJwtToken(user, created.SessionId),
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
            token = GenerateSessionJwtToken(issued.User, issued.SessionId),
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
    public async Task<IActionResult> ForgotPassword(ForgotPasswordRequest request)
    {
        // #332: per-IP first, before any account lookup or other limiter.
        if (!_clientIpLimiter.TryAcquire(ClientIpGroup.Email, HttpContext.Connection.RemoteIpAddress))
            return StatusCode(StatusCodes.Status429TooManyRequests);

        if (!_forgotPasswordLimiter.TryAcquireGlobal())
            return StatusCode(StatusCodes.Status429TooManyRequests);

        if (!_forgotPasswordLimiter.TryAcquireRecipient(request.Email!))
            return StatusCode(StatusCodes.Status429TooManyRequests);

        var user = await _userManager.FindByEmailAsync(request.Email!);

        // #319: the token, link and send run in the background so response time and
        // status do not depend on whether the account exists.
        if (user != null)
        {
            QueueBackgroundEmail(
                user,
                BackgroundEmailKind.PasswordReset,
                EmailLanguageParser.Parse(request.Language));
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

        // #319: an unknown email gets the same response as a known email with a bad
        // token, so the endpoint does not reveal whether an account exists.
        if (user == null)
            return BadRequest(new[] { _userManager.ErrorDescriber.InvalidToken() });

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

    private void QueueBackgroundEmail(
        ApplicationUser user,
        BackgroundEmailKind kind,
        EmailLanguage language)
    {
        // Never waits. A full queue drops the item and the response stays the same.
        if (!_backgroundEmails.TryEnqueue(new BackgroundEmailJob(user.Id, language, kind)))
        {
            _logger.LogWarning(
                "Background email queue is full; dropped {Kind} email for user {UserId}",
                kind,
                user.Id);
        }
    }

    private sealed record PasswordSignIn(ApplicationUser User, string? SecurityStamp);

    /// <summary>
    /// Password sign-in with account lockout (#299), shared by Login, CreateDeviceSession
    /// and CreateWebSession. Returns null for an unknown email, a wrong password or a
    /// locked account, so callers return one identical response for all three. The
    /// confirmed-email check stays with the caller and runs only after this succeeds;
    /// an unconfirmed account then gets the same response too (#318). Unknown and locked
    /// accounts verify a dummy hash first (#319), so response time does not show account
    /// state; the stored hash of a locked account is never checked.
    /// </summary>
    private async Task<PasswordSignIn?> CheckPasswordWithLockoutAsync(string email, string password)
    {
        var user = await _userManager.FindByEmailAsync(email);

        if (user == null)
        {
            _passwordTiming.Equalize(_userManager.PasswordHasher);
            return null;
        }

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
        {
            // Self-heal: a row left at the max count with no active lock (e.g. a failure
            // between the reservation and the lock update) becomes a normal timed lock.
            var healedUntil = now.Add(lockout.DefaultLockoutTimeSpan);
            await _context.Users
                .Where(value => value.Id == userId
                    && value.LockoutEnabled
                    && (value.LockoutEnd == null || value.LockoutEnd <= now)
                    && value.AccessFailedCount >= lockout.MaxFailedAccessAttempts)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(value => value.LockoutEnd, healedUntil)
                    .SetProperty(value => value.AccessFailedCount, 0));
            _passwordTiming.Equalize(_userManager.PasswordHasher);
            return null;
        }

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
        {
            _passwordTiming.Equalize(_userManager.PasswordHasher);
            return null;
        }

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

    // Session tokens carry the session id protected with Data Protection, never bare (#337).
    private string GenerateSessionJwtToken(ApplicationUser user, Guid sessionId) =>
        GenerateJwtToken(user, new Claim(AccessTokenClaims.SessionId, _sessionIds.Protect(sessionId)));

    private string GenerateJwtToken(ApplicationUser user, Claim sessionBinding)
    {
        var jwtKey = _configuration["Jwt:Key"]
            ?? throw new InvalidOperationException("JWT key is missing");

        var claims = new List<Claim>
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id),
            new Claim(ClaimTypes.Email, user.Email ?? ""),
            new Claim(ClaimTypes.Name, user.UserName ?? ""),
            sessionBinding
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));

        var credentials = new SigningCredentials(
            key,
            SecurityAlgorithms.HmacSha256
        );

        var token = new JwtSecurityToken(
            issuer: AccessTokenClaims.Issuer,
            audience: AccessTokenClaims.Audience,
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
