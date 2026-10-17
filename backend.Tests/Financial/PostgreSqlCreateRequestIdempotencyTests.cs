using System.Net;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

[Collection("Environment variable tests")]
[Trait("Category", "PostgreSQL")]
public sealed class PostgreSqlCreateRequestIdempotencyTests
{
    private const string PreviousMigration = "20261016190503_AddDeviceSessions";
    private const int Parallel = 8;

    private static string NewKey() => Guid.NewGuid().ToString();

    private static async Task<HttpResponseMessage[]> RaceAsync(IEnumerable<Func<Task<HttpResponseMessage>>> requests) =>
        await Task.WhenAll(requests.Select(request => Task.Run(request)));

    [PostgreSqlFact]
    public async Task Concurrent_identical_expense_requests_create_one_record()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("pg-idem-expense@example.com");
        var key = NewKey();

        var responses = await RaceAsync(Enumerable.Range(0, Parallel).Select(_ => (Func<Task<HttpResponseMessage>>)(() =>
            CreateRequestTestHttp.PostAsync(
                owner.Client, CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(), key))));

        Assert.Equal(1, responses.Count(r => r.StatusCode == HttpStatusCode.Created));
        Assert.Equal(Parallel - 1, responses.Count(r => r.StatusCode == HttpStatusCode.OK));
        var ids = new HashSet<int>();
        foreach (var response in responses) ids.Add(await CreateRequestTestHttp.IdAsync(response));
        Assert.Single(ids);
        Assert.Equal((1, 0, 1), await CreateRequestTestHttp.CountsAsync(app));
    }

    [PostgreSqlFact]
    public async Task Concurrent_identical_inflow_requests_create_one_record()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("pg-idem-inflow@example.com");
        var key = NewKey();

        var responses = await RaceAsync(Enumerable.Range(0, Parallel).Select(_ => (Func<Task<HttpResponseMessage>>)(() =>
            CreateRequestTestHttp.PostAsync(
                owner.Client, CreateRequestTestHttp.InflowsUrl, CreateRequestTestHttp.Inflow(), key))));

        Assert.Equal(1, responses.Count(r => r.StatusCode == HttpStatusCode.Created));
        Assert.Equal(Parallel - 1, responses.Count(r => r.StatusCode == HttpStatusCode.OK));
        var ids = new HashSet<int>();
        foreach (var response in responses) ids.Add(await CreateRequestTestHttp.IdAsync(response));
        Assert.Single(ids);
        Assert.Equal((0, 1, 1), await CreateRequestTestHttp.CountsAsync(app));
    }

    [PostgreSqlFact]
    public async Task Concurrent_requests_with_mixed_details_create_one_record()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("pg-idem-mixed@example.com");
        var key = NewKey();

        var responses = await RaceAsync(Enumerable.Range(0, Parallel).Select(i => (Func<Task<HttpResponseMessage>>)(() =>
            CreateRequestTestHttp.PostAsync(
                owner.Client,
                CreateRequestTestHttp.ExpensesUrl,
                CreateRequestTestHttp.Expense(amount: i % 2 == 0 ? "10.00" : "20.00"),
                key))));

        Assert.Equal(1, responses.Count(r => r.StatusCode == HttpStatusCode.Created));
        Assert.All(responses, r => Assert.Contains(
            r.StatusCode,
            new[] { HttpStatusCode.Created, HttpStatusCode.OK, HttpStatusCode.UnprocessableEntity }));
        Assert.Equal((1, 0, 1), await CreateRequestTestHttp.CountsAsync(app));
    }

    [PostgreSqlFact]
    public async Task Concurrent_same_key_for_two_users_creates_two_records()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var first = await app.CreateAuthenticatedUserAsync("pg-idem-user-a@example.com");
        using var second = await app.CreateAuthenticatedUserAsync("pg-idem-user-b@example.com");
        var key = NewKey();

        var responses = await RaceAsync(new[] { first, second }.SelectMany(user =>
            Enumerable.Range(0, 4).Select(_ => (Func<Task<HttpResponseMessage>>)(() =>
                CreateRequestTestHttp.PostAsync(
                    user.Client, CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(), key)))));

        Assert.Equal(2, responses.Count(r => r.StatusCode == HttpStatusCode.Created));
        Assert.Equal(6, responses.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.Equal((2, 0, 2), await CreateRequestTestHttp.CountsAsync(app));
    }

    [PostgreSqlFact]
    public async Task Concurrent_same_key_on_both_endpoints_creates_exactly_one_record()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("pg-idem-cross@example.com");
        var key = NewKey();

        var requests = Enumerable.Range(0, 4).SelectMany(_ => new[]
        {
            (Func<Task<HttpResponseMessage>>)(() => CreateRequestTestHttp.PostAsync(
                owner.Client, CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(), key)),
            () => CreateRequestTestHttp.PostAsync(
                owner.Client, CreateRequestTestHttp.InflowsUrl, CreateRequestTestHttp.Inflow(), key)
        });
        var responses = await RaceAsync(requests);

        Assert.Equal(1, responses.Count(r => r.StatusCode == HttpStatusCode.Created));
        Assert.All(responses, r => Assert.Contains(
            r.StatusCode,
            new[] { HttpStatusCode.Created, HttpStatusCode.OK, HttpStatusCode.UnprocessableEntity }));
        var (expenses, inflows, receipts) = await CreateRequestTestHttp.CountsAsync(app);
        Assert.Equal(1, expenses + inflows);
        Assert.Equal(1, receipts);
    }

    [PostgreSqlFact]
    public async Task Schema_has_the_approved_keys_checks_indexes_and_delete_rules()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var user = await app.CreateAuthenticatedUserAsync("pg-idem-schema@example.com");
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();

        var constraints = await context.Database.SqlQueryRaw<string>("""
            SELECT conname || ':' || contype::text AS "Value" FROM pg_constraint
            WHERE conrelid = '"CreateRequestReceipts"'::regclass
            """).ToListAsync();
        Assert.Contains("PK_CreateRequestReceipts:p", constraints);
        Assert.Contains("CK_CreateRequestReceipt_Kind:c", constraints);
        Assert.Contains("CK_CreateRequestReceipt_Fingerprint:c", constraints);
        Assert.Contains("CK_CreateRequestReceipt_KindLink:c", constraints);
        Assert.Contains("CK_CreateRequestReceipt_InflowOwner:c", constraints);

        var primaryKey = await context.Database.SqlQueryRaw<string>("""
            SELECT pg_get_constraintdef(oid) AS "Value" FROM pg_constraint
            WHERE conname = 'PK_CreateRequestReceipts'
            """).SingleAsync();
        Assert.Equal("PRIMARY KEY (\"OwnerId\", \"RequestKey\")", primaryKey);

        var indexes = await context.Database.SqlQueryRaw<string>("""
            SELECT indexdef AS "Value" FROM pg_indexes WHERE tablename = 'CreateRequestReceipts'
            """).ToListAsync();
        Assert.Contains(indexes, d => d.Contains("UNIQUE") && d.Contains("(\"ExpenseId\")")
            && d.Contains("WHERE (\"ExpenseId\" IS NOT NULL)"));
        Assert.Contains(indexes, d => d.Contains("UNIQUE") && d.Contains("(\"AccountInflowId\")")
            && d.Contains("WHERE (\"AccountInflowId\" IS NOT NULL)"));

        var deleteRules = await context.Database.SqlQueryRaw<string>("""
            SELECT constraint_name || ':' || delete_rule AS "Value"
            FROM information_schema.referential_constraints
            WHERE constraint_name LIKE 'FK_CreateRequestReceipts_%'
            """).ToListAsync();
        Assert.Contains("FK_CreateRequestReceipts_AspNetUsers_OwnerId:CASCADE", deleteRules);
        Assert.Contains("FK_CreateRequestReceipts_Expenses_ExpenseId:SET NULL", deleteRules);
        Assert.Contains("FK_CreateRequestReceipts_AccountInflow_Owner:SET NULL", deleteRules);
        Assert.False((await context.Database.GetPendingMigrationsAsync()).Any());
    }

    [PostgreSqlFact]
    public async Task Database_rejects_mismatched_inflow_owner_bad_kind_and_bad_fingerprint()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("pg-idem-check-a@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("pg-idem-check-b@example.com");
        var otherInflow = await app.SeedInflowAsync(other.Id);
        var ownerInflow = await app.SeedInflowAsync(owner.Id);
        var ownerExpense = await app.SeedExpenseAsync(owner.Id);

        var cases = new (string Constraint, Func<CreateRequestReceipt> Build)[]
        {
            ("CK_CreateRequestReceipt_InflowOwner", () => Receipt(owner.Id, CreateRequestReceipt.AccountInflowKind,
                r => { r.AccountInflowId = otherInflow.Id; r.AccountInflowOwnerId = other.Id; })),
            ("CK_CreateRequestReceipt_Kind", () => Receipt(owner.Id, "Other", _ => { })),
            ("CK_CreateRequestReceipt_Fingerprint", () => Receipt(owner.Id, CreateRequestReceipt.ExpenseKind,
                r => { r.RequestFingerprint = new byte[31]; r.ExpenseId = ownerExpense.Id; })),
            ("CK_CreateRequestReceipt_KindLink", () => Receipt(owner.Id, CreateRequestReceipt.ExpenseKind,
                r => { r.AccountInflowId = ownerInflow.Id; r.AccountInflowOwnerId = owner.Id; })),
            ("CK_CreateRequestReceipt_KindLink", () => Receipt(owner.Id, CreateRequestReceipt.AccountInflowKind,
                r => r.ExpenseId = ownerExpense.Id))
        };
        foreach (var (constraint, build) in cases)
        {
            using var scope = app.Services.CreateScope();
            var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            context.CreateRequestReceipts.Add(build());
            var failure = await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
            var pg = Assert.IsType<PostgresException>(failure.InnerException);
            Assert.Equal(constraint, pg.ConstraintName);
        }

        static CreateRequestReceipt Receipt(string ownerId, string kind, Action<CreateRequestReceipt> shape)
        {
            var receipt = new CreateRequestReceipt
            {
                OwnerId = ownerId,
                RequestKey = Guid.NewGuid(),
                RecordKind = kind,
                RequestFingerprint = new byte[32],
                CreatedAt = DateTime.UtcNow
            };
            shape(receipt);
            return receipt;
        }
    }

    [PostgreSqlFact]
    public async Task Deleting_the_record_nulls_the_link_without_breaking_checks_and_replay_is_409()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("pg-idem-delete@example.com");
        var expenseKey = NewKey();
        var inflowKey = NewKey();
        using var expense = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(), expenseKey);
        using var inflow = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.InflowsUrl, CreateRequestTestHttp.Inflow(), inflowKey);
        Assert.Equal(HttpStatusCode.Created, expense.StatusCode);
        Assert.Equal(HttpStatusCode.Created, inflow.StatusCode);
        using var deleteExpense = await owner.Client.DeleteAsync(
            $"/api/expenses/{await CreateRequestTestHttp.IdAsync(expense)}");
        using var deleteInflow = await owner.Client.DeleteAsync(
            $"/api/inflows/{await CreateRequestTestHttp.IdAsync(inflow)}");
        Assert.Equal(HttpStatusCode.NoContent, deleteExpense.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, deleteInflow.StatusCode);

        using (var scope = app.Services.CreateScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            var receipts = await context.CreateRequestReceipts.AsNoTracking().ToListAsync();
            Assert.Equal(2, receipts.Count);
            Assert.All(receipts, r =>
            {
                Assert.Null(r.ExpenseId);
                Assert.Null(r.AccountInflowId);
                Assert.Null(r.AccountInflowOwnerId);
            });
        }

        using var expenseReplay = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(), expenseKey);
        using var inflowReplay = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.InflowsUrl, CreateRequestTestHttp.Inflow(), inflowKey);
        Assert.Equal(HttpStatusCode.Conflict, expenseReplay.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, inflowReplay.StatusCode);
        Assert.Equal("idempotency_key_record_deleted", await CreateRequestTestHttp.CodeAsync(expenseReplay));
        Assert.Equal("idempotency_key_record_deleted", await CreateRequestTestHttp.CodeAsync(inflowReplay));
        Assert.Equal((0, 0, 2), await CreateRequestTestHttp.CountsAsync(app));
    }

    [PostgreSqlFact]
    public async Task Migration_is_additive_preserves_existing_rows_and_down_drops_the_table()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("pg-idem-migration@example.com");
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var migrator = context.GetService<IMigrator>();

        await migrator.MigrateAsync(PreviousMigration);
        Assert.Equal(0, await TableCountAsync(context));
        var expense = await app.SeedExpenseAsync(owner.Id, "before migration", 5.25m);
        var inflow = await app.SeedInflowAsync(owner.Id, "before migration", 99.50m);

        await context.Database.MigrateAsync();

        Assert.Equal(app.GetDefinedMigrations(), await app.GetAppliedMigrationsAsync());
        Assert.Equal(1, await TableCountAsync(context));
        var persistedExpense = await context.Expenses.AsNoTracking().SingleAsync();
        Assert.Equal(expense.Id, persistedExpense.Id);
        Assert.Equal("before migration", persistedExpense.Description);
        Assert.Equal(5.25m, persistedExpense.Amount);
        Assert.Equal(expense.CommitmentEvidenceRevision, persistedExpense.CommitmentEvidenceRevision);
        var persistedInflow = await context.AccountInflows.AsNoTracking().SingleAsync();
        Assert.Equal(inflow.Id, persistedInflow.Id);
        Assert.Equal(99.50m, persistedInflow.Amount);
        Assert.Equal(inflow.PaycheckEvidenceRevision, persistedInflow.PaycheckEvidenceRevision);
        Assert.Empty(await context.CreateRequestReceipts.ToListAsync());

        await migrator.MigrateAsync(PreviousMigration);
        Assert.Equal(0, await TableCountAsync(context));
        Assert.Equal(expense.Id, (await context.Expenses.AsNoTracking().SingleAsync()).Id);
        Assert.Equal(inflow.Id, (await context.AccountInflows.AsNoTracking().SingleAsync()).Id);

        static Task<int> TableCountAsync(BudgetContext db) => db.Database.SqlQueryRaw<int>("""
            SELECT count(*)::int AS "Value" FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'CreateRequestReceipts'
            """).SingleAsync();
    }
}
