import { rangeRecords } from "./reports";
import { getSettings } from "./settings";
import { loadCalendar } from "./attendance";
import { ABSENT_CODE, statusMap } from "./status";
import { minDate, todayIST, type ISODate } from "./dates";

export interface PersonReport {
  employeeId: string;
  empCode: string;
  name: string;
  workingDays: number;
  present: number;
  absent: number;
  holidays: number;
  percentage: number | null;
}

export interface LogEntry {
  date: ISODate;
  status: string;
  note: string | null;
  upcoming: boolean;
}

/**
 * Working days = every employed day up to today except weekly offs (Sundays).
 * Public holidays count as working days AND as Present for everyone.
 */
export async function individualReport(from: ISODate, to: ISODate): Promise<PersonReport[]> {
  const end = minDate(to, todayIST());
  if (from > end) return [];
  const [records, settings] = await Promise.all([rangeRecords({ from, to: end }), getSettings()]);
  const defs = statusMap(settings.statuses);
  const byEmp = new Map<string, PersonReport>();
  for (const r of records) {
    const cur = byEmp.get(r.empCode) ?? { employeeId: "", empCode: r.empCode, name: r.name, workingDays: 0, present: 0, absent: 0, holidays: 0, percentage: null };
    byEmp.set(r.empCode, cur);
    const bucket = defs.get(r.status)?.bucket;
    if (bucket === "weeklyOff" || bucket === "na") continue;
    cur.workingDays++;
    if (r.status === ABSENT_CODE) cur.absent++;
    else if (bucket === "present") cur.present++;
    if (r.status === "H") cur.holidays++;
  }
  return [...byEmp.values()].map((p) => ({ ...p, percentage: p.workingDays ? Math.round((p.present / p.workingDays) * 1000) / 10 : null }));
}

/** Day-by-day log for one employee: status plus the absence reason or holiday name. */
export async function employeeLog(employeeId: string, from: ISODate, to: ISODate): Promise<LogEntry[]> {
  const settings = await getSettings();
  const [records, ctx] = await Promise.all([rangeRecords({ from, to, employeeId }), loadCalendar(from, to, settings)]);
  const today = todayIST();
  return records.map((r) => ({
    date: r.date,
    status: r.status,
    note: r.status === "H" ? ctx.holidays.get(r.date)?.name ?? "Public holiday" : r.status === ABSENT_CODE ? r.remarks : r.status === "WO" ? "Sunday" : r.remarks,
    upcoming: r.date > today,
  }));
}
