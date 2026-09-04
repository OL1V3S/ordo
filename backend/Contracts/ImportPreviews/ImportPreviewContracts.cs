namespace BudgetPlanner.Contracts.ImportPreviews;

public sealed record ImportPreviewError(string Code, string Message);

public sealed record ImportConfirmationRowError(
    Guid RowId,
    IReadOnlyList<string> Codes);

public sealed record ImportConfirmationError(
    string Code,
    string Message,
    IReadOnlyList<ImportConfirmationRowError> Rows);

public sealed record ImportConfirmationResponse(
    Guid BatchId,
    string Status,
    DateTime ConfirmedAt,
    int ImportedExpenseCount,
    int ImportedInflowCount);

public sealed record ImportPreviewResponse(
    Guid BatchId,
    string SourceType,
    string ParserRuleVersion,
    DateTime CreatedAt,
    DateTime ExpiresAt,
    IReadOnlyList<ImportPreviewRowResponse> Rows);

public sealed record ImportPreviewRowResponse(
    Guid RowId,
    int SourceRowOrdinal,
    DateOnly? PostedDate,
    decimal? Amount,
    string Direction,
    string SourceDescription,
    string SourceSection,
    string Classification,
    bool IsEligible,
    bool IsInflowEligible,
    IReadOnlyList<string> Errors,
    IReadOnlyList<string> Warnings,
    bool IsPossibleDuplicate,
    IReadOnlyList<int> DuplicateExpenseIds,
    bool IsPossibleInflowDuplicate,
    IReadOnlyList<int> DuplicateInflowIds,
    string? EditableExpenseDescription,
    string? Category,
    bool SelectedForImport,
    bool SelectedForInflow);

public sealed record UpdateImportPreviewRowRequest(
    string? EditableExpenseDescription,
    string? Category,
    bool SelectedForImport,
    bool SelectedForInflow);
