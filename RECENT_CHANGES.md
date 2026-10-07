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

### 2026-10-07 — Account-access pages in English and Spanish

[Issue #190](https://github.com/OL1V3S/ordo/issues/190)

- Sign-in, registration, email confirmation, and password recovery pages now follow
  the selected language, and a language selector is available before sign-in.
- Backend messages are mapped to localized text by stable code or HTTP status; unknown
  failures show a fixed localized message instead of raw server text.

### 2026-10-06 — Activity timeline search and filters; newest-first Expenses

[PR #189](https://github.com/OL1V3S/ordo/pull/189) ·
[Issue #188](https://github.com/OL1V3S/ordo/issues/188)

- The Activity timeline can be searched (description and expense category) and
  filtered by type and date range on the server, so every page of history stays
  reachable through "Show older activity".
- `GET /api/expenses` now guarantees newest-first order (date, then id, descending),
  so the Expenses table lists the latest records first.

### 2026-10-05 — Review follow-ups for the V2 localization work

[PR #185](https://github.com/OL1V3S/ordo/pull/185) ·
[Issue #184](https://github.com/OL1V3S/ordo/issues/184)

- Fixed the Spanish Commitments "keep current" accessible names, made the Activity
  timeline's out-of-date notice a persistent live region, and made the import
  preview row total count-aware ("1 fila" in Spanish; English wording unchanged).
- Clarified a few Spanish phrases ("Por encima del límite", "tus categorías"), removed
  a fragile `{{context}}` placeholder name, and added tests for previously untested
  messages and the READ ONLY timeline transaction.
- Corrected stale statements in the architecture and product overviews and in the
  localization, Home read-model, and Activity timeline documentation.

### 2026-10-05 — Spanish Commitments page

[PR #183](https://github.com/OL1V3S/ordo/pull/183) ·
[Issue #182](https://github.com/OL1V3S/ordo/issues/182)

- Localized the Commitments page (the page, commitment form, change review with its
  pending and reviewed decisions, supporting-expense evidence, and the error and
  notice messages the hook maps from stable backend codes) in English and Spanish
  through a new `commitments` catalog namespace. Count-dependent text is now complete
  count-aware messages per cadence and change dimension instead of concatenated
  English fragments; English wording is unchanged.
- Spanish keeps an expected commitment distinct from expenses actually recorded and
  names what each accept, keep, dismiss, and mark-ended decision does. Commitment
  detection, change-review and decision logic, payloads, element ids, and focus
  behavior are unchanged; `$` amounts and the browser-language date display keep
  their existing form in both languages.

### 2026-10-05 — Spanish Analytics page

[PR #181](https://github.com/OL1V3S/ordo/pull/181) ·
[Issue #180](https://github.com/OL1V3S/ordo/issues/180)

- Localized the Analytics (Insights) page (the cash-flow summary and its
  disclosure, category ranking, trend chart with its tooltips, ticks, and
  accessible table, spending, budget-status, comparison, and largest-expense
  sections, and the cash-flow load messages) in English and Spanish through a new
  `analytics` catalog namespace. Month names and the month and date labels built
  from them follow the language, using catalog month names applied to the
  existing year-month and date components; English labels are unchanged.
- Spanish keeps recorded cash in and spending distinct from expectations and an
  unavailable exact figure distinct from a recorded zero. Cash-flow and spending
  calculation, comparisons, which month or date each label refers to, payloads,
  and focus behavior are unchanged; `$` amounts, percentages, and numeric
  expense dates keep their existing form in both languages.

### 2026-10-04 — Spanish Budgets page

[PR #179](https://github.com/OL1V3S/ordo/pull/179) ·
[Issue #178](https://github.com/OL1V3S/ordo/issues/178)

- Localized the Budgets page (headings, month and category form, validation,
  feedback, loading, error, and empty states, budget status labels, progress
  text, accessible names, and the delete confirmation) in English and Spanish
  through a new `budgets` catalog namespace.
- Spanish keeps a budget limit (`límite`, `monto límite`) distinct from recorded
  spending (`gasto`, `gastos registrados`, `usado`). English wording,
  budget-limit validation and calculation, payloads, focus behavior, and money
  and month display are unchanged.

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
