import Foundation

enum PendingSaveLoad: Equatable, Sendable {
    case none
    case record(PendingSave)
    /// A file exists but cannot be read (corrupt, unknown schema version, or a read error).
    case unreadable
}

/// Storage for the single unresolved save. The record holds financial values, so it must stay on
/// this device.
protocol PendingSaveStore: Sendable {
    func load() -> PendingSaveLoad
    func save(_ record: PendingSave) throws
    /// Removing a record that does not exist succeeds.
    func clear() throws
}

/// A file in `Application Support/Ordo/Pending`, written atomically with file protection until
/// the first unlock (the same availability as the Keychain credential, so an outcome-driven
/// delete still works if the phone locks mid-request). The directory and file are excluded from
/// backups; nothing uses iCloud. The file is inside the app container, so an uninstall removes it.
struct FilePendingSaveStore: PendingSaveStore {
    let directory: URL

    static var defaultDirectory: URL {
        URL.applicationSupportDirectory.appending(path: "Ordo/Pending", directoryHint: .isDirectory)
    }

    var fileURL: URL { directory.appending(path: "pending-save.json", directoryHint: .notDirectory) }

    func load() -> PendingSaveLoad {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return .none }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let data = try? Data(contentsOf: fileURL),
              let record = try? decoder.decode(PendingSave.self, from: data),
              record.isWellFormed else { return .unreadable }
        return .record(record)
    }

    func save(_ record: PendingSave) throws {
        let manager = FileManager.default
        try manager.createDirectory(at: directory, withIntermediateDirectories: true,
                                    attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var excluded = URLResourceValues()
        excluded.isExcludedFromBackup = true
        var directoryURL = directory
        try directoryURL.setResourceValues(excluded)

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(record)
        try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        // An atomic write replaces the file, so the exclusion is applied again on every write.
        var savedURL = fileURL
        try savedURL.setResourceValues(excluded)
    }

    func clear() throws {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        try FileManager.default.removeItem(at: fileURL)
    }
}
