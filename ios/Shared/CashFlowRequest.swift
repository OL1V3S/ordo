import Foundation

/// The one read the app and the widget share: `GET /api/analytics/cash-flow`. Building the request
/// and reading the status live here so both use the same URL, headers and status rules.
enum CashFlowRequest {
    enum Outcome: Equatable, Sendable {
        case ok
        case unauthorized
        case server(Int)
    }

    static func make(baseURL: URL, accessToken: String, month: BudgetMonth, throughDate: CalendarDate) -> URLRequest? {
        var components = URLComponents(url: baseURL.appending(path: "api/analytics/cash-flow"), resolvingAgainstBaseURL: false)
        components?.percentEncodedQueryItems = [URLQueryItem(name: "month", value: month.key),
                                                URLQueryItem(name: "throughDate", value: throughDate.isoString)]
        guard let url = components?.url else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 30
        return request
    }

    static func outcome(status: Int) -> Outcome {
        switch status {
        case 200: .ok
        case 401: .unauthorized
        default: .server(status)
        }
    }
}
