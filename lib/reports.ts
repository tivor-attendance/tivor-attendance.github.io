import { prisma } from "./db";
import { getMonthGrid, summarizeGrid, companyWorkingDays, loadCalendar, employmentOf, generateAttendance } from "./attendance";
import { computeSalary, summarize } from "./payroll";
import { getSettings } from "./settings";
import { statusMap } from "./status";
import { defaultStatus, dayKind } from "./calendar";
import { daysInMonth, eachDate, fromDbDate, isoDate, minDate, toDbDate, todayIST, type ISODate } from "./dates";
import { ensureLeaveBalances } from "./employees";

export interface PayrollRow {
  employeeId: string;
  empCode: string;
  name: string;
  department: string | null;
  workingDays: number;
  present: number;
  wfh: number;
  halfDay: number;
  absent: number;
  lop: number;
  leaves: Record<string, number>;
  holidays: number;
  weeklyOffs: number;
  naDays: number;
  lopDays: number;
  paidDays: number;
  monthlySalary: number | null;
  perDaySalary: number | null;
  lopDeduction: number | null;
  payableGross: number | null;
}

export async function payrollSummary(year: number, month: number, opts: { sensitive: boolean; department?: string }) {
  const grid = await getMonthGrid(year, month, { department: opts.department });
  const summaries = summarizeGrid(grid);
  const leaveCodes = grid.statuses.filter((s) => s.leaveType).map((s) => s.code);
  const basisDays = grid.basis === "calendar" ? daysInMonth(year, month) : companyWorkingDays(grid);
  const salaries = opts.sensitive
    ? new Map((await prisma.employee.findMany({ where: { id: { in: grid.rows.map((r) => r.id) } }, select: { id: true, monthlySalary: true } }))
        .map((e) => [e.id, e.monthlySalary === null ? null : Number(e.monthlySalary)]))
    : new Map<string, number | null>();

  const rows: PayrollRow[] = grid.rows.map((r) => {
    const s = summaries.get(r.id)!;
    const salary = salaries.get(r.id) ?? null;
    const pay = salary !== null ? computeSalary(salary, basisDays, s) : null;
    return {
      employeeId: r.id, empCode: r.empCode, name: r.name, department: r.department,
      workingDays: s.workingDays, present: s.present, wfh: s.wfh, halfDay: s.halfDay, absent: s.absent, lop: s.lop,
      leaves: Object.fromEntries(leaveCodes.map((c) => [c, s.byCode[c] ?? 0])),
      holidays: s.holiday, weeklyOffs: s.weeklyOff, naDays: s.na, lopDays: s.lopDays, paidDays: s.paidDays,
      monthlySalary: salary, perDaySalary: pay?.perDaySalary ?? null, lopDeduction: pay?.lopDeduction ?? null, payableGross: pay?.payableGross ?? null,
    };
  });
  return { year, month, basis: grid.basis, basisDays, lock: grid.lock, leaveCodes, rows, salaryVisible: opts.sensitive };
}

export async function leaveReport(year: number) {
  await ensureLeaveBalances(year);
  const balances = await prisma.leaveBalance.findMany({
    where: { year },
    include: { employee: { select: { empCode: true, name: true, department: true, status: true } } },
    orderBy: [{ employee: { empCode: "asc" } }, { leaveType: "asc" }],
  });
  const byEmp = new Map<string, { empCode: string; name: string; department: string | null; status: string; balances: Record<string, { allotted: number; used: number; remaining: number }> }>();
  for (const b of balances) {
    const cur = byEmp.get(b.employeeId) ?? { empCode: b.employee.empCode, name: b.employee.name, department: b.employee.department, status: b.employee.status, balances: {} };
    cur.balances[b.leaveType] = { allotted: Number(b.allotted), used: Number(b.used), remaining: Number(b.allotted) - Number(b.used) };
    byEmp.set(b.employeeId, cur);
  }
  return [...byEmp.entries()].map(([employeeId, v]) => ({ employeeId, ...v }));
}

export interface RangeRecord {
  date: ISODate;
  empCode: string;
  name: string;
  department: string | null;
  status: string;
  source: string;
  remarks: string | null;
}

/** Effective status for every employed day in a range (records + derived defaults for missing days). */
export async function rangeRecords(f: { from: ISODate; to: ISODate; department?: string; employeeId?: string; status?: string }): Promise<RangeRecord[]> {
  const today = todayIST();
  if (f.from <= today) await generateAttendance(f.from, minDate(f.to, today));
  const settings = await getSettings();
  const ctx = await loadCalendar(f.from, f.to, settings);
  const employees = await prisma.employee.findMany({
    where: {
      dateOfJoining: { lte: toDbDate(f.to) },
      ...(f.department ? { department: f.department } : {}),
      ...(f.employeeId ? { id: f.employeeId } : {}),
    },
    orderBy: { empCode: "asc" },
  });
  const records = await prisma.attendanceRecord.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: toDbDate(f.from), lte: toDbDate(f.to) } },
  });
  const map = new Map(records.map((r) => [`${r.employeeId}|${fromDbDate(r.date)}`, r]));
  const out: RangeRecord[] = [];
  const dates = eachDate(f.from, f.to);
  for (const e of employees) {
    const emp = employmentOf(e);
    for (const date of dates) {
      const def = defaultStatus(date, emp, ctx);
      if (def === "NA") continue;
      const r = map.get(`${e.id}|${date}`);
      const status = r?.status ?? def;
      if (f.status && status !== f.status) continue;
      out.push({ date, empCode: e.empCode, name: e.name, department: e.department, status, source: r?.source ?? (date > today ? "UPCOMING" : "AUTO"), remarks: r?.remarks ?? null });
    }
  }
  return out;
}

/** Yearly per-month summary for one employee plus the month calendars. */
export async function employeeYear(employeeId: string, year: number) {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) return null;
  const settings = await getSettings();
  const defs = statusMap(settings.statuses);
  const from = isoDate(year, 1, 1);
  const to = isoDate(year, 12, 31);
  const records = await rangeRecords({ from, to, employeeId });
  const ctx = await loadCalendar(from, to, settings);
  const byDate = new Map(records.map((r) => [r.date, r]));
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const dates = eachDate(isoDate(year, m, 1), isoDate(year, m, daysInMonth(year, m)));
    const days = dates.map((d) => ({ date: d, status: byDate.get(d)?.status ?? "NA", remarks: byDate.get(d)?.remarks ?? null, source: byDate.get(d)?.source ?? "NA", kind: dayKind(d, ctx) }));
    const summary = summarize(days.map((d) => ({ status: d.status, companyWorking: d.kind === "working" })), defs, settings.payrollBasis);
    return { month: m, days, summary };
  });
  const balances = await prisma.leaveBalance.findMany({ where: { employeeId, year } });
  return {
    employee: { id: emp.id, empCode: emp.empCode, name: emp.name, department: emp.department, designation: emp.designation },
    year, months, statuses: settings.statuses,
    balances: balances.map((b) => ({ leaveType: b.leaveType, allotted: Number(b.allotted), used: Number(b.used) })),
  };
}
