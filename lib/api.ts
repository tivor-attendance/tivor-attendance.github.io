import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "./db";
import { can, canViewSensitive, type Permission, type Role } from "./permissions";

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export interface Actor {
  id: string;
  name: string;
  email: string;
  role: Role;
  canViewSensitive: boolean;
  ip: string | null;
  userAgent: string | null;
}

/** Login is disabled: every request acts as the seeded Admin account (used for audit records). */
export async function requireUser(req: NextRequest | Request, perm?: Permission): Promise<Actor> {
  const user = await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, orderBy: { createdAt: "asc" } });
  if (!user) throw new ApiError(500, "No admin user found — run `npm run db:seed`");
  if (perm && !can(user.role, perm)) throw new ApiError(403, "You do not have permission for this action");
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    canViewSensitive: canViewSensitive(user),
    ip: req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? req.headers.get("x-real-ip"),
    userAgent: req.headers.get("user-agent"),
  };
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response | unknown>;

/** Wraps a route handler with uniform JSON error handling. */
export function route<C = unknown>(fn: Handler<C>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    try {
      const result = await fn(req, ctx);
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (e) {
      if (e instanceof ZodError) {
        return NextResponse.json(
          { error: e.issues[0]?.message ?? "Invalid input", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
          { status: 400 },
        );
      }
      if (e instanceof ApiError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
      console.error("[api]", e);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
}

export function searchParams(req: NextRequest) {
  return Object.fromEntries(new URL(req.url).searchParams.entries());
}

export function fileResponse(body: Buffer | string, filename: string, contentType: string) {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
