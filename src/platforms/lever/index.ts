import { LEVER_BOARDS } from "./urls";
import Bottleneck from "bottleneck";
import { db, initDb } from "../../core/db";
import { createId } from "@paralleldrive/cuid2";

// ─── CLI Args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let SEARCH_TEXT = "Software Engineer";
let LOCATION_FILTER = "";      // e.g. "India", "Bengaluru", "Remote"
let UPDATED_WITHIN_DAYS = 0;   // 0 = no filter, 7 = last 7 days, etc.

for (let i = 0; i < args.length; i++) {
  if (args[i] === "-search" && args[i + 1]) {
    SEARCH_TEXT = args[++i];
  } else if (args[i] === "-location" && args[i + 1]) {
    LOCATION_FILTER = args[++i];
  } else if (args[i] === "-days" && args[i + 1]) {
    UPDATED_WITHIN_DAYS = parseInt(args[++i], 10) || 0;
  }
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────
const limiter = new Bottleneck({
  maxConcurrent: 3,
  minTime: 500,
});

// ─── Logging helpers ─────────────────────────────────────────────────────────
const tag = (company: string) => `[LV:${company.padEnd(18).slice(0, 18)}]`;

function log(company: string, msg: string) {
  console.log(`${tag(company)} ${msg}`);
}
function warn(company: string, msg: string) {
  console.warn(`${tag(company)} ⚠️  ${msg}`);
}
function error(company: string, msg: string) {
  console.error(`${tag(company)} ❌ ${msg}`);
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface LeverPosting {
  id: string;
  text: string;                    // Job title
  description: string;             // HTML description
  descriptionPlain: string;        // Plain text description
  additional: string;              // Additional HTML (salary, benefits etc.)
  additionalPlain: string;
  hostedUrl: string;               // e.g. https://jobs.lever.co/company/uuid
  applyUrl: string;
  createdAt: number;               // Unix timestamp in milliseconds
  country: string;                 // ISO 2-letter code, e.g. "IN"
  workplaceType: string;           // "unspecified", "on-site", "remote", "hybrid"
  categories: {
    commitment: string;            // e.g. "Full-time", "Permanent"
    department: string;
    location: string;              // Primary location
    team: string;
    allLocations: string[];        // All location strings
  };
  lists: { text: string; content: string }[];
  opening: string;
  openingPlain: string;
  descriptionBody: string;
  descriptionBodyPlain: string;
}

export interface ScrapedJob {
  title: string;
  location: string;
  url: string;
  updatedAt: string;
  company: string;
  portal: string;       // "lever"
  description: string;
}

// ─── Filtering helpers ───────────────────────────────────────────────────────

function matchesTitle(title: string, searchText: string): boolean {
  if (!searchText) return true;
  const keywords = searchText.toLowerCase().split(/\s+/);
  const titleLower = title.toLowerCase();
  return keywords.every((kw) => titleLower.includes(kw));
}

function matchesLocation(posting: LeverPosting, locationFilter: string): boolean {
  if (!locationFilter) return true;
  const filterLower = locationFilter.toLowerCase();

  // Special handling for "India" — match Indian city names too
  const isIndiaFilter = filterLower === "india";
  const indianCities = [
    "india", "bengaluru", "bangalore", "pune", "mumbai",
    "hyderabad", "chennai", "gurgaon", "gurugram", "noida",
    "delhi", "kolkata", "kochi", "thiruvananthapuram",
    "ind ",
  ];

  // Build a combined location string from all available fields
  const parts: string[] = [];
  if (posting.categories?.location) parts.push(posting.categories.location);
  if (posting.categories?.allLocations) parts.push(...posting.categories.allLocations);
  if (posting.country) parts.push(posting.country);
  const combined = parts.join(" ").toLowerCase();

  if (isIndiaFilter) {
    // Country code check
    if (posting.country?.toUpperCase() === "IN") return true;
    return indianCities.some(city => combined.includes(city));
  }

  return combined.includes(filterLower);
}

function matchesCreatedWithin(createdAt: number, withinDays: number): boolean {
  if (withinDays <= 0) return true;
  const created = new Date(createdAt);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - withinDays);
  return created >= cutoff;
}

// ─── Strip HTML to plain text ────────────────────────────────────────────────
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Build full description from Lever posting ──────────────────────────────
function buildDescription(posting: LeverPosting): string {
  const parts: string[] = [];

  // Main description
  if (posting.descriptionPlain) {
    parts.push(posting.descriptionPlain.trim());
  }

  // Sections (e.g. "What You'll Do", "Who You Are", etc.)
  if (posting.lists && posting.lists.length > 0) {
    for (const section of posting.lists) {
      if (section.text) parts.push(`\n${section.text.trim()}`);
      if (section.content) parts.push(stripHtml(section.content));
    }
  }

  // Additional info (often salary / benefits)
  if (posting.additionalPlain) {
    parts.push(posting.additionalPlain.trim());
  }

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ─── Scrape a single board ───────────────────────────────────────────────────
async function scrapeBoard(slug: string, company: string): Promise<ScrapedJob[]> {
  const apiUrl = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  const results: ScrapedJob[] = [];

  log(company, `Fetching all jobs from API...`);

  try {
    const resp = await fetch(apiUrl, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (resp.status === 404) {
      warn(company, `Board not found (404) — slug "${slug}" may be invalid`);
      return results;
    }

    if (!resp.ok) {
      error(company, `HTTP ${resp.status}: ${(await resp.text()).slice(0, 150)}`);
      return results;
    }

    const allPostings = await resp.json() as LeverPosting[];

    if (!Array.isArray(allPostings)) {
      warn(company, `Unexpected response format (not an array)`);
      return results;
    }

    log(company, `Got ${allPostings.length} total jobs from API`);

    let skippedTitle = 0;
    let skippedLocation = 0;
    let skippedDate = 0;
    let skippedNoDesc = 0;

    for (const posting of allPostings) {
      // Title filter
      if (!matchesTitle(posting.text, SEARCH_TEXT)) {
        skippedTitle++;
        continue;
      }

      // Location filter
      if (!matchesLocation(posting, LOCATION_FILTER)) {
        skippedLocation++;
        continue;
      }

      // Date filter
      if (!matchesCreatedWithin(posting.createdAt, UPDATED_WITHIN_DAYS)) {
        skippedDate++;
        continue;
      }

      // Description
      const description = buildDescription(posting);
      if (!description) {
        skippedNoDesc++;
        continue;
      }

      const locationText = posting.categories?.allLocations?.join(", ")
        || posting.categories?.location
        || "Not specified";

      log(company, `  ✅ "${posting.text}" | ${locationText}`);

      results.push({
        title: posting.text,
        location: locationText,
        url: posting.hostedUrl,
        updatedAt: new Date(posting.createdAt).toISOString(),
        company,
        portal: "lever",
        description,
      });
    }

    log(company, `━━━ Done ━━━ matched=${results.length} | skipped: title=${skippedTitle} location=${skippedLocation} date=${skippedDate} no_desc=${skippedNoDesc}`);
  } catch (err: any) {
    error(company, `Uncaught error: ${err.message}`);
  }

  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────
export async function scrape() {
  await initDb();
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Lever Scraper`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  Search   : ${SEARCH_TEXT}`);
  console.log(`  Location : ${LOCATION_FILTER || "(none)"}`);
  console.log(`  Updated  : ${UPDATED_WITHIN_DAYS > 0 ? `within last ${UPDATED_WITHIN_DAYS} days` : "all"}`);
  console.log(`  Boards   : ${LEVER_BOARDS.length}`);
  console.log(`  Concurrency: 3 boards at a time`);
  console.log(`${"═".repeat(60)}\n`);

  const startTime = Date.now();

  const tasks = LEVER_BOARDS.map(({ slug, company }) =>
    limiter.schedule(() => scrapeBoard(slug, company))
  );

  const allResults = await Promise.all(tasks);
  const allJobs = allResults.flat();

  // ─── Save to DB ────────────────────────────────────────────────────────────
  if (allJobs.length > 0) {
    console.log(`  Writing jobs to DB...`);
    let newJobsCount = 0;

    for (const job of allJobs) {
      // Duplicate check
      const existing = await db.execute({
        sql: "SELECT id FROM jobs WHERE url = ?",
        args: [job.url]
      });

      if (existing.rows.length > 0) {
        // Just update postedOn / updatedAt
        await db.execute({
          sql: `UPDATE jobs SET postedOn = ?, updatedAt = CURRENT_TIMESTAMP WHERE url = ?`,
          args: [job.updatedAt, job.url]
        });
      } else {
        // Insert new job
        await db.execute({
          sql: `
            INSERT INTO jobs (id, title, location, url, postedOn, company, portal, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          args: [createId(), job.title, job.location, job.url, job.updatedAt, job.company, job.portal, job.description]
        });
        newJobsCount++;
      }
    }
    console.log(`  ✅ Added ${newJobsCount} completely new jobs to the database.`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Lever scraping completed in ${elapsed}s`);
  console.log(`  Total matching jobs: ${allJobs.length}`);
  console.log(`${"═".repeat(60)}\n`);

  return allJobs;
}

if (import.meta.main) {
  scrape().catch(console.error);
}
