import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  scanProjectStructure,
  buildSemanticSummary,
  findRelevantFilesForTask,
  findRiskyFiles,
  findSaasSmells,
  server,
} from "../src/server.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

// Helper: invoke a registered MCP tool by name against the server export.
// The McpServer SDK stores tools on the prefix-underscore-private `_registeredTools`
// map. We invoke the registered handler directly so we exercise the same surface
// an MCP client would call, without needing a stdio transport.
type ToolResult = { content: Array<{ type: string; text: string }> };
type RegisteredToolLike = {
  handler: (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<ToolResult>;
};

function getRegisteredTool(name: string): RegisteredToolLike {
  const map = (server as unknown as { _registeredTools: Record<string, RegisteredToolLike> })
    ._registeredTools;
  const tool = map[name];
  if (!tool) {
    throw new Error(`Registered tool not found: ${name}`);
  }
  return tool;
}

async function callRegisteredTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const tool = getRegisteredTool(name);
  const result = await tool.handler(args, {});
  assert.ok(Array.isArray(result.content), `tool ${name} must return content array`);
  assert.equal(result.content[0]?.type, "text", `tool ${name} content[0] must be text`);
  const text = result.content[0]?.text;
  assert.equal(typeof text, "string", `tool ${name} content[0].text must be string`);
  return JSON.parse(text as string);
}

function assertAllStrings(arr: unknown, label: string): void {
  assert.ok(Array.isArray(arr), `${label} must be an array`);
  for (const item of arr as unknown[]) {
    assert.equal(typeof item, "string", `${label} entries must be strings`);
  }
}

function assertNoBackslashes(arr: ReadonlyArray<string>, label: string): void {
  for (const p of arr) {
    assert.ok(
      !p.includes("\\"),
      `${label} contains a backslash in path: ${p} (POSIX normalization regression)`
    );
  }
}

test("get_project_structure returns root, directories, files (all strings, POSIX)", async () => {
  const result = await scanProjectStructure(REPO_ROOT);
  assert.equal(typeof result.root, "string");
  assertAllStrings(result.directories, "directories");
  assertAllStrings(result.files, "files");
  assert.ok(result.directories.length > 0, "directories should not be empty for this repo");
  assert.ok(result.files.length > 0, "files should not be empty for this repo");
  // POSIX path regression: no backslashes anywhere in returned paths.
  assertNoBackslashes(result.directories, "directories");
  assertNoBackslashes(result.files, "files");
  assert.ok(
    !result.root.includes("\\"),
    `root contains a backslash: ${result.root} (POSIX normalization regression)`
  );
});

test("get_semantic_summary returns root, linesPerFile, ignoredDirectories, fileCount, files map", async () => {
  const result = await buildSemanticSummary(REPO_ROOT);
  assert.equal(typeof result.root, "string");
  assert.equal(typeof result.linesPerFile, "number");
  assert.equal(result.linesPerFile, 50, "linesPerFile must equal SEMANTIC_LINE_LIMIT (50)");
  assert.ok(Array.isArray(result.ignoredDirectories), "ignoredDirectories must be array");
  assert.equal(typeof result.fileCount, "number");
  assert.ok(result.fileCount > 0, "fileCount must be > 0 on this repo");
  assert.equal(typeof result.files, "object", "files must be an object map");
  assert.ok(result.files !== null, "files must not be null");
});

// UNIFIED_NARRATIVE §4 honesty boundary #9: "Path separators normalized to
// POSIX at every tool output boundary. No Windows backslashes leaking."
// runBuildSemanticSummary currently returns root: rootDir (raw input, not
// posix-normalized) and the files map is keyed off rel paths produced with
// path.join (native separators). On Windows this leaks backslashes.
// FLAGGED: this test is expected to FAIL on Windows until the bug is fixed.
test("get_semantic_summary uses POSIX-only paths in root and files map keys", async () => {
  const result = await buildSemanticSummary(REPO_ROOT);

  assert.ok(
    !result.root.includes("\\"),
    `get_semantic_summary.root must not contain backslashes (got: ${result.root}). ` +
      `UNIFIED_NARRATIVE §4 #9 requires POSIX-normalized paths at every tool ` +
      `output boundary. Fix: wrap rootDir with toPosix() in runBuildSemanticSummary.`
  );

  const offendingKeys = Object.keys(result.files).filter((k) => k.includes("\\"));
  assert.equal(
    offendingKeys.length,
    0,
    `get_semantic_summary.files map keys must not contain backslashes. ` +
      `Got ${offendingKeys.length} offending keys (first 5: ` +
      `${JSON.stringify(offendingKeys.slice(0, 5))}). ` +
      `Fix: normalize rel paths via path.sep -> "/" in runBuildSemanticSummary ` +
      `(or in runCollectTsAndJsonFiles).`
  );

  // After the fix, src/server.ts must be in the map with the POSIX key.
  assert.ok(
    Object.prototype.hasOwnProperty.call(result.files, "src/server.ts"),
    "files map should include the POSIX key 'src/server.ts'"
  );
});

test("get_entry_points returns entryPoints array of file/reason rows", async () => {
  const result = (await callRegisteredTool("get_entry_points", { rootDir: REPO_ROOT })) as {
    entryPoints: Array<{ file: string; reason: string }>;
  };
  assert.ok(Array.isArray(result.entryPoints), "entryPoints must be array");
  assert.ok(result.entryPoints.length > 0, "this repo should yield at least one entry point");
  for (const ep of result.entryPoints) {
    assert.equal(typeof ep.file, "string");
    assert.equal(typeof ep.reason, "string");
    assert.ok(!ep.file.includes("\\"), `entry point file path has backslash: ${ep.file}`);
  }
});

test("get_relevant_files_for_task with 'stripe billing' returns non-empty relevantFiles", async () => {
  // This is the dogfood regression: without the whole-file fallback pass,
  // this would have returned [] on this repo's own src/server.ts (billing
  // logic lives past line 50).
  const result = await findRelevantFilesForTask(REPO_ROOT, "stripe billing");
  assert.ok(Array.isArray(result.relevantFiles), "relevantFiles must be array");
  assert.ok(
    result.relevantFiles.length > 0,
    "relevantFiles must be non-empty for task 'stripe billing' on this repo"
  );
  for (const rf of result.relevantFiles) {
    assert.equal(typeof rf.file, "string");
    assert.equal(typeof rf.reason, "string");
  }
});

test("get_execution_plan_for_task returns executionPlan and avoid arrays", async () => {
  const result = (await callRegisteredTool("get_execution_plan_for_task", {
    rootDir: REPO_ROOT,
    task: "stripe billing",
  })) as {
    executionPlan: Array<{ step: number; file: string; reason: string; action: string; reasonChain: string }>;
    avoid: Array<{ file: string; reason: string }>;
  };
  assert.ok(Array.isArray(result.executionPlan), "executionPlan must be array");
  assert.ok(Array.isArray(result.avoid), "avoid must be array");
  assert.ok(result.executionPlan.length > 0, "executionPlan must be non-empty on this repo");
  for (const step of result.executionPlan) {
    assert.equal(typeof step.step, "number");
    assert.equal(typeof step.file, "string");
    assert.equal(typeof step.reason, "string");
    assert.equal(typeof step.action, "string");
    assert.equal(typeof step.reasonChain, "string");
    assert.ok(
      step.action === "read" || step.action === "modify" || step.action === "inspect",
      `unexpected action: ${step.action}`
    );
  }
});

test("get_risky_files returns riskyFiles array including src/server.ts", async () => {
  const result = await findRiskyFiles(REPO_ROOT);
  assert.ok(Array.isArray(result.riskyFiles), "riskyFiles must be array");
  assert.ok(result.riskyFiles.length > 0, "riskyFiles must be non-empty on this repo");
  for (const rf of result.riskyFiles) {
    assert.equal(typeof rf.file, "string");
    assert.equal(typeof rf.reason, "string");
  }
  const files = result.riskyFiles.map((r) => r.file);
  assert.ok(
    files.includes("src/server.ts"),
    `riskyFiles must include src/server.ts (got: ${files.join(", ")})`
  );
  // POSIX path regression: no backslashes in any risky-file path.
  assertNoBackslashes(files, "riskyFiles[*].file");
});

test("get_likely_config_files returns configFiles array including package.json", async () => {
  const result = (await callRegisteredTool("get_likely_config_files", {
    rootDir: REPO_ROOT,
  })) as { configFiles: Array<{ file: string; reason: string }> };
  assert.ok(Array.isArray(result.configFiles), "configFiles must be array");
  const files = result.configFiles.map((r) => r.file);
  assert.ok(
    files.includes("package.json"),
    `configFiles must include package.json (got: ${files.join(", ")})`
  );
  for (const cf of result.configFiles) {
    assert.equal(typeof cf.file, "string");
    assert.equal(typeof cf.reason, "string");
    assert.ok(!cf.file.includes("\\"), `config file path has backslash: ${cf.file}`);
  }
});

test("get_saas_smells returns rootDir, lineCapPerFile, totalSmells, byCategory, smells, notes", async () => {
  const result = await findSaasSmells(REPO_ROOT);
  assert.equal(typeof result.rootDir, "string");
  assert.equal(result.lineCapPerFile, 500, "lineCapPerFile must equal SMELL_SCAN_LIMIT (500)");
  assert.equal(typeof result.totalSmells, "number");
  assert.equal(typeof result.byCategory, "object");
  assert.ok(Array.isArray(result.smells), "smells must be array");
  assert.ok(Array.isArray(result.notes), "notes must be array");
  for (const note of result.notes) {
    assert.equal(typeof note, "string");
  }
});

test("all 8 tools are registered on the server export", async () => {
  const expected = [
    "get_project_structure",
    "get_semantic_summary",
    "get_entry_points",
    "get_relevant_files_for_task",
    "get_execution_plan_for_task",
    "get_risky_files",
    "get_likely_config_files",
    "get_saas_smells",
  ];
  const map = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
  for (const name of expected) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(map, name),
      `tool ${name} must be registered on the McpServer`
    );
  }
});
