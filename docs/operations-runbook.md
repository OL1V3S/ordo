# Operations Runbook: Backup, Restore and Rollback

## Authority

This document authorizes nothing. It is reference material only.

- Drills, restores, rollbacks, redeploys, migrations, and any production read or
  write are separately gated. Each needs explicit, durable owner authorization
  (see [`../AGENTS.md`](../AGENTS.md)) before it is run.
- Ordinary verification authority never covers production actions
  ([`debugging.md`](debugging.md)).
- Anything marked **OWNER TO FILL IN** is a fact an agent cannot read from the
  repository. Do not guess it. Do not fill it in without the owner.

## Facts to record

| Fact | Value | Confirmed from (console page, date) |
| --- | --- | --- |
| Neon plan tier | OWNER TO FILL IN | OWNER TO FILL IN |
| Neon point-in-time restore (PITR) retention window | OWNER TO FILL IN | OWNER TO FILL IN |
| Neon project and production branch names | OWNER TO FILL IN | OWNER TO FILL IN |
| Neon automated snapshot/backup schedule, if any | OWNER TO FILL IN | OWNER TO FILL IN |
| Neon branch-count limit and cost of a drill branch | OWNER TO FILL IN | OWNER TO FILL IN |
| Render service name and plan | OWNER TO FILL IN | OWNER TO FILL IN |
| Number of previous Render deploys kept and rollbackable | OWNER TO FILL IN | OWNER TO FILL IN |
| Vercel project name and production alias | OWNER TO FILL IN | OWNER TO FILL IN |
| Who holds Neon, Render, and Vercel admin access | OWNER TO FILL IN | OWNER TO FILL IN |
| Recovery time objective (RTO): target time to restore service | OWNER TO FILL IN | OWNER TO FILL IN |
| Recovery point objective (RPO): acceptable data loss | OWNER TO FILL IN | OWNER TO FILL IN |
| Restore drill authorization (link to the durable #339 comment) | OWNER TO FILL IN | OWNER TO FILL IN |
| Last restore drill: date and result | OWNER TO FILL IN | OWNER TO FILL IN |
| Last JWT key rotation date (date only, never values) | OWNER TO FILL IN | OWNER TO FILL IN |

- RTO and RPO are owner decisions. No agent sets them. A measured drill time
  informs them; it does not set them.
- "Confirmed from" names the console page or document and the date. Never
  paste connection strings, hostnames or screenshots of them.

## Who can do what

- Owner (`OL1V3S`): the only person who may authorize and run production
  restores, rollbacks, redeploys, and migrations. Other platform admins:
  OWNER TO FILL IN.
- Agents and workers: may edit this document and run local, disposable checks.
  They never touch Neon, Render, or Vercel production, and never hold a
  production connection string.
- CI: builds and tests only. It does not deploy or migrate production.

## Ordering rules

From [`../README.md`](../README.md#production-database-migrations):

- Apply schema changes before deploying application code that requires them.
- Keep migrations backward-compatible with the running application.
- Never run migrations from application startup or the Docker start command.
- Rolling back a Render deploy or a Vercel deployment does not roll back the
  database schema.
- After production data has changed, prefer a forward corrective migration over
  restoring the database.
- Destructive or backward-incompatible migrations need a verified recovery
  point (Neon branch or backup) before they run.

Practical consequences:

- Rolling the app back past a migration is safe only if the older app still
  works with the newer schema. Check this before rolling back.
- A database restore returns the schema and data to the restore point. The
  deployed app must be compatible with that older schema. Check the
  `__EFMigrationsHistory` table against the deployed commit.
- The Data Protection key ring lives in the `DataProtectionKeys` table. A
  restore to before the keys existed or rotated can invalidate outstanding
  tokens and protected payloads. Expect users to sign in again and tokens to be
  reissued. See the Data Protection section of the README.

## Neon recovery

Behavior below is generic Neon behavior. Confirm it against current Neon
documentation and the active plan before relying on it. The retention window
and available features depend on the plan: OWNER TO FILL IN. See
[Unverified Neon behavior](#unverified-neon-behavior) for the claims no one has
confirmed yet.

### Before any restore

1. Get written owner authorization for the specific restore.
2. Decide the target time (UTC) from privacy-safe evidence, such as deploy
   times and migration times. Do not copy row contents into durable notes.
3. Check that the target time is inside the PITR retention window:
   OWNER TO FILL IN.
4. Decide the order: verify on a branch first (below), then restore production
   only if verification passes.

### Restore to a branch (non-destructive)

Preferred first step. Production is not changed.

1. In the Neon console, open the project and the production branch.
2. Create a branch from the production branch at the chosen past time (or
   timestamp/LSN) instead of the current head.
3. Name it clearly (for example `restore-check-YYYYMMDD`). Record the name.
4. Use the new branch's own connection string. Keep it private and never
   commit it.
5. Delete the branch when finished. It holds a copy of production data. A
   [restore drill](#restore-drill-owner-run) always deletes its branch.

### Restore production in place (destructive)

Only after a branch check and explicit owner authorization.

1. In the Neon console, use the restore feature on the production branch and
   choose the target time.
2. Neon's restore replaces the branch's current state with the chosen
   point-in-time state. Confirm in current Neon docs whether Neon preserves the
   pre-restore state as a backup branch, and its name and lifetime:
   OWNER TO FILL IN.
3. Connection strings normally stay the same for an in-place restore. Confirm
   after restoring. Do not change Render environment values without its own
   authorization.
4. Run the post-incident checks below.

### Unverified Neon behavior

None of these is confirmed for this project. Treat each as unknown until the
owner records the date it was confirmed from current Neon documentation or the
console. Do not rely on any of them before then.

| Claim | Confirmed (date) |
| --- | --- |
| Plan tier, and which recovery features it includes | OWNER TO FILL IN |
| History/PITR window, and restore to an arbitrary timestamp or LSN | OWNER TO FILL IN |
| A branch created at a past time leaves the parent branch untouched | OWNER TO FILL IN |
| Branch creation time (measure it in a drill; do not assume) | OWNER TO FILL IN |
| A branch inherits the parent's roles and passwords, so its connection string is as sensitive as production | OWNER TO FILL IN |
| The branch's endpoint host, and which string is direct (unpooled) versus pooled | OWNER TO FILL IN |
| Autosuspend and cold-start time | OWNER TO FILL IN |
| Compute and storage cost of a drill branch, and the branch-count limit | OWNER TO FILL IN |
| Delete rules (branches with children, the default branch) | OWNER TO FILL IN |
| In-place restore keeps a backup branch, and connection strings stay the same (see steps 2 and 3 of "Restore production in place") | OWNER TO FILL IN |

## Verifying a restore without touching production

- Restore to a branch (above), never over production, to test a recovery.
- Connect to the branch only under a durable owner authorization for that
  restore or a [restore drill](#restore-drill-owner-run), read-only (except the
  drill's optional app check). Otherwise stop and report. Never point CI, a CI
  secret, or the PostgreSQL integration tests at a branch.
- Never use Neon, Render, production, or another hosted database as a
  substitute when a local PostgreSQL is unavailable
  ([`debugging.md`](debugging.md), [`verification.md`](verification.md)).
- For local verification, use a disposable local PostgreSQL with synthetic
  data and `./scripts/verify.sh postgresql`.
- Inspect schema state, `__EFMigrationsHistory` IDs, and aggregate row counts.
  Do not read or publish row contents.

## Restore drill (owner-run)

**Authorizes nothing.** This is a checklist. The owner may run it only after
posting a durable authorization on
[#339](https://github.com/OL1V3S/ordo/issues/339). Agents never run it, never
hold the branch connection string, and never fill in the facts. No drill has
been run.

Goal: measure a branch restore and check that the branch has the expected
schema and data, with production untouched.

- A drill creates a **new child branch** and nothing else. It never restores
  in place and never changes an existing branch.
- Use the Neon console. Wording there may differ from this checklist; if a step
  is unclear, stop.

### Stop conditions

**Stop, change nothing more, and report if any of these is true.**

- **No durable #339 authorization naming restore point T and the branch name.**
- **T is outside the PITR window, or the window is unconfirmed.**
- **The branch-count limit or cost is unconfirmed.**
- **A console action would modify an existing branch instead of creating a new
  child, restore in place, change Render or Vercel settings, repoint, or
  deploy. Or the target is ambiguous.**
- **The branch cannot be told apart from production by name.**
- **`SHOW default_transaction_read_only;` does not return `on`.**
- **A check needs row contents or a dump.**
- **A migration of the deployed commit is missing on the branch,
  `DataProtectionKeys` is missing, or counts differ without an explained write.**
- **Any tool rejects the target** (for example the PostgreSQL test guard). Never
  weaken or bypass the rejection.
- **The connection string appears anywhere outside the shell session** (history,
  chat, ticket, screenshot, CI, log). Treat it as compromised. Rotating it needs
  separate owner authorization.
- **Branch deletion fails or would affect any other branch, or production
  changes in any way beyond the branch being created.**

### Before the drill

1. Post a durable comment on #339 with: restore point T (UTC), the branch name
   `restore-drill-YYYYMMDD`, who runs it, and a separate yes or no for:
   - baseline: production baseline reads and the production smoke GETs;
   - app check: the optional app check (below).
2. Link that comment in the facts table. Fill in the facts: plan, PITR window,
   branch limit and cost, each with where it was confirmed. Confirm T is inside
   the window.
3. Keep a private notes directory outside the repository for timings,
   per-table counts and the migration lists. The repository is public.
4. Keep the branch connection string only in the shell session. Split off the
   password so it never appears in `psql` process arguments (visible in process
   listings). Enter the string without its password with
   `read -r DRILL_DATABASE_URL`, then the password with
   `read -rs PGPASSWORD; export PGPASSWORD`. This also keeps both out of shell
   history. Never put either in chat, tickets, screenshots, CI, or a file in the
   repository.
5. If baseline is yes: run `scripts/smoke-deploy.sh --api <url> --web <url>` for a
   pre-state. It is GET-only and needs no credentials.

### Run

Record the UTC time at each step with `date -u +%FT%TZ`:

| Mark | Step |
| --- | --- |
| t0 | Drill starts |
| t1 | Branch creation requested |
| t2 | Console shows the branch ready |
| t3 | First connection succeeds (includes any cold start) |
| t4 | Schema checks (a), (d), (e) done |
| t5 | Counts and checksums (b), (c) done |
| t6 | Optional app check done |
| t7 | Branch deleted |

1. t1: in the console, create a new branch from the production branch at T.
   Before confirming, check it is a new child with the drill name and not the
   primary branch.
2. t2: wait until the console shows it ready.
3. Get the branch's own **direct (unpooled)** connection string. Enter it as in
   Before the drill step 4. Set the
   session options and run the gate:

   ```bash
   export PGOPTIONS='-c default_transaction_read_only=on -c TimeZone=UTC -c DateStyle=ISO,MDY'
   psql -X "$DRILL_DATABASE_URL" -c 'SHOW default_transaction_read_only;'
   ```

   t3 is when this connects. **Stop unless it prints `on`.** This is a safety
   net, not a security boundary: the branch still holds production data.
4. Run the checks below. Output must be counts, migration ids and hashes only.
   Never print rows. Never select columns from `DataProtectionKeys`.

### Checks

(a) Every migration of the deployed commit is in `__EFMigrationsHistory`.
Replace `<deployed-commit>` with the commit Render serves, `<repo-path>` with
the path of your clone and `<notes-dir>` with your private notes directory. The
`cd` keeps both files outside the repository; if it fails, stop. Extra ids on
the branch need an explanation (schema is applied before code).

```bash
cd <notes-dir> || return   # do not continue if cd fails
psql -X -At "$DRILL_DATABASE_URL" \
  -c 'SELECT "MigrationId" FROM "__EFMigrationsHistory"' \
  | LC_ALL=C sort > branch-migrations.txt
git -C <repo-path> ls-tree --name-only <deployed-commit> backend/Migrations/ \
  | grep -E '/[0-9]{14}_[A-Za-z0-9_]+\.cs$' | grep -v '\.Designer\.cs$' \
  | sed -E 's#.*/([0-9]{14}_[A-Za-z0-9_]+)\.cs#\1#' \
  | LC_ALL=C sort > commit-migrations.txt
diff commit-migrations.txt branch-migrations.txt
```

A line starting `<` is missing on the branch: stop.

(b) to (e), run through `psql -X -v ON_ERROR_STOP=1 "$DRILL_DATABASE_URL"`:

```sql
-- (b) exact row count per user table
SELECT format('SELECT %L AS table_name, count(*) AS row_count FROM %I.%I',
              tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename \gexec

-- (c) checksum of one owner-chosen table (repeat per table; NULL means empty)
SELECT md5(string_agg(t::text, E'\n' ORDER BY t::text)) AS table_md5
FROM public."BudgetLimits" AS t;

-- (d) index and constraint counts
SELECT 'indexes' AS what, count(*) AS n FROM pg_indexes WHERE schemaname = 'public'
UNION ALL
SELECT 'constraint ' || c.contype::text, count(*)
FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname = 'public' GROUP BY c.contype
ORDER BY 1;

-- (e) the Data Protection key ring exists and is not empty
SELECT to_regclass('public."DataProtectionKeys"') AS key_table;
SELECT count(*) AS key_rows FROM public."DataProtectionKeys";
```

- (c) hashes row text, so both sides must use the same `TimeZone` and
  `DateStyle` (the `PGOPTIONS` above). Choose small tables by name. Never
  checksum `DataProtectionKeys`.
- (e): stop if `key_table` is empty or `key_rows` is 0.
- Count differences are acceptable only when explained as writes after T.
  Record the difference as a count, never as rows.

### Optional: production baseline

Only if baseline is yes. Use production's **direct (unpooled)** connection
string, entered as in Before the drill step 4. Set the same `PGOPTIONS` and run
the read-only gate from Run step 3 first: **stop unless it prints `on`.** Then
run the same (b) to (e) queries read-only against production. Then unset the
production `DRILL_DATABASE_URL` and `PGPASSWORD` values. Enter the
branch's values again before using the branch. Exact equality needs T to be the
instant the baseline was taken: take the baseline first, then add its UTC time
as T in a follow-up #339 comment before creating the branch. Otherwise expect
differences from later writes and explain them as counts.

### Optional: app check

Default off. Only if app check is yes. Run it last (t6), after every other check,
because the app's own connection may not carry the read-only setting (whether
Npgsql honors `PGOPTIONS`, which stays exported until After the drill step 1, is
unverified) and the app could write to the branch.

- Run the backend locally in Development. Set these in the shell only. Never
  type the connection string into an `export` line: that puts the password in
  shell history. Enter it with
  `read -rs ConnectionStrings__DefaultConnection; export ConnectionStrings__DefaultConnection`
  (the branch, in Npgsql form), as in Before the drill step 4. Also set a
  throwaway `Jwt__Key` (for example `openssl rand -base64 48`).
- Startup validation requires these shell-only values. Use obvious dummy
  values and never real email credentials:
  - `EmailSettings__FromName`: non-empty.
  - `EmailSettings__FromEmail`: a valid email address, for example
    `drill@example.invalid`.
  - `GoogleEmail__ClientId`, `GoogleEmail__ClientSecret` and
    `GoogleEmail__RefreshToken`: non-empty.
  - `Frontend__BaseUrl`: an absolute http or https URL with no query or
    fragment, for example `http://localhost:5173`.
- Call `GET /health/ready` only and record the HTTP status. No sign-in, no other
  request. Never register, resend a confirmation, or use forgot-password.
- The branch holds a copy of production data, including the Data Protection
  key ring. Treat the connection string and the running process as production-sensitive.
  Stop the process as soon as the call returns.

### PostgreSQL test guard

The PostgreSQL integration tests accept only `localhost`, `127.0.0.1` or `::1`
with database `budget_planner_ci` or `budget_planner_test_*`, and they run
`EnsureDeleted` (`backend.Tests/Financial/PostgreSqlFinancialApiTestApplication.cs`).
Never point them, a CI job, or a CI secret at the branch. No allow-list, flag
or rename.

### After the drill

1. Close psql and stop the app. Unset `DRILL_DATABASE_URL`, `PGPASSWORD`,
   `PGOPTIONS`, `ConnectionStrings__DefaultConnection`, `Jwt__Key` and the
   dummy email and frontend values.
2. In the console, confirm the branch you are about to delete is the drill
   child and not the primary branch. Confirm no Render or Vercel setting
   references it.
3. t7: delete the branch. If it fails, **stop** and report.
4. If baseline is yes: rerun `scripts/smoke-deploy.sh --api <url> --web <url>` to
   show production is healthy.
5. Record results in a follow-up docs-only PR (below), then remove the local
   notes and migration files.

### Results

Empty until the owner runs a drill. Record match or mismatch and table totals
only. Per-table counts stay in the private notes.

| Step | UTC start | UTC end | Elapsed | Result |
| --- | --- | --- | --- | --- |
| Branch create to ready (t1 to t2) | | | | |
| First connection, cold start (t2 to t3) | | | | |
| Schema checks (t3 to t4) | | | | |
| Counts and checksums (t4 to t5) | | | | |
| App check, optional (t5 to t6) | | | | |
| Branch delete (t6 to t7) | | | | |

- Measured RTO (t0 to the last passing check): OWNER TO FILL IN
- RPO: take it from the branch point the Neon console reports for T, not from
  reading user timestamps. If a newest-record timestamp is used, record only the
  delta: OWNER TO FILL IN
- This measures a branch restore only. It excludes detection, the decision to
  restore, and cutover.

## Render rollback (backend)

Needs owner authorization. The backend rolls back by redeploying a previous
deploy.

1. Check migration compatibility first (ordering rules above).
2. In the Render dashboard, open the backend service, then Events or Deploys.
3. Pick the last known good deploy and choose to redeploy/roll back to it.
   Which previous deploys are available depends on the plan: OWNER TO FILL IN.
4. Wait for the deploy to report live. Confirm the deployed commit matches the
   intended one.
5. Run the post-incident checks.

Render Free has an ephemeral filesystem and no pre-deploy commands or one-off
jobs. Do not work around this by running migrations at startup.

## Vercel rollback (frontend)

Needs owner authorization. Use Instant Rollback.

1. In the Vercel dashboard, open the project and its Deployments list.
2. Pick the previous good production deployment and use Instant Rollback.
   Availability on the current plan: OWNER TO FILL IN.
3. Instant Rollback repoints the production alias without a rebuild. Vercel
   may turn off auto-assignment of new deployments to the production domain
   after a rollback. Check the project's current behavior and re-enable
   promotion only with authorization.
4. Confirm the production URL serves the expected deployment and source commit,
   as described in [`debugging.md`](debugging.md) section 7. A preview or
   GitHub deployment status alone does not prove the alias.
5. The frontend calls `/api/auth/web-session/*` through a Vercel rewrite to
   Render (see [`../ARCHITECTURE.md`](../ARCHITECTURE.md)). Check the frontend
   and backend versions are compatible after rolling only one of them back.

## Post-incident checks

Keep evidence privacy-safe per [`debugging.md`](debugging.md). Record method and
path, HTTP status, timing, response shape, aggregate counts, exact commit
hashes, and configuration key names. Never record values, tokens, cookies,
connection strings, emails, user IDs, amounts, dates, or statement content.

1. Record the deployed commit for Render and Vercel, and the intended commit.
   Find a failing request in the Render log by its `X-Request-Id`
   (see [`debugging.md`](debugging.md)): search the 16-hex ID from the response
   header or the `requestId` in the error body.
2. Check `__EFMigrationsHistory` matches the deployed backend commit.
3. Check the `DataProtectionKeys` table exists. Expect sign-ins and tokens to
   need reissue if the restore point predates the current keys.
4. Make one minimal, read-only, database-backed request with an authorized
   private test session. Confirm status and response shape only.
5. Check the frontend production URL loads and the changed route works.
6. Check aggregate row counts against expectations. Compare counts only.
7. Note data written after the restore point that was lost, as counts and a
   time range, not contents. Tell the owner.
8. Open a separately scoped issue for follow-up fixes or forward migrations.

## Release and rollback evidence

Record this in the change's issue or PR comment for every deploy and rollback.
Never record secrets, tokens in URLs, env values, connection strings, emails,
user IDs or amounts.

- UTC time, who ran it, and a link to the durable owner authorization.
- Backend commit SHA (Render) and frontend commit SHA plus Vercel deployment ID:
  intended and live.
- Migration state: latest `__EFMigrationsHistory` id before and after, the
  latest migration id in the commit, and any pre-check results as counts.
- Order followed: migrate, then backend, then frontend.
- Smoke: `scripts/smoke-deploy.sh` exit code and status codes. To confirm a new
  build is live, check that `X-Request-Id` is 16 lowercase hex or that an error
  body has `requestId`. The host edge may add its own `X-Request-Id`, so
  its presence alone proves nothing.
- Rollback target: previous Render deploy (SHA, time), previous Vercel
  deployment ID, and a yes/no "older app works with the current schema" with the
  migration ids.
- If a rollback was triggered: what was seen (smoke failure, readiness 503, 5xx
  rate) and the request IDs of sampled failures.

## Health, smoke and uptime alerts

- `GET /health` is liveness: no checks, no database. Keep Render's health check
  path on `/health` so a database blip does not restart the app.
- `GET /health/ready` is readiness: one `SELECT 1` with a 3 s timeout. It returns
  `200` or `503` with a fixed body (`status`, `checks.database`) and
  `Cache-Control: no-store`. It shows up/down only.
- Run `scripts/smoke-deploy.sh --api <url> --web <url>` after every deploy,
  rollback or restore. It is GET-only, needs no credentials, and prints URLs and
  status codes only. Exit 0 pass, 1 failed check, 2 usage error.
- Owner-created monitors (for example UptimeRobot or Better Stack free tier):
  - `/health/ready` every 5 minutes; alert after 2 consecutive failures.
  - The web origin on the same schedule.
  - Each tick wakes Neon, so do not poll faster than 5 minutes.
  - Creating monitors is an owner action; nothing here creates them.

## JWT signing-key rotation

Owner-run. Agents never generate, read or set a production key, never touch
Render, and never run the end-all-sessions step. Code and design:
[`auth-session-invariants.md`](auth-session-invariants.md) (JWT parameters).

How it works:

- `Jwt__Key` is the current key: it signs and validates.
- `Jwt__PreviousKey` is optional and validates only. It never signs. Unset
  (or empty) means normal single-key behavior.
- Access tokens last 2 h, plus about 5 min clock skew.
- Device and web session credentials are opaque database secrets, not JWTs, so
  rotation does not touch them. A refresh always returns a current-key token.
- With `Jwt__PreviousKey` set, startup fails if either key is under 32 bytes or
  the two keys are equal. That is deliberate.
- Confirm in Render that the variables are named `Jwt__Key` and
  `Jwt__PreviousKey`: OWNER TO FILL IN.
- Never put key values in chat, issues, PRs, logs or the repo. Record dates only.

### Planned rotation (no 401s)

Three deploys. One swap can 401 requests split across old and new instances,
and iOS signs out after two 401s in a row.

1. Generate a new key locally (for example `openssl rand -base64 48`).
2. Deploy 1: `Jwt__Key` = old key, `Jwt__PreviousKey` = new key. Every
   instance now accepts the new key. Signing is still with the old key.
3. Deploy 2: `Jwt__Key` = new key, `Jwt__PreviousKey` = old key. Start it
   only after Deploy 1 is fully live and the pre-Deploy-1 instance has stopped
   serving. Run the smoke script, then one private sign-in or refresh on web
   and iOS.
4. Wait at least 2 h 5 min counted from when the old instance stops serving
   (not from "live"). Prefer 24 h. Do not start another rotation before step 5.
5. Deploy 3: delete `Jwt__PreviousKey`. Run the smoke script again. Record the
   date in the facts table.

### Emergency rotation (key leaked)

1. Set `Jwt__Key` to a new key and delete `Jwt__PreviousKey`. Never put the
   leaked key in `Jwt__PreviousKey`. Deploy.
2. Once the new instance serves, every existing access token, forged ones
   included, gets 401. Web refreshes once through its cookie and retries. iOS
   refreshes once and signs out on a second 401. The old instance keeps
   accepting leaked-key tokens until it stops serving.
3. A key swap alone does not sign anyone out: sessions survive and refresh
   silently. To sign everyone out, also run the optional step below.
4. Run the smoke script. Record the date.

### End all sessions (optional, destructive)

Owner-run only, with fresh explicit owner authorization at the time. Take a
recovery point first (Neon branch, see the ordering rules).

- Mechanism: delete every `DeviceSessions` row (one table for native and web)
  and give every user a new security stamp. This is what a completed password
  reset does for one user. Existing access tokens then get 401 and clients go
  to sign-in. Outstanding confirm-email and reset-password links stop working
  too, because they embed the stamp.
- SQL, run on a production connection only by the owner:

  ```sql
  BEGIN;
  DELETE FROM "DeviceSessions";
  UPDATE "AspNetUsers" SET
    "SecurityStamp" = replace(gen_random_uuid()::text, '-', ''),
    "ConcurrencyStamp" = gen_random_uuid()::text;
  COMMIT;
  ```

- Verified only on a disposable local PostgreSQL 16 with synthetic data (3
  sessions, 2 users): 0 sessions left, 2 users kept, both security and
  concurrency stamps replaced.
  Not run against the API or any hosted database.

### If a deploy will not start after an env change

- A short, equal or otherwise bad previous key stops the app on purpose.
  Restore the previous env values at once.
- Render's behavior on a failed start and on env saves is unverified:
  OWNER TO FILL IN.
- Code rollback: revert the PR. Older code ignores `Jwt__PreviousKey`, so
  previous-key tokens get 401 and clients refresh once.

## Not covered

- Anonymous `/health` (liveness) and `/health/ready` (readiness) are done.
  Telemetry, deployment workflows and authenticated smoke remain separate
  ROADMAP E1/E4 work. Monitors must be created by the owner.
- Restore drills have not been run. A checklist exists
  ([Restore drill](#restore-drill-owner-run)), but no drill has been run and
  its results table is empty. RTO and RPO are unset. A drill needs its own
  durable owner authorization on
  [#339](https://github.com/OL1V3S/ordo/issues/339).
