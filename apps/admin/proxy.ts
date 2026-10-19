import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { hostedConfig, isHostedMode } from "./lib/hosted-config";
import { canOpenPage } from "./lib/hub-permissions";
import { cookieName, getRoleToken, isLocalMode, localApiOrigin, localPersonas, type LocalRole } from "./lib/local-session";
import { readHubAccount, unavailablePage } from "./lib/hub-account";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const denied = () => new NextResponse(`<!doctype html><html lang="th"><meta charset="utf-8"><title>ไม่มีสิทธิ์เข้าถึงหน้านี้</title><main><h1>ไม่มีสิทธิ์เข้าถึงหน้านี้</h1><p>กรุณาเลือกหน้าที่ได้รับสิทธิ์ หรือให้ผู้ดูแลปรับสิทธิ์ให้บัญชีนี้</p><a href="/account/request">ตรวจสถานะบัญชีและเข้าพื้นที่ทำงาน</a>${isLocalMode() && !isHostedMode() ? '<p><a href="/">กลับไปเลือกบัญชีทดสอบ</a></p>' : ""}</main></html>`, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
  if (!isHostedMode()) {
    if (!isLocalMode() || path.startsWith("/api/") || /^\/(account|login|signup|auth)(\/|$)/.test(path)) return NextResponse.next();
    const persona = request.cookies.get(cookieName)?.value;
    const token = (localPersonas as readonly string[]).includes(persona || "") ? getRoleToken(persona as LocalRole) : null;
    if (!token) return NextResponse.next();
    try {
      const { status, account } = await readHubAccount(localApiOrigin(), token);
      if (status === 401) return NextResponse.redirect(new URL("/login", request.url));
      if (status === 403 || account?.status !== "ACTIVE") return NextResponse.redirect(new URL("/account/request", request.url));
      if (account && !canOpenPage(account, path, request.nextUrl.searchParams) && !(path === "/" && !request.nextUrl.search)) return denied();
      return NextResponse.next();
    } catch { const page = unavailablePage(); return new NextResponse(page.body, { status: 503, headers: page.headers }); }
  }
  // The Hub route handler refreshes the cookie and verifies the exact bearer.
  // Do not repeat its Supabase user lookup in the page proxy for every API call.
  if (path.startsWith("/api/hub/")) {
    const response = NextResponse.next({ request });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  const config = hostedConfig()!;
  let response = NextResponse.next({ request });
  const client = createServerClient(config.supabaseUrl, config.publishableKey, { cookies: {
    getAll: () => request.cookies.getAll(),
    setAll(values) {
      values.forEach(({ name, value }) => request.cookies.set(name, value));
      response = NextResponse.next({ request });
      values.forEach(({ name, value, options }) => response.cookies.set(name, value, { ...options, secure: !config.simulation, sameSite: "lax" }));
    },
  } });
  const { data: { user } } = await client.auth.getUser();
  const publicPage = ["/login", "/auth/callback"].includes(path) || config.password && ["/signup", "/signup/verify", "/login/forgot"].includes(path);
  let destination: URL | null = null;
  if (!user && !publicPage && !path.startsWith("/api/")) {
    destination = new URL("/login", config.adminOrigin);
    destination.searchParams.set("next", path + request.nextUrl.search);
  } else if (user && !publicPage && path !== "/account/request" && !path.startsWith("/api/")) {
    const { data: { session } } = await client.auth.getSession();
    try {
      const { status, account } = await readHubAccount(config.apiOrigin, session?.access_token || "");
      if (status === 401) {
        destination = new URL("/login", config.adminOrigin);
        destination.searchParams.set("next", path + request.nextUrl.search);
      } else if (status === 403 || account?.status !== "ACTIVE") destination = new URL("/account/request", config.adminOrigin);
      else if (account && !canOpenPage(account, path, request.nextUrl.searchParams) && !(path === "/" && !request.nextUrl.search)) {
        const blocked = denied(); response.cookies.getAll().forEach(cookie => blocked.cookies.set(cookie)); return blocked;
      }
    } catch {
      const page = unavailablePage();
      const unavailable = new NextResponse(page.body, { status: 503, headers: page.headers });
      response.cookies.getAll().forEach(cookie => unavailable.cookies.set(cookie));
      return unavailable;
    }
  }
  if (!config.password && ["/signup", "/signup/verify", "/login/forgot"].includes(path)) destination = new URL("/login", config.adminOrigin);
  if (destination) {
    const redirect = NextResponse.redirect(destination);
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
    response = redirect;
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|demo-assets/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
