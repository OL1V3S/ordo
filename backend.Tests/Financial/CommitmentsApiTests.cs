using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BudgetPlanner.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
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
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/commitment-candidates/dismiss", new { fingerprint = new string('0', 64) })).StatusCode);
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
