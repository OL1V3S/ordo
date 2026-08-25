using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BudgetPlanner.Data;
using BudgetPlanner.Import.Sunflower;
using BudgetPlanner.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using BudgetPlanner.Tests.Import.Fixtures.Sunflower;
using BudgetPlanner.Import;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace BudgetPlanner.Tests.Financial;

[Collection("Environment variable tests")]
[Trait("Category", "PostgreSQL")]
public sealed class PostgreSqlFinancialApiTests
{
    [PostgreSqlFact]
    public async Task Migration_chain_applies_to_empty_database_and_supports_identity()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var user = await app.CreateAuthenticatedUserAsync("migration@example.com");

        var definedMigrations = app.GetDefinedMigrations();
        var appliedMigrations = await app.GetAppliedMigrationsAsync();

        Assert.NotEmpty(definedMigrations);
        Assert.Equal(definedMigrations, appliedMigrations);

        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", context.Database.ProviderName);
        Assert.True(await context.Users.AnyAsync(candidate => candidate.Id == user.Id));
        Assert.False((await context.Database.GetPendingMigrationsAsync()).Any());

        await context.Database.OpenConnectionAsync();
        await using var command = context.Database.GetDbConnection().CreateCommand();
        command.CommandText =
            """
            SELECT data_type
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'Expenses'
              AND column_name = 'Date';
            """;
        Assert.Equal("date", await command.ExecuteScalarAsync());
    }

    [PostgreSqlFact]
    public async Task Expense_date_migration_preserves_the_utc_calendar_component()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var client = app.CreateTestClient();
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var migrator = context.GetService<IMigrator>();

        await context.Database.EnsureDeletedAsync();
        await migrator.MigrateAsync("20260812213613_PersistDataProtectionKeys");
        await context.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO "AspNetUsers"
                ("Id", "EmailConfirmed", "PhoneNumberConfirmed", "TwoFactorEnabled", "LockoutEnabled", "AccessFailedCount")
            VALUES
                ('date-migration-user', false, false, false, false, 0);

            INSERT INTO "Expenses" ("Description", "Amount", "Date", "Category", "UserId")
            VALUES ('month edge', 12.34, TIMESTAMPTZ '2026-08-31 00:00:00+00', 'food', 'date-migration-user');
            """);

        await migrator.MigrateAsync();

        var migratedDate = await context.Database
            .SqlQuery<DateOnly>($"SELECT \"Date\" AS \"Value\" FROM \"Expenses\"")
            .SingleAsync();
        Assert.Equal(new DateOnly(2026, 8, 31), migratedDate);
    }

    [PostgreSqlFact]
    public async Task Expense_overprecision_is_rejected_before_postgresql_can_round_it()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("expense-precision@example.com");

        var response = await owner.Client.PostAsJsonAsync("/api/expenses", new
        {
            description = "postgres precision",
            amount = 123.456m,
            date = "2026-08-15",
            category = "food"
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var read = await owner.Client.GetFromJsonAsync<JsonElement>("/api/expenses");
        Assert.Empty(read.EnumerateArray());
    }

    [PostgreSqlFact]
    public async Task Expense_crud_persists_valid_values_and_enforces_user_isolation()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("expense-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("expense-other@example.com");

        var createResponse = await owner.Client.PostAsJsonAsync("/api/expenses", new
        {
            description = " postgres expense ",
            amount = 123.45m,
            date = "2026-08-15",
            category = " Food "
        });
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        Assert.Equal(123.45m, created.GetProperty("amount").GetDecimal());
        Assert.Equal("postgres expense", created.GetProperty("description").GetString());
        Assert.Equal("food", created.GetProperty("category").GetString());
        Assert.False(created.TryGetProperty("userId", out _));
        Assert.False(created.TryGetProperty("user", out _));
        var id = created.GetProperty("id").GetInt32();

        var read = await owner.Client.GetFromJsonAsync<JsonElement>("/api/expenses");
        var readExpense = Assert.Single(read.EnumerateArray());
        Assert.Equal(id, readExpense.GetProperty("id").GetInt32());
        Assert.Equal(123.45m, readExpense.GetProperty("amount").GetDecimal());

        var forbiddenUpdate = await other.Client.PutAsJsonAsync($"/api/expenses/{id}", new
        {
            id,
            description = "not allowed",
            amount = 1m,
            date = "2026-08-16",
            category = "other"
        });
        Assert.Equal(HttpStatusCode.NotFound, forbiddenUpdate.StatusCode);

        var updateResponse = await owner.Client.PutAsJsonAsync($"/api/expenses/{id}", new
        {
            id,
            description = " updated postgres expense ",
            amount = 4.50m,
            date = "2026-09-03",
            category = " FOOD   MARKET "
        });
        Assert.Equal(HttpStatusCode.NoContent, updateResponse.StatusCode);

        var persisted = await app.FindExpenseAsync(id);
        Assert.NotNull(persisted);
        Assert.Equal(4.50m, persisted.Amount);
        Assert.Equal("updated postgres expense", persisted.Description);
        Assert.Equal("food market", persisted.Category);
        Assert.Equal(new DateOnly(2026, 9, 3), persisted.Date);

        var deleteResponse = await owner.Client.DeleteAsync($"/api/expenses/{id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);
        Assert.Null(await app.FindExpenseAsync(id));
    }

    [PostgreSqlFact]
    public async Task Import_preview_migration_persists_owned_batch_rows_without_creating_expenses()
    {
        await using var app = new PostgreSqlImportPreviewTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-preview@example.com");
        using var upload = new MultipartFormDataContent();
        upload.Add(new StringContent(SunflowerStatementParser.SourceType), "sourceType");
        upload.Add(new ByteArrayContent(SunflowerFixtureCorpus.CreateRepresentativePdf()), "file", "synthetic.pdf");

        var response = await owner.Client.PostAsync("/api/import-previews", upload);
        var preview = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.True(
            response.StatusCode == HttpStatusCode.Created,
            $"Expected preview creation, received {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var batchId = preview.GetProperty("batchId").GetGuid();
        var batch = await context.ImportPreviewBatches.AsNoTracking()
            .Include(value => value.Rows).SingleAsync(value => value.Id == batchId);
        Assert.Equal(owner.Id, batch.OwnerId);
        Assert.Equal(32, batch.DocumentDigest.Length);
        Assert.Equal(13, batch.Rows.Count);
        Assert.False(await context.Expenses.AnyAsync());

        var indexDefinition = await context.Database.SqlQueryRaw<string>(
            """
            SELECT indexdef AS "Value"
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname = 'IX_ImportPreviewBatches_OwnerId_SourceType_DocumentDigest'
            """).SingleAsync();
        Assert.Contains("\"OwnerId\", \"SourceType\", \"DocumentDigest\"", indexDefinition);
        Assert.Contains("WHERE", indexDefinition);
        Assert.Contains("\"Lifecycle\"", indexDefinition);
        Assert.Contains("'Open'", indexDefinition);
        Assert.DoesNotContain("ParserRuleVersion", indexDefinition);
    }

    [PostgreSqlFact]
    public async Task Concurrent_version_replacements_resolve_to_one_current_open_batch()
    {
        await using var app = new PostgreSqlConcurrentImportPreviewTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-preview-race@example.com");
        var pdf = SunflowerFixtureCorpus.CreateRepresentativePdf();
        var predecessor = await app.SeedImportPreviewBatchAsync(owner.Id, pdf, "sunflower-v1");

        async Task<ImportPreviewOperation> CreateAsync()
        {
            using var scope = app.Services.CreateScope();
            var service = scope.ServiceProvider.GetRequiredService<IImportPreviewService>();
            await using var stream = new MemoryStream(pdf, writable: false);
            return await service.CreateAsync(owner.Id, SunflowerStatementParser.SourceType, stream, pdf.Length, CancellationToken.None);
        }

        var firstTask = CreateAsync();
        var secondTask = CreateAsync();
        var results = await Task.WhenAll(firstTask, secondTask);

        Assert.All(results, result => Assert.True(result.IsSuccess));
        Assert.Single(results, result => result.Reused);
        Assert.Single(results, result => !result.Reused);
        var firstPreview = results[0].Preview!;
        var secondPreview = results[1].Preview!;
        Assert.Equal(firstPreview.BatchId, secondPreview.BatchId);
        Assert.Equal("sunflower-v3", firstPreview.ParserRuleVersion);

        var batches = await app.FindImportPreviewBatchesAsync(owner.Id);
        Assert.Equal(2, batches.Count);
        var stale = Assert.Single(batches, value => value.Id == predecessor.Id);
        Assert.Equal(ImportPreviewLifecycle.Expired, stale.Lifecycle);
        Assert.Equal("sunflower-v1", stale.ParserRuleVersion);
        var current = Assert.Single(batches, value => value.ParserRuleVersion == "sunflower-v3");
        Assert.Equal(ImportPreviewLifecycle.Open, current.Lifecycle);
        Assert.Equal(firstPreview.BatchId, current.Id);
        Assert.Equal(2, app.Extractor.CallCount);
        Assert.Equal(0, await app.CountExpensesAsync());
    }

    [PostgreSqlFact]
    public async Task Failed_replacement_insert_rolls_back_predecessor_supersession()
    {
        await using var app = new PostgreSqlImportPreviewTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-preview-rollback@example.com");
        var pdf = SunflowerFixtureCorpus.CreateRepresentativePdf();
        var predecessor = await app.SeedImportPreviewBatchAsync(owner.Id, pdf, "sunflower-v1");

        using (var setupScope = app.Services.CreateScope())
        {
            var setupContext = setupScope.ServiceProvider.GetRequiredService<BudgetContext>();
            await setupContext.Database.ExecuteSqlRawAsync(
                """
                CREATE FUNCTION reject_current_parser_preview() RETURNS trigger
                LANGUAGE plpgsql AS $function$
                BEGIN
                    IF NEW."ParserRuleVersion" = 'sunflower-v3' THEN
                        RAISE EXCEPTION 'intentional disposable-test insert rejection';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER reject_current_parser_preview_insert
                BEFORE INSERT ON "ImportPreviewBatches"
                FOR EACH ROW EXECUTE FUNCTION reject_current_parser_preview();
                """);
        }

        using (var scope = app.Services.CreateScope())
        {
            var service = scope.ServiceProvider.GetRequiredService<IImportPreviewService>();
            await using var stream = new MemoryStream(pdf, writable: false);
            await Assert.ThrowsAsync<DbUpdateException>(() =>
                service.CreateAsync(owner.Id, SunflowerStatementParser.SourceType, stream, pdf.Length, CancellationToken.None));
        }

        var batches = await app.FindImportPreviewBatchesAsync(owner.Id);
        var preserved = Assert.Single(batches);
        Assert.Equal(predecessor.Id, preserved.Id);
        Assert.Equal(ImportPreviewLifecycle.Open, preserved.Lifecycle);
        Assert.Equal("sunflower-v1", preserved.ParserRuleVersion);
        Assert.Equal(0, await app.CountExpensesAsync());
    }

    [PostgreSqlFact]
    public async Task Budget_create_read_upsert_and_delete_use_relational_month_query()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("budget-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("budget-other@example.com");

        var createResponse = await owner.Client.PostAsJsonAsync("/api/budgetlimits", new
        {
            category = "food",
            limitAmount = 125.505m,
            monthYear = "2026-08-23T14:30:00"
        });
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, createResponse.StatusCode);
        Assert.Equal(125.505m, created.GetProperty("limitAmount").GetDecimal());
        var id = created.GetProperty("id").GetInt32();

        await app.SeedBudgetLimitAsync(other.Id, "hidden", 999m);
        var read = await owner.Client.GetFromJsonAsync<JsonElement>(
            "/api/budgetlimits?monthYear=2026-08");
        var readLimit = Assert.Single(read.EnumerateArray());
        Assert.Equal(id, readLimit.GetProperty("id").GetInt32());
        Assert.Equal(125.51m, readLimit.GetProperty("limitAmount").GetDecimal());

        var upsertResponse = await owner.Client.PostAsJsonAsync("/api/budgetlimits", new
        {
            category = "food",
            limitAmount = 250m,
            monthYear = "2026-08-31"
        });
        var upserted = await upsertResponse.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, upsertResponse.StatusCode);
        Assert.Equal(id, upserted.GetProperty("id").GetInt32());
        var limits = await app.FindBudgetLimitsAsync(owner.Id, "food");
        var persisted = Assert.Single(limits);
        Assert.Equal(250m, persisted.LimitAmount);
        Assert.Equal(new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc), persisted.MonthYear);

        var deleteResponse = await owner.Client.DeleteAsync($"/api/budgetlimits/{id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);
        Assert.Empty(await app.FindBudgetLimitsAsync(owner.Id, "food"));
        Assert.Single(await app.FindBudgetLimitsAsync(other.Id, "hidden"));
    }
}

internal sealed class PostgreSqlImportPreviewTestApplication : PostgreSqlFinancialApiTestApplication
{
    protected override void ConfigureAdditionalServices(IServiceCollection services)
    {
        services.RemoveAll<IPdfTextExtractor>();
        services.AddSingleton<IPdfTextExtractor, BudgetPlanner.Tests.Import.ImmediateSyntheticExtractor>();
    }
}

internal sealed class PostgreSqlConcurrentImportPreviewTestApplication : PostgreSqlFinancialApiTestApplication
{
    public CoordinatedSyntheticExtractor Extractor =>
        Services.GetRequiredService<CoordinatedSyntheticExtractor>();

    protected override void ConfigureAdditionalServices(IServiceCollection services)
    {
        services.RemoveAll<IPdfTextExtractor>();
        services.AddSingleton<CoordinatedSyntheticExtractor>();
        services.AddSingleton<IPdfTextExtractor>(provider =>
            provider.GetRequiredService<CoordinatedSyntheticExtractor>());
    }
}

internal sealed class CoordinatedSyntheticExtractor : IPdfTextExtractor
{
    private readonly TaskCompletionSource _bothCallersReady =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly BudgetPlanner.Tests.Import.ImmediateSyntheticExtractor _inner = new();
    private int _callCount;

    public int CallCount => Volatile.Read(ref _callCount);

    public async Task<PdfTextExtractionOutcome> ExtractAsync(
        ReadOnlyMemory<byte> pdf,
        CancellationToken cancellationToken = default)
    {
        if (Interlocked.Increment(ref _callCount) == 2)
        {
            _bothCallersReady.TrySetResult();
        }

        await _bothCallersReady.Task.WaitAsync(cancellationToken);
        return await _inner.ExtractAsync(pdf, cancellationToken);
    }
}

internal sealed class PostgreSqlFactAttribute : FactAttribute
{
    public PostgreSqlFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(
            PostgreSqlFinancialApiTestApplication.ConnectionEnvironmentVariable)))
        {
            Skip = $"Set {PostgreSqlFinancialApiTestApplication.ConnectionEnvironmentVariable} to run PostgreSQL integration tests.";
        }
    }
}

public sealed class PostgreSqlDatabaseSafetyTests
{
    [Fact]
    public void Ci_connection_is_accepted()
    {
        PostgreSqlFinancialApiTestApplication.ValidateDestructiveDatabaseConnection(
            "Host=localhost;Database=budget_planner_ci;Username=test;Password=test");
    }

    [Theory]
    [InlineData("localhost")]
    [InlineData("127.0.0.1")]
    [InlineData("::1")]
    public void Local_test_designated_database_is_accepted(string host)
    {
        PostgreSqlFinancialApiTestApplication.ValidateDestructiveDatabaseConnection(
            $"Host={host};Database=budget_planner_test_safety;Username=test;Password=test");
    }

    [Fact]
    public void Remote_host_is_rejected()
    {
        var exception = Assert.Throws<InvalidOperationException>(() =>
            PostgreSqlFinancialApiTestApplication.ValidateDestructiveDatabaseConnection(
                "Host=example.neon.tech;Database=budget_planner_test_safety;Username=test;Password=test"));

        Assert.Contains("local disposable databases", exception.Message);
    }

    [Fact]
    public void Unsafe_database_name_is_rejected()
    {
        var exception = Assert.Throws<InvalidOperationException>(() =>
            PostgreSqlFinancialApiTestApplication.ValidateDestructiveDatabaseConnection(
                "Host=localhost;Database=budget_planner;Username=test;Password=test"));

        Assert.Contains("local disposable databases", exception.Message);
    }
}
