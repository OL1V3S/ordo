using System.Security.Claims;
using BudgetPlanner.Contracts.Expenses;
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

    public ExpensesController(BudgetContext context)
    {
        _context = context;
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
            .ToListAsync();

        return expenses.Select(ToResponse).ToList();
    }

    [HttpPost]
    public async Task<ActionResult<ExpenseResponse>> PostExpense(CreateExpenseRequest request)
    {
        var userId = GetUserId();

        if (userId == null)
        {
            return Unauthorized();
        }

        if (!TryValidateAndNormalize(
                request.Description,
                request.Amount,
                request.Category,
                out var description,
                out var category))
        {
            return ValidationProblem(ModelState);
        }

        var expense = new Expense
        {
            UserId = userId,
            Description = description,
            Amount = request.Amount,
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

        if (!TryValidateAndNormalize(
                request.Description,
                request.Amount,
                request.Category,
                out var description,
                out var category))
        {
            return ValidationProblem(ModelState);
        }

        var commitmentEvidenceChanged =
            existingExpense.Date != request.Date
            || existingExpense.Amount != request.Amount
            || ExpenseInputRules.NormalizeDescriptionForComparison(existingExpense.Description)
                != ExpenseInputRules.NormalizeDescriptionForComparison(description)
            || existingExpense.Category != category;

        existingExpense.Description = description;
        existingExpense.Amount = request.Amount;
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

    private static ExpenseResponse ToResponse(Expense expense)
    {
        return new ExpenseResponse(
            expense.Id,
            expense.Description,
            expense.Amount,
            expense.Date,
            expense.Category);
    }
}
