import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  analyzeJsonLines,
  analyzeTypeScriptLines,
  readFirstLines,
  SEMANTIC_LINE_LIMIT,
} from "./analyzer.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const IGNORED_DIRS = new Set(["node_modules", ".git", "dist"]);

export const MCP_SERVER_NAME = "context-ops-mcp";
export const MCP_SERVER_VERSION = "1.0.0";

export type ProjectStructure = {
  root: string;
  directories: string[];
  files: string[];
};

export type SemanticFileKind = "typescript" | "json";

export type SemanticFileEntry = {
  kind: SemanticFileKind;
  linesRead: number;
  exports: string[];
  keyFunctions: string[];
};

export type SemanticSummary = {
  root: string;
  linesPerFile: number;
  ignoredDirectories: string[];
  fileCount: number;
  files: Record<string, SemanticFileEntry>;
};

export async function scanProjectStructure(rootDir: string): Promise<ProjectStructure> {
  return runScanProjectStructure(rootDir);
}

export async function collectTsAndJsonFiles(rootDir: string): Promise<string[]> {
  return runCollectTsAndJsonFiles(rootDir);
}

export async function buildSemanticSummary(rootDir: string): Promise<SemanticSummary> {
  return runBuildSemanticSummary(rootDir);
}

function runScanProjectStructure(rootDir: string): Promise<ProjectStructure> {
  const directories: string[] = [];
  const files: string[] = [];

  async function walk(absDir: string, relPrefix: string): Promise<void> {
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relPrefix ? path.join(relPrefix, entry.name) : entry.name;
      const abs = path.join(absDir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        directories.push(rel);
        await walk(abs, rel);
      } else {
        files.push(rel);
      }
    }
  }

  return (async () => {
    await walk(rootDir, "");
    directories.sort();
    files.sort();
    return {
      root: rootDir,
      directories,
      files,
    };
  })();
}

function runCollectTsAndJsonFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(absDir: string, relPrefix: string): Promise<void> {
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relPrefix ? path.join(relPrefix, entry.name) : entry.name;
      const abs = path.join(absDir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(abs, rel);
      } else if (entry.isFile()) {
        if (
          entry.name.endsWith(".ts") ||
          entry.name.endsWith(".tsx") ||
          entry.name.endsWith(".json")
        ) {
          out.push(rel);
        }
      }
    }
  }

  return (async () => {
    await walk(rootDir, "");
    out.sort();
    return out;
  })();
}

const ENTRY_FILE_NAMES = new Set(["index.ts", "app.ts", "server.ts", "main.ts"]);
const SERVER_FOLDER_PARTS = new Set(["routes", "api", "controllers"]);

type EntryPointRow = { file: string; reason: string };

function runCollectTsFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(absDir: string, relPrefix: string): Promise<void> {
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relPrefix ? path.join(relPrefix, entry.name) : entry.name;
      const abs = path.join(absDir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(abs, rel);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ) {
        out.push(rel);
      }
    }
  }

  return (async () => {
    await walk(rootDir, "");
    out.sort();
    return out;
  })();
}

async function runFindEntryPoints(rootDir: string): Promise<{ entryPoints: EntryPointRow[] }> {
  const relPaths = await runCollectTsFiles(rootDir);
  const merged = new Map<string, Set<string>>();

  const add = (rel: string, reason: string): void => {
    const posix = rel.split(path.sep).join("/");
    let set = merged.get(posix);
    if (!set) {
      set = new Set();
      merged.set(posix, set);
    }
    set.add(reason);
  };

  for (const rel of relPaths) {
    const base = path.basename(rel);
    const posixRel = rel.split(path.sep).join("/");
    const segments = posixRel.split("/");

    if (ENTRY_FILE_NAMES.has(base)) {
      add(rel, "Possible application entry file");
    }

    for (const seg of segments) {
      if (SERVER_FOLDER_PARTS.has(seg.toLowerCase())) {
        add(rel, "Inside routes, api, or controllers folder");
        break;
      }
    }

    const abs = path.join(rootDir, rel);
    let lines: string[] = [];
    try {
      lines = await readFirstLines(abs, SEMANTIC_LINE_LIMIT);
    } catch {
      continue;
    }
    const head = lines.join("\n");

    if (
      /from\s+["'](?:node:)?https?["']/.test(head) ||
      /\brequire\s*\(\s*["'](?:node:)?https?["']\s*\)/.test(head)
    ) {
      add(rel, "Imports http or https");
    }
    if (/from\s+["']express["']/.test(head) || /\brequire\s*\(\s*["']express["']\s*\)/.test(head)) {
      add(rel, "Imports express");
    }
    if (/from\s+["']fastify["']/.test(head) || /\brequire\s*\(\s*["']fastify["']\s*\)/.test(head)) {
      add(rel, "Imports fastify");
    }

    if (
      /\.listen\s*\(/.test(head) ||
      /createServer\s*\(/.test(head) ||
      /\bfastify\s*\(\s*\{/.test(head) ||
      /\.use\s*\(/.test(head) ||
      /registerTool\s*\(/.test(head) ||
      /\.register\s*\(/.test(head)
    ) {
      add(rel, "Possible app bootstrap or route/tool registration");
    }
  }

  const entryPoints: EntryPointRow[] = [...merged.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, reasons]) => ({
      file,
      reason: [...reasons].sort().join("; "),
    }));

  return { entryPoints };
}

type RelevantFileRow = { file: string; reason: string };

function taskKeywords(task: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of task.toLowerCase().split(/[^a-z0-9]+/g)) {
    const w = raw.trim();
    if (w.length < 2) continue;
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

async function runFindRelevantFilesForTask(
  rootDir: string,
  task: string
): Promise<{ relevantFiles: RelevantFileRow[] }> {
  const kws = taskKeywords(task);
  if (kws.length === 0) {
    return { relevantFiles: [] };
  }

  const tsFiles = await runCollectTsFiles(rootDir);
  const scored: { file: string; score: number; matched: string[] }[] = [];

  for (const rel of tsFiles) {
    const posix = rel.split(path.sep).join("/");
    const base = path.basename(rel, ".ts").toLowerCase();
    const pathParts = posix.toLowerCase().split("/").map((p) => p.replace(/\.ts$/i, ""));

    const abs = path.join(rootDir, rel);
    let lines: string[] = [];
    try {
      lines = await readFirstLines(abs, SEMANTIC_LINE_LIMIT);
    } catch {
      continue;
    }
    const analyzed = analyzeTypeScriptLines(lines);

    let score = 0;
    const matched = new Set<string>();

    for (const kw of kws) {
      let hit = false;
      if (base === kw || (kw.length > 2 && base.includes(kw))) {
        score += 5;
        matched.add(kw);
        continue;
      }
      for (const part of pathParts) {
        if (part === kw || (kw.length > 2 && part.includes(kw))) {
          score += 3;
          matched.add(kw);
          hit = true;
          break;
        }
      }
      if (hit) continue;

      for (const fn of analyzed.keyFunctions) {
        const f = fn.toLowerCase();
        if (f === kw || (kw.length > 2 && f.includes(kw))) {
          score += 3;
          matched.add(kw);
          hit = true;
          break;
        }
      }
      if (hit) continue;

      for (const ex of analyzed.exports) {
        const e = ex.toLowerCase();
        if (e.includes(kw)) {
          score += 2;
          matched.add(kw);
          hit = true;
          break;
        }
      }
      if (hit) continue;

      const blob = `${posix} ${analyzed.exports.join(" ")} ${analyzed.keyFunctions.join(" ")}`.toLowerCase();
      if (blob.includes(kw)) {
        score += 1;
        matched.add(kw);
      }
    }

    if (score > 0) {
      scored.push({
        file: posix,
        score,
        matched: [...matched].sort(),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

  const top = scored.slice(0, 10);

  const relevantFiles: RelevantFileRow[] = top.map((s) => ({
    file: s.file,
    reason: `Matches task keywords: ${s.matched.join(", ")}`,
  }));

  return { relevantFiles };
}

type ExecutionPlanStep = {
  step: number;
  file: string;
  reason: string;
  action: "read" | "modify" | "inspect";
  reasonChain: string;
};

type ExecutionPlanAvoidRow = { file: string; reason: string };

type ExecutionPlanResult = {
  executionPlan: ExecutionPlanStep[];
  avoid: ExecutionPlanAvoidRow[];
};

type ShallowFileContext = {
  exports: string[];
  keyFunctions: string[];
  head: string;
};

async function loadShallowFileContext(
  rootDir: string,
  relativePosix: string
): Promise<ShallowFileContext | null> {
  const rel = relativePosix.split("/").join(path.sep);
  const abs = path.join(rootDir, rel);
  try {
    const lines = await readFirstLines(abs, SEMANTIC_LINE_LIMIT);
    const analyzed = analyzeTypeScriptLines(lines);
    return {
      exports: analyzed.exports,
      keyFunctions: analyzed.keyFunctions,
      head: lines.join("\n"),
    };
  } catch {
    return null;
  }
}

function inferPathFlowRoles(filePosix: string): string[] {
  const roles: string[] = [];
  const segments = filePosix.split("/");
  for (const seg of segments) {
    const s = seg.toLowerCase().replace(/\.ts$/i, "");
    if (s.includes("route")) roles.push("routing / route handlers");
    if (s.includes("controller")) roles.push("controllers");
    if (s.includes("service")) roles.push("services / business logic");
    if (s.includes("middleware")) roles.push("middleware");
    if (s === "api" || s.endsWith("api")) roles.push("API layer");
    if (s.includes("model") || s.includes("entity")) roles.push("models / entities");
    if (s.includes("util") || s.includes("helper")) roles.push("shared utilities");
  }
  return [...new Set(roles)];
}

function describeExportSurface(ctx: ShallowFileContext | null): string {
  if (!ctx) {
    return "Could not read file head; treat export/role hints as unknown until opened.";
  }
  const chunks: string[] = [];
  if (ctx.exports.length > 0) {
    const sample = ctx.exports.slice(0, 8).join(", ");
    const extra = ctx.exports.length > 8 ? ` (and ${ctx.exports.length - 8} more symbols)` : "";
    chunks.push(`Top-of-file exports suggest a public surface: ${sample}${extra}.`);
  }
  if (ctx.keyFunctions.length > 0) {
    const sample = ctx.keyFunctions.slice(0, 6).join(", ");
    const extra = ctx.keyFunctions.length > 6 ? ` (+${ctx.keyFunctions.length - 6} names)` : "";
    chunks.push(`Declared-style functions near the top: ${sample}${extra} — often the units you extend or call.`);
  }
  if (chunks.length === 0) {
    return "Few exports/functions in the first 50 lines; logic may live deeper (classes, nested declarations, or re-exports).";
  }
  return chunks.join(" ");
}

function headLikelyImportsFromPrior(head: string, priorStem: string): boolean {
  const h = head.toLowerCase();
  const stem = priorStem.toLowerCase().replace(/\.ts$/i, "");
  if (!stem) return false;
  return (
    h.includes(`from "./${stem}"`) ||
    h.includes(`from './${stem}'`) ||
    h.includes(`from "../${stem}"`) ||
    h.includes(`from '../${stem}'`) ||
    h.includes(`from "../../${stem}"`) ||
    h.includes(`/"${stem}"`) ||
    h.includes(`/'${stem}'`) ||
    h.includes(`/${stem}.js"`) ||
    h.includes(`/${stem}.js'`)
  );
}

function buildStepReasonChain(opts: {
  stepIndex: number;
  file: string;
  action: "read" | "modify" | "inspect";
  prevFile: string | null;
  prevStem: string | null;
  ctx: ShallowFileContext | null;
}): string {
  const { stepIndex, file, action, prevFile, prevStem, ctx } = opts;
  const flowRoles = inferPathFlowRoles(file);
  const exportNarrative = describeExportSurface(ctx);

  const parts: string[] = [];

  if (stepIndex === 1) {
    parts.push(
      "Opening move: inspect how the process boots and which modules are wired first — downstream steps assume you understand this spine."
    );
  } else if (prevFile) {
    let bridge = `Follows ${prevFile}: expect deeper wiring or feature code than the previous step, not duplicate boilerplate.`;
    if (prevStem && ctx && headLikelyImportsFromPrior(ctx.head, prevStem)) {
      bridge = `Likely chain: ${prevFile} (prior step) appears imported/referenced from this file's head — flow probably goes ${prevStem} → ${path.basename(file)}.`;
    }
    parts.push(bridge);
  }

  if (flowRoles.length > 0) {
    parts.push(`Directory/name heuristic: ${flowRoles.join("; ")} — infer request/feature flow touches this layer.`);
  }

  if (action === "modify") {
    parts.push(
      "Suggested edit focus: first high-relevance file for the task; validate against callers (previous steps) before shipping."
    );
  } else if (action === "read") {
    parts.push("Read/supporting pass: confirm side effects and shared types before changing the primary target.");
  } else {
    parts.push(
      "Inspect-only: map imports and side effects so later modify/read steps do not break startup or registration order."
    );
  }

  parts.push(exportNarrative);

  return parts.filter((p) => p.length > 0).join(" ");
}

async function runExecutionPlanForTask(rootDir: string, task: string): Promise<ExecutionPlanResult> {
  const [entryResult, relevantResult, riskyResult] = await Promise.all([
    runFindEntryPoints(rootDir),
    runFindRelevantFilesForTask(rootDir, task),
    runFindRiskyFiles(rootDir),
  ]);

  const executionPlan: ExecutionPlanStep[] = [];
  const inPlan = new Set<string>();
  let stepNum = 1;
  let prevFile: string | null = null;
  let prevStem: string | null = null;

  for (const ep of entryResult.entryPoints) {
    if (inPlan.has(ep.file)) continue;
    inPlan.add(ep.file);
    const ctx = await loadShallowFileContext(rootDir, ep.file);
    executionPlan.push({
      step: stepNum,
      file: ep.file,
      reason: `Entry point: ${ep.reason}`,
      action: "inspect",
      reasonChain: buildStepReasonChain({
        stepIndex: stepNum,
        file: ep.file,
        action: "inspect",
        prevFile,
        prevStem,
        ctx,
      }),
    });
    prevFile = ep.file;
    prevStem = path.basename(ep.file, ".ts");
    stepNum++;
  }

  let modifyAssigned = false;
  for (const rf of relevantResult.relevantFiles) {
    if (inPlan.has(rf.file)) continue;
    inPlan.add(rf.file);
    const action: "read" | "modify" = modifyAssigned ? "read" : "modify";
    modifyAssigned = true;
    const ctx = await loadShallowFileContext(rootDir, rf.file);
    executionPlan.push({
      step: stepNum,
      file: rf.file,
      reason: rf.reason,
      action,
      reasonChain: buildStepReasonChain({
        stepIndex: stepNum,
        file: rf.file,
        action,
        prevFile,
        prevStem,
        ctx,
      }),
    });
    prevFile = rf.file;
    prevStem = path.basename(rf.file, ".ts");
    stepNum++;
  }

  const avoid: ExecutionPlanAvoidRow[] = riskyResult.riskyFiles.map((r) => ({
    file: r.file,
    reason: r.reason,
  }));

  return { executionPlan, avoid };
}

const RISKY_PATH_MARKERS = [
  "auth",
  "config",
  "env",
  "db",
  "database",
  "migration",
  "server",
  "index",
  "core",
];

type RiskyFileRow = { file: string; reason: string };

async function runFindRiskyFiles(rootDir: string): Promise<{ riskyFiles: RiskyFileRow[] }> {
  const tsFiles = await runCollectTsFiles(rootDir);
  const merged = new Map<string, Set<string>>();

  const add = (rel: string, reason: string): void => {
    const posix = rel.split(path.sep).join("/");
    let set = merged.get(posix);
    if (!set) {
      set = new Set();
      merged.set(posix, set);
    }
    set.add(reason);
  };

  for (const rel of tsFiles) {
    const posix = rel.split(path.sep).join("/");
    const base = path.basename(rel, ".ts").toLowerCase();
    const segments = posix.toLowerCase().split("/");

    for (const marker of RISKY_PATH_MARKERS) {
      const baseHit = base.includes(marker);
      const segHit = segments.some((seg) => seg.replace(/\.ts$/i, "").includes(marker));
      if (baseHit || segHit) {
        add(rel, `Filename or path segment matches "${marker}"`);
      }
    }

    const abs = path.join(rootDir, rel);
    let lines: string[] = [];
    try {
      lines = await readFirstLines(abs, SEMANTIC_LINE_LIMIT);
    } catch {
      continue;
    }
    const head = lines.join("\n").toLowerCase();

    if (/\bprocess\.env\b/.test(head)) {
      add(rel, "Uses process.env (secrets/config risk)");
    }

    if (
      /from\s+["'][^"']*pg\b[^"']*["']/.test(head) ||
      /from\s+["']mysql2["']/.test(head) ||
      /from\s+["']mongodb["']/.test(head) ||
      /from\s+["']mongoose["']/.test(head) ||
      /from\s+["']@prisma\/client["']/.test(head) ||
      /from\s+["']drizzle-orm["']/.test(head) ||
      /from\s+["']knex["']/.test(head) ||
      /from\s+["']typeorm["']/.test(head) ||
      /from\s+["']ioredis["']/.test(head) ||
      /from\s+["']redis["']/.test(head) ||
      /from\s+["']better-sqlite3["']/.test(head) ||
      /from\s+["']@libsql\/client["']/.test(head) ||
      /from\s+["']sequelize["']/.test(head)
    ) {
      add(rel, "Imports database or persistence client");
    }

    if (
      /from\s+["']passport["']/.test(head) ||
      /from\s+["']jsonwebtoken["']/.test(head) ||
      /from\s+["']jose["']/.test(head) ||
      /from\s+["']bcrypt["']/.test(head) ||
      /from\s+["']bcryptjs["']/.test(head) ||
      /from\s+["']next-auth/.test(head) ||
      /from\s+["']@auth\//.test(head) ||
      /from\s+["']better-auth["']/.test(head) ||
      /from\s+["']@clerk\//.test(head) ||
      /from\s+["']@supabase\//.test(head)
    ) {
      add(rel, "Imports auth or security-related library");
    }

    if (/from\s+["']express["']/.test(head) || /from\s+["']fastify["']/.test(head)) {
      add(rel, "Imports express or fastify (HTTP bootstrap)");
    }

    if (
      /\.listen\s*\(/.test(head) ||
      /createServer\s*\(/.test(head) ||
      /\bfastify\s*\(\s*\{/.test(head) ||
      /\bnew\s+mcpServer\s*\(/.test(head) ||
      /registerTool\s*\(/.test(head) ||
      /\.connect\s*\(\s*transport/.test(head)
    ) {
      add(rel, "Possible app or server startup / central orchestration");
    }
  }

  const riskyFiles: RiskyFileRow[] = [...merged.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, reasons]) => ({
      file,
      reason: [...reasons].sort().join("; "),
    }));

  return { riskyFiles };
}

type ConfigFileRow = { file: string; reason: string };

function classifyConfigReasons(posixPath: string): string[] {
  const reasons: string[] = [];
  const segments = posixPath.split("/");
  const base = segments[segments.length - 1] ?? posixPath;
  const lower = posixPath.toLowerCase();
  const lowerBase = base.toLowerCase();

  if (base === "package.json") reasons.push("Node.js package / npm manifest");
  if (base === "package-lock.json") reasons.push("npm lockfile");
  if (base === "pnpm-lock.yaml" || base === "yarn.lock" || base === "bun.lockb") {
    reasons.push("Package manager lockfile");
  }

  if (/^tsconfig(\..*)?\.json$/i.test(base) || lowerBase === "jsconfig.json") {
    reasons.push("TypeScript project configuration file");
  }

  if (base === ".env" || /^\.env\./.test(base)) reasons.push("Environment variables file");

  if (/\.config\.(ts|js|mjs|cjs)$/i.test(base)) {
    reasons.push("Tooling *.config.(ts|js|mjs|cjs) file");
  }

  if (/^vite\.config\./i.test(base)) reasons.push("Vite configuration");
  if (/^next\.config\./i.test(base)) reasons.push("Next.js configuration");
  if (/^eslint\.config\./i.test(base)) reasons.push("ESLint configuration");
  if (/^prettier\.config\./i.test(base)) reasons.push("Prettier configuration");
  if (/^tailwind\.config\./i.test(base)) reasons.push("Tailwind configuration");
  if (/^jest\.config\./i.test(base)) reasons.push("Jest configuration");
  if (/^vitest\.config\./i.test(base)) reasons.push("Vitest configuration");
  if (/^postcss\.config\./i.test(base)) reasons.push("PostCSS configuration");
  if (/^webpack\.config\./i.test(base)) reasons.push("Webpack configuration");

  if (/^docker-compose\./i.test(base)) reasons.push("Docker Compose file");
  if (/^dockerfile$/i.test(base) || /^dockerfile\./i.test(base)) reasons.push("Dockerfile");

  if (lower.endsWith("prisma/schema.prisma") || lower.includes("prisma/schema.prisma")) {
    reasons.push("Prisma schema");
  }

  if (lower.includes(".github/workflows/") && /\.(ya?ml|yaml)$/.test(lowerBase)) {
    reasons.push("GitHub Actions workflow");
  }
  if (lowerBase === ".gitlab-ci.yml") reasons.push("GitLab CI configuration");
  if (lowerBase === "azure-pipelines.yml" || lowerBase === "azure-pipelines.yaml") {
    reasons.push("Azure Pipelines configuration");
  }
  if (lowerBase === "jenkinsfile") reasons.push("Jenkins pipeline file");

  if (lowerBase === ".npmrc") reasons.push("npm configuration");
  if (lowerBase === ".nvmrc" || lowerBase === ".node-version") reasons.push("Node version pin");
  if (lowerBase === "biome.json" || lowerBase === "biome.jsonc") reasons.push("Biome configuration");
  if (lowerBase === "deno.json" || lowerBase === "deno.jsonc") reasons.push("Deno configuration");
  if (lowerBase === ".editorconfig") reasons.push("EditorConfig");

  if (/^\.prettierrc/i.test(base) || lowerBase === "prettierrc.json") {
    reasons.push("Prettier rc file");
  }
  if (/^\.eslintrc/i.test(base)) reasons.push("ESLint rc file");

  return reasons;
}

async function runFindLikelyConfigFiles(rootDir: string): Promise<{ configFiles: ConfigFileRow[] }> {
  const allFiles: string[] = [];

  async function walk(absDir: string, relPrefix: string): Promise<void> {
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relPrefix ? path.join(relPrefix, entry.name) : entry.name;
      const abs = path.join(absDir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(abs, rel);
      } else if (entry.isFile()) {
        allFiles.push(rel);
      }
    }
  }

  await walk(rootDir, "");
  allFiles.sort();

  const configFiles: ConfigFileRow[] = [];

  for (const rel of allFiles) {
    const posix = rel.split(path.sep).join("/");
    const reasons = classifyConfigReasons(posix);
    if (reasons.length === 0) continue;
    const unique = [...new Set(reasons)].sort();
    configFiles.push({
      file: posix,
      reason: unique.join("; "),
    });
  }

  return { configFiles };
}

/** All relative file paths under root (posix), skipping IGNORED_DIRS. */
async function collectFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(absDir: string, relPrefix: string): Promise<void> {
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relPrefix ? path.join(relPrefix, entry.name) : entry.name;
      const abs = path.join(absDir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(abs, rel);
      } else if (entry.isFile()) {
        out.push(rel.split(path.sep).join("/"));
      }
    }
  }

  await walk(rootDir, "");
  out.sort();
  return out;
}

async function runBuildSemanticSummary(rootDir: string): Promise<SemanticSummary> {
  const relPaths = await runCollectTsAndJsonFiles(rootDir);
  const files: Record<string, SemanticFileEntry> = {};

  for (const rel of relPaths) {
    const abs = path.join(rootDir, rel);
    let lines: string[] = [];
    try {
      lines = await readFirstLines(abs, SEMANTIC_LINE_LIMIT);
    } catch {
      files[rel] = {
        kind: rel.endsWith(".json") ? "json" : "typescript",
        linesRead: 0,
        exports: [],
        keyFunctions: [],
      };
      continue;
    }

    const kind: SemanticFileKind = rel.endsWith(".json") ? "json" : "typescript";
    const analyzed =
      kind === "json" ? analyzeJsonLines(lines) : analyzeTypeScriptLines(lines);

    files[rel] = {
      kind,
      linesRead: lines.length,
      exports: analyzed.exports,
      keyFunctions: analyzed.keyFunctions,
    };
  }

  return {
    root: rootDir,
    linesPerFile: SEMANTIC_LINE_LIMIT,
    ignoredDirectories: [...IGNORED_DIRS],
    fileCount: relPaths.length,
    files,
  };
}

const server = new McpServer({
  name: MCP_SERVER_NAME,
  version: MCP_SERVER_VERSION,
});

server.registerTool(
  "get_project_structure",
  {
    description:
      "Recursively scans the process working directory and returns sorted lists of relative directory and file paths (skips node_modules, .git, dist).",
    inputSchema: {
      rootDir: z.string().optional().describe("Absolute path to target project. Defaults to process.cwd()"),
    },
  },
  async ({ rootDir }) => {
    const targetDir = rootDir ?? process.cwd();
    const structure = await runScanProjectStructure(targetDir);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(structure, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "get_semantic_summary",
  {
    description:
      "Reads the first 50 lines of each .ts and .json file (excluding node_modules and dist), detects exports and key functions (TypeScript) or top-level JSON keys, and returns a structured map of project logic.",
    inputSchema: {
      rootDir: z
        .string()
        .optional()
        .describe("Absolute path to target project root. Defaults to process.cwd()"),
    },
  },
  async ({ rootDir }) => {
    const summary = await runBuildSemanticSummary(rootDir ?? process.cwd());
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "get_entry_points",
  {
    description:
      "Heuristic scan of .ts files (skips node_modules, .git, dist): common entry filenames, routes/api/controllers folders, express/fastify/http imports, and bootstrap/route-registration cues in the first 50 lines per file.",
    inputSchema: {
      rootDir: z
        .string()
        .optional()
        .describe("Absolute path to target project root. Defaults to process.cwd()"),
    },
  },
  async ({ rootDir }) => {
    const result = await runFindEntryPoints(rootDir ?? process.cwd());
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "get_relevant_files_for_task",
  {
    description:
      "Given a short task description, returns up to 10 ranked .ts files using filename/path, exports, key functions, and keyword overlap on the first 50 lines (no AI).",
    inputSchema: {
      task: z.string().min(1).describe("Short natural-language coding task (e.g. what you want to change or investigate)"),
      rootDir: z
        .string()
        .optional()
        .describe("Absolute path to target project root. Defaults to process.cwd()"),
    },
  },
  async ({ task, rootDir }) => {
    const result = await runFindRelevantFilesForTask(rootDir ?? process.cwd(), task);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "get_execution_plan_for_task",
  {
    description:
      "Given a task string, merges entry-point hints, ranked relevant .ts files, and risky file list into a suggested step order (inspect → first modify candidate → further reads) plus an avoid/caution list from risk heuristics.",
    inputSchema: {
      task: z.string().min(1).describe("Coding task to plan against (same style as get_relevant_files_for_task)"),
      rootDir: z
        .string()
        .optional()
        .describe("Absolute path to target project root. Defaults to process.cwd()"),
    },
  },
  async ({ task, rootDir }) => {
    const result = await runExecutionPlanForTask(rootDir ?? process.cwd(), task);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "get_risky_files",
  {
    description:
      "Heuristic list of .ts files that may be sensitive to change: risky path/name segments, process.env, DB/auth imports, HTTP frameworks, or startup/orchestration patterns (first 50 lines; skips node_modules, .git, dist).",
    inputSchema: {
      rootDir: z
        .string()
        .optional()
        .describe("Absolute path to target project root. Defaults to process.cwd()"),
    },
  },
  async ({ rootDir }) => {
    const result = await runFindRiskyFiles(rootDir ?? process.cwd());
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "get_likely_config_files",
  {
    description:
      "Lists files that look like configuration, env, build, or CI/setup artifacts (heuristic filename/path patterns; skips node_modules, .git, dist).",
    inputSchema: {
      rootDir: z
        .string()
        .optional()
        .describe("Absolute path to target project root. Defaults to process.cwd()"),
    },
  },
  async ({ rootDir }) => {
    const result = await runFindLikelyConfigFiles(rootDir ?? process.cwd());
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

const REVENUE_DIAGNOSIS_SYSTEM = `You are a SaaS revenue analyst. Analyze the codebase and identify the TOP 3 revenue friction points. For each, respond in this exact format:

FRICTION #1
SEVERITY: [HIGH/MEDIUM/LOW]
FRICTION POINT: [one sentence]
WHY IT COSTS MONEY: [one sentence]
EVIDENCE IN CODE: [file names only, comma separated]
RECOMMENDED FIX: [one sentence]

FRICTION #2
SEVERITY: [HIGH/MEDIUM/LOW]
FRICTION POINT: [one sentence]
WHY IT COSTS MONEY: [one sentence]
EVIDENCE IN CODE: [file names only, comma separated]
RECOMMENDED FIX: [one sentence]

FRICTION #3
SEVERITY: [HIGH/MEDIUM/LOW]
FRICTION POINT: [one sentence]
WHY IT COSTS MONEY: [one sentence]
EVIDENCE IN CODE: [file names only, comma separated]
RECOMMENDED FIX: [one sentence]

OVERALL REVENUE HEALTH: [one sentence summary]`;

server.registerTool(
  "get_revenue_diagnosis",
  {
    description:
      "Runs entry-point, task-relevance, and risk scans, then asks Claude to name one SaaS revenue friction point from the codebase map. Requires ANTHROPIC_API_KEY.",
    inputSchema: {
      task: z.string().min(1).describe("Coding task to plan against (same style as get_relevant_files_for_task)"),
      rootDir: z
        .string()
        .optional()
        .describe("Absolute path to target project root. Defaults to process.cwd()"),
    },
  },
  async ({ task, rootDir }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    console.error("DEBUG KEY:", process.env.ANTHROPIC_API_KEY ? "FOUND" : "NOT FOUND");
    console.error("DEBUG ENV KEYS:", Object.keys(process.env).filter((k) => k.includes("ANTHROPIC")));
    if (!apiKey) {
      return {
        content: [{ type: "text", text: "Error: ANTHROPIC_API_KEY is not set." }],
      };
    }

    const targetDir = rootDir ?? process.cwd();
    const [entryResult, relevantResult, _riskyResult] = await Promise.all([
      runFindEntryPoints(targetDir),
      runFindRelevantFilesForTask(targetDir, task),
      runFindRiskyFiles(targetDir),
    ]);

    const { readFirstLinesCached: readFirstLines } = await import("./analyzer.js");
    const fileContents: string[] = [];
    const topFiles = relevantResult.relevantFiles.slice(0, 5);
    for (const rf of topFiles) {
      const abs = path.join(targetDir, rf.file.split("/").join(path.sep));
      try {
        const lines = await readFirstLines(abs, 150);
        fileContents.push(`=== ${rf.file} ===\n${lines.join("\n")}`);
      } catch {
        fileContents.push(`=== ${rf.file} === (unreadable)`);
      }
    }

    const entryLines = entryResult.entryPoints.map((e) => `- ${e.file}: ${e.reason}`).join("\n");
    const relevantLines = relevantResult.relevantFiles
      .map((r) => `- ${r.file}: ${r.reason}`)
      .join("\n");

    const diagnosisPrompt = [
      `Task: ${task}`,
      "",
      "Entry points:",
      entryLines.length > 0 ? entryLines : "(none)",
      "",
      "Relevant files:",
      relevantLines.length > 0 ? relevantLines : "(none)",
      "",
      "File contents (first 150 lines each):",
      fileContents.length > 0 ? fileContents.join("\n\n") : "(none)",
    ].join("\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 2048,
        system: REVENUE_DIAGNOSIS_SYSTEM,
        messages: [{ role: "user", content: diagnosisPrompt }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return {
        content: [
          {
            type: "text",
            text: `Anthropic API error ${res.status}: ${errBody}`,
          },
        ],
      };
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const textBlock = data.content?.find((b) => b.type === "text");
    const text = textBlock?.text ?? "Error: No text content in API response.";

    return {
      content: [{ type: "text", text }],
    };
  }
);

server.registerTool(
  "get_billing_audit",
  {
    description:
      "Scans the codebase for billing and payment code. Reports: billing files found, payment provider detected, paywall enforcement gaps, and missing billing best practices. Requires no API key.",
    inputSchema: {
      rootDir: z
        .string()
        .optional()
        .describe("Absolute path to target project root. Defaults to process.cwd()"),
    },
  },
  async ({ rootDir }) => {
    const targetDir = rootDir ?? process.cwd();
    const { readFirstLinesCached: readFirstLines } = await import("./analyzer.js");

    const BILLING_KEYWORDS = [
      "stripe",
      "lemon",
      "paddle",
      "billing",
      "subscription",
      "payment",
      "checkout",
      "invoice",
      "plan",
      "pricing",
      "webhook",
      "upgrade",
      "paywall",
      "trial",
      "cancel",
    ];

    const allFiles = await collectFiles(targetDir);
    const billingFiles: Array<{ file: string; hits: string[] }> = [];

    for (const f of allFiles) {
      const abs = path.join(targetDir, f.split("/").join(path.sep));
      let lines: string[] = [];
      try {
        lines = await readFirstLines(abs, 300);
      } catch {
        continue;
      }
      const content = lines.join("\n").toLowerCase();
      const hits = BILLING_KEYWORDS.filter((k) => content.includes(k));
      if (hits.length > 0) billingFiles.push({ file: f, hits });
    }

    const provider = billingFiles.some((bf) => bf.hits.includes("stripe"))
      ? "Stripe"
      : billingFiles.some((bf) => bf.hits.includes("lemon"))
        ? "Lemon Squeezy"
        : billingFiles.some((bf) => bf.hits.includes("paddle"))
          ? "Paddle"
          : "Unknown";

    const hasWebhook = billingFiles.some((bf) => bf.hits.includes("webhook"));
    const hasPaywall = billingFiles.some(
      (bf) => bf.hits.includes("paywall") || bf.hits.includes("plan")
    );
    const hasTrial = billingFiles.some((bf) => bf.hits.includes("trial"));

    const gaps: string[] = [];
    if (!hasWebhook) gaps.push("⚠️  No webhook handler found — subscription events may be missed");
    if (!hasPaywall) gaps.push("⚠️  No paywall enforcement detected — paid features may be exposed");
    if (!hasTrial) gaps.push("⚠️  No trial logic found — missing conversion opportunity");

    const report = [
      `BILLING AUDIT REPORT`,
      `====================`,
      `Payment Provider: ${provider}`,
      `Billing Files Found: ${billingFiles.length}`,
      ``,
      `FILES:`,
      ...billingFiles.map((bf) => `  ${bf.file} [${bf.hits.join(", ")}]`),
      ``,
      `GAPS:`,
      ...(gaps.length > 0 ? gaps : ["✅ No critical gaps detected"]),
    ].join("\n");

    return { content: [{ type: "text", text: report }] };
  }
);

server.registerTool(
  "get_onboarding_friction",
  {
    description:
      "Analyzes user onboarding flow in the codebase. Identifies steps between signup and first value, detects missing loading states, error handling gaps, and redirect logic issues.",
    inputSchema: {
      rootDir: z
        .string()
        .optional()
        .describe("Absolute path to target project root. Defaults to process.cwd()"),
    },
  },
  async ({ rootDir }) => {
    const targetDir = rootDir ?? process.cwd();
    const { readFirstLinesCached: readFirstLines } = await import("./analyzer.js");

    const ONBOARDING_KEYWORDS = [
      "signup",
      "sign-up",
      "register",
      "onboard",
      "welcome",
      "redirect",
      "loading",
      "spinner",
      "error",
      "toast",
      "first",
      "setup",
      "wizard",
      "step",
      "complete",
    ];

    const allFiles = await collectFiles(targetDir);
    const onboardingFiles: Array<{ file: string; hits: string[]; snippet: string }> = [];

    for (const f of allFiles) {
      const abs = path.join(targetDir, f.split("/").join(path.sep));
      let lines: string[] = [];
      try {
        lines = await readFirstLines(abs, 300);
      } catch {
        continue;
      }
      const content = lines.join("\n").toLowerCase();
      const hits = ONBOARDING_KEYWORDS.filter((k) => content.includes(k));
      if (hits.length >= 2) {
        onboardingFiles.push({
          file: f,
          hits,
          snippet: lines.slice(0, 10).join("\n"),
        });
      }
    }

    const hasLoading = onboardingFiles.some(
      (of) => of.hits.includes("loading") || of.hits.includes("spinner")
    );
    const hasErrorHandling = onboardingFiles.some(
      (of) => of.hits.includes("error") || of.hits.includes("toast")
    );
    const hasRedirect = onboardingFiles.some((of) => of.hits.includes("redirect"));
    const stepCount = onboardingFiles.filter(
      (of) => of.hits.includes("step") || of.hits.includes("wizard")
    ).length;

    const issues: string[] = [];
    if (!hasLoading) issues.push("⚠️  No loading states in onboarding — users may see blank screens");
    if (!hasErrorHandling) issues.push("⚠️  No error feedback in onboarding — silent failures lose users");
    if (!hasRedirect) issues.push("⚠️  No redirect logic found — users may be lost after signup");
    if (stepCount > 3)
      issues.push(`⚠️  ${stepCount} onboarding steps detected — consider reducing friction`);

    const report = [
      `ONBOARDING FRICTION REPORT`,
      `==========================`,
      `Onboarding Files Found: ${onboardingFiles.length}`,
      `Multi-step Flow: ${stepCount > 0 ? `Yes (${stepCount} steps)` : "No"}`,
      `Has Loading States: ${hasLoading ? "✅" : "❌"}`,
      `Has Error Handling: ${hasErrorHandling ? "✅" : "❌"}`,
      `Has Redirect Logic: ${hasRedirect ? "✅" : "❌"}`,
      ``,
      `FILES:`,
      ...onboardingFiles.map((of) => `  ${of.file} [${of.hits.join(", ")}]`),
      ``,
      `ISSUES:`,
      ...(issues.length > 0 ? issues : ["✅ No critical onboarding issues detected"]),
    ].join("\n");

    return { content: [{ type: "text", text: report }] };
  }
);

server.registerTool(
  "get_competitive_gaps",
  {
    description:
      "Compares the codebase against SaaS best practices checklist. Returns a scored gap report: what is present, what is missing, and a READINESS score out of 100.",
    inputSchema: {
      rootDir: z
        .string()
        .optional()
        .describe("Absolute path to target project root. Defaults to process.cwd()"),
      format: z
        .enum(["text", "json"])
        .optional()
        .default("text")
        .describe("Output format. 'json' returns structured data."),
    },
  },
  async ({ rootDir, format }) => {
    const targetDir = rootDir ?? process.cwd();
    const { readFirstLinesCached: readFirstLines } = await import("./analyzer.js");
    const allFiles = await collectFiles(targetDir);

    const CHECKLIST: Array<{ id: string; label: string; keywords: string[]; weight: number }> = [
      { id: "auth", label: "Authentication", keywords: ["auth", "login", "session", "jwt", "cookie"], weight: 15 },
      { id: "billing", label: "Billing / Payments", keywords: ["stripe", "lemon", "paddle", "subscription", "plan"], weight: 15 },
      { id: "error", label: "Error Handling", keywords: ["error", "catch", "toast", "sentry", "logger"], weight: 10 },
      { id: "loading", label: "Loading States", keywords: ["loading", "spinner", "skeleton", "suspense"], weight: 10 },
      { id: "ratelimit", label: "Rate Limiting", keywords: ["ratelimit", "rate-limit", "throttle", "limiter"], weight: 10 },
      { id: "analytics", label: "Analytics / Tracking", keywords: ["analytics", "posthog", "mixpanel", "segment", "gtag"], weight: 10 },
      { id: "email", label: "Email / Notifications", keywords: ["email", "resend", "sendgrid", "nodemailer", "smtp"], weight: 10 },
      { id: "tests", label: "Tests", keywords: ["test", "spec", "jest", "vitest", "describe"], weight: 10 },
      { id: "envconfig", label: "Env / Config", keywords: [".env", "process.env", "dotenv", "config"], weight: 5 },
      { id: "docs", label: "Documentation", keywords: ["readme", "docs", "changelog", "contributing"], weight: 5 },
    ];

    const allContent = new Map<string, string>();
    for (const f of allFiles) {
      const abs = path.join(targetDir, f.split("/").join(path.sep));
      try {
        const lines = await readFirstLines(abs, 300);
        allContent.set(f, lines.join("\n").toLowerCase());
      } catch {
        /* skip */
      }
    }
    const combinedContent = [...allContent.values()].join("\n");

    const results = CHECKLIST.map((item) => {
      const found = item.keywords.some((k) => combinedContent.includes(k));
      return { ...item, found };
    });

    const score = results.reduce((sum, r) => sum + (r.found ? r.weight : 0), 0);
    const present = results.filter((r) => r.found);
    const missing = results.filter((r) => !r.found);

    if (format === "json") {
      const output = {
        readiness_score: score,
        present: present.map((r) => ({ id: r.id, label: r.label, weight: r.weight })),
        missing: missing.map((r) => ({ id: r.id, label: r.label, weight: r.weight })),
      };
      return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
    }

    const lines = [
      `COMPETITIVE GAPS REPORT`,
      `=======================`,
      `READINESS SCORE: ${score}/100`,
      ``,
      `✅ PRESENT (${present.length}):`,
      ...present.map((r) => `  [+${r.weight}] ${r.label}`),
      ``,
      `❌ MISSING (${missing.length}):`,
      ...missing.map((r) => `  [-${r.weight}] ${r.label}`),
      ``,
      `PRIORITY FIX: ${missing.sort((a, b) => b.weight - a.weight)[0]?.label ?? "None — fully ready!"}`,
    ];

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

/** Connected MCP server (tools registered). */
export { server };
