import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findRelevantFilesForTask } from "../src/server.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

// Regression test for the dogfood failure called out in UNIFIED_NARRATIVE P1.1
// and §4 honesty boundary #7: get_relevant_files_for_task must be able to find
// this repo's own billing logic in src/server.ts. The billing keyword/regex
// definitions live well past line 50 in that file, so the head-pass scoring
// alone returns nothing. The fix is the whole-file streaming pass via
// streamFileForKeywords. Without that fallback this assertion is the alarm.
test("findRelevantFilesForTask finds src/server.ts for task 'stripe billing'", async () => {
  const result = await findRelevantFilesForTask(REPO_ROOT, "stripe billing");

  assert.ok(
    Array.isArray(result.relevantFiles),
    "relevantFiles must be an array"
  );

  assert.ok(
    result.relevantFiles.length > 0,
    `relevantFiles must not be empty for 'stripe billing' on this repo (got: []). ` +
      `This is the dogfood regression: the whole-file fallback pass in ` +
      `runFindRelevantFilesForTask was removed or broken.`
  );

  const files = result.relevantFiles.map((r) => r.file);
  assert.ok(
    files.includes("src/server.ts"),
    `relevantFiles must include 'src/server.ts' for task 'stripe billing'. ` +
      `Got: ${JSON.stringify(files)}. ` +
      `If this fails, the whole-file streaming pass in runFindRelevantFilesForTask ` +
      `is no longer catching keywords past the first ${50} lines.`
  );
});
