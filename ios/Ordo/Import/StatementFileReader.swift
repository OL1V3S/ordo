import Foundation

/// Reads the picked PDF into memory only. It is never copied, cached or saved, and its name, path
/// and size are never logged.
enum StatementFileReader {
    static let maximumBytes = 10 * 1024 * 1024

    enum ReadError: Error, Equatable { case tooLarge, unreadable }

    /// Reads at most `maximumBytes + 1` bytes under security-scoped access and file coordination,
    /// then deletes the file when (and only when) it is a regular file inside the app's own
    /// temporary or Inbox folder (a copy made by the picker).
    static func read(_ url: URL, ownedRoots: [URL] = defaultOwnedRoots(),
                     limit: Int = maximumBytes) throws -> Data {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        defer { deleteIfOwnedCopy(url, ownedRoots: ownedRoots) }
        var coordinationError: NSError?
        var result: Result<Data, ReadError> = .failure(.unreadable)
        NSFileCoordinator().coordinate(readingItemAt: url, options: [.withoutChanges],
                                       error: &coordinationError) { readable in
            result = readBounded(readable, limit: limit)
        }
        if coordinationError != nil { throw ReadError.unreadable }
        return try result.get()
    }

    static func readBounded(_ url: URL, limit: Int) -> Result<Data, ReadError> {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return .failure(.unreadable) }
        defer { try? handle.close() }
        guard let data = try? handle.read(upToCount: limit + 1) else { return .failure(.unreadable) }
        return data.count > limit ? .failure(.tooLarge) : .success(data)
    }

    static func defaultOwnedRoots(fileManager: FileManager = .default) -> [URL] {
        var roots = [fileManager.temporaryDirectory]
        if let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first {
            roots.append(documents.appending(path: "Inbox", directoryHint: .isDirectory))
        }
        return roots
    }

    /// True only for a regular, non-symlink file strictly inside one of the roots.
    static func isOwnedCopy(_ url: URL, ownedRoots: [URL]) -> Bool {
        guard url.isFileURL else { return false }
        let values = try? url.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey])
        guard values?.isSymbolicLink != true, values?.isRegularFile == true else { return false }
        let path = url.resolvingSymlinksInPath().standardizedFileURL.pathComponents
        return ownedRoots.contains { root in
            let rootPath = root.resolvingSymlinksInPath().standardizedFileURL.pathComponents
            return path.count > rootPath.count && Array(path.prefix(rootPath.count)) == rootPath
        }
    }

    /// Best effort; a failure is ignored.
    static func deleteIfOwnedCopy(_ url: URL, ownedRoots: [URL]) {
        guard isOwnedCopy(url, ownedRoots: ownedRoots) else { return }
        try? FileManager.default.removeItem(at: url)
    }
}
