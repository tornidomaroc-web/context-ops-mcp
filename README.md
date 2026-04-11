# ContextOps

## What it is

**ContextOps** is a local [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives coding agents a **structured, token-aware view** of a repository: layout, shallow semantics, likely entry points, task-oriented file hints, risk signals, and common config paths.

## Problem it solves

Agents often need repository context without reading every file. ContextOps answers **where things are**, **what surface-level symbols appear near the top of files**, and **which paths deserve caution**—using **heuristics** and **bounded reads**, not a full language server or indexer.

## MVP tools

| Tool | What it does |
|------|----------------|
| `get_project_structure` | Lists relative directories and files from the server process working directory (skips `node_modules`, `.git`, `dist`). |
| `get_semantic_summary` | For each `.ts` and `.json` file, reads the **first 50 lines** and reports detected exports, key-style function names, and (for JSON) top-level keys—best-effort, pattern-based. |
| `get_entry_points` | Flags `.ts` files that **look** like entry or wiring points (common names, certain folders, HTTP/framework imports, simple bootstrap cues in the first 50 lines). |
| `get_relevant_files_for_task` | **Input:** `task` (string). Ranks `.ts` files (same 50-line window) against task keywords using filenames, paths, exports, and key functions—**rough relevance**, not intent understanding. |
| `get_risky_files` | Lists `.ts` files that may be **high-impact or sensitive** to edit: path/name cues, `process.env`, DB/auth imports, HTTP stacks, and simple orchestration patterns in the first 50 lines. |
| `get_likely_config_files` | Lists paths that **match common config/CI/env/build naming patterns** (e.g. `package.json`, `tsconfig.json`, `.env*`, `*.config.*`, Docker/Prisma/GitHub Actions, and similar)—by **filename/path rules** only. |

## Requirements

- [Node.js](https://nodejs.org/) 18+
- npm

## How to run locally

```bash
npm install
npm run start
```

The server speaks **stdio**. Configure your MCP client to run the command above and set **`cwd`** to the project you want analyzed.

Typecheck (development):

```bash
npm run typecheck
```

## Current limitations

- **Heuristic-based:** Results are approximate; patterns can miss real structure or flag false positives.
- **50-line cap:** Semantic-style tools only inspect the **first 50 lines** per file; declarations and imports below that are invisible to those checks.
- **TypeScript-heavy:** Most analysis targets **`.ts`** files; other languages get little or no semantic treatment.
- **Not a semantic engine:** There is no full AST, type graph, call graph, or “ground truth” codebase model—only lightweight text rules suitable for an **MVP**.
- **Config detection:** `get_likely_config_files` uses naming conventions; it does not validate file contents or guarantee completeness.

ContextOps is intended to **guide** exploration and editing—not to replace careful review, tests, or IDE intelligence.
