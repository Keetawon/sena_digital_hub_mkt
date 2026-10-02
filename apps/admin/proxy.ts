import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { hostedConfig, isHostedMode, verifiedRole } from "./lib/hosted-config";

export async function proxy(request: NextRequest) {
  if (!isHostedMode()) return NextResponse.next();
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
  if (!user || !verifiedRole(user.app_metadata)) {
    if (request.nextUrl.pathname !== "/login" && !request.nextUrl.pathname.startsWith("/api/")) {
      const target = new URL("/login", config.adminOrigin);
      target.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
      const redirect = NextResponse.redirect(target);
      response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
      response = redirect;
    }
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|demo-assets/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
