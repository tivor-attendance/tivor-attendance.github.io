// Logical JSON backup of all tables: npm run backup  (schedule with cron / Task Scheduler)
// For a native dump use the db-backup service in docker-compose.yml (pg_dump, 14-day retention).
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fullBackup } from "@/lib/backup";
import { prisma } from "@/lib/db";
import { todayIST } from "@/lib/dates";

async function main() {
  const dir = path.resolve(process.env.BACKUP_DIR ?? "./backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `attendance-backup-${todayIST()}-${Date.now()}.json.gz`);
  fs.writeFileSync(file, gzipSync(JSON.stringify(await fullBackup())));
  const keepDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (f.startsWith("attendance-backup-") && Date.now() - fs.statSync(p).mtimeMs > keepDays * 86_400_000) fs.unlinkSync(p);
  }
  console.info(`Backup written: ${file}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
