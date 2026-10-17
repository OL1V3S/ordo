import Foundation
import Security
import Testing
@testable import Ordo

@Suite struct KeychainCredentialStoreTests {
    private func makeStore() -> KeychainCredentialStore {
        KeychainCredentialStore(service: "ordo.tests.\(UUID().uuidString)")
    }

    @Test func roundTrip() throws {
        let store = makeStore()
        defer { try? store.delete() }
        #expect(try store.read() == nil)
        try store.save("synthetic-1")
        #expect(try store.read() == "synthetic-1")
        try store.save("synthetic-2")
        #expect(try store.read() == "synthetic-2")
        try store.delete()
        #expect(try store.read() == nil)
        try store.delete()
    }

    @Test func itemIsAfterFirstUnlockThisDeviceOnlyAndNotSynchronizable() throws {
        let store = makeStore()
        defer { try? store.delete() }
        try store.save("synthetic-1")
        try store.save("synthetic-2") // an update must keep the policy
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: store.service,
            kSecAttrAccount as String: KeychainCredentialStore.account,
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        #expect(SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess)
        let attributes = result as? [String: Any]
        #expect(attributes?[kSecAttrAccessible as String] as? String == kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
        let sync = attributes?[kSecAttrSynchronizable as String]
        #expect(sync == nil || (sync as? NSNumber)?.boolValue == false)
    }

    @Test func freshInstallGuardClearsOnlyOnce() throws {
        let defaults = UserDefaults(suiteName: "ordo.tests.\(UUID().uuidString)")!
        let store = InMemoryCredentialStore(initial: "leftover")
        FreshInstallGuard.apply(defaults: defaults, store: store)
        #expect(store.value == nil)
        try store.save("current")
        FreshInstallGuard.apply(defaults: defaults, store: store)
        #expect(store.value == "current")
    }
}
