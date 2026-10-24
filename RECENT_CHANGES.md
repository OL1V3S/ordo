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

### 2026-10-23 — iPhone widget: this month's spending

[PR #297](https://github.com/OL1V3S/ordo/pull/297) · [Issue #291](https://github.com/OL1V3S/ordo/issues/291)

- The Home Screen widget now shows this month's exact spending and a six-month graph from the existing cash-flow report, labelled "Updated …"; it asks you to open Ordo when its copy is old.
- The app shares only the 2-hour access token with the widget through a shared Keychain item, removed at sign-out; the refresh credential never leaves the app. iPhone app only, so backend, API and schema are unchanged.

### 2026-10-23 — Web sessions: stay signed in on the web

[PR #295](https://github.com/OL1V3S/ordo/pull/295) · [PR #296](https://github.com/OL1V3S/ordo/pull/296) · [PR #298](https://github.com/OL1V3S/ordo/pull/298) · [Issue #292](https://github.com/OL1V3S/ordo/issues/292)

- Backend: `POST /api/auth/web-session`, `/refresh` and `/sign-out` keep a long-lived session in an HttpOnly, Secure, SameSite=Strict cookie, guarded by an Origin and custom-header check.
- Web app: signs in through a same-origin Vercel rewrite, refreshes the 2-hour access token before expiry and after a `401`, coordinates tabs with a Web Lock, and signs out on the server and in every tab.
- Session identity no longer changes when the access token is refreshed. Older 2-hour sessions run out normally; `/api/auth/login` and iOS are unchanged.

### 2026-10-23 — iPhone Home Screen widget: Add expense and Add deposit

[PR #294](https://github.com/OL1V3S/ordo/pull/294) · [Issue #291](https://github.com/OL1V3S/ordo/issues/291)

- New medium Home Screen widget with two buttons that open Add expense and Add deposit in the app. Nothing is saved from the widget. It shows "Open Ordo to see spending" for now; the spending graph is a later slice.
- The widget reads no account data and shares no credentials. English and Spanish; iPhone app only, so backend, API and schema are unchanged.

### 2026-10-22 — Edit a recurring expense in the iPhone app

[PR #290](https://github.com/OL1V3S/ordo/pull/290) · [Issue #288](https://github.com/OL1V3S/ordo/issues/288)

- Active, paused and ended recurring expenses now have an Edit action (row menu and detail screen) with the same form as Review and confirm; "Save changes" updates it.
- A saved amount that cannot be read exactly is left empty and has to be entered. A refused save keeps the form and your changes. English and Spanish; iPhone app only, so backend, API and schema are unchanged.

### 2026-10-22 — Review recurring expense changes in the iPhone app

[PR #289](https://github.com/OL1V3S/ordo/pull/289) · [Issue #288](https://github.com/OL1V3S/ordo/issues/288)

- The Recurring section now lists "Changes to review" (new amount, new dates, or no matching expense lately) with a detail screen. You can use the new details, keep the saved ones, keep an expense active, mark it as ended (with a confirmation) or review a kept change again.
- Home's "Needs your attention" links to these changes. English and Spanish; iPhone app only, so backend, API and schema are unchanged.

### 2026-10-20 — iPhone app tabs, sign-in "What is Ordo?", password rules

[PR #286](https://github.com/OL1V3S/ordo/pull/286) · [PR #287](https://github.com/OL1V3S/ordo/pull/287) · [Issue #285](https://github.com/OL1V3S/ordo/issues/285)

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
