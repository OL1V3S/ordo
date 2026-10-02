using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using BudgetPlanner.ActivityTimeline;
using BudgetPlanner.Data;
using BudgetPlanner.Controllers;
using BudgetPlanner.Models;
using BudgetPlanner.Paychecks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

[Collection("Environment variable tests")]
public sealed class ActivityTimelineApiTests
{
    private const string HomeRoute = "/api/home?activityThroughDate=2026-12-31";

    [Fact]
    public async Task Read_requires_authentication()
    {
        await using var app = new ActivityTimelineTestApplication();
        using var anonymous = app.CreateTestClient();

        using var response = await anonymous.GetAsync("/api/activity/timeline");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Empty_read_returns_an_empty_exact_page()
    {
        await using var app = new ActivityTimelineTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("timeline-empty@example.com");

        var body = await ActivityTimelineTestClient.ReadAsync(owner.Client);

        Assert.Equal("USD", body.GetProperty("currencyCode").GetString());
        Assert.Empty(body.GetProperty("items").EnumerateArray());
        var page = body.GetProperty("page");
        Assert.Equal(25, page.GetProperty("limit").GetInt32());
        Assert.False(page.GetProperty("hasMore").GetBoolean());
        Assert.Equal(JsonValueKind.Null, page.GetProperty("nextCursor").ValueKind);
    }

    [Fact]
    public async Task Orders_by_date_then_expense_before_cash_in_then_id_descending_without_a_date_cutoff()
    {
        await using var app = new ActivityTimelineTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("timeline-order@example.com");
        var sameDay = new DateOnly(2026, 9, 22);

        var olderInflow = await app.SeedInflowAsync(owner.Id, "Older cash", 5m, new(2026, 8, 1));
        var olderExpense = await app.SeedExpenseAsync(owner.Id, "Older expense", 5m, new(2026, 8, 1));
        var firstInflow = await app.SeedInflowAsync(owner.Id, "First cash", 5m, sameDay);
        var firstExpense = await app.SeedExpenseAsync(owner.Id, "First expense", 5m, sameDay);
        var secondInflow = await app.SeedInflowAsync(owner.Id, "Second cash", 5m, sameDay);
        var secondExpense = await app.SeedExpenseAsync(owner.Id, "Second expense", 5m, sameDay);
        var futureInflow = await app.SeedInflowAsync(owner.Id, "Future cash", 5m, new(2027, 1, 5));
        var futureExpense = await app.SeedExpenseAsync(owner.Id, "Future expense", 5m, new(2027, 1, 5));

        var body = await ActivityTimelineTestClient.ReadAsync(owner.Client);

        Assert.Equal(
            [
                ("expense", futureExpense.Id),
                ("account_inflow", futureInflow.Id),
                ("expense", secondExpense.Id),
                ("expense", firstExpense.Id),
                ("account_inflow", secondInflow.Id),
                ("account_inflow", firstInflow.Id),
                ("expense", olderExpense.Id),
                ("account_inflow", olderInflow.Id)
            ],
            ActivityTimelineTestClient.Keys(body));
        Assert.False(body.GetProperty("page").GetProperty("hasMore").GetBoolean());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("page").GetProperty("nextCursor").ValueKind);
    }

    [Fact]
    public async Task First_three_rows_match_Home_recent_activity_item_for_item()
    {
        await using var app = new ActivityTimelineTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("timeline-parity@example.com");

        await app.SeedExpenseAsync(owner.Id, "Parity older expense", 1.5m, new(2026, 8, 1), "food");
        await app.SeedExpenseAsync(owner.Id, "Parity same-day expense", 9999999999999999.99m, new(2026, 9, 22), "rent");
        await app.SeedInflowAsync(owner.Id, "Parity plain cash", 10m, new(2026, 9, 22));
        var linked = await app.SeedInflowAsync(owner.Id, "Parity linked cash", 2500m, new(2026, 9, 22));
        await app.SeedExpenseAsync(owner.Id, "Parity newest expense", 3m, new(2026, 9, 23), "fun");
        await app.AddPaycheckLinkAsync(owner.Id, linked, PaycheckOccurrenceKind.ConfirmationEvidence);

        var timeline = await ActivityTimelineTestClient.ReadAsync(owner.Client);
        using var homeResponse = await owner.Client.GetAsync(HomeRoute);
        homeResponse.EnsureSuccessStatusCode();
        var home = await homeResponse.Content.ReadFromJsonAsync<JsonElement>();

        var homeItems = home.GetProperty("recentActivity").GetProperty("items").EnumerateArray().ToArray();
        var timelineItems = timeline.GetProperty("items").EnumerateArray().Take(3).ToArray();
        Assert.Equal(3, homeItems.Length);
        Assert.Equal(homeItems.Select(value => value.GetRawText()), timelineItems.Select(value => value.GetRawText()));
        Assert.Contains(timelineItems, value => value.GetProperty("paycheck").ValueKind == JsonValueKind.Object);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(7)]
    public async Task Keyset_paging_walks_a_split_same_day_group_without_gaps_or_duplicates(int limit)
    {
        await using var app = new ActivityTimelineTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync($"timeline-paging-{limit}@example.com");
        var sameDay = new DateOnly(2026, 9, 22);
        for (var index = 0; index < 3; index++)
        {
            await app.SeedExpenseAsync(owner.Id, $"Same-day expense {index}", 1m + index, sameDay);
            await app.SeedInflowAsync(owner.Id, $"Same-day cash {index}", 10m + index, sameDay);
        }
        await app.SeedExpenseAsync(owner.Id, "Newer expense", 4m, new(2026, 9, 23));
        await app.SeedInflowAsync(owner.Id, "Older cash", 5m, new(2026, 9, 21));
        await app.SeedExpenseAsync(owner.Id, "Older expense", 6m, new(2026, 9, 21));

        var everything = ActivityTimelineTestClient.Keys(
            await ActivityTimelineTestClient.ReadAsync(owner.Client, "?limit=100"));
        var walked = await ActivityTimelineTestClient.WalkAsync(owner.Client, limit);

        Assert.Equal(9, everything.Length);
        Assert.Equal(everything, walked.Keys);
        Assert.Equal(everything.Length, walked.Keys.Distinct().Count());
        Assert.Equal((everything.Length + limit - 1) / limit, walked.PageCount);
    }

    [Fact]
    public async Task Has_more_is_exact_at_and_around_the_limit()
    {
        await using var app = new ActivityTimelineTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("timeline-hasmore@example.com");
        await app.SeedExpenseAsync(owner.Id, "One", 1m, new(2026, 9, 20));
        await app.SeedInflowAsync(owner.Id, "Two", 2m, new(2026, 9, 21));
        await app.SeedExpenseAsync(owner.Id, "Three", 3m, new(2026, 9, 22));

        var exact = await ActivityTimelineTestClient.ReadAsync(owner.Client, "?limit=3");
        Assert.Equal(3, exact.GetProperty("items").GetArrayLength());
        Assert.False(exact.GetProperty("page").GetProperty("hasMore").GetBoolean());
        Assert.Equal(JsonValueKind.Null, exact.GetProperty("page").GetProperty("nextCursor").ValueKind);

        var more = await ActivityTimelineTestClient.ReadAsync(owner.Client, "?limit=2");
        Assert.True(more.GetProperty("page").GetProperty("hasMore").GetBoolean());
        var cursor = more.GetProperty("page").GetProperty("nextCursor").GetString();
        Assert.False(string.IsNullOrEmpty(cursor));

        var last = await ActivityTimelineTestClient.ReadAsync(
            owner.Client, $"?limit=2&cursor={Uri.EscapeDataString(cursor!)}");
        Assert.Equal(1, last.GetProperty("items").GetArrayLength());
        Assert.False(last.GetProperty("page").GetProperty("hasMore").GetBoolean());
        Assert.Equal(JsonValueKind.Null, last.GetProperty("page").GetProperty("nextCursor").ValueKind);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("101")]
    [InlineData("-1")]
    [InlineData("+5")]
    [InlineData("%205")]
    [InlineData("abc")]
    [InlineData("1.5")]
    [InlineData("1e1")]
    [InlineData("2147483648")]
    [InlineData("1,2")]
    public async Task Limit_outside_one_to_one_hundred_or_not_an_integer_is_a_400(string limit)
    {
        await using var app = new ActivityTimelineTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("timeline-limit@example.com");

        using var response = await owner.Client.GetAsync($"/api/activity/timeline?limit={limit}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("activity_timeline_limit_invalid", await ActivityTimelineTestClient.ProblemCodeAsync(response));
    }

    [Theory]
    [InlineData("1")]
    [InlineData("100")]
    public async Task Limit_bounds_are_inclusive_and_echoed(string limit)
    {
        await using var app = new ActivityTimelineTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync($"timeline-limit-ok-{limit}@example.com");

        var body = await ActivityTimelineTestClient.ReadAsync(owner.Client, $"?limit={limit}");

        Assert.Equal(int.Parse(limit), body.GetProperty("page").GetProperty("limit").GetInt32());
    }

    [Theory]
    [InlineData("not-a-cursor")]
    [InlineData("!!!!")]
    [InlineData("MS4yMDI2LTA5LTIyLjAuNQ==")]
    [InlineData("1.2026-09-22.0.5")]
    [InlineData("bad-version")]
    [InlineData("bad-rank")]
    [InlineData("bad-date")]
    [InlineData("bad-id-zero")]
    [InlineData("bad-id-negative")]
    [InlineData("bad-extra-part")]
    [InlineData("too-long")]
    public async Task Malformed_cursor_is_a_400(string cursor)
    {
        await using var app = new ActivityTimelineTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("timeline-cursor@example.com");
        var value = cursor switch
        {
            "bad-version" => ActivityTimelineTestClient.Base64Url("2.2026-09-22.0.5"),
            "bad-rank" => ActivityTimelineTestClient.Base64Url("1.2026-09-22.2.5"),
            "bad-date" => ActivityTimelineTestClient.Base64Url("1.2026-13-40.0.5"),
            "bad-id-zero" => ActivityTimelineTestClient.Base64Url("1.2026-09-22.0.0"),
            "bad-id-negative" => ActivityTimelineTestClient.Base64Url("1.2026-09-22.0.-5"),
            "bad-extra-part" => ActivityTimelineTestClient.Base64Url("1.2026-09-22.0.5.9"),
            "too-long" => new string('A', 200),
            _ => cursor
        };

        using var response = await owner.Client.GetAsync(
            $"/api/activity/timeline?cursor={Uri.EscapeDataString(value)}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("activity_timeline_cursor_invalid", await ActivityTimelineTestClient.ProblemCodeAsync(response));
    }

    [Fact]
    public async Task Well_formed_position_cursor_is_accepted_even_when_it_names_no_record()
    {
        await using var app = new ActivityTimelineTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("timeline-position@example.com");
        var kept = await app.SeedExpenseAsync(owner.Id, "Before position", 1m, new(2026, 9, 21));
        await app.SeedExpenseAsync(owner.Id, "After position", 1m, new(2026, 9, 23));
        var cursor = new ActivityFeedCursor(new DateOnly(2026, 9, 22), ActivityFeedOrdering.ExpenseRank, 999_999).Encode();

        var body = await ActivityTimelineTestClient.ReadAsync(
            owner.Client, $"?cursor={Uri.EscapeDataString(cursor)}");

        Assert.Equal([("expense", kept.Id)], ActivityTimelineTestClient.Keys(body));
    }

    [Fact]
    public async Task Another_owners_cursor_only_positions_the_read_and_never_widens_owner_scope()
    {
        await using var app = new ActivityTimelineTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("timeline-cursor-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("timeline-cursor-other@example.com");
        for (var day = 1; day <= 4; day++)
        {
            await app.SeedExpenseAsync(owner.Id, $"Owner private {day}", 1m, new(2026, 9, day));
            await app.SeedExpenseAsync(other.Id, $"Other private {day}", 1m, new(2026, 9, day));
        }

        var ownerFirst = await ActivityTimelineTestClient.ReadAsync(owner.Client, "?limit=2");
        var ownerCursor = ownerFirst.GetProperty("page").GetProperty("nextCursor").GetString()!;
        var otherRead = await ActivityTimelineTestClient.ReadAsync(
            other.Client, $"?limit=100&cursor={Uri.EscapeDataString(ownerCursor)}");

        var descriptions = otherRead.GetProperty("items").EnumerateArray()
            .Select(value => value.GetProperty("description").GetString()!).ToArray();
        Assert.Equal(["Other private 2", "Other private 1"], descriptions);
        Assert.DoesNotContain("Owner private", otherRead.GetRawText(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Amounts_are_exact_and_legacy_zero_or_negative_expenses_are_returned_unaltered()
    {
        await using var app = new ActivityTimelineTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("timeline-amounts@example.com");
        await app.SeedExpenseAsync(owner.Id, "Legacy zero", 0m, new(2026, 9, 25), "legacy");
        await app.SeedExpenseAsync(owner.Id, "Legacy negative", -5m, new(2026, 9, 24), "legacy");
        await app.SeedExpenseAsync(owner.Id, "Largest expense", 9999999999999999.99m, new(2026, 9, 23), "big");
        await app.SeedInflowAsync(owner.Id, "Largest cash", 9999999999999999.99m, new(2026, 9, 22));
        await app.SeedInflowAsync(owner.Id, "Small cash", 0.01m, new(2026, 9, 21));

        var body = await ActivityTimelineTestClient.ReadAsync(owner.Client);
        var items = body.GetProperty("items").EnumerateArray().ToArray();

        Assert.Equal(
            ["0.00", "-5.00", "9999999999999999.99", "9999999999999999.99", "0.01"],
            items.Select(value => value.GetProperty("amount").GetString()));
        Assert.All(items, value => Assert.Equal(JsonValueKind.String, value.GetProperty("amount").ValueKind));
    }

    [Fact]
    public async Task Response_has_no_totals_net_balance_owner_or_provenance_fields()
    {
        await using var app = new ActivityTimelineTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("timeline-shape@example.com");
        await app.SeedExpenseAsync(owner.Id, "Shape expense", 12m, new(2026, 9, 22));
        await app.SeedInflowAsync(owner.Id, "Shape cash", 20m, new(2026, 9, 22));

        var body = await ActivityTimelineTestClient.ReadAsync(owner.Client, "?limit=1");

        Assert.Equal(["currencyCode", "items", "page"], body.EnumerateObject().Select(value => value.Name));
        Assert.Equal(["limit", "hasMore", "nextCursor"],
            body.GetProperty("page").EnumerateObject().Select(value => value.Name));
        Assert.Equal(
            ["kind", "recordId", "date", "amount", "description", "category", "paycheck"],
            body.GetProperty("items")[0].EnumerateObject().Select(value => value.Name));
        Assert.DoesNotContain("ownerId", body.GetRawText(), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(owner.Id, body.GetRawText(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Read_is_owner_scoped_read_only_and_shows_a_linked_inflow_once()
    {
        await using var app = new ActivityTimelineTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("timeline-scope@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("timeline-scope-other@example.com");
        await app.SeedExpenseAsync(owner.Id, "Owner expense", 3m, new(2026, 9, 22), "food");
        var linked = await app.SeedInflowAsync(owner.Id, "Owner linked cash", 900m, new(2026, 9, 21));
        await app.SeedExpenseAsync(other.Id, "Foreign expense", 777m, new(2026, 9, 22));
        var foreignInflow = await app.SeedInflowAsync(other.Id, "Foreign cash", 777m, new(2026, 9, 22));
        var profileId = await app.AddPaycheckLinkAsync(owner.Id, linked, PaycheckOccurrenceKind.RecordedReceipt);
        await app.AddPaycheckLinkAsync(other.Id, foreignInflow, PaycheckOccurrenceKind.RecordedReceipt);
        var before = await app.RecordStateAsync();

        var body = await ActivityTimelineTestClient.ReadAsync(owner.Client);
        var items = body.GetProperty("items").EnumerateArray().ToArray();

        Assert.Equal(2, items.Length);
        var inflow = Assert.Single(items, value => value.GetProperty("kind").GetString() == "account_inflow");
        Assert.Equal(linked.Id, inflow.GetProperty("recordId").GetInt32());
        Assert.Equal("recorded_receipt", inflow.GetProperty("paycheck").GetProperty("relation").GetString());
        Assert.Equal(profileId, inflow.GetProperty("paycheck").GetProperty("profileId").GetGuid());
        Assert.Equal(JsonValueKind.Null, items[0].GetProperty("paycheck").ValueKind);
        Assert.Equal(JsonValueKind.Null, inflow.GetProperty("category").ValueKind);
        Assert.DoesNotContain("Foreign", body.GetRawText(), StringComparison.Ordinal);
        Assert.Equal(before, await app.RecordStateAsync());
    }

    [Theory]
    [InlineData("db")]
    [InlineData("timeout")]
    public async Task Recoverable_provider_failure_is_a_privacy_safe_503(string failure)
    {
        Exception exception = failure == "db" ? new SyntheticDbException() : new TimeoutException();
        await using var app = new ActivityTimelineTestApplication(new ThrowingActivityFeedReader(exception));
        using var owner = await app.CreateAuthenticatedUserAsync($"timeline-503-{failure}@example.com");

        using var response = await owner.Client.GetAsync("/api/activity/timeline");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("activity_timeline_unavailable", await ActivityTimelineTestClient.ProblemCodeAsync(response));
        var text = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain(nameof(SyntheticDbException), text, StringComparison.Ordinal);
        Assert.DoesNotContain(nameof(TimeoutException), text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Cancellation_and_programming_defects_are_not_converted_to_unavailability()
    {
        var canceled = new CancellationToken(canceled: true);

        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            Controller(new ThrowingActivityFeedReader(new OperationCanceledException(canceled)))
                .Get(null, null, canceled));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Controller(new ThrowingActivityFeedReader(new InvalidOperationException("synthetic defect")))
                .Get(null, null, default));
    }

    [Fact]
    public async Task Reader_rejects_a_limit_outside_the_shared_bounds()
    {
        await using var app = new ActivityTimelineTestApplication();
        using var client = app.CreateTestClient();
        using var scope = app.Services.CreateScope();
        var reader = scope.ServiceProvider.GetRequiredService<IActivityFeedReader>();

        foreach (var limit in new[] { 0, ActivityFeedOrdering.MaxLimit + 1 })
        {
            await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => reader.ReadAsync(
                new ActivityFeedRequest("owner", limit, null, null, ActivityFeedQueryTags.Timeline),
                default));
        }
    }

    [Fact]
    public void Cursor_round_trips_and_rejects_non_canonical_spellings()
    {
        var cursor = new ActivityFeedCursor(new DateOnly(2026, 9, 22), ActivityFeedOrdering.InflowRank, 42);
        var encoded = cursor.Encode();

        Assert.True(ActivityFeedCursor.TryDecode(encoded, out var decoded));
        Assert.Equal(cursor, decoded);
        Assert.DoesNotContain("=", encoded, StringComparison.Ordinal);
        Assert.False(ActivityFeedCursor.TryDecode(encoded + "=", out _));
        Assert.False(ActivityFeedCursor.TryDecode(
            ActivityTimelineTestClient.Base64Url("1.2026-09-22.1.042"), out _));
        Assert.False(ActivityFeedCursor.TryDecode(null, out _));
        Assert.False(ActivityFeedCursor.TryDecode("", out _));
    }

    private static ActivityTimelineController Controller(IActivityFeedReader reader) => new(
        reader, NullLogger<ActivityTimelineController>.Instance)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    [new Claim(ClaimTypes.NameIdentifier, "owner")], "test"))
            }
        }
    };
}

internal sealed class ActivityTimelineTestApplication(IActivityFeedReader? reader = null)
    : FinancialApiTestApplication
{
    protected override void ConfigureAdditionalServices(IServiceCollection services)
    {
        if (reader is null) return;
        services.RemoveAll<IActivityFeedReader>();
        services.AddSingleton(reader);
    }
}

internal sealed class ThrowingActivityFeedReader(Exception exception) : IActivityFeedReader
{
    public Task<ActivityFeedPage> ReadAsync(
        ActivityFeedRequest request,
        CancellationToken cancellationToken) =>
        Task.FromException<ActivityFeedPage>(exception);
}

internal static class ActivityTimelineTestClient
{
    public static async Task<JsonElement> ReadAsync(HttpClient client, string query = "")
    {
        using var response = await client.GetAsync($"/api/activity/timeline{query}");
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    public static (string Kind, int Id)[] Keys(JsonElement body) =>
        body.GetProperty("items").EnumerateArray()
            .Select(value => (value.GetProperty("kind").GetString()!, value.GetProperty("recordId").GetInt32()))
            .ToArray();

    public static async Task<(IReadOnlyList<(string Kind, int Id)> Keys, int PageCount)> WalkAsync(
        HttpClient client,
        int limit)
    {
        var keys = new List<(string Kind, int Id)>();
        string? cursor = null;
        var pages = 0;
        while (true)
        {
            var query = $"?limit={limit}" + (cursor is null ? "" : $"&cursor={Uri.EscapeDataString(cursor)}");
            var body = await ReadAsync(client, query);
            keys.AddRange(Keys(body));
            pages++;
            var page = body.GetProperty("page");
            if (!page.GetProperty("hasMore").GetBoolean())
            {
                Assert.Equal(JsonValueKind.Null, page.GetProperty("nextCursor").ValueKind);
                return (keys, pages);
            }
            cursor = page.GetProperty("nextCursor").GetString();
            Assert.False(string.IsNullOrEmpty(cursor));
            Assert.True(pages < 1000, "The timeline walk did not terminate.");
        }
    }

    public static async Task<string?> ProblemCodeAsync(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString();

    public static string Base64Url(string text) => WebEncoders.Base64UrlEncode(Encoding.ASCII.GetBytes(text));

    public static async Task<Guid> AddPaycheckLinkAsync(
        this FinancialApiTestApplicationBase app,
        string ownerId,
        AccountInflow inflow,
        PaycheckOccurrenceKind kind)
    {
        var at = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc);
        var profile = new PaycheckProfile
        {
            Id = Guid.NewGuid(),
            OwnerId = ownerId,
            DisplayName = "Timeline payroll",
            Lifecycle = PaycheckLifecycle.Ended,
            Cadence = PaycheckCadence.Monthly,
            FirstMonthAnchor = 1,
            AmountMode = PaycheckAmountMode.Fixed,
            ExpectedAmount = 1000m,
            CreatedAt = at,
            UpdatedAt = at
        };
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        db.PaycheckProfiles.Add(profile);
        db.PaycheckOccurrences.Add(new PaycheckOccurrence
        {
            PaycheckProfileId = profile.Id,
            AccountInflowId = inflow.Id,
            OwnerId = ownerId,
            Kind = kind,
            EvidenceRevisionAtAssignment = inflow.PaycheckEvidenceRevision,
            SlotAnchor = inflow.Date,
            TimingOffsetDays = 0,
            LinkedAt = at
        });
        await db.SaveChangesAsync();
        return profile.Id;
    }

    public static async Task<(int Expenses, int Inflows, int Profiles, int Occurrences)> RecordStateAsync(
        this FinancialApiTestApplicationBase app)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        return (
            await db.Expenses.CountAsync(),
            await db.AccountInflows.CountAsync(),
            await db.PaycheckProfiles.CountAsync(),
            await db.PaycheckOccurrences.CountAsync());
    }
}
