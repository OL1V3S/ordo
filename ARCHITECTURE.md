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
transactions, commitment review, and paychecks. The protected Commitments experience
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
authenticated shell, navigation hubs, and Settings are localized first, while
feature and public account-access pages remain English until separately scoped.
See [`docs/localization.md`](docs/localization.md) for catalog, glossary, and
future presentation-formatting rules.

The Activity page coordinates spending, cash-in, and import tasks. The
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

Below the desktop sidebar breakpoint, the shell exposes Home, Activity, Plan,
Insights, and More. The protected `/plan` and `/more` pages group links to the
existing feature URLs without owning feature data or changing their workflows.
Desktop retains individual destinations. Home composes existing cash-flow and
feature list reads with independent loading/error states and session-staleness
protection. Its financial summary reuses Analytics' exact-cent response; paycheck
and commitment lists do not invoke candidate or change detection. Theme tokens also
drive chart presentation in explicit and system appearance modes.

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
authentication, Data Protection key persistence, CORS, and application
services.

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

`backend/Import/` contains the bounded PDF-to-text application boundary. Its
private `backend.PdfWorker` child process is packaged inside the backend publish
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

### Authentication and ownership boundaries

ASP.NET Core Identity manages users, JWT bearer authentication establishes the
request identity, and protected controllers authorize access. Financial data
ownership comes from the authenticated identity, not from a client-selected
user. Cross-user isolation is a mandatory backend responsibility.

Approved financial meaning and future authoritative validation destinations
are defined in
[`docs/financial-domain-invariants.md`](docs/financial-domain-invariants.md).
That document may describe approved targets that the current API or schema has
not implemented yet.

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
apply production migrations.

## Approved and planned extension points

Sunflower statement upload, row parsing, preview, confirmation, and persistence
remain planned future capabilities. The bounded PDF text extractor is current
private backend infrastructure but is not exposed by an endpoint. Its approved
untrusted-document security and privacy boundary is
defined in [`docs/import-threat-model.md`](docs/import-threat-model.md), and its
approved V1 normalized financial-processing and review pipeline is defined in
[`docs/import-pipeline.md`](docs/import-pipeline.md).

Future implementation may extend the import boundary to parse supported
extracted statement text, normalize it into reviewed bank-neutral rows, and
persists only explicitly confirmed valid expense candidates through the
authoritative backend financial write boundary. Sunflower row parsing, API/UI
implementation, import storage/schema design, and any required migrations remain
future scoped work. Imported expense persistence remains blocked until the
applicable approved date-only semantics are implemented and verified.

Likewise, approved target representations such as date-only financial semantics
remain future roadmap work until their implementation issues are separately
approved and completed.

## Architecture non-goals

- Microservices or distributed orchestration without a demonstrated need.
- Direct browser access to PostgreSQL or production infrastructure.
- Client-controlled financial ownership or authoritative client-only
  validation.
- Applying migrations during normal application startup.
- Treating roadmap targets as already implemented behavior.
- New abstractions, services, or dependencies solely to make the architecture
  appear more elaborate.
