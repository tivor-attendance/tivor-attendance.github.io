import { z } from "zod";
import { requireUser, route, searchParams } from "@/lib/api";
import { prisma } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { isoDateSchema } from "@/lib/validators";

export const GET = route(async (req) => {
  await requireUser(req, "audit:read");
  const q = z.object({
    entity: z.string().optional(), action: z.string().optional(), userId: z.string().optional(), search: z.string().optional(),
    from: isoDateSchema.optional(), to: isoDateSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
  }).parse(searchParams(req));
  const where = {
    ...(q.entity ? { entity: q.entity } : {}),
    ...(q.action ? { action: q.action } : {}),
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.search ? { entityId: { contains: q.search } } : {}),
    ...(q.from || q.to ? { createdAt: {
      ...(q.from ? { gte: new Date(`${q.from}T00:00:00+05:30`) } : {}),
      ...(q.to ? { lt: new Date(`${addDays(q.to, 1)}T00:00:00+05:30`) } : {}),
    } } : {}),
  };
  const pageSize = 50;
  const [total, logs, users] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * pageSize, take: pageSize, include: { user: { select: { name: true } } } }),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    total, page: q.page, pageSize, users,
    logs: logs.map((l) => ({ id: l.id, createdAt: l.createdAt, user: l.user?.name ?? "System", entity: l.entity, entityId: l.entityId, action: l.action, oldValue: l.oldValue, newValue: l.newValue, ip: l.ip, userAgent: l.userAgent })),
  };
});
