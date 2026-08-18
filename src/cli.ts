#!/usr/bin/env node

import { Command } from "commander";
import { compareFiles } from "./compare";
import { translateKeys } from "./translate";
import getFiles from "./utils";
import { CliOptions } from "./types";
import { mergeApiResults } from "./merged";

const program = new Command();

program
  .name("json-translate")
  .description(
    "Compare JSON translation files and auto-translate missing keys via AI",
  )
  .version("1.0.0")
  .requiredOption(
    "-b, --base <path>",
    "Base JSON file with reference translations",
  )
  .requiredOption(
    "-f, --file <path>",
    "Target JSON file to compare and translate",
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

async function main() {
  const { source, target } = getFiles(opts);

  console.log("\n┌─────────────────────────────────────────────────┐");
  console.log("│  json-translate                                 │");
  console.log("└─────────────────────────────────────────────────┘");
  console.log(
    `Source: ${source.name} (${source.lang.name}${source.lang.infer ? " (specified)" : " (inferred)"})`,
  );
  console.log(
    `Target: ${target.name} (${target.lang.name}${target.lang.infer ? " (specified)" : " (inferred)"})`,
  );

  if (opts.translate) {
    console.log(`Model: ${opts.model}@${opts.url}`);
  }

  const { missing, extra } = await compareFiles(source, target);

  if (missing.length === 0 && extra.length === 0) {
    console.log("✅ Files are in sync!\n");
    return;
  }

  if (extra.length > 0) {
    console.log(`🟡 Extra keys in target (${extra.length}):`);
    for (const entry of extra) {
      console.log(`${entry.key}`);
    }
  }
  console.log("");

  if (missing.length === 0) {
    return;
  }

  console.log(`🔴 Missing keys in target (${missing.length}):`);
  for (const entry of missing) {
    console.log(`   ${entry.key}: "${entry.value}"`);
  }
  console.log("");

  if (opts.dryRun) {
    console.log("💡 Run without --dry-run to apply changes.\n");
    return;
  }

  // Resolve apiKey
  const apiKey = opts.apiKey || process.env.OPENAI_API_KEY;
  if (opts.translate && apiKey) {
    const translations = await translateKeys(missing, {
      apiKey,
      model: opts.model,
      url: opts.url,
      maxChars: parseInt(opts.maxChars, 10),
      target: target.lang.name,
      source: source.lang.name,
    });

    if (Object.keys(translations).length === 0) {
      console.log("⚠️  No translations received from API.\n");
      return;
    }

    mergeApiResults(opts, translations, missing);
  } else if (!opts.translate) {
    console.log("⏭️  Skipping translation (--no-translate)\n");
  } else {
    console.error("❌ No API key provided. Use -k or set OPENAI_API_KEY.\n");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n❌ Error: ${(err as Error).message}\n`);
  process.exit(1);
});
