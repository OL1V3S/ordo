# Ordo for iPhone

A native SwiftUI iPhone app. Slice 1 ([#256](https://github.com/OL1V3S/ordo/issues/256))
signs in through the backend's device-session API and shows Home (needs attention, recent
transactions, upcoming paychecks). Slice 2 ([#258](https://github.com/OL1V3S/ordo/issues/258))
adds **Add expense** and **Add deposit** from Home, using `POST /api/expenses` and
`POST /api/inflows` with the server's `Idempotency-Key` protection. Slice 3
([#262](https://github.com/OL1V3S/ordo/issues/262)) adds a **Transactions** tab to browse,
search, filter, edit and delete expenses and deposits, using `GET /api/activity/timeline` and
`PUT`/`DELETE` on `/api/expenses/{id}` and `/api/inflows/{id}`. Slice 4
([#268](https://github.com/OL1V3S/ordo/issues/268)) adds a **Budgets** tab: a month's category
limits against the recorded spending, with add, edit and delete, using `GET`, `POST` and `DELETE`
on `/api/budgetlimits` and the existing timeline for spending. Slice 5
([#272](https://github.com/OL1V3S/ordo/issues/272)) adds a **Paychecks** tab: pay schedules, their
lifecycle, and linking or removing a received paycheck, using `GET /api/paychecks`,
`PATCH /api/paychecks/{id}/lifecycle`, `POST /api/paychecks/{id}/receipts`,
`DELETE /api/paychecks/{id}/receipts/{accountInflowId}` and `GET /api/inflows`. Slice 6
([#274](https://github.com/OL1V3S/ordo/issues/274)) adds a **Recurring** tab (Recurring expenses): confirmed
recurring expenses and detected possible ones, with confirm, dismiss, review again, pause, reactivate and
end, using `GET /api/commitment-candidates`, `GET /api/commitments`, `POST /api/commitment-candidates/confirm`,
`/dismiss` and `/reconsider`, and `PATCH /api/commitments/{id}/lifecycle`. Slice 7
([#276](https://github.com/OL1V3S/ordo/issues/276)) adds **Reports**,
using `GET /api/analytics/cash-flow`. Slice 8
([#281](https://github.com/OL1V3S/ordo/issues/281)) adds **Statement import**, opened from a Transactions toolbar
button, using the existing `/api/import-previews` endpoints. There is no backend, API or
schema change.

- iOS 18.0 or later, iPhone only. Swift 6 with strict concurrency. No third-party
  dependencies (SwiftUI, Foundation, Security, os, Swift Testing).
- English and Spanish (es-MX). The device language is used until a language is chosen in
  Settings or on the sign-in screen. Copy comes from the web catalogs in
  `frontend/src/shared/localization/locales`.

## Set up

1. Install Xcode 16 or later (CI and the maintainer use Xcode 27.1).
2. Copy `ios/Config/Local.xcconfig.example` to `ios/Config/Local.xcconfig`. The file is
   git-ignored; never commit it. Replace the placeholders:
   - `ORDO_API_BASE_URL` per configuration and SDK. The example points the simulator at
     `http://localhost:5298` and a device or Release build at your deployed backend over
     HTTPS (`https:/$()/YOUR-BACKEND-HOST.example`; write the double slash as `/$()/`
     because `//` starts an xcconfig comment).
   - `DEVELOPMENT_TEAM` (your own team ID), needed only to install on a physical iPhone.
   - Optionally `ORDO_BUNDLE_ID_PREFIX` (default `com.ol1v3s`).
3. Without a valid server address the app shows a "not set up" screen and makes no
   network calls. Release builds accept only `https`. Debug builds also accept `http`
   for `localhost` and `127.0.0.1`. No App Transport Security exceptions are used.

## Run against a local backend (simulator)

Run the API with the plain-HTTP profile. The default `https` profile redirects
the simulator to an untrusted development certificate:

```bash
cd backend
dotnet run --launch-profile http
```

Then run the `Ordo` scheme on an iPhone simulator. Use a local test account and a local
database; do not point a development build at production data you do not own.

## Run on your iPhone

Set `DEVELOPMENT_TEAM` and an HTTPS `ORDO_API_BASE_URL` for `[sdk=iphoneos*]` in
`Local.xcconfig`, select your device, and run. With a free Apple ID the free
provisioning profile expires after **7 days**: re-run from Xcode to re-sign and reinstall.
Installing over the existing app keeps the Keychain item; an uninstall clears it on the
next launch (first-launch cleanup).

## Tests

```bash
xcodebuild -project ios/Ordo.xcodeproj -scheme Ordo \
  -destination 'platform=iOS Simulator,name=iPhone 17' test
```

Use any available iPhone simulator name. The scheme sets `ORDO_TEST_HOST=1`, so the
hosted app stays inert (no session, no Keychain, no network). Tests use synthetic
fixtures and stub transports only. Do not set `CODE_SIGNING_ALLOWED=NO`: the real
Keychain tests need the simulator entitlement. The non-required **iOS build and tests**
workflow (`.github/workflows/ios-ci.yml`) runs the same command on pull requests that
touch `ios/**`.

## Add expense and Add deposit

Home has a bottom bar with **Add expense** (primary) and **Add deposit** (secondary), shown in
every Home state except the first load. Each opens a sheet.

- **Fields.** Expense: description, amount, date (defaults to today on the device calendar),
  category. Deposit: description, amount, date. A refund is recorded as a deposit.
- **Categories** come from a fixed list as on the web (there is no category endpoint):
  Uncategorized (default), Food, Transport, Bills, Entertainment and Other (custom text).
  A blank custom category sends `uncategorized`. The reserved value `other` is rejected on
  the phone and never sent. Descriptions keep their case.
- **Exact money.** Amounts are typed in a locale-aware way and held as integer cents
  (`Money`), never `Double`. One decimal separator is accepted (the app locale's, or the
  keyboard's, for example `,`); grouping separators, signs and exponents are rejected. They
  are sent as a JSON string with two decimals (`"12.50"`). They must be above zero and at
  most 9999999999999999.99. The server has the final say.
- **Recorded once.** On the first valid Save the values are frozen with one random
  lowercase-UUID `Idempotency-Key`, written to disk, and only then sent. From then on the
  form is read-only and a double tap cannot send a second request. Every retry, including one
  after a 401 refresh or a relaunch, re-sends the same key and the same bytes.
- **Results.** `201` and `200` (a replay of the same record) mean saved. `400` shows field
  messages (the server's field names only, never its text) and the next Save gets a new key.
  `409 idempotency_key_record_deleted` says the original was deleted and nothing new was
  saved. `422 idempotency_key_reused` says it may already be saved and is never retried.
  A timeout, dropped connection, `5xx`, cancellation or any unrecognised answer is
  **uncertain**: Retry (same key) or Discard (with a warning that it may already be saved).
  A `401` renews the session through the single refresher and retries with the same key; an
  ended session signs the user out.
- **After saving**, Home is re-read from the server. Nothing is added to Home optimistically.

### Pending save

While a save is uncertain its key and locked values stay in one file,
`Application Support/Ordo/Pending/pending-save.json`, so they survive the app being closed or
killed. The file is written atomically with file protection until first unlock, is excluded
from backups, is never in iCloud, and holds no token, email or account id. It is removed on a
definitive outcome, on Discard, on sign-out, when the session ends, and at a fresh sign-in. It
is never removed while the session is restoring or after a launch-time signed-out state (no
credential, or a transient Keychain failure), so an uncertain save survives those. After a
restored launch the app offers to retry or discard it. Signing out or a forced session end
discards a waiting save; the sign-out confirmation warns about it. If a leftover file cannot be
deleted (at sign-in, sign-out, session end or after a definitive outcome), it is marked invalid
in a non-financial `UserDefaults` flag and ignored: the next launch retries the delete and never
shows or sends it, and the flag is reset only after the delete succeeds.

## Transactions

The signed-in app is a five-tab `TabView`: **Home**, **Transactions** (Movimientos), **Plan**
(SF Symbol `list.clipboard`), **Reports** (Reportes) and **Settings** (Configuración), each with its own navigation stack.
Plan holds Budgets, Recurring expenses and Paychecks behind a switcher under the navigation bar (a menu at accessibility text sizes; off while a write is on its way). Switching rebuilds the area: data and drafts are kept, but a pushed screen, open groups and scroll position start over. The system tab bar is Liquid Glass on iOS 26 and later and the standard
bar on iOS 18-25. Add expense and Add deposit stay on Home; Settings (with Sign out) is its own tab.

- **List.** The tab reads `GET /api/activity/timeline` (25 rows a page, newest first, the server's
  cursor) when it first appears. Each row shows the kind, description, date, category (expenses),
  a paycheck-linked marker and the amount exactly as the server reports it. A stored amount that is
  not a positive exact amount (a legacy zero or negative) shows "Exact amount unavailable" with the
  stored text, never repaired. **Show older transactions** loads the next page (no automatic
  loading); pull to refresh re-reads the first page. A page that fails strict validation is hidden
  as a whole, as on the web. There are loading, empty, no-matches, error, offline and end states.
- **Search and filters.** The search field and a Filters sheet (type, period presets, custom
  dates) work as on the web. Only set filters are sent and the owner is never a parameter. The
  search is trimmed, limited to 100 UTF-16 units and debounced by 300 ms; kind and dates apply at
  once. An invalid draft (search too long, `from` after `to`) is never applied and shows the
  app's own message. Query values are percent-encoded with the RFC 3986 unreserved set, so `+`
  is not read as a space. Filters are not persisted. A filter the server still rejects shows the
  app's own message, and a rejected cursor restarts from the first page.
- **Edit.** Tap a row (or use Edit) for the same fields and validation as Add: description,
  amount (`Decimal`/`Money`, sent as a two-decimal string), date and, for expenses, category. The
  description keeps its case. A stored category outside the fixed list is edited as custom text; a
  legacy `other` must be chosen again and an empty one saves as `uncategorized`. An expense whose
  stored amount needs review has Delete only; a deposit in that state opens with the amount empty.
  The deposit form always shows the web's note that a pay-schedule link stays.
- **Delete.** A confirmation names the record. Deposits reuse the web's copy about the pay-schedule
  link and import. `204` and `404` both end with the record gone.
- **Server has the final say.** `400` shows localized field messages (field names only, never
  server text) and unlocks the form; `404` says the record no longer exists.
- **One write at a time.** Edits and deletes are disabled while Add is saving, and Add and a
  waiting save's Retry wait while an edit or delete is submitting. At the first valid Save or
  Confirm the request is frozen synchronously on the main actor and the form is read-only, so a
  double tap cannot send a second request.
- **Uncertain outcomes.** A timeout, dropped connection, cancellation, `5xx` or any unrecognised
  status leaves the change **uncertain**: **Retry** re-sends the identical frozen request, or
  **Check transactions** re-reads the list and Home and sends nothing. A `400` on a retry never
  says "not saved"; it asks the user to check the list.
- **Why a retry is safe without `Idempotency-Key`.** `PUT` is an absolute replacement (fixed
  values the server validates again), so the same body twice leaves the same row, and the server's
  evidence revisions change only when values differ; it never creates a record, so a record deleted
  meanwhile answers `404`. `DELETE` targets a never-reused, owner-scoped id; a repeat can only
  answer `404` for the same record. A `401` is refused before the controller runs. Residual risk:
  last write wins, because the API has no concurrency token (a change made on another device
  between two attempts is overwritten by the retry).
- **No optimistic money.** Nothing in the list or on Home changes locally. After an edit, a delete,
  a `404` or a check, the list and Home are re-read from the server. If the list re-read fails after
  a known change, the rows are cleared and the error state is shown. A saved expense or deposit
  also refreshes a list that has been opened.
- **Session.** A `401` refreshes once through the single-flight refresher and re-sends the same
  bytes; a second `401` or `session_invalid` signs the user out and drops any late response.
- **Nothing persisted.** The timeline, filters and in-flight edits and deletes live in memory only.
  An uncertain change is lost if the app is killed; both operations are idempotent and the server
  list is the check. There is no new file, `UserDefaults` key or Keychain item.

## Budgets

The **Budgets** section of the Plan tab (Presupuestos; first segment of the Plan switcher) shows how recorded spending compares
with each category's monthly limit, as the web's Plan, Budgets page does. It is the first section of the Plan tab, like the web's Plan hub. It uses the existing endpoints `GET /api/budgetlimits?monthYear=YYYY-MM`,
`POST /api/budgetlimits` (the server upserts by owner, exact category and month),
`DELETE /api/budgetlimits/{id}` and, for spending, `GET /api/activity/timeline`.

- **Month.** The month is an exact `YYYY-MM` key (`BudgetMonth`), never a `Date`. It defaults to the
  current month on the device calendar (Gregorian, device time zone), steps with integer arithmetic
  between 0001-01 and 9999-12, and has a **This month** shortcut. Only the visible label ("October
  2026", "octubre de 2026") is locale-aware. Stepping is blocked while a form is open, a change is
  pending or a change is unconfirmed.
- **Rows.** One row per category with its status, the used amount "of" the limit, and for a positive
  limit with an exact comparison a progress bar and the percent used. When the server returns several
  rows for one exact category the **last row wins**, as on the web; rows are never merged, repaired or
  deleted. Statuses, in the web's order: Spending unavailable, Exact spending unavailable, Exact limit
  unavailable, Zero limit (no spending), Over limit, Limit reached, Near limit, Within limit. Near limit
  (used at or above 90% of the limit) is a UI-only state, not a Home attention state. The bar is capped
  at 100%; the percent text is not. The percent and the 90% check use `Int128` in integer cents. A
  limit that is not a JSON number inside the exact range (a string, a negative, more than two
  decimals, 2^46 dollars or more) shows "Exact limit unavailable" for that row only.
- **Recorded spending** comes from the timeline (`kind=expense`, `from` the 1st of the month, `to` the
  last day, or today for the current month, 100 per page, paged to the end). A future month sends no
  request and shows `0.00` used. Amounts are summed in `Int64` cents per exact category (Unicode scalar
  equality, no trimming, case folding or aliases); a stored zero or negative amount, or a total above
  the maximum, makes only that category "Exact spending unavailable". A repeated record id counts once.
  Any failed or malformed page, a repeated cursor or more than 100 pages makes the whole month's spending
  unavailable: the limits stay visible with the web's message and "Try loading spending again", and a
  partial sum is never shown. An expense with a blank or whitespace-only category (never aliased to
  "Uncategorized") makes every row's spending "Exact spending unavailable" for that month, with the same
  retry, as Home's budget family does for the same data.
- **Add and Edit.** Add chooses Food, Transport, Bills, Entertainment or Other (custom text, trimmed,
  whitespace collapsed, lowercased, at most 100 characters; blank sends `uncategorized`; `other` is
  rejected and never sent) and a monthly limit for the selected month. Edit changes only the limit and
  sends the stored category verbatim, so the upsert key still matches the row. A row whose stored
  category is blank can only be deleted. The limit is entered with the shared amount input, zero or
  more, at most two decimals and below 2^46 dollars (70368744177663.99), so the app never saves a limit
  that it and the web read back as unavailable. Blank, negative and more-than-two-decimals input show
  the web's validation message on the phone. The server has the final say: `400` shows the same
  message and unlocks the form.
- **What the request sends.** `{"category":"food","limitAmount":12.50,"monthYear":"2026-10-01"}` and
  nothing else: no `id`, `userId` or `user`. The body is written byte by byte with sorted keys, so a
  retry sends identical bytes. The limit is a JSON number whose text is exactly the two-decimal
  `Money.text`, so the server reads the same cents. `monthYear` is a date-only `YYYY-MM-01` with no time
  and no offset; the server reads the year and month and nothing else, so it stores the intended month
  on any device or server time zone. (The web sends device-local midnight as a UTC instant, which
  stores the previous month east of UTC; this is reported, and the web is unchanged.)
- **Delete** asks first, naming the category. `204` and `404` both end with the row gone.
- **Uncertain writes.** A timeout, dropped connection, cancellation, `5xx` or any unrecognised status
  leaves the change **unconfirmed**. As on the web, further changes are blocked until the limits are
  read from the server again with **Refresh limits**; the form stays open with its fields editable, Save
  disabled and Cancel enabled, and the user is told to check the saved limits first. A change that
  succeeded but whose limits re-read failed is reported as saved or deleted, with the same gate. There
  is no "Retry the same request" button.
- **Why a repeat is safe without `Idempotency-Key`.** The upsert is an absolute set of one value on the
  row keyed by owner, exact category and month (or one insert), so the same category, limit and month
  twice leaves the same state. The delete targets a never-reused, owner-scoped id; a repeat can only
  answer `404` for the same row, which means gone. A `401` is refused before the controller runs.
  Residual risks: last write wins (no concurrency token), the server's `FirstOrDefaultAsync` has no
  `OrderBy` so with duplicate rows a repeat may update a different duplicate, and uniqueness is not
  enforced, so two overlapping inserts could create a duplicate. A duplicate is shown per the last-row
  rule and never repaired.
- **No optimistic money.** Nothing is changed locally. After a known change the limits are re-read and
  Home is refreshed (its budget attention depends on them). A capture save, or a Transactions edit or
  delete, re-reads the month's spending once Budgets has been opened. Pull to refresh re-reads limits and
  spending; the spending is also re-read when the device day changes.
- **One write at a time** across the app: a budget save or delete disables Add expense, Add deposit
  and Transactions edits, and the reverse. A double tap cannot send a second request.
- **Session.** A `401` refreshes once through the single-flight refresher and re-sends the same bytes;
  a second `401` or `session_invalid` signs the user out and drops any late response.
- **Nothing persisted.** Limits, spending, the form and the gate live in memory only. The owner id the
  server returns in each limit row is never decoded, shown, stored, logged or sent. Amounts, categories,
  custom text and record ids are never logged, and server text is never shown.
- **Out of scope:** pacing, forecasts, rollover, non-monthly budgets, a total across categories,
  duplicate cleanup, changing a row's category (delete and add instead, as on the web), an offline cache
  or queue, and the other Plan pages.

## Paychecks

The **Paychecks** section of the Plan tab (Nómina; third segment of the Plan switcher) lists the user's pay schedules as the web's
Plan, Paychecks page does. It uses `GET /api/paychecks`,
`PATCH /api/paychecks/{id}/lifecycle`, `POST /api/paychecks/{id}/receipts`,
`DELETE /api/paychecks/{id}/receipts/{accountInflowId}` and, for saved deposits, `GET /api/inflows`.

- **List.** Active schedules first, then collapsible Paused and Ended groups (collapsed until a pause or
  end opens the destination). A row shows the name, status, cadence, expected amount, the next expected
  window with "Expected, not guaranteed." and the number of linked deposits. Expected money is never
  shown as received and nothing on the screen is totalled. A detail screen adds the web's facts and the
  linked deposits. The pay schedule itself cannot be created or edited here.
- **Lifecycle.** Active: Pause, End. Paused: Reactivate, End. Ended: Reactivate, Pause (as on the web).
  End asks first; Pause and Reactivate do not.
- **Link a deposit.** Offered for an active schedule only, for the slots the server lists in
  `receiptSlots` (current, previous). The app never computes slots, so near midnight the server's UTC
  "current" slot can differ from the device's day. The user records a new deposit (description, amount,
  date; the amount is sent as a JSON number whose text is the exact two-decimal amount) or picks a saved
  deposit. Saved deposits that any schedule (any lifecycle) already has linked are not offered: the
  server has no "linked" flag, so the app derives the set from the evidence of the `GET /api/paychecks`
  read. `GET /api/inflows` is unbounded, as on the web. Warnings (date outside the window, amount
  differs or outside the range) are advisory and never block. A slot that disappears after a refresh
  stays visible as "(previously selected)" and Link is disabled until a listed date is chosen.
- **Remove a link.** Only links the user recorded can be removed, on any lifecycle, after a
  confirmation. The deposit stays in Transactions.
- **Retry safety.** `POST .../receipts` takes no `Idempotency-Key`. The server answers a repeat of the
  same request (same schedule and slot, the same saved deposit, or the same new-deposit date, amount
  and description) with `200 alreadyRecorded` and writes nothing. The first valid tap freezes the
  request (exact bytes) and sends once; a timeout, lost connection, `5xx` or anything unrecognised is
  an unconfirmed result: Retry re-sends the identical bytes and Check re-reads the schedules (sends
  nothing); every paycheck write waits until it is resolved. A `409` on a Retry is never reported as
  "not saved" and forces a Check. Residual risks: a Retry after the link was removed elsewhere, or the
  deposit deleted elsewhere, creates a new deposit (so Check first); lifecycle changes are last write
  wins; the unconfirmed state is lost if the app is killed; and after a Check finds no link, a new
  submission while the first request may still be running on the server could conflict or duplicate
  (the web has the same edge).
- **Refresh.** No optimistic updates. After a change or a Check the schedules, Home and Transactions are
  re-read. A capture deposit save or a Transactions deposit edit or delete re-reads the schedules once
  the tab has been opened. If the read after a change fails, the list is hidden with a message.
- **One write at a time** across the app, shared with capture, Transactions and Budgets.
- **Amounts.** Money is decoded as `Decimal` and shown exactly up to 9999999999999999.99 (tests prove
  exact decoding above 2^53 cents); the web shows 2^46 dollars and above as unavailable because of
  JavaScript numbers. Anything inexact shows "Exact amount unavailable".
- **Nothing persisted;** `origin`, timestamps and algorithm versions are never decoded; amounts,
  names, dates, ids and server text are never logged, and server error text is never shown.
- **Out of scope:** creating or editing a schedule, detected "possible paychecks", match suggestions,
  statement-import linking, totals of expected money and an offline cache or queue.

## Recurring expenses

The **Recurring** section of the Plan tab (second segment of the Plan switcher, labeled "Recurring expenses" /
"Gastos recurrentes") is the web's Plan, Recurring expenses page. It uses `GET /api/commitment-candidates`
and `GET /api/commitments` (read together; if either fails or is malformed the whole list is hidden with a
Try again button), `GET /api/commitment-changes` (see Changes to review), `POST /api/commitment-candidates/confirm`, `/dismiss` and `/reconsider`, and
`PATCH /api/commitments/{id}/lifecycle`.

- **List.** Your recurring expenses (Active), Possible recurring expenses (to review), collapsible Paused and
  Ended groups and a collapsible Dismissed group, in the web's order, with the server's order kept inside each
  group. A row shows name, category and cadence, the expected timing summary ("Day 15, up to 1 day early or 2
  days late") and the expected (or observed) amount. The server has no next-date projection for recurring
  expenses, so no next date is shown or computed. Expected money is never shown as spent and nothing is totalled.
  Detail screens list the matching expenses used.
- **Review and confirm.** A sheet prefilled from the candidate (name, category, how often, weekday or day or
  month, days before and after, fixed amount or range, with exact observed amounts only). Client checks follow
  the web plus two server rules the web leaves to the server (range maximum at least the minimum; a yearly day
  that exists in the month, 29 February allowed). The body is built byte by byte with sorted keys and explicit
  nulls; amounts are JSON numbers (the web sends exact strings; the server accepts both). An observed amount that
  cannot be read exactly disables Confirm (an `amount_invalid` message, where the web silently blocks).
- **Dismiss, Review again, Pause, Reactivate, End.** No confirmation except End, which acts on the recurring
  expense it presents and closes if that expense changed or disappeared after a re-read. A definitive `fingerprint_invalid`
  also re-reads (the web does not).
- **Retry safety.** No `Idempotency-Key`: confirm is idempotent by origin fingerprint (a repeat answers
  `alreadyConfirmed`, treated as success); dismiss and review again answer `204` when already in the target
  state; lifecycle is an absolute set. A timeout, lost connection, `5xx` or anything unrecognised is shown as
  unconfirmed with Retry (identical bytes) and Check (re-reads; sends nothing); all recurring-expense writes wait.
  If the confirm sheet was dismissed during an unknown outcome and a later Retry is refused, the error is shown
  as the visible notice. A `409` on Retry forces Check and never says "not saved". Residual risks: a Retry during
  a still-running first confirm can answer `409 confirmation_conflict`; dismiss and review again answer
  `409 candidate_changed` after the matching expenses changed; lifecycle changes are last write wins; the unknown
  state is not persisted.
- **Refresh.** No optimistic updates: after a decision or a Check both lists and Home are re-read. A saved
  expense or an expense edit or delete re-reads the tab once it has been opened.
- **Changes to review.** `GET /api/commitment-changes` is read with the two lists but on its own: if only it
  fails, the lists stay, the Changes section says it could not be loaded with a Try again button, and no change
  can be decided. The "Changes to review (N)" section sits between Active and Possible; a collapsed "Reviewed
  changes" group holds kept changes. Rows open a detail screen (the only place with decisions): saved details
  against the observed change, the expenses behind it, missed dates, why it was suggested, when it was checked
  and the detector version. Only amount and timing `proposed_change` and missing `not_seen_recently` /
  `possibly_ended` assessments with a 64-hex fingerprint and a pending or kept decision are shown (a bad
  fingerprint hides only that assessment). Pending amount or timing: Use the new details, Keep saved details.
  Possibly ended: Mark as ended (with a confirmation) and Keep active; not seen lately: Keep active only. Kept:
  Review again. Snapshot money arrives as JSON numbers and is read as `Decimal`; proposed and observed amounts
  are strings read exactly. An amount assessment whose proposed value, evidence list or observation amounts are
  not exact disables every decision on it and says to refresh. Decisions are
  `POST /api/commitment-changes/{id}/amount|timing/accept`, `/missing/mark-ended`, `/{dimension}/keep` and
  `/{dimension}/reconsider`, each with only `{"fingerprint": ...}`, through the same write machine as the other
  recurring-expense writes (one write at a time, Retry sends identical bytes, a `409` on Retry forces Check, a
  Keep Retry answered `204` is success). Only `409 change_proposal_changed` and `404 commitment_not_found` re-read;
  `400` and `422` show the error and change nothing. After a success both lists, the changes and Home are re-read.
- **Home link.** Needs your attention shows "Review recurring expenses" (or "See all N items to review" when more
  items exist than the two shown) when there are recurring-expense items, and also when attention is unavailable
  or malformed. It opens Plan, Recurring expenses and scrolls to Changes. It is off while a write is in flight,
  like the Plan switcher. Tab and Plan section selection live in `AppModel`.
- **Out of scope:** editing a recurring expense (`PUT /api/commitments/{id}`), a next-expected date, quick
  decisions on list rows, links from individual attention rows, totals of expected money and an offline cache.
- **Nothing persisted;** names, categories, amounts, dates, ids and fingerprints are never logged, and server
  error text is never shown.

## Reports

Reports (Reportes, SF Symbol `chart.bar.xaxis`) is a tab of its own, the web's cash-flow region of `/analytics`. It is read-only.

- **Endpoint.** One `GET /api/analytics/cash-flow?month=YYYY-MM&throughDate=YYYY-MM-DD`; `throughDate` is the device-local day. A response for another month or day is rejected, as on the web.
- **Exact money.** Amounts arrive as integer-cent strings and are held as `Int128` (`CashAmount`), never `Double`; tests cover values above 2^53 and above `Int64`. Nothing is summed or subtracted on the phone. Percentages and money text are ported from the web with exact digits.
- **Screen.** Month picker (earlier, later, this month, over the listed months), summary (deposits, spent, confirmed paychecks vs other deposits, deposits minus spending, "About these figures"), spending by category, and the six-month trend.
- **Chart and list.** A Swift Charts bar chart (hidden from VoiceOver) plus the web's "View chart data" as an exact list. No tap tooltip. `approximateDollars` is used only by the chart.
- **States.** Loading, error with Retry, pull to refresh. A failed refresh clears the report and shows the error. No writes, so no uncertain state.
- **Refresh.** Reports re-reads after Capture saves, Transactions edits and deletes, and Paychecks writes, once opened. Not after Budgets or Recurring writes. Sign-out resets it. Nothing is persisted or logged.
- **Departures from the web.** Pull to refresh replaces the Refresh button; no chart tooltip; the lower "More spending detail" section (previous-month change, largest expenses, "Budget status / Open budgets" link) is omitted.

## Statement import

Import statement (Importar estado de cuenta) is a toolbar button on Transactions that opens a full-screen import. Sunflower PDF only.

- **Flow.** `GET /api/import-previews/open` finds an unfinished preview (`204` shows Choose PDF). The system picker (PDF only) picks a file; it is uploaded once; the review lists rows with filters (All, To review, Possible duplicates, Deposit rows, Selected), summary, select or clear, and per-row selection. Expense rows can edit description and category. Confirm saves the selected rows, then Home and the opened tabs are read again.
- **Privacy.** The PDF is read into memory only (at most 10 MiB + 1 byte, under file coordination), never copied, cached or saved. The upload file part is always named `statement.pdf`. Nothing but static messages and status codes is logged. A picker copy is deleted only if it is a regular file inside the app's own temp or Inbox folder; nothing else is ever deleted.
- **No duplicates.** Confirm is never retried automatically. An unknown outcome shows Retry, which sends the same `POST`; the server answers a repeat with `200 already_confirmed` and creates nothing. Closing after an unknown outcome still refreshes the other tabs. An unknown upload is not resent: the open preview is read and the user can choose the file again. Row writes are absolute and bulk select or clear sets state, so they are repeated safely (bulk replays once, then Confirm waits for Reload).
- **Gate.** Import joins the one-write-at-a-time checks. Sign-out and both session changes reset it; late responses are ignored.
- **Messages.** Server text is never shown; codes map to the web's catalog entries. Any `413` is "file too large".
- **Departures from the web.** Bank is fixed to Sunflower; no paycheck linking after saving; saved rows are shown as counts only; no per-row confirmation codes (a duplicate refusal re-reads the preview). iOS-only strings (`importPreview.ios.*`) need Spanish review.

## Account

The sign-in screen is a centred column (it scrolls at large text sizes or with the keyboard open) with **Forgot password?**, **Create account** and **What is Ordo?**, like the web's links. What is Ordo? opens a sheet that describes the shipped areas, names Sunflower Bank PDF import only, and says the figures are not a balance, savings or money available to spend. Create account lists the password rules one per line. Forgot password has a wrapping in-body heading (no navigation title) and keeps the confirmation-email help and resend in a collapsed disclosure.

- **Requests.** `POST /api/auth/register`, `/resend-confirmation` and `/forgot-password`, the same as the web, with no token. `language` is the app's language, so the emails match it. Registering does not sign in.
- **Create account.** Email, password, confirm password and the web's password list. Only a mismatch is checked on the phone; Identity `code` values map to the web's messages (descriptions are never read). Success, or `503 confirmation_email_delivery_failed`, opens Check your email.
- **Unknown outcome.** A register timeout or lost connection may have created the account, so Check your email says it is not known and offers Resend and Back to sign in. Never retried automatically.
- **Resend and forgot** show the same message for any email. A resend `429` says "Too many requests"; any forgot failure is the web's failure message.
- **Email links open in Safari** on the web's `/confirm-email` and `/reset-password` pages. The app never handles a token; there are no Universal Links or URL schemes. Known gap: those pages open in the web's language, not the app's.
- **Passwords** live only in memory and are cleared after a submit that reaches Check your email, when the screen is left and on any session change. Nothing is logged or stored. Back is hidden while a request is on its way, and late answers after a reset are ignored.
- On sign-in, "Confirm your email" adds a Resend confirmation email button.
- iOS-only strings (`auth.ios.*`, `auth.register.ios.*`, `settings.ios.*`) need Spanish review.

## Settings

Settings is the fifth tab. The account email is not shown.

- **Appearance:** System (default), Light, Dark, applied at the window root (sheets and dialogs included).
- **Language:** English or Español. It applies at once to the strings, formatting, amount parsing and system controls (the root `locale`). It is locked while a save, edit or delete is on its way; open drafts are kept. The sign-in and account screens have the same language menu.
- **Sign out** is here, with the same confirmation and waiting-save warning.
- **Stored on the device:** only `ordo.theme` and `ordo.language` in `UserDefaults`. Sign-out and an ended session keep them.

## Look and theme

The app uses Ordo's web look through one theme layer (`ios/Ordo/Theme`), while keeping iOS
structure: large-title navigation, inset-grouped lists, system sheets, Dynamic Type, VoiceOver,
Reduce Motion and Increase Contrast.

- **Colors** are asset-catalog color sets (`Resources/Assets.xcassets/Theme`, plus `AccentColor`)
  ported from the web's `themes.css`, with light, dark and Increase Contrast values. The app follows
  the system appearance unless Light or Dark is chosen in Settings.
- **Views never use raw colors.** They use `ThemeColor`, `Theme.Typography` (text styles only, so
  everything scales), `Theme.Space`, `Theme.Radius` and the `Ordo*ButtonStyle` styles. The system
  `.borderedProminent` style is not used: its white label fails contrast on the dark accent.
  `ThemeSourceRulesTests` scans `ios/Ordo/Views` and fails on raw or system colors, fixed font sizes
  and system bordered button styles.
- **Money** is monospaced-digit semibold. The sign and the kind label carry direction; color only
  reinforces it: cash in is green, spending stays neutral and is never red.
- **Adding a color:** add it to the web tokens first, then a color set, a `ThemeColor` case, and its
  row in `docs/design-tokens.md` and `ThemeColorTests`. Add every new text/background pair to
  `ThemeContrastTests`.
- The full token mapping and contrast table is in the iOS section of
  [`docs/design-tokens.md`](../docs/design-tokens.md).

## Security notes

- Only the refresh credential is stored, in the Keychain
  (`AfterFirstUnlockThisDeviceOnly`, not synchronizable). The access token lives in
  memory only. The password is never stored.
- Exactly one refresh runs at a time (reusing a rotated credential
  ends the session). A refresh from an old session cannot affect a newer one.
- The app logs only static messages and status codes, never tokens, emails, bodies, amounts,
  descriptions, categories, search text, record ids, cursors or idempotency keys. Error bodies are read for
  their `code` (and, for a create or edit `400`, the field names) only; server text is never shown.
- The URL session is ephemeral (no disk cache or cookies).
- `UserDefaults` holds only non-financial flags and the two settings `ordo.theme` and
  `ordo.language`. Registration adds nothing to the Keychain.

## Out of scope

Add expense and Add deposit on the Transactions tab, bulk edit or delete, undo, an offline queue
or cache, a concurrency token or conflict detection, automatic infinite scrolling, persisted
filters, category management, creating or editing pay schedules, possible-paycheck suggestions, editing a recurring expense, paycheck linking after an import, Reports' "More spending detail",
widget, push notifications, TestFlight or App Store distribution, iPad
layout, confirming an email or resetting a password inside the app (Universal Links, URL schemes,
a paste-the-link field), and links into other web workflows.
