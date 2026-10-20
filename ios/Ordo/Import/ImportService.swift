import Foundation

/// Reads and writes the statement import. `nil` from `openPreview` means there is no open preview.
protocol ImportService: Sendable {
    func openPreview() async throws -> ImportPreview?
    func preview(batchId: String) async throws -> ImportPreview
    func upload(_ body: ImportUploadBody) async throws -> ImportPreview
    func updateRow(batchId: String, rowId: String, body: Data) async throws -> ImportRow
    func select(batchId: String, body: Data) async throws -> ImportPreview
    func confirm(batchId: String) async throws -> ImportConfirmation
}

/// Production implementation: every call is authorized through the session. A response that cannot
/// be read throws `APIError.invalidResponse`, which the caller treats as an unknown outcome for a write.
struct SessionImportService: ImportService {
    let session: SessionManager
    let api: OrdoAPI

    private static func parse<T>(_ work: () throws -> T) throws -> T {
        do { return try work() } catch { throw APIError.invalidResponse }
    }

    func openPreview() async throws -> ImportPreview? {
        let api = self.api
        let data = try await session.authorized { token in try await api.importOpen(accessToken: token.value) }
        guard let data else { return nil }
        return try Self.parse { try ImportValidation.parsePreview(data) }
    }

    func preview(batchId: String) async throws -> ImportPreview {
        let api = self.api
        let data = try await session.authorized { token in try await api.importPreview(accessToken: token.value, batchId: batchId) }
        return try Self.parse { try ImportValidation.parsePreview(data) }
    }

    func upload(_ body: ImportUploadBody) async throws -> ImportPreview {
        let api = self.api
        let data = try await session.authorized { token in
            try await api.createImportPreview(accessToken: token.value, body: body.data, boundary: body.boundary)
        }
        return try Self.parse { try ImportValidation.parsePreview(data) }
    }

    func updateRow(batchId: String, rowId: String, body: Data) async throws -> ImportRow {
        let api = self.api
        let data = try await session.authorized { token in
            try await api.updateImportRow(accessToken: token.value, batchId: batchId, rowId: rowId, body: body)
        }
        return try Self.parse { try ImportValidation.parseRow(data) }
    }

    func select(batchId: String, body: Data) async throws -> ImportPreview {
        let api = self.api
        let data = try await session.authorized { token in
            try await api.updateImportSelection(accessToken: token.value, batchId: batchId, body: body)
        }
        return try Self.parse { try ImportValidation.parseSelection(data) }
    }

    func confirm(batchId: String) async throws -> ImportConfirmation {
        let api = self.api
        let data = try await session.authorized { token in try await api.confirmImport(accessToken: token.value, batchId: batchId) }
        return try Self.parse { try ImportValidation.parseConfirmation(data) }
    }
}
