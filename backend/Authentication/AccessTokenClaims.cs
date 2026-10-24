namespace BudgetPlanner.Authentication;

/// <summary>
/// Fixed <c>iss</c> and <c>aud</c> values for Ordo access tokens (#301).
/// Constants on purpose: not secret, one deployment, and not bound to configuration.
/// Phase 1 only issues them; validation is turned on in phase 2.
/// </summary>
public static class AccessTokenClaims
{
    public const string Issuer = "ordo-api";
    public const string Audience = "ordo-clients";
}
