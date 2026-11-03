using System.Net.Http.Json;
using System.Text.Json;
using BudgetPlanner.Commitments;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using BudgetPlanner.Paychecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

[Collection("Environment variable tests")]
[Trait("Category", "PostgreSQL")]
public sealed class PostgreSqlHomeTests
{
    private const string Route = "/api/home?activityThroughDate=2026-09-22";

    [PostgreSqlFact]
    public async Task Budget_attention_is_owner_scoped_cutoff_exact_and_read_only()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-home-budget-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("postgres-home-budget-other@example.com");
        var month = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc);

        await app.SeedBudgetLimitAsync(owner.Id, "food", 100m, month);
        await app.SeedBudgetLimitAsync(other.Id, "foreign", 1m, month);
        await app.SeedExpenseAsync(owner.Id, "Owner cutoff expense", 100.01m, new(2026, 9, 22), "food");
        await app.SeedExpenseAsync(owner.Id, "After cutoff expense", 500m, new(2026, 9, 23), "food");
        await app.SeedExpenseAsync(other.Id, "Foreign expense", 999m, new(2026, 9, 22), "foreign");
        var before = await StateAsync(app);

        using var response = await owner.Client.GetAsync(Route);
        response.EnsureSuccessStatusCode();
        var attention = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("attention");
        var item = Assert.Single(attention.GetProperty("budgetItems").EnumerateArray());

        Assert.Equal("available", attention.GetProperty("familyAvailability")
            .GetProperty("budget_attention").GetProperty("state").GetString());
        Assert.Equal("over_limit", item.GetProperty("state").GetString());
        Assert.Equal("food", item.GetProperty("category").GetString());
        Assert.Equal("100.01", item.GetProperty("spentAmount").GetString());
        Assert.Equal("100.00", item.GetProperty("limitAmount").GetString());
        Assert.DoesNotContain("Foreign", attention.GetRawText(), StringComparison.Ordinal);
        Assert.Equal(before, await StateAsync(app));
    }

    [PostgreSqlFact]
    public async Task Duplicate_budget_rows_cannot_be_stored()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-home-budget-duplicate@example.com");
        var month = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc);
        await app.SeedBudgetLimitAsync(owner.Id, "food", 100m, month);

        await Assert.ThrowsAsync<DbUpdateException>(
            () => app.SeedBudgetLimitAsync(owner.Id, "food", 200m, month));
    }

    [Theory]
    [InlineData("negative_budget")]
    [InlineData("zero_expense")]
    public async Task Representable_legacy_numeric_rows_fail_only_budget_family(string rowKind)
    {
        await using var app = new FrozenPostgreSqlHomeApplication();
        using var owner = await app.CreateAuthenticatedUserAsync($"postgres-home-budget-{rowKind}@example.com");

        if (rowKind == "negative_budget")
            await app.SeedBudgetLimitAsync(owner.Id, "food", -1m, new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc));
        else
        {
            await app.SeedBudgetLimitAsync(owner.Id, "food", 10m, new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc));
            await app.SeedExpenseAsync(owner.Id, "Legacy zero expense", 0m, new(2026, 9, 10), "food");
        }
        await SeedPendingCommitmentAsync(app, owner.Id);

        using var response = await owner.Client.GetAsync(Route);
        response.EnsureSuccessStatusCode();
        var attention = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("attention");

        Assert.Equal("available", attention.GetProperty("availability").GetProperty("state").GetString());
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

    [PostgreSqlFact]
    public async Task Read_is_exact_owner_scoped_read_only_and_keeps_linked_cash_single()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-home-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("postgres-home-other@example.com");
        var expense = await app.SeedExpenseAsync(
            owner.Id, "PostgreSQL exact expense", 9999999999999999.99m, new(2026, 9, 22), "uncategorized");
        var inflow = await app.SeedInflowAsync(
            owner.Id, "PostgreSQL linked cash", 9999999999999999.99m, new(2026, 9, 21));
        await app.SeedExpenseAsync(other.Id, "Foreign PostgreSQL expense", 777m, new(2026, 9, 22));
        await app.SeedInflowAsync(other.Id, "Foreign PostgreSQL cash", 777m, new(2026, 9, 22));

        var profile = new PaycheckProfile
        {
            Id = Guid.NewGuid(), OwnerId = owner.Id, DisplayName = "PostgreSQL payroll",
            Lifecycle = PaycheckLifecycle.Ended, Cadence = PaycheckCadence.Monthly,
            FirstMonthAnchor = 21, AmountMode = PaycheckAmountMode.Fixed, ExpectedAmount = 1000m,
            CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow
        };
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            db.PaycheckProfiles.Add(profile);
            db.PaycheckOccurrences.Add(new PaycheckOccurrence
            {
                PaycheckProfileId = profile.Id, AccountInflowId = inflow.Id, OwnerId = owner.Id,
                Kind = PaycheckOccurrenceKind.RecordedReceipt,
                EvidenceRevisionAtAssignment = inflow.PaycheckEvidenceRevision,
                SlotAnchor = inflow.Date, TimingOffsetDays = 0, LinkedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }
        var before = await StateAsync(app);

        using var response = await owner.Client.GetAsync(Route);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var attention = body.GetProperty("attention");
        Assert.Equal("available", attention.GetProperty("availability").GetProperty("state").GetString());
        Assert.Equal(new[] { "commitment_change_review", "budget_attention" }, attention.GetProperty("kindsEvaluated")
            .EnumerateArray().Select(value => value.GetString()));
        Assert.Empty(attention.GetProperty("items").EnumerateArray());
        Assert.Empty(attention.GetProperty("budgetItems").EnumerateArray());
        var items = body.GetProperty("recentActivity").GetProperty("items").EnumerateArray().ToArray();

        Assert.Equal(2, items.Length);
        Assert.Equal(expense.Id, items[0].GetProperty("recordId").GetInt32());
        Assert.Equal("9999999999999999.99", items[0].GetProperty("amount").GetString());
        Assert.Equal(inflow.Id, items[1].GetProperty("recordId").GetInt32());
        Assert.Equal("9999999999999999.99", items[1].GetProperty("amount").GetString());
        Assert.Equal("recorded_receipt", items[1].GetProperty("paycheck").GetProperty("relation").GetString());
        Assert.Single(items, value => value.GetProperty("kind").GetString() == "account_inflow");
        Assert.DoesNotContain("Foreign PostgreSQL", body.GetRawText(), StringComparison.Ordinal);
        Assert.Equal(before, await StateAsync(app));
    }

    [PostgreSqlFact]
    public async Task Paycheck_attention_flags_unrecorded_and_expected_owner_scoped_and_read_only()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-home-pa-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("postgres-home-pa-other@example.com");
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var longAgo = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        PaycheckProfile Weekly(string ownerId, string name, DateOnly reference) => new()
        {
            Id = Guid.NewGuid(), OwnerId = ownerId, DisplayName = name,
            Lifecycle = PaycheckLifecycle.Active, Cadence = PaycheckCadence.Weekly,
            ReferenceAnchorDate = reference, WindowBeforeDays = 0, WindowAfterDays = 0,
            AmountMode = PaycheckAmountMode.Fixed, ExpectedAmount = 1000m,
            CreatedAt = longAgo, UpdatedAt = longAgo
        };
        var missed = Weekly(owner.Id, "PostgreSQL missed", today.AddDays(-3));
        var expected = Weekly(owner.Id, "PostgreSQL expected", today);
        // Earlier weekly slots predate this profile, so only today's window flags.
        expected.CreatedAt = expected.UpdatedAt = DateTime.UtcNow;
        var recorded = Weekly(owner.Id, "PostgreSQL recorded", today.AddDays(-2));
        var foreign = Weekly(other.Id, "PostgreSQL foreign", today.AddDays(-1));
        var inflow = await app.SeedInflowAsync(owner.Id, "PostgreSQL receipt", 1000m, today.AddDays(-2));
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            db.PaycheckProfiles.AddRange(missed, expected, recorded, foreign);
            db.PaycheckOccurrences.Add(new PaycheckOccurrence
            {
                PaycheckProfileId = recorded.Id, AccountInflowId = inflow.Id, OwnerId = owner.Id,
                Kind = PaycheckOccurrenceKind.RecordedReceipt,
                EvidenceRevisionAtAssignment = inflow.PaycheckEvidenceRevision,
                SlotAnchor = inflow.Date, TimingOffsetDays = 0, LinkedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }
        var before = await StateAsync(app);

        using var response = await owner.Client.GetAsync($"/api/home?activityThroughDate={today:yyyy-MM-dd}");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var section = body.GetProperty("paycheckAttention");
        var items = section.GetProperty("items").EnumerateArray().ToArray();

        Assert.Equal("available", section.GetProperty("availability").GetProperty("state").GetString());
        Assert.Equal(["paycheck_unrecorded", "paycheck_expected"],
            items.Select(value => value.GetProperty("kind").GetString()));
        Assert.Equal([missed.Id, expected.Id],
            items.Select(value => value.GetProperty("paycheckProfileId").GetGuid()));
        var upcoming = body.GetProperty("upcoming").GetProperty("items").EnumerateArray()
            .Select(value => value.GetProperty("paycheckProfileId").GetGuid()).ToArray();
        Assert.DoesNotContain(expected.Id, upcoming);
        Assert.DoesNotContain("PostgreSQL foreign", body.GetRawText(), StringComparison.Ordinal);
        Assert.Equal(before, await StateAsync(app));
    }

    private static async Task<(int Expenses, int Inflows, int Profiles, int Occurrences, int Budgets)> StateAsync(
        FinancialApiTestApplicationBase app)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        return (
            await db.Expenses.CountAsync(),
            await db.AccountInflows.CountAsync(),
            await db.PaycheckProfiles.CountAsync(),
            await db.PaycheckOccurrences.CountAsync(),
            await db.BudgetLimits.CountAsync());
    }

    private static async Task SeedPendingCommitmentAsync(
        PostgreSqlFinancialApiTestApplication app,
        string ownerId)
    {
        var evidence = new List<Expense>();
        foreach (var date in new[] { new DateOnly(2026, 5, 10), new DateOnly(2026, 6, 10), new DateOnly(2026, 7, 10) })
            evidence.Add(await app.SeedExpenseAsync(ownerId, "membership", 10m, date, "bills"));
        foreach (var date in new[] { new DateOnly(2026, 8, 12), new DateOnly(2026, 9, 12), new DateOnly(2026, 10, 12) })
            await app.SeedExpenseAsync(ownerId, "membership", 12m, date, "bills");

        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var at = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        context.Commitments.Add(new Commitment
        {
            Id = Guid.NewGuid(), OwnerId = ownerId, Name = "Gym plan", Category = "bills",
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

    private sealed class FrozenPostgreSqlHomeApplication : PostgreSqlFinancialApiTestApplication
    {
        protected override void ConfigureAdditionalServices(IServiceCollection services)
        {
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(new FrozenTimeProvider(
                new DateTimeOffset(2026, 10, 29, 18, 0, 0, TimeSpan.Zero)));
        }
    }
}
