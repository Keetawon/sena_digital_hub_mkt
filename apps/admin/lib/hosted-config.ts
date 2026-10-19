import type { LocalRole } from "./local-session";

export type HostedConfig = { supabaseUrl: string; publishableKey: string; apiOrigin: string; adminOrigin: string; simulation: boolean; google: boolean; password: boolean; label: string; adminContact: string };

export function accountRole(account: { status?: string; role?: string; agency?: string | null }): LocalRole | null {
  if (account.status !== "ACTIVE") return null;
  if (account.role === "agency") return account.agency === "KIN" ? "agency_kin" : account.agency === "COMBAY" ? "agency_combay" : "agency";
  return ["editor", "publisher", "viewer", "admin", "online_staff"].includes(account.role || "") ? account.role as LocalRole : null;
}

export function isHostedMode() { return process.env.HUB_ENV === "hosted-test" && process.env.HUB_AUTH_MODE === "supabase"; }

// Only public configuration crosses the server/client boundary. Never load a service key here.
export function hostedConfig(): HostedConfig | null {
  if (!isHostedMode()) return null;
  const runtime = process.env;
  const simulation = process.env.HUB_HOSTED_TEST_SIMULATION === "1";
  const supabaseUrl = runtime.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = runtime.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const apiOrigin = process.env.HUB_API_URL;
  const adminOrigin = process.env.HUB_ADMIN_ORIGIN;
  if (!supabaseUrl || !publishableKey || !apiOrigin || !adminOrigin) throw new Error("Hosted H1 public configuration is incomplete");
  if (simulation ? publishableKey !== "h1-simulation-public-key" : !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) throw new Error("Hosted H1 requires a publishable key, never a server credential");
  if (supabaseUrl !== (simulation ? "http://127.0.0.1:54329" : "https://eqlrtevwpyboplljgowo.supabase.co")) throw new Error("Hosted H1 Auth target is not allowed");
  for (const [value, local] of [[apiOrigin, "http://127.0.0.1:8001"], [adminOrigin, "http://127.0.0.1:3001"]]) {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password || (simulation ? value !== local : url.protocol !== "https:" || /^(localhost|127\.|\[::1\])/.test(url.hostname))) throw new Error("Hosted H1 origin is not allowed");
  }
  return { supabaseUrl, publishableKey, apiOrigin, adminOrigin, simulation, google: runtime.HUB_AUTH_GOOGLE === "1", password: runtime.HUB_AUTH_PASSWORD === "1", label: runtime.HUB_ENV_LABEL || runtime.HUB_ENV || "SENA Digital Hub", adminContact: runtime.HUB_ADMIN_CONTACT || "" };
}

export const deferredH1Sections = new Set(["finance", "actuals", "documents", "archive", "exceptions"]);
export const h1Unavailable = "ยังไม่เปิดใช้งานใน H1 · รอเปิดใน H2 ขึ้นไป";

export function h1AllowsApi(path: string, method: string) {
  if (path === "v1/admin/knowledge/preview" || /^v1\/admin\/knowledge\/projects\/[^/]+\/preview-release$/.test(path)) return false;
  if (path === "v1/admin/permissions/catalog") return method === "GET";
  if (/^v1\/admin\/permissions\/(?:preview|apply)$/.test(path)) return method === "POST";
  if (/^v1\/admin\/permissions\/notices\/[a-z_]+\/ack$/.test(path)) return method === "POST";
  if (/^v1\/admin\/accounts\/[0-9a-f-]{36}\/permissions$/.test(path)) return method === "POST";
  if (path === "v1/me/invite-accept") return method === "POST";
  if (/^v1\/admin\/account-invites(?:\/[0-9a-f-]{36}\/decision)?$/.test(path)) return method === "POST" || method === "GET" && path === "v1/admin/account-invites";
  if (/^v1\/admin\/brands\/bulk-(?:preview|create)$/.test(path)) return false;
  if (path.startsWith("v1/admin/assistant") || path.startsWith("v1/admin/ads/archive")) return false;
  if (!path.startsWith("v1/admin/ads/")) return true;
  if (method === "GET") return /^v1\/admin\/ads\/(?:settings|vocab|scopes|registrations(?:\/SN\d{7}[A-Z0-9])?)$/.test(path);
  return method === "POST" && /^v1\/admin\/ads\/registrations\/SN\d{7}[A-Z0-9]\/bindings$/.test(path);
}
