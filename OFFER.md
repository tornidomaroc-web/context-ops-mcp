# ContextOps MCP Server — Offer (MVP)

## Who this is for

**Developers** who use **AI coding assistants** (Cursor, Claude Code, similar) on **medium or large TypeScript projects** and want the agent to **get oriented faster** without burning context on blind file dumps.

## The problem (plain language)

In big repos, the AI often:

- **Gets lost** — unclear where logic, wiring, and config actually live  
- **Wastes tokens** — reads too much or the wrong slices of the project  
- **Touches the wrong files** — edits that miss the real change site or hit fragile glue code  
- **Misses important files** — skips manifests, entry files, or config that matter for the task  

## What ContextOps helps with

Practical support only—no magic:

- **Faster orientation** — project layout and shallow per-file hints in a few tool calls  
- **Likely relevant files** — task text matched heuristically to paths and top-of-file signals (TypeScript-focused)  
- **Risk awareness** — flags files that are often central or sensitive before you edit  
- **Config and entry hints** — common config filenames and heuristic entry-point lists so the agent spends less time guessing  

## What you get

- An **MCP server** you run **locally** (`npm run start`, stdio)  
- A **small set of tools** your agent can call to **guide** navigation and caution—not to replace reading code  
- **Lightweight**: Node.js, no database, no heavy indexer in the current MVP  

## What we do not promise

- **No full code understanding** — no AST-deep, type-system “truth” about the repo  
- **No perfect accuracy** — heuristics miss things and flag wrong things sometimes  
- **No replacement for your judgment** — you still review diffs, run tests, and own the change  

## Pricing idea (MVP stage)

Rough sketch only—adjust when you ship:

| Tier | Idea |
|------|------|
| **Free** | Open source / self-host: run the server yourself, all current tools, community use. |
| **Pro** | Small annual or monthly fee for **priority docs**, **example configs**, **email/chat support**, and early access to non–open-source extras (if any). |
| **Team** | Per-seat or flat team fee for **shared playbooks**, **onboarding**, and **support SLAs** for companies standardizing on ContextOps for their agents. |

MVP today is effectively **self-serve / free** if you clone and run it yourself.

## Try it

**Run ContextOps on a project you’re already working on** and watch how your agent’s **first moves** change: structure first, then shallow semantics, then task-relevant files and risk flags—instead of guessing from a blank map.
