// Run the daily attendance job once (for system cron / manual catch-up): npm run jobs:daily
import "dotenv/config";
import { runDailyJob } from "@/lib/jobs";
import { prisma } from "@/lib/db";

runDailyJob()
  .then((r) => console.info(`Daily job done for ${r.date}: ${r.inserted} record(s) created`))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
