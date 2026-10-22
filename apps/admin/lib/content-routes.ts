// Exact private draft routes; source-specific authority is rechecked in SQL.
const id = "[a-zA-Z0-9_-]{1,128}";
const uuid = "[0-9a-fA-F-]{36}";
const key = "[a-z][a-z0-9_.-]{0,149}";
const term = "[a-z0-9_.-]{1,150}";
const routes: Record<string, RegExp> = {
  GET: new RegExp(`^v1/admin/(?:content/(?:fields|glossary)|(?:projects|brands)/${id}/content|faq(?:/(?:questions|references|corporate-contacts|${uuid}))?)$`),
  PATCH: new RegExp(`^v1/admin/content/fields/${key}$`),
  PUT: new RegExp(`^v1/admin/(?:content/(?:email-domains/[a-z0-9][a-z0-9_.-]{0,149}|glossary/${term})|projects/${id}/(?:(?:facts|sections)/${key}|buildings/${id}|(?:selling-points|contacts)/${uuid})|brands/${id}/contacts/${uuid}|faq/(?:questions/${key}|corporate-contacts/${uuid}|${uuid}))$`),
  POST: new RegExp(`^v1/admin/(?:content/(?:translations/${uuid}/(?:review|retry)|glossary/${term}/approve)|projects/${id}/(?:sections/${key}/submit|selling-points|contacts)|brands/${id}/contacts|faq(?:/(?:questions/${key}/approve|corporate-contacts|${uuid}/submit))?)$`),
};

export function contentAllowsApi(path: string, method: string) {
  return (routes[method]?.test(path) ?? false) || mediaAllowsApi(path, method) || unitAllowsApi(path, method);
}

const media: Record<string, RegExp> = {
  GET: new RegExp(`^v1/admin/(?:media/(?:tags|requirements)|projects/${id}/media(?:/jobs)?)$`),
  PUT: new RegExp(`^v1/admin/(?:media/(?:tags|requirements)/[a-z][a-z0-9_]{0,79}|projects/${id}/media/(?:assets|links|clips)/${uuid})$`),
  POST: new RegExp(`^v1/admin/(?:media/tags/[a-z][a-z0-9_]{0,79}/approve|projects/${id}/media/(?:jobs|links/${uuid}/remove|clips/${uuid}/check))$`),
};
export function mediaAllowsApi(path: string, method: string) { return media[method]?.test(path) ?? false; }

const units: Record<string, RegExp> = {
  GET: new RegExp(`^v1/admin/projects/${id}/unit-types$`),
  PUT: new RegExp(`^v1/admin/projects/${id}/prices/${uuid}$`),
  POST: new RegExp(`^v1/admin/projects/${id}/(?:commercial-types/${id}/(?:submit|review)|prices(?:/${uuid}/(?:submit|review))?)$`),
};
export function unitAllowsApi(path: string, method: string) { return units[method]?.test(path) ?? false; }
