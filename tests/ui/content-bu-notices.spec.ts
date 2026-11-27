import { expect, test, type Page } from "@playwright/test";
import { emptyCapabilities, type HubAccount } from "../../apps/admin/lib/hub-permissions";
import { contentScopeText as T } from "../../apps/admin/lib/content-scope-text";
import { workspaceCopy } from "../../apps/admin/lib/workspace-copy";
import { workspaceProjection, fitsWorkspace } from "./unified-workspace-helpers";
import { refreshSyntheticAuthority } from "./content-workflow-fixtures";

const copy = {"heading":"การแจ้งเตือน BUD","empty":"ไม่มีการแจ้งเตือน BUD","partial":"แสดงการแจ้งเตือน 100 รายการแรก"} as const;
const origin = "http://127.0.0.1:3000", publicA = "prj_notice_A", publicB = "prj_notice_B";
const moveEnd = "2030-01-10T01:02:03Z", membershipEnd = "2030-01-08T00:00:00Z";
const node = (kind: string, extra: Record<string, unknown> = {}) => ({ id: kind + ":one", kind, manager: false, href: null, project_ref: null, deadline: null, ...extra });
const handover = (project = publicA) => node("handover", { project_ref: project, tab: "faq", started_at: "2030-01-03T01:02:03Z", deadline: moveEnd, membership_deadline: membershipEnd, expired: false });
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release, seen: 0, completed: false }; }
type Gate = ReturnType<typeof gate>;
type Notice = ReturnType<typeof node>;
async function fixture(page: Page, manager = false) {
  const account: HubAccount = { id: "88000000-0000-4000-8000-000000000001", status: "ACTIVE", hub_role: "viewer", display_name_th: "Notice fixture caller", capabilities: { ...emptyCapabilities, published_consumer: true, can_manage_users: manager, tabs: { knowledge: { view: true }, projects: { view: false } } } };
  const state = { account, items: [handover()] as Notice[], hasMore: false, error: false, invalidate: false, meReads: 0, delay: null as Gate | null, queries: [] as string[], sourceReads: [] as string[], writes: [] as string[], homeError: false, assistantEvents: [] as unknown[] };
  const safeTask = { id: "safe-task", category: "review_due", label: { th: "Safe content task" }, href: "/website/project/prj_notice_A?tab=faq", context: { project: publicA } };
  await page.context().addCookies([{ name: "sena_local_persona", value: "admin", url: origin }]);
  await page.addInitScript(() => {
    (window as unknown as { noticeAssistantEvents: unknown[] }).noticeAssistantEvents = [];
    window.addEventListener("hub-assistant-open", event => {
      const detail = (event as CustomEvent).detail;
      (window as unknown as { noticeAssistantEvents: unknown[] }).noticeAssistantEvents.push({ text: detail.text, context: detail.context });
      event.stopImmediatePropagation();
    }, true);
  });
  await page.route("**/api/hub/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace("/api/hub/v1/admin/", "");
    const done = (data: unknown) => route.fulfill({ json: { data } });
    if (url.pathname === "/api/hub/v1/me") { state.meReads++; return done(state.account); }
    if (url.pathname.endsWith("/accounts/display-names")) return done([]);
    if (route.request().method() !== "GET") { state.writes.push(path); return route.fulfill({ status: 500, json: { error: { code: "unexpected_notice_write" } } }); }
    if (path === "content/bu-notices") {
      state.queries.push(url.searchParams.toString());
      const response = { items: structuredClone(state.items), has_more: state.hasMore }, waiting = state.delay, error = state.error, invalidate = state.invalidate;
      if (invalidate) { state.invalidate = false; state.error = false; }
      if (waiting) { waiting.seen++; await waiting.promise; }
      try { if (error) await route.fulfill({ status: 503, json: { error: { message: "PRIVATE diagnostic must not render", invalidate_access: invalidate } } }); else await done(response); }
      finally { if (waiting) waiting.completed = true; }
      return;
    }
    if (path === "content/home") return state.homeError ? route.fulfill({ status: 503, json: { error: {} } }) : done({ projects: [], brands: [], buds: [], project_total: 0, tasks: [safeTask], task_total: 1, selected_gap: null, offset: 0, limit: 20 });
    if (/^(projects|brands)(\/|$)/.test(path)) { state.sourceReads.push(path); return route.fulfill({ status: 403, json: { error: { code: "source_denied" } } }); }
    const entity = /^content\/workspace\/project\/([^/]+)(?:\/(faq|history))?$/.exec(path);
    if (entity) {
      const selected = url.searchParams.get("phase") === "REM-B" ? publicB : publicA;
      if (entity[2] === "faq") return done({ page_scope: { type: "project", id: selected === publicB ? "REM-B" : "REM-A" }, selected_phase: selected === publicB ? "REM-B" : "REM-A", items: [], next_cursor: null, unmatched_clusters: [], unmatched_next_cursor: null });
      if (entity[2] === "history") return done({ items: [], next_cursor: null });
      return done({ ...workspaceProjection({ public_project_id: selected, public_name: { th: "Exact selected phase" }, source: { rem_project_id: selected === publicB ? "REM-B" : "REM-A" } }),
        faq_only: true, tabs: ["faq", "history"], sections: [], phases: [{ rem_project_id: "REM-A", public_project_id: publicA, name: { th: "Phase A" } }, { rem_project_id: "REM-B", public_project_id: publicB, name: { th: "Phase B" } }], selected_phase: selected === publicB ? "REM-B" : "REM-A" });
    }
    if (path === "content-workflow/items") return done({ scope: { level: "project", id: url.searchParams.get("id"), phase: url.searchParams.get("phase") }, items: [], next_cursor: null });
    if (path === "content/fields") return done({ items: [], can_manage: false });
    if (path === "faq/questions") return done({ items: [], topics: [], translations: [] });
    if (path === "faq/references") return done({ projects: [], brands: [], groups: [], unit_types: [], businesses: [] });
    if (path === "faq/corporate-contacts") return done([]);
    return done([]);
  });
  return state;
}
async function home(page: Page) { await page.goto("/home"); await refreshSyntheticAuthority(page); await expect(page.locator(".content-bu-notices")).toBeVisible(); }
const notices = (page: Page) => page.getByRole("region", { name: copy.heading, exact: true });

test("manager notices expose only the exact account-management link and no private diagnostics", async ({ page }) => {
  const state = await fixture(page, true);
  state.items = [node("sync_missing", { manager: true, href: "/admin/accounts" }), node("sync_failed", { id: "failed", manager: true, href: "/admin/accounts?account=someone_else", failure_code: "PRIVATE_FAILURE" }), node("stale_data", { manager: true, href: "https://example.test/admin/accounts", source_snapshot_at: "2030-01-01T00:00:00Z", deadline: membershipEnd }), node("unknown_kind", { manager: true, label: "PRIVATE_UNKNOWN" })];
  await home(page); const panel = notices(page);
  await expect(panel.locator("li")).toHaveCount(3); await expect(panel.getByRole("link", { name: T.scope_temporary_grant, exact: true })).toHaveCount(1);
  await expect(panel.getByRole("link")).toHaveAttribute("href", "/admin/accounts");
  await expect(panel).not.toContainText("PRIVATE"); expect(state.queries.every(query => new URLSearchParams(query).get("project") === null)).toBe(true); expect(state.writes).toEqual([]);
});

test("ordinary callers see only their finite notices and never account-manager payload or navigation", async ({ page }) => {
  const state = await fixture(page);
  state.items = [handover(), node("sync_failed", { manager: true, href: "/admin/accounts", failure_code: "PRIVATE_FAILURE" }), node("stale_warning", { href: "/admin/accounts", deadline: membershipEnd, account_id: "PRIVATE_ACCOUNT" }), node("unknown_kind", { label: "PRIVATE_UNKNOWN" })];
  await home(page); const panel = notices(page);
  await expect(panel.locator("li")).toHaveCount(2); await expect(panel.getByRole("link", { name: T.scope_temporary_grant, exact: true })).toHaveCount(0);
  await expect(panel.locator('a[href="/admin/accounts"]')).toHaveCount(0); await expect(panel).not.toContainText("PRIVATE");
  await expect(panel.locator('a[href="/website/project/prj_notice_A?tab=faq"]')).toBeVisible();
});

for (const kind of ["stale_warning", "stale_expired"] as const) test(`server ${kind} state uses the supplied cutoff, independently of the browser clock`, async ({ page }) => {
  const state = await fixture(page); state.items = [node(kind, { source_snapshot_at: "2030-01-01T00:00:00Z", deadline: membershipEnd })];
  await home(page); const panel = notices(page);
  await expect(panel).toContainText(kind === "stale_warning" ? T.scope_stale_warning : T.scope_stale_expired);
  await expect(panel.locator("dt").filter({ hasText: T.scope_cutoff })).toHaveCount(1);
  await expect(panel.locator(`time[datetime="${membershipEnd}"]`)).toHaveText(/07:00$/);
  await expect(panel.locator(`time[datetime="${membershipEnd}"]`)).toContainText("2573");
});

test("Knowledge-only phase banners preserve separate handover and membership deadlines", async ({ page }) => {
  const state = await fixture(page); await page.goto(`/website/project/${publicA}?tab=faq`); await refreshSyntheticAuthority(page);
  const panel = notices(page); await expect(panel).toHaveAttribute("data-notice-project", publicA);
  await expect(panel).toContainText(T.scope_handover); await expect(panel.locator("dt").filter({ hasText: T.scope_handover_end })).toHaveCount(1);
  await expect(panel.locator("dt").filter({ hasText: T.scope_cutoff })).toHaveCount(1);
  await expect(panel.locator(`time[datetime="${moveEnd}"]`)).toHaveText(/08:02$/); await expect(panel.locator(`time[datetime="${membershipEnd}"]`)).toHaveText(/07:00$/);
  expect(state.queries.every(query => new URLSearchParams(query).get("project") === publicA)).toBe(true); expect(state.sourceReads).toEqual([]);
  state.items = [handover(publicB)]; await page.locator(".workspace-heading select").selectOption("REM-B");
  await expect(notices(page)).toHaveAttribute("data-notice-project", publicB); await expect(notices(page).locator("li")).toHaveCount(1);
  expect(new URLSearchParams(state.queries.at(-1)).get("project")).toBe(publicB); expect(state.queries.some(query => new URLSearchParams(query).get("project") === "REM-B")).toBe(false);
});

test("a late notice response from the previous phase cannot appear after phase selection", async ({ page }) => {
  const state = await fixture(page), delayed = gate(); state.delay = delayed;
  await page.goto(`/website/project/${publicA}?tab=faq`); await refreshSyntheticAuthority(page); await expect.poll(() => delayed.seen).toBeGreaterThan(0);
  state.delay = null; state.items = [node("stale_expired", { project_ref: publicB, deadline: membershipEnd })];
  await page.locator(".workspace-heading select").selectOption("REM-B"); await expect(notices(page)).toContainText(T.scope_stale_expired);
  delayed.release(); await expect.poll(() => delayed.completed).toBe(true);
  await expect(notices(page)).not.toContainText(T.scope_handover); await expect(notices(page)).toHaveAttribute("data-notice-project", publicB);
});

for (const replaceIdentity of [false, true]) test(`${replaceIdentity ? "identity change" : "same-account manager revocation"} discards delayed caller-specific notices`, async ({ page }) => {
  const state = await fixture(page, true), delayed = gate(); state.delay = delayed;
  state.items = [node("sync_failed", { manager: true, href: "/admin/accounts" })];
  await home(page); await expect.poll(() => delayed.seen).toBeGreaterThan(0);
  state.delay = null; if (replaceIdentity) state.account.id = "88000000-0000-4000-8000-000000000002"; state.account.capabilities!.can_manage_users = false; state.items = [];
  await refreshSyntheticAuthority(page); await expect(notices(page)).toContainText(copy.empty);
  delayed.release(); await expect.poll(() => delayed.completed).toBe(true);
  await expect(notices(page)).not.toContainText(T.scope_sync_failed); await expect(notices(page).getByRole("link")).toHaveCount(0);
});

test("bounded replacement loads stop at 100 and disclose remaining notices", async ({ page }) => {
  const state = await fixture(page); state.hasMore = true; await home(page);
  for (const limit of [40, 60, 80, 100]) {
    await notices(page).getByRole("button", { name: T.scope_load_more, exact: true }).click();
    await expect.poll(() => Number(new URLSearchParams(state.queries.at(-1)).get("limit"))).toBe(limit);
    await expect(notices(page).locator("li")).toHaveCount(1);
  }
  await expect(notices(page)).toContainText(copy.partial); await expect(notices(page).getByRole("button", { name: T.scope_load_more, exact: true })).toHaveCount(0);
  expect(state.queries.every(query => [...new URLSearchParams(query).keys()].every(key => key === "limit"))).toBe(true);
});

test("notice errors retry independently from home data and never expose server diagnostics", async ({ page }) => {
  const state = await fixture(page); state.error = true; state.homeError = true; await home(page);
  await expect(notices(page).getByRole("status").filter({ hasText: T.load_error })).toBeVisible(); await expect(notices(page).getByRole("alert")).toHaveCount(0); await expect(notices(page)).not.toContainText("PRIVATE diagnostic");
  state.error = false; state.items = [node("handover", { expired: true, deadline: moveEnd, membership_deadline: null, project_ref: null })];
  await notices(page).getByRole("button", { name: T.retry, exact: true }).click(); await expect(notices(page)).toContainText(T.scope_reason_handover_end);
  await expect(notices(page).locator("time")).toHaveCount(1); await expect(notices(page).locator("dt").filter({ hasText: T.scope_cutoff })).toHaveCount(0);
});

test("a current notice denial revalidates account authority without exposing diagnostics", async ({ page }) => {
  const state = await fixture(page); await home(page);
  await expect(notices(page).locator("li")).toHaveCount(1);
  const before = state.meReads;
  state.error = true; state.invalidate = true;
  await notices(page).getByRole("button", { name: T.refresh, exact: true }).click();
  await expect.poll(() => state.meReads).toBeGreaterThan(before);
  await expect(notices(page).locator("li")).toHaveCount(1);
  await expect(notices(page)).not.toContainText("PRIVATE diagnostic");
  expect(state.writes).toEqual([]);
});

test("a stale notice denial cannot invalidate the replacement identity", async ({ page }) => {
  const state = await fixture(page); await home(page);
  await expect(notices(page).locator("li")).toHaveCount(1);
  await page.evaluate(() => {
    (window as unknown as { noticeInvalidations: number }).noticeInvalidations = 0;
    window.addEventListener("hub-content-access-invalidated", () => { (window as unknown as { noticeInvalidations: number }).noticeInvalidations++; });
  });
  const delayed = gate(); state.delay = delayed; state.error = true; state.invalidate = true;
  await notices(page).getByRole("button", { name: T.refresh, exact: true }).click();
  await expect.poll(() => delayed.seen).toBe(1);
  state.delay = null; state.account.id = "88000000-0000-4000-8000-000000000002";
  await refreshSyntheticAuthority(page); await expect(notices(page).locator("li")).toHaveCount(1);
  delayed.release(); await expect.poll(() => delayed.completed).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { noticeInvalidations: number }).noticeInvalidations)).toBe(0);
});

test("notice content is absent from assistant examples and dispatched assistant context", async ({ page }) => {
  const state = await fixture(page); state.items = [node("stale_expired", { deadline: membershipEnd })]; await home(page);
  await expect(page.locator(".workspace-home-examples")).toHaveText(workspaceCopy.ask_prefix + "Safe content task");
  await expect(page.locator(".workspace-home-examples .content-bu-notices")).toHaveCount(0);
  await notices(page).getByRole("button", { name: T.refresh, exact: true }).click(); await expect(notices(page)).toContainText(T.scope_stale_expired);
  expect(await page.evaluate(() => (window as unknown as { noticeAssistantEvents: unknown[] }).noticeAssistantEvents)).toEqual([]);
  await page.locator(".workspace-home-examples button").click();
  expect(await page.evaluate(() => (window as unknown as { noticeAssistantEvents: unknown[] }).noticeAssistantEvents)).toEqual([{ text: workspaceCopy.task_question + ": Safe content task", context: { project_id: publicA } }]);
  expect(state.writes).toEqual([]);
});

test("refreshing the project notice leaves an actual unsaved project form and its original source mounted", async ({ page }) => {
  await page.context().addCookies([{ name: "sena_local_persona", value: "editor", url: origin }]);
  const response = await page.request.get("/api/hub/v1/admin/projects"); expect(response.ok()).toBe(true);
  const project = (await response.json()).data.find((item: any) => item.source?.rem_project_id === "DEMO-001"); expect(project).toBeTruthy();
  let noticeReads = 0; const sourceReads: string[] = [], writes: string[] = [];
  await page.route("**/api/hub/v1/admin/content/bu-notices?*", route => { noticeReads++; return route.fulfill({ json: { data: { items: [handover(project.public_project_id)], has_more: false } } }); });
  page.on("request", request => { if (request.url().includes(`/projects/${project.public_project_id}`)) sourceReads.push(request.url()); if (request.url().includes("/api/hub/") && request.method() !== "GET") writes.push(request.url()); });
  await page.goto(`/website/project/${project.public_project_id}?tab=data&section=identity`);
  const input = page.locator("#public_name"); await expect(input).toBeEditable(); await input.fill("Keep this typed project name");
  await expect(notices(page).locator("li")).toHaveCount(1); const before = sourceReads.length, previousNotices = noticeReads;
  await notices(page).getByRole("button", { name: T.refresh, exact: true }).click(); await expect.poll(() => noticeReads).toBe(previousNotices + 1); await expect(notices(page).locator("li")).toHaveCount(1);
  await expect(input).toHaveValue("Keep this typed project name"); expect(sourceReads).toHaveLength(before); expect(writes).toEqual([]);
});

for (const colorScheme of ["light", "dark"] as const) test(`notice dates, keyboard focus and measured colors fit 390px with reduced motion in ${colorScheme}`, async ({ page }) => {
  const state = await fixture(page, true); state.items = [handover(), node("stale_warning", { manager: true, href: "/admin/accounts", deadline: membershipEnd })];
  await page.setViewportSize({ width: 390, height: 900 }); await page.emulateMedia({ colorScheme, reducedMotion: "reduce" }); await home(page);
  const panel = notices(page); await expect(panel.locator("li")).toHaveCount(2); await fitsWorkspace(page);
  await panel.getByRole("button", { name: T.refresh, exact: true }).focus(); await page.keyboard.press("Tab"); await expect(panel.getByRole("link").first()).toBeFocused();
  const measured = await panel.evaluate(element => {
    const rgb = (color: string) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (color: string) => rgb(color).map(value => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const contrast = (a: string, b: string) => { const first = luminance(a), second = luminance(b); return (Math.max(first, second) + .05) / (Math.min(first, second) + .05); };
    const li = element.querySelector("li")!, strong = li.querySelector("strong")!, link = li.querySelector("a")!;
    const background = getComputedStyle(li).backgroundColor, focus = getComputedStyle(document.activeElement!);
    return { text: contrast(getComputedStyle(strong).color, background), link: contrast(getComputedStyle(link).color, background), border: contrast(getComputedStyle(li).borderInlineStartColor, background), focus: focus.outlineStyle, width: parseFloat(focus.outlineWidth), transition: focus.transitionDuration };
  });
  expect(measured.text).toBeGreaterThanOrEqual(4.5); expect(measured.link).toBeGreaterThanOrEqual(4.5); expect(measured.border).toBeGreaterThanOrEqual(3);
  expect(measured.focus).not.toBe("none"); expect(measured.width).toBeGreaterThanOrEqual(2); expect(measured.transition.split(",").every(value => parseFloat(value) === 0)).toBe(true);
  await page.screenshot({ path: `artifacts/unified-workspace/w6/notices/local-${colorScheme}-390-reduced.png`, fullPage: true });
});
