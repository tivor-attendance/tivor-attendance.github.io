import { backfillRecent } from "./attendance";
import { ensureLeaveBalances } from "./employees";
import { parseISO, todayIST } from "./dates";
import { prisma } from "./db";

/** Daily job (00:05 IST): create today's records and backfill any days a previous run missed. */
export async function runDailyJob() {
  const started = Date.now();
  const inserted = await backfillRecent();
  await ensureLeaveBalances(parseISO(todayIST()).year);
  await prisma.auditLog.create({
    data: { entity: "System", action: "DAILY_JOB", newValue: { date: todayIST(), inserted, ms: Date.now() - started } },
  });
  return { date: todayIST(), inserted };
}
