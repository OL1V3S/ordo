using Microsoft.AspNetCore.WebUtilities;

namespace BudgetPlanner.Authentication;

/// <summary>
/// Fixed <c>iss</c> and <c>aud</c> values for Ordo access tokens (#301), and the
/// claims that tie a token to a live session (#337).
/// Constants on purpose: not secret, one deployment, and not bound to configuration.
/// Issued by <c>AuthController.GenerateJwtToken</c> and required by the JWT bearer validator.
/// </summary>
public static class AccessTokenClaims
{
    public const string Issuer = "ordo-api";
    public const string Audience = "ordo-clients";

    /// <summary>
    /// Device-session and web-session tokens: the session id, protected with ASP.NET
    /// Data Protection (never the bare id). Read by this literal name from the validated principal.
    /// </summary>
    public const string SessionId = "sid";

    /// <summary>
    /// <c>/login</c> tokens (no session): base64url SHA-256 of the user's security stamp.
    /// Read by this literal name from the validated principal.
    /// </summary>
    public const string StampHash = "ordo_stamp";

    /// <summary>Data Protection purpose for <see cref="SessionId"/>. Changing it invalidates every issued token.</summary>
    public const string SessionIdProtectorPurpose = "BudgetPlanner.Authentication.AccessTokenSessionId.v1";

    /// <summary>The <see cref="StampHash"/> claim value for a security stamp.</summary>
    public static string StampHashValue(string? securityStamp) =>
        WebEncoders.Base64UrlEncode(DeviceSessionCredential.HashSecurityStamp(securityStamp));
}
