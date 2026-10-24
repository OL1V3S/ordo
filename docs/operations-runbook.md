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

## Not covered

- A basic anonymous `/health` liveness endpoint is done (PR #304). Readiness and
  database checks, alerts, telemetry, automated smoke, and deployment workflows
  remain separate ROADMAP E2/E1/E4 work.
- Restore drills have not been run. A drill needs its own owner authorization
  and issue.
