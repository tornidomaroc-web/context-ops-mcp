import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/** Head-of-file line cap for symbol extraction and orientation heuristics. */
export const SEMANTIC_LINE_LIMIT = 50;

/** Deeper line cap used by smell scans (security regex, debt markers). */
export const SMELL_SCAN_LIMIT = 500;

export type LineAnalysis = {
  exports: string[];
  keyFunctions: string[];
};

export function analyzeTypeScriptLines(lines: string[]): LineAnalysis {
  return runTypeScriptAnalysis(lines);
}

export function analyzeJsonLines(lines: string[]): LineAnalysis {
  return runJsonAnalysis(lines);
}

export async function readFirstLines(absPath: string, maxLines: number): Promise<string[]> {
  const stream = createReadStream(absPath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const lines: string[] = [];
  try {
    for await (const line of rl) {
      lines.push(line);
      if (lines.length >= maxLines) break;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return lines;
}

/**
 * Whole-file streaming pass that reports which lowercase keywords appear anywhere
 * in the file. Exits early when every keyword has been seen. Used by the relevance
 * heuristic to find code past the head-of-file read window.
 */
export async function streamFileForKeywords(
  absPath: string,
  keywords: string[]
): Promise<Set<string>> {
  const found = new Set<string>();
  const needles = keywords.map((k) => k.toLowerCase());
  if (needles.length === 0) return found;

  const stream = createReadStream(absPath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const lower = line.toLowerCase();
      for (const kw of needles) {
        if (!found.has(kw) && lower.includes(kw)) {
          found.add(kw);
        }
      }
      if (found.size === needles.length) break;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return found;
}

function parseExportClause(clause: string): string[] {
  const names: string[] = [];
  for (const part of clause.split(",")) {
    const segment = part.trim();
    if (!segment) continue;
    const withoutType = segment.replace(/^type\s+/, "");
    const name = withoutType.split(/\s+as\s+/)[0]?.trim();
    if (name && /^[\w$]+$/.test(name)) names.push(name);
  }
  return names;
}

function runTypeScriptAnalysis(lines: string[]): LineAnalysis {
  const exportNames = new Set<string>();
  const functionNames = new Set<string>();

  const addExport = (name: string): void => {
    exportNames.add(name);
  };

  const addFn = (name: string): void => {
    if (name) functionNames.add(name);
  };

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    let m: RegExpMatchArray | null;

    m = trimmed.match(/^export\s+default\s+function\s+(\w+)/);
    if (m?.[1]) {
      addExport(`default function ${m[1]}`);
      addFn(m[1]);
      continue;
    }
    m = trimmed.match(/^export\s+default\s+class\s+(\w+)/);
    if (m?.[1]) {
      addExport(`default class ${m[1]}`);
      continue;
    }
    m = trimmed.match(/^export\s+default\s+const\s+(\w+)/);
    if (m?.[1]) {
      addExport(`default const ${m[1]}`);
      continue;
    }

    m = trimmed.match(/^export\s+async\s+function\s+(\w+)/);
    if (m?.[1]) {
      addExport(m[1]);
      addFn(m[1]);
      continue;
    }
    m = trimmed.match(/^export\s+function\s+(\w+)/);
    if (m?.[1]) {
      addExport(m[1]);
      addFn(m[1]);
      continue;
    }
    m = trimmed.match(/^export\s+class\s+(\w+)/);
    if (m?.[1]) {
      addExport(m[1]);
      continue;
    }
    m = trimmed.match(/^export\s+interface\s+(\w+)/);
    if (m?.[1]) {
      addExport(`interface ${m[1]}`);
      continue;
    }
    m = trimmed.match(/^export\s+type\s+([\w$]+)/);
    if (m?.[1]) {
      addExport(`type ${m[1]}`);
      continue;
    }
    m = trimmed.match(/^export\s+(?:const|let|var)\s+(\w+)/);
    if (m?.[1]) {
      addExport(m[1]);
      continue;
    }

    m = trimmed.match(/^export\s*\{\s*([^}]+)\}\s*from\s+['"]([^'"]+)['"]/);
    if (m?.[1] && m[2] !== undefined) {
      const from = m[2];
      for (const n of parseExportClause(m[1])) addExport(`${n} ← ${from}`);
      continue;
    }
    m = trimmed.match(/^export\s*\{\s*([^}]+)\s*\}/);
    if (m?.[1]) {
      for (const n of parseExportClause(m[1])) addExport(n);
      continue;
    }
    m = trimmed.match(/^export\s+\*\s+from\s+['"]([^'"]+)['"]/);
    if (m?.[1]) {
      addExport(`* from '${m[1]}'`);
      continue;
    }

    m = trimmed.match(/^function\s+(\w+)\s*\(/);
    if (m?.[1]) {
      addFn(m[1]);
      continue;
    }
    m = trimmed.match(/^async\s+function\s+(\w+)\s*\(/);
    if (m?.[1]) {
      addFn(m[1]);
      continue;
    }
    m = trimmed.match(/^const\s+(\w+)\s*=\s*(?:async\s*)?\(/);
    if (m?.[1]) {
      addFn(m[1]);
    }
  }

  return {
    exports: [...exportNames].sort(),
    keyFunctions: [...functionNames].sort(),
  };
}

function runJsonAnalysis(lines: string[]): LineAnalysis {
  const keyFunctions: string[] = [];
  const exportHints: string[] = [];
  const seen = new Set<string>();
  let depth = 0;

  for (const line of lines) {
    const m = line.match(/^\s*"([^"]+)"\s*:/);
    const key = m?.[1];
    if (key !== undefined && depth === 1 && !seen.has(key)) {
      seen.add(key);
      keyFunctions.push(key);
      if (key === "exports") exportHints.push('field "exports" (see file)');
    }
    for (const c of line) {
      if (c === "{") depth++;
      else if (c === "}") depth = Math.max(0, depth - 1);
    }
  }

  return {
    exports: exportHints,
    keyFunctions: keyFunctions.sort(),
  };
}
