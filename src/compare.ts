import * as fs from "fs/promises";
import { LangEntry, LangFileEntry, StringRecord } from "./types";

export interface CompareResult {
  missing: LangEntry[];
  extra: LangEntry[];
}

/**
 * Extract all dot-notation paths from a nested object
 */
export function extractPaths(obj: unknown, prefix = ""): StringRecord {
  const paths: StringRecord = {};

  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    if (prefix) {
      paths[prefix] = String(obj);
    }
    return paths;
  }

  for (const key of Object.keys(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const value = (obj as Record<string, unknown>)[key];

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(paths, extractPaths(value, fullPath));
    } else {
      paths[fullPath] = String(value);
    }
  }

  return paths;
}

/**
 * Compare base and target JSON files
 * @returns {Object} { missing: {path: baseValue}, extra: {path: targetValue} }
 */
export async function compareFiles(
  source: LangFileEntry,
  target: LangFileEntry,
): Promise<CompareResult> {
  const [souceContent, targetContent] = await Promise.all([
    fs.readFile(source.path, "utf-8"),
    fs.readFile(target.path, "utf-8"),
  ]);

  const baseJson = JSON.parse(souceContent);
  const targetJson = JSON.parse(targetContent);

  const basePaths = extractPaths(baseJson);
  const targetPaths = extractPaths(targetJson);

  const missing: Record<string, LangEntry> = {};
  const extra: Record<string, LangEntry> = {};

  // Keys in base but not in target
  for (const path of Object.keys(basePaths)) {
    if (!(path in targetPaths)) {
      missing[path] = {
        key: path,
        value: basePaths[path],
      };
    }
  }

  // Keys in target but not in base
  for (const path of Object.keys(targetPaths)) {
    if (!(path in basePaths)) {
      extra[path] = {
        key: path,
        value: targetPaths[path],
      };
    }
  }

  return { missing: Object.values(missing), extra: Object.values(extra) };
}
