import { readJson, requireUser, route } from "@/lib/api";
import { upsertOverride } from "@/lib/holidays";
import { overrideSchema } from "@/lib/validators";

/** Mark a specific date as a working day (e.g. compensatory Sunday) or as a day off. */
export const POST = route(async (req) => {
  const user = await requireUser(req, "holidays:write");
  const { affected } = await upsertOverride(overrideSchema.parse(await readJson(req)), user);
  return { affected };
});
