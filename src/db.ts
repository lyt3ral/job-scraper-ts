import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || "file:jobs.sqlite";
const authToken = process.env.TURSO_AUTH_TOKEN;

export const db = createClient({
  url,
  authToken,
});

export async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      location TEXT,
      url TEXT UNIQUE NOT NULL,
      postedOn TEXT,
      company TEXT,
      portal TEXT,
      description TEXT,
      isAnalyzed INTEGER DEFAULT 0,
      yearsExperienceRequired INTEGER,
      isCsRole INTEGER,
      skillsNeeded TEXT,
      qualifications TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_isAnalyzed ON jobs(isAnalyzed);
  `);
}
