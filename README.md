# job-scraper-ts

A serverless-ready job scraper and AI analysis pipeline built with Bun and TypeScript.

Scrapes listings from **Workday**, **Greenhouse**, **Lever**, and **Ashby** portals, stores them in Turso (serverless SQLite), runs each description through Google Gemini to extract structured metadata, then notifies you on Telegram.

---

## Requirements

- [Bun](https://bun.sh) v1.2+
- Google Gemini API key — [get one free](https://aistudio.google.com/app/apikey)
- Turso database — [get one free](https://turso.tech)
- Telegram bot + chat ID (for notifications)

---

## Setup

```bash
bun install
```

Create a `.env` file:

```env
GOOGLE_GENERATIVE_AI_API_KEY="..."
TURSO_DATABASE_URL="libsql://your-db.turso.io"
TURSO_AUTH_TOKEN="..."
TELEGRAM_BOT_TOKEN="..."
TELEGRAM_CHAT_ID="..."
```

---

## Usage

### Scrape

```bash
bun run scrape      # All platforms sequentially
bun run scrape:wd   # Workday
bun run scrape:gh   # Greenhouse
bun run scrape:lv   # Lever
bun run scrape:as   # Ashby
```

### Dry Run Mode

You can run any scraper without writing to the database by setting `DRY_RUN=true`. This will skip all `INSERT`, `UPDATE`, and `DELETE` operations.

```bash
DRY_RUN=true bun run scrape:wd -search "software"
```

All scrapers accept the same flags:

| Flag | Description |
|------|-------------|
| `-search <text>` | Job title keyword (default: `software`) |
| `-location <text>` | Location filter — e.g. `India`, `Bengaluru` |
| `-days <n>` | Only jobs posted within the last N days (`0` = all) |

> Workday uses `-posted` instead of `-days`: `today`, `yesterday`, `3`, `30+`, or `all`

```bash
bun run scrape:lv -search "software" -location "India" -days 1
```

### Analyze

Runs unanalyzed jobs through Gemini to extract skills, YoE, CS role flag, etc.

```bash
bun run analyze
```

### Notify

Sends Telegram messages for newly analyzed jobs that pass filters.

```bash
bun run notify             # default: max-yoe 2 (junior/entry focus)
bun run notify -- -max-yoe 10  # senior roles
```

---

## Automation

The pipeline runs daily via GitHub Actions (`.github/workflows/cron.yml`). Each stage can be toggled independently when triggering manually:

- **Workday** — on/off
- **Greenhouse** — on/off
- **Lever** — on/off
- **Ashby** — on/off
- **Analyze** — on/off
- **Notify** — on/off

---

## Project Structure

```
src/
├── core/
│   ├── analyzer.ts     # Gemini AI metadata extractor
│   ├── db.ts           # DB init & shared connection
│   └── notify.ts       # Telegram notifier
│
├── platforms/
│   ├── ashby/          # Ashby scraper & URLs
│   ├── greenhouse/     # Greenhouse scraper & URLs
│   ├── lever/          # Lever scraper & URLs
│   └── workday/        # Workday scraper, details fetcher & URLs
│
└── index.ts            # Unified CLI entry point for all platforms
```

---

## Database Schema

| Column | Description |
|--------|-------------|
| `id` | CUID2 primary key |
| `title` | Job title |
| `location` | Location from portal |
| `url` | Unique job URL |
| `postedOn` | Posting date/age |
| `company` | Company name |
| `portal` | `workday` / `greenhouse` / `lever` / `ashby` |
| `description` | Full plain-text description |
| `isAnalyzed` | `0` pending · `1` done · `-1` failed |
| `isNotified` | `0` pending · `1` sent |
| `yearsExperienceRequired` | Extracted by AI |
| `isCsRole` | `1` if CS/IT/Data role |
| `skillsNeeded` | JSON array of skills |
| `qualifications` | JSON array of qualifications |

---

## Tech Stack

| | |
|--|--|
| Runtime | [Bun](https://bun.sh) |
| Language | TypeScript |
| Database | [Turso](https://turso.tech) via `@libsql/client` |
| AI | Gemini (`gemma-3-27b-it`) via `@ai-sdk/google` |
| Rate limiting | [Bottleneck](https://github.com/SGrondin/bottleneck) |
