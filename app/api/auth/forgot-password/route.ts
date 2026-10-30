import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, readJson, route } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { sendMail } from "@/lib/mail";

export const POST = route(async (req) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  if (!rateLimit(`forgot:${ip}`, 5, 15 * 60_000).ok) throw new ApiError(429, "Too many requests. Try again later.");
  const { email } = z.object({ email: z.email() }).parse(await readJson(req));
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (user?.active) {
    const token = crypto.randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60 * 60_000) },
    });
    const url = `${process.env.NEXTAUTH_URL ?? new URL(req.url).origin}/reset-password?token=${token}`;
    await sendMail(user.email, "Reset your password", `Use this link within 1 hour to reset your password:\n\n${url}\n\nIf you did not request this, ignore this email.`);
  }
  // Same response either way so the endpoint can't be used to discover accounts.
  return { ok: true };
});
