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

### 2026-10-20 — iPhone app tabs, sign-in "What is Ordo?", password rules

[Issue #285](https://github.com/OL1V3S/ordo/issues/285)

- The iPhone app now has five tabs: Home, Transactions, Plan (Budgets, Recurring expenses and Paychecks behind a switcher), Reports and Settings. Reports and Settings no longer open from Home.
- Sign-in is centred and has a "What is Ordo?" sheet. Create account lists the password rules one per line, and Forgot password no longer clips its heading.
- The web sign-in page has the same "What is Ordo?" dialog, and Create account shows the password rules as a bulleted list.
- English and Spanish; backend, API and schema are unchanged.

### 2026-10-20 — Account and Settings in the iPhone app

[Issue #282](https://github.com/OL1V3S/ordo/issues/282)

- The iPhone app can create an account and send confirmation or reset emails, like the web. Email links open the web pages in Safari; the app never handles a token.
- Settings (gear on Home) has Appearance, Language (English, Español) and Sign out. Only theme and language are stored on the device. Backend, API, schema and web app are unchanged.

### 2026-10-20 — Statement import in the iOS app

[Issue #281](https://github.com/OL1V3S/ordo/issues/281)

- The iOS Transactions tab can import a Sunflower statement PDF: upload, review, edit, select and confirm.
- The PDF is only held in memory; a confirm is retried only on tap and cannot create duplicates.

### 2026-10-20 — One Refresh button on Transactions

[Issue #279](https://github.com/OL1V3S/ordo/issues/279)

- The web Transactions page has one Refresh button that reloads both the expense and deposit lists, replacing "Refresh expenses" and "Refresh deposits". Recovery messages now say "Select Refresh". English and Spanish.
- Refresh is off while either list loads or a save is running. Each list's recovery checks and write blocks are unchanged. iPhone app, backend, API and schema are unchanged.

### 2026-10-20 — Reports in the iPhone app

[Issue #276](https://github.com/OL1V3S/ordo/issues/276)

- The iPhone app has Reports, opened from Home: the selected month's deposits, spending, confirmed paychecks vs other deposits and deposits minus spending, spending by category, and a six-month trend chart with an exact list, in English and Spanish. You can move between months that have records.
- Figures come from the server and are shown exactly; the phone does no money maths. Reports re-reads after saves, edits, deletes and paycheck changes. The web's "More spending detail" is not in the app yet. Backend, API, schema, web app and required checks are unchanged.

### 2026-10-20 — Recurring expenses in the iPhone app

[PR #275](https://github.com/OL1V3S/ordo/pull/275) · [Issue #274](https://github.com/OL1V3S/ordo/issues/274)

- The iPhone app has a Recurring tab: your confirmed recurring expenses (Active, with collapsible Paused and Ended groups) and the possible recurring expenses the server detected, with their expected timing and expected or observed amounts, in English and Spanish. You can review and confirm a possible one, dismiss it or review it again, and pause, reactivate or end (ending asks first) a confirmed one.
- A decision that times out or loses its connection is shown as unconfirmed; you can retry the same request or check the lists, and further recurring-expense changes wait until then. After every decision both lists and Home are re-read from the server, so nothing is changed on the phone first. Expected amounts are never counted as money spent. Reviewing detected changes and editing a recurring expense are not in the app yet. Backend, API, schema, web app and required checks are unchanged; the app is still not distributed.

### 2026-10-20 — Paychecks in the iPhone app

[PR #273](https://github.com/OL1V3S/ordo/pull/273) · [Issue #272](https://github.com/OL1V3S/ordo/issues/272)

- The iPhone app has a Paychecks tab: your pay schedules with their cadence, expected amount, next expected window ("Expected, not guaranteed.") and number of linked deposits, in English and Spanish. You can pause, reactivate or end a schedule (ending asks first), link a received paycheck to an active schedule's current or previous date as a new deposit or a saved one, and remove a link you made (the deposit stays in Transactions).
- A change that times out or loses its connection is shown as unconfirmed; you can retry the same request or check the schedules, and further paycheck changes wait until then. After every change the schedules, Home and Transactions are re-read from the server, so nothing is changed on the phone first. Expected paychecks are never counted as money received. Backend, API, schema, web app and required checks are unchanged; the app is still not distributed.

### 2026-10-19 — iPhone Transactions delete uses the row you confirmed

[PR #271](https://github.com/OL1V3S/ordo/pull/271) · [Issue #270](https://github.com/OL1V3S/ordo/issues/270)

- Deleting an expense or a deposit in the iPhone app now confirms the row the dialog showed, so the delete no longer depends on the order in which the dialog closes and its button runs. The same single delete request is sent after the same confirmation; a double tap or a change already in flight is still ignored.
- Mirrors the Budgets correction from #269. Backend, API, schema, web app and required checks are unchanged; the app is still not distributed.

### 2026-10-19 — Budgets in the iPhone app

[PR #269](https://github.com/OL1V3S/ordo/pull/269) · [Issue #268](https://github.com/OL1V3S/ordo/issues/268)

- The iPhone app has a Budgets tab: pick a month, see each category's limit against the spending recorded for it (a status, the used amount, and a progress bar and percent), and add a category budget, change a limit or delete one, in English and Spanish. A delete asks first and names the category.
- A budget change that times out or loses its connection is shown as unconfirmed, and further changes wait until the limits are read again from the server; after every change the limits and Home are re-read, so no amount is changed on the phone first. Backend, API, schema, web app and required checks are unchanged; the app is still not distributed.

### 2026-10-17 — Transactions in the iPhone app

[PR #263](https://github.com/OL1V3S/ordo/pull/263) · [Issue #262](https://github.com/OL1V3S/ordo/issues/262)

- The iPhone app has a Transactions tab: browse your expenses and deposits newest first, search and filter by type and dates, and edit or delete a record, in English and Spanish. A delete asks first and names the record; an edit uses the same fields and checks as Add.
- A change that times out or loses its connection is shown as unconfirmed, and you can retry the same request or check the list. After every change the list and Home are re-read from the server, so no amount is changed on the phone first. Backend, API, schema, web app and required checks are unchanged; the app is still not distributed.

### 2026-10-17 — Ordo look for the iPhone app

[PR #261](https://github.com/OL1V3S/ordo/pull/261) · [Issue #260](https://github.com/OL1V3S/ordo/issues/260)

- The iPhone app now has the web's colors and flat style through one theme layer: light and dark pairs (with Increase Contrast variants), the web's periwinkle accent, buttons that keep readable labels in dark mode, status messages with an icon and text, and money in monospaced digits with cash in shown in green. Navigation, sheets, Dynamic Type and VoiceOver stay native, and three small haptics confirm a save, an uncertain save and a form error.
- Presentation only: no change to data, networking, saving, sessions, copy, the web app, backend or required checks. New tests check every color in all four appearances, text contrast for the pairs used, and that views use only the theme.

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
