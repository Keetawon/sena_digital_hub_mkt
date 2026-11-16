import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { withWritingCatalog } from "./writing-catalog-h1-fixture";

// This file is selected only by the existing isolated H1 harness. It uses the
// real guarded API/proxy with synthetic accounts; no provider or hosted service.
test.describe("H1 writing-aid protocol", () => {
  test.use({ baseURL: process.env.HUB_ADMIN_ORIGIN! });
  const api = "/api/hub/v1/admin", headers = { Origin: process.env.HUB_ADMIN_ORIGIN! };
  async function login(page: Page, role: string) {
    await page.context().clearCookies();
    await page.goto("/login?next=%2Fhome");
    await page.locator('input[type="email"]').fill(`hub-test-${role}@example.test`);
    await page.locator('input[type="password"]').fill("H1-synthetic-only!");
    await page.locator("form").getByRole("button").last().click();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  }
  async function registryFlag(page: Page, enabled: boolean): Promise<boolean> {
    // The scoped fixture assigns and restores the explicit catalog special.
    // Field opt-in still uses the ordinary guarded registry writer.
    await login(page, "admin");
    const response = await page.request.get(`${api}/content/fields`); expect(response.status()).toBe(200);
    const catalog = (await response.json()).data; expect(catalog.can_manage).toBe(true);
    const field = catalog.items.find((item: { field_key: string }) => item.field_key === "faq.short_answer");
    expect(field).toBeTruthy();
    const changed = await page.request.patch(`${api}/content/fields/faq.short_answer`, { headers,
      data: { expected_revision: field.revision, changes: { ai_writing_enabled: enabled } } });
    expect(changed.status()).toBe(200); expect((await changed.json()).data.ai_writing_enabled).toBe(enabled);
    return field.ai_writing_enabled;
  }
  test.beforeEach(async ({ page }) => {
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      return ["http:", "https:"].includes(url.protocol) && url.hostname !== "127.0.0.1"
        ? route.abort("blockedbyclient") : route.continue();
    });
  });
  test("anonymous writing state and proposal paths require verified authentication", async ({ page }) => {
    const id = "11111111-1111-4111-8111-111111111111";
    await page.context().clearCookies();
    expect((await page.request.get(`${api}/content/writing-aid/${id}`)).status()).toBe(401);
    expect((await page.request.post(`${api}/content/writing-aid/${id}/proposals`, { headers,
      data: { request_id: randomUUID(), expected_revision: 1, language: "th", mode: "shorten", context: [] } })).status()).toBe(401);
  });
  test("verified writing proposals preserve the source until an ordinary draft save and retain role denial", async ({ page }) => {
    test.setTimeout(180000);
    const key = "writing_h1_" + randomUUID().replaceAll("-", "");
    await withWritingCatalog(page, login, async () => {
      await registryFlag(page, false);
      await login(page, "editor");
      const question = await page.request.put(`${api}/faq/questions/${key}`, { headers, data: { expected_revision: 0,
        changes: { topic: "design", default_level: "corporate", question_template: { th: "Synthetic writing question" },
          answer_kind: "text", show_on_project_pages: false } } });
      expect(question.status()).toBe(200);
      await login(page, "publisher");
      const approved = await page.request.post(`${api}/faq/questions/${key}/approve`, { headers,
        data: { expected_revision: 1, decision: "approved" } });
      expect(approved.status()).toBe(200);
      await login(page, "editor");
      const changes = { question_key: key, scope_type: "corporate", scope_id: "sena", applies_to_project_ids: [],
        question: { th: "Synthetic writing question", en: "Synthetic writing question" },
        short_answer: { th: "  Green 20.5 homes {project} 20.5  ", en: "  Green 20.5 homes {project} 20.5  " },
        answer_kind: "text", fact_keys: [], ai_exposure: "internal" };
      const created = await page.request.post(`${api}/faq`, { headers, data: { expected_revision: 0, changes } });
      expect(created.status()).toBe(200);
      const faq = (await created.json()).data;
      const readFaq = async () => {
        const response = await page.request.get(`${api}/faq/${faq.id}`); expect(response.status()).toBe(200); return (await response.json()).data;
      };
      const initial = await readFaq();
      const translation = initial.translations.find((item: { field_key: string }) => item.field_key === "faq.short_answer");
      expect(translation).toBeTruthy();
      const base = `${api}/content/writing-aid/${translation.id}`;
      const off = await page.request.get(base); expect(off.status()).toBe(200);
      expect((await off.json()).data.eligible).toBe(false);
      await registryFlag(page, true); await login(page, "editor");
      const read = await page.request.get(base); expect(read.status()).toBe(200);
      expect((await read.json()).data).toMatchObject({ eligible: true, editable: true, revision: translation.revision, budget: { synthetic: true } });
      const request = { request_id: randomUUID(), expected_revision: translation.revision, language: "th", mode: "shorten", context: [] };
      const proposal = await page.request.post(base + "/proposals", { headers, data: request });
      expect(proposal.status()).toBe(200);
      const result = (await proposal.json()).data;
      expect(result).toMatchObject({ status: "done", synthetic: true, input_tokens: 0, output_tokens: 0,
        proposal: { before: initial.version.short_answer.th, after: "Green 20.5 homes {project} 20.5", acceptance: "ordinary_draft_save" } });
      const unchanged = await readFaq();
      expect(unchanged.revision).toBe(initial.revision); expect(unchanged.state).toBe("DRAFT");
      expect(unchanged.version).toEqual(initial.version);
      const english = await page.request.post(base + "/proposals", { headers, data: { ...request, request_id: randomUUID(), language: "en", mode: "proofread" } });
      expect(english.status()).toBe(200); expect((await english.json()).data.proposal.before).toBe(initial.version.short_answer.en);
      const replay = await page.request.post(base + "/proposals", { headers, data: request });
      expect(replay.status()).toBe(200); expect((await replay.json()).data.replayed).toBe(true);
      expect((await replay.json()).data.proposal).toBeUndefined();
      const ledger = (await (await page.request.get(base)).json()).data.requests;
      expect(ledger.filter((item: { id: string }) => item.id === request.request_id)).toHaveLength(1);
      await login(page, "viewer");
      const viewer = await page.request.get(base); expect(viewer.status()).toBe(200);
      expect((await viewer.json()).data.requests).toEqual([]);
      expect((await page.request.post(base + "/proposals", { headers, data: { ...request, request_id: randomUUID() } })).status()).toBe(403);
      await login(page, "agency-kin");
      expect((await page.request.get(base)).status()).toBe(403);
      expect((await page.request.post(base + "/proposals", { headers, data: { ...request, request_id: randomUUID() } })).status()).toBe(403);
      await login(page, "editor");
      // This explicit ordinary writer is the same contract as the UI callback;
      // the writing endpoint itself has no accept/save/submit/approve/publish path.
      const saved = await page.request.put(`${api}/faq/${faq.id}`, { headers, data: { expected_revision: initial.revision,
        changes: { ...changes, short_answer: { ...changes.short_answer, th: result.proposal.after } } } });
      expect(saved.status()).toBe(200);
      const current = await readFaq(); expect(current.state).toBe("DRAFT");
      expect(current.revision).toBeGreaterThan(initial.revision);
      expect(current.version.short_answer.th).toBe(result.proposal.after);
      expect((await page.request.post(base + "/proposals", { headers, data: { ...request, request_id: randomUUID() } })).status()).toBe(409);
    });
  });
});
