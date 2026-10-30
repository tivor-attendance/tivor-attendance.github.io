import { z } from "zod";
import { readJson, requireUser, route } from "@/lib/api";
import { copyHolidaysFromYear } from "@/lib/holidays";

export const POST = route(async (req) => {
  const user = await requireUser(req, "holidays:write");
  const { year } = z.object({ year: z.number().int().min(2001).max(2100) }).parse(await readJson(req));
  return copyHolidaysFromYear(year - 1, year, user);
});
