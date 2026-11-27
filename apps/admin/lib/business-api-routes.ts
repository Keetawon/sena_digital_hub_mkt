// Transport shape only. API/SQL retain current staff, Knowledge and object guards.
// Mirrors business_content.py: a fixed reference read and ordinary draft writers.
const base = "v1/admin/content/businesses";
const scopeBase = "v1/admin/content/scopes/(?:corporate|project_group|programme)/[^/\\u0000-\\u001f\\\\]{1,200}";
const code = "[a-z][a-z0-9_]{1,63}";
const section = "[a-z][a-z0-9_.]{1,100}";
const uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const routes = new Map<string, RegExp>([
  ["GET", new RegExp(`^${base}(?:/${code}/content)?$`)],
  ["PUT", new RegExp(`^${base}/${code}/(?:sections/${section}|contacts/${uuid})$`)],
  ["POST", new RegExp(`^${base}/${code}/contacts$`)],
]);
const scopeRoutes = new Map<string, RegExp>([
  ["GET", new RegExp(`^${scopeBase}/content$`)],
  ["PUT", new RegExp(`^${scopeBase}/sections/${section}$`)],
]);
export function businessAllowsApi(path: string, method: string) {
  return routes.get(method)?.exec(path)?.[0] === path;
}
export function businessAllowsQuery(path: string, method: string, query: URLSearchParams) {
  return businessAllowsApi(path, method) && query.size === 0;
}
export function scopeContentAllowsApi(path: string, method: string) {
  return scopeRoutes.get(method)?.exec(path)?.[0] === path;
}
export function scopeContentAllowsQuery(path: string, method: string, query: URLSearchParams) {
  return scopeContentAllowsApi(path, method) && query.size === 0;
}
