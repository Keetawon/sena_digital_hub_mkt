import { expect, type Page } from "@playwright/test";

const api = "/api/hub/v1/admin";
const special = "projects.manage_field_catalog";
const identities = {
  admin: { id: "70000000-0000-0000-0000-000000000004", email: "hub-test-admin@example.test" },
  editor: { id: "70000000-0000-0000-0000-000000000001", email: "hub-test-editor@example.test" },
} as const;
type Persona = keyof typeof identities;
type Access = {
  tabs: Record<string, string[]>;
  can_manage_users: boolean;
  template: { code: string; version: number } | null;
  customised: boolean;
};
type Account = {
  id: string; email: string; status: string; hub_role: string; updated_at: string; access: Access;
};
type Field = { field_key: string; revision: number; ai_writing_enabled: boolean; label: { th: string } };
type Login = (page: Page, role: Persona) => Promise<void>;

/** Only the attested local H1 profile; all changes use the ordinary Accounts API. */
export async function withWritingCatalog(page: Page, login: Login, run: (original: Field) => Promise<void>) {
  expect(process.env.HUB_HOSTED_TEST_SIMULATION).toBe("1");
  expect(process.env.HUB_ENV).toBe("hosted-test");
  const origin = new URL(process.env.HUB_ADMIN_ORIGIN!);
  expect(origin.protocol).toBe("http:"); expect(origin.hostname).toBe("127.0.0.1");
  expect(Number(origin.port)).toBeGreaterThanOrEqual(1024);
  expect([3000, 8000, 55432]).not.toContain(Number(origin.port));
  expect(origin.pathname).toBe("/"); expect(origin.search + origin.hash + origin.username + origin.password).toBe("");
  const headers = { Origin: origin.origin };

  async function accounts(actor: Persona) {
    const response = await page.request.get(api + "/accounts"); expect(response.status()).toBe(200);
    const data = (await response.json()).data as { actor_id: string; items: Account[] };
    expect(data.actor_id).toBe(identities[actor].id);
    return Object.fromEntries((Object.keys(identities) as Persona[]).map(role => {
      const rows = data.items.filter(row => row.id === identities[role].id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ ...identities[role], status: "ACTIVE", hub_role: role });
      return [role, rows[0]];
    })) as Record<Persona, Account>;
  }
  async function field() {
    const response = await page.request.get(api + "/content/fields"); expect(response.status()).toBe(200);
    const catalog = (await response.json()).data as { can_manage: boolean; items: Field[] };
    const rows = catalog.items.filter(item => item.field_key === "faq.short_answer");
    expect(rows).toHaveLength(1); return { canManage: catalog.can_manage, value: rows[0] };
  }
  async function deniedRegistryWrite() {
    const before = await field(); expect(before.canManage).toBe(false);
    const denied = await page.request.patch(api + "/content/fields/faq.short_answer", { headers,
      data: { expected_revision: before.value.revision, changes: { ai_writing_enabled: !before.value.ai_writing_enabled } } });
    expect(denied.status()).toBe(403);
    expect(await field()).toEqual(before);
  }
  async function assign(actor: Persona, target: Persona, access: Access) {
    await login(page, actor);
    const current = (await accounts(actor))[target];
    const response = await page.request.post(`${api}/accounts/${current.id}/permissions`, { headers, data: {
      tabs: access.tabs, can_manage_users: access.can_manage_users,
      confirm_manage_users: access.can_manage_users && !current.access.can_manage_users,
      updated_at: current.updated_at, note: "Temporary synthetic H1 writing catalog fixture",
    } });
    expect(response.status()).toBe(200);
    // No template assignment: retain the original template and every unrelated grant.
    expect((await accounts(actor))[target].access).toEqual(access);
  }
  function catalogAccess(original: Access, manager = original.can_manage_users): Access {
    const result = structuredClone(original);
    result.tabs.projects = [...new Set([...(result.tabs.projects ?? []), special])].sort();
    result.can_manage_users = manager;
    result.customised = true;
    return result;
  }

  await login(page, "admin");
  const original = await accounts("admin");
  const adminAccess = structuredClone(original.admin.access), editorAccess = structuredClone(original.editor.access);
  expect(adminAccess.can_manage_users).toBe(true);
  expect(adminAccess.tabs.projects ?? []).not.toContain(special);
  const originalField = (await field()).value;
  let editorTouched = false, adminTouched = false, failed = false;
  let failure: unknown;
  const cleanupErrors: unknown[] = [];
  async function cleanup(action: () => Promise<void>) {
    try { await action(); } catch (error) { cleanupErrors.push(error); }
  }
  try {
    await deniedRegistryWrite(); // Actual Admin still needs the explicit special.
    // Mark before sending: a lost response must still trigger fresh-read restoration.
    editorTouched = true;
    await assign("admin", "editor", catalogAccess(editorAccess, true));
    await login(page, "editor");
    const manager = (await accounts("editor")).editor;
    expect(manager.access.can_manage_users).toBe(true);
    expect(manager.access.tabs.projects).toContain(special);
    await deniedRegistryWrite(); // Manager + special does not make an Editor an Admin.
    adminTouched = true;
    await assign("editor", "admin", catalogAccess(adminAccess));
    await login(page, "admin");
    expect((await field()).canManage).toBe(true);
    await run(structuredClone(originalField));
  } catch (error) {
    failed = true; failure = error;
  } finally {
    // Restore the registry while authority is still held, then Admin, then Editor.
    // Continue later cleanup even if an earlier request fails; never erase audit rows.
    if (adminTouched) {
      await cleanup(async () => {
        await login(page, "admin");
        const current = await field();
        if (current.value.ai_writing_enabled !== originalField.ai_writing_enabled) {
          expect(current.canManage).toBe(true);
          const restored = await page.request.patch(api + "/content/fields/faq.short_answer", { headers, data: {
            expected_revision: current.value.revision, changes: { ai_writing_enabled: originalField.ai_writing_enabled },
          } });
          expect(restored.status()).toBe(200);
        }
        expect((await field()).value.ai_writing_enabled).toBe(originalField.ai_writing_enabled);
      });
      await cleanup(() => assign("editor", "admin", adminAccess));
    }
    if (editorTouched) await cleanup(() => assign("admin", "editor", editorAccess));
    await cleanup(async () => {
      await login(page, "admin");
      const restored = await accounts("admin");
      expect(restored.admin.access).toEqual(adminAccess); expect(restored.editor.access).toEqual(editorAccess);
      await deniedRegistryWrite();
    });
  }
  if (cleanupErrors.length) throw new AggregateError(failed ? [failure, ...cleanupErrors] : cleanupErrors, "H1 writing fixture restoration failed");
  if (failed) throw failure;
}
