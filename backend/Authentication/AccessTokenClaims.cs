namespace BudgetPlanner.Authentication;

/// <summary>
/// Fixed <c>iss</c> and <c>aud</c> values for Ordo access tokens (#301).
/// Constants on purpose: not secret, one deployment, and not bound to configuration.
/// Issued by <c>AuthController.GenerateJwtToken</c> and required by the JWT bearer validator.
/// </summary>
public static class AccessTokenClaims
{
    public const string Issuer = "ordo-api";
    public const string Audience = "ordo-clients";
}
