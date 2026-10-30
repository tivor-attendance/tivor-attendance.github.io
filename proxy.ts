import { NextResponse, type NextRequest } from "next/server";

const OLD_AUTH_PAGES = ["/forgot-password", "/reset-password", "/change-password"];

/** No login: the app opens straight to the attendance page. */
export function proxy(req: NextRequest) {
  if (OLD_AUTH_PAGES.some((p) => req.nextUrl.pathname.startsWith(p))) {
    return NextResponse.redirect(new URL("/", req.url));
  }
  const res = NextResponse.next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
