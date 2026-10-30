import { requireUser, route, searchParams } from "@/lib/api";
import { holidayConflicts } from "@/lib/holidays";
import { isoDateSchema } from "@/lib/validators";

/** Manually edited cells on a date — these keep their value when a holiday is added. */
export const GET = route(async (req) => {
  await requireUser(req, "holidays:write");
  const date = isoDateSchema.parse(searchParams(req).date);
  return { conflicts: await holidayConflicts(date) };
});
