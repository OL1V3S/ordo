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
- an income model;
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
