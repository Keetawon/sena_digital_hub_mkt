import { businessAllowsApi, businessAllowsQuery } from './business-api-routes';
import { workflowAllowsApi, workflowAllowsQuery } from './content-workflow-routes';
// Exact private draft routes; source-specific authority is rechecked in SQL.
import { workspaceAllowsApi, workspaceAllowsQuery } from './workspace-api-routes';
import { amenityAllowsApi } from './amenity-routes';
const id = "[a-zA-Z0-9_-]{1,128}";
const uuid = "[0-9a-fA-F-]{36}";
const key = "[a-z][a-z0-9_.-]{0,149}";
const term = "[a-z0-9_.-]{1,150}";
const routes: Record<string, RegExp> = {
  GET: new RegExp(`^v1/admin/(?:content/(?:fields|glossary|search|home)|(?:projects|brands)/${id}/content|faq(?:/(?:questions|references|corporate-contacts|${uuid}))?|faq-intake/clusters(?:/${uuid})?)$`),
  PATCH: new RegExp(`^v1/admin/content/fields/${key}$`),
  PUT: new RegExp(`^v1/admin/(?:content/(?:email-domains/[a-z0-9][a-z0-9_.-]{0,149}|glossary/${term})|projects/${id}/(?:(?:facts|sections)/${key}|buildings/${id}|(?:selling-points|contacts)/${uuid})|brands/${id}/contacts/${uuid}|faq/(?:questions/${key}|corporate-contacts/${uuid}|${uuid}))$`),
  POST: new RegExp(`^v1/admin/(?:content/(?:translations/${uuid}/(?:review|retry)|glossary/${term}/approve)|projects/${id}/(?:sections/${key}/submit|selling-points|contacts)|brands/${id}/contacts|faq(?:/(?:questions/${key}/approve|corporate-contacts|${uuid}/submit))?|faq-intake/clusters/${uuid}/decision)$`),
};

export function contentAllowsApi(path: string, method: string) {
  if (/^v1\/admin\/content\/businesses(?:\/|$)/.test(path)) return businessAllowsApi(path, method);
  if (path === "v1/admin/promotions/resolve") return method === "POST";
  if (/^v1\/admin\/(?:content-workflow|publication-queue)(?:\/|$)/.test(path)) return workflowAllowsApi(path, method);
  if (workspaceAllowsApi(path, method) || amenityAllowsApi(path, method)) return true;
  return (routes[method]?.test(path) ?? false) || mediaAllowsApi(path, method) || unitAllowsApi(path, method) || commercialAllowsApi(path, method) || faqCoverageAllowsApi(path, method) || articleAllowsApi(path, method) || webAllowsApi(path, method);
}

const media: Record<string, RegExp> = {
  GET: new RegExp(`^v1/admin/(?:media/(?:tags|requirements|website)|projects/${id}/(?:media(?:/(?:jobs|website|ai-state))?|content/website))$`),
  PUT: new RegExp(`^v1/admin/(?:media/(?:tags|requirements)/[a-z][a-z0-9_]{0,79}|projects/${id}/media/(?:assets|links|clips)/${uuid})$`),
  POST: new RegExp(`^v1/admin/(?:media/tags/[a-z][a-z0-9_]{0,79}/approve|projects/${id}/media/(?:jobs|website/confirm|links/${uuid}/remove|clips/${uuid}/check))$`),
};
export function mediaAllowsApi(path: string, method: string) { return media[method]?.test(path) ?? false; }

const units: Record<string, RegExp> = {
  GET: new RegExp(`^v1/admin/projects/${id}/unit-types$`),
  PUT: new RegExp(`^v1/admin/projects/${id}/prices/${uuid}$`),
  POST: new RegExp(`^v1/admin/projects/${id}/(?:commercial-types/${id}/(?:submit|review)|prices(?:/${uuid}/(?:submit|review))?)$`),
};
export function unitAllowsApi(path: string, method: string) { return units[method]?.test(path) ?? false; }
// FAQ intake list filters; values are re-validated by the API and SQL.
const intakeFilters: Record<string, RegExp> = {
  level: /^(?:corporate|business|brand|programme|project_group|project|unit_type)$/, kind: /^(?:text|fact|handoff|auto)$/,
  hold: /^(?:none|numeric|commercial|programme_terms|phase_decision|mapping_conflict|prompt_injection|closed_project)$/,
  brand: /^[A-Za-z0-9_-]{1,64}$/, state: /^(?:open|held|question_proposed|decided)$/, after: /^\d{1,6}$/, limit: /^(?:[1-9]\d?|100)$/,
};

export function contentAllowsQuery(path: string, method: string, query: URLSearchParams) {
  if (/^v1\/admin\/content\/businesses(?:\/|$)/.test(path)) return businessAllowsQuery(path, method, query);
  if (/^v1\/admin\/(?:content-workflow|publication-queue)(?:\/|$)/.test(path)) return workflowAllowsQuery(path, method, query);
  if (workspaceAllowsApi(path, method)) return workspaceAllowsQuery(path, method, query);
  if (method === "GET") {
    if (path === "v1/admin/content/search" || path === "v1/admin/content/home") {
      const filters: Record<string, RegExp> = path.endsWith("/search")
        ? { q: /^[^\u0000-\u001f]{0,120}$/, limit: /^(?:[1-9]|[12]\d|30)$/ }
        : { bud: /^[^\u0000-\u001f]{1,200}$/, brand: /^[A-Za-z0-9_-]{1,128}$/, offset: /^(?:0|[1-9]\d{0,4}|100000)$/, limit: /^(?:[1-9]\d?|100)$/, task: /^(?:returned|approval|publish|expiring|fact_missing|review_due|unanswered)$/, gap: new RegExp(`^${uuid}$`) };
      return [...query.keys()].every(key => filters[key]?.test(query.get(key) ?? "") && query.getAll(key).length === 1);
    }
    if (webAllowsApi(path, method)) return [...query.keys()].every(key => key === "locale" && query.getAll(key).length === 1 && /^(?:th|en)$/.test(query.get(key) ?? ""));
    const filters: Record<string, RegExp> | null = new RegExp(`^v1/admin/projects/${id}/media/website$`).test(path) ? { offset: /^(?:0|[1-9]\d{0,5})$/ }
      : path === "v1/admin/articles" ? { q: /^[^\u0000-\u001f]{0,120}$/, offset: /^(?:0|[1-9]\d{0,5})$/, limit: /^(?:[1-9]\d?|100)$/ }
      : new RegExp(`^v1/admin/articles/${uuid}/preview$`).test(path) ? { locale: /^(?:th|en)$/ }
      : path === "v1/admin/faq-coverage" ? { project: new RegExp(`^${id}$`), offset: /^(?:0|[1-9]\d{0,5})$/, limit: /^(?:[1-9]\d?|100)$/ }
      : new RegExp(`^v1/admin/faq-composition/${id}$`).test(path) ? { locale: /^(?:th|en)$/, unit_type: new RegExp(`^${id}$`) }
      : path === "v1/admin/faq-gaps" ? { project: new RegExp(`^${id}$`) } : null;
    if (filters) return [...query.keys()].every(key => filters[key]?.test(query.get(key) ?? "") && query.getAll(key).length === 1);
  }
  return method === "GET" && path === "v1/admin/faq-intake/clusters"
    && [...query.keys()].every(key => Object.hasOwn(intakeFilters, key) && intakeFilters[key].exec(query.get(key) ?? "")?.[0] === query.get(key) && query.getAll(key).length === 1);
}

const commercialKind = "(?:disclosures|sales-terms|programmes|construction)";
const commercial: Record<string, RegExp> = {
  GET: new RegExp(`^v1/admin/(?:projects/${id}/commercial|promotions/references)$`),
  PUT: new RegExp(`^v1/admin/projects/${id}/commercial/${commercialKind}/${uuid}$`),
  POST: new RegExp(`^v1/admin/projects/${id}/commercial/${commercialKind}(?:/${uuid}/(?:submit|review))?$`),
};
export function commercialAllowsApi(path: string, method: string) { return commercial[method]?.test(path) ?? false; }

const faqCoverage: Record<string, RegExp> = {
  GET: new RegExp(`^v1/admin/(?:faq-coverage|faq-composition/${id}|faq-gaps)$`),
  POST: /^v1\/admin\/faq-applicability$/,
  PATCH: new RegExp(`^v1/admin/faq-gaps/${uuid}$`),
};
export function faqCoverageAllowsApi(path: string, method: string) { return faqCoverage[method]?.test(path) ?? false; }

const articles: Record<string, RegExp> = {
  GET: new RegExp(`^v1/admin/articles(?:/(?:references|${uuid}(?:/preview)?))?$`),
  POST: new RegExp(`^v1/admin/articles(?:/${uuid}/(?:submit|review))?$`),
  PUT: new RegExp(`^v1/admin/articles/${uuid}$`),
};
export function articleAllowsApi(path: string, method: string) { return articles[method]?.test(path) ?? false; }

const pageKey = "(?:project|brand|programme|corporate|article|location):[A-Za-z0-9][A-Za-z0-9_-]{0,127}";
const web: Record<string, RegExp> = {
  GET: new RegExp(`^v1/admin/web(?:/(?:pages/${pageKey}/(?:history|versions/${uuid})|publications/${uuid}(?:/preview)?))?$`),
  PUT: new RegExp(`^v1/admin/web/pages/${pageKey}$`),
  POST: new RegExp(`^v1/admin/web/(?:pages/${pageKey}/pointer|publications(?:/${uuid}/publish)?)$`),
};
export function webAllowsApi(path: string, method: string) { return web[method]?.test(path) ?? false; }
