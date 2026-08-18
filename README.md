# json-translate

CLI tool to compare JSON translation files and auto-translate missing keys via AI.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why?

This tool was born out of necessity. Many projects use JSON files as their content source — think i18n systems, static sites, or apps with multilingual support. When translating these files with AI, you hit a wall fast:

- **Token bloat** — JSON files tend to be large, and sending the entire file to an AI for translation burns through your quota quickly.
- **Corruption risk** — AI models sometimes lose track of JSON structure mid-generation, especially with deep nesting, resulting in malformed output you have to fix manually.
- **Partial failures** — if a translation job fails or times out, you're left with a half-translated file and no easy way to resume.

`json-translate` solves this by working in a smarter, surgical way: it compares a **base** file (complete, reference translations) with a **target** file (partial or missing translations), identifies exactly which keys are missing, and translates **only those** in batches — keeping token usage low and the original file untouched until you're ready to merge.

## Features

- Compare two JSON translation files and detect missing or extra keys
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
# Set your API key
export OPENAI_API_KEY=your_api_key

# Compare and translate missing keys
json-translate -b en.json -f es.json -k $OPENAI_API_KEY
```

## CLI Options

| Short | Long | Description | Default |
|-------|------|-------------|---------|
| `-b` | `--base <path>` | Base JSON file with reference translations | Required |
| `-f` | `--file <path>` | Target JSON file to compare and translate | Required |
| `-k` | `--api-key <key>` | API key for the AI service | `OPENAI_API_KEY` env |
| `-m` | `--model <name>` | Model name | `deepseek-chat` |
| `-u` | `--url <url>` | API base URL | `https://api.deepseek.com/v1` |
| `-l` | `--lang <code>` | Target language code | Auto-detected from filename |
| `-s` | `--source-lang <code>` | Source language code | Auto-detected from filename |
| `-c` | `--max-chars <n>` | Max characters per batch | `2000` |
| | `--dry-run` | Show missing keys without writing changes | `false` |
| | `--no-translate` | Skip AI translation (just compare) | `false` |
| `-i` | `--interactive` | Ask for confirmation before applying each translation | `false` |

## Examples

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

### Interactive mode

```bash
json-translate -b en.json -f es.json -k $OPENAI_API_KEY --interactive
```

### Auto-detect language from filenames

Filenames like `en.json`, `es.json`, `fr.json` automatically detect language codes:

```bash
json-translate -b en.json -f es.json -k $OPENAI_API_KEY
# Source: English (en) -> Target: Spanish (es)
```

## API Configuration

The tool works with any OpenAI-compatible API. Configure via flags or environment variables:

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | API key (fallback if `-k` not provided) |
| `OPENAI_API_KEY` | Alternative env var |

### Supported Providers

- **DeepSeek** — `https://api.deepseek.com/v1`
- **OpenAI** — `https://api.openai.com/v1`
- **Any OpenAI-compatible** — custom URL with `-u`

## Contributing

Contributions are welcome! To set up the project locally:

```bash
# Clone the repo
git clone https://github.com/yourusername/easy-json-file-translate
cd easy-json-file-translate

# Install dependencies
pnpm install

# Build
pnpm build

# Run in development mode
pnpm dev -- -b examples/en.json -f examples/es.json --dry-run
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile TypeScript to JavaScript |
| `pnpm dev` | Run CLI in development with tsx |
| `pnpm start` | Run compiled CLI from dist |

## License

MIT
