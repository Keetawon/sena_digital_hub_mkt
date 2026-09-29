import { cookies } from "next/headers";

export const roles = ["editor", "publisher", "viewer", "admin", "online_staff", "agency_kin", "agency_combay"] as const;
export type LocalRole = (typeof roles)[number];
export const roleLabels: Record<LocalRole, string> = {
  editor: "ผู้แก้ไขข้อมูล",
  publisher: "ผู้เผยแพร่",
  viewer: "ผู้อ่านข้อมูล",
  admin: "ผู้ดูแลระบบ",
  online_staff: "ทีมออนไลน์",
  agency_kin: "เอเจนซี KIN",
  agency_combay: "เอเจนซี COMBAY",
};
const cookieName = "sena_local_persona";
export { cookieName };

export function isLocalMode() {
  return process.env.HUB_ENV === "local" && process.env.HUB_AUTH_MODE === "demo";
}

export function isLoopback(hostname: string) {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
}

export function localRequestOrigin(request: { headers: Headers; url: string }): string | null {
  const host = request.headers.get("host");
  if (!host || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) return null;
  try {
    const protocol = new URL(request.url).protocol;
    if (!["http:", "https:"].includes(protocol)) return null;
    const actual = new URL(`${protocol}//${host}`);
    return isLoopback(actual.hostname) ? actual.origin : null;
  } catch { return null; }
}

export function hasSameLocalOrigin(request: { headers: Headers; url: string }) {
  const expected = localRequestOrigin(request);
  const origin = request.headers.get("origin");
  if (!expected || !origin) return false;
  try {
    const parsed = new URL(origin);
    return ["http:", "https:"].includes(parsed.protocol)
      && isLoopback(parsed.hostname)
      && parsed.origin === origin
      && parsed.origin === expected;
  } catch { return false; }
}

export async function getLocalRole(): Promise<LocalRole | null> {
  if (!isLocalMode()) return null;
  const value = (await cookies()).get(cookieName)?.value;
  return roles.includes(value as LocalRole) ? value as LocalRole : null;
}

export function getRoleToken(role: LocalRole | "service_consumer") {
  const key = `HUB_DEMO_${role.toUpperCase()}_TOKEN`;
  const token = process.env[key];
  return token && token.length >= 32 ? token : null;
}
