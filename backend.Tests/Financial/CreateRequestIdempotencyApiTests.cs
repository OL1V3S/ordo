using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using BudgetPlanner.CreateRequests;
using BudgetPlanner.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace BudgetPlanner.Tests.Financial;

internal static class CreateRequestTestHttp
{
    public const string ExpensesUrl = "/api/expenses";
    public const string InflowsUrl = "/api/inflows";

    public static object Expense(
        string description = "Coffee",
        string amount = "12.50",
        string date = "2026-08-12",
        string category = "food") => new { description, amount, date, category };

    public static object Inflow(
        string description = "Pay",
        decimal amount = 2450.25m,
        string date = "2026-09-03") => new { description, amount, date };

    public static Task<HttpResponseMessage> PostAsync(
        HttpClient client,
        string url,
        object body,
        params string[] keyValues)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
        if (keyValues.Length > 0)
        {
            request.Headers.TryAddWithoutValidation(IdempotencyKeyHeader.HeaderName, keyValues);
        }

        return client.SendAsync(request);
    }

    public static async Task<int> IdAsync(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

    public static async Task<string> CodeAsync(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString()!;

    public static async Task<(int Expenses, int Inflows, int Receipts)> CountsAsync(
        FinancialApiTestApplicationBase app)
    {
        using var scope = app.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
        return (
            await context.Expenses.CountAsync(),
            await context.AccountInflows.CountAsync(),
            await context.CreateRequestReceipts.CountAsync());
    }
}

[Collection("Environment variable tests")]
public sealed class CreateRequestIdempotencyApiTests
{
    private static string NewKey() => Guid.NewGuid().ToString();

    [Fact]
    public async Task Expense_first_save_is_201_and_exact_replay_is_200_with_same_record()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("idem-expense@example.com");
        var key = NewKey();

        using var first = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(), key);
        using var replay = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(), key.ToUpperInvariant());

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();
        var replayBody = await replay.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(firstBody.GetProperty("id").GetInt32(), replayBody.GetProperty("id").GetInt32());
        Assert.Equal("Coffee", replayBody.GetProperty("description").GetString());
        Assert.Equal(12.50m, decimal.Parse(
            replayBody.GetProperty("amount").GetString()!, CultureInfo.InvariantCulture));
        Assert.Equal((1, 0, 1), await CreateRequestTestHttp.CountsAsync(app));
    }

    [Fact]
    public async Task Inflow_first_save_is_201_and_exact_replay_is_200_with_same_record()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("idem-inflow@example.com");
        var key = NewKey();

        using var first = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.InflowsUrl, CreateRequestTestHttp.Inflow(), key);
        using var replay = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.InflowsUrl, CreateRequestTestHttp.Inflow(), key);

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();
        var replayBody = await replay.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(firstBody.GetProperty("id").GetInt32(), replayBody.GetProperty("id").GetInt32());
        Assert.Equal(2450.25m, replayBody.GetProperty("amount").GetDecimal());
        Assert.Equal((0, 1, 1), await CreateRequestTestHttp.CountsAsync(app));
    }

    [Fact]
    public async Task Keyed_201_location_matches_the_no_key_location_shape()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("idem-location@example.com");

        foreach (var (url, body) in new[]
                 {
                     (CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense()),
                     (CreateRequestTestHttp.InflowsUrl, CreateRequestTestHttp.Inflow())
                 })
        {
            using var plain = await CreateRequestTestHttp.PostAsync(owner.Client, url, body);
            using var keyed = await CreateRequestTestHttp.PostAsync(owner.Client, url, body, NewKey());

            Assert.Equal(HttpStatusCode.Created, plain.StatusCode);
            Assert.Equal(HttpStatusCode.Created, keyed.StatusCode);
            Assert.Equal(
                Regex.Replace(plain.Headers.Location!.PathAndQuery, @"\d+$", "N"),
                Regex.Replace(keyed.Headers.Location!.PathAndQuery, @"\d+$", "N"));
            Assert.EndsWith((await CreateRequestTestHttp.IdAsync(keyed)).ToString(), keyed.Headers.Location.PathAndQuery);
        }
    }

    [Fact]
    public async Task Requests_without_a_key_still_create_duplicates_and_store_no_receipt()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("idem-nokey@example.com");

        using var a = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense());
        using var b = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense());

        Assert.Equal(HttpStatusCode.Created, a.StatusCode);
        Assert.Equal(HttpStatusCode.Created, b.StatusCode);
        Assert.Equal((2, 0, 0), await CreateRequestTestHttp.CountsAsync(app));
    }

    [Fact]
    public async Task Normalization_equivalent_replay_is_200_and_different_details_are_422_without_saving()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("idem-fingerprint@example.com");
        var expenseKey = NewKey();
        var inflowKey = NewKey();
        await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(), expenseKey);
        await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.InflowsUrl, CreateRequestTestHttp.Inflow(), inflowKey);

        using var equivalentExpense = await CreateRequestTestHttp.PostAsync(
            owner.Client,
            CreateRequestTestHttp.ExpensesUrl,
            CreateRequestTestHttp.Expense(description: "  Coffee  ", amount: "12.5", category: "  FOOD "),
            expenseKey);
        using var equivalentInflow = await CreateRequestTestHttp.PostAsync(
            owner.Client,
            CreateRequestTestHttp.InflowsUrl,
            CreateRequestTestHttp.Inflow(description: "  Pay "),
            inflowKey);
        Assert.Equal(HttpStatusCode.OK, equivalentExpense.StatusCode);
        Assert.Equal(HttpStatusCode.OK, equivalentInflow.StatusCode);

        var mismatches = new (string Url, object Body, string Key)[]
        {
            (CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(amount: "12.51"), expenseKey),
            (CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(date: "2026-08-13"), expenseKey),
            (CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(description: "coffee"), expenseKey),
            (CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(description: "Cof fee"), expenseKey),
            (CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(category: "bills"), expenseKey),
            (CreateRequestTestHttp.InflowsUrl, CreateRequestTestHttp.Inflow(amount: 2450.26m), inflowKey),
            (CreateRequestTestHttp.InflowsUrl, CreateRequestTestHttp.Inflow(date: "2026-09-04"), inflowKey),
            (CreateRequestTestHttp.InflowsUrl, CreateRequestTestHttp.Inflow(description: "pay"), inflowKey),
            // Same key on the other endpoint, even with otherwise matching values.
            (CreateRequestTestHttp.InflowsUrl, CreateRequestTestHttp.Inflow(), expenseKey),
            (CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(), inflowKey)
        };
        foreach (var (url, body, key) in mismatches)
        {
            using var response = await CreateRequestTestHttp.PostAsync(owner.Client, url, body, key);
            Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
            Assert.Equal("idempotency_key_reused", await CreateRequestTestHttp.CodeAsync(response));
        }

        Assert.Equal((1, 1, 2), await CreateRequestTestHttp.CountsAsync(app));
    }

    // An empty header value is covered by the header reader unit test: the in-process test
    // server drops empty header values before the action runs, so it cannot be sent here.
    [Theory]
    [InlineData("not-a-uuid")]
    [InlineData("{4f5f1c0e-7a64-4e8c-9d1b-0a1b2c3d4e5f}")]
    [InlineData("4f5f1c0e7a644e8c9d1b0a1b2c3d4e5f")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    [InlineData(" 4f5f1c0e-7a64-4e8c-9d1b-0a1b2c3d4e5f")]
    public async Task Invalid_key_is_400_and_saves_nothing(string value)
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("idem-invalid@example.com");

        foreach (var (url, body) in new[]
                 {
                     (CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense()),
                     (CreateRequestTestHttp.InflowsUrl, CreateRequestTestHttp.Inflow())
                 })
        {
            using var response = await CreateRequestTestHttp.PostAsync(owner.Client, url, body, value);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("idempotency_key_invalid", await CreateRequestTestHttp.CodeAsync(response));
        }

        Assert.Equal((0, 0, 0), await CreateRequestTestHttp.CountsAsync(app));
    }

    [Fact]
    public async Task Multiple_key_values_are_400_and_save_nothing()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("idem-multiple@example.com");

        using var response = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(), NewKey(), NewKey());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("idempotency_key_invalid", await CreateRequestTestHttp.CodeAsync(response));
        Assert.Equal((0, 0, 0), await CreateRequestTestHttp.CountsAsync(app));
    }

    [Fact]
    public async Task Body_validation_failures_keep_todays_validation_problem_and_store_no_receipt()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("idem-validation@example.com");
        var key = NewKey();

        using var expense = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(amount: "0"), key);
        using var inflow = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.InflowsUrl, CreateRequestTestHttp.Inflow(amount: 0m), key);

        foreach (var response in new[] { expense, inflow })
        {
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.True(body.GetProperty("errors").TryGetProperty("amount", out _));
        }

        Assert.Equal((0, 0, 0), await CreateRequestTestHttp.CountsAsync(app));
    }

    [Fact]
    public async Task Malformed_body_binding_error_wins_over_an_invalid_key()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("idem-binding@example.com");
        using var request = new HttpRequestMessage(HttpMethod.Post, CreateRequestTestHttp.ExpensesUrl)
        {
            Content = new StringContent("{not json", System.Text.Encoding.UTF8, "application/json")
        };
        request.Headers.TryAddWithoutValidation(IdempotencyKeyHeader.HeaderName, "bad");

        using var response = await owner.Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(body.TryGetProperty("code", out _));
    }

    [Fact]
    public async Task Same_key_for_two_users_creates_two_independent_records_without_a_signal()
    {
        await using var app = new FinancialApiTestApplication();
        using var first = await app.CreateAuthenticatedUserAsync("idem-user-a@example.com");
        using var second = await app.CreateAuthenticatedUserAsync("idem-user-b@example.com");
        var key = NewKey();

        using var a = await CreateRequestTestHttp.PostAsync(
            first.Client, CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(), key);
        using var b = await CreateRequestTestHttp.PostAsync(
            second.Client, CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(amount: "99.00"), key);

        Assert.Equal(HttpStatusCode.Created, a.StatusCode);
        Assert.Equal(HttpStatusCode.Created, b.StatusCode);
        Assert.NotEqual(await CreateRequestTestHttp.IdAsync(a), await CreateRequestTestHttp.IdAsync(b));
        Assert.Equal((2, 0, 2), await CreateRequestTestHttp.CountsAsync(app));
    }

    [Fact]
    public async Task Replay_after_edit_returns_the_same_record_with_current_values()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("idem-edit@example.com");
        var expenseKey = NewKey();
        var inflowKey = NewKey();
        using var expense = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(), expenseKey);
        using var inflow = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.InflowsUrl, CreateRequestTestHttp.Inflow(), inflowKey);
        var expenseId = await CreateRequestTestHttp.IdAsync(expense);
        var inflowId = await CreateRequestTestHttp.IdAsync(inflow);

        using var editExpense = await owner.Client.PutAsJsonAsync($"/api/expenses/{expenseId}", new
        {
            id = expenseId, description = "Edited", amount = "20.00", date = "2026-08-20", category = "bills"
        });
        using var editInflow = await owner.Client.PutAsJsonAsync($"/api/inflows/{inflowId}", new
        {
            id = inflowId, description = "Edited pay", amount = 10m, date = "2026-09-09"
        });
        Assert.Equal(HttpStatusCode.NoContent, editExpense.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, editInflow.StatusCode);

        using var expenseReplay = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(), expenseKey);
        using var inflowReplay = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.InflowsUrl, CreateRequestTestHttp.Inflow(), inflowKey);

        Assert.Equal(HttpStatusCode.OK, expenseReplay.StatusCode);
        Assert.Equal(HttpStatusCode.OK, inflowReplay.StatusCode);
        var expenseBody = await expenseReplay.Content.ReadFromJsonAsync<JsonElement>();
        var inflowBody = await inflowReplay.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(expenseId, expenseBody.GetProperty("id").GetInt32());
        Assert.Equal("Edited", expenseBody.GetProperty("description").GetString());
        Assert.Equal(inflowId, inflowBody.GetProperty("id").GetInt32());
        Assert.Equal("Edited pay", inflowBody.GetProperty("description").GetString());
        Assert.Equal((1, 1, 2), await CreateRequestTestHttp.CountsAsync(app));
    }

    [Fact]
    public async Task Replay_after_delete_is_409_and_creates_nothing()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("idem-delete@example.com");
        var expenseKey = NewKey();
        var inflowKey = NewKey();
        using var expense = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.ExpensesUrl, CreateRequestTestHttp.Expense(), expenseKey);
        using var inflow = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.InflowsUrl, CreateRequestTestHttp.Inflow(), inflowKey);
        using var deleteExpense = await owner.Client.DeleteAsync(
            $"/api/expenses/{await CreateRequestTestHttp.IdAsync(expense)}");
        using var deleteInflow = await owner.Client.DeleteAsync(
            $"/api/inflows/{await CreateRequestTestHttp.IdAsync(inflow)}");
        Assert.Equal(HttpStatusCode.NoContent, deleteExpense.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, deleteInflow.StatusCode);

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

    [Fact]
    public async Task Error_bodies_contain_no_key_financial_input_or_record_identity()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("idem-privacy@example.com");
        var key = NewKey();
        using var created = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.ExpensesUrl,
            CreateRequestTestHttp.Expense(description: "SecretMerchant", amount: "777.77"), key);
        var id = await CreateRequestTestHttp.IdAsync(created);

        using var reused = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.ExpensesUrl,
            CreateRequestTestHttp.Expense(description: "OtherMerchant", amount: "888.88"), key);
        using var invalid = await CreateRequestTestHttp.PostAsync(
            owner.Client, CreateRequestTestHttp.ExpensesUrl,
            CreateRequestTestHttp.Expense(description: "OtherMerchant", amount: "888.88"), "bad-key");

        foreach (var response in new[] { reused, invalid })
        {
            var text = await response.Content.ReadAsStringAsync();
            Assert.DoesNotContain(key, text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("bad-key", text);
            Assert.DoesNotContain("SecretMerchant", text);
            Assert.DoesNotContain("OtherMerchant", text);
            Assert.DoesNotContain("777", text);
            Assert.DoesNotContain("888", text);
            Assert.DoesNotContain("\"id\"", text);
            Assert.DoesNotContain($"/{id}", text);
        }
    }
}

public sealed class CreateRequestFingerprintAndKeyTests
{
    [Fact]
    public void Fingerprint_serialization_and_hash_are_pinned()
    {
        Assert.Equal(
            "[\"v1\",\"Expense\",\"Coffee\",\"12.50\",\"2026-08-12\",\"food\"]",
            CreateRequestFingerprint.Serialize("Expense", "Coffee", 12.5m, new DateOnly(2026, 8, 12), "food"));
        Assert.Equal(
            "d0104417b0a8e216f2faffaa9eb653ee75837b2768550bcf467ea3c5b5b078a2",
            Convert.ToHexStringLower(
                CreateRequestFingerprint.ForExpense("Coffee", 12.50m, new DateOnly(2026, 8, 12), "food")));
        Assert.Equal(
            "f85e4ace7b09508e69af9d9cfa26a6b354809e5d46f8d96cb022feaeb327cd11",
            Convert.ToHexStringLower(
                CreateRequestFingerprint.ForAccountInflow("Pay", 2450.25m, new DateOnly(2026, 9, 3))));
        Assert.Equal(
            "[\"v1\",\"Expense\",\"Caf\\u00E9 \\u0022x\\u0022\",\"0.05\",\"2026-01-02\",\"a b\"]",
            CreateRequestFingerprint.Serialize("Expense", "Café \"x\"", 0.05m, new DateOnly(2026, 1, 2), "a b"));
        Assert.Equal(
            "f6efe2467c66d551422b08d595770931ee7bdb847b6f9b496441aec35bdd6b5e",
            Convert.ToHexStringLower(
                CreateRequestFingerprint.ForExpense("Café \"x\"", 0.05m, new DateOnly(2026, 1, 2), "a b")));
    }

    [Fact]
    public void Fingerprint_is_culture_invariant_and_distinguishes_kind_and_values()
    {
        var original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("ar-SA");
            var arabic = CreateRequestFingerprint.ForExpense("a", 1.5m, new DateOnly(2026, 1, 2), "c");
            CultureInfo.CurrentCulture = new CultureInfo("de-DE");
            var german = CreateRequestFingerprint.ForExpense("a", 1.5m, new DateOnly(2026, 1, 2), "c");
            Assert.Equal(arabic, german);
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }

        var baseline = CreateRequestFingerprint.ForExpense("a", 1m, new DateOnly(2026, 1, 2), "");
        Assert.NotEqual(baseline, CreateRequestFingerprint.ForAccountInflow("a", 1m, new DateOnly(2026, 1, 2)));
        Assert.NotEqual(baseline, CreateRequestFingerprint.ForExpense("a ", 1m, new DateOnly(2026, 1, 2), ""));
        Assert.Equal(baseline, CreateRequestFingerprint.ForExpense("a", 1.00m, new DateOnly(2026, 1, 2), ""));
    }

    [Theory]
    [InlineData("4f5f1c0e-7a64-4e8c-9d1b-0a1b2c3d4e5f", true)]
    [InlineData("4F5F1C0E-7A64-4E8C-9D1B-0A1B2C3D4E5F", true)]
    [InlineData("00000000-0000-0000-0000-000000000000", false)]
    [InlineData("4f5f1c0e7a644e8c9d1b0a1b2c3d4e5f", false)]
    [InlineData("{4f5f1c0e-7a64-4e8c-9d1b-0a1b2c3d4e5f}", false)]
    [InlineData("(4f5f1c0e-7a64-4e8c-9d1b-0a1b2c3d4e5f)", false)]
    [InlineData("4f5f1c0e-7a64-4e8c-9d1b-0a1b2c3d4e5f ", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Key_parsing_accepts_only_canonical_non_zero_uuids(string? value, bool valid)
    {
        Assert.Equal(valid, IdempotencyKeyHeader.TryParse(value, out var key));
        Assert.Equal(valid, key != Guid.Empty);
    }

    [Fact]
    public void Header_reader_distinguishes_absent_valid_empty_and_multiple_values()
    {
        var headers = new HeaderDictionary();
        Assert.Equal(IdempotencyKeyStatus.Absent, IdempotencyKeyHeader.Read(headers).Status);

        headers[IdempotencyKeyHeader.HeaderName] = "4f5f1c0e-7a64-4e8c-9d1b-0a1b2c3d4e5f";
        Assert.Equal(IdempotencyKeyStatus.Valid, IdempotencyKeyHeader.Read(headers).Status);

        headers[IdempotencyKeyHeader.HeaderName] = "";
        Assert.Equal(IdempotencyKeyStatus.Invalid, IdempotencyKeyHeader.Read(headers).Status);

        headers[IdempotencyKeyHeader.HeaderName] = new[]
        {
            "4f5f1c0e-7a64-4e8c-9d1b-0a1b2c3d4e5f",
            "5f5f1c0e-7a64-4e8c-9d1b-0a1b2c3d4e5f"
        };
        Assert.Equal(IdempotencyKeyStatus.Invalid, IdempotencyKeyHeader.Read(headers).Status);
    }
}
