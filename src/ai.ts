import { loadInquirer } from "./inquire";

type ProviderPreset = {
  name: string;
  url: string;
  defaultModel: string;
};

const CUSTOM_PROVIDER_VALUE = "__custom__";

/**
 * Curated list of OpenAI-compatible providers that work with translate.ts
 * (which only speaks the /chat/completions + Bearer auth + messages[] protocol).
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

export async function selectProviderUrl(): Promise<{ url: string; suggestedModel: string }> {
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

export async function promptModel(defaultModel: string): Promise<string> {
  const iq = await loadInquirer();
  if (!iq) return defaultModel;
  return iq.input({
    message: "Model name:",
    default: defaultModel,
    validate: (val: string) =>
      val.trim() ? true : "Model name cannot be empty",
  });
}

export async function promptApiKey(): Promise<string> {
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