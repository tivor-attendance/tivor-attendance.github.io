import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/permissions";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { id: string; role: Role; mustChangePassword: boolean };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role;
    mustChangePassword?: boolean;
  }
}
