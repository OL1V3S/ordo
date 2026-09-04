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
transactions, and commitment review. The protected Commitments experience
consumes the owner-scoped candidate and commitment APIs and keeps evidence
review, confirmation, dismissal/reconsideration, expectation edits, and
lifecycle controls inside `frontend/src/features/commitments/`. Shared HTTP,
constants, theme, UI, and utilities live under
`frontend/src/shared/`; chart-specific presentation lives under
`frontend/src/charts/`.

Feature UI and hooks depend on feature or shared API modules. Shared modules
must not depend on feature-specific UI. The Axios client is the common API
transport and attaches the current bearer token to requests.

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
occurrences, and exact-fingerprint dismissals are persisted; candidate and
projection results remain derived. Confirmation uses a serializable transaction,
ordered inflow locks, owner-consistent foreign keys, and exclusive evidence
assignment. The profile schedule is immutable, while accepted amounts, windows,
display name, and lifecycle are explicitly editable. No Paychecks frontend or
paycheck change detection is included. See the paycheck section of
[`docs/financial-domain-invariants.md`](docs/financial-domain-invariants.md).

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
inflows and their import provenance, paycheck profiles/evidence/dismissals, and
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
