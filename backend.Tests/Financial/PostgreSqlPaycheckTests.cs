using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BudgetPlanner.Contracts.Paychecks;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using BudgetPlanner.Paychecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

[Collection("Environment variable tests")]
[Trait("Category", "PostgreSQL")]
public sealed class PostgreSqlPaycheckTests
{
    [PostgreSqlFact]
    public async Task Migration_is_additive_and_preserves_dates_precision_timestamps_and_unassigned_inflows()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-migration@example.com");
        var inflow = await app.SeedInflowAsync(owner.Id);
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var migrator = context.GetService<IMigrator>();
        await migrator.MigrateAsync("20260903004657_AddAccountInflowFoundation");
        await context.Database.MigrateAsync();

        Assert.Equal(app.GetDefinedMigrations(), await app.GetAppliedMigrationsAsync());
        Assert.True(await context.Users.AnyAsync(value => value.Id == owner.Id));
        Assert.Equal(inflow.PaycheckEvidenceRevision,
            (await context.AccountInflows.AsNoTracking().SingleAsync()).PaycheckEvidenceRevision);
        Assert.Empty(await context.PaycheckProfiles.ToListAsync());
        Assert.Empty(await context.PaycheckOccurrences.ToListAsync());
        Assert.Empty(await context.PaycheckCandidateDismissals.ToListAsync());

        var types = await context.Database.SqlQueryRaw<string>("""
            SELECT column_name || ':' || data_type || ':' || COALESCE(numeric_precision::text, '')
                || ':' || COALESCE(numeric_scale::text, '') AS "Value"
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'PaycheckProfiles'
            """).ToListAsync();
        Assert.Contains("ExpectedAmount:numeric:18:2", types);
        Assert.Contains("ExpectedMinimumAmount:numeric:18:2", types);
        Assert.Contains("ExpectedMaximumAmount:numeric:18:2", types);
        Assert.Contains("ReferenceAnchorDate:date::", types);
        Assert.Contains("FirstMonthAnchor:smallint:16:0", types);
        Assert.Contains("SecondMonthAnchor:smallint:16:0", types);
        Assert.Contains("WindowBeforeDays:smallint:16:0", types);
        Assert.Contains("WindowAfterDays:smallint:16:0", types);
        Assert.Contains("CreatedAt:timestamp with time zone::", types);
        Assert.Contains("UpdatedAt:timestamp with time zone::", types);
        Assert.Contains("OriginEvidenceFingerprint:bytea::", types);

        var profile = NewProfile(owner.Id);
        profile.Cadence = PaycheckCadence.Biweekly;
        profile.FirstMonthAnchor = null;
        profile.ReferenceAnchorDate = new DateOnly(2026, 2, 28);
        profile.ExpectedAmount = 1234.56m;
        context.PaycheckProfiles.Add(profile);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var persisted = await context.PaycheckProfiles.SingleAsync();
        Assert.Equal(profile.ReferenceAnchorDate, persisted.ReferenceAnchorDate);
        Assert.Equal(1234.56m, persisted.ExpectedAmount);
        Assert.Equal(DateTimeKind.Utc, persisted.CreatedAt.Kind);
        Assert.Equal(profile.CreatedAt, persisted.CreatedAt);
    }

    [PostgreSqlFact]
    public async Task Profile_checks_reject_invalid_and_partial_nullable_shapes()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-checks@example.com");
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();

        var invalid = new (string Check, Action<PaycheckProfile> Mutate)[]
        {
            ("Text", p => p.DisplayName = "  "),
            ("Enums", p => p.Lifecycle = (PaycheckLifecycle)99),
            ("Enums", p => p.Cadence = (PaycheckCadence)99),
            ("Amount", p => p.AmountMode = (PaycheckAmountMode)99),
            ("Schedule", p => p.FirstMonthAnchor = null),
            ("Schedule", p => p.FirstMonthAnchor = 0),
            ("Schedule", p => p.FirstMonthAnchor = 32),
            ("Schedule", p => p.SecondMonthAnchor = 20),
            ("Schedule", p => p.ReferenceAnchorDate = new DateOnly(2026, 1, 1)),
            ("Schedule", p => { p.Cadence = PaycheckCadence.Weekly; p.FirstMonthAnchor = null; }),
            ("Schedule", p => { p.Cadence = PaycheckCadence.Biweekly; p.FirstMonthAnchor = null; }),
            ("Schedule", p => { p.Cadence = PaycheckCadence.Weekly; p.ReferenceAnchorDate = new DateOnly(2026, 1, 1); }),
            ("Schedule", p => { p.Cadence = PaycheckCadence.Semimonthly; p.FirstMonthAnchor = null; p.SecondMonthAnchor = 15; }),
            ("Schedule", p => p.Cadence = PaycheckCadence.Semimonthly),
            ("Schedule", p => { p.Cadence = PaycheckCadence.Semimonthly; p.SecondMonthAnchor = 10; }),
            ("Schedule", p => { p.Cadence = PaycheckCadence.Semimonthly; p.SecondMonthAnchor = 16; }),
            ("Schedule", p => { p.Cadence = PaycheckCadence.Semimonthly; p.FirstMonthAnchor = 1; p.SecondMonthAnchor = 31; }),
            ("Schedule", p => { p.Cadence = PaycheckCadence.Semimonthly; p.FirstMonthAnchor = 31; p.SecondMonthAnchor = 15; }),
            ("Schedule", p => { p.Cadence = PaycheckCadence.Semimonthly; p.FirstMonthAnchor = 0; p.SecondMonthAnchor = 15; }),
            ("Schedule", p => { p.Cadence = PaycheckCadence.Semimonthly; p.SecondMonthAnchor = 32; }),
            ("Windows", p => p.WindowBeforeDays = -1),
            ("Windows", p => p.WindowBeforeDays = 4),
            ("Windows", p => p.WindowAfterDays = -1),
            ("Windows", p => p.WindowAfterDays = 4),
            ("Amount", p => p.ExpectedAmount = null),
            ("Amount", p => p.ExpectedAmount = 0),
            ("Amount", p => p.ExpectedAmount = -1),
            ("Amount", p => p.ExpectedMinimumAmount = 1),
            ("Amount", p => p.ExpectedMaximumAmount = 2000),
            ("Amount", p => { p.AmountMode = PaycheckAmountMode.Range; p.ExpectedAmount = null; }),
            ("Amount", p => { p.AmountMode = PaycheckAmountMode.Range; p.ExpectedAmount = null; p.ExpectedMinimumAmount = 1; }),
            ("Amount", p => { p.AmountMode = PaycheckAmountMode.Range; p.ExpectedAmount = null; p.ExpectedMaximumAmount = 2; }),
            ("Amount", p => { p.AmountMode = PaycheckAmountMode.Range; p.ExpectedMinimumAmount = 1; p.ExpectedMaximumAmount = 2; }),
            ("Amount", p => { p.AmountMode = PaycheckAmountMode.Range; p.ExpectedAmount = null; p.ExpectedMinimumAmount = 0; p.ExpectedMaximumAmount = 2; }),
            ("Amount", p => { p.AmountMode = PaycheckAmountMode.Range; p.ExpectedAmount = null; p.ExpectedMinimumAmount = 2; p.ExpectedMaximumAmount = 2; }),
            ("Amount", p => { p.AmountMode = PaycheckAmountMode.Range; p.ExpectedAmount = null; p.ExpectedMinimumAmount = 3; p.ExpectedMaximumAmount = 2; }),
            ("Origin", p => p.OriginAlgorithmVersion = PaycheckCandidateDetector.AlgorithmVersion),
            ("Origin", p => p.OriginEvidenceFingerprint = new byte[32]),
            ("Origin", p => { p.OriginAlgorithmVersion = " "; p.OriginEvidenceFingerprint = new byte[32]; }),
            ("Origin", p => { p.OriginAlgorithmVersion = "v1"; p.OriginEvidenceFingerprint = new byte[31]; }),
            ("Origin", p => { p.OriginAlgorithmVersion = "v1"; p.OriginEvidenceFingerprint = new byte[33]; }),
            ("Timestamps", p => p.UpdatedAt = p.CreatedAt.AddSeconds(-1))
        };
        foreach (var (check, mutate) in invalid)
        {
            var profile = NewProfile(owner.Id);
            mutate(profile);
            context.PaycheckProfiles.Add(profile);
            var error = await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
            var postgres = Assert.IsType<PostgresException>(error.InnerException);
            Assert.Equal(PostgresErrorCodes.CheckViolation, postgres.SqlState);
            Assert.Equal("CK_PaycheckProfile_" + check, postgres.ConstraintName);
            context.ChangeTracker.Clear();
        }

        foreach (var cadence in Enum.GetValues<PaycheckCadence>())
        {
            var profile = NewProfile(owner.Id);
            profile.Cadence = cadence;
            if (cadence is PaycheckCadence.Weekly or PaycheckCadence.Biweekly)
            {
                profile.FirstMonthAnchor = null;
                profile.ReferenceAnchorDate = new DateOnly(2026, 1, 1);
            }
            if (cadence == PaycheckCadence.Semimonthly)
            {
                profile.FirstMonthAnchor = 15;
                profile.SecondMonthAnchor = 31;
                profile.AmountMode = PaycheckAmountMode.Range;
                profile.ExpectedAmount = null;
                profile.ExpectedMinimumAmount = 900;
                profile.ExpectedMaximumAmount = 1100;
            }
            context.PaycheckProfiles.Add(profile);
        }
        await context.SaveChangesAsync();
        Assert.Equal(4, await context.PaycheckProfiles.CountAsync());
    }

    [PostgreSqlFact]
    public async Task Origin_and_dismissal_uniqueness_are_partitioned_by_owner_and_exact_tuple()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-origin@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("paycheck-origin-other@example.com");
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();

        foreach (var (ownerId, version) in new[] { (owner.Id, "v1"), (owner.Id, "v2"), (other.Id, "v1") })
        {
            var profile = NewProfile(ownerId);
            profile.OriginAlgorithmVersion = version;
            profile.OriginEvidenceFingerprint = new byte[32];
            context.PaycheckProfiles.Add(profile);
        }
        await context.SaveChangesAsync();
        var duplicate = NewProfile(owner.Id);
        duplicate.OriginAlgorithmVersion = "v1";
        duplicate.OriginEvidenceFingerprint = new byte[32];
        context.PaycheckProfiles.Add(duplicate);
        var error = await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
        Assert.Equal("UX_PaycheckProfiles_Owner_Origin", Assert.IsType<PostgresException>(error.InnerException).ConstraintName);
        context.ChangeTracker.Clear();

        Task InsertDismissal(string ownerId, string version, string cadence, byte[] fingerprint) =>
            context.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "PaycheckCandidateDismissals"
                    ("Id", "OwnerId", "AlgorithmVersion", "Cadence", "EvidenceFingerprint", "DismissedAt")
                VALUES ({Guid.NewGuid()}, {ownerId}, {version}, {cadence}, {fingerprint}, {DateTime.UtcNow})
                """);

        await InsertDismissal(owner.Id, "v1", "Monthly", new byte[32]);
        await InsertDismissal(owner.Id, "v2", "Monthly", new byte[32]);
        await InsertDismissal(owner.Id, "v1", "Weekly", new byte[32]);
        await InsertDismissal(other.Id, "v1", "Monthly", new byte[32]);
        var duplicateDismissal = await Assert.ThrowsAsync<PostgresException>(() =>
            InsertDismissal(owner.Id, "v1", "Monthly", new byte[32]));
        Assert.Equal(PostgresErrorCodes.UniqueViolation, duplicateDismissal.SqlState);
        Assert.Equal("UX_PaycheckCandidateDismissals_Owner_Origin", duplicateDismissal.ConstraintName);
        foreach (var (version, cadence, fingerprint, check) in new[]
        {
            (" ", "Monthly", new byte[32], "AlgorithmVersion"),
            ("v1", "Unknown", new byte[32], "Cadence"),
            ("v1", "Monthly", new byte[31], "FingerprintLength"),
            ("v1", "Monthly", new byte[33], "FingerprintLength")
        })
        {
            var invalid = await Assert.ThrowsAsync<PostgresException>(() =>
                InsertDismissal(owner.Id, version, cadence, fingerprint));
            Assert.Equal(PostgresErrorCodes.CheckViolation, invalid.SqlState);
            Assert.Equal("CK_PaycheckCandidateDismissal_" + check, invalid.ConstraintName);
        }
        await context.Users.Where(value => value.Id == other.Id).ExecuteDeleteAsync();
        Assert.False(await context.PaycheckProfiles.AnyAsync(value => value.OwnerId == other.Id));
        Assert.False(await context.PaycheckCandidateDismissals.AnyAsync(value => value.OwnerId == other.Id));
        Assert.Equal(2, await context.PaycheckProfiles.CountAsync());
        Assert.Equal(3, await context.PaycheckCandidateDismissals.CountAsync());
    }

    [PostgreSqlFact]
    public async Task Occurrences_enforce_owner_consistency_exclusivity_checks_and_edit_delete_cascades()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-links@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("paycheck-links-other@example.com");
        var inflow = await app.SeedInflowAsync(owner.Id, date: new DateOnly(2026, 9, 10));
        var secondInflow = await app.SeedInflowAsync(owner.Id, date: new DateOnly(2026, 9, 10));
        var otherInflow = await app.SeedInflowAsync(other.Id, date: new DateOnly(2026, 9, 10));
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var profile = NewProfile(owner.Id);
        var secondProfile = NewProfile(owner.Id);
        var foreignProfile = NewProfile(other.Id);
        context.PaycheckProfiles.AddRange(profile, secondProfile, foreignProfile);
        await context.SaveChangesAsync();

        Task Insert(Guid profileId, int inflowId, string ownerId, string kind, Guid revision, short offset) =>
            context.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "PaycheckOccurrences"
                    ("PaycheckProfileId", "AccountInflowId", "OwnerId", "Kind", "EvidenceRevisionAtAssignment", "SlotAnchor", "TimingOffsetDays", "LinkedAt")
                VALUES ({profileId}, {inflowId}, {ownerId}, {kind}, {revision}, {inflow.Date}, {offset}, {DateTime.UtcNow})
                """);

        foreach (var (profileId, inflowId, check) in new[]
        {
            (foreignProfile.Id, inflow.Id, "FK_PaycheckOccurrence_Profile_Owner"),
            (profile.Id, otherInflow.Id, "FK_PaycheckOccurrence_AccountInflow_Owner")
        })
        {
            var error = await Assert.ThrowsAsync<PostgresException>(() =>
                Insert(profileId, inflowId, owner.Id, "ConfirmationEvidence", inflow.PaycheckEvidenceRevision, 0));
            Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, error.SqlState);
            Assert.Equal(check, error.ConstraintName);
        }
        foreach (var (kind, revision, offset, check) in new[]
        {
            ("Unknown", Guid.NewGuid(), (short)0, "Kind"),
            ("ConfirmationEvidence", Guid.Empty, (short)0, "EvidenceRevision"),
            ("ConfirmationEvidence", Guid.NewGuid(), (short)-4, "TimingOffset"),
            ("ConfirmationEvidence", Guid.NewGuid(), (short)4, "TimingOffset")
        })
        {
            var error = await Assert.ThrowsAsync<PostgresException>(() =>
                Insert(profile.Id, inflow.Id, owner.Id, kind, revision, offset));
            Assert.Equal(PostgresErrorCodes.CheckViolation, error.SqlState);
            Assert.Equal("CK_PaycheckOccurrence_" + check, error.ConstraintName);
        }

        await Insert(profile.Id, inflow.Id, owner.Id, "ConfirmationEvidence", inflow.PaycheckEvidenceRevision, 0);
        var duplicate = await Assert.ThrowsAsync<PostgresException>(() =>
            Insert(secondProfile.Id, inflow.Id, owner.Id, "ConfirmationEvidence", inflow.PaycheckEvidenceRevision, 0));
        Assert.Equal(PostgresErrorCodes.UniqueViolation, duplicate.SqlState);
        Assert.Equal("IX_PaycheckOccurrences_AccountInflowId", duplicate.ConstraintName);
        var edited = await context.AccountInflows.SingleAsync(value => value.Id == inflow.Id);
        edited.UpdateEvidence("edited synthetic deposit", 543.21m, inflow.Date.AddDays(1));
        await context.SaveChangesAsync();
        var occurrence = await context.PaycheckOccurrences.AsNoTracking().SingleAsync();
        Assert.Equal(inflow.PaycheckEvidenceRevision, occurrence.EvidenceRevisionAtAssignment);
        Assert.NotEqual(edited.PaycheckEvidenceRevision, occurrence.EvidenceRevisionAtAssignment);
        Assert.Equal(inflow.Date, occurrence.SlotAnchor);
        Assert.Equal(DateTimeKind.Utc, occurrence.LinkedAt.Kind);

        await context.AccountInflows.Where(value => value.Id == inflow.Id).ExecuteDeleteAsync();
        Assert.Empty(await context.PaycheckOccurrences.ToListAsync());
        Assert.True(await context.PaycheckProfiles.AnyAsync(value => value.Id == profile.Id));
        await Insert(secondProfile.Id, secondInflow.Id, owner.Id, "ConfirmationEvidence", secondInflow.PaycheckEvidenceRevision, 0);
        await context.PaycheckProfiles.Where(value => value.Id == secondProfile.Id).ExecuteDeleteAsync();
        Assert.Empty(await context.PaycheckOccurrences.ToListAsync());
        Assert.True(await context.AccountInflows.AnyAsync(value => value.Id == secondInflow.Id));
        await Insert(profile.Id, secondInflow.Id, owner.Id, "ConfirmationEvidence", secondInflow.PaycheckEvidenceRevision, 0);
        await context.Users.Where(value => value.Id == owner.Id).ExecuteDeleteAsync();
        Assert.Empty(await context.PaycheckOccurrences.ToListAsync());
        Assert.False(await context.PaycheckProfiles.AnyAsync(value => value.OwnerId == owner.Id));
        Assert.True(await context.PaycheckProfiles.AnyAsync(value => value.Id == foreignProfile.Id));
    }

    [PostgreSqlFact]
    public async Task Same_candidate_confirmation_and_dismissal_races_are_idempotent()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-confirm-race@example.com");
        var inflows = await SeedCandidateAsync(app, owner.Id);
        var candidate = await ReadCandidateAsync(owner.Client);
        var decision = new PaycheckCandidateDecisionRequest(
            candidate.AlgorithmVersion, candidate.Schedule.Cadence, candidate.Fingerprint);
        var dismissals = await Task.WhenAll(
            owner.Client.PostAsJsonAsync("/api/paycheck-candidates/dismiss", decision),
            owner.Client.PostAsJsonAsync("/api/paycheck-candidates/dismiss", decision));
        Assert.All(dismissals, response => Assert.Equal(HttpStatusCode.NoContent, response.StatusCode));
        using (var dismissedScope = app.Services.CreateScope())
            Assert.Equal(1, await dismissedScope.ServiceProvider.GetRequiredService<BudgetContext>()
                .PaycheckCandidateDismissals.CountAsync());
        using var reconsider = await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/reconsider", decision);
        Assert.Equal(HttpStatusCode.NoContent, reconsider.StatusCode);
        var request = Confirmation(candidate);
        var responses = await Task.WhenAll(
            owner.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", request),
            owner.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", request));
        Assert.All(responses, response => Assert.Contains(response.StatusCode,
            new[] { HttpStatusCode.Created, HttpStatusCode.OK }));
        var bodies = await Task.WhenAll(responses.Select(response =>
            response.Content.ReadFromJsonAsync<ConfirmPaycheckResponse>()));
        Assert.Single(bodies, body => !body!.AlreadyConfirmed);
        Assert.Single(bodies, body => body!.AlreadyConfirmed);
        Assert.Single(bodies.Select(body => body!.Paycheck.Id).Distinct());
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        Assert.Equal(1, await context.PaycheckProfiles.CountAsync());
        var occurrences = await context.PaycheckOccurrences.AsNoTracking().OrderBy(value => value.AccountInflowId).ToListAsync();
        Assert.Equal(inflows.Select(value => value.Id), occurrences.Select(value => value.AccountInflowId));
        foreach (var row in occurrences)
        {
            var source = inflows.Single(value => value.Id == row.AccountInflowId);
            var snapshot = candidate.Evidence.Single(value => value.AccountInflowId == row.AccountInflowId);
            Assert.Equal(source.PaycheckEvidenceRevision, row.EvidenceRevisionAtAssignment);
            Assert.Equal(snapshot.SlotAnchor, row.SlotAnchor);
            Assert.Equal(snapshot.TimingOffsetDays, row.TimingOffsetDays);
        }
        Assert.Empty(await context.PaycheckCandidateDismissals.ToListAsync());
    }

    [PostgreSqlFact]
    public async Task Overlapping_old_and_current_fingerprints_cannot_both_confirm()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-overlap@example.com");
        var inflows = await SeedCandidateAsync(app, owner.Id);
        var oldCandidate = await ReadCandidateAsync(owner.Client);
        using (var editScope = app.Services.CreateScope())
        {
            var editContext = editScope.ServiceProvider.GetRequiredService<BudgetContext>();
            var edited = await editContext.AccountInflows.SingleAsync(value => value.Id == inflows[0].Id);
            edited.UpdateEvidence(edited.Description, 1001m, edited.Date);
            await editContext.SaveChangesAsync();
        }
        var currentCandidate = await ReadCandidateAsync(owner.Client);
        Assert.NotEqual(oldCandidate.Fingerprint, currentCandidate.Fingerprint);
        Assert.Equal(oldCandidate.Evidence.Select(value => value.AccountInflowId),
            currentCandidate.Evidence.Select(value => value.AccountInflowId));
        var responses = await Task.WhenAll(
            owner.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", Confirmation(oldCandidate)),
            owner.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", Confirmation(currentCandidate)));
        Assert.Equal(HttpStatusCode.Conflict, responses[0].StatusCode);
        var error = await responses[0].Content.ReadFromJsonAsync<PaycheckError>();
        Assert.Contains(error!.Code, new[] { "candidate_changed", "confirmation_conflict" });
        Assert.Equal(HttpStatusCode.Created, responses[1].StatusCode);
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        Assert.Equal(1, await context.PaycheckProfiles.CountAsync());
        Assert.Equal(3, await context.PaycheckOccurrences.CountAsync());
        var profile = await context.PaycheckProfiles.SingleAsync();
        Assert.Equal(Convert.FromHexString(currentCandidate.Fingerprint), profile.OriginEvidenceFingerprint);
    }

    [PostgreSqlFact]
    public async Task Separate_serializable_confirmations_cannot_assign_one_inflow_to_two_profiles()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-exclusive-race@example.com");
        var inflow = await app.SeedInflowAsync(owner.Id, date: new DateOnly(2026, 9, 10));
        var bothReady = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var readyCount = 0;
        async Task<bool> AssignAsync(byte discriminator)
        {
            using var scope = app.Services.CreateScope();
            var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            await using var transaction = await context.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
            Assert.False(await context.PaycheckOccurrences.AnyAsync(value => value.AccountInflowId == inflow.Id));
            if (Interlocked.Increment(ref readyCount) == 2) bothReady.SetResult();
            await bothReady.Task.WaitAsync(TimeSpan.FromSeconds(10));
            var profile = NewProfile(owner.Id);
            profile.OriginAlgorithmVersion = "synthetic-test-v1";
            profile.OriginEvidenceFingerprint = new byte[32];
            profile.OriginEvidenceFingerprint[0] = discriminator;
            profile.Occurrences.Add(new PaycheckOccurrence
            {
                AccountInflowId = inflow.Id,
                OwnerId = owner.Id,
                EvidenceRevisionAtAssignment = inflow.PaycheckEvidenceRevision,
                SlotAnchor = inflow.Date,
                LinkedAt = DateTime.UtcNow
            });
            context.PaycheckProfiles.Add(profile);
            try
            {
                await context.SaveChangesAsync();
                await transaction.CommitAsync();
                return true;
            }
            catch (Exception exception) when (exception is PostgresException or DbUpdateException)
            {
                var postgres = exception as PostgresException ?? exception.InnerException as PostgresException;
                Assert.NotNull(postgres);
                Assert.Contains(postgres.SqlState, new[] { PostgresErrorCodes.UniqueViolation, PostgresErrorCodes.SerializationFailure });
                await transaction.RollbackAsync();
                return false;
            }
        }
        var results = await Task.WhenAll(AssignAsync(1), AssignAsync(2));
        Assert.Single(results, value => value);
        Assert.Single(results, value => !value);
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        Assert.Equal(1, await context.PaycheckProfiles.CountAsync());
        Assert.Equal(1, await context.PaycheckOccurrences.CountAsync());
    }

    [PostgreSqlFact]
    public async Task Occurrence_insert_failure_rolls_back_profile_and_all_assignments()
    {
        await using var app = new PostgreSqlFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-rollback@example.com");
        var inflows = await SeedCandidateAsync(app, owner.Id);
        var candidate = await ReadCandidateAsync(owner.Client);
        using (var setupScope = app.Services.CreateScope())
        {
            var setupContext = setupScope.ServiceProvider.GetRequiredService<BudgetContext>();
            await setupContext.Database.ExecuteSqlRawAsync("""
                CREATE FUNCTION reject_later_paycheck_occurrence() RETURNS trigger
                LANGUAGE plpgsql AS $function$
                BEGIN
                    IF EXISTS (SELECT 1 FROM "PaycheckOccurrences" WHERE "PaycheckProfileId" = NEW."PaycheckProfileId") THEN
                        RAISE EXCEPTION 'intentional disposable-test paycheck occurrence rejection';
                    END IF;
                    RETURN NEW;
                END;
                $function$;
                CREATE TRIGGER reject_later_paycheck_occurrence_insert
                BEFORE INSERT ON "PaycheckOccurrences"
                FOR EACH ROW EXECUTE FUNCTION reject_later_paycheck_occurrence();
                """);
        }
        using var response = await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", Confirmation(candidate));
        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        var responseText = await response.Content.ReadAsStringAsync();
        var error = JsonSerializer.Deserialize<JsonElement>(responseText);
        Assert.Equal("confirmation_failed", error.GetProperty("code").GetString());
        Assert.Equal(500, error.GetProperty("status").GetInt32());
        Assert.DoesNotContain("PaycheckOccurrences", responseText);
        Assert.DoesNotContain("reject_later_paycheck_occurrence", responseText);
        Assert.DoesNotContain("intentional disposable-test", responseText);
        Assert.DoesNotContain("P0001", responseText);
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        Assert.Empty(await context.PaycheckProfiles.ToListAsync());
        Assert.Empty(await context.PaycheckOccurrences.ToListAsync());
        Assert.Empty(await context.PaycheckCandidateDismissals.ToListAsync());
        Assert.Equal(inflows.Select(value => value.PaycheckEvidenceRevision),
            await context.AccountInflows.OrderBy(value => value.Id).Select(value => value.PaycheckEvidenceRevision).ToListAsync());
        Assert.Equal(candidate.Fingerprint, (await ReadCandidateAsync(owner.Client)).Fingerprint);
    }

    [PostgreSqlFact]
    public async Task Http_inflow_edit_retains_assignment_and_delete_recomputes_projection_without_loaded_dependents()
    {
        await using var app = new FixedDatePostgreSqlPaycheckApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-http-evidence@example.com");
        var inflows = new List<AccountInflow>();
        for (var month = 7; month <= 9; month++)
            inflows.Add(await app.SeedInflowAsync(owner.Id, "synthetic payroll", 1000m, new DateOnly(2026, month, 10)));
        var candidate = await ReadCandidateAsync(owner.Client);
        using var confirmation = await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", Confirmation(candidate));
        Assert.Equal(HttpStatusCode.Created, confirmation.StatusCode);
        var confirmed = (await confirmation.Content.ReadFromJsonAsync<ConfirmPaycheckResponse>())!.Paycheck;
        Assert.Equal(new DateOnly(2026, 10, 10), confirmed.NextProjection!.Anchor);
        var latest = inflows[^1];

        using var update = await owner.Client.PutAsJsonAsync($"/api/inflows/{latest.Id}", new
        {
            id = latest.Id, description = "edited synthetic payroll", amount = 1500m,
            date = latest.Date.AddDays(1)
        });
        Assert.Equal(HttpStatusCode.NoContent, update.StatusCode);
        var edited = await owner.Client.GetFromJsonAsync<PaycheckProfileDto>($"/api/paychecks/{confirmed.Id}");
        Assert.NotNull(edited);
        Assert.Equal(3, edited.Evidence.Count);
        var editedEvidence = Assert.Single(edited.Evidence, value => value.AccountInflowId == latest.Id);
        Assert.True(editedEvidence.EditedSinceConfirmation);
        Assert.Equal("edited synthetic payroll", editedEvidence.Description);
        Assert.Equal(1500m, editedEvidence.Amount);
        Assert.Equal(latest.Date.AddDays(1), editedEvidence.PostedDate);
        Assert.Equal(latest.Date, editedEvidence.SlotAnchor);
        Assert.Equal(0, editedEvidence.TimingOffsetDays);
        Assert.Equal(confirmed.Amount, edited.Amount);
        Assert.Equal(confirmed.Schedule, edited.Schedule);
        Assert.Equal(confirmed.NextProjection, edited.NextProjection);
        using (var checkScope = app.Services.CreateScope())
        {
            var context = checkScope.ServiceProvider.GetRequiredService<BudgetContext>();
            var occurrence = await context.PaycheckOccurrences.AsNoTracking().SingleAsync(value => value.AccountInflowId == latest.Id);
            Assert.Equal(latest.PaycheckEvidenceRevision, occurrence.EvidenceRevisionAtAssignment);
            Assert.NotEqual(latest.PaycheckEvidenceRevision,
                (await context.AccountInflows.AsNoTracking().SingleAsync(value => value.Id == latest.Id)).PaycheckEvidenceRevision);
        }

        // Each HTTP request creates its own context; no occurrence navigation is loaded
        // before InflowsController deletes the principal, so PostgreSQL must cascade it.
        using var deletion = await owner.Client.DeleteAsync($"/api/inflows/{latest.Id}");
        Assert.Equal(HttpStatusCode.NoContent, deletion.StatusCode);
        var remaining = await owner.Client.GetFromJsonAsync<PaycheckProfileDto>($"/api/paychecks/{confirmed.Id}");
        Assert.NotNull(remaining);
        Assert.Equal("active", remaining.Lifecycle);
        Assert.Equal(confirmed.Amount, remaining.Amount);
        Assert.Equal(inflows.Take(2).Select(value => value.Id), remaining.Evidence.Select(value => value.AccountInflowId));
        Assert.Equal(new DateOnly(2026, 8, 10), remaining.Evidence.Max(value => value.SlotAnchor));
        Assert.Equal(new DateOnly(2026, 9, 10), remaining.NextProjection!.Anchor);
        Assert.Equal(new DateOnly(2026, 9, 10), remaining.NextProjection.EvaluatedOn);

        foreach (var inflow in inflows.Take(2))
        {
            using var deleteRemaining = await owner.Client.DeleteAsync($"/api/inflows/{inflow.Id}");
            Assert.Equal(HttpStatusCode.NoContent, deleteRemaining.StatusCode);
        }
        var empty = await owner.Client.GetFromJsonAsync<PaycheckProfileDto>($"/api/paychecks/{confirmed.Id}");
        Assert.NotNull(empty);
        Assert.Empty(empty.Evidence);
        Assert.Equal("active", empty.Lifecycle);
        Assert.Equal(new DateOnly(2026, 9, 10), empty.NextProjection!.Anchor);
        using var finalScope = app.Services.CreateScope();
        var finalContext = finalScope.ServiceProvider.GetRequiredService<BudgetContext>();
        Assert.Equal(1, await finalContext.PaycheckProfiles.CountAsync());
        Assert.Empty(await finalContext.PaycheckOccurrences.ToListAsync());
        Assert.Empty(await finalContext.AccountInflows.ToListAsync());
    }

    private sealed class FixedDatePostgreSqlPaycheckApplication : PostgreSqlFinancialApiTestApplication
    {
        protected override void ConfigureAdditionalServices(IServiceCollection services)
        {
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(new FixedPaycheckDate());
        }
    }

    private sealed class FixedPaycheckDate : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(2026, 9, 10, 23, 59, 0, TimeSpan.Zero);
    }

    private static async Task<List<AccountInflow>> SeedCandidateAsync(PostgreSqlFinancialApiTestApplication app, string ownerId)
    {
        var thisMonth = new DateOnly(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
        var inflows = new List<AccountInflow>();
        for (var monthsAgo = 3; monthsAgo >= 1; monthsAgo--)
            inflows.Add(await app.SeedInflowAsync(ownerId, "synthetic payroll", 1000m, thisMonth.AddMonths(-monthsAgo).AddDays(9)));
        return inflows;
    }

    private static async Task<PaycheckCandidateDto> ReadCandidateAsync(HttpClient client)
    {
        using var response = await client.GetAsync("/api/paycheck-candidates");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<PaycheckCandidatesResponse>();
        return Assert.Single(body!.Candidates);
    }

    private static ConfirmPaycheckRequest Confirmation(PaycheckCandidateDto candidate) => new(
        candidate.AlgorithmVersion, candidate.Fingerprint, "Confirmed synthetic paycheck",
        candidate.Schedule, candidate.WindowBeforeDays, candidate.WindowAfterDays,
        new ConfirmedPaycheckAmountDto("range", null, 900m, 1100m));

    private static PaycheckProfile NewProfile(string ownerId) => new()
    {
        Id = Guid.NewGuid(),
        OwnerId = ownerId,
        DisplayName = "Synthetic paycheck",
        Lifecycle = PaycheckLifecycle.Active,
        Cadence = PaycheckCadence.Monthly,
        FirstMonthAnchor = 10,
        AmountMode = PaycheckAmountMode.Fixed,
        ExpectedAmount = 1000m,
        CreatedAt = new DateTime(2026, 9, 1, 12, 0, 0, DateTimeKind.Utc),
        UpdatedAt = new DateTime(2026, 9, 1, 12, 0, 0, DateTimeKind.Utc)
    };
}
