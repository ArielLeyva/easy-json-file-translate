import * as fs from "fs/promises";
import * as path from "path";
import { CliOptions, Lang, LangFileEntries, LangFileEntry } from "./types";
import { getLangByCode, inferLang } from "./translate";

/**
 * Resolve which JSON files should be considered as translation targets.
 *
 * Rules:
 *  - If `-f/--file` is omitted: use the directory of the base file and list
 *    every `*.json` there (excluding the base file itself).
 *  - If `-f/--file` is a directory: list every `*.json` inside it (excluding
 *    the base file if it lives in the same dir).
 *  - If `-f/--file` is a file: use that file as the only candidate.
 *
 * For each candidate, language is inferred from the filename. When inference
 * fails, `lang` is left undefined so the CLI can prompt the user.
 */
export default async function getFiles(
  opts: CliOptions,
): Promise<LangFileEntries> {
  const basePath = path.resolve(opts.base);

  // Verify base exists
  try {
    const baseStat = await fs.stat(basePath);
    if (!baseStat.isFile()) {
      throw new Error(
        `Base path is not a file: ${basePath}. Use -b/--base with a JSON file.`,
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Base file not found: ${basePath}`);
    }
    throw err;
  }

  const baseName = path.basename(basePath);
  const sourceLang = getLangByCode(opts.sourceLang) || inferLang(baseName);

  const source: LangFileEntry = {
    name: baseName,
    path: basePath,
    lang: sourceLang || undefined,
    entries: [],
    missing: [],
  };

  const candidatePaths = await resolveTargetCandidates(opts, basePath);
  const targets: LangFileEntry[] = candidatePaths.map((filePath) => {
    const name = path.basename(filePath);
    const inferred = getLangByCode(opts.lang) || inferLang(name);
    return {
      name,
      path: filePath,
      lang: inferred || undefined,
      entries: [],
      missing: [],
    } as LangFileEntry;
  });

  return { source, targets };
}

/**
 * Resolve the list of target file paths based on CLI options.
 *
 * Returns the resolved absolute paths. The caller is responsible for
 * verifying that at least one target was found and that each target is
 * actually a file.
 */
async function resolveTargetCandidates(
  opts: CliOptions,
  basePath: string,
): Promise<string[]> {
  const baseName = path.basename(basePath);
  const baseDir = path.dirname(basePath);

  // Case 1: --file not provided → use base file's directory
  if (!opts.file || opts.file.trim() === "") {
    return listJsonFiles(baseDir, baseName);
  }

  const targetPath = path.resolve(opts.file);

  // Case 2: --file is a directory → list *.json there
  let stat;
  try {
    stat = await fs.stat(targetPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Target path not found: ${targetPath}`);
    }
    throw err;
  }

  if (stat.isDirectory()) {
    return listJsonFiles(targetPath, baseName);
  }

  // Case 3: --file is a single file
  if (stat.isFile()) {
    if (path.resolve(targetPath) === path.resolve(basePath)) {
      throw new Error(
        `Target file is the same as the base file: ${targetPath}`,
      );
    }
    return [targetPath];
  }

  throw new Error(
    `Target path is neither a file nor a directory: ${targetPath}`,
  );
}

/**
 * List every `*.json` file inside `dirPath`, sorted alphabetically,
 * optionally excluding a specific filename (typically the base file).
 */
export async function listJsonFiles(
  dirPath: string,
  excludeName?: string,
): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Directory not found: ${dirPath}`);
    }
    throw err;
  }

  const files = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".json"))
    .map((e) => path.join(dirPath, e.name))
    .sort();

  if (excludeName) {
    return files.filter((p) => path.basename(p) !== excludeName);
  }
  return files;
}

/**
 * Set a value in a nested object using dot-notation path
 */
export function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: string,
): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
}
