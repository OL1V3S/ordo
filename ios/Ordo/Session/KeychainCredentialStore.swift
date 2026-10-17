import Foundation
import Security

enum KeychainError: Error, Equatable { case unexpectedStatus(OSStatus) }

/// A generic-password item, available after first unlock, this device only, never synchronized
/// (so it is excluded from backups and iCloud). After-first-unlock lets a rotated credential
/// still be saved if the phone locks mid-refresh; losing that write would present a rotated
/// credential on the next launch, which the server treats as reuse and ends the session.
struct KeychainCredentialStore: CredentialStore {
    static let account = "device-session"
    let service: String

    init(service: String) { self.service = service }

    init(bundle: Bundle = .main) {
        self.init(service: "\(bundle.bundleIdentifier ?? "ordo").device-session")
    }

    private var identity: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: Self.account,
         kSecAttrSynchronizable as String: false]
    }

    func read() throws -> String? {
        var query = identity
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError.unexpectedStatus(status) }
        guard let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func save(_ refreshToken: String) throws {
        let data = Data(refreshToken.utf8)
        let update: [String: Any] = [kSecValueData as String: data,
                                     kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(identity as CFDictionary, update as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw KeychainError.unexpectedStatus(status) }
        var add = identity
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw KeychainError.unexpectedStatus(addStatus) }
    }

    func delete() throws {
        let status = SecItemDelete(identity as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError.unexpectedStatus(status) }
    }
}
