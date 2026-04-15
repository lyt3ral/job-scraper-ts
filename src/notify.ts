import { db, initDb } from "./db";
import * as dotenv from "dotenv";

dotenv.config();

// Helper to escape characters for HTML
function escapeHTML(text: string) {
  if (!text) return "";
  return text.replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
}

async function sendTelegramMessage(message: string): Promise<{ success: boolean; retryAfter?: number }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID.");
    return { success: false };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (response.status === 429) {
      const data = await response.json() as any;
      const retryAfter = data.parameters?.retry_after || 30;
      console.warn(`⚠️ Telegram rate limit hit. Retry after ${retryAfter}s`);
      return { success: false, retryAfter };
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Telegram API Error: ${response.status} - ${errText} (Message sent: ${message.slice(0,100)}...)`);
      return { success: false };
    }
    return { success: true };
  } catch (error) {
    console.error("Failed to send Telegram message", error);
    return { success: false };
  }
}

async function main() {
  await initDb();
  console.log("🚀 Starting Notifications Service...");

  // Fetch all jobs that are analyzed successfully, are CS roles, but not notified yet
  const result = await db.execute(`
    SELECT id, title, company, url, yearsExperienceRequired, skillsNeeded 
    FROM jobs 
    WHERE isAnalyzed = 1 AND isCsRole = 1 AND isNotified = 0
  `);

  const jobs = result.rows as unknown as any[];

  console.log(`Found ${jobs.length} new jobs to notify.`);

  if (jobs.length === 0) return;

  const BATCH_SIZE = 10;
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const chunk = jobs.slice(i, i + BATCH_SIZE);
    let consolidatedMessage = `🚀 <b>New Jobs Batch (${i / BATCH_SIZE + 1})</b> 🚀\n\n`;

    for (const job of chunk) {
      const { title, company, url, yearsExperienceRequired, skillsNeeded } = job;

      let skillsStr = "Not specified";
      try {
        const skills = JSON.parse(skillsNeeded);
        if (Array.isArray(skills) && skills.length > 0) {
          skillsStr = skills.slice(0, 3).join(", ");
        }
      } catch (e) {}

      const expText = yearsExperienceRequired !== null 
          ? `${yearsExperienceRequired} Years` 
          : "Not specified";

      consolidatedMessage += `🏢 <b>${escapeHTML(company)}</b> - <a href="${url}">${escapeHTML(title)}</a>\n`;
      consolidatedMessage += `⏳ Exp: ${escapeHTML(String(expText))} | 🛠 ${escapeHTML(skillsStr)}\n\n`;
    }

    const { success, retryAfter } = await sendTelegramMessage(consolidatedMessage.trim());

    if (success) {
      console.log(`✅ Notified batch of ${chunk.length} jobs.`);
      const ids = chunk.map(j => j.id);
      for (const id of ids) {
        await db.execute({
          sql: "UPDATE jobs SET isNotified = 1 WHERE id = ?",
          args: [id],
        });
      }
      await new Promise((r) => setTimeout(r, 2000));
    } else if (retryAfter) {
      console.log(`⏳ Waiting ${retryAfter}s for rate limit...`);
      await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
      i -= BATCH_SIZE; 
    } else {
      console.log(`❌ Failed to notify batch starting at index ${i}`);
    }
  }

  console.log("🎉 All notifications sent!");
}

main().catch(console.error);
