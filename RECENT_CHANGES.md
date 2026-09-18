# Recent Changes

This is Ordo's rolling, human-readable record of recent meaningful product and
engineering changes. For what Ordo does today, see
[PRODUCT_OVERVIEW.md](PRODUCT_OVERVIEW.md). GitHub pull requests and issues remain
the permanent, complete archive.

## Maintenance

- Record meaningful merged PRs or completed changes, not individual commits,
  pushes, or every bounded correction within a larger feature. Update this file
  in the implementation PR when appropriate.
- Each entry includes the merge/completion date, a linked PR number (and issue
  number where useful), a short human title, and 1–3 concise bullets describing
  what materially changed.
- Keep entries **newest first**, with **at most 20 entries**. When adding entry
  21, remove the oldest entry. This cap keeps the file readable; GitHub retains
  the full history.
- Skip trivial typo-only or formatting-only changes and mechanical maintenance
  with no meaningful product or engineering effect.
- Do not backfill older history. The completed **Ordo UX V3 work governed by
  [#127](https://github.com/OL1V3S/ordo/issues/127)** is the starting point for
  this history.

## History

### 2026-09-18 — English and Spanish localization foundation

[PR #148](https://github.com/OL1V3S/ordo/pull/148) ·
[Issue #147](https://github.com/OL1V3S/ordo/issues/147)

- Added a persisted English/Spanish browser preference with bundled catalogs,
  English fallback, and active-language document metadata.
- Localized the responsive shell, navigation hubs, Settings, and theme controls
  while preserving routes, user content, financial semantics, and feature behavior.
- Established catalog parity tests, accessible in-place switching, a reviewed
  glossary, and precision-safe boundaries for future feature localization.

### 2026-09-17 — Record paycheck received

[PR #145](https://github.com/OL1V3S/ordo/pull/145) ·
[Issue #143](https://github.com/OL1V3S/ordo/issues/143)

- Added an active-paycheck workflow to create and link actual cash in or select
  an existing unclaimed cash-in record for the current or previous schedule slot.
- Preserved observed amount/date differences without rewriting expectations,
  advanced projections from recorded slots, and added non-destructive unlinking.
- Enforced owner, inflow, slot, retry, and concurrency invariants with exact
  historical cash-flow reclassification and focused frontend/backend coverage.

### 2026-09-08 — Recorded cash-in management

[PR #142](https://github.com/OL1V3S/ordo/pull/142) ·
[Issue #141](https://github.com/OL1V3S/ordo/issues/141)

- Added a separate Cash in section in Activity with manual entry, search, edit,
  and delete for all recorded inflows, including imported or paycheck-linked records.
- Preserved exact amount drafts and posted dates, with explicit edit/delete
  warnings and recovery for uncertain writes or unavailable refreshed lists.
- Coordinated cash-in, expense, and import tasks; confirmed imports refresh each
  affected record list while retaining known success if a read fails.

### 2026-09-07 — Ordo UX V3

[Issue #127](https://github.com/OL1V3S/ordo/issues/127) ·
[PR #132](https://github.com/OL1V3S/ordo/pull/132),
[PR #133](https://github.com/OL1V3S/ordo/pull/133),
[PR #134](https://github.com/OL1V3S/ordo/pull/134),
[PR #135](https://github.com/OL1V3S/ordo/pull/135),
[PR #136](https://github.com/OL1V3S/ordo/pull/136),
[PR #137](https://github.com/OL1V3S/ordo/pull/137),
[PR #138](https://github.com/OL1V3S/ordo/pull/138)

- Simplified Home, Activity/import, Budgets, Commitments, Paychecks, and Insights
  around recorded figures, saved expectations, and explicit review tasks.
- Added a consistent responsive shell, task-focused account-access pages,
  expandable details/history, and quieter Plan, More, and Settings pages.
- Improved focus, accessible control names, draft preservation, and distinct
  loading/error states while preserving existing financial and account behavior.
