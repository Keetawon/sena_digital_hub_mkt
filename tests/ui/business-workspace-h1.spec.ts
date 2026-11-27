import { expect, test, type Page } from "@playwright/test";
import { fitsWorkspace, workspaceText as text } from "./unified-workspace-helpers";
import { businessWorkspaceText as businessText } from "../../apps/admin/lib/business-workspace-text";
import { workflowInventoryPath } from "../../apps/admin/lib/content-workflow";

test.describe("H1 fixed business workspace", () => {
  test.use({ baseURL: process.env.HUB_ADMIN_ORIGIN! });
  test.beforeEach(async ({ page }) => {
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      return ["http:", "https:"].includes(url.protocol) && url.hostname !== "127.0.0.1" ? route.abort("blockedbyclient") : route.continue();
    });
  });
  async function login(page: Page) {
    await page.goto("/login?next=%2Fwebsite%2Fbusiness%2Fresidential");
    await page.locator('input[type="email"]').fill("hub-test-editor@example.test");
    await page.locator('input[type="password"]').fill("H1-synthetic-only!");
    await page.locator("form").getByRole("button").last().click();
    await expect(page).toHaveURL(/\/website\/business\/residential/);
  }
  for (const width of [1280, 390]) test(`real business catalog, hierarchy, content, FAQ and history at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme: width === 390 ? "dark" : "light", reducedMotion: "reduce" });
    const inventoryLoaded = page.waitForResponse(response => new URL(response.url()).pathname === "/api/hub/v1/admin/content-workflow/items");
    await login(page);
    expect((await inventoryLoaded).status()).toBe(200);
    const inventory = await page.request.get("/api/hub/" + workflowInventoryPath({ level: "business", id: "residential" }));
    expect(inventory.status()).toBe(200);
    expect((await inventory.json()).data.scope).toEqual({ level: "business", id: "residential", phase: null });
    const intake = await page.request.get("/api/hub/v1/admin/faq-intake/clusters?level=business&limit=100");
    expect(intake.status()).toBe(200);
    const malformed = await page.request.get("/api/hub/v1/admin/content-workflow/items?level=business%0A&id=residential");
    expect(malformed.status()).toBe(404);
    await expect(page.locator(".workspace-heading [role=alert]")).toHaveCount(0);
    const catalog = await page.request.get("/api/hub/v1/admin/content/businesses"); expect(catalog.ok()).toBe(true);
    expect(catalog.headers()["cache-control"]).toContain("no-store");
    const businesses = (await catalog.json()).data.items;
    expect(businesses.map((item: { code: string }) => item.code)).toEqual(["residential", "solar", "senx", "ngernsod_jaidee"]);
    expect(Object.keys(businesses[0]).sort()).toEqual(["code", "label"]);
    await expect(page.locator(".workspace-heading h1")).toHaveText(businesses[0].label.th);
    const children = await page.request.get("/api/hub/v1/admin/content/workspace/tree?parent_kind=corporate&parent_ref=sena&limit=50"); expect(children.ok()).toBe(true);
    expect((await children.json()).data.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "business", ref: "residential", parent: { kind: "corporate", ref: "sena" } })]));
    const writes: string[] = []; page.on("request", request => { if (request.url().includes("/api/hub/") && request.method() !== "GET") writes.push(request.url()); });
    await expect(page.locator("#workspace-tab-unit-types, #workspace-tab-media, .workspace-heading select")).toHaveCount(0);
    await page.locator("#workspace-tab-data").click(); await expect(page.locator('[data-business-content="residential"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: businessText.narrative, exact: true })).toBeVisible();
    await page.getByRole("button", { name: businessText.contacts, exact: true }).click();
    await expect(page.locator('[data-business-content] .content-section')).toBeVisible(); await fitsWorkspace(page);
    await page.locator("#workspace-tab-data").focus();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/unified-workspace/w5/h1-data-${width}.png`, fullPage: true });
    await page.locator("#workspace-tab-faq").click(); await expect(page.locator(".entity-embedded-faq")).toBeVisible();
    await expect(page.locator(".entity-embedded-faq")).toContainText(text.business); await fitsWorkspace(page);
    await page.locator("#workspace-tab-faq").focus();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/unified-workspace/w5/h1-faq-${width}.png`, fullPage: true });
    await page.locator("#workspace-tab-history").click(); await expect(page.locator("#workspace-panel-history")).toBeVisible(); await fitsWorkspace(page);
    await page.locator("#workspace-tab-history").focus();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/unified-workspace/w5/h1-history-${width}.png`, fullPage: true });
    const unknown = await page.request.get("/api/hub/v1/admin/content/businesses/not_a_business/content"); expect(unknown.status()).toBe(404);
    expect(writes).toEqual([]);
  });
  test("business deep links remain behind hosted authentication", async ({ page }) => {
    await page.goto("/website/business/residential?tab=faq&question=business_missing");
    await expect(page).toHaveURL(/\/login/);
    const response = await page.request.get("/api/hub/v1/admin/content/businesses/residential/content");
    expect([401, 403]).toContain(response.status());
    await expect(page.locator("[data-business-content]")).toHaveCount(0);
  });
});
