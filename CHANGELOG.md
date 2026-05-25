# Changelog

All notable changes to context-ops-mcp.

## 2.1.0 — 2026-05-25

Patch cycle resolving the three observations filed in `docs/PUBLISH_REPORT.md` §6. No new tools; no API breaks. Every behavioral change is covered by a regression test that proves both that the fix works AND that it does not overclaim.

### Fixed
- **AUTH_PATTERNS missed subpath imports.** The 5 existing import-anchored patterns (`/from\s+["']PKG["']/`) only matched bare imports. They missed `from "better-auth/next-js"`, `from "passport/strategies"`, `from "jose/jwt/verify"`, etc. On the inbox-zero smoke (a Next.js SaaS using `better-auth` heavily), 12 of 15 auth import sites were silently dropped. Patterns now use `/from\s+["']PKG(?:\/[^"']+)?["']/` so subpath imports match. Captured by `tests/v2_1.test.ts` with positive (bare + subpath) and negative (`better-auth-utils` shadow name) tests.
- **`get_execution_plan_for_task` over-generated on monorepos.** Returned 272 plan steps and 182 avoid items on inbox-zero in v2.0. v2.1 caps entry-point plan steps at 15 (prioritized: `index.ts`/`app.ts`/`server.ts`/`main.ts` filenames first, then bootstrap-marker reasons, then folder matches; shallower paths preferred within a tier), and caps the `avoid` list at 30 (prioritized by reason richness). The response now includes a `truncated: { entryPointsTotal, entryPointsShown, avoidTotal, avoidShown }` field so the consumer always sees when signal was elided. **No silent truncation.**

### Added
- **5 new auth packages in AUTH_PATTERNS:** `@workos-inc/*`, `@kinde-oss/*`, `@stackframe/*` (Stack Auth), `arctic` (Pilcrow OAuth), `oslo` (Lucia's successor). Plus a `@better-auth/*` scope sibling for `@better-auth/expo` and `@better-auth/sso`. Each pattern is import-statement-anchored; no fuzzy substring matching.
- **8 new entries in RISKY_PACKAGES**, each with a verifiable source: `tslint` (deprecated by Palantir), `node-uuid` (renamed to `uuid`), `node-sass` (LibSass EOL), `crypto-js` (maintenance discontinued; CVE-2023-46233), `event-stream` (2018 supply-chain attack), `flatmap-stream` (the malicious payload), `node-ipc` (CVE-2022-23812 protestware), `q` (maintainer recommends native Promises). No opinion-flags.
- **`tests/v2_1.test.ts`** (7 tests) covering each behavioral change. Total suite: 25 tests, all passing.
- **`tests/fixtures/v2_1/`** with auth import fixtures (one per package, plus a false-positive guard) and a synthetic `package.json` for the dependency-risk additions.

### Changed
- `get_execution_plan_for_task` tool description now states the caps and the `truncated` field explicitly.
- `faker` observation tightened from "Original abandoned" to "Original `faker` is abandoned; switch to @faker-js/faker" — clearer to the agent reading the smell.

### Notes
- `lucia` / `lucia-auth` was considered and rejected — deprecated by its maintainer in 2025 in favor of `oslo` + `arctic` (both of which v2.1 adds). Flagging a dead package wastes a slot.
- `firebase/auth`, `@aws-amplify/auth`, `@azure/msal-*` were considered and deferred — used by sub-segments outside the current agency-lead-SaaS-triage JTBD. Add when a customer asks.
- `underscore`, `grunt`, `ua-parser-js`, `left-pad`, `is-promise`, `core-js` were considered for the risky list and rejected — flagging maintained or once-incident-now-patched packages would be opinion, not risk.

## 2.0.0 — 2026-05-25

Major rewrite. The 1.0.0 line shipped under a "Revenue diagnosis MCP tool" tagline with 16 registered tools, several of which were keyword scans dressed as audits. Internal diagnosis (see `docs/STATE_REPORT.md` and `docs/UNIFIED_NARRATIVE.md`) collapsed the surface area to 8 honest tools and rewrote the product story around a single buyer: the agency or fractional-CTO dev lead inheriting an unfamiliar TypeScript SaaS repo.

### Added
- `get_saas_smells`: one observation-only tool that folds the salvageable parts of the old security, debt, dependency, and billing scanners into a single output. Returns flat `(file, line, category, observation, snippet)` tuples. No scores. No severity ranking. No hour estimates. No verdicts. Categories: billing, auth, security, type-safety, debt-marker, dependency-risk.
- Whole-file streaming pass in `get_relevant_files_for_task`. The head-of-file scan now has a fallback that catches keyword presence past line 50, fixing a dogfood failure where the tool could not find this repo's own billing code.
- `instructions` field on the McpServer constructor, exposing the intended 8-tool workflow to clients (Cursor, Claude Code, Claude Desktop).
- `streamFileForKeywords` helper in `src/analyzer.ts`.
- `SMELL_SCAN_LIMIT` constant (500 lines per code file) documented separately from `SEMANTIC_LINE_LIMIT`.
- Test suite using `node --import tsx --test`: 18 tests across `tests/smoke.test.ts`, `tests/dogfood.test.ts`, `tests/honesty.test.ts`.

### Changed
- `SEMANTIC_LINE_LIMIT` reduced from 300 to 50 lines. The headline token-discipline value prop now matches the code.
- Path separators normalized to POSIX at every tool output boundary (`get_project_structure`, `get_semantic_summary`, `get_entry_points`, `get_risky_files`, `get_likely_config_files`, `get_relevant_files_for_task`, `get_execution_plan_for_task`, `get_saas_smells`).
- `IGNORED_DIRS` expanded from `[node_modules, .git, dist]` to also include `.next`, `.turbo`, `.svelte-kit`, `.vercel`, `.cache`, `coverage`, `build`, `out`. Stops result-set ballooning on Next.js, SvelteKit, and other modern stacks.
- `MCP_SERVER_VERSION` synced to package.json (was stuck at `1.0.0`).
- README, VALUE.md, OFFER.md, POSITIONING.md, LANDING_PAGE.md rewritten to tell the same product story. Every surface now references exactly the 8 registered tools.

### Removed
- `get_revenue_diagnosis` (was unbounded LLM opinion behind a hard-coded prompt, contradicted the "bounded heuristic" promise, required an Anthropic API key at install).
- `get_billing_audit`, `get_security_vulnerabilities`, `get_technical_debt_report`, `get_dependency_risk_analysis` (folded into `get_saas_smells`).
- `get_onboarding_friction` (was keyword bingo on UI words; UI-layer claims were out of scope from day one).
- `get_competitive_gaps` (was structurally incapable of returning a low score, joined all file heads into one string).
- `get_architecture_health_score` (would have graded this repo F before the rewrite).
- `get_full_diagnostic_report` (bundled four of the tools above).
- `@anthropic-ai/sdk` dependency (was declared but never imported).
- Score-out-of-100 fields, hour estimates, severity rankings, "/audit/" / "/diagnosis/" framing from every tool output.

### Fixed
- Dogfood failure in `get_relevant_files_for_task`: now finds billing code past the read window.
- Path-separator inconsistency where `get_project_structure` returned Windows backslashes while other tools returned POSIX forward slashes.
- `get_semantic_summary` previously leaked the raw input path in its `root` field and used platform-separator keys in its `files` map; both now POSIX.
- Tool descriptions claiming "first 50 lines" while the constant was 300.

### Migration from 1.0.0
- The three tool names from the old README (`analyze_repo`, `get_billing_gaps`, `get_onboarding_score`) never existed in source; no migration needed if you only read the README.
- If you scripted against any of the cut tool names listed above, you will need to either reframe your call around `get_saas_smells` (for the security/debt/dep/billing observations) or remove the call entirely (for `get_revenue_diagnosis`, `get_onboarding_friction`, `get_competitive_gaps`, `get_architecture_health_score`, `get_full_diagnostic_report`).
- The 50-line head cap will reduce token usage; if you previously relied on the 300-line scan implicitly, use `get_saas_smells` for the deeper pass.
