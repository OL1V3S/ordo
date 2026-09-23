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

V1 exposes only the coverage envelope:

```json
{
  "availability": { "state": "available", "reasonCode": null },
  "kindsEvaluated": [],
  "items": []
}
```

This makes no claim that every possible attention family was evaluated. No
attention inference is part of this slice.

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

Recent Activity and Coming Up each use a separate read-only repeatable-read
relational transaction. Queries are sequential on the scoped EF Core context,
and a failed section transaction is disposed before the next section begins.
Section-level coherence is required; one cross-section database snapshot is not.

Known recoverable provider, timeout, or projection-availability failures make
only that section unavailable. Cancellation and programming or contract defects
propagate. HTTP `200` is returned when either source-backed section succeeds;
when both fail, the endpoint returns privacy-safe `503` ProblemDetails with code
`home_unavailable`. Authentication failures are never converted to partial
responses.

All entity and relationship reads are scoped to the authenticated owner on
every joined side, use no tracking, perform no writes, and return no owner ID,
raw statement content, provenance, token, secret, localized prose, web URL, or
shared cached financial data.
