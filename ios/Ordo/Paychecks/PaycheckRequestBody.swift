import Foundation

/// Byte-exact request bodies: sorted keys, built by hand, so every attempt of one frozen write
/// sends identical bytes in any time zone or locale.
enum PaycheckRequestBody {
    static func lifecycle(_ value: PaycheckLifecycle) -> Data {
        Data("{\"lifecycle\":\"\(value.rawValue)\"}".utf8)
    }

    /// A saved deposit: `{"existingInflowId":<int>,"slotAnchor":"yyyy-MM-dd"}`.
    static func recordExisting(inflowId: Int, slot: CalendarDate) -> Data {
        Data("{\"existingInflowId\":\(inflowId),\"slotAnchor\":\"\(slot.isoString)\"}".utf8)
    }

    /// A new deposit. `amount` is a JSON number whose text is exactly `Money.text`; the description is
    /// escaped by `JSONEncoder`.
    static func recordNew(description: String, amount: Money, date: CalendarDate, slot: CalendarDate) throws -> Data {
        var body = Data("{\"newInflow\":{\"amount\":\(amount.text),\"date\":\"\(date.isoString)\",\"description\":".utf8)
        body.append(try JSONEncoder().encode(description))
        body.append(Data("},\"slotAnchor\":\"\(slot.isoString)\"}".utf8))
        return body
    }
}
