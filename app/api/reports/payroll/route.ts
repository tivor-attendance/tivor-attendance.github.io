import { z } from "zod";
import { fileResponse, requireUser, route, searchParams } from "@/lib/api";
import { payrollSummary } from "@/lib/reports";
import { toCsv, toXlsx } from "@/lib/exports";
import { MONTHS } from "@/lib/dates";
import { monthQuerySchema } from "@/lib/validators";

export const GET = route(async (req) => {
  const user = await requireUser(req, "reports:read");
  const q = searchParams(req);
  const { year, month } = monthQuerySchema.parse(q);
  const format = z.enum(["xlsx", "csv"]).parse(q.format ?? "xlsx");
  const p = await payrollSummary(year, month, { sensitive: user.canViewSensitive, department: q.department || undefined });
  const salaryCols = p.salaryVisible ? ["Monthly Gross", "Per-day Salary", "LOP Deduction", "Payable Gross"] : [];
  const table = {
    headers: ["Emp ID", "Name", "Department", "Working Days", "Present", "WFH", "Half Days", "Absent", "LOP Leave",
      ...p.leaveCodes, "Holidays", "Weekly Offs", "NA Days", "LOP Days", "Paid Days", ...salaryCols],
    rows: p.rows.map((r) => [
      r.empCode, r.name, r.department, r.workingDays, r.present, r.wfh, r.halfDay, r.absent, r.lop,
      ...p.leaveCodes.map((c) => r.leaves[c] ?? 0), r.holidays, r.weeklyOffs, r.naDays, r.lopDays, r.paidDays,
      ...(p.salaryVisible ? [r.monthlySalary, r.perDaySalary, r.lopDeduction, r.payableGross] : []),
    ]),
  };
  const name = `payroll-summary-${year}-${String(month).padStart(2, "0")}`;
  if (format === "csv") return fileResponse(toCsv(table), `${name}.csv`, "text/csv; charset=utf-8");
  const title = `Payroll Summary — ${MONTHS[month - 1]} ${year} (${p.basis} basis, ${p.basisDays} days)${p.lock ? " — LOCKED" : " — NOT LOCKED"}`;
  return fileResponse(await toXlsx(table, "Payroll", title), `${name}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});
