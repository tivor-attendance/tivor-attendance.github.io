import { prisma } from "./db";
import { Prisma, type Employee } from "@/lib/generated/prisma/client";
import { audit } from "./audit";
import { ApiError, type Actor } from "./api";
import { recomputeAuto } from "./attendance";
import { getSettings } from "./settings";
import { fromDbDate, minDate, parseISO, toDbDate, todayIST, isoDate } from "./dates";
import { maskValue } from "./utils";
import { employeeSchema } from "./validators";
import type { z } from "zod";

type EmployeeData = z.output<typeof employeeSchema>;
const SENSITIVE = ["monthlySalary", "bankAccount", "ifsc", "pan", "uan"] as const;

export async function nextEmpCode(tx: Prisma.TransactionClient = prisma): Promise<string> {
  const rows = await tx.employee.findMany({ where: { empCode: { startsWith: "EMP" } }, select: { empCode: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.empCode.slice(3)) || 0), 0);
  return `EMP${String(max + 1).padStart(3, "0")}`;
}

export function serializeEmployee(e: Employee & { manager?: { name: string } | null }, sensitive: boolean) {
  return {
    id: e.id,
    empCode: e.empCode,
    name: e.name,
    email: e.email,
    phone: e.phone,
    department: e.department,
    designation: e.designation,
    managerId: e.managerId,
    managerName: e.manager?.name ?? null,
    dateOfJoining: fromDbDate(e.dateOfJoining),
    dateOfExit: e.dateOfExit ? fromDbDate(e.dateOfExit) : null,
    dateOfBirth: e.dateOfBirth ? fromDbDate(e.dateOfBirth) : null,
    employmentType: e.employmentType,
    status: e.status,
    sensitiveVisible: sensitive,
    monthlySalary: sensitive ? (e.monthlySalary === null ? null : Number(e.monthlySalary)) : null,
    bankAccount: sensitive ? e.bankAccount : maskValue(e.bankAccount),
    ifsc: sensitive ? e.ifsc : maskValue(e.ifsc, 0),
    pan: sensitive ? e.pan : maskValue(e.pan, 2),
    uan: sensitive ? e.uan : maskValue(e.uan),
    hasSalary: e.monthlySalary !== null,
  };
}
export type EmployeeDTO = ReturnType<typeof serializeEmployee>;

function toDb(d: EmployeeData) {
  return {
    name: d.name, email: d.email, phone: d.phone, department: d.department, designation: d.designation,
    managerId: d.managerId,
    dateOfJoining: toDbDate(d.dateOfJoining),
    dateOfExit: d.dateOfExit ? toDbDate(d.dateOfExit) : null,
    dateOfBirth: d.dateOfBirth ? toDbDate(d.dateOfBirth) : null,
    employmentType: d.employmentType, status: d.status,
    monthlySalary: d.monthlySalary, bankAccount: d.bankAccount, ifsc: d.ifsc, pan: d.pan, uan: d.uan,
  };
}

function redact(obj: Record<string, unknown>) {
  const out = { ...obj };
  for (const k of SENSITIVE) if (out[k] !== undefined && out[k] !== null) out[k] = "[redacted]";
  return out;
}

export async function createEmployee(data: EmployeeData, actor: Actor, tx?: Prisma.TransactionClient) {
  const run = async (t: Prisma.TransactionClient) => {
    const empCode = data.empCode ?? (await nextEmpCode(t));
    if (await t.employee.findUnique({ where: { empCode } })) throw new ApiError(409, `Employee ID ${empCode} already exists`);
    const values = toDb(data);
    if (!actor.canViewSensitive) for (const k of SENSITIVE) values[k] = null;
    const emp = await t.employee.create({ data: { ...values, empCode } });
    const settings = await getSettings(t);
    const year = parseISO(todayIST()).year;
    const allot = data.leave ?? settings.leaveAllotment;
    await t.leaveBalance.createMany({
      data: (["CL", "SL", "EL"] as const).map((leaveType) => ({ employeeId: emp.id, year, leaveType, allotted: allot[leaveType] })),
      skipDuplicates: true,
    });
    await audit(t, actor, [{ entity: "Employee", entityId: emp.id, action: "CREATE", newValue: redact({ empCode, ...data }) }]);
    return emp;
  };
  return tx ? run(tx) : prisma.$transaction(run);
}

export async function updateEmployee(id: string, data: EmployeeData, actor: Actor) {
  const current = await prisma.employee.findUnique({ where: { id } });
  if (!current) throw new ApiError(404, "Employee not found");
  if (data.managerId === id) throw new ApiError(400, "An employee cannot report to themselves");
  return prisma.$transaction(async (tx) => {
    const empCode = data.empCode ?? current.empCode;
    if (empCode !== current.empCode && (await tx.employee.findUnique({ where: { empCode } }))) {
      throw new ApiError(409, `Employee ID ${empCode} already exists`);
    }
    const values: Partial<ReturnType<typeof toDb>> = toDb(data);
    if (!actor.canViewSensitive) for (const k of SENSITIVE) delete values[k];
    const updated = await tx.employee.update({ where: { id }, data: { ...values, empCode } });

    const oldDoj = fromDbDate(current.dateOfJoining);
    const oldDoe = current.dateOfExit ? fromDbDate(current.dateOfExit) : null;
    if (oldDoj !== data.dateOfJoining || oldDoe !== data.dateOfExit) {
      // Re-derive AUTO cells (NA ↔ default) across the span affected by the change.
      const from = minDate(oldDoj, data.dateOfJoining);
      await recomputeAuto(tx, actor, { from, to: todayIST() > from ? todayIST() : from, employeeIds: [id], reason: "Joining/exit date changed" });
    }
    if (data.leave) {
      const year = parseISO(todayIST()).year;
      for (const leaveType of ["CL", "SL", "EL"] as const) {
        await tx.leaveBalance.upsert({
          where: { employeeId_year_leaveType: { employeeId: id, year, leaveType } },
          create: { employeeId: id, year, leaveType, allotted: data.leave[leaveType] },
          update: { allotted: data.leave[leaveType] },
        });
      }
    }
    const diffOld: Record<string, unknown> = {};
    const diffNew: Record<string, unknown> = {};
    const before = serializeEmployee(current, true) as Record<string, unknown>;
    const after = serializeEmployee(updated, true) as Record<string, unknown>;
    for (const k of Object.keys(after)) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) { diffOld[k] = before[k]; diffNew[k] = after[k]; }
    }
    if (data.leave) diffNew.leaveAllotment = data.leave;
    await audit(tx, actor, [{ entity: "Employee", entityId: id, action: "UPDATE", oldValue: redact(diffOld), newValue: redact(diffNew) }]);
    return updated;
  });
}

export async function setEmployeeStatus(id: string, status: "ACTIVE" | "INACTIVE", dateOfExit: string | null, actor: Actor) {
  const current = await prisma.employee.findUnique({ where: { id } });
  if (!current) throw new ApiError(404, "Employee not found");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.employee.update({
      where: { id },
      data: { status, ...(dateOfExit !== undefined ? { dateOfExit: dateOfExit ? toDbDate(dateOfExit) : null } : {}) },
    });
    const oldExit = current.dateOfExit ? fromDbDate(current.dateOfExit) : null;
    const from = [oldExit, dateOfExit].filter((d): d is string => !!d).sort()[0];
    if (from && from <= todayIST() && oldExit !== dateOfExit) {
      await recomputeAuto(tx, actor, { from, to: todayIST(), employeeIds: [id], reason: dateOfExit ? "Employee exited" : "Employee reactivated" });
    }
    await audit(tx, actor, [{
      entity: "Employee", entityId: id, action: status === "INACTIVE" ? "DEACTIVATE" : "ACTIVATE",
      oldValue: { status: current.status, dateOfExit: current.dateOfExit ? fromDbDate(current.dateOfExit) : null },
      newValue: { status, dateOfExit },
    }]);
    return updated;
  });
}

export async function ensureLeaveBalances(year: number) {
  const settings = await getSettings();
  const employees = await prisma.employee.findMany({
    where: { dateOfJoining: { lte: toDbDate(isoDate(year, 12, 31)) }, OR: [{ status: "ACTIVE" }, { dateOfExit: { gte: toDbDate(isoDate(year, 1, 1)) } }] },
    select: { id: true },
  });
  await prisma.leaveBalance.createMany({
    data: employees.flatMap((e) => (["CL", "SL", "EL"] as const).map((leaveType) => ({ employeeId: e.id, year, leaveType, allotted: settings.leaveAllotment[leaveType] }))),
    skipDuplicates: true,
  });
}
