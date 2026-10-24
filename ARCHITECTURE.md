# Ordo Architecture

## Purpose

This document describes the durable current architecture and its boundaries.
[`AGENTS.md`](AGENTS.md) governs how agents work, [`ROADMAP.md`](ROADMAP.md)
governs engineering sequencing, and
[`docs/financial-domain-invariants.md`](docs/financial-domain-invariants.md)
governs approved financial semantics.

## Current architecture

Ordo is a modular monolith with three deployable persistence/runtime
parts:

- a React 19 and Vite frontend;
- an ASP.NET Core 9 Web API; and
- a PostgreSQL database accessed through Entity Framework Core.

The browser calls the API over HTTP. The API owns authentication,
authorization, business-boundary enforcement, and persistence access. The
frontend does not connect directly to the database.

### Frontend

`frontend/src/app/` owns routing, the authenticated application shell, and
top-level pages. Product behavior is organized under `frontend/src/features/`
by capability, including authentication, expenses, budget limits, analytics,
transactions, commitment review, and paychecks. The protected Recurring expenses (commitments) experience
consumes the owner-scoped candidate and commitment APIs and keeps evidence
review, confirmation, dismissal/reconsideration, expectation edits, and
lifecycle controls inside `frontend/src/features/commitments/`. The protected
Paychecks experience in `frontend/src/features/paychecks/` consumes the existing
candidate/profile APIs for explicit confirmation, dismissal/reconsideration,
manual expectations, allowed edits, lifecycle changes, and receipt recording.
Receipt forms reuse the inflow feature's exact-decimal validation while the
backend supplies allowed schedule slots; the UI may create-and-link actual cash
in or link an existing record and supports non-destructive unlink correction.
It displays the server's active-profile projection as expected, never
guaranteed, and keeps candidate schedules and saved profile schedules immutable.
Shared HTTP, constants, theme, localization, UI, and utilities live under
`frontend/src/shared/`; chart-specific presentation lives under
`frontend/src/charts/`.

The frontend localization boundary under `frontend/src/shared/localization/`
uses bundled i18next English and Spanish catalogs with English fallback. A
validated browser-local `en` or `es` preference drives catalog selection and
`html.lang` without changing authentication, routes, APIs, stored financial
values, currency, or input semantics. Localization adoption is incremental: the
authenticated shell, navigation hubs, and Settings were localized first, and the
Home, Transactions, statement import, Budgets, Reports, Recurring expenses, and Paychecks
pages and the public account-access pages have since followed, while the
unavailable Investing placeholder page remains English until separately scoped.
See [`docs/localization.md`](docs/localization.md) for catalog, glossary, and
future presentation-formatting rules.

The Transactions page (`activity` feature) coordinates spending, deposit (cash-in), and import tasks. The
`inflows` frontend feature owns exact-decimal drafts, cash-in presentation, and
session-scoped reads/writes over the existing `/api/inflows` contract. Imported
and paycheck-linked inflows share this management surface; the DTO carries no
source/linkage flags. Cash-in mutation outcomes distinguish rejected, unknown,
and completed writes with failed refreshes. Import confirmation refreshes each
record list according to its saved counts.

Expense and cash-in capture orchestration lives in domain-specific frontend
controllers under their respective features. The controllers receive narrow
mutation, authoritative-refresh, read-availability, blocking, and focus
adapters; they do not own list hooks or automatically load history. Activity
injects its existing Expense and AccountInflow list operations, while another
surface can reuse the same create, validation, duplicate-submit, session,
outcome, and recovery behavior with a bounded read model. Activity retains its
page-specific filtering, list pinning, import coordination, and presentation.

Expense money crosses the browser/API boundary as canonical invariant decimal
strings and is parsed into integer minor units for Expense entry, editing,
aggregation, ordering, comparison, and display. The API temporarily accepts
legacy numeric Expense requests for version compatibility. Selected commitment
candidate, evidence, observation, and proposal fields that are derived directly
from Expenses use the same string boundary; saved commitment expectation fields
retain their existing contract. BudgetLimit contracts also remain numeric, so a
browser comparison is allowed only when the received number can be reconstructed
unambiguously at cent precision. Ambiguous legacy Expense or BudgetLimit values
fail closed and cannot drive an edit, commitment amount decision, budget status,
or Overview attention item.

Below the desktop sidebar breakpoint, the shell exposes Home, Transactions, Plan,
Reports, and More. The protected `/plan` and `/more` pages group links to the
existing feature URLs without owning feature data or changing their workflows.
Desktop retains individual destinations. Home composes existing cash-flow and
feature list reads with independent loading/error states and session-staleness
protection. Its financial summary reuses Analytics' exact-cent response; paycheck
and commitment lists do not invoke candidate or change detection. Theme tokens also
drive chart presentation in explicit and system appearance modes (see
[docs/design-tokens.md](docs/design-tokens.md)).

Analytics combines historical cash in and Expenses through an analytics-local
read API and session-aware snapshot hook. The selected-month comparison and
six-month trend show all recorded inflows, with confirmed-paycheck-linked and
other inflows as an exact partition. Exact cent strings are formatted with
integer arithmetic; approximate numbers are used only for chart geometry.
Accessible text and disclosures accompany the graphs. Existing spending/budget
drilldowns retain their separate read boundaries and behavior.

Feature UI and hooks depend on feature or shared API modules. Shared modules
must not depend on feature-specific UI. The Axios client is the common API
transport and attaches the current bearer token to requests. A shared session
module under `frontend/src/shared/auth/` owns the existing token/email storage
and synchronizes authentication state with React and ordinary cross-tab storage
changes. An authenticated API `401` clears the matching current session without
replaying the request; public auth operations explicitly retain their own error
handling. Request session identity and a per-tab generation prevent late failures
from invalidating a newer session established in that tab. The backend remains
authoritative for token validity; the frontend does not refresh or extend tokens.

### Backend

`backend/Program.cs` is the composition root. It configures controllers,
PostgreSQL EF Core persistence, ASP.NET Core Identity, JWT bearer
authentication, Data Protection key persistence, CORS, a global
unhandled-exception handler (`backend/Diagnostics/`), an anonymous `/health`
endpoint, and application services.

Controllers under `backend/Controllers/` are the HTTP boundary. Authentication
and email concerns have supporting components under `backend/Authentication/`,
`backend/Configuration/`, and `backend/Services/`. `backend/Data/` owns the EF
Core context and design-time database configuration; `backend/Models/` contains
the current persistence and Identity models; `backend/Migrations/` contains the
schema history.

The intended dependency direction is HTTP boundary to application/service and
persistence concerns, with database access remaining behind the API. Keep this
structure appropriately simple; new layers require a demonstrated need.

The Expense HTTP boundary uses an Expense-specific decimal input adapter: new
clients send canonical decimal strings, stale clients may send JSON number
tokens, and both are validated into .NET `decimal` before the existing domain
rules run. Expense responses format `numeric(18,2)` values as fixed-two-decimal
strings. This is a transport hardening only; persistence, approved monetary
range, financial semantics, and commitment detector arithmetic remain decimal
and unchanged.

`backend/Import/` contains the statement-import boundary. A per-user admission
filter allows one import request at a time. The preview service creates, reads,
edits and confirms import previews. The Sunflower parser turns extracted PDF text
into normalized rows with source provenance, and shared input rules normalize
and validate editable expense fields. PDF text extraction runs behind a bounded
PDF-to-text application boundary. Its private `backend.PdfWorker` child process is packaged inside the backend publish
artifact and exists only for one extraction call. The worker has no endpoint,
independent deployment, data store, or service identity; it receives one bounded
binary stdin frame and returns one bounded stdout frame. The parent backend owns
admission, fixed limits, stable errors, timeout/cancellation, process kill/reap,
and environment scrubbing. This is a narrow containment boundary for untrusted
PDF parsing, not general subprocess infrastructure.

`backend/Commitments/` contains the pure, versioned recurring-commitment
detector and the owner-scoped application service for candidate review and
durable commitment operations. Candidate inference is derived from Expenses;
only confirmed commitments, occurrence links, and dismissals are persisted.
The approved V1 semantics and explicit non-goals are defined in
[`docs/commitment-intelligence.md`](docs/commitment-intelligence.md).

`backend/Paychecks/` contains the pure, versioned paycheck candidate detector and
projector plus the owner-scoped profile application service. The authenticated
`/api/paycheck-candidates` and `/api/paychecks` APIs separate generic inflow
evidence from explicit user-confirmed paycheck meaning. Profiles, confirmation
evidence, recorded-receipt occurrences, and exact-fingerprint dismissals are
persisted; candidate, receipt-slot, and projection results remain derived.
Confirmation and receipt assignment use serializable transactions, owner-scoped
locks, owner-consistent foreign keys, exclusive inflow assignment, and unique
profile/slot protection. Actual receipt money remains an `AccountInflow`; the
occurrence records its profile assignment and exact date-to-slot offset. The
profile schedule is immutable, while accepted amounts, windows, display name,
and lifecycle are explicitly editable. The Paychecks frontend consumes these
contracts without changing their semantics. Automatic matching and paycheck
change detection are not included. See the paycheck section of
[`docs/financial-domain-invariants.md`](docs/financial-domain-invariants.md).

`backend/Analytics/` owns the historical cash-flow read model and pure exact-cent
aggregation. The authenticated `/api/analytics/cash-flow` endpoint reads owner
Expenses, AccountInflows, and owner-consistent paycheck evidence membership in
one read-only repeatable-read PostgreSQL snapshot. It returns selected-month
totals/categories, explicit monthly trend buckets, record counts, and available
months, with monetary amounts encoded as integer-cent strings. It does not
invoke candidate detection or projection, write financial data, or introduce
new persistence. Current recorded dates and amounts govern history; the explicit
date-only cutoff preserves the Analytics browser-local calendar convention.

`backend/Home/` owns the authenticated Home composition read model. The
`/api/home` endpoint keeps the caller's local activity cutoff separate from the
paycheck projector's UTC evaluation date, returns exact string money, and
composes at most three current Expenses/AccountInflows plus two active paycheck
projections. Linked inflows remain one actual row with relationship metadata.
Needs Attention evaluates commitment reviews and recorded-spending budget
conditions independently, each in a read-only repeatable-read transaction.
Explicit family availability preserves a trustworthy result when the sibling
family fails. Recent Activity and Coming Up also use independent read-only
repeatable-read transactions so one recoverable source failure can be
represented without guessing another section. Home performs no writes, caching,
schema changes, balance semantics, commitment projection, or localized backend
presentation. See
[`docs/home-read-model.md`](docs/home-read-model.md).

`backend/ActivityTimeline/` owns the shared activity feed reader that Home recent
activity and the authenticated, read-only `/api/activity/timeline` endpoint both
use, so the date, expense-before-cash-in, record-ID ordering rule, the
owner-scoped paycheck-membership join, and exact two-decimal formatting exist
once. The endpoint pages by opaque position-only keyset cursor in one read-only
repeatable-read transaction, returns stored amounts unaltered, and adds no
schema, totals, or balance. It accepts optional server-side `q`, `kind`, `from`, and `to` filters that only narrow the owner's rows, and `ActivityFeedOrdering.OrderNewestFirst` is the shared date/id ordering also used by `GET /api/expenses`. The `activity` frontend feature renders it on the
Activity page independently of the per-type lists. See
[`docs/activity-timeline.md`](docs/activity-timeline.md).

`backend/CreateRequests/` owns duplicate-safe creation for `POST /api/expenses`
and `POST /api/inflows` when the optional `Idempotency-Key` header is present.
It parses the key, fingerprints the normalized stored values, and writes the
record and a `CreateRequestReceipts` row in one `SaveChanges` with a composite
`(OwnerId, RequestKey)` primary key; a concurrent loser catches the exact
primary-key unique violation, re-reads the winner's receipt, and replays or
rejects it, so no second financial row is created and no request returns a 500
for this race. Requests without the header take the original path unchanged.
Edit, delete, import and paycheck paths are unaffected. See
[`docs/financial-domain-invariants.md`](docs/financial-domain-invariants.md).

### Authentication and ownership boundaries

ASP.NET Core Identity manages users, JWT bearer authentication establishes the
request identity, and protected controllers authorize access. Financial data
ownership comes from the authenticated identity, not from a client-selected
user. Cross-user isolation is a mandatory backend responsibility.

Native clients can hold a long-lived, revocable device session instead of
re-entering a password every two hours. `AuthController` exposes
`/api/auth/device-sessions` (create from email and password), `/refresh` and
`/sign-out`; `backend/Authentication/DeviceSessionService.cs` owns the logic and
the `DeviceSessions` table stores only a SHA-256 hash of the current credential
secret. A refresh rotates the credential and returns a new 2-hour access token
from the unchanged token generator. Presenting an already-rotated credential
ends that session. Sessions end at 60 days idle or 180 days absolute, on
sign-out, on a completed password reset, or when the user's security stamp no
longer matches the one captured at sign-in. The API contract is **one refresher
per credential at a time**: a client that shares a credential across processes
(for example an app and a widget) must serialize refreshes, and must treat a
`401` as signed out, because a concurrent or retried refresh with an old
credential is indistinguishable from reuse and ends the session. The iOS widget
(#291) follows this by never holding the credential: the app copies only the
2-hour access token to a shared Keychain item the widget reads, so the access
token is no longer memory-only on iOS; the widget never refreshes. Web login
(`/api/auth/login`), access-token validation and lockout behavior are unchanged.

The backend also exposes web-session endpoints (#292), used by the web app: `POST /api/auth/web-session`, `/refresh` and
`/sign-out`. They reuse `DeviceSessionService` and the `DeviceSessions` table
(shared 20-session cap, same lifetimes and strict reuse), but the credential
lives only in the HttpOnly, Secure, `SameSite=Strict` cookie
`__Secure-ordo-web-session` (Path `/api/auth/web-session`, no Domain, Max-Age =
idle timeout) and never in a body. The body is ignored on refresh, and the
device-session endpoints never read the cookie. Every web-session action runs
behind `WebSessionGuardFilter`, a resource filter that runs before model
validation and returns `403` unless the `X-Ordo-Web-Session: 1` header is
present and `Origin` equals `Frontend:BaseUrl` by parsed scheme, host and port.
CORS is unchanged and has no `AllowCredentials`; responses are `no-store`. Any
refresh failure returns `401 {"code":"session_invalid"}` and clears the cookie.
The cookie is first-party because the web app calls these endpoints at
relative URLs: a Vercel rewrite in `frontend/vercel.json` (before the SPA
catch-all) forwards `/api/auth/web-session/*` to the Render host, and the Vite
dev server proxies the same path. All other API calls still go directly to
Render with the bearer token.

In the web app, `shared/api/webSessionClient.js` makes these same-origin calls
(header `X-Ordo-Web-Session: 1`, no timeout or abort) and
`shared/auth/webSession.js` orchestrates them. The 2-hour access token stays in
`localStorage`. A refresh runs on boot without a valid token, about 5 minutes
before the JWT `exp`, and once after an authenticated `401` (then the request is
retried once). Refreshes are single-flight per tab and serialized across tabs
with the Web Lock `ordo-web-session-refresh`; inside the lock a tab skips if
another tab already stored a new token. A refresh keeps the session identity.
A refresh `401` clears the session in every tab; a network error or `5xx` never
keeps an expired token. Sign-out calls `/sign-out`, clears storage and signs out
other tabs (storage event plus `BroadcastChannel("ordo-session")`); if the call
fails, a `pending-sign-out` flag blocks auto-refresh and the sign-out is retried
on the next boot. Older 2-hour sessions from `/api/auth/login` keep working
until their next refresh fails; the backend login endpoint is unchanged.

Approved financial meaning and future authoritative validation destinations
are defined in
[`docs/financial-domain-invariants.md`](docs/financial-domain-invariants.md).
That document may describe approved targets that the current API or schema has
not implemented yet.

### iOS client

`ios/` holds a native SwiftUI iPhone app (iOS 18+, no third-party dependencies). It
signs in with the device-session endpoints, keeps only the refresh credential in the
Keychain, and renders Home from `GET /api/home`. It validates the response
with the same rules as the web client, except that it does not re-check the server's
sort order. A single actor serializes credential refreshes, which the API contract
requires. The app reads its server address from the build configuration
(`ios/Config`, with the real address in an untracked `Local.xcconfig`). A Transactions tab
reads `GET /api/activity/timeline` (server cursor paging, search and filters, nothing
persisted). A Budgets tab reads `GET /api/budgetlimits?monthYear=YYYY-MM`, sets a limit with the
upsert `POST /api/budgetlimits` and removes one with `DELETE /api/budgetlimits/{id}` (none of the
three takes an `Idempotency-Key`: the upsert is an absolute set of one value and the delete
targets a never-reused id), and reads the month's recorded spending through the same timeline
endpoint; the month and the limit are sent as exact strings and numbers built from integers,
and nothing is persisted. A Paychecks tab reads `GET /api/paychecks` and `GET /api/inflows`, changes a schedule's
lifecycle with `PATCH /api/paychecks/{id}/lifecycle`, and links or unlinks a received paycheck with
`POST /api/paychecks/{id}/receipts` and `DELETE /api/paychecks/{id}/receipts/{accountInflowId}`
(the server's slots are used as given; a repeat of the same link request is answered
`alreadyRecorded` by the server, so no `Idempotency-Key` is needed; nothing is persisted).
A Recurring tab reads `GET /api/commitment-candidates` and `GET /api/commitments`, confirms a
possible recurring expense with `POST /api/commitment-candidates/confirm` (a repeat for the same
origin fingerprint is answered `alreadyConfirmed`, so no `Idempotency-Key` is needed), dismisses
or reconsiders one with `POST /api/commitment-candidates/dismiss` and `/reconsider`, and changes
a confirmed one's lifecycle with `PATCH /api/commitments/{id}/lifecycle`; the lists are re-read
after every decision and nothing is persisted.
The app's financial writes are setting or deleting a budget limit (above), adding an
expense or a deposit through the existing
`POST /api/expenses` and `POST /api/inflows`, each with one `Idempotency-Key` that is reused
for every retry, and editing or deleting a record through the existing `PUT` and `DELETE` on
`/api/expenses/{id}` and `/api/inflows/{id}`. Those four take no key: an edit is an absolute
replacement and a delete targets a never-reused id, so an identical retry is safe, and every
change is followed by a re-read from the server with no optimistic money. While a save's outcome is uncertain, its key and locked values are kept in
one file-protected, backup-excluded file in the app container, cleared on a definitive
outcome, discard, sign-out, session end or fresh sign-in. If that file cannot be deleted, a
non-financial `UserDefaults` flag marks it invalid, so the next launch retries the delete and
never shows or sends it. Every view reads colors, type, spacing and button styles from one theme layer
(`ios/Ordo/Theme`, asset-catalog color sets ported from the web's semantic tokens, with light, dark and
Increase Contrast values), and a test fails if a view uses a raw color. A Reports screen (opened from Home) reads `GET /api/analytics/cash-flow` and shows server figures as exact integer-cent values (no `Double`, no client maths), with a Swift Charts trend (a system framework) and an exact list; nothing is persisted. A Transactions toolbar button opens a Statement import (`ios/Ordo/Import`) over the existing `/api/import-previews` endpoints: the PDF is read in memory only, uploaded once with a fixed file name, and confirm is retried only on tap (the server answers a repeat with `already_confirmed`). Signed out, the app can create an account and request confirmation or reset emails (`register`, `resend-confirmation`, `forgot-password`, no token); the email links open the web pages in Safari, so the app never handles a confirm or reset token. A Settings screen saves the theme and language in two `UserDefaults` keys. See [`ios/README.md`](ios/README.md).

### Persistence and migrations

PostgreSQL is the application persistence provider. The database stores
Identity data, expenses, budget limits, commitment decisions and links, account
inflows and their import provenance, paycheck profiles/occurrences/dismissals, and
the ASP.NET Core Data Protection key ring. Normal application startup does not
apply migrations. Production migrations remain a separate, deliberate,
human-authorized operation described in [`README.md`](README.md).

### Deployment topology

The frontend is deployed to Vercel, the containerized backend to Render, and
PostgreSQL to Neon. These are separate deployment boundaries. Repository CI
builds and tests source changes but does not authorize production changes or
apply production migrations. Backup, restore, and rollback reference:
[`docs/operations-runbook.md`](docs/operations-runbook.md).

The iOS app is not deployed anywhere: it is built and installed from source on the
owner's own devices. Its CI job (`iOS build and tests`) is not a required check.

## Approved and planned extension points

Statement import is a shipped capability with one supported source,
`sunflower_pdf` (text-extractable Sunflower Bank PDF statements). The
authenticated, owner-scoped `/api/import-previews` endpoints upload a statement,
return the open preview, read a preview, edit a row's selection and eligible
fields (or several rows' selection at once), and confirm the preview. The Activity page's import review consumes
these endpoints through the `importPreview` frontend feature. The private,
contained PDF text extractor remains infrastructure behind that flow and is not
exposed by any endpoint of its own. A parsed preview is stored as normalized
rows for 24 hours, without the original PDF, and possible duplicates of
existing Expenses or AccountInflows are flagged for review. Confirmation is
atomic and all-or-nothing: only explicitly selected, revalidated rows are
persisted through the authoritative backend write boundary, with selected
debits saved as Expenses and selected credits or deposits saved as generic
AccountInflows, never as income or paychecks. The untrusted-document security
and privacy boundary is defined in
[`docs/import-threat-model.md`](docs/import-threat-model.md), and the
normalized financial-processing and review pipeline is defined in
[`docs/import-pipeline.md`](docs/import-pipeline.md).

Additional institutions, statement reconciliation, refund and reversal
relationships beyond direction-based treatment, merchant extraction, a broader
income model, scanned-PDF support, and source-account semantics beyond the
single tracked checking account remain future scoped work. See the deferred
import decisions in
[`docs/financial-domain-invariants.md`](docs/financial-domain-invariants.md) and
Track F in [`ROADMAP.md`](ROADMAP.md).

Expense and inflow dates are already date-only (`Expense.Date` and
`AccountInflow.Date` are .NET `DateOnly`, stored as PostgreSQL `date`). Other
approved target representations, and date-only treatment of fields that are
still timestamp-shaped (for example budget limit months), remain future roadmap
work until their implementation issues are separately approved and completed.

## Architecture non-goals

- Microservices or distributed orchestration without a demonstrated need.
- Direct browser access to PostgreSQL or production infrastructure.
- Client-controlled financial ownership or authoritative client-only
  validation.
- Applying migrations during normal application startup.
- Treating roadmap targets as already implemented behavior.
- New abstractions, services, or dependencies solely to make the architecture
  appear more elaborate.
