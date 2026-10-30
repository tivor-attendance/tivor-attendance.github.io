// Role → permission matrix. Shared by API guards (authoritative) and UI (cosmetic hiding).
export type Role = "ADMIN" | "HR" | "MANAGER" | "VIEWER";

const ALL: Role[] = ["ADMIN", "HR", "MANAGER", "VIEWER"];
const EDITORS: Role[] = ["ADMIN", "HR"];

export const PERMISSIONS = {
  "attendance:read": ALL,
  "attendance:write": EDITORS,
  "employees:read": ALL,
  "employees:write": EDITORS,
  "holidays:read": ALL,
  "holidays:write": EDITORS,
  "payroll:read": ALL,
  "months:lock": EDITORS,
  "months:unlock": ["ADMIN"],
  "reports:read": ALL,
  "audit:read": EDITORS,
  "settings:read": ALL,
  "settings:write": ["ADMIN"],
  "users:manage": ["ADMIN"],
  "backup:export": ["ADMIN"],
} satisfies Record<string, Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, perm: Permission): boolean {
  return (PERMISSIONS[perm] as Role[]).includes(role);
}

export function canViewSensitive(user: { role: Role; canViewSensitive: boolean }): boolean {
  return user.role === "ADMIN" || (user.role === "HR" && user.canViewSensitive);
}

/** Month-lock rule: a locked month is read-only for everyone (Admin must unlock first). */
export function canEditMonth(role: Role, locked: boolean): boolean {
  return !locked && can(role, "attendance:write");
}

export function canUnlockMonth(role: Role, reason: string | undefined): { ok: boolean; error?: string } {
  if (role !== "ADMIN") return { ok: false, error: "Only an Admin can unlock a month" };
  if (!reason || reason.trim().length < 5) return { ok: false, error: "A reason (min 5 characters) is required to unlock" };
  return { ok: true };
}
