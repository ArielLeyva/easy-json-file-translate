import { loadInquirer } from "./inquire";
import { LANG_MAP, LangFileEntry } from "./types";

export async function pickTargetsInteractive(
  candidates: LangFileEntry[],
): Promise<LangFileEntry[] | null> {
  if (candidates.length <= 1) {
    return candidates;
  }

  const iq = await loadInquirer();
  if (!iq) {
    console.log(
      "ℹNo interactive terminal detected — processing all targets.",
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

export async function resolveUnknownLanguages(
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

export async function confirmProceed(message: string, fallback: boolean): Promise<boolean> {
  const iq = await loadInquirer();
  if (!iq) return fallback;
  return iq.confirm({ message, default: fallback });
}