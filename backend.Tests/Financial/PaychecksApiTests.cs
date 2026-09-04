using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using BudgetPlanner.Data;
using BudgetPlanner.Models;
using BudgetPlanner.Paychecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

[Collection("Environment variable tests")]
public sealed class PaychecksApiTests
{
    private static readonly DateOnly EvaluatedOn = new(2026, 9, 10);

    [Fact]
    public async Task Every_read_and_mutation_requires_authentication()
    {
        await using var app = new PaycheckTestApplication();
        using var client = app.CreateTestClient();
        var id = Guid.NewGuid();
        foreach (var (method, path) in new[]
        {
            (HttpMethod.Get, "/api/paycheck-candidates"),
            (HttpMethod.Post, "/api/paycheck-candidates/dismiss"),
            (HttpMethod.Post, "/api/paycheck-candidates/reconsider"),
            (HttpMethod.Post, "/api/paycheck-candidates/confirm"),
            (HttpMethod.Get, "/api/paychecks"),
            (HttpMethod.Post, "/api/paychecks"),
            (HttpMethod.Get, $"/api/paychecks/{id}"),
            (HttpMethod.Put, $"/api/paychecks/{id}"),
            (HttpMethod.Patch, $"/api/paychecks/{id}/lifecycle")
        })
        {
            using var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(new { }) };
            using var response = await client.SendAsync(request);
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }
    }

    [Fact]
    public async Task Candidates_match_the_pure_detector_exactly_with_owned_sources_and_ordinal_order()
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-evidence@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("paycheck-evidence-other@example.com");
        var zulu = await SeedMonthlyAsync(app, owner.Id, "  Zulu   Deposit  ");
        var alpha = await SeedMonthlyAsync(app, owner.Id, "alpha deposit", variable: true);
        await SeedMonthlyAsync(app, other.Id, "FOREIGN PRIVATE", variable: true);
        await SeedImportedAsync(app, owner.Id, zulu[0]);
        // The nonrelational fixture permits corrupt provenance: it must never establish an owned source.
        await SeedImportedAsync(app, other.Id, zulu[1]);
        await app.SeedInflowAsync(owner.Id, "future only", 100m, EvaluatedOn.AddDays(1));

        var response = await CandidatesAsync(owner.Client);
        Assert.Equal("2026-09-10", response.GetProperty("evaluatedOn").GetString());
        Assert.Empty(response.GetProperty("dismissedCandidates").EnumerateArray());
        var candidates = response.GetProperty("candidates").EnumerateArray().ToArray();
        Assert.Equal(new[] { "alpha deposit", "zulu deposit" }, candidates.Select(c => c.GetProperty("normalizedDescriptionIdentity").GetString()));
        var expected = new PaycheckCandidateDetector().Detect(zulu.Concat(alpha), EvaluatedOn);
        foreach (var (actual, domain) in candidates.Zip(expected))
        {
            AssertKeys(actual, "algorithmVersion", "coveredFrom", "coveredTo", "evidence", "fingerprint", "normalizedDescriptionIdentity", "observedAmount", "occurrenceCount", "schedule", "windowAfterDays", "windowBeforeDays");
            Assert.Equal(domain.EvidenceFingerprint, actual.GetProperty("fingerprint").GetString());
            Assert.Equal(domain.AlgorithmVersion, actual.GetProperty("algorithmVersion").GetString());
            Assert.Equal(3, actual.GetProperty("occurrenceCount").GetInt32());
            Assert.Equal("2026-07-10", actual.GetProperty("coveredFrom").GetString());
            Assert.Equal("2026-09-10", actual.GetProperty("coveredTo").GetString());
            Assert.True(JsonNode.DeepEquals(JsonSerializer.SerializeToNode(Schedule(domain.Schedule)), JsonNode.Parse(actual.GetProperty("schedule").GetRawText())));
            Assert.Equal(domain.WindowBeforeDays, actual.GetProperty("windowBeforeDays").GetInt32());
            Assert.Equal(domain.WindowAfterDays, actual.GetProperty("windowAfterDays").GetInt32());
            foreach (var (evidence, snapshot) in actual.GetProperty("evidence").EnumerateArray().Zip(domain.Evidence))
            {
                AssertKeys(evidence, "accountInflowId", "amount", "description", "postedDate", "slotAnchor", "source", "timingOffsetDays");
                Assert.Equal(snapshot.AccountInflowId, evidence.GetProperty("accountInflowId").GetInt32());
                Assert.Equal(snapshot.Amount, evidence.GetProperty("amount").GetDecimal());
                Assert.Equal(snapshot.Description, evidence.GetProperty("description").GetString());
                Assert.Equal(snapshot.PostedDate.ToString("yyyy-MM-dd"), evidence.GetProperty("postedDate").GetString());
                Assert.Equal(snapshot.SlotAnchor.ToString("yyyy-MM-dd"), evidence.GetProperty("slotAnchor").GetString());
                Assert.Equal(snapshot.TimingOffsetDays, evidence.GetProperty("timingOffsetDays").GetInt32());
                Assert.Equal(snapshot.AccountInflowId == zulu[0].Id ? "imported" : "manual", evidence.GetProperty("source").GetString());
            }
        }
        var observed = candidates[0].GetProperty("observedAmount");
        Assert.Equal("variable", observed.GetProperty("mode").GetString());
        Assert.Equal(1000m, observed.GetProperty("minimumAmount").GetDecimal());
        Assert.Equal(1100m, observed.GetProperty("lowerMedianAmount").GetDecimal());
        Assert.Equal(1200m, observed.GetProperty("maximumAmount").GetDecimal());
        Assert.DoesNotContain("FOREIGN", response.ToString());
        Assert.DoesNotContain("revision", response.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("ownerId", response.ToString());
        Assert.Equal(response.GetRawText(), (await CandidatesAsync(owner.Client)).GetRawText());
        Assert.Equal(0, await CountAsync(app, db => db.PaycheckProfiles.CountAsync()));
    }

    [Fact]
    public async Task Dismissal_is_exact_idempotent_owner_scoped_and_retained_when_evidence_changes()
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-dismiss@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("paycheck-dismiss-other@example.com");
        var rows = await SeedMonthlyAsync(app, owner.Id);
        var candidate = await CandidateAsync(owner.Client);
        var decision = Decision(candidate);
        await AssertErrorAsync(await other.Client.PostAsJsonAsync("/api/paycheck-candidates/dismiss", decision), HttpStatusCode.Conflict, "candidate_changed");
        for (var i = 0; i < 2; i++)
            Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/dismiss", decision)).StatusCode);
        Assert.Equal(1, await CountAsync(app, db => db.PaycheckCandidateDismissals.CountAsync()));
        var dismissed = await CandidatesAsync(owner.Client);
        Assert.Empty(dismissed.GetProperty("candidates").EnumerateArray());
        Assert.Equal(candidate.GetRawText(), Assert.Single(dismissed.GetProperty("dismissedCandidates").EnumerateArray()).GetRawText());
        await AssertErrorAsync(await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", Confirmation(candidate)), HttpStatusCode.Conflict, "candidate_dismissed");
        Assert.Equal(HttpStatusCode.NoContent, (await other.Client.PostAsJsonAsync("/api/paycheck-candidates/reconsider", decision)).StatusCode);
        Assert.Equal(1, await CountAsync(app, db => db.PaycheckCandidateDismissals.CountAsync()));

        await EditInflowAsync(owner.Client, rows[0], amount: 1010m);
        var changed = await CandidateAsync(owner.Client);
        Assert.NotEqual(candidate.GetProperty("fingerprint").GetString(), changed.GetProperty("fingerprint").GetString());
        Assert.Empty((await CandidatesAsync(owner.Client)).GetProperty("dismissedCandidates").EnumerateArray());
        Assert.Equal(1, await CountAsync(app, db => db.PaycheckCandidateDismissals.CountAsync()));
        // Existing exact decisions remain idempotent even when they no longer describe a current candidate.
        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/dismiss", decision)).StatusCode);
        for (var i = 0; i < 2; i++)
            Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/reconsider", decision)).StatusCode);
        Assert.Equal(0, await CountAsync(app, db => db.PaycheckCandidateDismissals.CountAsync()));
        await AssertErrorAsync(await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/dismiss", decision), HttpStatusCode.Conflict, "candidate_changed");
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, true)]
    public async Task Confirmation_persists_explicit_amount_windows_and_exact_occurrences(bool variable, bool range)
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-confirm@example.com");
        var rows = await SeedMonthlyAsync(app, owner.Id, variable: variable);
        var candidate = await CandidateAsync(owner.Client);
        var request = Confirmation(candidate, range ? RangeAmount(900m, 1500m) : FixedAmount(1350m));
        request["accountInflowIds"] = new JsonArray(int.MaxValue);
        request["evidence"] = new JsonArray(JsonSerializer.SerializeToNode(new { accountInflowId = int.MaxValue }));
        using var response = await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(body.GetProperty("alreadyConfirmed").GetBoolean());
        var profile = body.GetProperty("paycheck");
        var id = profile.GetProperty("id").GetGuid();
        Assert.Equal("Synthetic employer", profile.GetProperty("displayName").GetString());
        Assert.Equal("active", profile.GetProperty("lifecycle").GetString());
        Assert.Equal("candidate", profile.GetProperty("source").GetString());
        Assert.Equal(candidate.GetProperty("schedule").GetRawText(), profile.GetProperty("schedule").GetRawText());
        Assert.Equal(candidate.GetProperty("fingerprint").GetString(), profile.GetProperty("origin").GetProperty("fingerprint").GetString());
        Assert.Equal(3, profile.GetProperty("windowBeforeDays").GetInt32());
        Assert.Equal(2, profile.GetProperty("windowAfterDays").GetInt32());
        Assert.Equal(range ? "range" : "fixed", profile.GetProperty("amount").GetProperty("mode").GetString());
        Assert.Equal(range ? 900m : 1350m, profile.GetProperty("amount").GetProperty(range ? "minimumAmount" : "fixedAmount").GetDecimal());
        if (range) Assert.Equal(1500m, profile.GetProperty("amount").GetProperty("maximumAmount").GetDecimal());
        Assert.Equal("2026-10-10", profile.GetProperty("nextProjection").GetProperty("anchor").GetString());
        Assert.All(profile.GetProperty("evidence").EnumerateArray(), e => Assert.False(e.GetProperty("editedSinceConfirmation").GetBoolean()));
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var saved = await db.PaycheckProfiles.AsNoTracking().SingleAsync();
        Assert.Equal(owner.Id, saved.OwnerId);
        Assert.Equal(Convert.FromHexString(candidate.GetProperty("fingerprint").GetString()!), saved.OriginEvidenceFingerprint);
        var occurrences = await db.PaycheckOccurrences.AsNoTracking().OrderBy(e => e.AccountInflowId).ToArrayAsync();
        Assert.Equal(rows.Select(r => r.Id), occurrences.Select(e => e.AccountInflowId));
        foreach (var (row, occurrence) in rows.Zip(occurrences))
        {
            Assert.Equal(id, occurrence.PaycheckProfileId);
            Assert.Equal(owner.Id, occurrence.OwnerId);
            Assert.Equal(row.PaycheckEvidenceRevision, occurrence.EvidenceRevisionAtAssignment);
            Assert.Equal(row.Date, occurrence.SlotAnchor);
            Assert.Equal(0, occurrence.TimingOffsetDays);
            Assert.Equal(PaycheckOccurrenceKind.ConfirmationEvidence, occurrence.Kind);
        }
        Assert.Empty((await CandidatesAsync(owner.Client)).GetProperty("candidates").EnumerateArray());
        using var retry = await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", request);
        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
        var retryBody = await retry.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(retryBody.GetProperty("alreadyConfirmed").GetBoolean());
        Assert.Equal(id, retryBody.GetProperty("paycheck").GetProperty("id").GetGuid());
        Assert.Equal(1, await db.PaycheckProfiles.CountAsync());
    }

    [Fact]
    public async Task Variable_candidate_requires_range_and_confirmation_rejects_stale_or_foreign_tuples()
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-stale@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("paycheck-stale-other@example.com");
        var rows = await SeedMonthlyAsync(app, owner.Id, variable: true);
        var empty = await CandidatesAsync(other.Client);
        Assert.Empty(empty.GetProperty("candidates").EnumerateArray());
        Assert.Empty(empty.GetProperty("dismissedCandidates").EnumerateArray());
        var candidate = await CandidateAsync(owner.Client);
        await AssertErrorAsync(await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", Confirmation(candidate)), HttpStatusCode.BadRequest);
        var request = Confirmation(candidate, RangeAmount(900m, 1400m));
        await AssertErrorAsync(await other.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", request), HttpStatusCode.Conflict, "candidate_changed");
        var mismatched = Confirmation(candidate, RangeAmount(900m, 1400m));
        mismatched["schedule"] = JsonSerializer.SerializeToNode(Schedule(new MonthlyPaycheckSchedule(PaycheckMonthAnchor.DayOfMonth(11))));
        await AssertErrorAsync(await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", mismatched), HttpStatusCode.BadRequest, "candidate_schedule_mismatch");
        await EditInflowAsync(owner.Client, rows[0], amount: 1001m);
        await AssertErrorAsync(await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", request), HttpStatusCode.Conflict, "candidate_changed");
        Assert.Equal(0, await CountAsync(app, db => db.PaycheckProfiles.CountAsync()));
        Assert.Equal(0, await CountAsync(app, db => db.PaycheckOccurrences.CountAsync()));
    }

    [Fact]
    public async Task Manual_creation_has_no_origin_or_evidence_and_ignores_client_ownership_and_link_injection()
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-manual@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("paycheck-manual-other@example.com");
        var foreign = await app.SeedInflowAsync(other.Id, "FOREIGN PRIVATE");
        var request = Manual();
        request["ownerId"] = other.Id;
        request["accountInflowIds"] = new JsonArray(foreign.Id);
        request["evidence"] = new JsonArray(JsonSerializer.SerializeToNode(new { accountInflowId = foreign.Id }));
        using var response = await owner.Client.PostAsJsonAsync("/api/paychecks", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var profile = await response.Content.ReadFromJsonAsync<JsonElement>();
        var id = profile.GetProperty("id").GetGuid();
        Assert.Equal($"/api/paychecks/{id}", response.Headers.Location?.AbsolutePath ?? response.Headers.Location?.OriginalString);
        Assert.Equal("Synthetic employer", profile.GetProperty("displayName").GetString());
        Assert.Equal("manual", profile.GetProperty("source").GetString());
        Assert.Equal(JsonValueKind.Null, profile.GetProperty("origin").ValueKind);
        Assert.Empty(profile.GetProperty("evidence").EnumerateArray());
        Assert.Equal("2026-09-10", profile.GetProperty("nextProjection").GetProperty("anchor").GetString());
        Assert.DoesNotContain("owner", profile.GetRawText(), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("change", profile.GetRawText(), StringComparison.OrdinalIgnoreCase);
        Assert.Empty((await other.Client.GetFromJsonAsync<JsonElement>("/api/paychecks")).GetProperty("paychecks").EnumerateArray());
        Assert.Equal(0, await CountAsync(app, db => db.PaycheckOccurrences.CountAsync()));
    }

    [Theory]
    [MemberData(nameof(ValidSchedules))]
    public async Task Manual_profiles_map_all_schedule_types_to_the_unchanged_projector(PaycheckSchedule schedule)
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-schedules@example.com");
        var request = Manual(schedule: schedule, amount: RangeAmount(1.01m, 9999999999999999.99m));
        using var response = await owner.Client.PostAsJsonAsync("/api/paychecks", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var profile = await response.Content.ReadFromJsonAsync<JsonElement>();
        var actual = profile.GetProperty("nextProjection");
        var expected = new PaycheckProjector().Project(new ConfirmedPaycheckPattern(schedule, 3, 2, new RangeConfirmedPaycheckAmount(1.01m, 9999999999999999.99m)), EvaluatedOn);
        Assert.Equal(PaycheckProjector.AlgorithmVersion, actual.GetProperty("algorithmVersion").GetString());
        Assert.Equal(EvaluatedOn.ToString("yyyy-MM-dd"), actual.GetProperty("evaluatedOn").GetString());
        Assert.Equal(expected.Anchor.ToString("yyyy-MM-dd"), actual.GetProperty("anchor").GetString());
        Assert.Equal(expected.EarliestExpectedDate.ToString("yyyy-MM-dd"), actual.GetProperty("earliestExpectedDate").GetString());
        Assert.Equal(expected.LatestExpectedDate.ToString("yyyy-MM-dd"), actual.GetProperty("latestExpectedDate").GetString());
        Assert.Equal(profile.GetProperty("amount").GetRawText(), actual.GetProperty("amount").GetRawText());
    }

    [Theory]
    [MemberData(nameof(InvalidManualRequests))]
    public async Task Manual_validation_fails_closed_without_persisting(string path, string invalidJson)
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-invalid@example.com");
        var request = Manual();
        SetPath(request, path, JsonNode.Parse(invalidJson));
        await AssertErrorAsync(await owner.Client.PostAsJsonAsync("/api/paychecks", request), HttpStatusCode.BadRequest);
        Assert.Equal(0, await CountAsync(app, db => db.PaycheckProfiles.CountAsync()));
    }

    [Theory]
    [InlineData("displayName")]
    [InlineData("schedule")]
    [InlineData("windowBeforeDays")]
    [InlineData("windowAfterDays")]
    [InlineData("amount")]
    public async Task Manual_creation_requires_explicit_complete_profile_fields(string omitted)
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-missing@example.com");
        var request = Manual();
        request.Remove(omitted);
        await AssertErrorAsync(await owner.Client.PostAsJsonAsync("/api/paychecks", request), HttpStatusCode.BadRequest);
        Assert.Equal(0, await CountAsync(app, db => db.PaycheckProfiles.CountAsync()));
    }

    [Theory]
    [InlineData("algorithmVersion", "null")]
    [InlineData("algorithmVersion", "\"   \"")]
    [InlineData("fingerprint", "null")]
    [InlineData("fingerprint", "\"not-a-fingerprint\"")]
    [InlineData("fingerprint", "\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\"")]
    [InlineData("cadence", "\"annual\"")]
    public async Task Decision_validation_rejects_malformed_exact_tuple(string field, string value)
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-decision-invalid@example.com");
        var request = JsonSerializer.SerializeToNode(new { algorithmVersion = PaycheckCandidateDetector.AlgorithmVersion, cadence = "monthly", fingerprint = new string('a', 64) })!.AsObject();
        request[field] = JsonNode.Parse(value);
        foreach (var action in new[] { "dismiss", "reconsider" })
            await AssertErrorAsync(await owner.Client.PostAsJsonAsync($"/api/paycheck-candidates/{action}", request), HttpStatusCode.BadRequest);
        Assert.Equal(0, await CountAsync(app, db => db.PaycheckCandidateDismissals.CountAsync()));
    }

    [Fact]
    public async Task Missing_and_foreign_item_operations_return_identical_empty_not_found()
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-isolation@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("paycheck-isolation-other@example.com");
        var foreign = await CreateManualAsync(other.Client, "FOREIGN PRIVATE");
        foreach (var id in new[] { foreign.GetProperty("id").GetGuid(), Guid.NewGuid() })
        {
            foreach (var response in new[]
            {
                await owner.Client.GetAsync($"/api/paychecks/{id}"),
                await owner.Client.PutAsJsonAsync($"/api/paychecks/{id}", Update()),
                await owner.Client.PatchAsJsonAsync($"/api/paychecks/{id}/lifecycle", new { lifecycle = "ended" })
            })
            {
                using (response)
                {
                    Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
                    Assert.Empty(await response.Content.ReadAsStringAsync());
                }
            }
        }
    }

    [Fact]
    public async Task Updates_preserve_schedule_and_lifecycle_is_explicit_reversible_and_ordered()
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-lifecycle@example.com");
        var zulu = await CreateManualAsync(owner.Client, "zulu");
        var alpha = await CreateManualAsync(owner.Client, "Alpha");
        var duplicateAlpha = await CreateManualAsync(owner.Client, "Alpha");
        var ended = await CreateManualAsync(owner.Client, "A ended");
        var zuluId = zulu.GetProperty("id").GetGuid();
        var alphaId = alpha.GetProperty("id").GetGuid();
        var duplicateAlphaId = duplicateAlpha.GetProperty("id").GetGuid();
        var endedId = ended.GetProperty("id").GetGuid();
        await SetLifecycleAsync(owner.Client, endedId, "ended");
        await SetLifecycleAsync(owner.Client, zuluId, "paused");
        var list = await owner.Client.GetFromJsonAsync<JsonElement>("/api/paychecks");
        Assert.Equal("2026-09-10", list.GetProperty("evaluatedOn").GetString());
        Assert.Equal(new[] { alphaId, duplicateAlphaId }.Order().Concat(new[] { zuluId, endedId }), list.GetProperty("paychecks").EnumerateArray().Select(p => p.GetProperty("id").GetGuid()));
        foreach (var state in new[] { "active", "ended", "paused", "active", "active" })
        {
            var profile = await SetLifecycleAsync(owner.Client, zuluId, state);
            Assert.Equal(state, profile.GetProperty("lifecycle").GetString());
            Assert.Equal(state == "active" ? JsonValueKind.Object : JsonValueKind.Null, profile.GetProperty("nextProjection").ValueKind);
        }
        var update = Update();
        update["schedule"] = JsonSerializer.SerializeToNode(Schedule(new WeeklyPaycheckSchedule(EvaluatedOn)));
        update["lifecycle"] = "ended";
        for (var i = 0; i < 2; i++)
        {
            using var response = await owner.Client.PutAsJsonAsync($"/api/paychecks/{zuluId}", update);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var result = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(zulu.GetProperty("schedule").GetRawText(), result.GetProperty("schedule").GetRawText());
            Assert.Equal("Updated employer", result.GetProperty("displayName").GetString());
            Assert.Equal("active", result.GetProperty("lifecycle").GetString());
            Assert.Equal("range", result.GetProperty("amount").GetProperty("mode").GetString());
        }
        await AssertErrorAsync(await owner.Client.PatchAsJsonAsync($"/api/paychecks/{zuluId}/lifecycle", new { lifecycle = "deleted" }), HttpStatusCode.BadRequest);
        using var deletion = await owner.Client.DeleteAsync($"/api/paychecks/{zuluId}");
        Assert.Equal(HttpStatusCode.MethodNotAllowed, deletion.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.GetAsync($"/api/paychecks/{zuluId}")).StatusCode);
    }

    [Theory]
    [InlineData("displayName", "\"  \"")]
    [InlineData("windowAfterDays", "4")]
    [InlineData("amount.maximumAmount", "800")]
    public async Task Invalid_updates_leave_the_existing_profile_unchanged(string path, string invalidJson)
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-invalid-update@example.com");
        var original = await CreateManualAsync(owner.Client, "Original");
        var id = original.GetProperty("id").GetGuid();
        var update = Update();
        SetPath(update, path, JsonNode.Parse(invalidJson));
        await AssertErrorAsync(await owner.Client.PutAsJsonAsync($"/api/paychecks/{id}", update), HttpStatusCode.BadRequest);
        var current = await owner.Client.GetFromJsonAsync<JsonElement>($"/api/paychecks/{id}");
        Assert.Equal(original.GetRawText(), current.GetRawText());
    }

    [Theory]
    [InlineData("weekly")]
    [InlineData("biweekly")]
    public async Task Creation_rejects_projection_date_overflow_without_persisting_a_profile(string cadence)
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-overflow-create@example.com");
        var request = ExtremeReferenceProfile(cadence);
        request["windowAfterDays"] = 1;

        await AssertErrorAsync(await owner.Client.PostAsJsonAsync("/api/paychecks", request), HttpStatusCode.BadRequest, "schedule_invalid");

        Assert.Equal(0, await CountAsync(app, db => db.PaycheckProfiles.CountAsync()));
        Assert.Empty((await owner.Client.GetFromJsonAsync<JsonElement>("/api/paychecks")).GetProperty("paychecks").EnumerateArray());
    }

    [Fact]
    public async Task Update_rejects_projection_date_overflow_without_changing_the_profile()
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-overflow-update@example.com");
        using var creation = await owner.Client.PostAsJsonAsync("/api/paychecks", ExtremeReferenceProfile("weekly"));
        Assert.Equal(HttpStatusCode.Created, creation.StatusCode);
        var original = await creation.Content.ReadFromJsonAsync<JsonElement>();
        var id = original.GetProperty("id").GetGuid();
        Assert.Equal("9999-12-31", original.GetProperty("nextProjection").GetProperty("latestExpectedDate").GetString());
        app.Clock.UtcNow = app.Clock.UtcNow.AddMinutes(1);
        var update = Update();
        update["windowAfterDays"] = 1;

        await AssertErrorAsync(await owner.Client.PutAsJsonAsync($"/api/paychecks/{id}", update), HttpStatusCode.BadRequest, "schedule_invalid");

        var current = await owner.Client.GetFromJsonAsync<JsonElement>($"/api/paychecks/{id}");
        Assert.Equal(original.GetProperty("displayName").GetString(), current.GetProperty("displayName").GetString());
        Assert.Equal(original.GetProperty("amount").GetRawText(), current.GetProperty("amount").GetRawText());
        Assert.Equal(original.GetProperty("updatedAt").GetString(), current.GetProperty("updatedAt").GetString());
        Assert.Equal(0, current.GetProperty("windowAfterDays").GetInt32());
        Assert.Equal("active", current.GetProperty("lifecycle").GetString());
    }

    [Fact]
    public async Task Reactivation_rejects_projection_date_overflow_and_keeps_the_profile_paused()
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-overflow-lifecycle@example.com");
        using var creation = await owner.Client.PostAsJsonAsync("/api/paychecks", ExtremeReferenceProfile("biweekly"));
        Assert.Equal(HttpStatusCode.Created, creation.StatusCode);
        var id = (await creation.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        await SetLifecycleAsync(owner.Client, id, "paused");
        var update = Update();
        update["windowAfterDays"] = 1;
        using var updated = await owner.Client.PutAsJsonAsync($"/api/paychecks/{id}", update);
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        var paused = await updated.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, paused.GetProperty("nextProjection").ValueKind);
        app.Clock.UtcNow = app.Clock.UtcNow.AddMinutes(1);

        await AssertErrorAsync(await owner.Client.PatchAsJsonAsync($"/api/paychecks/{id}/lifecycle", new { lifecycle = "active" }), HttpStatusCode.BadRequest, "schedule_invalid");

        var current = await owner.Client.GetFromJsonAsync<JsonElement>($"/api/paychecks/{id}");
        Assert.Equal(paused.GetRawText(), current.GetRawText());
        Assert.Equal("paused", current.GetProperty("lifecycle").GetString());
    }

    private static JsonObject ExtremeReferenceProfile(string cadence)
    {
        var request = Manual(schedule: cadence == "weekly"
            ? new WeeklyPaycheckSchedule(DateOnly.MaxValue)
            : new BiweeklyPaycheckSchedule(DateOnly.MaxValue));
        request["windowAfterDays"] = 0;
        return request;
    }

    [Fact]
    public async Task Evidence_edits_keep_assignment_and_retry_identity_while_showing_current_data_only()
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-edited@example.com");
        var rows = await SeedMonthlyAsync(app, owner.Id);
        var candidate = await CandidateAsync(owner.Client);
        var request = Confirmation(candidate);
        using var confirmation = await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", request);
        confirmation.EnsureSuccessStatusCode();
        var profile = (await confirmation.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("paycheck");
        var id = profile.GetProperty("id").GetGuid();
        await EditInflowAsync(owner.Client, rows[0], 1510m, "Revised description");
        var current = await owner.Client.GetFromJsonAsync<JsonElement>($"/api/paychecks/{id}");
        var evidence = current.GetProperty("evidence").EnumerateArray().ToArray();
        Assert.Equal(3, evidence.Length);
        Assert.True(evidence[0].GetProperty("editedSinceConfirmation").GetBoolean());
        Assert.Equal(1510m, evidence[0].GetProperty("amount").GetDecimal());
        Assert.Equal("Revised description", evidence[0].GetProperty("description").GetString());
        Assert.All(evidence.Skip(1), e => Assert.False(e.GetProperty("editedSinceConfirmation").GetBoolean()));
        Assert.DoesNotContain("revision", current.GetRawText(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(profile.GetProperty("amount").GetRawText(), current.GetProperty("amount").GetRawText());
        Assert.Equal(profile.GetProperty("schedule").GetRawText(), current.GetProperty("schedule").GetRawText());
        await SetLifecycleAsync(owner.Client, id, "ended");
        Assert.Empty((await CandidatesAsync(owner.Client)).GetProperty("candidates").EnumerateArray());
        Assert.Equal(3, await CountAsync(app, db => db.PaycheckOccurrences.CountAsync()));
        await owner.Client.PutAsJsonAsync($"/api/paychecks/{id}", Update());
        using var retry = await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", request);
        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
        var retryBody = await retry.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(retryBody.GetProperty("alreadyConfirmed").GetBoolean());
        Assert.Equal("Updated employer", retryBody.GetProperty("paycheck").GetProperty("displayName").GetString());
        Assert.Equal("ended", retryBody.GetProperty("paycheck").GetProperty("lifecycle").GetString());
    }

    [Fact]
    public async Task Deleted_evidence_recomputes_latest_slot_keeps_profile_and_preserves_confirmation_retry()
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-deleted@example.com");
        var rows = await SeedMonthlyAsync(app, owner.Id);
        var request = Confirmation(await CandidateAsync(owner.Client));
        using var confirmation = await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", request);
        confirmation.EnsureSuccessStatusCode();
        var profile = (await confirmation.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("paycheck");
        var id = profile.GetProperty("id").GetGuid();
        Assert.Equal("2026-10-10", profile.GetProperty("nextProjection").GetProperty("anchor").GetString());
        // InMemory does not execute database cascades for untracked dependents. Load the relationship
        // in the deletion context to exercise EF cascade behavior; PostgreSQL tests prove the API cascade.
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            await db.PaycheckOccurrences.LoadAsync();
            var latestInflowId = rows[^1].Id;
            db.AccountInflows.Remove(await db.AccountInflows.SingleAsync(i => i.Id == latestInflowId));
            await db.SaveChangesAsync();
        }
        var afterLatestDelete = await owner.Client.GetFromJsonAsync<JsonElement>($"/api/paychecks/{id}");
        Assert.Equal(2, afterLatestDelete.GetProperty("evidence").GetArrayLength());
        Assert.Equal("2026-09-10", afterLatestDelete.GetProperty("nextProjection").GetProperty("anchor").GetString());
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            await db.PaycheckOccurrences.LoadAsync();
            db.AccountInflows.RemoveRange(await db.AccountInflows.ToArrayAsync());
            await db.SaveChangesAsync();
        }
        var empty = await owner.Client.GetFromJsonAsync<JsonElement>($"/api/paychecks/{id}");
        Assert.Equal("active", empty.GetProperty("lifecycle").GetString());
        Assert.Empty(empty.GetProperty("evidence").EnumerateArray());
        Assert.Equal("2026-09-10", empty.GetProperty("nextProjection").GetProperty("anchor").GetString());
        Assert.Equal(profile.GetProperty("amount").GetRawText(), empty.GetProperty("amount").GetRawText());
        using var retry = await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", request);
        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
        Assert.True((await retry.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("alreadyConfirmed").GetBoolean());
        Assert.Equal(1, await CountAsync(app, db => db.PaycheckProfiles.CountAsync()));
    }

    [Fact]
    public async Task Later_disjoint_evidence_can_surface_without_automatically_linking_to_an_ended_profile()
    {
        await using var app = new PaycheckTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("paycheck-disjoint@example.com");
        var firstRows = await SeedMonthlyAsync(app, owner.Id);
        using var confirmation = await owner.Client.PostAsJsonAsync("/api/paycheck-candidates/confirm", Confirmation(await CandidateAsync(owner.Client)));
        confirmation.EnsureSuccessStatusCode();
        var id = (await confirmation.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("paycheck").GetProperty("id").GetGuid();
        await SetLifecycleAsync(owner.Client, id, "ended");
        app.Clock.UtcNow = new DateTimeOffset(2026, 12, 10, 12, 0, 0, TimeSpan.Zero);
        var laterRows = new List<AccountInflow>();
        foreach (var month in new[] { 10, 11, 12 })
            laterRows.Add(await app.SeedInflowAsync(owner.Id, "Synthetic deposit", 1000m, new(2026, month, 10)));
        var later = await CandidateAsync(owner.Client);
        Assert.Equal(laterRows.Select(r => r.Id), later.GetProperty("evidence").EnumerateArray().Select(e => e.GetProperty("accountInflowId").GetInt32()));
        var old = await owner.Client.GetFromJsonAsync<JsonElement>($"/api/paychecks/{id}");
        Assert.Equal(firstRows.Select(r => r.Id), old.GetProperty("evidence").EnumerateArray().Select(e => e.GetProperty("accountInflowId").GetInt32()));
        Assert.Equal(1, await CountAsync(app, db => db.PaycheckProfiles.CountAsync()));
    }

    public static IEnumerable<object[]> ValidSchedules()
    {
        yield return [new WeeklyPaycheckSchedule(new(2026, 9, 4))];
        yield return [new BiweeklyPaycheckSchedule(new(2026, 8, 28))];
        yield return [new MonthlyPaycheckSchedule(PaycheckMonthAnchor.DayOfMonth(30))];
        yield return [new MonthlyPaycheckSchedule(PaycheckMonthAnchor.MonthEnd)];
        yield return [new SemimonthlyPaycheckSchedule(PaycheckMonthAnchor.DayOfMonth(15), PaycheckMonthAnchor.MonthEnd)];
        yield return [new SemimonthlyPaycheckSchedule(PaycheckMonthAnchor.DayOfMonth(5), PaycheckMonthAnchor.DayOfMonth(20))];
    }

    public static IEnumerable<object[]> InvalidManualRequests()
    {
        foreach (var (path, value) in new (string, string)[]
        {
            ("displayName", "null"), ("displayName", "\"   \""), ("displayName", JsonSerializer.Serialize(new string('x', 501))),
            ("schedule", "null"), ("schedule.cadence", "null"), ("schedule.cadence", "\"annual\""),
            ("schedule.referenceAnchorDate", "\"2026-09-10\""), ("schedule.firstMonthAnchor", "null"),
            ("schedule.firstMonthAnchor.kind", "null"), ("schedule.firstMonthAnchor.kind", "\"weekday\""),
            ("schedule.firstMonthAnchor.day", "null"), ("schedule.firstMonthAnchor.day", "0"), ("schedule.firstMonthAnchor.day", "31"),
            ("schedule.firstMonthAnchor", "{\"kind\":\"month_end\",\"day\":30}"),
            ("schedule.secondMonthAnchor", "{\"kind\":\"month_end\",\"day\":null}"),
            ("windowBeforeDays", "-1"), ("windowBeforeDays", "4"), ("windowBeforeDays", "null"),
            ("windowAfterDays", "-1"), ("windowAfterDays", "4"), ("windowAfterDays", "null"),
            ("amount", "null"), ("amount.mode", "null"), ("amount.mode", "\"variable\""),
            ("amount.fixedAmount", "null"), ("amount.fixedAmount", "0"), ("amount.fixedAmount", "-1"),
            ("amount.fixedAmount", "1.001"), ("amount.fixedAmount", "10000000000000000"),
            ("amount.minimumAmount", "1"), ("amount.maximumAmount", "2000"),
            ("amount", "{\"mode\":\"range\",\"fixedAmount\":1,\"minimumAmount\":1,\"maximumAmount\":2}"),
            ("amount", "{\"mode\":\"range\",\"minimumAmount\":1}"),
            ("amount", "{\"mode\":\"range\",\"maximumAmount\":2}"),
            ("amount", "{\"mode\":\"range\",\"minimumAmount\":2,\"maximumAmount\":2}"),
            ("amount", "{\"mode\":\"range\",\"minimumAmount\":3,\"maximumAmount\":2}"),
            ("amount", "{\"mode\":\"range\",\"minimumAmount\":0,\"maximumAmount\":2}"),
            ("amount", "{\"mode\":\"range\",\"minimumAmount\":1.001,\"maximumAmount\":2}"),
            ("amount", "{\"mode\":\"range\",\"minimumAmount\":1,\"maximumAmount\":2.001}")
        }) yield return [path, value];
        foreach (var cadence in new[] { "weekly", "biweekly" })
        {
            yield return ["schedule", JsonSerializer.Serialize(new { cadence, referenceAnchorDate = (string?)null, firstMonthAnchor = (object?)null, secondMonthAnchor = (object?)null })];
            yield return ["schedule", JsonSerializer.Serialize(new { cadence, referenceAnchorDate = "2026-09-10", firstMonthAnchor = new { kind = "day_of_month", day = 10 }, secondMonthAnchor = (object?)null })];
            yield return ["schedule", JsonSerializer.Serialize(new { cadence, referenceAnchorDate = "2026-09-10", firstMonthAnchor = (object?)null, secondMonthAnchor = new { kind = "month_end", day = (int?)null } })];
        }
        foreach (var (first, second) in new[] { (15, 15), (20, 10), (25, 31), (1, 30), (1, 7), (0, 15), (15, 32) })
            yield return ["schedule", JsonSerializer.Serialize(new { cadence = "semimonthly", referenceAnchorDate = (string?)null, firstMonthAnchor = Anchor(first), secondMonthAnchor = Anchor(second) })];
        yield return ["schedule", "{\"cadence\":\"semimonthly\",\"firstMonthAnchor\":{\"kind\":\"day_of_month\",\"day\":15}}"];
        yield return ["schedule", "{\"cadence\":\"semimonthly\",\"secondMonthAnchor\":{\"kind\":\"month_end\",\"day\":null}}"];
        yield return ["schedule", "{\"cadence\":\"semimonthly\",\"referenceAnchorDate\":\"2026-09-10\",\"firstMonthAnchor\":{\"kind\":\"day_of_month\",\"day\":15},\"secondMonthAnchor\":{\"kind\":\"month_end\",\"day\":null}}"];
    }

    private static object Anchor(int day) => new { kind = day == 31 ? "month_end" : "day_of_month", day = day == 31 ? (int?)null : day };

    private static object Schedule(PaycheckSchedule schedule) => new
    {
        cadence = schedule.Cadence.ToString().ToLowerInvariant(),
        referenceAnchorDate = schedule switch { WeeklyPaycheckSchedule w => w.ReferenceAnchor.ToString("yyyy-MM-dd"), BiweeklyPaycheckSchedule b => b.ReferenceAnchor.ToString("yyyy-MM-dd"), _ => null },
        firstMonthAnchor = schedule switch { MonthlyPaycheckSchedule m => MonthAnchor(m.Anchor), SemimonthlyPaycheckSchedule s => MonthAnchor(s.First), _ => null },
        secondMonthAnchor = schedule is SemimonthlyPaycheckSchedule semi ? MonthAnchor(semi.Second) : null
    };

    private static object MonthAnchor(PaycheckMonthAnchor anchor) => new { kind = anchor.Kind == PaycheckMonthAnchorKind.MonthEnd ? "month_end" : "day_of_month", day = anchor.Day };
    private static object FixedAmount(decimal value = 1000m) => new { mode = "fixed", fixedAmount = (decimal?)value, minimumAmount = (decimal?)null, maximumAmount = (decimal?)null };
    private static object RangeAmount(decimal minimum, decimal maximum) => new { mode = "range", fixedAmount = (decimal?)null, minimumAmount = (decimal?)minimum, maximumAmount = (decimal?)maximum };

    private static JsonObject Manual(string name = "  Synthetic employer  ", PaycheckSchedule? schedule = null, object? amount = null) => JsonSerializer.SerializeToNode(new
    {
        displayName = name,
        schedule = Schedule(schedule ?? new MonthlyPaycheckSchedule(PaycheckMonthAnchor.DayOfMonth(10))),
        windowBeforeDays = 3, windowAfterDays = 2, amount = amount ?? FixedAmount()
    })!.AsObject();

    private static JsonObject Update() => JsonSerializer.SerializeToNode(new { displayName = "  Updated employer  ", windowBeforeDays = 1, windowAfterDays = 0, amount = RangeAmount(800m, 1600m) })!.AsObject();

    private static JsonObject Confirmation(JsonElement candidate, object? amount = null)
    {
        var request = Manual(amount: amount);
        request["algorithmVersion"] = candidate.GetProperty("algorithmVersion").GetString();
        request["fingerprint"] = candidate.GetProperty("fingerprint").GetString();
        request["schedule"] = JsonNode.Parse(candidate.GetProperty("schedule").GetRawText());
        return request;
    }

    private static object Decision(JsonElement candidate) => new { algorithmVersion = candidate.GetProperty("algorithmVersion").GetString(), cadence = candidate.GetProperty("schedule").GetProperty("cadence").GetString(), fingerprint = candidate.GetProperty("fingerprint").GetString() };
    private static async Task<JsonElement> CandidatesAsync(HttpClient client) => await client.GetFromJsonAsync<JsonElement>("/api/paycheck-candidates");
    private static async Task<JsonElement> CandidateAsync(HttpClient client) => Assert.Single((await CandidatesAsync(client)).GetProperty("candidates").EnumerateArray());

    private static async Task<List<AccountInflow>> SeedMonthlyAsync(FinancialApiTestApplicationBase app, string ownerId, string description = "Synthetic deposit", bool variable = false)
    {
        var rows = new List<AccountInflow>();
        foreach (var month in new[] { 7, 8, 9 })
            rows.Add(await app.SeedInflowAsync(ownerId, description, variable ? 1000m + (month - 7) * 100m : 1000m, new(2026, month, 10)));
        return rows;
    }

    private static async Task EditInflowAsync(HttpClient client, AccountInflow row, decimal amount, string? description = null)
    {
        using var response = await client.PutAsJsonAsync($"/api/inflows/{row.Id}", new { id = row.Id, description = description ?? row.Description, amount, date = row.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) });
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    private static async Task<JsonElement> CreateManualAsync(HttpClient client, string name)
    {
        using var response = await client.PostAsJsonAsync("/api/paychecks", Manual(name));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<JsonElement> SetLifecycleAsync(HttpClient client, Guid id, string lifecycle)
    {
        using var response = await client.PatchAsJsonAsync($"/api/paychecks/{id}/lifecycle", new { lifecycle });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task AssertErrorAsync(HttpResponseMessage response, HttpStatusCode status, string? code = null)
    {
        using (response)
        {
            Assert.Equal(status, response.StatusCode);
            var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
            var actualCode = problem.GetProperty("code").GetString();
            Assert.False(string.IsNullOrWhiteSpace(actualCode));
            if (code is not null) Assert.Equal(code, actualCode);
            Assert.DoesNotContain("FOREIGN", problem.GetRawText());
        }
    }

    private static void AssertKeys(JsonElement value, params string[] expected) => Assert.Equal(expected.Order(StringComparer.Ordinal), value.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));

    private static void SetPath(JsonObject target, string path, JsonNode? value)
    {
        var parts = path.Split('.');
        JsonNode node = target;
        foreach (var part in parts[..^1]) node = node[part]!;
        node[parts[^1]] = value;
    }

    private static async Task<int> CountAsync(FinancialApiTestApplicationBase app, Func<BudgetContext, Task<int>> query)
    {
        using var scope = app.Services.CreateScope();
        return await query(scope.ServiceProvider.GetRequiredService<BudgetContext>());
    }

    private static async Task SeedImportedAsync(FinancialApiTestApplicationBase app, string provenanceOwnerId, AccountInflow inflow)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        var now = new DateTime(2026, 9, 10, 0, 0, 0, DateTimeKind.Utc);
        db.ImportPreviewBatches.Add(new ImportPreviewBatch
        {
            Id = Guid.NewGuid(), OwnerId = provenanceOwnerId, SourceType = "sunflower_pdf", ParserRuleVersion = "paycheck-tests-v1",
            DocumentDigest = Guid.NewGuid().ToByteArray().Concat(Guid.NewGuid().ToByteArray()).ToArray(),
            CreatedAt = now.AddHours(-1), ExpiresAt = now.AddHours(1), ConfirmedAt = now, Lifecycle = ImportPreviewLifecycle.Confirmed,
            InflowProvenance = [new ImportInflowProvenance { OwnerId = provenanceOwnerId, AccountInflowId = inflow.Id, AccountInflowOwnerId = inflow.OwnerId, SourceRowOrdinal = 1 }]
        });
        await db.SaveChangesAsync();
    }
}

internal sealed class PaycheckTestApplication : FinancialApiTestApplication
{
    public PaycheckTestClock Clock { get; } = new();

    protected override void ConfigureAdditionalServices(IServiceCollection services)
    {
        services.RemoveAll<TimeProvider>();
        services.AddSingleton<TimeProvider>(Clock);
    }
}

internal sealed class PaycheckTestClock : TimeProvider
{
    public DateTimeOffset UtcNow { get; set; } = new(2026, 9, 10, 23, 59, 0, TimeSpan.Zero);
    public override DateTimeOffset GetUtcNow() => UtcNow;
}
