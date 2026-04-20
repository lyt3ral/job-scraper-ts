import { spawn } from "child_process";

const args = process.argv.slice(2);
const scrapers = [
  "src/workday_scraper.ts",
  "src/greenhouse_scraper.ts",
  "src/lever_scraper.ts",
  "src/ashby_scraper.ts",
];

async function runScraper(path: string) {
  return new Promise((resolve, reject) => {
    console.log(`\n🚀 Starting scraper: ${path}`);
    const proc = spawn("bun", ["run", path, ...args], { stdio: "inherit" });

    proc.on("close", (code) => {
      if (code === 0) resolve(true);
      else reject(new Error(`Scraper ${path} exited with code ${code}`));
    });
  });
}

async function main() {
  for (const scraper of scrapers) {
    try {
      await runScraper(scraper);
    } catch (err) {
      console.error(err);
    }
  }
  console.log("\n✅ All scrapers finished.");
}

main();
