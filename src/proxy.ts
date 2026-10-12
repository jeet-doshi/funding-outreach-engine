import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, tokenFor } from "@/lib/auth";

export async function proxy(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie && cookie === (await tokenFor(password))) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // /api/cron has its own bearer-token check; /login must stay reachable.
  matcher: ["/((?!login|api/cron|_next/static|_next/image|favicon.ico).*)"],
};
