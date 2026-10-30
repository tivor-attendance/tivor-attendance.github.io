import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ApiError, readJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { changePasswordSchema } from "@/lib/validators";
import { rateLimit } from "@/lib/rate-limit";

export const POST = route(async (req) => {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new ApiError(401, "Not signed in");
  if (!rateLimit(`pwchange:${session.user.id}`, 10, 15 * 60_000).ok) throw new ApiError(429, "Too many attempts");
  const body = changePasswordSchema.parse(await readJson(req));
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || !user.active) throw new ApiError(401, "Account disabled");
  if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) throw new ApiError(400, "Current password is incorrect");
  if (body.currentPassword === body.newPassword) throw new ApiError(400, "New password must be different");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(body.newPassword, 12), mustChangePassword: false } });
    await audit(tx, { id: user.id, ip: req.headers.get("x-forwarded-for"), userAgent: req.headers.get("user-agent") }, [
      { entity: "User", entityId: user.id, action: "PASSWORD_CHANGE" },
    ]);
  });
  return { ok: true };
});
