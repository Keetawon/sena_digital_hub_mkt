// Transport shape only. API/SQL retain current caller, source and revision checks.
// Acceptance always uses the source editor's ordinary draft writer.
const base = "v1/admin/content/writing-aid";
const uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const routes = new Map<string, RegExp>([
  ["GET", new RegExp(`^${base}/${uuid}$`)],
  ["POST", new RegExp(`^${base}/${uuid}/proposals$`)],
]);

export function writingAllowsApi(path: string, method: string) {
  // Equality also rejects the final line terminator that JavaScript's $ permits.
  return routes.get(method)?.exec(path)?.[0] === path;
}

export function writingAllowsQuery(path: string, method: string, query: URLSearchParams) {
  return writingAllowsApi(path, method) && query.size === 0;
}
