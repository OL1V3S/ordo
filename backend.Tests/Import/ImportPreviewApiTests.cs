using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using BudgetPlanner.Data;
using BudgetPlanner.Tests.Financial;
using BudgetPlanner.Tests.Import.Fixtures.Sunflower;
using BudgetPlanner.Import;
using BudgetPlanner.Import.Sunflower;
using BudgetPlanner.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace BudgetPlanner.Tests.Import;

[Collection("Environment variable tests")]
public sealed class ImportPreviewApiTests
{
    [Fact]
    public async Task Endpoints_require_authentication()
    {
        await using var app = new SyntheticExtractionFinancialApiTestApplication();
        using var client = app.CreateTestClient();
        using var content = PdfUpload(SunflowerFixtureCorpus.CreateRepresentativePdf());

        var create = await client.PostAsync("/api/import-previews", content);
        var read = await client.GetAsync("/api/import-previews/open?sourceType=sunflower_pdf");
        var confirm = await client.PostAsync($"/api/import-previews/{Guid.NewGuid()}/confirm", null);

        Assert.Equal(HttpStatusCode.Unauthorized, create.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, read.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, confirm.StatusCode);
    }

    [Fact]
    public async Task Upload_requires_a_closed_supported_source_before_extraction()
    {
        await using var app = new SyntheticExtractionFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-source@example.com");
        using var missing = PdfUpload(SunflowerFixtureCorpus.CreateRepresentativePdf(), sourceType: null);
        using var unknown = PdfUpload(SunflowerFixtureCorpus.CreateRepresentativePdf(), "prairie_pdf");

        var missingResponse = await owner.Client.PostAsync("/api/import-previews", missing);
        var unknownResponse = await owner.Client.PostAsync("/api/import-previews", unknown);
        var missingOpenResponse = await owner.Client.GetAsync("/api/import-previews/open");
        var unknownOpenResponse = await owner.Client.GetAsync("/api/import-previews/open?sourceType=prairie_pdf");

        Assert.Equal(HttpStatusCode.BadRequest, missingResponse.StatusCode);
        Assert.Equal("source_required", (await missingResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, unknownResponse.StatusCode);
        Assert.Equal("unsupported_statement_source", (await unknownResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, missingOpenResponse.StatusCode);
        Assert.Equal("source_required", (await missingOpenResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, unknownOpenResponse.StatusCode);
        Assert.Equal("unsupported_statement_source", (await unknownOpenResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        Assert.Equal(0, await app.CountImportPreviewBatchesAsync(owner.Id));
        Assert.Equal(0, await app.CountExpensesAsync());
    }

    [Fact]
    public async Task Valid_synthetic_pdf_creates_owner_scoped_preview_without_expense_writes()
    {
        await using var app = new SyntheticExtractionFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("preview-other@example.com");
        await app.SeedExpenseAsync(owner.Id, "NORTH STAR MARKET", 42.16m, new DateOnly(2026, 2, 5));
        await app.SeedExpenseAsync(other.Id, "STREAMCO SUBSCRIPTION", 7.99m, new DateOnly(2026, 2, 4));
        using var content = PdfUpload(SunflowerFixtureCorpus.CreateRepresentativePdf());

        var response = await owner.Client.PostAsync("/api/import-previews", content);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("sunflower_pdf", body.GetProperty("sourceType").GetString());
        Assert.Equal(13, body.GetProperty("rows").GetArrayLength());
        var rows = body.GetProperty("rows").EnumerateArray().ToList();
        var duplicate = rows.Single(row => row.GetProperty("sourceDescription").GetString() == "NORTH STAR MARKET");
        Assert.True(duplicate.GetProperty("isPossibleDuplicate").GetBoolean());
        Assert.False(duplicate.GetProperty("selectedForImport").GetBoolean());
        Assert.Single(duplicate.GetProperty("duplicateExpenseIds").EnumerateArray());
        var crossUserMatch = rows.Single(row => row.GetProperty("sourceDescription").GetString() == "STREAMCO SUBSCRIPTION");
        Assert.False(crossUserMatch.GetProperty("isPossibleDuplicate").GetBoolean());
        Assert.True(crossUserMatch.GetProperty("selectedForImport").GetBoolean());
        Assert.Equal(2, await app.CountExpensesAsync());

        var batchId = body.GetProperty("batchId").GetGuid();
        var forbidden = await other.Client.GetAsync($"/api/import-previews/{batchId}");
        Assert.Equal(HttpStatusCode.NotFound, forbidden.StatusCode);
    }

    [Fact]
    public async Task Same_pdf_reuses_open_preview_and_resume_returns_it()
    {
        await using var app = new SyntheticExtractionFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-reuse@example.com");
        var pdf = SunflowerFixtureCorpus.CreateRepresentativePdf();
        using var firstContent = PdfUpload(pdf);
        using var secondContent = PdfUpload(pdf);

        var first = await owner.Client.PostAsync("/api/import-previews", firstContent);
        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();
        var second = await owner.Client.PostAsync("/api/import-previews", secondContent);
        var secondBody = await second.Content.ReadFromJsonAsync<JsonElement>();
        var resumed = await owner.Client.GetFromJsonAsync<JsonElement>("/api/import-previews/open?sourceType=sunflower_pdf");

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.Equal("sunflower-v3", firstBody.GetProperty("parserRuleVersion").GetString());
        Assert.Equal("sunflower-v3", secondBody.GetProperty("parserRuleVersion").GetString());
        Assert.Equal(firstBody.GetProperty("batchId").GetGuid(), secondBody.GetProperty("batchId").GetGuid());
        Assert.Equal(firstBody.GetProperty("batchId").GetGuid(), resumed.GetProperty("batchId").GetGuid());
        Assert.Equal(1, await app.CountImportPreviewBatchesAsync(owner.Id));
        Assert.Equal(1, ((ImmediateSyntheticExtractor)app.Services
            .GetRequiredService<IPdfTextExtractor>()).CallCount);
    }

    [Fact]
    public async Task Incompatible_preview_is_hidden_then_atomically_superseded_after_successful_reparse()
    {
        await using var app = new SyntheticExtractionFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-version-owner@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("preview-version-other@example.com");
        var pdf = SunflowerFixtureCorpus.CreateRepresentativePdf();
        var stale = await app.SeedImportPreviewBatchAsync(owner.Id, pdf, "sunflower-v1");
        var otherStale = await app.SeedImportPreviewBatchAsync(other.Id, pdf, "sunflower-v1");

        var staleRead = await owner.Client.GetAsync($"/api/import-previews/{stale.Id}");
        var staleResume = await owner.Client.GetAsync("/api/import-previews/open?sourceType=sunflower_pdf");
        var staleUpdate = await owner.Client.PatchAsJsonAsync(
            $"/api/import-previews/{stale.Id}/rows/{stale.Rows.Single().Id}",
            new { editableExpenseDescription = "changed", category = "food", selectedForImport = false });
        var crossUserRead = await other.Client.GetAsync($"/api/import-previews/{stale.Id}");
        using var content = PdfUpload(pdf);

        var response = await owner.Client.PostAsync("/api/import-previews", content);
        var replacement = await response.Content.ReadFromJsonAsync<JsonElement>();
        var resumed = await owner.Client.GetFromJsonAsync<JsonElement>(
            "/api/import-previews/open?sourceType=sunflower_pdf");

        Assert.Equal(HttpStatusCode.NotFound, staleRead.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, staleResume.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, staleUpdate.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, crossUserRead.StatusCode);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotEqual(stale.Id, replacement.GetProperty("batchId").GetGuid());
        Assert.Equal("sunflower-v3", replacement.GetProperty("parserRuleVersion").GetString());
        Assert.Equal(13, replacement.GetProperty("rows").GetArrayLength());
        Assert.DoesNotContain(
            replacement.GetProperty("rows").EnumerateArray(),
            row => row.GetProperty("sourceDescription").GetString() == "STALE SYNTHETIC ROW");
        Assert.Equal(replacement.GetProperty("batchId").GetGuid(), resumed.GetProperty("batchId").GetGuid());

        var ownerBatches = await app.FindImportPreviewBatchesAsync(owner.Id);
        Assert.Collection(
            ownerBatches,
            predecessor =>
            {
                Assert.Equal(stale.Id, predecessor.Id);
                Assert.Equal(ImportPreviewLifecycle.Expired, predecessor.Lifecycle);
                Assert.Equal("sunflower-v1", predecessor.ParserRuleVersion);
            },
            current =>
            {
                Assert.Equal(ImportPreviewLifecycle.Open, current.Lifecycle);
                Assert.Equal("sunflower-v3", current.ParserRuleVersion);
            });
        var preservedOther = Assert.Single(await app.FindImportPreviewBatchesAsync(other.Id));
        Assert.Equal(otherStale.Id, preservedOther.Id);
        Assert.Equal(ImportPreviewLifecycle.Open, preservedOther.Lifecycle);
        Assert.Equal(0, await app.CountExpensesAsync());
    }

    [Fact]
    public async Task Failed_reparse_does_not_supersede_incompatible_preview_or_write_expenses()
    {
        await using var app = new RejectingParserFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-version-failure@example.com");
        var pdf = SunflowerFixtureCorpus.CreateRepresentativePdf();
        var stale = await app.SeedImportPreviewBatchAsync(owner.Id, pdf, "sunflower-v1");
        using var content = PdfUpload(pdf);

        var response = await owner.Client.PostAsync("/api/import-previews", content);
        var error = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        Assert.Equal("unsupported_statement_format", error.GetProperty("code").GetString());
        var preserved = Assert.Single(await app.FindImportPreviewBatchesAsync(owner.Id));
        Assert.Equal(stale.Id, preserved.Id);
        Assert.Equal(ImportPreviewLifecycle.Open, preserved.Lifecycle);
        Assert.Equal("sunflower-v1", preserved.ParserRuleVersion);
        Assert.Equal(0, await app.CountExpensesAsync());
    }

    [Fact]
    public async Task Timed_out_reparse_does_not_supersede_incompatible_preview_or_write_expenses()
    {
        await using var app = new BlockingParserFinancialApiTestApplication(TimeSpan.FromMilliseconds(50));
        using var owner = await app.CreateAuthenticatedUserAsync("preview-version-timeout@example.com");
        var pdf = SunflowerFixtureCorpus.CreateRepresentativePdf();
        var stale = await app.SeedImportPreviewBatchAsync(owner.Id, pdf, "sunflower-v1");
        using var content = PdfUpload(pdf);

        var response = await owner.Client.PostAsync("/api/import-previews", content);
        var error = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.RequestTimeout, response.StatusCode);
        Assert.Equal("processing_timed_out", error.GetProperty("code").GetString());
        var preserved = Assert.Single(await app.FindImportPreviewBatchesAsync(owner.Id));
        Assert.Equal(stale.Id, preserved.Id);
        Assert.Equal(ImportPreviewLifecycle.Open, preserved.Lifecycle);
        Assert.Equal("sunflower-v1", preserved.ParserRuleVersion);
        Assert.Equal(0, await app.CountExpensesAsync());
    }

    [Fact]
    public async Task Row_edits_are_normalized_and_ineligible_rows_cannot_be_selected()
    {
        await using var app = new SyntheticExtractionFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-edit@example.com");
        using var content = PdfUpload(SunflowerFixtureCorpus.CreateRepresentativePdf());
        var create = await owner.Client.PostAsync("/api/import-previews", content);
        var preview = await create.Content.ReadFromJsonAsync<JsonElement>();
        var batchId = preview.GetProperty("batchId").GetGuid();
        var rows = preview.GetProperty("rows").EnumerateArray().ToList();
        var eligible = rows.First(row => row.GetProperty("isEligible").GetBoolean());
        var excluded = rows.First(row => !row.GetProperty("isEligible").GetBoolean());

        var update = await owner.Client.PatchAsJsonAsync(
            $"/api/import-previews/{batchId}/rows/{eligible.GetProperty("rowId").GetGuid()}",
            new { editableExpenseDescription = "  Updated description  ", category = " HOME   Supplies ", selectedForImport = false });
        var updated = await update.Content.ReadFromJsonAsync<JsonElement>();
        var rejected = await owner.Client.PatchAsJsonAsync(
            $"/api/import-previews/{batchId}/rows/{excluded.GetProperty("rowId").GetGuid()}",
            new { editableExpenseDescription = "changed", category = "food", selectedForImport = true });

        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        Assert.Equal("Updated description", updated.GetProperty("editableExpenseDescription").GetString());
        Assert.Equal("home supplies", updated.GetProperty("category").GetString());
        Assert.False(updated.GetProperty("selectedForImport").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
    }

    [Fact]
    public async Task Confirmation_uses_only_server_owned_selected_fields_and_is_retry_safe()
    {
        await using var app = new SyntheticExtractionFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-confirm@example.com");
        var pdf = SunflowerFixtureCorpus.CreateRepresentativePdf();
        var preview = await UploadPreviewAsync(owner, pdf);
        var batchId = preview.GetProperty("batchId").GetGuid();
        var rows = preview.GetProperty("rows").EnumerateArray().ToList();
        var selected = rows.Single(row => row.GetProperty("sourceDescription").GetString() == "STREAMCO SUBSCRIPTION");
        var selectedRowId = selected.GetProperty("rowId").GetGuid();
        await SelectOnlyAsync(owner, batchId, rows, selectedRowId);
        var edit = await owner.Client.PatchAsJsonAsync(
            $"/api/import-previews/{batchId}/rows/{selectedRowId}",
            new
            {
                editableExpenseDescription = "  Server-edited description  ",
                category = " HOME   Supplies ",
                selectedForImport = true
            });
        var edited = await edit.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, edit.StatusCode);
        Assert.Equal("Server-edited description", edited.GetProperty("editableExpenseDescription").GetString());
        Assert.Equal("home supplies", edited.GetProperty("category").GetString());

        var first = await owner.Client.PostAsync($"/api/import-previews/{batchId}/confirm", null);
        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();
        var confirmedAt = firstBody.GetProperty("confirmedAt").GetDateTime();

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(batchId, firstBody.GetProperty("batchId").GetGuid());
        Assert.Equal("confirmed", firstBody.GetProperty("status").GetString());
        Assert.Equal(1, firstBody.GetProperty("importedExpenseCount").GetInt32());
        var expenses = await owner.Client.GetFromJsonAsync<JsonElement>("/api/expenses");
        var expense = Assert.Single(expenses.EnumerateArray());
        Assert.Equal("Server-edited description", expense.GetProperty("description").GetString());
        Assert.Equal("home supplies", expense.GetProperty("category").GetString());
        Assert.Equal(7.99m, expense.GetProperty("amount").GetDecimal());
        Assert.Equal("2026-02-04", expense.GetProperty("date").GetString());

        var retry = await owner.Client.PostAsync($"/api/import-previews/{batchId}/confirm", null);
        var retryBody = await retry.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
        Assert.Equal(batchId, retryBody.GetProperty("batchId").GetGuid());
        Assert.Equal("already_confirmed", retryBody.GetProperty("status").GetString());
        Assert.Equal(confirmedAt, retryBody.GetProperty("confirmedAt").GetDateTime());
        Assert.Equal(1, retryBody.GetProperty("importedExpenseCount").GetInt32());
        Assert.Equal(1, await app.CountExpensesAsync());

        using (var scope = app.Services.CreateScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            var batch = await context.ImportPreviewBatches.AsNoTracking()
                .Include(value => value.Rows)
                .Include(value => value.Provenance)
                .SingleAsync(value => value.Id == batchId);
            Assert.Equal(ImportPreviewLifecycle.Confirmed, batch.Lifecycle);
            Assert.Equal(confirmedAt, batch.ConfirmedAt);
            Assert.Empty(batch.Rows);
            var provenance = Assert.Single(batch.Provenance);
            Assert.Equal(selected.GetProperty("sourceRowOrdinal").GetInt32(), provenance.SourceRowOrdinal);
            Assert.Equal(expense.GetProperty("id").GetInt32(), provenance.ExpenseId);
        }

        using (var scope = app.Services.CreateScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            var provenance = await context.ImportExpenseProvenances
                .Include(value => value.Expense)
                .SingleAsync(value => value.BatchId == batchId);
            context.Expenses.Remove(Assert.IsType<Expense>(provenance.Expense));
            await context.SaveChangesAsync();
            Assert.Null(provenance.ExpenseId);
        }

        using var reuploadContent = PdfUpload(pdf);
        var reupload = await owner.Client.PostAsync("/api/import-previews", reuploadContent);
        var reuploadBody = await reupload.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Conflict, reupload.StatusCode);
        Assert.Equal("already_imported", reuploadBody.GetProperty("code").GetString());
        Assert.Equal(0, await app.CountExpensesAsync());
        Assert.Equal(1, await app.CountImportPreviewBatchesAsync(owner.Id));
        Assert.Equal(1, ((ImmediateSyntheticExtractor)app.Services
            .GetRequiredService<IPdfTextExtractor>()).CallCount);
        using (var scope = app.Services.CreateScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            var provenance = await context.ImportExpenseProvenances.AsNoTracking()
                .SingleAsync(value => value.BatchId == batchId);
            Assert.Null(provenance.ExpenseId);
        }
    }

    [Fact]
    public async Task Confirmation_with_no_selected_rows_is_rejected_and_remains_open()
    {
        await using var app = new SyntheticExtractionFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-confirm-empty@example.com");
        var preview = await UploadPreviewAsync(owner, SunflowerFixtureCorpus.CreateRepresentativePdf());
        var batchId = preview.GetProperty("batchId").GetGuid();
        var rows = preview.GetProperty("rows").EnumerateArray().ToList();
        await SelectOnlyAsync(owner, batchId, rows, selectedRowId: null);

        var response = await owner.Client.PostAsync($"/api/import-previews/{batchId}/confirm", null);
        var error = await response.Content.ReadFromJsonAsync<JsonElement>();
        var stillOpen = await owner.Client.GetAsync($"/api/import-previews/{batchId}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("no_rows_selected", error.GetProperty("code").GetString());
        Assert.Empty(error.GetProperty("rows").EnumerateArray());
        Assert.Equal(HttpStatusCode.OK, stillOpen.StatusCode);
        Assert.Equal(0, await app.CountExpensesAsync());
    }

    [Fact]
    public async Task Confirmation_uses_bare_not_found_for_missing_foreign_and_stale_batches()
    {
        await using var app = new SyntheticExtractionFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-confirm-not-found@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("preview-confirm-foreign@example.com");
        var foreignPreview = await UploadPreviewAsync(other, SunflowerFixtureCorpus.CreateRepresentativePdf());
        var foreignBatchId = foreignPreview.GetProperty("batchId").GetGuid();
        var stale = await app.SeedImportPreviewBatchAsync(
            owner.Id,
            SunflowerFixtureCorpus.CreateRepresentativePdf(),
            "sunflower-v1");
        var expiredStale = await app.SeedImportPreviewBatchAsync(
            owner.Id,
            SunflowerFixtureCorpus.CreateRepresentativePdf().Concat(new byte[] { 0 }).ToArray(),
            "sunflower-v1");
        using (var scope = app.Services.CreateScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            var batch = await context.ImportPreviewBatches.SingleAsync(value => value.Id == expiredStale.Id);
            batch.Lifecycle = ImportPreviewLifecycle.Expired;
            await context.SaveChangesAsync();
        }

        var missing = await owner.Client.PostAsync($"/api/import-previews/{Guid.NewGuid()}/confirm", null);
        var foreign = await owner.Client.PostAsync($"/api/import-previews/{foreignBatchId}/confirm", null);
        var incompatible = await owner.Client.PostAsync($"/api/import-previews/{stale.Id}/confirm", null);
        var expiredIncompatible = await owner.Client.PostAsync(
            $"/api/import-previews/{expiredStale.Id}/confirm",
            null);

        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, incompatible.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, expiredIncompatible.StatusCode);
        Assert.Equal("", await missing.Content.ReadAsStringAsync());
        Assert.Equal("", await foreign.Content.ReadAsStringAsync());
        Assert.Equal("", await incompatible.Content.ReadAsStringAsync());
        Assert.Equal("", await expiredIncompatible.Content.ReadAsStringAsync());
        Assert.Equal(0, await app.CountExpensesAsync());
    }

    [Fact]
    public async Task Confirmation_at_the_exact_expiry_boundary_returns_gone_without_writes()
    {
        var clock = new MutableTimeProvider(new DateTimeOffset(2026, 8, 20, 12, 0, 0, TimeSpan.Zero));
        await using var app = new ClockedFinancialApiTestApplication(clock);
        using var owner = await app.CreateAuthenticatedUserAsync("preview-confirm-expired@example.com");
        var preview = await UploadPreviewAsync(owner, SunflowerFixtureCorpus.CreateRepresentativePdf());
        var batchId = preview.GetProperty("batchId").GetGuid();
        clock.Advance(TimeSpan.FromHours(24));

        var response = await owner.Client.PostAsync($"/api/import-previews/{batchId}/confirm", null);
        var error = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Gone, response.StatusCode);
        Assert.Equal("preview_expired", error.GetProperty("code").GetString());
        Assert.Empty(error.GetProperty("rows").EnumerateArray());
        Assert.Equal(0, await app.CountExpensesAsync());
    }

    [Fact]
    public async Task Cancelled_confirmation_returns_a_safe_failure_and_preserves_the_open_preview()
    {
        await using var app = new SyntheticExtractionFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-confirm-cancelled@example.com");
        var preview = await UploadPreviewAsync(owner, SunflowerFixtureCorpus.CreateRepresentativePdf());
        var batchId = preview.GetProperty("batchId").GetGuid();
        using var scope = app.Services.CreateScope();
        var service = scope.ServiceProvider.GetRequiredService<IImportPreviewService>();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        var result = await service.ConfirmAsync(owner.Id, batchId, cancellation.Token);

        Assert.False(result.IsSuccess);
        Assert.Equal("confirmation_failed", result.Error!.Code);
        Assert.Empty(result.Error.Rows);
        Assert.Equal(0, await app.CountExpensesAsync());
        var batch = Assert.Single(await app.FindImportPreviewBatchesAsync(owner.Id));
        Assert.Equal(ImportPreviewLifecycle.Open, batch.Lifecycle);
        Assert.NotEmpty(batch.Rows);
    }

    [Fact]
    public async Task Invalid_selected_row_rejects_the_whole_confirmation_with_safe_row_errors()
    {
        await using var app = new SyntheticExtractionFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-confirm-invalid@example.com");
        var preview = await UploadPreviewAsync(owner, SunflowerFixtureCorpus.CreateRepresentativePdf());
        var batchId = preview.GetProperty("batchId").GetGuid();
        var rows = preview.GetProperty("rows").EnumerateArray().ToList();
        var selected = rows.Single(row => row.GetProperty("sourceDescription").GetString() == "STREAMCO SUBSCRIPTION");
        var selectedRowId = selected.GetProperty("rowId").GetGuid();
        await SelectOnlyAsync(owner, batchId, rows, selectedRowId);
        using (var scope = app.Services.CreateScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            var persisted = await context.ImportPreviewRows.SingleAsync(value => value.Id == selectedRowId);
            persisted.EditableExpenseDescription = "   ";
            await context.SaveChangesAsync();
        }

        var response = await owner.Client.PostAsync($"/api/import-previews/{batchId}/confirm", null);
        var responseText = await response.Content.ReadAsStringAsync();
        using var errorDocument = JsonDocument.Parse(responseText);
        var error = errorDocument.RootElement;

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        Assert.Equal("confirmation_validation_failed", error.GetProperty("code").GetString());
        AssertSafeRowError(error, selectedRowId, "description_required");
        Assert.DoesNotContain("STREAMCO SUBSCRIPTION", responseText);
        Assert.Equal(0, await app.CountExpensesAsync());
        using var verificationScope = app.Services.CreateScope();
        var verificationContext = verificationScope.ServiceProvider.GetRequiredService<BudgetContext>();
        var batch = await verificationContext.ImportPreviewBatches.AsNoTracking()
            .Include(value => value.Rows)
            .Include(value => value.Provenance)
            .SingleAsync(value => value.Id == batchId);
        Assert.Equal(ImportPreviewLifecycle.Open, batch.Lifecycle);
        Assert.Equal(rows.Count, batch.Rows.Count);
        Assert.Empty(batch.Provenance);
    }

    [Fact]
    public async Task Already_warned_row_imports_after_explicit_selection()
    {
        await using var app = new SyntheticExtractionFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-confirm-warned@example.com");
        await app.SeedExpenseAsync(owner.Id, "NORTH STAR MARKET", 42.16m, new DateOnly(2026, 2, 5));
        var preview = await UploadPreviewAsync(owner, SunflowerFixtureCorpus.CreateRepresentativePdf());
        var batchId = preview.GetProperty("batchId").GetGuid();
        var rows = preview.GetProperty("rows").EnumerateArray().ToList();
        var duplicate = rows.Single(row => row.GetProperty("sourceDescription").GetString() == "NORTH STAR MARKET");
        var duplicateRowId = duplicate.GetProperty("rowId").GetGuid();

        Assert.True(duplicate.GetProperty("isPossibleDuplicate").GetBoolean());
        Assert.False(duplicate.GetProperty("selectedForImport").GetBoolean());
        Assert.Contains("possible_duplicate", duplicate.GetProperty("warnings").EnumerateArray()
            .Select(value => value.GetString()));
        await SelectOnlyAsync(owner, batchId, rows, duplicateRowId);

        var response = await owner.Client.PostAsync($"/api/import-previews/{batchId}/confirm", null);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("confirmed", body.GetProperty("status").GetString());
        Assert.Equal(1, body.GetProperty("importedExpenseCount").GetInt32());
        Assert.Equal(2, await app.CountExpensesAsync());
    }

    [Fact]
    public async Task Cross_user_expense_matches_do_not_trigger_confirmation_duplicate_review()
    {
        await using var app = new SyntheticExtractionFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-confirm-owner-scope@example.com");
        using var other = await app.CreateAuthenticatedUserAsync("preview-confirm-other-scope@example.com");
        var preview = await UploadPreviewAsync(owner, SunflowerFixtureCorpus.CreateRepresentativePdf());
        var batchId = preview.GetProperty("batchId").GetGuid();
        var rows = preview.GetProperty("rows").EnumerateArray().ToList();
        var selected = rows.Single(row =>
            row.GetProperty("sourceDescription").GetString() == "STREAMCO SUBSCRIPTION");
        var selectedRowId = selected.GetProperty("rowId").GetGuid();
        await SelectOnlyAsync(owner, batchId, rows, selectedRowId);
        await app.SeedExpenseAsync(
            other.Id,
            "streamco subscription",
            7.99m,
            new DateOnly(2026, 2, 4));

        var response = await owner.Client.PostAsync($"/api/import-previews/{batchId}/confirm", null);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("confirmed", body.GetProperty("status").GetString());
        Assert.Equal(1, body.GetProperty("importedExpenseCount").GetInt32());
        var ownerExpenses = await owner.Client.GetFromJsonAsync<JsonElement>("/api/expenses");
        Assert.Single(ownerExpenses.EnumerateArray());
        Assert.Equal(2, await app.CountExpensesAsync());
    }

    [Fact]
    public async Task Newly_discovered_duplicate_requires_review_before_explicit_reselection_imports()
    {
        await using var app = new SyntheticExtractionFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-confirm-new-duplicate@example.com");
        var preview = await UploadPreviewAsync(owner, SunflowerFixtureCorpus.CreateRepresentativePdf());
        var batchId = preview.GetProperty("batchId").GetGuid();
        var rows = preview.GetProperty("rows").EnumerateArray().ToList();
        var candidate = rows.Single(row => row.GetProperty("sourceDescription").GetString() == "NORTH STAR MARKET");
        var candidateRowId = candidate.GetProperty("rowId").GetGuid();
        await SelectOnlyAsync(owner, batchId, rows, candidateRowId);
        var matchingExpense = await app.SeedExpenseAsync(
            owner.Id,
            "  north   star market ",
            42.16m,
            new DateOnly(2026, 2, 5));

        var first = await owner.Client.PostAsync($"/api/import-previews/{batchId}/confirm", null);
        var firstText = await first.Content.ReadAsStringAsync();
        using var firstDocument = JsonDocument.Parse(firstText);
        var firstBody = firstDocument.RootElement;

        Assert.Equal(HttpStatusCode.Conflict, first.StatusCode);
        Assert.Equal("duplicate_review_required", firstBody.GetProperty("code").GetString());
        AssertSafeRowError(firstBody, candidateRowId, "possible_duplicate");
        Assert.DoesNotContain("NORTH STAR MARKET", firstText);
        Assert.Equal(1, await app.CountExpensesAsync());
        using (var scope = app.Services.CreateScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            Assert.Empty(await context.ImportExpenseProvenances.Where(value => value.BatchId == batchId).ToListAsync());
        }

        var refreshedResponse = await owner.Client.GetAsync($"/api/import-previews/{batchId}");
        var refreshed = await refreshedResponse.Content.ReadFromJsonAsync<JsonElement>();
        var refreshedRow = refreshed.GetProperty("rows").EnumerateArray()
            .Single(row => row.GetProperty("rowId").GetGuid() == candidateRowId);
        Assert.Equal(HttpStatusCode.OK, refreshedResponse.StatusCode);
        Assert.True(refreshedRow.GetProperty("isPossibleDuplicate").GetBoolean());
        Assert.False(refreshedRow.GetProperty("selectedForImport").GetBoolean());
        Assert.Contains("possible_duplicate", refreshedRow.GetProperty("warnings").EnumerateArray()
            .Select(value => value.GetString()));
        Assert.Equal(
            new[] { matchingExpense.Id },
            refreshedRow.GetProperty("duplicateExpenseIds").EnumerateArray().Select(value => value.GetInt32()));

        var reselection = await owner.Client.PatchAsJsonAsync(
            $"/api/import-previews/{batchId}/rows/{candidateRowId}",
            new
            {
                editableExpenseDescription = refreshedRow.GetProperty("editableExpenseDescription").GetString(),
                category = refreshedRow.GetProperty("category").GetString(),
                selectedForImport = true
            });
        var second = await owner.Client.PostAsync($"/api/import-previews/{batchId}/confirm", null);
        var secondBody = await second.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, reselection.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.Equal("confirmed", secondBody.GetProperty("status").GetString());
        Assert.Equal(1, secondBody.GetProperty("importedExpenseCount").GetInt32());
        Assert.Equal(2, await app.CountExpensesAsync());
    }

    [Fact]
    public async Task Confirmation_committed_during_reupload_cannot_create_a_second_open_preview()
    {
        await using var app = new SyntheticExtractionFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-confirm-upload-race@example.com");
        var pdf = SunflowerFixtureCorpus.CreateRepresentativePdf();
        var extractor = (ImmediateSyntheticExtractor)app.Services.GetRequiredService<IPdfTextExtractor>();
        extractor.BeforeResultAsync = async cancellationToken =>
        {
            using var scope = app.Services.CreateScope();
            var context = scope.ServiceProvider.GetRequiredService<BudgetContext>();
            var now = DateTime.UtcNow;
            context.ImportPreviewBatches.Add(new ImportPreviewBatch
            {
                Id = Guid.NewGuid(),
                OwnerId = owner.Id,
                SourceType = SunflowerStatementParser.SourceType,
                ParserRuleVersion = SunflowerStatementParser.RuleVersion,
                DocumentDigest = SHA256.HashData(pdf),
                CreatedAt = now,
                ExpiresAt = now.AddHours(24),
                Lifecycle = ImportPreviewLifecycle.Confirmed,
                ConfirmedAt = now
            });
            await context.SaveChangesAsync(cancellationToken);
        };

        using var content = PdfUpload(pdf);
        var response = await owner.Client.PostAsync("/api/import-previews", content);
        var error = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("already_imported", error.GetProperty("code").GetString());
        Assert.Equal(1, extractor.CallCount);
        Assert.Equal(1, await app.CountImportPreviewBatchesAsync(owner.Id));
        var batch = Assert.Single(await app.FindImportPreviewBatchesAsync(owner.Id));
        Assert.Equal(ImportPreviewLifecycle.Confirmed, batch.Lifecycle);
        Assert.Equal(0, await app.CountExpensesAsync());
    }

    [Fact]
    public async Task File_content_above_ten_mib_is_rejected_before_parsing()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-size@example.com");
        using var content = PdfUpload(new byte[(10 * 1024 * 1024) + 1]);

        var response = await owner.Client.PostAsync("/api/import-previews", content);
        var error = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Equal("upload_too_large", error.GetProperty("code").GetString());
        Assert.Equal(0, await app.CountImportPreviewBatchesAsync(owner.Id));
    }

    [Fact]
    public async Task Exactly_ten_mib_of_valid_pdf_content_is_not_rejected_by_multipart_overhead()
    {
        await using var app = new SyntheticExtractionFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-size-boundary@example.com");
        var fixture = SunflowerFixtureCorpus.CreateRepresentativePdf();
        var padded = new byte[10 * 1024 * 1024];
        fixture.CopyTo(padded, 0);
        Array.Fill(padded, (byte)' ', fixture.Length, padded.Length - fixture.Length);
        using var content = PdfUpload(padded);

        var response = await owner.Client.PostAsync("/api/import-previews", content);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Preview_is_inaccessible_at_the_exact_24_hour_expiry_boundary()
    {
        var clock = new MutableTimeProvider(new DateTimeOffset(2026, 8, 20, 12, 0, 0, TimeSpan.Zero));
        await using var app = new ClockedFinancialApiTestApplication(clock);
        using var owner = await app.CreateAuthenticatedUserAsync("preview-expiry@example.com");
        using var content = PdfUpload(SunflowerFixtureCorpus.CreateRepresentativePdf());
        var create = await owner.Client.PostAsync("/api/import-previews", content);
        var preview = await create.Content.ReadFromJsonAsync<JsonElement>();
        var batchId = preview.GetProperty("batchId").GetGuid();

        clock.Advance(TimeSpan.FromHours(24));
        var read = await owner.Client.GetAsync($"/api/import-previews/{batchId}");
        var resume = await owner.Client.GetAsync("/api/import-previews/open?sourceType=sunflower_pdf");

        Assert.Equal(HttpStatusCode.NotFound, read.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, resume.StatusCode);
    }

    [Fact]
    public void Per_user_admission_is_non_waiting_and_releases_its_permit()
    {
        var admission = new ImportPreviewAdmission();
        using var first = admission.TryAcquire("owner");

        Assert.NotNull(first);
        Assert.Null(admission.TryAcquire("owner"));
        using var other = admission.TryAcquire("other");
        Assert.NotNull(other);

        first.Dispose();
        using var reacquired = admission.TryAcquire("owner");
        Assert.NotNull(reacquired);
    }

    [Fact]
    public async Task Active_user_admission_rejects_request_before_upload_processing()
    {
        await using var app = new SyntheticExtractionFinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-admission@example.com");
        var admission = app.Services.GetRequiredService<IImportPreviewAdmission>();
        using var lease = admission.TryAcquire(owner.Id);
        using var content = PdfUpload(SunflowerFixtureCorpus.CreateRepresentativePdf());

        var response = await owner.Client.PostAsync("/api/import-previews", content);
        var error = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("import_in_progress", error.GetProperty("code").GetString());
        Assert.Equal(0, await app.CountImportPreviewBatchesAsync(owner.Id));
    }

    [Fact]
    public async Task Real_contained_extractor_flows_through_preview_api_and_persistence()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-real-path@example.com");
        using var content = PdfUpload(SunflowerFixtureCorpus.CreateRepresentativePdf());

        var response = await owner.Client.PostAsync("/api/import-previews", content);
        var preview = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(13, preview.GetProperty("rows").GetArrayLength());
        Assert.Equal(1, await app.CountImportPreviewBatchesAsync(owner.Id));
        Assert.Equal(0, await app.CountExpensesAsync());
    }

    [Fact]
    public async Task Concatenated_sunflower_brand_flows_through_extractor_and_preview_api()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-concatenated-brand@example.com");
        var lines = new[]
        {
            "-SunflowerBank FIRST NATIONAL 1870 STATEMENT DATE: 02/28/26",
            "Days in Statement Period: 28",
            "Electronic Transactions",
            "-Posted Description Amount",
            "02/05/26 SYNTHETIC MARKET 42.16-"
        };
        using var content = PdfUpload(SyntheticPdfBuilder.Build(new IReadOnlyList<string>[] { lines }));

        var response = await owner.Client.PostAsync("/api/import-previews", content);
        var preview = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var row = Assert.Single(preview.GetProperty("rows").EnumerateArray());
        Assert.Equal("SYNTHETIC MARKET", row.GetProperty("sourceDescription").GetString());
        Assert.Equal(1, await app.CountImportPreviewBatchesAsync(owner.Id));
        Assert.Equal(0, await app.CountExpensesAsync());
    }

    [Fact]
    public async Task Derived_page_order_and_header_whitespace_flow_through_extractor_and_preview_api()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-derived-layout@example.com");
        var pages = new IReadOnlyList<string>[]
        {
            new[] { "Deposits", "Electronic Transactions" },
            new[]
            {
                "Deposits",
                "-SunflowerBank SYNTHETIC HEADER STATEMENTDATE:02/28/26",
                "DaysinStatementPeriod:28Deposits",
                "Electronic Transactions",
                "-PostedDescriptionAmount",
                "02/05/26 SYNTHETIC MARKET 42.16-"
            }
        };
        using var content = PdfUpload(SyntheticPdfBuilder.Build(pages));

        var response = await owner.Client.PostAsync("/api/import-previews", content);
        var preview = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var row = Assert.Single(preview.GetProperty("rows").EnumerateArray());
        Assert.Equal("SYNTHETIC MARKET", row.GetProperty("sourceDescription").GetString());
        Assert.Equal(1, await app.CountImportPreviewBatchesAsync(owner.Id));
        Assert.Equal(0, await app.CountExpensesAsync());
    }

    [Fact]
    public async Task Positioned_compact_rows_flow_through_contained_extractor_and_preview_api()
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync("preview-positioned-rows@example.com");
        var page = new[]
        {
            new SyntheticPdfBuilder.PositionedText(50, 760, "-SunflowerBank SYNTHETIC HEADER STATEMENTDATE:02/28/26"),
            new SyntheticPdfBuilder.PositionedText(50, 744, "DaysinStatementPeriod:28"),
            new SyntheticPdfBuilder.PositionedText(50, 710, "Electronic Transactions"),
            new SyntheticPdfBuilder.PositionedText(40, 694, "-"),
            new SyntheticPdfBuilder.PositionedText(50, 694, "Posted"),
            new SyntheticPdfBuilder.PositionedText(160, 694, "Description"),
            new SyntheticPdfBuilder.PositionedText(520, 694, "Amount"),
            new SyntheticPdfBuilder.PositionedText(50, 678, "02/05/26"),
            new SyntheticPdfBuilder.PositionedText(160, 678, "SYNTHETICREFERENCE7"),
            new SyntheticPdfBuilder.PositionedText(520, 678, "42.16-"),
            new SyntheticPdfBuilder.PositionedText(50, 662, "02/06/26"),
            new SyntheticPdfBuilder.PositionedText(160, 662, "SYNTHETICUTILITY"),
            new SyntheticPdfBuilder.PositionedText(520, 662, "75.25-"),
            new SyntheticPdfBuilder.PositionedText(50, 40, "Page1of1")
        };
        var pdf = SyntheticPdfBuilder.BuildPositioned(
            new IReadOnlyList<SyntheticPdfBuilder.PositionedText>[] { page });
        var extraction = await new ContainedPdfTextExtractor().ExtractAsync(pdf);
        Assert.True(extraction.IsSuccess, extraction.Failure?.Code);
        var parsed = new SunflowerStatementParser().Parse(extraction.Result!);
        Assert.True(parsed.IsSuccess, parsed.Failure?.Code);
        using var content = PdfUpload(pdf);

        var response = await owner.Client.PostAsync("/api/import-previews", content);
        var preview = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var rows = preview.GetProperty("rows").EnumerateArray().ToList();
        Assert.Equal(2, rows.Count);
        Assert.Equal(new[] { "SYNTHETICREFERENCE7", "SYNTHETICUTILITY" },
            rows.Select(row => row.GetProperty("sourceDescription").GetString()));
        Assert.All(rows, row => Assert.Equal("expense_candidate", row.GetProperty("classification").GetString()));
        Assert.Equal(1, await app.CountImportPreviewBatchesAsync(owner.Id));
        Assert.Equal(0, await app.CountExpensesAsync());
    }

    [Theory]
    [InlineData("malformed", "invalid_pdf")]
    [InlineData("encrypted", "encrypted_pdf")]
    [InlineData("image_only", "image_only_pdf")]
    public async Task Unsafe_pdf_failures_have_stable_safe_api_errors(string kind, string expectedCode)
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync($"preview-{kind}@example.com");
        var pdf = kind switch
        {
            "encrypted" => ParserSpecificPdfFixtures.EncryptedPdf(),
            "image_only" => ParserSpecificPdfFixtures.ImageOnlyPdf(),
            _ => ParserSpecificPdfFixtures.InvalidPdf()
        };
        using var content = PdfUpload(pdf);

        var response = await owner.Client.PostAsync("/api/import-previews", content);
        var error = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        Assert.Equal(expectedCode, error.GetProperty("code").GetString());
        Assert.DoesNotContain("advisory-name", await response.Content.ReadAsStringAsync());
        Assert.Equal(0, await app.CountImportPreviewBatchesAsync(owner.Id));
        Assert.Equal(0, await app.CountExpensesAsync());
    }

    [Theory]
    [InlineData("lookalike")]
    [InlineData("unsupported_format")]
    public async Task Routed_but_structurally_incompatible_statements_fail_safely(string kind)
    {
        await using var app = new FinancialApiTestApplication();
        using var owner = await app.CreateAuthenticatedUserAsync($"preview-{kind}@example.com");
        var header = kind == "lookalike" ? "PRAIRIE BANK" : "SUNFLOWER BANKFIRST NATIONAL 1870";
        var lines = kind == "lookalike"
            ? new[] { header, "STATEMENT DATE: 02/28/26", "Days in Statement Period: 28", "Electronic Transactions", "Posted Description Amount" }
            : new[] { header, "STATEMENT DATE: 02/28/26", "Electronic Transactions", "Posted Description Amount" };
        using var content = PdfUpload(SyntheticPdfBuilder.Build(new IReadOnlyList<string>[] { lines }));

        var response = await owner.Client.PostAsync("/api/import-previews", content);
        var error = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        Assert.Equal("unsupported_statement_format", error.GetProperty("code").GetString());
        Assert.Equal(0, await app.CountImportPreviewBatchesAsync(owner.Id));
    }

    [Fact]
    public async Task Parser_timeout_releases_admission_and_persists_nothing()
    {
        await using var app = new BlockingParserFinancialApiTestApplication(TimeSpan.FromMilliseconds(50));
        using var owner = await app.CreateAuthenticatedUserAsync("preview-timeout@example.com");
        using var content = PdfUpload(SunflowerFixtureCorpus.CreateRepresentativePdf());

        var response = await owner.Client.PostAsync("/api/import-previews", content);
        var error = await response.Content.ReadFromJsonAsync<JsonElement>();
        var admission = app.Services.GetRequiredService<IImportPreviewAdmission>();
        using var releasedLease = admission.TryAcquire(owner.Id);

        Assert.Equal(HttpStatusCode.RequestTimeout, response.StatusCode);
        Assert.Equal("processing_timed_out", error.GetProperty("code").GetString());
        Assert.NotNull(releasedLease);
        Assert.Equal(0, await app.CountImportPreviewBatchesAsync(owner.Id));
        Assert.Equal(0, await app.CountExpensesAsync());
    }

    [Fact]
    public async Task Parser_request_cancellation_releases_admission_and_persists_nothing()
    {
        await using var app = new BlockingParserFinancialApiTestApplication(TimeSpan.FromSeconds(5));
        using var owner = await app.CreateAuthenticatedUserAsync("preview-cancel@example.com");
        using var content = PdfUpload(SunflowerFixtureCorpus.CreateRepresentativePdf());
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            owner.Client.PostAsync("/api/import-previews", content, cancellation.Token));
        var admission = app.Services.GetRequiredService<IImportPreviewAdmission>();
        using var releasedLease = admission.TryAcquire(owner.Id);

        Assert.NotNull(releasedLease);
        Assert.Equal(0, await app.CountImportPreviewBatchesAsync(owner.Id));
        Assert.Equal(0, await app.CountExpensesAsync());
    }

    private static async Task<JsonElement> UploadPreviewAsync(TestUser owner, byte[] pdf)
    {
        using var content = PdfUpload(pdf);
        var response = await owner.Client.PostAsync("/api/import-previews", content);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var preview = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("sunflower_pdf", preview.GetProperty("sourceType").GetString());
        return preview;
    }

    private static async Task SelectOnlyAsync(
        TestUser owner,
        Guid batchId,
        IReadOnlyList<JsonElement> rows,
        Guid? selectedRowId)
    {
        foreach (var row in rows.Where(row => row.GetProperty("isEligible").GetBoolean()))
        {
            var response = await owner.Client.PatchAsJsonAsync(
                $"/api/import-previews/{batchId}/rows/{row.GetProperty("rowId").GetGuid()}",
                new
                {
                    editableExpenseDescription = row.GetProperty("editableExpenseDescription").GetString(),
                    category = row.GetProperty("category").GetString(),
                    selectedForImport = row.GetProperty("rowId").GetGuid() == selectedRowId
                });
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
    }

    private static void AssertSafeRowError(JsonElement error, Guid rowId, string code)
    {
        Assert.Equal(
            new[] { "code", "message", "rows" },
            error.EnumerateObject().Select(property => property.Name).OrderBy(value => value));
        var row = Assert.Single(error.GetProperty("rows").EnumerateArray());
        Assert.Equal(
            new[] { "codes", "rowId" },
            row.EnumerateObject().Select(property => property.Name).OrderBy(value => value));
        Assert.Equal(rowId, row.GetProperty("rowId").GetGuid());
        Assert.Equal(new[] { code }, row.GetProperty("codes").EnumerateArray().Select(value => value.GetString()));
    }

    private static MultipartFormDataContent PdfUpload(byte[] bytes, string? sourceType = SunflowerStatementParser.SourceType)
    {
        var content = new MultipartFormDataContent();
        if (sourceType is not null)
            content.Add(new StringContent(sourceType), "sourceType");
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new("text/plain");
        content.Add(file, "file", "advisory-name.bin");
        return content;
    }
}

internal sealed class ClockedFinancialApiTestApplication(MutableTimeProvider clock) : FinancialApiTestApplication
{
    protected override void ConfigureAdditionalServices(IServiceCollection services)
    {
        services.RemoveAll<TimeProvider>();
        services.AddSingleton<TimeProvider>(clock);
        services.RemoveAll<IPdfTextExtractor>();
        services.AddSingleton<IPdfTextExtractor, ImmediateSyntheticExtractor>();
    }
}

internal sealed class SyntheticExtractionFinancialApiTestApplication : FinancialApiTestApplication
{
    protected override void ConfigureAdditionalServices(IServiceCollection services)
    {
        services.RemoveAll<IPdfTextExtractor>();
        services.AddSingleton<IPdfTextExtractor, ImmediateSyntheticExtractor>();
    }
}

internal sealed class ImmediateSyntheticExtractor : IPdfTextExtractor
{
    private int _callCount;

    public int CallCount => Volatile.Read(ref _callCount);
    public Func<CancellationToken, Task>? BeforeResultAsync { get; set; }

    public async Task<PdfTextExtractionOutcome> ExtractAsync(ReadOnlyMemory<byte> pdf, CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref _callCount);
        cancellationToken.ThrowIfCancellationRequested();
        if (BeforeResultAsync is not null)
            await BeforeResultAsync(cancellationToken);
        var pages = SunflowerFixtureCorpus.RepresentativePages
            .Select((page, index) => new PdfExtractedPage(index + 1, string.Join('\n', page.Lines)))
            .ToList();
        return PdfTextExtractionOutcome.Success(new PdfTextExtractionResult(
            pdf.Length, pages.Count, pages.Sum(page => page.Text.Length), pages));
    }
}

internal sealed class BlockingParserFinancialApiTestApplication(TimeSpan timeout) : FinancialApiTestApplication
{
    protected override void ConfigureAdditionalServices(IServiceCollection services)
    {
        services.RemoveAll<IPdfTextExtractor>();
        services.AddSingleton<IPdfTextExtractor, ImmediateSyntheticExtractor>();
        services.RemoveAll<ISunflowerStatementParser>();
        services.AddSingleton<ISunflowerStatementParser, BlockingSunflowerParser>();
        services.RemoveAll<ImportPreviewProcessingOptions>();
        services.AddSingleton(new ImportPreviewProcessingOptions { Timeout = timeout });
    }
}

internal sealed class RejectingParserFinancialApiTestApplication : FinancialApiTestApplication
{
    protected override void ConfigureAdditionalServices(IServiceCollection services)
    {
        services.RemoveAll<IPdfTextExtractor>();
        services.AddSingleton<IPdfTextExtractor, ImmediateSyntheticExtractor>();
        services.RemoveAll<ISunflowerStatementParser>();
        services.AddSingleton<ISunflowerStatementParser, RejectingSunflowerParser>();
    }
}

internal sealed class RejectingSunflowerParser : ISunflowerStatementParser
{
    public SunflowerStatementParseResult Parse(
        PdfTextExtractionResult extraction,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return SunflowerStatementParseResult.Failed(SunflowerStatementParseFailure.UnsupportedFormat);
    }
}

internal sealed class BlockingSunflowerParser : ISunflowerStatementParser
{
    public SunflowerStatementParseResult Parse(
        PdfTextExtractionResult extraction,
        CancellationToken cancellationToken = default)
    {
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Thread.SpinWait(10_000);
        }
    }
}

internal sealed class MutableTimeProvider(DateTimeOffset utcNow) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => utcNow;
    public void Advance(TimeSpan duration) => utcNow = utcNow.Add(duration);
}
