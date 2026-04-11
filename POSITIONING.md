# ContextOps MCP Server — Product positioning (MVP)

## What ContextOps is

**ContextOps** is a local **Model Context Protocol (MCP)** server that gives coding agents a **structured, bounded snapshot** of a TypeScript-oriented repository: layout, shallow per-file signals, likely entry and config paths, task-oriented file hints, and simple risk flags. It is built for **speed and token discipline**, not for deep program analysis. Outputs are **heuristic** and **approximate**—useful for orientation and first-pass decisions, not as ground truth.

## The problem

- **Context drift:** Agents working in medium or large codebases lose track of where logic lives, what is central vs peripheral, and which files matter for a given task.
- **Token waste:** Pulling whole folders or long files into the context window “just in case” is expensive and slow; it also dilutes attention.
- **Wrong or incomplete targeting:** Agents often open the wrong modules, miss bootstrap or config files, or touch high-impact paths without realizing it—raising error rates and review churn.

## What the current MVP does

- **Project structure discovery** — Recursive listing of directories and files (with standard ignores).
- **Shallow semantic summary** — First **50 lines** per `.ts` / `.json`: pattern-based exports, key-style names, and JSON top-level keys where applicable.
- **Entry point detection** — Heuristic signals for files that may start or orchestrate the app (names, folders, imports, simple bootstrap cues in that same shallow window).
- **Task-based relevant file suggestions** — Keyword overlap against paths and shallow summary data (`.ts` only); ranked, not “understood.”
- **Risky file identification** — Flags `.ts` files that may be sensitive or central to change by path/name, env usage, dependency imports, HTTP stacks, and simple orchestration patterns (again in a shallow read).
- **Likely config file identification** — Filename/path rules for manifests, TS config, env patterns, common build/tooling and CI filenames—not content validation.

## What it does NOT do yet

- **Not a full code intelligence engine** — No unified semantic model of the repo.
- **Not AST-accurate** — No parse tree, type checker, or symbol table as the source of truth.
- **Not execution-aware** — No tracing of runtime behavior or data flow.
- **Not runtime / debugger / test-aware** — No integration with test results, coverage, breakpoints, or logs.
- **Still heuristic-based** — False negatives and false positives are expected; results require human or tool verification downstream.

## Who it is for

- **Developers** who use **coding agents** on **medium and large TypeScript** (and TS-heavy) codebases and want **faster, cheaper first steps**.
- **Teams** that value **clearer first-pass navigation**, **less blind full-repo scanning**, and **explicit caution** around files that are likely central or sensitive.

## Why it matters

- **Faster orientation** — Structure, shallow symbols, and config hints compress “where is everything?” into a few tool calls.
- **Less blind scanning** — Bounded reads and targeted lists reduce unnecessary file dumps.
- **Better first-pass file targeting** — Task hints and entry signals steer agents toward plausible files earlier.
- **More cautious edits in sensitive areas** — Risk heuristics flag paths that deserve extra review before change.

## Positioning statement

**ContextOps is a context orchestration layer for coding agents working in large TypeScript repositories—bounded, heuristic, and MCP-native, so agents orient faster and spend fewer tokens doing it.**
