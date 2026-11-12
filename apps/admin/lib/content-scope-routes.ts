// Transport shape only. API/SQL retain account, source and object authority.
// Query references are exact raw values; never trim, decode twice or strip BUD prefixes.
const scopes = "v1/admin/accounts/content-scopes";
const runs = "v1/admin/accounts/bu-sync-runs";
const settings = "v1/admin/accounts/content-scope-settings";
const notices = "v1/admin/content/bu-notices";
const uuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const count = /^(?:[1-9]\d?|100)$/;
const text = (min: number, max: number) => new RegExp(`^[^\\u0000-\\u001f\\u007f-\\u009f]{${min},${max}}$`, "u");
const noQuery = new Map<string, RegExp>();
const routes = new Map<string, ReadonlyMap<string, RegExp>>([
  [`GET ${scopes}`, new Map([
    ["account_id", uuid], ["reference_kind", /^(?:projects|bus)$/], ["bu_id", text(1, 200)],
    ["q", text(0, 120)], ["after", text(0, 200)], ["limit", count],
    ["history_after", text(0, 1024)], ["history_limit", count],
  ])],
  [`GET ${runs}`, new Map([["after", text(0, 500)], ["limit", count]])],
  [`GET ${settings}`, noQuery],
  [`POST ${settings}/preview`, noQuery],
  [`POST ${settings}/apply`, noQuery],
  [`GET ${notices}`, new Map([["project", text(1, 200)], ["limit", count]])],
]);

export function contentScopeAllowsApi(path: string, method: string) {
  return routes.has(`${method} ${path}`);
}

export function contentScopeAllowsQuery(path: string, method: string, query: URLSearchParams) {
  const filters = routes.get(`${method} ${path}`);
  if (!filters) return false;
  for (const [key, value] of query) {
    const pattern = filters.get(key);
    if (!pattern || query.getAll(key).length !== 1 || pattern.exec(value)?.[0] !== value) return false;
  }
  // History belongs to one exact account, even for an explicit default limit.
  return path !== scopes || !(query.has("history_after") || query.has("history_limit")) || query.has("account_id");
}
