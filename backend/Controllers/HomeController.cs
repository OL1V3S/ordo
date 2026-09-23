using System.Globalization;
using System.Security.Claims;
using BudgetPlanner.Home;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BudgetPlanner.Controllers;

[ApiController]
[Authorize]
[Route("api/home")]
public sealed class HomeController(IHomeReadService home) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get(
        [FromQuery] string? activityThroughDate,
        CancellationToken cancellationToken)
    {
        var ownerId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (ownerId is null) return Unauthorized();

        if (!DateOnly.TryParseExact(
                activityThroughDate,
                "yyyy-MM-dd",
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var throughDate))
        {
            return Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "Home request failed",
                detail: "Provide an activity through date in YYYY-MM-DD format.",
                type: "https://ordo.invalid/problems/home_activity_through_date_invalid",
                extensions: new Dictionary<string, object?>
                {
                    ["code"] = "home_activity_through_date_invalid"
                });
        }

        var result = await home.GetAsync(ownerId, throughDate, cancellationToken);
        if (!result.IsUnavailable) return Ok(result.Response);

        return Problem(
            statusCode: StatusCodes.Status503ServiceUnavailable,
            title: "Home is unavailable",
            detail: "Home data could not be read.",
            type: "https://ordo.invalid/problems/home_unavailable",
            extensions: new Dictionary<string, object?>
            {
                ["code"] = "home_unavailable"
            });
    }
}
