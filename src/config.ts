import * as fs from "node:fs";
import * as path from "node:path";
import { CliOptions, TranslateOptions } from "./types";
import { Command } from "commander";
import { wasOptionProvided } from "./utils";
import { selectProviderUrl, promptModel, promptApiKey } from "./ai";
import { loadInquirer } from "./inquire";

/**
 * Shape of the JSON config file. Every key is optional; an empty `{}` is valid.
 */
export interface ConfigOptions {
  base?: string;
  file?: string;
  model?: string;
  url?: string;
  lang?: string;
  sourceLang?: string;
  maxChars?: number | string;
  dryRun?: boolean;
  translate?: boolean;
  interactive?: boolean;
}

export const CONFIG_FILENAME = ".jsontranslaterc.json";

/**
 * Walk up from `startDir` looking for a `.jsontranslaterc.json` file.
 * Returns the absolute path of the first match, or `null` if none is found
 * before reaching the filesystem root.
 */
export function findConfigFile(
  startDir: string = process.cwd(),
): string | null {
  let current = path.resolve(startDir);
  const { root } = path.parse(current);

  while (true) {
    const candidate = path.join(current, CONFIG_FILENAME);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    if (current === root) {
      return null;
    }
    current = path.dirname(current);
  }
}

/**
 * Read and parse a config file. Throws with a clear message on bad JSON,
 * non-object roots, or read errors. Strips and warns about `apiKey` if
 * present (it must never come from the config).
 */
export function loadConfigFile(configPath: string): ConfigOptions {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch (err) {
    throw new Error(
      `Could not read config file at ${configPath}: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Config file at ${configPath} is not valid JSON: ${(err as Error).message}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Config file at ${configPath} must be a JSON object.`);
  }

  const obj = parsed as Record<string, unknown>;

  if ("apiKey" in obj) {
    console.warn(
      `⚠️  Ignoring "apiKey" in ${configPath} — API keys must come from the OPENAI_API_KEY env var or the -k flag.`,
    );
    delete obj.apiKey;
  }

  return obj as ConfigOptions;
}

export async function getTranslateOpts(
  opts: CliOptions,
  program: Command,
): Promise<TranslateOptions> {
  const translateOpts: TranslateOptions = {
    url: opts.url,
    model: opts.model,
    apiKey: opts.apiKey || process.env.OPENAI_API_KEY,
  };
  // 8. Ask for URL/model/api-key, because we know there's actual work to do.
  if (!wasOptionProvided(program, "url")) {
    const iq = await loadInquirer();
    if (!iq) {
      console.error(
        "\n❌ No URL provided and no interactive terminal is available. Pass -u <url>.\n",
      );
      process.exit(1);
    }
    const { url, suggestedModel } = await selectProviderUrl();
    translateOpts.url = url;
    // If model wasn't explicitly passed either, suggest the default for this provider
    if (!wasOptionProvided(program, "model")) {
      translateOpts.model = (await promptModel(suggestedModel)).trim();
    }
  } else if (!wasOptionProvided(program, "model")) {
    // URL was provided but model wasn't — prompt with a generic default
    const iq = await loadInquirer();
    if (iq) {
      translateOpts.model = (await promptModel("gpt-4o-mini")).trim();
    } else {
      console.error(
        `\n⚠️ No model specified and no interactive terminal. Falling back to: ${translateOpts.model}\n`,
      );
    }
  }

  if (!translateOpts.apiKey) {
    translateOpts.apiKey = (await promptApiKey()).trim();
  }

  return translateOpts;
}
