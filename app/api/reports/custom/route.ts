import { z } from "zod";
import { ApiError, fileResponse, requireUser, route, searchParams } from "@/lib/api";
import { rangeRecords } from "@/lib/reports";
import { toCsv, toXlsx } from "@/lib/exports";
import { eachDate } from "@/lib/dates";
import { isoDateSchema } from "@/lib/validators";

export const GET = route(async (req) => {
  await requireUser(req, "reports:read");
  const q = z.object({
    from: isoDateSchema, to: isoDateSchema,
    department: z.string().optional(), employeeId: z.string().optional(), status: z.string().optional(),
    format: z.enum(["json", "csv", "xlsx"]).default("json"),
  }).parse(searchParams(req));
  if (q.from > q.to) throw new ApiError(400, "From date must be before To date");
  if (eachDate(q.from, q.to).length > 366) throw new ApiError(400, "Range is limited to one year");
  const rows = await rangeRecords({ from: q.from, to: q.to, department: q.department || undefined, employeeId: q.employeeId || undefined, status: q.status || undefined });
  if (q.format === "json") return { rows: rows.slice(0, 2000), total: rows.length };
  const table = {
    headers: ["Date", "Emp ID", "Name", "Department", "Status", "Source", "Remarks"],
    rows: rows.map((r) => [r.date, r.empCode, r.name, r.department, r.status, r.source, r.remarks]),
  };
  const name = `attendance-${q.from}-to-${q.to}`;
  if (q.format === "csv") return fileResponse(toCsv(table), `${name}.csv`, "text/csv; charset=utf-8");
  return fileResponse(await toXlsx(table, "Attendance", `Attendance ${q.from} to ${q.to}`), `${name}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});
