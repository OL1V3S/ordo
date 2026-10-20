import Foundation

/// A message on the account screens. Some carry the email the user typed (never server text).
struct AccountMessage: Equatable, Sendable {
    let key: L10nKey
    var email: String?

    func text(_ l10n: L10n) -> String {
        if let email { return l10n.string(key, email) }
        return l10n.string(key)
    }
}

/// What the Check email screen says on top.
enum CheckEmailNotice: Equatable, Sendable {
    /// `200`: the link was sent.
    case sent
    /// `503 confirmation_email_delivery_failed`: the account exists, the email failed.
    case deliveryFailed
    /// Timeout or lost connection: the account may exist. Never a definitive message.
    case outcomeUnknown
}

/// The uniform result of a resend: the same for any email.
enum ResendResult: Equatable, Sendable {
    case sent, rateLimited, failed

    var key: L10nKey {
        switch self {
        case .sent: .authResendSent
        case .rateLimited: .authResendRateLimited
        case .failed: .authResendFailed
        }
    }

    var tone: StatusTone { self == .sent ? .success : .danger }
}

/// The uniform result of a forgot-password request. Any failure (429 included) is `failed`, like the web.
enum ForgotResult: Equatable, Sendable {
    case sent, failed

    var key: L10nKey { self == .sent ? .authForgotPasswordSent : .authForgotPasswordFailed }
    var tone: StatusTone { self == .sent ? .success : .danger }
}

/// What a registration failure means. Only `code` values and the status decide.
enum RegisterOutcome: Equatable, Sendable {
    case checkEmail(CheckEmailNotice)
    case errors([AccountMessage])
}

enum AccountErrorMapping {
    static func identityKey(_ code: IdentityCode) -> L10nKey? {
        switch code {
        case .passwordTooShort: .authErrorsIdentityPasswordTooShort
        case .passwordRequiresNonAlphanumeric: .authErrorsIdentityPasswordRequiresNonAlphanumeric
        case .passwordRequiresDigit: .authErrorsIdentityPasswordRequiresDigit
        case .passwordRequiresLower: .authErrorsIdentityPasswordRequiresLower
        case .passwordRequiresUpper: .authErrorsIdentityPasswordRequiresUpper
        case .passwordRequiresUniqueChars: .authErrorsIdentityPasswordRequiresUniqueChars
        case .duplicateUserName: .authErrorsIdentityDuplicateUserName
        case .duplicateEmail: .authErrorsIdentityDuplicateEmail
        case .invalidEmail: .authErrorsIdentityInvalidEmail
        case .invalidUserName: .authErrorsIdentityInvalidUserName
        case .unknown: nil
        }
    }

    /// The web's `mapSubmitError` for registration: known codes deduped in server order, plus the
    /// generic registration failure when any code is unknown or there is none.
    static func identityMessages(_ codes: [IdentityCode], email: String) -> [AccountMessage] {
        var messages: [AccountMessage] = []
        var hasUnknown = codes.isEmpty
        for code in codes {
            guard let key = identityKey(code) else { hasUnknown = true; continue }
            let usesEmail = [IdentityCode.duplicateUserName, .duplicateEmail, .invalidEmail, .invalidUserName].contains(code)
            let message = AccountMessage(key: key, email: usesEmail ? email : nil)
            if !messages.contains(where: { $0.key == key }) { messages.append(message) }
        }
        if hasUnknown { messages.append(AccountMessage(key: .authErrorsRegistrationFailed)) }
        return messages
    }

    static func registerOutcome(for error: Error, email: String) -> RegisterOutcome {
        switch error {
        case APIError.confirmationDeliveryFailed: .checkEmail(.deliveryFailed)
        case APIError.registrationOutcomeUnknown: .checkEmail(.outcomeUnknown)
        case APIError.registrationRejected(let codes): .errors(identityMessages(codes, email: email))
        case APIError.offline: .errors([AccountMessage(key: .appOffline)])
        default: .errors([AccountMessage(key: .authErrorsGeneric)])
        }
    }

    static func resendResult(for error: Error) -> ResendResult {
        if case APIError.rateLimited = error { return .rateLimited }
        return .failed
    }
}
