import { ApiError, readJson, requireUser, route, searchParams } from "@/lib/api";
import { autoOnlyDays, isMonthLocked } from "@/lib/attendance";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { lockSchema, monthQuerySchema } from "@/lib/validators";
import { monthEnd, todayIST } from "@/lib/dates";

/** Lock status, history and pre-lock warnings for a month. */
export const GET = route(async (req) => {
  await requireUser(req, "payroll:read");
  const { year, month } = monthQuerySchema.parse(searchParams(req));
  const history = await prisma.monthLock.findMany({
    where: { year, month }, orderBy: { lockedAt: "desc" },
    include: { lockedBy: { select: { name: true } }, unlockedBy: { select: { name: true } } },
  });
  return {
    locked: history.some((h) => !h.unlockedAt),
    monthComplete: monthEnd(year, month) < todayIST(),
    autoOnlyDays: await autoOnlyDays(year, month),
    history: history.map((h) => ({
      lockedAt: h.lockedAt, lockedBy: h.lockedBy.name, unlockedAt: h.unlockedAt, unlockedBy: h.unlockedBy?.name ?? null, unlockReason: h.unlockReason,
    })),
  };
});

export const POST = route(async (req) => {
  const user = await requireUser(req, "months:lock");
  const body = lockSchema.parse(await readJson(req));
  if (await isMonthLocked(body.year, body.month)) throw new ApiError(409, "Month is already locked");
  const autoOnly = await autoOnlyDays(body.year, body.month);
  if (autoOnly.length && !body.acknowledgeAutoOnly) {
    throw new ApiError(428, `${autoOnly.length} day(s) still contain only automatic data. Review them or confirm to lock anyway.`, { autoOnlyDays: autoOnly });
  }
  return prisma.$transaction(async (tx) => {
    if ((await tx.monthLock.count({ where: { year: body.year, month: body.month, unlockedAt: null } })) > 0) throw new ApiError(409, "Month is already locked");
    const lock = await tx.monthLock.create({ data: { year: body.year, month: body.month, lockedById: user.id } });
    await audit(tx, user, [{ entity: "MonthLock", entityId: lock.id, action: "LOCK", newValue: { year: body.year, month: body.month, autoOnlyDaysAcknowledged: autoOnly } }]);
    return { ok: true };
  });
});
