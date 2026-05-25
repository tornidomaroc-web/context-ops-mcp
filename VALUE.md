# context-ops-mcp: Outcomes for you

Built for the agency, fractional-CTO, or consultancy dev lead who just inherited an unfamiliar TypeScript SaaS repo and needs a credible triage map by Friday, working through Cursor or Claude Code.

## Before using context-ops-mcp

You open a client's repo cold. The agent has no map. Common patterns:

- The agent **guesses where to look** in `src/`, searches by vibe, or dumps long files into context.
- It **burns tokens** on duplicate reads and never builds a stable mental model of the SaaS surface area.
- It **edits the wrong module** because it never noticed which files are central or sensitive.
- It **misses the SaaS-shaped landmines** you need to call out in the deliverable: where billing wiring lives, which files touch auth, what risky deps are still in package.json.
- You get stuck in **trial and error**: run the agent, watch it wander, nudge it, repeat.

That is the default state of "no map, full repo, billing by the week."

## After using context-ops-mcp

Nothing becomes perfect. A few things **usually shift**:

- The agent can **call eight bounded tools first**, in roughly this order:
  1. `get_project_structure` and `get_likely_config_files` to see the shape
  2. `get_semantic_summary` for top-50-line export and function hints across every .ts and .json
  3. `get_entry_points` for bootstrap and routing
  4. `get_relevant_files_for_task` to rank candidates against your task string
  5. `get_execution_plan_for_task` to merge entries, relevance, and risk into a step order
  6. `get_risky_files` and `get_saas_smells` as guard rails before edits and as scaffolding for the client memo
- Navigation becomes **stepwise** instead of vibe-driven: layout, then declared exports, then likely entries, then task-matched candidates, then risk and SaaS smells.
- The **first hour on a new client repo** is less random. Fewer "search entire repo" loops. Fewer surprise edits to spine files. A starting outline for your triage memo already exists in the smell output.

Improvement is **incremental**, not guaranteed every session.

## Before vs After

| Before | After |
|--------|--------|
| Agent rebuilds the map from scratch each session | Agent imports a small, bounded map via 8 MCP tools |
| Long files and deep trees show up early in context | 50-line caps on orientation reads push toward headers and exports first |
| "Relevant files" is mostly search and luck | Task string plus heuristics produce a ranked candidate list |
| Central or sensitive files get edited without ceremony | Risky file hints flag some high-impact paths before changes |
| Config and entry points discovered late | Likely config and entry heuristics surface manifests and wiring early |
| Billing, auth, and security context lives in your head | `get_saas_smells` returns file plus line tuples you can paste into the client memo |

## Concrete benefits

- **Faster first read of the repo.** Tree, top-of-file summaries, config names, and entry hints compress "where is everything?" into one tool sequence.
- **Fewer obviously wrong file edits.** Task-ranked candidates and entry hints steer away from pure guesswork.
- **More targeted early changes.** Smaller candidate sets and shallow reads before diving deep.
- **Better awareness of risky areas.** Explicit flags for paths that often matter when you break them.
- **SaaS-shaped scaffolding for client deliverables.** Billing, auth, security, debt, and dependency observations with file and line numbers. Not an audit. Not a verdict. Material you confirm and use in your own write-up.

## What does NOT magically improve

- **Reasoning.** The model can still misunderstand requirements or pick the wrong fix among right files.
- **Correct code.** No tool here proves patches are right. Tests, types, and review still decide.
- **Completeness.** Heuristics miss symbols below the 50-line head, miss non-TypeScript languages, and false-positive on risk.
- **The smell tool is observation, not audit.** `get_saas_smells` returns presence flags with file plus line. No /100 scores, no severity ranking, no hour estimates. You decide what matters.
- **Developer validation.** You still own the merge and the client memo. context-ops-mcp only reduces blind wandering. It does not replace judgment.
