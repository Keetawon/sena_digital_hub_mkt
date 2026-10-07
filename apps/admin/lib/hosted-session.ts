import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getLocalRole } from "./local-session";
import { hostedConfig, isHostedMode, accountRole } from "./hosted-config";

export const getHostedCaller = cache(async () => {
  const config = hostedConfig();
  if (!config) return null;
  const jar = await cookies();
  const client = createServerClient(config.supabaseUrl, config.publishableKey, {
    cookieOptions: { secure: !config.simulation, sameSite: "lax" },
    cookies: { getAll: () => jar.getAll(), setAll: values => {
      // Server Components cannot set cookies; proxy.ts has already refreshed them.
      try { for (const { name, value, options } of values) jar.set(name, value, options); } catch { /* Read-only rendering. */ }
    } },
  });
  const { data: { session } } = await client.auth.getSession();
  if (!session) return null;
  // Verify the exact bearer we forward; the cached cookie's user/role is untrusted.
  const { data: { user }, error } = await client.auth.getUser(session.access_token);
  if (error || !user) return null;
  const response = await fetch(`${config.apiOrigin}/v1/me`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) return null;
  const { data: account } = await response.json();
  return { role: accountRole(account), account, token: session.access_token };
});

export async function getHubRole() { return isHostedMode() ? (await getHostedCaller())?.role ?? null : getLocalRole(); }
