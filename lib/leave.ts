import type { StatusDef, LeaveTypeCode } from "./status";
import type { ISODate } from "./dates";

export interface StatusTransition {
  employeeId: string;
  date: ISODate;
  before: string | null;
  after: string;
}

/** Net change in "used" leave per employee/year/type caused by a set of status transitions. */
export function leaveDeltas(changes: StatusTransition[], defs: Map<string, StatusDef>) {
  const deltas = new Map<string, { employeeId: string; year: number; leaveType: LeaveTypeCode; delta: number }>();
  const bump = (employeeId: string, date: ISODate, code: string | null, by: number) => {
    const type = code ? defs.get(code)?.leaveType : null;
    if (!type) return;
    const year = Number(date.slice(0, 4));
    const key = `${employeeId}|${year}|${type}`;
    const cur = deltas.get(key) ?? { employeeId, year, leaveType: type, delta: 0 };
    cur.delta += by;
    deltas.set(key, cur);
  };
  for (const c of changes) {
    if (c.before === c.after) continue;
    bump(c.employeeId, c.date, c.before, -1);
    bump(c.employeeId, c.date, c.after, +1);
  }
  return [...deltas.values()].filter((d) => d.delta !== 0);
}
