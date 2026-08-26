# Sunflower PDF Import Pipeline

## Status and authority

This document records the approved V1 financial-processing pipeline for importing supported Sunflower Bank PDF statements into Ordo.

The approved flow is:

`parse → normalize → validate → deduplicate → preview → confirm → persist`

This specification governs transaction meaning, review behavior, idempotency, and persistence eligibility for the initial Sunflower PDF import. It complements [`import-threat-model.md`](import-threat-model.md), which governs the untrusted-document security and privacy boundary, and [`financial-domain-invariants.md`](financial-domain-invariants.md), which governs core financial semantics.

This document does **not** make statement import current executable behavior. Parser selection, upload/UI implementation, schema or migration changes, and persistence implementation require separate scoped work under `AGENTS.md` and `ROADMAP.md`.

## Pipeline boundary

A parsed bank row must never become an `Expense` directly.

The V1 pipeline is:

1. **Parse** the supported Sunflower statement under the approved F1 threat-model limits.
2. **Normalize** each supported source row into a bank-neutral imported-row representation.
3. **Validate** required financial fields and supported formats.
4. **Deduplicate** against exact import provenance and existing expense data.
5. **Preview** every successfully parsed batch for authenticated-user review.
6. **Confirm** only explicitly selected, valid rows after authoritative backend revalidation.
7. **Persist** selected rows as ordinary expenses atomically and idempotently once all persistence prerequisites are satisfied.

Format-specific parsing must remain separate from the core expense write boundary. Existing Transactions, Budgets, and Analytics continue to consume normal `Expense` records after a successful import; V1 does not introduce a parallel outflow model.

## Normalized imported row

The parser produces a bank-neutral imported row rather than an `Expense` entity.

The conceptual V1 row includes:

- a server-generated batch-local row identifier or stable row ordinal;
- posted **calendar date** using the approved date-only semantics;
- positive absolute monetary amount with at most two decimal places;
- direction: `debit` or `credit`;
- source description for authenticated-user preview only;
- source section/type from the statement where available;
- classification state;
- editable expense description when the row is eligible for expense import;
- category, defaulting to canonical `uncategorized` for eligible expenses;
- validation errors and warnings;
- duplicate status;
- selected-for-import state; and
- minimum provenance metadata required to identify source, parser/rule version, batch, and source row without retaining the original PDF.

The normalized import model is intentionally broader than `Expense`. Credits and deposits may exist in preview without being representable as negative expenses.

## Classification states

V1 uses four classification states:

- `expense_candidate` — a supported, valid debit/outflow from the tracked checking account and eligible for user selection;
- `needs_review` — a transaction-like row was recognized, but the parser cannot confidently establish debit/credit direction or another required source fact; never auto-selected or persisted;
- `non_expense` — a known credit or deposit that increases the tracked checking account balance and is excluded from expense persistence; and
- `invalid` — cannot satisfy required date, amount, description, or supported-format rules.

Classification rules must be explicit, testable, and versioned when a rule change can affect normalized output.

Once a supported row is confidently identified as a valid debit, its economic meaning in another account is not a reason to exclude it from the current tracked-checking-account expense model.

## Sunflower classification policy

For the initial supported Sunflower statement format:

- rows from **Deposits/Credits** sections are `non_expense` when their direction is confidently established as money into the tracked checking account;
- every supported, valid debit is `expense_candidate`, including ordinary merchant purchases, subscriptions, rent and bills, bank fees, credit-card payments, loan/account payments, account-to-account transfers, outgoing person-to-person/payment-app payments, and brokerage/investment-funding debits;
- `needs_review` is reserved for source-parsing uncertainty such as a transaction-like row whose direction or required source facts cannot be established confidently, not for uncertainty about whether a valid debit is "true spending"; and
- unsupported sections or rows are surfaced as unsupported/invalid according to parser confidence and are never silently persisted.

No income model is introduced by V1. Credits and deposits may be visible in preview as excluded rows but are not persisted as expenses.

## Validation

Normalized rows must satisfy the approved financial-domain invariants before they can become expenses.

At minimum, eligible rows require:

- a valid date-only calendar date;
- a positive amount with at most two decimal places;
- a valid editable expense description under the current description invariant;
- a valid canonical category, defaulting to `uncategorized`; and
- ownership derived exclusively from the authenticated user.

Frontend validation is user experience only. Confirmation must revalidate the selected rows on the backend; client preview state is never authoritative.

## Preview and review behavior

Every successfully parsed batch reaches a review screen before financial persistence.

For each row, preview should expose to the authenticated user:

- date;
- source description;
- amount and debit/credit direction;
- classification/status;
- duplicate warning when relevant;
- editable expense description and category for rows eligible to become expenses; and
- whether the row is selected for import.

Default selection behavior:

- `expense_candidate`: selected by default only when validation is clean and there is no duplicate warning;
- `needs_review`: not selected until the source ambiguity is resolved into an eligible debit or an excluded credit/deposit;
- `non_expense`: cannot be selected for expense import in V1; and
- `invalid`: cannot be selected for expense import.

Rows with possible-duplicate warnings are not selected by default. The user must explicitly choose to import them.

V1 does not auto-categorize merchants. Eligible expenses default to `uncategorized` unless the user chooses another valid category during review.

## Import batches and ownership

Each successful parse receives a server-generated UUID batch ID.

Batch ownership comes exclusively from the authenticated Ordo user. Clients do not supply or choose authoritative ownership, and cross-user batch or preview access must be impossible.

The original PDF is discarded according to the F1 threat model. If preview state is persisted, it may contain only the normalized rows and metadata required for the review lifecycle, never the original PDF bytes.

## Exact re-upload idempotency

During bounded processing, compute a SHA-256 digest of the uploaded PDF bytes. After processing, discard the original bytes and retain only the digest as non-reversible import metadata scoped to the authenticated user and source type.

The digest is used only as an exact-document identity aid; it does not replace structural PDF validation and must not be logged.

For the same authenticated user, source type, and parser/rule version:

- if an unexpired open preview exists for the same digest, reuse/return that batch rather than creating a second independent preview; and
- if that statement was already confirmed, report it as already imported and do not create duplicate expenses by default.

An open preview produced by an incompatible parser/rule version must not be
resumed, mutated, or reused as current financial interpretation. A successful
re-upload may atomically supersede that exact owned/source/digest predecessor
with a current-version preview. The predecessor must remain unchanged if fresh
extraction or parsing fails, and no cross-user preview may participate in the
replacement decision.

## Row-level duplicate policy

Duplicate handling has two levels.

### Exact imported provenance duplicate

A row already confirmed from the same source batch/provenance is blocked automatically.

### Possible duplicate

A normalized row that resembles an existing expense or another relevant row by fields such as date, amount, and normalized/user-facing description is a **warning**, not an automatic rejection.

Legitimate repeated outflows can have the same date, amount, and description. Therefore:

- date + amount alone is never an automatic duplicate key;
- possible duplicates are not silently dropped; and
- the user must explicitly choose whether to import a warned row.

Exact schema and fingerprint design remain implementation details, provided they preserve these semantics.

## Confirmation and idempotency

Confirmation references an authenticated user's server-generated batch ID.

At confirmation time, the backend must:

1. verify authenticated ownership of the batch;
2. reject expired or invalid batch state;
3. revalidate every selected row against authoritative financial rules;
4. re-run the required duplicate/idempotency checks against current persisted state; and
5. persist only the selected valid expense rows.

A batch may be successfully confirmed only once. Retrying a confirmation request after success must return a stable already-confirmed/success result without creating additional expenses.

Client-supplied row state cannot bypass backend classification, validation, ownership, duplicate, or idempotency rules.

## Atomic persistence

Confirmation of the selected expense rows is atomic.

If any selected row fails authoritative validation, ownership, exact-duplicate/idempotency checks, or persistence, persist **none** of the selected rows and return safe per-row errors so the user can correct or unselect problematic rows and retry.

Rows that remain excluded as `needs_review`, `non_expense`, or `invalid` are not part of the persistence transaction and do not make confirmation fail merely because they remain excluded.

This prevents half-imported statements and makes retries predictable.

## Provenance after confirmation

Retain only the minimum durable metadata needed for idempotency and auditability, such as:

- import batch ID;
- authenticated user ownership;
- source type (`sunflower_pdf`);
- parser/rule version;
- document digest;
- source section plus stable row ordinal/fingerprint;
- link to the created Expense ID; and
- confirmed timestamp/status.

Do not retain the raw PDF.

Do not retain the entire raw bank description after confirmation solely for provenance when a stable non-reversible fingerprint and the resulting expense description are sufficient.

Exact schema/table design is deferred to implementation work and may require a separately approved migration.

## Preview retention

Unconfirmed normalized preview batches are temporary.

The V1 expiry is **24 hours from parse**. Within that period, an authenticated user may leave and return to the unfinished review. After expiry, the preview is no longer confirmable and the user must re-upload the statement.

The 24-hour retention applies only to normalized preview state needed for the unfinished review. The raw PDF itself is not retained for 24 hours; it is discarded as required by the F1 threat model.

Implementation should use the simplest enforceable cleanup/expiry mechanism compatible with the current architecture. Do not introduce a background-job framework solely for preview cleanup.

Confirmed minimal provenance may remain with the linked imported expenses unless a later approved deletion/export/privacy policy changes that decision.

## Date-only persistence prerequisite

The normalized import model uses the approved date-only semantics immediately:

- API target: `YYYY-MM-DD`;
- .NET target: `DateOnly`; and
- PostgreSQL target: `date`.

Upload, parsing, normalization, duplicate analysis, and preview may be implemented before imported persistence is enabled.

However, **no imported row may be confirmed into `Expense` until the applicable A5 date-only boundary is implemented and verified**. Imported dates must not be coerced into the current `DateTime`/UTC representation merely to ship sooner.

## Error model

Import errors and warnings should use stable codes plus safe user-facing messages rather than parser internals.

Expected categories include:

- unsupported row or section;
- invalid or missing date;
- invalid amount or precision;
- missing or oversized description;
- ambiguous source direction or row parsing / review required;
- exact imported duplicate;
- possible duplicate;
- invalid or reserved category;
- batch expired or already confirmed; and
- final authoritative validation failure.

Sensitive source descriptions, amounts, account details, and other statement content must not be logged merely because they are associated with an error.

## Verification requirements for implementation

Later implementation must use privacy-safe synthetic or irreversibly sanitized fixtures and cover at minimum:

- representative Sunflower deposit/credit rows excluded from Expense persistence;
- ordinary merchant debits eligible as expense candidates;
- card-payment and transfer debits eligible as expense candidates;
- outgoing person-to-person/payment-app debits eligible as expense candidates;
- investing/brokerage-funding debits eligible as expense candidates;
- rent-like and bill-payment debits eligible as expense candidates;
- bank-fee debits eligible as expense candidates;
- parser-ambiguous rows that remain `needs_review` until source direction/facts are resolved;
- debit/credit direction without negative expenses;
- default `uncategorized` category behavior;
- exact same-PDF re-upload idempotency;
- possible-duplicate warnings without false automatic suppression;
- repeated legitimate identical outflows;
- preview ownership and cross-user isolation;
- 24-hour expiration and already-confirmed behavior;
- confirmation retry idempotency;
- atomic rollback when one selected row fails;
- no persistence of excluded, unresolved, or invalid rows;
- final authoritative expense validation; and
- date-only month-edge behavior and PostgreSQL-backed persistence once A5 and any required import schema work are implemented.

No real customer statement or identifying financial information may be committed as a test fixture.

## Non-goals

This specification does not approve or implement:

- PDF parser-library selection;
- upload endpoint or frontend upload UI;
- database schema or EF Core migration;
- A5 date migration implementation;
- income or cash-flow tracking;
- automatic merchant/category rules;
- statement balance reconciliation;
- refund/reversal relationship modeling beyond current direction-based treatment;
- another bank or QFX/CSV support;
- raw PDF archival;
- background-job infrastructure; or
- production migrations, deployment operations, or automatic merge.

If later implementation cannot satisfy this specification together with the F1 threat model and financial-domain invariants, keep persistence disabled or support preview-only behavior until the blocker is resolved. Do not silently weaken these boundaries.
