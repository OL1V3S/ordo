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

### 2026-10-17 — Add expense and Add deposit in the iPhone app

[PR #259](https://github.com/OL1V3S/ordo/pull/259) · [Issue #258](https://github.com/OL1V3S/ordo/issues/258)

- The iPhone app can add an expense or a deposit from Home, in English and Spanish, using the existing create endpoints. Each save sends one `Idempotency-Key` and reuses it for every retry, so a lost response cannot record it twice; an unconfirmed save is kept on the device until it is retried or discarded, and Home is re-read from the server afterwards.
- Backend, API, schema, web app and required checks are unchanged; the app is still not distributed.

### 2026-10-17 — Native iOS app with sign-in and a read-only Home

[PR #257](https://github.com/OL1V3S/ordo/pull/257) · [Issue #256](https://github.com/OL1V3S/ordo/issues/256)

- New SwiftUI iPhone app in `ios/` (iOS 18+): signs in with the device-session API, keeps the session in the Keychain, and shows a read-only Home (attention, recent transactions, upcoming paychecks) in English and Spanish.
- Adds a non-required macOS workflow, "iOS build and tests". Backend, API, schema, web app and existing workflows are unchanged; the app is not distributed.

### 2026-10-17 — Duplicate-safe expense and cash-in creation

[PR #255](https://github.com/OL1V3S/ordo/pull/255) · [Issue #253](https://github.com/OL1V3S/ordo/issues/253)

- `POST /api/expenses` and `POST /api/inflows` accept an optional `Idempotency-Key` header (one UUID). A retry with the same key and details returns `200` with the same record instead of creating a duplicate; the same key with different details returns `422`, and a key whose record was deleted returns `409` without recreating it. Keys are per user and shared by both endpoints.
- Requests without the header, the web app, the frontend and existing responses are unchanged. Adds the `CreateRequestReceipts` table (migration `AddCreateRequestReceipts`), which must be applied to production before this backend is deployed.

### 2026-10-16 — Revocable device sessions for native clients

[PR #254](https://github.com/OL1V3S/ordo/pull/254) · [Issue #252](https://github.com/OL1V3S/ordo/issues/252)

- The backend can now sign in a native client with a long-lived, revocable device session: `POST /api/auth/device-sessions` (email and password), `/refresh` (rotates the credential and returns a new 2-hour access token) and `/sign-out`. A session expires after 60 days without use or 180 days in total, a reused credential ends the whole session, and a completed password reset ends every session of that account.
- Web login, the access-token lifetime, the frontend and existing endpoint responses are unchanged (a completed password reset now also ends device sessions). Adds the `DeviceSessions` table (migration `AddDeviceSessions`), which must be applied to production before this backend is deployed.

### 2026-10-16 — Deposit rows read from whitespace-free statements

[PR #251](https://github.com/OL1V3S/ordo/pull/251) · [Issue #250](https://github.com/OL1V3S/ordo/issues/250)

- Statement deposits that the PDF text layer runs together without spaces are now read as individual rows in import review. Before, they collapsed into one unreadable line and the deposits were missing. Deposits stay unselected by default and nothing is saved automatically.
- When a deposits line cannot be read with confidence, the review shows one unreadable line per dated entry instead of any amount, and a header-only page that continues a Deposits section is shown as unreadable lines instead of being skipped.
- The Sunflower parser rule version is now `sunflower-v4`, so a statement previewed or confirmed under `v3` can be previewed again; row-level duplicate flags remain the protection against saving it twice. Backend only: no schema, API shape, frontend, or dependency change.

### 2026-10-15 — Unreadable statement lines collapsed in import review

[PR #249](https://github.com/OL1V3S/ordo/pull/249) · [Issue #247](https://github.com/OL1V3S/ordo/issues/247)

- Lines with no date, amount, or description (such as column headers) no longer clutter the statement review table. They appear in a collapsed "N lines couldn't be read" note that says they might include transactions and to check the statement; they stay unselectable and are never saved. English and Spanish.
- The statement summary and the to-review filter still count them. Frontend and docs only: the parser, API, schema, and dependencies are unchanged.

### 2026-10-15 — Paycheck matches in statement import review

[PR #248](https://github.com/OL1V3S/ordo/pull/248) · [Issue #247](https://github.com/OL1V3S/ordo/issues/247)

- Deposit rows in the statement review now show "May match {name}" when they fit an open slot of an active pay schedule (same `paycheck-match-v1` rules as the Paychecks page; ambiguous or possible-duplicate rows get none). English and Spanish.
- "Link to {name} when saved" is off by default; ticking it also selects the deposit. After saving, the deposit is linked through the existing receipt write. Saving and linking are two requests, so a failed link leaves the deposit saved and unlinked, and the results list says which were linked. Frontend only: no schema, API, parser, or dependency change.

### 2026-10-14 — Account emails follow the selected language

[PR #246](https://github.com/OL1V3S/ordo/pull/246) ·
[Issue #245](https://github.com/OL1V3S/ordo/issues/245)

- The confirmation and password-reset emails are now sent in English or Spanish, following the language selected in the app when you register, resend a confirmation, or request a reset. The wording says "Ordo" in both languages.
- A missing or unrecognized language falls back to English, and the English emails are unchanged. The account does not store a language, and responses and limits are unchanged. Adds an optional `language` field to those three requests; no schema or dependency change.

### 2026-10-14 — Paycheck matching suggestions on the Paychecks page

[PR #244](https://github.com/OL1V3S/ordo/pull/244) · [Issue #243](https://github.com/OL1V3S/ordo/issues/243)

- The Paychecks page now lists deposits that may match an open slot of an active pay schedule, when the date is inside the expected window and the amount equals the fixed amount or falls in the range. Nothing is linked until you choose "Link to ..."; ambiguous matches are not shown.
- "Dismiss match" hides a suggestion on this device only (stored in the browser, not synced); "Dismissed matches" lets you show it again. Frontend only: no schema, API, or automatic linking change.

### 2026-10-14 — Select all and Clear selection send one request in statement import review

[PR #242](https://github.com/OL1V3S/ordo/pull/242) ·
[Issue #239](https://github.com/OL1V3S/ordo/issues/239)

- Select all and Clear selection in the statement import review now send one request for the whole action instead of one per row. Before this change each took about 29 seconds on a 34-row statement (the owner's measurement); the new speed has not been measured yet. The change is all-or-nothing: there is no longer a "Stopped after X of Y rows" state, and progress shows a count instead of "row n of N".
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
