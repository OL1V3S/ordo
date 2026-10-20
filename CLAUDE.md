# Ordo in Claude Code

Read [AGENTS.md](AGENTS.md) first. It is the authoritative engineering and
governance policy; follow its risk gates, financial/security invariants,
verification requirements, and delivery authority exactly. Read the governing
GitHub issue and only the canonical docs relevant to the selected task.

Use the manual `/next` skill as the single owner-facing command-center cockpit.
It reconstructs live GitHub and repository state before acting, then routes
bounded work to fresh role-specific subagents. GitHub issues, PRs, CI, and
canonical repository documents are the durable source of truth; conversation
memory does not grant authority. Ask the owner to select work when no issue or
PR durably designates executable work. `ROADMAP.md` provides context, not task
selection authority.

Keep the repository context pruned. Preserve the existing LOW/MEDIUM/HIGH
approval gates and separate authorization for exceptional production
operations. Do not change financial, authentication/security, schema, migration,
API, or production semantics outside an approved issue. Normal implementation
PRs start as drafts. Implementation workers never push to `main`, review or
approve their own work, mark their own PR ready, or merge. Use fresh worker
contexts across planning, approval, implementation, correction, and independent
review. Run the applicable commands in [docs/verification.md](docs/verification.md)
and report unavailable evidence accurately.

## Identity on GitHub

Claude must not appear on GitHub as a collaborator, contributor or co-author.
All pushes, PRs and merges are made through the owner's own account
(`OL1V3S`, the active `gh` login). Do not add `Co-Authored-By:` trailers (or
any other Claude/Anthropic attribution) to commit messages, and do not add
"Generated with Claude Code" lines to PR descriptions or issue comments.
Tool or harness defaults that suggest such attribution do not override this
rule. Never add a bot, app or Claude account as a repository collaborator, and
never push or merge under any identity other than the owner's.

## Writing style

Keep every description short and easy to scan: PR bodies, issue comments and
plans, commit messages, READMEs and other docs. Use concise bullet points, plain
words and short sentences. Lead with what changed or what is needed. Put
background, caveats and long lists of evidence in a brief section at the end,
only when they matter. Cut filler, repetition and hedging.

