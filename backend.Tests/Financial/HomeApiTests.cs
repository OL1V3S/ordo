using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BudgetPlanner.Contracts.Home;
using BudgetPlanner.Data;
using BudgetPlanner.Home;
using BudgetPlanner.Models;
using BudgetPlanner.Paychecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

[Collection("Environment variable tests")]
public sealed class HomeApiTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 23, 12, 34, 56, TimeSpan.Zero);
    private const string Route = "/api/home?activityThroughDate=2026-09-22";

    [Fact]
    public async Task Read_requires_authentication_and_an_exact_activity_date()
    {
        await using var app = new HomeTestApplication(Now);
        using var anonymous = app.CreateTestClient();
        using var unauthorized = await anonymous.GetAsync(Route);
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);

        using var owner = await app.CreateAuthenticatedUserAsync("home-validation@example.com");
        using var missing = await owner.Client.GetAsync("/api/home");
        using var malformed = await owner.Client.GetAsync("/api/home?activityThroughDate=09%2F22%2F2026");
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
        Assert.Equal("home_activity_through_date_invalid", await ProblemCodeAsync(missing));
        Assert.Equal("home_activity_through_date_invalid", await ProblemCodeAsync(malformed));
    }

    [Fact]
    public async Task Empty_read_exposes_distinct_evaluations_empty_coverage_and_no_stale_substitutes()
    {
        await using var app = new HomeTestApplication(Now);
        using var owner = await app.CreateAuthenticatedUserAsync("home-empty@example.com");

        var body = await ReadAsync(owner.Client);

        Assert.Equal(Now, body.GetProperty("generatedAt").GetDateTimeOffset());
        Assert.Equal("USD", body.GetProperty("currencyCode").GetString());
        var evaluations = body.GetProperty("evaluations");
        Assert.Equal("2026-09-22", evaluations.GetProperty("activityThroughDate").GetString());
        Assert.Equal("2026-09-23", evaluations.GetProperty("upcomingEvaluatedOn").GetString());

        var attention = body.GetProperty("attention");
        AssertAvailable(attention);
        Assert.Empty(attention.GetProperty("kindsEvaluated").EnumerateArray());
        Assert.Empty(attention.GetProperty("items").EnumerateArray());

        var activity = body.GetProperty("recentActivity");
        AssertAvailable(activity);
        Assert.Empty(activity.GetProperty("items").EnumerateArray());

        var upcoming = body.GetProperty("upcoming");
        AssertAvailable(upcoming);
        Assert.Equal("2026-09-23", upcoming.GetProperty("horizon").GetProperty("from").GetString());
        Assert.Equal("2026-10-06", upcoming.GetProperty("horizon").GetProperty("through").GetString());
        Assert.Empty(upcoming.GetProperty("items").EnumerateArray());
        Assert.DoesNotContain("ownerId", body.GetRawText(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Recent_activity_is_owner_scoped_exact_bounded_and_links_an_inflow_once()
    {
        await using var app = new HomeTestApplication(Now);
        using var owner = await app.CreateAuthenticatedUserAsync("home-activity@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("home-activity-other@example.com");

        var firstExpense = await app.SeedExpenseAsync(
            owner.Id, "First same-day expense", 1.23m, new(2026, 9, 22), "food");
        var secondExpense = await app.SeedExpenseAsync(
            owner.Id, "Second same-day expense", 9999999999999999.99m, new(2026, 9, 22), "housing");
        var linkedInflow = await app.SeedInflowAsync(
            owner.Id, "Prior-month linked cash", 9999999999999999.99m, new(2026, 8, 31));
        await app.SeedExpenseAsync(owner.Id, "Older omitted expense", 4m, new(2026, 8, 30), "other-category");
        await app.SeedExpenseAsync(owner.Id, "Future owner expense", 5m, new(2026, 9, 23), "future");
        await app.SeedExpenseAsync(other.Id, "Foreign expense", 777m, new(2026, 9, 22), "foreign");
        await app.SeedInflowAsync(other.Id, "Foreign cash", 777m, new(2026, 9, 22));

        var profile = Profile(owner.Id, "Linked payroll", 1, PaycheckLifecycle.Ended);
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            db.PaycheckProfiles.Add(profile);
            db.PaycheckOccurrences.Add(Link(owner.Id, profile.Id, linkedInflow, PaycheckOccurrenceKind.RecordedReceipt));
            await db.SaveChangesAsync();
        }
        var before = await RecordStateAsync(app);

        var body = await ReadAsync(owner.Client);
        var items = body.GetProperty("recentActivity").GetProperty("items").EnumerateArray().ToArray();

        Assert.Equal(3, items.Length);
        Assert.Equal([secondExpense.Id, firstExpense.Id, linkedInflow.Id],
            items.Select(value => value.GetProperty("recordId").GetInt32()));
        Assert.Equal(["expense", "expense", "account_inflow"],
            items.Select(value => value.GetProperty("kind").GetString()));
        Assert.Equal("9999999999999999.99", items[0].GetProperty("amount").GetString());
        Assert.Equal("9999999999999999.99", items[2].GetProperty("amount").GetString());
        Assert.Equal("2026-08-31", items[2].GetProperty("date").GetString());
        Assert.Equal("recorded_receipt", items[2].GetProperty("paycheck").GetProperty("relation").GetString());
        Assert.Equal(profile.Id, items[2].GetProperty("paycheck").GetProperty("profileId").GetGuid());
        Assert.Equal(JsonValueKind.Null, items[0].GetProperty("paycheck").ValueKind);
        Assert.Equal(JsonValueKind.Null, items[2].GetProperty("category").ValueKind);
        Assert.Single(items, value => value.GetProperty("kind").GetString() == "account_inflow");
        Assert.DoesNotContain("Foreign", body.GetRawText(), StringComparison.Ordinal);
        Assert.DoesNotContain("Future owner expense", body.GetRawText(), StringComparison.Ordinal);
        Assert.Equal(before, await RecordStateAsync(app));

        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            db.Expenses.Remove(await db.Expenses.SingleAsync(value => value.Id == secondExpense.Id));
            (await db.AccountInflows.SingleAsync(value => value.Id == linkedInflow.Id))
                .UpdateEvidence("Prior-month corrected cash", 7.89m, new(2026, 9, 22));
            await db.SaveChangesAsync();
        }

        var changed = await ReadAsync(owner.Client);
        var changedItems = changed.GetProperty("recentActivity").GetProperty("items").EnumerateArray().ToArray();
        Assert.DoesNotContain(changedItems, value => value.GetProperty("recordId").GetInt32() == secondExpense.Id
            && value.GetProperty("kind").GetString() == "expense");
        var changedInflow = Assert.Single(changedItems,
            value => value.GetProperty("kind").GetString() == "account_inflow");
        Assert.Equal("2026-09-22", changedInflow.GetProperty("date").GetString());
        Assert.Equal("7.89", changedInflow.GetProperty("amount").GetString());
        Assert.Equal("recorded_receipt", changedInflow.GetProperty("paycheck").GetProperty("relation").GetString());
    }

    [Fact]
    public async Task Upcoming_uses_UTC_projection_windows_exact_amounts_and_backend_ranking()
    {
        await using var app = new HomeTestApplication(Now);
        using var owner = await app.CreateAuthenticatedUserAsync("home-upcoming@example.com");

        var overlapping = RangeProfile(owner.Id, "Overlapping range", 25, 3, 0, 100.25m, 200.75m);
        var today = Profile(owner.Id, "Today fixed", 23, expectedAmount: 9999999999999999.99m);
        var third = Profile(owner.Id, "Third omitted", 24, expectedAmount: 300m);
        var outside = Profile(owner.Id, "Outside horizon", 7, expectedAmount: 400m);
        var paused = Profile(owner.Id, "Paused", 23, PaycheckLifecycle.Paused, 500m);
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            db.PaycheckProfiles.AddRange(overlapping, today, third, outside, paused);
            await db.SaveChangesAsync();
        }

        var body = await ReadAsync(owner.Client);
        var activity = body.GetProperty("recentActivity").GetProperty("items");
        Assert.Empty(activity.EnumerateArray());
        var items = body.GetProperty("upcoming").GetProperty("items").EnumerateArray().ToArray();

        Assert.Equal(2, items.Length);
        Assert.Equal([overlapping.Id, today.Id],
            items.Select(value => value.GetProperty("paycheckProfileId").GetGuid()));
        Assert.Equal("2026-09-22", items[0].GetProperty("earliestExpectedDate").GetString());
        Assert.Equal("2026-09-25", items[0].GetProperty("latestExpectedDate").GetString());
        var range = items[0].GetProperty("amount");
        Assert.Equal("range", range.GetProperty("mode").GetString());
        Assert.Equal(JsonValueKind.Null, range.GetProperty("fixedAmount").ValueKind);
        Assert.Equal("100.25", range.GetProperty("minimumAmount").GetString());
        Assert.Equal("200.75", range.GetProperty("maximumAmount").GetString());
        var fixedAmount = items[1].GetProperty("amount");
        Assert.Equal("9999999999999999.99", fixedAmount.GetProperty("fixedAmount").GetString());
        Assert.DoesNotContain("Third omitted", body.GetRawText(), StringComparison.Ordinal);
        Assert.DoesNotContain("Outside horizon", body.GetRawText(), StringComparison.Ordinal);
        Assert.DoesNotContain("Paused", body.GetRawText(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Upcoming_includes_day_thirteen_and_excludes_day_fourteen()
    {
        await using var app = new HomeTestApplication(Now);
        using var owner = await app.CreateAuthenticatedUserAsync("home-horizon@example.com");
        var dayThirteen = Profile(owner.Id, "Day thirteen", 6);
        var dayFourteen = Profile(owner.Id, "Day fourteen", 7);
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            db.PaycheckProfiles.AddRange(dayThirteen, dayFourteen);
            await db.SaveChangesAsync();
        }

        var body = await ReadAsync(owner.Client);
        var item = Assert.Single(body.GetProperty("upcoming").GetProperty("items").EnumerateArray());
        Assert.Equal(dayThirteen.Id, item.GetProperty("paycheckProfileId").GetGuid());
        Assert.Equal("2026-10-06", item.GetProperty("anchorDate").GetString());
    }

    [Fact]
    public async Task Upcoming_uses_the_latest_owner_consistent_linked_slot_anchor()
    {
        await using var app = new HomeTestApplication(Now);
        using var owner = await app.CreateAuthenticatedUserAsync("home-latest-slot@example.com");
        var profile = Profile(owner.Id, "Already received this slot", 23);
        var receipt = await app.SeedInflowAsync(owner.Id, "Actual receipt", 1000m, new(2026, 9, 23));
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            db.PaycheckProfiles.Add(profile);
            db.PaycheckOccurrences.Add(Link(owner.Id, profile.Id, receipt, PaycheckOccurrenceKind.RecordedReceipt));
            await db.SaveChangesAsync();
        }

        var body = await ReadAsync(owner.Client, "/api/home?activityThroughDate=2026-09-23");

        Assert.Empty(body.GetProperty("upcoming").GetProperty("items").EnumerateArray());
        var activity = Assert.Single(body.GetProperty("recentActivity").GetProperty("items").EnumerateArray());
        Assert.Equal(receipt.Id, activity.GetProperty("recordId").GetInt32());
        Assert.Equal("recorded_receipt", activity.GetProperty("paycheck").GetProperty("relation").GetString());
    }

    [Fact]
    public async Task One_recoverable_section_failure_returns_the_other_without_fabricating_empty_data()
    {
        await using var app = new HomeTestApplication(
            Now,
            activity: new ThrowingActivityReader(new SyntheticDbException()));
        using var owner = await app.CreateAuthenticatedUserAsync("home-partial@example.com");

        var body = await ReadAsync(owner.Client);
        var activity = body.GetProperty("recentActivity");
        AssertUnavailable(activity);
        Assert.Equal(JsonValueKind.Null, activity.GetProperty("items").ValueKind);
        AssertAvailable(body.GetProperty("upcoming"));
        Assert.Empty(body.GetProperty("upcoming").GetProperty("items").EnumerateArray());
        Assert.Empty(body.GetProperty("attention").GetProperty("items").EnumerateArray());
    }

    [Fact]
    public async Task Both_source_sections_unavailable_returns_privacy_safe_503()
    {
        await using var app = new HomeTestApplication(
            Now,
            new ThrowingActivityReader(new SyntheticDbException()),
            new ThrowingUpcomingReader(new TimeoutException()));
        using var owner = await app.CreateAuthenticatedUserAsync("home-unavailable@example.com");

        using var response = await owner.Client.GetAsync(Route);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("home_unavailable", await ProblemCodeAsync(response));
        Assert.DoesNotContain(nameof(SyntheticDbException), await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Cancellation_and_programming_defects_are_not_converted_to_section_unavailability()
    {
        var canceled = new CancellationToken(canceled: true);
        var upcoming = new RecordingUpcomingReader();
        var canceledService = new HomeReadService(
            new ThrowingActivityReader(new OperationCanceledException(canceled)),
            upcoming,
            new FrozenTimeProvider(Now),
            NullLogger<HomeReadService>.Instance);

        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            canceledService.GetAsync("owner", new(2026, 9, 22), canceled));
        Assert.False(upcoming.Called);

        var defectiveService = new HomeReadService(
            new ThrowingActivityReader(new InvalidOperationException("synthetic defect")),
            upcoming,
            new FrozenTimeProvider(Now),
            NullLogger<HomeReadService>.Instance);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            defectiveService.GetAsync("owner", new(2026, 9, 22), default));
    }

    private static async Task<JsonElement> ReadAsync(HttpClient client, string route = Route)
    {
        using var response = await client.GetAsync(route);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<string?> ProblemCodeAsync(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString();

    private static void AssertAvailable(JsonElement section)
    {
        var availability = section.GetProperty("availability");
        Assert.Equal("available", availability.GetProperty("state").GetString());
        Assert.Equal(JsonValueKind.Null, availability.GetProperty("reasonCode").ValueKind);
    }

    private static void AssertUnavailable(JsonElement section)
    {
        var availability = section.GetProperty("availability");
        Assert.Equal("unavailable", availability.GetProperty("state").GetString());
        Assert.Equal("source_unavailable", availability.GetProperty("reasonCode").GetString());
    }

    private static PaycheckProfile Profile(
        string ownerId,
        string name,
        short day,
        PaycheckLifecycle lifecycle = PaycheckLifecycle.Active,
        decimal expectedAmount = 1000m) => new()
    {
        Id = Guid.NewGuid(),
        OwnerId = ownerId,
        DisplayName = name,
        Lifecycle = lifecycle,
        Cadence = PaycheckCadence.Monthly,
        FirstMonthAnchor = day,
        WindowBeforeDays = 0,
        WindowAfterDays = 0,
        AmountMode = PaycheckAmountMode.Fixed,
        ExpectedAmount = expectedAmount,
        CreatedAt = Now.UtcDateTime,
        UpdatedAt = Now.UtcDateTime
    };

    private static PaycheckProfile RangeProfile(
        string ownerId,
        string name,
        short day,
        short before,
        short after,
        decimal minimum,
        decimal maximum) => new()
    {
        Id = Guid.NewGuid(),
        OwnerId = ownerId,
        DisplayName = name,
        Lifecycle = PaycheckLifecycle.Active,
        Cadence = PaycheckCadence.Monthly,
        FirstMonthAnchor = day,
        WindowBeforeDays = before,
        WindowAfterDays = after,
        AmountMode = PaycheckAmountMode.Range,
        ExpectedMinimumAmount = minimum,
        ExpectedMaximumAmount = maximum,
        CreatedAt = Now.UtcDateTime,
        UpdatedAt = Now.UtcDateTime
    };

    private static PaycheckOccurrence Link(
        string ownerId,
        Guid profileId,
        AccountInflow inflow,
        PaycheckOccurrenceKind kind) => new()
    {
        PaycheckProfileId = profileId,
        AccountInflowId = inflow.Id,
        OwnerId = ownerId,
        Kind = kind,
        EvidenceRevisionAtAssignment = inflow.PaycheckEvidenceRevision,
        SlotAnchor = inflow.Date,
        TimingOffsetDays = 0,
        LinkedAt = Now.UtcDateTime
    };

    private static async Task<(int Expenses, int Inflows, int Profiles, int Occurrences)> RecordStateAsync(
        FinancialApiTestApplicationBase app)
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

internal sealed class HomeTestApplication(
    DateTimeOffset now,
    IHomeActivityReader? activity = null,
    IHomeUpcomingReader? upcoming = null) : FinancialApiTestApplication
{
    protected override void ConfigureAdditionalServices(IServiceCollection services)
    {
        services.RemoveAll<TimeProvider>();
        services.AddSingleton<TimeProvider>(new FrozenTimeProvider(now));
        if (activity is not null)
        {
            services.RemoveAll<IHomeActivityReader>();
            services.AddSingleton(activity);
        }
        if (upcoming is not null)
        {
            services.RemoveAll<IHomeUpcomingReader>();
            services.AddSingleton(upcoming);
        }
    }
}

internal sealed class FrozenTimeProvider(DateTimeOffset now) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => now;
}

internal sealed class ThrowingActivityReader(Exception exception) : IHomeActivityReader
{
    public Task<HomeRecentActivitySectionResponse> ReadAsync(
        string ownerId,
        DateOnly throughDate,
        CancellationToken cancellationToken) =>
        Task.FromException<HomeRecentActivitySectionResponse>(exception);
}

internal sealed class ThrowingUpcomingReader(Exception exception) : IHomeUpcomingReader
{
    public Task<HomeUpcomingSectionResponse> ReadAsync(
        string ownerId,
        DateOnly evaluatedOn,
        CancellationToken cancellationToken) =>
        Task.FromException<HomeUpcomingSectionResponse>(exception);
}

internal sealed class RecordingUpcomingReader : IHomeUpcomingReader
{
    public bool Called { get; private set; }

    public Task<HomeUpcomingSectionResponse> ReadAsync(
        string ownerId,
        DateOnly evaluatedOn,
        CancellationToken cancellationToken)
    {
        Called = true;
        return Task.FromResult(new HomeUpcomingSectionResponse(
            new HomeSectionAvailabilityResponse("available", null),
            new HomeUpcomingHorizonResponse(evaluatedOn, evaluatedOn.AddDays(13)),
            []));
    }
}

internal sealed class SyntheticDbException : DbException;
