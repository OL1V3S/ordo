import Foundation

/// Storage for the single refresh credential.
protocol CredentialStore: Sendable {
    func read() throws -> String?
    /// Update-or-add; never delete-then-add, so a failure cannot lose the previous credential.
    func save(_ refreshToken: String) throws
    func delete() throws
}

/// First launch after install: a Keychain item can outlive an uninstall, so remove it once. The
/// widget's access-token copy goes too (overwritten with empty bytes if the delete fails).
enum FreshInstallGuard {
    static let key = "hasLaunched"

    static func apply(defaults: UserDefaults, store: CredentialStore,
                      widgetAccess: WidgetAccessStore = DisabledWidgetAccessStore()) {
        guard !defaults.bool(forKey: key) else { return }
        try? store.delete()
        do { try widgetAccess.delete() } catch { try? widgetAccess.overwriteWithEmpty() }
        defaults.set(true, forKey: key)
    }
}
