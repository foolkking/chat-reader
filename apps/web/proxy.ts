import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "chat_reader_session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Pages have no Server Actions or form POST handlers: all mutations use the
  // same-origin API. Reject unsupported page methods before auth redirects or
  // Next's action decoder, including requests carrying a forged Next-Action.
  if (!pathname.startsWith("/api/") && request.method !== "GET" && request.method !== "HEAD") {
    return new NextResponse(null, {
      status: 405,
      headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
    });
  }
  // Legacy integration/PWA suites run with APP_ENV=test and an explicitly
  // disabled auth provider; production and auth-enabled tests remain gated.
  const authEnabled = process.env.APP_ENV !== "test" || process.env.AUTH_ENABLED === "true";
  if (!authEnabled || isPublicPath(pathname) || request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.next();
  }
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  if (!/^\/(?:share|shared)\//i.test(pathname) && pathname !== "/") {
    login.searchParams.set("return_to", pathname);
  }
  return NextResponse.redirect(login);
}

function isPublicPath(pathname: string): boolean {
  return /^\/(?:login|register|account-upgrade|password-reset|reset-password|verify-email)(?:\/|$)/i.test(pathname)
    || /^\/share\/[^/]+\/?$/i.test(pathname)
    || pathname === "/health"
    || pathname.startsWith("/api/")
    || pathname.startsWith("/_next/")
    || pathname.startsWith("/icons/")
    || pathname.startsWith("/skills/")
    || pathname.startsWith("/import-rescue/")
    || pathname === "/favicon.ico"
    || pathname === "/library-sw.js"
    || pathname === "/sw.js"
    || pathname.endsWith(".webmanifest");
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
