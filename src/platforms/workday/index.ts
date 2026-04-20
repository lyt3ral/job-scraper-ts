import { db, initDb } from "../../core/db";
import { fetchWorkdayJobDetails } from "./details";
import { createId } from "@paralleldrive/cuid2";
import { WORKDAY_URLS } from "./urls";
import Bottleneck from "bottleneck";

const args = process.argv.slice(2);
let SEARCH_TEXT = "Software Engineer";
let COUNTRY = "";
let LOCATION_FILTER = "India"; // Default to India as requested
let POSTED_FILTER = "all";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "-search" && args[i + 1]) {
    SEARCH_TEXT = args[++i];
  } else if (args[i] === "-location" && args[i + 1]) {
    LOCATION_FILTER = args[++i];
  } else if (args[i] === "-posted" && args[i + 1]) {
    POSTED_FILTER = args[++i];
  }
}

const BATCH_SIZE = 20;

const limiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 200,
});

// ─── Logging helpers ─────────────────────────────────────────────────────────
const tag = (portal: string) => `[${portal.padEnd(20).slice(0, 20)}]`;

function log(portal: string, msg: string) {
  console.log(`${tag(portal)} ${msg}`);
}
function warn(portal: string, msg: string) {
  console.warn(`${tag(portal)} ⚠️  ${msg}`);
}
function error(portal: string, msg: string) {
  console.error(`${tag(portal)} ❌ ${msg}`);
}
// ─────────────────────────────────────────────────────────────────────────────

function parseWorkdayURL(portalURL: string) {
  try {
    const url = new URL(portalURL);
    let company = "", portal = "";
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (url.hostname.endsWith("myworkdayjobs.com")) {
      const match = url.hostname.match(/^(.*?)\.wd\d+\.myworkdayjobs\.com$/);
      if (match && match[1]) company = match[1];
      if (pathParts.length > 0) portal = pathParts[pathParts.length - 1];
    } else if (url.hostname.endsWith("myworkdaysite.com")) {
      if (pathParts.length >= 2) {
        company = pathParts[pathParts.length - 2];
        portal = pathParts[pathParts.length - 1];
      }
    }

    if (!company || !portal) return null;
    return { company, portal, hostname: url.hostname };
  } catch (err) {
    return null;
  }
}

function matchesFilter(postedOn: string, filter: string): boolean {
  if (!filter || filter === "all") return true;

  const postedLower = postedOn.toLowerCase().trim();
  const filterLower = filter.toLowerCase().trim();

  if (filterLower.includes("today") || filterLower === "0") {
    return postedLower.includes("today");
  }
  if (filterLower.includes("yesterday") || filterLower === "1") {
    return postedLower.includes("yesterday");
  }

  const filterNumMatch = filterLower.match(/^(\d+)$/);
  const postedNumMatch = postedLower.match(/posted\s+(\d+)\s+days?\s+ago/i);
  if (filterNumMatch && postedNumMatch) {
    return filterNumMatch[1] === postedNumMatch[1];
  }

  if (filterLower.includes("30+")) return postedLower.includes("30+");

  let normalizedFilter = filterLower;
  if (!normalizedFilter.startsWith("posted ")) normalizedFilter = `posted ${normalizedFilter}`;
  return postedLower === normalizedFilter || postedLower.includes(normalizedFilter + " ");
}

function matchesLocation(locationText: string, filter: string): boolean {
  if (!filter) return true;
  if (filter.toLowerCase() === "india") {
    const lowLoc = locationText.toLowerCase();
    return lowLoc.includes("india") ||
           lowLoc.includes("bengaluru") || lowLoc.includes("bangalore") ||
           lowLoc.includes("pune") || lowLoc.includes("mumbai") ||
           lowLoc.includes("hyderabad") || lowLoc.includes("chennai") ||
           lowLoc.includes("gurgaon") || lowLoc.includes("noida") ||
           lowLoc.includes("ind "); // catch "IND "
  }
  return locationText.toLowerCase().includes(filter.toLowerCase());
}

async function scrapePortal(portalURL: string) {
  const parsed = parseWorkdayURL(portalURL);
  if (!parsed) {
    warn(portalURL, `Could not parse URL format. Skipping.`);
    return;
  }

  const { company, portal, hostname } = parsed;
  const baseUrl = `https://${hostname}/wday/cxs/${company}/${portal}/jobs`;
  const jobURLBase = portalURL.replace(/\/$/, "");
  const portalTag = company;

  let offset = 0;
  const seenUrls = new Set<string>();
  let totalSaved = 0;
  let totalSkippedFilter = 0;
  let totalSkippedCountry = 0;
  let totalSkippedDuplicate = 0;
  let totalSkippedNoDesc = 0;
  let totalAPIRequests = 0;

  log(portalTag, `Starting scrape — API: ${baseUrl}`);
  if (LOCATION_FILTER) log(portalTag, `Location filter: "${LOCATION_FILTER}"`);
  if (POSTED_FILTER !== "all") log(portalTag, `Date filter: "${POSTED_FILTER}"`);

  while (true) {
    const payload: any = {
      limit: BATCH_SIZE,
      offset,
      searchText: SEARCH_TEXT,
      appliedFacets: {},
    };

    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };

    log(portalTag, `Fetching batch — offset: ${offset}`);

    try {
      let resp = await fetch(baseUrl, { method: "POST", headers, body: JSON.stringify(payload) });
      totalAPIRequests++;

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
      }

      const rawText = await resp.text();
      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch (e) {
        error(portalTag, `Failed to parse JSON response: ${rawText.slice(0, 150)}`);
        break;
      }

      const postings = data.jobPostings || [];
      log(portalTag, `Got ${postings.length} postings at offset ${offset} (total from API: ${data.total ?? "?"})`);

      if (postings.length === 0) {
        log(portalTag, `No postings returned — stopping pagination.`);
        break;
      }

      let newJobsInBatch = false;

      for (const posting of postings) {
        const title = posting.title || posting.displayJobTitle;
        if (!title || !posting.externalPath) {
          warn(portalTag, `Skipping posting with no title/externalPath (raw: ${JSON.stringify(posting).slice(0, 80)})`);
          continue;
        }

        const jobUrl = `${jobURLBase}${posting.externalPath}`;

        if (seenUrls.has(jobUrl)) {
          log(portalTag, `[DEDUP-MEMORY] Already seen in this run: ${title}`);
          continue;
        }
        seenUrls.add(jobUrl);
        newJobsInBatch = true;

        const location = posting.locationsText || "Location not specified";
        const postedOn = posting.postedOn || "";

        log(portalTag, `Found: "${title}" | loc: "${location}" | posted: "${postedOn}"`);

        // Date filter
        if (!matchesFilter(postedOn, POSTED_FILTER)) {
          log(portalTag, `  → SKIP (date filter): postedOn="${postedOn}" does not match filter="${POSTED_FILTER}"`);
          totalSkippedFilter++;
          continue;
        }

        // Location text filter
        if (!matchesLocation(location, LOCATION_FILTER)) {
          log(portalTag, `  → SKIP (location mismatch): "${location}" does not match "${LOCATION_FILTER}"`);
          totalSkippedCountry++;
          continue;
        }

        // Duplicate check against DB
        const existingJobResult = await db.execute({
          sql: "SELECT id, isAnalyzed FROM jobs WHERE url = ?",
          args: [jobUrl]
        });
        const existingJob = existingJobResult.rows[0] as unknown as { id: string; isAnalyzed: number } | undefined;
        
        if (existingJob) {
          log(portalTag, `  → SKIP (DB duplicate): already in DB (isAnalyzed=${existingJob.isAnalyzed}), refreshing postedOn`);
          await db.execute({
            sql: `UPDATE jobs SET postedOn = ?, updatedAt = CURRENT_TIMESTAMP WHERE url = ?`,
            args: [postedOn, jobUrl]
          });
          totalSkippedDuplicate++;
          totalSaved++;
          continue;
        }

        // Fetch description
        log(portalTag, `  → Fetching description: ${jobUrl}`);
        const details = await fetchWorkdayJobDetails(jobUrl);

        if (!details || !details.jobDescription) {
          warn(portalTag, `  → SKIP (no description extracted): ${jobUrl}`);
          totalSkippedNoDesc++;
          continue;
        }

        log(portalTag, `  → Description extracted (${details.jobDescription.length} chars, source: ${details.source})`);

        // Insert
        await db.execute({
          sql: `
          INSERT INTO jobs (id, title, location, url, postedOn, company, portal, description)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(url) DO UPDATE SET 
            updatedAt=CURRENT_TIMESTAMP,
            postedOn=excluded.postedOn
        `,
          args: [createId(), title, location, jobUrl, postedOn, company, "workday", details.jobDescription]
        });

        log(portalTag, `  → ✅ Saved: "${title}"`);
        totalSaved++;
      }

      if (postings.length < BATCH_SIZE || !newJobsInBatch) {
        if (!newJobsInBatch && postings.length > 0) {
          log(portalTag, `All ${postings.length} postings in batch were already seen — stopping pagination.`);
        }
        break;
      }

      offset += BATCH_SIZE;

    } catch (err: any) {
      error(portalTag, `Uncaught error: ${err.message}`);
      break;
    }
  }

  log(portalTag, `━━━ Done ━━━ saved=${totalSaved} | api_requests=${totalAPIRequests} | skipped: date=${totalSkippedFilter} country=${totalSkippedCountry} duplicate=${totalSkippedDuplicate} no_desc=${totalSkippedNoDesc}`);
}

export async function scrape() {
  await initDb();

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Workday Scraper`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  Search   : ${SEARCH_TEXT}`);
  console.log(`  Location : ${LOCATION_FILTER || "(none)"}`);
  console.log(`  Posted   : ${POSTED_FILTER}`);
  console.log(`  Portals  : ${WORKDAY_URLS.length}`);
  console.log(`  Concurrency: ${5} portals at once, ${BATCH_SIZE} jobs/batch`);
  console.log(`${"═".repeat(60)}\n`);

  const startTime = Date.now();
  const tasks = WORKDAY_URLS.map(url => limiter.schedule(() => scrapePortal(url)));
  await Promise.all(tasks);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalRes = await db.execute("SELECT count(*) as c FROM jobs");
  const total = totalRes.rows[0].c as number;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Scraping completed in ${elapsed}s`);
  console.log(`  Total jobs in DB: ${total}`);
  console.log(`${"═".repeat(60)}\n`);
}

if (import.meta.main) {
  scrape().catch(console.error);
}
