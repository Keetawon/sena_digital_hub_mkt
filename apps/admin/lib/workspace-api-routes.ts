// Transport allowlist only; current source/object authority is checked by API/SQL.
const base = "v1/admin/content/workspace";
const kinds = new Set(["corporate", "brand", "project", "programme", "project_group", "unit_type"]);
const reference = /^[^/\\\u0000-\u001f\u007f]{1,200}$/;
const cursor = /^[1-9]\d{0,18}$/;
const uuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const count = /^(?:[1-9]\d?|100)$/;
const boundedText = (limit: number) => new RegExp(`^[^\\u0000-\\u001f\\u007f]{0,${limit}}$`);
const validCursor = (value: string) => cursor.test(value) && BigInt(value) <= BigInt("9223372036854775807");
const date = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function route(path: string, method: string) {
  if (method === "POST" && /^v1\/admin\/projects\/[a-zA-Z0-9_-]{1,128}\/content\/website\/[0-9a-fA-F-]{36}\/decision$/.test(path)) {
    return uuid.test(path.split("/")[6]) ? "decision" : null;
  }
  if (method !== "GET") return null;
  if (path === "v1/admin/content/activity") return "activity";
  if (path === `${base}/tree`) return "tree";
  if (path === `${base}/resolve`) return "resolve";
  if (!path.startsWith(base + "/")) return null;
  const parts = path.slice(base.length + 1).split("/");
  if (!kinds.has(parts[0]) || !reference.test(parts[1] ?? "")) return null;
  if (parts.length === 2) return "page";
  if (parts.length === 3 && ["faq", "preview", "history"].includes(parts[2])) return parts[2];
  if (parts.length === 4 && parts[2] === "history" && validCursor(parts[3])) return "event";
  return null;
}

export function workspaceAllowsApi(path: string, method: string) {
  return route(path, method) !== null;
}

export function workspaceAllowsQuery(path: string, method: string, query: URLSearchParams) {
  const selected = route(path, method);
  if (!selected || method !== "GET") return false;
  let filters: Record<string, RegExp>;
  switch (selected) {
    case "tree": filters = { parent_kind: /^(?:corporate|brand|project|programme|project_group|unit_type)$/, parent_ref: reference, q: boundedText(200), after: boundedText(220), limit: count }; break;
    case "resolve": filters = { faq: uuid, cluster: uuid, phase: reference }; break;
    case "page": filters = { phase: reference }; break;
    case "faq": filters = { phase: reference, q: boundedText(200), after: boundedText(120), limit: count, locale: /^(?:th|en)$/, question_key: /^[a-z][a-z0-9_]{1,100}$/ }; break;
    case "preview": filters = { phase: reference, locale: /^(?:th|en)$/ }; break;
    case "history": filters = { before: cursor, limit: count }; break;
    case "activity": filters = { actor_id: uuid, project: reference, rem_bu_id: reference, date_from: date, date_to: date, before: cursor, limit: count }; break;
    default: filters = {};
  }
  if (![...query.keys()].every(key => filters[key]?.test(query.get(key) ?? "") && query.getAll(key).length === 1)) return false;
  if (query.has("before") && !validCursor(query.get("before")!)) return false;
  if (selected === "tree" && query.has("parent_kind") !== query.has("parent_ref")) return false;
  if (selected === "resolve" && query.has("faq") === query.has("cluster")) return false;
  if (selected === "faq" && query.has("question_key") && (query.has("q") || query.has("after"))) return false;
  for (const key of ["date_from", "date_to"]) if (query.has(key) && !Number.isFinite(Date.parse(query.get(key)!))) return false;
  if (query.has("date_from") && query.has("date_to") && Date.parse(query.get("date_from")!) > Date.parse(query.get("date_to")!)) return false;
  return true;
}
