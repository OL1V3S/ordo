import Foundation
@testable import Ordo

enum ImportFixtures {
    static let batch = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    static let row1 = "11111111-1111-4111-8111-111111111111"
    static let row2 = "22222222-2222-4222-8222-222222222222"
    static let row3 = "33333333-3333-4333-8333-333333333333"

    static func rowJSON(_ id: String, amount: String? = "12.50", classification: String = "expense_candidate",
                        eligible: Bool = true, inflow: Bool = false, selected: Bool = false, selectedInflow: Bool = false,
                        direction: String = "debit", date: String? = "2026-10-01", duplicate: Bool = false,
                        description: String = "Synthetic Store", category: String? = "uncategorized") -> String {
        let amountText = amount ?? "null"
        let dateText = date.map { "\"\($0)\"" } ?? "null"
        let categoryText = category.map { "\"\($0)\"" } ?? "null"
        return """
        {"rowId":"\(id)","sourceRowOrdinal":1,"postedDate":\(dateText),"amount":\(amountText),"direction":"\(direction)",
        "sourceDescription":"\(description)","sourceSection":"electronic_transactions","classification":"\(classification)",
        "isEligible":\(eligible),"isInflowEligible":\(inflow),"errors":[],"warnings":[],"isPossibleDuplicate":\(duplicate),
        "duplicateExpenseIds":[],"isPossibleInflowDuplicate":false,"duplicateInflowIds":[],
        "editableExpenseDescription":"\(description)","category":\(categoryText),"selectedForImport":\(selected),
        "selectedForInflow":\(selectedInflow)}
        """
    }

    static func previewJSON(_ rows: [String]? = nil, batchId: String = batch) -> String {
        let list = rows ?? [rowJSON(row1), rowJSON(row2, amount: "7.25")]
        return #"{"batchId":"\#(batchId)","sourceType":"sunflower_pdf","parserRuleVersion":"1","createdAt":"2026-10-01T10:00:00Z","expiresAt":"2026-10-02T10:00:00Z","rows":[\#(list.joined(separator: ","))]}"#
    }

    static func confirmationJSON(_ status: String = "confirmed", expenses: Int = 2, deposits: Int = 1) -> String {
        #"{"batchId":"\#(batch)","status":"\#(status)","confirmedAt":"2026-10-01T10:05:00Z","importedExpenseCount":\#(expenses),"importedInflowCount":\#(deposits)}"#
    }

    static func preview(_ rows: [String]? = nil) -> ImportPreview {
        try! ImportValidation.parsePreview(Data(previewJSON(rows).utf8))
    }

    static func row(_ json: String) -> ImportRow { try! ImportValidation.parseRow(Data(json.utf8)) }
}

/// Scripted service: records every call and runs the scripted closure.
final class ScriptedImportService: ImportService, @unchecked Sendable {
    private let lock = NSLock()
    private var log: [String] = []
    private var uploads: [ImportUploadBody] = []
    private var rowBodies: [Data] = []
    private var selectionBodies: [Data] = []

    var onOpen: @Sendable () async throws -> ImportPreview? = { nil }
    var onPreview: @Sendable () async throws -> ImportPreview = { ImportFixtures.preview() }
    var onUpload: @Sendable () async throws -> ImportPreview = { ImportFixtures.preview() }
    var onRow: @Sendable () async throws -> ImportRow = { ImportFixtures.row(ImportFixtures.rowJSON(ImportFixtures.row1)) }
    var onSelect: @Sendable () async throws -> ImportPreview = { ImportFixtures.preview() }
    var onConfirm: @Sendable () async throws -> ImportConfirmation = { try ImportValidation.parseConfirmation(Data(ImportFixtures.confirmationJSON().utf8)) }

    private func addUpload(_ body: ImportUploadBody) { lock.lock(); uploads.append(body); lock.unlock() }
    private func addRow(_ body: Data) { lock.lock(); rowBodies.append(body); lock.unlock() }
    private func addSelection(_ body: Data) { lock.lock(); selectionBodies.append(body); lock.unlock() }
    private func record(_ name: String) { lock.lock(); log.append(name); lock.unlock() }
    func count(_ name: String) -> Int { lock.lock(); defer { lock.unlock() }; return log.filter { $0 == name }.count }
    var sentUploads: [ImportUploadBody] { lock.lock(); defer { lock.unlock() }; return uploads }
    var sentRowBodies: [Data] { lock.lock(); defer { lock.unlock() }; return rowBodies }
    var sentSelectionBodies: [Data] { lock.lock(); defer { lock.unlock() }; return selectionBodies }

    func openPreview() async throws -> ImportPreview? { record("open"); return try await onOpen() }
    func preview(batchId: String) async throws -> ImportPreview { record("preview"); return try await onPreview() }
    func upload(_ body: ImportUploadBody) async throws -> ImportPreview {
        record("upload"); addUpload(body); return try await onUpload()
    }
    func updateRow(batchId: String, rowId: String, body: Data) async throws -> ImportRow {
        record("row"); addRow(body); return try await onRow()
    }
    func select(batchId: String, body: Data) async throws -> ImportPreview {
        record("select"); addSelection(body); return try await onSelect()
    }
    func confirm(batchId: String) async throws -> ImportConfirmation { record("confirm"); return try await onConfirm() }
}

@MainActor
final class ImportRefreshCounter { var count = 0 }

@MainActor
func importModel(_ service: ScriptedImportService, counter: ImportRefreshCounter = ImportRefreshCounter(),
                 other: @escaping @MainActor () -> Bool = { false },
                 readFile: @escaping @Sendable (URL) throws -> Data = { _ in Data("%PDF-synthetic".utf8) }) -> ImportViewModel {
    ImportViewModel(service: service, readFile: readFile, refreshOthers: { counter.count += 1 }, isOtherWriteInFlight: other)
}

@MainActor
func reviewing(_ service: ScriptedImportService, counter: ImportRefreshCounter = ImportRefreshCounter(),
               other: @escaping @MainActor () -> Bool = { false }) async -> ImportViewModel {
    service.onOpen = { ImportFixtures.preview() }
    let model = importModel(service, counter: counter, other: other)
    await model.open()
    return model
}

let refusal413 = APIError.importRefused(status: 413, code: nil)
func refused(_ status: Int, _ code: String? = nil) -> APIError { .importRefused(status: status, code: code) }
