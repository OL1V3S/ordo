using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using BudgetPlanner.BudgetLimits;
using BudgetPlanner.Contracts.BudgetLimits;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using Microsoft.AspNetCore.Authorization;
using System.Security.Claims;

namespace BudgetPlanner.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class BudgetLimitsController : ControllerBase
{
    private readonly BudgetContext _context;

    public BudgetLimitsController(BudgetContext context)
    {
        _context = context;
    }

    private string? GetUserId()
    {
        return User.FindFirstValue(ClaimTypes.NameIdentifier);
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<BudgetLimit>>> GetBudgetLimits([FromQuery] string monthYear)
    {
        var userId = GetUserId();

        if (userId == null)
        {
            return Unauthorized();
        }

        if (string.IsNullOrEmpty(monthYear))
        {
            return BadRequest("monthYear query parameter is required.");
        }

        if (!DateTime.TryParse($"{monthYear}-01", out var monthYearDate))
        {
            return BadRequest("Invalid monthYear format. Expected format: YYYY-MM");
        }

        // 🔥 FIX: force UTC
        monthYearDate = DateTime.SpecifyKind(monthYearDate, DateTimeKind.Utc);

        var limits = await _context.BudgetLimits
            .Where(b =>
                b.UserId == userId &&
                b.MonthYear.Year == monthYearDate.Year &&
                b.MonthYear.Month == monthYearDate.Month)
            .ToListAsync();

        return Ok(limits);
    }

    [HttpPost]
    public async Task<ActionResult<BudgetLimitResponse>> UpsertBudgetLimit(UpsertBudgetLimitRequest limit)
    {
        var userId = GetUserId();

        if (userId == null)
        {
            return Unauthorized();
        }

        if (string.IsNullOrWhiteSpace(limit.Category))
        {
            return BadRequest("Category is required.");
        }

        if (limit.MonthYear == default)
        {
            return BadRequest("MonthYear is required.");
        }

        var category = BudgetLimitRules.NormalizeCategory(limit.Category);
        foreach (var (field, code) in BudgetLimitRules.Validate(limit.LimitAmount, category))
        {
            ModelState.AddModelError(field, code);
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        // Normalize to the first day of the month, UTC.
        var monthYear = DateTime.SpecifyKind(
            new DateTime(limit.MonthYear.Year, limit.MonthYear.Month, 1),
            DateTimeKind.Utc
        );

        if (_context.Database.IsNpgsql())
        {
            // One atomic statement: the unique index decides, the last committed write wins.
            var rows = await _context.BudgetLimits
                .FromSqlInterpolated($"""
                    INSERT INTO "BudgetLimits" ("UserId", "Category", "LimitAmount", "MonthYear")
                    VALUES ({userId}, {category}, {limit.LimitAmount}, {monthYear})
                    ON CONFLICT ("UserId", "Category", "MonthYear")
                    DO UPDATE SET "LimitAmount" = EXCLUDED."LimitAmount"
                    RETURNING "Id", "Category", "LimitAmount", "MonthYear", "UserId"
                    """)
                .AsNoTracking()
                .ToListAsync();
            return Ok(BudgetLimitResponse.From(rows.Single()));
        }

        var existing = await _context.BudgetLimits
            .FirstOrDefaultAsync(b =>
                b.UserId == userId &&
                b.Category == category &&
                b.MonthYear.Year == monthYear.Year &&
                b.MonthYear.Month == monthYear.Month);

        if (existing != null)
        {
            existing.LimitAmount = limit.LimitAmount;
            await _context.SaveChangesAsync();
            return Ok(BudgetLimitResponse.From(existing));
        }

        var created = new BudgetLimit
        {
            Category = category,
            LimitAmount = limit.LimitAmount,
            MonthYear = monthYear,
            UserId = userId
        };
        _context.BudgetLimits.Add(created);
        await _context.SaveChangesAsync();

        return Ok(BudgetLimitResponse.From(created));
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteBudgetLimit(int id)
    {
        var userId = GetUserId();

        if (userId == null)
        {
            return Unauthorized();
        }

        var limit = await _context.BudgetLimits
            .FirstOrDefaultAsync(b => b.Id == id && b.UserId == userId);

        if (limit == null)
        {
            return NotFound();
        }

        _context.BudgetLimits.Remove(limit);
        await _context.SaveChangesAsync();

        return NoContent();
    }
}