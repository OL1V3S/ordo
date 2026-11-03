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

| Fact | Value |
| --- | --- |
| Neon plan tier | OWNER TO FILL IN |
| Neon point-in-time restore (PITR) retention window | OWNER TO FILL IN |
| Neon project and production branch names | OWNER TO FILL IN |
| Neon automated snapshot/backup schedule, if any | OWNER TO FILL IN |
| Render service name and plan | OWNER TO FILL IN |
| Number of previous Render deploys kept and rollbackable | OWNER TO FILL IN |
| Vercel project name and production alias | OWNER TO FILL IN |
| Who holds Neon, Render, and Vercel admin access | OWNER TO FILL IN |
| Target recovery time and acceptable data loss | OWNER TO FILL IN |
| Last JWT key rotation date (date only, never values) | OWNER TO FILL IN |

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
and available features depend on the plan: OWNER TO FILL IN.

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
5. Delete the branch when finished, if the plan bills or limits branches.

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

## Verifying a restore without touching production

- Restore to a branch (above), never over production, to test a recovery.
- Point a disposable local or CI environment at the branch connection string
  only if the owner authorizes that connection. Otherwise stop and report.
- Never use Neon, Render, production, or another hosted database as a
  substitute when a local PostgreSQL is unavailable
  ([`debugging.md`](debugging.md), [`verification.md`](verification.md)).
- For local verification, use a disposable local PostgreSQL with synthetic
  data and `./scripts/verify.sh postgresql`.
- Inspect schema state, `__EFMigrationsHistory` IDs, and aggregate row counts.
  Do not read or publish row contents.

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
3. Deploy 2: `Jwt__Key` = new key, `Jwt__PreviousKey` = old key. Run the smoke
   script, then one private sign-in or refresh on web and iOS.
4. Wait at least 2 h 5 min counted from when the old instance stops serving
   (not from "live"). Prefer 24 h. Do not start another rotation before step 5.
5. Deploy 3: delete `Jwt__PreviousKey`. Run the smoke script again. Record the
   date in the facts table.

### Emergency rotation (key leaked)

1. Set `Jwt__Key` to a new key and delete `Jwt__PreviousKey`. Never put the
   leaked key in `Jwt__PreviousKey`. Deploy.
2. Every existing access token, forged ones included, now gets 401. Web
   refreshes once through its cookie and retries. iOS refreshes once and signs
   out on a second 401.
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
  UPDATE "AspNetUsers" SET "SecurityStamp" = replace(gen_random_uuid()::text, '-', '');
  COMMIT;
  ```

- Verified only on a disposable local PostgreSQL 16 with synthetic data (3
  sessions, 2 users): 0 sessions left, 2 users kept, both stamps replaced.
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
- Restore drills have not been run. A drill needs its own owner authorization
  and issue.
