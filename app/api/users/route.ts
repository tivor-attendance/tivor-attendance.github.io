import bcrypt from "bcryptjs";
import { ApiError, readJson, requireUser, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { userSchema } from "@/lib/validators";

const pub = { id: true, name: true, email: true, role: true, active: true, canViewSensitive: true, mustChangePassword: true, lastLoginAt: true, createdAt: true } as const;

export const GET = route(async (req) => {
  await requireUser(req, "users:manage");
  return { users: await prisma.user.findMany({ select: pub, orderBy: { createdAt: "asc" } }) };
});

export const POST = route(async (req) => {
  const actor = await requireUser(req, "users:manage");
  const body = userSchema.parse(await readJson(req));
  if (!body.password) throw new ApiError(400, "A temporary password is required");
  if (await prisma.user.findUnique({ where: { email: body.email } })) throw new ApiError(409, "A user with this email already exists");
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name: body.name, email: body.email, role: body.role, active: body.active, canViewSensitive: body.canViewSensitive, passwordHash: await bcrypt.hash(body.password!, 12), mustChangePassword: true },
      select: pub,
    });
    await audit(tx, actor, [{ entity: "User", entityId: user.id, action: "CREATE", newValue: { name: user.name, email: user.email, role: user.role } }]);
    return user;
  });
});
