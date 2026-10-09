import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { hostedConfig } from "@/lib/hosted-config";
import { canOpenPage } from "@/lib/hub-permissions";
import { safeNext, workspaceLanding } from "@/components/hub-navigation-data";
import { readHubAccount, unavailablePage } from "@/lib/hub-account";

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
    try {
      const { status, account } = await readHubAccount(config.apiOrigin, data.session.access_token);
      if (status === 401) response.headers.set("Location", new URL("/login", config.adminOrigin).href);
      else if (account?.status === "ACTIVE") {
        const requested = new URL(safeNext(request.nextUrl.searchParams.get("next")), config.adminOrigin);
        response.headers.set("Location", canOpenPage(account, requested.pathname, requested.searchParams) ? requested.href : new URL(workspaceLanding(account.capabilities), config.adminOrigin).href);
      }
    } catch {
      // The OAuth code is already consumed; retry the destination using the saved session.
      const page = unavailablePage(safeNext(request.nextUrl.searchParams.get("next")));
      const unavailable = new NextResponse(page.body, { status: 503, headers: page.headers });
      response.cookies.getAll().forEach(cookie => unavailable.cookies.set(cookie));
      return unavailable;
    }
  }
  return response;
}
