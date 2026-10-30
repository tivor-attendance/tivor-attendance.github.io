import { requireUser, route } from "@/lib/api";
import { deleteOverride } from "@/lib/holidays";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req, "holidays:write");
  const { id } = await params;
  return deleteOverride(id, user);
});
