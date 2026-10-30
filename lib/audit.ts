import type { Prisma } from "@/lib/generated/prisma/client";
import type { Actor } from "./api";

export interface AuditEntry {
  entity: string;
  entityId?: string | null;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
}

const json = (v: unknown) => (v === undefined || v === null ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));

/** Audit entries are append-only (enforced by a DB trigger as well). */
export async function audit(tx: Prisma.TransactionClient, actor: Pick<Actor, "id" | "ip" | "userAgent"> | null, entries: AuditEntry[]) {
  if (!entries.length) return;
  await tx.auditLog.createMany({
    data: entries.map((e) => ({
      userId: actor?.id ?? null,
      entity: e.entity,
      entityId: e.entityId ?? null,
      action: e.action,
      oldValue: json(e.oldValue),
      newValue: json(e.newValue),
      ip: actor?.ip ?? null,
      userAgent: actor?.userAgent ?? null,
    })),
  });
}
