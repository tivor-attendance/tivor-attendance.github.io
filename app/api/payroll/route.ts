import { requireUser, route, searchParams } from "@/lib/api";
import { payrollSummary } from "@/lib/reports";
import { monthQuerySchema } from "@/lib/validators";

export const GET = route(async (req) => {
  const user = await requireUser(req, "payroll:read");
  const q = searchParams(req);
  const { year, month } = monthQuerySchema.parse(q);
  return { ...(await payrollSummary(year, month, { sensitive: user.canViewSensitive, department: q.department || undefined })), role: user.role };
});
