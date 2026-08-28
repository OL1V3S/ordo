# Debugging and Smoke Checks

## Purpose

Use this guide to locate the smallest failing layer in a local or preview Ordo
workflow. Debugging and smoke checks provide focused evidence; they do not
replace the full verification and CI requirements in
[`verification.md`](verification.md), the authority rules in
[`../AGENTS.md`](../AGENTS.md), independent review, or human merge authority.

## Privacy-safe evidence

Use synthetic or private test data. Durable issues, pull requests, committed
fixtures, screenshots, and copied logs must not contain:

- tokens, cookies, authorization headers, credentials, secrets, or connection
  strings;
- statement or PDF content, transaction descriptions, amounts, or dates;
- email addresses, user or account identifiers, or digests/hashes of those
  identifiers;
- Data Protection key material; or
- full financial or authentication payloads.

Prefer method and path, HTTP status, timing, content type, response shape,
aggregate row count, synthetic identifiers, sanitized subsystem/error category,
and exact non-secret commit evidence. Private inspection does not authorize
durable disclosure.

## Diagnostic sequence

Stop when the faulty boundary is established. Open a separately scoped issue if
the correction would exceed the governing task.

### 1. Reproduce and identify the environment

Record the exact commit, local/preview/deployed environment, route or action,
expected state, and observed state. Determine whether the behavior is local,
preview-only, deployed-only, or shared.

### 2. Frontend and render state

Distinguish pending, error, successful-empty, and populated states. Inspect the
narrow component or hook and run its focused test, for example:

```bash
cd frontend
npm test -- src/path/to/changed.test.jsx
```

Check the browser console for the error category, without copying sensitive
values into durable evidence.

### 3. Browser, network, and API

In the browser Network panel, inspect only the request method/path, status,
timing, content type, response shape, and aggregate row count when necessary.
Separate these outcomes:

- no request, transport, or CORS failure;
- `401` unauthenticated or `403` forbidden;
- other `4xx` validation failures;
- `5xx` backend failures;
- successful empty responses; and
- successful populated responses that the UI fails to render.

Do not copy request/response bodies or authentication material.

### 4. Authentication and session

Use the status boundary and privately visible signed-in state to distinguish an
expired/missing session from authorization failure. Reauthenticate privately
when appropriate. Do not inspect, print, or publish tokens. Changes to
authentication semantics require their own approved scope.

### 5. Backend execution

Use sanitized local application logs to determine whether routing/controller
execution began, whether an exception occurred, and which subsystem category
failed. Do not add production logging or copy request/response bodies merely to
diagnose a task.

Run a focused backend test while narrowing the failure, for example:

```bash
dotnet test backend.Tests/backend.Tests.csproj --filter "FullyQualifiedName~RelevantTest"
```

### 6. PostgreSQL and persistence

Use a disposable local PostgreSQL database and synthetic fixtures. Inspect
schema/constraint state or aggregate counts rather than row contents. Run the
canonical lane when persistence evidence is applicable:

```bash
./scripts/verify.sh postgresql
```

Never substitute Neon, Render, production, or another hosted database when the
local capability is unavailable. Production reads require separate authority.

### 7. Deployment-only failures

Compare the exact deployed commit and configuration key names—never values—then
inspect privacy-safe platform status or sanitized application logs. Route a
deployment-only defect to separately scoped work rather than expanding the
current issue.

## Smoke checks after a change

A smoke check is the smallest changed-boundary behavior check after focused
tests. Report it separately from full verification.

| Changed boundary | Minimal smoke check |
| --- | --- |
| Frontend only | Open the changed local route, exercise one representative state or action, confirm the expected visible transition, and confirm no browser console error. |
| API/backend | Send one minimal synthetic local request through the changed endpoint; confirm status, response shape, and the sanitized backend outcome. |
| Persistence | Exercise the narrow changed path against an approved disposable local PostgreSQL database; confirm the intended aggregate or constraint outcome. |
| Browser to API | Perform one representative local UI action; confirm the expected request status/shape and resulting UI state. |
| Repository, docs, or CI only | Exercise the affected verifier lane or its dry-run/usage path and validate referenced commands. Do not claim an artificial application smoke. |

For local UI work, start the backend and frontend through their established
development commands:

```bash
dotnet run --project backend/backend.csproj
```

```bash
cd frontend
npm run dev
```

If a required local service is unavailable, report the smoke check as not run;
do not infer a pass from CI.

## Preview and production boundary

After CI and Vercel preview evidence succeed, check a public shell or changed
unauthenticated preview route when relevant. Authenticated preview checks use a
private test session and publish only the privacy-safe evidence defined above.

Do not automate production or deployed authentication, data access, writes,
migrations, redeployments, recovery actions, or settings changes under ordinary
verification authority. Those actions require their existing explicit
authorization. When authorized, production smoke remains minimal and read-only
by default, and sensitive state stays private.

## Deferred operational capabilities

This guide does not add health/readiness endpoints, request correlation,
centralized exception handling, logging or telemetry, alerts, automated browser
or deployment smoke, rollback/incident runbooks, deployment workflows, or
runtime configuration. Those remain the separately scoped ROADMAP D2/D3 work.
