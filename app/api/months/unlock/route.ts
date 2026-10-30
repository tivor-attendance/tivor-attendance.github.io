import { ApiError, readJson, requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { unlockSchema } from "@/lib/validators";
import { canUnlockMonth } from "@/lib/permissions";

export const POST = route(async (req) => {
  const user = await requireUser(req, "months:unlock");
  const body = unlockSchema.parse(await readJson(req));
  const check = canUnlockMonth(user.role, body.reason);
  if (!check.ok) throw new ApiError(403, check.error!);
  return prisma.$transaction(async (tx) => {
    const lock = await tx.monthLock.findFirst({ where: { year: body.year, month: body.month, unlockedAt: null } });
    if (!lock) throw new ApiError(409, "Month is not locked");
    await tx.monthLock.update({ where: { id: lock.id }, data: { unlockedAt: new Date(), unlockedById: user.id, unlockReason: body.reason } });
    await audit(tx, user, [{ entity: "MonthLock", entityId: lock.id, action: "UNLOCK", oldValue: { locked: true }, newValue: { locked: false, reason: body.reason } }]);
    return { ok: true };
  });
});
