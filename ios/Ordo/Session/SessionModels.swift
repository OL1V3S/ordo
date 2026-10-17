import Foundation

/// Short-lived bearer token. Memory only; never persisted.
struct AccessToken: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let value: String
    var description: String { "AccessToken(redacted)" }
    var debugDescription: String { description }
}

/// The long-lived refresh credential. Persisted only in the Keychain.
struct DeviceCredential: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let refreshToken: String
    var description: String { "DeviceCredential(redacted)" }
    var debugDescription: String { description }
}

enum SignedOutReason: Equatable, Sendable {
    case none
    case sessionEnded
}

enum SessionState: Equatable, Sendable {
    case restoring
    case signedOut(SignedOutReason)
    case signedIn
}
