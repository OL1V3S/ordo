import Foundation

/// Storage for the single refresh credential.
protocol CredentialStore: Sendable {
    func read() throws -> String?
    /// Update-or-add; never delete-then-add, so a failure cannot lose the previous credential.
    func save(_ refreshToken: String) throws
    func delete() throws
}

/// First launch after install: a Keychain item can outlive an uninstall, so remove it once.
enum FreshInstallGuard {
    static let key = "hasLaunched"

    static func apply(defaults: UserDefaults, store: CredentialStore) {
        guard !defaults.bool(forKey: key) else { return }
        try? store.delete()
        defaults.set(true, forKey: key)
    }
}
