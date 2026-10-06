using System.Data.Common;
using System.Globalization;
using System.Security.Claims;
using BudgetPlanner.ActivityTimeline;
using BudgetPlanner.Contracts.ActivityTimeline;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BudgetPlanner.Controllers;

[ApiController]
[Authorize]
[Route("api/activity/timeline")]
public sealed class ActivityTimelineController(
    IActivityFeedReader feed,
    ILogger<ActivityTimelineController> logger) : ControllerBase
{
    private const int DefaultLimit = 25;

    [HttpGet]
    public async Task<IActionResult> Get(
        [FromQuery] string? limit,
        [FromQuery] string? cursor,
        [FromQuery] string[]? q,
        [FromQuery] string[]? kind,
        [FromQuery] string[]? from,
        [FromQuery] string[]? to,
        CancellationToken cancellationToken)
    {
        var ownerId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (ownerId is null) return Unauthorized();

        var pageLimit = DefaultLimit;
        if (limit is not null
            && (!int.TryParse(limit, NumberStyles.None, CultureInfo.InvariantCulture, out pageLimit)
                || pageLimit < 1
                || pageLimit > ActivityFeedOrdering.MaxLimit))
        {
            return Rejected(
                "activity_timeline_limit_invalid",
                $"Provide a limit from 1 to {ActivityFeedOrdering.MaxLimit}.");
        }

        ActivityFeedCursor? after = null;
        if (cursor is not null && !ActivityFeedCursor.TryDecode(cursor, out after))
        {
            return Rejected(
                "activity_timeline_cursor_invalid",
                "Provide a cursor returned by a previous activity timeline response.");
        }

        string? search = null;
        if (q is { Length: > 0 })
        {
            if (q.Length > 1 || (q[0]?.Trim().Length ?? 0) > ActivityFeedOrdering.MaxSearchLength)
            {
                return Rejected(
                    "activity_timeline_search_invalid",
                    $"Provide a single search of at most {ActivityFeedOrdering.MaxSearchLength} characters.");
            }

            search = q[0]?.Trim() ?? "";
            if (search.Length == 0) search = null;
        }

        string? kindFilter = null;
        if (kind is { Length: > 0 })
        {
            kindFilter = kind.Length == 1 ? kind[0] : null;
            if (kindFilter is not (ActivityFeedOrdering.ExpenseKind or ActivityFeedOrdering.InflowKind))
            {
                return Rejected(
                    "activity_timeline_kind_invalid",
                    "Provide kind as expense or account_inflow.");
            }
        }

        if (!TryReadDate(from, out var fromDate) || !TryReadDate(to, out var toDate)
            || (fromDate is { } f && toDate is { } t && f > t))
        {
            return Rejected(
                "activity_timeline_date_invalid",
                "Provide from and to as yyyy-MM-dd dates with from on or before to.");
        }

        var filter = search is null && kindFilter is null && fromDate is null && toDate is null
            ? null
            : new ActivityFeedFilter(search, kindFilter, fromDate, toDate);

        ActivityFeedPage page;
        try
        {
            page = await feed.ReadAsync(
                new ActivityFeedRequest(ownerId, pageLimit, after, null, ActivityFeedQueryTags.Timeline, filter),
                cancellationToken);
        }
        catch (Exception exception) when (IsRecoverable(exception))
        {
            logger.LogWarning(
                "Activity timeline is unavailable after {FailureType}.",
                exception.GetType().Name);
            return Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Activity timeline is unavailable",
                detail: "Activity timeline data could not be read.",
                type: "https://ordo.invalid/problems/activity_timeline_unavailable",
                extensions: new Dictionary<string, object?>
                {
                    ["code"] = "activity_timeline_unavailable"
                });
        }

        return Ok(new ActivityTimelineResponse(
            "USD",
            page.Items,
            new ActivityTimelinePageResponse(
                pageLimit,
                page.HasMore,
                page.HasMore ? page.Next?.Encode() : null)));
    }

    private static bool TryReadDate(string[]? values, out DateOnly? date)
    {
        date = null;
        if (values is null || values.Length == 0) return true;
        if (values.Length > 1
            || !DateOnly.TryParseExact(
                values[0], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
        {
            return false;
        }

        date = parsed;
        return true;
    }

    private ObjectResult Rejected(string code, string detail) => Problem(
        statusCode: StatusCodes.Status400BadRequest,
        title: "Activity timeline request failed",
        detail: detail,
        type: $"https://ordo.invalid/problems/{code}",
        extensions: new Dictionary<string, object?>
        {
            ["code"] = code
        });

    private static bool IsRecoverable(Exception exception) =>
        exception is DbException or TimeoutException;
}
