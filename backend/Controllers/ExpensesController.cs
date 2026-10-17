using System.Security.Claims;
using System.Globalization;
using BudgetPlanner.ActivityTimeline;
using BudgetPlanner.Contracts.Expenses;
using BudgetPlanner.CreateRequests;
using BudgetPlanner.Data;
using BudgetPlanner.Import;
using BudgetPlanner.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BudgetPlanner.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ExpensesController : ControllerBase
{
    private readonly BudgetContext _context;
    private readonly IdempotentCreateService _idempotentCreate;

    public ExpensesController(BudgetContext context, IdempotentCreateService idempotentCreate)
    {
        _context = context;
        _idempotentCreate = idempotentCreate;
    }

    private string? GetUserId()
    {
        return User.FindFirstValue(ClaimTypes.NameIdentifier);
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<ExpenseResponse>>> GetExpenses()
    {
        var userId = GetUserId();

        if (userId == null)
        {
            return Unauthorized();
        }

        var expenses = await _context.Expenses
            .Where(e => e.UserId == userId)
            .OrderNewestFirst()
            .ToListAsync();

        return expenses.Select(ToResponse).ToList();
    }

    [HttpPost]
    public async Task<ActionResult<ExpenseResponse>> PostExpense(
        CreateExpenseRequest request,
        CancellationToken cancellationToken = default)
    {
        var userId = GetUserId();

        if (userId == null)
        {
            return Unauthorized();
        }

        var idempotencyKey = IdempotencyKeyHeader.Read(Request.Headers);
        if (idempotencyKey.Status == IdempotencyKeyStatus.Invalid)
        {
            return CreateRequestProblems.InvalidKey();
        }

        if (!TryReadAmount(request.Amount, out var amount)
            || !TryValidateAndNormalize(
                request.Description,
                amount,
                request.Category,
                out var description,
                out var category))
        {
            return ValidationProblem(ModelState);
        }

        if (idempotencyKey.Status == IdempotencyKeyStatus.Valid)
        {
            return await PostIdempotentExpenseAsync(
                userId,
                idempotencyKey.Key,
                description,
                amount,
                request.Date,
                category,
                cancellationToken);
        }

        var expense = new Expense
        {
            UserId = userId,
            Description = description,
            Amount = amount,
            Date = request.Date,
            Category = category
        };

        _context.Expenses.Add(expense);
        await _context.SaveChangesAsync();

        return CreatedAtAction(
            nameof(GetExpenses),
            new { id = expense.Id },
            ToResponse(expense));
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> PutExpense(int id, UpdateExpenseRequest request)
    {
        var userId = GetUserId();

        if (userId == null)
        {
            return Unauthorized();
        }

        if (id != request.Id)
        {
            return BadRequest("Expense ID mismatch");
        }

        var existingExpense = await _context.Expenses
            .FirstOrDefaultAsync(e => e.Id == id && e.UserId == userId);

        if (existingExpense == null)
        {
            return NotFound();
        }

        if (!TryReadAmount(request.Amount, out var amount)
            || !TryValidateAndNormalize(
                request.Description,
                amount,
                request.Category,
                out var description,
                out var category))
        {
            return ValidationProblem(ModelState);
        }

        var commitmentEvidenceChanged =
            existingExpense.Date != request.Date
            || existingExpense.Amount != amount
            || ExpenseInputRules.NormalizeDescriptionForComparison(existingExpense.Description)
                != ExpenseInputRules.NormalizeDescriptionForComparison(description)
            || existingExpense.Category != category;

        existingExpense.Description = description;
        existingExpense.Amount = amount;
        existingExpense.Date = request.Date;
        existingExpense.Category = category;
        if (commitmentEvidenceChanged)
        {
            existingExpense.CommitmentEvidenceRevision = Guid.NewGuid();
        }

        await _context.SaveChangesAsync();

        return NoContent();
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteExpense(int id)
    {
        var userId = GetUserId();

        if (userId == null)
        {
            return Unauthorized();
        }

        var expense = await _context.Expenses
            .FirstOrDefaultAsync(e => e.Id == id && e.UserId == userId);

        if (expense == null)
        {
            return NotFound();
        }

        _context.Expenses.Remove(expense);
        await _context.SaveChangesAsync();

        return NoContent();
    }

    private async Task<ActionResult<ExpenseResponse>> PostIdempotentExpenseAsync(
        string userId,
        Guid key,
        string description,
        decimal amount,
        DateOnly date,
        string category,
        CancellationToken cancellationToken)
    {
        var result = await _idempotentCreate.CreateExpenseAsync(
            userId,
            key,
            () => new Expense
            {
                UserId = userId,
                Description = description,
                Amount = amount,
                Date = date,
                Category = category
            },
            CreateRequestFingerprint.ForExpense(description, amount, date, category),
            cancellationToken);

        return result.Status switch
        {
            IdempotentCreateStatus.Created => CreatedAtAction(
                nameof(GetExpenses),
                new { id = result.Expense!.Id },
                ToResponse(result.Expense)),
            IdempotentCreateStatus.Replayed => Ok(ToResponse(result.Expense!)),
            _ => CreateRequestProblems.For(result.Status)
        };
    }

    private bool TryValidateAndNormalize(
        string? description,
        decimal amount,
        string? category,
        out string normalizedDescription,
        out string normalizedCategory)
    {
        normalizedDescription = ExpenseInputRules.NormalizeDescription(description);
        normalizedCategory = ExpenseInputRules.NormalizeCategory(category);
        foreach (var error in ExpenseInputRules.Validate(amount, DateOnly.MinValue, normalizedDescription, normalizedCategory))
        {
            var (field, message) = error switch
            {
                "amount_must_be_positive" => ("amount", "Amount must be greater than zero."),
                "amount_out_of_range" => ("amount", "Amount exceeds the supported monetary range."),
                "amount_precision_invalid" => ("amount", "Amount must have at most two decimal places."),
                "description_required" => ("description", "Description is required."),
                "description_too_long" => ("description", "Description must be 500 characters or fewer."),
                "category_required" => ("category", "Category is required."),
                "category_too_long" => ("category", "Category must be 100 characters or fewer."),
                "category_reserved" => ("category", "Category 'other' is reserved for the UI custom-category selector."),
                _ => ("request", "The expense is invalid.")
            };
            ModelState.AddModelError(field, message);
        }

        return ModelState.IsValid;
    }

    private bool TryReadAmount(ExpenseAmountInput? input, out decimal amount)
    {
        amount = default;
        var failure = input?.TryGetDecimal(out amount) ?? ExpenseAmountParseFailure.Invalid;
        if (failure == ExpenseAmountParseFailure.None)
        {
            return true;
        }

        ModelState.AddModelError("amount", failure == ExpenseAmountParseFailure.OutOfRange
            ? "Amount exceeds the supported monetary range."
            : "Amount must be an invariant decimal value with no exponent, separators, or currency symbol.");
        return false;
    }

    private static ExpenseResponse ToResponse(Expense expense)
    {
        return new ExpenseResponse(
            expense.Id,
            expense.Description,
            expense.Amount.ToString("0.00", CultureInfo.InvariantCulture),
            expense.Date,
            expense.Category);
    }
}
