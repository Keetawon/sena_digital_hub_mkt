const uuid = "[0-9a-fA-F-]{36}";

const routes: Record<string, RegExp> = {
  GET: new RegExp(`^v1/admin/events(?:/(?:references|alerts|${uuid}))?$`),
  POST: new RegExp(`^v1/admin/events(?:/(?:${uuid}/(?:attachments|join)|attachments/${uuid}/remove|participants/${uuid}/decision|alerts/${uuid}/acknowledge))?$`),
  PUT: new RegExp(`^v1/admin/events/${uuid}$`),
};

export function eventAllowsApi(path: string, method: string): boolean {
  return routes[method]?.test(path) ?? false;
}

export function eventAllowsQuery(path: string, method: string, query: URLSearchParams): boolean {
  if (method !== "GET") return [...query.keys()].length === 0;
  if (path === "v1/admin/events") {
    const filters: Record<string, RegExp> = {
      filter: /^(?:all|open_join|upcoming|changed|mine)$/,
      q: /^[^\u0000-\u001f]{0,150}$/,
      scope: /^[^\u0000-\u001f]{0,220}$/,
      limit: /^(?:[1-9]\d?|100)$/,
      offset: /^(?:0|[1-9]\d{0,4}|100000)$/,
    };
    return [...query.keys()].every(k => filters[k]?.test(query.get(k) ?? "") && query.getAll(k).length === 1);
  }
  if (path === "v1/admin/events/alerts") {
    return [...query.keys()].every(k => k === "only_mine" && /^(?:true|false)$/.test(query.get(k) ?? "") && query.getAll(k).length === 1);
  }
  return [...query.keys()].length === 0;
}
