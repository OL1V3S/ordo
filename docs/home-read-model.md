# Home Read Model

## Purpose

`GET /api/home?activityThroughDate=YYYY-MM-DD` is Ordo's authenticated,
read-only Home composition boundary. It returns compact existing facts for
future web, native, and widget clients without creating money, changing
financial classifications, or defining a balance.

The required `activityThroughDate` is the caller's local calendar cutoff for
stored `DateOnly` actual records. The response separately identifies the UTC
date used by the paycheck projector. Neither date is converted through a
timezone.

## Response sections

The response contains one captured UTC `generatedAt`, application-defined
`currencyCode` (`USD`), both evaluation dates, and three sections. Section
availability is either:

- `available` with `reasonCode: null` and an array that may be empty; or
- `unavailable` with `reasonCode: source_unavailable` and `items: null`.

An empty available array is not interchangeable with an unavailable read. V1
does not cache or return stale section data.

### Needs Attention

Needs Attention evaluates exactly one family, `commitment_change_review`, on
the UTC calendar date of the response's captured `generatedAt`. Its envelope
includes `evaluatedOn`, and a successful evaluation includes
`kindsEvaluated: ["commitment_change_review"]`, even when there are no items.
That empty available result means this family was evaluated and no pending
review exists; it does not claim that other attention families were checked.

Each item groups actionable pending dimensions for one commitment, in the
commitment-change detector's stable commitment-ID order. Dimensions retain the
existing amount, timing, missing order:

```json
{
  "availability": { "state": "available", "reasonCode": null },
  "kindsEvaluated": ["commitment_change_review"],
  "items": [{
    "kind": "commitment_change_review",
    "commitmentId": "00000000-0000-0000-0000-000000000001",
    "commitmentName": "Gym plan",
    "reviews": [{ "dimension": "amount", "state": "proposed_change" }]
  }],
  "evaluatedOn": "2026-09-23"
}
```

Only existing assessments with a non-null fingerprint and `decisionState` of
`pending` are included: `proposed_change` for amount/timing and
`not_seen_recently` or `possibly_ended` for missing. Kept, normal, isolated
outlier, possible-change, matching-unavailable, and other non-actionable
assessments are omitted. Home returns the complete set; its compact UI shows at
most two commitment groups and links to the full Commitments review when more
groups exist. The “See all” count is the number of pending dimension reviews,
not the number of grouped commitments.

The typed Home item intentionally omits proposed values, fingerprints, raw
evidence, observations, category, algorithm version, and owner identifiers.
The backend supplies structured language-neutral dimension/state codes, not
localized prose. Home only links to the existing Commitments review workflow;
it does not accept or dismiss decisions.

The Home attention reader reuses the commitment service's existing dated
evaluation/projection seam. The existing commitment-change endpoint keeps its
own UTC date capture and request transaction behavior. Home passes its captured
UTC date and owns a separate read-only repeatable-read relational transaction
for attention, like the other Home source readers. Detector semantics are
documented in `docs/commitment-intelligence.md`.

### Recent Activity

Recent Activity returns at most three actual persisted records on or before
`activityThroughDate`. It queries at most three Expenses and three
AccountInflows, then owns the final ordering:

1. stored date descending;
2. `expense` before `account_inflow` as a deterministic same-day tie-break;
3. record ID descending.

Expense and AccountInflow persistence remains separate. A paycheck-linked
inflow appears once as `account_inflow`, with an optional relationship carrying
the paycheck profile ID and `confirmation_evidence` or `recorded_receipt` code.
The relationship never adds a second cash row or changes the amount.

Amounts are invariant fixed-two-decimal strings. Dates are ISO calendar dates.
Descriptions and categories are current saved user content and are not
translated. Import origin is not exposed.

### Coming Up

Coming Up returns at most two active paycheck projections whose expected window
overlaps the inclusive UTC horizon from `upcomingEvaluatedOn` through the next
13 calendar days. Ordering is earliest expected date, latest expected date,
then paycheck profile ID. Overlapping windows remain separate expectations.

The existing `PaycheckProjector` receives the current profile schedule,
accepted amount/windows, and maximum currently linked slot anchor. Inactive
profiles and projections outside the horizon are excluded. Passing an expected
date never creates an AccountInflow or a missed-paycheck classification.

Fixed and range amounts use mutually exclusive fixed-two-decimal string fields.
Commitments are excluded because Ordo has no separately approved commitment
next-payment projection contract.

## Failure and consistency

Needs Attention, Recent Activity, and Coming Up each use a separate read-only
repeatable-read relational transaction. Queries are sequential on the scoped
EF Core context, and a failed section transaction is disposed before the next
section begins. Section-level coherence is required; one cross-section database
snapshot is not.

Known recoverable provider, timeout, or projection-availability failures make
only that section unavailable. Cancellation and programming or contract defects
propagate. HTTP `200` is returned when any of the three source-backed sections
succeeds; only when all three are unavailable does the endpoint return
privacy-safe `503` ProblemDetails with code `home_unavailable`. Authentication
failures are never converted to partial responses.

All entity and relationship reads are scoped to the authenticated owner on
every joined side, use no tracking, perform no writes, and return no owner ID,
raw statement content, provenance, token, secret, localized prose, web URL, or
shared cached financial data.
