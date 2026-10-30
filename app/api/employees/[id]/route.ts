import { ApiError, readJson, requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { serializeEmployee, updateEmployee } from "@/lib/employees";
import { employeeSchema } from "@/lib/validators";
import { parseISO, todayIST } from "@/lib/dates";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req, "employees:read");
  const { id } = await params;
  const emp = await prisma.employee.findUnique({ where: { id }, include: { manager: { select: { name: true } } } });
  if (!emp) throw new ApiError(404, "Employee not found");
  const balances = await prisma.leaveBalance.findMany({ where: { employeeId: id, year: parseISO(todayIST()).year } });
  return {
    ...serializeEmployee(emp, user.canViewSensitive),
    leave: Object.fromEntries(balances.map((b) => [b.leaveType, { allotted: Number(b.allotted), used: Number(b.used) }])),
  };
});

export const PUT = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req, "employees:write");
  const { id } = await params;
  const data = employeeSchema.parse(await readJson(req));
  return serializeEmployee(await updateEmployee(id, data, user), user.canViewSensitive);
});
