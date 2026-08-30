# Commitment Intelligence V1

## Purpose and authority

This document defines the approved V1 financial semantics for recurring
commitment intelligence. It supplements
[`financial-domain-invariants.md`](financial-domain-invariants.md); changes to
these semantics require the approval process in `AGENTS.md`.

V1 derives candidate commitments from a user's own expense history. A candidate
does not become durable financial state until the user confirms it. Dismissals
are durable and reversible user decisions.

## Candidate derivation

Candidate grouping uses the canonical expense category and this normalized
description:

1. trim leading and trailing whitespace;
2. collapse each internal whitespace run to one space; and
3. compare case-insensitively.

The detector evaluates at most the latest 36 calendar months, ordered by
calendar date and then Expense ID. V1 applies these exact cadence gates:

- monthly: at least 3 occurrences in 3 consecutive calendar months, exactly
  one occurrence per month, with normal days of month in a 7-day inclusive
  span; when every occurrence is in its month's last 4 days, use a month-end
  anchor and require the offsets from month end to fit within 3 days;
- weekly: at least 4 occurrences spanning at least 21 days, exactly one per
  calendar week, with every consecutive gap between 6 and 8 days; or
- yearly: at least 3 occurrences in 3 consecutive calendar years, all in the
  same calendar month, with observed days in a 7-day inclusive span or
  consistently month-end anchored.

Groups with more than one occurrence in a hypothesized cadence period are
ambiguous and withheld. Biweekly, quarterly, semimonthly, and arbitrary
intervals are not V1 cadences.

The detector must use an explicit algorithm version. Candidate evidence is an
ordered sequence of `(ExpenseId, CommitmentEvidenceRevision)` pairs. Its
fingerprint includes the algorithm version and cadence as well as that ordered
sequence. The server recomputes this fingerprint when confirming or dismissing
a candidate; a client-supplied fingerprint is never authoritative.

An expense receives a new `CommitmentEvidenceRevision` only when its date,
amount, normalized description, or canonical category materially changes.
Presentation-only description changes that preserve the normalized value do not
rotate the revision.

## Amount and timing semantics

When every evidence amount is exactly equal in cents, the candidate amount is
fixed. Otherwise it is variable and records the evidence median, minimum, and
maximum. V1 does not assign a confidence score.

Supported cadences are weekly, monthly, and yearly. Their timing shapes are:

- weekly: weekday;
- monthly: day of month or month end; and
- yearly: month and day.

Commitments also persist nonnegative before/after timing windows. Month-end
anchors resolve to the last valid calendar day, including leap-year behavior.
Fingerprint serialization must be defined by the versioned detector
implementation before candidate APIs are exposed.

## Durable state

A confirmed commitment is user-owned and has an `active`, `paused`, or `ended`
lifecycle. It records its cadence, timing, timing windows, fixed or variable
amount model, and the expense links used as confirmation evidence. A single
expense can be confirmation evidence for at most one commitment.

The durable origin records the detector algorithm version and evidence
fingerprint together. Repeating a confirmation with the same owner and origin
fingerprint must be idempotent. A dismissal records the owner, algorithm
version, cadence, and evidence fingerprint; the same tuple cannot be stored
twice. Removing that record reverses the dismissal.

Deleting an expense removes its occurrence link but does not delete the
commitment. Deleting a user deletes that user's commitments and dismissals.

## Explicit V1 boundaries

The first slice does not provide confidence scoring, late or missing
commitment detection, upcoming projections, or automatic transaction matching.
These are separate product decisions. Schema and backend foundations must not
be treated as authorization to expose an incomplete user workflow, run a
production migration, deploy, or perform production data operations.

## Commitment change detection V1

The approved first change-detection slice is a pure, explicitly versioned
`commitment-change-v1` detector. The authenticated read-only
`GET /api/commitment-changes` endpoint evaluates it on demand for the current
owner and returns explicit response DTOs; it does not expose a UI or persist
derived matches or proposals.

Only active, owner-scoped commitments participate. Observation identity comes
from at least two surviving confirmation-linked Expenses that all share one
normalized description and canonical category. Name and display-category edits
do not redefine that identity. If confirmation evidence is insufficient or
inconsistent, matching is unavailable. If multiple active commitments derive
the same identity, matching fails closed for the entire identity group; paused
and ended commitments neither participate nor create ambiguity.

An identity-matching Expense dated after the latest confirmation evidence and
not linked as confirmation evidence to any of the owner's commitments is
qualified to a cadence slot only inside a bounded plausibility envelope. Weekly
anchors use `max(the accepted window, 3 days)` on each corresponding side;
monthly and yearly anchors use `max(the accepted window, 6 days)`. These bounds
come from the existing weekday and seven-day candidate timing semantics. In
overlapping envelopes the uniquely nearest anchor wins; equal-distance ties,
or multiple qualified Expenses in one slot, are ambiguous. Ambiguous evidence
is never treated as missing. Day-of-month and yearly anchors clamp to the last
valid calendar day, including February 29 resolving to February 28 in a
non-leap year; month-end anchors use the actual last day.

For amounts, exact fixed equality or inclusion in the accepted range is normal.
One, two, or at least three consecutive outside observations mean isolated
outlier, possible change, or proposed change. A proposal uses at most the six
latest deviations and proposes a fixed amount when all are equal, otherwise
their observed minimum/maximum range with the lower median as evidence. A
normal, missing, or ambiguous closed slot breaks the run.

For timing, accepted before/after windows are inclusive. One, two, or at least
three consecutive outside observations on the same side mean isolated outlier,
possible change, or proposed change. An in-window observation, a closed gap,
ambiguity, or a direction reversal breaks the run. Proposed timing uses at most
the six latest deviations and the existing weekday, day/month-end, and yearly
calendar shapes. Amount and timing assessments are independent.

A slot is missed only after its accepted after-window closes. Weekly and
monthly commitments become `not_seen_recently` after two consecutive missed
slots and `possibly_ended` after three. Yearly commitments use one and two
missed slots respectively. No state changes automatically, and evaluation is
on demand from an injected current date; there is no scheduler.

Non-normal assessments use a SHA-256 fingerprint with an explicit domain and
algorithm version. It serializes exact semantic baseline fields (not broad
`UpdatedAt`, name, or display category), derived identity, ordered confirmation
and qualified Expense IDs with evidence revisions, relevant closed slots, and
the exact assessment result. A future action boundary must recompute this
authoritatively and reject stale decisions. A user-visible workflow remains
blocked until accept/end, durable keep/dismiss, reconsider, and stale-conflict
handling can ship coherently under separate approval.

Each read captures one UTC calendar date and returns it as `evaluatedOn`. Every
active-commitment result contains the exact commitment snapshot supplied to the
detector in that invocation: display name/category, lifecycle, cadence,
timing/window fields, and amount fields. Display name and editable category are
presentation-only and remain distinct from the evidence-derived normalized
description/category identity. Owner identity comes only from the authenticated
claim, and commitments, Expenses, confirmation evidence, and import provenance
are filtered to that owner before response mapping. Paused and ended
commitments are not returned. Matching-unavailable cases are successful data,
and a user with no active commitments receives a dated empty collection.

### Change-review persistence staging

The first change-review persistence slice adds only the additive
`CommitmentChangeDismissal` schema foundation. A row records the owner,
commitment, detector version, assessment dimension (`Amount`, `Timing`, or
`Missing`), exact 32-byte assessment fingerprint, and UTC dismissal time. The
database enforces owner and commitment cascade deletion, nonblank detector
version, allowed dimensions, exact fingerprint length, and uniqueness of one
decision per owner/commitment/version/dimension/fingerprint. A composite
commitment/owner foreign key also requires every dismissal owner to match the
referenced commitment owner; independent valid owner and commitment IDs are
not sufficient.

This schema slice does not query the new table from a runtime request path and
does not add change-review actions. The currently deployed read-only change
assessment behavior is therefore compatible both before and after the
additive migration. Before a later dismissal-aware backend is deployed, the
target database migration history must be verified at or beyond
`20260830053939_AddCommitmentChangeDismissals`. A frontend flag is not a
substitute for that backend/schema gate.

Production rollback is not automatic. Application rollback does not remove
the table, and removing an empty or inert table requires a separately reviewed
corrective migration. Once durable dismissal rows can exist, they must not be
deleted by deployment tooling or an unreviewed migration rollback.
