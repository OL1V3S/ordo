namespace BudgetPlanner.Import;

public static class ImportStatementSources
{
    public const string SunflowerPdf = "sunflower_pdf";

    public static bool IsSupported(string? sourceType) =>
        string.Equals(sourceType, SunflowerPdf, StringComparison.Ordinal);
}
