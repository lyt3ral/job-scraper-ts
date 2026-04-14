import { Database } from "bun:sqlite";

export const db = new Database("jobs.sqlite", { create: true });

export function initDb() {
  db.run(`PRAGMA journal_mode = WAL;`);
  db.run(`PRAGMA busy_timeout = 5000;`);
  
  db.run(`
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
  
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_isAnalyzed ON jobs(isAnalyzed);
  `);
}
