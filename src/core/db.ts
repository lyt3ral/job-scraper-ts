import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || "file:jobs.sqlite";
const authToken = process.env.TURSO_AUTH_TOKEN;
const isDryRun = process.env.DRY_RUN === "true";

const client = createClient({
  url,
  authToken,
});

// Wrap the client to support a global Dry Run mode
export const db = {
  ...client,
  execute: async (stmt: any) => {
    const sql = typeof stmt === "string" ? stmt : stmt.sql;
    const isWrite = /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/i.test(sql);

    if (isDryRun && isWrite) {
      console.log(`[DRY RUN] Skipping write operation: ${sql.trim().split("\n")[0].slice(0, 80)}...`);
      return { rows: [], rowsAffected: 0, lastInsertRowid: undefined };
    }
    
    return client.execute(stmt);
  }
} as any;

export async function initDb() {
  if (isDryRun) return; // Don't try to init schema in dry run
  
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
      isNotified INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_isAnalyzed ON jobs(isAnalyzed);
  `);
  
  // Safe migration for existing DBs
  try {
    await db.execute(`ALTER TABLE jobs ADD COLUMN isNotified INTEGER DEFAULT 0;`);
  } catch (err) {
    // Column likely already exists, ignore
  }
}
