using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace BudgetPlanner.Diagnostics;

/// <summary>
/// Adds the additive <c>requestId</c> extension to every ProblemDetails body MVC returns (#340).
/// Registered with the highest order so it runs after the framework's client-error mapping and the
/// Paychecks validation filter, which replace results. Empty and non-ProblemDetails responses are untouched
/// and carry only the <c>X-Request-Id</c> header.
/// </summary>
public sealed class RequestIdProblemFilter : IAlwaysRunResultFilter
{
    public const string ExtensionName = "requestId";

    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is not ObjectResult { Value: ProblemDetails problem }) return;
        var requestId = RequestCorrelationMiddleware.GetRequestId(context.HttpContext);
        if (requestId is not null) problem.Extensions[ExtensionName] = requestId;
    }

    public void OnResultExecuted(ResultExecutedContext context) { }
}
