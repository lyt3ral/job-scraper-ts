import { db, initDb } from "./db";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import * as dotenv from "dotenv";

dotenv.config();

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const model = google("gemma-3-27b-it");

async function testGemmaUnbatched(limit: number) {
  initDb();

  const jobs = db
    .query(`SELECT id, title, description FROM jobs LIMIT ? OFFSET 20`)
    .all(limit) as { id: string; title: string; description: string }[];

  console.log(`\n🧪 Testing sequential unbatched runs on ${jobs.length} jobs using Gemma 3 27B...`);
  
  const startTime = Date.now();
  let success = 0;

  for (const job of jobs) {
    const prompt = `You are a strict data extractor. Analyze the following job description and return ONLY raw JSON matching this format:
{"yearsExperienceRequired": 5, "isCsRole": true, "skillsNeeded": ["React", "Node.js"], "qualifications": ["Bachelor's degree in Computer Science"]}

Rules:
- \`yearsExperienceRequired\`: number | null
- \`isCsRole\`: boolean (true if highly related to Computer Science, IT, Data, etc.)
- \`skillsNeeded\`: array of strings (e.g., ["Python", "AWS", "Agile"])
- \`qualifications\`: array of strings (e.g., ["BSc Computer Science", "AWS Certified"])
- DO NOT wrap the output in markdown \`\`\`json blocks.
- Output ONLY the raw JSON string.

Job Title: ${job.title}
Description:
${job.description.slice(0, 3000)}`;

    const reqStart = Date.now();
    try {
      const { text } = await generateText({ model, prompt });
      const CleanJSON = text.replace(/^```json/i, "").replace(/```$/, "").trim();
      const parsed = JSON.parse(CleanJSON);
      
      const reqElapsed = ((Date.now() - reqStart) / 1000).toFixed(1);
      console.log(`✅ [${reqElapsed}s] ${job.title.slice(0, 40)} -> Exp: ${parsed.yearsExperienceRequired}, CS: ${parsed.isCsRole}, Skills: ${parsed.skillsNeeded?.length}`);
      success++;
    } catch (err: any) {
      console.error(`❌ Failed on ${job.title.slice(0, 40)}: ${err.message}`);
    }
    
    // Slight delay to avoid 15k TPM limit
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Finished ${success}/${jobs.length} valid JSON extractions in ${elapsed}s`);
}

testGemmaUnbatched(10);
