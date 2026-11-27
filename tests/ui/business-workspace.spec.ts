import { expect, test, type Page } from "@playwright/test";
import { emptyCapabilities, type HubAccount } from "../../apps/admin/lib/hub-permissions";
import { workspaceHref, workspaceText as text, type WorkspaceEntity, type WorkspaceLevel, type WorkspaceTarget } from "../../apps/admin/lib/unified-workspace";
import { workflowInventoryPath, workflowText, type WorkflowTarget } from "../../apps/admin/lib/content-workflow";
import { businessWorkspaceText as businessText } from "../../apps/admin/lib/business-workspace-text";
import { fitsWorkspace } from "./unified-workspace-helpers";

const origin = "http://127.0.0.1:3000", api = "/api/hub/v1/admin/", code = "residential";
const id = (n: number) => "85000000-0000-4000-8000-" + String(n).padStart(12, "0");
const ids = { section: id(1), contact: id(2), faq: id(3), corporateFaq: id(4), version: id(5), cluster: id(6) };
const stamp = "2026-11-05T09:00:00+07:00", rem = "REM-BUSINESS-EXACT";
const loc = (value: string) => ({ th: value, en: value });
function gate() { let release = () => {}; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release, seen: 0 }; }
type Gate = ReturnType<typeof gate>;
type Call = { path: string; method: string; body: any };

function pageProjection(level: WorkspaceLevel, ref: string): WorkspaceEntity {
  const business = level === "business";
  return {
    entity: { kind: level, ref, name: loc(business ? "Residential fixture" : ref), scope_type: level, scope_id: level === "project" ? rem : ref },
    phases: [], selected_phase: null, tabs: business ? ["overview", "data", "faq", "history"] : ["faq", "history"],
    sections: business ? [{ key: "narrative", label: businessText.narrative, tab: "data", state: "DRAFT", revision: 4, suggestion_count: 0, target: { level, id: ref, tab: "data", section: "narrative", field: "section.project_intro", item: ids.section } }] : [],
    overview: { readiness: { required: [], recommended: [] }, tasks: [], changes_since_publication: [], preview_target: business ? { level, id: ref, tab: "overview", section: "preview" } : null },
  };
}
function fixture() {
  const field = (key: string, entity: string, label: string) => ({ field_key: key, entity, section: entity === "contact" ? "contacts" : "narrative", label: loc(label), help: {}, sort: 1,
    value_kind: "localized_text", unit: null, source_policy: "mkt", source_ref: null, owner_role: "Marketing", required_for: {}, locales_required: ["th"], surfaces: [], default_ai_exposure: "internal", review_every_days: null, validation: { max_length: 12000 }, status: "active", revision: 1 });
  const section = { id: ids.section, section_key: "section.project_intro", revision: 4, state: "DRAFT", version: { version_no: 4, body: loc("Saved business narrative"), state: "DRAFT", source_ref: null, ai_exposure: "internal", created_at: stamp }, history: [] };
  const contact = { id: ids.contact, revision: 3, channel: "phone", value: "020000000", url: null, label: loc("Business contact"), shared_mailbox_confirmed: false, is_primary: true, sort: 0, ai_exposure: "web_only" };
  const question = (key: string) => ({ question_key: key, topic: "identity", default_level: "business", question_template: loc(key), alt_questions: {}, answer_kind: "text", fact_keys: [], property_types: [], is_core: true, show_on_project_pages: true, web_sort: 0, status: "approved", revision: 1, version_author: null, ai_exposure: "open" });
  const questions = [question("business_missing"), question("business_inherited")];
  const faq = { id: ids.faq, question_key: "business_inherited", scope_type: "business", scope_id: code, revision: 4, state: "DRAFT", version: {
    version_no: 4, question: loc("business_inherited"), alt_questions: {}, short_answer: loc("Own saved business answer"), detail: {}, answer_kind: "text", fact_keys: [], applies_to_project_ids: [] as string[], applicability_rule: {}, review_due: null, effective_to: null, state: "DRAFT", ai_exposure: "internal", created_at: stamp,
  }, history: [], sources: [], translations: [] };
  return { content: { scope_type: "business", scope_id: code, sections: [section], contacts: [contact], translations: [] }, questions, faq,
    fields: { items: [field("section.project_intro", "section", "Business introduction"), field("contact.channel", "contact", "Channel"), field("contact.value", "contact", "Contact value"), field("contact.label", "contact", "Contact label")], can_manage: false } };
}
async function refreshAuthority(page: Page) {
  await page.locator("main h1").first().waitFor();
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/hub/v1/me");
  await page.evaluate(() => window.dispatchEvent(new Event("hub-accounts-changed"))); await refreshed;
}
async function mock(page: Page, { edit = true, projects = false, inventory = false } = {}) {
  const value = fixture(), calls: Call[] = [], reads: string[] = [], sourceReads: string[] = [];
  const account: HubAccount = { id: id(99), status: "ACTIVE", hub_role: "admin", display_name_th: "Business fixture reviewer", capabilities: {
    ...emptyCapabilities, published_consumer: true, tabs: { knowledge: { view: true, edit, approve: edit }, projects: { view: projects, edit: false, approve: false } },
  } };
  let contentGate: Gate | null = null, commandGate: Gate | null = null, applicabilityGate: Gate | null = null, stale = false;
  const target = (kind: "section" | "contact"): WorkflowTarget => ({ kind, identity: { id: ids[kind] } });
  const snapshot = (item: WorkflowTarget) => ({ ...item, source_tab: "knowledge", source_tabs: ["knowledge"], expected_hash: (item.kind === "contact" ? "b" : value.content.sections[0].revision > 4 ? "c" : "a").repeat(64), source_revision: item.kind === "contact" ? value.content.contacts[0].revision : value.content.sections[0].revision,
    source_updated_at: null, state: "DRAFT", can_edit: edit, can_submit: edit, can_approve: false, can_return: false, can_withdraw: false, can_save_approve: edit, approval_requires_reason: true,
    version_id: null, version_no: null, approved_by: null, approved_at: null, decision_reason: null, self_approval: false, needs_reapproval: false, history: [] });
  const descriptor = (kind: "section" | "contact") => ({ ...snapshot(target(kind)), label: loc(kind === "section" ? "Business introduction" : "Business contact"), target: { level: "business", id: code, tab: "data", section: kind === "section" ? "narrative" : "contacts", item: ids[kind] }, href: null });
  await page.context().addCookies([{ name: "sena_local_persona", value: "admin", url: origin }]);
  await page.route("**/api/hub/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace(api, ""), method = route.request().method();
    const done = (data: unknown) => route.fulfill({ json: { data } });
    const denied = () => route.fulfill({ status: 403, json: { error: { code: "content_permission", message: workflowText.permission_required } } });
    if (url.pathname === "/api/hub/v1/me") return done(account);
    if (path === "accounts/display-names") return done([]);
    if (method === "GET") reads.push(path + url.search);
    if (/^(projects|brands)(\/|$)/.test(path)) { sourceReads.push(path); return denied(); }
    if (path === "content/workspace/tree") {
      const node = (kind: WorkspaceLevel, ref: string, children: boolean, parent: { kind: string; ref: string } | null) => ({ key: kind + ":" + ref, kind, ref, name: loc(kind === "business" ? "Residential fixture" : ref), target: { level: kind, id: ref, tab: kind === "business" || kind === "corporate" ? "overview" : "faq" }, parent, has_children: children, visible_phase_count: 0, grouping: { state: "unconfirmed", group_ref: null } });
      const parent = url.searchParams.get("parent_kind"), items = parent === "corporate" ? [node("business", code, true, { kind: "corporate", ref: "sena" })] : parent === "business" ? [node("brand", "brd_exact", true, { kind: "business", ref: code })] : parent === "brand" ? [node("project", "prj_exact", false, { kind: "brand", ref: "brd_exact" })] : [node("corporate", "sena", true, null)];
      return done({ items, programmes: [], next_cursor: null });
    }
    if (path === "content-workflow/items") return done({ scope: { level: url.searchParams.get("level"), id: url.searchParams.get("id"), phase: null }, items: inventory ? [descriptor(url.searchParams.has("after") ? "contact" : "section")] : [], next_cursor: inventory && !url.searchParams.has("after") ? "next-business-own-page" : null });
    if (path === "content-workflow" && method === "GET") return done(snapshot({ kind: url.searchParams.get("kind"), identity: JSON.parse(url.searchParams.get("identity")!) } as WorkflowTarget));
    if (method !== "GET") {
      const body = route.request().postDataJSON(); calls.push({ path, method, body });
      if (path === "faq-applicability") {
        if (applicabilityGate) { applicabilityGate.seen++; await applicabilityGate.promise; }
        return done({ project_ids: [rem], projects: [{ id: rem, name: loc("Old resolved phase") }], unresolved_forms: [] });
      }
      if (path.startsWith("content-workflow/")) {
        if (commandGate) { commandGate.seen++; await commandGate.promise; }
        if (stale || inventory && body.kind === "contact") return route.fulfill({ status: 409, json: { error: { code: "stale_revision", message: workflowText.stale_item } } });
        const savedApproval = path === "content-workflow/save-approve";
        if (savedApproval && body.kind === "section") { value.content.sections[0].revision += 1; value.content.sections[0].state = "APPROVED"; Object.assign(value.content.sections[0].version, body.changes, { state: "APPROVED" }); }
        return done({ ...snapshot(body), state: savedApproval ? "APPROVED" : "IN_REVIEW", can_submit: false });
      }
      if (path === `content/businesses/${code}/sections/section.project_intro` && method === "PUT") {
        value.content.sections[0].revision += 1; Object.assign(value.content.sections[0].version, body.changes); return done(value.content.sections[0]);
      }
      if (path === `content/businesses/${code}/contacts/${ids.contact}` && method === "PUT") {
        Object.assign(value.content.contacts[0], body.changes); value.content.contacts[0].revision += 1; return done(value.content.contacts[0]);
      }
      if (path === "faq" && method === "POST") {
        Object.assign(value.faq, { scope_type: body.changes.scope_type, scope_id: body.changes.scope_id, question_key: body.changes.question_key }); Object.assign(value.faq.version, body.changes); return done(value.faq);
      }
      if (path === "faq/questions/business_standard" && method === "PUT") { const saved = { ...value.questions[0], ...body.changes, question_key: "business_standard", status: "proposed" }; value.questions.push(saved); return done(saved); }
      return route.fulfill({ status: 500, json: { error: { code: "unexpected_test_write", message: path } } });
    }
    if (path === "content/fields") return done(value.fields);
    if (path === `content/businesses/${code}/content`) {
      const allowedAtRequest = account.capabilities?.tabs.knowledge.view;
      if (contentGate) { contentGate.seen++; await contentGate.promise; }
      return allowedAtRequest ? done(value.content) : denied();
    }
    if (path === "faq/questions") return done({ items: value.questions, topics: [{ code: "identity", label: loc("Identity") }], translations: [] });
    if (path === "faq/references") return done({ businesses: [{ id: code, name: "Residential fixture" }], projects: [{ id: rem, name: "Exact phase" }], brands: [{ id: "brd_exact", name: "Exact brand" }], groups: [], unit_types: [] });
    if (path === "faq/corporate-contacts") return done([]);
    if (path === "faq/" + ids.faq) return done(value.faq);
    if (path === "faq") return done({ items: [value.faq] });
    const workspace = /^content\/workspace\/(business|project|brand|corporate)\/([^/]+)(?:\/(faq|history|preview)(?:\/([^/]+))?)?$/.exec(path);
    if (workspace) {
      const level = workspace[1] as WorkspaceLevel, ref = decodeURIComponent(workspace[2]);
      if (!account.capabilities?.tabs.knowledge.view) return denied();
      if (level === "business" && ref !== code) return route.fulfill({ status: 404, json: { error: { code: "not_found", message: text.empty } } });
      if (workspace[3] === "preview") return done({ mode: "PRIVATE_DRAFT", saved: false, preview: {}, issues: [], html: "<p>Approved business inheritance</p>" });
      if (workspace[3] === "history") {
        const event = { audit_id: "85001", occurred_at: stamp, actor: { id: id(99), name: "Business fixture reviewer" }, action: "edit", entity: { kind: "business", ref: code, name: loc("Residential fixture") }, source_tab: "knowledge", section_key: "narrative", reason: "Saved exact business source", version: { id: ids.version, number: 4, state: "DRAFT" }, target: { level: "business", id: code, tab: "data", section: "narrative", field: "section.project_intro", item: ids.section, version: ids.version }, diff_available: true };
        return done(workspace[4] ? { ...event, before: { body: "Before business text" }, after: { body: "After business text" }, changed_field_keys: ["body"] } : { items: [event], next_cursor: null });
      }
      if (workspace[3] === "faq") {
        const source: WorkspaceTarget = { level: level === "business" ? "corporate" : "business", id: level === "business" ? "sena" : code, tab: "faq", question_key: "business_inherited" };
        const rows = value.questions.map((question, index) => ({ question_key: question.question_key, label: question.question_template, is_core: true, answer_kind: "text", display_state: index ? "inherited" : "missing", content_state: index ? "APPROVED" : null, own_answer: null,
          effective_answer: index ? { id: level === "business" ? ids.corporateFaq : ids.faq, revision: 4, version_id: ids.version, state: "APPROVED", question: question.question_template, short_answer: loc(level === "business" ? "Approved corporate fallback" : "Approved business winner"), detail: {}, source: { scope_type: source.level, scope_id: source.id, name: loc(source.level === "business" ? "Residential fixture" : "SENA"), target: source, affected_project_count: 2, affected_count_complete: false }, author: null, approver: null } : null,
          facts: [], legacy_clusters: [], applicability: { state: "applies", reason: null }, targets: { ...(edit ? { create_override: { level, id: ref, tab: "faq", question_key: question.question_key } } : {}), ...(index && edit ? { edit_source: source } : {}) } }));
        return done({ page_scope: { type: level, id: level === "project" ? rem : ref }, selected_phase: null, items: url.searchParams.has("question_key") ? rows.filter(row => row.question_key === url.searchParams.get("question_key")) : rows, next_cursor: null, unmatched_clusters: [], unmatched_next_cursor: null });
      }
      return done(pageProjection(level, ref));
    }
    if (path.endsWith("/ai-state")) return done({ enabled: false, configured: false });
    return done([]);
  });
  return { value, account, calls, reads, sourceReads, setContentGate: (value: Gate | null) => { contentGate = value; }, setCommandGate: (value: Gate | null) => { commandGate = value; }, setApplicabilityGate: (value: Gate | null) => { applicabilityGate = value; }, setStale: (value: boolean) => { stale = value; } };
}
async function open(page: Page, query = "tab=data&section=narrative") {
  await page.goto(`/website/business/${code}?${query}`); await refreshAuthority(page);
}

test("business targets preserve exact FAQ, section, history and own-scope inventory context", () => {
  const url = new URL(workspaceHref({ level: "business", id: code, tab: "faq", question_key: "business_inherited", faq: ids.faq, item: ids.faq, version: ids.version }), origin);
  expect(url.pathname).toBe("/website/business/residential");
  expect(Object.fromEntries(url.searchParams)).toEqual({ tab: "faq", question: "business_inherited", faq: ids.faq, item: ids.faq, version: ids.version });
  expect(workflowInventoryPath({ level: "business", id: code, phase: null })).toContain("level=business&id=residential");
  expect(workflowInventoryPath({ level: "business", id: code, phase: null })).not.toContain("phase=");
});

test("authorized hierarchy keeps the fixed business between corporate and exact brands", async ({ page }) => {
  const fixture = await mock(page); await page.goto("/website"); await refreshAuthority(page);
  await page.locator(".workspace-tree > li > details > summary").click();
  const business = page.locator('.workspace-tree a[href="/website/business/residential?tab=overview"]'); await expect(business).toHaveText("Residential fixture");
  await business.locator("xpath=../..").locator(":scope > details > summary").click();
  const brand = page.locator('.workspace-tree a[href="/website/brand/brd_exact?tab=faq"]'); await expect(brand).toBeVisible();
  await brand.locator("xpath=../..").locator(":scope > details > summary").click();
  await expect(page.locator('.workspace-tree a[href="/website/project/prj_exact?tab=faq"]')).toBeVisible();
  expect(fixture.reads.some(path => path.includes("parent_kind=business") && path.includes("parent_ref=residential"))).toBe(true);
  expect(fixture.calls).toEqual([]); expect(fixture.sourceReads).toEqual([]); await fitsWorkspace(page);
});

test("Knowledge-only business sections and contacts use their normal writer and original revisions", async ({ page }) => {
  const fixture = await mock(page); await open(page, "tab=data&section=narrative&field=section.project_intro");
  const section = page.locator('[data-workspace-field="section.project_intro"]'); await expect(section).toBeFocused();
  await page.locator("#section-body-section\\.project_intro-th").fill("Edited business narrative");
  await expect(page.getByRole("button", { name: businessText.contacts, exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: new RegExp("^" + workflowText.submit_all) })).toBeDisabled();
  await section.locator("form button.primary").click(); await expect(page.locator("#section-body-section\\.project_intro-th")).toHaveValue("Edited business narrative");
  expect(fixture.calls[0]).toMatchObject({ path: `content/businesses/${code}/sections/section.project_intro`, method: "PUT", body: { expected_revision: 4, changes: { body: { th: "Edited business narrative" }, ai_exposure: "internal" } } });
  await page.getByRole("button", { name: businessText.contacts, exact: true }).click();
  const contact = page.locator(`[data-workspace-item="${ids.contact}"]`); await contact.locator(":scope > button").click();
  await page.locator("#contact-value").fill("021111111"); await page.locator('[data-business-content] form button.primary').click();
  await expect(contact.getByText("021111111", { exact: true })).toBeVisible();
  expect(fixture.calls[1]).toMatchObject({ path: `content/businesses/${code}/contacts/${ids.contact}`, method: "PUT", body: { expected_revision: 3, changes: { value: "021111111" } } });
  await open(page, `tab=data&section=contacts&item=${ids.contact}&field=contact.value`); await expect(contact).toBeFocused();
  expect(fixture.sourceReads).toEqual([]); expect(fixture.calls.every(call => call.path.startsWith(`content/businesses/${code}/`))).toBe(true);
  await expect(page.locator('#workspace-tab-unit-types, #workspace-tab-media, .workspace-heading select')).toHaveCount(0);
});

test("business header reads every own draft page and keeps independent exact-hash outcomes", async ({ page }) => {
  const fixture = await mock(page, { inventory: true }); await open(page, "tab=overview");
  const submit = page.getByRole("button", { name: workflowText.submit_all + " (2)", exact: true }); await expect(submit).toBeEnabled();
  await submit.click(); await expect(page.locator(".workflow-results li")).toHaveCount(2);
  const commands = fixture.calls.filter(call => call.path === "content-workflow/submit");
  expect(commands.map(call => ({ kind: call.body.kind, identity: call.body.identity, hash: call.body.expected_hash }))).toEqual([
    { kind: "section", identity: { id: ids.section }, hash: "a".repeat(64) }, { kind: "contact", identity: { id: ids.contact }, hash: "b".repeat(64) },
  ]);
  await expect(page.locator(".workflow-results")).toContainText(workflowText.stale_item);
  const requests = fixture.reads.filter(path => path.startsWith("content-workflow/items"));
  expect(requests.some(path => path.includes("after=next-business-own-page"))).toBe(true);
  expect(requests.every(path => path.includes("level=business") && path.includes("id=residential") && !path.includes("phase="))).toBe(true);
});

test("business save-and-approve keeps the owning confirmation active and blocks peer navigation", async ({ page }) => {
  const fixture = await mock(page), delayed = gate(); fixture.setCommandGate(delayed); await open(page);
  const section = page.locator('[data-workspace-field="section.project_intro"]');
  await page.locator("#section-body-section\\.project_intro-th").fill("Approved typed business draft");
  await section.getByRole("button", { name: workflowText.save_approve, exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.getByLabel(workflowText.reason, { exact: true }).fill("Business source reviewed");
  await expect(dialog.locator("button.primary")).toBeEnabled(); await dialog.locator("button.primary").click();
  await expect.poll(() => delayed.seen).toBe(1);
  await expect(page.getByRole("button", { name: businessText.contacts, exact: true })).toBeDisabled();
  await expect(page.locator("#workspace-tab-faq")).toBeDisabled();
  expect(fixture.calls[0]).toMatchObject({ path: "content-workflow/save-approve", body: { kind: "section", identity: { id: ids.section }, expected_hash: "a".repeat(64), reason: "Business source reviewed", changes: { body: { th: "Approved typed business draft" } } } });
  delayed.release(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: businessText.contacts, exact: true })).toBeEnabled();
  await expect(page.locator("#section-body-section\\.project_intro-th")).toHaveValue("Approved typed business draft");
});

test("business source conflict preserves typed text until explicit source reload", async ({ page }) => {
  const fixture = await mock(page); fixture.setStale(true); await open(page);
  const section = page.locator('[data-workspace-field="section.project_intro"]');
  await page.locator("#section-body-section\\.project_intro-th").fill("Do not lose this business draft");
  await section.getByRole("button", { name: workflowText.save_approve, exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.getByLabel(workflowText.reason, { exact: true }).fill("Review original business source"); await dialog.locator("button.primary").click();
  await expect(section).toContainText(workflowText.stale_item); await expect(page.locator("#section-body-section\\.project_intro-th")).toHaveValue("Do not lose this business draft");
  expect(fixture.calls[0].body.expected_hash).toBe("a".repeat(64));
  await dialog.getByRole("button", { name: workflowText.cancel, exact: true }).click();
  fixture.value.content.sections[0].revision = 5; fixture.value.content.sections[0].version.body = loc("Latest business source"); fixture.setStale(false);
  await section.getByRole("button", { name: workflowText.refresh, exact: true }).click();
  await expect(page.locator("#section-body-section\\.project_intro-th")).toHaveValue("Latest business source");
  await expect(page.locator("#section-body-section\\.project_intro-en")).toHaveValue("Latest business source");
});

test("business View cannot edit and a revoked Knowledge source cannot return late data", async ({ page }) => {
  const fixture = await mock(page, { edit: false }); await open(page);
  await expect(page.locator('[data-business-content] [data-workspace-field] form')).toHaveCount(0);
  expect(fixture.calls).toEqual([]);
  const delayed = gate(); fixture.setContentGate(delayed);
  await page.reload(); await expect.poll(() => delayed.seen).toBeGreaterThan(0);
  fixture.account.capabilities!.tabs.knowledge = { view: false, edit: false, approve: false };
  fixture.account.capabilities!.tabs.projects = { view: true };
  await refreshAuthority(page);
  const returned = page.waitForResponse(response => response.url().includes(`/content/businesses/${code}/content`));
  delayed.release(); await (await returned).finished();
  await expect(page.locator('[data-business-content]')).toHaveCount(0); await expect(page.getByText("Saved business narrative", { exact: true })).toHaveCount(0);
  expect(fixture.calls).toEqual([]); expect(fixture.sourceReads).toEqual([]);
});

test("business permission revocation keeps typed text in the existing recovery panel", async ({ page }) => {
  const fixture = await mock(page); await open(page);
  await page.locator("#section-body-section\\.project_intro-th").fill("Unsaved business recovery text");
  fixture.account.capabilities!.tabs.knowledge = { view: false, edit: false, approve: false };
  fixture.account.capabilities!.tabs.projects = { view: true };
  await refreshAuthority(page);
  await expect(page.locator('[data-business-content]')).toHaveCount(0);
  await expect(page.locator('textarea[readonly]').filter({ visible: true })).toHaveValue("Unsaved business recovery text");
  expect(fixture.calls).toEqual([]);
});

test("business FAQ keeps its page scope, approved question defaults and empty applicability", async ({ page }) => {
  const fixture = await mock(page); await open(page, "tab=faq&question=business_missing&faq=new");
  const form = page.locator(".entity-embedded-faq form"); await expect(form).toBeVisible();
  expect(fixture.reads).not.toContain("faq/new");
  await expect(form.locator('select option[value="business"]')).toHaveCount(0);
  await expect(form).toContainText(text.business); await expect(form).toContainText("Residential fixture");
  await page.locator("#faq-short_answer-th").fill("A business draft with explicit applicability only");
  await form.locator("button.primary").click();
  await expect(page.locator(".entity-embedded-faq").getByText("A business draft with explicit applicability only", { exact: true })).toBeVisible();
  const saved = fixture.calls.find(call => call.path === "faq"); expect(saved?.body).toMatchObject({ expected_revision: 0, changes: { question_key: "business_missing", scope_type: "business", scope_id: code, applies_to_project_ids: [], applicability_rule: {} } });
  expect(fixture.sourceReads).toEqual([]);
});

test("winning inherited business FAQ opens its exact source while corporate fallback stays distinct", async ({ page }) => {
  const fixture = await mock(page); await page.goto("/website/project/prj_exact?tab=faq&question=business_inherited"); await refreshAuthority(page);
  const row = page.locator('[data-workspace-question="business_inherited"]');
  await expect(row).toContainText("Approved business winner"); await expect(row).toContainText(text.inheritedFrom + text.business);
  const source = row.getByRole("link", { name: new RegExp("^" + text.editSource) });
  expect(new URL((await source.getAttribute("href"))!, origin).pathname).toBe("/website/business/residential");
  await expect(source).toContainText(text.affected_projects + " 2");
  await source.click(); await expect(page).toHaveURL(new RegExp("/website/business/residential.*faq=" + ids.faq));
  await expect(page.locator(".entity-embedded-faq")).toContainText("Own saved business answer");
  await open(page, "tab=faq");
  await expect(page.locator('[data-workspace-question="business_inherited"]')).toContainText("Approved corporate fallback");
  await expect(page.locator('[data-workspace-question]').first()).toHaveAttribute("data-workspace-question", "business_missing");
  expect(fixture.sourceReads).toEqual([]); expect(fixture.calls).toEqual([]);
});

test("a cancelled applicability preview cannot select phases in a later business draft", async ({ page }) => {
  const fixture = await mock(page, { projects: true }), delayed = gate(); fixture.setApplicabilityGate(delayed);
  await open(page, "tab=faq&question=business_missing&faq=new");
  const form = page.locator(".entity-embedded-faq form"), applicability = form.locator("details.content-card");
  await applicability.locator("summary").click(); await applicability.locator("select[multiple]").first().selectOption("brd_exact");
  await applicability.locator(".content-actions button").last().click(); await expect.poll(() => delayed.seen).toBe(1);
  expect(fixture.calls[0].body).toEqual({ rule: { brand_ids: ["brd_exact"] }, scope_type: "business", scope_id: code });
  await form.getByRole("button", { name: text.cancel, exact: true }).click();
  await page.locator('[data-workspace-question="business_inherited"]').getByRole("button", { name: text.newFaq, exact: true }).click();
  await expect(page.locator("#faq-question-th")).toHaveValue("business_inherited");
  const returned = page.waitForResponse(response => response.url().endsWith("/faq-applicability")); delayed.release(); await (await returned).finished();
  await expect(page.locator(".entity-embedded-faq form > fieldset > label select[multiple]")).toHaveValues([]);
  await page.locator("#faq-short_answer-th").fill("Later untouched business draft"); await page.locator(".entity-embedded-faq form button.primary").click();
  await expect(page.locator(".entity-embedded-faq").getByText("Later untouched business draft", { exact: true })).toBeVisible();
  const saved = fixture.calls.find(call => call.path === "faq"); expect(saved?.body.changes).toMatchObject({ question_key: "business_inherited", applies_to_project_ids: [], applicability_rule: {} });
});

test("standard question proposal supports all seven defaults without changing existing answer scope", async ({ page }) => {
  const fixture = await mock(page); await page.goto("/settings?section=bank"); await refreshAuthority(page);
  const bank = page.locator(".content-section").filter({ has: page.getByRole("heading", { name: text.bank, exact: true }) });
  await bank.locator(".content-toolbar button").click(); await page.locator("#bank-key").fill("business_standard");
  const level = bank.locator("form select").filter({ has: page.locator('option[value="business"]') });
  expect(await level.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(["corporate", "business", "brand", "programme", "project_group", "project", "unit_type"]);
  await level.selectOption("business"); await page.locator("#bank-question-th").fill("Synthetic business standard question"); await bank.locator("form button.primary").click();
  await expect(bank.getByRole("heading", { name: "Synthetic business standard question", exact: true })).toBeVisible();
  expect(fixture.calls).toHaveLength(1); expect(fixture.calls[0]).toMatchObject({ path: "faq/questions/business_standard", method: "PUT", body: { changes: { default_level: "business" } } });
  expect(fixture.value.faq.scope_type).toBe("business");
});

for (const colorScheme of ["light", "dark"] as const) test(`business preview and exact history remain read-only and fit ${colorScheme}`, async ({ page }) => {
  const fixture = await mock(page, { edit: false }); await page.emulateMedia({ colorScheme, reducedMotion: "reduce" }); await open(page, "tab=overview&section=preview");
  await expect(page.frameLocator("iframe.workspace-preview").getByText("Approved business inheritance")).toBeVisible();
  await expect(page.locator("iframe.workspace-preview")).toHaveAttribute("sandbox", ""); await fitsWorkspace(page);
  await page.locator("iframe.workspace-preview").scrollIntoViewIfNeeded();
  await page.frameLocator("iframe.workspace-preview").getByText("Approved business inheritance").scrollIntoViewIfNeeded();
  await expect(page.frameLocator("iframe.workspace-preview").getByText("Approved business inheritance")).toBeInViewport();
  await page.screenshot({ path: `artifacts/unified-workspace/w5/local-${colorScheme}-${page.viewportSize()!.width}-preview.png` });
  await page.locator("#workspace-tab-history").click();
  const event = page.locator("#content-event-85001"); await expect(event).toContainText("Saved exact business source");
  const href = new URL((await event.locator(":scope > a").getAttribute("href"))!, origin);
  expect(href.pathname).toBe("/website/business/residential"); expect(href.searchParams.get("item")).toBe(ids.section); expect(href.searchParams.get("version")).toBe(ids.version);
  await event.locator("summary").click(); await expect(event).toContainText("Before business text"); await expect(event).toContainText("After business text");
  await fitsWorkspace(page); await event.locator("summary").focus();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `artifacts/unified-workspace/w5/local-${colorScheme}-${page.viewportSize()!.width}-history.png`, fullPage: true });
  expect(fixture.calls).toEqual([]); expect(fixture.sourceReads).toEqual([]);
});
