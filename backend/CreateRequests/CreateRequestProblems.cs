using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace BudgetPlanner.CreateRequests;

/// <summary>
/// ProblemDetails responses for idempotent creates. Details are generic and never echo
/// the key, any financial input, or the identity of an existing record.
/// </summary>
public static class CreateRequestProblems
{
    public const string Invalid = "idempotency_key_invalid";
    public const string Reused = "idempotency_key_reused";
    public const string RecordDeleted = "idempotency_key_record_deleted";
    public const string Conflict = "idempotency_key_conflict";

    public static ObjectResult InvalidKey() => Build(
        StatusCodes.Status400BadRequest,
        Invalid,
        "The Idempotency-Key header must be exactly one non-zero UUID.");

    public static ObjectResult For(IdempotentCreateStatus status) => status switch
    {
        IdempotentCreateStatus.KeyReused => Build(
            StatusCodes.Status422UnprocessableEntity,
            Reused,
            "This Idempotency-Key was already used for a different request."),
        IdempotentCreateStatus.RecordDeleted => Build(
            StatusCodes.Status409Conflict,
            RecordDeleted,
            "The record created by this Idempotency-Key no longer exists, so nothing was created."),
        _ => Build(
            StatusCodes.Status409Conflict,
            Conflict,
            "The request could not be completed because of a concurrent request. Retry with the same Idempotency-Key.")
    };

    private static ObjectResult Build(int status, string code, string detail)
    {
        var problem = new ProblemDetails
        {
            Status = status,
            Title = "Create request failed",
            Detail = detail,
            Type = $"https://ordo.invalid/problems/{code}"
        };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status };
    }
}
