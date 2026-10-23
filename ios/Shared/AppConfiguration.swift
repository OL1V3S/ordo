import Foundation

/// The server address, read from the build configuration (`ORDO_API_BASE_URL`).
/// Release builds require HTTPS; Debug builds also allow plain HTTP for `localhost`/`127.0.0.1`.
/// A missing or invalid value yields nil and the app shows a "not set up" screen.
struct AppConfiguration: Equatable, Sendable {
    let baseURL: URL

    static func load(bundle: Bundle = .main) -> AppConfiguration? {
        #if DEBUG
        let allowLocalHTTP = true
        #else
        let allowLocalHTTP = false
        #endif
        return make(from: bundle.object(forInfoDictionaryKey: "ORDO_API_BASE_URL") as? String,
                    allowLocalHTTP: allowLocalHTTP)
    }

    static func make(from text: String?, allowLocalHTTP: Bool) -> AppConfiguration? {
        guard let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty,
              var components = URLComponents(string: trimmed),
              let scheme = components.scheme?.lowercased(), let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil else { return nil }
        switch scheme {
        case "https": break
        case "http":
            guard allowLocalHTTP, host == "localhost" || host == "127.0.0.1" else { return nil }
        default: return nil
        }
        while components.path.hasSuffix("/") { components.path.removeLast() }
        guard let url = components.url else { return nil }
        return AppConfiguration(baseURL: url)
    }
}
