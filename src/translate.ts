import { mergeApiResults } from "./merged";
import {
  Lang,
  LANG_MAP,
  LangEntry,
  TranslateOptions,
  TranslationResponse,
  StringRecord,
  CliOptions,
  TargetWork,
} from "./types";

/**
 * Infer language code from filename
 */
export function inferLang(filename: string): Lang | null {
  const name = filename.toLowerCase().replace(/[_-]/g, "");

  return getLangByCode(name);
}

export function getLangByCode(name: string | undefined): Lang | null {
  if (name == undefined) return null;
  for (const code in LANG_MAP) {
    const pattern = new RegExp(`(^|[_-])${code}($|\\.[^.]+)`);
    if (pattern.test(name)) {
      return {
        code: code,
        name: LANG_MAP[code],
        infer: true,
      };
    }
  }

  return null;
}

/**
 * Build batch of keys that fit within char limit
 */
export function buildBatches(
  keys: LangEntry[],
  maxChars: number,
): LangEntry[][] {
  const batches: LangEntry[][] = [];

  let currentChars = 0;
  let currentBatch: LangEntry[] = [];

  for (const entry of keys) {
    const count = `"${entry.key}": "${entry.value}"`.length + 1;

    if (currentChars + count > maxChars) {
      batches.push(currentBatch);
      currentBatch = [entry];
      currentChars = 0;
    } else {
      currentBatch.push(entry);
      currentChars += count;
    }
  }
  batches.push(currentBatch);

  return batches;
}

/**
 * Translate missing keys using AI
 */
export async function translateKeys(
  keys: LangEntry[],
  options: TranslateOptions,
): Promise<StringRecord> {
  const {
    apiKey,
    model = "deepseek-chat",
    url = "https://api.deepseek.com/v1",
    maxChars = 2000,
    target,
    source,
  } = options;

  if (!apiKey) {
    throw new Error("API key required. Use -k or set OPENAI_API_KEY env var.");
  }

  if (keys.length === 0) {
    return {};
  }

  const batches = buildBatches(keys, maxChars);
  const results: StringRecord = {};
  
  console.log(`\nTranslating ${keys.length} keys...`);

  let progress = 0;

  for (let i = 0; i < batches.length; i++) {
    const content = batches[i]
      .map((entry) => `  "${entry.key}": "${entry.value}"`)
      .join("\n");

    const prompt = `You are a professional translator.

Translate the following ${source} strings to ${target}.
Return ONLY valid JSON with the same keys and translated values. Do not wrap in markdown or add explanations.

{
${content}
}`;

    const response = await fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error ${response.status}: ${error}`);
    }

    const data = (await response.json()) as TranslationResponse;
    const rawContent = data.choices[0].message.content.trim();

    // Try to extract JSON from response
    const jsonMatch = rawContent.match(/```json\n([\s\S]*?)\n```/);
    const objMatch = rawContent.match(/\{[\s\S]*\}/);
    let jsonStr = jsonMatch
      ? jsonMatch[1]
      : objMatch
        ? objMatch[0]
        : rawContent;

    try {
      const translated = JSON.parse(jsonStr) as Record<string, string>;
      Object.assign(results, translated);
    } catch {
      console.error(`   ⚠️ Failed to parse batch ${i + 1}. Raw response:`);
      console.error(rawContent);
      throw new Error(`Invalid JSON from API in batch ${i + 1}`);
    }

    progress += ((i + 1) / batches.length) * 100;
    console.log(`     ${progress.toFixed(0)}% completed`);
  }

  return results;
}

export async function translateTargets(programOpts: CliOptions, translateOpts: TranslateOptions, work: TargetWork[]) {
  let totalApplied = 0;
  for (const { target, missing } of work) {
    console.log(`\n── Translating ${target.name} (${missing.length} keys) ──`);
    const translations = await translateKeys(missing, {
      apiKey: translateOpts.apiKey!,
      model: translateOpts.model,
      url: translateOpts.url,
      maxChars: parseInt(programOpts.maxChars, 10),
      target: target.lang!.name,
      source: translateOpts.source,
    });

    if (Object.keys(translations).length === 0) {
      console.log(`⚠️  No translations received from API for ${target.name}.`);
      continue;
    }

    await mergeApiResults(programOpts, translations, missing, target.path);
    totalApplied += Object.keys(translations).length;
  }
  return totalApplied;
}