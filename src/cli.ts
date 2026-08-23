#!/usr/bin/env node

import { Command } from "commander";
import { compareFiles } from "./compare";
import { translateKeys } from "./translate";
import getFiles from "./utils";
import { CliOptions, LANG_MAP, Lang, LangEntry, LangFileEntry } from "./types";
import { mergeApiResults } from "./merged";

const program = new Command();

program
  .name("json-translate")
  .description(
    "Compare JSON translation files and auto-translate missing keys via AI",
  )
  .version("1.0.1")
  .requiredOption(
    "-b, --base <path>",
    "Base JSON file with reference translations",
  )
  .option(
    "-f, --file <path>",
    "Target JSON file or directory. If omitted, the base file's directory is scanned for *.json files.",
  )
  .option("-k, --api-key <key>", "API key (prompts interactively if omitted)")
  .option("-m, --model <name>", "Model name (prompts interactively if omitted)", "deepseek-chat")
  .option("-u, --url <url>", "API base URL (prompts interactively if omitted)", "https://api.deepseek.com/v1")
  .option(
    "-l, --lang <code>",
    "Target language code (auto-detected from filename if omitted)",
  )
  .option(
    "-s, --source-lang <code>",
    "Source language code (auto-detected from base filename if omitted)",
  )
  .option("-c, --max-chars <n>", "Max characters per batch", "2000")
  .option("--dry-run", "Show missing keys without writing changes")
  .option("--no-translate", "Skip AI translation (just compare)")
  .option(
    "-i, --interactive",
    "Ask for confirmation before applying each translation",
  )
  .parse(process.argv);

const opts = program.opts<CliOptions>();

/**
 * @inquirer/prompts is ESM-only. The project is compiled to CJS, so we load
 * it dynamically. Falls back to non-interactive defaults when no TTY is
 * available (CI / pipes).
 */
type InquirerModule = typeof import("@inquirer/prompts");
let inquirer: InquirerModule | null = null;
async function loadInquirer(): Promise<InquirerModule | null> {
  if (inquirer) return inquirer;
  if (!process.stdin.isTTY) return null;
  try {
    inquirer = (await import("@inquirer/prompts")) as InquirerModule;
    return inquirer;
  } catch {
    return null;
  }
}

function langFromCode(code: string | undefined): Lang | null {
  if (!code) return null;
  const lower = code.toLowerCase().trim();
  const name = LANG_MAP[lower];
  if (!name) return null;
  return { code: lower, name, infer: false };
}

async function pickTargetsInteractive(
  candidates: LangFileEntry[],
): Promise<LangFileEntry[] | null> {
  // 0 or 1 candidates → nothing to multi-select, take what we have
  if (candidates.length <= 1) {
    return candidates;
  }

  const iq = await loadInquirer();
  if (!iq) {
    console.log(
      "ℹ️  No interactive terminal detected — processing all targets. Run directly (node dist/cli.js) to enable the checklist.",
    );
    return candidates;
  }

  const choices = candidates.map((t) => {
    const inferred = t.lang ? ` (${t.lang.name})` : " (language unknown)";
    return {
      name: `${t.name}${inferred}`,
      value: t.path,
      checked: true,
    };
  });

  const selected = await iq.checkbox<string>({
    message: "Select translation targets (space to toggle, enter to confirm):",
    pageSize: Math.min(choices.length + 2, 20),
    instructions: false,
    choices,
  });

  if (selected.length === 0) {
    return [];
  }

  return candidates.filter((t) => selected.includes(t.path));
}

async function resolveUnknownLanguages(
  targets: LangFileEntry[],
): Promise<LangFileEntry[]> {
  const unresolved = targets.filter((t) => !t.lang);
  if (unresolved.length === 0) return targets;

  const iq = await loadInquirer();
  const validCodes = Object.keys(LANG_MAP).join(", ");

  for (const target of targets) {
    if (target.lang) continue;

    let code: string | undefined = undefined;
    if (iq) {
      code = await iq.input({
        message: `Enter language code for "${target.name}":`,
        validate: (val: string) => {
          if (val.trim()) return true;
          return "Language code cannot be empty";
        },
      });
    } else {
      console.error(
        `\n❌ Cannot infer language for "${target.name}" and no TTY is available to prompt.`,
      );
      console.error(`   Use --lang <code> or rename the file to include one of: ${validCodes}\n`);
      process.exit(1);
    }

    const trimmedCode = code.trim();
    const lowerCode = trimmedCode.toLowerCase();
    const canonical = LANG_MAP[lowerCode];

    if (canonical) {
      target.lang = { code: lowerCode, name: canonical, infer: false };
      continue;
    }

    // Unknown code: ask the user for a display name and keep going.
    // (The no-TTY case already exited above, so iq is guaranteed here.)
    const customName = await iq!.input({
      message: `Code "${trimmedCode}" is not in the supported list. Enter the language name (e.g. "Basque"):`,
      validate: (val: string) => {
        if (val.trim()) return true;
        return "Language name cannot be empty";
      },
    });

    target.lang = { code: lowerCode, name: customName.trim(), infer: false };
  }

  return targets;
}

async function confirmProceed(message: string, fallback: boolean): Promise<boolean> {
  const iq = await loadInquirer();
  if (!iq) return fallback;
  return iq.confirm({ message, default: fallback });
}

type ProviderPreset = {
  name: string;
  url: string;
  defaultModel: string;
};

const CUSTOM_PROVIDER_VALUE = "__custom__";

/**
 * Curated list of OpenAI-compatible providers that work with translate.ts
 * (which only speaks the /chat/completions + Bearer auth + messages[] protocol).
 * Keep this list short and battle-tested — users can always pick "Other"
 * for custom endpoints.
 */
const PROVIDER_PRESETS: ProviderPreset[] = [
  { name: "DeepSeek",        url: "https://api.deepseek.com/v1",                          defaultModel: "deepseek-chat" },
  { name: "OpenAI",          url: "https://api.openai.com/v1",                             defaultModel: "gpt-4o-mini" },
  { name: "Google Gemini",   url: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "gemini-2.0-flash" },
  { name: "Groq",            url: "https://api.groq.com/openai/v1",                       defaultModel: "llama-3.3-70b-versatile" },
  { name: "OpenRouter",      url: "https://openrouter.ai/api/v1",                          defaultModel: "openai/gpt-4o-mini" },
  { name: "Mistral",         url: "https://api.mistral.ai/v1",                             defaultModel: "mistral-small-latest" },
  { name: "Ollama (local)",  url: "http://localhost:11434/v1",                             defaultModel: "llama3.2" },
];

function findPresetByUrl(url: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.url === url);
}

/**
 * Commander tracks the origin of each option value. We use that to tell
 * "user passed -u" apart from "user got the default". This is what gates
 * the interactive prompts.
 */
function wasOptionProvided(optionName: string): boolean {
  const source = program.getOptionValueSource(optionName);
  return source === "cli" || source === "env" || source === "config";
}

async function selectProviderUrl(): Promise<{ url: string; suggestedModel: string }> {
  const iq = await loadInquirer();
  if (!iq) {
    throw new Error(
      "No interactive terminal available to pick a provider URL. Pass -u <url>.",
    );
  }

  const choices = [
    ...PROVIDER_PRESETS.map((p) => ({ name: p.name, value: p.url })),
    { name: "Other (enter custom URL)", value: CUSTOM_PROVIDER_VALUE },
  ];

  const selected = await iq.select<string>({
    message: "Select the AI provider URL:",
    choices,
    pageSize: choices.length + 2,
  });

  if (selected === CUSTOM_PROVIDER_VALUE) {
    const customUrl = await iq.input({
      message: "Enter the API base URL:",
      validate: (val: string) => {
        const trimmed = val.trim();
        if (!trimmed) return "URL cannot be empty";
        try {
          new URL(trimmed);
          return true;
        } catch {
          return "Must be a valid URL (e.g. https://api.example.com/v1)";
        }
      },
    });
    return { url: customUrl.trim(), suggestedModel: "gpt-4o-mini" };
  }

  const preset = findPresetByUrl(selected);
  return {
    url: selected,
    suggestedModel: preset?.defaultModel ?? "gpt-4o-mini",
  };
}

async function promptModel(defaultModel: string): Promise<string> {
  const iq = await loadInquirer();
  if (!iq) return defaultModel;
  return iq.input({
    message: "Model name:",
    default: defaultModel,
    validate: (val: string) =>
      val.trim() ? true : "Model name cannot be empty",
  });
}

async function promptApiKey(): Promise<string> {
  const iq = await loadInquirer();
  if (!iq) {
    throw new Error(
      "No API key provided. Use -k <key> or set OPENAI_API_KEY env var.",
    );
  }
  return iq.password({
    message: "API key:",
    validate: (val: string) =>
      val.trim() ? true : "API key cannot be empty",
  });
}

function printTargetHeader(target: LangFileEntry, index: number, total: number) {
  const lang = target.lang;
  let langLabel: string;
  if (!lang) {
    langLabel = "(unknown)";
  } else {
    const isCustom = !(lang.code in LANG_MAP);
    const tag = lang.infer
      ? " (inferred)"
      : isCustom
      ? " (custom)"
      : " (specified)";
    langLabel = `${lang.name}${tag}`;
  }
  console.log("");
  console.log(
    `── Target ${index + 1}/${total}: ${target.name}  [${langLabel}] ──`,
  );
}

async function main() {
  // URL/model/api-key start with whatever the user provided (or commander
  // defaults). The actual prompt happens LATER, after the user has seen
  // what's missing — that way they don't waste time entering credentials
  // for nothing.
  let url = opts.url;
  let model = opts.model;
  let apiKey = opts.apiKey || process.env.OPENAI_API_KEY;

  // 1. Scan files
  const { source, targets: initialTargets } = await getFiles(opts);

  if (initialTargets.length === 0) {
    console.error(
      "\n❌ No target JSON files found. Provide -f <file|dir> or place *.json files next to the base.\n",
    );
    process.exit(1);
  }

  // 2. Multi-select targets (checkbox appears whenever there's >1 candidate,
  //    regardless of whether -f was a file, a directory, or omitted)
  const picked = await pickTargetsInteractive(initialTargets);
  if (!picked || picked.length === 0) {
    console.log("\nNo targets selected. Exiting.\n");
    return;
  }

  // 3. Resolve language for any target where it could not be inferred
  const targets = await resolveUnknownLanguages(picked);

  // 4. Confirm before doing any work
  const proceed = await confirmProceed(
    `Proceed with ${targets.length} target(s)?`,
    true,
  );
  if (!proceed) {
    console.log("\nCancelled.\n");
    return;
  }

  // 5. Header
  console.log("\n┌─────────────────────────────────────────────────┐");
  console.log("│  json-translate                                 │");
  console.log("└─────────────────────────────────────────────────┘");
  console.log(
    `Source: ${source.name}${source.lang ? ` (${source.lang.name}${source.lang.infer ? " (inferred)" : " (specified)"})` : " (language unknown)"}`,
  );
  console.log(`Targets: ${targets.length}`);

  // 6. First pass: compare each target, show what's missing, collect work.
  //    We don't touch the API yet — just gather everything the user needs
  //    to see before deciding whether to provide credentials.
  type TargetWork = { target: LangFileEntry; missing: LangEntry[] };
  const work: TargetWork[] = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    printTargetHeader(target, i, targets.length);

    const { missing, extra } = await compareFiles(source, target);

    if (missing.length === 0 && extra.length === 0) {
      console.log("✅ In sync with source.");
      continue;
    }

    if (extra.length > 0) {
      console.log(`🟡 Extra keys in target (${extra.length}):`);
      for (const entry of extra) {
        console.log(`   ${entry.key}`);
      }
    }

    if (missing.length === 0) {
      console.log("✅ Nothing missing.");
      continue;
    }

    console.log(`🔴 Missing keys in target (${missing.length}):`);
    for (const entry of missing) {
      console.log(`   ${entry.key}: "${entry.value}"`);
    }

    work.push({ target, missing });
  }

  // 7. Bail out if there's nothing to translate (avoids asking for creds)
  if (work.length === 0) {
    console.log("\nDone. No translations needed.\n");
    return;
  }

  if (opts.dryRun) {
    console.log("\n💡 Run without --dry-run to apply changes.\n");
    return;
  }

  if (!opts.translate) {
    console.log("\nSkipping translation (--no-translate).\n");
    return;
  }

  // 8. Now — and only now — ask for URL/model/api-key, because we know
  //    there's actual work to do.
  if (!wasOptionProvided("url")) {
    const iq = await loadInquirer();
    if (!iq) {
      console.error(
        "\n❌ No URL provided and no interactive terminal is available. Pass -u <url>.\n",
      );
      process.exit(1);
    }
    const { url: selectedUrl, suggestedModel } = await selectProviderUrl();
    url = selectedUrl;
    // If model wasn't explicitly passed either, suggest the default for this provider
    if (!wasOptionProvided("model")) {
      model = (await promptModel(suggestedModel)).trim();
    }
  } else if (!wasOptionProvided("model")) {
    // URL was provided but model wasn't — prompt with a generic default
    const iq = await loadInquirer();
    if (iq) {
      model = (await promptModel("gpt-4o-mini")).trim();
    } else {
      console.error(
        `\n⚠️  No model specified and no interactive terminal. Falling back to: ${model}\n`,
      );
    }
  }

  if (!apiKey) {
    apiKey = (await promptApiKey()).trim();
  }

  console.log(`\nUsing: ${model}@${url}`);

  // 9. Second pass: actually translate
  let totalApplied = 0;
  for (const { target, missing } of work) {
    console.log(`\n── Translating ${target.name} (${missing.length} keys) ──`);
    const translations = await translateKeys(missing, {
      // apiKey is guaranteed non-null here: either -k/env provided it, or
      // the prompt block above already set it.
      apiKey: apiKey!,
      model,
      url,
      maxChars: parseInt(opts.maxChars, 10),
      target: target.lang!.name,
      source: source.lang?.name,
    });

    if (Object.keys(translations).length === 0) {
      console.log(`⚠️  No translations received from API for ${target.name}.`);
      continue;
    }

    await mergeApiResults(opts, translations, missing, target.path);
    totalApplied += Object.keys(translations).length;
  }

  // 10. Final summary
  console.log("");
  if (totalApplied > 0) {
    console.log(`Done. Applied ${totalApplied} translation(s) across ${targets.length} target(s).`);
  } else {
    console.log("Done. No translations applied.");
  }
  console.log("");
}

main().catch((err) => {
  console.error(`\n❌ Error: ${(err as Error).message}\n`);
  process.exit(1);
});
