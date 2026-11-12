import { expect, test, type Page } from "@playwright/test";
import { can, canOpenPage, canSpecial, emptyCapabilities, isContentAdmin, type HubAccount } from "../../apps/admin/lib/hub-permissions";
import { contentScopeText as T } from "../../apps/admin/lib/content-scope-text";

const origin = "http://127.0.0.1:3000", sourceAt = "2030-01-01T00:00:00Z", cutoff = "2030-01-08T00:00:00Z";
const managerAccount = (): HubAccount => ({
  id: "88000000-0000-4000-8000-000000000081", status: "ACTIVE", hub_role: "viewer", role: "viewer",
  capabilities: { ...emptyCapabilities, published_consumer: true, can_manage_users: true,
    tabs: Object.fromEntries(["projects", "brands", "knowledge", "promotions", "releases"].map(tab => [tab, { view: false, edit: false, approve: false }])) },
});
type Notice = { id: string; kind: string; manager: boolean; href: string | null; source_snapshot_at: string | null; deadline: string | null };
const notice = (kind: string): Notice => ({ id: `manager:${kind}`, kind, manager: true,
  href: kind === "stale_expired" ? "/admin/accounts" : null, source_snapshot_at: sourceAt, deadline: cutoff });
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release, seen: 0, completed: false }; }

async function fixture(page: Page) {
  const state = { account: managerAccount(), items: [notice("sync_failed")], delay: null as ReturnType<typeof gate> | null,
    queries: [] as string[], unexpected: [] as string[], writes: [] as string[], meReads: 0 };
  await page.context().addCookies([{ name: "sena_local_persona", value: "admin", url: origin }]);
  // The local cookie admits the server-rendered fixture page. Every client
  // control sees this explicitly limited manager, not the cookie's role label.
  await page.route("**/api/hub/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const done = (data: unknown) => route.fulfill({ json: { data } });
    if (request.method() !== "GET") { state.writes.push(`${request.method()} ${path}`); return route.fulfill({ status: 500, json: { error: { code: "unexpected_notice_write" } } }); }
    if (path === "/api/hub/v1/me") { state.meReads++; return done(state.account); }
    if (path === "/api/hub/v1/accounts/display-names") return done([]);
    if (path === "/api/hub/v1/admin/accounts") return done({ items: [], events: [], permission_events: [], agencies: [], actor_id: state.account.id });
    if (path === "/api/hub/v1/admin/account-invites") return done({ items: [], login_url: origin + "/login" });
    if (path === "/api/hub/v1/admin/permissions/catalog") return done({ tabs: [], templates: [], catalog_digest: "a".repeat(64) });
    if (path === "/api/hub/v1/admin/accounts/bu-sync-runs") {
      expect(url.searchParams.toString()).toBe("limit=50");
      return state.account.capabilities?.can_manage_users ? done({ items: [], next_cursor: null }) : route.fulfill({ status: 403, json: { error: { code: "content_scope_permission" } } });
    }
    if (path === "/api/hub/v1/admin/content/bu-notices") {
      state.queries.push(url.searchParams.toString());
      const response = { items: structuredClone(state.items), has_more: false }, waiting = state.delay;
      if (waiting) { waiting.seen++; await waiting.promise; }
      try { await done(response); } finally { if (waiting) waiting.completed = true; }
      return;
    }
    // The unrelated assistant may check its entry ceiling; no source payload
    // or proposal is made available by the account-management capability.
    if (path === "/api/hub/v1/admin/assistant/config") return route.fulfill({ status: 403, json: { error: { code: "forbidden" } } });
    state.unexpected.push(path);
    return route.fulfill({ status: 403, json: { error: { code: "unexpected_source_read" } } });
  });
  return state;
}
const panel = (page: Page) => page.locator(".scope-management > .content-bu-notices");
async function open(page: Page) { await page.goto("/admin/accounts"); await expect(panel(page)).toBeVisible(); }
async function refreshAuthority(page: Page, state: Awaited<ReturnType<typeof fixture>>) {
  const previous = state.meReads;
  await page.evaluate(() => window.dispatchEvent(new Event("hub-accounts-changed")));
  await expect.poll(() => state.meReads).toBeGreaterThan(previous);
}
function unchangedAuthority(state: Awaited<ReturnType<typeof fixture>>) {
  expect(state.writes).toEqual([]); expect(state.unexpected).toEqual([]);
  expect(state.queries.every(query => query === "limit=20")).toBe(true);
  expect(state.account.capabilities?.special_actions).toEqual({});
  for (const tab of ["projects", "brands", "knowledge", "promotions", "releases"]) {
    for (const level of ["view", "edit", "approve"] as const) expect(can(state.account.capabilities, tab, level)).toBe(false);
  }
}

test("an account manager without source View has Accounts entry but no home, publication or Admin authority", () => {
  const account = managerAccount();
  expect(canOpenPage(account, "/admin/accounts", new URLSearchParams())).toBe(true);
  expect(canOpenPage(account, "/home", new URLSearchParams())).toBe(false);
  expect(canOpenPage(account, "/settings/activity", new URLSearchParams())).toBe(false);
  expect(isContentAdmin(account)).toBe(false);
  expect(canSpecial(account.capabilities, "knowledge.publish_web")).toBe(false);
  expect(can(account.capabilities, "releases", "approve")).toBe(false);
});

test("failed sync is visible on Accounts while run history stays collapsed and no Admin settings or content loads", async ({ page }) => {
  const state = await fixture(page); await open(page);
  await expect(panel(page)).toContainText(T.scope_sync_failed);
  await expect(page.locator(".scope-management > details").first()).not.toHaveAttribute("open");
  expect(await panel(page).evaluate(element => element.closest("details") === null)).toBe(true);
  await expect(page.locator(".scope-settings")).toHaveCount(0);
  await expect(page.getByText(T.scope_admin_only, { exact: true })).toBeVisible();
  await expect(panel(page).getByRole("link")).toHaveCount(0);
  unchangedAuthority(state);
  await page.screenshot({ path: `artifacts/unified-workspace/w6/account-notices-${page.viewportSize()?.width}.png`, fullPage: true });
});

for (const [kind, label] of [["stale_data", T.scope_stale_data], ["stale_warning", T.scope_stale_warning], ["stale_expired", T.scope_stale_expired]] as const) {
  test(`manager-only Accounts exposes ${kind} and the exact BUD access cutoff`, async ({ page }) => {
    const state = await fixture(page); state.items = [notice(kind)]; await open(page);
    await expect(panel(page)).toContainText(label);
    await expect(panel(page).locator(`time[datetime="${sourceAt}"]`)).toBeVisible();
    await expect(panel(page).locator(`time[datetime="${cutoff}"]`)).toContainText("07:00:00");
    await expect(panel(page).locator("dt").filter({ hasText: T.scope_cutoff })).toHaveCount(1);
    const temporary = panel(page).getByRole("link", { name: T.scope_temporary_grant, exact: true });
    if (kind === "stale_expired") { await expect(temporary).toBeVisible(); await expect(temporary).toHaveAttribute("href", "/admin/accounts"); }
    else await expect(temporary).toHaveCount(0);
    await expect(page.locator(".scope-management > details").first()).not.toHaveAttribute("open");
    unchangedAuthority(state);
  });
}

test("manager revocation removes already displayed account notices without acquiring content rights", async ({ page }) => {
  const state = await fixture(page); state.items = [notice("stale_expired")]; await open(page);
  await expect(panel(page)).toContainText(T.scope_stale_expired);
  state.account.capabilities!.can_manage_users = false;
  await refreshAuthority(page, state);
  await expect(page.locator(".scope-management")).toHaveCount(0);
  await expect(page.locator(".content-bu-notices")).toHaveCount(0);
  await expect(page.getByRole("link", { name: T.scope_temporary_grant, exact: true })).toHaveCount(0);
  unchangedAuthority(state);
});

test("a delayed manager notice cannot return after account-management authority is removed", async ({ page }) => {
  const state = await fixture(page), waiting = gate(); state.delay = waiting;
  await open(page); await expect.poll(() => waiting.seen).toBeGreaterThan(0);
  state.account.capabilities!.can_manage_users = false;
  await refreshAuthority(page, state); await expect(page.locator(".scope-management")).toHaveCount(0);
  waiting.release(); await expect.poll(() => waiting.completed).toBe(true);
  await expect(page.locator(".content-bu-notices")).toHaveCount(0);
  await expect(page.locator('[data-bu-notice="sync_failed"]')).toHaveCount(0);
  unchangedAuthority(state);
});

test("an Admin role without account-management authority cannot mount the account notice panel", async ({ page }) => {
  const state = await fixture(page); state.account.hub_role = "admin"; state.account.role = "admin"; state.account.capabilities!.can_manage_users = false;
  await page.goto("/admin/accounts"); await expect.poll(() => state.meReads).toBeGreaterThan(0);
  await expect(page.locator(".accounts-admin")).toHaveCount(0);
  await expect(page.locator(".content-bu-notices")).toHaveCount(0);
  expect(state.queries).toEqual([]); unchangedAuthority(state);
});
