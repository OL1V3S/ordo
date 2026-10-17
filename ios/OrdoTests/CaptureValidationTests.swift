import Foundation
import Testing
@testable import Ordo

@Suite struct CaptureValidationTests {
    private let day = CalendarDate("2026-10-17")!

    private func draft(description: String = "Lunch", amount: String = "12.5",
                       category: CategoryChoice = .uncategorized, custom: String = "") -> CaptureDraft {
        CaptureDraft(description: description, amountText: amount, date: day, category: category, customCategory: custom)
    }

    private func freeze(_ draft: CaptureDraft, kind: CaptureKind = .expense) -> Result<PendingSave, CaptureValidation.Failure> {
        CaptureValidation.freeze(draft, kind: kind, key: "11111111-2222-4333-8444-555555555555",
                                 createdAt: CaptureFixtures.fixedNow, language: .en, deviceLocale: CaptureFixtures.english)
    }

    @Test func anExpenseFreezesTrimmedValuesAndKeepsDescriptionCase() throws {
        let save = try freeze(draft(description: "  Lunch AT Joe's \n", category: .food)).get()
        #expect(save.descriptionText == "Lunch AT Joe's")
        #expect(save.amount == "12.50")
        #expect(save.date == "2026-10-17")
        #expect(save.category == "food")
        #expect(save.kind == .expense)
        #expect(save.isWellFormed)
    }

    @Test func theDefaultCategoryIsUncategorized() throws {
        #expect(try freeze(draft()).get().category == "uncategorized")
    }

    @Test func aDepositHasNoCategory() throws {
        let save = try freeze(draft(category: .food), kind: .deposit).get()
        #expect(save.category == nil)
        #expect(save.isWellFormed)
    }

    @Test func customCategoryIsNormalizedLikeTheServer() throws {
        let save = try freeze(draft(category: .custom, custom: "  Home   Repair\tFund ")).get()
        #expect(save.category == "home repair fund")
    }

    @Test func aBlankCustomCategoryIsUncategorized() throws {
        #expect(try freeze(draft(category: .custom, custom: "   ")).get().category == "uncategorized")
    }

    @Test(arguments: ["other", "OTHER", "  Other "])
    func theReservedCategoryIsRejectedAndNeverSent(text: String) {
        guard case .failure(let failure) = freeze(draft(category: .custom, custom: text)) else {
            Issue.record("accepted \(text)"); return
        }
        #expect(failure.fields == [.category])
    }

    @Test func theOtherChoiceAloneNeverSendsOther() throws {
        // "Other" in the picker reveals the custom field; it is not a stored value.
        #expect(CategoryChoice.allCases.map(\.rawValue).contains("other") == false)
        #expect(try freeze(draft(category: .custom, custom: "")).get().category != "other")
    }

    @Test func categoryLengthIsCountedInUTF16Units() {
        #expect(freeze(draft(category: .custom, custom: String(repeating: "a", count: 100))) .isSuccess)
        #expect(!freeze(draft(category: .custom, custom: String(repeating: "a", count: 101))).isSuccess)
        // 51 emoji are 102 UTF-16 units but only 51 characters.
        #expect(!freeze(draft(category: .custom, custom: String(repeating: "😀", count: 51))).isSuccess)
        #expect(freeze(draft(category: .custom, custom: String(repeating: "😀", count: 50))).isSuccess)
    }

    @Test func descriptionLengthIsCountedInUTF16Units() {
        #expect(freeze(draft(description: String(repeating: "a", count: 500))).isSuccess)
        #expect(!freeze(draft(description: String(repeating: "a", count: 501))).isSuccess)
        #expect(!freeze(draft(description: String(repeating: "😀", count: 251))).isSuccess)
        #expect(freeze(draft(description: String(repeating: "😀", count: 250))).isSuccess)
        #expect(!freeze(draft(description: "   ")).isSuccess)
    }

    @Test func invalidFieldsAreReportedTogetherAndTheFirstGetsFocus() {
        guard case .failure(let failure) = freeze(draft(description: "", amount: "0")) else {
            Issue.record("accepted"); return
        }
        #expect(failure.fields == [.description, .amount])
        #expect(failure.first == .description)
    }

    @Test(arguments: ["0", "0.00", "-5", "abc", ""])
    func zeroNegativeAndGarbageAmountsAreRejected(amount: String) {
        guard case .failure(let failure) = freeze(draft(amount: amount)) else { Issue.record("accepted \(amount)"); return }
        #expect(failure.fields == [.amount])
    }

    @Test func pendingSaveIsRedactedInDescriptions() {
        let save = CaptureFixtures.save(description: "super-secret-description")
        for text in [String(describing: save), String(reflecting: save), "\(save)"] {
            #expect(!text.contains("super-secret"))
            #expect(!text.contains(save.key))
            #expect(text.contains("redacted"))
        }
    }

    @Test(arguments: ["Pacific/Kiritimati", "America/Los_Angeles", "UTC", "Pacific/Pago_Pago"])
    func theDatePickerConversionKeepsTheCalendarDay(zone: String) {
        let timeZone = TimeZone(identifier: zone)!
        for text in ["2026-03-08", "2026-11-01", "2026-10-17", "2024-02-29", "2026-12-31", "2026-01-01"] {
            let day = CalendarDate(text)!
            let date = CaptureDates.date(from: day, timeZone: timeZone)
            #expect(CaptureDates.calendarDate(from: date, timeZone: timeZone) == day, "\(text) in \(zone)")
        }
    }

    @Test func wellFormednessRejectsAlteredRecords() {
        let good = CaptureFixtures.save()
        #expect(good.isWellFormed)
        #expect(!CaptureFixtures.save(key: "NOT-A-KEY").isWellFormed)
        #expect(!CaptureFixtures.save(key: "11111111-2222-4333-8444-55555555555A").isWellFormed)
        #expect(!CaptureFixtures.save(amount: "0.00").isWellFormed)
        #expect(!CaptureFixtures.save(date: "2026-13-01").isWellFormed)
        #expect(!CaptureFixtures.save(category: "other").isWellFormed)
        #expect(!CaptureFixtures.save(description: " padded ").isWellFormed)
    }
}

private extension Result {
    var isSuccess: Bool { if case .success = self { true } else { false } }
}
