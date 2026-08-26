# Ordo Engineering Roadmap

This document is the engineering capability and maturity roadmap for Ordo. It
is not the product backlog. Product features belong here only when
they create an engineering dependency or materially change how the system must
be built, verified, secured, or operated.

Roadmap priority and product-feature blocking status are separate judgments.
Important engineering work may proceed incrementally in parallel with product
development unless a concrete dependency makes it part of a feature's critical
path.

## Engineering North Star

Ordo should remain an understandable, testable, secure, and
production-conscious application that humans and coding agents can modify
safely. Engineering controls should protect financial behavior and make
failures diagnosable while keeping the architecture appropriately simple for a
small full-stack product.

## Current State

Ordo is an appropriately scoped modular monolith with a React/Vite
frontend, an ASP.NET Core API, and PostgreSQL. The repository already has:

- meaningful frontend component and characterization tests;
- strong authentication-recovery, email-failure, rate-limit, concurrency, and
  Data Protection coverage;
- a deliberate production migration process that is separate from normal
  application startup;
- persistent Data Protection keys for reliable Identity tokens across backend
  restarts;
- frontend and backend GitHub Actions checks;
- protected human merge authority; and
- an established risk-sensitive, AI-assisted workflow in `AGENTS.md`.

The principal maturity gaps are concentrated around financial write-boundary
validation, explicit domain semantics, database-enforced invariants,
PostgreSQL-backed integration testing, authentication/session correctness,
production-equivalent CI, consistent errors, and operational diagnosis. The
repository also needs an explicit security and persistence model before it
accepts user-provided financial documents.

## Engineering Principles

- Treat financial correctness as a product requirement.
- Enforce important invariants through validation, tests, schemas, and CI where
  practical.
- Gather evidence before adding abstractions or changing behavior.
- Preserve existing behavior unless a semantic change is explicitly approved.
- Prefer small, independently reviewable issues and pull requests.
- Keep irreversible, security-sensitive, data, and production authority with a
  human.
- Increase agent autonomy only as automated verification makes it safe.
- Make production failures diagnosable without exposing credentials, tokens,
  financial descriptions, statements, or other sensitive data.
- Add architecture only in response to demonstrated product or operating needs.
- Keep documentation concise, useful, and aligned with executable behavior.

## Roadmap Tracks

Tracks communicate work that can usually progress in parallel. `Priority`
describes engineering importance; `Blocks product work?` identifies whether an
item blocks the currently planned Sunflower statement import or only becomes a
blocker under stated conditions.

### Track A — Financial Correctness

#### A1. Characterize the existing financial APIs

- **Goal:** Add behavior-preserving backend integration coverage for expense and
  budget CRUD contracts, authentication, authorization, user isolation, current
  amount/date/category/month behavior, duplicate budget behavior, status codes,
  and failure paths.
- **Why:** Core financial behavior has less backend regression protection than
  authentication and must be understood before financial write paths change.
- **Priority:** P1
- **Risk:** Low
- **Dependencies:** None.
- **Completion criteria:** Tests document current behavior without changing
  runtime semantics and cover cross-user read, update, and delete attempts.
- **Blocks product work?** Yes — blocks Sunflower import write-path changes.
- **Suggested GitHub issue?** Yes.

#### A2. Decide and document financial-domain invariants

- **Goal:** Obtain explicit human decisions for expense amount meaning and
  ranges, refunds/credits, transaction dates, budget months, category
  normalization, ownership, and budget uniqueness.
- **Why:** Import code must not silently define or change product semantics.
- **Priority:** P1
- **Risk:** High
- **Dependencies:** A1 provides current-behavior evidence.
- **Completion criteria:** Approved decisions identify which rules belong in
  API contracts, validation, tests, and database constraints. Semantic changes
  are separated from behavior-preserving work.
- **Blocks product work?** Yes — only the decisions relevant to safely importing
  and persisting transactions must precede Sunflower import.
- **Suggested GitHub issue?** Yes.

#### A3. Harden necessary financial write boundaries

- **Goal:** Introduce only the request/response DTOs, validation, normalization,
  and database protections required for safe financial writes.
- **Why:** Persistence entities are currently accepted directly and important
  validity rules are not consistently enforced at the API boundary.
- **Priority:** P1
- **Risk:** High
- **Dependencies:** A1 and the relevant A2 decisions.
- **Completion criteria:** Valid existing clients retain their intended
  contracts; invalid writes receive controlled responses; ownership cannot be
  supplied or overridden by clients; focused integration tests pass. Simple
  CRUD may continue using EF Core directly.
- **Blocks product work?** Conditional — the minimum safe imported-transaction
  persistence boundary blocks Sunflower import; unrelated cleanup does not.
- **Suggested GitHub issue?** Yes; split expense and budget work if needed.

#### A4. Enforce budget uniqueness and concurrency behavior

- **Goal:** Guarantee the approved one-limit-per-user/category/month invariant
  and define predictable concurrent-write behavior.
- **Why:** The current read-then-write upsert has no matching database unique
  constraint and can create duplicates.
- **Priority:** P1
- **Risk:** High
- **Dependencies:** A1, the A2 budget decision, existing-data inspection, and a
  reviewed migration/recovery plan.
- **Completion criteria:** Existing duplicates are handled deliberately, a
  database constraint enforces the approved invariant, concurrency tests pass,
  and the generated migration SQL is reviewed before any production operation.
- **Blocks product work?** Conditional — required before import only if imported
  data writes or relies on budget limits.
- **Suggested GitHub issue?** Yes; use a separate migration PR.

#### A5. Make date, month, and category semantics consistent

- **Goal:** Align frontend, API, and PostgreSQL handling of transaction dates,
  month periods, and category normalization.
- **Why:** Local-time calculations, `DateTime` handling, and client-only category
  normalization can produce inconsistent grouping or duplicate category keys.
- **Priority:** P1
- **Risk:** High
- **Dependencies:** A1 and A2.
- **Completion criteria:** Boundary tests cover timezone-sensitive dates and
  month edges; canonical category behavior is enforced at the appropriate
  server/database boundary; any contract or schema change is separately
  approved.
- **Blocks product work?** Yes for the subset consumed by normalized imported
  transactions.
- **Suggested GitHub issue?** Yes.

### Track B — Production Verification

#### B1. Add PostgreSQL-backed integration verification

- **Goal:** Run migrations and high-value financial persistence/API tests against
  an ephemeral PostgreSQL instance.
- **Why:** EF Core InMemory does not reproduce PostgreSQL constraints,
  transactions, precision, timestamps, indexes, or concurrency.
- **Priority:** P1
- **Risk:** Low
- **Dependencies:** A1; add A3–A5 cases as those behaviors are approved.
- **Completion criteria:** CI starts an isolated PostgreSQL database, applies all
  migrations, runs selected integration tests, and reports actionable failures.
- **Blocks product work?** Yes — sufficient PostgreSQL verification for imported
  transaction persistence must precede Sunflower import.
- **Suggested GitHub issue?** Yes.

#### B2. Verify migration evolution continuously

- **Goal:** Prove that the complete migration chain creates the expected schema
  without applying migrations during normal application startup.
- **Why:** Migration safety depends on both reviewed operations and an executable
  migration history.
- **Priority:** P1
- **Risk:** Low
- **Dependencies:** B1.
- **Completion criteria:** CI applies the migration chain from an empty database
  and preserves the documented administrator-controlled production procedure.
- **Blocks product work?** Conditional — blocks any import work requiring schema
  changes if B1 does not already provide equivalent evidence.
- **Suggested GitHub issue?** Yes; may be combined with B1.

#### B3. Build the production backend container in CI

- **Goal:** Verify that the Render deployment artifact builds from each relevant
  pull request.
- **Why:** Source build success does not prove the Docker publish context and
  runtime packaging are valid.
- **Priority:** P1
- **Risk:** Low
- **Dependencies:** None.
- **Completion criteria:** CI builds, but does not publish, the production image
  and the check is required where repository policy permits.
- **Blocks product work?** No.
- **Suggested GitHub issue?** Yes.

#### B4. Add a minimal browser smoke suite

- **Goal:** Cover a few critical browser-to-API journeys, including authenticated
  expense and budget behavior.
- **Why:** Component and API tests do not prove complete browser integration.
- **Priority:** P2
- **Risk:** Medium
- **Dependencies:** A stable isolated test environment and B1.
- **Completion criteria:** A small deterministic suite runs without production
  secrets or Gmail and has documented ownership for flaky-test correction.
- **Blocks product work?** No by default; add an import preview/confirm smoke
  journey when its value justifies the maintenance cost.
- **Suggested GitHub issue?** Yes.

#### B5. Verify repository protection and required checks

- **Goal:** Confirm that the expected frontend/backend checks and human review
  policy are enforced for `main`.
- **Why:** Workflow files alone do not prove branch-protection configuration.
- **Priority:** P1
- **Risk:** Medium
- **Dependencies:** Stable required-job names.
- **Completion criteria:** Required checks, review expectations, force-push
  policy, and human merge authority are verified and recorded.
- **Blocks product work?** No unless current protection is discovered to be
  ineffective.
- **Suggested GitHub issue?** No; use a repository-administration task.

### Track C — Authentication and Security

#### C1. Make login lockout behavior effective

- **Goal:** Enforce and test the intended Identity lockout policy or replace it
  with an explicitly approved equivalent.
- **Why:** Lockout is configured, while the current login path does not exercise
  Identity's sign-in failure accounting.
- **Priority:** P1
- **Risk:** High
- **Dependencies:** Human approval of lockout and public-response semantics.
- **Completion criteria:** Integration tests cover failure counting, concurrent
  attempts, lockout, successful recovery, and non-enumerating responses.
- **Blocks product work?** No.
- **Suggested GitHub issue?** Yes.

#### C2. Define and harden the JWT/session policy

- **Goal:** Define issuer, audience, key requirements, lifetime, frontend storage,
  and password-reset/revocation expectations.
- **Why:** Current token trust and invalidation boundaries are implicit.
- **Priority:** P1
- **Risk:** High
- **Dependencies:** Human decision on acceptable session behavior.
- **Completion criteria:** Startup validation and integration tests cover
  signature, issuer, audience, expiration, and the approved post-reset behavior.
  Secure cookies or refresh tokens are introduced only as a separately approved
  authentication design.
- **Blocks product work?** No.
- **Suggested GitHub issue?** Yes.

#### C3. Improve endpoint throttling deliberately

- **Goal:** Apply practical throttling to login, registration, confirmation, and
  password-reset endpoints using appropriate source and account identifiers.
- **Why:** Current confirmation/reset limits are process-local, and login and
  registration lack comparable protection.
- **Priority:** P1
- **Risk:** Medium
- **Dependencies:** C1 response policy; deployment topology.
- **Completion criteria:** Limits, `Retry-After` behavior, privacy properties,
  restart/multi-instance limitations, and tests are documented. A distributed
  store is deferred until multiple replicas make it necessary.
- **Blocks product work?** No.
- **Suggested GitHub issue?** Yes.

#### C4. Normalize authentication response privacy

- **Goal:** Make account-enumeration and error-response behavior intentional and
  consistent across registration, login, confirmation, and password recovery.
- **Why:** Current endpoints mix neutral and distinguishable responses.
- **Priority:** P1
- **Risk:** High
- **Dependencies:** C1 and approved product/security semantics.
- **Completion criteria:** Response contracts are documented and tested across
  missing, confirmed, locked, invalid-token, and delivery-failure states.
- **Blocks product work?** No.
- **Suggested GitHub issue?** Yes.

### Track D — Operations and Reliability

#### D1. Establish a consistent API error contract

- **Goal:** Use ASP.NET Problem Details and stable application codes where a
  client must branch on an error.
- **Why:** Mixed strings, arrays, anonymous objects, and empty errors make client
  behavior and diagnosis inconsistent.
- **Priority:** P1
- **Risk:** Medium
- **Dependencies:** Characterization tests for endpoints being changed.
- **Completion criteria:** The contract is documented; intentional auth privacy
  remains intact; frontend consumers render useful error/retry states.
- **Blocks product work?** No by default; import endpoints must define their own
  stable validation and parser errors before release.
- **Suggested GitHub issue?** Yes; adopt incrementally rather than in one rewrite.

#### D2. Add health, readiness, and request correlation

- **Goal:** Distinguish a live process from one ready to serve database-backed
  traffic and correlate failures across logs.
- **Why:** Deployment and incident diagnosis currently depend mainly on generic
  platform logs.
- **Priority:** P1
- **Risk:** Low
- **Dependencies:** None.
- **Completion criteria:** Safe liveness/readiness endpoints, correlation IDs,
  centralized exception logging, and tests exist without exposing secrets or
  financial content.
- **Blocks product work?** No.
- **Suggested GitHub issue?** Yes.

#### D3. Add deployment smoke checks and focused runbooks

- **Goal:** Make deployment verification and common recovery actions repeatable.
- **Why:** Migration operations are well documented, but general deployment,
  rollback, email outage, and incident diagnosis are not.
- **Priority:** P2
- **Risk:** Low
- **Dependencies:** D2 and actual Render/Vercel/Neon capabilities.
- **Completion criteria:** Short runbooks cover detection, containment, recovery,
  and verification; smoke checks avoid destructive writes and production secrets.
- **Blocks product work?** No.
- **Suggested GitHub issue?** Yes.

#### D4. Improve observability only from demonstrated needs

- **Goal:** Add the smallest metrics/alerts needed to diagnose real availability,
  database, email, and import failures.
- **Why:** Basic visibility is needed, but a complex telemetry stack would be
  premature.
- **Priority:** P2
- **Risk:** Low
- **Dependencies:** D2 and evidence from production operation.
- **Completion criteria:** Platform-native signals are used first; sensitive
  statement, transaction, token, credential, and key material is never logged.
- **Blocks product work?** No.
- **Suggested GitHub issue?** Conditional on a concrete signal gap.

### Track E — Developer and Agent Experience

#### E1. Repair setup and verification documentation

- **Goal:** Make a fresh clone and local verification path accurate and
  reproducible.
- **Why:** The root and generated documentation contain stale SQL Server,
  dependency-installation, verification, and sample-endpoint guidance.
- **Priority:** P2
- **Risk:** Low
- **Dependencies:** Confirmed current commands and supported local services.
- **Completion criteria:** One canonical setup guide documents exact runtime
  expectations, environment configuration, `npm ci`, and all required checks;
  stale generated guidance is removed or replaced.
- **Blocks product work?** No.
- **Suggested GitHub issue?** Yes.

#### E2. Add a root verification entry point

- **Goal:** Provide one discoverable command that runs the repository's required
  frontend and backend checks.
- **Why:** Humans and agents currently assemble the full verification sequence
  from multiple directories and documents.
- **Priority:** P2
- **Risk:** Low
- **Dependencies:** Stable CI commands.
- **Completion criteria:** The root command matches CI, fails clearly, and is
  referenced by `README.md` and `AGENTS.md` without hiding individual checks.
- **Blocks product work?** No.
- **Suggested GitHub issue?** Yes.

#### E3. Document architecture and durable semantics

- **Goal:** Add a concise `ARCHITECTURE.md` describing system context, module
  ownership, dependency direction, auth/session design, deployment topology,
  and approved financial invariants.
- **Why:** Important decisions currently must be reconstructed from code and
  operational prose.
- **Priority:** P2
- **Risk:** Low
- **Dependencies:** A2 and C2 for sections whose decisions are not yet settled.
- **Completion criteria:** The document reflects executable behavior and uses
  ADRs only for decisions with meaningful alternatives and durable consequences.
- **Blocks product work?** No; the import pipeline specification may become a
  focused architecture document independently.
- **Suggested GitHub issue?** Yes.

#### E4. Tighten the agent harness with enforceable references

- **Goal:** Connect `AGENTS.md` to canonical architecture, semantic, and
  verification sources without duplicating them.
- **Why:** The current authority workflow is strong, but agents need durable
  product constraints and machine-enforced definitions of done as autonomy grows.
- **Priority:** P2
- **Risk:** Low
- **Dependencies:** E2 and E3; add scoped instructions only when they provide
  distinct local constraints.
- **Completion criteria:** GitHub Issues continue to define work; risk determines
  authority; medium/high-risk changes require approval; PRs remain independently
  reviewable; corrections stay on the PR branch; agents never merge; production
  actions retain explicit human authority.
- **Blocks product work?** No.
- **Suggested GitHub issue?** Yes.

#### E5. Remove proven dead code and dependencies

- **Goal:** Remove unused packages, providers, models, and compatibility files
  only after non-use is demonstrated.
- **Why:** Unused surface area increases maintenance and misleads humans and
  agents about the actual architecture.
- **Priority:** P2
- **Risk:** Low
- **Dependencies:** Usage inspection and complete verification.
- **Completion criteria:** Each removal is justified, lockfile changes are
  intentional, and all relevant checks pass. Automated dependency updates remain
  reviewable and are not auto-merged.
- **Blocks product work?** No.
- **Suggested GitHub issue?** Yes.

### Track F — Financial Import Readiness

#### F1. Approve an import threat model

- **Goal:** Define the security and privacy boundary before accepting financial
  documents.
- **Why:** PDFs are sensitive, untrusted input and introduce parser,
  resource-exhaustion, retention, and disclosure risks.
- **Priority:** P1
- **Risk:** High
- **Dependencies:** The initial supported scope: Sunflower Bank text-extractable
  PDF statements.
- **Completion criteria:** The approved model defines supported formats; maximum
  file size; page, row, memory, CPU, and time limits; content/type validation;
  malformed-input and parser-failure behavior; no execution of active or embedded
  content; sensitive logging rules; transaction-description privacy;
  document-retention/deletion behavior; and security test expectations.
- **Blocks product work?** Yes — blocks accepting Sunflower statement uploads.
- **Suggested GitHub issue?** Yes; planning and approval only.

#### F2. Specify the normalized import pipeline

- **Goal:** Define `parse → normalize → validate → deduplicate → preview →
  confirm → persist` before implementation.
- **Why:** Format-specific parsing must not leak into core financial semantics or
  allow unreviewed records to be persisted.
- **Priority:** P1
- **Risk:** High
- **Dependencies:** A1–A3, the relevant A5 decisions, B1, and F1.
- **Completion criteria:** The specification defines the normalized imported
  transaction model, provenance/source, parser version where useful, import batch
  identity, per-row errors, idempotency, duplicate policy, preview/confirmation
  lifecycle, atomic versus partial commit behavior, and handling for transactions
  the existing expense model cannot safely represent.
- **Blocks product work?** Yes.
- **Suggested GitHub issue?** Yes; planning and approval only.

#### F3. Establish sanitized import fixtures and verification

- **Goal:** Create a representative, privacy-safe fixture strategy for Sunflower
  parsing and later bank formats.
- **Why:** Real statements contain sensitive information, while parser behavior
  needs stable regression evidence.
- **Priority:** P1
- **Risk:** Medium
- **Dependencies:** F1 and F2.
- **Completion criteria:** Synthetic or irreversibly sanitized fixtures cover
  deposit and electronic-transaction sections, page boundaries, malformed files,
  duplicates, parser limits, and unsupported rows; no real customer statement or
  identifying financial data is committed.
- **Blocks product work?** Yes — fixtures may be developed alongside the parser,
  but must exist before the import feature is considered complete.
- **Suggested GitHub issue?** Yes; may be part of the parser issue.

#### F4. Implement Sunflower PDF import incrementally

- **Goal:** Deliver upload, extraction, normalization, validation, duplicate
  review, preview, confirmation, and persistence for the approved Sunflower PDF
  scope.
- **Why:** This is the next major product capability and the first consumer of
  the import safety foundation.
- **Priority:** Product priority
- **Risk:** High
- **Dependencies:** The current product critical path below.
- **Completion criteria:** Split, independently reviewable issues satisfy F1–F3
  and the approved pipeline; only user-confirmed valid transactions persist;
  existing financial behavior remains protected; PostgreSQL integration tests
  pass; no income or cash-flow semantics are introduced implicitly.
- **Blocks product work?** This is the product work enabled by the blockers.
- **Suggested GitHub issue?** Yes; use an epic/tracking issue plus small delivery
  issues rather than one large PR.

Support for Credit Union of Dodge City should be added only when a representative
statement is available for safe fixture design and parser verification. Income
and cash-flow behavior require their own explicit product-semantic decisions and
must not be inferred from deposits during the initial Sunflower scope.

## Current Product Critical Path — Sunflower Statement Import

The minimum engineering sequence is:

1. **Financial API characterization** — protect current expense and budget
   contracts, authorization, ownership, and financial behavior.
2. **Financial-domain decisions relevant to import** — approve amount, refund,
   date, month, category, ownership, and persistence semantics that imported
   records require.
3. **Necessary write-boundary hardening** — add only the DTO, validation,
   normalization, and database protections needed to persist confirmed imported
   transactions safely.
4. **PostgreSQL-backed financial verification** — verify migrations and the
   database-dependent invariants used by import persistence.
5. **Import threat model** — approve file, parser, resource, privacy, logging,
   and retention boundaries before accepting uploads.
6. **Normalized import pipeline specification** — approve the parse-through-
   persist lifecycle, idempotency, duplicate, preview, error, fixture, and
   transaction-commit policies.
7. **Sunflower PDF import implementation** — deliver the approved scope through
   small, independently reviewable issues and pull requests.

Once steps 1–6 are complete, Sunflower PDF import may proceed even while other
roadmap work remains open.

Completion of unrelated authentication, observability, documentation,
browser-testing, or cleanup roadmap work is not required before Sunflower import
unless implementation reveals a concrete dependency.

## Explicit Non-Goals

The current roadmap does not call for premature introduction of:

- microservices or independently deployed services without an observed boundary;
- Kubernetes or distributed infrastructure without demonstrated scale needs;
- CQRS or event sourcing;
- generic repository abstractions over EF Core;
- service layers that contain no real domain logic or orchestration;
- arbitrary 100% test-coverage requirements;
- GraphQL without a product need;
- a large-scale frontend or TypeScript rewrite for appearance alone;
- automatic production migrations during application startup or deployment;
- automatic pull-request or dependency-update merging;
- complex feature-flag infrastructure;
- an elaborate observability platform before basic health, correlation, logging,
  and platform-native alerts exist; or
- heavyweight project-management or architecture processes.

Professional maturity here means evidence-backed controls and clear ownership,
not adopting enterprise mechanisms without the problems that justify them.

## Revisit Triggers

Reconsider deferred architecture only when repository or production evidence
supports it:

- **Distributed rate limiting or coordination:** the backend runs multiple
  replicas or process restarts materially undermine enforcement.
- **Formal API versioning:** a second independently deployed client needs contract
  stability, or incompatible contracts must coexist.
- **Background processing:** import or email work exceeds safe request lifetimes,
  requires durable retries, or must continue after clients disconnect.
- **Parser process isolation:** supported formats require complex/native parsers,
  or threat analysis or an incident demonstrates a containment need.
- **Additional application layers:** multiple controllers, importers, or scheduled
  workflows must reuse the same financial orchestration and invariants.
- **Advanced observability:** basic health, correlation, structured logs, and
  platform signals fail to diagnose real incidents.
- **Long-lived or revocable session infrastructure:** users need persistent
  sessions, device/session management, refresh-token rotation, or immediate
  revocation.
- **Separate services:** a component has a demonstrated need for independent
  scaling, deployment, isolation, ownership, or availability.

## Working the Roadmap

Each implementation item should begin as a GitHub Issue with explicit scope,
non-goals, risk, dependencies, and measurable acceptance criteria. `AGENTS.md`
remains authoritative for inspection, planning and approval gates, verification,
branch and pull-request handling, correction on an existing PR branch, and human
merge authority.

Roadmap items should normally become small independent pull requests. Updating
this document does not authorize implementation, semantic changes, migrations,
production operations, or destructive actions; those retain their normal risk
classification and approval requirements.
