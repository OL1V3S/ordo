using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BudgetPlanner.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

[Collection("Environment variable tests")]
[Trait("Category", "PostgreSQL")]
public sealed class PostgreSqlBudgetLimitTests
{
    private const string PreviousMigration = "20261017020810_AddCreateRequestReceipts";
    private static readonly DateTime August = new(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc);

    [PostgreSqlFact]
    public async Task Parallel_upserts_of_category_variants_leave_exactly_one_row()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("pg-budget-parallel@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("pg-budget-parallel-other@example.com");
        var otherLimit = await app.SeedBudgetLimitAsync(other.Id, "food", 7m, August);
        var variants = new[] { "Food", " food ", "FOOD", "fOoD", "food" };

        var responses = await Task.WhenAll(Enumerable.Range(0, 40).Select(i =>
            owner.Client.PostAsJsonAsync("/api/budgetlimits", new
            {
                category = variants[i % variants.Length],
                limitAmount = 10m + i,
                monthYear = "2026-08-17"
            })));

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
        var rows = await app.FindBudgetLimitsAsync(owner.Id, "food");
        var row = Assert.Single(rows);
        Assert.Equal(August, row.MonthYear);
        foreach (var response in responses)
        {
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(row.Id, body.GetProperty("id").GetInt32());
        }

        var untouched = Assert.Single(await app.FindBudgetLimitsAsync(other.Id, "food"));
        Assert.Equal(otherLimit.Id, untouched.Id);
        Assert.Equal(7m, untouched.LimitAmount);
    }

    [PostgreSqlFact]
    public async Task Database_rejects_duplicate_user_category_month()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("pg-budget-duplicate@example.com");
        await app.SeedBudgetLimitAsync(owner.Id, "food", 100m, August);

        var exception = await Assert.ThrowsAsync<DbUpdateException>(
            () => app.SeedBudgetLimitAsync(owner.Id, "food", 200m, August));

        Assert.Equal(PostgresErrorCodes.UniqueViolation, ((PostgresException)exception.InnerException!).SqlState);
        Assert.Equal(100m, Assert.Single(await app.FindBudgetLimitsAsync(owner.Id, "food")).LimitAmount);
    }

    [PostgreSqlFact]
    public async Task Home_matches_a_canonical_budget_to_canonical_expenses()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("pg-budget-home@example.com");
        var response = await owner.Client.PostAsJsonAsync("/api/budgetlimits", new
        {
            category = " Food ",
            limitAmount = 100m,
            monthYear = "2026-09-01"
        });
        response.EnsureSuccessStatusCode();
        await app.SeedExpenseAsync(owner.Id, "Canonical expense", 100.01m, new(2026, 9, 10), "food");

        using var home = await owner.Client.GetAsync("/api/home?activityThroughDate=2026-09-22");
        home.EnsureSuccessStatusCode();
        var attention = (await home.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("attention");
        var item = Assert.Single(attention.GetProperty("budgetItems").EnumerateArray());

        Assert.Equal("over_limit", item.GetProperty("state").GetString());
        Assert.Equal("food", item.GetProperty("category").GetString());
        Assert.Equal("100.01", item.GetProperty("spentAmount").GetString());
    }

    [PostgreSqlTheory]
    [InlineData("blank", "   ", 10)]
    [InlineData("upper", "Food", 10)]
    [InlineData("padded", " food", 10)]
    [InlineData("inner-space", "eating  out", 10)]
    [InlineData("negative", "food", -1)]
    public async Task Guard_aborts_on_bad_rows_deletes_nothing_and_passes_once_resolved(
        string name, string category, int amount)
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync($"pg-guard-{name}@example.com");
        var target = app.GetDefinedMigrations().Last();
        await using var scope = app.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var migrator = context.GetService<IMigrator>();
        await migrator.MigrateAsync(PreviousMigration);

        var bad = await app.SeedBudgetLimitAsync(owner.Id, category, amount, August);
        await app.SeedBudgetLimitAsync(owner.Id, "bills", 5m, August);

        var failure = await Assert.ThrowsAnyAsync<Exception>(() => migrator.MigrateAsync(target));

        Assert.Contains("AddBudgetLimitUniqueness aborted", failure.ToString(), StringComparison.Ordinal);
        Assert.Equal(2, await CountAsync(context));
        Assert.DoesNotContain(target, await context.Database.GetAppliedMigrationsAsync());

        await context.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM \"BudgetLimits\" WHERE \"Id\" = {bad.Id}");
        await migrator.MigrateAsync(target);
        Assert.Contains(target, await context.Database.GetAppliedMigrationsAsync());
    }

    [PostgreSqlFact]
    public async Task Guard_aborts_on_canonical_duplicates()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("pg-guard-duplicate@example.com");
        var target = app.GetDefinedMigrations().Last();
        await using var scope = app.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var migrator = context.GetService<IMigrator>();
        await migrator.MigrateAsync(PreviousMigration);
        await app.SeedBudgetLimitAsync(owner.Id, "food", 1m, August);
        await app.SeedBudgetLimitAsync(owner.Id, "food", 2m, August);

        var failure = await Assert.ThrowsAnyAsync<Exception>(() => migrator.MigrateAsync(target));

        Assert.Contains("duplicate", failure.ToString(), StringComparison.Ordinal);
        Assert.Equal(2, await CountAsync(context));
    }

    [PostgreSqlTheory]
    [InlineData("2026-08-01T00:00:00Z", true)]
    [InlineData("2026-08-01T05:00:00Z", false)]
    [InlineData("2026-08-15T00:00:00Z", false)]
    public async Task Guard_checks_the_month_in_utc_under_a_non_utc_session(string monthYear, bool passes)
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync($"pg-guard-month-{passes}-{monthYear.Length}-{monthYear[8..10]}@example.com");
        var target = app.GetDefinedMigrations().Last();
        await using var scope = app.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var migrator = context.GetService<IMigrator>();
        await migrator.MigrateAsync(PreviousMigration);
        await app.SeedBudgetLimitAsync(
            owner.Id, "food", 1m, DateTime.Parse(monthYear, null, System.Globalization.DateTimeStyles.AdjustToUniversal));

        await context.Database.OpenConnectionAsync();
        await context.Database.ExecuteSqlRawAsync("SET TIME ZONE 'America/Los_Angeles'");

        if (passes)
        {
            await migrator.MigrateAsync(target);
            Assert.Contains(target, await context.Database.GetAppliedMigrationsAsync());
        }
        else
        {
            var failure = await Assert.ThrowsAnyAsync<Exception>(() => migrator.MigrateAsync(target));
            Assert.Contains("AddBudgetLimitUniqueness aborted", failure.ToString(), StringComparison.Ordinal);
        }
    }

    private static async Task<int> CountAsync(BudgetContext context) =>
        await context.Database
            .SqlQueryRaw<int>("SELECT count(*)::int AS \"Value\" FROM \"BudgetLimits\"")
            .SingleAsync();
}

internal sealed class PostgreSqlTheoryAttribute : TheoryAttribute
{
    public PostgreSqlTheoryAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(
            PostgreSqlFinancialApiTestApplication.ConnectionEnvironmentVariable)))
        {
            Skip = $"Set {PostgreSqlFinancialApiTestApplication.ConnectionEnvironmentVariable} to run PostgreSQL integration tests.";
        }
    }
}
