import { ApiError, readJson, requireUser, route } from "@/lib/api";
import { applyChanges, employmentOf } from "@/lib/attendance";
import { isEmployed } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { eachDate } from "@/lib/dates";
import { bulkRangeSchema } from "@/lib/validators";

/** Bulk bar: apply one status (or reset) to several employees over a date range. NA days are skipped. */
export const POST = route(async (req) => {
  const user = await requireUser(req, "attendance:write");
  const body = bulkRangeSchema.parse(await readJson(req));
  if (!body.status && !body.reset) throw new ApiError(400, "Choose a status or reset");
  const dates = eachDate(body.from, body.to);
  if (dates.length > 366) throw new ApiError(400, "Range too large (max 1 year)");
  const employees = await prisma.employee.findMany({ where: { id: { in: body.employeeIds } } });
  const changes = employees.flatMap((e) => {
    const win = employmentOf(e);
    return dates.filter((d) => isEmployed(d, win)).map((date) => ({ employeeId: e.id, date, status: body.status, reset: body.reset }));
  });
  return applyChanges(changes, user);
});
