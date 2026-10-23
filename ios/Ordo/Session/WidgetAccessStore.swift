import Foundation
import Security
import WidgetKit

/// The app's side of the widget-access item: only the app writes or deletes it. It only ever
/// holds the 2-hour access token, never the refresh credential.
protocol WidgetAccessStore: Sendable {
    func save(_ access: WidgetAccess) throws
    func delete() throws
    /// Used when `delete` fails: replaces the value with empty bytes, which the widget reads as signed out.
    func overwriteWithEmpty() throws
    /// Asks WidgetKit to redraw the widget.
    func reloadWidget()
}

/// No widget item (tests and setups without a configured shared group).
struct DisabledWidgetAccessStore: WidgetAccessStore {
    func save(_ access: WidgetAccess) throws {}
    func delete() throws {}
    func overwriteWithEmpty() throws {}
    func reloadWidget() {}
}

/// The shared Keychain item: after first unlock (the widget may run while the phone is locked),
/// this device only, never synchronized.
struct KeychainWidgetAccessStore: WidgetAccessStore {
    let location: WidgetAccessLocation

    func save(_ access: WidgetAccess) throws {
        try write(JSONEncoder().encode(access))
    }

    func overwriteWithEmpty() throws {
        try write(Data())
    }

    func delete() throws {
        let status = SecItemDelete(location.identity as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError.unexpectedStatus(status) }
    }

    func reloadWidget() {
        WidgetCenter.shared.reloadAllTimelines()
    }

    private func write(_ data: Data) throws {
        let update: [String: Any] = [kSecValueData as String: data,
                                     kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(location.identity as CFDictionary, update as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw KeychainError.unexpectedStatus(status) }
        var add = location.identity
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw KeychainError.unexpectedStatus(addStatus) }
    }
}
