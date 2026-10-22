import Foundation

/// Reads `GET /api/commitment-candidates` and `GET /api/commitments`.
///
/// Structural failures make the whole response malformed (nothing is shown, nothing is guessed): a
/// body of the wrong shape, a candidate without a 64-character lowercase-hex `fingerprint` or a string
/// `description`, a commitment without a valid GUID `id`, a string `name` or a known `lifecycle`,
/// `evidence` that is not an array, an evidence row without a positive integer `expenseId`.
/// Everything else degrades per field. Candidate and evidence amounts are fixed two-decimal strings
/// (`Money.parse`); commitment amounts are JSON numbers read as `Decimal`, never `Double`.
/// `algorithmVersion`, timestamps and unknown keys are never decoded.
enum CommitmentsValidation {
    enum ParseError: Error, Equatable { case malformed }

    /// 64 lowercase hex digits. Uppercase is refused on purpose: the server writes lowercase, and the
    /// value is sent back verbatim as the origin fingerprint.
    static func isFingerprint(_ text: String) -> Bool {
        text.utf8.count == 64 && text.utf8.allSatisfy { ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66) }
    }

    static func money(fromText text: String?) -> CommitmentMoney {
        guard let text, let money = Money.parse(text) else { return .needsReview }
        return .exact(money)
    }

    struct RawEvidence: Decodable {
        let expenseId: Int
        let date: String?
        let amount: String?
        let text: String
        let category: String
        let source: String
        private enum Keys: String, CodingKey { case expenseId, date, amount, description, category, source }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            expenseId = try c.decode(Int.self, forKey: .expenseId)
            guard expenseId > 0 else { throw ParseError.malformed }
            date = try? c.decode(String.self, forKey: .date)
            amount = try? c.decode(String.self, forKey: .amount)
            text = (try? c.decode(String.self, forKey: .description)) ?? ""
            category = (try? c.decode(String.self, forKey: .category)) ?? ""
            source = (try? c.decode(String.self, forKey: .source)) ?? ""
        }
        var evidence: CommitmentEvidence {
            CommitmentEvidence(expenseId: expenseId, date: date.flatMap(CalendarDate.init),
                               amount: CommitmentsValidation.money(fromText: amount), text: text,
                               category: category, source: source)
        }
    }

    private struct RawTiming {
        let timing: CommitmentTiming
        init(_ c: KeyedDecodingContainer<RawCandidate.Keys>) {
            timing = CommitmentTiming(
                cadence: (try? c.decode(String.self, forKey: .cadence)) ?? "",
                kind: (try? c.decode(String.self, forKey: .timingKind)) ?? "",
                dayOfWeek: try? c.decode(String.self, forKey: .expectedDayOfWeek),
                day: try? c.decode(Int.self, forKey: .expectedDay),
                month: try? c.decode(Int.self, forKey: .expectedMonth),
                windowBeforeDays: try? c.decode(Int.self, forKey: .windowBeforeDays),
                windowAfterDays: try? c.decode(Int.self, forKey: .windowAfterDays))
        }
    }

    private struct RawCandidate: Decodable {
        enum Keys: String, CodingKey {
            case fingerprint, description, category, cadence, timingKind, expectedDayOfWeek, expectedDay, expectedMonth
            case windowBeforeDays, windowAfterDays, observedAmountMode, observedMedianAmount, observedMinimumAmount
            case observedMaximumAmount, coveredFrom, coveredTo, occurrenceCount, evidenceRule, evidence
        }
        let candidate: RecurringCandidate
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            let fingerprint = try c.decode(String.self, forKey: .fingerprint)
            guard CommitmentsValidation.isFingerprint(fingerprint) else { throw ParseError.malformed }
            let name = try c.decode(String.self, forKey: .description)
            let evidence = try c.decode([RawEvidence].self, forKey: .evidence).map(\.evidence)
            func amount(_ key: Keys) -> CommitmentMoney {
                CommitmentsValidation.money(fromText: try? c.decode(String.self, forKey: key))
            }
            candidate = RecurringCandidate(
                fingerprint: fingerprint, name: name,
                category: (try? c.decode(String.self, forKey: .category)) ?? "",
                timing: RawTiming(c).timing,
                observedFixed: (try? c.decode(String.self, forKey: .observedAmountMode)) == "fixed",
                median: amount(.observedMedianAmount), minimum: amount(.observedMinimumAmount),
                maximum: amount(.observedMaximumAmount),
                coveredFrom: (try? c.decode(String.self, forKey: .coveredFrom)).flatMap(CalendarDate.init),
                coveredTo: (try? c.decode(String.self, forKey: .coveredTo)).flatMap(CalendarDate.init),
                occurrenceCount: (try? c.decode(Int.self, forKey: .occurrenceCount)) ?? evidence.count,
                evidenceRule: (try? c.decode(String.self, forKey: .evidenceRule)) ?? "", evidence: evidence)
        }
    }

    private struct RawCandidates: Decodable {
        let candidates: [RawCandidate]
        let dismissed: [RawCandidate]
        private enum Keys: String, CodingKey { case candidates, dismissedCandidates }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            candidates = try c.decode([RawCandidate].self, forKey: .candidates)
            dismissed = try c.decode([RawCandidate].self, forKey: .dismissedCandidates)
        }
    }

    static func parseCandidates(_ data: Data) throws -> (candidates: [RecurringCandidate], dismissed: [RecurringCandidate]) {
        guard let raw = try? JSONDecoder().decode(RawCandidates.self, from: data) else { throw ParseError.malformed }
        return (raw.candidates.map(\.candidate), raw.dismissed.map(\.candidate))
    }

    private struct RawCommitment: Decodable {
        enum Keys: String, CodingKey {
            case id, name, category, lifecycle, cadence, timingKind, expectedDayOfWeek, expectedDay, expectedMonth
            case windowBeforeDays, windowAfterDays, amountMode, expectedAmount, expectedMinimumAmount
            case expectedMaximumAmount, evidence
        }
        let commitment: RecurringCommitment
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            let id = try c.decode(String.self, forKey: .id)
            guard UUID(uuidString: id) != nil else { throw ParseError.malformed }
            let name = try c.decode(String.self, forKey: .name)
            guard let lifecycle = CommitmentLifecycle(rawValue: try c.decode(String.self, forKey: .lifecycle)) else {
                throw ParseError.malformed
            }
            let evidence = try c.decode([RawEvidence].self, forKey: .evidence).map(\.evidence)
            func number(_ key: Keys) -> CommitmentMoney {
                PaychecksValidation.money(from: try? c.decode(Decimal.self, forKey: key))
            }
            let amount: CommitmentAmount
            switch try? c.decode(String.self, forKey: .amountMode) {
            case "fixed"?: amount = .fixed(number(.expectedAmount))
            case "range"?: amount = .range(minimum: number(.expectedMinimumAmount), maximum: number(.expectedMaximumAmount))
            default: amount = .unavailable
            }
            let timing = CommitmentTiming(
                cadence: (try? c.decode(String.self, forKey: .cadence)) ?? "",
                kind: (try? c.decode(String.self, forKey: .timingKind)) ?? "",
                dayOfWeek: try? c.decode(String.self, forKey: .expectedDayOfWeek),
                day: try? c.decode(Int.self, forKey: .expectedDay),
                month: try? c.decode(Int.self, forKey: .expectedMonth),
                windowBeforeDays: try? c.decode(Int.self, forKey: .windowBeforeDays),
                windowAfterDays: try? c.decode(Int.self, forKey: .windowAfterDays))
            commitment = RecurringCommitment(id: id, name: name, category: (try? c.decode(String.self, forKey: .category)) ?? "",
                                             lifecycle: lifecycle, timing: timing, amount: amount, evidence: evidence)
        }
    }

    static func parseCommitments(_ data: Data) throws -> [RecurringCommitment] {
        guard let rows = try? JSONDecoder().decode([RawCommitment].self, from: data) else { throw ParseError.malformed }
        return rows.map(\.commitment)
    }
}
