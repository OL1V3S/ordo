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
using Npgsql;
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

        var expenseAmountType = await context.Database.SqlQueryRaw<string>(
            """
            SELECT data_type || ':' || numeric_precision || ':' || numeric_scale AS "Value"
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'Expenses'
              AND column_name = 'Amount'
            """).SingleAsync();
        Assert.Equal("numeric:18:2", expenseAmountType);

        var commitmentEvidenceRevision = await context.Database.SqlQueryRaw<string>(
            """
            SELECT data_type || ':' || is_nullable || ':' || (column_default LIKE '%gen_random_uuid%') AS "Value"
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'Expenses'
              AND column_name = 'CommitmentEvidenceRevision'
            """).SingleAsync();
        Assert.Equal("uuid:NO:true", commitmentEvidenceRevision);

        var confirmedAtType = await context.Database.SqlQueryRaw<string>(
            """
            SELECT data_type || ':' || is_nullable AS "Value"
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'ImportPreviewBatches'
              AND column_name = 'ConfirmedAt'
            """).SingleAsync();
        Assert.Equal("timestamp with time zone:YES", confirmedAtType);

        var provenanceColumns = await context.Database.SqlQueryRaw<string>(
            """
            SELECT column_name || ':' || data_type || ':' || is_nullable AS "Value"
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'ImportExpenseProvenances'
            ORDER BY ordinal_position
            """).ToListAsync();
        Assert.Equal(
            [
                "BatchId:uuid:NO",
                "SourceRowOrdinal:integer:NO",
                "ExpenseId:integer:YES"
            ],
            provenanceColumns);

        var batchConfirmationCheck = await ReadConstraintDefinitionAsync(
            context,
            "CK_ImportPreviewBatch_ConfirmedAt");
        Assert.StartsWith("CHECK", batchConfirmationCheck);
        Assert.Contains("\"Lifecycle\"", batchConfirmationCheck);
        Assert.Contains("'Confirmed'", batchConfirmationCheck);
        Assert.Contains("\"ConfirmedAt\" IS NOT NULL", batchConfirmationCheck);
        Assert.Contains("\"ConfirmedAt\" IS NULL", batchConfirmationCheck);

        var positiveOrdinalCheck = await ReadConstraintDefinitionAsync(
            context,
            "CK_ImportExpenseProvenance_PositiveSourceRowOrdinal");
        Assert.Contains("\"SourceRowOrdinal\" > 0", positiveOrdinalCheck);

        var provenancePrimaryKey = await ReadConstraintDefinitionAsync(
            context,
            "PK_ImportExpenseProvenances");
        Assert.Equal("PRIMARY KEY (\"BatchId\", \"SourceRowOrdinal\")", provenancePrimaryKey);

        var batchForeignKey = await ReadConstraintDefinitionAsync(
            context,
            "FK_ImportExpenseProvenances_ImportPreviewBatches_BatchId");
        Assert.Contains("FOREIGN KEY (\"BatchId\")", batchForeignKey);
        Assert.Contains("REFERENCES \"ImportPreviewBatches\"(\"Id\")", batchForeignKey);
        Assert.EndsWith("ON DELETE CASCADE", batchForeignKey);

        var expenseForeignKey = await ReadConstraintDefinitionAsync(
            context,
            "FK_ImportExpenseProvenances_Expenses_ExpenseId");
        Assert.Contains("FOREIGN KEY (\"ExpenseId\")", expenseForeignKey);
        Assert.Contains("REFERENCES \"Expenses\"(\"Id\")", expenseForeignKey);
        Assert.EndsWith("ON DELETE SET NULL", expenseForeignKey);

        var confirmedDocumentIndex = await ReadIndexDefinitionAsync(
            context,
            "IX_ImportPreviewBatches_ConfirmedDocument");
        Assert.Contains("CREATE UNIQUE INDEX", confirmedDocumentIndex);
        Assert.Contains(
            "(\"OwnerId\", \"SourceType\", \"ParserRuleVersion\", \"DocumentDigest\")",
            confirmedDocumentIndex);
        Assert.Contains("WHERE", confirmedDocumentIndex);
        Assert.Contains("\"Lifecycle\"", confirmedDocumentIndex);
        Assert.Contains("'Confirmed'", confirmedDocumentIndex);

        var activeDocumentIndex = await ReadIndexDefinitionAsync(
            context,
            "IX_ImportPreviewBatches_ActiveDocument");
        Assert.Contains("CREATE UNIQUE INDEX", activeDocumentIndex);
        Assert.Contains(
            "(\"OwnerId\", \"SourceType\", \"ParserRuleVersion\", \"DocumentDigest\")",
            activeDocumentIndex);
        Assert.Contains("WHERE", activeDocumentIndex);
        Assert.Contains("\"Lifecycle\"", activeDocumentIndex);
        Assert.Contains("'Open'", activeDocumentIndex);
        Assert.Contains("'Confirmed'", activeDocumentIndex);

        var provenanceExpenseIndex = await ReadIndexDefinitionAsync(
            context,
            "IX_ImportExpenseProvenances_ExpenseId");
        Assert.Contains("CREATE UNIQUE INDEX", provenanceExpenseIndex);
        Assert.Contains("(\"ExpenseId\")", provenanceExpenseIndex);
        Assert.Contains("WHERE (\"ExpenseId\" IS NOT NULL)", provenanceExpenseIndex);

        var inflowAmountType = await context.Database.SqlQueryRaw<string>(
            """
            SELECT data_type || ':' || numeric_precision || ':' || numeric_scale AS "Value"
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'AccountInflows'
              AND column_name = 'Amount'
            """).SingleAsync();
        Assert.Equal("numeric:18:2", inflowAmountType);

        var inflowDateType = await context.Database.SqlQueryRaw<string>(
            """
            SELECT data_type AS "Value"
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'AccountInflows'
              AND column_name = 'Date'
            """).SingleAsync();
        Assert.Equal("date", inflowDateType);

        var paycheckEvidenceRevision = await context.Database.SqlQueryRaw<string>(
            """
            SELECT data_type || ':' || is_nullable || ':' || (column_default LIKE '%gen_random_uuid%') AS "Value"
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'AccountInflows'
              AND column_name = 'PaycheckEvidenceRevision'
            """).SingleAsync();
        Assert.Equal("uuid:NO:true", paycheckEvidenceRevision);

        Assert.Contains("\"Amount\" >", await ReadConstraintDefinitionAsync(
            context,
            "CK_AccountInflow_PositiveAmount"));
        var inflowDescriptionCheck = await ReadConstraintDefinitionAsync(
            context,
            "CK_AccountInflow_Description");
        Assert.Contains("btrim", inflowDescriptionCheck);
        Assert.Contains("\"Description\"", inflowDescriptionCheck);
        Assert.Contains("ON DELETE CASCADE", await ReadConstraintDefinitionAsync(
            context,
            "FK_AccountInflows_AspNetUsers_OwnerId"));

        var inflowOwnerDateIndex = await ReadIndexDefinitionAsync(
            context,
            "IX_AccountInflows_OwnerId_Date");
        Assert.Contains("CREATE INDEX", inflowOwnerDateIndex);
        Assert.Contains("(\"OwnerId\", \"Date\")", inflowOwnerDateIndex);

        var inflowProvenanceColumns = await context.Database.SqlQueryRaw<string>(
            """
            SELECT column_name || ':' || data_type || ':' || is_nullable AS "Value"
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'ImportInflowProvenances'
            ORDER BY ordinal_position
            """).ToListAsync();
        Assert.Equal(
            [
                "BatchId:uuid:NO",
                "SourceRowOrdinal:integer:NO",
                "OwnerId:text:NO",
                "AccountInflowId:integer:YES",
                "AccountInflowOwnerId:text:YES"
            ],
            inflowProvenanceColumns);
        Assert.Equal(
            "PRIMARY KEY (\"BatchId\", \"SourceRowOrdinal\")",
            await ReadConstraintDefinitionAsync(context, "PK_ImportInflowProvenances"));
        Assert.Contains("ON DELETE CASCADE", await ReadConstraintDefinitionAsync(
            context,
            "FK_ImportInflowProvenance_Batch_Owner"));
        Assert.Contains("ON DELETE SET NULL", await ReadConstraintDefinitionAsync(
            context,
            "FK_ImportInflowProvenance_AccountInflow_Owner"));
        Assert.Contains("\"AccountInflowOwnerId\" = \"OwnerId\"", await ReadConstraintDefinitionAsync(
            context,
            "CK_ImportInflowProvenance_OwnerConsistency"));
        var inflowProvenanceIndex = await ReadIndexDefinitionAsync(
            context,
            "IX_ImportInflowProvenances_AccountInflowId");
        Assert.Contains("CREATE UNIQUE INDEX", inflowProvenanceIndex);
        Assert.Contains("(\"AccountInflowId\")", inflowProvenanceIndex);
        Assert.Contains("WHERE (\"AccountInflowId\" IS NOT NULL)", inflowProvenanceIndex);

        Assert.Contains("CHECK", await ReadConstraintDefinitionAsync(context, "CK_Commitment_Timing"));
        Assert.Contains("CHECK", await ReadConstraintDefinitionAsync(context, "CK_Commitment_Amount"));
        Assert.Contains("ON DELETE CASCADE", await ReadConstraintDefinitionAsync(
            context,
            "FK_CommitmentOccurrences_Expenses_ExpenseId"));
        Assert.Contains("CREATE UNIQUE INDEX", await ReadIndexDefinitionAsync(
            context,
            "UX_Commitments_Owner_OriginFingerprint"));
        Assert.Contains("CREATE UNIQUE INDEX", await ReadIndexDefinitionAsync(
            context,
            "UX_CandidateDismissals_Owner_Origin"));
        Assert.Contains("CHECK", await ReadConstraintDefinitionAsync(
            context,
            "CK_CommitmentChangeDismissal_AlgorithmVersion"));
        Assert.Contains("CHECK", await ReadConstraintDefinitionAsync(
            context,
            "CK_CommitmentChangeDismissal_Dimension"));
        Assert.Contains("CHECK", await ReadConstraintDefinitionAsync(
            context,
            "CK_CommitmentChangeDismissal_FingerprintLength"));
        Assert.Contains("ON DELETE CASCADE", await ReadConstraintDefinitionAsync(
            context,
            "FK_CommitmentChangeDismissals_AspNetUsers_OwnerId"));
        Assert.Contains("ON DELETE CASCADE", await ReadConstraintDefinitionAsync(
            context,
            "FK_CommitmentChangeDismissals_Commitments_CommitmentId_OwnerId"));
        Assert.Equal("UNIQUE (\"Id\", \"OwnerId\")", await ReadConstraintDefinitionAsync(
            context,
            "AK_Commitments_Id_OwnerId"));
        var changeDismissalLookupIndex = await ReadIndexDefinitionAsync(
            context,
            "IX_CommitmentChangeDismissals_Owner_Commitment");
        Assert.Contains("CREATE INDEX", changeDismissalLookupIndex);
        Assert.Contains("(\"OwnerId\", \"CommitmentId\")", changeDismissalLookupIndex);
        var changeDismissalUniqueIndex = await ReadIndexDefinitionAsync(
            context,
            "UX_CommitmentChangeDismissals_Owner_Assessment");
        Assert.Contains("CREATE UNIQUE INDEX", changeDismissalUniqueIndex);
        Assert.Contains(
            "(\"OwnerId\", \"CommitmentId\", \"AlgorithmVersion\", \"Dimension\", \"EvidenceFingerprint\")",
            changeDismissalUniqueIndex);
    }

    [PostgreSqlFact]
    public async Task Account_inflow_foundation_migration_upgrades_additively()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var client = app.CreateTestClient();
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var migrator = context.GetService<IMigrator>();

        await context.Database.EnsureDeletedAsync();
        await migrator.MigrateAsync("20260830053939_AddCommitmentChangeDismissals");
        await context.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO "AspNetUsers"
                ("Id", "EmailConfirmed", "PhoneNumberConfirmed", "TwoFactorEnabled", "LockoutEnabled", "AccessFailedCount")
            VALUES
                ('account-inflow-migration-user', false, false, false, false, 0);

            INSERT INTO "Expenses" ("Description", "Amount", "Date", "Category", "UserId")
            VALUES
                ('existing expense', 10.00, DATE '2026-09-01', 'food', 'account-inflow-migration-user');
            """);

        await migrator.MigrateAsync();

        Assert.True(await context.Users.AnyAsync(value => value.Id == "account-inflow-migration-user"));
        Assert.True(await context.Expenses.AnyAsync(value => value.UserId == "account-inflow-migration-user"));
        Assert.Empty(await context.AccountInflows.ToListAsync());
        Assert.Empty(await context.ImportInflowProvenances.ToListAsync());
        Assert.False((await context.Database.GetPendingMigrationsAsync()).Any());
    }

    [PostgreSqlFact]
    public async Task Account_inflow_foundation_enforces_constraints_provenance_and_safe_rollback()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("account-inflow-owner@example.com");
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var now = DateTime.UtcNow;
        var batch = new ImportPreviewBatch
        {
            Id = Guid.NewGuid(),
            OwnerId = owner.Id,
            SourceType = SunflowerStatementParser.SourceType,
            ParserRuleVersion = SunflowerStatementParser.RuleVersion,
            DocumentDigest = Enumerable.Repeat((byte)1, 32).ToArray(),
            CreatedAt = now,
            ExpiresAt = now.AddMinutes(30),
            Lifecycle = ImportPreviewLifecycle.Open
        };
        var inflow = new AccountInflow
        {
            OwnerId = owner.Id,
            Description = "SYNTHETIC PAYROLL DEPOSIT",
            Amount = 2450m,
            Date = new DateOnly(2026, 9, 1)
        };
        batch.InflowProvenance.Add(new ImportInflowProvenance
        {
            SourceRowOrdinal = 1,
            AccountInflow = inflow
        });
        context.ImportPreviewBatches.Add(batch);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var persisted = await context.AccountInflows.AsNoTracking().SingleAsync();
        Assert.Equal(owner.Id, persisted.OwnerId);
        Assert.Equal(2450m, persisted.Amount);
        Assert.Equal(new DateOnly(2026, 9, 1), persisted.Date);
        Assert.NotEqual(Guid.Empty, persisted.PaycheckEvidenceRevision);

        using var otherOwner = await app.CreateAuthenticatedUserAsync("account-inflow-other-owner@example.com");
        var otherOwnerInflow = new AccountInflow
        {
            OwnerId = otherOwner.Id,
            Description = "OTHER OWNER DEPOSIT",
            Amount = 500m,
            Date = new DateOnly(2026, 9, 1)
        };
        context.AccountInflows.Add(otherOwnerInflow);
        await context.SaveChangesAsync();

        var crossOwnerLink = await Assert.ThrowsAsync<PostgresException>(() =>
            context.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO "ImportInflowProvenances"
                    ("BatchId", "SourceRowOrdinal", "OwnerId", "AccountInflowId", "AccountInflowOwnerId")
                VALUES ({batch.Id}, {2}, {owner.Id}, {otherOwnerInflow.Id}, {otherOwner.Id})
                """));
        Assert.Equal(PostgresErrorCodes.CheckViolation, crossOwnerLink.SqlState);
        Assert.Equal("CK_ImportInflowProvenance_OwnerConsistency", crossOwnerLink.ConstraintName);
        context.AccountInflows.Remove(otherOwnerInflow);
        await context.SaveChangesAsync();

        Task InsertInflowAsync(string description, decimal amount) =>
            context.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO "AccountInflows" ("OwnerId", "Description", "Amount", "Date")
                VALUES ({owner.Id}, {description}, {amount}, DATE '2026-09-02')
                """);

        var nonPositive = await Assert.ThrowsAsync<PostgresException>(() =>
            InsertInflowAsync("invalid amount", 0m));
        Assert.Equal(PostgresErrorCodes.CheckViolation, nonPositive.SqlState);
        Assert.Equal("CK_AccountInflow_PositiveAmount", nonPositive.ConstraintName);

        var blankDescription = await Assert.ThrowsAsync<PostgresException>(() =>
            InsertInflowAsync("   ", 1m));
        Assert.Equal(PostgresErrorCodes.CheckViolation, blankDescription.SqlState);
        Assert.Equal("CK_AccountInflow_Description", blankDescription.ConstraintName);

        var invalidOrdinal = await Assert.ThrowsAsync<PostgresException>(() =>
            context.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO "ImportInflowProvenances"
                    ("BatchId", "SourceRowOrdinal", "OwnerId", "AccountInflowId", "AccountInflowOwnerId")
                VALUES ({batch.Id}, {0}, {owner.Id}, {persisted.Id}, {owner.Id})
                """));
        Assert.Equal(PostgresErrorCodes.CheckViolation, invalidOrdinal.SqlState);
        Assert.Equal("CK_ImportInflowProvenance_PositiveSourceRowOrdinal", invalidOrdinal.ConstraintName);

        var duplicateLink = await Assert.ThrowsAsync<PostgresException>(() =>
            context.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO "ImportInflowProvenances"
                    ("BatchId", "SourceRowOrdinal", "OwnerId", "AccountInflowId", "AccountInflowOwnerId")
                VALUES ({batch.Id}, {2}, {owner.Id}, {persisted.Id}, {owner.Id})
                """));
        Assert.Equal(PostgresErrorCodes.UniqueViolation, duplicateLink.SqlState);
        Assert.Equal("IX_ImportInflowProvenances_AccountInflowId", duplicateLink.ConstraintName);

        var migrator = context.GetService<IMigrator>();
        var rollback = await Assert.ThrowsAsync<PostgresException>(() =>
            migrator.MigrateAsync("20260830053939_AddCommitmentChangeDismissals"));
        Assert.Contains("Cannot roll back account inflow foundation", rollback.MessageText);
        Assert.Single(await context.AccountInflows.AsNoTracking().ToListAsync());

        context.AccountInflows.Remove(await context.AccountInflows.SingleAsync());
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var retainedProvenance = await context.ImportInflowProvenances.AsNoTracking().SingleAsync();
        Assert.Equal(owner.Id, retainedProvenance.OwnerId);
        Assert.Null(retainedProvenance.AccountInflowId);
        Assert.Null(retainedProvenance.AccountInflowOwnerId);

        var secondInflow = new AccountInflow
        {
            OwnerId = owner.Id,
            Description = "SECOND SYNTHETIC DEPOSIT",
            Amount = 100m,
            Date = new DateOnly(2026, 9, 2)
        };
        context.AccountInflows.Add(secondInflow);
        context.ImportInflowProvenances.Add(new ImportInflowProvenance
        {
            BatchId = batch.Id,
            OwnerId = owner.Id,
            SourceRowOrdinal = 2,
            AccountInflow = secondInflow
        });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        context.ImportPreviewBatches.Remove(await context.ImportPreviewBatches.SingleAsync());
        await context.SaveChangesAsync();
        Assert.Empty(await context.ImportInflowProvenances.AsNoTracking().ToListAsync());
        Assert.Single(await context.AccountInflows.AsNoTracking().ToListAsync());

        context.Users.Remove(await context.Users.SingleAsync(value => value.Id == owner.Id));
        await context.SaveChangesAsync();
        Assert.Empty(await context.AccountInflows.AsNoTracking().ToListAsync());
    }

    [PostgreSqlFact]
    public async Task Commitment_foundation_migration_backfills_distinct_expense_revisions()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var client = app.CreateTestClient();
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var migrator = context.GetService<IMigrator>();

        await context.Database.EnsureDeletedAsync();
        await migrator.MigrateAsync("20260825155557_AddImportConfirmation");
        await context.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO "AspNetUsers"
                ("Id", "EmailConfirmed", "PhoneNumberConfirmed", "TwoFactorEnabled", "LockoutEnabled", "AccessFailedCount")
            VALUES
                ('commitment-migration-user', false, false, false, false, 0);

            INSERT INTO "Expenses" ("Description", "Amount", "Date", "Category", "UserId")
            VALUES
                ('first', 10.00, DATE '2026-01-01', 'food', 'commitment-migration-user'),
                ('second', 20.00, DATE '2026-02-01', 'food', 'commitment-migration-user');
            """);

        await migrator.MigrateAsync();

        var revisionSummary = await context.Database.SqlQueryRaw<string>(
            """
            SELECT count(*) || ':' || count(DISTINCT "CommitmentEvidenceRevision") AS "Value"
            FROM "Expenses"
            WHERE "UserId" = 'commitment-migration-user'
            """).SingleAsync();
        Assert.Equal("2:2", revisionSummary);
    }

    [PostgreSqlFact]
    public async Task Commitment_change_dismissal_migration_upgrades_stage_two_additively()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var client = app.CreateTestClient();
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var migrator = context.GetService<IMigrator>();

        await context.Database.EnsureDeletedAsync();
        await migrator.MigrateAsync("20260826174557_AddCommitmentFoundation");
        var commitmentId = Guid.NewGuid();
        var now = DateTime.UtcNow;
        await context.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO "AspNetUsers"
                ("Id", "EmailConfirmed", "PhoneNumberConfirmed", "TwoFactorEnabled", "LockoutEnabled", "AccessFailedCount")
            VALUES
                ({"stage-two-owner"}, false, false, false, false, 0);

            INSERT INTO "Commitments"
                ("Id", "OwnerId", "Name", "Category", "Lifecycle", "Cadence", "TimingKind",
                 "ExpectedDay", "WindowBeforeDays", "WindowAfterDays", "AmountMode",
                 "ExpectedAmount", "CreatedAt", "UpdatedAt")
            VALUES
                ({commitmentId}, {"stage-two-owner"}, 'Stage two commitment', 'bills', 'Active', 'Monthly',
                 'DayOfMonth', 1, 0, 2, 'Fixed', 25.00, {now}, {now});
            """);

        await migrator.MigrateAsync();

        Assert.True(await context.Users.AnyAsync(value => value.Id == "stage-two-owner"));
        Assert.True(await context.Commitments.AnyAsync(value => value.Id == commitmentId));
        Assert.Empty(await context.CommitmentChangeDismissals.ToListAsync());
        Assert.False((await context.Database.GetPendingMigrationsAsync()).Any());
    }

    [PostgreSqlFact]
    public async Task Commitment_change_dismissals_enforce_constraints_uniqueness_and_cascades()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("change-dismissal-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("change-dismissal-other@example.com");
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var now = DateTime.UtcNow;

        Commitment NewCommitment(string ownerId, string name) => new()
        {
            Id = Guid.NewGuid(),
            OwnerId = ownerId,
            Name = name,
            Category = "bills",
            Lifecycle = CommitmentLifecycle.Active,
            Cadence = CommitmentCadence.Monthly,
            TimingKind = CommitmentTimingKind.DayOfMonth,
            ExpectedDay = 1,
            WindowBeforeDays = 0,
            WindowAfterDays = 2,
            AmountMode = CommitmentAmountMode.Fixed,
            ExpectedAmount = 25m,
            CreatedAt = now,
            UpdatedAt = now
        };

        var first = NewCommitment(owner.Id, "First");
        var second = NewCommitment(owner.Id, "Second");
        var otherCommitment = NewCommitment(other.Id, "Other");
        context.Commitments.AddRange(first, second, otherCommitment);
        await context.SaveChangesAsync();

        Task InsertAsync(
            string ownerId,
            Guid commitmentId,
            string algorithmVersion,
            string dimension,
            byte[] fingerprint) => context.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO "CommitmentChangeDismissals"
                    ("Id", "OwnerId", "CommitmentId", "AlgorithmVersion", "Dimension",
                     "EvidenceFingerprint", "DismissedAt")
                VALUES
                    ({Guid.NewGuid()}, {ownerId}, {commitmentId}, {algorithmVersion}, {dimension},
                     {fingerprint}, {now})
                """);

        var fingerprint = Enumerable.Repeat((byte)1, 32).ToArray();
        await InsertAsync(owner.Id, first.Id, "commitment-change-v1", "Amount", fingerprint);
        await InsertAsync(owner.Id, first.Id, "commitment-change-v1", "Timing", fingerprint);
        await InsertAsync(owner.Id, second.Id, "commitment-change-v1", "Missing", fingerprint);
        await InsertAsync(other.Id, otherCommitment.Id, "commitment-change-v1", "Amount", fingerprint);

        var crossOwner = await Assert.ThrowsAsync<PostgresException>(() => InsertAsync(
            owner.Id,
            otherCommitment.Id,
            "commitment-change-v1",
            "Amount",
            Enumerable.Repeat((byte)2, 32).ToArray()));
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, crossOwner.SqlState);
        Assert.Equal(
            "FK_CommitmentChangeDismissals_Commitments_CommitmentId_OwnerId",
            crossOwner.ConstraintName);

        var malformedRows = new[]
        {
            (Algorithm: " ", Dimension: "Amount", Fingerprint: new byte[32], Constraint: "CK_CommitmentChangeDismissal_AlgorithmVersion"),
            (Algorithm: "commitment-change-v1", Dimension: "Unknown", Fingerprint: new byte[32], Constraint: "CK_CommitmentChangeDismissal_Dimension"),
            (Algorithm: "commitment-change-v1", Dimension: "Amount", Fingerprint: new byte[31], Constraint: "CK_CommitmentChangeDismissal_FingerprintLength")
        };

        foreach (var malformed in malformedRows)
        {
            var exception = await Assert.ThrowsAsync<PostgresException>(() => InsertAsync(
                owner.Id,
                first.Id,
                malformed.Algorithm,
                malformed.Dimension,
                malformed.Fingerprint));
            Assert.Equal(PostgresErrorCodes.CheckViolation, exception.SqlState);
            Assert.Equal(malformed.Constraint, exception.ConstraintName);
        }

        var duplicate = await Assert.ThrowsAsync<PostgresException>(() => InsertAsync(
            owner.Id,
            first.Id,
            "commitment-change-v1",
            "Amount",
            fingerprint));
        Assert.Equal(PostgresErrorCodes.UniqueViolation, duplicate.SqlState);
        Assert.Equal("UX_CommitmentChangeDismissals_Owner_Assessment", duplicate.ConstraintName);

        var migrator = context.GetService<IMigrator>();
        var rollback = await Assert.ThrowsAsync<PostgresException>(() =>
            migrator.MigrateAsync("20260826174557_AddCommitmentFoundation"));
        Assert.Contains("Cannot roll back commitment change dismissals", rollback.MessageText);
        Assert.Equal(4, await context.CommitmentChangeDismissals.CountAsync());

        context.Commitments.Remove(first);
        await context.SaveChangesAsync();
        Assert.False(await context.CommitmentChangeDismissals.AnyAsync(
            value => value.CommitmentId == first.Id));
        Assert.True(await context.CommitmentChangeDismissals.AnyAsync(
            value => value.CommitmentId == second.Id));

        context.Users.Remove(await context.Users.SingleAsync(value => value.Id == other.Id));
        await context.SaveChangesAsync();
        Assert.False(await context.Commitments.AnyAsync(value => value.Id == otherCommitment.Id));
        Assert.False(await context.CommitmentChangeDismissals.AnyAsync(value => value.OwnerId == other.Id));
    }

    [PostgreSqlFact]
    public async Task Deleting_confirmation_expense_removes_link_but_preserves_commitment()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("commitment-link@example.com");
        var expense = await app.SeedExpenseAsync(owner.Id, "membership", 25m, category: "bills");
        var commitmentId = Guid.NewGuid();

        using (var setupScope = app.Services.CreateScope())
        {
            var setupContext = setupScope.ServiceProvider.GetRequiredService<BudgetContext>();
            var now = DateTime.UtcNow;
            setupContext.Commitments.Add(new Commitment
            {
                Id = commitmentId,
                OwnerId = owner.Id,
                Name = "Membership",
                Category = "bills",
                Lifecycle = CommitmentLifecycle.Active,
                Cadence = CommitmentCadence.Monthly,
                TimingKind = CommitmentTimingKind.DayOfMonth,
                ExpectedDay = 12,
                WindowBeforeDays = 2,
                WindowAfterDays = 2,
                AmountMode = CommitmentAmountMode.Fixed,
                ExpectedAmount = 25m,
                CreatedAt = now,
                UpdatedAt = now,
                Occurrences =
                [
                    new CommitmentOccurrence
                    {
                        ExpenseId = expense.Id,
                        Kind = CommitmentOccurrenceKind.ConfirmationEvidence,
                        LinkedAt = now
                    }
                ]
            });
            await setupContext.SaveChangesAsync();
        }

        using var response = await owner.Client.DeleteAsync($"/api/expenses/{expense.Id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        using var assertionScope = app.Services.CreateScope();
        var assertionContext = assertionScope.ServiceProvider.GetRequiredService<BudgetContext>();
        Assert.True(await assertionContext.Commitments.AnyAsync(value => value.Id == commitmentId));
        Assert.False(await assertionContext.CommitmentOccurrences.AnyAsync(
            value => value.CommitmentId == commitmentId));
    }

    [PostgreSqlFact]
    public async Task Commitment_amount_constraint_accepts_valid_shapes_and_rejects_malformed_shapes()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("commitment-amount@example.com");
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var now = DateTime.UtcNow;

        Task InsertAsync(string mode, decimal? expected, decimal? minimum, decimal? maximum) =>
            context.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO "Commitments"
                    ("Id", "OwnerId", "Name", "Category", "Lifecycle", "Cadence", "TimingKind",
                     "ExpectedDay", "WindowBeforeDays", "WindowAfterDays", "AmountMode",
                     "ExpectedAmount", "ExpectedMinimumAmount", "ExpectedMaximumAmount", "CreatedAt", "UpdatedAt")
                VALUES
                    ({Guid.NewGuid()}, {owner.Id}, 'Amount constraint', 'bills', 'Active', 'Monthly', 'DayOfMonth',
                     1, 0, 0, {mode}, {expected}, {minimum}, {maximum}, {now}, {now})
                """);

        await InsertAsync("Fixed", 10m, null, null);
        await InsertAsync("Range", null, 5m, 15m);

        var malformedShapes = new (string Mode, decimal? Expected, decimal? Minimum, decimal? Maximum)[]
        {
            ("Fixed", null, null, null),
            ("Fixed", 10m, 5m, null),
            ("Range", 10m, 5m, 15m),
            ("Range", null, null, 15m),
            ("Range", null, 5m, null),
            ("Range", null, 0m, 15m),
            ("Range", null, 15m, 5m)
        };

        foreach (var shape in malformedShapes)
        {
            var exception = await Assert.ThrowsAsync<PostgresException>(() =>
                InsertAsync(shape.Mode, shape.Expected, shape.Minimum, shape.Maximum));
            Assert.Equal(PostgresErrorCodes.CheckViolation, exception.SqlState);
            Assert.Equal("CK_Commitment_Amount", exception.ConstraintName);
        }

        Assert.Equal(2, await context.Commitments.CountAsync());
    }

    [PostgreSqlFact]
    public async Task Commitment_timing_and_origin_constraints_reject_partial_nullable_shapes()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("commitment-shapes@example.com");
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();

        Commitment ValidCommitment() => new()
        {
            Id = Guid.NewGuid(),
            OwnerId = owner.Id,
            Name = "Constraint shape",
            Category = "bills",
            Lifecycle = CommitmentLifecycle.Active,
            Cadence = CommitmentCadence.Monthly,
            TimingKind = CommitmentTimingKind.DayOfMonth,
            ExpectedDay = 15,
            WindowBeforeDays = 0,
            WindowAfterDays = 0,
            AmountMode = CommitmentAmountMode.Fixed,
            ExpectedAmount = 10m,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        var weekly = ValidCommitment();
        weekly.Cadence = CommitmentCadence.Weekly;
        weekly.TimingKind = CommitmentTimingKind.Weekday;
        weekly.ExpectedDay = null;
        weekly.ExpectedDayOfWeek = DayOfWeek.Monday;
        var monthEnd = ValidCommitment();
        monthEnd.TimingKind = CommitmentTimingKind.MonthEnd;
        monthEnd.ExpectedDay = null;
        var yearly = ValidCommitment();
        yearly.Cadence = CommitmentCadence.Yearly;
        yearly.TimingKind = CommitmentTimingKind.MonthAndDay;
        yearly.ExpectedMonth = 2;
        yearly.ExpectedDay = 29;
        var withOrigin = ValidCommitment();
        withOrigin.OriginAlgorithmVersion = "commitment-v1";
        withOrigin.OriginEvidenceFingerprint = Enumerable.Repeat((byte)1, 32).ToArray();

        context.Commitments.AddRange(ValidCommitment(), weekly, monthEnd, yearly, withOrigin);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var malformedTiming = new[]
        {
            (CommitmentCadence.Weekly, CommitmentTimingKind.Weekday, (DayOfWeek?)null, (int?)null, (int?)null),
            (CommitmentCadence.Monthly, CommitmentTimingKind.DayOfMonth, (DayOfWeek?)null, (int?)null, (int?)null),
            (CommitmentCadence.Yearly, CommitmentTimingKind.MonthAndDay, (DayOfWeek?)null, (int?)1, (int?)null),
            (CommitmentCadence.Yearly, CommitmentTimingKind.MonthAndDay, (DayOfWeek?)null, (int?)null, (int?)1)
        };

        foreach (var shape in malformedTiming)
        {
            var commitment = ValidCommitment();
            commitment.Cadence = shape.Item1;
            commitment.TimingKind = shape.Item2;
            commitment.ExpectedDayOfWeek = shape.Item3;
            commitment.ExpectedDay = shape.Item4;
            commitment.ExpectedMonth = shape.Item5;
            context.Commitments.Add(commitment);
            var exception = await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
            var postgres = Assert.IsType<PostgresException>(exception.InnerException);
            Assert.Equal(PostgresErrorCodes.CheckViolation, postgres.SqlState);
            Assert.Equal("CK_Commitment_Timing", postgres.ConstraintName);
            context.ChangeTracker.Clear();
        }

        var malformedOrigins = new (string? Version, byte[]? Fingerprint)[]
        {
            ("commitment-v1", null),
            (null, new byte[32]),
            (" ", new byte[32]),
            ("commitment-v1", new byte[31])
        };

        foreach (var origin in malformedOrigins)
        {
            var commitment = ValidCommitment();
            commitment.OriginAlgorithmVersion = origin.Version;
            commitment.OriginEvidenceFingerprint = origin.Fingerprint;
            context.Commitments.Add(commitment);
            var exception = await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
            var postgres = Assert.IsType<PostgresException>(exception.InnerException);
            Assert.Equal(PostgresErrorCodes.CheckViolation, postgres.SqlState);
            Assert.Equal("CK_Commitment_Origin", postgres.ConstraintName);
            context.ChangeTracker.Clear();
        }

        Assert.Equal(5, await context.Commitments.CountAsync());
    }

    [PostgreSqlFact]
    public async Task Commitment_foundation_rollback_rejects_dropping_durable_decisions()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("commitment-rollback@example.com");
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var now = DateTime.UtcNow;
        context.Commitments.Add(new Commitment
        {
            Id = Guid.NewGuid(),
            OwnerId = owner.Id,
            Name = "Rent",
            Category = "housing",
            Lifecycle = CommitmentLifecycle.Active,
            Cadence = CommitmentCadence.Monthly,
            TimingKind = CommitmentTimingKind.DayOfMonth,
            ExpectedDay = 1,
            WindowBeforeDays = 0,
            WindowAfterDays = 3,
            AmountMode = CommitmentAmountMode.Fixed,
            ExpectedAmount = 1500m,
            CreatedAt = now,
            UpdatedAt = now
        });
        await context.SaveChangesAsync();

        var migrator = context.GetService<IMigrator>();
        var exception = await Assert.ThrowsAsync<PostgresException>(() =>
            migrator.MigrateAsync("20260825155557_AddImportConfirmation"));

        Assert.Contains("Cannot roll back commitment foundation", exception.MessageText);
        Assert.True(await context.Commitments.AnyAsync());
    }

    [PostgreSqlFact]
    public async Task Commitment_candidate_and_confirmation_flow_executes_relational_queries()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-commitment@example.com");
        foreach (var date in RecentCommitmentDates())
            await app.SeedExpenseAsync(owner.Id, "membership", 10m, date, "bills");
        var fingerprint = await ReadCandidateFingerprintAsync(owner.Client);

        using var response = await owner.Client.PostAsJsonAsync(
            "/api/commitment-candidates/confirm",
            FixedCommitmentConfirmation(fingerprint));
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.False(body.GetProperty("alreadyConfirmed").GetBoolean());
        Assert.Equal(3, body.GetProperty("commitment").GetProperty("evidence").GetArrayLength());
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        Assert.Single(await context.Commitments.Where(value => value.OwnerId == owner.Id).ToListAsync());
        Assert.Equal(3, await context.CommitmentOccurrences.CountAsync());
    }

    [PostgreSqlFact]
    public async Task Commitment_change_read_executes_owner_scoped_relational_query_and_provenance_mapping()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-commitment-change@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("postgres-commitment-change-other@example.com");
        var utcToday = DateTime.UtcNow;
        var currentAnchor = new DateOnly(utcToday.Year, utcToday.Month, 1);
        foreach (var date in new[]
                 {
                     currentAnchor.AddMonths(-3),
                     currentAnchor.AddMonths(-2),
                     currentAnchor.AddMonths(-1)
                 })
            await app.SeedExpenseAsync(owner.Id, "membership", 10m, date, "bills");
        var fingerprint = await ReadCandidateFingerprintAsync(owner.Client);
        using var confirmation = await owner.Client.PostAsJsonAsync(
            "/api/commitment-candidates/confirm",
            new
            {
                fingerprint,
                name = "Membership display",
                category = "custom display",
                cadence = "monthly",
                timingKind = "dayOfMonth",
                expectedDayOfWeek = (string?)null,
                expectedDay = 1,
                expectedMonth = (int?)null,
                windowBeforeDays = 0,
                windowAfterDays = 0,
                amountMode = "fixed",
                expectedAmount = 10m,
                expectedMinimumAmount = (decimal?)null,
                expectedMaximumAmount = (decimal?)null
            });
        Assert.Equal(HttpStatusCode.Created, confirmation.StatusCode);
        var observed = await app.SeedExpenseAsync(owner.Id, "membership", 12m, currentAnchor, "bills");
        await app.SeedExpenseAsync(other.Id, "RELATIONAL SECRET", 999m, currentAnchor, "private");

        using (var setupScope = app.Services.CreateScope())
        {
            var context = setupScope.ServiceProvider.GetRequiredService<BudgetContext>();
            var now = DateTime.UtcNow;
            var digest = new byte[32];
            BitConverter.GetBytes(observed.Id).CopyTo(digest, 0);
            context.ImportPreviewBatches.Add(new ImportPreviewBatch
            {
                Id = Guid.NewGuid(),
                OwnerId = owner.Id,
                SourceType = "sunflower_pdf",
                ParserRuleVersion = "commitment-change-postgresql-v1",
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
                        ExpenseId = observed.Id
                    }
                ]
            });
            await context.SaveChangesAsync();
        }

        var body = await owner.Client.GetFromJsonAsync<JsonElement>("/api/commitment-changes");
        var change = Assert.Single(body.GetProperty("changes").EnumerateArray());
        var observation = Assert.Single(change.GetProperty("observations").EnumerateArray());

        Assert.Equal("Membership display", change.GetProperty("commitment").GetProperty("name").GetString());
        Assert.Equal("custom display", change.GetProperty("commitment").GetProperty("category").GetString());
        Assert.Equal("membership", change.GetProperty("normalizedDescription").GetString());
        Assert.Equal("bills", change.GetProperty("canonicalCategory").GetString());
        Assert.Equal(observed.Id, observation.GetProperty("expenseId").GetInt32());
        Assert.Equal("sunflower_pdf", observation.GetProperty("source").GetString());
        Assert.Equal("isolated_outlier", change.GetProperty("amount").GetProperty("state").GetString());
        Assert.DoesNotContain("RELATIONAL SECRET", body.ToString(), StringComparison.Ordinal);
    }

    [PostgreSqlFact]
    public async Task Concurrent_change_accepts_commit_once_and_maps_the_stale_write_to_conflict()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-change-accept-race@example.com");
        var utcToday = DateTime.UtcNow;
        var currentAnchor = new DateOnly(utcToday.Year, utcToday.Month, 1);
        var evidence = new List<Expense>();
        foreach (var date in new[]
                 {
                     currentAnchor.AddMonths(-5),
                     currentAnchor.AddMonths(-4),
                     currentAnchor.AddMonths(-3)
                 })
            evidence.Add(await app.SeedExpenseAsync(owner.Id, "membership", 10m, date, "bills"));
        var commitmentId = await SeedChangeCommitmentAsync(app, owner.Id, evidence, expectedDay: 1);
        foreach (var date in new[]
                 {
                     currentAnchor.AddMonths(-2),
                     currentAnchor.AddMonths(-1),
                     currentAnchor
                 })
            await app.SeedExpenseAsync(owner.Id, "membership", 12m, date, "bills");
        var changes = await owner.Client.GetFromJsonAsync<JsonElement>("/api/commitment-changes");
        var change = Assert.Single(changes.GetProperty("changes").EnumerateArray());
        var fingerprint = change.GetProperty("amount").GetProperty("fingerprint").GetString()!;

        var responses = await Task.WhenAll(
            owner.Client.PostAsJsonAsync(
                $"/api/commitment-changes/{commitmentId}/amount/accept", new { fingerprint }),
            owner.Client.PostAsJsonAsync(
                $"/api/commitment-changes/{commitmentId}/amount/accept", new { fingerprint }));

        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.NoContent);
        var conflict = Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Conflict);
        Assert.Equal("change_proposal_changed",
            (await conflict.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        using var scope = app.Services.CreateScope();
        var persisted = await scope.ServiceProvider.GetRequiredService<BudgetContext>()
            .Commitments.SingleAsync(value => value.Id == commitmentId);
        Assert.Equal(CommitmentAmountMode.Fixed, persisted.AmountMode);
        Assert.Equal(12m, persisted.ExpectedAmount);
        Assert.Equal(CommitmentCadence.Monthly, persisted.Cadence);
        Assert.Equal(1, persisted.ExpectedDay);
    }

    [PostgreSqlFact]
    public async Task Concurrent_candidate_confirmations_create_one_commitment_and_return_one_retry()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-commitment-race@example.com");
        foreach (var date in RecentCommitmentDates())
            await app.SeedExpenseAsync(owner.Id, "membership", 10m, date, "bills");
        var fingerprint = await ReadCandidateFingerprintAsync(owner.Client);
        var request = FixedCommitmentConfirmation(fingerprint);

        var responses = await Task.WhenAll(
            owner.Client.PostAsJsonAsync("/api/commitment-candidates/confirm", request),
            owner.Client.PostAsJsonAsync("/api/commitment-candidates/confirm", request));
        var bodies = await Task.WhenAll(responses.Select(response =>
            response.Content.ReadFromJsonAsync<JsonElement>()));

        Assert.All(responses, response => Assert.Contains(response.StatusCode,
            new[] { HttpStatusCode.Created, HttpStatusCode.OK }));
        Assert.Single(bodies, body => !body.GetProperty("alreadyConfirmed").GetBoolean());
        Assert.Single(bodies, body => body.GetProperty("alreadyConfirmed").GetBoolean());
        Assert.Single(bodies.Select(body =>
            body.GetProperty("commitment").GetProperty("id").GetGuid()).Distinct());
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        Assert.Equal(1, await context.Commitments.CountAsync(value => value.OwnerId == owner.Id));
        Assert.Equal(3, await context.CommitmentOccurrences.CountAsync());
    }

    [PostgreSqlFact]
    public async Task Concurrent_candidate_dismissals_are_idempotent()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-dismiss-race@example.com");
        foreach (var date in RecentCommitmentDates())
            await app.SeedExpenseAsync(owner.Id, "membership", 10m, date, "bills");
        var fingerprint = await ReadCandidateFingerprintAsync(owner.Client);

        var responses = await Task.WhenAll(
            owner.Client.PostAsJsonAsync("/api/commitment-candidates/dismiss", new { fingerprint }),
            owner.Client.PostAsJsonAsync("/api/commitment-candidates/dismiss", new { fingerprint }));

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.NoContent, response.StatusCode));
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        Assert.Equal(1, await context.CommitmentCandidateDismissals.CountAsync(
            value => value.OwnerId == owner.Id));
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
    public async Task Confirmation_persists_selected_expenses_and_minimum_provenance()
    {
        await using var app = new PostgreSqlImportPreviewTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-confirm@example.com");
        var pdf = SunflowerFixtureCorpus.CreateRepresentativePdf();
        var preview = await CreatePreviewAsync(owner.Client, pdf);
        var batchId = preview.GetProperty("batchId").GetGuid();

        using var response = await owner.Client.PostAsync(
            $"/api/import-previews/{batchId}/confirm",
            content: null);
        var confirmation = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(batchId, confirmation.GetProperty("batchId").GetGuid());
        Assert.Equal("confirmed", confirmation.GetProperty("status").GetString());
        Assert.Equal(10, confirmation.GetProperty("importedExpenseCount").GetInt32());
        var responseConfirmedAt = confirmation.GetProperty("confirmedAt").GetDateTime();

        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var batch = await context.ImportPreviewBatches.AsNoTracking()
            .Include(value => value.Rows)
            .Include(value => value.Provenance)
            .SingleAsync(value => value.Id == batchId);
        var expenses = await context.Expenses.AsNoTracking()
            .Where(value => value.UserId == owner.Id)
            .OrderBy(value => value.Date)
            .ThenBy(value => value.Id)
            .ToListAsync();

        Assert.Equal(ImportPreviewLifecycle.Confirmed, batch.Lifecycle);
        Assert.Equal(owner.Id, batch.OwnerId);
        Assert.Equal(SunflowerStatementParser.SourceType, batch.SourceType);
        Assert.Equal(SunflowerStatementParser.RuleVersion, batch.ParserRuleVersion);
        Assert.Equal(32, batch.DocumentDigest.Length);
        Assert.NotNull(batch.ConfirmedAt);
        Assert.InRange(
            (responseConfirmedAt - batch.ConfirmedAt.Value).Duration(),
            TimeSpan.Zero,
            TimeSpan.FromMilliseconds(1));
        Assert.Empty(batch.Rows);
        Assert.Equal(Enumerable.Range(3, 10),
            batch.Provenance.OrderBy(value => value.SourceRowOrdinal)
                .Select(value => value.SourceRowOrdinal));
        Assert.All(batch.Provenance, value => Assert.NotNull(value.ExpenseId));
        Assert.Equal(10, batch.Provenance.Select(value => value.ExpenseId).Distinct().Count());
        Assert.Equal(10, expenses.Count);
        Assert.All(expenses, value => Assert.Equal(owner.Id, value.UserId));
        Assert.All(expenses, value => Assert.NotEqual(Guid.Empty, value.CommitmentEvidenceRevision));
        Assert.Equal(expenses.Count, expenses.Select(value => value.CommitmentEvidenceRevision).Distinct().Count());

        var market = Assert.Single(expenses, value => value.Description == "NORTH STAR MARKET");
        Assert.Equal(new DateOnly(2026, 2, 5), market.Date);
        Assert.Equal(42.16m, market.Amount);
        Assert.Equal("uncategorized", market.Category);
        Assert.Contains(batch.Provenance, value =>
            value.SourceRowOrdinal == 4 && value.ExpenseId == market.Id);
    }

    [PostgreSqlFact]
    public async Task Confirmation_database_failure_rolls_back_all_import_writes_and_preview_changes()
    {
        await using var app = new PostgreSqlImportPreviewTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-confirm-rollback@example.com");
        var preview = await CreatePreviewAsync(
            owner.Client,
            SunflowerFixtureCorpus.CreateRepresentativePdf());
        var batchId = preview.GetProperty("batchId").GetGuid();

        using (var setupScope = app.Services.CreateScope())
        {
            var setupContext = setupScope.ServiceProvider.GetRequiredService<BudgetContext>();
            await setupContext.Database.ExecuteSqlRawAsync(
                """
                CREATE FUNCTION reject_one_import_provenance() RETURNS trigger
                LANGUAGE plpgsql AS $function$
                BEGIN
                    IF NEW."SourceRowOrdinal" = 4 THEN
                        RAISE EXCEPTION 'intentional disposable-test confirmation rejection';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER reject_one_import_provenance_insert
                BEFORE INSERT ON "ImportExpenseProvenances"
                FOR EACH ROW EXECUTE FUNCTION reject_one_import_provenance();
                """);
        }

        using var response = await owner.Client.PostAsync(
            $"/api/import-previews/{batchId}/confirm",
            content: null);
        var error = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("confirmation_failed", error.GetProperty("code").GetString());

        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var batch = await context.ImportPreviewBatches.AsNoTracking()
            .Include(value => value.Rows)
            .Include(value => value.Provenance)
            .SingleAsync(value => value.Id == batchId);
        Assert.Equal(ImportPreviewLifecycle.Open, batch.Lifecycle);
        Assert.Null(batch.ConfirmedAt);
        Assert.Equal(13, batch.Rows.Count);
        Assert.Equal(10, batch.Rows.Count(value => value.SelectedForImport));
        Assert.Empty(batch.Provenance);
        Assert.False(await context.Expenses.AnyAsync());
    }

    [PostgreSqlFact]
    public async Task Concurrent_confirmations_serialize_to_confirmed_and_already_confirmed()
    {
        await using var app = new PostgreSqlImportPreviewTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-confirm-race@example.com");
        var preview = await CreatePreviewAsync(
            owner.Client,
            SunflowerFixtureCorpus.CreateRepresentativePdf());
        var batchId = preview.GetProperty("batchId").GetGuid();

        using var lockScope = app.Services.CreateScope();
        var lockContext = lockScope.ServiceProvider.GetRequiredService<BudgetContext>();
        await using var lockTransaction = await lockContext.Database.BeginTransactionAsync();
        await lockContext.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT 1 FROM \"ImportPreviewBatches\" WHERE \"Id\" = {batchId} FOR UPDATE");

        var firstTask = owner.Client.PostAsync($"/api/import-previews/{batchId}/confirm", null);
        var secondTask = owner.Client.PostAsync($"/api/import-previews/{batchId}/confirm", null);
        var bothWaitingForBatchLock = await app.WaitForBlockedBatchMutationsAsync(2);
        await lockTransaction.CommitAsync();

        using var first = await firstTask;
        using var second = await secondTask;
        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();
        var secondBody = await second.Content.ReadFromJsonAsync<JsonElement>();

        Assert.True(bothWaitingForBatchLock,
            "Both confirmations must reach the PostgreSQL batch mutation lock before it is released.");
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.Equal(
            ["already_confirmed", "confirmed"],
            new[]
            {
                firstBody.GetProperty("status").GetString(),
                secondBody.GetProperty("status").GetString()
            }.Order());
        Assert.Equal(10, firstBody.GetProperty("importedExpenseCount").GetInt32());
        Assert.Equal(10, secondBody.GetProperty("importedExpenseCount").GetInt32());
        Assert.Equal(
            firstBody.GetProperty("confirmedAt").GetDateTime(),
            secondBody.GetProperty("confirmedAt").GetDateTime());

        using var assertScope = app.Services.CreateScope();
        var context = assertScope.ServiceProvider.GetRequiredService<BudgetContext>();
        Assert.Equal(10, await context.Expenses.CountAsync(value => value.UserId == owner.Id));
        Assert.Equal(10, await context.ImportExpenseProvenances.CountAsync(
            value => value.BatchId == batchId));
        Assert.Equal(10, await context.ImportExpenseProvenances
            .Where(value => value.BatchId == batchId)
            .Select(value => value.ExpenseId)
            .Distinct()
            .CountAsync());
    }

    [PostgreSqlFact]
    public async Task Row_update_queued_before_confirmation_cannot_bypass_new_duplicate_review()
    {
        await using var app = new PostgreSqlImportPreviewTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-row-confirm-order@example.com");
        var preview = await CreatePreviewAsync(
            owner.Client,
            SunflowerFixtureCorpus.CreateRepresentativePdf());
        var batchId = preview.GetProperty("batchId").GetGuid();
        var target = preview.GetProperty("rows").EnumerateArray().Single(value =>
            value.GetProperty("sourceDescription").GetString() == "NORTH STAR MARKET");
        var targetRowId = target.GetProperty("rowId").GetGuid();

        using (var selectionScope = app.Services.CreateScope())
        {
            var context = selectionScope.ServiceProvider.GetRequiredService<BudgetContext>();
            await context.ImportPreviewRows.Where(value => value.BatchId == batchId)
                .ExecuteUpdateAsync(setters => setters.SetProperty(
                    value => value.SelectedForImport,
                    false));
        }
        var existing = await app.SeedExpenseAsync(
            owner.Id,
            "NORTH STAR MARKET",
            42.16m,
            new DateOnly(2026, 2, 5));

        using var lockScope = app.Services.CreateScope();
        var lockContext = lockScope.ServiceProvider.GetRequiredService<BudgetContext>();
        await using var lockTransaction = await lockContext.Database.BeginTransactionAsync();
        await lockContext.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT 1 FROM \"ImportPreviewBatches\" WHERE \"Id\" = {batchId} FOR UPDATE");

        var updateTask = owner.Client.PatchAsJsonAsync(
            $"/api/import-previews/{batchId}/rows/{targetRowId}",
            new
            {
                editableExpenseDescription = target.GetProperty("editableExpenseDescription").GetString(),
                category = target.GetProperty("category").GetString(),
                selectedForImport = true
            });
        var updateWaitingForBatchLock = await app.WaitForBlockedBatchMutationsAsync(1);
        var confirmationTask = owner.Client.PostAsync(
            $"/api/import-previews/{batchId}/confirm",
            content: null);
        var bothWaitingForBatchLock = await app.WaitForBlockedBatchMutationsAsync(2);
        await lockTransaction.CommitAsync();

        using var update = await updateTask;
        using var confirmation = await confirmationTask;
        var confirmationBody = await confirmation.Content.ReadFromJsonAsync<JsonElement>();

        Assert.True(updateWaitingForBatchLock,
            "The row update must reach the PostgreSQL batch mutation lock before confirmation is queued.");
        Assert.True(bothWaitingForBatchLock,
            "The row update and confirmation must both wait on the same PostgreSQL batch mutation lock.");
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, confirmation.StatusCode);
        Assert.Equal("duplicate_review_required", confirmationBody.GetProperty("code").GetString());
        var errorRow = Assert.Single(confirmationBody.GetProperty("rows").EnumerateArray());
        Assert.Equal(targetRowId, errorRow.GetProperty("rowId").GetGuid());
        Assert.Equal(
            ["possible_duplicate"],
            errorRow.GetProperty("codes").EnumerateArray().Select(value => value.GetString()));

        using var assertScope = app.Services.CreateScope();
        var assertContext = assertScope.ServiceProvider.GetRequiredService<BudgetContext>();
        var batch = await assertContext.ImportPreviewBatches.AsNoTracking()
            .Include(value => value.Rows)
            .Include(value => value.Provenance)
            .SingleAsync(value => value.Id == batchId);
        var refreshed = batch.Rows.Single(value => value.Id == targetRowId);
        Assert.Equal(ImportPreviewLifecycle.Open, batch.Lifecycle);
        Assert.Empty(batch.Provenance);
        Assert.True(refreshed.IsPossibleDuplicate);
        Assert.False(refreshed.SelectedForImport);
        Assert.Equal(
            [existing.Id],
            JsonSerializer.Deserialize<int[]>(refreshed.DuplicateExpenseIds)!);
        Assert.Equal(1, await assertContext.Expenses.CountAsync(value => value.UserId == owner.Id));
    }

    [PostgreSqlFact]
    public async Task Existing_duplicate_warning_can_be_explicitly_selected_and_confirmed()
    {
        await using var app = new PostgreSqlImportPreviewTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-warned-confirm@example.com");
        var existing = await app.SeedExpenseAsync(
            owner.Id,
            "NORTH STAR MARKET",
            42.16m,
            new DateOnly(2026, 2, 5));
        var preview = await CreatePreviewAsync(
            owner.Client,
            SunflowerFixtureCorpus.CreateRepresentativePdf());
        var batchId = preview.GetProperty("batchId").GetGuid();
        var target = preview.GetProperty("rows").EnumerateArray().Single(value =>
            value.GetProperty("sourceDescription").GetString() == "NORTH STAR MARKET");
        var targetRowId = target.GetProperty("rowId").GetGuid();

        Assert.True(target.GetProperty("isPossibleDuplicate").GetBoolean());
        Assert.False(target.GetProperty("selectedForImport").GetBoolean());
        Assert.Equal(
            [existing.Id],
            target.GetProperty("duplicateExpenseIds").EnumerateArray()
                .Select(value => value.GetInt32()));

        using var selection = await owner.Client.PatchAsJsonAsync(
            $"/api/import-previews/{batchId}/rows/{targetRowId}",
            new
            {
                editableExpenseDescription = target.GetProperty("editableExpenseDescription").GetString(),
                category = target.GetProperty("category").GetString(),
                selectedForImport = true
            });
        Assert.Equal(HttpStatusCode.OK, selection.StatusCode);

        using var confirmation = await owner.Client.PostAsync(
            $"/api/import-previews/{batchId}/confirm",
            content: null);
        var confirmationBody = await confirmation.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, confirmation.StatusCode);
        Assert.Equal("confirmed", confirmationBody.GetProperty("status").GetString());
        Assert.Equal(10, confirmationBody.GetProperty("importedExpenseCount").GetInt32());

        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        Assert.Equal(11, await context.Expenses.CountAsync(value => value.UserId == owner.Id));
        Assert.Equal(10, await context.ImportExpenseProvenances.CountAsync(
            value => value.BatchId == batchId));
        Assert.DoesNotContain(
            await context.ImportExpenseProvenances
                .Where(value => value.BatchId == batchId)
                .Select(value => value.ExpenseId)
                .ToListAsync(),
            value => value == existing.Id);
    }

    [PostgreSqlFact]
    public async Task Duplicate_refresh_queued_before_row_update_requires_later_confirmation()
    {
        await using var app = new PostgreSqlImportPreviewTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-duplicate-refresh@example.com");
        var preview = await CreatePreviewAsync(
            owner.Client,
            SunflowerFixtureCorpus.CreateRepresentativePdf());
        var batchId = preview.GetProperty("batchId").GetGuid();
        var previewRows = preview.GetProperty("rows").EnumerateArray().ToList();
        var target = previewRows.Single(value =>
            value.GetProperty("sourceDescription").GetString() == "NORTH STAR MARKET");
        var targetRowId = target.GetProperty("rowId").GetGuid();
        Assert.False(target.GetProperty("isPossibleDuplicate").GetBoolean());
        Assert.True(target.GetProperty("selectedForImport").GetBoolean());

        var existing = await app.SeedExpenseAsync(
            owner.Id,
            "NORTH STAR MARKET",
            42.16m,
            new DateOnly(2026, 2, 5));

        using var lockScope = app.Services.CreateScope();
        var lockContext = lockScope.ServiceProvider.GetRequiredService<BudgetContext>();
        await using var lockTransaction = await lockContext.Database.BeginTransactionAsync();
        await lockContext.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT 1 FROM \"ImportPreviewBatches\" WHERE \"Id\" = {batchId} FOR UPDATE");

        var refreshTask = owner.Client.PostAsync(
            $"/api/import-previews/{batchId}/confirm",
            content: null);
        var refreshWaitingForBatchLock = await app.WaitForBlockedBatchMutationsAsync(1);
        var reselectionTask = owner.Client.PatchAsJsonAsync(
            $"/api/import-previews/{batchId}/rows/{targetRowId}",
            new
            {
                editableExpenseDescription = target.GetProperty("editableExpenseDescription").GetString(),
                category = target.GetProperty("category").GetString(),
                selectedForImport = true
            });
        var bothWaitingForBatchLock = await app.WaitForBlockedBatchMutationsAsync(2);
        await lockTransaction.CommitAsync();

        using var refresh = await refreshTask;
        using var reselection = await reselectionTask;
        var refreshBody = await refresh.Content.ReadFromJsonAsync<JsonElement>();

        Assert.True(refreshWaitingForBatchLock,
            "Confirmation must reach the PostgreSQL batch mutation lock before reselection is queued.");
        Assert.True(bothWaitingForBatchLock,
            "Confirmation and reselection must both wait on the same PostgreSQL batch mutation lock.");
        Assert.Equal(HttpStatusCode.Conflict, refresh.StatusCode);
        Assert.Equal(HttpStatusCode.OK, reselection.StatusCode);
        Assert.Equal("duplicate_review_required", refreshBody.GetProperty("code").GetString());
        var refreshRow = Assert.Single(refreshBody.GetProperty("rows").EnumerateArray());
        Assert.Equal(targetRowId, refreshRow.GetProperty("rowId").GetGuid());
        Assert.Equal(
            ["possible_duplicate"],
            refreshRow.GetProperty("codes").EnumerateArray().Select(value => value.GetString()));

        using (var refreshScope = app.Services.CreateScope())
        {
            var context = refreshScope.ServiceProvider.GetRequiredService<BudgetContext>();
            var batch = await context.ImportPreviewBatches.AsNoTracking()
                .Include(value => value.Rows)
                .Include(value => value.Provenance)
                .SingleAsync(value => value.Id == batchId);
            var refreshed = batch.Rows.Single(value => value.Id == targetRowId);
            Assert.Equal(ImportPreviewLifecycle.Open, batch.Lifecycle);
            Assert.Null(batch.ConfirmedAt);
            Assert.Empty(batch.Provenance);
            Assert.True(refreshed.IsPossibleDuplicate);
            Assert.True(refreshed.SelectedForImport);
            Assert.Contains("possible_duplicate",
                JsonSerializer.Deserialize<string[]>(refreshed.WarningCodes)!);
            Assert.Equal(
                [existing.Id],
                JsonSerializer.Deserialize<int[]>(refreshed.DuplicateExpenseIds)!);
            Assert.Equal(1, await context.Expenses.CountAsync());
        }

        using var confirmation = await owner.Client.PostAsync(
            $"/api/import-previews/{batchId}/confirm",
            content: null);
        var confirmationBody = await confirmation.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, confirmation.StatusCode);
        Assert.Equal("confirmed", confirmationBody.GetProperty("status").GetString());
        Assert.Equal(10, confirmationBody.GetProperty("importedExpenseCount").GetInt32());

        using var assertScope = app.Services.CreateScope();
        var assertContext = assertScope.ServiceProvider.GetRequiredService<BudgetContext>();
        Assert.Equal(11, await assertContext.Expenses.CountAsync());
        Assert.Equal(10, await assertContext.ImportExpenseProvenances.CountAsync(
            value => value.BatchId == batchId));
        Assert.DoesNotContain(
            await assertContext.ImportExpenseProvenances
                .Where(value => value.BatchId == batchId)
                .Select(value => value.ExpenseId)
                .ToListAsync(),
            value => value == existing.Id);
    }

    [PostgreSqlFact]
    public async Task Confirmed_exact_reupload_is_already_imported_without_extraction_or_new_writes()
    {
        await using var app = new PostgreSqlImportPreviewTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-confirm-reupload@example.com");
        var pdf = SunflowerFixtureCorpus.CreateRepresentativePdf();
        var preview = await CreatePreviewAsync(owner.Client, pdf);
        var batchId = preview.GetProperty("batchId").GetGuid();
        using var confirmation = await owner.Client.PostAsync(
            $"/api/import-previews/{batchId}/confirm",
            content: null);
        Assert.Equal(HttpStatusCode.OK, confirmation.StatusCode);
        Assert.Equal(1, app.Extractor.CallCount);

        using (var constraintScope = app.Services.CreateScope())
        {
            var constraintContext = constraintScope.ServiceProvider.GetRequiredService<BudgetContext>();
            var confirmed = await constraintContext.ImportPreviewBatches.AsNoTracking()
                .SingleAsync(value => value.Id == batchId);
            constraintContext.ImportPreviewBatches.Add(new ImportPreviewBatch
            {
                Id = Guid.NewGuid(),
                OwnerId = confirmed.OwnerId,
                SourceType = confirmed.SourceType,
                ParserRuleVersion = confirmed.ParserRuleVersion,
                DocumentDigest = confirmed.DocumentDigest.ToArray(),
                CreatedAt = confirmed.CreatedAt.AddMinutes(1),
                ExpiresAt = confirmed.ExpiresAt.AddMinutes(1),
                Lifecycle = ImportPreviewLifecycle.Open
            });
            var exception = await Assert.ThrowsAsync<DbUpdateException>(() =>
                constraintContext.SaveChangesAsync());
            var postgres = Assert.IsType<PostgresException>(exception.InnerException);
            Assert.Equal(PostgresErrorCodes.UniqueViolation, postgres.SqlState);
            Assert.Equal("IX_ImportPreviewBatches_ActiveDocument", postgres.ConstraintName);
        }

        using var upload = CreatePdfUpload(pdf);
        using var reupload = await owner.Client.PostAsync("/api/import-previews", upload);
        var error = await reupload.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Conflict, reupload.StatusCode);
        Assert.Equal("already_imported", error.GetProperty("code").GetString());
        Assert.Equal(1, app.Extractor.CallCount);

        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        Assert.Equal(10, await context.Expenses.CountAsync(value => value.UserId == owner.Id));
        Assert.Equal(10, await context.ImportExpenseProvenances.CountAsync(
            value => value.BatchId == batchId));
        Assert.Equal(1, await context.ImportPreviewBatches.CountAsync(
            value => value.OwnerId == owner.Id));
    }

    [PostgreSqlFact]
    public async Task Expense_delete_sets_provenance_link_to_null_without_reopening_import_identity()
    {
        await using var app = new PostgreSqlImportPreviewTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("postgres-provenance-delete@example.com");
        var pdf = SunflowerFixtureCorpus.CreateRepresentativePdf();
        var preview = await CreatePreviewAsync(owner.Client, pdf);
        var batchId = preview.GetProperty("batchId").GetGuid();
        using var confirmation = await owner.Client.PostAsync(
            $"/api/import-previews/{batchId}/confirm",
            content: null);
        Assert.Equal(HttpStatusCode.OK, confirmation.StatusCode);

        int expenseId;
        int sourceRowOrdinal;
        using (var readScope = app.Services.CreateScope())
        {
            var context = readScope.ServiceProvider.GetRequiredService<BudgetContext>();
            var provenance = await context.ImportExpenseProvenances.AsNoTracking()
                .Where(value => value.BatchId == batchId)
                .OrderBy(value => value.SourceRowOrdinal)
                .FirstAsync();
            expenseId = Assert.IsType<int>(provenance.ExpenseId);
            sourceRowOrdinal = provenance.SourceRowOrdinal;
        }

        using var delete = await owner.Client.DeleteAsync($"/api/expenses/{expenseId}");
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);

        using (var assertScope = app.Services.CreateScope())
        {
            var context = assertScope.ServiceProvider.GetRequiredService<BudgetContext>();
            var provenance = await context.ImportExpenseProvenances.AsNoTracking()
                .SingleAsync(value => value.BatchId == batchId
                    && value.SourceRowOrdinal == sourceRowOrdinal);
            Assert.Null(provenance.ExpenseId);
            var batch = await context.ImportPreviewBatches.AsNoTracking()
                .SingleAsync(value => value.Id == batchId);
            Assert.Equal(ImportPreviewLifecycle.Confirmed, batch.Lifecycle);
            Assert.NotNull(batch.ConfirmedAt);
        }

        using var upload = CreatePdfUpload(pdf);
        using var reupload = await owner.Client.PostAsync("/api/import-previews", upload);
        var error = await reupload.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.Conflict, reupload.StatusCode);
        Assert.Equal("already_imported", error.GetProperty("code").GetString());
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

    private static async Task<JsonElement> CreatePreviewAsync(HttpClient client, byte[] pdf)
    {
        using var upload = CreatePdfUpload(pdf);
        using var response = await client.PostAsync("/api/import-previews", upload);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(
            response.StatusCode == HttpStatusCode.Created,
            $"Expected preview creation, received {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return body;
    }

    private static DateOnly[] RecentCommitmentDates()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var currentMonthAnchor = new DateOnly(today.Year, today.Month, 10);
        var latest = currentMonthAnchor <= today
            ? currentMonthAnchor
            : currentMonthAnchor.AddMonths(-1);
        return [latest.AddMonths(-2), latest.AddMonths(-1), latest];
    }

    private static async Task<Guid> SeedChangeCommitmentAsync(
        FinancialApiTestApplicationBase app,
        string ownerId,
        IEnumerable<Expense> evidence,
        int expectedDay)
    {
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var now = DateTime.UtcNow.AddYears(-1);
        var commitment = new Commitment
        {
            Id = Guid.NewGuid(),
            OwnerId = ownerId,
            Name = "Membership",
            Category = "bills",
            Lifecycle = CommitmentLifecycle.Active,
            Cadence = CommitmentCadence.Monthly,
            TimingKind = CommitmentTimingKind.DayOfMonth,
            ExpectedDay = expectedDay,
            AmountMode = CommitmentAmountMode.Fixed,
            ExpectedAmount = 10m,
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

    private static async Task<string> ReadCandidateFingerprintAsync(HttpClient client)
    {
        var response = await client.GetFromJsonAsync<JsonElement>("/api/commitment-candidates");
        return Assert.Single(response.GetProperty("candidates").EnumerateArray())
            .GetProperty("fingerprint").GetString()!;
    }

    private static object FixedCommitmentConfirmation(string fingerprint) => new
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

    private static MultipartFormDataContent CreatePdfUpload(byte[] pdf)
    {
        var upload = new MultipartFormDataContent();
        upload.Add(new StringContent(SunflowerStatementParser.SourceType), "sourceType");
        upload.Add(new ByteArrayContent(pdf), "file", "synthetic.pdf");
        return upload;
    }

    private static Task<string> ReadConstraintDefinitionAsync(
        BudgetContext context,
        string constraintName) => context.Database.SqlQueryRaw<string>(
            """
            SELECT pg_get_constraintdef(oid) AS "Value"
            FROM pg_constraint
            WHERE conname = {0}
            """,
            constraintName).SingleAsync();

    private static Task<string> ReadIndexDefinitionAsync(
        BudgetContext context,
        string indexName) => context.Database.SqlQueryRaw<string>(
            """
            SELECT indexdef AS "Value"
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname = {0}
            """,
            indexName).SingleAsync();
}

internal sealed class PostgreSqlImportPreviewTestApplication : PostgreSqlFinancialApiTestApplication
{
    public BudgetPlanner.Tests.Import.ImmediateSyntheticExtractor Extractor =>
        (BudgetPlanner.Tests.Import.ImmediateSyntheticExtractor)
        Services.GetRequiredService<IPdfTextExtractor>();

    public async Task<bool> WaitForBlockedBatchMutationsAsync(int expectedCount)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (DateTime.UtcNow < deadline)
        {
            using var scope = Services.CreateScope();
            var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            var count = await context.Database.SqlQueryRaw<int>(
                """
                SELECT COUNT(*)::integer AS "Value"
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND pid <> pg_backend_pid()
                  AND wait_event_type = 'Lock'
                  AND query ILIKE '%ImportPreviewBatches%'
                  AND query ILIKE '%FOR UPDATE%'
                """).SingleAsync();
            if (count >= expectedCount)
            {
                return true;
            }

            await Task.Delay(25);
        }

        return false;
    }

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
