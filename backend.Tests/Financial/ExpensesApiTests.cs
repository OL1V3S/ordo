using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

[Collection("Environment variable tests")]
public sealed class ExpensesApiTests
{
    [Fact]
    public async Task Unauthenticated_request_is_rejected()
    {
        await using var app = new FinancialApiTestApplication();
        using var client = app.CreateTestClient();

        var response = await client.GetAsync("/api/expenses");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Get_returns_only_authenticated_users_expenses_without_ownership_fields_and_preserves_legacy_values()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("other@example.com");
        var owned = await app.SeedExpenseAsync(
            owner.Id,
            description: "  legacy description  ",
            amount: -12.34m,
            category: " Legacy  Category ");
        await app.SeedExpenseAsync(other.Id, "hidden", 98.76m, category: "Bills");

        var response = await owner.Client.GetAsync("/api/expenses");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var expense = Assert.Single(body.EnumerateArray());
        Assert.Equal(owned.Id, expense.GetProperty("id").GetInt32());
        Assert.Equal("  legacy description  ", expense.GetProperty("description").GetString());
        Assert.Equal(-12.34m, expense.GetProperty("amount").GetDecimal());
        Assert.Equal(" Legacy  Category ", expense.GetProperty("category").GetString());
        Assert.False(expense.TryGetProperty("userId", out _));
        Assert.False(expense.TryGetProperty("user", out _));
        Assert.True(expense.TryGetProperty("date", out _));
    }

    [Fact]
    public async Task Create_assigns_authenticated_owner_normalizes_fields_and_returns_expense_dto()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("other@example.com");

        var response = await owner.Client.PostAsJsonAsync("/api/expenses", new
        {
            description = "  Mixed   CASE  ",
            amount = 42.25m,
            date = "2026-08-15",
            category = "  Food   And   Dining  ",
            userId = other.Id
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("Mixed   CASE", body.GetProperty("description").GetString());
        Assert.Equal(42.25m, body.GetProperty("amount").GetDecimal());
        Assert.Equal("food and dining", body.GetProperty("category").GetString());
        Assert.False(body.TryGetProperty("userId", out _));
        Assert.False(body.TryGetProperty("user", out _));
        Assert.NotNull(response.Headers.Location);

        var persisted = await app.FindExpenseAsync(body.GetProperty("id").GetInt32());
        Assert.NotNull(persisted);
        Assert.Equal(owner.Id, persisted.UserId);
        Assert.Equal("Mixed   CASE", persisted.Description);
        Assert.Equal("food and dining", persisted.Category);
        Assert.Equal(new DateOnly(2026, 8, 15), persisted.Date);
        Assert.Equal("2026-08-15", body.GetProperty("date").GetString());
    }

    [Fact]
    public async Task Create_rejects_timestamp_shaped_expense_date()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var response = await owner.Client.PostAsJsonAsync("/api/expenses", new
        {
            description = "timestamp date",
            amount = 1m,
            date = "2026-08-15T00:00:00Z",
            category = "food"
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-12.34")]
    public async Task Create_rejects_non_positive_amounts(string amountText)
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        var amount = decimal.Parse(amountText, System.Globalization.CultureInfo.InvariantCulture);

        var response = await owner.Client.PostAsJsonAsync("/api/expenses", new
        {
            description = "amount edge",
            amount,
            date = "2026-08-15",
            category = "food"
        });

        await AssertValidationErrorAsync(response, "amount");
    }

    [Fact]
    public async Task Create_rejects_more_than_two_decimal_places()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var response = await owner.Client.PostAsJsonAsync("/api/expenses", new
        {
            description = "precision edge",
            amount = 123.456m,
            date = "2026-08-15",
            category = "food"
        });

        await AssertValidationErrorAsync(response, "amount");
    }

    [Fact]
    public async Task Create_enforces_existing_numeric_18_2_range_without_smaller_product_ceiling()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var accepted = await owner.Client.PostAsJsonAsync("/api/expenses", new
        {
            description = "maximum",
            amount = 9999999999999999.99m,
            date = "2026-08-15",
            category = "food"
        });
        var acceptedBody = await accepted.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);
        Assert.Equal(9999999999999999.99m, acceptedBody.GetProperty("amount").GetDecimal());

        var rejected = await owner.Client.PostAsJsonAsync("/api/expenses", new
        {
            description = "overflow",
            amount = 10000000000000000m,
            date = "2026-08-15",
            category = "food"
        });

        await AssertValidationErrorAsync(rejected, "amount");
    }

    [Fact]
    public async Task Create_validates_description_after_outer_trim()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        var boundaryDescription = new string('D', 500);

        var accepted = await owner.Client.PostAsJsonAsync("/api/expenses", new
        {
            description = $"   {boundaryDescription}   ",
            amount = 1m,
            date = "2026-08-15",
            category = "food"
        });
        var acceptedBody = await accepted.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);
        Assert.Equal(boundaryDescription, acceptedBody.GetProperty("description").GetString());

        var blank = await owner.Client.PostAsJsonAsync("/api/expenses", new
        {
            description = "   ",
            amount = 1m,
            date = "2026-08-15",
            category = "food"
        });
        await AssertValidationErrorAsync(blank, "description");

        var tooLong = await owner.Client.PostAsJsonAsync("/api/expenses", new
        {
            description = new string('x', 501),
            amount = 1m,
            date = "2026-08-15",
            category = "food"
        });
        await AssertValidationErrorAsync(tooLong, "description");
    }

    [Fact]
    public async Task Create_validates_category_after_canonicalization()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        var acceptedCategory = $"  {new string('A', 50)}    {new string('B', 49)}  ";
        var expectedCategory = $"{new string('a', 50)} {new string('b', 49)}";

        var accepted = await owner.Client.PostAsJsonAsync("/api/expenses", new
        {
            description = "category boundary",
            amount = 1m,
            date = "2026-08-15",
            category = acceptedCategory
        });
        var acceptedBody = await accepted.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);
        Assert.Equal(100, expectedCategory.Length);
        Assert.Equal(expectedCategory, acceptedBody.GetProperty("category").GetString());

        var blank = await owner.Client.PostAsJsonAsync("/api/expenses", new
        {
            description = "blank category",
            amount = 1m,
            date = "2026-08-15",
            category = "   "
        });
        await AssertValidationErrorAsync(blank, "category");

        var tooLong = await owner.Client.PostAsJsonAsync("/api/expenses", new
        {
            description = "long category",
            amount = 1m,
            date = "2026-08-15",
            category = $"{new string('A', 50)}   {new string('B', 50)}"
        });
        await AssertValidationErrorAsync(tooLong, "category");
    }

    [Fact]
    public async Task Create_rejects_other_ui_sentinel_as_persisted_category()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var response = await owner.Client.PostAsJsonAsync("/api/expenses", new
        {
            description = "sentinel",
            amount = 1m,
            date = "2026-08-15",
            category = " OTHER "
        });

        await AssertValidationErrorAsync(response, "category");
    }

    [Fact]
    public async Task Put_rejects_route_and_body_id_mismatch_before_lookup()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var response = await owner.Client.PutAsJsonAsync("/api/expenses/123", new
        {
            id = 456,
            description = "mismatch",
            amount = 1m,
            date = "2026-08-15",
            category = "food"
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Expense ID mismatch", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Put_updates_owned_expense_with_authoritative_normalization()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        var expense = await app.SeedExpenseAsync(owner.Id);

        var response = await owner.Client.PutAsJsonAsync($"/api/expenses/{expense.Id}", new
        {
            id = expense.Id,
            description = "  Updated   Description  ",
            amount = 4.50m,
            date = "2026-09-03",
            category = " HOME   Supplies "
        });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var persisted = await app.FindExpenseAsync(expense.Id);
        Assert.NotNull(persisted);
        Assert.Equal("Updated   Description", persisted.Description);
        Assert.Equal(4.50m, persisted.Amount);
        Assert.Equal("home supplies", persisted.Category);
        Assert.Equal(owner.Id, persisted.UserId);
        Assert.Equal(new DateOnly(2026, 9, 3), persisted.Date);
    }

    [Fact]
    public async Task Put_rotates_commitment_evidence_revision_for_material_evidence_changes()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        var expense = await app.SeedExpenseAsync(owner.Id, "original", 4.50m, category: "food");
        var originalRevision = expense.CommitmentEvidenceRevision;

        var response = await owner.Client.PutAsJsonAsync($"/api/expenses/{expense.Id}", new
        {
            id = expense.Id,
            description = "changed",
            amount = expense.Amount,
            date = expense.Date.ToString("yyyy-MM-dd"),
            category = expense.Category
        });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var persisted = await app.FindExpenseAsync(expense.Id);
        Assert.NotNull(persisted);
        Assert.NotEqual(Guid.Empty, persisted.CommitmentEvidenceRevision);
        Assert.NotEqual(originalRevision, persisted.CommitmentEvidenceRevision);
    }

    [Fact]
    public async Task Put_preserves_commitment_evidence_revision_for_equivalent_description_formatting()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        var expense = await app.SeedExpenseAsync(owner.Id, "Weekly   Shop", 4.50m, category: "food");
        var originalRevision = expense.CommitmentEvidenceRevision;

        var response = await owner.Client.PutAsJsonAsync($"/api/expenses/{expense.Id}", new
        {
            id = expense.Id,
            description = "  weekly shop  ",
            amount = expense.Amount,
            date = expense.Date.ToString("yyyy-MM-dd"),
            category = " FOOD "
        });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var persisted = await app.FindExpenseAsync(expense.Id);
        Assert.NotNull(persisted);
        Assert.Equal(originalRevision, persisted.CommitmentEvidenceRevision);
    }

    [Fact]
    public async Task Put_of_another_users_expense_returns_not_found_before_write_validation()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("other@example.com");
        var expense = await app.SeedExpenseAsync(other.Id, "protected");

        var response = await owner.Client.PutAsJsonAsync($"/api/expenses/{expense.Id}", new
        {
            id = expense.Id,
            description = "changed",
            amount = 99m,
            date = "2026-08-15",
            category = "other"
        });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var persisted = await app.FindExpenseAsync(expense.Id);
        Assert.NotNull(persisted);
        Assert.Equal("protected", persisted.Description);
        Assert.Equal(other.Id, persisted.UserId);
    }

    [Fact]
    public async Task Put_of_missing_expense_returns_not_found()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var response = await owner.Client.PutAsJsonAsync("/api/expenses/404", new
        {
            id = 404,
            description = "missing",
            amount = 1m,
            date = "2026-08-15",
            category = "food"
        });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_removes_owned_expense()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        var expense = await app.SeedExpenseAsync(owner.Id);

        var response = await owner.Client.DeleteAsync($"/api/expenses/{expense.Id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Null(await app.FindExpenseAsync(expense.Id));
    }

    [Fact]
    public async Task Delete_of_another_users_expense_returns_not_found_and_preserves_it()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("other@example.com");
        var expense = await app.SeedExpenseAsync(other.Id);

        var response = await owner.Client.DeleteAsync($"/api/expenses/{expense.Id}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.NotNull(await app.FindExpenseAsync(expense.Id));
    }

    [Fact]
    public async Task Delete_of_missing_expense_returns_not_found()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("owner@example.com");

        var response = await owner.Client.DeleteAsync("/api/expenses/404");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    private static async Task AssertValidationErrorAsync(
        HttpResponseMessage response,
        string field)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var errors = body.GetProperty("errors");
        Assert.True(
            errors.TryGetProperty(field, out _),
            $"Expected validation errors for '{field}'. Response: {body}");
    }
}
