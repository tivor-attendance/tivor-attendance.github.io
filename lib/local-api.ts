"use client";

// In-browser backend used for the static (GitHub Pages) build. It mirrors the REST API's
// request/response shapes so the UI is identical in both modes. Data lives in localStorage.
import { DEFAULT_STATUSES, ABSENT_CODE, HALF_DAY_CODE, REASON_CODES, SELECTABLE_CODES } from "./status";
import { SEED_ABSENCES, SEED_EMPLOYEES } from "./seed-data";
import { DEFAULT_SETTINGS } from "./settings-types";
import { dayKind, defaultStatus, isEmployed, type CalendarContext } from "./calendar";
import { WEEKDAYS_SHORT, eachDate, isoDate, minDate, monthDates, monthEnd, monthStart, parseISO, todayIST, weekday, type ISODate } from "./dates";

interface Emp { id: string; empCode: string; name: string; dateOfJoining: ISODate; dateOfExit: ISODate | null; status: "ACTIVE" | "INACTIVE" }
interface Rec { status: string; remarks: string | null }
interface Holiday { id: string; date: ISODate; name: string; type: string }
export interface LocalDb { version: 1; employees: Emp[]; records: Record<string, Record<ISODate, Rec>>; holidays: Holiday[] }

// v2: real office data (Sep–Nov 2026). Bumping the key discards the old sample data.
const KEY = "tivor-attendance-v2";

export class LocalApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const uid = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function seed(): LocalDb {
  const employees: Emp[] = SEED_EMPLOYEES.map((e) => ({ id: uid(), empCode: e.code, name: e.name, dateOfJoining: e.dateOfJoining, dateOfExit: null, status: "ACTIVE" }));
  const byCode = new Map(employees.map((e) => [e.empCode, e.id]));
  const records: LocalDb["records"] = {};
  for (const [code, date, reason] of SEED_ABSENCES) {
    const id = byCode.get(code);
    if (id) (records[id] ??= {})[date] = { status: ABSENT_CODE, remarks: reason };
  }
  return { version: 1, employees, records, holidays: [] };
}

export function loadDb(): LocalDb {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const db = JSON.parse(raw) as LocalDb;
      if (db?.version === 1 && Array.isArray(db.employees)) return db;
    }
  } catch { /* fall through to seed */ }
  const db = seed();
  saveDb(db);
  return db;
}

export function saveDb(db: LocalDb) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    throw new LocalApiError(507, "Could not save — browser storage is full or blocked");
  }
}

export function exportDb(): string {
  return JSON.stringify(loadDb(), null, 2);
}

export function importDb(json: string) {
  const db = JSON.parse(json) as LocalDb;
  if (db?.version !== 1 || !Array.isArray(db.employees) || typeof db.records !== "object" || !Array.isArray(db.holidays)) {
    throw new LocalApiError(400, "This is not a valid attendance backup file");
  }
  saveDb(db);
}

const ctxFor = (db: LocalDb): CalendarContext => ({
  holidays: new Map(db.holidays.map((h) => [h.date, { name: h.name, type: h.type }])),
  overrides: new Map(),
  weeklyOff: DEFAULT_SETTINGS.weeklyOff,
});

function effective(db: LocalDb, emp: Emp, date: ISODate, ctx: CalendarContext, today: ISODate) {
  const def = defaultStatus(date, emp, ctx);
  if (def === "NA" || def === "H") return { status: def, source: date > today ? "NONE" : "AUTO", remarks: null, def } as const;
  const rec = db.records[emp.id]?.[date];
  if (rec) return { status: rec.status, source: "MANUAL", remarks: rec.remarks, def } as const;
  return { status: def, source: date > today ? "NONE" : "AUTO", remarks: null, def } as const;
}

const inRange = (e: Emp, from: ISODate, to: ISODate) => e.dateOfJoining <= to && (e.status === "ACTIVE" || (e.dateOfExit !== null && e.dateOfExit >= from));
const sorted = (db: LocalDb) => [...db.employees].sort((a, b) => a.empCode.localeCompare(b.empCode));

function grid(db: LocalDb, year: number, month: number, search?: string) {
  const today = todayIST();
  const ctx = ctxFor(db);
  const from = monthStart(year, month);
  const to = monthEnd(year, month);
  const dates = monthDates(year, month);
  const s = search?.trim().toLowerCase();
  const emps = sorted(db).filter((e) => inRange(e, from, to) && (!s || e.name.toLowerCase().includes(s) || e.empCode.toLowerCase().includes(s)));
  return {
    year, month, today,
    days: dates.map((date, i) => ({
      date, day: i + 1, weekday: weekday(date), kind: dayKind(date, ctx), holiday: ctx.holidays.get(date)?.name ?? null,
      override: null, future: date > today, today: date === today,
    })),
    rows: emps.map((e) => ({ id: e.id, empCode: e.empCode, name: e.name, department: null, cells: dates.map((d) => effective(db, e, d, ctx, today)) })),
    lock: null, statuses: DEFAULT_STATUSES, basis: "calendar" as const, canEdit: true, role: "ADMIN" as const,
  };
}

interface Change { employeeId: string; date: ISODate; status?: string; reset?: boolean; remarks?: string | null }

function applyChanges(db: LocalDb, changes: Change[]) {
  const ctx = ctxFor(db);
  const today = todayIST();
  const byId = new Map(db.employees.map((e) => [e.id, e]));
  // Validate everything first so a batch is all-or-nothing.
  for (const c of changes) {
    const emp = byId.get(c.employeeId);
    if (!emp) throw new LocalApiError(404, "Employee not found");
    if (!isEmployed(c.date, emp)) throw new LocalApiError(422, `${emp.name} is not employed on ${c.date}.`);
    const def = defaultStatus(c.date, emp, ctx);
    if (def === "H" && !c.reset) throw new LocalApiError(422, `${c.date} is a public holiday — it is always marked H.`);
    if (c.status && !(SELECTABLE_CODES as readonly string[]).includes(c.status)) throw new LocalApiError(400, "Only Present (P) or Absent (AB) can be marked");
    if (c.status && REASON_CODES.includes(c.status) && !c.remarks?.trim()) {
      throw new LocalApiError(422, `Please give a reason for ${emp.name}'s ${c.status === HALF_DAY_CODE ? "half day" : "absence"} on ${c.date}.`);
    }
  }
  const applied = changes.map((c) => {
    const recs = (db.records[c.employeeId] ??= {});
    if (c.reset) delete recs[c.date];
    else if (c.status) recs[c.date] = { status: c.status, remarks: REASON_CODES.includes(c.status) ? c.remarks!.trim() : null };
    else if (c.remarks !== undefined && recs[c.date]) recs[c.date].remarks = c.remarks;
    const e = effective(db, byId.get(c.employeeId)!, c.date, ctx, today);
    return { employeeId: c.employeeId, date: c.date, status: e.status, source: e.source === "MANUAL" ? "MANUAL" : "AUTO", remarks: e.remarks };
  });
  saveDb(db);
  return { applied, warnings: [] as string[] };
}

function report(db: LocalDb, from: ISODate, to: ISODate, employeeId?: string) {
  const today = todayIST();
  const ctx = ctxFor(db);
  const end = minDate(to, today);
  const dates = from <= end ? eachDate(from, end) : [];
  const rows = sorted(db).filter((e) => inRange(e, from, to)).map((e) => {
    let workingDays = 0, present = 0, absent = 0, halfDays = 0, holidays = 0;
    for (const d of dates) {
      if (!isEmployed(d, e)) continue;
      const s = effective(db, e, d, ctx, today).status;
      if (s === "WO") continue;
      workingDays++;
      if (s === ABSENT_CODE) absent++;
      else if (s === HALF_DAY_CODE) halfDays++;
      else present++;
      if (s === "H") holidays++;
    }
    // Half day = half present.
    const percentage = workingDays ? Math.round(((present + halfDays * 0.5) / workingDays) * 1000) / 10 : null;
    return { employeeId: e.id, empCode: e.empCode, name: e.name, workingDays, present, absent, halfDays, holidays, percentage };
  });
  let log;
  if (employeeId) {
    const emp = db.employees.find((e) => e.id === employeeId);
    log = emp ? eachDate(from, to).filter((d) => isEmployed(d, emp)).map((d) => ({ d, e: effective(db, emp, d, ctx, today) }))
      .filter(({ e }) => REASON_CODES.includes(e.status)).map(({ d, e }) => ({ date: d, status: e.status, note: e.remarks, upcoming: d > today })) : [];
  }
  return { from, to, rows, log };
}

export async function localApi<T>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const u = new URL(url, "http://local");
  const path = u.pathname;
  const q = Object.fromEntries(u.searchParams.entries());
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const body = (opts.body ?? {}) as Record<string, unknown>;
  const db = loadDb();
  const r = <R>(v: R) => v as unknown as T;

  if (path === "/api/attendance" && method === "GET") return r(grid(db, Number(q.year), Number(q.month), q.search));
  if (path === "/api/attendance/bulk" && method === "POST") return r(applyChanges(db, (body.changes as Change[]) ?? []));
  if (path === "/api/meta") {
    return r({ user: { id: "admin", name: "Admin", role: "ADMIN", canViewSensitive: true }, departments: [], statuses: DEFAULT_STATUSES, companyName: "",
      employees: sorted(db).map((e) => ({ id: e.id, empCode: e.empCode, name: e.name, status: e.status })) });
  }
  if (path === "/api/employees" && method === "POST") {
    const name = String(body.name ?? "").trim();
    const doj = String(body.dateOfJoining ?? "");
    if (!name) throw new LocalApiError(400, "Name is required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(doj)) throw new LocalApiError(400, "Enter a valid joining date");
    const max = db.employees.reduce((m, e) => Math.max(m, Number(e.empCode.replace(/\D/g, "")) || 0), 0);
    const emp: Emp = { id: uid(), empCode: `EMP${String(max + 1).padStart(3, "0")}`, name, dateOfJoining: doj, dateOfExit: null, status: "ACTIVE" };
    db.employees.push(emp);
    saveDb(db);
    return r(emp);
  }
  const em = path.match(/^\/api\/employees\/([^/]+)$/);
  if (em && method === "DELETE") {
    const emp = db.employees.find((e) => e.id === em[1]);
    if (!emp) throw new LocalApiError(404, "Employee not found");
    db.employees = db.employees.filter((e) => e.id !== emp.id);
    delete db.records[emp.id];
    saveDb(db);
    return r({ ok: true, name: emp.name });
  }
  if (path === "/api/holidays" && method === "GET") {
    const year = Number(q.year) || parseISO(todayIST()).year;
    return r({ year, overrides: [], holidays: db.holidays.filter((h) => h.date.startsWith(`${year}-`)).sort((a, b) => a.date.localeCompare(b.date)) });
  }
  if (path === "/api/holidays" && method === "POST") {
    const date = String(body.date ?? "");
    const name = String(body.name ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) throw new LocalApiError(400, "Date and name are required");
    const clash = db.holidays.find((h) => h.date === date);
    if (clash) throw new LocalApiError(409, `A holiday already exists on ${date} (${clash.name})`);
    const h = { id: uid(), date, name, type: String(body.type ?? "NATIONAL") };
    db.holidays.push(h);
    let affected = 0;
    for (const e of db.employees) {
      if (isEmployed(date, e)) affected++;
      if (db.records[e.id]?.[date]) delete db.records[e.id][date]; // holiday always wins
    }
    saveDb(db);
    return r({ id: h.id, affected });
  }
  const hm = path.match(/^\/api\/holidays\/([^/]+)$/);
  if (hm && method === "DELETE") {
    const before = db.holidays.length;
    db.holidays = db.holidays.filter((h) => h.id !== hm[1]);
    if (db.holidays.length === before) throw new LocalApiError(404, "Holiday not found");
    saveDb(db);
    return r({ affected: 0 });
  }
  if (path === "/api/report") {
    if (!q.from || !q.to || q.from > q.to) throw new LocalApiError(400, "Choose a valid date range");
    return r(report(db, q.from, q.to, q.employeeId || undefined));
  }
  throw new LocalApiError(404, `Not available in this version: ${method} ${path}`);
}

/** CSV attendance register for a month (static build export). */
export function registerCsv(year: number, month: number): { name: string; csv: string } {
  const db = loadDb();
  const g = grid(db, year, month);
  const header = ["Emp ID", "Name", ...g.days.map((d) => `${d.day} ${WEEKDAYS_SHORT[d.weekday]}`), "Present", "Half days", "Absent", "Reasons"];
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = g.rows.map((row) => {
    let p = 0, a = 0, h = 0;
    const reasons: string[] = [];
    const cells = row.cells.map((c, i) => {
      const future = g.days[i].future && c.source === "NONE";
      if (!future && c.status !== "NA" && c.status !== "WO") {
        if (c.status === ABSENT_CODE) { a++; reasons.push(`${g.days[i].day} AB: ${c.remarks ?? ""}`); }
        else if (c.status === HALF_DAY_CODE) { h++; reasons.push(`${g.days[i].day} HD: ${c.remarks ?? ""}`); }
        else p++;
      }
      return future || c.status === "NA" ? "" : c.status;
    });
    return [row.empCode, row.name, ...cells, p, h, a, reasons.join("; ")].map(esc).join(",");
  });
  return { name: `attendance-${year}-${String(month).padStart(2, "0")}.csv`, csv: "﻿" + [header.map(esc).join(","), ...lines].join("\r\n") };
}
