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

An empty available array is not interchangeable with an unavailable read. Home
does not cache or return stale section data.

### Needs Attention

Needs Attention evaluates two independent families. Commitment changes are
evaluated on the UTC calendar date of the response's captured `generatedAt`.
Budget attention uses Expenses in the month containing `activityThroughDate`,
through that caller-local date inclusive. The envelope keeps the existing
`evaluatedOn` value for commitment changes. `kindsEvaluated` lists only
families whose evaluation succeeded, in commitment-then-budget order.

`familyAvailability` always includes both family keys. Each family has an
availability state and its own nullable item array: an available empty array
means successfully evaluated and quiet; an unavailable family has
`source_unavailable` and a null item array. This represents all mixed outcomes
without allowing one failure to erase the other family's trustworthy items.
The enclosing attention section is available when either family is available,
and unavailable only when both fail. For example:

Commitment items group actionable pending dimensions for one commitment, in the
commitment-change detector's stable commitment-ID order. Dimensions retain the
existing amount, timing, missing order:

```json
{
  "availability": { "state": "available", "reasonCode": null },
  "kindsEvaluated": ["commitment_change_review", "budget_attention"],
  "familyAvailability": {
    "commitment_change_review": { "state": "available", "reasonCode": null },
    "budget_attention": { "state": "available", "reasonCode": null }
  },
  "items": [{
    "kind": "commitment_change_review",
    "commitmentId": "00000000-0000-0000-0000-000000000001",
    "commitmentName": "Gym plan",
    "reviews": [{ "dimension": "amount", "state": "proposed_change" }]
  }],
  "budgetItems": [{
    "kind": "budget_attention",
    "category": "food",
    "state": "over_limit",
    "spentAmount": "125.00",
    "limitAmount": "100.00"
  }],
  "evaluatedOn": "2026-09-23"
}
```

If only commitment evaluation succeeds, `items` is an array,
`budgetItems` is null, and only `commitment_change_review` appears in
`kindsEvaluated`. If only budget evaluation succeeds, the reverse applies. If
both fail, both item arrays are null, `kindsEvaluated` is empty, and attention
is unavailable. An available empty `budgetItems` array means no configured
budget condition deserves attention.

Only existing assessments with a non-null fingerprint and `decisionState` of
`pending` are included: `proposed_change` for amount/timing and
`not_seen_recently` or `possibly_ended` for missing. Kept, normal, isolated
outlier, possible-change, matching-unavailable, and other non-actionable
assessments are omitted. Home returns the complete commitment set. Its compact
UI combines budget and commitment items and shows at most two rows; the existing
Commitments link and “See all” review count remain available when commitment
groups need review.

The typed commitment Home item intentionally omits proposed values, fingerprints, raw
evidence, observations, category, algorithm version, and owner identifiers.
The backend supplies structured language-neutral dimension/state codes, not
localized prose. Commitment items link to the existing Commitments review
workflow; budget items link to `/budgets`. Home does not accept or dismiss
commitment decisions.

Budget states use exact persisted category strings and actual Expenses only.
Positive limits are quiet below the limit, `at_limit` at equality, and
`over_limit` above it. Zero limits are quiet at zero spending and emit
`zero_limit_spending` for positive spending; absent budgets are quiet. No V1
near-limit, pacing, forecast, balance, or Safe-to-Spend semantics are used.
Duplicate category/month budgets, negative budgets, zero or negative Expenses
in the evaluated period, a null/blank/whitespace-only category on an evaluated
budget or Expense row, invalid monetary precision/range, or exact-sum overflow
make only the budget family unavailable. These values are not silently omitted
or repaired; other nonblank category strings remain exact matches. Full
approved semantics are in
[`financial-domain-invariants.md`](financial-domain-invariants.md).

The backend returns at most two budget items: actionable
`over_limit`/`zero_limit_spending` items rank by exact excess/spending
descending, then category ordinally; `at_limit` follows in category order. The
Home UI uses the existing two-row cap and orders actionable budget items,
commitment items in their existing order, then `at_limit` items.

The commitment reader reuses the commitment service's existing dated
evaluation/projection seam. The existing commitment-change endpoint keeps its
own UTC date capture and request transaction behavior. Home evaluates each
attention family sequentially in its own read-only repeatable-read relational
transaction, so a recoverable failure in one family does not suppress the
other. Detector semantics are documented in
[`commitment-intelligence.md`](commitment-intelligence.md).

### Recent Activity

Recent Activity returns at most three actual persisted records on or before
`activityThroughDate`. The shared feed reader
([`activity-timeline.md`](activity-timeline.md)) queries at most four Expenses and
four AccountInflows, one more than the limit so it can tell whether further rows
exist, then owns the final ordering; Home returns only the first three:

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

Each attention family, Recent Activity, and Coming Up use separate read-only
repeatable-read relational transactions. Queries are sequential on the scoped
EF Core context, and a failed family or section transaction is disposed before
the next begins. Family/section-level coherence is required; one cross-family
or cross-section database snapshot is not.

Known recoverable provider, timeout, or projection-availability failures make
only that family or section unavailable. Cancellation and programming or
contract defects propagate. HTTP `200` is returned when either attention
family or another Home section succeeds; only when both attention families,
Recent Activity, and Coming Up are unavailable does the endpoint return
privacy-safe `503` ProblemDetails with code `home_unavailable`. Authentication
failures are never converted to partial responses.

All entity and relationship reads are scoped to the authenticated owner on
every joined side, use no tracking, perform no writes, and return no owner ID,
raw statement content, provenance, token, secret, localized prose, web URL, or
shared cached financial data.
