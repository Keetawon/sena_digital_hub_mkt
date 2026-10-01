// Navigation is only a hint; every API endpoint still checks its own permissions.
export function isHubStaff(role: unknown): boolean {
  return typeof role === "string" && ["editor", "publisher", "viewer", "admin", "online_staff"].includes(role);
}
