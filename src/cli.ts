#!/usr/bin/env node

import { Command } from "commander";
import { compareFiles } from "./compare";
import { translateKeys } from "./translate";
import getFiles, { wasOptionProvided } from "./utils";
import { CliOptions, LANG_MAP, Lang, LangEntry, LangFileEntry } from "./types";
import { mergeApiResults } from "./merged";
import { confirmProceed, pickTargetsInteractive, resolveUnknownLanguages } from "./target";
import { loadInquirer } from "./inquire";
import { promptApiKey, promptModel, selectProviderUrl } from "./ai";

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

  // 8. Ask for URL/model/api-key, because we know there's actual work to do.
  if (!wasOptionProvided(program, "url")) {
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
    if (!wasOptionProvided(program, "model")) {
      model = (await promptModel(suggestedModel)).trim();
    }
  } else if (!wasOptionProvided(program, "model")) {
    // URL was provided but model wasn't — prompt with a generic default
    const iq = await loadInquirer();
    if (iq) {
      model = (await promptModel("gpt-4o-mini")).trim();
    } else {
      console.error(
        `\n⚠️ No model specified and no interactive terminal. Falling back to: ${model}\n`,
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
