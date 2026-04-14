import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import * as dotenv from "dotenv";

dotenv.config();

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

async function testGemma() {
  console.log("Testing gemma-3-27b-it via standard text generation...");
  try {
    const { text } = await generateText({
      model: google("gemma-3-27b-it"),
      prompt: `Analyze this job description and return ONLY raw JSON matching this format:
{"yearsExperienceRequired": 5, "isCsRole": true, "skillsNeeded": ["React", "Node.js"], "qualifications": ["Bachelor's degree in Computer Science"]}

DO NOT add markdown blocks or backticks. Return nothing but the JSON string.

Job Title: Senior Software Engineer
Description: We are looking for a Senior Software Engineer with 5+ years of experience in React and Node.js. 
You must have a Bachelor's degree in Computer Science or a related field. Knowing AWS and Docker is a big plus.`,
    });
    console.log("✅ Success!");
    console.log("Response text:", text);
    console.log("Parsed:", JSON.parse(text));
  } catch (err: any) {
    console.error("❌ Failed:", err.message);
  }
}

testGemma();
