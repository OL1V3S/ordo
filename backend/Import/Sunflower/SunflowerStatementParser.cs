using System.Globalization;
using System.Text.RegularExpressions;

namespace BudgetPlanner.Import.Sunflower;

public sealed partial class SunflowerStatementParser : ISunflowerStatementParser
{
    public const string SourceType = ImportStatementSources.SunflowerPdf;
    public const string RuleVersion = "sunflower-v3";
    public const int MaximumCandidateRows = 1_000;

    private const string DepositsSection = "deposits";
    private const string ElectronicTransactionsSection = "electronic_transactions";

    public SunflowerStatementParseResult Parse(
        PdfTextExtractionResult extraction,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(extraction);
        cancellationToken.ThrowIfCancellationRequested();

        if (!HasOrderedPages(extraction.Pages))
        {
            return SunflowerStatementParseResult.Failed(SunflowerStatementParseFailure.UnsupportedFormat);
        }

        var statementDates = extraction.Pages
            .Select(page =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                return page;
            })
            .SelectMany(page => StatementDateRegex().Matches(page.Text).Select(match => match.Groups["date"].Value))
            .Select(value => TryParseStatementDate(value, out var date) ? date : (DateOnly?)null)
            .Where(date => date.HasValue)
            .Select(date => date!.Value)
            .Distinct()
            .ToList();

        var headerFamilies = extraction.Pages.ToDictionary(page => page.PageNumber, ClassifyHeaderFamily);
        var hasDaysMarker = extraction.Pages.Any(page => DaysInStatementPeriodRegex().IsMatch(page.Text));
        var hasTransactionHeading = extraction.Pages
            .SelectMany(page => SplitLines(page, headerFamilies[page.PageNumber]))
            .Any(line => IsTransactionHeading(line.Trim()));
        var hasColumnHeader = headerFamilies.Values.Any(family => family != HeaderFamily.Unsupported);
        if (statementDates.Count != 1 || !hasDaysMarker || !hasTransactionHeading || !hasColumnHeader)
        {
            return SunflowerStatementParseResult.Failed(SunflowerStatementParseFailure.UnsupportedFormat);
        }

        var statementDate = statementDates[0];
        var rows = new List<NormalizedImportedRow>();
        string? rememberedSection = null;

        foreach (var page in extraction.Pages)
        {
            cancellationToken.ThrowIfCancellationRequested();
            string? section = null;
            string? pendingSection = null;
            PendingRow? pendingRow = null;
            var inUnsupportedCheckSection = false;
            var positionalRows = TryGetPositionalElectronicRows(page, statementDate);
            var positionalRowsConsumed = false;

            void FlushPending()
            {
                if (pendingRow is null)
                {
                    return;
                }

                rows.Add(ParseRow(pendingRow, statementDate, rows.Count + 1));
                pendingRow = null;
            }

            foreach (var sourceLine in SplitLines(page, headerFamilies[page.PageNumber])
                         .Select(line => new SourceLine(page.PageNumber, line)))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var trimmed = sourceLine.Text.Trim();
                if (trimmed.Length == 0)
                {
                    continue;
                }

                if (pendingRow is not null && char.IsWhiteSpace(sourceLine.Text[0]) && !IsStructuralLine(trimmed))
                {
                    pendingRow.DescriptionContinuation.Add(trimmed);
                    continue;
                }

                FlushPending();

                if (trimmed.Equals("Checks Paid", StringComparison.OrdinalIgnoreCase)
                    || trimmed.Equals("Checks Paid Electronically", StringComparison.OrdinalIgnoreCase))
                {
                    section = null;
                    pendingSection = null;
                    rememberedSection = null;
                    inUnsupportedCheckSection = true;
                    continue;
                }

                if (inUnsupportedCheckSection)
                {
                    if (IsNoChecksMessage(trimmed))
                    {
                        inUnsupportedCheckSection = false;
                        continue;
                    }

                    if (IsKnownCheckHeader(trimmed) || IsKnownNonRow(trimmed))
                    {
                        continue;
                    }

                    if (IsNonTransactionBoundary(trimmed))
                    {
                        inUnsupportedCheckSection = false;
                    }
                    else
                    {
                        return SunflowerStatementParseResult.Failed(
                            SunflowerStatementParseFailure.UnsupportedFormat);
                    }
                }

                if (TryGetTransactionHeading(trimmed, out var headingSection))
                {
                    pendingSection = headingSection;
                    rememberedSection = headingSection;
                    continue;
                }

                if (PostedDescriptionAmountRegex().IsMatch(trimmed))
                {
                    section = pendingSection
                              ?? (rememberedSection == ElectronicTransactionsSection ? rememberedSection : null);
                    continue;
                }

                if (IsNonTransactionBoundary(trimmed))
                {
                    section = null;
                    pendingSection = null;
                    if (IsTerminalBoundary(trimmed))
                    {
                        rememberedSection = null;
                    }
                    continue;
                }

                if (section is null || IsKnownNonRow(trimmed))
                {
                    continue;
                }

                if (LooksLikeTransactionStart(trimmed))
                {
                    if (!positionalRowsConsumed
                        && section == ElectronicTransactionsSection
                        && !sourceLine.Text.Any(char.IsWhiteSpace)
                        && !TransactionRowRegex().IsMatch(trimmed)
                        && positionalRows.Count > 0)
                    {
                        if (rows.Count + positionalRows.Count > MaximumCandidateRows)
                        {
                            return SunflowerStatementParseResult.Failed(
                                SunflowerStatementParseFailure.CandidateRowLimitExceeded);
                        }

                        foreach (var positionalRow in positionalRows)
                        {
                            rows.Add(ParseRow(
                                new PendingRow(page.PageNumber, section, positionalRow),
                                statementDate,
                                rows.Count + 1));
                        }
                        positionalRowsConsumed = true;
                        continue;
                    }

                    if (rows.Count >= MaximumCandidateRows)
                    {
                        return SunflowerStatementParseResult.Failed(
                            SunflowerStatementParseFailure.CandidateRowLimitExceeded);
                    }

                    pendingRow = new PendingRow(sourceLine.PageNumber, section, trimmed);
                    continue;
                }

                if (!IsKnownSectionContent(trimmed))
                {
                    if (rows.Count >= MaximumCandidateRows)
                    {
                        return SunflowerStatementParseResult.Failed(
                            SunflowerStatementParseFailure.CandidateRowLimitExceeded);
                    }

                    rows.Add(CreateInvalidRow(
                        sourceLine.PageNumber,
                        section,
                        rows.Count + 1,
                        "unsupported_transaction_row"));
                }
            }

            FlushPending();
        }
        return SunflowerStatementParseResult.Success(rows);
    }

    private static IReadOnlyList<string> TryGetPositionalElectronicRows(
        PdfExtractedPage page,
        DateOnly statementDate)
    {
        if (page.Words.Count == 0
            || page.Words.Any(word => word.Orientation != PdfWordOrientation.Horizontal
                || word.Ordinal <= 0
                || string.IsNullOrEmpty(word.Text)
                || !HasValidBox(word)))
        {
            return Array.Empty<string>();
        }

        var orderedWords = page.Words.OrderBy(word => word.Ordinal).ToList();
        if (!orderedWords.Select(word => word.Ordinal).SequenceEqual(Enumerable.Range(1, orderedWords.Count)))
        {
            return Array.Empty<string>();
        }

        var medianHeight = Median(orderedWords.Select(word => word.Top - word.Bottom));
        var characterWidths = orderedWords
            .Where(word => word.Text.Length > 0)
            .Select(word => (word.Right - word.Left) / word.Text.Length)
            .Where(width => width > 0)
            .ToList();
        var medianCharacterWidth = Median(characterWidths);
        if (medianHeight <= 0 || medianCharacterWidth <= 0)
        {
            return Array.Empty<string>();
        }

        var baselineTolerance = medianHeight * 0.45;
        var lines = new List<PositionalLine>();
        foreach (var word in orderedWords.OrderByDescending(word => word.Baseline).ThenBy(word => word.Left))
        {
            var line = lines
                .Where(candidate => Math.Abs(candidate.Baseline - word.Baseline) <= baselineTolerance)
                .OrderBy(candidate => Math.Abs(candidate.Baseline - word.Baseline))
                .FirstOrDefault();
            if (line is null)
            {
                lines.Add(new PositionalLine(word.Baseline, new List<PdfExtractedWord> { word }));
            }
            else
            {
                line.Words.Add(word);
            }
        }

        lines = lines.OrderByDescending(line => line.Baseline).ToList();
        foreach (var line in lines)
        {
            line.Words.Sort((left, right) => left.Left.CompareTo(right.Left));
        }

        var electronicHeadingIndex = lines.FindIndex(line =>
            JoinedToken(line).Equals("ElectronicTransactions", StringComparison.OrdinalIgnoreCase));
        var headerIndex = lines.FindIndex(
            Math.Max(0, electronicHeadingIndex + 1),
            line => JoinedToken(line).TrimStart('-')
                .Equals("PostedDescriptionAmount", StringComparison.OrdinalIgnoreCase));
        if (headerIndex < 0 || (electronicHeadingIndex >= 0 && headerIndex <= electronicHeadingIndex))
        {
            return Array.Empty<string>();
        }

        var headerLine = lines[headerIndex];
        var postedHeaders = headerLine.Words
            .Where(word => word.Text.Equals("Posted", StringComparison.OrdinalIgnoreCase))
            .ToList();
        var descriptionHeaders = headerLine.Words
            .Where(word => word.Text.Equals("Description", StringComparison.OrdinalIgnoreCase))
            .ToList();
        var amountHeaders = headerLine.Words
            .Where(word => word.Text.Equals("Amount", StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (postedHeaders.Count != 1 || descriptionHeaders.Count != 1 || amountHeaders.Count != 1
            || postedHeaders[0].Right > descriptionHeaders[0].Left
            || descriptionHeaders[0].Right > amountHeaders[0].Left)
        {
            return Array.Empty<string>();
        }

        var candidates = new List<PositionalCandidate>();
        var sawCandidate = false;
        for (var lineIndex = headerIndex + 1; lineIndex < lines.Count; lineIndex++)
        {
            var line = lines[lineIndex];
            var joined = JoinedToken(line);
            if (IsLayoutTerminal(joined))
            {
                break;
            }

            var dateWords = line.Words.Where(word => TransactionDateRegex().IsMatch(word.Text)).ToList();
            var amountCandidates = new List<PositionalAmount>();
            for (var wordIndex = 0; wordIndex < line.Words.Count; wordIndex++)
            {
                var word = line.Words[wordIndex];
                if (word.Text.EndsWith("-", StringComparison.Ordinal)
                    && TryParseAmount(word.Text[..^1], out _))
                {
                    amountCandidates.Add(new PositionalAmount(word, null, word.Text));
                    continue;
                }

                if (TryParseAmount(word.Text, out _)
                    && wordIndex + 1 < line.Words.Count
                    && line.Words[wordIndex + 1].Text == "-"
                    && line.Words[wordIndex + 1].Left >= word.Right
                    && line.Words[wordIndex + 1].Left - word.Right <= medianCharacterWidth * 2)
                {
                    amountCandidates.Add(new PositionalAmount(
                        word,
                        line.Words[wordIndex + 1],
                        $"{word.Text}-"));
                }
            }

            if (dateWords.Count == 0 && amountCandidates.Count == 0)
            {
                if (sawCandidate && !IsKnownLayoutContent(joined))
                {
                    return Array.Empty<string>();
                }
                continue;
            }

            sawCandidate = true;
            if (dateWords.Count != 1 || amountCandidates.Count != 1)
            {
                return Array.Empty<string>();
            }

            var dateWord = dateWords[0];
            var amount = amountCandidates[0];
            var amountWord = amount.Word;
            if (!TryResolveDate(dateWord.Text, statementDate, out _)
                || dateWord.Right >= amountWord.Left)
            {
                return Array.Empty<string>();
            }

            var descriptionWords = line.Words
                .Where(word => word.Left >= dateWord.Right && word.Right <= amountWord.Left)
                .ToList();
            if (descriptionWords.Count == 0
                || line.Words.Any(word => word != dateWord
                    && word != amountWord
                    && word != amount.Marker
                    && !descriptionWords.Contains(word)))
            {
                return Array.Empty<string>();
            }

            var lastDescription = descriptionWords[^1];
            if (lastDescription.Right >= amountWord.Left
                || line.Words.Max(word => word.Baseline) - line.Words.Min(word => word.Baseline) > baselineTolerance)
            {
                return Array.Empty<string>();
            }

            candidates.Add(new PositionalCandidate(
                dateWord,
                descriptionWords,
                amount,
                amountWord.Left - lastDescription.Right));
        }

        if (candidates.Count == 0)
        {
            return Array.Empty<string>();
        }

        var dateColumn = Median(candidates.Select(candidate => candidate.Date.Left));
        var amountColumn = Median(candidates.Select(candidate => candidate.Amount.Right));
        var columnTolerance = medianCharacterWidth * 2;
        var headerTolerance = medianCharacterWidth * 4;
        if (candidates.Any(candidate =>
                Math.Abs(candidate.Date.Left - dateColumn) > columnTolerance
                || Math.Abs(candidate.Amount.Right - amountColumn) > columnTolerance
                || candidate.DescriptionAmountGap < medianCharacterWidth)
            || Math.Abs(postedHeaders[0].Left - dateColumn) > headerTolerance
            || Math.Abs(amountHeaders[0].Right - amountColumn) > headerTolerance)
        {
            return Array.Empty<string>();
        }

        return candidates.Select(candidate =>
            $"{candidate.Date.Text} {string.Join(' ', candidate.Description.Select(word => word.Text))} {candidate.Amount.CanonicalText}")
            .ToList();
    }

    private static bool HasValidBox(PdfExtractedWord word) =>
        double.IsFinite(word.Left)
        && double.IsFinite(word.Bottom)
        && double.IsFinite(word.Right)
        && double.IsFinite(word.Top)
        && double.IsFinite(word.Baseline)
        && word.Left >= -0.05
        && word.Right <= 1.05
        && word.Bottom >= -0.05
        && word.Top <= 1.05
        && word.Baseline >= -0.05
        && word.Baseline <= 1.05
        && word.Left <= word.Right
        && word.Bottom <= word.Top;

    private static string JoinedToken(PositionalLine line) =>
        string.Concat(line.Words.Select(word => word.Text));

    private static bool IsLayoutTerminal(string joined) =>
        joined.StartsWith("Page", StringComparison.OrdinalIgnoreCase)
        || joined.Equals("DailyBalanceSummary", StringComparison.OrdinalIgnoreCase)
        || joined.Equals("ImportantAccountInformation", StringComparison.OrdinalIgnoreCase)
        || joined.Equals("AccountSummary", StringComparison.OrdinalIgnoreCase)
        || joined.Equals("TransactionSummary", StringComparison.OrdinalIgnoreCase)
        || joined.StartsWith("ChecksPaid", StringComparison.OrdinalIgnoreCase);

    private static bool IsKnownLayoutContent(string joined) =>
        joined.StartsWith("Total", StringComparison.OrdinalIgnoreCase)
        || StatementDateRegex().IsMatch(joined)
        || DaysInStatementPeriodRegex().IsMatch(joined);

    private static double Median(IEnumerable<double> values)
    {
        var ordered = values.Where(double.IsFinite).OrderBy(value => value).ToList();
        if (ordered.Count == 0)
        {
            return 0;
        }
        var middle = ordered.Count / 2;
        return ordered.Count % 2 == 0
            ? (ordered[middle - 1] + ordered[middle]) / 2
            : ordered[middle];
    }

    private static NormalizedImportedRow ParseRow(PendingRow pending, DateOnly statementDate, int ordinal)
    {
        var match = TransactionRowRegex().Match(pending.SourceLine);
        if (!match.Success)
        {
            return CreateInvalidRow(pending.PageNumber, pending.Section, ordinal, "unsupported_transaction_row");
        }

        var description = string.Join(
            " ",
            new[] { match.Groups["description"].Value.Trim() }
                .Concat(pending.DescriptionContinuation)
                .Where(value => value.Length > 0));
        var errors = new List<string>();

        DateOnly? postedDate = TryResolveDate(match.Groups["date"].Value, statementDate, out var date)
            ? date
            : null;
        if (postedDate is null)
        {
            errors.Add("invalid_transaction_date");
        }

        decimal? amount = TryParseAmount(match.Groups["amount"].Value, out var parsedAmount)
            ? parsedAmount
            : null;
        if (amount is null)
        {
            errors.Add("invalid_transaction_amount");
        }

        if (description.Length == 0 || description.Length > 500)
        {
            errors.Add("invalid_transaction_description");
        }

        var hasDebitMarker = match.Groups["debit"].Success;
        var direction = ImportedTransactionDirection.Unresolved;
        var classification = ImportedRowClassification.NeedsReview;

        if (errors.Count > 0)
        {
            classification = ImportedRowClassification.Invalid;
        }
        else if (pending.Section == DepositsSection && !hasDebitMarker)
        {
            direction = ImportedTransactionDirection.Credit;
            classification = ImportedRowClassification.NonExpense;
        }
        else if (pending.Section == ElectronicTransactionsSection && hasDebitMarker)
        {
            direction = ImportedTransactionDirection.Debit;
            classification = ImportedRowClassification.ExpenseCandidate;
        }
        else if (pending.Section == DepositsSection && hasDebitMarker)
        {
            errors.Add("unsupported_transaction_direction");
            classification = ImportedRowClassification.Invalid;
        }

        var eligible = classification == ImportedRowClassification.ExpenseCandidate;
        return new NormalizedImportedRow(
            ordinal,
            postedDate,
            amount,
            direction,
            description,
            pending.Section,
            classification,
            eligible ? description : null,
            eligible ? "uncategorized" : null,
            errors,
            Array.Empty<string>(),
            new ImportRowProvenance(SourceType, RuleVersion, pending.PageNumber, pending.Section, ordinal));
    }

    private static NormalizedImportedRow CreateInvalidRow(int pageNumber, string section, int ordinal, string error) =>
        new(
            ordinal,
            null,
            null,
            ImportedTransactionDirection.Unresolved,
            string.Empty,
            section,
            ImportedRowClassification.Invalid,
            null,
            null,
            new[] { error },
            Array.Empty<string>(),
            new ImportRowProvenance(SourceType, RuleVersion, pageNumber, section, ordinal));

    private static bool TryResolveDate(string value, DateOnly statementDate, out DateOnly date)
    {
        date = default;
        var match = TransactionDateRegex().Match(value);
        if (!match.Success)
        {
            return false;
        }

        var month = int.Parse(match.Groups["month"].Value, CultureInfo.InvariantCulture);
        var day = int.Parse(match.Groups["day"].Value, CultureInfo.InvariantCulture);
        var shortYear = int.Parse(match.Groups["year"].Value, CultureInfo.InvariantCulture);
        var year = new[] { statementDate.Year, statementDate.Year - 1 }
            .Where(candidate => candidate % 100 == shortYear)
            .Cast<int?>()
            .SingleOrDefault();

        if (year is null)
        {
            return false;
        }

        return DateOnly.TryParseExact(
            $"{year:D4}-{month:D2}-{day:D2}",
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out date);
    }

    private static bool TryParseAmount(string value, out decimal amount)
    {
        amount = default;
        if (!AmountRegex().IsMatch(value))
        {
            return false;
        }

        return decimal.TryParse(
                   value.Replace(",", string.Empty, StringComparison.Ordinal),
                   NumberStyles.AllowDecimalPoint,
                   CultureInfo.InvariantCulture,
                   out amount)
               && amount > 0;
    }

    private static bool TryParseStatementDate(string value, out DateOnly date)
    {
        date = default;
        var match = TransactionDateRegex().Match(value);
        if (!match.Success)
        {
            return false;
        }

        var month = int.Parse(match.Groups["month"].Value, CultureInfo.InvariantCulture);
        var day = int.Parse(match.Groups["day"].Value, CultureInfo.InvariantCulture);
        var year = 2000 + int.Parse(match.Groups["year"].Value, CultureInfo.InvariantCulture);
        return DateOnly.TryParseExact(
            $"{year:D4}-{month:D2}-{day:D2}",
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out date);
    }

    private static bool HasOrderedPages(IReadOnlyList<PdfExtractedPage> pages) =>
        pages.Count > 0
        && pages.Select(page => page.PageNumber).SequenceEqual(Enumerable.Range(1, pages.Count));

    private static HeaderFamily ClassifyHeaderFamily(PdfExtractedPage page)
    {
        if (PostedDescriptionAmountRegex().IsMatch(page.Text))
        {
            return HeaderFamily.Canonical;
        }

        var compactMatches = CompactPostedDescriptionAmountRegex().Matches(page.Text);
        return compactMatches.Count == 1 && HasExactCompactHeaderGeometry(page)
            ? HeaderFamily.CompactGeometry
            : HeaderFamily.Unsupported;
    }

    private static bool HasExactCompactHeaderGeometry(PdfExtractedPage page)
    {
        if (page.Words.Count == 0
            || page.Words.Any(word => word.Orientation != PdfWordOrientation.Horizontal
                || word.Ordinal <= 0
                || string.IsNullOrEmpty(word.Text)
                || !HasValidBox(word)))
        {
            return false;
        }

        var orderedWords = page.Words.OrderBy(word => word.Ordinal).ToList();
        if (!orderedWords.Select(word => word.Ordinal).SequenceEqual(Enumerable.Range(1, orderedWords.Count)))
        {
            return false;
        }

        var medianHeight = Median(orderedWords.Select(word => word.Top - word.Bottom));
        if (medianHeight <= 0)
        {
            return false;
        }

        var baselineTolerance = medianHeight * 0.45;
        var lines = new List<PositionalLine>();
        foreach (var word in orderedWords.OrderByDescending(word => word.Baseline).ThenBy(word => word.Left))
        {
            var line = lines
                .Where(candidate => Math.Abs(candidate.Baseline - word.Baseline) <= baselineTolerance)
                .OrderBy(candidate => Math.Abs(candidate.Baseline - word.Baseline))
                .FirstOrDefault();
            if (line is null)
            {
                lines.Add(new PositionalLine(word.Baseline, new List<PdfExtractedWord> { word }));
            }
            else
            {
                line.Words.Add(word);
            }
        }

        lines = lines.OrderByDescending(line => line.Baseline).ToList();
        foreach (var line in lines)
        {
            line.Words.Sort((left, right) => left.Left.CompareTo(right.Left));
        }

        var headingIndex = lines.FindIndex(line =>
            line.Words.Count == 2
            && line.Words[0].Text.Equals("Electronic", StringComparison.OrdinalIgnoreCase)
            && line.Words[1].Text.Equals("Transactions", StringComparison.OrdinalIgnoreCase));
        if (headingIndex < 0)
        {
            return false;
        }

        var candidates = lines
            .Skip(headingIndex + 1)
            .Where(line => line.Words.Count == 3
                && line.Words[0].Text.Equals("Posted", StringComparison.OrdinalIgnoreCase)
                && line.Words[1].Text.Equals("Description", StringComparison.OrdinalIgnoreCase)
                && line.Words[2].Text.Equals("Amount", StringComparison.OrdinalIgnoreCase)
                && line.Words[0].Right < line.Words[1].Left
                && line.Words[1].Right < line.Words[2].Left
                && line.Words.Max(word => word.Baseline) - line.Words.Min(word => word.Baseline)
                    <= baselineTolerance)
            .ToList();
        return candidates.Count == 1;
    }

    private static IEnumerable<string> SplitLines(PdfExtractedPage page, HeaderFamily headerFamily)
    {
        var text = page.Text.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');
        if (headerFamily == HeaderFamily.CompactGeometry)
        {
            text = CompactPostedDescriptionAmountRegex().Replace(
                text,
                match => $"{match.Groups["prefix"].Value}\n{match.Groups["header"].Value}\n");
        }
        var fixedMarkers = new[]
        {
            "Important Account Information",
            "Electronic Transactions",
            "Transaction Summary",
            "Account Summary",
            "Daily Balance Summary",
            "SUNFLOWER BANK",
            "Deposits"
        };

        var markerPattern = string.Join("|", fixedMarkers.Select(Regex.Escape));
        text = Regex.Replace(
            text,
            markerPattern,
            match => $"\n{match.Value}\n",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        text = Regex.Replace(
            text,
            @"(?<!No )Checks Paid Electronically|(?<!No )Checks Paid",
            match => $"\n{match.Value}\n",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        text = StatementDateRegex().Replace(text, match => $"\n{match.Value}\n");
        text = DaysInStatementPeriodRegex().Replace(text, match => $"\n{match.Value}\n");
        text = PostedDescriptionAmountRegex().Replace(text, match => $"\n{match.Value}\n");

        text = Regex.Replace(
            text,
            @"Page\s+\d+\s+of\s+\d+",
            match => $"\n{match.Value}\n",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        text = Regex.Replace(
            text,
            @"(?=\d{2}/\d{2}/\d{2}\s)",
            "\n",
            RegexOptions.CultureInvariant);
        text = NoChecksMessageInTextRegex().Replace(text, match => $"\n{match.Value}\n");

        return text.Split('\n');
    }

    private static bool LooksLikeTransactionStart(string line) =>
        line.Length >= 8 && char.IsAsciiDigit(line[0]) && line[2] == '/' && line[5] == '/';

    private static bool IsTransactionHeading(string line) => TryGetTransactionHeading(line, out _);

    private static bool TryGetTransactionHeading(string line, out string? section)
    {
        section = line switch
        {
            var value when value.Equals("Deposits", StringComparison.OrdinalIgnoreCase) => DepositsSection,
            var value when value.Equals("Electronic Transactions", StringComparison.OrdinalIgnoreCase) => ElectronicTransactionsSection,
            _ => null
        };
        return section is not null;
    }

    private static bool IsNonTransactionBoundary(string line) =>
        line.Equals("Daily Balance Summary", StringComparison.OrdinalIgnoreCase)
        || line.Equals("Important Account Information", StringComparison.OrdinalIgnoreCase)
        || line.Equals("Checks Paid", StringComparison.OrdinalIgnoreCase)
        || line.Equals("Checks Paid Electronically", StringComparison.OrdinalIgnoreCase)
        || line.Equals("Account Summary", StringComparison.OrdinalIgnoreCase)
        || line.Equals("Transaction Summary", StringComparison.OrdinalIgnoreCase);

    private static bool IsTerminalBoundary(string line) =>
        line.Equals("Daily Balance Summary", StringComparison.OrdinalIgnoreCase)
        || line.Equals("Important Account Information", StringComparison.OrdinalIgnoreCase);

    private static bool IsKnownNonRow(string line) =>
        line.StartsWith("Page ", StringComparison.OrdinalIgnoreCase)
        || line.Equals("SUNFLOWER BANK", StringComparison.OrdinalIgnoreCase)
        || StatementDateRegex().IsMatch(line)
        || DaysInStatementPeriodRegex().IsMatch(line);

    private static bool IsNoChecksMessage(string line) => NoChecksMessageRegex().IsMatch(line.Trim());

    private static bool IsKnownCheckHeader(string line) => CheckHeaderRegex().IsMatch(line);

    private static bool IsKnownSectionContent(string line) =>
        line.StartsWith("Total ", StringComparison.OrdinalIgnoreCase);

    private static bool IsStructuralLine(string line) =>
        IsTransactionHeading(line)
        || IsNonTransactionBoundary(line)
        || PostedDescriptionAmountRegex().IsMatch(line);

    private sealed record SourceLine(int PageNumber, string Text);

    private sealed class PendingRow(int pageNumber, string section, string sourceLine)
    {
        public int PageNumber { get; } = pageNumber;
        public string Section { get; } = section;
        public string SourceLine { get; } = sourceLine;
        public List<string> DescriptionContinuation { get; } = new();
    }

    private sealed record PositionalLine(double Baseline, List<PdfExtractedWord> Words);

    private sealed record PositionalCandidate(
        PdfExtractedWord Date,
        IReadOnlyList<PdfExtractedWord> Description,
        PositionalAmount Amount,
        double DescriptionAmountGap);

    private sealed record PositionalAmount(
        PdfExtractedWord Word,
        PdfExtractedWord? Marker,
        string CanonicalText)
    {
        public double Right => Marker?.Right ?? Word.Right;
    }

    [GeneratedRegex(@"(?<![A-Za-z])STATEMENT\s*DATE\s*:\s*(?<date>\d{2}/\d{2}/\d{2})(?![\d/])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex StatementDateRegex();

    [GeneratedRegex(@"(?<![A-Za-z])Days\s*in\s*Statement\s*Period\s*:\s*\d+(?!\d)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex DaysInStatementPeriodRegex();

    [GeneratedRegex(@"(?<![A-Za-z])Posted\s*Description\s*Amount(?![A-Za-z])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex PostedDescriptionAmountRegex();

    [GeneratedRegex(@"(?<prefix>[A-Za-z])(?<header>Posted\s*Description\s*Amount)(?=\d{2}/\d{2}/\d{2})", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex CompactPostedDescriptionAmountRegex();

    [GeneratedRegex(@"^(?:---\s*)?No Checks Paid(?: Electronically)? in this statement cycle\.(?:\s*---)?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex NoChecksMessageRegex();

    [GeneratedRegex(@"(?:---\s*)?No Checks Paid(?: Electronically)? in this statement cycle\.(?:\s*---)?", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex NoChecksMessageInTextRegex();

    [GeneratedRegex(@"^(?:Posted\s*(?:/\s*)?Description\s*(?:/\s*)?Amount|Check Number\s*(?:/\s*)?Date\s*(?:/\s*)?Description\s*(?:/\s*)?Amount|Check Number\s+Date\s+Amount\s+Check Number\s+Date\s+Amount)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex CheckHeaderRegex();

    private enum HeaderFamily
    {
        Unsupported,
        Canonical,
        CompactGeometry
    }

    [GeneratedRegex(@"^(?<date>\d{2}/\d{2}/\d{2})\s+(?<description>.*?)\s+(?<amount>\S+?)(?<debit>-)?$", RegexOptions.CultureInvariant)]
    private static partial Regex TransactionRowRegex();

    [GeneratedRegex(@"^(?<month>\d{2})/(?<day>\d{2})/(?<year>\d{2})$", RegexOptions.CultureInvariant)]
    private static partial Regex TransactionDateRegex();

    [GeneratedRegex(@"^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)\.\d{2}$", RegexOptions.CultureInvariant)]
    private static partial Regex AmountRegex();
}
