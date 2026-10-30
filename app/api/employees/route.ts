import { readJson, requireUser, route, searchParams } from "@/lib/api";
import { prisma } from "@/lib/db";
import { createEmployee, nextEmpCode, serializeEmployee } from "@/lib/employees";
import { employeeSchema } from "@/lib/validators";

export const GET = route(async (req) => {
  const user = await requireUser(req, "employees:read");
  const q = searchParams(req);
  if (q.nextCode) return { nextCode: await nextEmpCode() };
  const status = q.status === "ACTIVE" || q.status === "INACTIVE" ? q.status : undefined;
  const employees = await prisma.employee.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(q.department ? { department: q.department } : {}),
      ...(q.search ? { OR: [
        { name: { contains: q.search, mode: "insensitive" } },
        { empCode: { contains: q.search, mode: "insensitive" } },
        { email: { contains: q.search, mode: "insensitive" } },
      ] } : {}),
    },
    include: { manager: { select: { name: true } } },
    orderBy: { empCode: "asc" },
  });
  return { employees: employees.map((e) => serializeEmployee(e, user.canViewSensitive)), nextCode: await nextEmpCode() };
});

export const POST = route(async (req) => {
  const user = await requireUser(req, "employees:write");
  const data = employeeSchema.parse(await readJson(req));
  const emp = await createEmployee(data, user);
  return serializeEmployee(emp, user.canViewSensitive);
});
