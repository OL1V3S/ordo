using System.Globalization;
using BudgetPlanner.Import;
using BudgetPlanner.Import.Sunflower;
using BudgetPlanner.Tests.Import.Fixtures.Sunflower;
using Xunit;

namespace BudgetPlanner.Tests.Import;

public sealed class SunflowerStatementParserTests
{
    [Fact]
    public async Task Representative_pdf_flows_through_extractor_and_parser()
    {
        var extraction = await new ContainedPdfTextExtractor().ExtractAsync(
            SunflowerFixtureCorpus.CreateRepresentativePdf());

        Assert.True(extraction.IsSuccess);
        var result = new SunflowerStatementParser().Parse(extraction.Result!);

        Assert.True(result.IsSuccess, result.Failure?.Code);
        Assert.Equal(13, result.Rows.Count);
        Assert.Equal(Enumerable.Range(1, 13), result.Rows.Select(row => row.SourceRowOrdinal));

        var payroll = result.Rows[0];
        Assert.Equal(new DateOnly(2026, 2, 3), payroll.PostedDate);
        Assert.Equal(2450.00m, payroll.Amount);
        Assert.Equal(ImportedTransactionDirection.Credit, payroll.Direction);
        Assert.Equal(ImportedRowClassification.NonExpense, payroll.Classification);

        var firstDebit = result.Rows[2];
        Assert.Equal(ImportedTransactionDirection.Debit, firstDebit.Direction);
        Assert.Equal(ImportedRowClassification.ExpenseCandidate, firstDebit.Classification);
        Assert.Equal(firstDebit.SourceDescription, firstDebit.EditableExpenseDescription);
        Assert.Equal("uncategorized", firstDebit.Category);
        Assert.Equal(SunflowerStatementParser.SourceType, firstDebit.Provenance.SourceType);
        Assert.Equal(SunflowerStatementParser.RuleVersion, firstDebit.Provenance.ParserRuleVersion);
        Assert.Equal(3, result.Rows.Single(row => row.SourceDescription == "BROKERAGE FUNDING").Provenance.SourcePageNumber);

        var repeated = result.Rows.Where(row => row.SourceDescription == "REPEATED CAFE").ToList();
        Assert.Equal(2, repeated.Count);
        Assert.NotEqual(repeated[0].SourceRowOrdinal, repeated[1].SourceRowOrdinal);

        var ambiguous = Assert.Single(result.Rows, row => row.SourceDescription == "SOURCE DIRECTION UNKNOWN");
        Assert.Equal(ImportedTransactionDirection.Unresolved, ambiguous.Direction);
        Assert.Equal(ImportedRowClassification.NeedsReview, ambiguous.Classification);
        Assert.Null(ambiguous.Category);
    }

    [Fact]
    public void Routed_parser_requires_transaction_structure_but_not_textual_bank_identity()
    {
        var parser = new SunflowerStatementParser();
        var withoutTextIdentity = parser.Parse(Result(
            "SYNTHETIC HEADER\nSTATEMENT DATE: 02/28/26\nDays in Statement Period: 28\n" +
            "Electronic Transactions\nPosted Description Amount\n02/01/26 PURCHASE 1.00-"));
        Assert.True(withoutTextIdentity.IsSuccess);
        Assert.Single(withoutTextIdentity.Rows);

        Assert.Equal(
            "unsupported_statement_format",
            parser.Parse(Result("SUNFLOWER BANK\nSTATEMENT DATE: 02/28/26\nDays in Statement Period 28\nElectronic Transactions\nPosted Description Amount"))
                .Failure?.Code);
    }

    [Fact]
    public void Compact_header_requires_exact_geometry_and_uses_the_common_row_grammar()
    {
        var parsed = new SunflowerStatementParser().Parse(CompactHeaderResult());

        Assert.True(parsed.IsSuccess, parsed.Failure?.Code);
        var row = Assert.Single(parsed.Rows);
        Assert.Equal("SYNTHETIC PURCHASE", row.SourceDescription);
        Assert.Equal(10.00m, row.Amount);
        Assert.Equal(ImportedRowClassification.ExpenseCandidate, row.Classification);
        Assert.Equal("sunflower-v3", row.Provenance.ParserRuleVersion);
    }

    [Fact]
    public void Compact_header_near_misses_fail_closed()
    {
        var parser = new SunflowerStatementParser();
        var withoutGeometry = CompactHeaderResult(words: Array.Empty<PdfExtractedWord>());
        var multipleTextMatches = CompactHeaderResult(
            textSuffix: "YPostedDescriptionAmount02/02/26 SECOND 11.00-");
        var rotatedWords = CompactHeaderWords();
        rotatedWords[0] = rotatedWords[0] with { Orientation = PdfWordOrientation.Rotate90 };
        var rotated = CompactHeaderResult(words: rotatedWords);

        Assert.Equal("unsupported_statement_format", parser.Parse(withoutGeometry).Failure?.Code);
        Assert.Equal("unsupported_statement_format", parser.Parse(multipleTextMatches).Failure?.Code);
        Assert.Equal("unsupported_statement_format", parser.Parse(rotated).Failure?.Code);
    }

    [Fact]
    public void Full_dates_use_fixed_statement_century_and_resolve_year_boundary()
    {
        var result = ParseRows(
            "STATEMENT DATE: 01/31/00",
            "12/31/99 PRIOR YEAR PURCHASE 10.00-",
            "01/01/00 CURRENT YEAR PURCHASE 11.00-");

        Assert.True(result.IsSuccess);
        Assert.Equal(new DateOnly(1999, 12, 31), result.Rows[0].PostedDate);
        Assert.Equal(new DateOnly(2000, 1, 1), result.Rows[1].PostedDate);
    }

    [Theory]
    [InlineData("02/29/26 PURCHASE 1.00-", "invalid_transaction_date")]
    [InlineData("02/01/24 PURCHASE 1.00-", "invalid_transaction_date")]
    [InlineData("02/01/26 PURCHASE 0.00-", "invalid_transaction_amount")]
    [InlineData("02/01/26 PURCHASE 00.10-", "invalid_transaction_amount")]
    [InlineData("02/01/26 PURCHASE 1,23.45-", "invalid_transaction_amount")]
    [InlineData("02/01/26 PURCHASE 1.2-", "invalid_transaction_amount")]
    [InlineData("02/01/26 PURCHASE 1.234-", "invalid_transaction_amount")]
    [InlineData("02/01/26 PURCHASE $1.00-", "invalid_transaction_amount")]
    [InlineData("02/01/26 PURCHASE (1.00)", "invalid_transaction_amount")]
    [InlineData("02/01/26 PURCHASE +1.00", "invalid_transaction_amount")]
    [InlineData("02/01/26 PURCHASE 999999999999999999999999999999.00-", "invalid_transaction_amount")]
    [InlineData("02/01/26 1.00-", "unsupported_transaction_row")]
    public void Invalid_dates_and_amounts_become_controlled_invalid_rows(string row, string error)
    {
        var parsed = ParseRows("STATEMENT DATE: 02/28/26", row);

        Assert.True(parsed.IsSuccess);
        var invalid = Assert.Single(parsed.Rows);
        Assert.Equal(ImportedRowClassification.Invalid, invalid.Classification);
        Assert.Contains(error, invalid.Errors);
    }

    [Theory]
    [InlineData("1.00", 1)]
    [InlineData("1234.56", 1234.56)]
    [InlineData("1,234.56", 1234.56)]
    [InlineData("12,345,678.90", 12345678.90)]
    public void Plain_and_correctly_grouped_amounts_parse_invariantly(string sourceAmount, decimal expected)
    {
        var previousCulture = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("de-DE");
            var result = ParseRows("STATEMENT DATE: 02/28/26", $"02/01/26 PURCHASE {sourceAmount}-");
            Assert.Equal(expected, Assert.Single(result.Rows).Amount);
        }
        finally
        {
            CultureInfo.CurrentCulture = previousCulture;
        }
    }

    [Fact]
    public void Wrapped_description_is_joined_but_orphan_content_is_surfaced()
    {
        var result = new SunflowerStatementParser().Parse(Result(
            "SUNFLOWER BANK ADJACENT HEADER\nSTATEMENT DATE: 02/28/26\nDays in Statement Period: 28\n" +
            "Electronic Transactions\nPosted Description Amount\n" +
            "02/01/26 SYNTHETIC MERCHANT 10.00-\n  CONTINUED DESCRIPTION\nUNRECOGNIZED ROW"));

        Assert.True(result.IsSuccess);
        Assert.Equal("SYNTHETIC MERCHANT CONTINUED DESCRIPTION", result.Rows[0].SourceDescription);
        Assert.Equal(ImportedRowClassification.Invalid, result.Rows[1].Classification);
        Assert.Contains("unsupported_transaction_row", result.Rows[1].Errors);
    }

    [Fact]
    public void Positional_words_separate_digit_ending_description_from_compact_amount()
    {
        var result = new SunflowerStatementParser().Parse(PositionalResult(
            "02/01/26SYNTHETICREFERENCE710.00-02/02/26SECONDPURCHASE20.25-",
            PositionalWord(1, "Posted", .08, .16, .80),
            PositionalWord(2, "Description", .25, .40, .80),
            PositionalWord(3, "Amount", .85, .93, .80),
            PositionalWord(4, "02/01/26", .08, .16, .70),
            PositionalWord(5, "SYNTHETIC", .25, .36, .70),
            PositionalWord(6, "REFERENCE7", .37, .49, .70),
            PositionalWord(7, "10.00-", .86, .93, .70),
            PositionalWord(8, "02/02/26", .08, .16, .65),
            PositionalWord(9, "SECOND", .25, .34, .65),
            PositionalWord(10, "PURCHASE", .35, .46, .65),
            PositionalWord(11, "20.25", .86, .92, .65),
            PositionalWord(12, "-", .92, .93, .65)));

        Assert.True(result.IsSuccess);
        Assert.Collection(
            result.Rows,
            row =>
            {
                Assert.Equal("SYNTHETIC REFERENCE7", row.SourceDescription);
                Assert.Equal(10.00m, row.Amount);
                Assert.Equal(ImportedTransactionDirection.Debit, row.Direction);
                Assert.Equal(ImportedRowClassification.ExpenseCandidate, row.Classification);
            },
            row =>
            {
                Assert.Equal("SECOND PURCHASE", row.SourceDescription);
                Assert.Equal(20.25m, row.Amount);
            });
    }

    [Theory]
    [InlineData("duplicate_amount")]
    [InlineData("column_drift")]
    [InlineData("overlap")]
    [InlineData("rotated")]
    [InlineData("missing_layout")]
    public void Ambiguous_or_invalid_positional_rows_fail_closed(string kind)
    {
        var words = new List<PdfExtractedWord>
        {
            PositionalWord(1, "Posted", .08, .16, .80),
            PositionalWord(2, "Description", .25, .40, .80),
            PositionalWord(3, "Amount", .85, .93, .80),
            PositionalWord(4, "02/01/26", .08, .16, .70),
            PositionalWord(5, "SYNTHETIC7", .25, kind == "overlap" ? .88 : .45, .70),
            PositionalWord(6, "10.00-", kind == "column_drift" ? .70 : .86, kind == "column_drift" ? .77 : .93, .70,
                kind == "rotated" ? PdfWordOrientation.Rotate90 : PdfWordOrientation.Horizontal),
            PositionalWord(7, "02/02/26", .08, .16, .65),
            PositionalWord(8, "SECOND", .25, .35, .65),
            PositionalWord(9, "20.00-", .86, .93, .65)
        };
        if (kind == "duplicate_amount")
        {
            words.Add(PositionalWord(10, "11.00-", .78, .84, .70));
        }
        if (kind == "missing_layout")
        {
            words.Clear();
        }

        var result = new SunflowerStatementParser().Parse(PositionalResult(
            "02/01/26SYNTHETIC710.00-02/02/26SECOND20.00-",
            words.ToArray()));

        Assert.True(result.IsSuccess);
        var invalid = Assert.Single(result.Rows);
        Assert.Equal(ImportedRowClassification.Invalid, invalid.Classification);
        Assert.Contains("unsupported_transaction_row", invalid.Errors);
    }

    [Fact]
    public void Summary_headers_page_markers_balances_disclosures_and_no_checks_create_no_rows()
    {
        var result = new SunflowerStatementParser().Parse(Result(
            "SUNFLOWER BANK ADJACENT HEADER\nSTATEMENT DATE: 02/28/26\nDays in Statement Period: 28\nPAGE 1 OF 1Daily Balance Summary\n02/01 100.00\n" +
            "Account Summary\nTotal Synthetic Debits 10.00\nElectronic Transactions\nPosted Description Amount\n" +
            "Checks Paid Electronically\nPosted Description Amount\n--- No Checks Paid Electronically in this statement cycle. ---\n" +
            "Checks Paid\nCheck Number Date Amount Check Number Date Amount\nNo Checks Paid in this statement cycle.\n" +
            "SYNTHETIC STATEMENT FOOTER\n" +
            "Important Account Information\nSynthetic disclosure"));

        Assert.True(result.IsSuccess);
        Assert.Empty(result.Rows);
    }

    [Fact]
    public void Actual_check_rows_fail_closed_without_inventing_check_grammar()
    {
        var result = new SunflowerStatementParser().Parse(Result(
            "SUNFLOWER BANK\nSTATEMENT DATE: 02/28/26\nDays in Statement Period: 28\nElectronic Transactions\n" +
            "Posted Description Amount\nChecks Paid\nCheck Number Date Amount Check Number Date Amount\n1001 02/01/26 10.00-"));

        Assert.Equal("unsupported_statement_format", result.Failure?.Code);
        Assert.Empty(result.Rows);
    }

    [Fact]
    public void No_check_decoration_is_bounded_to_the_evidenced_shape()
    {
        var result = new SunflowerStatementParser().Parse(Result(
            "SUNFLOWER HEADER\nSTATEMENT DATE: 02/28/26\nDays in Statement Period: 28\nElectronic Transactions\n" +
            "Posted Description Amount\nChecks Paid\n---- No Checks Paid in this statement cycle. ----"));

        Assert.Equal("unsupported_statement_format", result.Failure?.Code);
    }

    [Fact]
    public void Candidate_row_limit_accepts_1000_and_rejects_1001_without_partial_rows()
    {
        Assert.Equal(1000, ParseGeneratedRows(1000).Rows.Count);

        var exceeded = ParseGeneratedRows(1001);
        Assert.Equal("candidate_row_limit_exceeded", exceeded.Failure?.Code);
        Assert.Empty(exceeded.Rows);
    }

    [Fact]
    public async Task Generated_boundary_pdfs_flow_through_extractor_before_row_limit_enforcement()
    {
        var extractor = new ContainedPdfTextExtractor();
        var acceptedExtraction = await extractor.ExtractAsync(
            SunflowerAdversarialFixtures.CreateCandidateRowPdf(1000));
        var exceededExtraction = await extractor.ExtractAsync(
            SunflowerAdversarialFixtures.CreateCandidateRowPdf(1001));

        Assert.True(acceptedExtraction.IsSuccess);
        Assert.True(exceededExtraction.IsSuccess);
        Assert.Equal(1000, new SunflowerStatementParser().Parse(acceptedExtraction.Result!).Rows.Count);
        var exceeded = new SunflowerStatementParser().Parse(exceededExtraction.Result!);
        Assert.Equal("candidate_row_limit_exceeded", exceeded.Failure?.Code);
        Assert.Empty(exceeded.Rows);
    }

    [Fact]
    public void Invalid_description_and_deposit_debit_marker_do_not_become_candidates()
    {
        var oversized = ParseRows(
            "STATEMENT DATE: 02/28/26",
            $"02/01/26 {new string('X', 501)} 1.00-");
        Assert.Contains("invalid_transaction_description", Assert.Single(oversized.Rows).Errors);

        var depositDebit = new SunflowerStatementParser().Parse(Result(
            "SUNFLOWER BANK\nSTATEMENT DATE: 02/28/26\nDays in Statement Period: 28\n" +
            "Deposits\nPosted Description Amount\n02/01/26 SYNTHETIC CREDIT 1.00-"));
        var invalidDeposit = Assert.Single(depositDebit.Rows);
        Assert.Equal(ImportedRowClassification.Invalid, invalidDeposit.Classification);
        Assert.Contains("unsupported_transaction_direction", invalidDeposit.Errors);
    }

    [Fact]
    public void Page_order_must_match_extractor_contract()
    {
        var result = new SunflowerStatementParser().Parse(new PdfTextExtractionResult(
            0,
            1,
            0,
            new[] { new PdfExtractedPage(2, "SUNFLOWER BANK") }));

        Assert.Equal("unsupported_statement_format", result.Failure?.Code);
    }

    [Fact]
    public void Repeated_identical_statement_dates_are_valid_but_conflicts_fail_closed()
    {
        var repeated = MultiPageResult(
            "SUNFLOWER HEADER\nSTATEMENT DATE: 02/28/26\nDays in Statement Period: 28\nElectronic Transactions\nPosted Description Amount\n02/01/26 FIRST 1.00-",
            "STATEMENT DATE: 02/28/26\nPosted Description Amount\n02/02/26 SECOND 2.00-");
        Assert.Equal(2, new SunflowerStatementParser().Parse(repeated).Rows.Count);

        var conflicting = MultiPageResult(
            "SUNFLOWER HEADER\nSTATEMENT DATE: 02/28/26\nDays in Statement Period: 28\nElectronic Transactions\nPosted Description Amount",
            "STATEMENT DATE: 03/31/26");
        Assert.Equal("unsupported_statement_format", new SunflowerStatementParser().Parse(conflicting).Failure?.Code);
    }

    [Fact]
    public void Blank_interstitial_page_deactivates_rows_without_losing_header_only_continuation()
    {
        var extraction = MultiPageResult(
            "SUNFLOWER HEADER\nSTATEMENT DATE: 02/28/26\nDays in Statement Period: 28\nElectronic Transactions\nPosted Description Amount\n02/01/26 FIRST 1.00-",
            string.Empty,
            "STATEMENT DATE: 02/28/26\nPosted Description Amount\n02/02/26 SECOND 2.00-");

        var parsed = new SunflowerStatementParser().Parse(extraction);
        Assert.Equal(new[] { "FIRST", "SECOND" }, parsed.Rows.Select(row => row.SourceDescription));
        Assert.Equal(3, parsed.Rows[1].Provenance.SourcePageNumber);
    }

    [Theory]
    [InlineData("STATEMENT DATE: 02/30/26", "Days in Statement Period: 28")]
    [InlineData("STATEMENT DATE: 02/28/26", "Days in Statement Period 28")]
    public void Invalid_statement_metadata_fails_closed(string statementDate, string daysMarker)
    {
        var result = Result($"SUNFLOWER HEADER\n{statementDate}\n{daysMarker}\nElectronic Transactions\nPosted Description Amount");
        Assert.Equal("unsupported_statement_format", new SunflowerStatementParser().Parse(result).Failure?.Code);
    }

    private static SunflowerStatementParseResult ParseRows(string statementDate, params string[] rows) =>
        new SunflowerStatementParser().Parse(Result(string.Join(
            '\n',
            new[] { "SUNFLOWER BANK", statementDate, "Days in Statement Period: 28", "Electronic Transactions", "Posted Description Amount" }
                .Concat(rows))));

    private static PdfTextExtractionResult PositionalResult(
        string compactRows,
        params PdfExtractedWord[] words)
    {
        var text = "SUNFLOWER BANK\nSTATEMENT DATE: 02/28/26\nDays in Statement Period: 28\n" +
                   "Electronic Transactions\nPosted Description Amount\n" + compactRows;
        return new PdfTextExtractionResult(
            0,
            1,
            text.Length,
            new[] { new PdfExtractedPage(1, text, words) });
    }

    private static PdfTextExtractionResult CompactHeaderResult(
        string textSuffix = "",
        PdfExtractedWord[]? words = null)
    {
        var text = "SYNTHETIC HEADER\nSTATEMENT DATE: 02/28/26\nDays in Statement Period: 28\n" +
                   "Electronic Transactions\nXPostedDescriptionAmount02/01/26 SYNTHETIC PURCHASE 10.00-" +
                   textSuffix;
        return new PdfTextExtractionResult(
            0,
            1,
            text.Length,
            new[] { new PdfExtractedPage(1, text, words ?? CompactHeaderWords()) });
    }

    private static PdfExtractedWord[] CompactHeaderWords() =>
    [
        PositionalWord(1, "Electronic", .08, .18, .85),
        PositionalWord(2, "Transactions", .19, .32, .85),
        PositionalWord(3, "Posted", .08, .16, .75),
        PositionalWord(4, "Description", .25, .40, .75),
        PositionalWord(5, "Amount", .85, .93, .75),
        PositionalWord(6, "02/01/26", .08, .16, .65),
        PositionalWord(7, "SYNTHETIC", .25, .36, .65),
        PositionalWord(8, "PURCHASE", .37, .49, .65),
        PositionalWord(9, "10.00-", .86, .93, .65)
    ];

    private static PdfExtractedWord PositionalWord(
        int ordinal,
        string text,
        double left,
        double right,
        double baseline,
        PdfWordOrientation orientation = PdfWordOrientation.Horizontal) =>
        new(ordinal, text, left, baseline - .01, right, baseline + .01, baseline, orientation);

    private static SunflowerStatementParseResult ParseGeneratedRows(int count)
    {
        var rows = Enumerable.Range(1, count)
            .Select(index => $"02/{((index - 1) % 28) + 1:D2}/26 SYNTHETIC ROW {index:D4} 10.00-");
        return ParseRows("STATEMENT DATE: 02/28/26", rows.ToArray());
    }

    private static PdfTextExtractionResult Result(string text) =>
        new(0, 1, text.Length, new[] { new PdfExtractedPage(1, text) });

    private static PdfTextExtractionResult MultiPageResult(params string[] pages) =>
        new(
            0,
            pages.Length,
            pages.Sum(page => page.Length),
            pages.Select((page, index) => new PdfExtractedPage(index + 1, page)).ToArray());
}
