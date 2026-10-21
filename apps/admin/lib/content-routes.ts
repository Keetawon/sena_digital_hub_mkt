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
  return routes[method]?.test(path) ?? false;
}
