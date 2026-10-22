import Foundation

/// Reads `GET /api/commitment-changes`.
///
/// Structural failures make the whole response malformed: a body of the wrong shape, a change whose
/// `commitment` has no valid GUID `id` or string `name`, `observations` that is not an array, an
/// observation without a positive integer `expenseId`. Everything else degrades per assessment: only
/// `proposed_change` amount and timing and `not_seen_recently` / `possibly_ended` missing assessments
/// with a 64-hex fingerprint and a `pending` or `kept` decision are kept; any other assessment is
/// dropped (a bad fingerprint hides only that assessment). Snapshot money arrives as JSON numbers
/// read as `Decimal`; proposed and observed amounts are strings read with `Money.parse`. Never `Double`.
enum CommitmentChangesValidation {
    private struct RawAssessment: Decodable {
        let state: String?
        let fingerprint: String?
        let decisionState: String?
        let proposedMode: String?
        let proposedAmount: String?
        let proposedMinimumAmount: String?
        let proposedMaximumAmount: String?
        let evidenceExpenseIds: [Int]?
        let proposedTimingKind: String?
        let proposedDayOfWeek: String?
        let proposedDay: Int?
        let proposedMonth: Int?
        let proposedWindowBeforeDays: Int?
        let proposedWindowAfterDays: Int?
        let missedSlotAnchors: [String]?

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            state = try? c.decode(String.self, forKey: .state)
            fingerprint = try? c.decode(String.self, forKey: .fingerprint)
            decisionState = try? c.decode(String.self, forKey: .decisionState)
            proposedMode = try? c.decode(String.self, forKey: .proposedMode)
            proposedAmount = try? c.decode(String.self, forKey: .proposedAmount)
            proposedMinimumAmount = try? c.decode(String.self, forKey: .proposedMinimumAmount)
            proposedMaximumAmount = try? c.decode(String.self, forKey: .proposedMaximumAmount)
            evidenceExpenseIds = try? c.decode([Int].self, forKey: .evidenceExpenseIds)
            proposedTimingKind = try? c.decode(String.self, forKey: .proposedTimingKind)
            proposedDayOfWeek = try? c.decode(String.self, forKey: .proposedDayOfWeek)
            proposedDay = try? c.decode(Int.self, forKey: .proposedDay)
            proposedMonth = try? c.decode(Int.self, forKey: .proposedMonth)
            proposedWindowBeforeDays = try? c.decode(Int.self, forKey: .proposedWindowBeforeDays)
            proposedWindowAfterDays = try? c.decode(Int.self, forKey: .proposedWindowAfterDays)
            missedSlotAnchors = try? c.decode([String].self, forKey: .missedSlotAnchors)
        }

        enum Keys: String, CodingKey {
            case state, fingerprint, decisionState, proposedMode, proposedAmount, proposedMinimumAmount
            case proposedMaximumAmount, evidenceExpenseIds, proposedTimingKind, proposedDayOfWeek, proposedDay
            case proposedMonth, proposedWindowBeforeDays, proposedWindowAfterDays, missedSlotAnchors
        }

        /// A fingerprint and decision state the app may act on, or nil.
        var identity: (fingerprint: String, decision: ChangeDecisionState)? {
            guard let fingerprint, CommitmentsValidation.isFingerprint(fingerprint),
                  let decisionState, let decision = ChangeDecisionState(rawValue: decisionState) else { return nil }
            return (fingerprint, decision)
        }
    }

    private struct RawChange: Decodable {
        let change: CommitmentChange

        enum Keys: String, CodingKey {
            case commitment, algorithmVersion, observations, amount, timing, missing
        }

        enum CommitmentKeys: String, CodingKey {
            case id, name, category, cadence, timingKind, expectedDayOfWeek, expectedDay, expectedMonth
            case windowBeforeDays, windowAfterDays, amountMode, expectedAmount, expectedMinimumAmount
            case expectedMaximumAmount
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            let k = try c.nestedContainer(keyedBy: CommitmentKeys.self, forKey: .commitment)
            let id = try k.decode(String.self, forKey: .id)
            guard UUID(uuidString: id) != nil else { throw CommitmentsValidation.ParseError.malformed }
            let name = try k.decode(String.self, forKey: .name)
            func number(_ key: CommitmentKeys) -> CommitmentMoney {
                PaychecksValidation.money(from: try? k.decode(Decimal.self, forKey: key))
            }
            let amount: CommitmentAmount
            switch try? k.decode(String.self, forKey: .amountMode) {
            case "fixed"?: amount = .fixed(number(.expectedAmount))
            case "range"?: amount = .range(minimum: number(.expectedMinimumAmount), maximum: number(.expectedMaximumAmount))
            default: amount = .unavailable
            }
            let saved = CommitmentTiming(
                cadence: (try? k.decode(String.self, forKey: .cadence)) ?? "",
                kind: (try? k.decode(String.self, forKey: .timingKind)) ?? "",
                dayOfWeek: try? k.decode(String.self, forKey: .expectedDayOfWeek),
                day: try? k.decode(Int.self, forKey: .expectedDay),
                month: try? k.decode(Int.self, forKey: .expectedMonth),
                windowBeforeDays: try? k.decode(Int.self, forKey: .windowBeforeDays),
                windowAfterDays: try? k.decode(Int.self, forKey: .windowAfterDays))
            let commitment = ChangeCommitment(id: id, name: name, category: (try? k.decode(String.self, forKey: .category)) ?? "",
                                              timing: saved, amount: amount)
            let observations = try c.decode([CommitmentsValidation.RawEvidence].self, forKey: .observations).map(\.evidence)

            var assessments: [ChangeAssessment] = []
            if let raw = try? c.decode(RawAssessment.self, forKey: .amount), raw.state == "proposed_change",
               let identity = raw.identity {
                assessments.append(Self.amountAssessment(raw, identity, observations))
            }
            if let raw = try? c.decode(RawAssessment.self, forKey: .timing), raw.state == "proposed_change",
               let identity = raw.identity {
                let timing = CommitmentTiming(cadence: saved.cadence, kind: raw.proposedTimingKind ?? "",
                                              dayOfWeek: raw.proposedDayOfWeek, day: raw.proposedDay, month: raw.proposedMonth,
                                              windowBeforeDays: raw.proposedWindowBeforeDays,
                                              windowAfterDays: raw.proposedWindowAfterDays)
                let ids = Set(raw.evidenceExpenseIds ?? [])
                assessments.append(ChangeAssessment(dimension: .timing, fingerprint: identity.fingerprint,
                                                    decision: identity.decision, proposal: .timing(timing),
                                                    evidence: observations.filter { ids.contains($0.expenseId) }, isExact: true))
            }
            if let raw = try? c.decode(RawAssessment.self, forKey: .missing),
               let state = raw.state.flatMap(MissingState.init(rawValue:)), let identity = raw.identity {
                let dates = (raw.missedSlotAnchors ?? []).map { CalendarDate($0) }
                assessments.append(ChangeAssessment(dimension: .missing, fingerprint: identity.fingerprint,
                                                    decision: identity.decision,
                                                    proposal: .missing(state: state, missedDates: dates),
                                                    evidence: [], isExact: true))
            }
            change = CommitmentChange(commitment: commitment,
                                      algorithmVersion: (try? c.decode(String.self, forKey: .algorithmVersion)) ?? "",
                                      assessments: assessments)
        }

        /// The exact-amount gate (web `exactAmountAssessmentAvailable`): the proposed value(s) parse
        /// exactly, the evidence list is not empty, every evidence ID is among the observations, and
        /// every cited observation amount parses.
        private static func amountAssessment(_ raw: RawAssessment, _ identity: (fingerprint: String, decision: ChangeDecisionState),
                                             _ observations: [CommitmentEvidence]) -> ChangeAssessment {
            let proposed: CommitmentAmount
            switch raw.proposedMode {
            case "fixed"?: proposed = .fixed(CommitmentsValidation.money(fromText: raw.proposedAmount))
            case "range"?: proposed = .range(minimum: CommitmentsValidation.money(fromText: raw.proposedMinimumAmount),
                                             maximum: CommitmentsValidation.money(fromText: raw.proposedMaximumAmount))
            default: proposed = .unavailable
            }
            let proposedExact: Bool
            switch proposed {
            case .fixed(let money): proposedExact = money.money != nil
            case .range(let minimum, let maximum): proposedExact = minimum.money != nil && maximum.money != nil
            case .unavailable: proposedExact = false
            }
            let ids = Set(raw.evidenceExpenseIds ?? [])
            let evidence = observations.filter { ids.contains($0.expenseId) }
            let exact = proposedExact && !ids.isEmpty && evidence.count == ids.count && evidence.allSatisfy { $0.amount.money != nil }
            return ChangeAssessment(dimension: .amount, fingerprint: identity.fingerprint, decision: identity.decision,
                                    proposal: .amount(proposed), evidence: evidence, isExact: exact)
        }
    }

    private struct RawResponse: Decodable {
        let evaluatedOn: String?
        let changes: [RawChange]
        enum Keys: String, CodingKey { case evaluatedOn, changes }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            evaluatedOn = try? c.decode(String.self, forKey: .evaluatedOn)
            changes = try c.decode([RawChange].self, forKey: .changes)
        }
    }

    static func parse(_ data: Data) throws -> CommitmentChangesSnapshot {
        guard let raw = try? JSONDecoder().decode(RawResponse.self, from: data) else {
            throw CommitmentsValidation.ParseError.malformed
        }
        return CommitmentChangesSnapshot(evaluatedOn: raw.evaluatedOn.flatMap(CalendarDate.init),
                                         changes: raw.changes.map(\.change))
    }
}
