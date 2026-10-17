import Foundation
@testable import Ordo

struct StubResponse: Sendable {
    let status: Int
    let body: Data
    init(_ status: Int, _ body: Data = Data("{}".utf8)) { self.status = status; self.body = body }
    init(_ status: Int, fixture: String) throws { self.init(status, try Fixtures.data(fixture)) }
    init(_ status: Int, json: String) { self.init(status, Data(json.utf8)) }
}

/// Scripted transport: routes by URL path, records every request, never touches the network.
final class StubTransport: HTTPTransport, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest) async throws -> StubResponse
    private let lock = NSLock()
    private var routes: [String: Handler] = [:]
    private var requests: [URLRequest] = []

    func route(_ path: String, _ handler: @escaping Handler) {
        lock.lock(); defer { lock.unlock() }
        routes[path] = handler
    }

    func count(_ path: String) -> Int {
        lock.lock(); defer { lock.unlock() }
        return requests.filter { $0.url?.path == path }.count
    }

    func bodies(_ path: String) -> [Data] {
        lock.lock(); defer { lock.unlock() }
        return requests.filter { $0.url?.path == path }.compactMap(\.httpBody)
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let handler: Handler? = {
            lock.lock(); defer { lock.unlock() }
            requests.append(request)
            return routes[request.url?.path ?? ""]
        }()
        guard let handler else { throw URLError(.cannotConnectToHost) }
        let response = try await handler(request)
        let http = HTTPURLResponse(url: request.url!, statusCode: response.status, httpVersion: nil, headerFields: nil)!
        return (response.body, http)
    }
}

/// Holds a response until the test releases it, so overlapping calls are deterministic.
actor Gate {
    private var isOpen = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        if isOpen { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func release() {
        isOpen = true
        waiters.forEach { $0.resume() }
        waiters = []
    }
}

/// Waits for `count` participants to arrive before any of them continues.
actor Barrier {
    private let target: Int
    private var arrived = 0
    private var waiters: [CheckedContinuation<Void, Never>] = []
    init(_ target: Int) { self.target = target }

    func arrive() async {
        arrived += 1
        if arrived >= target {
            waiters.forEach { $0.resume() }
            waiters = []
        } else {
            await withCheckedContinuation { waiters.append($0) }
        }
    }
}

final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    func next() -> Int { lock.lock(); defer { lock.unlock() }; value += 1; return value }
}

func waitUntil(timeout: Duration = .seconds(5), _ condition: @Sendable () async -> Bool) async -> Bool {
    let deadline = ContinuousClock.now + timeout
    while ContinuousClock.now < deadline {
        if await condition() { return true }
        try? await Task.sleep(for: .milliseconds(5))
    }
    return await condition()
}
