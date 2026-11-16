import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writingText as text } from "../../apps/admin/lib/writing-aid";
import { withWritingCatalog } from "./writing-catalog-h1-fixture";

// Existing isolated H1 harness only. Temporary synthetic grants and field opt-in
// use normal API commands and are restored; no config loader or external service.
test.describe("H1 writing field integration", () => {
  test.use({ baseURL: process.env.HUB_ADMIN_ORIGIN! });
  const api = "/api/hub/v1/admin", headers = { Origin: process.env.HUB_ADMIN_ORIGIN! };
  async function login(page: Page, role: string) {
    await page.context().clearCookies(); await page.goto("/login?next=%2Fhome");
    await page.locator('input[type="email"]').fill(`hub-test-${role}@example.test`);
    await page.locator('input[type="password"]').fill("H1-synthetic-only!");
    await page.locator("form").getByRole("button").last().click();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  }
  async function currentField(page: Page) {
    const response = await page.request.get(api + "/content/fields"); expect(response.status()).toBe(200);
    const catalog = (await response.json()).data; expect(catalog.can_manage).toBe(true);
    const field = catalog.items.find((item: { field_key: string }) => item.field_key === "faq.short_answer"); expect(field).toBeTruthy(); return field;
  }
  test.beforeEach(async ({ page }) => {
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      return ["http:", "https:"].includes(url.protocol) && url.hostname !== "127.0.0.1" ? route.abort("blockedbyclient") : route.continue();
    });
  });
  test("explicit registry opt-in, field proposal rejection and locale-only ordinary acceptance", async ({ page }) => {
    test.setTimeout(180000);
    await withWritingCatalog(page, login, async original => {
      const disabled = await page.request.patch(api + "/content/fields/faq.short_answer", { headers, data: { expected_revision: original.revision, changes: { ai_writing_enabled: false } } });
      expect(disabled.status()).toBe(200);
      await page.goto("/settings?section=fields");
      const row = page.locator("article.content-card").filter({ has: page.getByRole("heading", { name: original.label.th, exact: true }) });
      await row.locator(".content-toolbar > button").click();
      await expect(row.getByLabel(text.writing_enabled, { exact: true })).not.toBeChecked();
      await row.getByLabel(text.writing_enabled, { exact: true }).check();
      const enabled = page.waitForResponse(response => response.url().includes("/content/fields/faq.short_answer") && response.request().method() === "PATCH");
      await row.locator("form button.primary").click(); expect((await enabled).status()).toBe(200);
      expect((await currentField(page)).ai_writing_enabled).toBe(true);
      await login(page, "editor");
      const key = "writing_field_h1_" + randomUUID().replaceAll("-", "");
      const question = await page.request.put(api + "/faq/questions/" + key, { headers, data: { expected_revision: 0,
        changes: { topic: "design", default_level: "corporate", question_template: { th: "Synthetic field question" }, answer_kind: "text", show_on_project_pages: false } } });
      expect(question.status()).toBe(200);
      await login(page, "publisher"); expect((await page.request.post(api + "/faq/questions/" + key + "/approve", { headers, data: { expected_revision: 1, decision: "approved" } })).status()).toBe(200);
      await login(page, "editor");
      const before = "  Green 20.5 homes {project} 20.5  ", english = "Original English 20.5 {project}";
      const created = await page.request.post(api + "/faq", { headers, data: { expected_revision: 0, changes: { question_key: key, scope_type: "corporate", scope_id: "sena", applies_to_project_ids: [],
        question: { th: "Synthetic field question", en: "Synthetic field question" }, short_answer: { th: before, en: english }, answer_kind: "text", fact_keys: [], ai_exposure: "internal" } } });
      expect(created.status()).toBe(200); const faq = (await created.json()).data;
      const read = async () => { const response = await page.request.get(api + "/faq/" + faq.id); expect(response.status()).toBe(200); return (await response.json()).data; };
      const initial = await read();
      await page.goto(`/website/corporate/sena?tab=faq&faq=${faq.id}`);
      const control = page.locator('[data-writing-field="faq.short_answer"][data-writing-language="th"]');
      const writes: { path: string; body: any }[] = [];
      page.on("request", request => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) && request.url().includes("/api/hub/v1/admin/")) writes.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() }); });
      await control.getByRole("button", { name: text.shorten, exact: true }).click(); await expect(control.locator(".writing-aid-review")).toBeVisible();
      await expect(control).toContainText("{project}"); await expect(control).toContainText("20.5");
      await control.getByRole("button", { name: text.writing_reject, exact: true }).click();
      expect((await read()).revision).toBe(initial.revision);
      expect(writes.filter(write => !write.path.includes("/writing-aid/"))).toEqual([]);
      await control.getByRole("button", { name: text.shorten, exact: true }).click(); await expect(control.locator(".writing-aid-review")).toBeVisible();
      await control.getByRole("button", { name: text.writing_accept, exact: true }).click(); await expect(control.locator(".writing-aid-review")).toHaveCount(0);
      const updated = await read(); expect(updated.state).toBe("DRAFT"); expect(updated.revision).toBeGreaterThan(initial.revision);
      expect(updated.version.short_answer).toEqual({ th: before.trim(), en: english });
      const ordinary = writes.filter(write => !write.path.includes("/writing-aid/")); expect(ordinary).toHaveLength(1);
      expect(ordinary[0]).toMatchObject({ path: api + "/faq/" + faq.id, body: { expected_revision: initial.revision, changes: { short_answer: { th: before.trim(), en: english } } } });
      expect(writes.some(write => /submit|approve|publish/.test(write.path))).toBe(false);
      await page.screenshot({ path: "artifacts/unified-workspace/w7/field-h1-accepted.png", fullPage: true });
    });
  });
});
