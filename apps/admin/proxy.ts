import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { hostedConfig, isHostedMode } from "./lib/hosted-config";
import { readHubAccount, unavailablePage } from "./lib/hub-account";

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
  const path = request.nextUrl.pathname;
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
