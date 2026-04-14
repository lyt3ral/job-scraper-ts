import { db, initDb } from "./db";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import * as dotenv from "dotenv";

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMIT CONFIGURATION
// Target Model: gemma-3-27b-it
// Limits:       30 RPM, 15,000 TPM, 14,400 RPD
// Strategy:     Sequential, unbatched API calls (1 job/req). 
//               Because 14,400 RPD is massive, we don't need to batch. 
//               The real bottleneck is the 15,000 TPM limit. 
//               We pace requests ~3.5 seconds apart to stay highly aligned with TPM.
// ─────────────────────────────────────────────────────────────────────────────
const TIER = (process.env.GEMINI_TIER || "free").toLowerCase();

const config = {
  label: "Gemma 3 27B (Free Tier)",
  RPM: 30,
  RPD: 14400,
  batchSize: 1, // Moving back to 1 for stability since RPD is essentially unlimited
  minTimeBetweenMs: 3_500, // Roughly keeps us well under the 15k TPM limit given ~800 tokens per job
};

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const model = google("gemma-3-27b-it");

// ─────────────────────────────────────────────────────────────────────────────
// Sleep helper
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Parse the "retry in Xs" delay from a Gemini error message
function parseRetryAfter(errMessage: string): number | null {
  const match = errMessage.match(/retry in ([\d.]+)s/i);
  if (match) return Math.ceil(parseFloat(match[1]));
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Analyze a single job via Gemma Text Generation
// Returns success boolean
// ─────────────────────────────────────────────────────────────────────────────
async function analyzeJob(
  job: { id: string; title: string; description: string },
  attempt = 1
): Promise<boolean> {
  const maxRetries = 3;

  const prompt = `You are a strict data extractor. Analyze the following job description and return ONLY raw JSON matching this format:
{"yearsExperienceRequired": 5, "isCsRole": true, "skillsNeeded": ["React", "Node.js"], "qualifications": ["Bachelor's degree in Computer Science"]}

Rules:
- \`yearsExperienceRequired\`: number | null
- \`isCsRole\`: boolean (true if highly related to Computer Science, IT, Data, etc.)
- \`skillsNeeded\`: array of strings (e.g., ["Python", "AWS", "Agile"])
- \`qualifications\`: array of strings (e.g., ["BSc Computer Science", "AWS Certified"])
- DO NOT wrap the output in markdown json blocks.
- Output ONLY the raw JSON string.

Job Title: ${job.title}
Description:
${job.description.slice(0, 3000)}`;

  try {
    const { text } = await generateText({ model, prompt });
    
    // Cleanse structural wrappers if the model includes them despite instructions
    let cleanJSON = text.replace(/^[\s\S]*?```json/im, "").replace(/```[\s\S]*$/im, "").trim();
    if (cleanJSON.startsWith("{") === false && text.startsWith("{")) {
       cleanJSON = text.trim();
    }

    const parsed = JSON.parse(cleanJSON);

    db.prepare(`
      UPDATE jobs 
      SET isAnalyzed = 1,
          yearsExperienceRequired = ?,
          isCsRole = ?,
          skillsNeeded = ?,
          qualifications = ?
      WHERE id = ?
    `).run(
      parsed.yearsExperienceRequired ?? null,
      parsed.isCsRole === true ? 1 : 0,
      JSON.stringify(parsed.skillsNeeded || []),
      JSON.stringify(parsed.qualifications || []),
      job.id
    );

    return true;
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    const isRateLimit = msg.toLowerCase().includes("quota") || msg.includes("429");

    if (isRateLimit && attempt < maxRetries) {
      const retryAfterSecs = parseRetryAfter(msg) ?? 65;
      const waitMs = retryAfterSecs * 1_000 + 2_000;
      console.warn(
        `  ⏳ Rate limited (attempt ${attempt}/${maxRetries}). Waiting ${retryAfterSecs + 2}s...`
      );
      await sleep(waitMs);
      return analyzeJob(job, attempt + 1);
    }

    console.error(`  ❌ Job failed [${job.id}]: ${msg.slice(0, 150)}`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main long-running loop
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  initDb();

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("Missing GOOGLE_GENERATIVE_AI_API_KEY in .env");
    process.exit(1);
  }

  const totalUnanalyzed = (
    db.query(`SELECT count(*) as c FROM jobs WHERE isAnalyzed = 0`).get() as { c: number }
  ).c;

  const maxRequestsThisRun = config.RPD;

  console.log(`\n🚀 Starting analyzer — Tier: ${config.label}`);
  console.log(`   Model          : gemma-3-27b-it`);
  console.log(`   Rate limit     : ${config.RPM} RPM / ${config.RPD} RPD / 15K TPM`);
  console.log(`   Batch size     : 1 job/request (Because RPD is vast & TPM is low)`);
  console.log(`   Min gap        : ${config.minTimeBetweenMs}ms between requests`);
  console.log(`   Jobs queued    : ${totalUnanalyzed}`);
  console.log();

  if (totalUnanalyzed === 0) {
    console.log("✅ All jobs already analyzed. Nothing to do.");
    return;
  }

  let totalSaved = 0;
  let totalFailed = 0;
  let requestCount = 0;

  while (true) {
    if (requestCount >= maxRequestsThisRun) {
      console.warn(`\n⛔ Reached daily RPD budget (${config.RPD} requests). Stopping.`);
      break;
    }

    const job = db
      .query(`SELECT id, title, description FROM jobs WHERE isAnalyzed = 0 LIMIT 1`)
      .get() as { id: string; title: string; description: string } | null;

    if (!job) break;

    const remaining = (
      db.query(`SELECT count(*) as c FROM jobs WHERE isAnalyzed = 0`).get() as { c: number }
    ).c;

    process.stdout.write(
      `[req ${requestCount + 1}] Processing: ${job.title.slice(0, 45).padEnd(45)} (${remaining} left) ... `
    );

    const startTs = Date.now();
    const success = await analyzeJob(job);
    const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);

    requestCount++;
    if (success) {
      totalSaved++;
      console.log(`✅ saved (${elapsed}s)`);
    } else {
      totalFailed++;
      // If it fails structurally (JSON parse error), mark it analyzed so it doesn't loop infinitely
      // but let's leave it un-analyzed in this simple setup so you can fix and retry
      console.log(`❌ failed (${elapsed}s)`);
      // Optional: Update to failed state to avoid infinite loops on syntax errors
      db.prepare(`UPDATE jobs SET isAnalyzed = -1 WHERE id = ?`).run(job.id);
    }

    // Pace between requests to strictly respect the 15,000 TPM limit
    await sleep(config.minTimeBetweenMs);
  }

  const finalRemaining = (
    db.query(`SELECT count(*) as c FROM jobs WHERE isAnalyzed = 0`).get() as { c: number }
  ).c;

  console.log(`\n✅ Analysis run complete.`);
  console.log(`   Requests used  : ${requestCount}`);
  console.log(`   Jobs saved     : ${totalSaved}`);
  console.log(`   Jobs failed    : ${totalFailed}`);
  console.log(`   Still pending  : ${finalRemaining}`);
}

main().catch(console.error);
