using System.Data;
using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using BudgetPlanner.Paychecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

[Collection("Environment variable tests")]
[Trait("Category", "PostgreSQL")]
public sealed class PostgreSqlCashFlowTests
{
    private const string Route = "/api/analytics/cash-flow?month=2026-09&throughDate=2026-09-06";

    [PostgreSqlFact]
    public async Task Read_preserves_full_precision_partitions_stored_records_and_isolates_owners()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("cash-flow-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("cash-flow-other@example.com");
        var linked = await app.SeedInflowAsync(owner.Id, "synthetic same deposit", 9999999999999999.99m, new(2026, 9, 1));
        await app.SeedInflowAsync(owner.Id, "synthetic same deposit", 9999999999999999.99m, new(2026, 9, 1));
        var refund = await app.SeedInflowAsync(owner.Id, "synthetic refund", 0.01m, new(2026, 9, 3));
        await app.SeedExpenseAsync(owner.Id, "synthetic outflow", 0.10m, new(2026, 9, 2), "uncategorized");
        await app.SeedInflowAsync(owner.Id, "future deposit", 999m, new(2026, 9, 7));
        await app.SeedExpenseAsync(owner.Id, "future outflow", 999m, new(2026, 9, 7));
        await app.SeedInflowAsync(owner.Id, "old other-only month", 1m, new(2026, 2, 1));
        var foreign = await app.SeedInflowAsync(other.Id, "foreign deposit", 777m, new(2026, 9, 1));
        await app.SeedExpenseAsync(other.Id, "foreign outflow", 777m, new(2026, 9, 1), "foreign category");
        await app.SeedInflowAsync(other.Id, "foreign month", 1m, new(2025, 1, 1));

        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var profile = NewProfile(owner.Id, PaycheckLifecycle.Ended);
        var foreignProfile = NewProfile(other.Id);
        db.PaycheckProfiles.AddRange(profile, foreignProfile);
        db.PaycheckOccurrences.AddRange(Link(profile, linked), Link(foreignProfile, foreign));
        var now = new DateTime(2026, 9, 3, 12, 0, 0, DateTimeKind.Utc);
        db.ImportPreviewBatches.Add(new ImportPreviewBatch
        {
            Id = Guid.NewGuid(), OwnerId = owner.Id, SourceType = "sunflower_pdf",
            ParserRuleVersion = "cash-flow-test", DocumentDigest = new byte[32],
            CreatedAt = now, ExpiresAt = now.AddHours(1), ConfirmedAt = now,
            Lifecycle = ImportPreviewLifecycle.Confirmed,
            InflowProvenance = [new ImportInflowProvenance
            {
                OwnerId = owner.Id, AccountInflowId = refund.Id,
                AccountInflowOwnerId = owner.Id, SourceRowOrdinal = 1
            }]
        });
        await db.SaveChangesAsync();
        var before = await RecordStateAsync(db);

        var body = await ReadAsync(owner.Client);
        var selected = body.GetProperty("selected");
        Assert.Equal("1999999999999999999", Money(selected, "cashInMinor"));
        Assert.Equal("999999999999999999", Money(selected, "paycheckCashInMinor"));
        Assert.Equal("1000000000000000000", Money(selected, "otherCashInMinor"));
        Assert.Equal("10", Money(selected, "spentMinor"));
        Assert.Equal("1999999999999999989", Money(selected, "netMinor"));
        Assert.Equal(3, selected.GetProperty("inflowCount").GetInt32());
        Assert.Equal(1, selected.GetProperty("paycheckInflowCount").GetInt32());
        Assert.Equal(2, selected.GetProperty("otherInflowCount").GetInt32());
        Assert.Equal(1, selected.GetProperty("expenseCount").GetInt32());
        Assert.Equal(1, selected.GetProperty("paycheckProfileCount").GetInt32());
        var category = Assert.Single(body.GetProperty("categories").EnumerateArray());
        Assert.Equal("uncategorized", category.GetProperty("category").GetString());
        Assert.Equal("10", Money(category, "amountMinor"));
        var days = selected.GetProperty("days").EnumerateArray().ToArray();
        Assert.Equal(6, days.Length);
        Assert.Equal("2026-09-02", days[1].GetProperty("date").GetString());
        Assert.Equal("10", Money(days[1], "spentMinor"));
        Assert.Equal(["0", "10", "0", "0", "0", "0"], days.Select(value => Money(value, "spentMinor")));
        Assert.Equal(selected.GetProperty("categories").GetRawText(), body.GetProperty("categories").GetRawText());
        Assert.Equal(["2026-09", "2026-02"],
            body.GetProperty("availableMonths").EnumerateArray().Select(value => value.GetString()));
        Assert.Equal(6, body.GetProperty("months").GetArrayLength());
        Assert.Equal("2026-09-06", body.GetProperty("to").GetString());
        Assert.DoesNotContain("foreign", body.GetRawText(), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("ownerId", body.GetRawText(), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("description", body.GetRawText(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(before, await RecordStateAsync(db));

        using var anonymous = app.CreateTestClient();
        using var rejected = await anonymous.GetAsync(Route);
        Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);
        var otherBody = await ReadAsync(other.Client);
        Assert.Equal("77700", Money(otherBody.GetProperty("selected"), "cashInMinor"));
        Assert.Equal("77700", Money(otherBody.GetProperty("selected"), "paycheckCashInMinor"));
    }

    [PostgreSqlFact]
    public async Task Membership_lifecycle_edit_and_delete_preserve_cash_flow_meaning()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("cash-flow-changes@example.com");
        var inflow = await app.SeedInflowAsync(owner.Id, "synthetic deposit", 1200.25m, new(2026, 9, 1));
        await app.SeedExpenseAsync(owner.Id, "synthetic outflow", 200m, new(2026, 9, 2));
        var initial = (await ReadAsync(owner.Client)).GetProperty("selected");
        Assert.Equal("120025", Money(initial, "otherCashInMinor"));

        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var profile = NewProfile(owner.Id);
        db.PaycheckProfiles.Add(profile);
        db.PaycheckOccurrences.Add(Link(profile, inflow));
        await db.SaveChangesAsync();
        foreach (var lifecycle in Enum.GetValues<PaycheckLifecycle>())
        {
            profile.Lifecycle = lifecycle;
            profile.ExpectedAmount = 999m;
            await db.SaveChangesAsync();
            var selected = (await ReadAsync(owner.Client)).GetProperty("selected");
            Assert.Equal(Money(initial, "cashInMinor"), Money(selected, "cashInMinor"));
            Assert.Equal(Money(initial, "netMinor"), Money(selected, "netMinor"));
            Assert.Equal("120025", Money(selected, "paycheckCashInMinor"));
            Assert.Equal("0", Money(selected, "otherCashInMinor"));
        }

        var tracked = await db.AccountInflows.SingleAsync(value => value.Id == inflow.Id);
        tracked.UpdateEvidence("synthetic edited deposit", 1300.27m, new(2026, 8, 31));
        await db.SaveChangesAsync();
        var moved = await ReadAsync(owner.Client);
        Assert.Equal("0", Money(moved.GetProperty("selected"), "cashInMinor"));
        Assert.Equal("-20000", Money(moved.GetProperty("selected"), "netMinor"));
        var august = Assert.Single(moved.GetProperty("months").EnumerateArray(),
            value => value.GetProperty("month").GetString() == "2026-08");
        Assert.Equal("130027", Money(august, "paycheckCashInMinor"));
        Assert.Equal(1, august.GetProperty("editedPaycheckInflowCount").GetInt32());

        db.AccountInflows.Remove(tracked);
        await db.SaveChangesAsync();
        var deleted = await ReadAsync(owner.Client);
        Assert.All(deleted.GetProperty("months").EnumerateArray(),
            value => Assert.Equal("0", Money(value, "cashInMinor")));
        Assert.Empty(await db.PaycheckOccurrences.AsNoTracking().ToListAsync());
        Assert.Equal(1, await db.PaycheckProfiles.CountAsync());
    }

    [PostgreSqlFact]
    public async Task Manual_inflow_http_crud_updates_historical_cash_flow_by_current_amount_and_date()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("cash-flow-manual-crud@example.com");

        using var created = await owner.Client.PostAsJsonAsync("/api/inflows", new
        {
            description = "  Manual deposit  ",
            amount = 1200.25m,
            date = "2026-09-03"
        });
        var createdBody = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = createdBody.GetProperty("id").GetInt32();

        var afterCreate = await ReadAsync(owner.Client);
        var septemberAfterCreate = afterCreate.GetProperty("selected");
        Assert.Equal("120025", Money(septemberAfterCreate, "cashInMinor"));
        Assert.Equal("0", Money(septemberAfterCreate, "paycheckCashInMinor"));
        Assert.Equal("120025", Money(septemberAfterCreate, "otherCashInMinor"));
        Assert.Equal("120025", Money(septemberAfterCreate, "netMinor"));
        Assert.Equal(1, septemberAfterCreate.GetProperty("inflowCount").GetInt32());

        using var updated = await owner.Client.PutAsJsonAsync($"/api/inflows/{id}", new
        {
            id,
            description = "Manual deposit corrected",
            amount = 1300.27m,
            date = "2026-08-31"
        });
        Assert.Equal(HttpStatusCode.NoContent, updated.StatusCode);

        var afterUpdate = await ReadAsync(owner.Client);
        var septemberAfterUpdate = afterUpdate.GetProperty("selected");
        Assert.Equal("0", Money(septemberAfterUpdate, "cashInMinor"));
        Assert.Equal("0", Money(septemberAfterUpdate, "netMinor"));
        Assert.Equal(0, septemberAfterUpdate.GetProperty("inflowCount").GetInt32());
        var august = Assert.Single(afterUpdate.GetProperty("months").EnumerateArray(),
            value => value.GetProperty("month").GetString() == "2026-08");
        Assert.Equal("130027", Money(august, "cashInMinor"));
        Assert.Equal("130027", Money(august, "otherCashInMinor"));
        Assert.Equal(1, august.GetProperty("inflowCount").GetInt32());

        using var deleted = await owner.Client.DeleteAsync($"/api/inflows/{id}");
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);

        var afterDelete = await ReadAsync(owner.Client);
        Assert.All(afterDelete.GetProperty("months").EnumerateArray(), month =>
        {
            Assert.Equal("0", Money(month, "cashInMinor"));
            Assert.Equal(0, month.GetProperty("inflowCount").GetInt32());
        });
        Assert.Equal(["2026-09"],
            afterDelete.GetProperty("availableMonths").EnumerateArray().Select(value => value.GetString()));
    }

    [PostgreSqlFact]
    public async Task Concurrent_membership_and_record_edits_use_one_read_only_repeatable_snapshot()
    {
        var gate = new SnapshotGate();
        await using var app = new InterceptedApplication(gate);
        using var owner = await app.CreateAuthenticatedUserAsync("cash-flow-snapshot@example.com");
        var inflow = await app.SeedInflowAsync(owner.Id, "synthetic before deposit", 1000m, new(2026, 9, 1));
        var expense = await app.SeedExpenseAsync(owner.Id, "synthetic before outflow", 250m, new(2026, 9, 2));
        gate.Arm();
        var request = ReadAsync(owner.Client);
        try
        {
            await gate.Reached.Task.WaitAsync(TimeSpan.FromSeconds(20));
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            var updated = await db.AccountInflows.SingleAsync(value => value.Id == inflow.Id);
            updated.UpdateEvidence("synthetic after deposit", 2500m, new(2026, 9, 2));
            var profile = NewProfile(owner.Id);
            profile.FirstMonthAnchor = 2;
            profile.ExpectedAmount = 2500m;
            db.PaycheckProfiles.Add(profile);
            db.PaycheckOccurrences.Add(Link(profile, updated));
            (await db.Expenses.SingleAsync(value => value.Id == expense.Id)).Amount = 350m;
            db.AccountInflows.Add(new AccountInflow
            {
                OwnerId = owner.Id, Description = "synthetic historical deposit",
                Amount = 0.01m, Date = new(2026, 2, 1)
            });
            await db.SaveChangesAsync();
        }
        finally
        {
            gate.Release.TrySetResult();
        }

        var before = await request.WaitAsync(TimeSpan.FromSeconds(20));
        var selected = before.GetProperty("selected");
        Assert.Equal("100000", Money(selected, "cashInMinor"));
        Assert.Equal("0", Money(selected, "paycheckCashInMinor"));
        Assert.Equal("100000", Money(selected, "otherCashInMinor"));
        Assert.Equal("25000", Money(selected, "spentMinor"));
        Assert.Equal("75000", Money(selected, "netMinor"));
        Assert.Equal(["2026-09"],
            before.GetProperty("availableMonths").EnumerateArray().Select(value => value.GetString()));
        Assert.Equal(IsolationLevel.RepeatableRead, gate.ObservedIsolation);
        Assert.True(gate.SawReadOnly);
        Assert.False(gate.SawTaggedWrite);

        var after = await ReadAsync(owner.Client);
        var next = after.GetProperty("selected");
        Assert.Equal("250000", Money(next, "cashInMinor"));
        Assert.Equal("250000", Money(next, "paycheckCashInMinor"));
        Assert.Equal("0", Money(next, "otherCashInMinor"));
        Assert.Equal("35000", Money(next, "spentMinor"));
        Assert.Equal("215000", Money(next, "netMinor"));
        Assert.Equal(["2026-09", "2026-02"],
            after.GetProperty("availableMonths").EnumerateArray().Select(value => value.GetString()));
    }

    private static async Task<JsonElement> ReadAsync(HttpClient client)
    {
        using var response = await client.GetAsync(Route);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static string? Money(JsonElement element, string field)
    {
        Assert.Equal(JsonValueKind.String, element.GetProperty(field).ValueKind);
        return element.GetProperty(field).GetString();
    }

    private static async Task<string> RecordStateAsync(BudgetContext db)
    {
        var inflows = await db.AccountInflows.AsNoTracking().OrderBy(value => value.Id).ToListAsync();
        var expenses = await db.Expenses.AsNoTracking().OrderBy(value => value.Id).ToListAsync();
        var profiles = await db.PaycheckProfiles.AsNoTracking().OrderBy(value => value.Id).ToListAsync();
        var occurrences = await db.PaycheckOccurrences.AsNoTracking().OrderBy(value => value.AccountInflowId).ToListAsync();
        return JsonSerializer.Serialize(new { inflows, expenses, profiles, occurrences });
    }

    private static PaycheckProfile NewProfile(string ownerId, PaycheckLifecycle lifecycle = PaycheckLifecycle.Active) => new()
    {
        Id = Guid.NewGuid(), OwnerId = ownerId, DisplayName = "Synthetic paycheck",
        Lifecycle = lifecycle, Cadence = PaycheckCadence.Monthly, FirstMonthAnchor = 1,
        AmountMode = PaycheckAmountMode.Fixed, ExpectedAmount = 1000m,
        CreatedAt = new(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc),
        UpdatedAt = new(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc)
    };

    private static PaycheckOccurrence Link(PaycheckProfile profile, AccountInflow inflow) => new()
    {
        OwnerId = inflow.OwnerId, PaycheckProfileId = profile.Id, AccountInflowId = inflow.Id,
        Kind = PaycheckOccurrenceKind.ConfirmationEvidence,
        EvidenceRevisionAtAssignment = inflow.PaycheckEvidenceRevision,
        SlotAnchor = inflow.Date, TimingOffsetDays = 0,
        LinkedAt = new(2026, 9, 3, 0, 0, 0, DateTimeKind.Utc)
    };

    private sealed class InterceptedApplication(SnapshotGate gate) : PostgreSqlFinancialApiTestApplication
    {
        protected override void ConfigureDatabase(IServiceCollection services) =>
            services.AddDbContext<BudgetContext>(options => options
                .UseNpgsql(Environment.GetEnvironmentVariable(ConnectionEnvironmentVariable))
                .AddInterceptors(gate));
    }

    private sealed class SnapshotGate : DbCommandInterceptor
    {
        private int _armed;
        public TaskCompletionSource Reached { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public IsolationLevel? ObservedIsolation { get; private set; }
        public bool SawReadOnly { get; private set; }
        public bool SawTaggedWrite { get; private set; }

        public void Arm() => Interlocked.Exchange(ref _armed, 1);

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("SET TRANSACTION READ ONLY", StringComparison.OrdinalIgnoreCase))
                SawReadOnly = true;
            if (command.CommandText.Contains("CashFlow:", StringComparison.Ordinal)) SawTaggedWrite = true;
            return ValueTask.FromResult(result);
        }

        public override async ValueTask<DbDataReader> ReaderExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, DbDataReader result,
            CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("CashFlow:inflows", StringComparison.Ordinal)
                && Interlocked.Exchange(ref _armed, 0) == 1)
            {
                ObservedIsolation = command.Transaction?.IsolationLevel;
                Reached.TrySetResult();
                await Release.Task.WaitAsync(TimeSpan.FromSeconds(20), cancellationToken);
            }
            return result;
        }
    }
}
