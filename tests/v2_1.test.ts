// v2.1 regression tests.
//
// Covers the three observations resolved in v2.1.0:
//  1. get_execution_plan_for_task cap and truncated field.
//  2. AUTH_PATTERNS subpath import fix plus 5 new packages, with FP guard.
//  3. RISKY_PACKAGES blocklist expanded with sourced entries.
//
// Each test asserts both that the fix works AND that it does not overclaim
// (no false-positive matches on adversarial inputs, cap-truncation surfaced
// honestly via the `truncated` field).

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findSaasSmells, server } from "../src/server.ts";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..");
const AUTH_FIXTURE_DIR = path.join(TEST_DIR, "fixtures", "v2_1", "auth");
const DEPS_FIXTURE_DIR = path.join(TEST_DIR, "fixtures", "v2_1", "deps");

type ToolResult = { content: Array<{ type: string; text: string }> };
type RegisteredToolLike = {
  handler: (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<ToolResult>;
};

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const map = (server as unknown as { _registeredTools: Record<string, RegisteredToolLike> })._registeredTools;
  const tool = map[name];
  if (!tool) throw new Error(`tool not registered: ${name}`);
  const r = await tool.handler(args, {});
  return JSON.parse(r.content[0]!.text);
}

test("AUTH_PATTERNS catch both bare and subpath better-auth imports (bug-fix regression)", async () => {
  const result = await findSaasSmells(AUTH_FIXTURE_DIR);
  const authSmells = result.smells.filter((s) => s.category === "auth");

  const bareHits = authSmells.filter((s) => s.file.endsWith("bare.ts"));
  const subpathHits = authSmells.filter((s) => s.file.endsWith("subpath.ts"));

  assert.ok(bareHits.length >= 1, "bare.ts must produce at least one better-auth match");
  assert.ok(
    subpathHits.length >= 2,
    `subpath.ts must produce at least 2 matches (better-auth/next-js and better-auth/adapters/prisma), got ${subpathHits.length}`
  );
});

test("AUTH_PATTERNS catch each of the 5 new v2.1 packages on its fixture", async () => {
  const result = await findSaasSmells(AUTH_FIXTURE_DIR);
  const authSmells = result.smells.filter((s) => s.category === "auth");

  const expectedFiles = ["workos.ts", "kinde.ts", "stackframe.ts", "arctic.ts", "oslo.ts"];
  for (const file of expectedFiles) {
    const hits = authSmells.filter((s) => s.file.endsWith(file));
    assert.ok(hits.length >= 1, `${file} must produce at least one auth smell, got ${hits.length}`);
  }
});

test("AUTH_PATTERNS do NOT match better-auth-utils or substring mentions (FP guard)", async () => {
  const result = await findSaasSmells(AUTH_FIXTURE_DIR);
  const authSmells = result.smells.filter((s) => s.category === "auth");
  const fpHits = authSmells.filter((s) => s.file.endsWith("fp.ts"));
  assert.equal(
    fpHits.length,
    0,
    `fp.ts must produce ZERO auth smells. Hits: ${JSON.stringify(fpHits)}`
  );
});

test("RISKY_PACKAGES flag all 8 new v2.1 entries from a synthetic package.json", async () => {
  const result = await findSaasSmells(DEPS_FIXTURE_DIR);
  const depSmells = result.smells.filter((s) => s.category === "dependency-risk");

  const expectedPackages = [
    "tslint",
    "node-uuid",
    "node-sass",
    "crypto-js",
    "event-stream",
    "flatmap-stream",
    "node-ipc",
    "q",
  ];
  for (const pkg of expectedPackages) {
    const hits = depSmells.filter((s) => s.observation.includes(`(currently ${pkg}@`));
    assert.ok(
      hits.length >= 1,
      `${pkg} must trigger a dependency-risk smell. depSmells observations: ${depSmells.map((s) => s.observation).join(" | ")}`
    );
  }
});

test("get_execution_plan_for_task surfaces the `truncated` field with correct counts", async () => {
  const plan = (await callTool("get_execution_plan_for_task", {
    task: "stripe billing webhook",
    rootDir: REPO_ROOT,
  })) as {
    executionPlan: Array<{ step: number; file: string; action: string }>;
    avoid: Array<{ file: string; reason: string }>;
    truncated: { entryPointsTotal: number; entryPointsShown: number; avoidTotal: number; avoidShown: number };
  };

  assert.ok(plan.truncated, "plan must include truncated metadata");
  assert.equal(typeof plan.truncated.entryPointsTotal, "number");
  assert.equal(typeof plan.truncated.entryPointsShown, "number");
  assert.equal(typeof plan.truncated.avoidTotal, "number");
  assert.equal(typeof plan.truncated.avoidShown, "number");
  assert.ok(
    plan.truncated.entryPointsShown <= plan.truncated.entryPointsTotal,
    "shown <= total for entry points"
  );
  assert.ok(plan.truncated.avoidShown <= plan.truncated.avoidTotal, "shown <= total for avoid");
});

test("get_execution_plan_for_task caps executionPlan at 25 and avoid at 30 on any repo", async () => {
  const plan = (await callTool("get_execution_plan_for_task", {
    task: "stripe billing webhook",
    rootDir: REPO_ROOT,
  })) as {
    executionPlan: Array<{ step: number; file: string }>;
    avoid: Array<{ file: string; reason: string }>;
    truncated: { entryPointsShown: number; avoidShown: number };
  };

  // executionPlan = capped entry points (max 15) + up to 10 relevant files = 25 ceiling
  assert.ok(
    plan.executionPlan.length <= 25,
    `executionPlan must be <= 25 steps; got ${plan.executionPlan.length}`
  );
  assert.ok(plan.truncated.entryPointsShown <= 15, `entryPointsShown must be <= 15; got ${plan.truncated.entryPointsShown}`);
  assert.ok(plan.avoid.length <= 30, `avoid must be <= 30 rows; got ${plan.avoid.length}`);
  assert.ok(plan.truncated.avoidShown <= 30, `avoidShown must be <= 30; got ${plan.truncated.avoidShown}`);
});

test("MCP_SERVER_VERSION is in sync with package.json after v2.1 bump", async () => {
  const { MCP_SERVER_VERSION } = await import("../src/server.ts");
  const pkgPath = path.join(REPO_ROOT, "package.json");
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version: string };
  assert.equal(MCP_SERVER_VERSION, pkg.version, `MCP_SERVER_VERSION (${MCP_SERVER_VERSION}) must match package.json version (${pkg.version})`);
  assert.equal(MCP_SERVER_VERSION, "2.1.0", "version must be 2.1.0 in this release");
});
