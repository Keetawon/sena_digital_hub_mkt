import { expect, test, type Page, type Locator } from "@playwright/test";
import { emptyCapabilities, type HubAccount } from "../../apps/admin/lib/hub-permissions";
import { workflowText as text, type WorkflowKind, type WorkflowTarget } from "../../apps/admin/lib/content-workflow";
import { fulfilWorkspaceProjection, fitsWorkspace } from "./unified-workspace-helpers";

import { refreshSyntheticAuthority } from "./content-workflow-fixtures";

const origin = "http://127.0.0.1:3000", api = "/api/hub/v1/admin/", stamp = "2026-11-04T09:00:00+00:00", hash = "a".repeat(64);
const uuid = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const ids = { project: uuid(1), brand: uuid(2), type: uuid(3), price: uuid(4), disclosure: uuid(5), sales_term: uuid(6), programme: uuid(7), progress: uuid(8), feature: uuid(9), solar: uuid(10), place: uuid(11), asset: uuid(12), project_asset: uuid(13), brand_asset: uuid(14), type_asset: uuid(15), asset_context: uuid(16), media_link: uuid(17), media_target: uuid(18), faq: uuid(19), article: uuid(20), page_config: uuid(21) };
const loc = (value: string) => ({ th: value, en: value });
const publicId = "prj_workflow", publicType = "ctyp_workflow", pageKey = `project:${publicId}`, rem = "REM-EXACT";
type Call = { path: string; method: string; body: Record<string, unknown> };
function fixture() {
  const asset = { id: ids.asset, original_filename: "synthetic.pdf", mime_type: "application/pdf", public_url: null, checksum: "b".repeat(64), file_size: 100, width: null, height: null, rights_status: "approved", rights_notes: "Synthetic rights", updated_at: stamp, effective_from: null, effective_to: null, reviewed_by: null, reviewed_at: stamp, review_reason: "Checked", storage_path: null,
    media_revision: 4, media_category: "exterior", caption: loc("Saved caption"), alt_text: loc("Saved alternative"), image_kind: "photo", taken_at: null, people: "none", third_party_marks: "none", credit: {}, tags: [], metadata_state: "confirmed", ai_exposure: "open", marketing_publication: false, ai_suggestion: null };
  const bound = { ...asset, binding_id: ids.project_asset, asset_role: "brochure", display_order: 0 };
  const facility = { code: "pool", facility_code: "pool", project_id: ids.project, revision: 4, name_th: "Synthetic pool", name_en: "Synthetic pool", required: false, status: "present", description: loc("Saved pool"), location_note: "", access_note: "", evidence_note: "", expected_open_date: null, updated_at: stamp, updated_by: null, display_name: loc("Synthetic pool"), location_label: {}, size_sqm: 10, opening_hours: {}, applies_to_project_ids: [], ai_exposure: "open", icon_code: "pool", group_code: "recreation" };
  const type = { id: ids.type, public_commercial_type_id: publicType, revision: 4, public_name: loc("Synthetic type"), description: loc("Saved type narrative"), highlights: {}, product_form: "house", category: "single_house", area_min_sqm: 100, area_max_sqm: 120, bedrooms: 2, bathrooms: 1, kitchens: 1, storeys: 2, parking_spaces: 1, land_area_sqm: 30, ceiling_height_m: 2.8, special_rooms: [], furniture_package: "none", price_mode: "manual", ai_exposure: "open", source_model_ids: [], source_links: [], source_notes: "", status: "draft",
    readiness: { missing: [], review_issues: [], publication_ready: false }, workflow: { ready: true, items: [], recommended: [] }, history: [], comparison: { rem_min_available: null, rem_as_of: null, groups: [] }, assets: [{ ...asset, binding_id: ids.type_asset, asset_role: "floor_plan", title: "Synthetic plan", floor_label: "1", plan_revision: "1", applicability_model_ids: [], display_order: 0 }] };
  const project = { id: ids.project, public_project_id: publicId, public_name: loc("Synthetic project"), address: {}, slug: publicId, updated_at: stamp, published_version_id: null, publication_available: false, readiness: { ready: false, percent: 0, missing: [] }, models: [], assets: [bound], commercial_types: [type], facilities: { review_status: "draft", checklist_version: 1, expected_count: 1, collected_count: 1, items: [facility], missing: [] }, source: { rem_project_id: rem, project_name_rem: "Synthetic REM", source_snapshot_at: stamp, source_updated_at: null } };
  const brand = { id: ids.brand, public_brand_id: "brd_workflow", rem_brand_id: "BRAND-EXACT", status: "active", projects: [], public_name: loc("Synthetic brand"), description: {}, slug: "synthetic-brand", updated_at: stamp, published_version_id: null, publication_available: false, readiness: { ready: false, percent: 0, missing: [] }, assets: [{ ...bound, binding_id: ids.brand_asset, asset_role: "logo_primary" }], source: { rem_brand_id: "BRAND-EXACT", brand_name_rem: "Synthetic brand" } };
  const price = { id: ids.price, revision: 4, kind: "unit_type", commercial_type_id: ids.type, amount: 1200000, basis_size_sqm: 100, display_text: loc("Synthetic price"), basis: loc("Synthetic basis"), condition_text: loc("Synthetic conditions"), valid_from: "2026-11-04", valid_to: "2026-12-01", promotion_id: null, ai_exposure: "web_only", state: "draft", readiness: { ready: true, items: [] }, comparison: type.comparison, rem_difference: false, expired: false, history: [] };
  const unit = { project, types: [type], prices: [price], translations: [], room_tags: [], tours: [], source: { models: [], groups: [] }, promotions: [] };
  const native = (id: string) => ({ id, revision: 4, state: "draft", ai_exposure: "web_only", readiness: { ready: true, items: [] }, history: [] });
  const commercial = { project, comparison: {}, translations: [], legal_documents: [], records: {
    disclosures: [{ ...native(ids.disclosure), notes: loc("Saved legal notes"), basis: "mkt_entered", title_deeds: [], land_numbers: [] }],
    "sales-terms": [{ ...native(ids.sales_term), conditions: loc("Saved sales conditions"), valid_from: "2026-11-04", valid_to: "2026-12-01" }],
    programmes: [{ ...native(ids.programme), programme_key: "LIVNEX", participating: true, monthly_from: 12000, basis: loc("Saved programme basis"), as_of: "2026-11-04" }],
    construction: [{ ...native(ids.progress), component: "overall", percent: 40, as_of: "2026-11-04", source: "mkt" }],
  } };
  const amenities = { project: { ...project, name: project.public_name }, facilities: [facility], features: [{ id: ids.feature, revision: 4, feature_code: "garden", status: "present", detail: loc("Saved feature"), metrics: {}, commercial_type_id: null, source_note: {}, ai_exposure: "open" }], solar: [{ id: ids.solar, revision: 4, system_kw: 3, battery_kwh: null, usage_profile: loc("Saved usage"), bill_before: 1000, bill_after: 500, saving_pct: 50, assumptions: loc("Synthetic assumptions"), source_note: loc("Synthetic evidence"), as_of: "2026-11-04", ai_exposure: "web_only", state: "draft" }], places: [{ id: ids.place, revision: 4, category: "park", status: "operating", name: loc("Synthetic park"), ref_id: null, distance_m: 100, distance_method: "road", travel_minutes: null, travel_mode: null, expected_open: null, as_of: "2026-11-04", show_on_web: false, sort: 0, ai_exposure: "open" }], references: { features: [{ code: "garden", label: loc("Synthetic feature"), active: true, explanation: {}, metric_defs: {} }], rail_lines: [], rail_stations: [], expressways: [], expressway_ramps: [], facilities: [] }, unit_types: [], phases: [], translations: [], nearest_stations: [], media: { assets: [], links: [], tags: [] } };
  const link = { id: ids.asset_context, asset_id: ids.asset, revision: 4, target_type: "project", target_key: ids.project, usage: "gallery", building_key: null, floor_from: null, floor_to: null, room_tag: null, is_primary: false, sort: 0 };
  const clip = { id: ids.media_link, revision: 4, provider: "youtube", kind: "walkthrough", tour_kind: null, url: "https://www.youtube.com/watch?v=synthetic", title: loc("Synthetic clip"), description: loc("Saved clip"), published_at: null, captured_at: null, duration_sec: 60, aspect: "landscape", language: "th", subtitles: [], channel_name: {}, owner_type: "sena_owned", is_sponsored: false, thumbnail_asset_id: null, is_featured: false, sort: 0, state: "DRAFT", ai_exposure: "open", targets: [{ id: ids.media_target, target_type: "project", target_key: ids.project }], link_status: "ok", visible: true };
  const media = { project: { ...project, name: project.public_name }, assets: [asset], links: [link], clips: [clip], context: { facilities: [], commercial_types: [{ key: ids.type, label: type.public_name }], buildings: [], promotions: [], selling_points: [], features: [], places: [] }, tags: [], requirements: [], checklist: { items: [], recommended_score: 100, required_missing: 0, broken_links: [], unknown_coverage: [] } };
  const question = { question_key: "synthetic_question", topic: "identity", default_level: "project", question_template: loc("Synthetic question"), alt_questions: {}, answer_kind: "text", fact_keys: [], property_types: [], is_core: false, show_on_project_pages: false, web_sort: 0, status: "approved", revision: 4, version_author: null, ai_exposure: "open" };
  const faq = { id: ids.faq, question_key: question.question_key, scope_type: "project", scope_id: rem, revision: 4, state: "DRAFT", version: { version_no: 1, question: question.question_template, alt_questions: {}, short_answer: loc("Saved answer"), detail: loc("Saved detail"), answer_kind: "text", fact_keys: [], applies_to_project_ids: [rem], applicability_rule: {}, review_due: null, effective_to: null, state: "DRAFT", ai_exposure: "open", created_at: stamp, editors: [] }, history: [], sources: [], translations: [] };
  const metadata = { slug: "synthetic-article", category: "design", cover_asset_id: null, author: {}, tags: [], ai_exposure: "web_only" }, block = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Saved body" }] }] };
  const article = { ...metadata, id: ids.article, revision: 4, state: "DRAFT", approved_version_id: null, version: { id: uuid(22), version_no: 1, state: "DRAFT", title: loc("Synthetic article"), excerpt: loc("Saved excerpt"), seo_title: {}, seo_description: {}, blocks: { th: block, en: block }, metadata, editors: [], created_at: stamp }, links: [], history: [], translations: [], readiness: [] as { code: string; label: string }[] };
  const pageConfig = { id: ids.page_config, page_key: pageKey, revision: 4, published_version_id: null, url: "/synthetic", locales: ["th"], ai_policy: "no_ai", max_faq_items: 20, project_ids: [publicId] };
  return { project, brand, type, price, unit, commercial, amenities, media, question, faq, article, pageConfig };
}

type Gate = { promise: Promise<void>; release: () => void; seen: number };
function gate(): Gate {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release, seen: 0 };
}
async function mock(page: Page) {
  const value = fixture(), calls: Call[] = [], reads: string[] = [], readGates = new Map<string, Gate>();
  const account: HubAccount = { id: uuid(99), status: "ACTIVE", hub_role: "admin", display_name_th: "Synthetic reviewer", capabilities: {
    ...emptyCapabilities, published_consumer: true,
    tabs: Object.fromEntries(["projects", "brands", "knowledge", "releases"].map(tab => [tab, { view: true, edit: true, approve: true }])),
    special_actions: { "knowledge.publish_web": true },
  } };
  let commandGate: Gate | null = null, retryGate: Gate | null = null, stale = false, currentHash = hash, currentRevision = 4;
  const translations = [{ id: uuid(80), owner_type: "question", owner_key: "synthetic_question", field_key: "question.question_template",
    revision: 4, th_version: 4, th_text: "Synthetic English source", entered_en: null, machine_en: null, reviewed_en: null,
    translation_state: "missing", editable: true, job: { status: "failed", error_code: "temporary", model: null, completed_at: null } }];
  let showTranslation = false;
  const snapshot = (target: WorkflowTarget) => {
    const source = ["faq", "question", "glossary", "article"].includes(target.kind) ? "knowledge" : target.kind === "brand_asset" ? "brands" : "projects";
    return { ...target, source_tab: source, source_tabs: [source], source_revision: currentRevision, source_updated_at: stamp,
      expected_hash: currentHash, state: "DRAFT", version_id: null, version_no: null, approved_by: null, approved_at: null,
      decision_reason: null, self_approval: false, history: [], needs_reapproval: false, can_edit: true, can_submit: true,
      can_approve: false, can_return: false, can_withdraw: false, can_save_approve: true, approval_requires_reason: true };
  };
  await page.context().addCookies([{ name: "sena_local_persona", value: "admin", url: origin }]);
  await page.route("**/api/hub/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace(api, ""), method = route.request().method();
    const done = (data: unknown) => route.fulfill({ json: { data } });
    if (url.pathname.endsWith("/v1/me")) return done(account);
    if (url.pathname.endsWith("/accounts/display-names")) return done([]);
    if (method === "GET") {
      reads.push(path);
      const wait = readGates.get(path); if (wait) { wait.seen++; await wait.promise; }
    }
    if (path === "content-workflow/items") return done({ scope: { level: url.searchParams.get("level"), id: url.searchParams.get("id"), phase: rem }, items: [], next_cursor: null });
    if (path === "content-workflow" && method === "GET") return done(snapshot({ kind: url.searchParams.get("kind"), identity: JSON.parse(url.searchParams.get("identity")!) } as WorkflowTarget));
    if (method !== "GET") {
      const body = route.request().postDataJSON(); calls.push({ path, method, body });
      if (path.startsWith("content-workflow/")) {
        if (commandGate) { commandGate.seen++; await commandGate.promise; }
        if (stale) return route.fulfill({ status: 409, json: { error: { code: "stale_revision", message: text.stale_item } } });
        return done({ ...snapshot(body), state: "IN_REVIEW", can_submit: false });
      }
      if (path === "content/translations/" + uuid(80) + "/retry") {
        if (retryGate) { retryGate.seen++; await retryGate.promise; }
        return done({});
      }
      return route.fulfill({ status: 500, json: { error: { code: "unexpected_test_write", message: path } } });
    }
    if (path === "content/fields") return done({ items: [], can_manage: false });
    if (path === "content/glossary") return done([{ term_key: "synthetic.term", term: loc("Synthetic term"), revision: 4, status: "proposed", version_author: null }]);
    if (path === "faq/questions") return done({ items: [value.question], topics: [{ code: "identity", label: loc("Identity") }], translations: showTranslation ? translations : [] });
    if (path === "faq/references") return done({ projects: [{ id: rem, name: "Synthetic project" }], brands: [], groups: [], unit_types: [] });
    if (path === "faq/corporate-contacts") return done([]);
    if (path === "faq/" + ids.faq) return done(value.faq);
    if (path === "faq") return done({ items: [value.faq] });
    if (path === "articles/references") return done({ categories: [{ code: "design", label: loc("Design") }], images: [], projects: [], brands: [], programmes: [], videos: [], questions: [] });
    if (path === "articles/" + ids.article) return done(value.article);
    if (path === "articles") return done({ items: [], total: 0, offset: 0, limit: 25 });
    if (path === "projects/" + publicId + "/unit-types") return done(value.unit);
    if (path === "projects/" + publicId + "/commercial") return done(value.commercial);
    if (path === "projects/" + publicId + "/amenities") return done(value.amenities);
    if (path === "projects/" + publicId + "/media") return done(value.media);
    if (path.endsWith("/ai-state")) return done({ configured: false, enabled: false });
    if (path === "projects/" + publicId || path === "projects/" + publicId + "/commercial-types") return done(value.project);
    if (path === "brands/brd_workflow") return done(value.brand);
    if (path === "projects") return done([value.project]);
    if (path === "brands") return done([value.brand]);
    if (path === "assets") return done(value.media.assets);
    if (await fulfilWorkspaceProjection(route, [value.project, { public_brand_id: value.brand.public_brand_id, public_name: value.brand.public_name }])) return;
    return done([]);
  });
  return { ...value, calls, reads,
    holdCommand: () => commandGate = gate(),
    holdRead: (path: string) => { const wait = gate(); readGates.set(path, wait); return wait; },
    holdRetry: () => { showTranslation = true; return retryGate = gate(); },
    stale: () => { stale = true; }, freshMetadata: () => { currentHash = "b".repeat(64); currentRevision = 5; },
  };
}
const projectPath = (query: string) => "/website/project/" + publicId + "?" + query;
const control = (page: Page, kind: WorkflowKind) => page.locator('[data-workflow-kind="' + kind + '"]:visible').first();
const submit = (panel: Locator) => panel.getByRole("button", { name: text.submit, exact: true });
async function visit(page: Page, path: string) { await page.goto(path); await refreshSyntheticAuthority(page); }
async function begin(page: Page, value: Awaited<ReturnType<typeof mock>>, kind: WorkflowKind) {
  const wait = value.holdCommand(); await submit(control(page, kind)).click();
  await expect.poll(() => wait.seen).toBe(1); return wait;
}
async function confirmOwnDraft(page: Page, panel: Locator) {
  await panel.getByRole("button", { name: text.save_approve, exact: true }).click();
  const dialog = page.locator("dialog[open]").last();
  await dialog.getByLabel(text.reason, { exact: true }).fill("Synthetic explicit approval reason");
  const confirm = dialog.getByRole("button", { name: text.save_approve, exact: true });
  await expect(confirm).toBeEnabled(); await confirm.click();
}

for (const kind of ["question", "glossary"] as const) test(kind + " keeps Add locked through command and explicit source reload", async ({ page }) => {
  const value = await mock(page), path = kind === "question" ? "faq/questions" : "content/glossary";
  await visit(page, "/settings?section=" + (kind === "question" ? "bank" : "glossary"));
  await expect(submit(control(page, kind))).toBeEnabled();
  const add = page.locator(".content-toolbar > button").last(), reload = value.holdRead(path);
  const wait = await begin(page, value, kind);
  try {
    await expect(add).toBeDisabled(); expect(value.calls).toHaveLength(1);
    wait.release(); await expect.poll(() => reload.seen).toBeGreaterThan(0);
    await expect(add).toBeDisabled(); reload.release();
    await expect(add).toBeEnabled(); await fitsWorkspace(page);
  } finally { wait.release(); reload.release(); }
});

test("English retry holds the parent workflow and Add until its source reload finishes", async ({ page }) => {
  const value = await mock(page), retry = value.holdRetry();
  await visit(page, "/settings?section=bank");
  const row = page.locator(".content-card").filter({ hasText: "Synthetic English source" });
  await expect(row.getByRole("button").first()).toBeEnabled();
  const reload = value.holdRead("faq/questions");
  await row.getByRole("button").first().click();
  try {
    await expect.poll(() => retry.seen).toBe(1);
    await expect(submit(control(page, "question"))).toBeDisabled();
    await expect(page.locator(".content-toolbar > button")).toHaveCount(0);
    retry.release(); await expect.poll(() => reload.seen).toBeGreaterThan(0);
    await expect(submit(control(page, "question"))).toBeDisabled();
    reload.release(); await expect(submit(control(page, "question"))).toBeEnabled();
    expect(value.calls.map(call => call.path)).toEqual(["content/translations/" + uuid(80) + "/retry"]);
  } finally { retry.release(); reload.release(); }
});

test("clip submission blocks Add, manual status write and the target's peer workflow", async ({ page }) => {
  const value = await mock(page); await visit(page, projectPath("tab=media&section=clips"));
  const card = page.locator(".media-card").filter({ hasText: "Synthetic clip" });
  await card.locator("select").selectOption("ok");
  const wait = await begin(page, value, "media_link");
  try {
    await expect(page.locator(".media-workspace .content-section > button.button.primary")).toBeDisabled();
    await expect(card.locator(":scope > button")).toHaveCount(4);
    for (const button of await card.locator(":scope > button").all()) await expect(button).toBeDisabled();
    await expect(submit(control(page, "media_target"))).toBeDisabled();
    expect(value.calls).toHaveLength(1);
  } finally { wait.release(); }
});

for (const kind of ["unit_type", "price"] as const) test(kind + " exclusively owns the wizard while its source reload is pending", async ({ page }) => {
  const value = await mock(page); await visit(page, projectPath("tab=unit-types&unit_type=" + publicType + "&field=price.amount"));
  await expect(submit(control(page, kind))).toBeEnabled();
  const reload = value.holdRead("projects/" + publicId + "/unit-types"), wait = await begin(page, value, kind);
  const peer = control(page, kind === "unit_type" ? "price" : "unit_type");
  try {
    await expect(submit(peer)).toBeDisabled();
    await expect(page.locator(".unit-wizard > .ct-row-heading > button")).toBeDisabled();
    await expect(page.locator(".unit-steps button")).toHaveCount(6);
    for (const button of await page.locator(".unit-steps button").all()) await expect(button).toBeDisabled();
    expect(await page.locator(".unit-prices > button, .unit-price-card > .ct-actions > button").count()).toBeGreaterThan(0);
    for (const button of await page.locator(".unit-prices > button, .unit-price-card > .ct-actions > button").all()) await expect(button).toBeDisabled();
    wait.release(); await expect.poll(() => reload.seen).toBeGreaterThan(0);
    await expect(submit(peer)).toBeDisabled(); reload.release();
    await expect(page.locator(".unit-wizard > .ct-row-heading > button")).toBeEnabled();
    expect(value.calls).toHaveLength(1);
  } finally { wait.release(); reload.release(); }
});

for (const kind of ["unit_type", "type_asset"] as const) test(kind + " blocks canonical type media and its sibling workflow", async ({ page }) => {
  const value = await mock(page); await visit(page, projectPath("tab=unit-types"));
  await page.locator(".ct-card-actions button[aria-expanded]").first().click();
  const wait = await begin(page, value, kind);
  try {
    await expect(page.locator(".ct-media input[type=file]:visible")).toBeDisabled();
    await expect(submit(control(page, kind === "unit_type" ? "type_asset" : "unit_type"))).toBeDisabled();
    await expect(page.locator(".ct-card-actions button[aria-expanded]")).toBeDisabled();
    expect(value.calls).toHaveLength(1);
  } finally { wait.release(); }
});

test("asset edit-and-approve keeps its confirmation usable and locks batch save through reload", async ({ page }) => {
  const value = await mock(page); await visit(page, projectPath("tab=media&section=upload&asset=" + ids.asset));
  const caption = page.locator('textarea[id$="-caption-th"]');
  await caption.fill("Typed asset caption");
  const wait = value.holdCommand(), reload = value.holdRead("projects/" + publicId + "/media");
  await confirmOwnDraft(page, control(page, "asset"));
  try {
    await expect.poll(() => wait.seen).toBe(1);
    await expect(page.locator(".media-workspace .content-section > .content-actions > button.button.primary")).toBeDisabled();
    await expect(caption).toBeDisabled();
    expect(value.calls[0].body).toMatchObject({ kind: "asset", identity: { id: ids.asset }, expected_hash: hash, changes: { caption: { th: "Typed asset caption" } } });
    wait.release(); await expect.poll(() => reload.seen).toBeGreaterThan(0);
    await expect(page.locator(".media-workspace .content-section > .content-actions > button.button.primary")).toBeDisabled();
    reload.release(); await expect(page.locator(".media-workspace .content-section > .content-actions > button.button.secondary")).toBeEnabled();
    expect(value.calls).toHaveLength(1);
  } finally { wait.release(); reload.release(); }
});

for (const kind of ["project_asset", "brand_asset"] as const) test(kind + " locks ordinary upload and removal during binding submission", async ({ page }) => {
  const value = await mock(page);
  await visit(page, kind === "project_asset" ? projectPath("tab=media&section=canonical") : "/website/brand/brd_workflow?tab=media");
  const wait = await begin(page, value, kind);
  try {
    expect(await page.locator(".asset-caption > button, .asset-toolbar > button.button.primary").count()).toBeGreaterThan(0);
    for (const button of await page.locator(".asset-caption > button, .asset-toolbar > button.button.primary").all()) await expect(button).toBeDisabled();
    if (kind === "brand_asset") {
      expect(await page.locator(".brand-logo-slot-actions textarea").count()).toBeGreaterThan(0);
      for (const input of await page.locator(".brand-logo-slot-actions textarea").all()) await expect(input).toBeDisabled();
    }
    expect(value.calls).toHaveLength(1);
  } finally { wait.release(); }
});

for (const item of [
  { kind: "article" as const, path: "/articles?article=" + ids.article, scope: ".articles-workspace", reload: "articles/" + ids.article },
  { kind: "faq" as const, path: projectPath("tab=faq&faq=" + ids.faq), scope: ".entity-embedded-faq", reload: "faq/" + ids.faq },
  { kind: "progress" as const, path: projectPath("tab=data&section=commercial&field=construction_progress.percent"), scope: 'section.content-section:has(> [data-workspace-item="' + ids.progress + '"])', reload: "projects/" + publicId + "/commercial" },
]) test(item.kind + " cannot edit or change native tabs during command reload", async ({ page }) => {
  const value = await mock(page); await visit(page, item.path);
  await expect(submit(control(page, item.kind))).toBeEnabled();
  const reload = value.holdRead(item.reload), wait = await begin(page, value, item.kind);
  try {
    const container = page.locator(item.scope);
    await expect(container).toBeVisible();
    const tabs = container.locator(".content-tabs > button:visible");
    expect(await tabs.count()).toBeGreaterThan(0);
    for (const button of await tabs.all()) await expect(button).toBeDisabled();
    const edit = item.kind === "progress" ? page.locator('[data-workspace-item="' + ids.progress + '"] > .content-actions > button').first() : container.locator(".content-actions > button").first();
    await expect(edit).toBeDisabled();
    wait.release(); await expect.poll(() => reload.seen).toBeGreaterThan(0);
    await expect(edit).toBeDisabled(); reload.release();
    await expect(edit).toBeEnabled(); expect(value.calls).toHaveLength(1);
  } finally { wait.release(); reload.release(); }
});

test("amenity workflow blocks ordinary edits until completion", async ({ page }) => {
  const value = await mock(page); await visit(page, projectPath("tab=data&section=places"));
  const wait = await begin(page, value, "place");
  try {
    const row = page.locator('[data-workspace-item="' + ids.place + '"]');
    await expect(row.locator(".content-actions > button")).toBeDisabled();
    expect(value.calls).toHaveLength(1);
  } finally { wait.release(); }
});

for (const item of [
  { kind: "article" as const, path: "/articles?article=" + ids.article },
  { kind: "unit_type" as const, path: projectPath("tab=unit-types&unit_type=" + publicType + "&field=price.amount") },
  { kind: "price" as const, path: projectPath("tab=unit-types&unit_type=" + publicType + "&field=price.amount") },
  { kind: "progress" as const, path: projectPath("tab=data&section=commercial&field=construction_progress.percent") },
]) test(item.kind + " native readiness keeps submit disabled despite authoritative action capability", async ({ page }) => {
  const value = await mock(page);
  if (item.kind === "article") value.article.readiness.push({ code: "english_required", label: "Synthetic English review required" });
  if (item.kind === "unit_type") value.type.workflow.ready = false;
  if (item.kind === "price") value.price.readiness.ready = false;
  if (item.kind === "progress") value.commercial.records.construction[0].readiness.ready = false;
  await visit(page, item.path);
  await expect(submit(control(page, item.kind))).toBeDisabled();
  expect(value.calls).toHaveLength(0);
});

test("stale FAQ approval preserves typed text and original hash until explicit reload", async ({ page }) => {
  const value = await mock(page); await visit(page, projectPath("tab=faq&faq=" + ids.faq));
  await page.locator(".entity-embedded-faq .content-actions > button").first().click();
  await page.locator("#faq-short_answer-th").fill("Typed answer kept after conflict");
  value.stale(); await confirmOwnDraft(page, control(page, "faq"));
  await expect(control(page, "faq")).toContainText(text.draft_preserved);
  await page.locator("dialog[open]").last().getByRole("button", { name: text.cancel, exact: true }).click();
  value.faq.revision = 5; value.faq.version.short_answer = loc("Explicitly reloaded answer"); value.freshMetadata();
  await expect(page.locator("#faq-short_answer-th")).toHaveValue("Typed answer kept after conflict");
  expect(value.calls[0].body).toMatchObject({ expected_hash: hash, changes: { short_answer: { th: "Typed answer kept after conflict" } } });
  await expect(control(page, "faq").getByRole("button", { name: text.save_approve, exact: true })).toBeDisabled();
  await control(page, "faq").getByRole("button", { name: text.refresh, exact: true }).click();
  await expect(page.locator("#faq-short_answer-th")).toHaveCount(0);
  await expect(page.locator(".entity-embedded-faq")).toContainText("Explicitly reloaded answer");
  expect(value.calls).toHaveLength(1);
});

test("wizard media approval holds its owner until the native unit reload completes", async ({ page }) => {
  const value = await mock(page);
  await visit(page, projectPath("tab=unit-types&unit_type=" + publicType + "&field=commercial_type.floor_plan"));
  // Hold the post-command reload, never the wizard's initial data request.
  await expect(submit(control(page, "type_asset"))).toBeEnabled();
  const reload = value.holdRead("projects/" + publicId + "/unit-types"), wait = await begin(page, value, "type_asset");
  try {
    await expect(submit(control(page, "unit_type"))).toBeDisabled();
    wait.release(); await expect.poll(() => reload.seen).toBeGreaterThan(0);
    await expect(submit(control(page, "unit_type"))).toBeDisabled();
    await expect(page.locator(".unit-wizard > .ct-row-heading > button")).toBeDisabled();
    reload.release(); await expect(page.locator(".unit-wizard > .ct-row-heading > button")).toBeEnabled();
    expect(value.calls).toHaveLength(1);
  } finally { wait.release(); reload.release(); }
});
