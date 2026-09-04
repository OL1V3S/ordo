using System.Security.Claims;
using BudgetPlanner.Contracts.Paychecks;
using BudgetPlanner.Paychecks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace BudgetPlanner.Controllers;

[ApiController]
[Authorize]
[PaycheckValidation]
[Route("api")]
public sealed class PaychecksController(IPaycheckService paychecks) : ControllerBase
{
    [HttpGet("paycheck-candidates")]
    public async Task<IActionResult> GetCandidates(CancellationToken cancellationToken)
    {
        var ownerId = OwnerId();
        return ownerId is null ? Unauthorized() : Ok(await paychecks.GetCandidatesAsync(ownerId, cancellationToken));
    }

    [HttpPost("paycheck-candidates/dismiss")]
    public async Task<IActionResult> Dismiss(PaycheckCandidateDecisionRequest request, CancellationToken cancellationToken)
    {
        var ownerId = OwnerId();
        if (ownerId is null) return Unauthorized();
        var result = await paychecks.DismissAsync(ownerId, request, cancellationToken);
        return result.IsSuccess ? NoContent() : ErrorResult(result.Error!);
    }

    [HttpPost("paycheck-candidates/reconsider")]
    public async Task<IActionResult> Reconsider(PaycheckCandidateDecisionRequest request, CancellationToken cancellationToken)
    {
        var ownerId = OwnerId();
        if (ownerId is null) return Unauthorized();
        var result = await paychecks.ReconsiderAsync(ownerId, request, cancellationToken);
        return result.IsSuccess ? NoContent() : ErrorResult(result.Error!);
    }

    [HttpPost("paycheck-candidates/confirm")]
    public async Task<IActionResult> Confirm(ConfirmPaycheckRequest request, CancellationToken cancellationToken)
    {
        var ownerId = OwnerId();
        if (ownerId is null) return Unauthorized();
        var result = await paychecks.ConfirmAsync(ownerId, request, cancellationToken);
        if (!result.IsSuccess) return ErrorResult(result.Error!);
        return result.Value!.AlreadyConfirmed ? Ok(result.Value) : StatusCode(StatusCodes.Status201Created, result.Value);
    }

    [HttpPost("paychecks")]
    public async Task<IActionResult> Create(CreatePaycheckRequest request, CancellationToken cancellationToken)
    {
        var ownerId = OwnerId();
        if (ownerId is null) return Unauthorized();
        var result = await paychecks.CreateAsync(ownerId, request, cancellationToken);
        return result.IsSuccess ? CreatedAtAction(nameof(Get), new { id = result.Value!.Id }, result.Value) : ErrorResult(result.Error!);
    }

    [HttpGet("paychecks")]
    public async Task<IActionResult> GetAll(CancellationToken cancellationToken)
    {
        var ownerId = OwnerId();
        return ownerId is null ? Unauthorized() : Ok(await paychecks.GetPaychecksAsync(ownerId, cancellationToken));
    }

    [HttpGet("paychecks/{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken cancellationToken)
    {
        var ownerId = OwnerId();
        if (ownerId is null) return Unauthorized();
        var result = await paychecks.GetAsync(ownerId, id, cancellationToken);
        return result.IsSuccess ? Ok(result.Value) : ErrorResult(result.Error!);
    }

    [HttpPut("paychecks/{id:guid}")]
    public async Task<IActionResult> Update(Guid id, UpdatePaycheckRequest request, CancellationToken cancellationToken)
    {
        var ownerId = OwnerId();
        if (ownerId is null) return Unauthorized();
        var result = await paychecks.UpdateAsync(ownerId, id, request, cancellationToken);
        return result.IsSuccess ? Ok(result.Value) : ErrorResult(result.Error!);
    }

    [HttpPatch("paychecks/{id:guid}/lifecycle")]
    public async Task<IActionResult> UpdateLifecycle(Guid id, UpdatePaycheckLifecycleRequest request, CancellationToken cancellationToken)
    {
        var ownerId = OwnerId();
        if (ownerId is null) return Unauthorized();
        var result = await paychecks.UpdateLifecycleAsync(ownerId, id, request, cancellationToken);
        return result.IsSuccess ? Ok(result.Value) : ErrorResult(result.Error!);
    }

    private string? OwnerId() => User.FindFirstValue(ClaimTypes.NameIdentifier);

    private IActionResult ErrorResult(PaycheckError error)
    {
        if (error.Code == "paycheck_not_found")
        {
            Response.StatusCode = StatusCodes.Status404NotFound;
            return new EmptyResult();
        }
        var status = error.Code switch
        {
            "candidate_changed" or "candidate_dismissed" or "confirmation_conflict" => StatusCodes.Status409Conflict,
            "confirmation_failed" => StatusCodes.Status500InternalServerError,
            _ => StatusCodes.Status400BadRequest
        };
        return StatusCode(status, new ProblemDetails
        {
            Status = status, Title = "Paycheck request failed", Detail = error.Message,
            Type = $"https://ordo.invalid/problems/{error.Code}", Extensions = { ["code"] = error.Code }
        });
    }
}

// Covers ApiController's automatic binding failures without changing other APIs
// or echoing financial input in validation messages.
[AttributeUsage(AttributeTargets.Class)]
internal sealed class PaycheckValidationAttribute : Attribute, IAlwaysRunResultFilter
{
    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is ObjectResult { Value: ValidationProblemDetails })
            context.Result = new BadRequestObjectResult(new ProblemDetails
            {
                Status = StatusCodes.Status400BadRequest, Title = "Paycheck request failed",
                Detail = "The request fields are invalid.", Type = "https://ordo.invalid/problems/request_invalid",
                Extensions = { ["code"] = "request_invalid" }
            });
    }

    public void OnResultExecuted(ResultExecutedContext context) { }
}
