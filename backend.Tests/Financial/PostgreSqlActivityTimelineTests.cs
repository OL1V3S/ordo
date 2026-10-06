using System.Collections.Concurrent;
using System.Data;
using System.Data.Common;
using System.Net.Http.Json;
using System.Text.Json;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

[Collection("Environment variable tests")]
[Trait("Category", "PostgreSQL")]
public sealed class PostgreSqlActivityTimelineTests
{
    private const string HomeRoute = "/api/home?activityThroughDate=2026-12-31";

    [PostgreSqlFact]
    public async Task Keyset_paging_on_date_and_id_is_exact_across_a_split_same_day_group()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-timeline-paging@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("postgres-timeline-paging-other@example.com");
        var sameDay = new DateOnly(2026, 9, 22);
        var expenses = new List<Expense>();
        var inflows = new List<AccountInflow>();
        for (var index = 0; index < 3; index++)
        {
            expenses.Add(await app.SeedExpenseAsync(owner.Id, $"PostgreSQL same-day expense {index}", 1m + index, sameDay));
            inflows.Add(await app.SeedInflowAsync(owner.Id, $"PostgreSQL same-day cash {index}", 10m + index, sameDay));
        }
        var future = await app.SeedExpenseAsync(owner.Id, "PostgreSQL future expense", 4m, new(2027, 1, 5));
        var olderInflow = await app.SeedInflowAsync(owner.Id, "PostgreSQL older cash", 5m, new(2026, 9, 21));
        var olderExpense = await app.SeedExpenseAsync(owner.Id, "PostgreSQL older expense", 6m, new(2026, 9, 21));
        await app.SeedExpenseAsync(other.Id, "Foreign PostgreSQL expense", 777m, sameDay);
        await app.SeedInflowAsync(other.Id, "Foreign PostgreSQL cash", 777m, sameDay);
        var before = await app.RecordStateAsync();

        var everything = ActivityTimelineTestClient.Keys(
            await ActivityTimelineTestClient.ReadAsync(owner.Client, "?limit=100"));
        Assert.Equal(
            [
                ("expense", future.Id),
                ("expense", expenses[2].Id),
                ("expense", expenses[1].Id),
                ("expense", expenses[0].Id),
                ("account_inflow", inflows[2].Id),
                ("account_inflow", inflows[1].Id),
                ("account_inflow", inflows[0].Id),
                ("expense", olderExpense.Id),
                ("account_inflow", olderInflow.Id)
            ],
            everything);

        foreach (var limit in new[] { 1, 2, 3, 4, 7 })
        {
            var walked = await ActivityTimelineTestClient.WalkAsync(owner.Client, limit);
            Assert.Equal(everything, walked.Keys);
            Assert.Equal(everything.Length, walked.Keys.Distinct().Count());
        }

        Assert.Equal(before, await app.RecordStateAsync());
    }

    [PostgreSqlFact]
    public async Task Amounts_stay_exact_and_legacy_zero_or_negative_expenses_are_not_repaired()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-timeline-amounts@example.com");
        await app.SeedExpenseAsync(owner.Id, "Legacy zero", 0m, new(2026, 9, 25), "legacy");
        await app.SeedExpenseAsync(owner.Id, "Legacy negative", -5m, new(2026, 9, 24), "legacy");
        await app.SeedExpenseAsync(owner.Id, "Largest expense", 9999999999999999.99m, new(2026, 9, 23), "big");
        await app.SeedInflowAsync(owner.Id, "Largest cash", 9999999999999999.99m, new(2026, 9, 22));
        await app.SeedInflowAsync(owner.Id, "Smallest cash", 0.01m, new(2026, 9, 21));

        var body = await ActivityTimelineTestClient.ReadAsync(owner.Client);

        Assert.Equal(
            ["0.00", "-5.00", "9999999999999999.99", "9999999999999999.99", "0.01"],
            body.GetProperty("items").EnumerateArray().Select(value => value.GetProperty("amount").GetString()));
    }

    [PostgreSqlFact]
    public async Task Linked_cash_stays_single_and_Home_output_matches_the_timeline_after_the_shared_reader_refactor()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-timeline-linked@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("postgres-timeline-linked-other@example.com");
        await app.SeedExpenseAsync(owner.Id, "PostgreSQL exact expense", 9999999999999999.99m, new(2026, 9, 22));
        var linked = await app.SeedInflowAsync(owner.Id, "PostgreSQL linked cash", 9999999999999999.99m, new(2026, 9, 22));
        await app.SeedExpenseAsync(owner.Id, "PostgreSQL older expense", 2m, new(2026, 9, 20));
        var foreignInflow = await app.SeedInflowAsync(other.Id, "Foreign PostgreSQL cash", 777m, new(2026, 9, 22));
        var profileId = await app.AddPaycheckLinkAsync(owner.Id, linked, PaycheckOccurrenceKind.RecordedReceipt);
        await app.AddPaycheckLinkAsync(other.Id, foreignInflow, PaycheckOccurrenceKind.RecordedReceipt);
        var before = await app.RecordStateAsync();

        var timeline = await ActivityTimelineTestClient.ReadAsync(owner.Client);
        using var homeResponse = await owner.Client.GetAsync(HomeRoute);
        homeResponse.EnsureSuccessStatusCode();
        var home = await homeResponse.Content.ReadFromJsonAsync<JsonElement>();

        var items = timeline.GetProperty("items").EnumerateArray().ToArray();
        var homeItems = home.GetProperty("recentActivity").GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(3, items.Length);
        Assert.Equal(homeItems.Select(value => value.GetRawText()), items.Select(value => value.GetRawText()));
        var inflow = Assert.Single(items, value => value.GetProperty("kind").GetString() == "account_inflow");
        Assert.Equal(linked.Id, inflow.GetProperty("recordId").GetInt32());
        Assert.Equal(profileId, inflow.GetProperty("paycheck").GetProperty("profileId").GetGuid());
        Assert.Equal("recorded_receipt", inflow.GetProperty("paycheck").GetProperty("relation").GetString());
        Assert.DoesNotContain("Foreign PostgreSQL", timeline.GetRawText(), StringComparison.Ordinal);
        Assert.Equal(before, await app.RecordStateAsync());
    }

    [PostgreSqlFact]
    public async Task Timeline_read_runs_every_query_inside_one_read_only_repeatable_read_transaction()
    {
        var observer = new ReadOnlyObserver();
        await using var app = new ObservedApplication(observer);
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-timeline-read-only@example.com");
        await app.SeedExpenseAsync(owner.Id, "PostgreSQL read-only expense", 3m, new(2026, 9, 22));
        await app.SeedInflowAsync(owner.Id, "PostgreSQL read-only cash", 4m, new(2026, 9, 21));
        var before = await app.RecordStateAsync();

        var timeline = await ActivityTimelineTestClient.ReadAsync(owner.Client);

        Assert.Equal(2, timeline.GetProperty("items").GetArrayLength());
        var observed = observer.Commands.ToArray();
        var readOnly = Assert.Single(observed, value => value.IsReadOnlyStatement);
        Assert.NotNull(readOnly.Transaction);
        Assert.Equal(IsolationLevel.RepeatableRead, readOnly.Isolation);
        // The READ ONLY statement precedes every timeline query, and all of them share its transaction.
        Assert.Same(readOnly, observed[0]);
        var queries = observed.Where(value => !value.IsReadOnlyStatement).ToArray();
        Assert.True(queries.Length >= 2);
        Assert.All(queries, query => Assert.Same(readOnly.Transaction, query.Transaction));
        Assert.Equal(before, await app.RecordStateAsync());
    }

    private sealed class ObservedApplication(ReadOnlyObserver observer) : PostgreSqlFinancialApiTestApplication
    {
        protected override void ConfigureDatabase(IServiceCollection services) =>
            services.AddDbContext<BudgetContext>(options => options
                .UseNpgsql(Environment.GetEnvironmentVariable(ConnectionEnvironmentVariable))
                .AddInterceptors(observer));
    }

    private sealed record ObservedCommand(bool IsReadOnlyStatement, DbTransaction? Transaction, IsolationLevel? Isolation);

    private sealed class ReadOnlyObserver : DbCommandInterceptor
    {
        private readonly ConcurrentQueue<ObservedCommand> _commands = new();

        public IReadOnlyCollection<ObservedCommand> Commands => _commands;

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("SET TRANSACTION READ ONLY", StringComparison.OrdinalIgnoreCase))
                _commands.Enqueue(new ObservedCommand(true, command.Transaction, command.Transaction?.IsolationLevel));
            return ValueTask.FromResult(result);
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("ActivityTimeline:", StringComparison.Ordinal))
                _commands.Enqueue(new ObservedCommand(false, command.Transaction, command.Transaction?.IsolationLevel));
            return ValueTask.FromResult(result);
        }
    }
}
