#!/usr/bin/env node

import { Command } from "commander";
import { compareFiles } from "./compare";
import { translateTargets } from "./translate";
import getFiles, { getPackageVersion, printTargetHeader } from "./utils";
import { CliOptions, TargetWork } from "./types";
import {
  confirmProceed,
  pickTargetsInteractive,
  resolveUnknownLanguages,
} from "./target";
import {
  ConfigOptions,
  findConfigFile,
  getTranslateOpts,
  loadConfigFile,
} from "./config";

const program = new Command();

program
  .name("json-translate")
  .description(
    "Compare JSON translation files and auto-translate missing keys via AI",
  )
  .version(getPackageVersion())
  .option("-b, --base <path>", "Base JSON file with reference translations")
  .option(
    "-f, --file <path>",
    "Target JSON file or directory. If omitted, the base file's directory is scanned for *.json files.",
  )
  .option("-k, --api-key <key>", "API key (prompts interactively if omitted)")
  .option(
    "-m, --model <name>",
    "Model name (prompts interactively if omitted)",
    "deepseek-chat",
  )
  .option(
    "-u, --url <url>",
    "API base URL (prompts interactively if omitted)",
    "https://api.deepseek.com/v1",
  )
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
  .option(
    "--config <path>",
    "Path to a config file. If omitted, searches for .jsontranslaterc.json in CWD and parent dirs.",
  )
  .parse(process.argv);

let opts = program.opts<CliOptions>();

// Load config file.
const configPath = opts.config || findConfigFile();
if (configPath) {
  let config: ConfigOptions;
  try {
    config = loadConfigFile(configPath);
  } catch (err) {
    console.error(`\n❌ ${(err as Error).message}\n`);
    process.exit(1);
  }
  console.log(`  Using config: ${configPath}`);

  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue;
    if (program.getOptionValueSource(key) === "cli") continue;

    const normalized =
      key === "maxChars" && typeof value !== "string" ? String(value) : value;

    program.setOptionValueWithSource(key, normalized, "config");
  }

  opts = program.opts<CliOptions>();
}

// Enforce required options after the config has been merged in
if (!opts.base) {
  console.error(
    '\n❌ Missing required option: -b, --base <path> (or set "base" in your config file)\n',
  );
  process.exit(1);
}

async function main() {
  // 1. Scan files
  const { source, targets: initialTargets } = await getFiles(opts);

  if (initialTargets.length === 0) {
    console.error(
      "\n❌ No target JSON files found. Provide -f <file|dir> or place *.json files next to the base.\n",
    );
    process.exit(1);
  }

  // 2. Multi-select targets
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

  const translateOpts = await getTranslateOpts(opts, program);
  translateOpts.source = source.lang?.name;
  console.log(`\nUsing: ${translateOpts.model}@${translateOpts.url}`);

  // 9. Second pass: actually translate
  let totalApplied = await translateTargets(opts, translateOpts, work);

  // 10. Final summary
  console.log("");
  if (totalApplied > 0) {
    console.log(
      `Done. Applied ${totalApplied} translation(s) across ${targets.length} target(s).`,
    );
  } else {
    console.log("Done. No translations applied.");
  }
  console.log("");
}

main().catch((err) => {
  console.error(`\n❌ Error: ${(err as Error).message}\n`);
  process.exit(1);
});
