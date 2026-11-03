using System.Diagnostics;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Routing;

namespace BudgetPlanner.Diagnostics;

/// <summary>
/// Gives every request a server-generated support reference (#340), returns it in the
/// <c>X-Request-Id</c> response header and writes one privacy-safe completion line.
/// Runs first in the pipeline so redirects, preflight, 401/404/429/500 and health checks are covered.
/// An inbound <c>X-Request-Id</c> is never read, so a client cannot spoof or inject one.
/// The completion line has exactly five fields: request, method, route template, status, duration.
/// It never contains the path, query, headers, cookies, tokens, bodies, claims, user IDs, IP, emails,
/// amounts or exception text.
/// </summary>
public sealed class RequestCorrelationMiddleware(
    RequestDelegate next,
    ILogger<RequestCorrelationMiddleware> logger)
{
    public const string HeaderName = "X-Request-Id";
    public const string RequestIdKey = "Ordo.RequestId";
    public const string RouteTemplateKey = "Ordo.RouteTemplate";
    public const string UnmatchedRoute = "unmatched";
    public const string OtherMethod = "OTHER";

    private static readonly HashSet<string> AllowedMethods = new(StringComparer.Ordinal)
    {
        "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"
    };

    /// <summary>The request ID of this request, or null outside the correlated pipeline.</summary>
    public static string? GetRequestId(HttpContext context) =>
        context.Items.TryGetValue(RequestIdKey, out var value) ? value as string : null;

    /// <summary>Only the standard methods are logged; anything else is OTHER.</summary>
    public static string SafeMethod(string method) =>
        AllowedMethods.Contains(method) ? method : OtherMethod;

    /// <summary>
    /// The endpoint template, never the concrete path. A handled 500 resets the endpoint, so the
    /// exception handler stores the template it read from <c>IExceptionHandlerFeature</c>.
    /// </summary>
    public static string RouteTemplate(HttpContext context)
    {
        if (context.Items.TryGetValue(RouteTemplateKey, out var stored) && stored is string template)
            return template;
        return (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? UnmatchedRoute;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var requestId = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(8));
        context.Items[RequestIdKey] = requestId;
        // OnStarting survives the exception handler's response reset, so a handled 500 keeps the header.
        context.Response.OnStarting(
            static state =>
            {
                var (response, id) = ((HttpResponse, string))state;
                response.Headers[HeaderName] = id;
                return Task.CompletedTask;
            },
            (context.Response, requestId));

        var started = Stopwatch.GetTimestamp();
        var completed = false;
        using var scope = logger.BeginScope(new Dictionary<string, object> { ["RequestId"] = requestId });
        try
        {
            await next(context);
            completed = true;
        }
        finally
        {
            LogCompletion(context, requestId, completed, started);
        }
    }

    private void LogCompletion(HttpContext context, string requestId, bool completed, long started)
    {
        var status = context.Response.StatusCode;
        if (!completed)
        {
            // An exception escaped the pipeline: a client abort is 499, anything else a 500.
            if (context.RequestAborted.IsCancellationRequested) status = 499;
            else if (!context.Response.HasStarted) status = StatusCodes.Status500InternalServerError;
        }

        // Probes run every few seconds; only failing ones are worth a line.
        if (status < StatusCodes.Status400BadRequest && context.Request.Path.StartsWithSegments("/health"))
            return;

        var level = status >= StatusCodes.Status500InternalServerError ? LogLevel.Warning : LogLevel.Information;
        if (!logger.IsEnabled(level)) return;

        logger.Log(
            level,
            "request_complete request={RequestId} method={Method} route={Route} status={StatusCode} duration_ms={DurationMs}",
            requestId,
            SafeMethod(context.Request.Method),
            RouteTemplate(context),
            status,
            (long)Stopwatch.GetElapsedTime(started).TotalMilliseconds);
    }
}
