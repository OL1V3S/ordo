# Verification Contract

## Purpose

This document is the canonical source for proving repository changes correct.
Required evidence depends on the files and behavior changed, not merely on
which commands happen to be available locally.

Record verification using these exact evidence states:

- **Passed locally** — the command ran successfully in the current workspace.
- **Not run locally — capability unavailable** — the required tool or service
  was unavailable; this is a disclosed evidence gap, not a pass.
- **Required/proven by CI** — name the required GitHub Actions job and record
  its result when known.

Focused checks support iteration. They do not replace the full applicable
verification required before a pull request is review-ready.

## Root verification entry point

From the repository root, the canonical entry point is:

```bash
./scripts/verify.sh
```

The default runs the frontend and non-PostgreSQL backend lanes. The script
supports Bash on macOS, Linux, and Windows through WSL or Git Bash. It exposes
these explicit lanes without hiding their underlying commands:

```bash
./scripts/verify.sh frontend
./scripts/verify.sh backend
./scripts/verify.sh postgresql
./scripts/verify.sh container
./scripts/verify.sh all
```

`container` requires Docker. `postgresql` requires
`BUDGETPLANNER_POSTGRESQL_TEST_CONNECTION` to target an approved disposable
local PostgreSQL database. `all` runs every lane and fails when either required
capability is unavailable. Use `./scripts/verify.sh --dry-run all` to inspect
the lane composition without executing it.

## Frontend verification

The canonical frontend lane is:

```bash
./scripts/verify.sh frontend
```

The lane runs `npm ci`, then `npm run verify` from `frontend/`. The npm script
runs the Vitest suite, ESLint, and the Vite production build.
After dependencies are already installed and unchanged, `npm ci` need not be
repeated for every iteration.

Focused tests may be run during development, for example:

```bash
cd frontend
npm test -- src/path/to/changed.test.jsx
```

Before review-ready status, frontend changes require the complete
`npm run verify` result and successful **Frontend test, lint, and build** CI
evidence.

## Backend verification

Run the same non-PostgreSQL verification represented by Backend CI:

```bash
./scripts/verify.sh backend
```

Focused `dotnet test` filters may be used while iterating. Before review-ready
status, backend changes require the applicable full suite and successful
**Backend build and tests** CI evidence.

## PostgreSQL integration verification

Changes affecting EF Core mappings, migrations, financial persistence,
relational queries, constraints, precision, timestamps, indexes, transactions,
or concurrency also require the PostgreSQL lane.

Local execution requires PostgreSQL and an isolated disposable local database.
Set `BUDGETPLANNER_POSTGRESQL_TEST_CONNECTION` to a connection using
`localhost`, `127.0.0.1`, or `::1`, with database `budget_planner_ci` or a name
beginning with `budget_planner_test_`. The tests deliberately delete and
recreate that database.

```bash
./scripts/verify.sh postgresql
```

The test harness mechanically rejects remote hosts and database names not
explicitly designated as disposable. Never substitute Neon, Render,
production, or another hosted database when local PostgreSQL is unavailable.
Use successful **PostgreSQL financial integration** CI evidence instead.
This job runs on every pull request and is required repository evidence; do not
add path filters that could silently skip persistence-relevant changes.

## Container verification

The production backend publish, contained PDF worker, and Docker artifact checks
are available through:

```bash
./scripts/verify.sh container
```

Docker verification is intentionally excluded from the default local lane due
to its capability and runtime cost. **Backend build and tests** CI runs it on
every pull request.

## Debugging and smoke checks

Smoke checks are small, changed-boundary behavior checks. They help diagnose a
change but never replace the applicable root verification lanes, CI, review, or
approval gates. Follow [`debugging.md`](debugging.md) for the canonical
privacy-safe diagnostic sequence and local/preview/production smoke boundaries.

## Documentation-only changes

For changes limited to documentation or repository instructions:

- inspect every changed file and the complete diff;
- confirm referenced repository paths and relative Markdown links exist;
- verify commands and CI job names against the current executable definitions;
- run `git diff --check` when Git is available; and
- allow the repository's normal pull-request CI to detect unintended effects.

Documentation-only work does not require inventing runtime tests. If normal CI
runs for the PR, its required jobs must still succeed before review-ready
status.

## Restricted workstation fallback

At the beginning of work, distinguish three capability groups:

- **Implementation capability** — safely inspect the branch and worktree, edit,
  review the diff, and create a local commit.
- **Publication capability** — push the branch and create a draft pull request.
- **Executable verification capability** — run npm/Node.js, the .NET SDK, and a
  disposable local PostgreSQL database when relevant.

Missing one capability does not prove that another is missing.

- If npm is unavailable, report frontend verification as **Not run locally —
  capability unavailable** and require Frontend CI when relevant.
- If .NET is unavailable, report backend verification the same way and require
  Backend CI when relevant.
- If local PostgreSQL is unavailable, report it and require the PostgreSQL CI
  lane; do not use a hosted or production substitute.
- If Git CLI is unavailable, do not claim local branch, worktree, diff, or
  `git diff --check` evidence. Use GitHub Desktop or connected GitHub evidence
  where it can establish the fact, and disclose anything still unverified.
- If `gh` is unavailable but safe local Git operations work, implementation may
  continue after the applicable risk approval. Missing `gh` alone is not an
  implementation blocker.
- If push authentication or draft-PR tooling is unavailable, create a clean
  local commit when authorized and report **publication handoff required**.
  Include the branch, commit SHA, changed files, verification evidence and
  gaps, and the remaining human steps. GitHub Desktop may publish the branch;
  GitHub Desktop or the GitHub web interface may then open the draft PR.

The supported split workflow is:

```text
agent implementation + clean local commit
-> human GitHub Desktop/web publication
-> required CI evidence
-> independent review
-> human merge
```

A local commit is durable implementation evidence. It is not evidence that the
branch was pushed, a PR exists, or CI ran. Never fabricate those states.

A draft PR may be published with disclosed local gaps when `AGENTS.md` permits
it. Missing local tools do not weaken the verification requirement and must
never be recorded as a pass.

## Local Codex execution evidence

Ordo's normal AI implementation agent is local Codex in the ChatGPT
desktop app, operating on a local Git checkout under the authority described in
`AGENTS.md` and the governing GitHub Issue.

Local Codex output is development evidence. It is not an independent substitute
for GitHub CI, PR review, or human merge authority.

### Task/authority evidence

Before implementation, establish and record:

- the governing GitHub Issue and its current scope/acceptance criteria;
- the risk classification;
- the exact current base branch/commit used for new work;
- the applicable canonical authority documents;
- any MEDIUM/HIGH plan and explicit human approval required by `AGENTS.md`.

For MEDIUM/HIGH work coordinated through ChatGPT, the plan and human approval
should be recorded durably on the governing issue before implementation begins.
A materially changed plan, broadened scope, changed financial/security semantic,
or stale/changed prerequisite does not silently inherit an earlier approval.

### Context-pruning evidence

Local Codex has access to a full checkout, but repository inspection remains
**pruned by default, expand only with a concrete reason**.

When useful, Codex may generate the lightweight structural map with:

```bash
python3 .github/scripts/build_repo_map.py --root . --output /tmp/ordo-repo-map.txt
```

The expected inspection sequence is:

1. `AGENTS.md` + governing issue + task-relevant canonical authority docs;
2. structural map when useful for navigation;
3. exact targeted files/symbols owning the requested behavior;
4. the smallest additional paths required by concrete dependencies discovered
   during inspection/implementation.

Plans and final implementation reports should identify the main files inspected
and record material context expansions with a short reason. Do not treat a broad
repository scan as stronger evidence merely because more files were read.

### Local implementation evidence

For implementation or bounded review correction, report:

- local branch/ref and starting base when verified;
- files changed;
- focused/full commands actually run and their exact pass/fail state;
- required commands that could not run locally and why;
- material context expansions beyond the initially targeted area;
- resulting local commit SHA when a commit was created;
- remaining risks/gaps;
- whether the branch was pushed and whether a draft PR was actually created.

Never record Codex's statement that tests passed unless the corresponding
command was actually executed successfully in the prepared local environment.

### GitHub publication and independent proof

The intended path is:

```text
local Codex implementation
-> feature/PR branch + commit
-> push to GitHub
-> draft pull request
-> applicable GitHub CI
-> ChatGPT independent PR/diff/CI review
-> human merge
```

If local Codex can authenticate safely to GitHub, it may push the approved
feature/PR branch and create the draft PR. If not, use the existing
**publication handoff required** fallback with GitHub Desktop/web. Neither path
allows a direct push to `main` or automatic merge.

The resulting draft PR requires **Frontend test, lint, and build**, **Backend
build and tests**, and **PostgreSQL financial integration** to succeed. Vercel
and Vercel Preview Comments are non-blocking preview/deployment evidence; record
them when relevant to frontend or deployment review, but do not treat them as
canonical test gates. Local Codex results support iteration but never replace
independent checks.

After CI succeeds, ChatGPT should inspect the actual PR diff, review discussion,
and current CI state. A Codex-generated summary is not sufficient proof of the
final branch contents.

### Review corrections

For a bounded review finding, remain on the existing PR branch, make the
smallest correction, rerun affected verification, push the updated branch, and
re-check CI. Scope-expanding corrections return to normal task planning and
approval.

### Credential boundary

The local-Codex workflow does not require repository `OPENAI_API_KEY` or a
publisher GitHub App. Never commit ChatGPT credentials, Codex auth state, API
keys, GitHub tokens, private keys, or other secrets. Local authentication state
must remain outside the repository.

## Full review-ready criteria

A draft PR is review-ready only when:

- the verification appropriate to the changed scope is identified;
- every local result and unavailable capability is reported accurately;
- all required Frontend CI, Backend CI, and PostgreSQL CI jobs have succeeded;
- remaining verification gaps are disclosed;
- the complete diff has been inspected for scope and unintended changes; and
- MEDIUM/HIGH approvals and all other `AGENTS.md` gates are satisfied.

Human review and merge authority remain unchanged.
