import { prisma } from "./db";
import { audit } from "./audit";
import { ApiError, type Actor } from "./api";
import { recomputeAuto, lockedMonths } from "./attendance";
import { fromDbDate, isoDate, parseISO, toDbDate, daysInMonth, monthKey, type ISODate } from "./dates";
import type { HolidayType } from "@/lib/generated/prisma/client";

async function assertDateUnlocked(...dates: ISODate[]) {
  for (const d of dates) {
    const locked = await lockedMonths(d, d);
    if (locked.has(monthKey(d))) throw new ApiError(423, `${monthKey(d)} is locked for payroll. Ask an Admin to unlock it first.`);
  }
}

/** MANUAL cells on a date that adding a holiday will NOT overwrite. */
export async function holidayConflicts(date: ISODate) {
  const rows = await prisma.attendanceRecord.findMany({
    where: { date: toDbDate(date), source: "MANUAL" },
    include: { employee: { select: { empCode: true, name: true } } },
    orderBy: { employee: { empCode: "asc" } },
  });
  return rows.map((r) => ({ empCode: r.employee.empCode, name: r.employee.name, status: r.status, remarks: r.remarks }));
}

export async function createHoliday(input: { date: ISODate; name: string; type: HolidayType }, actor: Actor) {
  await assertDateUnlocked(input.date);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.holiday.findUnique({ where: { date: toDbDate(input.date) } });
    if (existing && !existing.deletedAt) throw new ApiError(409, `A holiday already exists on ${input.date} (${existing.name})`);
    const holiday = existing
      ? await tx.holiday.update({ where: { id: existing.id }, data: { name: input.name, type: input.type, deletedAt: null, createdById: actor.id } })
      : await tx.holiday.create({ data: { date: toDbDate(input.date), name: input.name, type: input.type, createdById: actor.id } });
    await audit(tx, actor, [{ entity: "Holiday", entityId: holiday.id, action: "CREATE", newValue: input }]);
    const affected = await recomputeAuto(tx, actor, { from: input.date, to: input.date, reason: `Holiday added: ${input.name}`, includeManual: true });
    return { holiday, affected };
  });
}

export async function updateHoliday(id: string, input: { date: ISODate; name: string; type: HolidayType }, actor: Actor) {
  const current = await prisma.holiday.findUnique({ where: { id } });
  if (!current || current.deletedAt) throw new ApiError(404, "Holiday not found");
  const oldDate = fromDbDate(current.date);
  await assertDateUnlocked(oldDate, input.date);
  return prisma.$transaction(async (tx) => {
    if (oldDate !== input.date) {
      const clash = await tx.holiday.findUnique({ where: { date: toDbDate(input.date) } });
      if (clash && !clash.deletedAt) throw new ApiError(409, `A holiday already exists on ${input.date}`);
      if (clash) await tx.holiday.delete({ where: { id: clash.id } }); // stale soft-deleted row occupying the unique date
    }
    const holiday = await tx.holiday.update({ where: { id }, data: { date: toDbDate(input.date), name: input.name, type: input.type } });
    await audit(tx, actor, [{ entity: "Holiday", entityId: id, action: "UPDATE", oldValue: { date: oldDate, name: current.name, type: current.type }, newValue: input }]);
    let affected = await recomputeAuto(tx, actor, { from: input.date, to: input.date, reason: `Holiday updated: ${input.name}`, includeManual: true });
    if (oldDate !== input.date) affected += await recomputeAuto(tx, actor, { from: oldDate, to: oldDate, reason: `Holiday moved from ${oldDate}` });
    return { holiday, affected };
  });
}

export async function deleteHoliday(id: string, actor: Actor) {
  const current = await prisma.holiday.findUnique({ where: { id } });
  if (!current || current.deletedAt) throw new ApiError(404, "Holiday not found");
  const date = fromDbDate(current.date);
  await assertDateUnlocked(date);
  return prisma.$transaction(async (tx) => {
    await tx.holiday.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, actor, [{ entity: "Holiday", entityId: id, action: "DELETE", oldValue: { date, name: current.name, type: current.type } }]);
    const affected = await recomputeAuto(tx, actor, { from: date, to: date, reason: `Holiday removed: ${current.name}` });
    return { affected };
  });
}

export async function copyHolidaysFromYear(fromYear: number, toYear: number, actor: Actor) {
  const source = await prisma.holiday.findMany({
    where: { deletedAt: null, date: { gte: toDbDate(isoDate(fromYear, 1, 1)), lte: toDbDate(isoDate(fromYear, 12, 31)) } },
  });
  let created = 0;
  const skipped: string[] = [];
  for (const h of source) {
    const { month, day } = parseISO(fromDbDate(h.date));
    if (day > daysInMonth(toYear, month)) { skipped.push(h.name); continue; }
    const date = isoDate(toYear, month, day);
    const existing = await prisma.holiday.findUnique({ where: { date: toDbDate(date) } });
    if (existing && !existing.deletedAt) { skipped.push(h.name); continue; }
    try {
      await createHoliday({ date, name: h.name, type: h.type }, actor);
      created++;
    } catch (e) {
      if (e instanceof ApiError) skipped.push(`${h.name} (${e.message})`);
      else throw e;
    }
  }
  return { created, skipped };
}

export async function upsertOverride(input: { date: ISODate; isWorking: boolean; reason?: string | null }, actor: Actor) {
  await assertDateUnlocked(input.date);
  return prisma.$transaction(async (tx) => {
    const prev = await tx.workingDayOverride.findUnique({ where: { date: toDbDate(input.date) } });
    const row = await tx.workingDayOverride.upsert({
      where: { date: toDbDate(input.date) },
      create: { date: toDbDate(input.date), isWorking: input.isWorking, reason: input.reason ?? null, createdById: actor.id },
      update: { isWorking: input.isWorking, reason: input.reason ?? null, deletedAt: null, createdById: actor.id },
    });
    await audit(tx, actor, [{
      entity: "WorkingDayOverride", entityId: row.id, action: prev && !prev.deletedAt ? "UPDATE" : "CREATE",
      oldValue: prev && !prev.deletedAt ? { isWorking: prev.isWorking, reason: prev.reason } : null, newValue: input,
    }]);
    const affected = await recomputeAuto(tx, actor, { from: input.date, to: input.date, reason: input.isWorking ? "Marked as working day" : "Marked as day off" });
    return { override: row, affected };
  });
}

export async function deleteOverride(id: string, actor: Actor) {
  const current = await prisma.workingDayOverride.findUnique({ where: { id } });
  if (!current || current.deletedAt) throw new ApiError(404, "Override not found");
  const date = fromDbDate(current.date);
  await assertDateUnlocked(date);
  return prisma.$transaction(async (tx) => {
    await tx.workingDayOverride.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, actor, [{ entity: "WorkingDayOverride", entityId: id, action: "DELETE", oldValue: { date, isWorking: current.isWorking, reason: current.reason } }]);
    return { affected: await recomputeAuto(tx, actor, { from: date, to: date, reason: "Working-day override removed" }) };
  });
}
