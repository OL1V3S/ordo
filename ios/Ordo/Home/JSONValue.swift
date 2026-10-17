import Foundation

/// Minimal JSON tree used so Home validation can distinguish a missing key from `null`,
/// exactly like the web validator does.
enum JSONValue: Decodable, Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }

    /// nil when this is not an object or the key is absent.
    subscript(key: String) -> JSONValue? {
        if case .object(let object) = self { return object[key] }
        return nil
    }

    var stringValue: String? { if case .string(let value) = self { return value } else { return nil } }
    var arrayValue: [JSONValue]? { if case .array(let value) = self { return value } else { return nil } }
    var objectValue: [String: JSONValue]? { if case .object(let value) = self { return value } else { return nil } }
    var isNull: Bool { if case .null = self { return true } else { return false } }

    /// Mirrors `Number.isInteger` for the ids the backend sends.
    var integerValue: Int? {
        guard case .number(let value) = self, value.isFinite, value == value.rounded(),
              abs(value) < 9_007_199_254_740_992 else { return nil }
        return Int(value)
    }
}

extension Optional where Wrapped == JSONValue {
    /// True only when the key is present and explicitly `null`.
    var isExplicitNull: Bool { self?.isNull ?? false }
}
