import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  analyzeJsonLines,
  analyzeTypeScriptLines,
  readFirstLines,
  SEMANTIC_LINE_LIMIT,
  SMELL_SCAN_LIMIT,
  streamFileForKeywords,
} from "./analyzer.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".turbo",
  ".svelte-kit",
  ".vercel",
  ".cache",
  "coverage",
  "build",
  "out",
]);

export const MCP_SERVER_NAME = "context-ops-mcp";
export const MCP_SERVER_VERSION = "2.1.0";

const toPosix = (p: string): string => p.split(path.sep).join("/");

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

/** One entry yielded by {@link walkTree}. `rel` uses the platform path
 * separator; callers POSIX-normalize as needed. */
type WalkEntry = {
  rel: string;
  name: string;
  isDir: boolean;
  isFile: boolean;
};

/**
 * Single source of truth for the recursive, IGNORED_DIRS-aware directory walk
 * shared by every scanner. Yields each visited child: non-ignored directories
 * (then recurses into them) and every non-directory entry. Callers apply their
 * own file-type/extension predicate and path normalization. Traversal order is
 * unspecified — every caller sorts its own result, so order here is irrelevant.
 */
async function* walkTree(rootDir: string): AsyncGenerator<WalkEntry> {
  async function* recurse(absDir: string, relPrefix: string): AsyncGenerator<WalkEntry> {
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relPrefix ? path.join(relPrefix, entry.name) : entry.name;
      const abs = path.join(absDir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        yield { rel, name: entry.name, isDir: true, isFile: false };
        yield* recurse(abs, rel);
      } else {
        yield { rel, name: entry.name, isDir: false, isFile: entry.isFile() };
      }
    }
  }
  yield* recurse(rootDir, "");
}

function runScanProjectStructure(rootDir: string): Promise<ProjectStructure> {
  return (async () => {
    const directories: string[] = [];
    const files: string[] = [];
    // Note: any non-directory entry (not just regular files) counts as a file
    // here — this scanner deliberately has no isFile() guard, unlike the others.
    for await (const entry of walkTree(rootDir)) {
      if (entry.isDir) directories.push(toPosix(entry.rel));
      else files.push(toPosix(entry.rel));
    }
    directories.sort();
    files.sort();
    return {
      root: toPosix(rootDir),
      directories,
      files,
    };
  })();
}

function runCollectTsAndJsonFiles(rootDir: string): Promise<string[]> {
  return (async () => {
    const out: string[] = [];
    for await (const entry of walkTree(rootDir)) {
      if (
        entry.isFile &&
        (entry.name.endsWith(".ts") ||
          entry.name.endsWith(".tsx") ||
          entry.name.endsWith(".json"))
      ) {
        out.push(toPosix(entry.rel));
      }
    }
    out.sort();
    return out;
  })();
}

const ENTRY_FILE_NAMES = new Set(["index.ts", "app.ts", "server.ts", "main.ts"]);
const SERVER_FOLDER_PARTS = new Set(["routes", "api", "controllers"]);

type EntryPointRow = { file: string; reason: string };

function runCollectTsFiles(rootDir: string): Promise<string[]> {
  return (async () => {
    const out: string[] = [];
    for await (const entry of walkTree(rootDir)) {
      if (entry.isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
        out.push(toPosix(entry.rel));
      }
    }
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

    const unmatched = kws.filter((k) => !matched.has(k));
    if (unmatched.length > 0) {
      try {
        const wholeFileHits = await streamFileForKeywords(abs, unmatched);
        for (const kw of wholeFileHits) {
          score += 1;
          matched.add(kw);
        }
      } catch {
        /* skip — file became unreadable mid-scan */
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
  truncated: {
    entryPointsTotal: number;
    entryPointsShown: number;
    avoidTotal: number;
    avoidShown: number;
  };
};

/** Max entry-point steps surfaced in the plan. Above this, the rest is elided
 * and reported via `truncated`. Tuned for agent attention: 15 + up to 10
 * relevance-ranked files = ~25 plan steps fit on one screen. */
const EXECUTION_PLAN_ENTRY_POINT_CAP = 15;

/** Max avoid-list entries. Above this, the rest is elided and reported. */
const EXECUTION_PLAN_AVOID_CAP = 30;

/** Priority score for an entry point: higher = surfaced first when capped.
 * Filename-anchored reasons (index.ts/app.ts/server.ts/main.ts) beat
 * folder-only matches, which beat HTTP imports, which beat bootstrap cues.
 * Within the same tier, shallower paths win, then alphabetical. */
function entryPointPriority(file: string, reason: string): number {
  let score = 0;
  if (reason.includes("Possible application entry file")) score += 1000;
  if (reason.includes("bootstrap")) score += 100;
  if (reason.includes("express") || reason.includes("fastify") || reason.includes("http or https")) score += 50;
  if (reason.includes("routes, api, or controllers")) score += 10;
  const depth = file.split("/").length;
  score -= depth;
  return score;
}

/** Priority for a risky file: more risk markers in the reason = higher rank. */
function riskyFilePriority(reason: string): number {
  return reason.split(";").length;
}

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
    return `Few exports/functions in the first ${SEMANTIC_LINE_LIMIT} lines; logic may live deeper (classes, nested declarations, or re-exports).`;
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

  const entryPointsTotal = entryResult.entryPoints.length;
  const avoidTotal = riskyResult.riskyFiles.length;

  const prioritizedEntries = [...entryResult.entryPoints]
    .sort((a, b) => {
      const pa = entryPointPriority(a.file, a.reason);
      const pb = entryPointPriority(b.file, b.reason);
      return pb - pa || a.file.localeCompare(b.file);
    })
    .slice(0, EXECUTION_PLAN_ENTRY_POINT_CAP);

  const executionPlan: ExecutionPlanStep[] = [];
  const inPlan = new Set<string>();
  let stepNum = 1;
  let prevFile: string | null = null;
  let prevStem: string | null = null;

  for (const ep of prioritizedEntries) {
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

  const avoid: ExecutionPlanAvoidRow[] = [...riskyResult.riskyFiles]
    .sort((a, b) => {
      const pa = riskyFilePriority(a.reason);
      const pb = riskyFilePriority(b.reason);
      return pb - pa || a.file.localeCompare(b.file);
    })
    .slice(0, EXECUTION_PLAN_AVOID_CAP)
    .map((r) => ({ file: r.file, reason: r.reason }));

  return {
    executionPlan,
    avoid,
    truncated: {
      entryPointsTotal,
      entryPointsShown: Math.min(entryPointsTotal, EXECUTION_PLAN_ENTRY_POINT_CAP),
      avoidTotal,
      avoidShown: Math.min(avoidTotal, EXECUTION_PLAN_AVOID_CAP),
    },
  };
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
  // Collected with native separators and sorted before POSIX-normalizing,
  // preserving this scanner's original ordering (differs from the others,
  // which sort POSIX-normalized paths).
  const allFiles: string[] = [];
  for await (const entry of walkTree(rootDir)) {
    if (entry.isFile) allFiles.push(entry.rel);
  }
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
  for await (const entry of walkTree(rootDir)) {
    if (entry.isFile) out.push(toPosix(entry.rel));
  }
  out.sort();
  return out;
}

async function runBuildSemanticSummary(rootDir: string): Promise<SemanticSummary> {
  const relPaths = await runCollectTsAndJsonFiles(rootDir);
  const files: Record<string, SemanticFileEntry> = {};

  for (const rel of relPaths) {
    const abs = path.join(rootDir, rel.split("/").join(path.sep));
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
    root: toPosix(rootDir),
    linesPerFile: SEMANTIC_LINE_LIMIT,
    ignoredDirectories: [...IGNORED_DIRS],
    fileCount: relPaths.length,
    files,
  };
}

// ─── SAAS SMELLS SCANNER ─────────────────────────────────────────────────────
// Observation-only. No scores out of 100. No hour estimates. No severity ranking.
// Each smell is a single (file, line, category, observation) tuple. The consumer
// — an AI agent or a human reviewing — decides what's worth acting on.

type SmellCategory =
  | "billing"
  | "auth"
  | "security"
  | "type-safety"
  | "debt-marker"
  | "dependency-risk";

type Smell = {
  category: SmellCategory;
  file: string;
  line: number | null;
  observation: string;
  snippet: string;
};

type SaasSmellsReport = {
  rootDir: string;
  lineCapPerFile: number;
  totalSmells: number;
  byCategory: Record<SmellCategory, number>;
  smells: Smell[];
  notes: string[];
};

const SECURITY_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly observation: string }> = [
  { pattern: /(?:password|passwd)\s*[:=]\s*["'][^"']{4,}["']/i, observation: "Hardcoded password string literal" },
  { pattern: /(?:api[_-]?key|secret[_-]?key)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i, observation: "Hardcoded API key or secret literal" },
  { pattern: /(?:sk-|sk_live_|pk_live_|rk_live_)[A-Za-z0-9]{20,}/, observation: "Stripe or OpenAI key pattern in source" },
  { pattern: /\beval\s*\(/, observation: "eval() — arbitrary code execution" },
  { pattern: /new\s+Function\s*\(/, observation: "new Function() — arbitrary code execution" },
  { pattern: /dangerouslySetInnerHTML/, observation: "dangerouslySetInnerHTML — XSS vector if unsanitized" },
  { pattern: /\.innerHTML\s*=/, observation: "Direct innerHTML write — XSS vector if unsanitized" },
  { pattern: /(?:child_process|execSync)\b/, observation: "Shell execution — confirm inputs are sanitized" },
  { pattern: /query\s*\+\s*["']|["']\s*\+\s*\w+.*(?:WHERE|FROM|INTO|SELECT)/i, observation: "String-concatenated SQL — possible injection" },
  { pattern: /cors\(\s*\)/, observation: "cors() with no options — allows all origins" },
  { pattern: /origin\s*:\s*["']\*["']/, observation: "Wildcard CORS origin" },
  { pattern: /Math\.random\s*\(\s*\)/, observation: "Math.random() — not cryptographically secure" },
];

const DEBT_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly category: SmellCategory; readonly observation: string }> = [
  { pattern: /\/\/\s*FIXME/i, category: "debt-marker", observation: "FIXME marker" },
  { pattern: /\/\/\s*HACK/i, category: "debt-marker", observation: "HACK marker" },
  { pattern: /\/\/\s*XXX/i, category: "debt-marker", observation: "XXX marker" },
  { pattern: /\/\/\s*TODO/i, category: "debt-marker", observation: "TODO marker" },
  { pattern: /:\s*any\b/, category: "type-safety", observation: "'any' type annotation" },
  { pattern: /\bas\s+any\b/, category: "type-safety", observation: "'as any' cast" },
  { pattern: /@ts-ignore/, category: "type-safety", observation: "@ts-ignore suppression" },
  { pattern: /@ts-nocheck/, category: "type-safety", observation: "@ts-nocheck (whole-file)" },
];

const BILLING_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly observation: string }> = [
  { pattern: /\bstripe\b/i, observation: "Stripe reference" },
  { pattern: /\bpaddle\b/i, observation: "Paddle reference" },
  { pattern: /\blemon[- _]?squeezy\b/i, observation: "Lemon Squeezy reference" },
  { pattern: /\bwebhook\b/i, observation: "Webhook reference" },
  { pattern: /\bsubscription\b/i, observation: "Subscription reference" },
  { pattern: /\bcheckout\b/i, observation: "Checkout reference" },
  { pattern: /\bpaywall\b/i, observation: "Paywall reference" },
  { pattern: /\btrial\b/i, observation: "Trial reference" },
];

const AUTH_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly observation: string }> = [
  { pattern: /from\s+["']passport(?:\/[^"']+)?["']/, observation: "passport import" },
  { pattern: /from\s+["']jsonwebtoken(?:\/[^"']+)?["']/, observation: "jsonwebtoken import" },
  { pattern: /from\s+["']jose(?:\/[^"']+)?["']/, observation: "jose import" },
  { pattern: /from\s+["']bcrypt(?:js)?(?:\/[^"']+)?["']/, observation: "bcrypt(js) import" },
  { pattern: /from\s+["']next-auth(?:\/[^"']+)?["']/, observation: "next-auth import" },
  { pattern: /from\s+["']@auth\/[^"']+["']/, observation: "@auth import" },
  { pattern: /from\s+["']better-auth(?:\/[^"']+)?["']/, observation: "better-auth import" },
  { pattern: /from\s+["']@better-auth\/[^"']+["']/, observation: "@better-auth import" },
  { pattern: /from\s+["']@clerk\/[^"']+["']/, observation: "@clerk import" },
  { pattern: /from\s+["']@supabase\/[^"']+["']/, observation: "@supabase import" },
  { pattern: /from\s+["']@workos-inc\/[^"']+["']/, observation: "@workos-inc import" },
  { pattern: /from\s+["']@kinde-oss\/[^"']+["']/, observation: "@kinde-oss import" },
  { pattern: /from\s+["']@stackframe\/[^"']+["']/, observation: "Stack Auth (@stackframe) import" },
  { pattern: /from\s+["']arctic(?:\/[^"']+)?["']/, observation: "arctic OAuth import" },
  { pattern: /from\s+["']oslo(?:\/[^"']+)?["']/, observation: "oslo crypto/auth utils import" },
];

const RISKY_PACKAGES: ReadonlyArray<{ readonly name: string; readonly observation: string }> = [
  { name: "moment", observation: "Deprecated by maintainer; switch to date-fns or dayjs" },
  { name: "request", observation: "Deprecated since 2020 with unpatched vulnerabilities" },
  { name: "node-fetch", observation: "Native fetch available in Node 18+" },
  { name: "jsonwebtoken", observation: "Manual JWT handling is error-prone; prefer jose" },
  { name: "sequelize", observation: "Limited TypeScript support; Prisma/Drizzle stronger" },
  { name: "gulp", observation: "Legacy tooling; modern bundlers are faster" },
  { name: "colors", observation: "Sabotaged in v1.4.1; verify pinned version" },
  { name: "faker", observation: "Original `faker` is abandoned; switch to @faker-js/faker" },
  { name: "bluebird", observation: "Native Promises are sufficient; legacy overhead" },
  { name: "tslint", observation: "Deprecated by Palantir; switch to typescript-eslint" },
  { name: "node-uuid", observation: "Renamed; use the `uuid` package" },
  { name: "node-sass", observation: "LibSass end-of-life; switch to `sass` (Dart Sass)" },
  { name: "crypto-js", observation: "Maintenance discontinued; prefer native node:crypto or @noble/*" },
  { name: "event-stream", observation: "Compromised in 2018 via flatmap-stream supply-chain attack; abandoned" },
  { name: "flatmap-stream", observation: "Malicious payload from the 2018 event-stream incident" },
  { name: "node-ipc", observation: "CVE-2022-23812 maintainer-introduced destructive protestware; trust break" },
  { name: "q", observation: "Maintainer recommends native Promises; last release 8+ years ago" },
];

async function runSaasSmellsScan(rootDir: string): Promise<SaasSmellsReport> {
  const smells: Smell[] = [];
  const notes: string[] = [];

  const allFiles = await collectFiles(rootDir);
  const codeFiles = allFiles.filter((f) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(f));

  for (const rel of codeFiles) {
    const abs = path.join(rootDir, rel.split("/").join(path.sep));
    let lines: string[] = [];
    try {
      lines = await readFirstLines(abs, SMELL_SCAN_LIMIT);
    } catch {
      continue;
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const trimmed = line.trimStart();
      const isCommentLine = trimmed.startsWith("//") || trimmed.startsWith("*");
      const snippet = line.trim().slice(0, 120);

      if (!isCommentLine) {
        for (const check of SECURITY_PATTERNS) {
          if (check.pattern.test(line)) {
            smells.push({ category: "security", file: rel, line: i + 1, observation: check.observation, snippet });
          }
        }
        for (const check of BILLING_PATTERNS) {
          if (check.pattern.test(line)) {
            smells.push({ category: "billing", file: rel, line: i + 1, observation: check.observation, snippet });
          }
        }
        for (const check of AUTH_PATTERNS) {
          if (check.pattern.test(line)) {
            smells.push({ category: "auth", file: rel, line: i + 1, observation: check.observation, snippet });
          }
        }
      }
      for (const check of DEBT_PATTERNS) {
        if (check.pattern.test(line)) {
          smells.push({ category: check.category, file: rel, line: i + 1, observation: check.observation, snippet });
        }
      }
    }
  }

  const pkgPath = path.join(rootDir, "package.json");
  try {
    const raw = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const deps = (pkg["dependencies"] as Record<string, string> | undefined) ?? {};
    const devDeps = (pkg["devDependencies"] as Record<string, string> | undefined) ?? {};
    for (const [name, version] of Object.entries({ ...deps, ...devDeps })) {
      for (const risky of RISKY_PACKAGES) {
        if (name === risky.name || name.startsWith(`${risky.name}/`)) {
          smells.push({
            category: "dependency-risk",
            file: "package.json",
            line: null,
            observation: `${risky.observation} (currently ${name}@${version})`,
            snippet: `${name}@${version}`,
          });
        }
      }
    }
  } catch {
    notes.push("Could not read package.json — dependency-risk smells skipped.");
  }

  const byCategory: Record<SmellCategory, number> = {
    billing: 0,
    auth: 0,
    security: 0,
    "type-safety": 0,
    "debt-marker": 0,
    "dependency-risk": 0,
  };
  for (const s of smells) byCategory[s.category]++;

  smells.sort((a, b) =>
    a.category.localeCompare(b.category) ||
    a.file.localeCompare(b.file) ||
    (a.line ?? 0) - (b.line ?? 0)
  );

  notes.push(
    `Smells are presence observations only — no scoring, no severity ranking, no hour estimates. You decide what matters.`,
    `Per-file line cap: ${SMELL_SCAN_LIMIT} lines. Issues past that line in any single file are not scanned by this pass.`
  );

  return {
    rootDir: toPosix(rootDir),
    lineCapPerFile: SMELL_SCAN_LIMIT,
    totalSmells: smells.length,
    byCategory,
    smells,
    notes,
  };
}


const server = new McpServer(
  {
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  },
  {
    instructions: [
      "context-ops-mcp gives an AI coding agent a bounded map of an unfamiliar TypeScript SaaS repo.",
      "All tools are heuristic — regex over file heads, filename rules, and one whole-file streaming pass in the relevance ranker. No AST. No type checker. No call graph.",
      "Default workflow: 1) get_project_structure → 2) get_likely_config_files + get_entry_points → 3) get_semantic_summary (top 50 lines per file) → 4) get_relevant_files_for_task → 5) get_execution_plan_for_task → 6) get_risky_files + get_saas_smells before edits.",
      "get_saas_smells is observation-only. It reports billing/auth/security/debt/dependency presence checks with file+line. It does not score, rank by severity, or estimate hours. Treat its output as smells to confirm, not as audits.",
      "Path outputs are POSIX-normalized. Tool outputs are JSON text blocks.",
    ].join(" "),
  }
);

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
      "Given a short task description, returns up to 10 ranked .ts files. Scoring uses filename/path, exports, and key functions extracted from the first 50 lines, plus a whole-file streaming pass that catches keyword presence past the head (no AI).",
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
      "Given a task string, merges entry-point hints, ranked relevant .ts files, and risky file list into a suggested step order (inspect → first modify candidate → further reads) plus an avoid/caution list. Plan steps are capped at 15 prioritized entry points + up to 10 relevance-ranked files; avoid list is capped at 30. The `truncated` field reports total vs shown counts on each side so you know when signal was elided (typical on large monorepos).",
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

server.registerTool(
  "get_saas_smells",
  {
    description:
      "Observation-only scan for SaaS-shaped patterns: billing references (stripe/paddle/webhook/...), auth library imports, common security regex hits (eval/innerHTML/hardcoded creds/...), debt markers (TODO/FIXME/HACK/XXX), type-safety suppressions (any/@ts-ignore), and risky dependencies in package.json. Reads up to SMELL_SCAN_LIMIT (500) lines per code file. Returns a flat list of (file, line, category, observation) tuples — no scores, no severity ranking, no hour estimates, no audit framing. Consumer decides what matters.",
    inputSchema: {
      rootDir: z
        .string()
        .optional()
        .describe("Absolute path to target project root. Defaults to process.cwd()"),
    },
  },
  async ({ rootDir }) => {
    const result = await runSaasSmellsScan(rootDir ?? process.cwd());
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

/** Programmatic equivalent of the saas-smells tool (when not connected via stdio). */
export async function findSaasSmells(rootDir: string): Promise<SaasSmellsReport> {
  return runSaasSmellsScan(rootDir);
}

/** Programmatic equivalents of MCP tools (when not connected via stdio). */
export async function findRelevantFilesForTask(
  rootDir: string,
  task: string
): Promise<{ relevantFiles: RelevantFileRow[] }> {
  return runFindRelevantFilesForTask(rootDir, task);
}

export async function findRiskyFiles(rootDir: string): Promise<{ riskyFiles: RiskyFileRow[] }> {
  return runFindRiskyFiles(rootDir);
}

/** Connected MCP server (tools registered). */
export { server };
