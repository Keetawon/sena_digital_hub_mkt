// The server catalog and /v1/me projection are the only UI permission inputs.
// Legacy role names are identity/template labels, never a fallback grant.
export type PermissionLevel = "view" | "edit" | "approve";
export type TemplateRef = { code: string; version: number };
export type PermissionCatalogTab = {
  tab: string; label_th: string; nav_group: "content" | "ads" | "other" | null;
  levels: string[]; special_actions: string[]; special_labels?: Record<string, string>;
  separate_edit_approve: boolean; agency_visible: boolean; sensitivity: string;
  rollout_state: string; guards_ready: boolean; new_for_actor?: boolean;
};
export type PermissionTemplate = TemplateRef & { label_th: string; tabs: Record<string, string[]> };
export type AccountAccess = { tabs: Record<string, string[]>; can_manage_users: boolean; template: TemplateRef | null; customised: boolean };
export type CapabilityProjection = {
  tabs: Record<string, Partial<Record<PermissionLevel, boolean>>>;
  special_actions: Record<string, boolean>; can_manage_users: boolean;
  agency_registry: boolean; published_consumer: boolean; locked_tabs: string[];
  template: string | null; template_version: number | null; customised?: boolean;
  catalog: PermissionCatalogTab[];
};
export type HubAccount = {
  id: string; status: string; role?: string; hub_role?: string | null; agency?: string | null;
  agency_code?: string | null; display_name_th?: string; can_manage_users?: boolean;
  capabilities?: CapabilityProjection; pending_count?: number; updated_at?: string;
};
export const emptyCapabilities: CapabilityProjection = { tabs: {}, special_actions: {}, can_manage_users: false,
  agency_registry: false, published_consumer: false, locked_tabs: [], template: null, template_version: null, catalog: [] };
export function can(caps: CapabilityProjection | null | undefined, tab: string, level: PermissionLevel = "view") {
  if (tab === "registry" && level === "view" && caps?.agency_registry) return true;
  return caps?.tabs?.[tab]?.view === true && caps.tabs[tab]?.[level] === true;
}
export function canSpecial(caps: CapabilityProjection | null | undefined, action: string) {
  return can(caps, action.split(".")[0]) && caps?.special_actions?.[action] === true;
}
export function capabilityKey(account: HubAccount | null) {
  return JSON.stringify([account?.id, account?.status, account?.capabilities ?? null]);
}

export function pagePermission(path: string, query: URLSearchParams): { tab: string; level: PermissionLevel } | null {
  if (path === "/faq") return { tab: "knowledge", level: "view" };
  if (path === "/content") return { tab: query.has("brand") ? "brands" : "projects", level: "view" };
  if (path === "/content/fields") return { tab: "projects", level: "view" };
  if (path === "/") return { tab: query.has("brand") || query.get("view") === "brands" ? "brands" : "projects", level: "view" };
  if (path === "/admin/accounts") return { tab: "accounts", level: "view" };
  const content = /^\/(promotions|releases|knowledge|questions)$/.exec(path);
  if (content) return { tab: content[1], level: "view" };
  const operations = /^\/ads\/(registry|finance|actuals|documents|archive|exceptions)(?:\/(new|inbox))?$/.exec(path);
  return operations ? { tab: operations[1], level: operations[2] === "new" ? "edit" : "view" } : null;
}
export function canOpenPage(account: HubAccount, path: string, query: URLSearchParams) {
  const permission = pagePermission(path, query);
  return !permission || (permission.tab === "accounts" ? account.capabilities?.can_manage_users === true : can(account.capabilities, permission.tab, permission.level));
}

// Explicit UI dispatch matching the API finance action inventory. New paths fail
// closed here until classified; the transaction guards are the final authority.
const financeEditPaths = new RegExp("^v1/admin/ads/(?:memos(?:/[^/]+)?|memo-identifiers|media-lines(?:/[^/]+/revisions(?:/[^/]+)?)?|corrections|(?:ad-accounts|channel-accounts)(?:/[^/]+/versions)?|commitments(?:/[^/]+/(?:revisions|covers|occurrences))?|card-import-rows/[^/]+/classify)$");
const financeApprovePaths = new RegExp("^v1/admin/ads/(?:memos/[^/]+/confirm-record|media-lines/[^/]+/(?:archive|revisions/[^/]+/confirm)|line-assignments(?:/[^/]+/(?:replace|end|acknowledge))?|corrections/[^/]+/apply|(?:ad-accounts|channel-accounts)/[^/]+/versions/(?:confirm|close)|commitments/[^/]+/(?:activate|suspend)|card-imports/[^/]+/(?:confirm|replace)|cost-records/[^/]+/allocations)$");
export function canFinanceAction(caps: CapabilityProjection, path: string, values: Record<string, unknown> = {}) {
  if (/^v1\/admin\/ads\/(memo-identifiers|corrections)\/[^/]+\/(review|retire)$/.test(path)) return canSpecial(caps, "finance.review_identifiers_corrections");
  if (/^v1\/admin\/ads\/card-statements(?:\/[^/]+)?$/.test(path)) return can(caps, "finance", values.review_status === "CONFIRMED" ? "approve" : "edit");
  return financeApprovePaths.test(path) ? can(caps, "finance", "approve") : financeEditPaths.test(path) && can(caps, "finance", "edit");
}
