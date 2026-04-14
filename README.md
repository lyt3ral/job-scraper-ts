# scraper-ts

A standalone Workday job scraper and AI-powered analyzer pipeline built with Bun and TypeScript.

Scrapes job listings from Workday career portals and stores them in a local SQLite database, then uses Google Gemini (via the AI SDK) to extract structured metadata from each job description.

---

## Requirements

- [Bun](https://bun.sh) v1.2+
- A Google Gemini API key (free tier works)

---

## Setup

**1. Install dependencies**

```bash
bun install
```

**2. Configure environment**

Copy or create a `.env` file in the project root:

```bash
GOOGLE_GENERATIVE_AI_API_KEY="your-key-here"
```

> Get a free key at https://aistudio.google.com/app/apikey

---

## Usage

The pipeline has two independent phases:

### Phase 1 — Scrape jobs

Fetches job listings from all configured Workday portals and saves descriptions to `jobs.sqlite`.

```bash
bun run scrape
```

**Optional flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `-search <text>` | `Software Engineer` | Job title keyword to search |
| `-country <code>` | *(none)* | Filter by country (e.g. `IN` for India) |
| `-posted <filter>` | `all` | Filter by posting age: `today`, `yesterday`, `3` (days), `30+`, or `all` |

**Examples:**

```bash
# Search for data engineers in India posted in the last 3 days
bun run scrape -- -search "Data Engineer" -country IN -posted 3

# Search for all software engineer roles posted today
bun run scrape -- -search "Software Engineer" -posted today
```

---

### Phase 2 — Analyze jobs

Runs all unanalyzed jobs through `gemma-3-27b-it` to extract structured metadata (skills, experience level, qualifications, etc.) and saves results back to the DB.

```bash
bun run analyze
```

> The analyzer is rate-limited to respect Gemini free tier limits (30 RPM / 15K TPM). It runs sequentially with a ~3.5s gap between requests. It is safe to stop and resume — it picks up from where it left off.

---

## Database

Jobs are stored in `jobs.sqlite` (auto-created on first run). The schema:

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | CUID2 primary key |
| `title` | TEXT | Job title |
| `location` | TEXT | Location string from portal |
| `url` | TEXT | Unique job URL |
| `postedOn` | TEXT | Human-readable posting age (e.g. "Posted 2 days ago") |
| `company` | TEXT | Company derived from portal URL |
| `portal` | TEXT | Portal identifier |
| `description` | TEXT | Full job description (plain text) |
| `isAnalyzed` | INTEGER | `0` = pending, `1` = done, `-1` = failed |
| `yearsExperienceRequired` | INTEGER | Extracted by AI |
| `isCsRole` | INTEGER | `1` if CS/IT/Data role (boolean, extracted by AI) |
| `skillsNeeded` | TEXT | JSON array of skills (extracted by AI) |
| `qualifications` | TEXT | JSON array of qualifications (extracted by AI) |

---

## Project Structure

```
scraper-ts/
├── src/
│   ├── scraper.ts      # Phase 1: Workday portal scraper
│   ├── analyzer.ts     # Phase 2: AI metadata extractor
│   ├── details.ts      # Job description fetcher (JSON-LD + regex fallback)
│   ├── db.ts           # SQLite database init & shared connection
│   └── urls.ts         # List of Workday portal URLs to scrape
├── .env                # API keys (not committed)
├── package.json
└── tsconfig.json
```

---

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Language**: TypeScript
- **Database**: SQLite via `bun:sqlite` (built-in, zero config)
- **HTTP scraping**: Bun's built-in `fetch` + [jsdom](https://github.com/jsdom/jsdom)
- **AI analysis**: [Vercel AI SDK](https://sdk.vercel.ai/) + `@ai-sdk/google` (Gemma 3 27B)
- **Rate limiting**: [Bottleneck](https://github.com/SGrondin/bottleneck)

---

This project was created using `bun init` in Bun v1.2.18.
