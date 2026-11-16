import { expect, test, type Page, type Locator } from "@playwright/test";
import { emptyCapabilities, type HubAccount } from "../../apps/admin/lib/hub-permissions";
import { writingText as text, type WritingRequestStatus } from "../../apps/admin/lib/writing-aid";
import { workspaceProjection, fitsWorkspace } from "./unified-workspace-helpers";
import { refreshSyntheticAuthority } from "./content-workflow-fixtures";

const origin = "http://127.0.0.1:3000", api = "/api/hub/v1/admin/", stamp = "2026-11-04T09:00:00+00:00", nextStamp = "2026-11-04T09:01:00+00:00";
const uuid = (n: number) => `77111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const ids = { project: uuid(1), brand: uuid(2), section: uuid(3), point: uuid(4), type: uuid(5), faq: uuid(6), article: uuid(7), articleVersion: uuid(8), businessSection: uuid(9) };
const publicId = "prj_writing_fields", brandId = "brd_writing_fields", typeId = "ctyp_writing_fields", rem = "REM-WRITING-EXACT", business = "residential";
const before = "  Green 20.5 homes {project} 20.5  ", beforeEn = "  English 20.5 homes {project} 20.5  ";
const loc = () => ({ th: before, en: beforeEn });
const projectPath = (query: string) => `/website/project/${publicId}?${query}`;
type Call = { path: string; method: string; body: any };
function gate() { let release = () => {}; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release, seen: 0 }; }
function field(key: string, enabled = true) {
  return { field_key: key, entity: key.split(".")[0], section: key.startsWith("section.") || key.startsWith("selling_point.") ? "narrative" : "identity",
    label: { th: "Synthetic " + key }, help: {}, sort: 1, value_kind: "text", unit: null, source_policy: "mkt", source_ref: null, owner_role: "Marketing",
    required_for: {}, locales_required: ["th"], surfaces: [], default_ai_exposure: "internal", review_every_days: null, validation: {}, status: "active", revision: 4, ai_writing_enabled: enabled };
}
/** Finite transport fixtures exercise mounted editors. Real source authorization is tested by API/H1 suites. */
async function fixture(page: Page, options: { enabled?: boolean; edit?: boolean; budget?: boolean; topic?: string } = {}) {
  const calls: Call[] = [], reads: string[] = [], gates = new Map<string, ReturnType<typeof gate>>();
  const project: any = { id: ids.project, public_project_id: publicId, public_name: { th: "Synthetic project", en: "Original name" }, address: {}, meta_title: loc(), meta_description: loc(), slug: publicId, updated_at: stamp,
    published_version_id: null, publication_available: false, readiness: { ready: false, percent: 0, missing: [] }, models: [], assets: [], commercial_types: [],
    source: { rem_project_id: rem, project_name_rem: "Synthetic REM evidence", source_snapshot_at: stamp, source_updated_at: stamp } };
  const brand: any = { id: ids.brand, public_brand_id: brandId, rem_brand_id: "REM-BRAND-WRITING", public_name: { th: "Synthetic brand" }, description: loc(), slug: brandId, status: "active", updated_at: stamp,
    projects: [], assets: [], published_version_id: null, publication_available: false, readiness: { ready: false, percent: 0, missing: [] }, source: { brand_name_rem: "Synthetic source brand" } };
  const section: any = { id: ids.section, section_key: "section.concept_detail", revision: 4, state: "DRAFT", version: { version_no: 4, body: loc(), state: "DRAFT", source_ref: "Preserved source", ai_exposure: "internal", created_at: stamp }, history: [] };
  const point: any = { point_key: ids.point, revision: 4, title: loc(), detail: loc(), icon_code: "check", linked_feature_code: null, linked_fact_keys: [], sort: 1, state: "DRAFT", ai_exposure: "internal", history: [] };
  const facility: any = { code: "pool", facility_code: "pool", project_id: ids.project, revision: 4, name_th: "Synthetic pool", name_en: "Synthetic pool", required: false, status: "present", description: loc(),
    location_note: "Preserved location", access_note: "Preserved access", evidence_note: "Preserved evidence", expected_open_date: null, updated_at: stamp, updated_by: null,
    display_name: { th: "Synthetic pool" }, location_label: {}, size_sqm: 10, opening_hours: {}, applies_to_project_ids: [], ai_exposure: "internal", icon_code: "pool", group_code: "recreation" };
  project.facilities = { review_status: "draft", checklist_version: 1, expected_count: 1, collected_count: 1, items: [facility], missing: [] };
  const unitType: any = { id: ids.type, public_commercial_type_id: typeId, revision: 4, public_name: { th: "Synthetic unit" }, description: loc(), highlights: loc(), product_form: "house", category: "single_house",
    area_min_sqm: 100, area_max_sqm: 120, bedrooms: 2, bathrooms: 1, kitchens: 1, storeys: 2, parking_spaces: 1, land_area_sqm: 30, ceiling_height_m: 2.8, special_rooms: [], furniture_package: "none", price_mode: "manual",
    ai_exposure: "internal", source_model_ids: [], source_links: [], source_notes: "  Preserve spacing  ", status: "draft", readiness: { missing: [], review_issues: [], publication_ready: false }, workflow: { ready: true, items: [], recommended: [] }, history: [], comparison: { groups: [] }, assets: [] };
  project.commercial_types = [unitType];
  const question: any = { question_key: "writing_fields", topic: options.topic ?? "design", default_level: "project", question_template: { th: "Synthetic question" }, alt_questions: {}, answer_kind: "text", fact_keys: [], property_types: [], is_core: false, show_on_project_pages: false, web_sort: 0, status: "approved", revision: 4, ai_exposure: "internal" };
  const faq: any = { id: ids.faq, question_key: question.question_key, scope_type: "project", scope_id: rem, revision: 4, state: "DRAFT", version: { version_no: 1, question: loc(), alt_questions: loc(), short_answer: loc(), detail: loc(), answer_kind: "text", fact_keys: [], applies_to_project_ids: [rem], applicability_rule: {}, review_due: null, effective_to: null, state: "DRAFT", ai_exposure: "internal", created_at: stamp, editors: [] }, history: [], sources: [], translations: [] };
  const metadata = { slug: "synthetic-writing", category: options.topic ?? "design", cover_asset_id: null, author: {}, tags: [], ai_exposure: "internal" };
  const block = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Preserved ordinary article body" }] }] };
  const article: any = { ...metadata, id: ids.article, revision: 4, state: "DRAFT", approved_version_id: null, version: { id: ids.articleVersion, version_no: 1, state: "DRAFT", title: loc(), excerpt: loc(), seo_title: loc(), seo_description: loc(), blocks: { th: block, en: block }, metadata, editors: [], created_at: stamp }, links: [], history: [], translations: [], readiness: [] };
  const businessSection: any = { ...structuredClone(section), id: ids.businessSection };
  const content: any = { facts: [], rem: {}, computed: {}, buildings: [], sections: [section], selling_points: [point], contacts: [], translations: [], readiness: { required_missing: 0, ready: true, items: [] } };
  const businessContent: any = { scope_type: "business", scope_id: business, sections: [businessSection], contacts: [], translations: [] };
  const unit: any = { project, types: [unitType], prices: [], translations: [], room_tags: [], tours: [], source: { models: [], groups: [] }, promotions: [] };
  const amenities: any = { project: { ...project, name: project.public_name }, facilities: [facility], features: [], solar: [], places: [], references: { features: [], rail_lines: [], rail_stations: [], expressways: [], expressway_ramps: [], facilities: [] }, unit_types: [], phases: [], translations: [], nearest_stations: [], media: { assets: [], links: [], tags: [] } };
  const catalog: any = { can_manage: true, items: ["project.meta_title", "project.meta_description", "brand.description", "section.concept_detail", "selling_point.title", "selling_point.detail", "facility.description", "commercial_type.description", "commercial_type.highlights", "faq.question", "faq.alt_questions", "faq.short_answer", "faq.detail", "article.title", "article.excerpt", "article.seo_title", "article.seo_description", "project.public_name", "project.address", "disclosure.notes", "price.condition_text", "contact.value"].map(key => field(key, options.enabled !== false)) };
  const sources: { translation: any; value: () => any }[] = [];
  function bind(owner_type: string, owner_key: string, field_key: string, value: () => any) {
    const translation: any = { id: uuid(100 + sources.length), owner_type, owner_key, field_key, revision: 4, th_version: 3, th_text: value().th ?? "", entered_en: value().en ?? "", reviewed_en: value().en ?? "", machine_en: null, translation_state: "reviewed", editable: options.edit !== false, job: null };
    sources.push({ translation, value }); return translation;
  }
  content.translations = [bind("project", ids.project, "project.meta_title", () => project.meta_title), bind("project", ids.project, "project.meta_description", () => project.meta_description),
    bind("section", ids.section, "section.concept_detail", () => section.version.body), bind("selling_point", ids.point, "selling_point.title", () => point.title), bind("selling_point", ids.point, "selling_point.detail", () => point.detail),
    bind("facility", ids.project + ":pool", "facility.description", () => facility.description)];
  const brandContent = { contacts: [], translations: [bind("brand", ids.brand, "brand.description", () => brand.description)] };
  unit.translations = [bind("commercial_type", ids.type, "commercial_type.description", () => unitType.description), bind("commercial_type", ids.type, "commercial_type.highlights", () => unitType.highlights)];
  amenities.translations = content.translations.filter((row: any) => row.owner_type === "facility");
  businessContent.translations = [bind("section", ids.businessSection, "section.concept_detail", () => businessSection.version.body)];
  faq.translations = ["question", "alt_questions", "short_answer", "detail"].map(key => bind("faq", ids.faq, "faq." + key, () => faq.version[key]));
  article.translations = ["title", "excerpt", "seo_title", "seo_description"].map(key => bind("article", ids.article + ":" + key + ".en", "article." + key, () => article.version[key]));
  let stale = false, ambiguous = false; const failedReads = new Set<string>();
  const account: HubAccount & { capabilities: NonNullable<HubAccount["capabilities"]> } = { id: uuid(99), status: "ACTIVE", hub_role: "admin", display_name_th: "Synthetic writer", capabilities: { ...emptyCapabilities, published_consumer: true,
    tabs: Object.fromEntries(["projects", "brands", "knowledge", "releases"].map(tab => [tab, { view: true, edit: options.edit !== false, approve: false }])), special_actions: { "projects.manage_field_catalog": true } } };
  const requestStates = new Map<string, WritingRequestStatus[]>();
  const state = (translation: any) => ({ translation_id: translation.id, revision: translation.revision, eligible: catalog.items.find((row: any) => row.field_key === translation.field_key)?.ai_writing_enabled === true, editable: translation.editable,
    budget: { status: options.budget ? "budget_exhausted" : "available", synthetic: true, model: "stub-writing-v1", month: "2026-11-01", cap_usd: 0, spent_usd: 0, remaining_usd: 0, ceiling_usd: 0 }, requests: requestStates.get(translation.id) ?? [] });
  function sync() { for (const source of sources) { const value = source.value(); if (source.translation.th_text !== (value.th ?? "") || source.translation.entered_en !== (value.en ?? "")) { source.translation.revision++; if (source.translation.th_text !== (value.th ?? "")) source.translation.th_version++; source.translation.th_text = value.th ?? ""; source.translation.entered_en = value.en ?? ""; } } }

  await page.context().addCookies([{ name: "sena_local_persona", value: "admin", url: origin }]);
  await page.route("**/api/hub/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace(api, ""), method = route.request().method();
    const done = (data: unknown) => route.fulfill({ json: { data } });
    if (url.pathname.endsWith("/v1/me")) return done(account);
    if (path === "accounts/display-names") return done([]);
    if (method === "GET") { reads.push(path); const wait = gates.get(path); if (wait) { wait.seen++; await wait.promise; } if (failedReads.has(path)) return route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "Synthetic reload failure" } } }); }
    const writing = path.match(/^content\/writing-aid\/([^/]+)(\/proposals)?$/);
    if (writing) {
      const source = sources.find(row => row.translation.id === writing[1]); expect(source, "Exact persisted translation identity").toBeTruthy();
      if (method === "GET") return done(state(source!.translation));
      const body = route.request().postDataJSON(); calls.push({ path, method, body });
      if (ambiguous) return route.abort("failed");
      const translation = source!.translation, value = source!.value()[body.language] ?? "";
      const result = { id: body.request_id, translation_id: translation.id, source_revision: translation.revision, language: body.language, mode: body.mode, context: body.context,
        status: "done" as const, error_code: null, synthetic: true, model: "stub-writing-v1", input_tokens: 0, output_tokens: 0, elapsed_ms: 1, completed_at: stamp,
        proposal: { before: value, after: (body.mode === "draft" ? body.context.map((ref: { translation_id: string }) => sources.find(row => row.translation.id === ref.translation_id)!.value()[body.language]).join(" ") : value).trim(), source: { translation_id: translation.id, revision: translation.revision, th_version: translation.th_version, owner_type: translation.owner_type, owner_key: translation.owner_key, field_key: translation.field_key, row_ref: {} }, acceptance: "ordinary_draft_save" } };
      const { proposal, ...record } = result;
      requestStates.set(translation.id, [record, ...(requestStates.get(translation.id) ?? [])]);
      return done(result);
    }
    if (path === "content-workflow/items") return done({ scope: { level: url.searchParams.get("level"), id: url.searchParams.get("id"), phase: rem }, items: [], next_cursor: null });
    if (path === "content-workflow" && method === "GET") {
      const kind = url.searchParams.get("kind"), identity = JSON.parse(url.searchParams.get("identity")!);
      const source = ["faq", "article"].includes(kind!) || identity.id === ids.businessSection ? "knowledge" : kind === "brand" ? "brands" : "projects";
      return done({ kind, identity, source_tab: source, source_tabs: [source], source_revision: 4, source_updated_at: project.updated_at,
        expected_hash: "a".repeat(64), state: "DRAFT", version_id: null, version_no: null, approved_by: null, approved_at: null, self_approval: false, history: [], needs_reapproval: false,
        can_edit: options.edit !== false, can_submit: options.edit !== false, can_approve: false, can_return: false, can_withdraw: false, can_save_approve: false, approval_requires_reason: false });
    }
    if (method !== "GET") {
      const body = route.request().postDataJSON(); calls.push({ path, method, body });
      if (stale) return route.fulfill({ status: 409, json: { error: { code: "stale", message: text.stale_item } } });
      if (path.startsWith("content/fields/") && method === "PATCH") { const item = catalog.items.find((row: any) => row.field_key === decodeURIComponent(path.slice("content/fields/".length))); Object.assign(item, body.changes); item.revision++; return done(item); }
      if (path === "projects/" + publicId && method === "PATCH") Object.assign(project, body, { updated_at: nextStamp });
      else if (path === "brands/" + brandId && method === "PATCH") Object.assign(brand, body, { updated_at: nextStamp });
      else if (path === `projects/${publicId}/sections/section.concept_detail` && method === "PUT") { Object.assign(section.version, body.changes); section.revision++; }
      else if (path === `content/businesses/${business}/sections/section.concept_detail` && method === "PUT") { Object.assign(businessSection.version, body.changes); businessSection.revision++; }
      else if (path === `projects/${publicId}/selling-points/${ids.point}` && method === "PUT") { Object.assign(point, body.changes); point.revision++; }
      else if (path === `projects/${publicId}/commercial-types/${typeId}` && method === "PATCH") { Object.assign(unitType, body); project.updated_at = nextStamp; }
      else if (path === `projects/${publicId}/amenities/facilities/pool` && method === "PUT") { Object.assign(facility, body.changes); facility.revision++; }
      else if (path === `projects/${publicId}/facilities/pool` && method === "PUT") { Object.assign(facility, body); project.updated_at = nextStamp; }
      else if (path === "faq/" + ids.faq && method === "PUT") { Object.assign(faq.version, body.changes); faq.revision++; }
      else if (path === "articles/" + ids.article && method === "PUT") { Object.assign(article.version, body.content, { blocks: { th: body.content.blocks, en: article.version.blocks.en } }); article.revision++; }
      else return route.fulfill({ status: 500, json: { error: { code: "unexpected_test_write", message: path } } });
      sync(); return done(path.startsWith("brands/") ? brand : project);
    }
    if (path === "content/fields") return done(catalog);
    if (path === `content/workspace/project/${publicId}`) return done(workspaceProjection(project));
    if (path === `content/workspace/brand/${brandId}`) return done(workspaceProjection(brand, "brand"));
    if (path === `content/workspace/business/${business}`) return done({ entity: { kind: "business", ref: business, name: { th: "Synthetic business" }, scope_type: "business", scope_id: business }, tabs: ["overview", "data", "faq", "history"], phases: [], selected_phase: null, sections: [], overview: { readiness: { required: [], recommended: [] }, tasks: [], changes_since_publication: [] } });
    if ([`content/workspace/project/${publicId}/history`, `content/workspace/brand/${brandId}/history`].includes(path)) return done({ items: [], next_cursor: null });
    if (path === `projects/${publicId}/content`) return done(content);
    if (path === `projects/${publicId}/content/website`) return done([]);
    if (path === `brands/${brandId}/content`) return done(brandContent);
    if (path === `content/businesses/${business}/content`) return done(businessContent);
    if (path === `projects/${publicId}` || path === `projects/${publicId}/commercial-types`) return done(project);
    if (path === `brands/${brandId}`) return done(brand);
    if (path === "projects") return done([project]);
    if (path === "brands") return done([brand]);
    if ([`projects/${publicId}/versions`, `brands/${brandId}/versions`].includes(path)) return done([]);
    if (path === `projects/${publicId}/unit-types`) return done(unit);
    if (path === `projects/${publicId}/amenities`) return done(amenities);
    if (path === "faq/questions") return done({ items: [question], topics: [{ code: question.topic, label: { th: "Synthetic topic" } }], translations: [] });
    if (path === "faq/references") return done({ projects: [{ id: rem, name: "Synthetic project" }], brands: [], businesses: [], groups: [], unit_types: [] });
    if (path === "faq/corporate-contacts") return done([]);
    if (path === "faq/" + ids.faq) return done(faq);
    if (path === "faq") return done({ items: [faq] });
    if (path === "articles/references") return done({ categories: [{ code: article.category, label: { th: "Synthetic category" } }], images: [], projects: [], brands: [], programmes: [], videos: [], questions: [] });
    if (path === "articles/" + ids.article) return done(article);
    if (path === "articles") return done({ items: [], total: 0, offset: 0, limit: 25 });
    return route.fallback();
  });
  return { project, brand, content, unitType, facility, faq, article, question, catalog, calls, reads, sources, businessSection, requestStates,
    stale: () => { stale = true; }, ambiguous: () => { ambiguous = true; }, failRead: (path: string) => failedReads.add(path),
    revoke: () => { account.capabilities.tabs.projects = { view: false, edit: false, approve: false }; }, holdRead: (path: string) => { const value = gate(); gates.set(path, value); return value; },
    visit: async (path: string) => { await page.goto(path); await refreshSyntheticAuthority(page); } };
}
const control = (page: Page, field: string, language = "th") => page.locator(`[data-writing-field="${field}"][data-writing-language="${language}"]:visible`).first();
async function propose(root: Locator, mode: "draft" | "shorten" | "proofread" = "shorten") {
  await root.getByRole("button", { name: text[mode], exact: true }).click();
  await expect(root.locator(".writing-aid-review")).toBeVisible();
}
const ordinary = (calls: Call[]) => calls.filter(call => !call.path.startsWith("content/writing-aid/"));

for (const item of [
  { key: "project.meta_title", path: projectPath("tab=data&section=supplementary"), target: `projects/${publicId}`, locale: "th", stamp: { updated_at: stamp }, property: "meta_title" },
  { key: "project.meta_description", path: projectPath("tab=data&section=supplementary"), target: `projects/${publicId}`, locale: "en", stamp: { updated_at: stamp }, property: "meta_description" },
  { key: "brand.description", path: `/website/brand/${brandId}?tab=data`, target: `brands/${brandId}`, locale: "en", stamp: { updated_at: stamp }, property: "description" },
  { key: "section.concept_detail", path: projectPath("tab=data&section=narrative"), target: `projects/${publicId}/sections/section.concept_detail`, locale: "th", stamp: { expected_revision: 4 }, property: "body" },
  { key: "selling_point.detail", path: projectPath("tab=data&section=narrative"), target: `projects/${publicId}/selling-points/${ids.point}`, locale: "en", stamp: { expected_revision: 4 }, property: "detail" },
  { key: "commercial_type.highlights", path: projectPath("tab=unit-types&unit_type=" + typeId + "&field=commercial_type.highlights"), target: `projects/${publicId}/commercial-types/${typeId}`, locale: "th", stamp: { updated_at: stamp }, property: "highlights" },
  { key: "facility.description", path: projectPath("tab=data&section=facilities"), target: `projects/${publicId}/amenities/facilities/pool`, locale: "en", stamp: { expected_revision: 4 }, property: "description" },
  { key: "facility.description", path: projectPath("tab=data&section=supplementary"), target: `projects/${publicId}/facilities/pool`, locale: "th", stamp: { updated_at: stamp }, property: "description" },
  { key: "faq.short_answer", path: projectPath("tab=faq&faq=" + ids.faq), target: "faq/" + ids.faq, locale: "th", stamp: { expected_revision: 4 }, property: "short_answer" },
  { key: "article.excerpt", path: "/articles?article=" + ids.article, target: "articles/" + ids.article, locale: "en", stamp: { expected_revision: 4 }, property: "excerpt" },
  { key: "section.concept_detail", path: `/website/business/${business}?tab=data&section=narrative`, target: `content/businesses/${business}/sections/section.concept_detail`, locale: "en", stamp: { expected_revision: 4 }, property: "body" },
]) test(item.key + " uses the exact saved ordinary writer and preserves the other locale at " + item.target, async ({ page }) => {
  const value = await fixture(page); await value.visit(item.path);
  const current = control(page, item.key, item.locale); await propose(current);
  expect(ordinary(value.calls)).toEqual([]);
  await expect(current).toContainText("20.5"); await expect(current).toContainText("{project}");
  await current.getByRole("button", { name: text.writing_accept, exact: true }).click();
  await expect.poll(() => ordinary(value.calls).length).toBe(1);
  const write = ordinary(value.calls)[0]; expect(write.path).toBe(item.target); expect(write.body).toMatchObject(item.stamp);
  const changes = write.body.changes ?? write.body.content ?? write.body;
  expect(changes[item.property]).toEqual(item.locale === "th" ? { th: before.trim(), en: beforeEn } : { th: before, en: beforeEn.trim() });
  if (item.target === `projects/${publicId}` || item.target === `brands/${brandId}` || item.target.endsWith("commercial-types/" + typeId)) expect(Object.keys(write.body).sort()).toEqual([item.property, "updated_at"].sort());
  if (item.key === "article.excerpt") { expect(changes.blocks).toEqual(value.article.version.blocks.th); expect(changes.links).toEqual([]); }
  await expect(current.locator(".writing-aid-review")).toHaveCount(0);
  expect(value.calls.some(call => /submit|approve|publish/.test(call.path))).toBe(false);
});

test("default-off fields and hard-excluded registry entries expose no writing controls", async ({ page }) => {
  const value = await fixture(page, { enabled: false }); await value.visit(projectPath("tab=data&section=supplementary"));
  await expect(page.locator("[data-writing-field]")).toHaveCount(0); expect(value.reads.some(path => path.startsWith("content/writing-aid/"))).toBe(false);
  await value.visit("/settings?section=fields");
  const forbidden = page.locator("article.content-card").filter({ has: page.getByRole("heading", { name: "Synthetic project.public_name", exact: true }) });
  await forbidden.locator(".content-toolbar > button").click();
  await expect(forbidden.getByLabel(text.writing_enabled, { exact: true })).toHaveCount(0);
  expect(ordinary(value.calls)).toEqual([]);
});

test("registry opt-in uses its original revision and makes zero-budget stub controls available", async ({ page }) => {
  const value = await fixture(page, { enabled: false }); await value.visit("/settings?section=fields");
  const row = page.locator("article.content-card").filter({ has: page.getByRole("heading", { name: "Synthetic project.meta_title", exact: true }) });
  await row.locator(".content-toolbar > button").click(); await row.getByLabel(text.writing_enabled, { exact: true }).check();
  await row.locator("form button.primary").click(); await expect.poll(() => ordinary(value.calls).length).toBe(1);
  expect(ordinary(value.calls)[0]).toMatchObject({ method: "PATCH", path: "content/fields/project.meta_title", body: { expected_revision: 4, changes: { ai_writing_enabled: true } } });
  await value.visit(projectPath("tab=data&section=supplementary")); await propose(control(page, "project.meta_title"));
  await control(page, "project.meta_title").getByRole("button", { name: text.writing_reject, exact: true }).click();
  expect(ordinary(value.calls)).toHaveLength(1);
});

test("review and acceptance keep ordinary inputs and peers locked through both reloads", async ({ page }) => {
  const value = await fixture(page); await value.visit(projectPath("tab=data&section=supplementary"));
  const current = control(page, "project.meta_title"), peer = control(page, "project.meta_description"); await propose(current);
  await expect(page.locator("#meta_title")).toBeDisabled();
  await expect(peer.getByRole("button", { name: text.shorten, exact: true })).toBeDisabled();
  await expect(current.getByRole("button", { name: text.writing_accept, exact: true })).toBeEnabled();
  const translationReload = value.holdRead(`projects/${publicId}/content`), sourceReload = value.holdRead(`projects/${publicId}`);
  try {
    await current.getByRole("button", { name: text.writing_accept, exact: true }).click();
    await expect.poll(() => translationReload.seen).toBeGreaterThan(0); await expect(page.locator("#meta_title")).toBeDisabled();
    translationReload.release(); await expect.poll(() => sourceReload.seen).toBeGreaterThan(0); await expect(page.locator("#meta_title")).toBeDisabled();
    sourceReload.release(); await expect(page.locator("#meta_title")).toBeEnabled();
    await expect(page.locator("#meta_title")).toHaveValue(before.trim()); expect(ordinary(value.calls)).toHaveLength(1);
  } finally { translationReload.release(); sourceReload.release(); }
});

test("an ordinary conflict preserves the proposal and source; refresh never resubmits", async ({ page }) => {
  const value = await fixture(page); await value.visit(projectPath("tab=data&section=supplementary"));
  const current = control(page, "project.meta_title"); await propose(current); value.stale();
  await current.getByRole("button", { name: text.writing_accept, exact: true }).click();
  await expect(current).toContainText(text.stale_item); await expect(current.locator(".writing-aid-review")).toBeVisible();
  await expect(page.locator("#meta_title")).toHaveValue(before); expect(ordinary(value.calls)).toHaveLength(1);
  await current.getByRole("button", { name: text.refresh, exact: true }).click();
  await expect(current.locator(".writing-aid-review")).toBeVisible(); expect(ordinary(value.calls)).toHaveLength(1);
  await current.getByRole("button", { name: text.writing_reject, exact: true }).click();
  await expect(page.locator("#meta_title")).toBeEnabled(); expect(ordinary(value.calls)).toHaveLength(1);
});

test("unsaved ordinary text blocks all writing requests and leaves the draft untouched", async ({ page }) => {
  const value = await fixture(page); await value.visit(projectPath("tab=data&section=supplementary"));
  await page.locator("#meta_title").fill("Unsaved exact draft 20.5 {project}");
  const current = control(page, "project.meta_title"); await expect(current).toContainText(text.writing_unsaved);
  for (const mode of ["draft", "proofread", "shorten"] as const) await expect(current.getByRole("button", { name: text[mode], exact: true })).toBeDisabled();
  expect(value.calls).toEqual([]); await expect(page.locator("#meta_title")).toHaveValue("Unsaved exact draft 20.5 {project}");
});

test("draft mode carries only the finite nonempty eligible context identities", async ({ page }) => {
  const value = await fixture(page); value.project.meta_title = { th: "", en: "" }; value.sources[0].translation.th_text = ""; value.sources[0].translation.entered_en = "";
  await value.visit(projectPath("tab=data&section=supplementary")); const current = control(page, "project.meta_title");
  await expect(current.getByRole("button", { name: text.proofread, exact: true })).toBeDisabled(); await expect(current.getByRole("button", { name: text.shorten, exact: true })).toBeDisabled();
  await propose(current, "draft");
  expect(value.calls[0].body).toMatchObject({ expected_revision: 4, language: "th", mode: "draft", context: [{ translation_id: value.sources[1].translation.id, expected_revision: 4 }] });
  expect(Object.keys(value.calls[0].body).sort()).toEqual(["context", "expected_revision", "language", "mode", "request_id"]);
  await current.getByRole("button", { name: text.writing_reject, exact: true }).click(); expect(ordinary(value.calls)).toEqual([]);
});

test("empty context disables drafting while existing text remains proofreadable", async ({ page }) => {
  const value = await fixture(page); await value.visit(`/website/brand/${brandId}?tab=data`); const current = control(page, "brand.description");
  await expect(current.getByRole("button", { name: text.draft, exact: true })).toBeDisabled();
  await expect(current.getByRole("button", { name: text.proofread, exact: true })).toBeEnabled();
});

test("an ambiguous proposal never retries automatically or writes source content", async ({ page }) => {
  const value = await fixture(page); value.ambiguous(); await value.visit(projectPath("tab=data&section=supplementary")); const current = control(page, "project.meta_title");
  await current.getByRole("button", { name: text.shorten, exact: true }).click(); await expect(current).toContainText(text.writing_ambiguous);
  await current.getByRole("button", { name: text.refresh, exact: true }).click(); await expect.poll(() => value.reads.filter(path => path.startsWith("content/writing-aid/")).length).toBeGreaterThan(1);
  expect(value.calls).toHaveLength(1); expect(ordinary(value.calls)).toEqual([]);
});

for (const scenario of ["read-only", "budget", "prohibited-topic"] as const) test(scenario + " prevents proposals in the actual field editor", async ({ page }) => {
  const value = await fixture(page, scenario === "read-only" ? { edit: false } : scenario === "budget" ? { budget: true } : { topic: "legal" });
  await value.visit(scenario === "prohibited-topic" ? projectPath("tab=faq&faq=" + ids.faq) : projectPath("tab=data&section=supplementary"));
  if (scenario === "budget") await expect(control(page, "project.meta_title").getByRole("button", { name: text.shorten, exact: true })).toBeDisabled();
  else if (scenario === "prohibited-topic") {
    const editor = page.locator('.entity-embedded-faq');
    await expect(editor.getByRole('heading', { name: before.trim(), exact: true })).toBeVisible();
    await expect(editor.locator('[data-writing-field]')).toHaveCount(0);
  }
  else await expect(page.locator("[data-writing-field]")).toHaveCount(0);
  expect(value.calls).toEqual([]);
});

test("writing review retains visible keyboard focus and fits both supported widths", async ({ page }) => {
  const value = await fixture(page); await value.visit(projectPath("tab=data&section=supplementary")); const current = control(page, "project.meta_title"); await propose(current);
  await expect(current.locator(".writing-aid-review")).toBeFocused(); await fitsWorkspace(page);
  await page.screenshot({ path: `artifacts/unified-workspace/w7/field-review-${page.viewportSize()?.width}.png`, fullPage: true });
  await current.getByRole("button", { name: text.writing_reject, exact: true }).click();
  await expect(current.getByRole("button", { name: text.shorten, exact: true })).toBeFocused();
  expect(ordinary(value.calls)).toEqual([]);
});


test("successful save with a failed later reload retains a stale diff and never repeats the writer", async ({ page }) => {
  const value = await fixture(page); await value.visit(projectPath("tab=data&section=supplementary"));
  const current = control(page, "project.meta_title"); await propose(current);
  value.failRead(`projects/${publicId}`);
  await current.getByRole("button", { name: text.writing_accept, exact: true }).click();
  await expect(current).toContainText(text.writing_save_failed);
  await expect(current.locator(".writing-aid-review")).toBeVisible();
  expect(value.project.meta_title.th).toBe(before.trim());
  await expect(page.locator("#meta_title")).toHaveValue(before);
  await expect(page.locator("#meta_title")).toBeDisabled();
  expect(ordinary(value.calls)).toHaveLength(1);
  await current.getByRole("button", { name: text.refresh, exact: true }).click();
  await expect(current).toContainText(text.stale_item);
  await expect(current.getByRole("button", { name: text.writing_accept, exact: true })).toBeDisabled();
  expect(ordinary(value.calls)).toHaveLength(1);
});

test("authority loss during an acceptance reload immediately removes the retained diff", async ({ page }) => {
  const value = await fixture(page); await value.visit(projectPath("tab=data&section=supplementary"));
  const current = control(page, "project.meta_title"); await propose(current);
  const wait = value.holdRead(`projects/${publicId}`);
  try {
    await current.getByRole("button", { name: text.writing_accept, exact: true }).click();
    await expect.poll(() => wait.seen).toBeGreaterThan(0);
    value.revoke(); await refreshSyntheticAuthority(page);
    await expect(page.locator(".writing-aid-review")).toHaveCount(0);
    await expect(page.locator("[data-writing-field]")).toHaveCount(0);
    expect(ordinary(value.calls)).toHaveLength(1);
    wait.release(); await expect(page.locator(".writing-aid-review")).toHaveCount(0);
  } finally { wait.release(); }
});

test("a fresh server eligibility denial hides a held proposal without an ordinary write", async ({ page }) => {
  const value = await fixture(page); await value.visit(projectPath("tab=data&section=supplementary"));
  const current = control(page, "project.meta_title"); await propose(current);
  value.catalog.items.find((field: any) => field.field_key === "project.meta_title").ai_writing_enabled = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(current.locator(".writing-aid-review")).toHaveCount(0);
  expect(ordinary(value.calls)).toEqual([]);
});


test("the saved inline unit description uses its parent stamp without normalizing unrelated fields", async ({ page }) => {
  const value = await fixture(page); await value.visit(projectPath("tab=unit-types"));
  await page.locator(`[aria-controls="ct-detail-${typeId}"]`).click();
  const current = control(page, "commercial_type.description", "en"); await propose(current);
  await current.getByRole("button", { name: text.writing_accept, exact: true }).click();
  await expect.poll(() => ordinary(value.calls).length).toBe(1);
  expect(ordinary(value.calls)[0]).toEqual({ path: `projects/${publicId}/commercial-types/${typeId}`, method: "PATCH", body: { updated_at: stamp, description: { th: before, en: beforeEn.trim() } } });
  await expect(current.locator(".writing-aid-review")).toHaveCount(0);
  expect(value.unitType.source_notes).toBe("  Preserve spacing  "); expect(value.unitType.highlights).toEqual(loc());
});


for (const leave of [false, true]) test("delayed acceptance state read " + (leave ? "cannot save after its field unmounts" : "still permits the mounted ordinary writer"), async ({ page }) => {
  const value = await fixture(page); await value.visit(projectPath("tab=history"));
  await expect(page.locator("#workspace-tab-history")).toHaveAttribute("aria-selected", "true");
  // The workspace uses the native history API for same-document tab changes.
  await page.evaluate(path => history.pushState(null, "", path), projectPath("tab=faq&faq=" + ids.faq));
  const current = control(page, "faq.short_answer"); await propose(current);
  const source = value.sources.find(row => row.translation.owner_type === "faq" && row.translation.field_key === "faq.short_answer")!;
  const path = "content/writing-aid/" + source.translation.id;
  const wait = value.holdRead(path);
  const response = page.waitForResponse(item => item.url().endsWith(api + path) && item.request().method() === "GET");
  page.on("dialog", dialog => dialog.accept());
  try {
    await current.getByRole("button", { name: text.writing_accept, exact: true }).click();
    await expect.poll(() => wait.seen).toBeGreaterThan(0);
    expect(ordinary(value.calls)).toEqual([]);
    if (leave) {
      await page.evaluate(() => { (window as Window & { writingUnmountSentinel?: boolean }).writingUnmountSentinel = true; });
      await page.goBack();
      await expect(page.locator("#workspace-tab-history")).toHaveAttribute("aria-selected", "true");
      await expect(page.locator('[data-writing-field="faq.short_answer"]')).toHaveCount(0);
      expect(await page.evaluate(() => (window as Window & { writingUnmountSentinel?: boolean }).writingUnmountSentinel)).toBe(true);
    }
    wait.release(); await (await response).finished();
    // Let the released fetch and its acceptance continuation finish in this document.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    if (leave) {
      expect(ordinary(value.calls)).toEqual([]);
      expect(value.faq.version.short_answer.th).toBe(before);
    } else {
      await expect.poll(() => ordinary(value.calls).length).toBe(1);
      expect(ordinary(value.calls)[0]).toMatchObject({ path: "faq/" + ids.faq, method: "PUT", body: { expected_revision: 4 } });
      await expect(current.locator(".writing-aid-review")).toHaveCount(0);
      expect(value.faq.version.short_answer.th).toBe(before.trim());
    }
  } finally { wait.release(); }
});

for (const fieldKey of ["section.concept_detail", "selling_point.detail", "faq.short_answer"]) test("in-review source keeps writing disabled: " + fieldKey, async ({ page }) => {
  const value = await fixture(page);
  const source = fieldKey.startsWith("faq.") ? value.faq : fieldKey.startsWith("section.") ? value.content.sections[0] : value.content.selling_points[0];
  source.state = "IN_REVIEW";
  if (source.version) source.version.state = "IN_REVIEW";
  // Even a stale editable translation projection must not override the source freeze.
  await value.visit(projectPath(fieldKey.startsWith("faq.") ? "tab=faq&faq=" + ids.faq : "tab=data&section=narrative"));
  const current = control(page, fieldKey);
  await expect(current).toBeVisible();
  await expect(current).toHaveAttribute("aria-busy", "false");
  for (const mode of ["draft", "proofread", "shorten"] as const) {
    await expect(current.getByRole("button", { name: text[mode], exact: true })).toBeDisabled();
  }
  expect(value.calls).toEqual([]);
});


function requestRecord(translation: any, status: WritingRequestStatus['status'], id = uuid(701)): WritingRequestStatus {
  return { id, translation_id: translation.id, source_revision: translation.revision, language: "th", mode: "shorten", context: [], status,
    error_code: null, synthetic: true, model: "stub-writing-v1", input_tokens: 0, output_tokens: 0, elapsed_ms: null, completed_at: null };
}

test("an interrupted request permits a new explicit attempt without refresh retry or source save", async ({ page }) => {
  const value = await fixture(page), source = value.sources[0].translation;
  value.requestStates.set(source.id, [requestRecord(source, "ambiguous")]);
  await value.visit(projectPath("tab=data&section=supplementary"));
  const current = control(page, "project.meta_title"), path = "content/writing-aid/" + source.id;
  await expect(current).toContainText(text.writing_ambiguous);
  for (const mode of ["proofread", "shorten"] as const) await expect(current.getByRole("button", { name: text[mode], exact: true })).toBeEnabled();
  const reads = value.reads.filter(item => item === path).length;
  await current.getByRole("button", { name: text.refresh, exact: true }).click();
  await expect.poll(() => value.reads.filter(item => item === path).length).toBeGreaterThan(reads);
  await expect(current).toHaveAttribute("aria-busy", "false");
  expect(value.calls).toEqual([]);
  await propose(current);
  expect(value.calls).toHaveLength(1);
  expect(value.calls[0].body.request_id).not.toBe(uuid(701));
  expect(ordinary(value.calls)).toEqual([]);
  await expect.poll(() => value.reads.filter(item => item === path).length).toBeGreaterThan(reads + 1);
  await current.getByRole("button", { name: text.writing_reject, exact: true }).click();
  await expect(current).not.toContainText(text.writing_ambiguous);
  await expect(current.getByRole("button", { name: text.shorten, exact: true })).toBeEnabled();
  expect(value.requestStates.get(source.id)!.map(item => item.status)).toEqual(["done", "ambiguous"]);
  expect(value.project.meta_title.th).toBe(before);
  expect(ordinary(value.calls)).toEqual([]);
});

test("any fresh running request keeps the field busy even beside an unknown outcome", async ({ page }) => {
  const value = await fixture(page), source = value.sources[0].translation;
  value.requestStates.set(source.id, [requestRecord(source, "ambiguous"), requestRecord(source, "running", uuid(702))]);
  await value.visit(projectPath("tab=data&section=supplementary"));
  const current = control(page, "project.meta_title");
  await expect(current).toContainText(text.writing_processing);
  for (const mode of ["draft", "proofread", "shorten"] as const) await expect(current.getByRole("button", { name: text[mode], exact: true })).toBeDisabled();
  expect(value.calls).toEqual([]);
});

test("a previous source revision's pending or unknown requests do not block the current revision", async ({ page }) => {
  const value = await fixture(page), source = value.sources[0].translation;
  value.requestStates.set(source.id, ["running", "ambiguous"].map((status, index) =>
    ({ ...requestRecord(source, status as WritingRequestStatus['status'], uuid(701 + index)), source_revision: source.revision - 1 })));
  await value.visit(projectPath("tab=data&section=supplementary"));
  const current = control(page, "project.meta_title");
  await expect(current).toHaveAttribute("aria-busy", "false");
  await expect(current).not.toContainText(text.writing_ambiguous);
  await expect(current).not.toContainText(text.writing_processing);
  await expect(current.getByRole("button", { name: text.shorten, exact: true })).toBeEnabled();
  expect(value.calls).toEqual([]);
});


test("a supporting section changed after the diff blocks ordinary draft acceptance", async ({ page }) => {
  const value = await fixture(page), target = value.content.sections[0];
  const targetSource = value.sources.find(row => row.translation.owner_key === target.id)!;
  const supporting = { ...structuredClone(target), id: uuid(900), section_key: "section.location_summary" };
  const context = { ...structuredClone(targetSource.translation), id: uuid(901), owner_key: supporting.id, field_key: supporting.section_key };
  value.content.sections.push(supporting); value.content.translations.push(context);
  value.catalog.items.push(field(supporting.section_key));
  value.sources.push({ translation: context, value: () => supporting.version.body });
  await value.visit(projectPath("tab=data&section=narrative"));
  const current = control(page, "section.concept_detail"); await propose(current, "draft");
  expect(value.calls).toHaveLength(1);
  expect(value.calls[0].body.context).toEqual([{ translation_id: context.id, expected_revision: 4 }]);
  const path = "content/writing-aid/" + context.id, reads = value.reads.filter(item => item === path).length;
  supporting.version.body.th = "Changed supporting section 20.5 {project} 20.5";
  supporting.revision++; context.revision++; context.th_version++; context.th_text = supporting.version.body.th;
  await current.getByRole("button", { name: text.writing_accept, exact: true }).click();
  await expect.poll(() => value.reads.filter(item => item === path).length).toBeGreaterThan(reads);
  await expect(current).toContainText(text.stale_item);
  await expect(current.locator(".writing-aid-review")).toBeVisible();
  expect(ordinary(value.calls)).toEqual([]); expect(value.calls).toHaveLength(1);
  expect(target.revision).toBe(4); expect(target.version.body.th).toBe(before);
});
