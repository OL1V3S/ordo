import Foundation

/// Strict decoding of the statement import responses. A malformed preview is never shown.
/// Amounts are JSON numbers read as `Decimal`, never `Double`. Unknown keys are ignored; server
/// messages and the document text are never read beyond the fields used.
enum ImportValidation {
    enum ParseError: Error, Equatable { case malformed }

    static let maximumRows = 1000

    private static func guid(_ text: String) throws -> String {
        guard let value = UUID(uuidString: text) else { throw ParseError.malformed }
        return value.uuidString.lowercased()
    }

    private static func money(_ number: Decimal?) throws -> Money? {
        guard let number else { return nil }
        var scaled = number * 100
        var rounded = Decimal()
        NSDecimalRound(&rounded, &scaled, 0, .plain)
        guard number.isFinite, rounded == scaled, rounded >= 0, rounded <= Decimal(Money.maximumCents),
              let money = Money.fromCents(NSDecimalNumber(decimal: rounded).int64Value) else { throw ParseError.malformed }
        return money
    }

    private static func date(_ text: String?) -> Date? {
        guard let text else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let value = withFraction.date(from: text) { return value }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let value = plain.date(from: text) { return value }
        // The server may omit the zone (UTC).
        return withFraction.date(from: text + "Z") ?? plain.date(from: text + "Z")
    }

    private struct RawRow: Decodable {
        let rowId: String
        let sourceRowOrdinal: Int
        let postedDate: String?
        let amount: Decimal?
        let direction: String
        let sourceDescription: String?
        let classification: String
        let isEligible: Bool
        let isInflowEligible: Bool
        let errors: [String]?
        let warnings: [String]?
        let isPossibleDuplicate: Bool
        let duplicateExpenseIds: [Int]?
        let isPossibleInflowDuplicate: Bool
        let editableExpenseDescription: String?
        let category: String?
        let selectedForImport: Bool
        let selectedForInflow: Bool

        func row() throws -> ImportRow {
            let posted: CalendarDate?
            if let postedDate {
                guard let parsed = CalendarDate(postedDate) else { throw ParseError.malformed }
                posted = parsed
            } else {
                posted = nil
            }
            return ImportRow(
                rowId: try ImportValidation.guid(rowId), ordinal: sourceRowOrdinal, postedDate: posted,
                amount: try ImportValidation.money(amount), direction: direction,
                sourceDescription: sourceDescription ?? "", classification: classification,
                isEligible: isEligible, isInflowEligible: isInflowEligible, errors: errors ?? [], warnings: warnings ?? [],
                isPossibleDuplicate: isPossibleDuplicate, duplicateExpenseIds: duplicateExpenseIds ?? [],
                isPossibleInflowDuplicate: isPossibleInflowDuplicate,
                editableExpenseDescription: editableExpenseDescription, category: category,
                selectedForImport: selectedForImport, selectedForInflow: selectedForInflow)
        }
    }

    private struct RawPreview: Decodable {
        let batchId: String
        let expiresAt: String?
        let rows: [RawRow]

        func preview() throws -> ImportPreview {
            guard rows.count <= ImportValidation.maximumRows else { throw ParseError.malformed }
            let parsed = try rows.map { try $0.row() }
            guard Set(parsed.map(\.rowId)).count == parsed.count else { throw ParseError.malformed }
            return ImportPreview(batchId: try ImportValidation.guid(batchId), expiresAt: ImportValidation.date(expiresAt), rows: parsed)
        }
    }

    private struct RawSelection: Decodable { let preview: RawPreview }

    private struct RawConfirmation: Decodable {
        let batchId: String
        let status: String
        let confirmedAt: String?
        let importedExpenseCount: Int
        let importedInflowCount: Int
    }

    static func parsePreview(_ data: Data) throws -> ImportPreview {
        do { return try JSONDecoder().decode(RawPreview.self, from: data).preview() } catch { throw ParseError.malformed }
    }

    static func parseRow(_ data: Data) throws -> ImportRow {
        do { return try JSONDecoder().decode(RawRow.self, from: data).row() } catch { throw ParseError.malformed }
    }

    static func parseSelection(_ data: Data) throws -> ImportPreview {
        do { return try JSONDecoder().decode(RawSelection.self, from: data).preview.preview() } catch { throw ParseError.malformed }
    }

    static func parseConfirmation(_ data: Data) throws -> ImportConfirmation {
        do {
            let raw = try JSONDecoder().decode(RawConfirmation.self, from: data)
            guard raw.status == "confirmed" || raw.status == "already_confirmed",
                  raw.importedExpenseCount >= 0, raw.importedInflowCount >= 0 else { throw ParseError.malformed }
            return ImportConfirmation(batchId: try guid(raw.batchId), alreadyConfirmed: raw.status == "already_confirmed",
                                      confirmedAt: date(raw.confirmedAt), expenseCount: raw.importedExpenseCount,
                                      depositCount: raw.importedInflowCount)
        } catch { throw ParseError.malformed }
    }
}

/// The frozen request bodies. Identical arguments always produce identical bytes.
enum ImportRequestBody {
    private struct Row: Encodable {
        let editableExpenseDescription: String?
        let category: String?
        let selectedForImport: Bool
        let selectedForInflow: Bool
        enum Keys: String, CodingKey { case editableExpenseDescription, category, selectedForImport, selectedForInflow }
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: Keys.self)
            try c.encode(editableExpenseDescription, forKey: .editableExpenseDescription)
            try c.encode(category, forKey: .category)
            try c.encode(selectedForImport, forKey: .selectedForImport)
            try c.encode(selectedForInflow, forKey: .selectedForInflow)
        }
    }

    private struct Selection: Encodable {
        let action: String
        let rowIds: [String]
    }

    private static func encode<T: Encodable>(_ value: T) -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return (try? encoder.encode(value)) ?? Data()
    }

    static func row(description: String?, category: String?, selectedForImport: Bool, selectedForInflow: Bool) -> Data {
        encode(Row(editableExpenseDescription: description, category: category,
                   selectedForImport: selectedForImport, selectedForInflow: selectedForInflow))
    }

    static func selection(action: String, rowIds: [String]) -> Data { encode(Selection(action: action, rowIds: rowIds)) }
}
