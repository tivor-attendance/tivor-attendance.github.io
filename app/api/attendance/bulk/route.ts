import { readJson, requireUser, route } from "@/lib/api";
import { applyChanges } from "@/lib/attendance";
import { bulkChangeSchema } from "@/lib/validators";

/** Apply a batch of cell changes atomically (single cell edits, drag ranges, undo/redo). */
export const POST = route(async (req) => {
  const user = await requireUser(req, "attendance:write");
  const { changes } = bulkChangeSchema.parse(await readJson(req));
  return applyChanges(changes, user);
});
