# ContextOps

## Headline

**Help your AI coding agent stop getting lost in large TypeScript codebases.**

## Subheadline

ContextOps is a **small MCP server** that gives your agent a **fast layout, shallow file clues, and “where to look first”—**so it wastes fewer tokens and makes fewer random edits.

---

## The problem

On a big repo, your agent often:

- **Guesses** where logic lives instead of mapping the tree first  
- **Eats context** opening long files or re-reading the same areas  
- **Edits the wrong file** or **misses** manifests, entry files, and config  
- Leaves **you** in a loop: nudge, retry, nudge again  

That’s normal when there’s no shared, cheap map before the real work.

---

## The solution

ContextOps doesn’t “understand” your whole codebase. It **orients**: structure, top-of-file hints, likely entry and config paths, task-matched **TypeScript** candidates, and a **risk pass** on files that are often central or touchy—**all through MCP tools** your agent can call locally.

---

## How it works (4 steps)

1. **Map the repo** — folders and files (`get_project_structure`); spot setup files (`get_likely_config_files`).  
2. **Skim the surface** — first ~50 lines per `.ts` / `.json`: exports and key names (`get_semantic_summary`).  
3. **Find wiring and focus** — likely entry files (`get_entry_points`); files that match your task string (`get_relevant_files_for_task`).  
4. **Check blast radius** — files that may deserve extra care (`get_risky_files`).  

Your agent still reads code and runs tests—ContextOps just **cuts down blind wandering**.

---

## Before vs After

| Before | After |
|--------|--------|
| Random search and big dumps early | **Structure and shallow hints first** |
| Wrong or late discovery of config/entry | **Early lists** for common config and entry patterns |
| Edits to central files by accident | **Risk hints** before you change “spine” code |
| Task → guess which `.ts` files | **Ranked candidates** from task text (heuristic) |

---

## What you get

- A **local MCP server** (stdio)  
- **Six tools** for orientation, task focus, risk, and config paths  
- **Light setup**: Node.js, `npm install`, `npm run start`  

---

## Limitations (honest)

- **Heuristic-based** — misses things and flags the wrong thing sometimes  
- **Not perfect** — no guarantee the “relevant” list is the right list  
- **Not a full code intelligence engine** — no deep AST/type/call-graph truth in this MVP  
- **Shallow reads** for summaries — only the **first 50 lines** per file for that logic  

Use it to **start smarter**, not to skip thinking or review.

---

## Try it

**Point ContextOps at the repo you’re already working on**, wire it in your MCP client, and watch your agent’s **first moves** get cheaper and more structured—layout and hints before deep dives.
