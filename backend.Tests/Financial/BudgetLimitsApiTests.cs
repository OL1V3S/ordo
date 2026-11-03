using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

[Collection("Environment variable tests")]
public sealed class BudgetLimitsApiTests
{
    [Fact]
    public async Task Unauthenticated_request_is_rejected()
    {
        await using var app = new FinancialApiTestApplication();
        using var client = app.CreateTestClient();

        var response = await client.GetAsync("/api/budgetlimits?monthYear=2026-08");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Get_requires_month_year()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var response = await owner.Client.GetAsync("/api/budgetlimits");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("One or more validation errors occurred.", body.GetProperty("title").GetString());
        Assert.Equal(400, body.GetProperty("status").GetInt32());
        var monthYearErrors = body.GetProperty("errors").GetProperty("monthYear");
        Assert.Contains(
            "The monthYear field is required.",
            monthYearErrors.EnumerateArray().Select(error => error.GetString()));
    }

    [Fact]
    public async Task Get_rejects_invalid_month_year()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var response = await owner.Client.GetAsync("/api/budgetlimits?monthYear=not-a-month");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(
            "Invalid monthYear format. Expected format: YYYY-MM",
            await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Get_scopes_limits_to_authenticated_user_and_requested_month()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("other@example.com");
        var august = await app.SeedBudgetLimitAsync(owner.Id, "food", 100m);
        await app.SeedBudgetLimitAsync(
            owner.Id,
            "bills",
            200m,
            new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc));
        await app.SeedBudgetLimitAsync(other.Id, "transport", 300m);

        var response = await owner.Client.GetAsync("/api/budgetlimits?monthYear=2026-08");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var limit = Assert.Single(body.EnumerateArray());
        Assert.Equal(august.Id, limit.GetProperty("id").GetInt32());
        Assert.Equal("food", limit.GetProperty("category").GetString());
        Assert.Equal(100m, limit.GetProperty("limitAmount").GetDecimal());
        Assert.Equal(owner.Id, limit.GetProperty("userId").GetString());
        Assert.Equal(JsonValueKind.Null, limit.GetProperty("user").ValueKind);
        Assert.True(limit.TryGetProperty("monthYear", out _));
    }

    private static StringContent Json(string json) =>
        new(json, System.Text.Encoding.UTF8, "application/json");

    [Theory]
    [InlineData("{\"limitAmount\":1,\"monthYear\":\"2026-08-01\"}")]
    [InlineData("{\"category\":\"\",\"limitAmount\":1,\"monthYear\":\"2026-08-01\"}")]
    [InlineData("{\"category\":\"  \",\"limitAmount\":1,\"monthYear\":\"2026-08-01\"}")]
    public async Task Missing_or_blank_category_returns_category_required(string json)
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var response = await owner.Client.PostAsync("/api/budgetlimits", Json(json));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Category is required.", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Null_category_returns_automatic_validation_error()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var response = await owner.Client.PostAsync(
            "/api/budgetlimits",
            Json("{\"category\":null,\"limitAmount\":1,\"monthYear\":\"2026-08-01\"}"));
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("One or more validation errors occurred.", body.GetProperty("title").GetString());
        Assert.Equal(
            "The Category field is required.",
            body.GetProperty("errors").GetProperty("Category")[0].GetString());
    }

    [Theory]
    [InlineData("{\"category\":\"f\",\"limitAmount\":\"x\",\"monthYear\":\"2026-08-01\"}", "$.limitAmount")]
    [InlineData("{\"category\":\"f\",\"limitAmount\":1,\"monthYear\":\"x\"}", "$.monthYear")]
    public async Task Wrong_type_fields_return_automatic_validation_error(string json, string errorKey)
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var response = await owner.Client.PostAsync("/api/budgetlimits", Json(json));
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = body.GetProperty("errors");
        Assert.True(errors.TryGetProperty(errorKey, out _));
        Assert.True(errors.TryGetProperty("limit", out _));
    }

    [Fact]
    public async Task Extra_body_fields_are_ignored_and_create_one_caller_owned_row()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("other@example.com");
        var otherLimit = await app.SeedBudgetLimitAsync(other.Id, "food", 50m);
        var usersBefore = await app.CountUsersAsync();

        var response = await owner.Client.PostAsync(
            "/api/budgetlimits",
            Json($$$"""
            {"category":"food","limitAmount":10,"monthYear":"2026-08-01",
             "id":{{{otherLimit.Id}}},"userId":"{{{other.Id}}}",
             "user":{"id":"{{{other.Id}}}","email":"injected@example.com","userName":"injected"}}
            """));
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(owner.Id, body.GetProperty("userId").GetString());
        Assert.NotEqual(otherLimit.Id, body.GetProperty("id").GetInt32());
        Assert.Single(await app.FindBudgetLimitsAsync(owner.Id, "food"));
        var untouched = Assert.Single(await app.FindBudgetLimitsAsync(other.Id, "food"));
        Assert.Equal(otherLimit.Id, untouched.Id);
        Assert.Equal(50m, untouched.LimitAmount);
        Assert.Equal(usersBefore, await app.CountUsersAsync());
    }

    [Fact]
    public async Task Extra_body_fields_on_existing_row_update_only_limit_amount()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("other@example.com");
        var existing = await app.SeedBudgetLimitAsync(owner.Id, "food", 100m);
        var usersBefore = await app.CountUsersAsync();

        var response = await owner.Client.PostAsync(
            "/api/budgetlimits",
            Json($$$"""
            {"category":"food","limitAmount":20,"monthYear":"2026-08-01",
             "userId":"{{{other.Id}}}","user":{"id":"{{{other.Id}}}","email":"injected@example.com"}}
            """));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var persisted = Assert.Single(await app.FindBudgetLimitsAsync(owner.Id, "food"));
        Assert.Equal(existing.Id, persisted.Id);
        Assert.Equal(20m, persisted.LimitAmount);
        Assert.Equal(owner.Id, persisted.UserId);
        Assert.Equal(usersBefore, await app.CountUsersAsync());
    }

    [Fact]
    public async Task Post_response_has_exactly_the_expected_keys()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var response = await owner.Client.PostAsJsonAsync("/api/budgetlimits", new
        {
            category = "food",
            limitAmount = 5m,
            monthYear = "2026-08-01"
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(
            new[] { "category", "id", "limitAmount", "monthYear", "userId" },
            body.EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal));
    }

    [Fact]
    public async Task Create_assigns_owner_and_normalizes_month_to_first_day_utc()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("other@example.com");

        var response = await owner.Client.PostAsJsonAsync("/api/budgetlimits", new
        {
            category = "food",
            limitAmount = 125.50m,
            monthYear = "2026-08-23T14:30:00",
            userId = other.Id
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(owner.Id, body.GetProperty("userId").GetString());
        Assert.Equal("food", body.GetProperty("category").GetString());
        Assert.Equal(125.50m, body.GetProperty("limitAmount").GetDecimal());
        Assert.False(body.TryGetProperty("user", out _));

        var limits = await app.FindBudgetLimitsAsync(owner.Id, "food");
        var persisted = Assert.Single(limits);
        Assert.Equal(new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc), persisted.MonthYear);
        Assert.Equal(DateTimeKind.Utc, persisted.MonthYear.Kind);
    }

    [Fact]
    public async Task Same_user_category_and_month_updates_existing_limit()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        var existing = await app.SeedBudgetLimitAsync(owner.Id, "food", 100m);

        var response = await owner.Client.PostAsJsonAsync("/api/budgetlimits", new
        {
            category = "food",
            limitAmount = 250m,
            monthYear = "2026-08-31"
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(existing.Id, body.GetProperty("id").GetInt32());
        Assert.Equal(250m, body.GetProperty("limitAmount").GetDecimal());
        var limits = await app.FindBudgetLimitsAsync(owner.Id, "food");
        Assert.Equal(250m, Assert.Single(limits).LimitAmount);
    }

    [Fact]
    public async Task Category_variants_resolve_to_one_canonical_row()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("other@example.com");
        await app.SeedBudgetLimitAsync(owner.Id, "food", 100m);
        await app.SeedBudgetLimitAsync(other.Id, "food", 7m);

        foreach (var category in new[] { "Food", " food ", "FOOD", "fOoD" })
        {
            var response = await owner.Client.PostAsJsonAsync("/api/budgetlimits", new
            {
                category,
                limitAmount = 200m,
                monthYear = "2026-08-15"
            });
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("food", body.GetProperty("category").GetString());
        }

        Assert.Equal(200m, Assert.Single(await app.FindBudgetLimitsAsync(owner.Id, "food")).LimitAmount);
        Assert.Empty(await app.FindBudgetLimitsAsync(owner.Id, "Food"));
        Assert.Empty(await app.FindBudgetLimitsAsync(owner.Id, " food "));
        Assert.Equal(7m, Assert.Single(await app.FindBudgetLimitsAsync(other.Id, "food")).LimitAmount);
    }

    [Fact]
    public async Task Internal_whitespace_is_collapsed_in_the_stored_category()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var response = await owner.Client.PostAsJsonAsync("/api/budgetlimits", new
        {
            category = "  Eating   OUT ",
            limitAmount = 10m,
            monthYear = "2026-08-15"
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Single(await app.FindBudgetLimitsAsync(owner.Id, "eating out"));
    }

    [Fact]
    public async Task Create_accepts_zero_limit()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var response = await owner.Client.PostAsJsonAsync("/api/budgetlimits", new
        {
            category = "edge-zero",
            limitAmount = 0m,
            monthYear = "2026-08-15"
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(0m, Assert.Single(await app.FindBudgetLimitsAsync(owner.Id, "edge-zero")).LimitAmount);
    }

    [Theory]
    [InlineData("-75.25", "limit_amount_negative")]
    [InlineData("10.001", "limit_amount_precision_invalid")]
    [InlineData("10000000000000000.00", "limit_amount_out_of_range")]
    public async Task Invalid_amounts_are_rejected_with_a_code_and_nothing_is_written(string amountText, string code)
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        var existing = await app.SeedBudgetLimitAsync(owner.Id, "food", 100m);

        var response = await owner.Client.PostAsync(
            "/api/budgetlimits",
            Json($"{{\"category\":\"food\",\"limitAmount\":{amountText},\"monthYear\":\"2026-08-01\"}}"));
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(
            code,
            body.GetProperty("errors").GetProperty("limitAmount").EnumerateArray().Select(e => e.GetString()));
        Assert.Equal(100m, Assert.Single(await app.FindBudgetLimitsAsync(owner.Id, "food")).LimitAmount);
        Assert.Equal(existing.Id, (await app.FindBudgetLimitsAsync(owner.Id, "food"))[0].Id);
    }

    [Theory]
    [InlineData("OTHER", "category_reserved")]
    [InlineData(" Other ", "category_reserved")]
    public async Task Reserved_category_is_rejected(string category, string code)
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var response = await owner.Client.PostAsJsonAsync("/api/budgetlimits", new
        {
            category,
            limitAmount = 1m,
            monthYear = "2026-08-01"
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(
            code,
            body.GetProperty("errors").GetProperty("category").EnumerateArray().Select(e => e.GetString()));
        Assert.Empty(await app.FindBudgetLimitsAsync(owner.Id, "other"));
    }

    [Fact]
    public async Task Category_over_100_characters_is_rejected_and_not_truncated()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var response = await owner.Client.PostAsJsonAsync("/api/budgetlimits", new
        {
            category = new string('a', 101),
            limitAmount = 1m,
            monthYear = "2026-08-01"
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(
            "category_too_long",
            body.GetProperty("errors").GetProperty("category").EnumerateArray().Select(e => e.GetString()));
        Assert.Empty(await app.FindBudgetLimitsAsync(owner.Id, new string('a', 101)));
        Assert.Empty(await app.FindBudgetLimitsAsync(owner.Id, new string('a', 100)));
    }

    [Fact]
    public async Task Whitespace_only_category_is_still_rejected()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var rejected = await owner.Client.PostAsJsonAsync("/api/budgetlimits", new
        {
            category = "   ",
            limitAmount = 100m,
            monthYear = "2026-08-15"
        });

        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        Assert.Equal("Category is required.", await rejected.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Seeded_duplicate_limits_are_both_returned_and_upsert_updates_only_one()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        await app.SeedBudgetLimitAsync(owner.Id, "food", 100m);
        await app.SeedBudgetLimitAsync(owner.Id, "food", 150m);

        var before = await owner.Client.GetFromJsonAsync<JsonElement>(
            "/api/budgetlimits?monthYear=2026-08");
        Assert.Equal(2, before.GetArrayLength());

        var response = await owner.Client.PostAsJsonAsync("/api/budgetlimits", new
        {
            category = "food",
            limitAmount = 300m,
            monthYear = "2026-08-15"
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var persisted = await app.FindBudgetLimitsAsync(owner.Id, "food");
        Assert.Equal(2, persisted.Count);
        Assert.Single(persisted, limit => limit.LimitAmount == 300m);
        Assert.Single(persisted, limit => limit.LimitAmount is 100m or 150m);
    }

    [Fact]
    public async Task Delete_removes_owned_limit()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        var limit = await app.SeedBudgetLimitAsync(owner.Id);

        var response = await owner.Client.DeleteAsync($"/api/budgetlimits/{limit.Id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(await app.FindBudgetLimitsAsync(owner.Id, limit.Category));
    }

    [Fact]
    public async Task Delete_of_another_users_limit_returns_not_found_and_preserves_it()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("other@example.com");
        var limit = await app.SeedBudgetLimitAsync(other.Id);

        var response = await owner.Client.DeleteAsync($"/api/budgetlimits/{limit.Id}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Single(await app.FindBudgetLimitsAsync(other.Id, limit.Category));
    }

    [Fact]
    public async Task Delete_of_missing_limit_returns_not_found()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var response = await owner.Client.DeleteAsync("/api/budgetlimits/404");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
