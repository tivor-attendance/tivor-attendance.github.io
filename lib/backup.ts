import { prisma } from "./db";

/** Full logical backup of every table as JSON (password hashes excluded). */
export async function fullBackup() {
  const [users, employees, attendance, holidays, overrides, leaveBalances, monthLocks, auditLogs, settings] = await Promise.all([
    prisma.user.findMany({ omit: { passwordHash: true } }),
    prisma.employee.findMany(),
    prisma.attendanceRecord.findMany(),
    prisma.holiday.findMany(),
    prisma.workingDayOverride.findMany(),
    prisma.leaveBalance.findMany(),
    prisma.monthLock.findMany(),
    prisma.auditLog.findMany(),
    prisma.setting.findMany(),
  ]);
  return {
    format: "attendance-system-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    tables: { users, employees, attendance, holidays, overrides, leaveBalances, monthLocks, auditLogs, settings },
  };
}
