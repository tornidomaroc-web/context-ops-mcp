<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&amp;color=0:0a0a0a,50:064e3b,100:10b981&amp;height=160&amp;section=header&amp;text=ContextOps%20MCP&amp;fontSize=48&amp;fontColor=ffffff&amp;fontAlignY=40&amp;desc=Revenue-aware%20repo%20context%20for%20AI%20agents&amp;descAlignY=62&amp;descColor=6ee7b7&amp;animation=fadeIn" width="100%"/>

<br/>

[![npm](https://img.shields.io/npm/v/context-ops-mcp?color=10b981&style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/context-ops-mcp)
[![downloads](https://img.shields.io/npm/dm/context-ops-mcp?color=064e3b&style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/context-ops-mcp)
[![Claude AI](https://img.shields.io/badge/MCP%20Compatible-Claude-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://anthropic.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://github.com/tornidomaroc-web/context-ops-mcp)
[![Beta](https://img.shields.io/badge/Status-Beta-BA7517?style=for-the-badge)](https://github.com/tornidomaroc-web/context-ops-mcp)

</div>

---

> **MCP server that gives your AI agent a structured, revenue-aware view of any SaaS codebase — in seconds.**

[![license](https://img.shields.io/github/license/tornidomaroc-web/context-ops-mcp)](./LICENSE)

---

## The problem

Your AI agent reads files blindly.  
It wastes tokens. It misses billing logic. It touches risky files without knowing.

SaaS founders lose hours every week to agents that don't understand **which files matter** for revenue, onboarding, and growth.

---

## What context-ops-mcp does

`context-ops-mcp` is a local [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server.  
It connects to Claude, Cursor, or any MCP-compatible agent and gives it a **token-aware, structured map** of your repository — instantly.

No full indexer. No cloud sync. No setup beyond `npx`.

---

## Who it's for

- **SaaS founders** who use AI coding agents daily
- **Indie hackers** building on Claude Code, Cursor, or Windsurf
- **Developers** who want their agent to understand project structure without reading every file

---

## Install

```bash
npx context-ops-mcp
```

Or globally:

```bash
npm install -g context-ops-mcp
```

---

## Quick start (Claude Code)

Add this to your Claude MCP config:

```json
{
  "mcpServers": {
    "context-ops": {
      "command": "npx",
      "args": ["-y", "context-ops-mcp"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

Restart your agent. Done.

---

## Tools

| Tool | What it gives your agent |
|---|---|
| `get_project_structure` | Full repo map — directories and files, skipping noise (`node_modules`, `.git`, `dist`) |
| `get_semantic_summary` | Surface-level exports, functions, and JSON keys from every `.ts` file |
| `get_entry_points` | Flags wiring files, HTTP handlers, bootstrap points — where your app starts |
| `get_relevant_files_for_task` | Ranks files by relevance to a task — the agent reads less, ships faster |
| `get_risky_files` | Detects high-impact files: auth, DB, env, payment logic — before your agent touches them |
| `get_likely_config_files` | Lists all config, CI, env, and build files by convention |

---

## Why SaaS founders use it

Your agent now knows:

- **Where billing logic lives** — so it doesn't break it accidentally
- **Which files are risky** — auth, DB, payments — before making changes
- **What's relevant to this task** — so it stops wasting your context window

Less token waste. Less risk. Faster shipping.

---

## Requirements

- Node.js 18+
- Any MCP-compatible client: Claude Code, Cursor, Windsurf, Cline

---

## Run locally

```bash
npm install
npm run start
```

The server uses **stdio** transport. Set `cwd` to the project you want analyzed.

---

## Limitations (honest ones)

- **Heuristic-based** — pattern matching, not a full AST or type graph
- **50-line cap** — semantic tools only inspect the first 50 lines per file
- **TypeScript-first** — other languages get minimal treatment
- **Not a replacement** for tests, code review, or IDE intelligence

ContextOps is a navigation tool, not an oracle.

---

## Keywords

`mcp` · `model-context-protocol` · `claude` · `cursor` · `ai-agent` · `saas` · `developer-tools` · `context-window` · `codebase-analysis` · `revenue` · `billing` · `typescript`

---

## License

MIT © [tornidomaroc-web](https://github.com/tornidomaroc-web)

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=waving&amp;color=0:0a0a0a,50:064e3b,100:10b981&amp;height=100&amp;section=footer&amp;animation=fadeIn" width="100%"/>
</div>
