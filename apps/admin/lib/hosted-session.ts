import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getLocalRole, getRoleToken, localApiOrigin } from "./local-session";
import { hostedConfig, isHostedMode, accountRole } from "./hosted-config";
import { HubApiUnavailable, readHubAccount } from "./hub-account";
import { verifyHostedAccessToken } from "./hosted-token-cache";

export const getHostedIdentity = cache(async () => {
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
  const user = await verifyHostedAccessToken(client, session.access_token, Boolean(config.simulation));
  if (!user) return null;
  return { token: session.access_token };
});

export const getHostedCaller = cache(async () => {
  const identity = await getHostedIdentity();
  if (!identity) return null;
  const { status, account } = await readHubAccount(hostedConfig()!.apiOrigin, identity.token);
  if (status === 401) return null;
  return { role: account ? accountRole(account) : null, account, token: identity.token };
});

export const getHubCaller = cache(async () => {
  if (isHostedMode()) return getHostedCaller();
  const selected = await getLocalRole();
  const token = selected ? getRoleToken(selected) : null;
  if (!token) return null;
  const { status, account } = await readHubAccount(localApiOrigin(), token);
  if (status === 401) return null;
  // The cookie identifies a synthetic persona only; every permission is from /me.
  return { role: selected, account, token };
});
export async function getHubAccount() { return (await getHubCaller())?.account ?? null; }
export async function getHubRole() { return (await getHubCaller())?.role ?? null; }
