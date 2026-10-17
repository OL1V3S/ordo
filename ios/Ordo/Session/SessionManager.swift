import Foundation
import os

/// Owns the device session. One refresh at a time: the server treats a second use of an
/// already-rotated credential as reuse and ends the session, so every refresh (launch restore
/// or a 401 retry) goes through the single shared `refreshTask`.
actor SessionManager {
    private let api: OrdoAPI
    private let store: CredentialStore
    private let logger = Logger(subsystem: "app.ordo", category: "session")

    private(set) var state: SessionState = .restoring
    private var accessToken: AccessToken?
    private var credential: DeviceCredential?
    /// Bumped by sign-in, sign-out and session end. A refresh captures it when it starts and
    /// ignores its own outcome (success, failure or offline) if it changed.
    private var generation = 0
    private var refreshTask: Task<AccessToken, Error>?

    /// State changes for the UI (single consumer).
    nonisolated let states: AsyncStream<SessionState>
    private let stateContinuation: AsyncStream<SessionState>.Continuation

    init(api: OrdoAPI, store: CredentialStore) {
        self.api = api
        self.store = store
        (states, stateContinuation) = AsyncStream.makeStream(of: SessionState.self, bufferingPolicy: .bufferingNewest(1))
        stateContinuation.yield(.restoring)
    }

    private func setState(_ newState: SessionState) {
        state = newState
        stateContinuation.yield(newState)
    }

    // MARK: Restore

    /// Launch: read the Keychain; with a credential present, refresh (the access token is never persisted).
    func restore() async {
        guard state == .restoring else { return }
        let stored: String?
        do { stored = try store.read() } catch {
            logger.error("Keychain read failed")
            setState(.signedOut(.none))
            return
        }
        guard let stored else {
            setState(.signedOut(.none))
            return
        }
        credential = DeviceCredential(refreshToken: stored)
        let started = generation
        do {
            _ = try await refresh(after: nil)
        } catch {
            // Session ended: refresh() already signed out. Offline or server trouble keeps the
            // credential; the next authorized request retries the refresh.
            if generation == started, state == .restoring { setState(.signedIn) }
        }
    }

    // MARK: Sign in / out

    func signIn(email: String, password: String) async throws {
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let response = try await api.createDeviceSession(email: trimmed, password: password)
        generation += 1
        refreshTask = nil
        // Persist before exposing the token.
        do { try store.save(response.refreshToken) } catch {
            logger.error("Keychain save failed at sign-in")
            let orphan = response.refreshToken
            Task { [api] in try? await api.signOut(refreshToken: orphan) }
            throw SessionError.storageFailed
        }
        credential = DeviceCredential(refreshToken: response.refreshToken)
        accessToken = AccessToken(value: response.accessToken)
        setState(.signedIn)
    }

    /// Local sign-out always completes, even offline; the server call is best effort.
    func signOut() async {
        let current = credential
        generation += 1
        refreshTask = nil
        clearLocalSession()
        setState(.signedOut(.none))
        if let current { try? await api.signOut(refreshToken: current.refreshToken) }
    }

    // MARK: Authorized requests

    /// Runs `operation` with the access token. On a 401 it refreshes once (single flight) and
    /// retries once; a second 401 signs the user out locally.
    func authorized<T: Sendable>(_ operation: @Sendable (AccessToken) async throws -> T) async throws -> T {
        let started = generation
        let token = try await currentToken()
        do {
            return try await operation(token)
        } catch APIError.unauthorized {
            let refreshed = try await refresh(after: token)
            do {
                return try await operation(refreshed)
            } catch APIError.unauthorized {
                if generation == started { endSession() }
                throw SessionError.signedOut
            }
        }
    }

    private func currentToken() async throws -> AccessToken {
        if let accessToken { return accessToken }
        guard credential != nil else { throw SessionError.signedOut }
        return try await refresh(after: nil)
    }

    // MARK: Single-flight refresh

    private func refresh(after failedToken: AccessToken?) async throws -> AccessToken {
        // The token already changed while the caller was failing: use the new one.
        if let failedToken, let current = accessToken, current != failedToken { return current }
        // Checked and set before any suspension point.
        if let refreshTask { return try await refreshTask.value }
        guard let credential else { throw SessionError.signedOut }
        let started = generation
        let api = self.api
        let sent = credential.refreshToken
        // Unstructured on purpose: cancelling a waiting caller must never cancel the refresh.
        let task = Task<AccessToken, Error> {
            do {
                let response = try await api.refresh(refreshToken: sent)
                return try self.finishRefresh(response, generation: started)
            } catch {
                throw self.finishRefresh(failure: error, generation: started)
            }
        }
        refreshTask = task
        return try await task.value
    }

    private func finishRefresh(_ response: DeviceSessionResponse, generation started: Int) throws -> AccessToken {
        guard started == generation else { throw SessionError.signedOut }
        do { try store.save(response.refreshToken) } catch {
            // Keep the new credential for this run; the next launch will find the old one and sign out.
            logger.error("Keychain save failed after refresh")
        }
        credential = DeviceCredential(refreshToken: response.refreshToken)
        let token = AccessToken(value: response.accessToken)
        accessToken = token
        refreshTask = nil
        if state != .signedIn { setState(.signedIn) }
        return token
    }

    private func finishRefresh(failure error: Error, generation started: Int) -> Error {
        guard started == generation else { return SessionError.signedOut }
        refreshTask = nil
        if case APIError.sessionEnded = error {
            endSession()
            return APIError.sessionEnded
        }
        return error
    }

    private func endSession() {
        generation += 1
        refreshTask = nil
        clearLocalSession()
        setState(.signedOut(.sessionEnded))
    }

    private func clearLocalSession() {
        do { try store.delete() } catch { logger.error("Keychain delete failed") }
        credential = nil
        accessToken = nil
    }
}
