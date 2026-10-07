import { describe, expect, it } from "vitest";
import i18n from "../../shared/localization/i18n";
import { mapResendFailure, mapSubmitError, translateDescriptors } from "./authMessages";

const t = i18n.getFixedT("en", "auth");
const email = "person@example.com";
const registerErr = (data, status = 400) => ({ response: { status, data } });

describe("mapSubmitError", () => {
  it.each([
    ["PasswordTooShort", "Passwords must be at least 6 characters."],
    ["PasswordRequiresNonAlphanumeric", "Passwords must have at least one non alphanumeric character."],
    ["PasswordRequiresDigit", "Passwords must have at least one digit ('0'-'9')."],
    ["PasswordRequiresLower", "Passwords must have at least one lowercase ('a'-'z')."],
    ["PasswordRequiresUpper", "Passwords must have at least one uppercase ('A'-'Z')."],
    ["PasswordRequiresUniqueChars", "Passwords must use at least 1 different characters."],
    ["DuplicateUserName", "Username 'person@example.com' is already taken."],
    ["DuplicateEmail", "Email 'person@example.com' is already taken."],
    ["InvalidEmail", "Email 'person@example.com' is invalid."],
    ["InvalidUserName", "Username 'person@example.com' is invalid, can only contain letters or digits."],
  ])("maps Identity code %s", (code, expected) => {
    const mapped = mapSubmitError(registerErr([{ code, description: "server text" }]), { mode: "register", email });
    expect(mapped.kind).toBe("error");
    expect(translateDescriptors(t, mapped.messages)).toBe(expected);
  });

  it("shows known lines plus one deduplicated fallback for unknown codes", () => {
    const mapped = mapSubmitError(
      registerErr([{ code: "PasswordRequiresDigit" }, { code: "Nope" }, { code: "constructor" }, { code: "PasswordRequiresDigit" }, {}]),
      { mode: "register", email },
    );
    expect(mapped.messages.map((m) => m.key)).toEqual(["errors.identity.PasswordRequiresDigit", "errors.registration.failed"]);
  });

  it("uses the registration fallback for empty or all-unknown arrays", () => {
    expect(mapSubmitError(registerErr([]), { mode: "register", email }).messages).toEqual([{ key: "errors.registration.failed" }]);
    expect(mapSubmitError(registerErr([{ code: "__proto__" }]), { mode: "register", email }).messages).toEqual([{ key: "errors.registration.failed" }]);
  });

  it("maps the registration delivery failure code", () => {
    const mapped = mapSubmitError(registerErr({ code: "confirmation_email_delivery_failed", message: "x" }, 503), { mode: "register", email });
    expect(mapped).toEqual({ kind: "deliveryFailed", message: { key: "errors.registration.deliveryFailed" } });
  });

  it("maps the two exact login 401 literals", () => {
    const bad = mapSubmitError(registerErr("Invalid email or password", 401), { mode: "login", email });
    const unconfirmed = mapSubmitError(registerErr("Please confirm your email before logging in.", 401), { mode: "login", email });
    expect(bad.messages).toEqual([{ key: "errors.login.invalidCredentials" }]);
    expect(unconfirmed.messages).toEqual([{ key: "errors.login.emailNotConfirmed" }]);
  });

  it.each(["invalid email or password", "Invalid email or password ", " Invalid email or password", "Invalid credentials", "", null])(
    "falls back for near-miss login 401 body %j",
    (body) => {
      const mapped = mapSubmitError(registerErr(body, 401), { mode: "login", email });
      expect(mapped.messages).toEqual([{ key: "errors.login.failed" }]);
    },
  );

  it("does not apply login literals outside login or outside 401", () => {
    expect(mapSubmitError(registerErr("Invalid email or password", 400), { mode: "login", email }).messages).toEqual([{ key: "errors.generic" }]);
    expect(mapSubmitError(registerErr("Invalid email or password", 401), { mode: "register", email }).messages).toEqual([{ key: "errors.generic" }]);
  });

  it.each([
    ["network error", new Error("Network Error")],
    ["validation object", registerErr({ title: "One or more validation errors occurred.", errors: {} })],
    ["HTML string", registerErr("<html>Bad gateway</html>", 502)],
    ["undefined", undefined],
  ])("falls back to the generic message for %s", (_, err) => {
    for (const mode of ["login", "register"]) {
      expect(mapSubmitError(err, { mode, email }).messages).toEqual([{ key: "errors.generic" }]);
    }
  });

  it("returns only catalog keys and never echoes server text", () => {
    const cases = [
      registerErr("Invalid email or password", 401),
      registerErr([{ code: "Nope", description: "LEAK" }]),
      registerErr({ message: "LEAK" }),
      new Error("LEAK"),
    ];
    for (const err of cases) {
      for (const mode of ["login", "register"]) {
        const mapped = mapSubmitError(err, { mode, email });
        for (const m of mapped.messages) {
          expect(i18n.exists(m.key, { ns: "auth" })).toBe(true);
          expect(translateDescriptors(t, [m])).not.toContain("LEAK");
        }
      }
    }
  });
});

describe("mapResendFailure", () => {
  it("maps 429 and everything else", () => {
    expect(mapResendFailure({ response: { status: 429 } })).toEqual({ key: "resend.rateLimited" });
    expect(mapResendFailure({ response: { status: 500 } })).toEqual({ key: "resend.failed" });
    expect(mapResendFailure(new Error("x"))).toEqual({ key: "resend.failed" });
  });
});
