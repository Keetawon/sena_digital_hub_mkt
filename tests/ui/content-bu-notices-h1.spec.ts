import { expect, test, type Page } from "@playwright/test";
import { contentScopeText as T } from "../../apps/admin/lib/content-scope-text";
import { fitsWorkspace } from "./unified-workspace-helpers";

const copy = {"heading":"การแจ้งเตือน BUD","empty":"ไม่มีการแจ้งเตือน BUD","partial":"แสดงการแจ้งเตือน 100 รายการแรก"} as const;
const endpoint = "/api/hub/v1/admin/content/bu-notices";
const kinds = ["sync_missing", "sync_failed", "stale_data", "stale_warning", "stale_expired", "handover"];
const panel = (page: Page) => page.getByRole("region", { name: copy.heading, exact: true });

test.describe("W6 caller notices on isolated H1", () => {
  test.use({ baseURL: process.env.HUB_ADMIN_ORIGIN! });
  test.beforeEach(async ({ page }) => {
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      return ["http:", "https:"].includes(url.protocol) && url.hostname !== "127.0.0.1" ? route.abort("blockedbyclient") : route.continue();
    });
  });
  async function login(page: Page, role: string, next = "/home") {
    await page.goto("/login?next=" + encodeURIComponent(next));
    await page.locator('input[type="email"]').fill(`hub-test-${role}@example.test`);
    await page.locator('input[type="password"]').fill("H1-synthetic-only!");
    await page.locator("form").getByRole("button").last().click();
    await expect(page).toHaveURL(process.env.HUB_ADMIN_ORIGIN! + next);
  }
  for (const role of ["admin", "viewer"] as const) for (const width of [1280, 390]) {
    test(`real ${role} caller notice projection stays private at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme: width === 390 ? "dark" : "light", reducedMotion: "reduce" });
      await login(page, role);
      const accountResponse = await page.request.get("/api/hub/v1/me"); expect(accountResponse.status()).toBe(200);
      const account = (await accountResponse.json()).data;
      expect(account.capabilities.can_manage_users).toBe(role === "admin");
      const response = await page.request.get(endpoint + "?limit=20"); expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toContain("private"); expect(response.headers()["cache-control"]).toContain("no-store");
      const data = (await response.json()).data;
      expect(Object.keys(data).sort()).toEqual(["has_more", "items"]); expect(data.items.length).toBeLessThanOrEqual(20); expect(typeof data.has_more).toBe("boolean");
      for (const item of data.items) {
        expect(kinds).toContain(item.kind); expect(item.manager).toBe(role === "admin");
        if (role === "viewer") { expect(["sync_missing", "sync_failed", "stale_data"]).not.toContain(item.kind); expect(item.href).toBeNull(); }
      }
      await expect(panel(page).getByRole("button", { name: T.refresh, exact: true })).toBeEnabled();
      await expect(panel(page).getByRole("alert")).toHaveCount(0);
      await expect(panel(page).locator("li")).toHaveCount(data.items.length);
      if (!data.items.length) await expect(panel(page)).toContainText(copy.empty);
      const accountLinks = data.items.filter((item: { href?: string; manager?: boolean }) => item.manager && item.href === "/admin/accounts");
      await expect(panel(page).locator('a[href="/admin/accounts"]')).toHaveCount(accountLinks.length);
      await expect(page.locator(".workspace-home-examples .content-bu-notices")).toHaveCount(0);
      for (const button of await page.locator(".workspace-home-examples button").all()) await expect(button).toBeDisabled();
      const writes: string[] = []; page.on("request", request => { if (request.url().includes("/api/hub/") && request.method() !== "GET") writes.push(request.url()); });
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === endpoint);
      await panel(page).getByRole("button", { name: T.refresh, exact: true }).click(); expect((await refreshed).status()).toBe(200);
      await expect(panel(page).getByRole("button", { name: T.refresh, exact: true })).toBeEnabled();
      await fitsWorkspace(page); expect(writes).toEqual([]);
      await page.screenshot({ path: `artifacts/unified-workspace/w6/notices/h1-${role}-${width}.png`, fullPage: true });
      expect([404, 422]).toContain((await page.request.get(endpoint + "?limit=101")).status());
      expect([404, 422]).toContain((await page.request.get(endpoint + "?account_id=" + account.id)).status());
    });
  }
  test("real selected-project notice API uses the exact public phase reference and rejects missing projects", async ({ page }) => {
    await login(page, "viewer");
    const projectResponse = await page.request.get("/api/hub/v1/admin/projects"); expect(projectResponse.status()).toBe(200);
    const project = (await projectResponse.json()).data.find((item: any) => item.source?.rem_project_id === "H1-PROJECT-001"); expect(project).toBeTruthy();
    const response = await page.request.get(endpoint + "?" + new URLSearchParams({ project: project.public_project_id, limit: "20" })); expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const projected = (await response.json()).data;
    expect(projected.items.every((item: { project_ref: string | null }) => item.project_ref === null || item.project_ref === project.public_project_id)).toBe(true);
    const queries: string[] = []; page.on("request", request => { const url = new URL(request.url()); if (url.pathname === endpoint) queries.push(url.search); });
    await page.goto(`/website/project/${project.public_project_id}?tab=faq`);
    await expect(panel(page)).toHaveAttribute("data-notice-project", project.public_project_id);
    await expect(panel(page).getByRole("button", { name: T.refresh, exact: true })).toBeEnabled();
    expect(queries.length).toBeGreaterThan(0); expect(queries.every(query => new URLSearchParams(query).get("project") === project.public_project_id)).toBe(true);
    await expect(panel(page).locator('a[href="/admin/accounts"]')).toHaveCount(0);
    expect((await page.request.get(endpoint + "?project=missing_notice_project")).status()).toBe(403);
  });
  for (const colorScheme of ["light", "dark"] as const) test(`hosted notice transport renders separate cutoff dates and keyboard focus at 390px in ${colorScheme}`, async ({ page }) => {
    // Only notice transport is controlled here; hosted login, source authority,
    // entity projection, FAQ and the empty real notice API above stay real.
    await page.setViewportSize({ width: 390, height: 900 }); await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await login(page, "viewer");
    const response = await page.request.get("/api/hub/v1/admin/projects"); expect(response.ok()).toBe(true);
    const project = (await response.json()).data.find((item: any) => item.source?.rem_project_id === "H1-PROJECT-001"); expect(project).toBeTruthy();
    const deadline = "2030-01-10T01:02:03Z", membershipDeadline = "2030-01-08T00:00:00Z";
    let expired = false;
    await page.route("**/api/hub/v1/admin/content/bu-notices?*", route => route.fulfill({ json: { data: { items: [
      { id: "hosted-move", kind: "handover", project_ref: project.public_project_id, tab: "faq", manager: false, href: null, deadline, membership_deadline: membershipDeadline, expired },
      { id: "hosted-stale", kind: expired ? "stale_expired" : "stale_warning", project_ref: project.public_project_id, manager: false, href: null, deadline: membershipDeadline },
    ], has_more: false } } }));
    const writes: string[] = []; page.on("request", request => { if (request.url().includes("/api/hub/") && request.method() !== "GET") writes.push(request.url()); });
    await page.goto(`/website/project/${project.public_project_id}?tab=faq`);
    const current = panel(page); await expect(current.locator("li")).toHaveCount(2);
    await expect(current).toContainText(T.scope_handover); await expect(current).toContainText(T.scope_stale_warning);
    await expect(current.locator(`time[datetime="${deadline}"]`)).toContainText("08:02:03");
    await expect(current.locator(`time[datetime="${membershipDeadline}"]`).first()).toContainText("07:00:00");
    await expect(current.locator("dt").filter({ hasText: T.scope_handover_end })).toHaveCount(1);
    await expect(current.locator("dt").filter({ hasText: T.scope_cutoff })).toHaveCount(2);
    expired = true; await current.getByRole("button", { name: T.refresh, exact: true }).click();
    await expect(current).toContainText(T.scope_reason_handover_end); await expect(current).toContainText(T.scope_stale_expired);
    await expect(current).not.toContainText(T.scope_handover); await expect(current.locator('a[href="/admin/accounts"]')).toHaveCount(0);
    const refresh = current.getByRole("button", { name: T.refresh, exact: true }); await refresh.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab"); await expect(refresh).toBeFocused();
    const focus = await refresh.evaluate(element => ({ style: getComputedStyle(element).outlineStyle, width: parseFloat(getComputedStyle(element).outlineWidth), transition: getComputedStyle(element).transitionDuration }));
    expect(focus.style).not.toBe("none"); expect(focus.width).toBeGreaterThanOrEqual(2); expect(focus.transition.split(",").every(value => parseFloat(value) === 0)).toBe(true);
    await fitsWorkspace(page); expect(writes).toEqual([]);
    await page.screenshot({ path: `artifacts/unified-workspace/w6/notices/h1-${colorScheme}-390-cutoffs.png`, fullPage: true });
  });
  test("notice reads require hosted authentication and reject agencies", async ({ page }) => {
    expect((await page.request.get(endpoint + "?limit=20")).status()).toBe(401);
    await login(page, "agency-kin", "/ads/registry/inbox");
    expect((await page.request.get(endpoint + "?limit=20")).status()).toBe(403);
    await expect(page.locator(".content-bu-notices")).toHaveCount(0);
  });
});
