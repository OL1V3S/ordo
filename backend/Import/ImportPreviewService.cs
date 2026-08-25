using System.Security.Cryptography;
using System.Text.Json;
using BudgetPlanner.Contracts.ImportPreviews;
using BudgetPlanner.Data;
using BudgetPlanner.Import.Sunflower;
using BudgetPlanner.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace BudgetPlanner.Import;

public sealed record ImportPreviewOperation(
    ImportPreviewResponse? Preview,
    ImportPreviewError? Error,
    bool Reused = false)
{
    public bool IsSuccess => Preview is not null;
}

public sealed record ImportConfirmationOperation(
    ImportConfirmationResponse? Confirmation,
    ImportConfirmationError? Error)
{
    public bool IsSuccess => Confirmation is not null;
}

public interface IImportPreviewService
{
    Task<ImportPreviewOperation> CreateAsync(string userId, string? sourceType, Stream file, long? declaredLength, CancellationToken cancellationToken);
    Task<ImportPreviewResponse?> GetOpenAsync(string userId, string sourceType, CancellationToken cancellationToken);
    Task<ImportPreviewResponse?> GetAsync(string userId, Guid batchId, CancellationToken cancellationToken);
    Task<ImportConfirmationOperation> ConfirmAsync(string userId, Guid batchId, CancellationToken cancellationToken);
    Task<ImportPreviewOperation> UpdateRowAsync(string userId, Guid batchId, Guid rowId, UpdateImportPreviewRowRequest request, CancellationToken cancellationToken);
}

public sealed class ImportPreviewProcessingOptions
{
    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(10);
}

public sealed class ImportPreviewService(
    BudgetContext context,
    IPdfTextExtractor extractor,
    ISunflowerStatementParser parser,
    TimeProvider clock,
    ImportPreviewProcessingOptions processingOptions) : IImportPreviewService
{
    public const int MaximumUploadBytes = 10 * 1024 * 1024;
    private static readonly TimeSpan PreviewLifetime = TimeSpan.FromHours(24);
    private const string OpenDigestIndexName =
        "IX_ImportPreviewBatches_OwnerId_SourceType_DocumentDigest";
    private const string ActiveDocumentIndexName = "IX_ImportPreviewBatches_ActiveDocument";
    private const string ConfirmedDigestIndexName = "IX_ImportPreviewBatches_ConfirmedDocument";

    public async Task<ImportPreviewOperation> CreateAsync(
        string userId,
        string? sourceType,
        Stream file,
        long? declaredLength,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(sourceType))
            return Failed("source_required", "Choose a supported bank before uploading.");
        if (!ImportStatementSources.IsSupported(sourceType))
            return Failed("unsupported_statement_source", "The selected statement source is not supported.");
        if (declaredLength > MaximumUploadBytes)
            return Failed("upload_too_large", "The PDF exceeds the 10 MiB limit.");

        byte[] pdf;
        byte[] digest;
        try
        {
            using var buffer = new MemoryStream(Math.Min((int)(declaredLength ?? 0), MaximumUploadBytes));
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var chunk = new byte[81920];
            var total = 0;
            while (true)
            {
                var read = await file.ReadAsync(chunk, cancellationToken);
                if (read == 0) break;
                total += read;
                if (total > MaximumUploadBytes)
                    return Failed("upload_too_large", "The PDF exceeds the 10 MiB limit.");
                hash.AppendData(chunk, 0, read);
                await buffer.WriteAsync(chunk.AsMemory(0, read), cancellationToken);
            }
            pdf = buffer.ToArray();
            digest = hash.GetHashAndReset();
        }
        catch (OperationCanceledException)
        {
            return Failed("processing_cancelled", "Statement processing was cancelled.");
        }

        SunflowerStatementParseResult parsed;
        try
        {
            using var processingCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            processingCts.CancelAfter(processingOptions.Timeout);
            var processingToken = processingCts.Token;

            var confirmed = await FindConfirmedByDigestAsync(
                userId,
                sourceType,
                SunflowerStatementParser.RuleVersion,
                digest,
                processingToken);
            if (confirmed is not null)
                return Failed("already_imported", "This statement was already imported.");

            var existing = await FindCompatibleOpenByDigestAsync(
                userId,
                sourceType,
                SunflowerStatementParser.RuleVersion,
                digest,
                processingToken);
            if (existing is not null)
                return new(ToResponse(existing), null, true);

            PdfTextExtractionOutcome extraction;
            try
            {
                extraction = await extractor.ExtractAsync(pdf, processingToken);
            }
            catch (OperationCanceledException)
            {
                return ProcessingInterrupted(cancellationToken);
            }
            catch
            {
                return Failed("processing_failed", "The PDF could not be processed safely.");
            }

            if (!extraction.IsSuccess)
                return extraction.Failure!.Code == "cancelled"
                    ? ProcessingInterrupted(cancellationToken)
                    : MapExtractionFailure(extraction.Failure);

            processingToken.ThrowIfCancellationRequested();
            parsed = parser.Parse(extraction.Result!, processingToken);
        }
        catch (OperationCanceledException)
        {
            return ProcessingInterrupted(cancellationToken);
        }
        catch
        {
            return Failed("processing_failed", "The PDF could not be processed safely.");
        }
        finally
        {
            CryptographicOperations.ZeroMemory(pdf);
        }
        if (!parsed.IsSuccess)
            return Failed(parsed.Failure!.Code, parsed.Failure.Message);

        var now = clock.GetUtcNow().UtcDateTime;
        var batch = new ImportPreviewBatch
        {
            Id = Guid.NewGuid(),
            OwnerId = userId,
            SourceType = sourceType,
            ParserRuleVersion = SunflowerStatementParser.RuleVersion,
            DocumentDigest = digest,
            CreatedAt = now,
            ExpiresAt = now.Add(PreviewLifetime),
            Lifecycle = ImportPreviewLifecycle.Open
        };

        var eligibleRows = parsed.Rows.Where(IsPotentiallyEligible).ToList();
        var dates = eligibleRows.Where(row => row.PostedDate.HasValue).Select(row => row.PostedDate!.Value).Distinct().ToList();
        var expenses = await context.Expenses.AsNoTracking()
            .Where(expense => expense.UserId == userId && dates.Contains(expense.Date))
            .ToListAsync(cancellationToken);

        foreach (var source in parsed.Rows.OrderBy(row => row.SourceRowOrdinal))
        {
            var description = ExpenseInputRules.NormalizeDescription(source.EditableExpenseDescription ?? source.SourceDescription);
            var category = ExpenseInputRules.NormalizeCategory(source.Category ?? "uncategorized");
            var errors = source.Errors.ToList();
            if (source.SourceDescription.Length > 500)
                errors.Add("source_description_too_long");
            var eligible = IsPotentiallyEligible(source);
            if (eligible)
                errors.AddRange(ExpenseInputRules.Validate(source.Amount, source.PostedDate, description, category));
            eligible = eligible && errors.Count == 0;

            var duplicateIds = eligible
                ? expenses.Where(expense => expense.Date == source.PostedDate
                    && expense.Amount == source.Amount
                    && ExpenseInputRules.NormalizeDescriptionForComparison(expense.Description)
                        == ExpenseInputRules.NormalizeDescriptionForComparison(description))
                    .Select(expense => expense.Id).ToList()
                : [];

            var warnings = source.Warnings.ToList();
            if (duplicateIds.Count > 0 && !warnings.Contains("possible_duplicate"))
                warnings.Add("possible_duplicate");

            batch.Rows.Add(new ImportPreviewRow
            {
                Id = Guid.NewGuid(),
                SourceRowOrdinal = source.SourceRowOrdinal,
                PostedDate = source.PostedDate,
                Amount = source.Amount,
                Direction = source.Direction,
                SourceDescription = source.SourceDescription.Length <= 500
                    ? source.SourceDescription
                    : source.SourceDescription[..500],
                SourceSection = source.SourceSection,
                SourcePageNumber = source.Provenance.SourcePageNumber,
                Classification = source.Classification,
                IsEligible = eligible,
                ValidationErrorCodes = JsonSerializer.Serialize(errors.Distinct()),
                WarningCodes = JsonSerializer.Serialize(warnings.Distinct()),
                IsPossibleDuplicate = duplicateIds.Count > 0,
                DuplicateExpenseIds = JsonSerializer.Serialize(duplicateIds),
                EditableExpenseDescription = eligible ? description : null,
                Category = eligible ? category : null,
                SelectedForImport = eligible && duplicateIds.Count == 0
            });
        }

        var persisted = await PersistOrReuseAsync(batch, cancellationToken);

        await CleanupExpiredAsync(now, cancellationToken);
        return persisted;
    }

    public async Task<ImportPreviewResponse?> GetOpenAsync(string userId, string sourceType, CancellationToken cancellationToken)
    {
        if (!ImportStatementSources.IsSupported(sourceType)) return null;
        await ExpireOwnedAsync(userId, cancellationToken);
        var batch = await OwnedCompatibleOpenQuery(userId).Where(value => value.SourceType == sourceType)
            .OrderByDescending(value => value.CreatedAt).FirstOrDefaultAsync(cancellationToken);
        return batch is null ? null : ToResponse(batch);
    }

    public async Task<ImportPreviewResponse?> GetAsync(string userId, Guid batchId, CancellationToken cancellationToken)
    {
        await ExpireOwnedAsync(userId, cancellationToken);
        var batch = await OwnedCompatibleOpenQuery(userId)
            .SingleOrDefaultAsync(value => value.Id == batchId, cancellationToken);
        return batch is null ? null : ToResponse(batch);
    }

    public async Task<ImportConfirmationOperation> ConfirmAsync(
        string userId,
        Guid batchId,
        CancellationToken cancellationToken)
    {
        IDbContextTransaction? transaction = null;
        try
        {
            transaction = await BeginMutationTransactionAsync(cancellationToken);
            await LockOwnedBatchAsync(userId, batchId, cancellationToken);

            var batch = await context.ImportPreviewBatches
                .Include(value => value.Rows)
                .Include(value => value.Provenance)
                .SingleOrDefaultAsync(
                    value => value.OwnerId == userId && value.Id == batchId,
                    cancellationToken);
            if (batch is null)
                return ConfirmationFailed("preview_not_found", "The preview is unavailable.");

            if (batch.Lifecycle == ImportPreviewLifecycle.Confirmed)
            {
                return ConfirmationSucceeded(batch, "already_confirmed", batch.Provenance.Count);
            }

            if (batch.SourceType != SunflowerStatementParser.SourceType
                || batch.ParserRuleVersion != SunflowerStatementParser.RuleVersion)
            {
                return ConfirmationFailed("preview_not_found", "The preview is unavailable.");
            }

            var now = clock.GetUtcNow().UtcDateTime;
            if (batch.Lifecycle == ImportPreviewLifecycle.Expired
                || (batch.Lifecycle == ImportPreviewLifecycle.Open && batch.ExpiresAt <= now))
            {
                if (batch.Lifecycle == ImportPreviewLifecycle.Open)
                {
                    batch.Lifecycle = ImportPreviewLifecycle.Expired;
                    await context.SaveChangesAsync(cancellationToken);
                    await CommitAsync(transaction, cancellationToken);
                }
                return ConfirmationFailed("preview_expired", "The preview has expired. Re-upload the statement.");
            }

            if (batch.Lifecycle != ImportPreviewLifecycle.Open)
            {
                return ConfirmationFailed("preview_not_found", "The preview is unavailable.");
            }

            if (batch.Provenance.Count > 0)
            {
                return ConfirmationFailed("confirmation_conflict", "The preview cannot be confirmed safely.");
            }

            var selectedRows = batch.Rows.Where(value => value.SelectedForImport)
                .OrderBy(value => value.SourceRowOrdinal)
                .ToList();
            if (selectedRows.Count == 0)
            {
                return ConfirmationFailed("no_rows_selected", "Select at least one eligible row before confirming.");
            }

            var selectedDates = selectedRows.Where(value => value.PostedDate.HasValue)
                .Select(value => value.PostedDate!.Value)
                .Distinct()
                .ToList();
            var currentExpenses = await context.Expenses.AsNoTracking()
                .Where(value => value.UserId == userId && selectedDates.Contains(value.Date))
                .ToListAsync(cancellationToken);

            var newlyWarnedRows = new List<ImportConfirmationRowError>();
            foreach (var row in selectedRows)
            {
                var duplicateIds = FindPossibleDuplicateExpenseIds(row, currentExpenses);
                if (row.IsPossibleDuplicate || duplicateIds.Count == 0) continue;

                row.IsPossibleDuplicate = true;
                row.DuplicateExpenseIds = JsonSerializer.Serialize(duplicateIds);
                var warnings = DeserializeCodes(row.WarningCodes).ToList();
                if (!warnings.Contains("possible_duplicate")) warnings.Add("possible_duplicate");
                row.WarningCodes = JsonSerializer.Serialize(warnings.Distinct());
                row.SelectedForImport = false;
                newlyWarnedRows.Add(new(row.Id, ["possible_duplicate"]));
            }

            if (newlyWarnedRows.Count > 0)
            {
                await context.SaveChangesAsync(cancellationToken);
                await CommitAsync(transaction, cancellationToken);
                return ConfirmationFailed(
                    "duplicate_review_required",
                    "One or more selected rows now require duplicate review.",
                    newlyWarnedRows);
            }

            var validationErrors = new List<ImportConfirmationRowError>();
            var normalizedRows = new List<(ImportPreviewRow Row, string Description, string Category)>();
            foreach (var row in selectedRows)
            {
                var description = ExpenseInputRules.NormalizeDescription(row.EditableExpenseDescription);
                var category = ExpenseInputRules.NormalizeCategory(row.Category);
                var errors = new List<string>();
                if (!row.IsEligible
                    || row.Classification != ImportedRowClassification.ExpenseCandidate
                    || row.Direction != ImportedTransactionDirection.Debit)
                {
                    errors.Add("row_not_selectable");
                }
                errors.AddRange(ExpenseInputRules.Validate(row.Amount, row.PostedDate, description, category));

                var distinctErrors = errors.Distinct().ToList();
                if (distinctErrors.Count > 0)
                {
                    validationErrors.Add(new(row.Id, distinctErrors));
                }
                else
                {
                    normalizedRows.Add((row, description, category));
                }
            }

            if (validationErrors.Count > 0)
            {
                return ConfirmationFailed(
                    "confirmation_validation_failed",
                    "One or more selected rows are no longer valid.",
                    validationErrors);
            }

            foreach (var normalized in normalizedRows)
            {
                var expense = new Expense
                {
                    UserId = userId,
                    Description = normalized.Description,
                    Amount = normalized.Row.Amount!.Value,
                    Date = normalized.Row.PostedDate!.Value,
                    Category = normalized.Category
                };
                context.Expenses.Add(expense);
                batch.Provenance.Add(new ImportExpenseProvenance
                {
                    BatchId = batch.Id,
                    SourceRowOrdinal = normalized.Row.SourceRowOrdinal,
                    Expense = expense
                });
            }

            batch.Lifecycle = ImportPreviewLifecycle.Confirmed;
            batch.ConfirmedAt = now;
            context.ImportPreviewRows.RemoveRange(batch.Rows);
            await context.SaveChangesAsync(cancellationToken);
            await CommitAsync(transaction, cancellationToken);
            return ConfirmationSucceeded(batch, "confirmed", normalizedRows.Count);
        }
        catch (OperationCanceledException)
        {
            await RollbackAsync(transaction);
            context.ChangeTracker.Clear();
            return ConfirmationFailed("confirmation_failed", "The preview could not be confirmed safely.");
        }
        catch (DbUpdateException exception)
        {
            await RollbackAsync(transaction);
            context.ChangeTracker.Clear();
            return IsConfirmedDigestUniqueViolation(exception)
                ? ConfirmationFailed("confirmation_conflict", "The statement was already confirmed.")
                : ConfirmationFailed("confirmation_failed", "The preview could not be confirmed safely.");
        }
        catch (NpgsqlException)
        {
            await RollbackAsync(transaction);
            context.ChangeTracker.Clear();
            return ConfirmationFailed("confirmation_failed", "The preview could not be confirmed safely.");
        }
        finally
        {
            if (transaction is not null) await transaction.DisposeAsync();
        }
    }

    public async Task<ImportPreviewOperation> UpdateRowAsync(string userId, Guid batchId, Guid rowId, UpdateImportPreviewRowRequest request, CancellationToken cancellationToken)
    {
        IDbContextTransaction? transaction = null;
        try
        {
            transaction = await BeginMutationTransactionAsync(cancellationToken);
            await LockOwnedBatchAsync(userId, batchId, cancellationToken);

            var batch = await context.ImportPreviewBatches.Include(value => value.Rows)
                .SingleOrDefaultAsync(
                    value => value.OwnerId == userId && value.Id == batchId,
                    cancellationToken);
            if (batch is null)
                return Failed("preview_not_found", "The preview is unavailable.");

            if (batch.Lifecycle == ImportPreviewLifecycle.Open
                && batch.ExpiresAt <= clock.GetUtcNow().UtcDateTime)
            {
                batch.Lifecycle = ImportPreviewLifecycle.Expired;
                await context.SaveChangesAsync(cancellationToken);
                await CommitAsync(transaction, cancellationToken);
                return Failed("preview_not_found", "The preview is unavailable.");
            }

            if (batch.Lifecycle != ImportPreviewLifecycle.Open
                || batch.SourceType != SunflowerStatementParser.SourceType
                || batch.ParserRuleVersion != SunflowerStatementParser.RuleVersion)
            {
                return Failed("preview_not_found", "The preview is unavailable.");
            }

            var row = batch.Rows.SingleOrDefault(value => value.Id == rowId);
            if (row is null) return Failed("preview_not_found", "The preview is unavailable.");
            if (!row.IsEligible && request.SelectedForImport)
                return Failed("row_not_selectable", "This row cannot be selected for import.");

            if (row.IsEligible)
            {
                var description = ExpenseInputRules.NormalizeDescription(request.EditableExpenseDescription);
                var category = ExpenseInputRules.NormalizeCategory(request.Category);
                var errors = ExpenseInputRules.Validate(row.Amount, row.PostedDate, description, category);
                if (errors.Count > 0) return Failed("row_validation_failed", "The row changes are invalid.");
                row.EditableExpenseDescription = description;
                row.Category = category;
                row.SelectedForImport = request.SelectedForImport;
            }
            else
            {
                row.SelectedForImport = false;
            }
            await context.SaveChangesAsync(cancellationToken);
            await CommitAsync(transaction, cancellationToken);
            return new(ToResponse(batch), null);
        }
        finally
        {
            if (transaction is not null) await transaction.DisposeAsync();
        }
    }

    private IQueryable<ImportPreviewBatch> OwnedOpenQuery(string userId) => context.ImportPreviewBatches
        .AsNoTracking().Include(value => value.Rows)
        .Where(value => value.OwnerId == userId && value.Lifecycle == ImportPreviewLifecycle.Open);

    private IQueryable<ImportPreviewBatch> OwnedCompatibleOpenQuery(string userId) =>
        OwnedOpenQuery(userId).Where(value =>
            value.SourceType == SunflowerStatementParser.SourceType
            && value.ParserRuleVersion == SunflowerStatementParser.RuleVersion);

    private async Task<ImportPreviewBatch?> FindCompatibleOpenByDigestAsync(
        string userId,
        string sourceType,
        string parserRuleVersion,
        byte[] digest,
        CancellationToken cancellationToken)
    {
        await ExpireOwnedAsync(userId, cancellationToken);
        var candidates = await OwnedOpenQuery(userId)
            .Where(value => value.SourceType == sourceType
                && value.ParserRuleVersion == parserRuleVersion)
            .ToListAsync(cancellationToken);
        return candidates.SingleOrDefault(value => CryptographicOperations.FixedTimeEquals(value.DocumentDigest, digest));
    }

    private async Task<ImportPreviewBatch?> FindConfirmedByDigestAsync(
        string userId,
        string sourceType,
        string parserRuleVersion,
        byte[] digest,
        CancellationToken cancellationToken)
    {
        var candidates = await context.ImportPreviewBatches.AsNoTracking()
            .Where(value => value.OwnerId == userId
                && value.SourceType == sourceType
                && value.ParserRuleVersion == parserRuleVersion
                && value.Lifecycle == ImportPreviewLifecycle.Confirmed)
            .ToListAsync(cancellationToken);
        return candidates.SingleOrDefault(value =>
            CryptographicOperations.FixedTimeEquals(value.DocumentDigest, digest));
    }

    private async Task<IDbContextTransaction?> BeginMutationTransactionAsync(CancellationToken cancellationToken) =>
        context.Database.IsRelational()
            ? await context.Database.BeginTransactionAsync(cancellationToken)
            : null;

    private async Task LockOwnedBatchAsync(
        string userId,
        Guid batchId,
        CancellationToken cancellationToken)
    {
        if (!context.Database.IsRelational()) return;
        await context.Database.ExecuteSqlInterpolatedAsync(
            $@"SELECT 1 FROM ""ImportPreviewBatches""
               WHERE ""Id"" = {batchId} AND ""OwnerId"" = {userId}
               FOR UPDATE",
            cancellationToken);
    }

    private static List<int> FindPossibleDuplicateExpenseIds(
        ImportPreviewRow row,
        IReadOnlyList<Expense> expenses)
    {
        if (!row.PostedDate.HasValue || !row.Amount.HasValue) return [];
        var description = ExpenseInputRules.NormalizeDescriptionForComparison(row.EditableExpenseDescription);
        return expenses.Where(expense => expense.Date == row.PostedDate.Value
                && expense.Amount == row.Amount.Value
                && ExpenseInputRules.NormalizeDescriptionForComparison(expense.Description) == description)
            .Select(expense => expense.Id)
            .Distinct()
            .OrderBy(value => value)
            .ToList();
    }

    private static IReadOnlyList<string> DeserializeCodes(string value) =>
        JsonSerializer.Deserialize<string[]>(value) ?? [];

    private static async Task CommitAsync(
        IDbContextTransaction? transaction,
        CancellationToken cancellationToken)
    {
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
    }

    private static async Task RollbackAsync(IDbContextTransaction? transaction)
    {
        if (transaction is not null) await transaction.RollbackAsync(CancellationToken.None);
    }

    private async Task<ImportPreviewOperation> PersistOrReuseAsync(
        ImportPreviewBatch batch,
        CancellationToken cancellationToken)
    {
        IDbContextTransaction? transaction = null;
        try
        {
            if (context.Database.IsRelational())
            {
                transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            }

            var confirmed = await FindConfirmedByDigestAsync(
                batch.OwnerId,
                batch.SourceType,
                batch.ParserRuleVersion,
                batch.DocumentDigest,
                cancellationToken);
            if (confirmed is not null)
            {
                return Failed("already_imported", "This statement was already imported.");
            }

            var winner = await FindCompatibleOpenByDigestAsync(
                batch.OwnerId,
                batch.SourceType,
                batch.ParserRuleVersion,
                batch.DocumentDigest,
                cancellationToken);
            if (winner is not null)
            {
                return new(ToResponse(winner), null, true);
            }

            var predecessor = await FindTrackedOpenByDigestAsync(
                batch.OwnerId,
                batch.SourceType,
                batch.DocumentDigest,
                cancellationToken);
            if (predecessor is not null)
            {
                predecessor.Lifecycle = ImportPreviewLifecycle.Expired;
                if (transaction is not null)
                {
                    await context.SaveChangesAsync(cancellationToken);
                }
            }

            context.ImportPreviewBatches.Add(batch);
            await context.SaveChangesAsync(cancellationToken);
            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }
            return new(ToResponse(batch), null);
        }
        catch (DbUpdateException exception) when (
            IsOpenDigestUniqueViolation(exception) || IsActiveDocumentUniqueViolation(exception))
        {
            if (transaction is not null)
            {
                await transaction.RollbackAsync(CancellationToken.None);
                await transaction.DisposeAsync();
                transaction = null;
            }
            context.ChangeTracker.Clear();
            var winner = await FindCompatibleOpenByDigestAsync(
                batch.OwnerId,
                batch.SourceType,
                batch.ParserRuleVersion,
                batch.DocumentDigest,
                cancellationToken);
            if (winner is not null)
            {
                return new(ToResponse(winner), null, true);
            }
            var confirmed = await FindConfirmedByDigestAsync(
                batch.OwnerId,
                batch.SourceType,
                batch.ParserRuleVersion,
                batch.DocumentDigest,
                cancellationToken);
            if (confirmed is null)
            {
                throw;
            }
            return Failed("already_imported", "This statement was already imported.");
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }
    }

    private async Task<ImportPreviewBatch?> FindTrackedOpenByDigestAsync(
        string userId,
        string sourceType,
        byte[] digest,
        CancellationToken cancellationToken)
    {
        var candidates = await context.ImportPreviewBatches
            .Where(value => value.OwnerId == userId
                && value.SourceType == sourceType
                && value.Lifecycle == ImportPreviewLifecycle.Open)
            .ToListAsync(cancellationToken);
        return candidates.SingleOrDefault(value =>
            CryptographicOperations.FixedTimeEquals(value.DocumentDigest, digest));
    }

    private static bool IsOpenDigestUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: OpenDigestIndexName
        };

    private static bool IsActiveDocumentUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: ActiveDocumentIndexName
        };

    private static bool IsConfirmedDigestUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: ConfirmedDigestIndexName
        };

    private async Task ExpireOwnedAsync(string userId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var query = context.ImportPreviewBatches
            .Where(value => value.OwnerId == userId
                && value.Lifecycle == ImportPreviewLifecycle.Open
                && value.ExpiresAt <= now);
        if (context.Database.IsRelational())
        {
            await query.ExecuteUpdateAsync(
                setters => setters.SetProperty(value => value.Lifecycle, ImportPreviewLifecycle.Expired),
                cancellationToken);
            return;
        }

        var expired = await query
            .ToListAsync(cancellationToken);
        if (expired.Count == 0) return;
        foreach (var value in expired) value.Lifecycle = ImportPreviewLifecycle.Expired;
        await context.SaveChangesAsync(cancellationToken);
    }

    private async Task CleanupExpiredAsync(DateTime now, CancellationToken cancellationToken)
    {
        var stale = await context.ImportPreviewBatches.Where(value => value.Lifecycle == ImportPreviewLifecycle.Expired && value.ExpiresAt < now.AddDays(-7))
            .OrderBy(value => value.ExpiresAt).Take(100).ToListAsync(cancellationToken);
        if (stale.Count == 0) return;
        context.ImportPreviewBatches.RemoveRange(stale);
        await context.SaveChangesAsync(cancellationToken);
    }

    private static bool IsPotentiallyEligible(NormalizedImportedRow row) =>
        row.Classification == ImportedRowClassification.ExpenseCandidate
        && row.Direction == ImportedTransactionDirection.Debit;

    private static ImportPreviewOperation MapExtractionFailure(PdfExtractionFailure failure) => failure.Code switch
    {
        "input_too_large" => Failed("upload_too_large", "The PDF exceeds the 10 MiB limit."),
        "no_extractable_text" => Failed("image_only_pdf", "The PDF does not contain extractable text."),
        "cancelled" => Failed("processing_cancelled", "Statement processing was cancelled."),
        "timed_out" => Failed("processing_timed_out", "Statement processing timed out."),
        _ => Failed(failure.Code, failure.Message)
    };

    private static ImportPreviewOperation Failed(string code, string message) => new(null, new(code, message));

    private static ImportConfirmationOperation ConfirmationSucceeded(
        ImportPreviewBatch batch,
        string status,
        int importedExpenseCount) => new(
            new(
                batch.Id,
                status,
                batch.ConfirmedAt ?? throw new InvalidOperationException("A confirmed batch requires a confirmation time."),
                importedExpenseCount),
            null);

    private static ImportConfirmationOperation ConfirmationFailed(
        string code,
        string message,
        IReadOnlyList<ImportConfirmationRowError>? rows = null) =>
        new(null, new(code, message, rows ?? []));

    private static ImportPreviewOperation ProcessingInterrupted(CancellationToken requestToken) =>
        requestToken.IsCancellationRequested
            ? Failed("processing_cancelled", "Statement processing was cancelled.")
            : Failed("processing_timed_out", "Statement processing timed out.");

    private static ImportPreviewResponse ToResponse(ImportPreviewBatch batch) => new(
        batch.Id, batch.SourceType, batch.ParserRuleVersion, batch.CreatedAt, batch.ExpiresAt,
        batch.Rows.OrderBy(row => row.SourceRowOrdinal).Select(row => new ImportPreviewRowResponse(
            row.Id, row.SourceRowOrdinal, row.PostedDate, row.Amount,
            row.Direction.ToString().ToLowerInvariant(), row.SourceDescription, row.SourceSection,
            ToSnakeCase(row.Classification), row.IsEligible,
            JsonSerializer.Deserialize<string[]>(row.ValidationErrorCodes) ?? [],
            JsonSerializer.Deserialize<string[]>(row.WarningCodes) ?? [],
            row.IsPossibleDuplicate,
            JsonSerializer.Deserialize<int[]>(row.DuplicateExpenseIds) ?? [],
            row.EditableExpenseDescription, row.Category, row.SelectedForImport)).ToList());

    private static string ToSnakeCase(ImportedRowClassification value) => value switch
    {
        ImportedRowClassification.ExpenseCandidate => "expense_candidate",
        ImportedRowClassification.NonExpense => "non_expense",
        ImportedRowClassification.NeedsReview => "needs_review",
        _ => "invalid"
    };
}
