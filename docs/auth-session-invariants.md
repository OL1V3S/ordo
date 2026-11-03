# Auth and Session Invariants

This document states how authentication and sessions behave **today** (verified
against `main` at f1f7e0c; the access-token session check, #337, was added on
65a72d7). It describes current behavior; it does not approve
changes. Any change to a rule below needs its own approved issue (see
[`AGENTS.md`](../AGENTS.md)). Narrative design lives in
[`ARCHITECTURE.md`](../ARCHITECTURE.md); this file is the rule list.

"Pending" means designed and tracked but not shipped. "Not done" means
intentionally absent today.

## Credentials and lifetimes

| Credential | Lifetime | Where it lives |
| --- | --- | --- |
| Access token (JWT) | 2 hours, fixed; ends earlier when its session ends (see below) | Web: `localStorage`. iOS app: held in `SessionManager`; a copy goes to the shared Keychain item for the widget |
| Device session credential (native) | Idle 60 days, absolute 180 days | iOS Keychain (`AfterFirstUnlockThisDeviceOnly`, not synchronizable) |
| Web session credential | Same as above (same table and service) | HttpOnly cookie only, never in a body |
| Email confirmation / password reset token | ASP.NET Identity default token provider; no lifespan configured in this repo | Emailed link |

- Idle timeout counts from the last successful refresh (or creation).
- Absolute lifetime counts from creation. Refresh never extends it.
- Defaults are code defaults in `DeviceSessionOptions`; nothing overrides them in `Program.cs`.
- The access token lifetime is hard-coded in `AuthController.GenerateJwtToken`.
- Session and stamp binding of access tokens: see [Access-token session check (#337)](#access-token-session-check-337).
- Unknown: the actual Identity default token lifespan is framework behavior and is not asserted by any repo test.

## Device sessions and web sessions

Both are the same session: one `DeviceSessions` row, owned by
`DeviceSessionService`. Only the transport differs.

- The row stores only a SHA-256 hash of the secret and a hash of the user's security stamp.
- Credential format: `base64url(16-byte id) "." base64url(32-byte secret)`. The id locates the row; the secret proves possession.
- Per-account cap: 20 sessions, shared by native and web. Creating a session evicts the least recently used one over the cap.
- Creating a session also deletes at most one batch (100) of expired rows.
- Native endpoints: `POST /api/auth/device-sessions`, `/refresh`, `/sign-out`. The credential travels in the request body (`refreshToken`); no cookie is read.
- Web endpoints: `POST /api/auth/web-session`, `/refresh`, `/sign-out`. The credential travels only in the cookie; a body credential is ignored.
- `/api/auth/login` is the older 2-hour sign-in: it issues only an access token and no session.
- Refresh is not covered by lockout (see below).

### Rotation and reuse

- Every refresh rotates the secret and returns a new access token.
- Presenting a rotated or forged secret for a real session id ends that whole session, including the newest credential.
- There is **no grace window** for retries or concurrent refreshes.
- Contract: **one refresher per credential at a time.** A client sharing a credential across processes must serialize refreshes and treat `401` as signed out.
- The iOS widget never holds the credential and never refreshes. It reads only the access token copy.
- Refresh runs in a Read Committed transaction that takes a row lock (`FOR UPDATE` on PostgreSQL). The loser of a race sees the committed rotation and gets `401`, not a `500`.
- A refresh also ends the session if it is expired, the user is gone, or the stored security-stamp hash no longer matches the user's stamp.
- Every refresh failure is the same `401 {"code":"session_invalid"}`. Sign-out never reveals whether the session existed and returns `204` for any well-formed body.
- A completed password reset deletes every session of that user (native and web).
- Web sign-in first signs out the session named by an existing cookie, so replaced sessions do not use up the cap.

### Web session cookie and CSRF

- Cookie `__Secure-ordo-web-session`: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/auth/web-session`, no `Domain`, `Max-Age` = idle timeout.
- Any refresh failure clears the cookie. Sign-out clears it even when the server call finds no session.
- The cookie alone never authenticates a protected API; those still need the bearer access token.
- Every web-session action runs behind `WebSessionGuardFilter`, a resource filter that runs before model validation:
  - header `X-Ordo-Web-Session: 1` is required;
  - `Origin` must equal `Frontend:BaseUrl` by parsed scheme, host and port (no path, query, fragment or userinfo);
  - otherwise `403`, nothing changes, and responses are `no-store`.
- CORS (`Program.cs`) allows two fixed origins, any header and method, and **no credentials**.
- The cookie is first-party because the browser calls `/api/auth/web-session/*` at a relative URL. `frontend/vercel.json` rewrites that path to the Render API; the Vite dev server proxies it. All other API calls go straight to Render with the bearer token.
- Web client behavior (`shared/auth/webSession.js`): refresh on boot, about 5 minutes before the JWT `exp`, and once after an authenticated `401` (then the request is retried once). Refresh is single-flight per tab and serialized across tabs with the Web Lock `ordo-web-session-refresh`. A refresh `401` signs out every tab; a network error or `5xx` never keeps an expired token.
- Sign-out failure sets a `pending-sign-out` flag that blocks auto-refresh and retries sign-out on next boot.

## Lockout (#299)

- Applies to the three password sign-in endpoints: `/api/auth/login`, `/api/auth/device-sessions`, `/api/auth/web-session`. Failures count across all three.
- Identity options in `Program.cs`: 5 failed attempts, then a 10 minute lockout, enabled for new users.
- A user with lockout disabled is never counted or locked.
- On PostgreSQL each attempt is **reserved atomically before the password is hashed** (conditional `UPDATE` of `AccessFailedCount`). Parallel guesses cannot exceed the budget. The 5th failure sets `LockoutEnd` and resets the count to 0.
- Self-heal: a row at the max count with no active lock becomes a normal timed lock on the next attempt.
- A locked account is rejected without checking its stored hash. A dummy hash is verified instead (see Enumeration policy).
- The in-memory test provider uses the Identity primitives in the same order. It is **not atomic** under parallel requests; it exists for tests only.
- A valid password resets the count, also for an unconfirmed account. The reset does not change the security stamp, so sessions keep refreshing.
- Guard-rejected web sign-ins (`403`) do not count.
- Refresh does not check lockout. Reset-password does not unlock.

## Enumeration policy

Uniform today (same client-visible response for every case: same status and body):

- **Sign-in** (all three endpoints): unknown email, wrong password, locked out, and unconfirmed (even with the right password, #318) all return `401`. The body is the plain text `Invalid email or password` on `/login` and `/web-session`, and `{"code":"invalid_credentials"}` on `/device-sessions`. No token, session, cookie or email is produced.
- **Register** (#300): a taken email gets the same `200` (or the same `503 confirmation_email_delivery_failed`) as a new one. The stored owner gets a fixed existing-account email (sign-in and forgot-password links, no token); the account is unchanged. Password-rule `400` errors are unchanged and never contain duplicate-account errors.
- **Registration limiter**: runs before the account check, so the same `429` applies to every email.
- **Sign-in timing** (#319): unknown email and locked account (both lockout branches) each verify one dummy password hash through the request's hasher, so they cost about the same as a wrong password. `PasswordTimingEqualizer` builds the dummy hash once at startup from the registered hasher, so it has the configured cost. It reads no account data. The stored hash of a locked account is never checked, so the lockout cap is unchanged. Every sign-in request now costs one hash; sign-in is limited per IP only (#332).
- **Reset password** (#319): an unknown email gets `400` with the same `InvalidToken` error array as a known email with a bad or malformed token (same status, content type and body). A weak new password with a bad token also gets `InvalidToken`; policy errors only appear once the token is valid.
- **Resend confirmation**: `202` with one message for unknown, confirmed, unconfirmed, delivery-failed and any other send error (apart from `429` and request validation `400`).
- **Forgot password**: `200` with one message for unknown, delivery-failed and any other send error (apart from `429` and request validation `400`).
- **Background email** (#319): for a matching account only, the request queues `{userId, language}` on an in-process queue (`IBackgroundEmailQueue`: bounded channel, capacity 256, single reader, `TryWrite` so a request never waits) and returns the generic response. `BackgroundEmailWorker` reloads the user (skips a deleted one), then runs the confirmed-state check (resend: send only if still unconfirmed), token, link and send with the host stopping token, not the request token. Response time and status no longer depend on the account.
  - The worker wraps everything per item in a catch-all so the host never stops. Delivery failures log a warning by user ID; other errors log the exception type and user ID. The email is never logged. Shutdown cancellation is a normal stop.
  - A full queue drops the item and logs a warning by user ID; the response is unchanged. Queued emails are lost if the process restarts; the user can request again.
  - Intended change: a non-delivery exception or request cancellation on the send used to give `500` for existing accounts only. It now gives the same `200`/`202` as an unknown email.
  - Forgot-password now sends to and links the stored `user.Email`, as resend and register do. It differs from the submitted address only in letter case.
  - Registration is not moved: it must report delivery failure (`503`).
- **Clients**: web and iOS show a neutral hint and an inline resend after any invalid-credentials failure, never "unconfirmed".
- Logs use user IDs only, never emails or credentials.

Remaining oracles and residuals (#319 is done: sign-in timing, reset-password, resend and forgot-password timing are removed):

- Residual resend and forgot-password timing: only the in-request queue write for a matching account (microseconds).
- Residual sign-in timing: the relational path does 2 `ExecuteUpdate` round trips for a wrong password, 2 for a locked account, 3 for a success and 0 for an unknown email. That is a few ms against about 100 ms for the hash; accepted, no no-op updates added.
- Residual reset-password timing: a known email with a decodable bad token runs a Data Protection unprotect (microseconds).
- The sign-in failure-count side effect is not client-visible and is not considered an oracle: an unconfirmed account with the right password resets the count, a wrong password increments it (see the lockout section).
- Out of scope for #319: `confirm-email` returns `400 "Invalid user"` for an unknown user id (the key is a GUID); registration timing (#300, #317).

## JWT parameters

- Algorithm HS256 (`SecurityAlgorithms.HmacSha256`), symmetric key from `Jwt:Key` (the current key: it signs and validates). The app refuses to start if it is missing.
- **Key rotation** (#338): optional `Jwt:PreviousKey` (Render `Jwt__PreviousKey`) is validation only and never signs. Tokens carry no `kid`, so the handler tries both keys (`IssuerSigningKey` = current, `IssuerSigningKeys` = previous). A previous-key token must still pass every other check (iss, aud, lifetime, session check) and is accepted until its own `exp` plus skew. Issued tokens always use the current key. Procedures: [`operations-runbook.md`](operations-runbook.md).
- Both keys are read once at startup as raw UTF-8 bytes (no trim, no base64). An empty or whitespace previous key means "not configured": validation parameters are then exactly what they were before #338. With a previous key set, startup fails if either key is under 32 bytes or the two are equal. Messages name config keys, never values. `backend/Authentication/JwtSigningKeys.cs`.
- Claims: `NameIdentifier` (user id), `Email`, `Name`, `iss`, `aud`, `exp`, plus exactly one of `sid` (device and web session tokens) or `ordo_stamp` (`/login` tokens), see the session check section.
- `iss` = `ordo-api`, `aud` = `ordo-clients`. Constants in `backend/Authentication/AccessTokenClaims.cs`, not configuration.
- **Issuing** (#301 phase 1): all token paths issue them: login, device session create and refresh, web session create and refresh.
- **Validation: on** (#301 phase 2). `ValidateIssuer` and `ValidateAudience` are `true` with `ValidIssuer = ordo-api` and `ValidAudience = ordo-clients`, alongside the signature (`ValidateIssuerSigningKey`) and default lifetime checks. An `aud` array is accepted if it contains `ordo-clients`.
- A token with a missing or wrong `iss` or `aud` gets `401`. Older tokens issued before phase 1 carry neither claim and are rejected; clients recover by refreshing their session or signing in again.

## Access-token session check (#337)

- Every request that carries a bearer token is checked, after signature, `iss`/`aud` and lifetime, in `JwtBearerEvents.OnTokenValidated` (`AccessTokenSessionValidation`, `DeviceSessionService.IsAccessTokenCurrentAsync`). A failing token gets the normal bearer `401` (`error="invalid_token"`), the same as an expired token. It happens before any controller runs, so a `401` still means nothing ran. No `OnAuthenticationFailed` result is set; the failure text is fixed and no ids or tokens are logged.
- **Device-session and web-session tokens** carry `sid`: the session id protected with ASP.NET Data Protection (purpose `BudgetPlanner.Authentication.AccessTokenSessionId.v1`). The raw session id is never in a JWT, because native sign-out and refresh act on a well-formed credential without checking its secret and an expired token still carries `sid`. Keys persist in the database; if they are ever lost, access tokens get `401` and clients refresh and recover.
- **`/login` tokens** (no session; no shipped client calls `/login`) carry `ordo_stamp`: base64url SHA-256 of the security stamp.
- The check passes only when the token has exactly one of the two claims:
  - `sid`: it unprotects, the `DeviceSessions` row exists, `OwnerId` is the token's user, the session is not idle or absolutely expired (same rule as refresh), and the row's stamp hash equals the hash of the user's current stamp.
  - `ordo_stamp`: equals the hash of the user's current stamp (a missing user fails).
  - Neither claim (a token issued before #337), both, two of one, or a `sid` that does not unprotect: `401`.
- Claims are read by literal name from the validated principal. A claim-mapping change fails closed (`401`); `AccessTokenSessionCheckTests` pins the names and the principal.
- **Ends a token immediately**: sign-out of its session (native or web, including a web sign-in that replaces an old cookie); a completed password reset (sessions deleted and stamp changed, which also covers `/login` tokens); any other stamp change; a signing-key swap with no previous key (#338); reuse detection; eviction past the 20-session cap; session idle or absolute expiry; a deleted user.
- **Does not end a token**: lockout (it never revokes, so wrong guesses cannot sign the owner out); refresh and rotation (same session id); forgot-password, resend and confirm; sign-out of a different session.
- **Public endpoints**: the web client sends its bearer on the public auth calls too. A stale bearer there is not an error: authentication only sets the user, and only protected endpoints challenge. Sign-in and refresh keep working with a revoked token.
- **Cost**: one indexed primary-key `SELECT` per request that carries a bearer (a join of `DeviceSessions` and `AspNetUsers` for `sid`, one user row for `ordo_stamp`), `AsNoTracking`, no transaction, no lock, no write, no cache, so no staleness window. Data Protection reads its key ring from the database only when it refreshes it, not per request. Round-trip time from Render to Neon is not measured here.
- **Failure handling**: a database error is not turned into `401`. It reaches the safe `500` (fails closed), so an outage never signs clients out. A Data Protection failure that is not an invalid payload or unknown key (for example a database error while loading keys) is rethrown the same way. Logging: the bearer handler logs the exception once (type, message and stack; no token), then the exception handler writes its one privacy-safe line, so there is one line more than the single line described under Security headers and CSP.
- **Rollout**: tokens issued before #337 carry neither claim, so each client gets one `401` and then refreshes and retries (web and iOS already do). The iOS widget shows its "needs update" state until the app runs.
- Out of scope: sign-out-everywhere and a session list, a revocation table, caching, lockout changes, changing native sign-out or refresh secret checks.
- **Pending (#337 PR B)**: the web client still keeps the access token in `localStorage`; moving it to memory is a separate change.

## Email confirmation and password reset

- Both use ASP.NET Identity data-protection tokens, sent as Base64Url-encoded links built from `Frontend:BaseUrl`. Tokens are single purpose and not stored in Ordo tables.
- `RequireConfirmedEmail` is on; sign-in checks confirmation after the password and lockout checks.
- Data Protection keys persist in the database (`PersistKeysToDbContext`), so tokens survive restarts and redeploys. Restoring a database from before a key existed can invalidate outstanding tokens (see [`operations-runbook.md`](operations-runbook.md)).
- Reset-password changes the security stamp (Identity) and revokes all sessions. Access tokens issued earlier get `401` on their next request (see the session check section).

## Rate limiters

All are in-memory fixed-window limiters with code defaults. State is per process and resets on restart; they are not shared across instances.

| Endpoint | Global per minute | Per normalized email per minute |
| --- | --- | --- |
| `register` | 120 | 3 |
| `resend-confirmation` | 60 | 3 |
| `forgot-password` | 60 | 3 |

- Over limit returns `429` with no body detail.
- Sign-in endpoints have no per-account rate limit beyond account lockout; they do have the per-IP limit below.

### Per-client-IP limits (#332)

`ClientIpLimiter`: in-memory fixed window per `"{group}:{ip}"`, `QueueLimit = 0`, code defaults, no config keys.

| Group | Endpoints | Per IP per minute |
| --- | --- | --- |
| `sign-in` | `login`, `device-sessions`, `web-session` | 20 |
| `email` | `register`, `resend-confirmation`, `forgot-password` | 10 |

- **Ordering**: checked first in the controller. Sign-in: before `CheckPasswordWithLockoutAsync`, so a rejected request costs no hash and does not count toward lockout. Email endpoints: per-IP, then global, then per-email; a per-IP rejection uses none of the others.
- The same `429` applies whether or not the account exists.
- **Trust model**: outside Development, `UseForwardedHeaders` (X-Forwarded-For only, `ForwardLimit = 1`, known proxies and networks cleared) runs right after `UseExceptionHandler`. It uses only the rightmost entry, which Render's edge appends; client-sent entries to the left are ignored. The scheme is not forwarded, so HTTPS redirection is unchanged. If the app were reached without a proxy, a client could choose its own IP; Render always sits in front.
- A request with no known IP shares one `unknown` partition.
- State is in memory and resets on restart (single instance). Idle partitions are not evicted. Clients behind one NAT share a limit. Rotating IPs is still limited only by the global limits and lockout.
- **Post-deploy check**: confirm the Render logs or headers show one proxy hop. If not, all clients share one bucket.
- **Timing (criterion 6, #332)**: `ClientIpThrottleTests.Measure_known_wrong_password_versus_unknown_email_timing` (opt in with `ORDO_MEASURE_TIMING=1`; 20 warm-up and 200 measured pairs, real `PasswordHasher`, in-memory provider, macOS arm64, 8 CPUs, .NET 9.0.1). Medians: known email with wrong password 48.35 ms, unknown email 47.46 ms, a 1.84% difference, under the 5% bar. Accepted; no further evening-out. The number is for the in-memory provider; PostgreSQL round trips are not measured.

## Security headers and CSP

- Production headers come from `frontend/vercel.json` and apply to the web app: CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`.
- CSP: `default-src 'self'`, one hash-pinned inline script, `connect-src` limited to self plus the Render API, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`. It restricts where a stolen `localStorage` token could be sent, but does not make `localStorage` safe against XSS.
- The API itself sets no security headers; it relies on HTTPS redirection.
- Server errors: unhandled exceptions return a safe `500` problem body with a code and trace id and one privacy-safe log line (one more line from the bearer handler when the failure happens in the session check, see above). `GET /health` and `GET /health/ready` are anonymous; readiness returns only a fixed up/down body.

## Intentionally not done

- **No access-token revocation list.** Revocation is the per-request session check (see above); there is no table of revoked tokens and no cache.
- **No `kid` in tokens.** Rotation (#338) uses a validation-only previous key and the handler tries both keys, so there is no token-format change and no key fingerprint in headers.
- **`ValidAlgorithms` is not pinned.** The handler default applies.
- **No clock-skew override.** The default lifetime validation applies, so a token is accepted for a few minutes past `exp`.
- **No refresh grace window** and no multi-refresher support (see Rotation and reuse).
- **No refresh lockout check.** A locked account's existing sessions still refresh.
- **No MFA, passkeys or social sign-in endpoints** exist in `AuthController`.
- **No endpoint to list sessions or sign out everywhere.** Sign-out ends only the named session; only a password reset revokes all. A key swap alone does not end sessions (clients refresh); the owner-run end-all-sessions step in the runbook does.
- **No iOS universal links.** No associated-domains configuration was found under `ios/`; confirm and reset links are web links.
- **No distributed rate limiting.** Per-IP limits exist (#332) but are per process.
- **No password policy beyond ASP.NET Identity defaults** (`Program.cs` does not customize it).
- **Web access token stays in `localStorage`** (readable by script); only the long-lived credential is HttpOnly.

## Where each rule is enforced and tested

| Rule | Enforced in | Tested in |
| --- | --- | --- |
| Lifetimes, rotation, reuse, cap, expiry | `backend/Authentication/DeviceSessionService.cs`, `DeviceSessionCredential.cs` | `backend.Tests/Auth/DeviceSessionFlowTests.cs`, `DeviceSessionCredentialTests.cs`, `PostgreSqlDeviceSessionTests.cs` |
| Web cookie and CSRF guard | `backend/Authentication/WebSession.cs`, `AuthController` web-session actions | `backend.Tests/Auth/WebSessionFlowTests.cs` |
| Lockout | `AuthController.CheckPasswordWithLockoutAsync`, `Program.cs` Identity options | `SignInLockoutTests.cs`, `PostgreSqlSignInLockoutTests.cs` |
| Uniform sign-in | `AuthController` login, device-session and web-session create | `SignInEnumerationTests.cs`, `DeviceSessionFlowTests.cs`, `WebSessionFlowTests.cs` |
| Uniform register | `AuthController.Register`, `RegistrationLimiter.cs` | `RegisterEnumerationTests.cs` |
| Background email (resend, forgot password) | `BackgroundEmailQueue.cs`, `BackgroundEmailWorker.cs`, `AuthController` | `BackgroundEmailTests.cs` |
| Per-IP throttle | `ClientIpLimiter.cs`, `AuthController`, `Program.cs` (forwarded headers) | `ClientIpThrottleTests.cs` |
| Resend and forgot password | `ConfirmationResendLimiter.cs`, `ForgotPasswordLimiter.cs`, `AuthController` | `AccountConfirmationFlowTests.cs`, `ForgotPasswordFlowTests.cs` |
| JWT claims and parameters | `AccessTokenClaims.cs`, `AuthController.GenerateJwtToken`, `Program.cs` | `AccessTokenClaimsTests.cs` (issued claims and rejection matrix) |
| JWT key rotation (#338) | `JwtSigningKeys.cs`, `Program.cs` | `JwtKeyRotationTests.cs` (overlap, removal, startup rules) |
| Access-token session check (#337) | `AccessTokenSessionValidation.cs`, `DeviceSessionService.IsAccessTokenCurrentAsync`, `AuthController`, `Program.cs` (`OnTokenValidated`) | `AccessTokenSessionCheckTests.cs`, `PostgreSqlAccessTokenSessionTests.cs` |
| Data Protection key persistence | `Program.cs` | `DataProtectionPersistenceTests.cs` |
| Safe errors and health | `backend/Diagnostics/UnhandledExceptionHandler.cs`, `Program.cs` | `backend.Tests/Diagnostics/ExceptionHandlingAndHealthTests.cs` |
| Security headers and CSP | `frontend/vercel.json` | `frontend/src/test/securityHeaders.test.js` |
| Web session client | `frontend/src/shared/auth/webSession.js`, `shared/api/webSessionClient.js` | `webSession.test.js`, `webSessionClient.test.js` |
| iOS credential storage | `ios/Ordo/Session/KeychainCredentialStore.swift`, `WidgetAccessStore.swift` | `ios/OrdoTests` (not re-verified here) |

Sign-in error literals are matched by the web client; see
[`localization.md`](localization.md) before changing any of them.
