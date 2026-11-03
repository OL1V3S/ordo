using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BudgetPlanner.Commitments;
using BudgetPlanner.Contracts.Commitments;
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
        Assert.Equal("2026-09-23", attention.GetProperty("evaluatedOn").GetString());
        Assert.Equal(new[] { "commitment_change_review", "budget_attention" }, attention.GetProperty("kindsEvaluated")
            .EnumerateArray().Select(value => value.GetString()));
        Assert.Empty(attention.GetProperty("items").EnumerateArray());
        Assert.Empty(attention.GetProperty("budgetItems").EnumerateArray());
        Assert.Equal("available", attention.GetProperty("familyAvailability")
            .GetProperty("budget_attention").GetProperty("state").GetString());

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
    public async Task Attention_shows_only_pending_reviews_with_minimal_owner_scoped_contract()
    {
        var now = new DateTimeOffset(2026, 10, 29, 18, 0, 0, TimeSpan.Zero);
        await using var app = new HomeTestApplication(now);
        using var owner = await app.CreateAuthenticatedUserAsync("home-attention@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("home-attention-other@example.com");

        var confirmation = new List<Expense>();
        foreach (var date in new[] { new DateOnly(2026, 5, 10), new DateOnly(2026, 6, 10), new DateOnly(2026, 7, 10) })
            confirmation.Add(await app.SeedExpenseAsync(owner.Id, "membership", 10m, date, "bills"));
        foreach (var date in new[] { new DateOnly(2026, 8, 12), new DateOnly(2026, 9, 12), new DateOnly(2026, 10, 12) })
            await app.SeedExpenseAsync(owner.Id, "membership", 12m, date, "bills");
        await SeedHomeCommitmentAsync(app, owner.Id, confirmation, "Gym plan");

        var foreignConfirmation = new List<Expense>();
        foreach (var date in new[] { new DateOnly(2026, 5, 10), new DateOnly(2026, 6, 10), new DateOnly(2026, 7, 10) })
            foreignConfirmation.Add(await app.SeedExpenseAsync(other.Id, "private membership", 10m, date, "private"));
        foreach (var date in new[] { new DateOnly(2026, 8, 12), new DateOnly(2026, 9, 12), new DateOnly(2026, 10, 12) })
            await app.SeedExpenseAsync(other.Id, "private membership", 12m, date, "private");
        await SeedHomeCommitmentAsync(app, other.Id, foreignConfirmation, "Foreign secret name");

        var body = await ReadAsync(owner.Client);
        var attention = body.GetProperty("attention");
        AssertAvailable(attention);
        Assert.Equal("2026-10-29", attention.GetProperty("evaluatedOn").GetString());
        Assert.Equal(new[] { "commitment_change_review", "budget_attention" }, attention.GetProperty("kindsEvaluated")
            .EnumerateArray().Select(value => value.GetString()));
        var item = Assert.Single(attention.GetProperty("items").EnumerateArray());
        Assert.Equal("commitment_change_review", item.GetProperty("kind").GetString());
        Assert.Equal("Gym plan", item.GetProperty("commitmentName").GetString());
        Assert.Equal(new[] { "amount", "timing" }, item.GetProperty("reviews").EnumerateArray()
            .Select(value => value.GetProperty("dimension").GetString()));
        Assert.All(item.GetProperty("reviews").EnumerateArray(), review =>
            Assert.Equal("proposed_change", review.GetProperty("state").GetString()));
        Assert.DoesNotContain("Foreign secret", body.GetRawText(), StringComparison.Ordinal);
        Assert.DoesNotContain("fingerprint", body.GetRawText(), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("algorithmVersion", body.GetRawText(), StringComparison.Ordinal);
        Assert.DoesNotContain("observations", body.GetRawText(), StringComparison.Ordinal);
        Assert.DoesNotContain("ownerId", body.GetRawText(), StringComparison.OrdinalIgnoreCase);

        var changeRead = await owner.Client.GetFromJsonAsync<JsonElement>("/api/commitment-changes");
        var amountFingerprint = Assert.Single(changeRead.GetProperty("changes").EnumerateArray())
            .GetProperty("amount").GetProperty("fingerprint").GetString();
        using var kept = await owner.Client.PostAsJsonAsync(
            $"/api/commitment-changes/{item.GetProperty("commitmentId").GetGuid()}/amount/keep",
            new { fingerprint = amountFingerprint });
        Assert.Equal(HttpStatusCode.NoContent, kept.StatusCode);
        var afterKeep = await ReadAsync(owner.Client);
        var remainingReviews = Assert.Single(afterKeep.GetProperty("attention").GetProperty("items").EnumerateArray())
            .GetProperty("reviews").EnumerateArray();
        Assert.Equal(new[] { "timing" }, remainingReviews
            .Select(value => value.GetProperty("dimension").GetString()));
    }

    [Fact]
    public async Task Budget_attention_uses_exact_categories_owner_month_cutoff_and_state_ranking()
    {
        await using var app = new HomeTestApplication(Now);
        using var owner = await app.CreateAuthenticatedUserAsync("home-budget-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("home-budget-other@example.com");
        var month = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc);

        await app.SeedBudgetLimitAsync(owner.Id, "food", 10m, month);
        await app.SeedBudgetLimitAsync(owner.Id, "rent", 100m, month);
        await app.SeedBudgetLimitAsync(owner.Id, "zero", 0m, month);
        await app.SeedBudgetLimitAsync(owner.Id, "zero-quiet", 0m, month);
        await app.SeedBudgetLimitAsync(owner.Id, "quiet", 20m, month);
        await app.SeedBudgetLimitAsync(owner.Id, "Custom", 50m, month);
        await app.SeedBudgetLimitAsync(other.Id, "foreign", 1m, month);

        await app.SeedExpenseAsync(owner.Id, "Food start", 5m, new(2026, 9, 1), "food");
        await app.SeedExpenseAsync(owner.Id, "Food cutoff", 5m, new(2026, 9, 22), "food");
        await app.SeedExpenseAsync(owner.Id, "Food after cutoff", 100m, new(2026, 9, 23), "food");
        await app.SeedExpenseAsync(owner.Id, "Invalid after cutoff", 0m, new(2026, 9, 23), "food");
        await app.SeedExpenseAsync(owner.Id, "Food prior month", 100m, new(2026, 8, 31), "food");
        await app.SeedExpenseAsync(owner.Id, "Zero spending", 0.01m, new(2026, 9, 10), "zero");
        await app.SeedExpenseAsync(owner.Id, "Quiet spending", 19.99m, new(2026, 9, 10), "quiet");
        await app.SeedExpenseAsync(owner.Id, "Different category case", 500m, new(2026, 9, 10), "custom");
        await app.SeedExpenseAsync(owner.Id, "No configured limit", 500m, new(2026, 9, 10), "unbudgeted");
        await app.SeedExpenseAsync(other.Id, "Foreign food", 500m, new(2026, 9, 10), "food");
        await app.SeedExpenseAsync(other.Id, "Foreign category", 500m, new(2026, 9, 10), "foreign");

        var body = await ReadAsync(owner.Client);
        var attention = body.GetProperty("attention");
        var items = attention.GetProperty("budgetItems").EnumerateArray().ToArray();

        Assert.Equal(new[] { "zero_limit_spending", "at_limit" },
            items.Select(item => item.GetProperty("state").GetString()));
        Assert.Equal("zero", items[0].GetProperty("category").GetString());
        Assert.Equal("0.01", items[0].GetProperty("spentAmount").GetString());
        Assert.Equal("0.00", items[0].GetProperty("limitAmount").GetString());
        Assert.Equal("food", items[1].GetProperty("category").GetString());
        Assert.Equal("10.00", items[1].GetProperty("spentAmount").GetString());
        Assert.Equal("10.00", items[1].GetProperty("limitAmount").GetString());
        Assert.Equal(new[] { "commitment_change_review", "budget_attention" },
            attention.GetProperty("kindsEvaluated").EnumerateArray().Select(item => item.GetString()));
        Assert.DoesNotContain("foreign", attention.GetRawText(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Budget_attention_preserves_pending_commitment_reviews_when_legacy_expense_is_invalid()
    {
        await using var app = new HomeTestApplication(new DateTimeOffset(2026, 10, 29, 18, 0, 0, TimeSpan.Zero));
        using var owner = await app.CreateAuthenticatedUserAsync("home-budget-invalid-expense@example.com");
        var confirmation = new List<Expense>();
        foreach (var date in new[] { new DateOnly(2026, 5, 10), new DateOnly(2026, 6, 10), new DateOnly(2026, 7, 10) })
            confirmation.Add(await app.SeedExpenseAsync(owner.Id, "membership", 10m, date, "bills"));
        foreach (var date in new[] { new DateOnly(2026, 8, 12), new DateOnly(2026, 9, 12), new DateOnly(2026, 10, 12) })
            await app.SeedExpenseAsync(owner.Id, "membership", 12m, date, "bills");
        await SeedHomeCommitmentAsync(app, owner.Id, confirmation, "Gym plan");
        await app.SeedExpenseAsync(owner.Id, "Legacy zero expense", 0m, new(2026, 9, 15), "legacy");

        var body = await ReadAsync(owner.Client);
        var attention = body.GetProperty("attention");

        AssertAvailable(attention);
        Assert.Equal("available", attention.GetProperty("familyAvailability")
            .GetProperty("commitment_change_review").GetProperty("state").GetString());
        Assert.Equal("unavailable", attention.GetProperty("familyAvailability")
            .GetProperty("budget_attention").GetProperty("state").GetString());
        Assert.Equal(new[] { "commitment_change_review" }, attention.GetProperty("kindsEvaluated")
            .EnumerateArray().Select(item => item.GetString()));
        Assert.Single(attention.GetProperty("items").EnumerateArray());
        Assert.Equal(JsonValueKind.Null, attention.GetProperty("budgetItems").ValueKind);
    }

    [Fact]
    public async Task Budget_attention_remains_available_when_commitment_family_fails()
    {
        await using var app = new HomeTestApplication(
            Now,
            commitmentChanges: new ThrowingCommitmentChangeReadService(new TimeoutException()));
        using var owner = await app.CreateAuthenticatedUserAsync("home-budget-commitment-failure@example.com");
        await app.SeedBudgetLimitAsync(owner.Id, "food", 10m, new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc));
        await app.SeedExpenseAsync(owner.Id, "Over budget", 10.01m, new(2026, 9, 22), "food");

        var attention = (await ReadAsync(owner.Client)).GetProperty("attention");

        AssertAvailable(attention);
        Assert.Equal("unavailable", attention.GetProperty("familyAvailability")
            .GetProperty("commitment_change_review").GetProperty("state").GetString());
        Assert.Equal("available", attention.GetProperty("familyAvailability")
            .GetProperty("budget_attention").GetProperty("state").GetString());
        Assert.Equal(new[] { "budget_attention" }, attention.GetProperty("kindsEvaluated")
            .EnumerateArray().Select(item => item.GetString()));
        Assert.Equal("over_limit", Assert.Single(attention.GetProperty("budgetItems").EnumerateArray())
            .GetProperty("state").GetString());
        Assert.Equal(JsonValueKind.Null, attention.GetProperty("items").ValueKind);
    }

    [Theory]
    [InlineData("negative_budget")]
    [InlineData("duplicate_budget")]
    [InlineData("negative_expense")]
    [InlineData("zero_expense")]
    [InlineData("invalid_precision")]
    [InlineData("out_of_range")]
    [InlineData("sum_overflow")]
    public async Task Budget_attention_fails_closed_for_unsafe_legacy_rows(string rowKind)
    {
        await using var app = new HomeTestApplication(Now);
        using var owner = await app.CreateAuthenticatedUserAsync($"home-budget-{rowKind}@example.com");
        var month = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc);
        if (rowKind == "negative_budget")
            await app.SeedBudgetLimitAsync(owner.Id, "food", -1m, month);
        else
            await app.SeedBudgetLimitAsync(owner.Id, "food", 10m, month);

        if (rowKind == "duplicate_budget")
            await app.SeedBudgetLimitAsync(owner.Id, "food", 20m, month);
        if (rowKind == "negative_expense")
            await app.SeedExpenseAsync(owner.Id, "Legacy negative", -1m, new(2026, 9, 10), "food");
        if (rowKind == "zero_expense")
            await app.SeedExpenseAsync(owner.Id, "Legacy zero", 0m, new(2026, 9, 10), "food");
        if (rowKind == "invalid_precision")
            await app.SeedExpenseAsync(owner.Id, "Invalid precision", 1.001m, new(2026, 9, 10), "food");
        if (rowKind == "out_of_range")
            await app.SeedExpenseAsync(owner.Id, "Out of range", 10_000_000_000_000_000m, new(2026, 9, 10), "food");
        if (rowKind == "sum_overflow")
        {
            await app.SeedExpenseAsync(owner.Id, "Maximum amount", 9_999_999_999_999_999.99m, new(2026, 9, 10), "food");
            await app.SeedExpenseAsync(owner.Id, "Overflow cent", 0.01m, new(2026, 9, 11), "food");
        }

        var attention = (await ReadAsync(owner.Client)).GetProperty("attention");

        AssertAvailable(attention);
        Assert.Equal("available", attention.GetProperty("familyAvailability")
            .GetProperty("commitment_change_review").GetProperty("state").GetString());
        Assert.Equal("unavailable", attention.GetProperty("familyAvailability")
            .GetProperty("budget_attention").GetProperty("state").GetString());
        Assert.Equal(JsonValueKind.Null, attention.GetProperty("budgetItems").ValueKind);
    }

    [Theory]
    [InlineData("budget", "")]
    [InlineData("budget", "   ")]
    [InlineData("expense", "")]
    [InlineData("expense", "   ")]
    public async Task Blank_legacy_categories_fail_only_budget_attention_and_keep_commitment_reviews(
        string rowKind,
        string category)
    {
        var now = new DateTimeOffset(2026, 10, 29, 18, 0, 0, TimeSpan.Zero);
        await using var app = new HomeTestApplication(now);
        using var owner = await app.CreateAuthenticatedUserAsync(
            $"home-budget-blank-category-{rowKind}-{(category.Length == 0 ? "empty" : "spaces")}@example.com");

        var month = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc);
        await app.SeedBudgetLimitAsync(owner.Id, "food", 10m, month);
        await app.SeedExpenseAsync(owner.Id, "Over budget", 20m, new(2026, 9, 10), "food");
        if (rowKind == "budget")
        {
            await app.SeedBudgetLimitAsync(owner.Id, category, 10m, month);
            await app.SeedExpenseAsync(owner.Id, "Blank category", 20m, new(2026, 9, 11), category);
        }
        else
        {
            await app.SeedExpenseAsync(owner.Id, "Blank category", 1m, new(2026, 9, 11), category);
        }

        var confirmation = new List<Expense>();
        foreach (var date in new[] { new DateOnly(2026, 5, 10), new DateOnly(2026, 6, 10), new DateOnly(2026, 7, 10) })
            confirmation.Add(await app.SeedExpenseAsync(owner.Id, "membership", 10m, date, "bills"));
        foreach (var date in new[] { new DateOnly(2026, 8, 12), new DateOnly(2026, 9, 12), new DateOnly(2026, 10, 12) })
            await app.SeedExpenseAsync(owner.Id, "membership", 12m, date, "bills");
        await SeedHomeCommitmentAsync(app, owner.Id, confirmation, "Gym plan");

        var attention = (await ReadAsync(owner.Client)).GetProperty("attention");

        AssertAvailable(attention);
        Assert.Equal("available", attention.GetProperty("familyAvailability")
            .GetProperty("commitment_change_review").GetProperty("state").GetString());
        Assert.Equal("unavailable", attention.GetProperty("familyAvailability")
            .GetProperty("budget_attention").GetProperty("state").GetString());
        Assert.Equal(new[] { "commitment_change_review" }, attention.GetProperty("kindsEvaluated")
            .EnumerateArray().Select(value => value.GetString()));
        Assert.Equal("Gym plan", Assert.Single(attention.GetProperty("items").EnumerateArray())
            .GetProperty("commitmentName").GetString());
        Assert.Equal(JsonValueKind.Null, attention.GetProperty("budgetItems").ValueKind);
    }

    [Fact]
    public async Task Attention_failure_is_independent_and_all_three_sources_define_503_boundary()
    {
        await using var partial = new HomeTestApplication(
            Now, attention: new ThrowingAttentionReader(new SyntheticDbException()));
        using var owner = await partial.CreateAuthenticatedUserAsync("home-attention-partial@example.com");
        var body = await ReadAsync(owner.Client);
        AssertUnavailable(body.GetProperty("attention"));
        Assert.Equal(JsonValueKind.Null, body.GetProperty("attention").GetProperty("items").ValueKind);
        Assert.Empty(body.GetProperty("attention").GetProperty("kindsEvaluated").EnumerateArray());
        AssertAvailable(body.GetProperty("recentActivity"));
        AssertAvailable(body.GetProperty("upcoming"));

        await using var attentionOnly = new HomeTestApplication(
            Now,
            new ThrowingActivityReader(new SyntheticDbException()),
            new ThrowingUpcomingReader(new TimeoutException()));
        using var otherOwner = await attentionOnly.CreateAuthenticatedUserAsync("home-attention-only@example.com");
        using var response = await otherOwner.Client.GetAsync(Route);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var attentionOnlyBody = await response.Content.ReadFromJsonAsync<JsonElement>();
        AssertAvailable(attentionOnlyBody.GetProperty("attention"));
        AssertUnavailable(attentionOnlyBody.GetProperty("recentActivity"));
        AssertUnavailable(attentionOnlyBody.GetProperty("upcoming"));
    }

    [Fact]
    public async Task Recent_activity_breaks_same_day_ties_by_kind_then_id_descending()
    {
        await using var app = new HomeTestApplication(Now);
        using var owner = await app.CreateAuthenticatedUserAsync("home-activity-ties@example.com");

        var expense = await app.SeedExpenseAsync(owner.Id, "Expense", date: new(2026, 9, 22));
        var firstInflow = await app.SeedInflowAsync(owner.Id, "First inflow", date: new(2026, 9, 22));
        var secondInflow = await app.SeedInflowAsync(owner.Id, "Second inflow", date: new(2026, 9, 22));

        var body = await ReadAsync(owner.Client);
        var items = body.GetProperty("recentActivity").GetProperty("items").EnumerateArray().ToArray();

        Assert.Equal(["expense", "account_inflow", "account_inflow"],
            items.Select(value => value.GetProperty("kind").GetString()));
        Assert.Equal([expense.Id, secondInflow.Id, firstInflow.Id],
            items.Select(value => value.GetProperty("recordId").GetInt32()));
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

        // In-window profiles are shown as paycheck attention and removed from Coming Up.
        var upcomingItems = body.GetProperty("upcoming").GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal([third.Id], upcomingItems.Select(value => value.GetProperty("paycheckProfileId").GetGuid()));
        var items = body.GetProperty("paycheckAttention").GetProperty("items").EnumerateArray().ToArray();

        Assert.Equal(2, items.Length);
        Assert.Equal([today.Id, overlapping.Id],
            items.Select(value => value.GetProperty("paycheckProfileId").GetGuid()));
        Assert.All(items, value => Assert.Equal("paycheck_expected", value.GetProperty("kind").GetString()));
        Assert.Equal("2026-09-22", items[1].GetProperty("earliestExpectedDate").GetString());
        Assert.Equal("2026-09-25", items[1].GetProperty("latestExpectedDate").GetString());
        var range = items[1].GetProperty("amount");
        Assert.Equal("range", range.GetProperty("mode").GetString());
        Assert.Equal(JsonValueKind.Null, range.GetProperty("fixedAmount").ValueKind);
        Assert.Equal("100.25", range.GetProperty("minimumAmount").GetString());
        Assert.Equal("200.75", range.GetProperty("maximumAmount").GetString());
        var fixedAmount = items[0].GetProperty("amount");
        Assert.Equal("9999999999999999.99", fixedAmount.GetProperty("fixedAmount").GetString());
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
    public async Task Upcoming_skips_one_unrepresentable_profile_and_keeps_valid_projections()
    {
        await using var app = new HomeTestApplication(
            new DateTimeOffset(9999, 12, 18, 12, 0, 0, TimeSpan.Zero));
        using var owner = await app.CreateAuthenticatedUserAsync("home-unrepresentable-profile@example.com");

        var valid = Profile(owner.Id, "Representable profile", 22);
        var unrepresentable = Profile(owner.Id, "Unrepresentable profile", 31);
        var finalReceipt = await app.SeedInflowAsync(
            owner.Id, "Final representable date", date: DateOnly.MaxValue);
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            db.PaycheckProfiles.AddRange(valid, unrepresentable);
            db.PaycheckOccurrences.Add(Link(
                owner.Id, unrepresentable.Id, finalReceipt, PaycheckOccurrenceKind.RecordedReceipt));
            await db.SaveChangesAsync();
        }

        var body = await ReadAsync(owner.Client, "/api/home?activityThroughDate=9999-12-17");
        var upcoming = body.GetProperty("upcoming");
        AssertAvailable(upcoming);
        var item = Assert.Single(upcoming.GetProperty("items").EnumerateArray());
        Assert.Equal(valid.Id, item.GetProperty("paycheckProfileId").GetGuid());
        Assert.Equal("9999-12-22", item.GetProperty("anchorDate").GetString());
        Assert.DoesNotContain("Unrepresentable profile", body.GetRawText(), StringComparison.Ordinal);
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
        Assert.Equal(new[] { "commitment_change_review", "budget_attention" }, body.GetProperty("attention").GetProperty("kindsEvaluated")
            .EnumerateArray().Select(value => value.GetString()));
    }

    [Fact]
    public async Task All_source_sections_unavailable_returns_privacy_safe_503()
    {
        await using var app = new HomeTestApplication(
            Now,
            new ThrowingActivityReader(new SyntheticDbException()),
            new ThrowingUpcomingReader(new TimeoutException()),
            new ThrowingAttentionReader(new SyntheticDbException()));
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
        var attention = new RecordingAttentionReader();
        var upcoming = new RecordingUpcomingReader();
        var canceledService = new HomeReadService(
            attention,
            new ThrowingActivityReader(new OperationCanceledException(canceled)),
            upcoming,
            new FrozenTimeProvider(Now),
            NullLogger<HomeReadService>.Instance);

        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            canceledService.GetAsync("owner", new(2026, 9, 22), canceled));
        Assert.True(attention.Called);
        Assert.False(upcoming.Called);

        var defectiveService = new HomeReadService(
            attention,
            new ThrowingActivityReader(new InvalidOperationException("synthetic defect")),
            upcoming,
            new FrozenTimeProvider(Now),
            NullLogger<HomeReadService>.Instance);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            defectiveService.GetAsync("owner", new(2026, 9, 22), default));
    }

    private static PaycheckProfile Created(PaycheckProfile profile, DateTime createdAt)
    {
        profile.CreatedAt = createdAt;
        profile.UpdatedAt = createdAt;
        return profile;
    }

    private static readonly DateTime LongAgo = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Recent = new(2026, 9, 10, 0, 0, 0, DateTimeKind.Utc);

    private static async Task SeedAsync(FinancialApiTestApplicationBase app, params PaycheckProfile[] profiles)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        db.PaycheckProfiles.AddRange(profiles);
        await db.SaveChangesAsync();
    }

    private static JsonElement[] AttentionItems(JsonElement body) =>
        body.GetProperty("paycheckAttention").GetProperty("items").EnumerateArray().ToArray();

    [Fact]
    public async Task Paycheck_attention_flags_expected_and_unrecorded_but_not_future_windows()
    {
        await using var app = new HomeTestApplication(Now);
        using var owner = await app.CreateAuthenticatedUserAsync("home-pa-basic@example.com");
        var expected = Created(RangeProfile(owner.Id, "In window", 24, 2, 1, 10m, 20m), Recent);
        var missed = Created(Profile(owner.Id, "Missed", 20), Recent);
        var future = Created(Profile(owner.Id, "Future", 28), Recent);
        await SeedAsync(app, expected, missed, future);

        var body = await ReadAsync(owner.Client);

        AssertAvailable(body.GetProperty("paycheckAttention"));
        Assert.Equal("2026-09-23", body.GetProperty("paycheckAttention").GetProperty("evaluatedOn").GetString());
        var items = AttentionItems(body);
        Assert.Equal(["paycheck_unrecorded", "paycheck_expected"], items.Select(v => v.GetProperty("kind").GetString()));
        Assert.Equal([missed.Id, expected.Id], items.Select(v => v.GetProperty("paycheckProfileId").GetGuid()));
        Assert.Equal("2026-09-20", items[0].GetProperty("anchorDate").GetString());
        Assert.Equal("2026-09-20", items[0].GetProperty("latestExpectedDate").GetString());
        Assert.Equal("2026-09-22", items[1].GetProperty("earliestExpectedDate").GetString());
        Assert.Equal("2026-09-25", items[1].GetProperty("latestExpectedDate").GetString());
        // The expected profile is de-duplicated out of Coming Up; the future one stays.
        var upcoming = body.GetProperty("upcoming").GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal([future.Id], upcoming.Select(v => v.GetProperty("paycheckProfileId").GetGuid()));
    }

    [Fact]
    public async Task Paycheck_attention_unrecorded_look_back_is_thirty_days_after_window_end()
    {
        await using var app = new HomeTestApplication(Now);
        using var owner = await app.CreateAuthenticatedUserAsync("home-pa-bound@example.com");
        var inside = Created(Profile(owner.Id, "Thirty days", 24), LongAgo);   // Aug 24 ended 30 days ago
        var outside = Created(Profile(owner.Id, "Thirty one days", 23), LongAgo); // Aug 23 ended 31 days ago
        await SeedAsync(app, inside, outside);

        var body = await ReadAsync(owner.Client);

        var unrecorded = AttentionItems(body).Where(v => v.GetProperty("kind").GetString() == "paycheck_unrecorded").ToArray();
        var item = Assert.Single(unrecorded);
        Assert.Equal(inside.Id, item.GetProperty("paycheckProfileId").GetGuid());
        Assert.Equal("2026-08-24", item.GetProperty("anchorDate").GetString());
    }

    [Fact]
    public async Task Paycheck_attention_ignores_slots_before_profile_creation_but_keeps_creation_day()
    {
        await using var app = new HomeTestApplication(Now);
        using var owner = await app.CreateAuthenticatedUserAsync("home-pa-created@example.com");
        var after = Created(Profile(owner.Id, "Created after", 20), new DateTime(2026, 9, 21, 8, 0, 0, DateTimeKind.Utc));
        var sameDay = Created(Profile(owner.Id, "Created on anchor", 21), new DateTime(2026, 9, 21, 23, 0, 0, DateTimeKind.Utc));
        await SeedAsync(app, after, sameDay);

        var body = await ReadAsync(owner.Client);

        var item = Assert.Single(AttentionItems(body));
        Assert.Equal(sameDay.Id, item.GetProperty("paycheckProfileId").GetGuid());
        Assert.Equal("paycheck_unrecorded", item.GetProperty("kind").GetString());
    }

    [Theory]
    [InlineData(PaycheckOccurrenceKind.RecordedReceipt)]
    [InlineData(PaycheckOccurrenceKind.ConfirmationEvidence)]
    public async Task Paycheck_attention_is_cleared_only_by_a_linked_inflow(PaycheckOccurrenceKind kind)
    {
        await using var app = new HomeTestApplication(Now);
        using var owner = await app.CreateAuthenticatedUserAsync($"home-pa-linked-{kind}@example.com");
        var linked = Created(Profile(owner.Id, "Linked", 20), Recent);
        var unlinked = Created(Profile(owner.Id, "Unlinked", 21), Recent);
        var receipt = await app.SeedInflowAsync(owner.Id, "Linked pay", 1000m, new(2026, 9, 20));
        await app.SeedInflowAsync(owner.Id, "Loose pay", 1000m, new(2026, 9, 21));
        await SeedAsync(app, linked, unlinked);
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            db.PaycheckOccurrences.Add(Link(owner.Id, linked.Id, receipt, kind));
            await db.SaveChangesAsync();
        }

        var body = await ReadAsync(owner.Client, "/api/home?activityThroughDate=2026-09-23");

        var item = Assert.Single(AttentionItems(body));
        Assert.Equal(unlinked.Id, item.GetProperty("paycheckProfileId").GetGuid());
    }

    [Fact]
    public async Task Paycheck_attention_excludes_inactive_and_other_owner_profiles_and_writes_nothing()
    {
        await using var app = new HomeTestApplication(Now);
        using var owner = await app.CreateAuthenticatedUserAsync("home-pa-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("home-pa-other@example.com");
        await SeedAsync(app,
            Created(Profile(owner.Id, "Paused", 20, PaycheckLifecycle.Paused), LongAgo),
            Created(Profile(other.Id, "Foreign", 20), LongAgo),
            Created(Profile(owner.Id, "Mine", 21), LongAgo));
        var before = await RecordStateAsync(app);

        var body = await ReadAsync(owner.Client);

        var item = Assert.Single(AttentionItems(body));
        Assert.Equal("Mine", item.GetProperty("displayName").GetString());
        Assert.DoesNotContain("Foreign", body.GetRawText(), StringComparison.Ordinal);
        Assert.Equal(before, await RecordStateAsync(app));
    }

    [Fact]
    public async Task Paycheck_attention_orders_unrecorded_oldest_first_then_expected_and_caps_at_three()
    {
        await using var app = new HomeTestApplication(Now);
        using var owner = await app.CreateAuthenticatedUserAsync("home-pa-order@example.com");
        var newer = Created(Profile(owner.Id, "Newer miss", 21), Recent);
        var older = Created(Profile(owner.Id, "Older miss", 18), Recent);
        var today = Created(Profile(owner.Id, "Today", 23), Recent);
        var later = Created(RangeProfile(owner.Id, "Later", 25, 3, 0, 1m, 2m), Recent);
        await SeedAsync(app, newer, older, today, later);

        var body = await ReadAsync(owner.Client);

        Assert.Equal([older.Id, newer.Id, today.Id],
            AttentionItems(body).Select(v => v.GetProperty("paycheckProfileId").GetGuid()));
        // Only the displayed expected item is removed from Coming Up; "Later" is not displayed.
        var upcoming = body.GetProperty("upcoming").GetProperty("items").EnumerateArray()
            .Select(v => v.GetProperty("paycheckProfileId").GetGuid()).ToArray();
        Assert.Equal([later.Id], upcoming);
    }

    [Fact]
    public async Task Coming_up_still_shows_two_after_removing_an_expected_occurrence()
    {
        await using var app = new HomeTestApplication(Now);
        using var owner = await app.CreateAuthenticatedUserAsync("home-pa-takes2@example.com");
        var a = Created(Profile(owner.Id, "A", 23), Recent);
        var b = Created(Profile(owner.Id, "B", 24), Recent);
        var c = Created(Profile(owner.Id, "C", 25), Recent);
        var d = Created(Profile(owner.Id, "D", 26), Recent);
        await SeedAsync(app, a, b, c, d);

        var body = await ReadAsync(owner.Client);

        Assert.Equal([b.Id, c.Id], body.GetProperty("upcoming").GetProperty("items").EnumerateArray()
            .Select(v => v.GetProperty("paycheckProfileId").GetGuid()));
    }

    [Fact]
    public async Task Paycheck_attention_unavailable_when_shared_read_fails_but_home_survives_otherwise()
    {
        await using var app = new HomeTestApplication(
            Now, upcoming: new ThrowingUpcomingReader(new SyntheticDbException()));
        using var owner = await app.CreateAuthenticatedUserAsync("home-pa-fail@example.com");

        var body = await ReadAsync(owner.Client);

        var section = body.GetProperty("paycheckAttention");
        AssertUnavailable(section);
        Assert.Equal(JsonValueKind.Null, section.GetProperty("items").ValueKind);
        AssertAvailable(body.GetProperty("attention"));
    }

    [Fact]
    public async Task Only_paycheck_attention_available_still_returns_200()
    {
        await using var app = new HomeTestApplication(
            Now,
            new ThrowingActivityReader(new SyntheticDbException()),
            new UpcomingUnavailableAttentionAvailableReader(),
            new ThrowingAttentionReader(new SyntheticDbException()));
        using var owner = await app.CreateAuthenticatedUserAsync("home-pa-only@example.com");

        using var response = await owner.Client.GetAsync(Route);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        AssertAvailable(body.GetProperty("paycheckAttention"));
        AssertUnavailable(body.GetProperty("upcoming"));
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

    private static async Task SeedHomeCommitmentAsync(
        FinancialApiTestApplicationBase app,
        string ownerId,
        IEnumerable<Expense> evidence,
        string name)
    {
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var at = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        context.Commitments.Add(new Commitment
        {
            Id = Guid.NewGuid(), OwnerId = ownerId, Name = name, Category = "bills",
            Lifecycle = CommitmentLifecycle.Active, Cadence = CommitmentCadence.Monthly,
            TimingKind = CommitmentTimingKind.DayOfMonth, ExpectedDay = 10,
            WindowBeforeDays = 0, WindowAfterDays = 0,
            AmountMode = CommitmentAmountMode.Fixed, ExpectedAmount = 10m,
            CreatedAt = at, UpdatedAt = at,
            Occurrences = evidence.Select(expense => new CommitmentOccurrence
            {
                ExpenseId = expense.Id, Kind = CommitmentOccurrenceKind.ConfirmationEvidence, LinkedAt = at
            }).ToList()
        });
        await context.SaveChangesAsync();
    }

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
    IHomePaycheckReader? upcoming = null,
    IHomeAttentionReader? attention = null,
    ICommitmentChangeReadService? commitmentChanges = null) : FinancialApiTestApplication
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
            services.RemoveAll<IHomePaycheckReader>();
            services.AddSingleton(upcoming);
        }
        if (attention is not null)
        {
            services.RemoveAll<IHomeAttentionReader>();
            services.AddSingleton<IHomeAttentionReader>(attention);
        }
        if (commitmentChanges is not null)
        {
            services.RemoveAll<ICommitmentChangeReadService>();
            services.AddSingleton(commitmentChanges);
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

internal sealed class ThrowingAttentionReader(Exception exception) : IHomeAttentionReader
{
    public Task<HomeAttentionSectionResponse> ReadAsync(
        string ownerId,
        DateOnly evaluatedOn,
        DateOnly activityThroughDate,
        CancellationToken cancellationToken) =>
        Task.FromException<HomeAttentionSectionResponse>(exception);
}

internal sealed class RecordingAttentionReader : IHomeAttentionReader
{
    public bool Called { get; private set; }

    public Task<HomeAttentionSectionResponse> ReadAsync(
        string ownerId,
        DateOnly evaluatedOn,
        DateOnly activityThroughDate,
        CancellationToken cancellationToken)
    {
        Called = true;
        return Task.FromResult(new HomeAttentionSectionResponse(
            new HomeSectionAvailabilityResponse("available", null),
            ["commitment_change_review"], [], [],
            new Dictionary<string, HomeSectionAvailabilityResponse>
            {
                ["commitment_change_review"] = new("available", null),
                ["budget_attention"] = new("available", null)
            },
            evaluatedOn));
    }
}

internal sealed class ThrowingCommitmentChangeReadService(Exception exception) : ICommitmentChangeReadService
{
    public Task<CommitmentChangesResponse> EvaluateChangesAsync(
        string ownerId,
        DateOnly evaluatedOn,
        CancellationToken cancellationToken) =>
        Task.FromException<CommitmentChangesResponse>(exception);
}

internal sealed class ThrowingUpcomingReader(Exception exception) : IHomePaycheckReader
{
    public Task<HomePaycheckReadResult> ReadAsync(
        string ownerId,
        DateOnly evaluatedOn,
        CancellationToken cancellationToken) =>
        Task.FromException<HomePaycheckReadResult>(exception);
}

internal sealed class RecordingUpcomingReader : IHomePaycheckReader
{
    public bool Called { get; private set; }

    public Task<HomePaycheckReadResult> ReadAsync(
        string ownerId,
        DateOnly evaluatedOn,
        CancellationToken cancellationToken)
    {
        Called = true;
        return Task.FromResult(new HomePaycheckReadResult(
            new HomeUpcomingSectionResponse(
                new HomeSectionAvailabilityResponse("available", null),
                new HomeUpcomingHorizonResponse(evaluatedOn, evaluatedOn.AddDays(13)),
                []),
            new HomePaycheckAttentionSectionResponse(
                new HomeSectionAvailabilityResponse("available", null), evaluatedOn, [])));
    }
}

internal sealed class UpcomingUnavailableAttentionAvailableReader : IHomePaycheckReader
{
    public Task<HomePaycheckReadResult> ReadAsync(
        string ownerId,
        DateOnly evaluatedOn,
        CancellationToken cancellationToken) => Task.FromResult(new HomePaycheckReadResult(
        new HomeUpcomingSectionResponse(
            new HomeSectionAvailabilityResponse("unavailable", "source_unavailable"),
            new HomeUpcomingHorizonResponse(evaluatedOn, evaluatedOn.AddDays(13)),
            null),
        new HomePaycheckAttentionSectionResponse(
            new HomeSectionAvailabilityResponse("available", null), evaluatedOn, [])));
}

internal sealed class SyntheticDbException : DbException;
