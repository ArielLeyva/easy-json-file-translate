#!/usr/bin/env node

import { Command } from "commander";
import { compareFiles } from "./compare";
import { translateKeys } from "./translate";
import getFiles from "./utils";
import { CliOptions, LANG_MAP, Lang, LangFileEntry } from "./types";
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
  .option("-k, --api-key <key>", "API key for the AI service")
  .option("-m, --model <name>", "Model name", "deepseek-chat")
  .option("-u, --url <url>", "API base URL", "https://api.deepseek.com/v1")
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
  const { source, targets: initialTargets } = await getFiles(opts);

  if (initialTargets.length === 0) {
    console.error(
      "\n❌ No target JSON files found. Provide -f <file|dir> or place *.json files next to the base.\n",
    );
    process.exit(1);
  }

  // 1. Multi-select targets (checkbox appears whenever there's >1 candidate,
  //    regardless of whether -f was a file, a directory, or omitted)
  const picked = await pickTargetsInteractive(initialTargets);
  if (!picked || picked.length === 0) {
    console.log("\nNo targets selected. Exiting.\n");
    return;
  }

  // 2. Resolve language for any target where it could not be inferred
  const targets = await resolveUnknownLanguages(picked);

  // 3. Confirm before processing
  const proceed = await confirmProceed(
    `Proceed with ${targets.length} target(s)?`,
    true,
  );
  if (!proceed) {
    console.log("\nCancelled.\n");
    return;
  }

  // 4. Header
  console.log("\n┌─────────────────────────────────────────────────┐");
  console.log("│  json-translate                                 │");
  console.log("└─────────────────────────────────────────────────┘");
  console.log(
    `Source: ${source.name}${source.lang ? ` (${source.lang.name}${source.lang.infer ? " (inferred)" : " (specified)"})` : " (language unknown)"}`,
  );
  console.log(`Targets: ${targets.length}`);

  if (opts.translate) {
    console.log(`Model: ${opts.model}@${opts.url}`);
  }

  const apiKey = opts.apiKey || process.env.OPENAI_API_KEY;
  let totalApplied = 0;

  // 5. Process each target
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

    if (opts.dryRun) {
      console.log("💡 Run without --dry-run to apply changes.");
      continue;
    }

    if (!opts.translate) {
      console.log("Skipping translation (--no-translate).");
      continue;
    }

    if (!apiKey) {
      console.error("No API key provided. Use -k or set OPENAI_API_KEY.");
      process.exit(1);
    }

    const translations = await translateKeys(missing, {
      apiKey,
      model: opts.model,
      url: opts.url,
      maxChars: parseInt(opts.maxChars, 10),
      target: target.lang!.name,
      source: source.lang?.name,
    });

    if (Object.keys(translations).length === 0) {
      console.log("⚠️  No translations received from API.");
      continue;
    }

    await mergeApiResults(opts, translations, missing, target.path);
    totalApplied += Object.keys(translations).length;
  }

  // 6. Final summary
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
