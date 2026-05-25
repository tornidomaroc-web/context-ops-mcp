<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&amp;color=0:0a0a0a,50:064e3b,100:10b981&amp;height=160&amp;section=header&amp;text=ContextOps%20MCP&amp;fontSize=48&amp;fontColor=ffffff&amp;fontAlignY=40&amp;desc=Bounded%20repo%20map%20for%20AI%20coding%20agents&amp;descAlignY=62&amp;descColor=6ee7b7&amp;animation=fadeIn" width="100%"/>

<br/>

[![npm](https://img.shields.io/npm/v/context-ops-mcp?color=10b981&style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/context-ops-mcp)
[![downloads](https://img.shields.io/npm/dm/context-ops-mcp?color=064e3b&style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/context-ops-mcp)
[![Claude AI](https://img.shields.io/badge/MCP%20Compatible-Claude-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://anthropic.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Beta](https://img.shields.io/badge/Status-Beta-BA7517?style=for-the-badge)](https://github.com/tornidomaroc-web/context-ops-mcp)
[![license](https://img.shields.io/github/license/tornidomaroc-web/context-ops-mcp?style=for-the-badge)](./LICENSE)

</div>

---

# context-ops-mcp

> Gives your AI coding agent a bounded map of an unfamiliar TypeScript SaaS repo: where the code lives, what's risky to touch, and where the money / auth / user flows are. Without burning your context window on full-file reads.

Built for the agency, fractional-CTO, or consultancy dev lead who just inherited a TypeScript SaaS codebase and needs to go from zero to a credible map in one afternoon, inside Cursor or Claude Code.

## What it does

Eight MCP tools your agent calls locally. All heuristic. Regex over file heads, filename rules, and one whole-file streaming pass in the relevance ranker. No AST. No type checker. No call graph.

- **Orientation:** structure, top-of-file symbol hints, entry points, config files
- **Task focus:** ranked candidate files for a task string, plus a step-ordered plan
- **Risk:** files that often deserve extra care before edits
- **SaaS smells:** observation-only flags for billing, auth, security patterns, debt markers, and risky deps

## MCP tools exposed

| Tool | What it returns |
|------|------------------|
| `get_project_structure` | Sorted POSIX paths of directories and files (skips node_modules, .git, dist, .next, .turbo, build, out, coverage, .svelte-kit, .vercel, .cache) |
| `get_semantic_summary` | First 50 lines of every .ts and .json file: detected exports, key functions, JSON top-level keys |
| `get_entry_points` | .ts files that look like bootstrap or route registration (filenames, folder hints, framework imports) |
| `get_relevant_files_for_task` | Up to 10 .ts files ranked against a task string (path, exports, key functions, plus a whole-file keyword pass) |
| `get_execution_plan_for_task` | Step-ordered list: inspect entries first, then a modify candidate, then supporting reads, plus an avoid list |
| `get_risky_files` | .ts files matching risky path segments, process.env, DB/auth imports, or startup patterns |
| `get_likely_config_files` | Manifests, tsconfig, .env, build/CI/tooling configs (filename pattern match, not content validation) |
| `get_saas_smells` | Observation-only scan (up to 500 lines per code file): billing keywords, auth imports, security regex hits, TODO/FIXME/HACK/XXX, any/@ts-ignore, risky deps from package.json. No scores. No severity ranking. No hour estimates. |

## What it will not claim

- Not an audit, diagnosis, or analysis. The smell tool returns presence checks, not verdicts.
- No /100 scores. No hour estimates on remediation.
- No UI-layer claims. This reads code structure, not UX or conversion.
- No AST, type-checker, or call-graph promises.
- A determined engineer rebuilds the orientation core in an afternoon with `grep` and `tree`. The differentiator is MCP wiring, task-string ranking, and prose-narrated read order, not capability you cannot have.

## Stack

`TypeScript` · `MCP SDK` · `Node.js` · stdio transport

## Run locally

```bash
npm install
npm run build
npm run start
```

Wire it into Cursor or Claude Code as a local MCP server (stdio). No API keys required.

## Built by

[AboJad](https://github.com/tornidomaroc-web), Full Stack AI Engineer, Marrakesh

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=waving&amp;color=0:0a0a0a,50:064e3b,100:10b981&amp;height=100&amp;section=footer&amp;animation=fadeIn" width="100%"/>
</div>
