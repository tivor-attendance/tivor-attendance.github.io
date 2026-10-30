import { readJson, requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSettings, saveSettings } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { recomputeAuto } from "@/lib/attendance";
import { settingsSchema } from "@/lib/settings-types";
import { monthStart, parseISO, todayIST } from "@/lib/dates";

export const GET = route(async (req) => {
  await requireUser(req, "settings:read");
  return getSettings();
});

export const PUT = route(async (req) => {
  const user = await requireUser(req, "settings:write");
  const next = settingsSchema.parse(await readJson(req));
  return prisma.$transaction(async (tx) => {
    const prev = await getSettings(tx);
    await saveSettings(next, tx);
    await audit(tx, user, [{ entity: "Setting", entityId: "app", action: "UPDATE", oldValue: { ...prev, companyLogo: prev.companyLogo ? "[image]" : null }, newValue: { ...next, companyLogo: next.companyLogo ? "[image]" : null } }]);
    let affected = 0;
    if (JSON.stringify(prev.weeklyOff) !== JSON.stringify(next.weeklyOff)) {
      // Weekly-off policy changes apply from the start of the current month (locked months untouched).
      const t = parseISO(todayIST());
      const from = monthStart(t.year, t.month);
      affected = await recomputeAuto(tx, user, { from, to: todayIST(), reason: "Weekly-off policy changed" });
    }
    return { settings: next, affected };
  }, { timeout: 60_000 });
});
