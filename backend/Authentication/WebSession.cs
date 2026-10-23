using BudgetPlanner.Configuration;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Options;

namespace BudgetPlanner.Authentication;

/// <summary>
/// Cookie carrying the long-lived web session credential (#292). It is the same
/// <see cref="DeviceSessionCredential"/> as the native device sessions; only the
/// transport differs. Only the three web-session endpoints read or write it.
/// </summary>
public static class WebSessionCookie
{
    public const string Name = "__Secure-ordo-web-session";
    public const string CookiePath = "/api/auth/web-session";
    public const string CsrfHeader = "X-Ordo-Web-Session";

    public static string? Read(HttpRequest request) =>
        request.Cookies.TryGetValue(Name, out var value) && !string.IsNullOrEmpty(value) ? value : null;

    public static void Write(HttpContext context, string credential)
    {
        var idle = context.RequestServices.GetRequiredService<IOptions<DeviceSessionOptions>>().Value.IdleTimeout;
        context.Response.Cookies.Append(Name, credential, Options(idle));
    }

    public static void Clear(HttpContext context) =>
        context.Response.Cookies.Delete(Name, Options(null));

    private static CookieOptions Options(TimeSpan? maxAge) => new()
    {
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.Strict,
        Path = CookiePath,
        MaxAge = maxAge
    };
}

/// <summary>
/// CSRF guard for the web-session endpoints. A resource filter, so it runs before
/// model binding and validation: a forged or malformed request gets 403, never 400.
/// Requires the custom header and an <c>Origin</c> equal (scheme, host, port) to
/// <c>Frontend:BaseUrl</c>; anything else fails closed. Responses are never cacheable.
/// </summary>
public sealed class WebSessionGuardFilter(IOptions<FrontendOptions> frontend) : IAsyncResourceFilter
{
    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        var request = context.HttpContext.Request;
        context.HttpContext.Response.Headers.CacheControl = "no-store";

        if (request.Headers[WebSessionCookie.CsrfHeader] != "1"
            || !OriginMatches(request.Headers.Origin.ToString(), frontend.Value.BaseUrl))
        {
            context.Result = new StatusCodeResult(StatusCodes.Status403Forbidden);
            return;
        }

        await next();
    }

    private static bool OriginMatches(string origin, string baseUrl)
    {
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var actual)
            || !Uri.TryCreate(baseUrl, UriKind.Absolute, out var expected))
            return false;

        return actual.AbsolutePath == "/"
            && actual.Query.Length == 0
            && actual.Fragment.Length == 0
            && actual.UserInfo.Length == 0
            && actual.Scheme == expected.Scheme
            && string.Equals(actual.Host, expected.Host, StringComparison.OrdinalIgnoreCase)
            && actual.Port == expected.Port;
    }
}

public sealed class WebSessionGuardAttribute() : ServiceFilterAttribute(typeof(WebSessionGuardFilter));
