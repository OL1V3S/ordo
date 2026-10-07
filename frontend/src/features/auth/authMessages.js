// Maps auth failures to catalog descriptors ({ key, values }) in the `auth`
// namespace. The helper never returns or echoes server text; components
// translate descriptors at render so messages follow the language.

// Whitelist of Identity error codes the backend can return from registration.
// Looked up with Object.hasOwn; keys are never built from server input.
const IDENTITY_KEYS = {
  PasswordTooShort: "errors.identity.PasswordTooShort",
  PasswordRequiresNonAlphanumeric: "errors.identity.PasswordRequiresNonAlphanumeric",
  PasswordRequiresDigit: "errors.identity.PasswordRequiresDigit",
  PasswordRequiresLower: "errors.identity.PasswordRequiresLower",
  PasswordRequiresUpper: "errors.identity.PasswordRequiresUpper",
  PasswordRequiresUniqueChars: "errors.identity.PasswordRequiresUniqueChars",
  DuplicateUserName: "errors.identity.DuplicateUserName",
  DuplicateEmail: "errors.identity.DuplicateEmail",
  InvalidEmail: "errors.identity.InvalidEmail",
  InvalidUserName: "errors.identity.InvalidUserName",
};
// The password-length numbers in these messages are hard-coded to the project's
// default Identity options (minimum length 6, one unique character); they are
// not parsed from server text.

// Documented narrow exception (docs/localization.md): the login endpoint returns
// these two 401s as plain text without a code. Exact whole-string match only.
// Must stay identical to backend/Controllers/AuthController.cs lines 121, 126
// ("Invalid email or password") and 129 ("Please confirm your email before
// logging in."). A reworded backend message falls back to errors.login.failed.
const LOGIN_INVALID_CREDENTIALS = "Invalid email or password";
const LOGIN_EMAIL_NOT_CONFIRMED = "Please confirm your email before logging in.";

export const GENERIC_MESSAGE = { key: "errors.generic" };

export function mapSubmitError(err, { mode, email }) {
  const data = err?.response?.data;
  const status = err?.response?.status;

  if (mode === "register" && data && data.code === "confirmation_email_delivery_failed") {
    return { kind: "deliveryFailed", message: { key: "errors.registration.deliveryFailed" } };
  }

  if (mode === "register" && Array.isArray(data)) {
    const messages = [];
    let hasUnknown = false;
    for (const item of data) {
      const code = item && typeof item.code === "string" ? item.code : null;
      if (code !== null && Object.hasOwn(IDENTITY_KEYS, code)) {
        const key = IDENTITY_KEYS[code];
        if (!messages.some((m) => m.key === key)) messages.push({ key, values: { email } });
      } else {
        hasUnknown = true;
      }
    }
    if (hasUnknown || messages.length === 0) messages.push({ key: "errors.registration.failed" });
    return { kind: "error", messages };
  }

  if (mode === "login" && status === 401) {
    if (data === LOGIN_INVALID_CREDENTIALS) {
      return { kind: "error", messages: [{ key: "errors.login.invalidCredentials" }] };
    }
    if (data === LOGIN_EMAIL_NOT_CONFIRMED) {
      return { kind: "error", messages: [{ key: "errors.login.emailNotConfirmed" }] };
    }
    return { kind: "error", messages: [{ key: "errors.login.failed" }] };
  }

  return { kind: "error", messages: [GENERIC_MESSAGE] };
}

export function mapResendFailure(err) {
  return err?.response?.status === 429
    ? { key: "resend.rateLimited" }
    : { key: "resend.failed" };
}

export function translateDescriptors(t, descriptors) {
  return descriptors.map((d) => t(d.key, d.values)).join("\n");
}
