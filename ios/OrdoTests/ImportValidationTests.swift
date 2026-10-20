import Foundation
import Testing
@testable import Ordo

@Suite struct ImportValidationTests {
    private func parse(_ json: String) throws -> ImportPreview { try ImportValidation.parsePreview(Data(json.utf8)) }

    @Test func aValidPreviewKeepsExactAmounts() throws {
        let preview = try parse(ImportFixtures.previewJSON([ImportFixtures.rowJSON(ImportFixtures.row1, amount: "9007199254740993.07"),
                                                             ImportFixtures.rowJSON(ImportFixtures.row2, amount: "0.10")]))
        #expect(preview.batchId == ImportFixtures.batch)
        #expect(preview.rows[0].amount?.text == "9007199254740993.07")
        #expect(preview.rows[1].amount?.cents == 10)
        #expect(preview.expiresAt != nil)
    }

    @Test func malformedPreviewsAreRefused() {
        let bad = [
            "{}", "[]", ImportFixtures.previewJSON(batchId: "not-a-guid"),
            ImportFixtures.previewJSON([ImportFixtures.rowJSON("nope")]),
            ImportFixtures.previewJSON([ImportFixtures.rowJSON(ImportFixtures.row1), ImportFixtures.rowJSON(ImportFixtures.row1)]),
            ImportFixtures.previewJSON([ImportFixtures.rowJSON(ImportFixtures.row1, amount: "1.005")]),
            ImportFixtures.previewJSON([ImportFixtures.rowJSON(ImportFixtures.row1, date: "2026-13-40")]),
            ImportFixtures.previewJSON([ImportFixtures.rowJSON(ImportFixtures.row1, amount: "-3.00")]),
        ]
        for json in bad { #expect(throws: ImportValidation.ParseError.self) { try parse(json) } }
    }

    @Test func tooManyRowsAreRefused() {
        let rows = (0...1000).map { ImportFixtures.rowJSON(String(format: "00000000-0000-4000-8000-%012d", $0)) }
        #expect(throws: ImportValidation.ParseError.self) { try parse(ImportFixtures.previewJSON(rows)) }
    }

    @Test func aMissingAmountAndDateAreAllowedAndUnknownKeysIgnored() throws {
        let preview = try parse(ImportFixtures.previewJSON([ImportFixtures.rowJSON(ImportFixtures.row1, amount: nil, date: nil)]))
        #expect(preview.rows[0].amount == nil && preview.rows[0].postedDate == nil)
    }

    @Test func confirmationShape() throws {
        let done = try ImportValidation.parseConfirmation(Data(ImportFixtures.confirmationJSON("already_confirmed", expenses: 3, deposits: 0).utf8))
        #expect(done.alreadyConfirmed && done.expenseCount == 3 && done.depositCount == 0)
        #expect(throws: ImportValidation.ParseError.self) { try ImportValidation.parseConfirmation(Data(ImportFixtures.confirmationJSON("weird").utf8)) }
        #expect(throws: ImportValidation.ParseError.self) { try ImportValidation.parseConfirmation(Data(ImportFixtures.confirmationJSON(expenses: -1).utf8)) }
    }

    @Test func selectionResponseCarriesThePreview() throws {
        let json = #"{"preview":\#(ImportFixtures.previewJSON()),"changedRowIds":["\#(ImportFixtures.row1)"]}"#
        #expect(try ImportValidation.parseSelection(Data(json.utf8)).rows.count == 2)
    }

    @Test func requestBodiesAreStableAndAbsolute() {
        let body = ImportRequestBody.row(description: "A", category: "food", selectedForImport: true, selectedForInflow: false)
        #expect(String(decoding: body, as: UTF8.self) == #"{"category":"food","editableExpenseDescription":"A","selectedForImport":true,"selectedForInflow":false}"#)
        let deposit = ImportRequestBody.row(description: nil, category: nil, selectedForImport: false, selectedForInflow: true)
        #expect(String(decoding: deposit, as: UTF8.self).contains(#""category":null"#))
        #expect(String(decoding: ImportRequestBody.selection(action: "clear", rowIds: ["x"]), as: UTF8.self) == #"{"action":"clear","rowIds":["x"]}"#)
    }

    @Test func reviewRulesPortTheWebRules() {
        let rows = [
            ImportFixtures.row(ImportFixtures.rowJSON(ImportFixtures.row1, selected: true)),
            ImportFixtures.row(ImportFixtures.rowJSON(ImportFixtures.row2, duplicate: true)),
            ImportFixtures.row(ImportFixtures.rowJSON(ImportFixtures.row3, classification: "non_expense", eligible: false, inflow: true, direction: "credit")),
        ]
        #expect(ImportReviewRules.bulkSelectableExpenses(rows).isEmpty)
        #expect(ImportReviewRules.bulkClearTargets(rows).count == 1)
        #expect(ImportReviewRules.counts(rows)[.deposits] == 1 && ImportReviewRules.counts(rows)[.duplicates] == 1)
        let totals = ImportReviewRules.selectedTotals(rows)
        #expect(totals.expenses?.text == "12.50" && totals.depositCount == 0)
        let huge = ImportFixtures.row(ImportFixtures.rowJSON(ImportFixtures.row1, amount: "9999999999999999.99", selected: true))
        #expect(ImportReviewRules.selectedTotals(Array(repeating: huge, count: 10)).expenses == nil)
    }
}
