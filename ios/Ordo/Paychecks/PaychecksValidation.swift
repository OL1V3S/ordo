import Foundation

/// Reads `GET /api/paychecks` and `GET /api/inflows`.
///
/// Structural failures make the whole response malformed (nothing is shown, nothing is guessed): a
/// body that is not an object, `paychecks` that is not an array, a profile without a valid GUID
/// `id`, a string `displayName` or a known `lifecycle`, `evidence` or `receiptSlots` that is not an
/// array, an evidence row without a positive integer `accountInflowId` or a known `assignmentKind`.
/// Everything else degrades per field. Money is decoded as `Decimal` (exact), never `Double`.
/// `origin`, timestamps and algorithm versions are not declared, so they are never decoded.
enum PaychecksValidation {
    enum ParseError: Error, Equatable { case malformed }

    /// Amounts up to the server maximum are read exactly (`Decimal` decoding is proven exact above
    /// 2^53 cents in `PaychecksValidationTests`).
    static let maximumCents: Int64 = Money.maximumCents

    // MARK: Money

    /// Exact: finite, above zero, at most two decimals and at most `maximumCents`.
    static func money(from number: Decimal?) -> PaycheckMoney {
        guard let number, number.isFinite, number > 0 else { return .needsReview }
        var scaled = number * 100
        var rounded = Decimal()
        NSDecimalRound(&rounded, &scaled, 0, .plain)
        guard rounded == scaled, rounded <= Decimal(maximumCents),
              let money = Money.fromCents(NSDecimalNumber(decimal: rounded).int64Value), money.cents > 0 else {
            return .needsReview
        }
        return .exact(money)
    }

    // MARK: Raw shapes

    private struct RawAnchor: Decodable {
        let kind: String?
        let day: Int?
        var anchor: MonthAnchor {
            if kind == "month_end" { return .monthEnd }
            if kind == "day", let day, (1...31).contains(day) { return .day(day) }
            return .unknown
        }
    }

    private struct RawSchedule: Decodable {
        let cadence: String?
        let referenceAnchorDate: String?
        let firstMonthAnchor: RawAnchor?
        let secondMonthAnchor: RawAnchor?

        private enum Keys: String, CodingKey { case cadence, referenceAnchorDate, firstMonthAnchor, secondMonthAnchor }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            cadence = try? c.decode(String.self, forKey: .cadence)
            referenceAnchorDate = try? c.decode(String.self, forKey: .referenceAnchorDate)
            firstMonthAnchor = try? c.decode(RawAnchor.self, forKey: .firstMonthAnchor)
            secondMonthAnchor = try? c.decode(RawAnchor.self, forKey: .secondMonthAnchor)
        }
    }

    private struct RawAmount: Decodable {
        let mode: String?
        let fixed: Decimal?
        let minimum: Decimal?
        let maximum: Decimal?
        private enum Keys: String, CodingKey { case mode, fixedAmount, minimumAmount, maximumAmount }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            mode = try? c.decode(String.self, forKey: .mode)
            fixed = try? c.decode(Decimal.self, forKey: .fixedAmount)
            minimum = try? c.decode(Decimal.self, forKey: .minimumAmount)
            maximum = try? c.decode(Decimal.self, forKey: .maximumAmount)
        }
        var amount: PaycheckAmount {
            switch mode {
            case "fixed": .fixed(PaychecksValidation.money(from: fixed))
            case "range": .range(minimum: PaychecksValidation.money(from: minimum), maximum: PaychecksValidation.money(from: maximum))
            default: .unavailable
            }
        }
    }

    private struct RawProjection: Decodable {
        let anchor: String?
        let earliestExpectedDate: String?
        let latestExpectedDate: String?
        let amount: RawAmount?
        private enum Keys: String, CodingKey { case anchor, earliestExpectedDate, latestExpectedDate, amount }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            anchor = try? c.decode(String.self, forKey: .anchor)
            earliestExpectedDate = try? c.decode(String.self, forKey: .earliestExpectedDate)
            latestExpectedDate = try? c.decode(String.self, forKey: .latestExpectedDate)
            amount = try? c.decode(RawAmount.self, forKey: .amount)
        }
    }

    private struct RawSlot: Decodable {
        let relation: String?
        let anchor: String?
        let earliest: String?
        let latest: String?
        private enum Keys: String, CodingKey { case relation, anchor, earliestExpectedDate, latestExpectedDate }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            relation = try? c.decode(String.self, forKey: .relation)
            anchor = try? c.decode(String.self, forKey: .anchor)
            earliest = try? c.decode(String.self, forKey: .earliestExpectedDate)
            latest = try? c.decode(String.self, forKey: .latestExpectedDate)
        }
        /// A slot with any unreadable date or an unknown relation is not offered.
        var slot: PaycheckSlot? {
            guard let relation = relation.flatMap(PaycheckSlot.Relation.init(rawValue:)),
                  let anchor = anchor.flatMap(CalendarDate.init), let earliest = earliest.flatMap(CalendarDate.init),
                  let latest = latest.flatMap(CalendarDate.init) else { return nil }
            return PaycheckSlot(relation: relation, anchor: anchor, earliest: earliest, latest: latest)
        }
    }

    private struct RawEvidence: Decodable {
        let accountInflowId: Int
        let kind: PaycheckEvidence.Kind
        let postedDate: String?
        let amount: Decimal?
        let description: String?
        let source: String?
        let slotAnchor: String?
        let timingOffsetDays: Int?
        let edited: Bool

        private enum Keys: String, CodingKey {
            case accountInflowId, assignmentKind, postedDate, amount, description, source, slotAnchor, timingOffsetDays
            case editedSinceConfirmation
        }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            accountInflowId = try c.decode(Int.self, forKey: .accountInflowId)
            guard accountInflowId > 0 else { throw ParseError.malformed }
            switch try c.decode(String.self, forKey: .assignmentKind) {
            case "recorded_receipt": kind = .recordedReceipt
            case "confirmation_evidence": kind = .confirmationEvidence
            default: throw ParseError.malformed
            }
            postedDate = try? c.decode(String.self, forKey: .postedDate)
            amount = try? c.decode(Decimal.self, forKey: .amount)
            description = try? c.decode(String.self, forKey: .description)
            source = try? c.decode(String.self, forKey: .source)
            slotAnchor = try? c.decode(String.self, forKey: .slotAnchor)
            timingOffsetDays = try? c.decode(Int.self, forKey: .timingOffsetDays)
            edited = (try? c.decode(Bool.self, forKey: .editedSinceConfirmation)) ?? false
        }
        var evidence: PaycheckEvidence {
            PaycheckEvidence(accountInflowId: accountInflowId, postedDate: postedDate.flatMap(CalendarDate.init),
                             amount: PaychecksValidation.money(from: amount), text: description ?? "",
                             source: source == "imported" ? .imported : source == "manual" ? .manual : .unknown,
                             slotAnchor: slotAnchor.flatMap(CalendarDate.init), timingOffsetDays: timingOffsetDays, edited: edited, kind: kind)
        }
    }

    private struct RawProfile: Decodable {
        let id: String
        let name: String
        let lifecycle: PaycheckLifecycle
        let schedule: RawSchedule?
        let before: Int?
        let after: Int?
        let amount: RawAmount?
        let isManual: Bool
        let evidence: [RawEvidence]
        let slots: [RawSlot]
        let projection: RawProjection?

        private enum Keys: String, CodingKey {
            case id, displayName, lifecycle, schedule, windowBeforeDays, windowAfterDays, amount, source
            case evidence, receiptSlots, nextProjection
        }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            id = try c.decode(String.self, forKey: .id)
            guard UUID(uuidString: id) != nil else { throw ParseError.malformed }
            name = try c.decode(String.self, forKey: .displayName)
            guard let value = PaycheckLifecycle(rawValue: try c.decode(String.self, forKey: .lifecycle)) else {
                throw ParseError.malformed
            }
            lifecycle = value
            schedule = try? c.decode(RawSchedule.self, forKey: .schedule)
            before = try? c.decode(Int.self, forKey: .windowBeforeDays)
            after = try? c.decode(Int.self, forKey: .windowAfterDays)
            amount = try? c.decode(RawAmount.self, forKey: .amount)
            isManual = (try? c.decode(String.self, forKey: .source)) == "manual"
            evidence = try c.decode([RawEvidence].self, forKey: .evidence)
            slots = try c.decode([RawSlot].self, forKey: .receiptSlots)
            projection = try? c.decode(RawProjection.self, forKey: .nextProjection)
        }

        var profile: PaycheckProfile {
            let parsedSchedule = schedule.map { raw in
                PaycheckSchedule(cadence: raw.cadence.flatMap(PaycheckCadence.init(rawValue:)) ?? .unknown,
                                 reference: raw.referenceAnchorDate.flatMap(CalendarDate.init),
                                 first: raw.firstMonthAnchor?.anchor, second: raw.secondMonthAnchor?.anchor)
            }
            let parsedProjection = projection.map {
                PaycheckProjection(earliest: $0.earliestExpectedDate.flatMap(CalendarDate.init),
                                   latest: $0.latestExpectedDate.flatMap(CalendarDate.init),
                                   anchor: $0.anchor.flatMap(CalendarDate.init), amount: $0.amount?.amount ?? .unavailable)
            }
            return PaycheckProfile(id: id, name: name, lifecycle: lifecycle, schedule: parsedSchedule,
                                   windowBeforeDays: before, windowAfterDays: after,
                                   amount: amount?.amount ?? .unavailable, isManual: isManual,
                                   evidence: evidence.map(\.evidence), slots: slots.compactMap(\.slot),
                                   projection: lifecycle == .active ? parsedProjection : nil)
        }
    }

    private struct RawResponse: Decodable {
        let evaluatedOn: String?
        let paychecks: [RawProfile]
        private enum Keys: String, CodingKey { case evaluatedOn, paychecks }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            evaluatedOn = try? c.decode(String.self, forKey: .evaluatedOn)
            paychecks = try c.decode([RawProfile].self, forKey: .paychecks)
        }
    }

    static func parse(_ data: Data) throws -> PaychecksSnapshot {
        guard let raw = try? JSONDecoder().decode(RawResponse.self, from: data) else { throw ParseError.malformed }
        return PaychecksSnapshot(evaluatedOn: raw.evaluatedOn.flatMap(CalendarDate.init), profiles: raw.paychecks.map(\.profile))
    }

    // MARK: Deposits

    private struct RawDeposit: Decodable {
        let id: Int
        let description: String
        let amount: Decimal?
        let date: String?
        private enum Keys: String, CodingKey { case id, description, amount, date }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            id = try c.decode(Int.self, forKey: .id)
            guard id > 0 else { throw ParseError.malformed }
            description = try c.decode(String.self, forKey: .description)
            amount = try? c.decode(Decimal.self, forKey: .amount)
            date = try? c.decode(String.self, forKey: .date)
        }
    }

    static func parseDeposits(_ data: Data) throws -> [SavedDeposit] {
        guard let rows = try? JSONDecoder().decode([RawDeposit].self, from: data) else { throw ParseError.malformed }
        return rows.map {
            SavedDeposit(id: $0.id, text: $0.description, amount: money(from: $0.amount), date: $0.date.flatMap(CalendarDate.init))
        }
    }
}
