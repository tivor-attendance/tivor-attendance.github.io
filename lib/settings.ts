import { prisma } from "./db";
import { DEFAULT_SETTINGS, type AppSettings } from "./settings-types";
import type { Prisma } from "@/lib/generated/prisma/client";

const KEY = "app";

export async function getSettings(tx: Prisma.TransactionClient = prisma): Promise<AppSettings> {
  const row = await tx.setting.findUnique({ where: { key: KEY } });
  const stored = (row?.value ?? {}) as Partial<AppSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    weeklyOff: { ...DEFAULT_SETTINGS.weeklyOff, ...stored.weeklyOff },
    leaveAllotment: { ...DEFAULT_SETTINGS.leaveAllotment, ...stored.leaveAllotment },
    statuses: stored.statuses?.length ? stored.statuses : DEFAULT_SETTINGS.statuses,
  };
}

export async function saveSettings(value: AppSettings, tx: Prisma.TransactionClient = prisma) {
  const json = value as unknown as Prisma.InputJsonValue;
  await tx.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: json }, update: { value: json } });
}
