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

### 2026-10-14 — Faster Select all and Clear selection in statement import review

[PR #242](https://github.com/OL1V3S/ordo/pull/242) ·
[Issue #239](https://github.com/OL1V3S/ordo/issues/239)

- Select all and Clear selection in the statement import review now send one request instead of one per row, so they no longer take about 29 seconds on a 34-row statement. The change is all-or-nothing: there is no longer a "Stopped after X of Y rows" state, and progress shows a count instead of "row n of N".
- If the connection drops mid-action, the app retries the same request once; if it still can't confirm the result, importing stays locked and you're asked to refresh the page. Uses the endpoint added in [PR #241](https://github.com/OL1V3S/ordo/pull/241); confirm, duplicate checks and single-row edits are unchanged, and there is no schema change.

### 2026-10-13 — Category names and import dates in the user's language

[PR #240](https://github.com/OL1V3S/ordo/pull/240) ·
[Issue #237](https://github.com/OL1V3S/ordo/issues/237)

- The remaining places that showed stored category names in English in Spanish mode now read "Servicios", "Comida", "Transporte" and so on: the Budgets list, edit headings and delete confirmations, the Reports category list and comparisons, and Recurring expenses. Categories you typed yourself show exactly as before, and the app's own "uncategorized" now reads "Uncategorized" / "Sin categoría" everywhere.
- Statement import review rows show the statement date the same way as the saved list ("Oct 11, 2026" / "11 oct 2026") instead of the raw "2026-10-11". Display only; stored values, payloads and sorting are unchanged, and there is no API, schema or financial-semantics change.

### 2026-10-13 — Category names in the user's language, and a roomier import confirm bar

[PR #238](https://github.com/OL1V3S/ordo/pull/238) ·
[Issue #237](https://github.com/OL1V3S/ordo/issues/237)

- Found in a real-browser check: Home ("Needs your attention" budget items and recent transactions) and the Transactions list showed stored category names such as "bills" and "food" in both languages. They now read "Bills" / "Servicios", "Food" / "Comida" and so on; categories you typed yourself still show exactly as before.
- On tablet-portrait widths (about 600 to 760px) the statement import confirm bar is now stacked with a full-width button, as on phones, so a long Spanish button label no longer squeezes its summary into a narrow column or makes the bar so tall that it stops sticking. Frontend only; no API, schema or financial-semantics change.

### 2026-10-12 — Wording cleanup: leftovers from the wording series

[PR #236](https://github.com/OL1V3S/ordo/pull/236) ·
[Issue #235](https://github.com/OL1V3S/ordo/issues/235)

- Small follow-ups to the plain-language wording work: notices after an uncertain save in Transactions and Budgets now say the list was reloaded (Spanish "Se volvió a cargar…") instead of "actualizados"; the Reports month buttons are plainly "Earlier month" and "Later month"; Spanish "Verificado el" dates now read "Revisado el"; and the linked-deposit count on a pay schedule no longer repeats its label.
- The wording guard now also catches "no se guardó." at the end of a sentence. Docs only otherwise: product overview terms and the architecture notes on date-only dates and the import boundary. Frontend and docs only; no API, schema or financial-semantics change.

### 2026-10-12 — Plain-language wording: the rest of the app (final wording PR)

[PR #234](https://github.com/OL1V3S/ordo/pull/234) ·
[Issue #229](https://github.com/OL1V3S/ordo/issues/229)

- Fifth and last of the wording PRs: Home, navigation, Settings, sign-in and account pages, Investing, Budgets and Reports now use the same plain wording in English and Mexican Spanish. Examples: "Monthly limit" / "Límite mensual", "So far" / "A la fecha" on the chart, "Limits start over on {date}", "Try again" instead of "Retry", and a plainer Investing page that says Ordo isn't connected to any investment account.
- Review fixes from the earlier wording PRs are included: Paychecks notices after an uncertain save now say "Paychecks reloaded" instead of "updated", and empty states, error sentences and a few button names are clearer. The wording guard now covers every namespace. Frontend and docs only; no API, schema or financial-semantics change.

### 2026-10-12 — Plain-language wording: Paychecks

[PR #233](https://github.com/OL1V3S/ordo/pull/233) ·
[Issue #229](https://github.com/OL1V3S/ordo/issues/229)

- Fourth of five wording PRs: the Paychecks page now uses plain wording in English and Mexican Spanish. Saved schedules are "pay schedules" (Spanish "calendarios de nómina"), the date fields read "Starting pay date" and "First pay day", and the leftover words "candidate", "evidence", "anchor" and "(s)" are gone. The amount error now says "Enter an amount above zero with up to two decimals" on Paychecks and Transactions.
- Choosing the Quincenal (twice a month) option now shows a short hint: two pay days a month, at least 7 days apart. The wording guard now also covers this page. Frontend and docs only; no API, schema or financial-semantics change.

### 2026-10-12 — Plain-language wording: Recurring expenses

[PR #232](https://github.com/OL1V3S/ordo/pull/232) ·
[Issue #229](https://github.com/OL1V3S/ordo/issues/229)

- Third of five wording PRs: the Recurring expenses page now uses plain wording in English and Mexican Spanish. "Supporting expenses" became "Matching expenses", the change buttons read "Use the new details" and "Keep saved details", "Mark as ended" is confirmed with "Yes, mark as ended", and "proposal" and "candidate" are now "possible recurring expense" or "this change".
- Date ranges read "up to 2 days early or 1 day late" with correct singular and plural forms, ellipses are "…", and the wording guard now also bans internal words in this area and checks that the listed buttons' accessible names start with their visible text. Frontend and docs only; no API, schema or financial-semantics change.

### 2026-10-12 — Plain-language wording: Transactions and import

[PR #231](https://github.com/OL1V3S/ordo/pull/231) ·
[Issue #229](https://github.com/OL1V3S/ordo/issues/229)

- Second of five wording PRs: the Transactions page and the statement import now use plain, calm wording in English and Mexican Spanish. Errors reassure first and give one next step, the Transactions empty state says how to add, "(no. N)" and "MiB" are spelled out, and the import row problems read as full phrases.
- The import copy names what you do ("Import selected", "Select all expenses that can be imported", "Can't be imported") and keeps uncertain-save wording honest. The wording guard now also bans internal words in these two areas. Frontend only; no API, schema or financial-semantics change.

### 2026-10-12 — Plain-language wording: core terms

[PR #230](https://github.com/OL1V3S/ordo/pull/230) ·
[Issue #229](https://github.com/OL1V3S/ordo/issues/229)

- First of five wording PRs: English and Mexican Spanish now use one approved name per concept in every namespace. Examples: Transactions/Movimientos and Reports/Reportes for the pages, Deposit/Depósito for saved inflows (including transfers and refunds; not income), Recurring expense/Gasto recurrente, pay schedule/calendario de nómina, "Esperado" for expected money, and Quincenal for semimonthly pay.
- Fallback labels now read "Exact amount unavailable" / "Date unavailable" and are localized by the caller. Added the approved glossary and style guide to `docs/localization.md`, the new Reports label sentence in the financial-invariants doc, and a wording guard test. Frontend and docs only; no API, schema or financial-semantics change.

### 2026-10-12 — Statement import review and results polish

[PR #228](https://github.com/OL1V3S/ordo/pull/228) ·
[Issue #226](https://github.com/OL1V3S/ordo/issues/226)

- The statement import review now opens with a whole-statement summary, row filters (all, needs attention, possible duplicates, incoming deposits, selected), whole-batch "Select all eligible expenses" and "Clear selection" actions, and a sticky confirm bar showing exact, separate expense and incoming-deposit totals.
- After saving, the import shows the rows it saved with their exact totals and a "View in Activity" action; the Import statement entry point is more prominent and an empty Activity page offers a PDF import prompt. English and Spanish; frontend only, with no API, schema or financial-semantics change.

### 2026-10-12 — Language-aware money, percent and date formatting

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
