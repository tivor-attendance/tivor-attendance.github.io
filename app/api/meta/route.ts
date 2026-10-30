import { requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";

/** Lookup data for filters and forms. */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const [departments, employees, settings] = await Promise.all([
    prisma.employee.findMany({ where: { department: { not: null } }, distinct: ["department"], select: { department: true }, orderBy: { department: "asc" } }),
    prisma.employee.findMany({ select: { id: true, empCode: true, name: true, status: true }, orderBy: { empCode: "asc" } }),
    getSettings(),
  ]);
  return {
    user: { id: user.id, name: user.name, role: user.role, canViewSensitive: user.canViewSensitive },
    departments: departments.map((d) => d.department!).filter(Boolean),
    employees,
    statuses: settings.statuses,
    companyName: settings.companyName,
  };
});
