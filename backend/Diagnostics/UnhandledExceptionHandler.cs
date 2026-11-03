using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;

namespace BudgetPlanner.Diagnostics;

/// <summary>
/// Turns any unhandled exception into one fixed 500 body and one privacy-safe log line.
/// It never exposes or logs the exception message, stack, inner exceptions or request data.
/// </summary>
public sealed class UnhandledExceptionHandler(ILogger<UnhandledExceptionHandler> logger) : IExceptionHandler
{
    public const string Code = "internal_error";

    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        // The middleware clears the endpoint before handlers run, so read it from the feature.
        var endpoint = httpContext.Features.Get<IExceptionHandlerFeature>()?.Endpoint as RouteEndpoint;
        var routeTemplate = endpoint?.RoutePattern.RawText ?? RequestCorrelationMiddleware.UnmatchedRoute;
        // The reset above also hides the endpoint from the completion line; hand it the template.
        httpContext.Items[RequestCorrelationMiddleware.RouteTemplateKey] = routeTemplate;
        var requestId = RequestCorrelationMiddleware.GetRequestId(httpContext);

        // Deliberately not passing the exception object: providers would print message and stack.
        logger.LogError(
            "Unhandled {ExceptionType} for {Method} {RouteTemplate}; status {StatusCode}; request {RequestId}",
            exception.GetType().Name,
            RequestCorrelationMiddleware.SafeMethod(httpContext.Request.Method),
            routeTemplate,
            StatusCodes.Status500InternalServerError,
            requestId);

        if (httpContext.Response.HasStarted)
            return true;

        httpContext.Response.StatusCode = StatusCodes.Status500InternalServerError;
        var problem = new ProblemDetails
        {
            Type = $"https://ordo.invalid/problems/{Code}",
            Title = "Unexpected error",
            Detail = "The request could not be completed.",
            Status = StatusCodes.Status500InternalServerError,
            Extensions =
            {
                ["code"] = Code,
                ["traceId"] = httpContext.TraceIdentifier
            }
        };
        if (requestId is not null)
            problem.Extensions[RequestIdProblemFilter.ExtensionName] = requestId;
        await httpContext.Response.WriteAsJsonAsync(
            problem, options: null, contentType: "application/problem+json", cancellationToken);
        return true;
    }
}
