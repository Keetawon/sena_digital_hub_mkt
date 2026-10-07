import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { hostedConfig } from "@/lib/hosted-config";
import { safeNext } from "@/components/hub-navigation-data";

export async function GET(request: NextRequest) {
  const config = hostedConfig();
  if (!config || !config.google) return NextResponse.redirect(new URL("/login", request.url));
  const response = NextResponse.redirect(new URL("/account/request", config.adminOrigin));
  response.headers.set("Cache-Control", "no-store");
  const client = createServerClient(config.supabaseUrl, config.publishableKey, { cookies: {
    getAll: () => request.cookies.getAll(),
    setAll: values => values.forEach(({ name, value, options }) => response.cookies.set(name, value, { ...options, secure: !config.simulation, sameSite: "lax" })),
  } });
  const code = request.nextUrl.searchParams.get("code");
  const { data, error } = code ? await client.auth.exchangeCodeForSession(code) : { data: null, error: true };
  if (error || !data?.session) response.headers.set("Location", new URL("/login?error=oauth", config.adminOrigin).href);
  else {
    const me = await fetch(`${config.apiOrigin}/v1/me`, { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
    if (me.ok && (await me.json()).data.status === "ACTIVE") response.headers.set("Location", new URL(safeNext(request.nextUrl.searchParams.get("next")), config.adminOrigin).href);
  }
  return response;
}
