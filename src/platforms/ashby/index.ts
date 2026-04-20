import { ASHBY_BOARDS } from "./urls";
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
  maxConcurrent: 5,
  minTime: 200, // 5 requests per second is well within 1000/min
});

// ─── Logging helpers ─────────────────────────────────────────────────────────
const tag = (company: string) => `[Ashby:${company.padEnd(16).slice(0, 16)}]`;

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
interface AshbyJob {
  id: string;
  title: string;
  publishedAt: string;
  location: string;
  secondaryLocations?: { location: string }[];
  jobUrl: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
}

export interface ScrapedJob {
  title: string;
  location: string;
  url: string;
  updatedAt: string;
  company: string;
  portal: string;       // "ashby"
  description: string;
}

// ─── Filtering helpers ───────────────────────────────────────────────────────
function matchesTitle(title: string, searchText: string): boolean {
  if (!searchText) return true;
  const keywords = searchText.toLowerCase().split(/\s+/);
  const titleLower = title.toLowerCase();
  return keywords.every((kw) => titleLower.includes(kw));
}

function matchesLocation(job: AshbyJob, locationFilter: string): boolean {
  if (!locationFilter) return true;
  const filterLower = locationFilter.toLowerCase();
  
  if (job.location?.toLowerCase().includes(filterLower)) return true;
  
  if (job.secondaryLocations) {
    for (const sec of job.secondaryLocations) {
      if (sec.location?.toLowerCase().includes(filterLower)) return true;
    }
  }
  
  return false;
}

function matchesUpdatedWithin(updatedAt: string, withinDays: number): boolean {
  if (withinDays <= 0) return true;
  if (!updatedAt) return true;
  const updated = new Date(updatedAt);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - withinDays);
  return updated >= cutoff;
}

// ─── Strip HTML to plain text ────────────────────────────────────────────────
function stripHtml(html: string): string {
  if (!html) return "";
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
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Scrape a single board ───────────────────────────────────────────────────
async function scrapeBoard(name: string, company: string): Promise<ScrapedJob[]> {
  const apiUrl = `https://api.ashbyhq.com/posting-api/job-board/${name}`;
  const results: ScrapedJob[] = [];

  log(company, `Fetching all jobs from API...`);

  try {
    const resp = await fetch(apiUrl, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!resp.ok) {
      error(company, `HTTP ${resp.status}: ${(await resp.text()).slice(0, 150)}`);
      return results;
    }

    const data = await resp.json() as { jobs: AshbyJob[] };
    const allJobs = data.jobs || [];

    log(company, `Got ${allJobs.length} total jobs from API`);

    let skippedTitle = 0;
    let skippedLocation = 0;
    let skippedDate = 0;
    let skippedNoDesc = 0;

    for (const job of allJobs) {
      // Title filter
      if (!matchesTitle(job.title, SEARCH_TEXT)) {
        skippedTitle++;
        continue;
      }

      // Location filter
      if (!matchesLocation(job, LOCATION_FILTER)) {
        skippedLocation++;
        continue;
      }

      // Date filter
      if (!matchesUpdatedWithin(job.publishedAt, UPDATED_WITHIN_DAYS)) {
        skippedDate++;
        continue;
      }

      // Description
      const description = job.descriptionPlain 
        ? job.descriptionPlain.trim() 
        : stripHtml(job.descriptionHtml || "");
      
      if (!description) {
        skippedNoDesc++;
        continue;
      }

      log(company, `  ✅ "${job.title}" | ${job.location}`);

      results.push({
        title: job.title,
        location: job.location || "Not specified",
        url: job.jobUrl,
        updatedAt: job.publishedAt,
        company,
        portal: "ashby",
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
  console.log(`  Ashby Scraper`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  Search   : ${SEARCH_TEXT}`);
  console.log(`  Location : ${LOCATION_FILTER || "(none)"}`);
  console.log(`  Updated  : ${UPDATED_WITHIN_DAYS > 0 ? `within last ${UPDATED_WITHIN_DAYS} days` : "all"}`);
  console.log(`  Boards   : ${ASHBY_BOARDS.length}`);
  console.log(`  Concurrency: 5 boards at a time`);
  console.log(`${"═".repeat(60)}\n`);

  const startTime = Date.now();

  const tasks = ASHBY_BOARDS.map(({ name, company }) =>
    limiter.schedule(() => scrapeBoard(name, company))
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
  } else {
      console.log(`  No matching jobs found across any board.`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Ashby scraping completed in ${elapsed}s`);
  console.log(`  Total matching jobs: ${allJobs.length}`);
  console.log(`${"═".repeat(60)}\n`);

  return allJobs;
}

if (import.meta.main) {
  scrape().catch(console.error);
}
