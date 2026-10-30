// Pure payroll math, shared by the grid (client) and payroll/reports (server).
import type { StatusDef } from "./status";
import type { PayrollBasis } from "./settings-types";

export interface AttendanceSummary {
  present: number;
  absent: number;
  halfDay: number;
  paidLeave: number;
  lop: number;
  wfh: number;
  holiday: number;
  weeklyOff: number;
  na: number;
  /** Count of each status code. */
  byCode: Record<string, number>;
  totalDays: number;
  /** Company working days on which the employee was employed. */
  workingDays: number;
  /** A + LOP + 0.5 × HD (generally: Σ (1 − paid) over counted days). */
  lopDays: number;
  paidDays: number;
}

export interface DayInput {
  status: string;
  /** Whether the company calendar treats this date as a working day. */
  companyWorking: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function summarize(days: DayInput[], defs: Map<string, StatusDef>, basis: PayrollBasis): AttendanceSummary {
  const s: AttendanceSummary = {
    present: 0, absent: 0, halfDay: 0, paidLeave: 0, lop: 0, wfh: 0, holiday: 0, weeklyOff: 0, na: 0,
    byCode: {}, totalDays: days.length, workingDays: 0, lopDays: 0, paidDays: 0,
  };
  let eligibleCalendar = 0;
  for (const d of days) {
    s.byCode[d.status] = (s.byCode[d.status] ?? 0) + 1;
    const def = defs.get(d.status);
    if (!def || !def.counted) {
      s.na += 1;
      continue;
    }
    s[def.bucket === "na" ? "na" : def.bucket] += 1;
    eligibleCalendar += 1;
    if (d.companyWorking) s.workingDays += 1;
    s.lopDays += 1 - def.paid;
  }
  s.lopDays = round2(s.lopDays);
  const eligible = basis === "calendar" ? eligibleCalendar : s.workingDays;
  s.paidDays = round2(Math.max(0, eligible - s.lopDays));
  return s;
}

export interface SalaryResult {
  basisDays: number;
  perDaySalary: number;
  lopDeduction: number;
  payableGross: number;
}

/**
 * basisDays: calendar days in the month (calendar basis) or company working days (working basis).
 * Payable = per-day × paid days, so mid-month joiners/leavers are pro-rated automatically.
 */
export function computeSalary(monthlySalary: number, basisDays: number, summary: AttendanceSummary): SalaryResult {
  if (basisDays <= 0) return { basisDays, perDaySalary: 0, lopDeduction: 0, payableGross: 0 };
  const perDay = monthlySalary / basisDays;
  return {
    basisDays,
    perDaySalary: round2(perDay),
    lopDeduction: round2(perDay * summary.lopDays),
    payableGross: round2(Math.min(monthlySalary, perDay * summary.paidDays)),
  };
}
