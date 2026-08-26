export interface LangFileEntry {
  name: string;
  path: string;
  lang?: Lang;
  entries: LangEntry[];
  missing: LangEntry[];
}

export interface Lang {
  code: string;
  name: string;
  infer?: boolean;
}

export interface LangEntry {
  key: string;
  value: string;
  generated?: string;
}

export interface CliOptions {
  base: string;
  file: string;
  apiKey?: string;
  model: string;
  url: string;
  lang?: string;
  sourceLang?: string;
  maxChars: string;
  dryRun: boolean;
  translate: boolean;
  interactive: boolean;
  config?: string;
}

export const LANG_MAP: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ru: "Russian",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  ar: "Arabic",
  hi: "Hindi",
  nl: "Dutch",
  pl: "Polish",
  tr: "Turkish",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
  uk: "Ukrainian",
  cs: "Czech",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian",
  fi: "Finnish",
  is: "Icelandic",
  el: "Greek",
  hu: "Hungarian",
  ro: "Romanian",
  bg: "Bulgarian",
  sk: "Slovak",
  hr: "Croatian",
  sr: "Serbian",
  sl: "Slovenian",
  lt: "Lithuanian",
  lv: "Latvian",
  et: "Estonian",
  ca: "Catalan",
  gl: "Galician",
  he: "Hebrew",
  fa: "Persian",
  ur: "Urdu",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi",
  si: "Sinhala",
  my: "Burmese",
  km: "Khmer",
  lo: "Lao",
  ka: "Georgian",
  hy: "Armenian",
  az: "Azerbaijani",
  uz: "Uzbek",
  kk: "Kazakh",
  sw: "Swahili",
  af: "Afrikaans",
  zu: "Zulu",
  am: "Amharic",
};

export interface TranslateOptions {
  apiKey?: string;
  model?: string;
  url?: string;
  maxChars?: number;
  target?: string;
  source?: string;
}

export interface TranslationResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export type ConfirmAnswer = "all" | "quit" | boolean;

export type StringRecord = Record<string, string>;

export interface LangFileEntries {
  source: LangFileEntry;
  targets: LangFileEntry[];
}

export type TargetWork = { target: LangFileEntry; missing: LangEntry[] };