# easy-json-file-translate

CLI tool to compare JSON translation files and auto-translate missing keys via AI.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why?

This tool was born out of necessity. Many projects use JSON files as their content source — think i18n systems, static sites, or apps with multilingual support. When translating these files with AI, you hit a wall fast:

- **Token bloat** — JSON files tend to be large, and sending the entire file to an AI for translation burns through your quota quickly.
- **Corruption risk** — AI models sometimes lose track of JSON structure mid-generation, especially with deep nesting, resulting in malformed output you have to fix manually.
- **Partial failures** — if a translation job fails or times out, you're left with a half-translated file and no easy way to resume.

`easy-json-file-translate` solves this by working in a smarter, surgical way: it compares a **base** file (complete, reference translations) with a **target** file (partial or missing translations), identifies exactly which keys are missing, and translates **only those** in batches — keeping token usage low and the original file untouched until you're ready to merge.

## Features

- Compare two JSON translation files and detect missing or extra keys
- **Multi-target support** — point at a directory and pick which files to translate, or pass a single file like before
- **Interactive target selection** — checkbox UI (space to toggle) when multiple candidates are found
- **Language auto-inference with manual fallback** — if a filename doesn't reveal the language, you get prompted for the code; unrecognized codes can be rescued by typing the language name
- Auto-translate missing keys via AI (DeepSeek, OpenAI-compatible APIs)
- Batch translations to minimize token usage
- Dry-run mode: see what would change without writing anything
- Auto-detect source and target languages from filenames
- Interactive confirmation before applying translations
- Batch size control for large translation jobs

## Requirements

- Node.js 18+
- pnpm (recommended) or npm
- An API key for an OpenAI-compatible API (DeepSeek, OpenAI, etc.)

## Installation

### Using pnpm (recommended)

```bash
pnpm install -g easy-json-file-translate
```

### Using npm

```bash
npm install -g easy-json-file-translate
```

### Using npx (no install)

```bash
npx json-translate -b base.json -f target.json -k YOUR_API_KEY
```

## Quick Start

```bash
# Set your API key (optional — you'll be prompted if missing)
export OPENAI_API_KEY=your_api_key

# Compare and translate missing keys
json-translate -b en.json -f es.json -k $OPENAI_API_KEY
```

If you omit `-k`/`OPENAI_API_KEY`, `-m`, or `-u`, the CLI will prompt you
interactively: first pick a provider URL from a curated list (DeepSeek, OpenAI,
Google Gemini, Groq, OpenRouter, Mistral, Ollama, or a custom URL), then enter
the model name, then enter the API key. No flags required to get going.

## CLI Options

| Short | Long | Description | Default |
|-------|------|-------------|---------|
| `-b` | `--base <path>` | Base JSON file with reference translations | Required |
| `-f` | `--file <path>` | Target JSON file **or directory**. If omitted, the base file's directory is scanned for `*.json` files. | Optional |
| `-k` | `--api-key <key>` | API key (prompts interactively if omitted) | `OPENAI_API_KEY` env |
| `-m` | `--model <name>` | Model name (prompts interactively if omitted) | `deepseek-chat` |
| `-u` | `--url <url>` | API base URL (prompts interactively if omitted) | `https://api.deepseek.com/v1` |
| `-l` | `--lang <code>` | Target language code (applies when language can't be inferred) | Auto-detected from filename |
| `-s` | `--source-lang <code>` | Source language code | Auto-detected from filename |
| `-c` | `--max-chars <n>` | Max characters per batch | `2000` |
| | `--dry-run` | Show missing keys without writing changes | `false` |
| | `--no-translate` | Skip AI translation (just compare) | `false` |
| `-i` | `--interactive` | Ask for confirmation before applying each translation | `false` |

## Examples

### Single file (the classic workflow)

```bash
json-translate -b en.json -f es.json -k $OPENAI_API_KEY
```

Source and target languages are inferred from the filenames (`en.json` → English, `es.json` → Spanish).

### Compare files without translating

```bash
json-translate -b en.json -f es.json --no-translate
```

### Dry run: see what would be translated

```bash
json-translate -b en.json -f es.json -k $OPENAI_API_KEY --dry-run
```

### Translate with custom model and API

```bash
json-translate -b en.json -f es.json -k $OPENAI_API_KEY \
  -m gpt-4o \
  -u https://api.openai.com/v1
```

### Interactive mode (confirm each translation)

```bash
json-translate -b en.json -f es.json -k $OPENAI_API_KEY --interactive
```

## Working with multiple targets

When you have several translation files (one per language), `easy-json-file-translate` can process all of them in a single run. The `-f` flag accepts either a single file, a directory, or you can omit it entirely. The table below shows how the tool resolves targets in each case:

| You run | Targets resolved from |
|---|---|
| `-b en.json -f es.json` | The single file `es.json` |
| `-b en.json -f ./locales` | Every `*.json` inside `./locales` (excluding the base file) |
| `-b en.json` (no `-f`) | Every `*.json` in the base file's directory (excluding the base file itself) |
| `-b locales/en.json` (no `-f`) | Every sibling `*.json` next to `en.json` |

When more than one target is found, you'll see an interactive checklist (powered by `@inquirer/prompts`):

```
? Select translation targets (space to toggle, enter to confirm):
  (*) de.json  (German)
  (*) es.json  (Spanish)
  (*) fr.json  (French)
  ( ) locales.json  (language unknown)
```

Use <kbd>space</kbd> to toggle each item, <kbd>a</kbd> to toggle all, <kbd>i</kbd> to invert selection, and <kbd>enter</kbd> to confirm. Targets are selected by default — just press <kbd>enter</kbd> to process them all, or deselect the ones you want to skip.

If any target's filename doesn't include a recognizable language code (e.g. `locales.json`), you'll be prompted for it before processing:

```
? Enter language code for "locales.json": es
```

The full list of supported codes is in [Supported language codes](#supported-language-codes).

If you type a code that isn't in the supported list (for example, a less common language like Basque → `eu`), the tool won't refuse to continue — it will ask you for the display name and use that for the AI prompt:

```
? Enter language code for "locales.json": eu
? Code "eu" is not in the supported list. Enter the language name (e.g. "Basque"): Basque
```

Custom targets are tagged as `(custom)` in the per-target header so you can tell them apart from the recognized ones. They are processed exactly like any other target — only the language *name* sent to the AI model is the one you provided.

### Non-interactive environments (CI, pipes, scripts)

When there's no TTY available, the interactive checklist and the language prompt are skipped:

- Multiple candidates are processed automatically (no way to pick).
- Targets without an inferable language cause a clear error listing the available codes.

If you need reproducible selection in CI, pass an explicit `-f` with a single file, or pre-select the targets using your shell (e.g. `for f in es.json fr.json; do json-translate -b en.json -f "$f"; done`).

## Supported language codes

The following 62 codes are recognized when inferring language from filenames or when you pass `--lang` / `--source-lang`:

| Code | Language | Code | Language | Code | Language |
|------|----------|------|----------|------|----------|
| `en` | English | `ru` | Russian | `lt` | Lithuanian |
| `es` | Spanish | `zh` | Chinese | `lv` | Latvian |
| `fr` | French | `ja` | Japanese | `et` | Estonian |
| `de` | German | `ko` | Korean | `ca` | Catalan |
| `it` | Italian | `ar` | Arabic | `gl` | Galician |
| `pt` | Portuguese | `hi` | Hindi | `he` | Hebrew |
| `nl` | Dutch | `pl` | Polish | `fa` | Persian |
| `sv` | Swedish | `tr` | Turkish | `ur` | Urdu |
| `da` | Danish | `vi` | Vietnamese | `bn` | Bengali |
| `no` | Norwegian | `th` | Thai | `ta` | Tamil |
| `fi` | Finnish | `id` | Indonesian | `te` | Telugu |
| `is` | Icelandic | `uk` | Ukrainian | `mr` | Marathi |
| `el` | Greek | `cs` | Czech | `gu` | Gujarati |
| `hu` | Hungarian | `sk` | Slovak | `kn` | Kannada |
| `ro` | Romanian | `hr` | Croatian | `ml` | Malayalam |
| `bg` | Bulgarian | `sr` | Serbian | `pa` | Punjabi |
| `sl` | Slovenian | `si` | Sinhala | `ka` | Georgian |
| `my` | Burmese | `km` | Khmer | `hy` | Armenian |
| `lo` | Lao | `az` | Azerbaijani | `uz` | Uzbek |
| `kk` | Kazakh | `sw` | Swahili | `af` | Afrikaans |
| `zu` | Zulu | `am` | Amharic | | |

If a code you need is missing, you can either open an issue or just type the code at the prompt and provide a display name when asked — the tool will keep going either way. The list lives in `src/types.ts` (`LANG_MAP`).

## API Configuration

The tool works with any OpenAI-compatible API. Configure via flags or environment variables:

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | API key (used when `-k` is not provided) |

### Supported Providers

- **DeepSeek** — `https://api.deepseek.com/v1`
- **OpenAI** — `https://api.openai.com/v1`
- **Any OpenAI-compatible** — custom URL with `-u`

## Contributing

Contributions are welcome! To set up the project locally:

```bash
# Clone the repo
git clone https://github.com/ArielLeyva/easy-json-file-translate
cd easy-json-file-translate

# Install dependencies
pnpm install

# Build
pnpm build

# Run in development mode
pnpm dev -- -b examples/en.json -f examples/ --no-translate
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile TypeScript to JavaScript |
| `pnpm dev` | Run CLI in development with tsx |
| `pnpm start` | Run compiled CLI from dist |

## License

MIT
