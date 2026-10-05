# Activity Timeline

## Purpose

`GET /api/activity/timeline` is Ordo's authenticated, read-only unified Activity
read. It returns the caller's recorded Expenses and AccountInflows as one
newest-first, paged list so the Activity page can show money out and money in
together. It creates no money, defines no total, net, balance, or Safe-to-Spend
figure, and changes no financial classification. Expense and AccountInflow
persistence, write contracts, and semantics remain separate and unchanged.

## Shared ordering rule

`BudgetPlanner.ActivityTimeline.ActivityFeedReader` is the single owner of the
ordering rule that Home recent activity also uses:

1. stored date descending;
2. `expense` before `account_inflow` as a deterministic same-day tie-break;
3. record ID descending.

The reader also owns the per-source queries, the owner-scoped paycheck-membership
join, two-decimal amount formatting, and one read-only repeatable-read
transaction per request. Home's `HomeActivityReader` is a thin adapter over it
(limit three, Home's local `activityThroughDate` cutoff, Home query tags); Home's
response is unchanged. The shared reader fetches one extra row per source beyond
the requested limit to decide whether more rows exist; those extra rows are never
returned to Home.

## Request

- `limit`: integer 1 to 100, default 25. Parsed by hand as an unsigned decimal
  integer; anything else is `400` `activity_timeline_limit_invalid`.
- `cursor`: opaque position returned by a previous response. A malformed,
  non-canonical, or unsupported-version cursor is `400`
  `activity_timeline_cursor_invalid`.
- The owner comes only from the authenticated principal. There is no owner
  parameter or field. An anonymous request is `401`.

There is no date cutoff: every recorded row appears, including future-dated rows,
which sort first, matching the per-type Activity lists.

## Response

```json
{
  "currencyCode": "USD",
  "items": [{
    "kind": "account_inflow",
    "recordId": 12,
    "date": "2026-09-22",
    "amount": "2500.00",
    "description": "Payroll",
    "category": null,
    "paycheck": { "profileId": "00000000-0000-0000-0000-000000000001", "relation": "recorded_receipt" }
  }],
  "page": { "limit": 25, "hasMore": true, "nextCursor": "opaque" }
}
```

Items reuse Home's activity item contract. A paycheck-linked inflow appears once
as `account_inflow` with relationship metadata and never adds a second cash row.
Descriptions and categories are saved user content and are not translated.
`hasMore` is exact and `nextCursor` is null when it is false. The response carries
no totals, net, balance, owner identifier, provenance, or statement content.

### Amounts

`amount` is an invariant fixed-two-decimal string. The server returns stored
amounts exactly, including a legacy zero or negative Expense amount such as
`"0.00"` or `"-5.00"`, because the Expense table has no amount constraint and
those values were previously accepted. It never repairs, hides, or filters them.
Deciding how to present such a row is a client concern.

## Paging

Paging is keyset, not offset. A row `(date, rank, id)` follows cursor
`(D, K, I)` when `date < D`, or `date == D` and (`rank > K` or (`rank == K` and
`id < I`)), where an expense has rank 0 and an inflow rank 1. The cursor is the
base64url encoding of its version, date, rank, and ID. It is position-only: it
carries no owner or secret and cannot widen the owner-scoped read, so another
owner's cursor merely positions that owner's own rows.

No index is added: the Expense table has no date index and adding one would
require a migration. Cost is bounded by `limit <= 100`. An edit on another device
that moves a row's date across a held cursor can duplicate or drop that row
between pages; the browser never renders one record twice.

## Failure

A recoverable provider (`DbException`) or timeout failure returns privacy-safe
`503` ProblemDetails with code `activity_timeline_unavailable`; only the failure
type is logged. Cancellation and programming defects propagate. The frontend treats
any failed read generically, with a fixed localized message and a retry, and never
displays backend ProblemDetails text.

## Frontend behavior

`frontend/src/features/activity/` owns the timeline API module, a session-scoped
hook (request-id, abort, and session staleness guards; first page, load older,
refresh resets to the first page), a timeline-specific response validator, and
the presentation component. The Activity page renders it above Spending activity
with a Timeline section link; the per-type lists, forms, gates, and write
payloads are unchanged, so every record also appears in its per-type list.

- Rows are a list, not a table. Each shows a text label (Expense or Cash in),
  description, date, expense category, a paycheck-linked note, and an amount with
  an explicit sign. Direction never relies on color alone.
- The validator is strict on structure and fails closed for the whole response.
  It accepts any stored `-?\d+\.\d{2}` amount; a zero, negative, or otherwise
  non-canonical amount renders only that row as "Amount needs review" with the
  stored value unaltered, and never blanks the page.
- The timeline is read-only and independent: its failures never affect the
  per-type lists and vice versa. States are loading, ready, empty, initial failure
  with retry, failed refresh with the last rows kept, failed older-page load with
  an inline retry, and a malformed response.
- While Home's uncertain-write marker is set, the timeline and its link are hidden
  and no request is issued; it loads after acknowledgment.
- A fire-and-forget refresh follows completed expense and cash-in writes, imports
  that saved records, and the manual per-type refresh buttons, through wrappers
  that return the original result. An in-page unknown write outcome also triggers
  a refresh and shows a notice that the timeline may be out of date.

## Localization

Timeline strings and the section-links navigation use the `activity` catalog;
direction labels reuse Home's keys. Timeline money and dates format with `en-US`
or `es-US`. The rest of the Activity page (page header and actions, spending
area, and cash-in area) and the statement import preview are also localized, and
the spending and cash-in lists keep their existing `$` amounts and `MM/DD/YYYY`
dates in both languages. See [`localization.md`](localization.md).

## Non-goals

Unified edit or delete, per-row actions, search and filter, day grouping,
replacing the per-type lists, totals, net, balance, reconciliation, Safe-to-Spend,
import redesign, and any change to an existing endpoint or to Home's UI. Any of
the financial figures would be a financial-semantics change requiring renewed
owner approval; see [`financial-domain-invariants.md`](financial-domain-invariants.md)
and [`home-read-model.md`](home-read-model.md).
