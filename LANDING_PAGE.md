# context-ops-mcp

## Headline

**Hand your AI agent a bounded map of an unfamiliar TypeScript SaaS repo, before it burns your context window guessing.**

## Subheadline

A small local MCP server with **eight tools**. Structure, top-of-file hints, ranked candidates for a task, risk flags, and observation-only SaaS smells (billing, auth, security). For the agency, fractional CTO, or consultancy dev lead who just inherited a TypeScript SaaS codebase and needs a credible triage map by Friday.

---

## The problem

You opened a new client repo cold. Your agent has no map. So it:

- **Guesses** where logic lives instead of mapping the tree first
- **Eats context** opening long files or re-reading the same areas
- **Edits the wrong file** or misses manifests, entry files, and config
- **Never surfaces the SaaS-shaped pieces** (billing wiring, auth surfaces, risky deps) you need in the client memo
- Leaves **you** in a loop: nudge, retry, nudge again

That is the default state of "no map, full repo, billing by the week."

---

## The solution

context-ops-mcp does not "understand" the codebase. It **orients**: structure, top-of-file hints, likely entry and config paths, task-matched TypeScript candidates, a risk pass, and a SaaS smell pass. All through MCP tools your agent calls locally inside Cursor or Claude Code.

---

## How it works (5 steps)

1. **Map the repo.** Folders and files (`get_project_structure`); spot setup files (`get_likely_config_files`).
2. **Skim the surface.** First 50 lines per .ts and .json: exports and key names (`get_semantic_summary`).
3. **Find wiring and focus.** Likely entry files (`get_entry_points`); ranked .ts files for your task string (`get_relevant_files_for_task`).
4. **Plan the read order.** Entries first, then a modify candidate, then supporting reads, plus an avoid list (`get_execution_plan_for_task`).
5. **Check blast radius and SaaS shape.** Files that deserve extra care (`get_risky_files`); presence flags for billing, auth, security, debt, and dependency risk (`get_saas_smells`).

Your agent still reads code and runs tests. context-ops-mcp just cuts down the blind wandering and gives you scaffolding for the client memo.

---

## Before vs After

| Before | After |
|--------|--------|
| Random search and big dumps early | Structure and shallow hints first |
| Wrong or late discovery of config/entry | Early lists for common config and entry patterns |
| Edits to central files by accident | Risk hints before you change "spine" code |
| Task → guess which .ts files | Ranked candidates from task text (heuristic) |
| Billing, auth, security context lives in your head | Observation-only smell flags with file plus line |

---

## What you get

- A **local MCP server** (stdio, no API keys)
- **Eight tools** for orientation, task focus, risk, config, and SaaS smells
- **Light setup**: Node.js, `npm install`, `npm run start`

---

## Limitations (honest)

- **Heuristic.** Misses things and flags the wrong thing sometimes.
- **Shallow reads for orientation.** Only the first 50 lines per file for symbol extraction. The smell tool reads up to 500 lines per code file.
- **Not a full code intelligence engine.** No AST, type checker, or call-graph truth.
- **Not an audit.** `get_saas_smells` returns presence checks. No /100 scores, no severity ranking, no hour estimates, no verdicts on UX or business model.
- **A determined engineer rebuilds the orientation core in an afternoon with `grep` and `tree`.** What you pay for here is the MCP wiring, the task-string ranking, the prose-narrated read order, and the SaaS-smell shape, all inside the agent you already use.

Use it to **start smarter**, not to skip thinking or review.

---

## Try it

**Point context-ops-mcp at the client repo you just inherited**, wire it into Cursor or Claude Code, and watch your agent's first moves get cheaper and more structured. Layout, then shallow semantics, then task-ranked candidates, then risk and SaaS smells. The triage memo for Friday starts writing itself.
