import Foundation
import Testing
@testable import Ordo

@Suite struct ImportAPITests {
    private let transport = StubTransport()
    private var api: OrdoAPI { OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport) }
    private let batch = ImportFixtures.batch

    @Test func openIsAnAuthorizedGetWithTheSourceAndANoContentMeansNone() async throws {
        transport.route("/api/import-previews/open") { _ in StubResponse(204, Data()) }
        #expect(try await api.importOpen(accessToken: "access-1") == nil)
        let request = try #require(transport.requests("/api/import-previews/open").first)
        #expect(request.httpMethod == "GET" && request.url?.query == "sourceType=sunflower_pdf")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
        #expect(request.httpBody == nil)
    }

    @Test func openReturnsABody() async throws {
        transport.route("/api/import-previews/open") { _ in StubResponse(200, json: ImportFixtures.previewJSON()) }
        #expect(try await api.importOpen(accessToken: "a") != nil)
    }

    @Test func theUploadSendsAFixedFileNameAndNeverTheUsersName() async throws {
        transport.route("/api/import-previews") { _ in StubResponse(201, json: ImportFixtures.previewJSON()) }
        let pdf = Data("%PDF-synthetic\u{0}bytes".utf8)
        let body = MultipartBody.make(pdf: pdf, boundary: "BOUNDARY-1")
        _ = try await api.createImportPreview(accessToken: "access-1", body: body.data, boundary: body.boundary)
        let request = try #require(transport.requests("/api/import-previews").first)
        #expect(request.httpMethod == "POST" && request.timeoutInterval == 60)
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "multipart/form-data; boundary=BOUNDARY-1")
        let expected = Data("--BOUNDARY-1\r\nContent-Disposition: form-data; name=\"sourceType\"\r\n\r\nsunflower_pdf\r\n--BOUNDARY-1\r\nContent-Disposition: form-data; name=\"file\"; filename=\"statement.pdf\"\r\nContent-Type: application/pdf\r\n\r\n".utf8)
            + pdf + Data("\r\n--BOUNDARY-1--\r\n".utf8)
        #expect(request.httpBody == expected)
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
    }

    @Test func rowSelectionAndConfirmRequests() async throws {
        transport.route("/api/import-previews/\(batch)/rows/\(ImportFixtures.row1)") { _ in StubResponse(200, json: ImportFixtures.rowJSON(ImportFixtures.row1)) }
        transport.route("/api/import-previews/\(batch)/selection") { _ in StubResponse(200, json: "{}") }
        transport.route("/api/import-previews/\(batch)/confirm") { _ in StubResponse(200, json: ImportFixtures.confirmationJSON()) }
        _ = try await api.updateImportRow(accessToken: "a", batchId: batch, rowId: ImportFixtures.row1, body: Data("{}".utf8))
        _ = try await api.updateImportSelection(accessToken: "a", batchId: batch, body: Data("{}".utf8))
        _ = try await api.confirmImport(accessToken: "a", batchId: batch)
        #expect(transport.requests("/api/import-previews/\(batch)/rows/\(ImportFixtures.row1)").first?.httpMethod == "PATCH")
        let confirm = try #require(transport.requests("/api/import-previews/\(batch)/confirm").first)
        #expect(confirm.httpMethod == "POST" && confirm.httpBody == nil)
        #expect(confirm.value(forHTTPHeaderField: "Idempotency-Key") == nil)
    }

    @Test func statusAndCodeMapping() async throws {
        transport.route("/api/import-previews") { _ in StubResponse(413, Data()) }
        await #expect(throws: APIError.importRefused(status: 413, code: nil)) {
            try await api.createImportPreview(accessToken: "a", body: Data(), boundary: "b")
        }
        transport.route("/api/import-previews") { _ in StubResponse(422, json: #"{"code":"encrypted_pdf","message":"server text"}"#) }
        await #expect(throws: APIError.importRefused(status: 422, code: "encrypted_pdf")) {
            try await api.createImportPreview(accessToken: "a", body: Data(), boundary: "b")
        }
        transport.route("/api/import-previews/\(batch)/confirm") { _ in StubResponse(404, Data()) }
        await #expect(throws: APIError.importRefused(status: 404, code: nil)) { try await api.confirmImport(accessToken: "a", batchId: batch) }
        transport.route("/api/import-previews/\(batch)/confirm") { _ in StubResponse(409, json: #"{"code":"duplicate_review_required","rows":[]}"#) }
        await #expect(throws: APIError.importRefused(status: 409, code: "duplicate_review_required")) { try await api.confirmImport(accessToken: "a", batchId: batch) }
        transport.route("/api/import-previews/\(batch)/confirm") { _ in StubResponse(500, json: #"{"code":"confirmation_failed"}"#) }
        await #expect(throws: APIError.server(500)) { try await api.confirmImport(accessToken: "a", batchId: batch) }
        transport.route("/api/import-previews/\(batch)/confirm") { _ in StubResponse(401, Data()) }
        await #expect(throws: APIError.unauthorized) { try await api.confirmImport(accessToken: "a", batchId: batch) }
    }
}

@Suite struct StatementFileReaderTests {
    private func makeRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appending(path: "reader-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    @Test func readsAtMostTheLimitPlusOneByte() throws {
        let root = try makeRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let exact = root.appending(path: "exact.pdf"), over = root.appending(path: "over.pdf")
        try Data(count: 8).write(to: exact)
        try Data(count: 9).write(to: over)
        #expect(try StatementFileReader.read(exact, ownedRoots: [], limit: 8).count == 8)
        #expect(throws: StatementFileReader.ReadError.tooLarge) { try StatementFileReader.read(over, ownedRoots: [], limit: 8) }
        #expect(StatementFileReader.maximumBytes == 10 * 1024 * 1024)
    }

    @Test func anOwnedCopyIsDeletedAfterTheRead() throws {
        let root = try makeRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appending(path: "copy.pdf")
        try Data(count: 4).write(to: file)
        _ = try StatementFileReader.read(file, ownedRoots: [root], limit: 8)
        #expect(!FileManager.default.fileExists(atPath: file.path))
    }

    @Test func anOwnedCopyThatIsTooLargeIsStillDeleted() throws {
        let root = try makeRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appending(path: "copy.pdf")
        try Data(count: 20).write(to: file)
        #expect(throws: StatementFileReader.ReadError.tooLarge) { try StatementFileReader.read(file, ownedRoots: [root], limit: 8) }
        #expect(!FileManager.default.fileExists(atPath: file.path))
    }

    @Test func nothingOutsideTheOwnedRootsIsEverDeleted() throws {
        let owned = try makeRoot(), other = try makeRoot()
        defer { try? FileManager.default.removeItem(at: owned); try? FileManager.default.removeItem(at: other) }
        let outside = other.appending(path: "user.pdf")
        try Data(count: 4).write(to: outside)
        _ = try StatementFileReader.read(outside, ownedRoots: [owned], limit: 8)
        #expect(FileManager.default.fileExists(atPath: outside.path))
        // A symlink inside the root pointing outside is not deleted, and neither is its target.
        let link = owned.appending(path: "link.pdf")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: outside)
        _ = try StatementFileReader.read(link, ownedRoots: [owned], limit: 8)
        #expect(FileManager.default.fileExists(atPath: outside.path))
        // A prefix lookalike directory is outside the root.
        let lookalike = URL(fileURLWithPath: owned.path + "-evil", isDirectory: true)
        try FileManager.default.createDirectory(at: lookalike, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: lookalike) }
        let file = lookalike.appending(path: "a.pdf")
        try Data(count: 4).write(to: file)
        #expect(!StatementFileReader.isOwnedCopy(file, ownedRoots: [owned]))
        // The root itself and a directory are never owned copies.
        #expect(!StatementFileReader.isOwnedCopy(owned, ownedRoots: [owned]))
        #expect(!StatementFileReader.isOwnedCopy(URL(fileURLWithPath: "/etc/hosts"), ownedRoots: [owned]))
    }

    @Test func aMissingFileIsUnreadable() throws {
        let root = try makeRoot(); defer { try? FileManager.default.removeItem(at: root) }
        #expect(throws: StatementFileReader.ReadError.unreadable) { try StatementFileReader.read(root.appending(path: "none.pdf"), ownedRoots: [root]) }
    }
}
