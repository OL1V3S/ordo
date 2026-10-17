# Ordo for iPhone

A native SwiftUI iPhone app. Slice 1 signs in through the backend's device-session API
and shows a read-only Home (needs attention, recent transactions, upcoming paychecks).
It makes no writes to financial data. The governing issue is
[#256](https://github.com/OL1V3S/ordo/issues/256).

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

## Security notes

- Only the refresh credential is stored, in the Keychain
  (`AfterFirstUnlockThisDeviceOnly`, not synchronizable). The access token lives in
  memory only. The password is never stored.
- Exactly one refresh runs at a time (reusing a rotated credential
  ends the session). A refresh from an old session cannot affect a newer one.
- The app logs only static messages and status codes, never tokens, emails, bodies or
  amounts. Error bodies are read for their `code` only.
- The URL session is ephemeral (no disk cache or cookies).

## Out of scope for slice 1

Add Expense and Add Cash In, widget, push notifications, TestFlight or App Store
distribution, iPad layout, registration and password reset, in-app language picker, and
links into other web workflows.
