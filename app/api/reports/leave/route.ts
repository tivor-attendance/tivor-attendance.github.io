import { fileResponse, requireUser, route, searchParams } from "@/lib/api";
import { leaveReport } from "@/lib/reports";
import { toCsv, toXlsx } from "@/lib/exports";
import { parseISO, todayIST } from "@/lib/dates";

export const GET = route(async (req) => {
  await requireUser(req, "reports:read");
  const q = searchParams(req);
  const year = Number(q.year) || parseISO(todayIST()).year;
  const rows = await leaveReport(year);
  if (!q.format) return { year, rows };
  const types = ["CL", "SL", "EL"];
  const table = {
    headers: ["Emp ID", "Name", "Department", ...types.flatMap((t) => [`${t} Allotted`, `${t} Used`, `${t} Remaining`])],
    rows: rows.map((r) => [r.empCode, r.name, r.department, ...types.flatMap((t) => {
      const b = r.balances[t];
      return b ? [b.allotted, b.used, b.remaining] : [0, 0, 0];
    })]),
  };
  if (q.format === "csv") return fileResponse(toCsv(table), `leave-report-${year}.csv`, "text/csv; charset=utf-8");
  return fileResponse(await toXlsx(table, "Leave", `Leave Report ${year}`), `leave-report-${year}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});
