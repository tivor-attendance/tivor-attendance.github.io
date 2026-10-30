import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, readJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { passwordSchema } from "@/lib/validators";

export const POST = route(async (req) => {
  const body = z.object({ token: z.string().min(32), password: passwordSchema }).parse(await readJson(req));
  const tokenHash = crypto.createHash("sha256").update(body.token).digest("hex");
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw new ApiError(400, "This reset link is invalid or has expired");
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash: await bcrypt.hash(body.password, 12), mustChangePassword: false } });
    await audit(tx, { id: row.userId, ip: req.headers.get("x-forwarded-for"), userAgent: req.headers.get("user-agent") }, [
      { entity: "User", entityId: row.userId, action: "PASSWORD_RESET" },
    ]);
  });
  return { ok: true };
});
