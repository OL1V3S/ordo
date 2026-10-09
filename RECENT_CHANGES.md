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

### 2026-10-09 — Budgets declutter

[PR #211](https://github.com/OL1V3S/ordo/pull/211) ·
[Issue #210](https://github.com/OL1V3S/ordo/issues/210)

- Budgets now has a month picker (previous, next, a month list and This month), flat category rows with a "..." Edit/Delete menu, and one status area that also holds Refresh limits and Retry spending.
- Month values, write payloads, recovery gating, ordering, zero-limit and status behavior are unchanged.

### 2026-10-09 — Home declutter

[PR #209](https://github.com/OL1V3S/ordo/pull/209) ·
[Issue #208](https://github.com/OL1V3S/ordo/issues/208)

- Home drops its intro line and "Capture" heading, uses the shared section headers and rows, and shows each Coming Up item as a compact two-line row.
- On phones a single "Add" button reveals Add expense and Add cash in; wider screens still show both buttons. Data, ordering, capture and recovery behavior are unchanged.

### 2026-10-09 — Activity single task area and row menu

[PR #207](https://github.com/OL1V3S/ordo/pull/207) ·
[Issue #194](https://github.com/OL1V3S/ordo/issues/194)

- Activity is now one list plus one "Current task" area and a status area; the Spending and Cash in sections, Records toggles, expense filters and cash search are gone, and Edit/Delete moved into a "..." menu on each timeline row.
- Full read-only expense and cash-in tables appear only for Home recovery, unconfirmed saves and a failed timeline; write payloads, recovery and import are unchanged.

### 2026-10-09 — Plan hub

[PR #206](https://github.com/OL1V3S/ordo/pull/206) ·
[Issue #205](https://github.com/OL1V3S/ordo/issues/205)

- Plan now opens on Budgets, and a Budgets / Commitments / Paychecks switcher at the top of each planning page moves between them; each page keeps its own address.
- Replaced the Plan link list and the compact back-to-Plan link; `/plan` now performs the Budgets page's existing reads.

### 2026-10-09 — Navigation shell

[PR #204](https://github.com/OL1V3S/ordo/pull/204) ·
[Issue #203](https://github.com/OL1V3S/ordo/issues/203)

- One Primary navigation with Home, Activity, Plan (Budgets, Commitments, Paychecks) and Insights: bottom bar on phones, labelled rail on tablets, sidebar on desktop. Settings, Investing, theme, language and sign out moved into a new Account menu; `/more` still works by URL but is no longer linked.
- Fixed page-bar and bottom-bar scroll padding so focused controls stay visible.

### 2026-10-09 — Shared UI component kit

[PR #202](https://github.com/OL1V3S/ordo/pull/202) ·
[Issue #201](https://github.com/OL1V3S/ordo/issues/201)

- Added presentational components in `frontend/src/shared/ui` (Disclosure,
  FilterBar, StatusStrip, SectionHeader, ListRow, EmptyState, TaskArea) with unit
  tests, token-only `ui-kit.css`, and `docs/ui-kit.md`.
- Moved the Activity timeline and Records toggles onto the kit with no behavior,
  copy, request, or accessible-name change.

### 2026-10-09 — Design token foundation

[PR #200](https://github.com/OL1V3S/ordo/pull/200) ·
[Issue #199](https://github.com/OL1V3S/ordo/issues/199)

- Colors, radii, type, weights and spacing now come from tiered design tokens; each theme color is written once and a CSS-only mode switch serves light, dark and system dark (see [docs/design-tokens.md](docs/design-tokens.md)).
- Visual: flat opaque cards, no button hover lift or body gradient, no page bar/bottom nav shadows, 6/8/12px radii, smaller headings, 700 max font weight (except statement import), system font. A lint test blocks new raw literals.

### 2026-10-08 — Visual hygiene fixes (warning style, dark divider, tokens)

[PR #198](https://github.com/OL1V3S/ordo/pull/198) ·
[Issue #197](https://github.com/OL1V3S/ordo/issues/197)

- Warning status messages now have a distinct amber style in light and dark themes instead of rendering as a neutral box.
- The Home recent-list divider follows the dark theme; CSS-only, with tabular numerals for amounts and existing tokens replacing raw spacing and pill radii.

### 2026-10-08 — Activity page declutter (part 1)

[PR #196](https://github.com/OL1V3S/ordo/pull/196) ·
[Issue #194](https://github.com/OL1V3S/ordo/issues/194)

- Activity timeline filters moved behind a Filters disclosure with period chips and removable filter chips; the section links were removed.
- Spending and Cash in lists are now collapsed Records disclosures that open automatically when a task, error, or recovery needs them; frontend only, no API change.

### 2026-10-07 — Edit and delete from the Activity timeline

[PR #193](https://github.com/OL1V3S/ordo/pull/193) ·
[Issue #192](https://github.com/OL1V3S/ordo/issues/192)

- Each Activity timeline row now has Edit and Delete buttons that open the existing
  Spending and Cash in edit and delete flows; no new write path, payload, or API.
- An expense that is already gone (404 on edit or delete) now says so, closes the open
  edit, and prompts a refresh; a cash-in 404 now also refreshes the timeline.

### 2026-10-07 — Account-access pages in English and Spanish

[PR #191](https://github.com/OL1V3S/ordo/pull/191) ·
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
