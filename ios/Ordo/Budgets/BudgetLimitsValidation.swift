import Foundation

/// Reads the body of `GET /api/budgetlimits?monthYear=YYYY-MM`.
///
/// The response must be a JSON array of rows with a positive `id`, a string `category` and a
/// `monthYear` that belongs to the month that was asked for; anything else makes the whole
/// response malformed and no row is shown. The month is never inferred. The one softness is the
/// limit, as on the web's `parseBudgetLimit`: it must be a JSON number inside the exact range, and
/// anything else degrades only that row to "Exact limit unavailable". Nothing is repaired.
///
/// The owner id (`userId`) and `user` are not declared, so they are never decoded, stored, shown,
/// logged or sent.
enum BudgetLimitsValidation {
    enum ParseError: Error, Equatable { case malformed }

    /// Limits of 2^46 dollars or more are "unavailable" on the web (`UNSAFE_NUMERIC_DOLLARS`) and in
    /// the app. This is the largest limit the app reads or saves, in cents (70368744177663.99).
    static let maximumLimitCents: Int64 = 70_368_744_177_664 * 100 - 1

    private struct RawRow: Decodable {
        let id: Int
        let category: String
        let monthYear: String
        let limitNumber: Decimal?

        private enum CodingKeys: String, CodingKey { case id, category, monthYear, limitAmount }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(Int.self, forKey: .id)
            category = try container.decode(String.self, forKey: .category)
            monthYear = try container.decode(String.self, forKey: .monthYear)
            // A string, null, boolean or missing limit is not a number: that row needs review.
            limitNumber = try? container.decode(Decimal.self, forKey: .limitAmount)
        }
    }

    static func parse(_ data: Data, month: BudgetMonth) throws -> [BudgetLimitRow] {
        guard let rows = try? JSONDecoder().decode([RawRow].self, from: data) else { throw ParseError.malformed }
        var result: [BudgetLimitRow] = []
        result.reserveCapacity(rows.count)
        for row in rows {
            guard row.id > 0, belongs(row.monthYear, to: month) else { throw ParseError.malformed }
            result.append(BudgetLimitRow(id: row.id, category: row.category, limit: limit(from: row.limitNumber)))
        }
        return result
    }

    /// The first 7 characters are `\d{4}-\d{2}`, followed by the end of the string or `-`, and equal
    /// the requested key. That tolerates `2026-10-01T00:00:00Z`, `2026-10-01T00:00:00` and the
    /// invariant's future `2026-10`.
    static func belongs(_ monthYear: String, to month: BudgetMonth) -> Bool {
        let bytes = Array(monthYear.utf8)
        guard bytes.count >= 7, bytes.count == 7 || bytes[7] == 0x2D else { return false }
        return String(decoding: bytes[0..<7], as: UTF8.self) == month.key
    }

    /// A port of `parseBudgetLimit`: finite, zero or more, below 2^46 dollars and at most two
    /// decimals. Exact `Decimal` arithmetic only; there is no `Double`.
    static func limit(from number: Decimal?) -> BudgetLimitValue {
        guard let number, number.isFinite, number >= 0 else { return .needsReview }
        var scaled = number * 100
        var rounded = Decimal()
        NSDecimalRound(&rounded, &scaled, 0, .plain)
        guard rounded == scaled, rounded <= Decimal(maximumLimitCents),
              let money = Money.fromCents(NSDecimalNumber(decimal: rounded).int64Value) else { return .needsReview }
        return .exact(money)
    }
}
