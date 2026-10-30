import { route, requireUser, searchParams } from "@/lib/api";
import { getMonthGrid } from "@/lib/attendance";
import { monthQuerySchema } from "@/lib/validators";
import { canEditMonth } from "@/lib/permissions";

export const GET = route(async (req) => {
  const user = await requireUser(req, "attendance:read");
  const q = searchParams(req);
  const { year, month } = monthQuerySchema.parse(q);
  const grid = await getMonthGrid(year, month, { department: q.department || undefined, search: q.search || undefined });
  return { ...grid, canEdit: canEditMonth(user.role, Boolean(grid.lock)), role: user.role };
});
