import Foundation

/// One statement row as the server last reported it. Descriptions and amounts are never logged.
struct ImportRow: Equatable, Sendable, Identifiable {
    /// Lowercase GUID.
    let rowId: String
    let ordinal: Int
    let postedDate: CalendarDate?
    /// nil when the statement row has no amount.
    let amount: Money?
    let direction: String
    let sourceDescription: String
    let classification: String
    let isEligible: Bool
    let isInflowEligible: Bool
    let errors: [String]
    let warnings: [String]
    let isPossibleDuplicate: Bool
    let duplicateExpenseIds: [Int]
    let isPossibleInflowDuplicate: Bool
    let editableExpenseDescription: String?
    let category: String?
    let selectedForImport: Bool
    let selectedForInflow: Bool

    var id: String { rowId }
}

struct ImportPreview: Equatable, Sendable {
    /// Lowercase GUID.
    let batchId: String
    let expiresAt: Date?
    let rows: [ImportRow]
}

struct ImportConfirmation: Equatable, Sendable {
    let batchId: String
    let alreadyConfirmed: Bool
    let confirmedAt: Date?
    let expenseCount: Int
    let depositCount: Int
}

/// A complete multipart body together with its boundary.
struct ImportUploadBody: Sendable {
    let boundary: String
    let data: Data
}

/// The filter choices of the review list.
enum ImportFilter: String, CaseIterable, Sendable {
    case all, attention, duplicates, deposits, selected
}
