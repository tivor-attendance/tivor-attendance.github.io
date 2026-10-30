import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { rateLimit, resetRateLimit } from "./rate-limit";
import type { Role } from "./permissions";

const MAX_AGE = Number(process.env.SESSION_MAX_AGE ?? 8 * 60 * 60);

function clientIp(headers: Record<string, unknown> | undefined): string {
  const fwd = headers?.["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0].trim();
  return "unknown";
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: MAX_AGE, updateAge: 15 * 60 },
  jwt: { maxAge: MAX_AGE },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" } },
      async authorize(credentials, req) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) return null;

        const key = `login:${clientIp(req?.headers)}:${email}`;
        const rl = rateLimit(key, 5, 15 * 60 * 1000);
        if (!rl.ok) throw new Error(`Too many attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} min.`);

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active) return null;
        if (!(await bcrypt.compare(password, user.passwordHash))) return null;

        resetRateLimit(key);
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await prisma.auditLog.create({
          data: { userId: user.id, entity: "User", entityId: user.id, action: "LOGIN", ip: clientIp(req?.headers) },
        });
        return { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        const u = user as unknown as { role: Role; mustChangePassword: boolean };
        token.role = u.role;
        token.mustChangePassword = u.mustChangePassword;
      }
      if (trigger === "update" && token.sub) {
        const fresh = await prisma.user.findUnique({ where: { id: token.sub } });
        if (fresh) {
          token.role = fresh.role;
          token.name = fresh.name;
          token.mustChangePassword = fresh.mustChangePassword;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.user.role = token.role as Role;
        session.user.mustChangePassword = Boolean(token.mustChangePassword);
      }
      return session;
    },
  },
};
