# context-ops-mcp: Offer

## Who this is for

**The agency, fractional-CTO, or consultancy dev lead who inherits unfamiliar TypeScript SaaS codebases on engagement.** You live in Cursor or Claude Code. You bill by the week. The client wants a triage memo and a remediation quote by Friday, and you have one afternoon to go from zero to a credible map.

## The problem (plain language)

On a new client repo, the AI agent often:

- **Gets lost.** Unclear where logic, wiring, and config actually live.
- **Wastes tokens.** Reads too much or the wrong slices of the project.
- **Touches the wrong files.** Edits that miss the real change site or hit fragile glue code.
- **Misses the SaaS-shaped pieces.** Billing wiring, auth surfaces, security patterns, and risky dependencies you need to flag in the deliverable.

## What context-ops-mcp helps with

Practical support only. No magic.

- **Faster orientation.** Project layout and shallow per-file hints in a few tool calls.
- **Likely relevant files.** Task text matched heuristically to paths, exports, key functions, plus a whole-file keyword pass (TypeScript-focused).
- **Step-ordered plan.** Entry inspect, then a modify candidate, then supporting reads, with an avoid list from risk heuristics.
- **Risk awareness.** Flags files that are often central or sensitive before you edit.
- **Config and entry hints.** Common config filenames and heuristic entry-point lists so the agent spends less time guessing.
- **SaaS smell scaffolding.** Billing, auth, security, debt-marker, type-safety, and dependency observations with file plus line. Scaffolding for your client memo, not an audit.

## The eight tools

| Tool | Purpose |
|------|---------|
| `get_project_structure` | Repo layout (POSIX paths) |
| `get_semantic_summary` | First 50 lines per .ts and .json: exports, key functions, JSON keys |
| `get_entry_points` | Likely bootstrap and route registration files |
| `get_relevant_files_for_task` | Top-10 .ts files ranked against your task string |
| `get_execution_plan_for_task` | Suggested step order plus an avoid list |
| `get_risky_files` | Likely sensitive or central .ts files |
| `get_likely_config_files` | Manifests, tsconfig, .env, build/CI/tooling configs |
| `get_saas_smells` | Observation-only billing/auth/security/debt/dependency flags (up to 500 lines per code file) |

## What you get

- An **MCP server** you run **locally** (`npm run start`, stdio)
- **Eight tools** your agent calls to guide navigation and caution
- **Lightweight.** Node.js, no database, no API keys, no heavy indexer.

## What we do not promise

- **Not an audit, diagnosis, or analysis.** The smell tool is presence checks with file plus line. No /100 scores. No severity ranking. No hour estimates.
- **No UI-layer claims.** This reads code structure, not UX, conversion, or user flows.
- **No AST or type-checker truth.** Heuristics over file heads, end of story.
- **No replacement for your judgment.** You still review diffs, run tests, write the client memo, and own the change.
- **No guarantee against a determined `grep` user.** The orientation core is rebuildable in an afternoon. What you pay for here is MCP wiring, task-string ranking, and prose-narrated read order from inside your existing agent.

## Pricing idea (MVP stage)

Rough sketch only. Adjust when you ship.

| Tier | Idea |
|------|------|
| **Free** | Open source / self-host. Run the server yourself, all eight tools, community use. |
| **Pro** | Small annual or monthly fee for priority docs, example configs, email/chat support, and early access to non-OSS extras (if any). |
| **Team** | Per-seat or flat team fee for shared playbooks, onboarding, and support SLAs for agencies standardizing on context-ops-mcp across engagements. |

MVP today is effectively **self-serve / free** if you clone and run it yourself.

## Try it

**Run context-ops-mcp against the client repo you just opened.** Watch your agent's first moves change: structure, then shallow semantics, then task-relevant files, then risk flags, then SaaS smells. The triage memo starts writing itself.
