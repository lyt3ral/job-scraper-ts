# GitHub Copilot Instructions for `job-scraper-ts`

## 🏗️ Project Overview
This is a standalone, AI-powered Workday job scraper and analyzer pipeline built with **Bun** and **TypeScript**. 
The project has two distinct phases:
1. **Scraping** (`src/scraper.ts`, `src/details.ts`): Fetches job listings from configured Workday portals and stores raw job descriptions in a local SQLite database.
2. **Analysis** (`src/analyzer.ts`): Processes unanalyzed jobs using Google Gemini (`gemma-3-27b-it`) via the Vercel AI SDK to extract structured metadata (skills, experience, qualifications).

## 💻 Tech Stack & Tooling
- **Environment**: Bun (v1.2+)
- **Language**: TypeScript (strict mode preferred)
- **Database**: SQLite via `bun:sqlite` (built-in, zero-dependency)
- **AI/LLM**: Vercel AI SDK (`@ai-sdk/google`) using Gemini
- **Rate-Limiting/Concurrency**: `bottleneck`
- **Scraping**: `jsdom` (for stripping HTML), native Bun `fetch`

## 📐 Architecture & Conventions

### 1. Database Interactions
- The database schema is defined and initialized in `src/db.ts`.
- **Always** use Bun's native `bun:sqlite` driver. Do not introduce external libraries like `sqlite3` or `better-sqlite3`.
- Use synchronous database queries as `bun:sqlite` is fast and synchronous by default.
- Treat `isAnalyzed` in the `jobs` table as an enum: `0` (pending), `1` (done), `-1` (failed structurally).

### 2. Scraping Phase (`src/scraper.ts`, `src/details.ts`)
- Target URLs are maintained in `src/urls.ts`.
- Job details extraction (`src/details.ts`) attempts to parse `application/ld+json` first, treating regex extraction as a fallback.
- **Concurrency**: Governed by `bottleneck`. Keep concurrent requests polite to avoid IP blocks from Workday deployments.
- **Error Handling**: Use fallbacks for Workday API 400/422 status codes (e.g., trying `Location_Country` or `locationHierarchy1` if the default country filter fails).

### 3. Analysis Phase (`src/analyzer.ts`)
- Uses `gemma-3-27b-it` on the free tier.
- **Rate Limits**: The primary bottleneck is the 15,000 Tokens Per Minute (TPM) limit. 
- Ensure a sequential delay (currently `minTimeBetweenMs: 3500`) between unbatched requests to respect the TPM limit.
- AI prompts must instruct the model to return *only* raw JSON to simplify parsing. Handle edge cases where models might still append markdown formatting.

### 4. Code Style & Dependencies
- **Keep it minimal**: Do not add unnecessary dependencies if Bun natively supports the feature (e.g., file system, HTTP fetching, SQLite, hashing).
- Command-line arguments are parsed manually via `process.argv.slice(2)` to limit dependency bloat; avoid libraries like `minimist` unless complexity demands it.
- **Logging**: Use the established `log`, `warn`, and `error` prefixed console outputs for traceability.

## 📝 General Rules
- When writing code, assume the execution environment is `bun run <script>`, not Node.js.
- Ensure new features align with the two-phase pipeline architecture without tightly coupling scraping and analysis.
