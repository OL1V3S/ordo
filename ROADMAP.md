# Ordo Engineering Roadmap

This document is the engineering capability and maturity roadmap for Ordo. It
is not the product backlog. Product direction belongs here only where it shapes
what the system must be able to support, verify, secure, or operate safely.

Roadmap priority and product-feature priority are separate judgments. Updating
this file does not authorize implementation. GitHub Issues and `AGENTS.md`
remain the authority for selecting work, classifying risk, obtaining approval,
reviewing changes, merging, and performing production operations.

## Product Direction

Ordo is moving toward a **manual-first, intelligence-assisted** personal finance
workflow.

The primary everyday loop is to keep Ordo current as money actually moves:

- when money goes out, the user records the Expense;
- when money comes in, the user records the actual cash-in;
- recurring paycheck and commitment intelligence learns from recorded activity,
  reduces repeated work, and surfaces useful patterns;
- expectations and projections help the user plan, but never become historical
  money merely because time passed; and
- statement import is a catch-up and reconciliation aid, not the required
  primary workflow.

The product should become easier to maintain continuously, not more dependent on
month-end cleanup. Intelligence should assist explicit financial truth rather
than silently invent it.

### Product principles

1. **Actual money movement comes first.** Recorded outflows and inflows should be
   equally first-class everyday actions.
2. **Observed and expected are different facts.** Historical cash flow comes
   from persisted observations. Paycheck and commitment expectations remain
   future-looking until an actual event is recorded.
3. **Intelligence reduces work.** Detection, matching, prefill, recurrence, and
   suggestions should make future entry easier without weakening correctness.
4. **Durable inferred meaning is explicit.** When a record becomes a confirmed
   paycheck, commitment, or other meaningful financial relationship, the user
   should understand and control that transition unless a separately approved
   authoritative source justifies automation.
5. **Import is secondary.** Statement import should help users catch up, verify,
   or reconcile records; it should not be required for the normal daily loop.
6. **Automation must earn trust.** Background or automatic actions should follow
   only after deterministic semantics, failure behavior, and verification are
   strong enough to make them safe.
7. **Calm on the surface, rigorous underneath.** UX should remain simple while
   financial semantics, provenance, validation, and error states stay precise.

## Product Capability Direction

The sequence below describes the capabilities the engineering roadmap should
support. It is directional context, not an automatically executable backlog.

### 1. Complete the manual money-movement loop

Ordo already supports first-class manual Expense entry and backend manual
`AccountInflow` CRUD. The next product capability direction is to make incoming
money equally usable from the customer experience.

Engineering should support:

- first-class manual cash-in entry in the frontend;
- truthful loading, failure, retry, and uncertain-write states matching the
  standards already used for Expenses and Budgets;
- immediate participation of saved inflows in historical cash-flow analytics;
- an explicit **Record paycheck received** workflow that creates an actual
  inflow rather than converting an expectation into money automatically;
- explicit linkage of an actual inflow to the appropriate paycheck profile when
  the user confirms that relationship; and
- one-inflow-at-most-one-paycheck ownership and concurrency protection.

A projected payday must never create cash automatically. If the user does
nothing, historical totals remain unchanged.

### 2. Make Activity represent the money the user records as they go

The customer mental model should become coherent across money out and money in.
Engineering should support a clear recorded-activity experience where the user
can understand what has been persisted without mixing observations with
forecasts.

This may eventually include a unified or coordinated Activity presentation for
Expenses and AccountInflows, but exact product design must be approved before
implementation. Existing Expense and inflow semantics should not be collapsed
into a generic transaction model merely for UI convenience.

### 3. Build intelligence on top of actual records

Recurring intelligence should increasingly reduce manual repetition after the
basic recording loop is coherent.

Engineering should support, when separately approved:

- deterministic suggestions that connect newly recorded inflows to known
  paycheck profiles;
- recurring-expense and commitment learning from recorded Expenses;
- recurring-paycheck learning from recorded inflows;
- clear confidence/evidence presentation and reversible user decisions;
- change detection where enough evidence exists to define a trustworthy rule;
  and
- prefilled actions that preserve the distinction between an expectation and an
  observed event.

Do not introduce fuzzy or LLM-only financial classification merely because it
is convenient. Deterministic, explainable matching remains the default until a
stronger approach has explicit semantics and verification.

### 4. Improve ongoing planning and financial awareness

Once recorded activity is easy to maintain, Ordo should make those records more
useful for everyday decisions.

The roadmap should support:

- clear historical cash-in, spending, and net recorded cash-flow views;
- budget attention based on recorded spending;
- expected paycheck and commitment context that remains visibly separate from
  historical totals;
- useful trend and category analysis; and
- future planning features only when their data requirements and financial
  meaning are explicit.

Safe-to-Spend, canonical balance, forecasted balance, overdraft prediction, and
expense-to-paycheck allocation remain separate product decisions. They must not
be inferred from the current historical cash-flow model.

### 5. Treat import as catch-up and reconciliation support

Statement import remains valuable, but its role changes from product center to
supporting workflow.

Engineering should preserve and extend import so it can:

- help a user catch up after not recording activity for a period;
- surface possible duplicates instead of silently duplicating records;
- preserve explicit selection and confirmation before persistence;
- support additional institutions only when representative privacy-safe fixtures
  and parser verification exist; and
- eventually assist reconciliation without claiming a canonical bank balance
  before balance semantics are separately approved.

### 6. Add safer automation only after the manual loop is trustworthy

Potential later capabilities include reminders, missed-expected-event handling,
automatic matching, background processing, and richer proactive insights.

These should be introduced only when:

- the underlying event semantics are already explicit;
- duplicate/idempotency behavior is deterministic;
- false-positive and recovery behavior are acceptable;
- the user can understand what the automation did; and
- verification can prove the important failure paths.

## Engineering North Star

Ordo should remain an understandable, testable, secure, and
production-conscious application that humans and coding agents can modify
safely. Engineering controls should protect financial behavior and make
failures diagnosable while keeping the architecture appropriately simple for a
small full-stack product.

## Current Shipped Foundation

Ordo is an appropriately scoped modular monolith with a React/Vite frontend, an
ASP.NET Core API, and PostgreSQL. The current shipped foundation includes:

- authenticated Expense CRUD and monthly category budgets;
- owner-scoped `AccountInflow` persistence and authenticated inflow CRUD;
- first-class Activity cash-in entry, search, edit, and delete;
- Sunflower statement preview/import with explicit debit and credit selection;
- recurring Commitment Intelligence with confirmation, lifecycle, evidence, and
  reviewed change workflows;
- Paycheck Intelligence with candidates, confirmed/manual profiles, lifecycle,
  explicit actual-receipt creation/linking and correction, evidence links, and
  deterministic next-paycheck projection;
- historical cash-flow analytics using recorded AccountInflows and Expenses;
- the completed Ordo UX V3 information hierarchy and responsive/accessibility
  pass;
- frontend, backend/container, and PostgreSQL CI lanes; and
- risk-sensitive AI-assisted repository governance in `AGENTS.md`.

Important current product gaps relative to the direction above include:

- no automatic attachment of later inflows to an existing paycheck profile;
- no canonical tracked-account balance or reconciliation model;
- no Safe-to-Spend or forecasted-balance semantics; and
- no missed-paycheck diagnosis or background financial-event automation.

## Engineering Principles

- Treat financial correctness as a product requirement.
- Preserve the distinction between observations, classifications, expectations,
  and projections.
- Enforce important invariants through validation, tests, schemas, and CI where
  practical.
- Gather evidence before adding abstractions or changing behavior.
- Preserve existing behavior unless a semantic change is explicitly approved.
- Prefer small, independently reviewable issues and pull requests.
- Keep irreversible, security-sensitive, data, and exceptional production
  authority with a human.
- Increase agent and product automation only as verification makes it safe.
- Make production failures diagnosable without exposing credentials, tokens,
  financial descriptions, statements, or other sensitive data.
- Add architecture only in response to demonstrated product or operating needs.
- Keep documentation concise, useful, and aligned with executable behavior.

## Roadmap Tracks

Tracks communicate engineering capabilities that can usually progress in
parallel. A track item becoming important does not itself select it as current
work; task selection still follows `AGENTS.md` and durable GitHub state.

### Track A — Financial Event Correctness

#### A1. Maintain completed paycheck receipt semantics

- **Goal:** Preserve the shipped explicit action for recording actual paycheck
  cash against an existing active profile.
- **Why:** The receipt workflow is the bridge from expected paycheck to observed
  cash-in and must remain financially exact as adjacent features evolve.
- **Priority:** Shipped foundation; maintain under required CI.
- **Risk:** High.
- **Completion criteria:** Owner-approved semantics cover new versus existing
  inflow linkage, actual amount/date, occurrence meaning, schedule-slot mapping,
  one-inflow-one-profile enforcement, idempotency, edits/deletion, projection
  advancement, and owner isolation. Historical totals change only through an
  actual AccountInflow.

#### A2. Keep inflow and expense write boundaries symmetric where appropriate

- **Goal:** Give manual inflow entry the same quality of validation, truthful
  write outcome handling, retry behavior, and user isolation already expected
  from core Expense workflows.
- **Why:** Manual-first tracking is incomplete if money-in entry is less reliable
  or less understandable than money-out entry.
- **Priority:** Near-term.
- **Risk:** Medium to High depending on whether backend semantics change.
- **Completion criteria:** Frontend and API tests preserve current inflow
  validation/ownership rules and distinguish completed writes, failed reads, and
  uncertain write outcomes without duplicate retries.

#### A3. Preserve and strengthen financial invariants

- **Goal:** Continue hardening amount/date/category/month, ownership, uniqueness,
  and concurrency rules only where demonstrated gaps remain.
- **Why:** Manual-first use increases the importance of correct everyday writes.
- **Priority:** P1 when a concrete integrity gap affects active product work.
- **Risk:** Medium to High.
- **Completion criteria:** Each changed invariant is explicitly approved, tested
  at the correct boundary, and database-enforced where corruption would be
  otherwise possible.

#### A4. Add balance/reconciliation semantics only through a separate decision

- **Goal:** Define canonical balance, reconciliation, or forecast semantics only
  if a future product feature truly requires them.
- **Why:** Historical cash flow is not a bank balance and must not quietly become
  one.
- **Priority:** Deferred until product need is explicit.
- **Risk:** High.
- **Completion criteria:** Source of truth, opening/closing balance behavior,
  missing-record handling, transfers, corrections, and reconciliation state are
  owner-approved before implementation.

### Track B — Intelligence Assistance

#### B1. Explicit paycheck matching assistance

- **Goal:** Reduce repeated paycheck entry by suggesting or prefilling links
  between real inflows and known paycheck profiles.
- **Why:** Intelligence should save work after the user has established durable
  paycheck meaning.
- **Priority:** After the explicit manual receipt loop is coherent.
- **Risk:** High if matching creates durable financial meaning automatically;
  lower if suggestion-only.
- **Completion criteria:** Matching identity, ambiguity, confidence, user control,
  duplicate handling, and recovery are explicit and tested.

#### B2. Continue commitment/paycheck pattern learning

- **Goal:** Improve recurring pattern usefulness without broadening financial
  meaning silently.
- **Why:** Learning from actual records is the main intelligence advantage of the
  manual-first model.
- **Priority:** Product-driven.
- **Risk:** Depends on semantic impact.
- **Completion criteria:** New detection/change rules are deterministic or have
  separately approved probabilistic semantics, explainable evidence, and stable
  replayable tests.

#### B3. Proactive assistance only after event semantics are trustworthy

- **Goal:** Evaluate reminders, expected-event follow-up, or other proactive
  assistance after the underlying record/link actions are stable.
- **Why:** Notifications around ambiguous or automatically invented financial
  events would reduce trust.
- **Priority:** Deferred.
- **Risk:** Medium to High.
- **Completion criteria:** Trigger semantics, privacy, deduplication, retries,
  stale-state handling, and user controls are approved and testable.

### Track C — Product Verification

#### C1. Maintain production-equivalent financial CI

- **Goal:** Keep frontend, backend/container, and PostgreSQL verification aligned
  with the financial workflows Ordo actually ships.
- **Why:** Manual daily usage makes regressions in writes, reads, and cross-domain
  aggregation immediately user-visible.
- **Priority:** P1.
- **Risk:** Low.
- **Completion criteria:** Required CI covers new inflow/paycheck receipt behavior
  and migration chains where applicable without using hosted production data as
  a test substitute.

#### C2. Add a minimal browser smoke suite

- **Goal:** Prove a few critical browser-to-API journeys end to end.
- **Why:** Component/API tests do not prove the complete customer workflow.
- **Priority:** P2, rising as manual-first flows expand.
- **Risk:** Medium.
- **Completion criteria:** Deterministic isolated smoke coverage includes core
  expense entry, cash-in entry once shipped, budgets, and one high-value
  paycheck/receipt path without production secrets or real financial data.

#### C3. Verify repository protection and required checks

- **Goal:** Confirm that expected checks and human/command-center review policy
  are actually enforced for `main`.
- **Why:** Workflow files alone do not prove repository protection.
- **Priority:** P1 operational maturity.
- **Risk:** Medium.
- **Completion criteria:** Required checks, force-push policy, review expectations,
  and merge authority are verified and recorded.

### Track D — Authentication and Security

#### D1. Make login lockout behavior intentional and effective

- **Goal:** Enforce and test the approved account lockout policy or replace it
  with an explicitly approved equivalent.
- **Priority:** P1 security maturity.
- **Risk:** High.

#### D2. Define and harden session/JWT policy

- **Goal:** Make issuer, audience, key requirements, lifetime, storage, and
  revocation expectations explicit and tested.
- **Priority:** P1 security maturity.
- **Risk:** High.

#### D3. Normalize auth privacy and throttling

- **Goal:** Make enumeration resistance, endpoint throttling, and recovery
  responses intentional across authentication flows.
- **Priority:** P1 security maturity.
- **Risk:** Medium to High.

Authentication work does not automatically block manual-first product work
unless a concrete security dependency is identified.

### Track E — Operations and Reliability

#### E1. Establish consistent API error contracts

- **Goal:** Use stable, privacy-safe error codes where clients must branch on
  failures.
- **Why:** Manual-first UX needs reliable distinctions among validation, unknown
  write outcomes, stale state, conflicts, and unavailable reads.
- **Priority:** P1 when touching affected APIs.
- **Risk:** Medium.

#### E2. Health, readiness, and request correlation

- **Goal:** Make production failures diagnosable without exposing financial
  content.
- **Priority:** P1 operational maturity.
- **Risk:** Low.

#### E3. Focused deployment smoke checks and runbooks

- **Goal:** Make deploy/rollback and common incident recovery repeatable.
- **Priority:** P2.
- **Risk:** Low.

#### E4. Add observability only from demonstrated needs

- **Goal:** Use platform-native health, logs, and alerts before adopting a larger
  telemetry stack.
- **Priority:** P2.
- **Risk:** Low.

### Track F — Import and Reconciliation Support

#### F1. Keep statement import safe and secondary

- **Goal:** Preserve the existing privacy, parser, preview, selection,
  duplicate-warning, confirmation, and atomic-persistence guarantees while
  treating import as a catch-up workflow.
- **Why:** Import remains useful without defining the primary product interaction
  model.
- **Priority:** Maintenance / product-driven.
- **Risk:** High for parser or financial-write semantic changes.

#### F2. Add institution support only with representative fixtures

- **Goal:** Expand beyond current Sunflower support only when a representative
  statement can be modeled safely with synthetic or irreversibly sanitized
  regression fixtures.
- **Priority:** Product-driven.
- **Risk:** Medium to High.

#### F3. Reconciliation requires separate financial semantics

- **Goal:** If Ordo later compares its records against statement/account totals,
  define the exact reconciliation model before implementation.
- **Why:** Duplicate detection and import confirmation are not equivalent to a
  canonical bank ledger or balance.
- **Priority:** Deferred until product need is explicit.
- **Risk:** High.

### Track G — Developer and Agent Experience

#### G1. Keep setup, architecture, and verification docs current

- **Goal:** Ensure fresh-clone setup, architecture, product boundaries, and
  verification instructions match executable behavior.
- **Priority:** P2, or P1 when stale docs create delivery risk.
- **Risk:** Low.

#### G2. Maintain one canonical verification entry point

- **Goal:** Keep root verification commands aligned with CI without hiding the
  individual lanes.
- **Priority:** P2.
- **Risk:** Low.

#### G3. Tighten the agent harness with enforceable references

- **Goal:** Prefer mechanical checks and durable repository guidance over
  repeated prompt-only reminders when recurring failures reveal a real gap.
- **Priority:** P2.
- **Risk:** Low.

#### G4. Remove proven dead code and dependencies

- **Goal:** Remove unused surface only after non-use is demonstrated and complete
  verification passes.
- **Priority:** P2.
- **Risk:** Low.

## Current Capability Sequence

This sequence describes the product direction the engineering roadmap should
make possible. It does **not** authorize these items by itself.

1. **First-class manual cash in (shipped)** — users can record incoming money as
   naturally as they record expenses.
2. **Record paycheck received (shipped)** — users can connect a saved paycheck
   expectation to an actual observed inflow without inventing money on payday.
3. **Recorded Activity coherence** — make money-in and money-out records easy to
   review while preserving their distinct domain semantics.
4. **Intelligence-assisted matching and recurrence** — reduce repeated entry with
   explainable suggestions based on actual records.
5. **Richer planning** — use trustworthy historical records plus clearly labeled
   expectations for more useful budgeting and planning, with Safe-to-Spend or
   balance features requiring separate semantics.
6. **Catch-up/reconciliation improvements** — strengthen import and duplicate
   handling as a secondary workflow.
7. **Proactive automation** — reminders, automatic matching, or background
   assistance only after semantics and verification justify the trust increase.

## Explicit Non-Goals

The current roadmap does not call for premature introduction of:

- automatic conversion of expected paychecks or commitments into historical
  financial records;
- automatic classification of arbitrary incoming money as income or paycheck;
- Safe-to-Spend, canonical balance, or forecasted balance without separate
  owner-approved semantics;
- fuzzy or LLM-only financial classification without an explicit trustworthy
  decision model;
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

- **Canonical balance/reconciliation:** users need bank-total reconciliation,
  Safe-to-Spend, forecasted balances, or multi-account transfer handling.
- **Distributed rate limiting or coordination:** the backend runs multiple
  replicas or process restarts materially undermine enforcement.
- **Formal API versioning:** a second independently deployed client needs contract
  stability, or incompatible contracts must coexist.
- **Background processing:** import, notifications, matching, or email work
  exceeds safe request lifetimes, requires durable retries, or must continue
  after clients disconnect.
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
branch and pull-request handling, correction on an existing PR branch, and merge
authority.

`ROADMAP.md` communicates direction and engineering capability needs. It is not a
product backlog and must not be used to choose work autonomously. If no active or
explicitly authorized issue exists, return to product/planning mode with the
owner.

Roadmap items should normally become small independent pull requests. Updating
this document does not authorize implementation, semantic changes, migrations,
production operations, or destructive actions; those retain their normal risk
classification and approval requirements.
