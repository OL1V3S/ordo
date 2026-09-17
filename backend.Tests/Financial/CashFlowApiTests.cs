using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BudgetPlanner.Analytics;
using BudgetPlanner.Contracts.Analytics;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using BudgetPlanner.Paychecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

[Collection("Environment variable tests")]
public sealed class CashFlowApiTests
{
    private const string Route = "/api/analytics/cash-flow?month=2026-09&throughDate=2026-09-10";

    [Fact]
    public async Task Endpoint_requires_authentication()
    {
        await using var app = new FinancialApiTestApplication();
        using var client = app.CreateTestClient();
        using var response = await client.GetAsync(Route);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("")]
    [InlineData("?month=2026-09")]
    [InlineData("?throughDate=2026-09-10")]
    [InlineData("?month=2026-10&throughDate=2026-09-10")]
    [InlineData("?month=2026-09&throughDate=2026-09-10T00:00:00Z")]
    [InlineData("?month=PRIVATE_FINANCIAL_INPUT&throughDate=2026-09-10")]
    public async Task Invalid_filters_return_a_stable_privacy_safe_problem(string query)
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("cashflow-validation@example.com");
        using var response = await owner.Client.GetAsync($"/api/analytics/cash-flow{query}");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("cash_flow_period_invalid", body.GetProperty("code").GetString());
        Assert.DoesNotContain("PRIVATE_FINANCIAL_INPUT", body.GetRawText());
    }

    [Fact]
    public async Task Explicit_response_has_exact_strings_calendar_dates_empty_buckets_and_no_private_fields()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("cashflow-response@example.com");
        await app.SeedInflowAsync(owner.Id, "PRIVATE SAVED DEPOSIT", 9999999999999999.99m, new(2026, 9, 1));
        await app.SeedExpenseAsync(owner.Id, "PRIVATE EXPENSE", 0.01m, new(2026, 9, 10), "food");
        using var response = await owner.Client.GetAsync(Route);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(["availableMonths", "categories", "from", "month", "months", "selected", "throughDate", "to"],
            body.EnumerateObject().Select(value => value.Name).Order(StringComparer.Ordinal));
        Assert.Equal("2026-09-01", body.GetProperty("from").GetString());
        Assert.Equal("2026-09-10", body.GetProperty("to").GetString());
        Assert.Equal("2026-09-10", body.GetProperty("throughDate").GetString());
        var selected = body.GetProperty("selected");
        Assert.Equal("999999999999999999", selected.GetProperty("cashInMinor").GetString());
        Assert.Equal("999999999999999998", selected.GetProperty("netMinor").GetString());
        Assert.Equal("0", selected.GetProperty("paycheckCashInMinor").GetString());
        Assert.Equal(6, body.GetProperty("months").GetArrayLength());
        Assert.Equal("1", body.GetProperty("categories")[0].GetProperty("amountMinor").GetString());
        Assert.DoesNotContain("PRIVATE", body.GetRawText());
        Assert.DoesNotContain(owner.Id, body.GetRawText());
        Assert.DoesNotContain("projection", body.GetRawText(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Owners_cutoffs_and_month_discovery_apply_to_every_source_and_membership_side()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("cashflow-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("cashflow-foreign@example.com");
        var linked = await app.SeedInflowAsync(owner.Id, amount: 100m, date: new(2026, 9, 1));
        var unlinked = await app.SeedInflowAsync(owner.Id, amount: 25m, date: new(2026, 9, 10));
        var foreign = await app.SeedInflowAsync(other.Id, "FOREIGN PRIVATE", 999m, new(2026, 9, 1));
        await app.SeedInflowAsync(owner.Id, amount: 900m, date: new(2026, 9, 11));
        await app.SeedInflowAsync(owner.Id, amount: 1m, date: new(2020, 2, 1));
        await app.SeedInflowAsync(other.Id, amount: 1m, date: new(2019, 3, 1));
        await app.SeedExpenseAsync(owner.Id, amount: 30m, date: new(2026, 9, 10));
        await app.SeedExpenseAsync(owner.Id, amount: 500m, date: new(2026, 9, 11));
        await app.SeedExpenseAsync(other.Id, "FOREIGN EXPENSE", 700m, new(2026, 9, 1), "foreign category");
        await app.SeedExpenseAsync(owner.Id, amount: 1m, date: new(2021, 4, 1));
        await LinkAsync(app, owner.Id, [linked], PaycheckLifecycle.Ended);

        // InMemory deliberately permits malformed links so each ownership filter
        // is exercised independently of PostgreSQL's composite foreign keys.
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            var foreignProfile = Profile(other.Id, PaycheckLifecycle.Active);
            var ownedProfile = Profile(owner.Id, PaycheckLifecycle.Active);
            db.PaycheckProfiles.AddRange(foreignProfile, ownedProfile);
            db.PaycheckOccurrences.AddRange(
                Link(owner.Id, foreignProfile.Id, unlinked),
                Link(other.Id, ownedProfile.Id, unlinked),
                Link(owner.Id, ownedProfile.Id, foreign));
            await db.SaveChangesAsync();
        }

        var result = await ReadAsync(owner.Client, Route + $"&ownerId={other.Id}");
        Assert.Equal("12500", result.Selected.CashInMinor);
        Assert.Equal("10000", result.Selected.PaycheckCashInMinor);
        Assert.Equal("2500", result.Selected.OtherCashInMinor);
        Assert.Equal("3000", result.Selected.SpentMinor);
        Assert.Equal(1, result.Selected.PaycheckProfileCount);
        Assert.Equal(["2026-09", "2021-04", "2020-02"], result.AvailableMonths);
        Assert.Equal("food", Assert.Single(result.Categories).Category);
    }

    [Fact]
    public async Task All_lifecycles_pool_observed_evidence_while_manual_profiles_add_no_money()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("cashflow-lifecycles@example.com");
        foreach (var state in Enum.GetValues<PaycheckLifecycle>())
        {
            var inflow = await app.SeedInflowAsync(owner.Id, amount: 100m, date: new(2026, 9, 1));
            await LinkAsync(app, owner.Id, [inflow], state);
        }
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            var expectation = Profile(owner.Id, PaycheckLifecycle.Active);
            expectation.ExpectedAmount = 9999999999999999.99m;
            db.PaycheckProfiles.Add(expectation);
            await db.SaveChangesAsync();
        }

        var result = await ReadAsync(owner.Client);
        Assert.Equal("30000", result.Selected.CashInMinor);
        Assert.Equal("30000", result.Selected.PaycheckCashInMinor);
        Assert.Equal("0", result.Selected.OtherCashInMinor);
        Assert.Equal(3, result.Selected.InflowCount);
        Assert.Equal(3, result.Selected.PaycheckProfileCount);
    }

    [Fact]
    public async Task Saved_manual_duplicates_and_imports_count_but_unsaved_preview_rows_do_not()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("cashflow-sources@example.com");
        foreach (var unused in new[] { 1, 2 })
        {
            using var created = await owner.Client.PostAsJsonAsync("/api/inflows", new
            {
                description = "Same manual refund", amount = 20m, date = "2026-09-01"
            });
            Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        }
        var imported = await app.SeedInflowAsync(owner.Id, "Imported transfer", 30m, new(2026, 9, 2));
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            db.ImportPreviewBatches.Add(new ImportPreviewBatch
            {
                Id = Guid.NewGuid(), OwnerId = owner.Id, SourceType = "sunflower_pdf", ParserRuleVersion = "cashflow-tests",
                DocumentDigest = new byte[32], CreatedAt = DateTime.UtcNow, ExpiresAt = DateTime.UtcNow.AddDays(1),
                Lifecycle = ImportPreviewLifecycle.Confirmed, ConfirmedAt = DateTime.UtcNow,
                InflowProvenance = [new() { OwnerId = owner.Id, AccountInflowId = imported.Id,
                    AccountInflowOwnerId = owner.Id, SourceRowOrdinal = 1 }],
                Rows = [new() { Id = Guid.NewGuid(), SourceRowOrdinal = 2, Amount = 99999m, PostedDate = new(2026, 9, 1) }]
            });
            await db.SaveChangesAsync();
        }
        await app.SeedExpenseAsync(owner.Id, amount: 10m, date: new(2026, 9, 1), category: "original purchase");

        var result = await ReadAsync(owner.Client);
        Assert.Equal("7000", result.Selected.CashInMinor);
        Assert.Equal("7000", result.Selected.OtherCashInMinor);
        Assert.Equal("0", result.Selected.PaycheckCashInMinor);
        Assert.Equal("1000", result.Selected.SpentMinor);
        Assert.Equal("6000", result.Selected.NetMinor);
        Assert.Equal(3, result.Selected.InflowCount);
    }

    [Fact]
    public async Task Confirmation_changes_only_composition_and_dismissal_or_expectations_do_not_change_cash_totals()
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("cashflow-confirmation@example.com");
        foreach (var month in new[] { 7, 8, 9 })
            await app.SeedInflowAsync(owner.Id, "Monthly observed pay", 1000m, new(2026, month, 10));
        await app.SeedExpenseAsync(owner.Id, amount: 75m, date: new(2026, 9, 10));
        var candidates = await owner.Client.GetFromJsonAsync<JsonElement>("/api/paycheck-candidates");
        var candidate = Assert.Single(candidates.GetProperty("candidates").EnumerateArray());
        var decision = new
        {
            algorithmVersion = candidate.GetProperty("algorithmVersion").GetString(),
            cadence = candidate.GetProperty("schedule").GetProperty("cadence").GetString(),
            fingerprint = candidate.GetProperty("fingerprint").GetString()
        };
        var before = await ReadAsync(owner.Client);
        Assert.Equal("100000", before.Selected.OtherCashInMinor);
        using var dismissed = await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/dismiss", decision);
        dismissed.EnsureSuccessStatusCode();
        Assert.Equal(before.Selected, (await ReadAsync(owner.Client)).Selected);
        using var reconsidered = await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/reconsider", decision);
        reconsidered.EnsureSuccessStatusCode();
        using var confirmed = await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", new
        {
            decision.algorithmVersion, decision.fingerprint, displayName = "Confirmed stream",
            schedule = candidate.GetProperty("schedule"), windowBeforeDays = 0, windowAfterDays = 0,
            amount = new { mode = "fixed", fixedAmount = 9999m }
        });
        Assert.Equal(HttpStatusCode.Created, confirmed.StatusCode);
        var profileId = (await confirmed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("paycheck").GetProperty("id").GetGuid();
        var after = await ReadAsync(owner.Client);
        Assert.Equal(before.Selected.CashInMinor, after.Selected.CashInMinor);
        Assert.Equal(before.Selected.NetMinor, after.Selected.NetMinor);
        Assert.Equal(before.Selected.SpentMinor, after.Selected.SpentMinor);
        Assert.Equal("100000", after.Selected.PaycheckCashInMinor);
        Assert.Equal("0", after.Selected.OtherCashInMinor);

        using var updated = await owner.Client.PutAsJsonAsync($"/api/paychecks/{profileId}", new
        {
            displayName = "Changed expectation", windowBeforeDays = 1, windowAfterDays = 1,
            amount = new { mode = "fixed", fixedAmount = 25000m }
        });
        updated.EnsureSuccessStatusCode();
        using var ended = await owner.Client.PatchAsJsonAsync($"/api/paychecks/{profileId}/lifecycle", new { lifecycle = "ended" });
        ended.EnsureSuccessStatusCode();
        Assert.Equal(after.Selected, (await ReadAsync(owner.Client)).Selected);
        await app.SeedInflowAsync(owner.Id, "Monthly observed pay", 1000m, new(2026, 9, 10));
        var later = await ReadAsync(owner.Client);
        Assert.Equal("200000", later.Selected.CashInMinor);
        Assert.Equal("100000", later.Selected.PaycheckCashInMinor);
        Assert.Equal("100000", later.Selected.OtherCashInMinor);
    }

    [Fact]
    public async Task Recording_and_unlinking_receipts_changes_cash_only_through_the_actual_inflow()
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("cashflow-receipts@example.com");
        var existing = await app.SeedInflowAsync(owner.Id, "Existing cash", 100m, new(2026, 9, 1));
        using var creation = await owner.Client.PostAsJsonAsync("/api/paychecks", new
        {
            displayName = "Synthetic payroll",
            schedule = new
            {
                cadence = "monthly", referenceAnchorDate = (string?)null,
                firstMonthAnchor = new { kind = "day_of_month", day = 10 }, secondMonthAnchor = (object?)null
            },
            windowBeforeDays = 1, windowAfterDays = 1,
            amount = new { mode = "fixed", fixedAmount = 500m, minimumAmount = (decimal?)null, maximumAmount = (decimal?)null }
        });
        creation.EnsureSuccessStatusCode();
        var profileId = (await creation.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var before = await ReadAsync(owner.Client);
        Assert.Equal("10000", before.Selected.CashInMinor);
        Assert.Equal("0", before.Selected.PaycheckCashInMinor);
        Assert.Equal("10000", before.Selected.OtherCashInMinor);

        using var linked = await owner.Client.PostAsJsonAsync($"/api/paychecks/{profileId}/receipts", new
        {
            slotAnchor = "2026-09-10", existingInflowId = existing.Id, newInflow = (object?)null
        });
        Assert.Equal(HttpStatusCode.Created, linked.StatusCode);
        var afterLink = await ReadAsync(owner.Client);
        Assert.Equal(before.Selected.CashInMinor, afterLink.Selected.CashInMinor);
        Assert.Equal(before.Selected.NetMinor, afterLink.Selected.NetMinor);
        Assert.Equal("10000", afterLink.Selected.PaycheckCashInMinor);
        Assert.Equal("0", afterLink.Selected.OtherCashInMinor);

        using var removed = await owner.Client.DeleteAsync($"/api/paychecks/{profileId}/receipts/{existing.Id}");
        removed.EnsureSuccessStatusCode();
        Assert.Equal(before.Selected, (await ReadAsync(owner.Client)).Selected);

        using var recorded = await owner.Client.PostAsJsonAsync($"/api/paychecks/{profileId}/receipts", new
        {
            slotAnchor = "2026-09-10", existingInflowId = (int?)null,
            newInflow = new { description = "Actual cash", amount = 75m, date = "2026-09-10" }
        });
        Assert.Equal(HttpStatusCode.Created, recorded.StatusCode);
        var afterCreate = await ReadAsync(owner.Client);
        Assert.Equal("17500", afterCreate.Selected.CashInMinor);
        Assert.Equal("7500", afterCreate.Selected.PaycheckCashInMinor);
        Assert.Equal("10000", afterCreate.Selected.OtherCashInMinor);
        Assert.Equal("17500", afterCreate.Selected.NetMinor);
    }

    [Fact]
    public async Task Inflow_edits_and_deletion_use_current_dates_amounts_and_surviving_links_without_mutating_on_read()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("cashflow-edits@example.com");
        var inflow = await app.SeedInflowAsync(owner.Id, "Original", 100m, new(2026, 8, 31));
        await LinkAsync(app, owner.Id, [inflow], PaycheckLifecycle.Paused);
        using var edited = await owner.Client.PutAsJsonAsync($"/api/inflows/{inflow.Id}", new
        {
            id = inflow.Id, description = "Edited observation", amount = 110.01m, date = "2026-09-01"
        });
        edited.EnsureSuccessStatusCode();
        var result = await ReadAsync(owner.Client);
        Assert.Equal("11001", result.Selected.CashInMinor);
        Assert.Equal("11001", result.Selected.PaycheckCashInMinor);
        Assert.Equal(1, result.Selected.EditedPaycheckInflowCount);
        Assert.Equal("0", result.Months.Single(value => value.Month == "2026-08").CashInMinor);

        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            Assert.True(CashFlowPeriod.TryCreate("2026-09", "2026-09-10", out var period));
            await new CashFlowService(db).GetAsync(owner.Id, period!, default);
            Assert.Empty(db.ChangeTracker.Entries());
            // InMemory does not enforce relational cascade without loading the dependent.
            // PostgreSQL coverage proves the public delete cascade separately.
            var persisted = await db.AccountInflows.SingleAsync(value => value.Id == inflow.Id);
            await db.PaycheckOccurrences.ToListAsync();
            db.AccountInflows.Remove(persisted);
            await db.SaveChangesAsync();
        }
        var deleted = await ReadAsync(owner.Client);
        Assert.Equal("0", deleted.Selected.CashInMinor);
        Assert.Equal("0", deleted.Selected.PaycheckCashInMinor);
        Assert.Equal(0, deleted.Selected.EditedPaycheckInflowCount);
    }

    private static async Task<CashFlowResponse> ReadAsync(HttpClient client, string route = Route) =>
        (await client.GetFromJsonAsync<CashFlowResponse>(route))!;

    private static async Task LinkAsync(
        FinancialApiTestApplicationBase app, string ownerId, IReadOnlyList<AccountInflow> inflows, PaycheckLifecycle lifecycle)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var profile = Profile(ownerId, lifecycle);
        db.PaycheckProfiles.Add(profile);
        db.PaycheckOccurrences.AddRange(inflows.Select(value => Link(ownerId, profile.Id, value)));
        await db.SaveChangesAsync();
    }

    private static PaycheckProfile Profile(string ownerId, PaycheckLifecycle lifecycle) => new()
    {
        Id = Guid.NewGuid(), OwnerId = ownerId, DisplayName = "Synthetic stream", Lifecycle = lifecycle,
        Cadence = PaycheckCadence.Monthly, FirstMonthAnchor = 1, AmountMode = PaycheckAmountMode.Fixed,
        ExpectedAmount = 500m, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow
    };

    private static PaycheckOccurrence Link(string ownerId, Guid profileId, AccountInflow inflow) => new()
    {
        PaycheckProfileId = profileId, AccountInflowId = inflow.Id, OwnerId = ownerId,
        Kind = PaycheckOccurrenceKind.ConfirmationEvidence,
        EvidenceRevisionAtAssignment = inflow.PaycheckEvidenceRevision,
        SlotAnchor = inflow.Date, TimingOffsetDays = 0, LinkedAt = DateTime.UtcNow
    };
}
