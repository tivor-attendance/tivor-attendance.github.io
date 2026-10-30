import { readJson, requireUser, route, searchParams } from "@/lib/api";
import { prisma } from "@/lib/db";
import { createHoliday } from "@/lib/holidays";
import { fromDbDate, isoDate, parseISO, toDbDate, todayIST } from "@/lib/dates";
import { holidaySchema } from "@/lib/validators";

export const GET = route(async (req) => {
  await requireUser(req, "holidays:read");
  const year = Number(searchParams(req).year) || parseISO(todayIST()).year;
  const range = { gte: toDbDate(isoDate(year, 1, 1)), lte: toDbDate(isoDate(year, 12, 31)) };
  const [holidays, overrides] = await Promise.all([
    prisma.holiday.findMany({ where: { deletedAt: null, date: range }, orderBy: { date: "asc" } }),
    prisma.workingDayOverride.findMany({ where: { deletedAt: null, date: range }, orderBy: { date: "asc" } }),
  ]);
  return {
    year,
    holidays: holidays.map((h) => ({ id: h.id, date: fromDbDate(h.date), name: h.name, type: h.type })),
    overrides: overrides.map((o) => ({ id: o.id, date: fromDbDate(o.date), isWorking: o.isWorking, reason: o.reason })),
  };
});

export const POST = route(async (req) => {
  const user = await requireUser(req, "holidays:write");
  const body = holidaySchema.parse(await readJson(req));
  const { holiday, affected } = await createHoliday(body, user);
  return { id: holiday.id, affected };
});
