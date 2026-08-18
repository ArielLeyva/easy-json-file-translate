import { CliOptions, ConfirmAnswer, LangEntry, StringRecord } from "./types";
import { setNestedValue } from "./utils";
import * as fs from "fs/promises";
import * as readline from "readline";

export async function mergeApiResults(
  opts: CliOptions,
  translations: StringRecord,
  missing: LangEntry[],
) {
  if (opts.interactive) {
    console.log("\nInteractive mode - confirm each translation:\n");
    let mode: "all" | "quit" | null = null;

    for (const [path, translatedValue] of Object.entries(translations)) {
      if (mode === "quit") break;

      for (let entry of missing) {
        if (entry.key == path) {
          if (mode === "all") {
            entry.generated = translatedValue;
            console.log(`   ${path}: ✓ (auto-approved)`);
            continue;
          }

          const answer = await askConfirm(entry, translatedValue);

          if (answer === "all") {
            entry.generated = translatedValue;
            mode = "all";
            console.log(`   ${path}: ✓ (first of auto-approved batch)`);
          } else if (answer === "quit") {
            mode = "quit";
            console.log("   Stopping...");
          } else if (answer === true) {
            entry.generated = translatedValue;
            console.log(`   ${path}: ✓`);
          } else {
            console.log(`   ${path}: ✗ (skipped)`);
          }
          break;
        }
      }
    }

    const translated = missing.filter((entry) => entry.generated != null);
    if (translated.length > 0) {
      let entries: StringRecord = {};
      for (const entry of translated) {
        entries[entry.key] = entry.generated!;
      }
      await applyMissingKeys(opts.file, entries);
      console.log(`\n✅ Applied ${translated.length} translations.\n`);
    } else {
      console.log("\n⚠️  No translations applied.\n");
    }
  } else {
    await applyMissingKeys(opts.file, translations);

    console.log("\n✅ Translations applied:");
    for (const [path, value] of Object.entries(translations)) {
      console.log(`   ${path}: "${value}"`);
    }
    console.log("");
  }
}

/**
 * Apply missing keys to target file
 */
export async function applyMissingKeys(
  targetPath: string,
  missingKeys: StringRecord,
): Promise<void> {
  const content = await fs.readFile(targetPath, "utf-8");
  const targetJson = JSON.parse(content) as Record<string, unknown>;

  for (const [path, value] of Object.entries(missingKeys)) {
    setNestedValue(targetJson, path, value);
  }

  await fs.writeFile(targetPath, JSON.stringify(targetJson, null, 2), "utf-8");
}

export async function askConfirm(
  base: LangEntry,
  translatedValue: string,
): Promise<ConfirmAnswer> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(
      `\n  ${base.key}\n    Base: "${base.value}"\n    Translate to: "${translatedValue}"\n    [y]es, [n]o, [a]ll, [q]uit: `,
      (answer) => {
        rl.close();
        const normalized = answer.toLowerCase().trim();
        if (normalized === "a") {
          resolve("all");
        } else if (normalized === "q") {
          resolve("quit");
        } else if (normalized === "y" || normalized === "s") {
          resolve(true);
        } else {
          resolve(false);
        }
      },
    );
  });
}
