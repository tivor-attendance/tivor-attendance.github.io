// Date helpers. Attendance days are plain calendar dates ("YYYY-MM-DD") in Asia/Kolkata.
// They are persisted as Postgres DATE values, which Prisma exposes as UTC-midnight Date objects.

export const TIMEZONE = "Asia/Kolkata";
export type ISODate = string;

export const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const pad = (n: number) => String(n).padStart(2, "0");

export function isoDate(year: number, month: number, day: number): ISODate {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Today's date in IST, regardless of server timezone. */
export function todayIST(now: Date = new Date()): ISODate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function toDbDate(d: ISODate): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Invalid date: ${d}`);
  return new Date(`${d}T00:00:00.000Z`);
}

export function fromDbDate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function parseISO(d: ISODate) {
  const [year, month, day] = d.split("-").map(Number);
  return { year, month, day };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthStart(year: number, month: number): ISODate {
  return isoDate(year, month, 1);
}

export function monthEnd(year: number, month: number): ISODate {
  return isoDate(year, month, daysInMonth(year, month));
}

export function monthDates(year: number, month: number): ISODate[] {
  return Array.from({ length: daysInMonth(year, month) }, (_, i) => isoDate(year, month, i + 1));
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(d: ISODate): number {
  return toDbDate(d).getUTCDay();
}

export function addDays(d: ISODate, n: number): ISODate {
  const dt = toDbDate(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromDbDate(dt);
}

export function addMonths(year: number, month: number, delta: number) {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function eachDate(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function minDate(a: ISODate, b: ISODate) { return a < b ? a : b; }
export function maxDate(a: ISODate, b: ISODate) { return a > b ? a : b; }

export function monthKey(d: ISODate) { return d.slice(0, 7); }

export function formatDate(d: ISODate | null | undefined, style: "short" | "long" = "short"): string {
  if (!d) return "—";
  const { year, month, day } = parseISO(d);
  const m = MONTHS[month - 1];
  return style === "long" ? `${WEEKDAYS_SHORT[weekday(d)]}, ${day} ${m} ${year}` : `${pad(day)} ${m.slice(0, 3)} ${year}`;
}

export function formatDateTime(d: Date | string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIMEZONE, dateStyle: "medium", timeStyle: "short",
  }).format(new Date(d));
}
