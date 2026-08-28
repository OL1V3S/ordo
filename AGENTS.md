# Ordo Agent Instructions

## Purpose

This repository uses AI-assisted software engineering with human approval at risk-sensitive boundaries.

Agents should optimize for:

- correctness;
- small, reviewable changes;
- preservation of existing behavior unless a task explicitly changes it;
- strong automated verification;
- clear GitHub history;
- minimal unrelated churn.

## Repository structure

- `frontend/` — React + Vite frontend
- `backend/` — ASP.NET Core backend
- `backend.Tests/` — backend test suite
- `.github/workflows/` — CI workflows

## Canonical repository knowledge

Use this file as the concise operational entry point, then read only the
sources relevant to the task:

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — current system boundaries, module organization,
  dependency direction, and planned extension points;
- [`ROADMAP.md`](ROADMAP.md) — engineering priorities, sequencing, and dependencies;
- [`docs/financial-domain-invariants.md`](docs/financial-domain-invariants.md) — approved financial semantics and
  decisions that require explicit human approval to change;
- [`docs/verification.md`](docs/verification.md) — canonical commands, required evidence, environment
  fallbacks, and review-ready criteria;
- [`docs/debugging.md`](docs/debugging.md) — privacy-safe diagnostic sequence and supplemental
  smoke-check guidance;
- the applicable GitHub Issue — task-specific scope and acceptance criteria.

Do not treat planned roadmap behavior as current architecture or executable
behavior.

## Project continuation and task resolution

Conversation memory, project summaries, and prior-chat context may provide
useful hints, but they are not authoritative for current execution state. Live
GitHub and repository state override them when they conflict.

When asked to **“Continue Ordo”** or **“Where are we?”**, reconstruct
current state before declaring current work, in this order:

1. current `main` and the latest merged repository state;
2. open pull requests;
3. open GitHub issues;
4. recent merged pull requests and their linked issues;
5. `ROADMAP.md` and other applicable canonical repository documents.

Then report what most recently completed, whether any work is currently active,
what roadmap or product decision is next to consider, and any unresolved
approval or cleanup state.

Never select a closed or merged issue as current work merely because prior
conversation context names it.

When asked to **“Work on the next task”**, resolve executable work in this order:

1. an explicitly attached or current GitHub issue;
2. an issue number explicitly named by the human;
3. durable GitHub or repository state that explicitly designates an active or
   next issue.

If none of those selects executable work, stop and enter product/planning mode
with the human instead of choosing a roadmap item autonomously. Product planning
and engineering execution remain distinct. `ROADMAP.md` is an engineering
roadmap, not a product backlog or automatic execution queue.

These continuation rules do not change existing risk approvals, verification
requirements, publication rules, production-operation authority, or human merge
authority.

## General workflow

### New work

When starting a new issue or change:

1. Fetch current `origin/main`.
2. Start from an up-to-date `main`.
3. Confirm the worktree is clean.
4. Create a fresh feature branch.
5. Inspect the relevant code and tests before editing.
6. Identify the risk level of the task.

If unexpected tracked or untracked changes exist before starting new work, stop and report them.

Do not automatically stash, reset, clean, discard, or overwrite unexpected work.

### Existing PR follow-up

When addressing review feedback or continuing work on an existing draft PR:

1. Remain on the existing PR branch.
2. Confirm the branch and worktree state match the expected PR.
3. Inspect the review finding and affected code.
4. Make only the smallest correction required.
5. Rerun affected verification.
6. Commit and push to the existing PR branch.

Do not create a new branch for ordinary review corrections.

Do not rebase or merge `main` into an existing PR branch unless explicitly requested or required to resolve a known integration problem.

### Post-merge branch lifecycle

Review corrections stay on the existing feature/PR branch until merge. Keep a
feature branch until GitHub confirms that its PR is merged and the associated
work is complete.

After that confirmation, delete the merged remote feature branch when the
current environment and tooling permit the target and merge state to be
verified safely. Never delete `main`, the default branch, a protected branch, a
branch with an open or unmerged PR, or a branch containing unmerged work.
Prefer remote cleanup after merge; local stale branches may be removed later
when local Git tooling is available.

If deletion cannot be performed or verified safely, do not guess and do not
block the already-approved merge. Report that remote branch cleanup remains
required. Human merge authority remains unchanged.

### General safety

Do not modify unrelated files.

Do not use destructive git operations unless explicitly authorized.

Prefer exact-path staging over `git add .` or `git add -A`.

### Implementation and publication capabilities

Treat local implementation capability and GitHub publication capability as
separate concerns.

Before editing, establish the branch and worktree state safely. If local Git or
an equivalent repository tool cannot establish that state, stop and report the
missing evidence. Do not edit based on a guessed branch or worktree state.

When implementation is authorized and safe local Git operations are available,
missing GitHub CLI (`gh`) alone does not block implementation. The agent may
create the approved feature branch, edit, run available verification, inspect
the diff, and create an intentional local commit.

Push and draft-PR creation require working publication tooling and
authentication. If either cannot be completed, stop at the safest durable local
state, normally a clean local commit, and report **publication handoff
required**. Include the branch, commit SHA, changed files, verification that
passed or was unavailable, and the exact remaining publication steps. The human
repository owner may publish the branch with GitHub Desktop and open the draft
PR through GitHub Desktop or the GitHub web interface.

Never claim that a push, PR, or CI result exists unless it has been verified.
Publication handoff does not weaken the requirement for a draft PR, successful
required CI, independent review, or human merge authority.

## Risk levels

### LOW

Examples:

- tests;
- copy changes;
- isolated styling;
- mechanical moves or renames;
- small accessibility fixes;
- small repository-maintenance changes.

Agent authority:

- inspect;
- implement;
- test;
- commit;
- push;
- open a draft PR.

No separate implementation approval is required unless the task reveals unexpected risk.

### MEDIUM

Examples:

- new feature behavior;
- meaningful frontend state changes;
- API consumption changes;
- cross-feature refactors;
- new user workflows.

Agent authority:

1. inspect;
2. produce a concise implementation plan;
3. stop for approval;
4. after approval, implement;
5. verify;
6. commit;
7. push;
8. open a draft PR.

### HIGH

Examples:

- authentication or authorization;
- security-sensitive behavior;
- database schema changes;
- EF Core migrations;
- production configuration;
- secrets;
- destructive data operations;
- financial/business-rule semantic changes;
- deployment or migration procedures.

Agent authority:

1. inspect only;
2. produce a plan, risks, rollback considerations, and verification plan;
3. stop for explicit human approval before implementation.

High-risk production operations require separate explicit authorization.

Never perform a production migration or destructive production action merely because implementation is complete.

## Behavioral preservation

Existing tests and characterization tests are evidence of current behavior.

Do not opportunistically fix unrelated quirks during a refactor.

If a task is intended to preserve behavior:

- preserve payload shapes;
- preserve state transitions;
- preserve API contracts;
- preserve date semantics;
- preserve normalization behavior;
- preserve error behavior unless explicitly changed.

If existing behavior appears incorrect but is outside task scope, report it instead of silently changing it.

## Frontend verification

From the repository root, run the canonical frontend lane:

```bash
./scripts/verify.sh frontend
```

For the normal repository-wide local checks, run:

```bash
./scripts/verify.sh
```

Any new or changed behavior should have appropriate tests.

A refactor intended to preserve behavior should keep existing assertions unless the task explicitly authorizes semantic change.

## Backend verification

For backend-affecting changes, run `./scripts/verify.sh backend` and any
additional applicable lane documented in `docs/verification.md`.

At minimum, before a backend-affecting PR is review-ready, confirm the full
applicable backend test suite passes locally or through required CI evidence.

Do not create or apply EF Core migrations unless the issue explicitly authorizes a schema change.

## Verification evidence and environment capabilities

Follow `docs/verification.md`. At the start of work, determine which required
tools and local services are actually available. Report each relevant result
as passed locally, not run locally because a capability is unavailable, or
required/proven by CI. Never report unavailable verification as passed.

A draft PR may be published with disclosed local verification gaps when the
risk workflow permits it. It is not review-ready until all required executable
CI evidence has succeeded and remaining gaps are disclosed.

Do not use Neon, Render, production, or another hosted database as a substitute
for unavailable local PostgreSQL test infrastructure. Use the repository's
PostgreSQL CI lane.

## Harness improvement

When an agent failure reveals a recurring or important weakness, prefer the
smallest appropriate durable harness improvement over indefinite prompt
reminders, in this order:

1. mechanical prevention or check when practical;
2. automated verification or test;
3. durable repository instruction;
4. one-off prompt reminder only for genuinely task-specific concerns.

Do not add automation solely to satisfy this principle. The existing
PostgreSQL integration-test guard, which rejects remote and non-disposable
database targets, is an example of mechanical prevention.

## Dependencies

Do not add or upgrade dependencies unless needed for the task.

If a dependency change is required:

- explain why;
- identify alternatives considered;
- include lockfile changes;
- verify the resulting build.

## Secrets and configuration

Never commit:

- secrets;
- tokens;
- credentials;
- production connection strings;
- private keys.

Use existing environment/configuration mechanisms.

## Draft pull requests

Normal agent-created PRs should begin as draft PRs.

PRs should include:

- summary;
- issue reference;
- risk classification;
- important implementation details;
- verification performed;
- explicit scope boundaries;
- migration/API/dependency impact if applicable.

Do not merge pull requests.

Merge authority remains with the human repository owner after CI and independent review.

## Review and correction

Once a draft PR exists, the PR itself is the primary review artifact.

Do not create temporary review-packet files unless specifically requested.

If review identifies a problem:

1. make the smallest appropriate correction;
2. rerun affected verification;
3. push to the existing branch;
4. report what changed.

Do not hide or dismiss review findings.

## Scope control

If implementation requires work outside the authorized issue:

1. stop;
2. explain why;
3. propose the smallest scope adjustment.

Do not silently expand into adjacent roadmap work.

## ChatGPT command center and local Codex execution

The normal Ordo engineering workflow uses **local Codex in the
ChatGPT desktop app**, authenticated with the repository owner's ChatGPT
account, as the repository execution agent. GitHub remains the durable source
of truth for task scope, pull requests, CI evidence, and merge state.

Do not assume that an API-key GitHub Actions Codex bridge is the normal
execution path. Repository engineering should not require `OPENAI_API_KEY` or a
publisher GitHub App unless a future issue explicitly authorizes a different
integration.

The human and ChatGPT are the product/engineering command center. They own:

- product discussion and priority;
- selecting or creating the governing GitHub Issue;
- resolving ambiguity and defining acceptance criteria;
- risk classification and required approvals;
- recording durable plan/approval state when MEDIUM/HIGH gates require it;
- independent review of the resulting GitHub PR and CI evidence.

Codex owns repository engineering execution after that authority is established:

- inspect the local checkout;
- plan when the risk gate requires a plan;
- implement within the authorized scope;
- run available verification;
- create intentional commits;
- push the feature/PR branch and open a draft PR when publication tooling is
  available;
- address bounded review corrections on the existing PR branch.

The human repository owner remains the sole merge authority.

### Minimal human handoff

The human should not act as a prompt/message bus between ChatGPT and Codex.
Product decisions, constraints, acceptance criteria, and approvals belong in the
GitHub Issue and canonical repository documents so Codex can retrieve them from
durable state.

For an already-authorized task, the normal Codex handoff should be no more than
an issue reference, for example:

```text
Work on Ordo issue #57. Follow AGENTS.md and the issue exactly.
```

For MEDIUM/HIGH work that has not yet passed its approval gate, use the same
issue-reference handoff for inspection/planning only. After the human approves
the plan and ChatGPT records that approval durably on the governing issue, the
implementation handoff may be similarly short, for example:

```text
Implement the approved plan for Ordo issue #57. Follow AGENTS.md and the issue exactly.
```

If Codex cannot retrieve the governing issue or required authority document,
stop and report that access gap rather than asking the human to reconstruct the
task from memory or guessing the missing scope.

### Repository Context Pruning

Use **pruned by default, expand only with a concrete reason** even though local
Codex has a full repository checkout.

At the start of inspection/planning:

1. read `AGENTS.md`, the governing issue, and only the canonical authority docs
   relevant to that task;
2. use `.github/scripts/build_repo_map.py` when a structural overview would help
   locate the narrow implementation boundary without reading raw files broadly;
3. inspect the exact files/symbols most likely to own the requested behavior;
4. expand to additional files only when a concrete dependency, contract, call
   path, test boundary, security rule, or financial invariant requires it;
5. record material context expansions and their reasons in the plan/final report.

Do not perform broad raw-repository scans merely for convenience. Do not read
large generated files or lockfiles unless the task specifically requires them.
If the targeted context is insufficient, request or inspect the smallest
specific additional path/symbol needed rather than silently broadening scope.

A lightweight structural map can be generated locally with:

```bash
python3 .github/scripts/build_repo_map.py --root . --output /tmp/ordo-repo-map.txt
```

The map is navigation context only; canonical repository files and executable
behavior remain authoritative.

### Credit-aware execution

When the active Codex environment exposes a choice of agent, model, subagent,
or reasoning level, start with the least expensive option reasonably capable
of the task and escalate deliberately when the work demonstrates a need for
more capability. Use lighter execution for narrow discovery, repository
navigation, mechanical edits, formatting, simple tests, and bounded
verification. Apply context pruning, targeted searches, repository maps, and
durable task artifacts before increasing capability merely to compensate for
oversized or repeatedly replayed context.

Match capability to risk and ambiguity, not only task size:

- LOW mechanical work should default to cheaper adequate execution;
- MEDIUM work may begin with a balanced option, but architectural ambiguity,
  cross-boundary reasoning, or repeated uncertainty should trigger escalation
  for planning and synthesis; and
- HIGH work involving security, authentication, financial semantics,
  migrations, production configuration, destructive operations, or deployment
  must prioritize correctness and use the strongest appropriate available
  capability when a choice exists.

When supported safely, delegate bounded search, test, mechanical, or
verification subtasks to cheaper adequate subagents. Reserve stronger
capability for synthesis, architecture, difficult debugging, security and
financial reasoning, approval-gate plans, and final integration or review when
warranted. Delegation never broadens repository context, issue scope, or
authority.

One bounded retry or correction may be reasonable for an incidental failure.
When failure instead demonstrates a capability or ambiguity limit, escalate to
a stronger appropriate option rather than repeatedly retrying an inadequate
one. Record material escalations and their reasons in the plan or final report
when they materially affected execution.

Credit efficiency never weakens issue scope, context pruning, MEDIUM/HIGH
approval gates, security/privacy/financial invariants, required tests or CI,
independent PR review, migration/deployment/production-operation approvals, or
human merge authority. Correctness and those controls always take precedence.

If the environment cannot programmatically select an agent, model, subagent, or
reasoning level, do not claim a switch occurred and do not treat the missing
control as a blocker. Apply the controllable parts of this policy instead:
pruned context, concise prompts, bounded delegation where available, targeted
verification, durable GitHub and repository artifacts, and avoidance of
redundant retries.

### Risk approvals in the local-Codex workflow

LOW work may proceed after the task is explicitly selected under the LOW
authority above.

For MEDIUM work, Codex must inspect and produce the concise plan required by the
risk gate, then stop. Implementation begins only after explicit human approval.

For HIGH work, Codex must inspect only and provide the required plan, risks,
rollback considerations, and verification plan, then stop. Implementation
begins only after explicit human approval. A separate explicit authorization is
still required for production migrations or other high-risk production
operations.

For every MEDIUM/HIGH planning-only run, Codex must publish the completed plan
as a top-level comment on the governing GitHub Issue before stopping for
approval when issue-comment publication is available. The comment must include
the information required by the applicable risk gate and issue, such as the
implementation and verification plans, material context expansions, risks,
rollback considerations, and requested human decisions.

The planning comment is a durable planning artifact, not implementation
authority. Publishing it does not authorize repository edits, branch creation,
commits, pushes, pull requests, migrations, production access or operations,
deployment, or merge. Implementation still requires the existing explicit
approval and short implementation handoff.

If issue-comment publication is unavailable, Codex must stop and report a
**planning-publication capability gap**, identifying the governing issue and
the unavailable capability. It must not silently leave the workflow appearing
ready, create an implementation artifact as a substitute, or ask the human to
relay the full plan manually. The command center may then restore direct
publication capability or deliberately select the smallest explicit fallback.

When ChatGPT is acting as command center, it should record the approved plan and
human approval on the governing GitHub Issue before sending the short
implementation handoff. A materially changed plan, changed financial/security
semantics, or broadened scope requires renewed approval rather than inheriting
an earlier approval by implication.

### Local execution and GitHub publication

Local execution does not make the work local-only. The intended publication
path is:

```text
local Codex checkout
-> feature/PR branch
-> intentional commit(s)
-> push branch to GitHub
-> draft pull request
-> independent GitHub CI
-> ChatGPT review of actual PR + CI
-> human merge
```

Codex must never push directly to `main`, merge a pull request, deploy, apply a
production migration, or perform destructive production/data operations.

If Codex can safely authenticate to GitHub, it may push the approved branch and
open the draft PR itself. If push or PR tooling is unavailable, stop at a clean
local commit and use the existing **publication handoff required** fallback.
GitHub Desktop/web publication is an acceptable fallback; it does not weaken CI,
review, or merge requirements.

### Independent review and corrections

Codex's local test/build results are development evidence, not the independent
proof layer. Existing applicable Frontend, Backend, PostgreSQL, Vercel, and
other repository CI checks remain authoritative for review-ready status.

After the draft PR exists and required CI succeeds, ChatGPT should inspect the
actual PR diff, review discussion, and CI state rather than accepting Codex's
summary as proof.

If ChatGPT or another reviewer finds a bounded defect, Codex should remain on
the existing PR branch and make only the smallest correction required. The
short handoff may reference the PR/review finding instead of restating the
entire task. Scope-expanding corrections return to normal planning and approval.

Human review and merge authority remain unchanged.
