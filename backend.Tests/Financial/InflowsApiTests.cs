using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

[Collection("Environment variable tests")]
public sealed class InflowsApiTests
{
    [Fact]
    public async Task Unauthenticated_request_is_rejected()
    {
        await using var app = new FinancialApiTestApplication();
        using var client = app.CreateTestClient();

        using var response = await client.GetAsync("/api/inflows");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Create_assigns_authenticated_owner_trims_description_and_returns_explicit_dto()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("inflow-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("inflow-other@example.com");

        using var response = await owner.Client.PostAsJsonAsync("/api/inflows", new
        {
            description = "  Synthetic   Deposit  ",
            amount = 2450.25m,
            date = "2026-09-03",
            ownerId = other.Id
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("Synthetic   Deposit", body.GetProperty("description").GetString());
        Assert.Equal(2450.25m, body.GetProperty("amount").GetDecimal());
        Assert.Equal("2026-09-03", body.GetProperty("date").GetString());
        Assert.False(body.TryGetProperty("ownerId", out _));
        Assert.False(body.TryGetProperty("owner", out _));
        Assert.False(body.TryGetProperty("paycheckEvidenceRevision", out _));
        Assert.Equal(
            $"/api/inflows/{body.GetProperty("id").GetInt32()}",
            response.Headers.Location?.AbsolutePath);

        var persisted = await app.FindInflowAsync(body.GetProperty("id").GetInt32());
        Assert.NotNull(persisted);
        Assert.Equal(owner.Id, persisted.OwnerId);
        Assert.NotEqual(Guid.Empty, persisted.PaycheckEvidenceRevision);
    }

    [Fact]
    public async Task List_is_owner_scoped_and_deterministically_orders_date_then_id_descending()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("inflow-list-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("inflow-list-other@example.com");
        var older = await app.SeedInflowAsync(owner.Id, "older", date: new(2026, 8, 31));
        var firstLatest = await app.SeedInflowAsync(owner.Id, "latest first", date: new(2026, 9, 2));
        var secondLatest = await app.SeedInflowAsync(owner.Id, "latest second", date: new(2026, 9, 2));
        await app.SeedInflowAsync(other.Id, "FOREIGN PRIVATE", date: new(2026, 9, 3));

        using var response = await owner.Client.GetAsync("/api/inflows");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(
            [secondLatest.Id, firstLatest.Id, older.Id],
            body.EnumerateArray().Select(value => value.GetProperty("id").GetInt32()));
        Assert.DoesNotContain("FOREIGN PRIVATE", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Item_read_returns_owned_record_and_bare_not_found_for_missing_or_foreign()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("inflow-read-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("inflow-read-other@example.com");
        var owned = await app.SeedInflowAsync(owner.Id, "owned");
        var foreign = await app.SeedInflowAsync(other.Id, "FOREIGN PRIVATE");

        using var found = await owner.Client.GetAsync($"/api/inflows/{owned.Id}");
        using var hidden = await owner.Client.GetAsync($"/api/inflows/{foreign.Id}");
        using var missing = await owner.Client.GetAsync("/api/inflows/2147483647");

        Assert.Equal(HttpStatusCode.OK, found.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
        Assert.Empty(await hidden.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Empty(await missing.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("123.456")]
    [InlineData("10000000000000000")]
    public async Task Create_rejects_invalid_amounts(string amountText)
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync($"inflow-amount-{Guid.NewGuid()}@example.com");

        using var response = await owner.Client.PostAsJsonAsync("/api/inflows", new
        {
            description = "amount edge",
            amount = decimal.Parse(amountText, System.Globalization.CultureInfo.InvariantCulture),
            date = "2026-09-03"
        });

        await AssertValidationErrorAsync(response, "amount");
    }

    [Fact]
    public async Task Create_accepts_numeric_18_2_maximum_and_rejects_missing_or_timestamp_date()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("inflow-date-owner@example.com");

        using var accepted = await owner.Client.PostAsJsonAsync("/api/inflows", new
        {
            description = "maximum",
            amount = 9999999999999999.99m,
            date = "2026-09-03"
        });
        using var missing = await owner.Client.PostAsJsonAsync("/api/inflows", new
        {
            description = "missing date",
            amount = 1m
        });
        using var timestamp = await owner.Client.PostAsJsonAsync("/api/inflows", new
        {
            description = "timestamp date",
            amount = 1m,
            date = "2026-09-03T00:00:00Z"
        });

        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);
        await AssertValidationErrorAsync(missing, "date");
        Assert.Equal(HttpStatusCode.BadRequest, timestamp.StatusCode);
    }

    [Fact]
    public async Task Create_validates_description_after_outer_trim_and_allows_manual_duplicates()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("inflow-description-owner@example.com");
        var boundary = new string('D', 500);

        using var accepted = await owner.Client.PostAsJsonAsync("/api/inflows", new
        {
            description = $"  {boundary}  ", amount = 1m, date = "2026-09-03"
        });
        using var duplicate = await owner.Client.PostAsJsonAsync("/api/inflows", new
        {
            description = $"  {boundary}  ", amount = 1m, date = "2026-09-03"
        });
        using var blank = await owner.Client.PostAsJsonAsync("/api/inflows", new
        {
            description = "   ", amount = 1m, date = "2026-09-03"
        });
        using var tooLong = await owner.Client.PostAsJsonAsync("/api/inflows", new
        {
            description = new string('x', 501), amount = 1m, date = "2026-09-03"
        });

        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);
        Assert.Equal(HttpStatusCode.Created, duplicate.StatusCode);
        await AssertValidationErrorAsync(blank, "description");
        await AssertValidationErrorAsync(tooLong, "description");
    }

    [Fact]
    public async Task Update_uses_evidence_semantics_for_equivalent_and_material_edits()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("inflow-update-owner@example.com");
        var inflow = await app.SeedInflowAsync(owner.Id, "Weekly   Payroll", 100m, new(2026, 9, 1));
        var originalRevision = inflow.PaycheckEvidenceRevision;

        using var formatting = await owner.Client.PutAsJsonAsync($"/api/inflows/{inflow.Id}", new
        {
            id = inflow.Id,
            description = "  weekly payroll  ",
            amount = 100m,
            date = "2026-09-01"
        });
        var afterFormatting = await app.FindInflowAsync(inflow.Id);

        Assert.Equal(HttpStatusCode.NoContent, formatting.StatusCode);
        Assert.NotNull(afterFormatting);
        Assert.Equal("weekly payroll", afterFormatting.Description);
        Assert.Equal(originalRevision, afterFormatting.PaycheckEvidenceRevision);

        using var material = await owner.Client.PutAsJsonAsync($"/api/inflows/{inflow.Id}", new
        {
            id = inflow.Id,
            description = "different payroll",
            amount = 101m,
            date = "2026-09-02"
        });
        var afterMaterial = await app.FindInflowAsync(inflow.Id);

        Assert.Equal(HttpStatusCode.NoContent, material.StatusCode);
        Assert.NotNull(afterMaterial);
        Assert.NotEqual(originalRevision, afterMaterial.PaycheckEvidenceRevision);
    }

    [Fact]
    public async Task Update_rejects_id_mismatch_and_hides_foreign_before_validation()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("inflow-write-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("inflow-write-other@example.com");
        var foreign = await app.SeedInflowAsync(other.Id, "protected");

        using var mismatch = await owner.Client.PutAsJsonAsync("/api/inflows/1", new
        {
            id = 2, description = "mismatch", amount = 1m, date = "2026-09-03"
        });
        using var hidden = await owner.Client.PutAsJsonAsync($"/api/inflows/{foreign.Id}", new
        {
            id = foreign.Id, description = "   ", amount = -1m, date = (string?)null
        });

        Assert.Equal(HttpStatusCode.BadRequest, mismatch.StatusCode);
        Assert.Equal("Inflow ID mismatch", await mismatch.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
        Assert.Empty(await hidden.Content.ReadAsStringAsync());
        Assert.Equal("protected", (await app.FindInflowAsync(foreign.Id))?.Description);
    }

    [Fact]
    public async Task Delete_removes_owned_record_and_hides_foreign_or_missing()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("inflow-delete-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("inflow-delete-other@example.com");
        var owned = await app.SeedInflowAsync(owner.Id, "delete me");
        var foreign = await app.SeedInflowAsync(other.Id, "protected");

        using var deleted = await owner.Client.DeleteAsync($"/api/inflows/{owned.Id}");
        using var hidden = await owner.Client.DeleteAsync($"/api/inflows/{foreign.Id}");
        using var missing = await owner.Client.DeleteAsync("/api/inflows/2147483647");

        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.Null(await app.FindInflowAsync(owned.Id));
        Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
        Assert.Empty(await hidden.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.NotNull(await app.FindInflowAsync(foreign.Id));
    }

    private static async Task AssertValidationErrorAsync(HttpResponseMessage response, string field)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True(body.GetProperty("errors").TryGetProperty(field, out _));
    }
}
