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

### 2026-10-03 — Spanish Paychecks page

[PR #177](https://github.com/OL1V3S/ordo/pull/177) ·
[Issue #176](https://github.com/OL1V3S/ordo/issues/176)

- Localized the Paychecks page (profiles, possible and dismissed paychecks,
  paused and ended groups, linked-deposit evidence, the paycheck form, the
  record-received panel, and their feedback, validation, and error messages) in
  English and Spanish through a new `paychecks` catalog namespace.
- Spanish keeps a paycheck expectation (`previsión`, `previsto`) distinct from
  money actually recorded (`pago recibido`, `entrada de dinero`). English wording,
  paycheck detection, projection, confirmation, dismissal, and receipt logic,
  payloads, focus behavior, and money and date display are unchanged; unknown
  backend codes still show a readable fallback.
- The Paychecks page no longer stays English on the Spanish app. Dates keep their
  English `Mon D, YYYY` form and amounts keep `$` formatting in both languages.

### 2026-10-03 — Spanish import preview

[PR #175](https://github.com/OL1V3S/ordo/pull/175) ·
[Issue #174](https://github.com/OL1V3S/ordo/issues/174)

- Localized the Activity statement import preview (panel, rows, upload and
  confirmation messages, and row issue, warning, and duplicate text) in English
  and Spanish through a new `importPreview` catalog namespace.
- Duplicate and review warnings keep their meaning in Spanish; unknown backend
  codes still show a readable fallback. English wording, duplicate-safety and
  confirmation logic, row selection, payloads, and focus behavior are unchanged.
- The import preview no longer stays English on the Spanish Activity page.
  User-entered and parsed statement data and browser-formatted timestamps are
  shown as before.

### 2026-10-03 — Spanish Activity spending and cash in

[PR #173](https://github.com/OL1V3S/ordo/pull/173) ·
[Issue #172](https://github.com/OL1V3S/ordo/issues/172)

- Localized the Activity page header, spending area (expense form, filters, list,
  row editing, delete confirmation), and cash-in area (form, list, delete
  confirmation) with their feedback and error messages in English and Spanish.
- English wording, validation, payloads, focus behavior, and money and date
  display are unchanged; only message text moved into the `activity` catalogs.
- The import preview panel stays English until a later slice, so the Spanish
  Activity page is still partly English.

### 2026-10-02 — Unified Activity timeline

[PR #171](https://github.com/OL1V3S/ordo/pull/171) ·
[Issue #170](https://github.com/OL1V3S/ordo/issues/170)

- Added a read-only, newest-first Activity timeline of recorded expenses and cash
  in, with exact signed amounts and "Show older activity" keyset paging, above the
  existing per-type lists on Activity.
- Home recent activity and the timeline now share one backend feed reader so the
  ordering rule exists once; Home's output is unchanged.
- Localized the timeline and the Activity section links in English and Spanish;
  the rest of the Activity page stays English until umbrella item 10.
### 2026-10-01 — Claude Code command-center workflow

[PR #169](https://github.com/OL1V3S/ordo/pull/169) ·
[Issue #168](https://github.com/OL1V3S/ordo/issues/168)

- Recast command-center, implementation-agent, and independent-reviewer
  governance in provider-neutral roles while retaining existing Ordo gates.
- Added a single Claude `/next` cockpit with fresh role-separated workers,
  task-specific model routing, and a read-only review fallback.

### 2026-09-29 — Home budget attention

[PR #167](https://github.com/OL1V3S/ordo/pull/167) ·
[Issue #166](https://github.com/OL1V3S/ordo/issues/166)

- Added selective Home alerts for recorded category spending at or above an
  explicit monthly budget, with exact-cents classification and deterministic
  ranking.
- Kept budget and commitment attention independently available, read-only, and
  bilingual, within Home's existing two-row limit.

### 2026-09-28 — Home commitment-change reviews

[PR #160](https://github.com/OL1V3S/ordo/pull/160) ·
[Issue #159](https://github.com/OL1V3S/ordo/issues/159)

- Added the first Home Needs Attention family for authoritative pending
  commitment-change reviews, grouped by commitment and linked to the existing
  Commitments decision workflow.
- Kept Home attention independently available, privacy-minimal, bilingual, and
  read-only, with a compact two-group presentation and explicit review focus.

### 2026-09-25 — Coming Up paycheck expectations

[PR #158](https://github.com/OL1V3S/ordo/pull/158) ·
[Issue #157](https://github.com/OL1V3S/ordo/issues/157)

- Added a quiet Home Coming Up section for up to two backend-ranked paycheck
  expectations with exact fixed or range amounts and localized expected dates.
- Kept projections distinct from recorded activity and made malformed or
  unavailable Upcoming data fail closed without hiding valid Recent Activity.
- Added English and Spanish copy, accessible responsive presentation, and
  focused tests without adding Home network requests or changing the API.

### 2026-09-23 — Capture-first Home and mixed Recent Activity

[PR #156](https://github.com/OL1V3S/ordo/pull/156) ·
[Issue #155](https://github.com/OL1V3S/ordo/issues/155)

- Reframed Home around quick Expense and Cash In capture, followed by the
  backend-ordered mixed recent-activity feed and a quieter Insights link.
- Reused shared capture flows and added account-scoped uncertain-write recovery
  that requires a successful full-list Activity review and explicit acknowledgment.
- Added English and Spanish Home copy with exact money/date display, and removed
  the dashboard reads for cash flow, paychecks, budgets, and commitments from Home.

### 2026-09-23 — Home semantic read-model foundation

[PR #154](https://github.com/OL1V3S/ordo/pull/154) ·
[Issue #153](https://github.com/OL1V3S/ordo/issues/153)

- Added an authenticated Home contract with an explicit local activity cutoff
  and UTC paycheck-evaluation horizon.
- Composed bounded exact recent activity and paycheck-only upcoming items while
  keeping linked inflows single and owner-scoped.
- Added explicit partial-availability metadata and empty attention coverage on
  independent read-only snapshots without changing financial semantics.

### 2026-09-22 — Exact Expense precision across browser boundaries

[PR #152](https://github.com/OL1V3S/ordo/pull/152) ·
[Issue #151](https://github.com/OL1V3S/ordo/issues/151)

- Encoded Expense request and response amounts as canonical decimal strings,
  while retaining compatible legacy numeric requests and the existing full monetary range.
- Kept Expense entry, editing, aggregation, ordering, display, and selected
  Expense-derived commitment evidence exact with integer minor-unit arithmetic.
- Made ambiguous legacy Expense and BudgetLimit numbers fail closed instead of
  driving approximate edits, commitment decisions, budget classifications, or attention.

### 2026-09-21 — Reusable financial capture orchestration

[PR #150](https://github.com/OL1V3S/ordo/pull/150) ·
[Issue #149](https://github.com/OL1V3S/ordo/issues/149)

- Extracted dependency-injected Expense and Cash In capture controllers while
  preserving Activity payloads, validation, task locking, focus, and recovery behavior.
- Kept full-list ownership outside capture so future surfaces can reuse trusted
  writes with bounded authoritative reads instead of loading complete history.

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
