import { requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getMonthGrid, isMonthLocked } from "@/lib/attendance";
import { addDays, addMonths, fromDbDate, parseISO, toDbDate, todayIST, MONTHS } from "@/lib/dates";
import { statusMap } from "@/lib/status";
import { ensureLeaveBalances } from "@/lib/employees";

export const GET = route(async (req) => {
  await requireUser(req, "attendance:read");
  const today = todayIST();
  const t = parseISO(today);
  const grid = await getMonthGrid(t.year, t.month);
  const defs = statusMap(grid.statuses);
  const todayIdx = t.day - 1;

  let presentToday = 0, leaveToday = 0, absentToday = 0, employedToday = 0;
  for (const r of grid.rows) {
    const c = r.cells[todayIdx];
    if (c.status === "NA") continue;
    employedToday++;
    const b = defs.get(c.status)?.bucket;
    if (b === "present" || b === "wfh" || b === "halfDay") presentToday++;
    if (b === "paidLeave" || b === "lop") leaveToday++;
    if (b === "absent") absentToday++;
  }

  // Daily attendance % (present-like / employed) for elapsed working days.
  const daily = grid.days.filter((d) => !d.future).map((d, i) => {
    let employed = 0, present = 0;
    for (const r of grid.rows) {
      const c = r.cells[i];
      if (c.status === "NA") continue;
      const b = defs.get(c.status)?.bucket;
      if (b === "holiday" || b === "weeklyOff") continue;
      employed++;
      if (b === "present" || b === "wfh") present++;
      else if (b === "halfDay") present += 0.5;
    }
    return { day: d.day, pct: employed ? Math.round((present / employed) * 1000) / 10 : null };
  }).filter((d) => d.pct !== null);

  const leaveBreakdown: Record<string, number> = {};
  const deptMap = new Map<string, { present: number; total: number }>();
  for (const r of grid.rows) {
    const dept = r.department || "Unassigned";
    const cur = deptMap.get(dept) ?? { present: 0, total: 0 };
    r.cells.forEach((c, i) => {
      if (grid.days[i].future) return;
      const def = defs.get(c.status);
      if (def?.leaveType || def?.bucket === "lop") leaveBreakdown[c.status] = (leaveBreakdown[c.status] ?? 0) + 1;
      if (!def || def.bucket === "na" || def.bucket === "holiday" || def.bucket === "weeklyOff") return;
      cur.total++;
      if (def.bucket === "present" || def.bucket === "wfh") cur.present++;
      else if (def.bucket === "halfDay") cur.present += 0.5;
    });
    deptMap.set(dept, cur);
  }

  // Needs attention
  const attention: { kind: string; message: string; href?: string }[] = [];
  const since = addDays(today, -30);
  const absences = await prisma.attendanceRecord.groupBy({
    by: ["employeeId"],
    where: { date: { gte: toDbDate(since), lte: toDbDate(today) }, status: { in: ["AB", "LOP"] } },
    _count: { _all: true },
    having: { employeeId: { _count: { gte: 3 } } },
  });
  if (absences.length) {
    const emps = await prisma.employee.findMany({ where: { id: { in: absences.map((a) => a.employeeId) } }, select: { id: true, name: true } });
    for (const a of absences) {
      const e = emps.find((x) => x.id === a.employeeId);
      attention.push({ kind: "absence", message: `${e?.name} has ${a._count._all} absences/LOP in the last 30 days`, href: `/employees/${a.employeeId}` });
    }
  }
  await ensureLeaveBalances(t.year);
  const low = await prisma.leaveBalance.findMany({
    where: { year: t.year, employee: { status: "ACTIVE" } },
    include: { employee: { select: { id: true, name: true } } },
  });
  for (const b of low) {
    const remaining = Number(b.allotted) - Number(b.used);
    if (Number(b.allotted) > 0 && remaining <= 1) {
      attention.push({ kind: "leave", message: `${b.employee.name}: only ${remaining} ${b.leaveType} left`, href: `/employees/${b.employee.id}` });
    }
  }
  const prev = addMonths(t.year, t.month, -1);
  if (t.day > 3 && !(await isMonthLocked(prev.year, prev.month))) {
    attention.push({ kind: "lock", message: `${MONTHS[prev.month - 1]} ${prev.year} is not locked for payroll yet`, href: `/payroll?year=${prev.year}&month=${prev.month}` });
  }

  const upcomingHolidays = await prisma.holiday.findMany({
    where: { deletedAt: null, date: { gte: toDbDate(today) } }, orderBy: { date: "asc" }, take: 5,
  });

  // Birthdays & work anniversaries in the next 30 days
  const window = new Set(Array.from({ length: 31 }, (_, i) => addDays(today, i).slice(5)));
  const people = await prisma.employee.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, dateOfBirth: true, dateOfJoining: true } });
  const celebrations: { name: string; kind: "birthday" | "anniversary"; date: string; years?: number }[] = [];
  for (const p of people) {
    if (p.dateOfBirth && window.has(fromDbDate(p.dateOfBirth).slice(5))) celebrations.push({ name: p.name, kind: "birthday", date: fromDbDate(p.dateOfBirth).slice(5) });
    const doj = fromDbDate(p.dateOfJoining);
    const years = t.year - Number(doj.slice(0, 4));
    if (years > 0 && window.has(doj.slice(5))) celebrations.push({ name: p.name, kind: "anniversary", date: doj.slice(5), years });
  }

  return {
    today,
    cards: { totalEmployees: employedToday, presentToday, leaveToday, absentToday, upcomingHolidays: upcomingHolidays.length },
    daily,
    leaveBreakdown: Object.entries(leaveBreakdown).map(([code, count]) => ({ code, label: defs.get(code)?.label ?? code, color: defs.get(code)?.fg ?? "#7C5CFC", count })),
    departments: [...deptMap.entries()].map(([name, v]) => ({ name, pct: v.total ? Math.round((v.present / v.total) * 1000) / 10 : 0 })),
    attention,
    upcomingHolidays: upcomingHolidays.map((h) => ({ date: fromDbDate(h.date), name: h.name, type: h.type })),
    celebrations: celebrations.sort((a, b) => a.date.localeCompare(b.date)),
  };
});
