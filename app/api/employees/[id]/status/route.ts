import { z } from "zod";
import { readJson, requireUser, route } from "@/lib/api";
import { setEmployeeStatus } from "@/lib/employees";
import { isoDateSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

/** Activate / deactivate. Employees are never hard-deleted. */
export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req, "employees:write");
  const { id } = await params;
  const body = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]), dateOfExit: isoDateSchema.nullable().optional() }).parse(await readJson(req));
  await setEmployeeStatus(id, body.status, body.dateOfExit ?? null, user);
  return { ok: true };
});
