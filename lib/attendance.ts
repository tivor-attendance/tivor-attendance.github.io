import { prisma } from "./db";
import { Prisma } from "@/lib/generated/prisma/client";
import { getSettings } from "./settings";
import { audit } from "./audit";
import { ApiError, type Actor } from "./api";
import {
  addMonths, daysInMonth, eachDate, fromDbDate, maxDate, minDate, monthDates, monthEnd, monthKey,
  monthStart, parseISO, toDbDate, todayIST, weekday, type ISODate,
} from "./dates";
import { dayKind, defaultStatus, isEmployed, planGeneration, type CalendarContext } from "./calendar";
import { leaveDeltas } from "./leave";
import { ABSENT_CODE, selectableStatuses, statusMap, type StatusDef } from "./status";
import type { AppSettings } from "./settings-types";
import { summarize, type AttendanceSummary } from "./payroll";

type Tx = Prisma.TransactionClient;

export async function loadCalendar(from: ISODate, to: ISODate, settings?: AppSettings, tx: Tx = prisma): Promise<CalendarContext> {
  const s = settings ?? (await getSettings(tx));
  const [holidays, overrides] = await Promise.all([
    tx.holiday.findMany({ where: { deletedAt: null, date: { gte: toDbDate(from), lte: toDbDate(to) } } }),
    tx.workingDayOverride.findMany({ where: { deletedAt: null, date: { gte: toDbDate(from), lte: toDbDate(to) } } }),
  ]);
  return {
    holidays: new Map(holidays.map((h) => [fromDbDate(h.date), { name: h.name, type: h.type }])),
    overrides: new Map(overrides.map((o) => [fromDbDate(o.date), o.isWorking])),
    weeklyOff: s.weeklyOff,
  };
}

export function employmentOf(e: { dateOfJoining: Date; dateOfExit: Date | null }) {
  return { dateOfJoining: fromDbDate(e.dateOfJoining), dateOfExit: e.dateOfExit ? fromDbDate(e.dateOfExit) : null };
}

/** Employees relevant for a date range: active, or exited inside/after the range. */
function employeesInRange(from: ISODate, to: ISODate) {
  return {
    dateOfJoining: { lte: toDbDate(to) },
    OR: [{ status: "ACTIVE" as const }, { dateOfExit: { gte: toDbDate(from) } }],
  };
}

export async function lockedMonths(from: ISODate, to: ISODate, tx: Tx = prisma): Promise<Set<string>> {
  const a = parseISO(from);
  const b = parseISO(to);
  const locks = await tx.monthLock.findMany({
    where: { unlockedAt: null, year: { gte: a.year, lte: b.year } },
    select: { year: true, month: true },
  });
  return new Set(locks.map((l) => `${l.year}-${String(l.month).padStart(2, "0")}`));
}

export async function isMonthLocked(year: number, month: number, tx: Tx = prisma) {
  return (await tx.monthLock.count({ where: { year, month, unlockedAt: null } })) > 0;
}

/**
 * Daily automation: materialise default records for every employed day in [from, to].
 * Inserts with ON CONFLICT DO NOTHING, so AUTO and MANUAL records are never overwritten.
 * Locked months are skipped. Returns the number of inserted rows.
 */
export async function generateAttendance(from: ISODate, to: ISODate): Promise<number> {
  const today = todayIST();
  to = minDate(to, today);
  if (from > to) return 0;
  const settings = await getSettings();
  const [ctx, employees, locked] = await Promise.all([
    loadCalendar(from, to, settings),
    prisma.employee.findMany({ where: employeesInRange(from, to), select: { id: true, dateOfJoining: true, dateOfExit: true } }),
    lockedMonths(from, to),
  ]);
  const dates = eachDate(from, to).filter((d) => !locked.has(monthKey(d)));
  const plan = planGeneration(dates, employees.map((e) => ({ id: e.id, ...employmentOf(e) })), ctx);
  let inserted = 0;
  for (let i = 0; i < plan.length; i += 5000) {
    const chunk = plan.slice(i, i + 5000);
    const res = await prisma.attendanceRecord.createMany({
      data: chunk.map((r) => ({ employeeId: r.employeeId, date: toDbDate(r.date), status: r.status, source: "AUTO" as const })),
      skipDuplicates: true,
    });
    inserted += res.count;
  }
  return inserted;
}

/** Ensure everything from the start of last month up to today exists (covers missed cron runs). */
export async function backfillRecent(): Promise<number> {
  const t = parseISO(todayIST());
  const prev = addMonths(t.year, t.month, -1);
  return generateAttendance(monthStart(prev.year, prev.month), todayIST());
}

/**
 * Re-derive AUTO records after a calendar change (holiday, override, weekly-off rule, joining/exit date).
 * MANUAL records are never touched. Locked months are skipped unless `failOnLocked`.
 */
export async function recomputeAuto(
  tx: Tx,
  actor: Actor | null,
  opts: { from: ISODate; to: ISODate; employeeIds?: string[]; reason: string; failOnLocked?: boolean; includeManual?: boolean },
): Promise<number> {
  const locked = await lockedMonths(opts.from, opts.to, tx);
  if (opts.failOnLocked && locked.size) {
    throw new ApiError(423, `Month ${[...locked][0]} is locked for payroll. Ask an Admin to unlock it first.`);
  }
  const settings = await getSettings(tx);
  const ctx = await loadCalendar(opts.from, opts.to, settings, tx);
  const records = await tx.attendanceRecord.findMany({
    where: {
      ...(opts.includeManual ? {} : { source: "AUTO" as const }),
      date: { gte: toDbDate(opts.from), lte: toDbDate(opts.to) },
      ...(opts.employeeIds ? { employeeId: { in: opts.employeeIds } } : {}),
    },
    include: { employee: { select: { dateOfJoining: true, dateOfExit: true } } },
  });
  const byStatus = new Map<string, string[]>();
  const entries = [];
  for (const r of records) {
    const date = fromDbDate(r.date);
    if (locked.has(monthKey(date))) continue;
    const next = defaultStatus(date, employmentOf(r.employee), ctx);
    if (next === r.status) continue;
    byStatus.set(next, [...(byStatus.get(next) ?? []), r.id]);
    entries.push({
      entity: "AttendanceRecord", entityId: r.id, action: "AUTO_RECOMPUTE",
      oldValue: { employeeId: r.employeeId, date, status: r.status, source: r.source, remarks: r.remarks },
      newValue: { employeeId: r.employeeId, date, status: next, reason: opts.reason },
    });
  }
  for (const [status, ids] of byStatus) {
    await tx.attendanceRecord.updateMany({
      where: { id: { in: ids } },
      data: { status, source: "AUTO", ...(opts.includeManual ? { remarks: null } : {}), updatedById: actor?.id ?? null },
    });
  }
  await audit(tx, actor, entries);
  return entries.length;
}

// ---------------------------------------------------------------- Grid

export interface GridCell {
  status: string;
  source: "AUTO" | "MANUAL" | "NONE";
  remarks: string | null;
  /** Status the system would assign; used for "reset" and to block edits on NA days. */
  def: string;
}

export interface GridDay {
  date: ISODate;
  day: number;
  weekday: number;
  kind: "working" | "holiday" | "weeklyOff";
  holiday: string | null;
  override: boolean | null;
  future: boolean;
  today: boolean;
}

export interface GridRow {
  id: string;
  empCode: string;
  name: string;
  department: string | null;
  cells: GridCell[];
}

export interface MonthGrid {
  year: number;
  month: number;
  today: ISODate;
  days: GridDay[];
  rows: GridRow[];
  lock: { lockedAt: string; lockedBy: string } | null;
  statuses: StatusDef[];
  basis: AppSettings["payrollBasis"];
}

export async function getMonthGrid(
  year: number,
  month: number,
  filter: { department?: string; employeeIds?: string[]; search?: string } = {},
): Promise<MonthGrid> {
  const from = monthStart(year, month);
  const to = monthEnd(year, month);
  const today = todayIST();
  if (from <= today) await generateAttendance(from, minDate(to, today));

  const settings = await getSettings();
  const [ctx, employees, records, lock] = await Promise.all([
    loadCalendar(from, to, settings),
    prisma.employee.findMany({
      where: {
        ...employeesInRange(from, to),
        ...(filter.department ? { department: filter.department } : {}),
        ...(filter.employeeIds ? { id: { in: filter.employeeIds } } : {}),
        ...(filter.search ? { OR: [{ name: { contains: filter.search, mode: "insensitive" as const } }, { empCode: { contains: filter.search, mode: "insensitive" as const } }] } : {}),
      },
      orderBy: { empCode: "asc" },
      select: { id: true, empCode: true, name: true, department: true, dateOfJoining: true, dateOfExit: true },
    }),
    prisma.attendanceRecord.findMany({
      where: { date: { gte: toDbDate(from), lte: toDbDate(to) } },
      select: { employeeId: true, date: true, status: true, source: true, remarks: true },
    }),
    prisma.monthLock.findFirst({ where: { year, month, unlockedAt: null }, include: { lockedBy: { select: { name: true } } } }),
  ]);

  const dates = monthDates(year, month);
  const recMap = new Map(records.map((r) => [`${r.employeeId}|${fromDbDate(r.date)}`, r]));
  const days: GridDay[] = dates.map((date, i) => ({
    date,
    day: i + 1,
    weekday: weekday(date),
    kind: dayKind(date, ctx),
    holiday: ctx.holidays.get(date)?.name ?? null,
    override: ctx.overrides.get(date) ?? null,
    future: date > today,
    today: date === today,
  }));

  const rows: GridRow[] = employees.map((e) => {
    const emp = employmentOf(e);
    return {
      id: e.id,
      empCode: e.empCode,
      name: e.name,
      department: e.department,
      cells: dates.map((date) => {
        const def = defaultStatus(date, emp, ctx);
        const rec = recMap.get(`${e.id}|${date}`);
        if (rec && def !== "NA") return { status: rec.status, source: rec.source, remarks: rec.remarks, def };
        return { status: def, source: "NONE" as const, remarks: rec?.remarks ?? null, def };
      }),
    };
  });

  return {
    year, month, today, days, rows,
    lock: lock ? { lockedAt: lock.lockedAt.toISOString(), lockedBy: lock.lockedBy.name } : null,
    statuses: settings.statuses,
    basis: settings.payrollBasis,
  };
}

/** Per-employee summary for a month grid (same math the grid uses client-side). */
export function summarizeGrid(grid: MonthGrid): Map<string, AttendanceSummary> {
  const defs = statusMap(grid.statuses);
  return new Map(grid.rows.map((r) => [
    r.id,
    summarize(r.cells.map((c, i) => ({ status: c.status, companyWorking: grid.days[i].kind === "working" })), defs, grid.basis),
  ]));
}

export function companyWorkingDays(grid: MonthGrid) {
  return grid.days.filter((d) => d.kind === "working").length;
}

// ---------------------------------------------------------------- Edits

export interface CellChange {
  employeeId: string;
  date: ISODate;
  /** New status code. Omit with `reset` to restore the automatic default. */
  status?: string;
  reset?: boolean;
  /** undefined = keep existing remarks; null = clear. */
  remarks?: string | null;
}

export interface AppliedCell {
  employeeId: string;
  date: ISODate;
  status: string;
  source: "AUTO" | "MANUAL";
  remarks: string | null;
}

export async function applyChanges(changes: CellChange[], actor: Actor): Promise<{ applied: AppliedCell[]; warnings: string[] }> {
  if (!changes.length) return { applied: [], warnings: [] };
  const today = todayIST();
  const dates = changes.map((c) => c.date).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];

  return prisma.$transaction(async (tx) => {
    const locked = await lockedMonths(from, to, tx);
    const lockedHit = changes.find((c) => locked.has(monthKey(c.date)));
    if (lockedHit) throw new ApiError(423, `${monthKey(lockedHit.date)} is locked for payroll and is read-only.`);

    const settings = await getSettings(tx);
    const defs = statusMap(settings.statuses);
    const ctx = await loadCalendar(from, to, settings, tx);
    const empIds = [...new Set(changes.map((c) => c.employeeId))];
    const employees = new Map(
      (await tx.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, name: true, dateOfJoining: true, dateOfExit: true } }))
        .map((e) => [e.id, { ...e, ...employmentOf(e) }]),
    );
    const existing = new Map(
      (await tx.attendanceRecord.findMany({
        where: { employeeId: { in: empIds }, date: { gte: toDbDate(from), lte: toDbDate(to) } },
      })).map((r) => [`${r.employeeId}|${fromDbDate(r.date)}`, r]),
    );

    const seen = new Set<string>();
    const applied: AppliedCell[] = [];
    const toWrite: AppliedCell[] = [];
    const transitions = [];
    const auditEntries = [];

    for (const c of changes) {
      const key = `${c.employeeId}|${c.date}`;
      if (seen.has(key)) throw new ApiError(400, `Duplicate change for ${c.date}`);
      seen.add(key);
      const emp = employees.get(c.employeeId);
      if (!emp) throw new ApiError(404, "Employee not found");
      if (!isEmployed(c.date, emp)) throw new ApiError(422, `${emp.name} is not employed on ${c.date} (NA).`);
      const def = defaultStatus(c.date, emp, ctx);
      if (def === "H" && !c.reset) throw new ApiError(422, `${c.date} is a public holiday — it is always marked H.`);
      const prev = existing.get(key);
      const before = { status: prev?.status ?? def, source: prev?.source ?? "AUTO", remarks: prev?.remarks ?? null };

      let next: { status: string; source: "AUTO" | "MANUAL"; remarks: string | null };
      if (c.reset) {
        next = { status: def, source: "AUTO", remarks: c.remarks !== undefined ? c.remarks : null };
      } else if (c.status) {
        const sd = defs.get(c.status);
        if (!sd || !selectableStatuses(settings.statuses).some((s) => s.code === c.status)) throw new ApiError(400, `Only Present (P) or Absent (AB) can be marked`);
        if (c.date > today && !sd.plannable) throw new ApiError(422, `${sd.label} cannot be set on a future date (planned leave only).`);
        next = { status: c.status, source: "MANUAL", remarks: c.remarks !== undefined ? c.remarks : before.remarks };
      } else if (c.remarks !== undefined) {
        next = { ...before, remarks: c.remarks };
      } else {
        continue;
      }
      if (next.status === ABSENT_CODE && next.source === "MANUAL" && !next.remarks?.trim()) {
        throw new ApiError(422, `Please give a reason for ${emp.name}'s absence on ${c.date}.`);
      }
      if (prev && next.status === before.status && next.source === before.source && next.remarks === before.remarks) {
        applied.push({ employeeId: c.employeeId, date: c.date, ...next });
        continue;
      }
      applied.push({ employeeId: c.employeeId, date: c.date, ...next });
      toWrite.push({ employeeId: c.employeeId, date: c.date, ...next });
      transitions.push({ employeeId: c.employeeId, date: c.date, before: prev ? prev.status : (c.date > today ? null : def), after: next.status });
      auditEntries.push({
        entity: "AttendanceRecord", entityId: key, action: prev ? "UPDATE" : "CREATE",
        oldValue: prev ? { employee: emp.name, date: c.date, ...before } : null,
        newValue: { employee: emp.name, date: c.date, ...next },
      });
    }

    if (toWrite.length) {
      await tx.$executeRaw`
        INSERT INTO attendance_records (id, employee_id, date, status, source, remarks, updated_by_id, created_at, updated_at)
        SELECT gen_random_uuid()::text, t.e, t.d, t.s, t.src::"RecordSource", t.r, ${actor.id}, now(), now()
        FROM unnest(
          ${toWrite.map((a) => a.employeeId)}::text[],
          ${toWrite.map((a) => a.date)}::date[],
          ${toWrite.map((a) => a.status)}::text[],
          ${toWrite.map((a) => a.source)}::text[],
          ${toWrite.map((a) => a.remarks)}::text[]
        ) AS t(e, d, s, src, r)
        ON CONFLICT (employee_id, date) DO UPDATE SET
          status = EXCLUDED.status, source = EXCLUDED.source, remarks = EXCLUDED.remarks,
          updated_by_id = EXCLUDED.updated_by_id, updated_at = now()`;
    }

    // Leave balances move atomically with the attendance change.
    const warnings: string[] = [];
    for (const d of leaveDeltas(transitions, defs)) {
      const allot = settings.leaveAllotment[d.leaveType];
      const rows = await tx.$queryRaw<{ allotted: Prisma.Decimal; used: Prisma.Decimal }[]>`
        INSERT INTO leave_balances (id, employee_id, year, leave_type, allotted, used, updated_at)
        VALUES (gen_random_uuid()::text, ${d.employeeId}, ${d.year}, ${d.leaveType}::"LeaveType", ${allot}, ${d.delta}, now())
        ON CONFLICT (employee_id, year, leave_type) DO UPDATE SET used = leave_balances.used + EXCLUDED.used, updated_at = now()
        RETURNING allotted, used`;
      const remaining = Number(rows[0].allotted) - Number(rows[0].used);
      if (remaining < 0) {
        const name = employees.get(d.employeeId)?.name ?? d.employeeId;
        const msg = `${name}: ${d.leaveType} balance for ${d.year} is negative (${remaining}).`;
        if (!settings.allowNegativeLeave) throw new ApiError(409, `Insufficient leave balance — ${msg}`);
        warnings.push(msg);
      }
    }

    await audit(tx, actor, auditEntries);
    return { applied, warnings };
  }, { timeout: 60_000, maxWait: 10_000 });
}

/** Days in the month (up to today) where no cell has been touched by HR. */
export async function autoOnlyDays(year: number, month: number): Promise<ISODate[]> {
  const from = monthStart(year, month);
  const to = minDate(monthEnd(year, month), todayIST());
  if (from > to) return [];
  const manual = await prisma.attendanceRecord.findMany({
    where: { source: "MANUAL", date: { gte: toDbDate(from), lte: toDbDate(to) } },
    distinct: ["date"],
    select: { date: true },
  });
  const touched = new Set(manual.map((m) => fromDbDate(m.date)));
  return eachDate(from, to).filter((d) => !touched.has(d));
}

export { daysInMonth, maxDate };
