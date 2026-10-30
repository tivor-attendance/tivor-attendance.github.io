import { z } from "zod";
import { ApiError, requireUser, route, searchParams } from "@/lib/api";
import { prisma } from "@/lib/db";
import { employeeLog, individualReport } from "@/lib/individual-report";
import { isoDateSchema } from "@/lib/validators";
import { eachDate } from "@/lib/dates";

export const GET = route(async (req) => {
  await requireUser(req, "reports:read");
  const q = z.object({ from: isoDateSchema, to: isoDateSchema, employeeId: z.string().optional() }).parse(searchParams(req));
  if (q.from > q.to) throw new ApiError(400, "From date must be before To date");
  if (eachDate(q.from, q.to).length > 731) throw new ApiError(400, "Range is limited to two years");
  const [rows, employees] = await Promise.all([individualReport(q.from, q.to), prisma.employee.findMany({ select: { id: true, empCode: true } })]);
  const ids = new Map(employees.map((e) => [e.empCode, e.id]));
  return {
    from: q.from,
    to: q.to,
    rows: rows.map((r) => ({ ...r, employeeId: ids.get(r.empCode) ?? "" })),
    log: q.employeeId ? await employeeLog(q.employeeId, q.from, q.to) : undefined,
  };
});
