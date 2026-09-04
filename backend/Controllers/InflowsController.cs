using System.Security.Claims;
using BudgetPlanner.Contracts.Inflows;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BudgetPlanner.Controllers;

[ApiController]
[Authorize]
[Route("api/inflows")]
public sealed class InflowsController(BudgetContext context) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<InflowResponse>>> GetAll(
        CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null) return Unauthorized();

        var inflows = await context.AccountInflows.AsNoTracking()
            .Where(value => value.OwnerId == userId)
            .OrderByDescending(value => value.Date)
            .ThenByDescending(value => value.Id)
            .ToListAsync(cancellationToken);

        return inflows.Select(ToResponse).ToList();
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(
        int id,
        CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null) return Unauthorized();

        var inflow = await context.AccountInflows.AsNoTracking()
            .SingleOrDefaultAsync(
                value => value.Id == id && value.OwnerId == userId,
                cancellationToken);
        return inflow is null ? EmptyNotFound() : Ok(ToResponse(inflow));
    }

    [HttpPost]
    public async Task<ActionResult<InflowResponse>> Create(
        CreateInflowRequest request,
        CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null) return Unauthorized();

        if (!TryValidateAndNormalize(
                request.Description,
                request.Amount,
                request.Date,
                out var description))
        {
            return ValidationProblem(ModelState);
        }

        var inflow = new AccountInflow
        {
            OwnerId = userId,
            Description = description,
            Amount = request.Amount,
            Date = request.Date!.Value
        };
        context.AccountInflows.Add(inflow);
        await context.SaveChangesAsync(cancellationToken);

        return CreatedAtAction(nameof(Get), new { id = inflow.Id }, ToResponse(inflow));
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(
        int id,
        UpdateInflowRequest request,
        CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null) return Unauthorized();
        if (id != request.Id) return BadRequest("Inflow ID mismatch");

        var inflow = await context.AccountInflows.SingleOrDefaultAsync(
            value => value.Id == id && value.OwnerId == userId,
            cancellationToken);
        if (inflow is null) return EmptyNotFound();

        if (!TryValidateAndNormalize(
                request.Description,
                request.Amount,
                request.Date,
                out var description))
        {
            return ValidationProblem(ModelState);
        }

        inflow.UpdateEvidence(description, request.Amount, request.Date!.Value);
        await context.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null) return Unauthorized();

        var inflow = await context.AccountInflows.SingleOrDefaultAsync(
            value => value.Id == id && value.OwnerId == userId,
            cancellationToken);
        if (inflow is null) return EmptyNotFound();

        context.AccountInflows.Remove(inflow);
        await context.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    private bool TryValidateAndNormalize(
        string? description,
        decimal amount,
        DateOnly? date,
        out string normalizedDescription)
    {
        normalizedDescription = AccountInflowInputRules.NormalizeDescription(description);
        foreach (var error in AccountInflowInputRules.Validate(amount, date, normalizedDescription))
        {
            var (field, message) = error switch
            {
                "date_required" => ("date", "Date is required."),
                "amount_must_be_positive" => ("amount", "Amount must be greater than zero."),
                "amount_out_of_range" => ("amount", "Amount exceeds the supported monetary range."),
                "amount_precision_invalid" => ("amount", "Amount must have at most two decimal places."),
                "description_required" => ("description", "Description is required."),
                "description_too_long" => ("description", "Description must be 500 characters or fewer."),
                _ => ("request", "The inflow is invalid.")
            };
            ModelState.AddModelError(field, message);
        }

        return ModelState.IsValid;
    }

    private static InflowResponse ToResponse(AccountInflow inflow) => new(
        inflow.Id,
        inflow.Description,
        inflow.Amount,
        inflow.Date);

    private IActionResult EmptyNotFound()
    {
        Response.StatusCode = StatusCodes.Status404NotFound;
        return new EmptyResult();
    }
}
