using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

[Collection("Environment variable tests")]
public sealed class CommitmentsApiTests
{
    [Fact]
    public async Task Endpoints_require_authentication()
    {
        await using var app = new FinancialApiTestApplication();
        using var client = app.CreateTestClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/commitment-candidates")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/commitments")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/commitment-changes")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/commitment-candidates/dismiss", new { fingerprint = new string('0', 64) })).StatusCode);
    }

    [Fact]
    public async Task Change_read_is_self_contained_owner_scoped_explainable_and_deterministic()
    {
        var clock = new FixedCommitmentTimeProvider(new DateTimeOffset(2026, 10, 29, 18, 0, 0, TimeSpan.Zero));
        await using var app = new ClockedCommitmentFinancialApiTestApplication(clock);
        using var owner = await app.CreateAuthenticatedUserAsync("change-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("change-other@example.com");

        var confirmation = new List<Expense>();
        foreach (var date in new[] { new DateOnly(2026, 5, 10), new DateOnly(2026, 6, 10), new DateOnly(2026, 7, 10) })
            confirmation.Add(await app.SeedExpenseAsync(owner.Id, "  Membership  ", 10m, date, " Bills "));
        var observations = new List<Expense>();
        foreach (var date in new[] { new DateOnly(2026, 8, 12), new DateOnly(2026, 9, 12), new DateOnly(2026, 10, 12) })
            observations.Add(await app.SeedExpenseAsync(owner.Id, "membership", 12m, date, "bills"));
        await SeedImportedProvenanceAsync(app, owner.Id, observations[0].Id);
        await SeedImportedProvenanceAsync(app, other.Id, observations[1].Id);
        var changedId = await SeedCommitmentAsync(
            app, owner.Id, confirmation, name: "Edited display name", category: "custom display");

        var missingConfirmation = new List<Expense>();
        foreach (var date in new[] { new DateOnly(2026, 5, 20), new DateOnly(2026, 6, 20), new DateOnly(2026, 7, 20) })
            missingConfirmation.Add(await app.SeedExpenseAsync(owner.Id, "insurance", 25m, date, "bills"));
        var missingId = await SeedCommitmentAsync(
            app, owner.Id, missingConfirmation, name: "Insurance", expectedDay: 20, expectedAmount: 25m);

        var otherEvidence = new[]
        {
            await app.SeedExpenseAsync(other.Id, "FOREIGN SECRET", 999m, new DateOnly(2026, 6, 10), "private"),
            await app.SeedExpenseAsync(other.Id, "FOREIGN SECRET", 999m, new DateOnly(2026, 7, 10), "private")
        };
        await SeedCommitmentAsync(app, other.Id, otherEvidence, name: "FOREIGN COMMITMENT", category: "private");

        var first = await owner.Client.GetFromJsonAsync<JsonElement>("/api/commitment-changes");
        var second = await owner.Client.GetFromJsonAsync<JsonElement>("/api/commitment-changes");

        Assert.Equal("2026-10-29", first.GetProperty("evaluatedOn").GetString());
        var changes = first.GetProperty("changes").EnumerateArray().ToDictionary(
            value => value.GetProperty("commitment").GetProperty("id").GetGuid());
        Assert.Equal(2, changes.Count);
        var changed = changes[changedId];
        var snapshot = changed.GetProperty("commitment");
        Assert.Equal("Edited display name", snapshot.GetProperty("name").GetString());
        Assert.Equal("custom display", snapshot.GetProperty("category").GetString());
        Assert.Equal("active", snapshot.GetProperty("lifecycle").GetString());
        Assert.Equal("monthly", snapshot.GetProperty("cadence").GetString());
        Assert.Equal("dayofmonth", snapshot.GetProperty("timingKind").GetString());
        Assert.Equal(10, snapshot.GetProperty("expectedDay").GetInt32());
        Assert.Equal("fixed", snapshot.GetProperty("amountMode").GetString());
        Assert.Equal(10m, snapshot.GetProperty("expectedAmount").GetDecimal());
        Assert.Equal(JsonValueKind.Null, snapshot.GetProperty("expectedDayOfWeek").ValueKind);
        Assert.Equal(JsonValueKind.Null, snapshot.GetProperty("expectedMonth").ValueKind);
        Assert.Equal(0, snapshot.GetProperty("windowBeforeDays").GetInt32());
        Assert.Equal(0, snapshot.GetProperty("windowAfterDays").GetInt32());
        Assert.Equal(JsonValueKind.Null, snapshot.GetProperty("expectedMinimumAmount").ValueKind);
        Assert.Equal(JsonValueKind.Null, snapshot.GetProperty("expectedMaximumAmount").ValueKind);
        Assert.Equal(
            new[]
            {
                "amountMode", "cadence", "category", "expectedAmount", "expectedDay", "expectedDayOfWeek",
                "expectedMaximumAmount", "expectedMinimumAmount", "expectedMonth", "id", "lifecycle", "name",
                "timingKind", "windowAfterDays", "windowBeforeDays"
            },
            snapshot.EnumerateObject().Select(value => value.Name).OrderBy(value => value));
        Assert.False(snapshot.TryGetProperty("updatedAt", out _));
        Assert.Equal("commitment-change-v1", changed.GetProperty("algorithmVersion").GetString());
        Assert.True(changed.GetProperty("isMatchingAvailable").GetBoolean());
        Assert.Equal(JsonValueKind.Null, changed.GetProperty("unavailableReason").ValueKind);
        Assert.Equal("membership", changed.GetProperty("normalizedDescription").GetString());
        Assert.Equal("bills", changed.GetProperty("canonicalCategory").GetString());

        var emitted = changed.GetProperty("observations").EnumerateArray().ToArray();
        Assert.Equal(3, emitted.Length);
        Assert.Equal(observations[0].Id, emitted[0].GetProperty("expenseId").GetInt32());
        Assert.Equal("2026-08-12", emitted[0].GetProperty("date").GetString());
        Assert.Equal(12m, emitted[0].GetProperty("amount").GetDecimal());
        Assert.Equal("membership", emitted[0].GetProperty("description").GetString());
        Assert.Equal("bills", emitted[0].GetProperty("category").GetString());
        Assert.Equal("sunflower_pdf", emitted[0].GetProperty("source").GetString());
        Assert.Equal("2026-08-10", emitted[0].GetProperty("slotAnchor").GetString());
        Assert.Equal(2, emitted[0].GetProperty("timingOffsetDays").GetInt32());
        Assert.False(emitted[0].GetProperty("isWithinTimingWindow").GetBoolean());
        Assert.All(emitted.Skip(1), value => Assert.Equal("manual", value.GetProperty("source").GetString()));
        var amount = changed.GetProperty("amount");
        Assert.Equal("proposed_change", amount.GetProperty("state").GetString());
        Assert.Equal("fixed", amount.GetProperty("proposedMode").GetString());
        Assert.Equal(12m, amount.GetProperty("proposedAmount").GetDecimal());
        Assert.Equal(JsonValueKind.Null, amount.GetProperty("proposedMinimumAmount").ValueKind);
        Assert.Equal(JsonValueKind.Null, amount.GetProperty("proposedMaximumAmount").ValueKind);
        Assert.Equal(12m, amount.GetProperty("observedMedianAmount").GetDecimal());
        Assert.Equal(64, amount.GetProperty("fingerprint").GetString()!.Length);
        Assert.Equal(observations.Select(value => value.Id),
            amount.GetProperty("evidenceExpenseIds").EnumerateArray().Select(value => value.GetInt32()));
        var timing = changed.GetProperty("timing");
        Assert.Equal("proposed_change", timing.GetProperty("state").GetString());
        Assert.Equal("dayofmonth", timing.GetProperty("proposedTimingKind").GetString());
        Assert.Equal(12, timing.GetProperty("proposedDay").GetInt32());
        Assert.Equal(0, timing.GetProperty("proposedWindowBeforeDays").GetInt32());
        Assert.Equal(0, timing.GetProperty("proposedWindowAfterDays").GetInt32());
        Assert.Equal(64, timing.GetProperty("fingerprint").GetString()!.Length);
        Assert.Equal(observations.Select(value => value.Id),
            timing.GetProperty("evidenceExpenseIds").EnumerateArray().Select(value => value.GetInt32()));

        var missing = changes[missingId].GetProperty("missing");
        Assert.Equal("possibly_ended", missing.GetProperty("state").GetString());
        Assert.Equal(3, missing.GetProperty("missedSlotAnchors").GetArrayLength());
        Assert.Equal(
            new[] { "2026-08-20", "2026-09-20", "2026-10-20" },
            missing.GetProperty("missedSlotAnchors").EnumerateArray().Select(value => value.GetString()));
        Assert.Equal(64, missing.GetProperty("fingerprint").GetString()!.Length);
        Assert.Equal(
            amount.GetProperty("fingerprint").GetString(),
            second.GetProperty("changes").EnumerateArray()
                .Single(value => value.GetProperty("commitment").GetProperty("id").GetGuid() == changedId)
                .GetProperty("amount").GetProperty("fingerprint").GetString());
        Assert.DoesNotContain("FOREIGN", first.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("private", first.ToString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Change_read_returns_all_matching_unavailable_reasons_as_data()
    {
        var clock = new FixedCommitmentTimeProvider(new DateTimeOffset(2026, 8, 29, 12, 0, 0, TimeSpan.Zero));
        await using var app = new ClockedCommitmentFinancialApiTestApplication(clock);
        using var owner = await app.CreateAuthenticatedUserAsync("unavailable@example.com");

        var one = await app.SeedExpenseAsync(owner.Id, "single", 10m, new DateOnly(2026, 7, 10), "bills");
        var insufficientId = await SeedCommitmentAsync(app, owner.Id, [one], name: "Insufficient");
        var inconsistentId = await SeedCommitmentAsync(app, owner.Id,
            [
                await app.SeedExpenseAsync(owner.Id, "first", 10m, new DateOnly(2026, 6, 10), "bills"),
                await app.SeedExpenseAsync(owner.Id, "second", 10m, new DateOnly(2026, 7, 10), "bills")
            ], name: "Inconsistent");
        var sharedAId = await SeedCommitmentAsync(app, owner.Id,
            [
                await app.SeedExpenseAsync(owner.Id, "shared", 10m, new DateOnly(2026, 4, 10), "bills"),
                await app.SeedExpenseAsync(owner.Id, "shared", 10m, new DateOnly(2026, 5, 10), "bills")
            ], name: "Shared A");
        var sharedBId = await SeedCommitmentAsync(app, owner.Id,
            [
                await app.SeedExpenseAsync(owner.Id, " SHARED ", 10m, new DateOnly(2026, 6, 10), " BILLS "),
                await app.SeedExpenseAsync(owner.Id, "shared", 10m, new DateOnly(2026, 7, 10), "bills")
            ], name: "Shared B");

        var body = await owner.Client.GetFromJsonAsync<JsonElement>("/api/commitment-changes");
        var changes = body.GetProperty("changes").EnumerateArray().ToDictionary(
            value => value.GetProperty("commitment").GetProperty("id").GetGuid());

        AssertUnavailable(changes[insufficientId], "insufficient_confirmation_evidence");
        AssertUnavailable(changes[inconsistentId], "inconsistent_confirmation_identity");
        AssertUnavailable(changes[sharedAId], "shared_active_identity");
        AssertUnavailable(changes[sharedBId], "shared_active_identity");
    }

    [Fact]
    public async Task Change_read_withholds_inactive_commitments_and_excludes_their_confirmation_expenses()
    {
        var clock = new FixedCommitmentTimeProvider(new DateTimeOffset(2026, 8, 29, 12, 0, 0, TimeSpan.Zero));
        await using var app = new ClockedCommitmentFinancialApiTestApplication(clock);
        using var owner = await app.CreateAuthenticatedUserAsync("lifecycle-change@example.com");

        var activeId = await SeedCommitmentAsync(app, owner.Id,
            [
                await app.SeedExpenseAsync(owner.Id, "shared", 10m, new DateOnly(2026, 4, 10), "bills"),
                await app.SeedExpenseAsync(owner.Id, "shared", 10m, new DateOnly(2026, 5, 10), "bills")
            ], name: "Active");
        await SeedCommitmentAsync(app, owner.Id,
            [
                await app.SeedExpenseAsync(owner.Id, "shared", 10m, new DateOnly(2026, 6, 10), "bills"),
                await app.SeedExpenseAsync(owner.Id, "shared", 10m, new DateOnly(2026, 7, 10), "bills")
            ], name: "Paused", lifecycle: CommitmentLifecycle.Paused);
        await SeedCommitmentAsync(app, owner.Id,
            [
                await app.SeedExpenseAsync(owner.Id, "shared", 10m, new DateOnly(2026, 3, 10), "bills"),
                await app.SeedExpenseAsync(owner.Id, "shared", 10m, new DateOnly(2026, 8, 10), "bills")
            ], name: "Ended", lifecycle: CommitmentLifecycle.Ended);

        var body = await owner.Client.GetFromJsonAsync<JsonElement>("/api/commitment-changes");
        var change = Assert.Single(body.GetProperty("changes").EnumerateArray());

        Assert.Equal(activeId, change.GetProperty("commitment").GetProperty("id").GetGuid());
        Assert.True(change.GetProperty("isMatchingAvailable").GetBoolean());
        Assert.Empty(change.GetProperty("observations").EnumerateArray());
    }

    [Fact]
    public async Task Change_read_fails_closed_for_foreign_linked_confirmation_evidence()
    {
        var clock = new FixedCommitmentTimeProvider(new DateTimeOffset(2026, 8, 29, 12, 0, 0, TimeSpan.Zero));
        await using var app = new ClockedCommitmentFinancialApiTestApplication(clock);
        using var owner = await app.CreateAuthenticatedUserAsync("foreign-link-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("foreign-link-other@example.com");
        var foreign = new[]
        {
            await app.SeedExpenseAsync(other.Id, "FOREIGN DESCRIPTION", 50m, new DateOnly(2026, 6, 10), "SECRET CATEGORY"),
            await app.SeedExpenseAsync(other.Id, "FOREIGN DESCRIPTION", 50m, new DateOnly(2026, 7, 10), "SECRET CATEGORY")
        };
        await SeedCommitmentAsync(app, owner.Id, foreign, name: "Owner display");

        var body = await owner.Client.GetFromJsonAsync<JsonElement>("/api/commitment-changes");
        var change = Assert.Single(body.GetProperty("changes").EnumerateArray());

        AssertUnavailable(change, "insufficient_confirmation_evidence");
        Assert.DoesNotContain("FOREIGN DESCRIPTION", body.ToString(), StringComparison.Ordinal);
        Assert.DoesNotContain("SECRET CATEGORY", body.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Change_read_recomputes_after_expense_edit_and_delete_without_persisting_derived_state()
    {
        var clock = new FixedCommitmentTimeProvider(new DateTimeOffset(2026, 8, 29, 12, 0, 0, TimeSpan.Zero));
        await using var app = new ClockedCommitmentFinancialApiTestApplication(clock);
        using var owner = await app.CreateAuthenticatedUserAsync("change-recompute@example.com");
        var confirmation = new[]
        {
            await app.SeedExpenseAsync(owner.Id, "membership", 10m, new DateOnly(2026, 6, 10), "bills"),
            await app.SeedExpenseAsync(owner.Id, "membership", 10m, new DateOnly(2026, 7, 10), "bills")
        };
        await SeedCommitmentAsync(app, owner.Id, confirmation);
        var observed = await app.SeedExpenseAsync(owner.Id, "membership", 12m, new DateOnly(2026, 8, 10), "bills");

        var first = Assert.Single((await owner.Client.GetFromJsonAsync<JsonElement>("/api/commitment-changes"))
            .GetProperty("changes").EnumerateArray());
        var firstFingerprint = first.GetProperty("amount").GetProperty("fingerprint").GetString();
        using var update = await owner.Client.PutAsJsonAsync($"/api/expenses/{observed.Id}", new
        {
            id = observed.Id,
            description = observed.Description,
            amount = 13m,
            date = observed.Date.ToString("yyyy-MM-dd"),
            category = observed.Category
        });
        update.EnsureSuccessStatusCode();
        var edited = Assert.Single((await owner.Client.GetFromJsonAsync<JsonElement>("/api/commitment-changes"))
            .GetProperty("changes").EnumerateArray());
        Assert.NotEqual(firstFingerprint, edited.GetProperty("amount").GetProperty("fingerprint").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.DeleteAsync($"/api/expenses/{observed.Id}")).StatusCode);
        var deleted = Assert.Single((await owner.Client.GetFromJsonAsync<JsonElement>("/api/commitment-changes"))
            .GetProperty("changes").EnumerateArray());
        Assert.Empty(deleted.GetProperty("observations").EnumerateArray());
        Assert.Equal("within_expectation", deleted.GetProperty("amount").GetProperty("state").GetString());
        Assert.Equal(JsonValueKind.Null, deleted.GetProperty("amount").GetProperty("fingerprint").ValueKind);

        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        Assert.Equal(2, await context.CommitmentOccurrences.CountAsync());
    }

    [Fact]
    public async Task Change_read_without_active_commitments_returns_dated_empty_collection()
    {
        var clock = new FixedCommitmentTimeProvider(new DateTimeOffset(2026, 8, 29, 12, 0, 0, TimeSpan.Zero));
        await using var app = new ClockedCommitmentFinancialApiTestApplication(clock);
        using var owner = await app.CreateAuthenticatedUserAsync("empty-changes@example.com");

        var body = await owner.Client.GetFromJsonAsync<JsonElement>("/api/commitment-changes");

        Assert.Equal("2026-08-29", body.GetProperty("evaluatedOn").GetString());
        Assert.Empty(body.GetProperty("changes").EnumerateArray());
    }

    [Fact]
    public async Task Candidate_read_is_owner_scoped_explainable_and_deterministic()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("candidate-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("candidate-other@example.com");
        var dates = RecentMonthlyDates();
        var ownedExpenses = new List<BudgetPlanner.Models.Expense>();
        for (var index = 0; index < dates.Length; index++)
        {
            ownedExpenses.Add(await app.SeedExpenseAsync(
                owner.Id, "  Gym   Club ", 20m + index, dates[index], " Health "));
            await app.SeedExpenseAsync(other.Id, "hidden", 99m, dates[index], "bills");
        }
        using (var provenanceScope = app.Services.CreateScope())
        {
            var context = provenanceScope.ServiceProvider.GetRequiredService<BudgetContext>();
            var now = DateTime.UtcNow;
            context.ImportPreviewBatches.Add(new BudgetPlanner.Models.ImportPreviewBatch
            {
                Id = Guid.NewGuid(),
                OwnerId = owner.Id,
                SourceType = "sunflower_pdf",
                ParserRuleVersion = "test-v1",
                DocumentDigest = new byte[32],
                CreatedAt = now.AddHours(-1),
                ExpiresAt = now.AddHours(1),
                Lifecycle = BudgetPlanner.Models.ImportPreviewLifecycle.Confirmed,
                ConfirmedAt = now,
                Provenance =
                [
                    new BudgetPlanner.Models.ImportExpenseProvenance
                    {
                        SourceRowOrdinal = 1,
                        ExpenseId = ownedExpenses[0].Id
                    }
                ]
            });
            await context.SaveChangesAsync();
        }

        var first = await owner.Client.GetFromJsonAsync<JsonElement>("/api/commitment-candidates");
        var second = await owner.Client.GetFromJsonAsync<JsonElement>("/api/commitment-candidates");

        var candidate = Assert.Single(first.GetProperty("candidates").EnumerateArray());
        Assert.Empty(first.GetProperty("dismissedCandidates").EnumerateArray());
        Assert.Equal("monthly", candidate.GetProperty("cadence").GetString());
        Assert.Equal("health", candidate.GetProperty("category").GetString());
        Assert.Equal("variable", candidate.GetProperty("observedAmountMode").GetString());
        Assert.Equal(3, candidate.GetProperty("occurrenceCount").GetInt32());
        Assert.Equal("consecutive_calendar_months", candidate.GetProperty("evidenceRule").GetString());
        Assert.Equal(3, candidate.GetProperty("evidence").GetArrayLength());
        var evidenceRows = candidate.GetProperty("evidence").EnumerateArray().ToArray();
        Assert.Equal("sunflower_pdf", evidenceRows[0].GetProperty("source").GetString());
        Assert.All(evidenceRows.Skip(1), evidence =>
            Assert.Equal("manual", evidence.GetProperty("source").GetString()));
        Assert.All(evidenceRows, evidence =>
            Assert.False(evidence.TryGetProperty("commitmentEvidenceRevision", out _)));
        Assert.Equal(64, candidate.GetProperty("fingerprint").GetString()!.Length);
        Assert.Equal(
            candidate.GetProperty("fingerprint").GetString(),
            Assert.Single(second.GetProperty("candidates").EnumerateArray())
                .GetProperty("fingerprint").GetString());
        Assert.DoesNotContain("hidden", first.ToString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Dismiss_and_reconsider_are_reversible_and_idempotent()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("dismiss@example.com");
        await SeedMonthlyCandidateAsync(app, owner.Id);
        var fingerprint = await CandidateFingerprintAsync(owner.Client);

        Assert.Equal(HttpStatusCode.NoContent,
            (await owner.Client.PostAsJsonAsync("/api/commitment-candidates/dismiss", new { fingerprint })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await owner.Client.PostAsJsonAsync("/api/commitment-candidates/dismiss", new { fingerprint })).StatusCode);
        var dismissed = await owner.Client.GetFromJsonAsync<JsonElement>("/api/commitment-candidates");
        Assert.Empty(dismissed.GetProperty("candidates").EnumerateArray());
        Assert.Single(dismissed.GetProperty("dismissedCandidates").EnumerateArray());

        Assert.Equal(HttpStatusCode.NoContent,
            (await owner.Client.PostAsJsonAsync("/api/commitment-candidates/reconsider", new { fingerprint })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await owner.Client.PostAsJsonAsync("/api/commitment-candidates/reconsider", new { fingerprint })).StatusCode);
        var reconsidered = await owner.Client.GetFromJsonAsync<JsonElement>("/api/commitment-candidates");
        Assert.Single(reconsidered.GetProperty("candidates").EnumerateArray());
        Assert.Empty(reconsidered.GetProperty("dismissedCandidates").EnumerateArray());
    }

    [Fact]
    public async Task Material_expense_edit_invalidates_stale_candidate_and_dismissal()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("stale@example.com");
        var expenses = await SeedMonthlyCandidateAsync(app, owner.Id);
        var oldFingerprint = await CandidateFingerprintAsync(owner.Client);
        await owner.Client.PostAsJsonAsync("/api/commitment-candidates/dismiss", new { fingerprint = oldFingerprint });

        var edited = expenses[1];
        var update = await owner.Client.PutAsJsonAsync($"/api/expenses/{edited.Id}", new
        {
            id = edited.Id,
            description = "membership",
            amount = 12m,
            date = edited.Date.ToString("yyyy-MM-dd"),
            category = "bills"
        });
        Assert.Equal(HttpStatusCode.NoContent, update.StatusCode);

        var stale = await owner.Client.PostAsJsonAsync(
            "/api/commitment-candidates/reconsider",
            new { fingerprint = oldFingerprint });
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        var current = await owner.Client.GetFromJsonAsync<JsonElement>("/api/commitment-candidates");
        var newCandidate = Assert.Single(current.GetProperty("candidates").EnumerateArray());
        Assert.NotEqual(oldFingerprint, newCandidate.GetProperty("fingerprint").GetString());
        Assert.Empty(current.GetProperty("dismissedCandidates").EnumerateArray());
        using var scope = app.Services.CreateScope();
        Assert.Empty(await scope.ServiceProvider.GetRequiredService<BudgetContext>()
            .CommitmentCandidateDismissals.ToListAsync());
    }

    [Fact]
    public async Task Confirmation_is_server_resolved_persists_links_and_is_retry_safe()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("confirm@example.com");
        var expenses = await SeedMonthlyCandidateAsync(app, owner.Id);
        var fingerprint = await CandidateFingerprintAsync(owner.Client);
        var request = FixedConfirmation(fingerprint);

        var firstResponse = await owner.Client.PostAsJsonAsync("/api/commitment-candidates/confirm", request);
        var first = await firstResponse.Content.ReadFromJsonAsync<JsonElement>();
        var retryResponse = await owner.Client.PostAsJsonAsync("/api/commitment-candidates/confirm", request);
        var retry = await retryResponse.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Created, firstResponse.StatusCode);
        Assert.False(first.GetProperty("alreadyConfirmed").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, retryResponse.StatusCode);
        Assert.True(retry.GetProperty("alreadyConfirmed").GetBoolean());
        Assert.Equal(
            first.GetProperty("commitment").GetProperty("id").GetGuid(),
            retry.GetProperty("commitment").GetProperty("id").GetGuid());
        Assert.Equal(3, first.GetProperty("commitment").GetProperty("evidence").GetArrayLength());

        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        Assert.Single(await context.Commitments.ToListAsync());
        Assert.Equal(expenses.Count, await context.CommitmentOccurrences.CountAsync());
        Assert.Empty((await owner.Client.GetFromJsonAsync<JsonElement>("/api/commitment-candidates"))
            .GetProperty("candidates").EnumerateArray());
    }

    [Fact]
    public async Task Dismissed_or_stale_candidate_cannot_be_confirmed()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("confirm-conflict@example.com");
        var expenses = await SeedMonthlyCandidateAsync(app, owner.Id);
        var fingerprint = await CandidateFingerprintAsync(owner.Client);
        await owner.Client.PostAsJsonAsync("/api/commitment-candidates/dismiss", new { fingerprint });
        Assert.Equal(HttpStatusCode.Conflict,
            (await owner.Client.PostAsJsonAsync("/api/commitment-candidates/confirm", FixedConfirmation(fingerprint))).StatusCode);

        await owner.Client.PostAsJsonAsync("/api/commitment-candidates/reconsider", new { fingerprint });
        var expense = expenses[0];
        await owner.Client.PutAsJsonAsync($"/api/expenses/{expense.Id}", new
        {
            id = expense.Id,
            description = expense.Description,
            amount = 11m,
            date = expense.Date.ToString("yyyy-MM-dd"),
            category = expense.Category
        });
        Assert.Equal(HttpStatusCode.Conflict,
            (await owner.Client.PostAsJsonAsync("/api/commitment-candidates/confirm", FixedConfirmation(fingerprint))).StatusCode);
    }

    [Fact]
    public async Task Commands_reject_invalid_fingerprints_and_expectation_shapes()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("invalid-commitment@example.com");
        await SeedMonthlyCandidateAsync(app, owner.Id);
        var fingerprint = await CandidateFingerprintAsync(owner.Client);

        var invalidFingerprint = await owner.Client.PostAsJsonAsync(
            "/api/commitment-candidates/dismiss",
            new { fingerprint = "not-a-fingerprint" });
        Assert.Equal(HttpStatusCode.BadRequest, invalidFingerprint.StatusCode);
        Assert.Equal("fingerprint_invalid", (await invalidFingerprint.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("code").GetString());
        Assert.Equal("application/problem+json", invalidFingerprint.Content.Headers.ContentType?.MediaType);

        var invalidExpectation = await owner.Client.PostAsJsonAsync(
            "/api/commitment-candidates/confirm",
            new
            {
                fingerprint,
                name = "Membership",
                category = "bills",
                cadence = "weekly",
                timingKind = "dayOfMonth",
                expectedDayOfWeek = (string?)null,
                expectedDay = (int?)null,
                expectedMonth = (int?)null,
                windowBeforeDays = -1,
                windowAfterDays = 0,
                amountMode = "range",
                expectedAmount = 10m,
                expectedMinimumAmount = (decimal?)null,
                expectedMaximumAmount = (decimal?)null
            });
        Assert.Equal(HttpStatusCode.BadRequest, invalidExpectation.StatusCode);
        Assert.Equal("timing_invalid", (await invalidExpectation.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("code").GetString());
    }

    [Fact]
    public async Task Commitment_update_and_lifecycle_are_owned_validated_and_do_not_edit_expenses()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("edit-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("edit-other@example.com");
        var expenses = await SeedMonthlyCandidateAsync(app, owner.Id);
        var fingerprint = await CandidateFingerprintAsync(owner.Client);
        var confirmation = await owner.Client.PostAsJsonAsync(
            "/api/commitment-candidates/confirm",
            FixedConfirmation(fingerprint));
        var confirmed = await confirmation.Content.ReadFromJsonAsync<JsonElement>();
        var id = confirmed.GetProperty("commitment").GetProperty("id").GetGuid();

        var update = await owner.Client.PutAsJsonAsync($"/api/commitments/{id}", new
        {
            name = "  Updated membership ",
            category = " Home   Bills ",
            cadence = "monthly",
            timingKind = "monthEnd",
            expectedDayOfWeek = (string?)null,
            expectedDay = (int?)null,
            expectedMonth = (int?)null,
            windowBeforeDays = 3,
            windowAfterDays = 0,
            amountMode = "range",
            expectedAmount = (decimal?)null,
            expectedMinimumAmount = 9m,
            expectedMaximumAmount = 15m
        });
        var updated = await update.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        Assert.Equal("Updated membership", updated.GetProperty("name").GetString());
        Assert.Equal("home bills", updated.GetProperty("category").GetString());
        Assert.Equal("range", updated.GetProperty("amountMode").GetString());

        var lifecycle = await owner.Client.PatchAsJsonAsync(
            $"/api/commitments/{id}/lifecycle",
            new { lifecycle = "paused" });
        Assert.Equal("paused", (await lifecycle.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("lifecycle").GetString());
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.Client.PatchAsJsonAsync($"/api/commitments/{id}/lifecycle", new { lifecycle = "ended" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await owner.Client.PatchAsJsonAsync($"/api/commitments/{id}/lifecycle", new { lifecycle = "automatic" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await owner.Client.PatchAsJsonAsync($"/api/commitments/{id}/lifecycle", new { lifecycle = "1" })).StatusCode);
        Assert.Empty((await other.Client.GetFromJsonAsync<JsonElement>("/api/commitments")).EnumerateArray());
        foreach (var expense in expenses)
        {
            var persisted = await app.FindExpenseAsync(expense.Id);
            Assert.Equal(expense.Amount, persisted!.Amount);
            Assert.Equal(expense.Description, persisted.Description);
        }
    }

    private static async Task<List<BudgetPlanner.Models.Expense>> SeedMonthlyCandidateAsync(
        FinancialApiTestApplication app,
        string ownerId)
    {
        var result = new List<BudgetPlanner.Models.Expense>();
        foreach (var date in RecentMonthlyDates())
            result.Add(await app.SeedExpenseAsync(ownerId, "membership", 10m, date, "bills"));
        return result;
    }

    private static async Task<Guid> SeedCommitmentAsync(
        FinancialApiTestApplicationBase app,
        string ownerId,
        IEnumerable<Expense> evidence,
        string name = "Membership",
        string category = "bills",
        int expectedDay = 10,
        decimal expectedAmount = 10m,
        CommitmentLifecycle lifecycle = CommitmentLifecycle.Active)
    {
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var now = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var commitment = new Commitment
        {
            Id = Guid.NewGuid(),
            OwnerId = ownerId,
            Name = name,
            Category = category,
            Lifecycle = lifecycle,
            Cadence = CommitmentCadence.Monthly,
            TimingKind = CommitmentTimingKind.DayOfMonth,
            ExpectedDay = expectedDay,
            WindowBeforeDays = 0,
            WindowAfterDays = 0,
            AmountMode = CommitmentAmountMode.Fixed,
            ExpectedAmount = expectedAmount,
            CreatedAt = now,
            UpdatedAt = now,
            Occurrences = evidence.Select(expense => new CommitmentOccurrence
            {
                ExpenseId = expense.Id,
                Kind = CommitmentOccurrenceKind.ConfirmationEvidence,
                LinkedAt = now
            }).ToList()
        };
        context.Commitments.Add(commitment);
        await context.SaveChangesAsync();
        return commitment.Id;
    }

    private static async Task SeedImportedProvenanceAsync(
        FinancialApiTestApplicationBase app,
        string ownerId,
        int expenseId)
    {
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var now = new DateTime(2026, 10, 29, 0, 0, 0, DateTimeKind.Utc);
        var digest = new byte[32];
        BitConverter.GetBytes(expenseId).CopyTo(digest, 0);
        context.ImportPreviewBatches.Add(new ImportPreviewBatch
        {
            Id = Guid.NewGuid(),
            OwnerId = ownerId,
            SourceType = "sunflower_pdf",
            ParserRuleVersion = "change-read-test-v1",
            DocumentDigest = digest,
            CreatedAt = now.AddHours(-1),
            ExpiresAt = now.AddHours(1),
            Lifecycle = ImportPreviewLifecycle.Confirmed,
            ConfirmedAt = now,
            Provenance =
            [
                new ImportExpenseProvenance
                {
                    SourceRowOrdinal = 1,
                    ExpenseId = expenseId
                }
            ]
        });
        await context.SaveChangesAsync();
    }

    private static void AssertUnavailable(JsonElement change, string reason)
    {
        Assert.False(change.GetProperty("isMatchingAvailable").GetBoolean());
        Assert.Equal(reason, change.GetProperty("unavailableReason").GetString());
        Assert.Equal(JsonValueKind.Null, change.GetProperty("normalizedDescription").ValueKind);
        Assert.Equal(JsonValueKind.Null, change.GetProperty("canonicalCategory").ValueKind);
        Assert.Empty(change.GetProperty("observations").EnumerateArray());
        Assert.Equal("matching_unavailable", change.GetProperty("amount").GetProperty("state").GetString());
        Assert.Equal("matching_unavailable", change.GetProperty("timing").GetProperty("state").GetString());
        Assert.Equal("matching_unavailable", change.GetProperty("missing").GetProperty("state").GetString());
    }

    private static DateOnly[] RecentMonthlyDates()
    {
        var now = DateTime.UtcNow;
        var current = new DateOnly(now.Year, now.Month, 10);
        return [current.AddMonths(-2), current.AddMonths(-1), current];
    }

    private static async Task<string> CandidateFingerprintAsync(HttpClient client)
    {
        var response = await client.GetFromJsonAsync<JsonElement>("/api/commitment-candidates");
        return Assert.Single(response.GetProperty("candidates").EnumerateArray())
            .GetProperty("fingerprint").GetString()!;
    }

    private static object FixedConfirmation(string fingerprint) => new
    {
        fingerprint,
        name = "Membership",
        category = "bills",
        cadence = "monthly",
        timingKind = "dayOfMonth",
        expectedDayOfWeek = (string?)null,
        expectedDay = 10,
        expectedMonth = (int?)null,
        windowBeforeDays = 0,
        windowAfterDays = 0,
        amountMode = "fixed",
        expectedAmount = 10m,
        expectedMinimumAmount = (decimal?)null,
        expectedMaximumAmount = (decimal?)null
    };
}

internal sealed class ClockedCommitmentFinancialApiTestApplication(FixedCommitmentTimeProvider clock)
    : FinancialApiTestApplication
{
    protected override void ConfigureAdditionalServices(IServiceCollection services)
    {
        services.RemoveAll<TimeProvider>();
        services.AddSingleton<TimeProvider>(clock);
    }
}

internal sealed class FixedCommitmentTimeProvider(DateTimeOffset utcNow) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => utcNow;
}
