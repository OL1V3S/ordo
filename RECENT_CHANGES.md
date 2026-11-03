# Recent Changes

This is Ordo's rolling, human-readable record of recent meaningful product and
engineering changes. For what Ordo does today, see
[PRODUCT_OVERVIEW.md](PRODUCT_OVERVIEW.md). GitHub pull requests and issues remain
the permanent, complete archive.

## Maintenance

- Record meaningful merged PRs or completed changes, not individual commits,
  pushes, or every bounded correction within a larger feature. Update this file
  in the implementation PR when appropriate.
- Each entry includes the merge/completion date, a linked PR number (and issue
  number where useful), a short human title, and 1–3 concise bullets describing
  what materially changed.
- Keep entries **newest first**, with **at most 20 entries**. When adding entry
  21, remove the oldest entry. This cap keeps the file readable; GitHub retains
  the full history.
- Skip trivial typo-only or formatting-only changes and mechanical maintenance
  with no meaningful product or engineering effect.
- Do not backfill older history. The completed **Ordo UX V3 work governed by
  [#127](https://github.com/OL1V3S/ordo/issues/127)** is the starting point for
  this history.

## History

### 2026-11-03 — One budget limit per category and month

[Issue #334](https://github.com/OL1V3S/ordo/issues/334)

- Budget categories are saved in canonical form (`Food` = `food`). Negative, over-precise and out-of-range limits are rejected; zero is allowed. Saving is an atomic upsert backed by a new unique index.
- The migration deletes nothing and aborts if existing rows are duplicates or non-canonical, so the owner runs a pre-check first. Web and iOS show localized messages for the new rejections.

### 2026-11-03 — Per-IP limits on sign-in and email endpoints

[Issue #332](https://github.com/OL1V3S/ordo/issues/332)

- Sign-in endpoints allow 20 requests a minute per client IP; register, resend and forgot-password allow 10. Over the limit returns the usual `429`, before any password hash or account lookup.
- The client IP comes from the rightmost `X-Forwarded-For` entry (Render's edge). Limits are in memory and reset on restart. No config, schema, web or iOS change.

### 2026-11-03 — Readiness check and deploy smoke script

[Issue #335](https://github.com/OL1V3S/ordo/issues/335)

- Added anonymous `/health/ready` (database reachability, fixed body, 503 when down); `/health` stays DB-free.
- Added `scripts/smoke-deploy.sh` and runbook guidance for post-deploy smoke and uptime monitors.

### 2026-11-03 — Budget limit save binds a request DTO

[PR #342](https://github.com/OL1V3S/ordo/pull/342) · [Issue #331](https://github.com/OL1V3S/ordo/issues/331)

- `POST /api/BudgetLimits` now binds a request type with `category`, `limitAmount` and `monthYear`, and returns a response type. Status codes and error texts are unchanged.
- The response no longer includes the always-null `user` key. No schema, web or iOS change.

### 2026-11-02 — Resend and forgot-password emails send in the background

[PR #324](https://github.com/OL1V3S/ordo/pull/324) · [Issue #319](https://github.com/OL1V3S/ordo/issues/319)

- Resend-confirmation and forgot-password now queue the email for an in-process worker, so response time no longer shows whether an account exists. Queued emails are lost on restart; the user can ask again.
- A non-delivery error or cancellation during the send now returns the normal `200`/`202` instead of `500` for existing accounts. Forgot-password sends to the stored address. No config, schema, web or iOS change.

### 2026-11-02 — Sign-in timing and reset-password no longer reveal accounts

[PR #323](https://github.com/OL1V3S/ordo/pull/323) · [Issue #319](https://github.com/OL1V3S/ordo/issues/319)

- Unknown emails and locked accounts now pay one dummy password hash at sign-in, so response time no longer shows whether an account exists. The stored hash of a locked account is still never checked.
- `reset-password` answers an unknown email with the same `InvalidToken` error as a known email with a bad token. No config, schema, web or iOS change. Resend and forgot-password timing follow in a second PR.

### 2026-11-02 — Access tokens must carry Ordo issuer and audience

[PR #322](https://github.com/OL1V3S/ordo/pull/322) · [Issue #301](https://github.com/OL1V3S/ordo/issues/301)

- The API now rejects access tokens whose `iss` is not `ordo-api` or whose `aud` does not include `ordo-clients` (phase 2 of #301). Tokens from before phase 1 carry neither and get `401`; web and iOS refresh or sign in again.
- Signature, lifetime and clock-skew checks are unchanged. No config, schema, web or iOS change.

### 2026-11-02 — Sign-in no longer reveals unconfirmed accounts

[PR #320](https://github.com/OL1V3S/ordo/pull/320) · [Issue #318](https://github.com/OL1V3S/ordo/issues/318)

- A correct password on an unconfirmed account now gets the same "incorrect email or password" answer as a wrong password, on all three sign-in endpoints. No email is sent from sign-in.
- Web and iOS show a neutral "Just created an account? Confirm your email first." hint with an inline "Resend confirmation email" button after any such failure.

### 2026-10-24 — Registration no longer reveals existing accounts

[PR #317](https://github.com/OL1V3S/ordo/pull/317) · [Issue #300](https://github.com/OL1V3S/ordo/issues/300)

- Registering with an email that already has an account returns the same `200` (or `503` when email fails) as a new registration. The owner gets a fixed "someone tried to create an account" email (English/Spanish, plain sign-in and forgot-password links, no token); the account is never changed. Weak-password `400` errors are unchanged.
- New in-memory registration limiter (global and per email, code defaults, no new settings) runs before the account check and returns the same `429` for everyone. Web and iOS now show "Too many requests" for it.

### 2026-10-24 — Access tokens: issuer and audience claims (phase 1)

[Issue #301](https://github.com/OL1V3S/ordo/issues/301)

- Every access token now carries `iss = ordo-api` and `aud = ordo-clients`; claims, lifetime and algorithm are otherwise unchanged.
- Validation stays off in this phase, so existing tokens keep working; phase 2 enables it after older tokens expire. No client, config or schema change.

### 2026-10-23 — Web security headers

[PR #315](https://github.com/OL1V3S/ordo/pull/315) · [Issue #307](https://github.com/OL1V3S/ordo/issues/307)

- The web app now sends a Content Security Policy (own scripts plus one hashed inline theme script; API calls only to the app and the Render backend) and `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` and `Permissions-Policy` headers, set in `frontend/vercel.json`.
- A frontend test fails if the inline script changes without its hash, if the API origin and CSP drift apart, or if unsafe CSP sources are added. Backend, API and iOS are unchanged.

### 2026-10-23 — Safe server errors and a /health check

[PR #314](https://github.com/OL1V3S/ordo/pull/314) · [Issue #304](https://github.com/OL1V3S/ordo/issues/304)

- An unexpected server error now returns a fixed `500` (`code: internal_error`, plus a `traceId`) with no exception text. The server logs one line with the error type, method, route template and trace id, and never the message, stack, request data or amounts. EF Core's own error logs and responses that had already started can still log exception details (see `docs/debugging.md`).
- New anonymous `GET /health` returns `200 Healthy` without touching the database. Existing error responses, the web app and iOS are unchanged; no new settings.

### 2026-10-23 — Sign-in: account lockout enforced

[Issue #299](https://github.com/OL1V3S/ordo/issues/299)

- Login, device-session and web-session sign-in now lock an account for 10 minutes after 5 wrong passwords; a success resets the count.
- Attempts are reserved atomically before hashing on PostgreSQL, so parallel guesses stay within the budget. Locked, wrong-password and unknown-email responses are identical; no API, schema or config change.

### 2026-10-23 — iPhone widget: this month's spending

[PR #297](https://github.com/OL1V3S/ordo/pull/297) · [Issue #291](https://github.com/OL1V3S/ordo/issues/291)

- The Home Screen widget now shows this month's exact spending and a six-month graph from the existing cash-flow report, labelled "Updated …"; it asks you to open Ordo when its copy is old.
- The app shares only the 2-hour access token with the widget through a shared Keychain item, removed at sign-out; the refresh credential never leaves the app. iPhone app only, so backend, API and schema are unchanged.

### 2026-10-23 — Web sessions: stay signed in on the web

[PR #295](https://github.com/OL1V3S/ordo/pull/295) · [PR #296](https://github.com/OL1V3S/ordo/pull/296) · [PR #298](https://github.com/OL1V3S/ordo/pull/298) · [Issue #292](https://github.com/OL1V3S/ordo/issues/292)

- Backend: `POST /api/auth/web-session`, `/refresh` and `/sign-out` keep a long-lived session in an HttpOnly, Secure, SameSite=Strict cookie, guarded by an Origin and custom-header check.
- Web app: signs in through a same-origin Vercel rewrite, refreshes the 2-hour access token before expiry and after a `401`, coordinates tabs with a Web Lock, and signs out on the server and in every tab.
- Session identity no longer changes when the access token is refreshed. Older 2-hour sessions run out normally; `/api/auth/login` and iOS are unchanged.

### 2026-10-23 — iPhone Home Screen widget: Add expense and Add deposit

[PR #294](https://github.com/OL1V3S/ordo/pull/294) · [Issue #291](https://github.com/OL1V3S/ordo/issues/291)

- New medium Home Screen widget with two buttons that open Add expense and Add deposit in the app. Nothing is saved from the widget. It shows "Open Ordo to see spending" for now; the spending graph is a later slice.
- The widget reads no account data and shares no credentials. English and Spanish; iPhone app only, so backend, API and schema are unchanged.

### 2026-10-22 — Edit a recurring expense in the iPhone app

[PR #290](https://github.com/OL1V3S/ordo/pull/290) · [Issue #288](https://github.com/OL1V3S/ordo/issues/288)

- Active, paused and ended recurring expenses now have an Edit action (row menu and detail screen) with the same form as Review and confirm; "Save changes" updates it.
- A saved amount that cannot be read exactly is left empty and has to be entered. A refused save keeps the form and your changes. English and Spanish; iPhone app only, so backend, API and schema are unchanged.

### 2026-10-22 — Review recurring expense changes in the iPhone app

[PR #289](https://github.com/OL1V3S/ordo/pull/289) · [Issue #288](https://github.com/OL1V3S/ordo/issues/288)

- The Recurring section now lists "Changes to review" (new amount, new dates, or no matching expense lately) with a detail screen. You can use the new details, keep the saved ones, keep an expense active, mark it as ended (with a confirmation) or review a kept change again.
- Home's "Needs your attention" links to these changes. English and Spanish; iPhone app only, so backend, API and schema are unchanged.

### 2026-10-20 — iPhone app tabs, sign-in "What is Ordo?", password rules

[PR #286](https://github.com/OL1V3S/ordo/pull/286) · [PR #287](https://github.com/OL1V3S/ordo/pull/287) · [Issue #285](https://github.com/OL1V3S/ordo/issues/285)

- The iPhone app now has five tabs: Home, Transactions, Plan (Budgets, Recurring expenses and Paychecks behind a switcher), Reports and Settings. Reports and Settings no longer open from Home.
- Sign-in is centred and has a "What is Ordo?" sheet. Create account lists the password rules one per line, and Forgot password no longer clips its heading.
- The web sign-in page has the same "What is Ordo?" dialog, and Create account shows the password rules as a bulleted list.
- English and Spanish; backend, API and schema are unchanged.

### 2026-10-20 — Account and Settings in the iPhone app

[Issue #282](https://github.com/OL1V3S/ordo/issues/282)

- The iPhone app can create an account and send confirmation or reset emails, like the web. Email links open the web pages in Safari; the app never handles a token.
- Settings (gear on Home) has Appearance, Language (English, Español) and Sign out. Only theme and language are stored on the device. Backend, API, schema and web app are unchanged.
