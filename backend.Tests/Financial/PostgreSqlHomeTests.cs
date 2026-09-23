using System.Net.Http.Json;
using System.Text.Json;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using BudgetPlanner.Paychecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

[Collection("Environment variable tests")]
[Trait("Category", "PostgreSQL")]
public sealed class PostgreSqlHomeTests
{
    private const string Route = "/api/home?activityThroughDate=2026-09-22";

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

    private static async Task<(int Expenses, int Inflows, int Profiles, int Occurrences)> StateAsync(
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
