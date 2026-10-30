import { ApiError, readJson, requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { userSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = route<Ctx>(async (req, { params }) => {
  const actor = await requireUser(req, "users:manage");
  const { id } = await params;
  const body = userSchema.omit({ password: true }).parse(await readJson(req));
  const current = await prisma.user.findUnique({ where: { id } });
  if (!current) throw new ApiError(404, "User not found");
  if (id === actor.id && (body.role !== "ADMIN" || !body.active)) throw new ApiError(400, "You cannot demote or deactivate yourself");
  if (current.role === "ADMIN" && (body.role !== "ADMIN" || !body.active)) {
    const admins = await prisma.user.count({ where: { role: "ADMIN", active: true } });
    if (admins <= 1) throw new ApiError(400, "At least one active Admin is required");
  }
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id }, data: body, select: { id: true, name: true, email: true, role: true, active: true, canViewSensitive: true } });
    await audit(tx, actor, [{
      entity: "User", entityId: id, action: "UPDATE",
      oldValue: { name: current.name, email: current.email, role: current.role, active: current.active, canViewSensitive: current.canViewSensitive },
      newValue: body,
    }]);
    return user;
  });
});
