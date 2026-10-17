# Ordo for iPhone

A native SwiftUI iPhone app. Slice 1 ([#256](https://github.com/OL1V3S/ordo/issues/256))
signs in through the backend's device-session API and shows Home (needs attention, recent
transactions, upcoming paychecks). Slice 2 ([#258](https://github.com/OL1V3S/ordo/issues/258))
adds **Add expense** and **Add deposit** from Home. These are the app's only financial
writes: `POST /api/expenses` and `POST /api/inflows` with the server's `Idempotency-Key`
protection. There is no backend, API or schema change.

- iOS 18.0 or later, iPhone only. Swift 6 with strict concurrency. No third-party
  dependencies (SwiftUI, Foundation, Security, os, Swift Testing).
- English and Spanish (es-MX), following the device language. Copy comes from the web
  catalogs in `frontend/src/shared/localization/locales`.

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

## Look and theme

The app uses Ordo's web look through one theme layer (`ios/Ordo/Theme`), while keeping iOS
structure: large-title navigation, inset-grouped lists, system sheets, Dynamic Type, VoiceOver,
Reduce Motion and Increase Contrast.

- **Colors** are asset-catalog color sets (`Resources/Assets.xcassets/Theme`, plus `AccentColor`)
  ported from the web's `themes.css`, with light, dark and Increase Contrast values. The app follows
  the system appearance; there is no in-app picker.
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
  descriptions or idempotency keys. Error bodies are read for their `code` (and, for a
  create `400`, the field names) only; server text is never shown.
- The URL session is ephemeral (no disk cache or cookies).

## Out of scope

Editing or deleting expenses and deposits, an offline queue that saves later on its own,
category management, paycheck linking, statement import, receipts, widget, push
notifications, TestFlight or App Store distribution, iPad layout, registration and
password reset, in-app language picker, and links into other web workflows.
