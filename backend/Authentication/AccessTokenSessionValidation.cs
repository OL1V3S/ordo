using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;

namespace BudgetPlanner.Authentication;

/// <summary>
/// Protects the session id inside access tokens (#337). A bare session id in a JWT
/// would let anyone who reads a token end that session, because sign-out acts on a
/// well-formed credential without checking its secret. Keys persist in the database.
/// </summary>
public sealed class AccessTokenSessionIdProtector(IDataProtectionProvider provider)
{
    private readonly IDataProtector _protector = provider.CreateProtector(AccessTokenClaims.SessionIdProtectorPurpose);

    public string Protect(Guid sessionId) =>
        WebEncoders.Base64UrlEncode(_protector.Protect(sessionId.ToByteArray()));

    /// <summary>
    /// False for a value that is not a session id we protected (garbage, tampered, another
    /// purpose, lost key). Anything else, such as a failure to read the key ring, is thrown
    /// so it reaches the safe 500 instead of looking like an invalid token.
    /// </summary>
    public bool TryUnprotect(string? value, out Guid sessionId)
    {
        sessionId = Guid.Empty;
        if (string.IsNullOrEmpty(value))
            return false;

        byte[] payload;
        try
        {
            payload = WebEncoders.Base64UrlDecode(value);
        }
        catch (FormatException)
        {
            return false;
        }

        try
        {
            var plain = _protector.Unprotect(payload);
            if (plain.Length != 16)
                return false;

            sessionId = new Guid(plain);
            return sessionId != Guid.Empty;
        }
        // Data Protection reports an invalid payload or an unknown key as a
        // CryptographicException with no inner exception. It wraps any other failure
        // (for example a database error while loading keys) with one: rethrow that.
        catch (CryptographicException exception) when (exception.InnerException is null)
        {
            return false;
        }
    }
}

/// <summary>
/// The per-request check (#337): after signature, issuer, audience and lifetime,
/// a bearer token must belong to a live session (<c>sid</c>) or, for <c>/login</c>
/// tokens, carry the user's current security stamp hash (<c>ordo_stamp</c>).
/// A failure is the normal bearer 401, before any controller runs. Exceptions
/// (such as a database error) are not turned into 401.
/// </summary>
public static class AccessTokenSessionValidation
{
    // Fixed text: no ids, tokens or claim values.
    public const string FailureMessage = "The access token is not tied to a current session.";

    public static async Task OnTokenValidatedAsync(TokenValidatedContext context)
    {
        var services = context.HttpContext.RequestServices;
        var current = await IsCurrentAsync(
            context.Principal,
            services.GetRequiredService<AccessTokenSessionIdProtector>(),
            services.GetRequiredService<IDeviceSessionService>());

        if (!current)
            context.Fail(FailureMessage);
    }

    internal static async Task<bool> IsCurrentAsync(
        ClaimsPrincipal? principal,
        AccessTokenSessionIdProtector protector,
        IDeviceSessionService sessions)
    {
        if (principal is null)
            return false;

        // Claims are read by literal name. A claim-mapping change fails closed (401)
        // and the pin tests catch it.
        var userId = principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId))
            return false;

        var sessionClaims = principal.FindAll(AccessTokenClaims.SessionId).ToList();
        var stampClaims = principal.FindAll(AccessTokenClaims.StampHash).ToList();

        // Exactly one of the two: neither (older token) or both fail.
        if (sessionClaims.Count + stampClaims.Count != 1)
            return false;

        // The query is tiny and indexed; it is not tied to the request token so a
        // client disconnect does not log an error from the bearer handler.
        if (sessionClaims.Count == 1)
        {
            return protector.TryUnprotect(sessionClaims[0].Value, out var sessionId)
                && await sessions.IsAccessTokenCurrentAsync(userId, sessionId, null, CancellationToken.None);
        }

        return await sessions.IsAccessTokenCurrentAsync(userId, null, stampClaims[0].Value, CancellationToken.None);
    }
}
