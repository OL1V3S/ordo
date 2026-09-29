---
name: "next"
description: "Continue the currently authorized Ordo GitHub workflow from live repository state when the owner invokes $next or asks to continue Ordo."
---

# Continue Ordo

Use live GitHub and repository state as authority. Conversation history, summaries, and the roadmap do not select work by themselves. Follow `AGENTS.md`; this skill does not replace or relax its approval, risk, verification, publication, review, or merge rules.

## Reconstruct current state

1. Read `AGENTS.md` and fetch current `origin/main`. Confirm the worktree and branch before any edits.
2. Inspect the latest `origin/main` commit and recent merges, open pull requests, and open issues.
3. Inspect the active governing issue and its acceptance criteria, dependencies, and relevant plan, approval, and review comments. Consult `ROADMAP.md` only for context.
4. Expand repository inspection only to the files needed for the selected issue, following the context-pruning rules in `AGENTS.md`.

If required GitHub state cannot be retrieved, stop and report the capability gap. Do not infer current work from a local branch or memory.

## Choose only an authorized next action

Apply the first matching state:

- **A user explicitly names an issue or PR:** continue that task if it is open and its current authority permits the requested step. A closed or merged issue is not current work.
- **An open PR has bounded command-center review findings:** stay on its branch, make only the requested corrections, run affected verification, and push to that PR.
- **A selected or durably designated LOW issue has implementation remaining:** implement within its scope, verify, commit, push, and open a draft PR as required by `AGENTS.md`.
- **A selected or durably designated MEDIUM/HIGH issue has implementation in progress or remains unimplemented:** proceed only when the exact plan and owner approval are durably recorded on the issue. Implement only that slice and follow its delivery requirements.
- **An unapproved MEDIUM/HIGH issue is selected:** inspect and plan only. Publish the required top-level plan comment on the issue, then stop for owner approval. The comment grants no implementation authority.
- **A PR is awaiting independent review, required CI, or merge:** report the outstanding state and stop. Never self-approve or merge.
- **No issue or PR is explicitly selected and no durable GitHub state designates executable next work:** ask the owner to select/create the governing issue. Never select an arbitrary open issue or choose a `ROADMAP.md` item as a backlog task.

## Preserve Ordo authority

- Classify risk using `AGENTS.md`. LOW work may proceed after explicit task selection. MEDIUM/HIGH planning and approval gates remain mandatory.
- Keep scope within the issue and approved plan. Stop if work requires a new risk decision, scope expansion, or exceptional production authorization.
- Run the applicable local verification and require the specified CI and independent review evidence before a PR is review-ready.
- For new work, use an up-to-date `main`, a clean worktree, and a fresh feature branch. For PR corrections, stay on the existing PR branch.
- Open normal agent PRs as drafts. Never push to `main`, self-approve, or merge.
- If GitHub publication is unavailable, preserve the authorized work in a clean local commit and report the publication handoff with exact remaining steps.
