// Pure calendar rules: which status a day gets automatically.
import { parseISO, weekday, type ISODate } from "./dates";
import type { WeeklyOffRule } from "./settings-types";

export interface CalendarContext {
  holidays: Map<ISODate, { name: string; type: string }>;
  /** date → true (forced working day) / false (forced day off) */
  overrides: Map<ISODate, boolean>;
  weeklyOff: WeeklyOffRule;
}

export interface EmploymentWindow {
  dateOfJoining: ISODate;
  dateOfExit: ISODate | null;
}

export function isWeeklyOff(date: ISODate, rule: WeeklyOffRule): boolean {
  const wd = weekday(date);
  if (wd === 0) return rule.sunday;
  if (wd === 6) {
    if (rule.saturday === "all") return true;
    if (rule.saturday === "second_fourth") {
      const nth = Math.ceil(parseISO(date).day / 7);
      return nth === 2 || nth === 4;
    }
  }
  return false;
}

export type DayKind = "working" | "holiday" | "weeklyOff";

/** Company-level classification of a date. Explicit overrides beat holidays and weekly-off rules. */
export function dayKind(date: ISODate, ctx: CalendarContext): DayKind {
  const override = ctx.overrides.get(date);
  if (override === true) return "working";
  if (override === false) return "weeklyOff";
  if (ctx.holidays.has(date)) return "holiday";
  if (isWeeklyOff(date, ctx.weeklyOff)) return "weeklyOff";
  return "working";
}

export function isEmployed(date: ISODate, emp: EmploymentWindow): boolean {
  if (date < emp.dateOfJoining) return false;
  if (emp.dateOfExit && date > emp.dateOfExit) return false;
  return true;
}

/** The status the system fills in automatically for an employee on a date. */
export function defaultStatus(date: ISODate, emp: EmploymentWindow, ctx: CalendarContext): "P" | "H" | "WO" | "NA" {
  if (!isEmployed(date, emp)) return "NA";
  const kind = dayKind(date, ctx);
  if (kind === "holiday") return "H";
  if (kind === "weeklyOff") return "WO";
  return "P";
}

export interface GeneratedRecord {
  employeeId: string;
  date: ISODate;
  status: string;
}

/**
 * Records the daily job should insert for the given dates. Only days inside the
 * employment window are materialised; NA days are derived on read.
 * Existing records are never touched — the caller inserts with ON CONFLICT DO NOTHING.
 */
export function planGeneration(
  dates: ISODate[],
  employees: (EmploymentWindow & { id: string })[],
  ctx: CalendarContext,
): GeneratedRecord[] {
  const out: GeneratedRecord[] = [];
  for (const date of dates) {
    for (const emp of employees) {
      if (!isEmployed(date, emp)) continue;
      out.push({ employeeId: emp.id, date, status: defaultStatus(date, emp, ctx) });
    }
  }
  return out;
}
