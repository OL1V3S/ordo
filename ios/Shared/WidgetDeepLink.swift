import Foundation

/// The two Home Screen widget buttons. The widget builds these URLs; the app parses them.
///
/// Only an exact `ordo-widget://capture/expense` or `ordo-widget://capture/deposit` is accepted.
/// Anything else (another scheme, host or path, a query, a fragment, a user or a port) is ignored.
/// A link carries no amount or other prefill, and the scheme is deliberately not registered in
/// `CFBundleURLTypes`, so other apps and web pages cannot open it.
enum WidgetDeepLink: Equatable, Sendable {
    case addExpense
    case addDeposit

    static let scheme = "ordo-widget"
    static let host = "capture"

    var url: URL {
        // The pieces are constants, so this never fails.
        switch self {
        case .addExpense: URL(string: "\(Self.scheme)://\(Self.host)/expense")!
        case .addDeposit: URL(string: "\(Self.scheme)://\(Self.host)/deposit")!
        }
    }

    static func parse(_ url: URL) -> WidgetDeepLink? {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == scheme, parts.host == host,
              parts.user == nil, parts.password == nil, parts.port == nil,
              parts.query == nil, parts.fragment == nil else { return nil }
        switch parts.path {
        case "/expense": return .addExpense
        case "/deposit": return .addDeposit
        default: return nil
        }
    }
}
