import { db, initDb } from "./db";
import * as dotenv from "dotenv";

dotenv.config();

// Helper to escape characters for Telegram MarkdownV2
function escapeMarkdownV2(text: string) {
  if (!text) return "";
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

async function sendTelegramMessage(message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID.");
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Telegram API Error: ${response.status} - ${errText}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Failed to send Telegram message", error);
    return false;
  }
}

async function main() {
  await initDb();
  console.log("🚀 Starting Notifications Service...");

  // Fetch all jobs that are analyzed successfully but not notified yet
  const result = await db.execute(`
    SELECT id, title, company, url, yearsExperienceRequired, skillsNeeded 
    FROM jobs 
    WHERE isAnalyzed = 1 AND isNotified = 0
  `);

  const jobs = result.rows as unknown as any[];

  console.log(`Found ${jobs.length} new jobs to notify.`);

  if (jobs.length === 0) return;

  for (const job of jobs) {
    const { id, title, company, url, yearsExperienceRequired, skillsNeeded } = job;

    // Parse array string safely
    let skillsStr = "Not specified";
    try {
      const skills = JSON.parse(skillsNeeded);
      if (Array.isArray(skills) && skills.length > 0) {
        skillsStr = skills.slice(0, 5).join(", ");
      }
    } catch (e) {}

    const expText = yearsExperienceRequired !== null 
        ? `${yearsExperienceRequired} Years` 
        : "Not specified";

    const text = `
💼 *New Job Found* 💼

🏢 *Company:* ${escapeMarkdownV2(company)}
📌 *Title:* ${escapeMarkdownV2(title)}
⏳ *Experience:* ${escapeMarkdownV2(String(expText))}
🛠 *Skills:* ${escapeMarkdownV2(skillsStr)}

🔗 [Apply Here](${url})
    `.trim();

    const success = await sendTelegramMessage(text);

    if (success) {
      console.log(`✅ Notified: ${title} at ${company}`);
      await db.execute({
        sql: "UPDATE jobs SET isNotified = 1 WHERE id = ?",
        args: [id],
      });
      // Small pause to avoid Telegram rate limits (~30 msgs per sec limit typical for bots)
      await new Promise((r) => setTimeout(r, 500));
    } else {
      console.log(`❌ Failed to notify: ${title}`);
    }
  }

  console.log("🎉 All notifications sent!");
}

main().catch(console.error);
