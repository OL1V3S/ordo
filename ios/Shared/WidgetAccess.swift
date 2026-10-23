import Foundation
import Security

/// The widget's copy of the short-lived (2-hour) access token. The app writes it after sign-in and
/// after each refresh, and deletes it at sign-out. The refresh credential is never part of it.
struct WidgetAccess: Codable, Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let accessToken: String
    let savedAt: Date

    /// The app saves a new token at least every 2 hours while it runs; an older copy is not used.
    static let maximumAge: TimeInterval = 2 * 60 * 60
    /// A `savedAt` this far in the future (a clock change) is not trusted either.
    static let allowedClockSkew: TimeInterval = 5 * 60

    /// True when the copy is recent enough and the token's `exp` has not passed. Only then does the
    /// widget send it. A token whose `exp` cannot be read is never sent.
    func isUsable(now: Date) -> Bool {
        guard !accessToken.isEmpty,
              savedAt <= now.addingTimeInterval(Self.allowedClockSkew),
              now.timeIntervalSince(savedAt) < Self.maximumAge,
              let expiry = Self.expiry(of: accessToken) else { return false }
        return expiry > now
    }

    /// The `exp` claim of a JWT (seconds since 1970), read without verifying the signature: the
    /// server verifies it. Nil when the token is not a readable JWT.
    static func expiry(of token: String) -> Date? {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var base64 = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64.append("=") }
        guard let data = Data(base64Encoded: base64),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = json["exp"] as? NSNumber else { return nil }
        let seconds = exp.doubleValue
        guard seconds.isFinite, seconds > 0 else { return nil }
        return Date(timeIntervalSince1970: seconds)
    }

    /// Redacted: the token is never logged or printed.
    var description: String { "WidgetAccess(redacted)" }
    var debugDescription: String { "WidgetAccess(redacted)" }
}

/// Where the widget-access item lives. The access group comes from the Info.plist key that both
/// targets set from the same build setting (`ORDO_KEYCHAIN_SHARED_GROUP`).
struct WidgetAccessLocation: Equatable, Sendable {
    static let account = "widget-access"
    static let sharedGroupKey = "OrdoKeychainSharedGroup"
    static let serviceKey = "OrdoWidgetAccessService"

    let service: String
    let accessGroup: String?

    /// Service `<prefix>.ordo.widget` and the shared group, both from the Info.plist. Nil when
    /// either is missing, so nothing is read or written outside the shared group.
    static func load(bundle: Bundle = .main) -> WidgetAccessLocation? {
        guard let group = value(bundle, sharedGroupKey), let service = value(bundle, serviceKey) else { return nil }
        return WidgetAccessLocation(service: service, accessGroup: group)
    }

    private static func value(_ bundle: Bundle, _ key: String) -> String? {
        guard let text = bundle.object(forInfoDictionaryKey: key) as? String,
              !text.isEmpty, !text.contains("$(") else { return nil }
        return text
    }

    var identity: [String: Any] {
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: Self.account,
                                    kSecAttrSynchronizable as String: false]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }
}

/// Read-only access to the widget item. This is the only Keychain code the widget uses: it never
/// writes, refreshes or deletes, and it has no way to reach the refresh credential (that item is in
/// the app's private group, which the widget's entitlements do not include).
struct WidgetAccessReader: Sendable {
    let location: WidgetAccessLocation

    /// Nil when there is no item, or the item is empty or unreadable (treated as signed out).
    func read() -> WidgetAccess? {
        var query = location.identity
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data, !data.isEmpty,
              let access = try? JSONDecoder().decode(WidgetAccess.self, from: data),
              !access.accessToken.isEmpty else { return nil }
        return access
    }
}
