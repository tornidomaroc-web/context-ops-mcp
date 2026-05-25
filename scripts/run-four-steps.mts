import path from "node:path";
import {
  scanProjectStructure,
  buildSemanticSummary,
  findRelevantFilesForTask,
  findRiskyFiles,
} from "../src/server.ts";

const root = process.argv[2];
if (!root) {
  console.error(
    "Usage: npx tsx scripts/run-four-steps.mts <absolute-project-root> [task-string]"
  );
  process.exit(1);
}

const task =
  process.argv[3] ??
  "billing gates, subscription logic, trial flow, payment enforcement";

console.log("=== Step 1: get_project_structure ===");
console.log(JSON.stringify(await scanProjectStructure(root), null, 2));

console.log("\n=== Step 2: get_risky_files ===");
console.log(JSON.stringify(await findRiskyFiles(root), null, 2));

console.log("\n=== Step 3: get_relevant_files_for_task ===");
console.log(JSON.stringify(await findRelevantFilesForTask(root, task), null, 2));

const { relevantFiles } = await findRelevantFilesForTask(root, task);
const top5 = relevantFiles.slice(0, 5).map((r) => r.file);

console.log("\n=== Step 4: get_semantic_summary (full project; filter top 5 from step 3) ===");
const full = await buildSemanticSummary(root);
const filtered: typeof full.files = {};
for (const f of top5) {
  const winKey = f.split("/").join(path.sep);
  const entry = full.files[f] ?? full.files[winKey];
  if (entry) filtered[f] = entry;
}
console.log(
  JSON.stringify(
    {
      root: full.root,
      linesPerFile: full.linesPerFile,
      ignoredDirectories: full.ignoredDirectories,
      fileCount: top5.length,
      files: filtered,
      note: "Subset: semantic entries for top 5 files from get_relevant_files_for_task only.",
    },
    null,
    2
  )
);
