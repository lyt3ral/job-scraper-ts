import { scrape as scrapeWorkday } from "./platforms/workday/index";
import { scrape as scrapeGreenhouse } from "./platforms/greenhouse/index";
import { scrape as scrapeLever } from "./platforms/lever/index";
import { scrape as scrapeAshby } from "./platforms/ashby/index";

async function main() {
  console.log("🚀 Starting all scrapers sequentially...");
  
  await scrapeWorkday();
  await scrapeGreenhouse();
  await scrapeLever();
  await scrapeAshby();
  
  console.log("\n✅ All platforms scraped.");
}

main().catch(console.error);
