# ContextOps — Outcomes for you (MVP)

## Before using ContextOps

When you point a coding agent at a **large TypeScript repo** without a structured map, common patterns show up:

- The agent **guesses where to look** — opens `src/` at random, searches by vibe, or pulls huge chunks into context.  
- It **burns tokens** on long files, duplicate reads, or listing the same areas twice because it never built a stable mental model.  
- It **edits the wrong module** — e.g. a helper when the bug is in wiring, or a UI file when the contract is in a shared type.  
- It **misses boring but critical files** — `package.json`, `tsconfig`, env samples, or the real entry file.  
- You get **trial and error**: run the agent, watch it wander, nudge it, repeat.  

None of that is hypothetical—it’s what “no map, full repo” usually feels like.

## After using ContextOps

Nothing becomes perfect. A few things **usually shift**:

- The agent can **call tools first**—structure, shallow top-of-file signals, config names, entry guesses, a short list keyed to your **task string**, and a **risk pass** before big edits.  
- Navigation becomes **stepwise**: layout → “what’s declared at the top” → “where might it start” → “what matches this task” → “what’s scary to touch.”  
- You still **read code and run tests**, but the **first 10 minutes** are less random—fewer “search entire repo” loops and fewer surprise edits to central files.  

Improvement is **incremental**, not guaranteed every session.

## Before vs After

| Before | After |
|--------|--------|
| Agent builds the map from scratch each time, often inconsistently | Agent can **import** a small, bounded map via MCP tools |
| Long files and deep trees show up early in context | **50-line** caps on semantic-style reads push toward **headers and exports first** |
| “Relevant files” is mostly search + luck | **Task string** + heuristics produce a **candidate list** (TypeScript-biased) |
| Central or sensitive files get edited without ceremony | **Risky file** hints flag **some** high-impact paths—you decide |
| Config and entry points are discovered late | **Likely config** + **entry heuristics** surface common **manifests and wiring** earlier |

## Concrete benefits

- **Faster first read of the repo** — tree + top-of-file summaries + config names compress “where is everything?”  
- **Fewer obviously wrong file edits** — task-ranked and entry hints steer away from pure guesswork  
- **More targeted early changes** — smaller candidate sets and shallow reads before diving deep  
- **Better awareness of risky areas** — explicit flags for paths that often matter when you break them  

## What does NOT magically improve

- **Reasoning** — the model can still misunderstand requirements or pick the wrong fix among right files.  
- **Correct code** — no tool here proves patches are right; **tests, types, and review** still decide.  
- **Completeness** — heuristics **miss** symbols below the read window, **miss** languages, and **false-positive** risk.  
- **Developer validation** — you still own the merge; ContextOps only **reduces blind wandering**, it doesn’t replace judgment.  
