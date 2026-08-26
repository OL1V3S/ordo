using System.Security.Claims;
using BudgetPlanner.Commitments;
using BudgetPlanner.Contracts.Commitments;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BudgetPlanner.Controllers;

[ApiController]
[Authorize]
[Route("api")]
public sealed class CommitmentsController(ICommitmentService commitments) : ControllerBase
{
    [HttpGet("commitment-candidates")]
    public async Task<IActionResult> GetCandidates(CancellationToken cancellationToken)
    {
        var ownerId = OwnerId();
        return ownerId is null
            ? Unauthorized()
            : Ok(await commitments.GetCandidatesAsync(ownerId, cancellationToken));
    }

    [HttpPost("commitment-candidates/dismiss")]
    public async Task<IActionResult> Dismiss(
        CandidateDecisionRequest request,
        CancellationToken cancellationToken)
    {
        var ownerId = OwnerId();
        if (ownerId is null) return Unauthorized();
        var result = await commitments.DismissAsync(ownerId, request, cancellationToken);
        return result.IsSuccess ? NoContent() : ErrorResult(result.Error!);
    }

    [HttpPost("commitment-candidates/reconsider")]
    public async Task<IActionResult> Reconsider(
        CandidateDecisionRequest request,
        CancellationToken cancellationToken)
    {
        var ownerId = OwnerId();
        if (ownerId is null) return Unauthorized();
        var result = await commitments.ReconsiderAsync(ownerId, request, cancellationToken);
        return result.IsSuccess ? NoContent() : ErrorResult(result.Error!);
    }

    [HttpPost("commitment-candidates/confirm")]
    public async Task<IActionResult> Confirm(
        ConfirmCommitmentRequest request,
        CancellationToken cancellationToken)
    {
        var ownerId = OwnerId();
        if (ownerId is null) return Unauthorized();
        var result = await commitments.ConfirmAsync(ownerId, request, cancellationToken);
        if (!result.IsSuccess) return ErrorResult(result.Error!);
        return result.Value!.AlreadyConfirmed
            ? Ok(result.Value)
            : StatusCode(StatusCodes.Status201Created, result.Value);
    }

    [HttpGet("commitments")]
    public async Task<IActionResult> GetCommitments(CancellationToken cancellationToken)
    {
        var ownerId = OwnerId();
        return ownerId is null
            ? Unauthorized()
            : Ok(await commitments.GetCommitmentsAsync(ownerId, cancellationToken));
    }

    [HttpPut("commitments/{id:guid}")]
    public async Task<IActionResult> Update(
        Guid id,
        UpdateCommitmentRequest request,
        CancellationToken cancellationToken)
    {
        var ownerId = OwnerId();
        if (ownerId is null) return Unauthorized();
        var result = await commitments.UpdateAsync(ownerId, id, request, cancellationToken);
        return result.IsSuccess ? Ok(result.Value) : ErrorResult(result.Error!);
    }

    [HttpPatch("commitments/{id:guid}/lifecycle")]
    public async Task<IActionResult> UpdateLifecycle(
        Guid id,
        UpdateCommitmentLifecycleRequest request,
        CancellationToken cancellationToken)
    {
        var ownerId = OwnerId();
        if (ownerId is null) return Unauthorized();
        var result = await commitments.UpdateLifecycleAsync(ownerId, id, request, cancellationToken);
        return result.IsSuccess ? Ok(result.Value) : ErrorResult(result.Error!);
    }

    private string? OwnerId() => User.FindFirstValue(ClaimTypes.NameIdentifier);

    private IActionResult ErrorResult(CommitmentError error)
    {
        var status = error.Code switch
        {
            "commitment_not_found" => StatusCodes.Status404NotFound,
            "candidate_changed" or "candidate_dismissed" or "confirmation_conflict" =>
                StatusCodes.Status409Conflict,
            "fingerprint_invalid" or "name_invalid" or "category_invalid" or "cadence_invalid"
                or "timing_invalid" or "amount_invalid" or "lifecycle_invalid" =>
                StatusCodes.Status400BadRequest,
            _ => StatusCodes.Status422UnprocessableEntity
        };
        var problem = new ProblemDetails
        {
            Status = status,
            Title = "Commitment request failed",
            Detail = error.Message,
            Type = $"https://ordo.invalid/problems/{error.Code}"
        };
        problem.Extensions["code"] = error.Code;
        return StatusCode(status, problem);
    }
}
