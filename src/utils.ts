import { CliOptions, LangEntry, LangFileEntries, LangFileEntry } from "./types";
import { getLangByCode, inferLang } from "./translate";

/**
 * Resolve languages
 */
export default function getFiles(opts: CliOptions): LangFileEntries {
  // TODO (Verify file existing)

  const targetFile = opts.file.split(/[\\/]/).pop() as string;
  const baseFile = opts.base.split(/[\\/]/).pop() as string;

  const inferredTargetLang = inferLang(targetFile);
  const inferredSourceLang = inferLang(baseFile);

  const targetLang = getLangByCode(opts.lang) || inferredTargetLang;
  const sourceLang = getLangByCode(opts.sourceLang) || inferredSourceLang;

  if (!targetLang) {
    console.error("\nCould not infer target language from filename.\n");
    console.error("   Please specify --lang (e.g., --lang es, --lang fr)\n");
    process.exit(1);
  }

  return {
    source: {
      name: baseFile,
      path: opts.base,
      lang: sourceLang,
      entries: [],
      missing: [],
    } as LangFileEntry,
    target: {
      name: targetFile,
      path: opts.file,
      lang: targetLang,
      entries: [],
      missing: [],
    } as LangFileEntry,
  };
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
