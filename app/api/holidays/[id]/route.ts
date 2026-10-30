import { readJson, requireUser, route } from "@/lib/api";
import { deleteHoliday, updateHoliday } from "@/lib/holidays";
import { holidaySchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req, "holidays:write");
  const { id } = await params;
  const { affected } = await updateHoliday(id, holidaySchema.parse(await readJson(req)), user);
  return { affected };
});

/** Soft delete; AUTO cells on that date revert to their default (P / WO). */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req, "holidays:write");
  const { id } = await params;
  return deleteHoliday(id, user);
});
