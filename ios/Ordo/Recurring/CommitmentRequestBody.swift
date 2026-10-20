import Foundation

/// Byte-exact request bodies: sorted keys, built by hand, so every attempt of one frozen write sends
/// identical bytes in any time zone or locale. Amounts are JSON numbers whose text is `Money.text`
/// (the same encoding as Paychecks; the server accepts numbers and numeric strings).
enum CommitmentRequestBody {
    static func lifecycle(_ value: CommitmentLifecycle) -> Data {
        Data("{\"lifecycle\":\"\(value.rawValue)\"}".utf8)
    }

    /// `{"fingerprint":"<64 hex>"}` for dismiss and reconsider.
    static func fingerprint(_ fingerprint: String) -> Data {
        Data("{\"fingerprint\":\"\(fingerprint)\"}".utf8)
    }

    struct Confirm: Equatable, Sendable {
        let name: String
        let category: String
        let cadence: String
        let timingKind: String
        let dayOfWeek: String?
        let day: Int?
        let month: Int?
        let windowBeforeDays: Int
        let windowAfterDays: Int
        let amountMode: String
        let expectedAmount: Money?
        let minimumAmount: Money?
        let maximumAmount: Money?
    }

    static func confirm(fingerprint: String, _ values: Confirm) throws -> Data {
        func text(_ value: String?) throws -> String {
            guard let value else { return "null" }
            return String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
        }
        func int(_ value: Int?) -> String { value.map(String.init) ?? "null" }
        func money(_ value: Money?) -> String { value?.text ?? "null" }
        let json = "{\"amountMode\":\(try text(values.amountMode)),\"cadence\":\(try text(values.cadence))"
            + ",\"category\":\(try text(values.category)),\"expectedAmount\":\(money(values.expectedAmount))"
            + ",\"expectedDay\":\(int(values.day)),\"expectedDayOfWeek\":\(try text(values.dayOfWeek))"
            + ",\"expectedMaximumAmount\":\(money(values.maximumAmount))"
            + ",\"expectedMinimumAmount\":\(money(values.minimumAmount)),\"expectedMonth\":\(int(values.month))"
            + ",\"fingerprint\":\(try text(fingerprint)),\"name\":\(try text(values.name))"
            + ",\"timingKind\":\(try text(values.timingKind)),\"windowAfterDays\":\(values.windowAfterDays)"
            + ",\"windowBeforeDays\":\(values.windowBeforeDays)}"
        return Data(json.utf8)
    }
}
