import bcrypt from "bcryptjs";
import { z } from "zod";
import { ApiError, readJson, requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { passwordSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

/** Admin sets a temporary password; the user must change it at next login. */
export const POST = route<Ctx>(async (req, { params }) => {
  const actor = await requireUser(req, "users:manage");
  const { id } = await params;
  const { password } = z.object({ password: passwordSchema }).parse(await readJson(req));
  if (!(await prisma.user.findUnique({ where: { id } }))) throw new ApiError(404, "User not found");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true } });
    await audit(tx, actor, [{ entity: "User", entityId: id, action: "ADMIN_PASSWORD_RESET" }]);
  });
  return { ok: true };
});
