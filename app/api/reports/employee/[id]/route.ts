import { ApiError, fileResponse, requireUser, route, searchParams } from "@/lib/api";
import { employeeYear } from "@/lib/reports";
import { toXlsx } from "@/lib/exports";
import { MONTHS, parseISO, todayIST } from "@/lib/dates";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  await requireUser(req, "reports:read");
  const { id } = await params;
  const q = searchParams(req);
  const year = Number(q.year) || parseISO(todayIST()).year;
  const data = await employeeYear(id, year);
  if (!data) throw new ApiError(404, "Employee not found");
  if (q.format !== "xlsx") return data;
  const table = {
    headers: ["Month", "Present", "Absent", "Half Days", "Paid Leave", "LOP", "WFH", "Holidays", "Weekly Offs", "NA", "LOP Days", "Paid Days"],
    rows: data.months.map((m) => [MONTHS[m.month - 1], m.summary.present, m.summary.absent, m.summary.halfDay, m.summary.paidLeave,
      m.summary.lop, m.summary.wfh, m.summary.holiday, m.summary.weeklyOff, m.summary.na, m.summary.lopDays, m.summary.paidDays]),
  };
  const buf = await toXlsx(table, "Yearly", `${data.employee.empCode} — ${data.employee.name} — ${year}`);
  return fileResponse(buf, `${data.employee.empCode}-${year}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});
