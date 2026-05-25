# context-ops-mcp: Product positioning

## What context-ops-mcp is

**context-ops-mcp** is a local **Model Context Protocol (MCP)** server that gives an AI coding agent a fast, bounded map of an unfamiliar SaaS TypeScript repo: where the code lives, what's risky to touch, and where the money / auth / user flows are, without burning the context window on full-file reads. Outputs are **heuristic** and **approximate**, useful for orientation and first-pass decisions, not as ground truth.

## The buyer

**The agency, fractional-CTO, or consultancy dev lead who inherits unfamiliar TypeScript SaaS codebases on engagement.** Lives in Cursor or Claude Code. Bills by the week. Needs to go from zero to a credible triage memo by Friday.

## The problem

- **Context drift.** Agents working in unfamiliar SaaS codebases lose track of where logic lives, what is central vs peripheral, and which files matter for a given task.
- **Token waste.** Pulling whole folders or long files into the context window "just in case" is expensive and slow. It also dilutes attention.
- **Wrong or incomplete targeting.** Agents open the wrong modules, miss bootstrap or config files, or touch high-impact paths without realizing it. Error rates and review churn go up.
- **SaaS-shaped landmines.** Billing wiring, auth surfaces, security patterns, and risky deps are exactly what an inheriting consultant needs to surface in the deliverable, and exactly what the agent will miss if it never opens those files.

## What the current version does (8 tools)

- **`get_project_structure`.** Recursive listing of directories and files in POSIX paths (skips node_modules, .git, dist, .next, .turbo, build, out, coverage, .svelte-kit, .vercel, .cache).
- **`get_semantic_summary`.** First **50 lines** per .ts and .json: pattern-based exports, key-style function names, and JSON top-level keys where applicable.
- **`get_entry_points`.** Heuristic signals for files that may start or orchestrate the app (filenames, route/api/controllers folders, framework imports, simple bootstrap cues in the same shallow window).
- **`get_relevant_files_for_task`.** Up to 10 ranked .ts files. Keyword overlap against paths, exports, and key functions, plus a whole-file streaming pass that catches keywords past the head.
- **`get_execution_plan_for_task`.** Step-ordered plan that merges entry-point hints, ranked relevant files, and risk flags into an inspect, then modify, then read sequence with an avoid list.
- **`get_risky_files`.** Flags .ts files that may be sensitive or central to change: risky path/name segments, process.env, DB/auth imports, HTTP frameworks, or startup patterns (shallow read).
- **`get_likely_config_files`.** Filename and path rules for manifests, tsconfig, env, common build/tooling, and CI files. Not content validation.
- **`get_saas_smells`.** Observation-only pass over code files (up to 500 lines each): billing keyword presence, auth library imports, common security regex patterns, debt markers (TODO/FIXME/HACK/XXX), type-safety suppressions (any, @ts-ignore, @ts-nocheck), and a small risky-package list checked against package.json. Returns a flat list of (file, line, category, observation) tuples.

## What it does NOT do

- **Not a full code intelligence engine.** No unified semantic model of the repo.
- **Not AST-accurate.** No parse tree, type checker, or symbol table as source of truth.
- **Not execution-aware.** No tracing of runtime behavior or data flow.
- **Not runtime, debugger, or test-aware.** No integration with test results, coverage, breakpoints, or logs.
- **Not an audit, diagnosis, or analysis.** The smell tool returns presence checks. No /100 scores. No severity ranking. No hour estimates. No verdicts.
- **No UI-layer claims.** This reads code structure, not UX, conversion, or user flows.
- **Still heuristic.** False negatives and false positives are expected. Results require human or downstream verification.

## Who it is for

- The **inheriting consultant** running an unfamiliar TypeScript SaaS repo through Cursor or Claude Code, who needs both orientation and SaaS-shaped scaffolding for a client deliverable in the same workflow.
- **Agencies and fractional CTOs** standardizing on a bounded MCP layer so every new engagement starts from the same first hour, not from a blank map.

## Why it matters

- **Faster orientation.** Structure, shallow symbols, and config hints compress "where is everything?" into a few tool calls.
- **Less blind scanning.** Bounded reads and targeted lists reduce unnecessary file dumps.
- **Better first-pass file targeting.** Task hints and entry signals steer agents toward plausible files earlier.
- **More cautious edits in sensitive areas.** Risk heuristics flag paths that deserve extra review before change.
- **Triage memo scaffolding.** `get_saas_smells` gives you billing, auth, and security observations with file plus line, ready to confirm and paste into the client write-up.

## Positioning statement

**context-ops-mcp gives your AI coding agent a fast, bounded map of an unfamiliar SaaS TypeScript repo: where the code lives, what's risky to touch, and where the money / auth / user flows are, without burning your context window on full-file reads.**
