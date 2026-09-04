# Financial Domain Invariants

## Purpose and authority

This document records the approved meaning of Ordo's core financial
concepts. `AGENTS.md` governs workflow and agent authority, while `ROADMAP.md`
governs engineering sequencing. This document governs financial-domain
semantics. Changing these semantics requires explicit human approval.

The target representations below describe approved future behavior. They do
not imply that the current API, schema, or stored data already conforms.

Approved recurring-commitment semantics and V1 boundaries are defined in
[`commitment-intelligence.md`](commitment-intelligence.md).

## Expense invariant

For the current product scope, an expense is an authenticated user's debit or
outflow from the tracked checking account. Its amount:

- must be strictly greater than zero;
- must have at most two decimal places; and
- may use the existing application and database representable monetary range.

There is no additional product-specific monetary ceiling. Economic meaning in
another account does not exclude a valid tracked-account debit: ordinary
purchases, subscriptions, bills, credit-card or loan payments, person-to-person
payments, transfers, bank fees, and brokerage or investment-funding debits may
all be represented as positive expenses when they reduce the tracked checking
account balance.

Deposits, refunds, credits, income, and other movements that increase the
tracked checking account balance are not negative expenses and must not be
persisted as expenses merely by changing their sign.

If Ordo later tracks multiple accounts, this invariant must be
revisited before cross-account transfers are represented so the product does
not accidentally double-count the same movement across tracked accounts.

## Account inflow invariant

An `AccountInflow` is owner-scoped evidence that money increased the one
tracked checking account. It is not an `Expense`, does not use a negative
amount, and does not by itself classify the movement as income or a paycheck.
Transfers, refunds, reimbursements, and other non-paycheck credits may therefore
be retained as inflow evidence without acquiring income meaning.

Its amount is strictly positive, uses at most two decimal places, and shares the
application's `numeric(18,2)` monetary range. Its posted date is a calendar date
using API `YYYY-MM-DD`, .NET `DateOnly`, and PostgreSQL `date`. Its description
is required, outer-trimmed at the authoritative write boundary, limited to 500
characters, and preserves meaningful case and internal text.

Ownership comes only from authenticated identity. Manual inflows have no import
provenance. A confidently directed imported credit becomes an `AccountInflow`
only when the user explicitly selects it during statement review; that selection
is false by default. Credits never become Expenses, and saving an imported
credit does not call it income or a paycheck.

## Confirmed paycheck profiles

The owner-approved Stage 4 plan on [issue #114](https://github.com/OL1V3S/ordo/issues/114)
establishes the backend profile and API boundary. A detector candidate is derived
evidence until the user explicitly confirms it. A manual profile is a separate
explicit statement of expected paycheck behavior; creating an `AccountInflow`
alone never creates a paycheck. Multiple profiles per owner remain valid.

Profiles store a user-controlled display name, paycheck-specific lifecycle
(`active`, `paused`, `ended`), immutable schedule, accepted timing windows, and
either a fixed amount or an explicitly accepted range. Names are outer-trimmed,
nonblank, and at most 500 characters. Amounts are positive `numeric(18,2)` values
with at most two decimals; range minimum must be strictly less than maximum.
Each timing window is explicitly supplied and is between zero and three days.
An observed variable amount requires an explicit confirmed range; raw detector
minimum/maximum values are never automatically adopted as the expectation.

Schedules reuse the unchanged Stage 2 types and rules:

- weekly and biweekly use only a reference anchor date;
- monthly uses one canonical day-of-month or month-end anchor;
- semimonthly uses two ordered canonical anchors that remain at least seven
  days apart within and across months;
- a day-of-month API anchor has `kind: day_of_month` and day `1..30`; a month-end
  anchor has `kind: month_end` and null day. Persistence encodes month end as 31.

All schedule variants have exclusive shapes: interval schedules cannot contain
month anchors, and calendar schedules cannot contain an interval reference.
Candidate confirmation must explicitly accept the exact detector schedule;
changing it returns `400 candidate_schedule_mismatch`. Changing a durable
schedule requires explicitly ending the old profile and creating/confirming a
replacement. Updates may change only the display name, accepted windows, and
amount. All lifecycle transitions, including reactivation, are explicit. There
is no profile-delete API, automatic transition, or automatic evidence release.

### Evidence, decisions, and concurrency

Each `PaycheckOccurrence` stores one exact confirmation-evidence membership:
profile/inflow IDs, consistent owner, evidence revision at assignment, slot
anchor, timing offset, and link time. Composite foreign keys enforce owner
consistency; a unique inflow index prevents assignment to a second profile.
Occurrences do not imply employer verification, gross pay, taxes, deductions,
payroll-document truth, or earned-income classification.

Editing an assigned inflow keeps its assignment. The stored revision enables an
`editedSinceConfirmation` flag without retaining duplicate financial snapshots
or diagnosing a paycheck change. Deleting an inflow removes only its occurrence
link, leaving the profile unchanged. Pausing or ending a profile retains its
assignments. Candidate detection excludes claimed inflows before invoking the
unchanged `paycheck-candidate-v1` detector. A later disjoint set of evidence may
surface a new candidate, including for the same exact normalized description.
There is no fuzzy matching or automatic attachment to an existing profile.

Dismissal identity is owner + algorithm version + cadence + exact fingerprint.
Reads partition current candidates into available/dismissed arrays without
deleting obsolete decisions. Dismiss is idempotent for an existing exact row;
otherwise it requires the current candidate. Reconsider removes only that exact
owner decision and is idempotent even after the candidate changes.

Confirmation recomputes owner-scoped candidates in a serializable transaction,
checks the exact version/fingerprint and accepted schedule, rejects an exact
dismissal, locks selected inflows in ascending ID order, and revalidates their
revisions and assignment state. One profile and every candidate occurrence are
written atomically. The unique owner/version/origin fingerprint makes a retry
return the existing profile, even after later profile edits or evidence deletion.
Conflicting confirmations cannot both claim an inflow; a loser returns the same
winner for an identical origin or a stable conflict after rollback. Manual
creation accepts no evidence IDs and creates no occurrences.

### Authenticated API and projection contract

Owner identity comes only from claims. Request and response DTOs expose no
authoritative owner IDs. Candidate evidence contains current dates, descriptions,
amounts, manual/imported source, and exact slot assignments; no evidence revision
is exposed. Candidates sort by normalized identity and fingerprint ordinal;
evidence sorts by posted date and inflow ID. Profiles sort by lifecycle rank
(`active`, `paused`, `ended`), display name ordinal, then ID.

| Route | Result |
| --- | --- |
| `GET /api/paycheck-candidates` | Evaluation date, available and dismissed candidates |
| `POST /api/paycheck-candidates/dismiss` | Exact version/cadence/fingerprint dismissal; `204` |
| `POST /api/paycheck-candidates/reconsider` | Exact decision removal; `204` |
| `POST /api/paycheck-candidates/confirm` | Profile plus `alreadyConfirmed`; `201`, or `200` on retry |
| `POST /api/paychecks` | Explicit active manual profile; `201` with item location |
| `GET /api/paychecks` | One evaluation date and ordered profiles |
| `GET /api/paychecks/{id}` | Current profile, evidence, and projection |
| `PUT /api/paychecks/{id}` | Update display name, windows, and accepted amount |
| `PATCH /api/paychecks/{id}/lifecycle` | Explicit active/paused/ended transition |

Missing and foreign profile GET/PUT/PATCH operations return the same empty `404`.
Validation returns privacy-safe `400` ProblemDetails with stable codes. Candidate
staleness, dismissal, and conflicting confirmation return `409` without foreign
owner disclosure. A failed database write during confirmation rolls back and
returns a generic `500 confirmation_failed` without database details. Financial
content, request bodies, and tokens are not logged.

Only active profiles invoke the unchanged `paycheck-projector-v1`. The confirmed
pattern maps directly from persisted schedule/windows/amount and the maximum
slot anchor among currently linked occurrences, or null when no links remain.
The response supplies algorithm version, one captured UTC evaluation date,
anchor, earliest/latest expected dates, and accepted amount. Paused/ended
profiles return null projection. These dates are **expected, not guaranteed**;
there is no missed-pay diagnosis or amount/timing change detection. Writes whose
projection window would exceed the representable calendar are rejected before
persisting that state.

The Stage 4 migration is additive and has no backfill. An ordinary application
rollback leaves the added tables inert. Production schema readiness must precede
application rollout; creating/testing this migration locally or in CI does not
authorize production application. Down removes occurrence links before decision
and profile tables and would destroy durable decisions. Production Down or data
cleanup requires separate explicit authorization and a retention/export decision.

## Description invariant

An expense description is required. At the authoritative write boundary it is
trimmed of leading and trailing whitespace, rejected if blank after trimming,
and limited to 500 characters. Case and meaningful internal text are
preserved.

Raw bank descriptions and source provenance are separate import concerns and
must not be overloaded into the expense description.

## Category invariant

Categories remain strings and may be custom. At the authoritative backend
boundary, a category is:

- trimmed of leading and trailing whitespace;
- normalized by collapsing repeated internal whitespace;
- lowercased invariantly;
- rejected if blank after normalization; and
- limited to 100 characters.

`"other"` is a UI-only sentinel or control value and is not a persisted
category. `"uncategorized"` is the canonical persisted value for a transaction
that has not yet been assigned a meaningful category. A category-ID or taxonomy
subsystem requires a separate demonstrated product need and approval.

## Expense date invariant

An expense date is a business or calendar date, not an instant in time. It has
no timezone or implicit local/UTC clock meaning. The approved targets are:

- API: `YYYY-MM-DD`;
- .NET: `DateOnly`; and
- PostgreSQL: `date`.

Existing data must be inspected before any date migration. No date conversion
or migration policy is authorized by this document. Preserving the stored
calendar date is the presumptive goal, but it must first be validated against
real data.

## Budget invariant

A budget belongs to one calendar month. Its target API representation is
`YYYY-MM`, and its canonical storage representation is the first day of that
month as a date without timezone semantics.

A configured budget amount:

- must be greater than or equal to zero;
- may be zero to express an intentional zero-spend limit;
- must not be negative; and
- must have at most two decimal places.

A zero-valued budget record and an absent budget record are distinct: zero is
an intentional no-spend budget, while absence means no budget is configured.

There should eventually be at most one budget per:

`(UserId, CanonicalCategory, BudgetMonth)`

That invariant should be database-enforced with an atomic upsert. Last
committed write may win unless later product requirements justify stronger
optimistic concurrency. Duplicate cleanup has **not** been authorized. Existing
duplicates and category-normalization collisions must be inspected and a
resolution policy separately approved before a uniqueness migration. No row
may be selected, merged, or deleted automatically.

## Ownership and API boundary

Financial ownership comes exclusively from authenticated identity claims.
Clients must not control or provide authoritative ownership. Future financial
request DTOs must not accept `userId`; user-scoped response DTOs should omit
`userId`, and persistence or navigation fields such as `user` must not be
public API fields.

Financial APIs must use explicit request and response DTOs rather than EF
entities. Unrelated behavior, including the existing expense `PUT` route/body
ID agreement, must be preserved during the initial DTO transition. Cross-user
isolation remains mandatory, including the current `404` behavior used to
avoid disclosing another user's resource.

## Validation responsibilities

- **Frontend:** provides UX feedback only and is never authoritative.
- **Request DTO/API boundary:** validates required fields, formats, lengths,
  ranges, and monetary precision.
- **Application/domain logic:** applies canonicalization, authenticated
  ownership, and business semantics.
- **Controllers:** handle HTTP, authentication, and routing concerns.
- **EF configuration:** defines persistence representations, lengths,
  precision, and conversions.
- **PostgreSQL:** enforces important invariants whose violation could corrupt
  financial meaning, including appropriate checks and uniqueness.
- **Tests:** verify the relevant boundary and cross-layer behavior.

Rules should be enforced where they provide protection, not duplicated blindly
in every layer.

## Existing behavior that will intentionally change

The A1 characterization baseline records current behavior; it must not be
changed until a separately approved implementation issue changes the behavior.
Known differences between that baseline and the approved targets include:

- zero and negative expenses are currently accepted, but both will be invalid;
- zero and negative budgets are currently accepted, but only zero will remain
  valid;
- description and category case or whitespace may currently be preserved;
- category equality is currently case- and whitespace-sensitive;
- expense dates and budget months currently use timestamp-shaped values;
- duplicate budget rows can currently exist and be returned; and
- financial API responses currently expose `userId` and `user` fields.

These are intentional future semantic changes, not documentation-only changes
to current executable behavior.

## Data-inspection requirements

Restrictive validation, constraints, normalization, or migrations require a
read-only inspection of relevant existing data first. At minimum, inspect for:

- non-positive expense amounts;
- negative budget amounts;
- invalid monetary precision;
- blank, oversized, or otherwise invalid descriptions and categories;
- collisions caused by proposed category normalization;
- legacy expense and budget timestamps;
- duplicate budgets under current and canonical keys; and
- ownership anomalies.

Inspection does not authorize cleanup. Do not automatically delete records,
flip signs, round values, truncate text, merge or normalize categories, convert
dates, remove duplicate budgets, or recategorize transactions. Any destructive
or semantic cleanup requires separate human approval.

## Sunflower import blockers

Before imported transactions can safely persist as expenses, the applicable
implementation must provide:

- the positive tracked-account outflow model;
- reliable debit/credit direction so supported debits are eligible and credits
  or deposits remain excluded;
- monetary precision enforcement;
- date-only semantics;
- description requirements;
- category canonicalization and `"uncategorized"` handling;
- ownership derived from authenticated identity;
- authoritative backend validation; and
- PostgreSQL-backed verification for relevant persistence guarantees.

## Deferred import decisions

The following remain for F1, F2, or later approved product work:

- refund and reversal relationships beyond current direction-based treatment;
- a broader income model beyond the explicitly confirmed paycheck boundary;
- merchant extraction;
- provenance and raw descriptions;
- parser versions;
- duplicate fingerprints and idempotency;
- preview and review workflows;
- statement reconciliation;
- batch atomicity; and
- source-account semantics beyond the current single tracked checking account.

## Implementation destinations

- **A3 — Financial write boundaries:** request/response DTOs, authoritative
  write validation, ownership assignment, and the minimum safe normalization.
- **A4 — Budget uniqueness and concurrency:** inspected cleanup planning,
  atomic upsert behavior, and database-enforced uniqueness.
- **A5 — Date, month, and category semantics:** aligned API, application,
  frontend, and persistence representations.
- **B1 — PostgreSQL verification:** integration evidence for constraints,
  persistence types, migrations, and concurrency behavior.
- **F1 — Import threat model:** risks and trust boundaries for user-provided
  financial documents.
- **F2 — Normalized import pipeline:** classification, normalization, review,
  and safe persistence of imported transactions.

Refer to `ROADMAP.md` for sequencing, dependencies, and completion criteria.
