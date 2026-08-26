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
