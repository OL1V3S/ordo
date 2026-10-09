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

### 2026-10-09 — Language-aware money, percent and date formatting

[PR #224](https://github.com/OL1V3S/ordo/pull/224) ·
[Issue #223](https://github.com/OL1V3S/ordo/issues/223)

- Money, percentages, dates and import timestamps now follow the app language through one shared formatter. Spanish shows USD amounts as `USD 1,234.56` (so they are not read as pesos) and dates in Mexican Spanish style such as `4 mar 2026`; English text is unchanged apart from a few listed corrections (Budgets reset date, grouped large percentages, import preview amounts, unparseable Commitments amounts).
- Amounts stay exact at any size and calendar dates do not shift with the machine's timezone; calculations, payloads and the backend are unchanged.

### 2026-10-09 — CSS cleanup and architecture

[PR #220](https://github.com/OL1V3S/ordo/pull/220) ·
[Issue #219](https://github.com/OL1V3S/ordo/issues/219)

- Removed dead CSS (pre-V2 Home, navigation hub, settings and import-card rules), redundant `box-shadow`/`transform: none` overrides, nine unused design tokens, an unused `saved.timingPattern` string and the unused `buildBudgetStatuses` helper; split `components.css` into page-owned `analytics.css`, `commitments.css` and `import-preview.css` and documented the CSS architecture in `docs/design-tokens.md`.
- The only visible change is spacing between Investing capability list items; no behaviour, markup, API or dependency changes.

### 2026-10-09 — Settings, auth pages and Investing redesign

[PR #218](https://github.com/OL1V3S/ordo/pull/218) ·
[Issue #217](https://github.com/OL1V3S/ordo/issues/217)

- Settings uses flat named sections; the public auth pages now render every status and error through the shared status message with unchanged roles, focus and text; Investing is fully localized (English and Spanish) with flat named regions.
- No change to sign-in, sessions, error mapping, or theme/language persistence.

### 2026-10-09 — Insights declutter

[PR #216](https://github.com/OL1V3S/ordo/pull/216) ·
[Issue #215](https://github.com/OL1V3S/ordo/issues/215)

- Insights now has a month picker (earlier/later steps move between months that have recorded data), one status area, flat cash-flow panels, and accessible More spending disclosures.
- Budget status is a single link to Budgets; Insights no longer reads budget limits. Cash-flow figures, charts and requests are unchanged.

### 2026-10-09 — Paychecks declutter

[PR #214](https://github.com/OL1V3S/ordo/pull/214) ·
[Issue #212](https://github.com/OL1V3S/ordo/issues/212)

- Paychecks now has one status area (including Loading), flat rows with one main action and a "..." actions menu, and collapsed Paused, Ended and Dismissed sections.
- Paycheck lifecycle, candidate and receipt behavior, payloads and ordering are unchanged; "Expected, not guaranteed." stays next to each projection.

### 2026-10-09 — Commitments declutter

[PR #213](https://github.com/OL1V3S/ordo/pull/213) ·
[Issue #212](https://github.com/OL1V3S/ordo/issues/212)

- Commitments now has one status area, flat rows with one main action and a "..." actions menu, inline change-review decisions, and collapsed Paused, Ended, Reviewed and Dismissed sections.
- Lifecycle, candidate and review behavior, payloads and ordering are unchanged. Shared rows and menus gained optional title-level, extra-content and item-list support.

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
