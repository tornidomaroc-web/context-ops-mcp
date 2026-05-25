import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { findSaasSmells, MCP_SERVER_VERSION } from "../src/server.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const ALLOWED_CATEGORIES = new Set([
  "billing",
  "auth",
  "security",
  "type-safety",
  "debt-marker",
  "dependency-risk",
]);

const FORBIDDEN_FIELD_NAMES = new Set([
  "score",
  "hours",
  "estimatedHours",
  "grade",
  "verdict",
  "criticalCount",
  "highCount",
]);

// Walk every property name at any depth and assert it is not in the forbidden set.
function assertNoForbiddenFieldNames(value: unknown, breadcrumb: string): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertNoForbiddenFieldNames(value[i], `${breadcrumb}[${i}]`);
    }
    return;
  }
  if (typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    assert.ok(
      !FORBIDDEN_FIELD_NAMES.has(key),
      `Forbidden field name '${key}' found at ${breadcrumb}. ` +
        `findSaasSmells must remain a presence-only contract: no scoring, ` +
        `no hours, no grading, no verdicts.`
    );
    assertNoForbiddenFieldNames(obj[key], `${breadcrumb}.${key}`);
  }
}

test("findSaasSmells JSON serialization contains no 'audit' or 'score' words", async () => {
  const result = await findSaasSmells(REPO_ROOT);
  const serialized = JSON.stringify(result).toLowerCase();

  assert.ok(
    !serialized.includes("audit"),
    `findSaasSmells output must not contain the word 'audit'. ` +
      `This is honesty boundary #2 from UNIFIED_NARRATIVE: the word 'audit' ` +
      `is non-negotiably gone from this tool's surface.`
  );

  assert.ok(
    !serialized.includes("score"),
    `findSaasSmells output must not contain the word 'score'. ` +
      `This is honesty boundary #3 from UNIFIED_NARRATIVE: no /100 scores, ` +
      `no scoring framing on a presence-only scanner.`
  );
});

test("findSaasSmells has no forbidden field names at any depth", async () => {
  const result = await findSaasSmells(REPO_ROOT);
  assertNoForbiddenFieldNames(result, "$");
});

test("each smell has the required shape and a category from the allowed set", async () => {
  const result = await findSaasSmells(REPO_ROOT);

  for (let i = 0; i < result.smells.length; i++) {
    const s = result.smells[i] as Record<string, unknown>;
    assert.equal(
      typeof s.category,
      "string",
      `smell[${i}].category must be string`
    );
    assert.ok(
      ALLOWED_CATEGORIES.has(s.category as string),
      `smell[${i}].category must be one of ${[...ALLOWED_CATEGORIES].join(", ")} ` +
        `(got '${String(s.category)}')`
    );
    assert.equal(typeof s.file, "string", `smell[${i}].file must be string`);
    assert.ok(
      s.line === null || typeof s.line === "number",
      `smell[${i}].line must be number or null (got ${typeof s.line})`
    );
    assert.equal(
      typeof s.observation,
      "string",
      `smell[${i}].observation must be string`
    );
    assert.equal(
      typeof s.snippet,
      "string",
      `smell[${i}].snippet must be string`
    );

    // Explicitly forbid a 'severity' field on a smell. The honesty contract is
    // presence-only: no severity ranking. Re-introducing severity would be a
    // direct regression of UNIFIED_NARRATIVE §4 boundary #2/#3.
    assert.ok(
      !Object.prototype.hasOwnProperty.call(s, "severity"),
      `smell[${i}] must not have a 'severity' field (presence-only contract)`
    );
  }
});

test("notes array includes the phrase 'presence observations only'", async () => {
  const result = await findSaasSmells(REPO_ROOT);
  assert.ok(Array.isArray(result.notes), "notes must be an array");
  const joined = result.notes.join("\n");
  assert.ok(
    joined.includes("presence observations only"),
    `notes must include the exact phrase 'presence observations only'. ` +
      `Got notes: ${JSON.stringify(result.notes)}`
  );
});

test("byCategory uses only the 6 allowed category keys", async () => {
  const result = await findSaasSmells(REPO_ROOT);
  const keys = Object.keys(result.byCategory);
  assert.equal(
    keys.length,
    ALLOWED_CATEGORIES.size,
    `byCategory must have exactly ${ALLOWED_CATEGORIES.size} keys ` +
      `(got ${keys.length}: ${keys.join(", ")})`
  );
  for (const key of keys) {
    assert.ok(
      ALLOWED_CATEGORIES.has(key),
      `byCategory key '${key}' is not in the allowed set ` +
        `(allowed: ${[...ALLOWED_CATEGORIES].join(", ")})`
    );
  }
  for (const cat of ALLOWED_CATEGORIES) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(result.byCategory, cat),
      `byCategory must include the '${cat}' key (got: ${keys.join(", ")})`
    );
  }
});

test("lineCapPerFile equals 500", async () => {
  const result = await findSaasSmells(REPO_ROOT);
  assert.equal(
    result.lineCapPerFile,
    500,
    `lineCapPerFile must equal SMELL_SCAN_LIMIT (500), got ${result.lineCapPerFile}`
  );
});

test("MCP_SERVER_VERSION matches package.json version", () => {
  const pkgRaw = readFileSync(path.join(REPO_ROOT, "package.json"), "utf8");
  const pkg = JSON.parse(pkgRaw) as { version: string };
  assert.equal(
    typeof pkg.version,
    "string",
    "package.json must have a string version field"
  );
  assert.equal(
    MCP_SERVER_VERSION,
    pkg.version,
    `MCP_SERVER_VERSION ('${MCP_SERVER_VERSION}') must match ` +
      `package.json version ('${pkg.version}'). This is UNIFIED_NARRATIVE P0.3.`
  );
});
