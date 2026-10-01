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

- [`PRODUCT_OVERVIEW.md`](PRODUCT_OVERVIEW.md) — concise human introduction to
  Ordo's current shipped capabilities and product boundaries;
- [`RECENT_CHANGES.md`](RECENT_CHANGES.md) — rolling history of recent meaningful
  merged changes; GitHub remains the complete archive;
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
requirements, publication rules, or the approved delivery and exceptional
production-operation authority defined below.

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
required. Branch cleanup does not broaden approved delivery authority.

### General safety

Do not modify unrelated files.

Do not use destructive git operations unless explicitly authorized.

Prefer exact-path staging over `git add .` or `git add -A`.

### Product documentation maintenance

For meaningful implementation work, update `RECENT_CHANGES.md` in the same PR
when appropriate. Record changes at the merged-PR level, not per commit or
bounded correction. Keep entries newest-first and capped at 20, removing the
oldest when adding entry 21. Follow the entry format in that file; trivial
typo-only, formatting-only, or mechanical work with no meaningful effect needs
no entry. Do not backfill history: completed UX V3 work governed by #127 creates
the first real entry.

Update `PRODUCT_OVERVIEW.md` only when shipped high-level product capabilities
or positioning materially change. Routine fixes and refactors may warrant a
recent-changes entry without an overview edit. Never present planned behavior
as shipped behavior in the overview.

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
required CI, independent review, or authorized merge execution.

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

After a LOW task is explicitly selected, command-center tooling may
execute its merge only after required CI succeeds on the actual final PR head,
independent command-center PASS review is recorded, and no unresolved blocking
findings remain. Selecting a LOW task alone does not authorize merge or
deployment. An implementation agent must never self-approve or self-merge.

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

Durably recorded explicit owner approval authorizes the approved slice through
the delivery process below, including independent review, bounded corrections,
authorized merge, and ordinary non-destructive application deployment.

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
- new or materially changed deployment or migration procedures.

Agent authority:

1. inspect only;
2. produce a plan, risks, rollback considerations, and verification plan;
3. stop for explicit human approval before implementation.

After explicit owner approval is durably recorded, the same approved delivery
authority below applies. Exceptional production operations remain separately
gated.

Never perform a production migration or destructive production action merely because implementation is complete.

## Approved delivery authority

The human remains the product owner and approval authority for product priority,
scope, MEDIUM/HIGH plans, and exceptional production operations. An exact
MEDIUM/HIGH plan with durable owner approval on the governing GitHub Issue
authorizes that slice through the delivery steps below. Explicit limits or
exclusions in the issue or owner approval remain binding. For explicitly
selected LOW work, only the gated merge permission in the LOW section applies;
it does not add deployment authority.

The approved delivery steps are:

- implementation, commits, publication, and a draft PR;
- required local and CI verification;
- independent review of the actual PR, diff, discussion, and CI evidence;
- bounded review corrections and affected verification;
- merge after required checks succeed on the actual final PR head, independent
  command-center PASS review is recorded, and no unresolved blocking findings
  remain;
- ordinary non-destructive application deployment when available authorized
  tooling supports it and deployment introduces no new authority decision.

No additional approval is needed merely to advance between those delivery
steps. Required CI and independent review must succeed on the final changes
before merge; implementation-agent results or summaries cannot replace
them. Privacy, security, financial invariants, and issue/plan scope remain
mandatory. This section governs delivery authority; supporting verification
documents continue to govern required evidence.

For explicitly selected LOW work, command-center tooling may execute
only the gated merge step described in the LOW section. For an approved
MEDIUM/HIGH slice, command-center tooling may merge within that approved
delivery authority after its applicable gates succeed. The command-center
review must be independent of the implementing agent. An implementation agent
must not self-approve or merge pull requests, including by invoking
command-center tooling to merge its own PR.

Separate explicit owner authorization remains required for:

- applying a production database migration;
- destructive or irreversible production-data operations;
- secrets/credential changes or materially new production configuration authority;
- destructive rollback or data cleanup;
- scope expansion beyond the approved issue/plan; and
- any newly discovered HIGH-risk production operation not already covered by a
  standing policy.

Creating and testing an approved migration locally or in CI does not authorize
applying it to production. Ordinary deployment must respect existing schema and
release prerequisites; a missing prerequisite that requires an exceptional
operation returns to the separate authorization gate above.

After authorized merge of an approved MEDIUM/HIGH slice, the implementation
agent or command-center tooling may perform an ordinary non-destructive
application deployment within this authority. LOW task selection and its gated
merge do not authorize deployment. If available authorized tooling cannot
perform an authorized deployment, report **deployment handoff required** with the merged
revision, verified delivery state, and exact remaining steps. Do not claim
deployment or full delivery is complete without verified evidence.

Governance changes take effect only after merge under the previously effective
policy. An unmerged governance edit cannot grant authority for its own merge or
deployment; the issue #115 governance PR requires the human owner's final merge.

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

An implementation agent must not self-approve or merge pull requests.

For explicitly selected LOW work or an approved MEDIUM/HIGH slice,
command-center tooling may merge only after required CI succeeds on the
actual final PR head, independent command-center PASS review is recorded, and no
unresolved blocking findings remain, under the approved delivery authority
above.

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

## Command center, implementation agents, and independent review

Ordo separates owner authority, command-center coordination, implementation,
and independent review. Human ownership and durable GitHub/repository authority
do not depend on a particular AI provider. The human owner retains product
priority, scope, acceptance criteria, risk classification, and approval
authority. GitHub issues, this file, canonical repository documents, PRs, and CI
remain the durable source of truth; chat/session memory is not authority.

The command center owns:

- reconstructing live repository/GitHub state and helping the owner select or
  create the governing issue;
- product discussion, scope, acceptance criteria, and risk classification with
  the owner;
- independent MEDIUM/HIGH plan review, durable recording of blocking plan
  corrections, and recording the exact owner approval on the issue;
- independent review of the actual final PR head, full diff, changed files,
  required CI, discussion, and scope;
- recording bounded review findings and final PASS, and marking a PR ready or
  merging only when existing authority and gates permit;
- verifying live `main`, recording delivery state, and closing the issue;
- returning to owner-led planning when no issue or PR selects executable work.

The command center must not choose roadmap work automatically. In Claude Code,
one owner-facing `/next` cockpit may route these phases to fresh role-specific
worker contexts. Other supported environments use the same separation and
durable handoffs.

Implementation agents own repository execution only within established
authority: targeted inspection, risk-appropriate plan preparation, approved
implementation, available verification, intentional commits, feature-branch
publication and draft PR creation, and bounded corrections on the existing PR
branch. They must never push directly to `main`, approve or independently review
their own implementation, mark their own PR ready, or merge it. An implementation
summary cannot substitute for independent review or CI evidence.

Independent reviewers inspect the durable issue/approval and actual GitHub PR
state afresh. They do not rely on implementation-agent conclusions. For Claude
Code, use a fresh read-oriented reviewer context with mutation tools denied and
read-only permissions where the active parent mode permits. If that isolation
cannot be verified, stop and use a separate fresh reviewer session with
appropriate read-only/manual permissions. The reviewer reports findings; only
the command center may record PASS or perform an authorized GitHub mutation
after re-checking current state.

The human should not act as a message bus between agents. Product decisions,
constraints, acceptance criteria, and approvals belong on the governing issue
and canonical repository documents. A short issue-reference handoff is
sufficient only when the agent can retrieve that durable state. If the issue or
required authority cannot be retrieved, stop and report the access gap rather
than guessing.

### Repository context pruning

Use **pruned by default, expand only with a concrete reason**. At the start of
inspection/planning:

1. read `AGENTS.md`, the governing issue, and only task-relevant canonical
   authority docs;
2. use `.github/scripts/build_repo_map.py` when a structural overview would
   locate the narrow implementation boundary without broad raw-file reading;
3. inspect the exact files/symbols most likely to own the behavior;
4. expand only for a concrete dependency, contract, call path, test boundary,
   security rule, or financial invariant; and
5. record material context expansions and their reasons in the plan/final report.

Do not scan the raw repository broadly for convenience or read generated files
and lockfiles without a task-specific reason. If targeted context is
insufficient, inspect the smallest specific additional path/symbol needed.
The repository map is navigation context; canonical files and executable
behavior remain authoritative.

### Credit-aware model routing

Match model capability to task risk and ambiguity. Use the cheapest adequate
model for bounded discovery, metadata, mechanical checks, simple test/log
summaries, and straightforward LOW work. Use a balanced model such as Sonnet
for routine orchestration, implementation, debugging, publication preparation,
and bounded corrections. Escalate selectively for nontrivial MEDIUM/HIGH plan
synthesis/review, difficult architecture or cross-boundary reasoning, financial,
security, migration or production-configuration reasoning, and repeated failure
that demonstrates a need. Fable/`best` or other premium long-horizon models are
exceptional, not defaults.

In Claude Code, the owner-facing cockpit defaults to Sonnet; use fresh project
subagents with `haiku`, `sonnet`, or an explicit per-invocation `opus` override
for appropriately scoped tasks. Do not pin the general `/next` skill to
`opusplan`, force every subagent to one model, or use model choice to change
authority. Verify the resolved model when relevant and disclose unavailable or
substituted routing. Start a new worker context for each authority/review phase;
GitHub is the handoff. Do not reuse old conclusions as approval or evidence.

When the environment cannot select a model/agent, do not claim a switch
occurred. Use concise prompts, pruned context, durable GitHub/repository state,
and targeted verification instead. One bounded retry or correction may be
reasonable for an incidental failure; when failure demonstrates a capability
or ambiguity limit, escalate instead of repeatedly retrying. Record material
escalations. Credit efficiency never weakens issue scope, approval gates,
privacy/security/financial invariants, required tests/CI, independent review,
exceptional-operation approval, or separation of implementation from review and
merge.

### Risk approvals and durable plans

LOW work may proceed after explicit task selection under the authority above.
For MEDIUM work, an implementation agent inspects and prepares the concise plan;
for HIGH work it inspects only and prepares the plan, risks, rollback
considerations, and verification plan. The command center independently reviews
the plan, records blocking corrections, and publishes the final plan as a
top-level comment on the governing issue when publication is available. Stop
for explicit owner approval unless that exact plan and approval are already
durably recorded. HIGH work also retains separate authorization for exceptional
production operations.

The owner approval applies only to the exact issue/plan slice through the
approved delivery process. Publishing a plan does not authorize implementation,
branch creation, commit, push, PR, migration, production access/action,
deployment, or merge. A materially changed plan, broadened scope, or changed
financial/security/production semantics requires renewed approval.

If issue-comment publication is unavailable, stop and report a
**planning-publication capability gap**, naming the issue and missing
capability. Do not leave the workflow appearing ready, substitute a local
implementation artifact, or ask the human to relay the plan.

### Local execution, publication, and independent proof

The intended path is:

```text
selected issue + durable authority
-> implementation-agent checkout on an up-to-date feature branch
-> implementation + local verification + intentional commit(s)
-> push branch + draft PR (or disclosed publication handoff)
-> required GitHub CI on the PR head
-> fresh independent command-center review of actual PR + CI
-> authorized merge after every gate succeeds
-> ordinary non-destructive application deployment only when authorized,
   or deployment handoff
```

The implementation agent may push only its approved feature/PR branch, never
`main`. If local GitHub publication tooling/authentication is unavailable but
safe local Git works, stop at a clean local commit and report **publication
handoff required** with branch, SHA, files, verification evidence/gaps, and
remaining steps. Human publication through GitHub Desktop/web is an acceptable
fallback; it does not weaken CI, independent review, or merge gates.

For bounded review findings, remain on the existing PR branch, make the smallest
correction, rerun affected verification, push, and re-check CI. Scope-expanding
corrections return to planning and approval. Independent review and successful
required CI on the actual final head gate authorized command-center merge.
Existing exceptional production-operation approvals remain separate. Following
authorized MEDIUM/HIGH merge, ordinary non-destructive deployment is permitted
only within the approved delivery authority and when prerequisites are met.

Implementation-agent local tests/builds are development evidence. Required
Frontend, Backend, PostgreSQL, Vercel, and other applicable checks retain the
evidence requirements in `docs/verification.md`; independent review inspects the
actual PR diff, discussion and current CI rather than accepting an implementer
summary. Never fabricate branch, PR, CI, review, merge or deployment state.

Provider-specific adapters, including Codex and Claude Code, must follow this
shared role/authority model. Never commit provider authentication state, API
keys, GitHub tokens, private keys, or other secrets.
