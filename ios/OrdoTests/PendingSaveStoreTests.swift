import Foundation
import Testing
@testable import Ordo

@Suite struct PendingSaveStoreTests {
    private func makeStore() -> (FilePendingSaveStore, URL) {
        let root = FileManager.default.temporaryDirectory.appending(path: "ordo-pending-\(UUID().uuidString)", directoryHint: .isDirectory)
        return (FilePendingSaveStore(directory: root.appending(path: "Pending", directoryHint: .isDirectory)), root)
    }

    @Test func writesReadsAndClears() throws {
        let (store, root) = makeStore()
        defer { try? FileManager.default.removeItem(at: root) }
        #expect(store.load() == .none)
        let save = CaptureFixtures.save(description: "Café — 日本語 😀")
        try store.save(save)
        #expect(store.load() == .record(save))
        try store.clear()
        #expect(store.load() == .none)
        try store.clear() // clearing nothing succeeds
    }

    @Test func anAtomicOverwriteReplacesTheRecord() throws {
        let (store, root) = makeStore()
        defer { try? FileManager.default.removeItem(at: root) }
        try store.save(CaptureFixtures.save(amount: "1.00"))
        let second = CaptureFixtures.save(key: "99999999-2222-4333-8444-555555555555", amount: "2.00")
        try store.save(second)
        #expect(store.load() == .record(second))
        let files = try FileManager.default.contentsOfDirectory(atPath: store.directory.path)
        #expect(files == ["pending-save.json"]) // no leftover temporary file
    }

    @Test func theFileAndDirectoryAreExcludedFromBackupOnEveryWrite() throws {
        let (store, root) = makeStore()
        defer { try? FileManager.default.removeItem(at: root) }
        try store.save(CaptureFixtures.save())
        try store.save(CaptureFixtures.save(amount: "3.00")) // re-applied after the replacing write
        let directory = try store.directory.resourceValues(forKeys: [.isExcludedFromBackupKey])
        let file = try store.fileURL.resourceValues(forKeys: [.isExcludedFromBackupKey])
        #expect(directory.isExcludedFromBackup == true)
        #expect(file.isExcludedFromBackup == true)
    }

    @Test func fileProtectionIsAssertedWhereThePlatformReportsIt() throws {
        let (store, root) = makeStore()
        defer { try? FileManager.default.removeItem(at: root) }
        try store.save(CaptureFixtures.save())
        let attributes = try FileManager.default.attributesOfItem(atPath: store.fileURL.path)
        if let protection = attributes[.protectionKey] as? FileProtectionType {
            #expect(protection == .completeUntilFirstUserAuthentication || protection == .none)
        }
    }

    @Test func aCorruptFileIsUnreadable() throws {
        let (store, root) = makeStore()
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: store.directory, withIntermediateDirectories: true)
        try Data("{ not json".utf8).write(to: store.fileURL)
        #expect(store.load() == .unreadable)
        try store.clear()
        #expect(store.load() == .none)
    }

    @Test func anUnknownSchemaVersionIsUnreadable() throws {
        let (store, root) = makeStore()
        defer { try? FileManager.default.removeItem(at: root) }
        try store.save(CaptureFixtures.save())
        let text = try String(contentsOf: store.fileURL, encoding: .utf8).replacingOccurrences(of: "\"schemaVersion\":1", with: "\"schemaVersion\":2")
        try Data(text.utf8).write(to: store.fileURL)
        #expect(store.load() == .unreadable)
    }

    @Test func aWellShapedFileWithAlteredValuesIsUnreadable() throws {
        let (store, root) = makeStore()
        defer { try? FileManager.default.removeItem(at: root) }
        try store.save(CaptureFixtures.save())
        let text = try String(contentsOf: store.fileURL, encoding: .utf8).replacingOccurrences(of: "\"amount\":\"12.50\"", with: "\"amount\":\"-1\"")
        try Data(text.utf8).write(to: store.fileURL)
        #expect(store.load() == .unreadable)
    }

    @Test func theRecordHoldsNoCredentialOrAccountData() throws {
        let (store, root) = makeStore()
        defer { try? FileManager.default.removeItem(at: root) }
        try store.save(CaptureFixtures.save())
        let json = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: store.fileURL)) as? [String: Any])
        #expect(Set(json.keys) == ["schemaVersion", "kind", "key", "amount", "description", "date", "category", "createdAt"])
    }
}
