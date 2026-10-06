import { roleLabels, type LocalRole } from "./roles";

// Navigation is only a hint; every API endpoint still checks its own permissions.
export function isHubStaff(role: unknown): boolean {
  return typeof role === "string" && ["editor", "publisher", "viewer", "admin", "online_staff"].includes(role);
}
export function isContentStaff(role: unknown): boolean {
  return typeof role === "string" && ["editor", "publisher", "viewer", "admin"].includes(role);
}

export function staffActorLabel(value: string, localMode: boolean): string {
  // These identities belong to the local role picker, not a hosted staff directory.
  const localActors: Record<string, LocalRole> = {
    "00000000-0000-0000-0000-000000000001": "editor",
    "00000000-0000-0000-0000-000000000002": "publisher",
    "00000000-0000-0000-0000-000000000003": "viewer",
    "00000000-0000-0000-0000-000000000005": "admin",
    "00000000-0000-0000-0000-000000000006": "online_staff",
    "00000000-0000-0000-0000-000000000007": "agency_kin",
    "00000000-0000-0000-0000-000000000008": "agency_combay",
  };
  if (localMode && localActors[value]) return roleLabels[localActors[value]];
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? "ยังไม่มีชื่อผู้แก้ไข" : value;
}
