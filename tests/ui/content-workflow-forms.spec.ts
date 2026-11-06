import { expect, test, type Page, type Route } from '@playwright/test';
import { workflowText as text, type WorkflowKind, type WorkflowSnapshot } from '../../apps/admin/lib/content-workflow';
import { workspaceProjection, fitsWorkspace, openWorkspaceTab } from './unified-workspace-helpers';

const origin = 'http://127.0.0.1:3000', publicId = 'WORKFLOW-PRIMARY-UI', brandId = 'WORKFLOW-BRAND-UI', phase = 'REM-WORKFLOW-EXACT';
const stamp = '2026-11-04T09:00:00+00:00', newerStamp = '2026-11-04T09:01:00+00:00';
const ids = {
  project: '71000000-0000-4000-8000-000000000001', model: '71000000-0000-4000-8000-000000000002', brand: '71000000-0000-4000-8000-000000000003',
  section: '71000000-0000-4000-8000-000000000004', point: '71000000-0000-4000-8000-000000000005', contact: '71000000-0000-4000-8000-000000000006', fact: '71000000-0000-4000-8000-000000000007',
};
const identity = (kind: WorkflowKind) => kind === 'building' ? { project_id: ids.project, building_key: 'B-01' }
  : kind === 'selling_point' ? { project_id: ids.project, point_key: ids.point } : { id: ids[kind as keyof typeof ids] };
const hash = (kind: string) => ({ project: '1', model: '2', brand: '3', section: '4', selling_point: '5', contact: '6', fact: '7', building: '8' }[kind] ?? 'a').repeat(64);
function snapshot(kind: WorkflowKind): WorkflowSnapshot {
  const source = kind === 'brand' ? 'brands' : 'projects';
  return { kind, identity: identity(kind), expected_hash: hash(kind), source_revision: ['project', 'model', 'brand'].includes(kind) ? null : 5,
    source_updated_at: ['project', 'model', 'brand'].includes(kind) ? stamp : null, source_tab: source, source_tabs: [source], state: 'DRAFT',
    version_id: null, version_no: null, approved_by: null, approved_at: null, decision_reason: null, self_approval: false, history: [], needs_reapproval: false,
    can_edit: true, can_submit: true, can_approve: false, can_return: false, can_withdraw: false, can_save_approve: true, approval_requires_reason: true } as WorkflowSnapshot;
}
const field = (key: string, entity: string, section: string) => ({ field_key: key, entity, section, label: { th: 'Synthetic ' + key }, help: {}, sort: 1,
  value_kind: 'text', unit: null, source_policy: 'mkt', source_ref: null, owner_role: 'Marketing', required_for: {}, locales_required: ['th'], surfaces: [],
  default_ai_exposure: 'internal', review_every_days: null, validation: {}, status: 'active', revision: 1 });

/** Synthetic wire contracts exercise the real mounted forms, never substitute for API permission tests. */
async function fixture(page: Page, levels = ['view', 'edit', 'approve']) {
  expect((await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role: 'viewer' } })).ok()).toBeTruthy();
  const account = (await (await page.request.get('/api/hub/v1/me')).json()).data;
  let me = { ...account, capabilities: { ...account.capabilities, tabs: { projects: { view: levels.includes('view'), edit: levels.includes('edit'), approve: levels.includes('approve') }, brands: { view: levels.includes('view'), edit: levels.includes('edit'), approve: levels.includes('approve') } }, special_actions: {}, can_manage_users: false, agency_registry: false } };
  const project = { id: ids.project, public_project_id: publicId, public_name: { th: 'Synthetic project', en: 'Original English' }, slug: 'workflow-project', updated_at: stamp,
    published_version_id: null, publication_available: false, readiness: { ready: false, percent: 0, missing: [] }, assets: [], commercial_types: [],
    source: { rem_project_id: phase, project_name_rem: 'Synthetic REM evidence', source_snapshot_at: stamp, source_updated_at: stamp },
    models: [{ id: ids.model, public_model_id: 'MODEL-PUBLIC-EXACT', rem_model_id: 'REM-MODEL-EXACT', model_name_rem: 'Synthetic source model', public_name: { th: 'Synthetic model' },
      bedrooms: 2, bathrooms: 2, usable_area_sqm: 60, parking_spaces: 1, match_status: 'CONFIRMED', verified_at: null, verified_by: null, source_updated_at: stamp, source_snapshot_at: stamp }] };
  const brand = { id: ids.brand, public_brand_id: brandId, rem_brand_id: 'REM-BRAND-EXACT', public_name: { th: 'Synthetic brand' }, description: { th: 'Original brand description' },
    slug: 'workflow-brand', status: 'active', updated_at: stamp, published_version_id: null, publication_available: false, readiness: { ready: false, percent: 0, missing: [] }, assets: [], projects: [] };
  const content = { facts: [{ id: ids.fact, fact_key: 'project.land_area_sqwah', grain: 'project', revision: 5, value_number: 100, value_text: null, unit: null, as_of: '2026-11-04', valid_to: null,
      override_reason: null, ai_exposure: 'internal', source: 'mkt', rem_value: null, basis: {} }], rem: {}, computed: {},
    buildings: [{ building_key: 'B-01', revision: 5, name: { th: 'Synthetic building' }, floors_above: 5, has_rooftop: null, skip_floors: [], unit_count: 10, ai_exposure: 'internal' }],
    sections: [{ id: ids.section, section_key: 'section.concept', revision: 5, state: 'DRAFT', version: { version_no: 5, body: { th: 'Original section', en: 'Reviewed English' }, state: 'DRAFT', source_ref: 'Synthetic evidence', ai_exposure: 'internal', created_at: stamp }, history: [] }],
    selling_points: [{ point_key: ids.point, revision: 5, title: { th: 'Synthetic point' }, detail: { th: 'Original point detail' }, icon_code: 'check', linked_feature_code: null, linked_fact_keys: [], sort: 1, state: 'DRAFT', ai_exposure: 'internal', history: [] }],
    contacts: [{ id: ids.contact, revision: 5, channel: 'phone', value: '020000001', url: null, label: { th: 'Synthetic contact' }, shared_mailbox_confirmed: false, is_primary: false, sort: 1, ai_exposure: 'internal' }],
    translations: [], readiness: { required_missing: 0, ready: true, items: [] } };
  const catalog = { can_manage: false, items: [field('section.concept', 'section', 'narrative'), field('project.land_area_sqwah', 'project', 'facts'),
    ...['title', 'detail'].map(key => field('selling_point.' + key, 'selling_point', 'narrative')),
    ...['name', 'floors_above', 'unit_count', 'has_rooftop', 'skip_floors'].map(key => field('building.' + key, 'building', 'buildings')),
    ...['channel', 'value', 'label', 'url'].map(key => field('contact.' + key, 'contact', 'contacts'))] };
  const snapshots = Object.fromEntries(['project', 'model', 'brand', 'section', 'selling_point', 'contact', 'fact', 'building'].map(kind => [kind, snapshot(kind as WorkflowKind)]));
  const commands: { path: string; body: any }[] = [], ordinaryWrites: { path: string; body: any }[] = [], reads: string[] = [], inventoryReads: URLSearchParams[] = [];
  let conflict = false, inventory: WorkflowKind[] = [], failSubmit: WorkflowKind | null = null;
  function inventoryRow(kind: WorkflowKind) {
    const row = snapshots[kind];
    return { kind: row.kind, identity: row.identity, expected_hash: row.expected_hash, source_revision: row.source_revision, source_updated_at: row.source_updated_at,
      state: 'DRAFT', can_submit: true, can_edit: true, source_tab: row.source_tab, source_tabs: row.source_tabs, label: { th: 'Saved ' + kind }, target: null, href: null };
  }
  function apply(kind: WorkflowKind, changes: any) {
    if (kind === 'project') Object.assign(project, changes, { updated_at: newerStamp });
    if (kind === 'brand') Object.assign(brand, changes, { updated_at: newerStamp });
    if (kind === 'model') { Object.assign(project.models[0], changes); project.updated_at = newerStamp; }
    if (kind === 'section') { Object.assign(content.sections[0].version, changes); content.sections[0].revision++; }
    if (kind === 'selling_point') Object.assign(content.selling_points[0], changes, { revision: 6 });
    if (kind === 'contact') Object.assign(content.contacts[0], changes, { revision: 6 });
    if (kind === 'fact') Object.assign(content.facts[0], changes, { revision: 6 });
    if (kind === 'building') Object.assign(content.buildings[0], changes, { revision: 6 });
  }
  await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data: me } }));
  await page.route('**/api/hub/v1/admin/**', async (route: Route) => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/api/hub/v1/admin/', ''), method = route.request().method();
    const reply = (data: unknown) => route.fulfill({ json: { data } });
    if (path === 'content-workflow' || path.startsWith('content-workflow/')) {
      if (method === 'GET' && path === 'content-workflow/items') {
        inventoryReads.push(url.searchParams);
        const scope = { level: url.searchParams.get('level'), id: url.searchParams.get('id'), phase: url.searchParams.get('level') === 'project' ? phase : null };
        const after = url.searchParams.get('after');
        return reply({ scope, items: inventory.slice(after ? 1 : 0, after ? undefined : 1).map(inventoryRow), next_cursor: !after && inventory.length > 1 ? 'a'.repeat(64) : null });
      }
      if (method === 'GET') {
        const kind = url.searchParams.get('kind')!; reads.push(kind);
        expect(JSON.parse(url.searchParams.get('identity')!)).toEqual(identity(kind as WorkflowKind));
        return reply(snapshots[kind]);
      }
      const body = route.request().postDataJSON(); commands.push({ path, body });
      if (conflict || body.kind === failSubmit && path.endsWith('/submit')) return route.fulfill({ status: 409, json: { error: { message: 'Synthetic stale item', code: 'stale' } } });
      if (body.changes) apply(body.kind, body.changes);
      snapshots[body.kind] = { ...snapshots[body.kind], state: path.endsWith('/submit') ? 'IN_REVIEW' : body.decision === 'return' ? 'RETURNED' : 'APPROVED', can_submit: false,
        source_revision: ['project', 'brand', 'model'].includes(body.kind) ? null : 6, source_updated_at: ['project', 'brand', 'model'].includes(body.kind) ? newerStamp : null,
        expected_hash: 'f'.repeat(64), self_approval: path.endsWith('/save-approve'), decision_reason: body.reason ?? null };
      return reply(snapshots[body.kind]);
    }
    if (path === 'content/fields') return reply(catalog);
    if (path === `content/workspace/project/${publicId}`) return reply(workspaceProjection(project));
    if (path === `content/workspace/brand/${brandId}`) return reply(workspaceProjection(brand, 'brand'));
    if (path === `content/workspace/project/${publicId}/history` || path === `content/workspace/brand/${brandId}/history`) return reply({ items: [], next_cursor: null });
    if (path === `projects/${publicId}/content` || path === `brands/${brandId}/content`) return reply(content);
    if (path === `projects/${publicId}/content/website`) return reply([]);
    if (path === `projects/${publicId}/versions` || path === `brands/${brandId}/versions` || path === 'brands') return reply([]);
    if (path === `projects/${publicId}` || path === `brands/${brandId}`) {
      if (method !== 'GET') { const body = route.request().postDataJSON(); ordinaryWrites.push({ path, body }); apply(path.startsWith('brands') ? 'brand' : 'project', body); }
      return reply(path.startsWith('brands') ? brand : project);
    }
    return route.fallback();
  });
  async function visit(href: string) {
    await page.goto(href); await page.locator("#workspace-tab-data").waitFor();
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/hub/v1/me");
    await page.evaluate(() => window.dispatchEvent(new Event("hub-accounts-changed"))); await refreshed;
    if (levels.includes("edit")) await page.locator("[data-workflow-kind] .workflow-actions button").filter({ hasText: new RegExp("^" + text.submit + "$") }).first().waitFor({ state: "attached" });
    else if (levels.includes("approve")) await page.getByRole("button", { name: text.return, exact: true }).waitFor();
    else await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }
  return { project, brand, content, snapshots, commands, ordinaryWrites, reads, inventoryReads, visit,
    conflict: (value: boolean) => { conflict = value; }, inventory: (kinds: WorkflowKind[], failure: WorkflowKind | null = null) => { inventory = kinds; failSubmit = failure; },
    revokeEdit: () => { me = { ...me, capabilities: { ...me.capabilities, tabs: { ...me.capabilities.tabs, projects: { view: true, edit: false, approve: false } } } }; } };
}
const controls = (page: Page, kind: WorkflowKind) => page.locator(`[data-workflow-kind="${kind}"]:visible`);
async function approveDraft(page: Page, kind: WorkflowKind) {
  await controls(page, kind).getByRole('button', { name: text.save_approve, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: text.save_approve, exact: true })).toBeDisabled();
  await dialog.getByLabel(text.reason, { exact: true }).fill('Checked synthetic source and authored text');
  await dialog.getByRole('button', { name: text.save_approve, exact: true }).click();
}

test('project atomic approval uses its loaded row identity, inner normal payload and required reason', async ({ page }) => {
  const data = await fixture(page);
  await data.visit(`/website/project/${publicId}?tab=data&section=identity`);
  await page.locator('#public_name').fill('Authored project draft');
  await expect(page.getByRole('button', { name: new RegExp('^' + text.submit_all) })).toBeDisabled();
  await expect(controls(page, 'project').getByRole('button', { name: text.save_approve, exact: true })).toBeEnabled();
  await fitsWorkspace(page);
  await page.screenshot({ path: `artifacts/unified-workspace/w4/primary-project-${page.viewportSize()?.width}.png`, fullPage: true });
  await approveDraft(page, 'project');
  await expect.poll(() => data.commands.length).toBe(1);
  expect(data.commands[0]).toMatchObject({ path: 'content-workflow/save-approve', body: { kind: 'project', identity: { id: ids.project }, expected_hash: hash('project'), reason: 'Checked synthetic source and authored text', changes: { public_name: { th: 'Authored project draft', en: 'Original English' } } } });
  expect(data.commands[0].body.changes).not.toHaveProperty('updated_at');
  expect(data.commands[0].body.changes).not.toHaveProperty('id');
  expect(data.ordinaryWrites).toHaveLength(0);
  await expect(page.locator('#public_name')).toHaveValue('Authored project draft');
});

test('project conflict retains typed input and old hash until explicit normal-form reload', async ({ page }) => {
  const data = await fixture(page); data.conflict(true);
  await data.visit(`/website/project/${publicId}?tab=data&section=identity`);
  await page.locator('#public_name').fill('Keep this typed value');
  await approveDraft(page, 'project');
  await expect(page.getByRole('dialog')).toContainText(text.draft_preserved);
  data.project.public_name.th = 'New server source'; data.project.updated_at = newerStamp;
  data.snapshots.project = { ...data.snapshots.project, source_updated_at: newerStamp, expected_hash: 'b'.repeat(64) };
  await page.getByRole('dialog').getByRole('button', { name: text.cancel, exact: true }).click();
  await expect(page.locator('#public_name')).toHaveValue('Keep this typed value');
  await expect(controls(page, 'project').getByRole('button', { name: text.save_approve, exact: true })).toBeDisabled();
  expect(data.commands[0].body.expected_hash).toBe(hash('project'));
  await controls(page, 'project').getByRole('button', { name: text.refresh, exact: true }).click();
  await expect(page.locator('#public_name')).toHaveValue('New server source');
  expect(data.ordinaryWrites).toHaveLength(0);
});

test('model save-approve pins the original parent timestamp and model row UUID', async ({ page }) => {
  const data = await fixture(page);
  await data.visit(`/website/project/${publicId}?tab=unit-types`);
  await page.locator('[data-model-id="MODEL-PUBLIC-EXACT"] button').click();
  await page.locator('#model-public_name').fill('Authored model draft');
  await expect(controls(page, 'model').getByRole('button', { name: text.save_approve, exact: true })).toBeEnabled();
  await approveDraft(page, 'model');
  await expect.poll(() => data.commands.length).toBe(1);
  expect(data.commands[0].body).toMatchObject({ kind: 'model', identity: { id: ids.model }, expected_hash: hash('model'), changes: { public_name: { th: 'Authored model draft' }, bedrooms: 2, bathrooms: 2, usable_area_sqm: 60, parking_spaces: 1 } });
  expect(data.commands[0].body.changes).not.toHaveProperty('updated_at');
});

test('brand form sends only ordinary authored fields and preserves its native identity', async ({ page }) => {
  const data = await fixture(page);
  await data.visit(`/website/brand/${brandId}?tab=data&section=identity`);
  await page.locator('#brand-description').fill('Authored brand draft');
  await approveDraft(page, 'brand');
  await expect.poll(() => data.commands.length).toBe(1);
  expect(data.commands[0].body).toMatchObject({ kind: 'brand', identity: { id: ids.brand }, expected_hash: hash('brand'), changes: { description: { th: 'Authored brand draft' }, status: 'active' } });
  expect(data.commands[0].body.changes).not.toHaveProperty('updated_at');
  expect(data.ordinaryWrites).toHaveLength(0);
});

for (const entry of [
  { kind: 'section', section: 'narrative', card: '[data-workspace-field="section.concept"]', input: '#section-body-th', value: 'Authored section draft', change: { body: { th: 'Authored section draft', en: 'Reviewed English' }, source_ref: 'Synthetic evidence', ai_exposure: 'internal' } },
  { kind: 'selling_point', section: 'narrative', card: `[data-workspace-item="${ids.point}"]`, input: '#point-title-th', value: 'Authored point draft', change: { title: { th: 'Authored point draft' }, ai_exposure: 'internal' } },
  { kind: 'contact', section: 'contacts', card: `[data-workspace-item="${ids.contact}"]`, input: '#contact-value', value: '020000002', change: { value: '020000002', channel: 'phone', ai_exposure: 'internal' } },
  { kind: 'fact', section: 'facts', card: '[data-workspace-field="project.land_area_sqwah"]', input: '#fact-land_area_sqwah', value: '150', change: { value_number: 150, as_of: '2026-11-04', ai_exposure: 'internal' } },
  { kind: 'building', section: 'buildings', card: '[data-workspace-item="B-01"]', input: '#building-name-th', value: 'Authored building draft', change: { name: { th: 'Authored building draft' }, skip_floors: [], ai_exposure: 'internal' } },
] as const) test(`${entry.kind} actual editor uses saved identity, original revision and its normal fields`, async ({ page }) => {
  const data = await fixture(page);
  await data.visit(`/website/project/${publicId}?tab=data&section=${entry.section}`);
  const card = page.locator(entry.card);
  await card.locator('button').first().click();
  await page.locator(entry.input).fill(entry.value);
  await expect(page.getByRole('button', { name: new RegExp('^' + text.submit_all) })).toBeDisabled();
  await approveDraft(page, entry.kind);
  await expect.poll(() => data.commands.length).toBe(1);
  expect(data.commands[0].body).toMatchObject({ kind: entry.kind, identity: identity(entry.kind), expected_hash: hash(entry.kind), changes: entry.change });
  expect(data.commands[0].body.changes).not.toHaveProperty('expected_revision');
  expect(data.commands[0].body.changes).not.toHaveProperty('changes');
  expect(data.ordinaryWrites).toHaveLength(0);
});

test('header consumes every exact-phase inventory page and continues after a stale item', async ({ page }) => {
  const data = await fixture(page); data.inventory(['contact', 'fact'], 'contact');
  await data.visit(`/website/project/${publicId}?tab=overview&phase=${phase}`);
  const submit = page.getByRole('button', { name: text.submit_all + ' (2)', exact: true });
  await expect(submit).toBeEnabled();
  const inventoryCount = data.inventoryReads.length;
  expect(inventoryCount).toBeGreaterThanOrEqual(2);
  for (const query of data.inventoryReads) expect(Object.fromEntries(query)).toMatchObject({ level: 'project', id: publicId, phase });
  expect(data.inventoryReads.at(-1)?.get('after')).toBe('a'.repeat(64));
  expect(data.reads.filter(kind => kind === 'contact' || kind === 'fact')).toEqual([]);
  await submit.click();
  await expect(page.getByRole('heading', { name: text.submit_results, exact: true })).toBeVisible();
  await expect(page.locator('.workflow-results')).toContainText(text.rejected);
  await expect(page.locator('.workflow-results')).toContainText(text.IN_REVIEW);
  expect(data.commands.map(command => [command.body.kind, command.body.expected_hash])).toEqual([['contact', hash('contact')], ['fact', hash('fact')]]);
  expect(data.inventoryReads).toHaveLength(inventoryCount);
  await page.getByRole('button', { name: text.submit_all + ' (1)', exact: true }).click();
  await expect.poll(() => data.commands.length).toBe(3);
  expect(data.commands[2].body.expected_hash).toBe(hash('contact'));
});

test('one pending nonmodal section submission blocks peer controls and the entity header', async ({ page }) => {
  const data = await fixture(page);
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/hub/v1/admin/content-workflow/submit', async route => {
    const body = route.request().postDataJSON(); data.commands.push({ path: 'content-workflow/submit', body });
    await pending;
    data.snapshots.section = { ...data.snapshots.section, state: 'IN_REVIEW', can_submit: false };
    await route.fulfill({ json: { data: data.snapshots.section } });
  });
  await data.visit(`/website/project/${publicId}?tab=data&section=narrative`);
  try {
    await controls(page, 'section').getByRole('button', { name: text.submit, exact: true }).click();
    await expect.poll(() => data.commands.length).toBe(1);
    await expect(controls(page, 'selling_point').getByRole('button', { name: text.submit, exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: new RegExp('^' + text.submit_all) })).toBeDisabled();
    expect(data.commands[0].body).toEqual({ kind: 'section', identity: { id: ids.section }, expected_hash: hash('section') });
  } finally { finish(); }
  await expect(controls(page, 'selling_point').getByRole('button', { name: text.submit, exact: true })).toBeEnabled();
});

test('View-only fixtures never inherit command authority from account role or workflow flags', async ({ page }) => {
  const data = await fixture(page, ['view']);
  data.snapshots.project = { ...data.snapshots.project, can_approve: true, can_return: true, state: 'IN_REVIEW' };
  await data.visit(`/website/project/${publicId}?tab=data&section=identity`);
  await expect(controls(page, 'project')).toBeVisible();
  for (const action of [text.submit, text.approve, text.return, text.save_approve]) await expect(controls(page, 'project').getByRole('button', { name: action, exact: true })).toHaveCount(0);
  await expect(page.locator('#public_name')).not.toBeEditable();
  expect(data.commands).toHaveLength(0);
});

test('revocation during a dirty project draft keeps typed-only recovery and removes workflow actions', async ({ page }) => {
  const data = await fixture(page);
  await data.visit(`/website/project/${publicId}?tab=data&section=identity`);
  await page.locator('#public_name').fill('Typed recovery must remain');
  data.revokeEdit(); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const recovery = page.locator('aside:has(#hub-recovered-0)');
  await expect(recovery).toBeVisible();
  await expect(recovery.getByRole('textbox')).toHaveValue('Typed recovery must remain');
  await expect(recovery).not.toContainText('Original English');
  await expect(controls(page, 'project').getByRole('button', { name: text.save_approve, exact: true })).toHaveCount(0);
  expect(data.commands).toHaveLength(0);
});

test('source Approve without a publish special leads to the single queue, never a legacy publish command', async ({ page }) => {
  const data = await fixture(page);
  await data.visit(`/website/project/${publicId}?tab=history`);
  await page.locator('.workspace-persistent-editor > summary').click();
  await expect(page.locator('.publication-actions a')).toHaveAttribute('href', `/publish?source=project&id=${publicId}`);
  await expect(page.locator('.publication-actions a')).toHaveText(text.queue);
  await expect(page.locator('.publication-actions button')).toHaveCount(0);
  await data.visit(`/website/brand/${brandId}?tab=data&section=identity`);
  await expect(page.locator('.publish-block a')).toHaveAttribute('href', `/publish?source=brand&id=${brandId}`);
  await expect(page.locator('.publish-block a')).toHaveText(text.queue);
  await expect(page.locator('.publish-block button')).toHaveCount(0);
  expect(data.commands).toHaveLength(0); expect(data.ordinaryWrites).toHaveLength(0);
});

test('model metadata cannot rebase the original loaded project stamp', async ({ page }) => {
  const data = await fixture(page);
  data.snapshots.model.source_updated_at = newerStamp;
  await data.visit(`/website/project/${publicId}?tab=unit-types`);
  await page.locator('[data-model-id="MODEL-PUBLIC-EXACT"] button').click();
  await page.locator('#model-public_name').fill('Older loaded model draft');
  await expect(controls(page, 'model')).toContainText(text.stale_item);
  await expect(controls(page, 'model').getByRole('button', { name: text.save_approve, exact: true })).toBeDisabled();
  await expect(page.locator('#model-public_name')).toHaveValue('Older loaded model draft');
  expect(data.commands).toHaveLength(0);
});

async function mediaFixture(page: Page, externalText = false) {
  const data = await fixture(page), lastStamp = '2026-11-04T09:02:00+00:00';
  const asset = { id: '71000000-0000-4000-8000-000000000020', original_filename: 'synthetic-own-media.png', mime_type: 'image/png',
    public_url: null, checksum: 'a'.repeat(64), file_size: 68, width: 1, height: 1, rights_status: 'pending', rights_notes: null,
    updated_at: stamp, effective_from: null, effective_to: null, reviewed_by: null, reviewed_at: null, review_reason: null, storage_path: null };
  const binding = { ...asset, binding_id: '71000000-0000-4000-8000-000000000021', asset_role: 'hero', is_primary: true, public_model_id: null,
    alt_text: { th: 'Synthetic media caption' }, display_order: 0 };
  if (externalText) Object.assign(data.project, { assets: [binding] });
  const writes: { path: string; body: any }[] = [];
  await page.route('**/api/hub/v1/admin/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api/hub/v1/admin/', '');
    const reply = (value: unknown) => route.fulfill({ json: { data: value } });
    if (request.method() === 'GET') {
      if (path === 'assets') return reply([asset]);
      if (path === `assets/${asset.id}/file`) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1kAAAAASUVORK5CYII=', 'base64') });
      if (path === `projects/${publicId}/media`) return reply({ project: { ...data.project, name: data.project.public_name }, assets: [], links: [], clips: [], tags: [], requirements: [], context: {},
        checklist: { items: [], recommended_score: 0, required_missing: 0, broken_links: [], unknown_coverage: [] } });
      if (path === `projects/${publicId}/media/jobs`) return reply([]);
      if (path === `projects/${publicId}/media/ai-state`) return reply(null);
      if (path === 'content-workflow' && url.searchParams.get('kind') === 'project_asset') return reply({ ...snapshot('project'), kind: 'project_asset', identity: { id: binding.binding_id }, source_revision: 1, can_submit: false, can_save_approve: false });
      return route.fallback();
    }
    if (path === `projects/${publicId}/assets` || path === `projects/${publicId}/assets/${binding.binding_id}/remove`) {
      const body = request.postDataJSON(); writes.push({ path, body }); expect(body.updated_at).toBe(data.project.updated_at);
      if (path.endsWith('/remove')) Object.assign(data.project, { assets: [], updated_at: lastStamp });
      else { expect(body).toMatchObject({ asset_id: asset.id, asset_role: 'hero' }); Object.assign(data.project, { assets: [binding], updated_at: newerStamp }); }
      if (externalText) data.project.public_name.en = 'Saved by another editor';
      return reply(data.project);
    }
    if (path === `projects/${publicId}` && request.method() === 'PATCH') {
      const body = request.postDataJSON(); writes.push({ path, body });
      if (body.updated_at !== data.project.updated_at) return route.fulfill({ status: 409, json: { error: { message: 'Synthetic external source conflict' } } });
    }
    return route.fallback();
  });
  return { ...data, asset, binding, writes, lastStamp };
}

test('verified own media binding and removal preserve typed text and advance only the ordinary writer stamp', async ({ page }) => {
  const data = await mediaFixture(page);
  await data.visit(`/website/project/${publicId}?tab=data&section=identity`);
  await page.locator('#public_name').fill('Typed project text stays');
  await openWorkspaceTab(page, 'media');
  const media = page.locator('#assets');
  await media.locator('button[aria-controls="assets-library"]').click();
  await media.locator('.library-asset-actions > button').first().click();
  await page.getByRole('dialog').locator('#asset-alt').fill('Synthetic media caption');
  await page.getByRole('dialog').locator('button[type="submit"]').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(media.locator('.bound-assets')).toContainText(data.asset.original_filename);
  await media.locator('.bound-assets .asset-caption > button').last().click();
  await page.getByRole('dialog').locator('button[type="submit"]').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openWorkspaceTab(page, 'data');
  await expect(page.locator('#public_name')).toHaveValue('Typed project text stays');
  await expect(page.locator('#public_name_en')).toHaveValue('Original English');
  expect(data.project.public_name.th).toBe('Synthetic project');
  expect(data.writes.map(write => write.body.updated_at)).toEqual([stamp, newerStamp]);
  await page.locator('.project-save-bar button[type="submit"]').click();
  await expect.poll(() => data.ordinaryWrites.length).toBe(1);
  expect(data.ordinaryWrites[0].body).toMatchObject({ updated_at: data.lastStamp, public_name: { th: 'Typed project text stays', en: 'Original English' } });
  expect(data.project.assets).toEqual([]); expect(data.project.published_version_id).toBeNull(); expect(data.commands).toHaveLength(0);
});

test('media responses containing external authored changes retain the old guard and cannot overwrite that text', async ({ page }) => {
  const data = await mediaFixture(page, true);
  await data.visit(`/website/project/${publicId}?tab=data&section=identity`);
  await page.locator('#public_name').fill('Keep my typed project text');
  await openWorkspaceTab(page, 'media');
  await page.locator('#assets .bound-assets .asset-caption > button').last().click();
  await page.getByRole('dialog').locator('button[type="submit"]').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openWorkspaceTab(page, 'data');
  await expect(page.locator('#public_name')).toHaveValue('Keep my typed project text');
  await expect(page.locator('.entity-embedded-editor > .notice.error[role="alert"]')).toBeVisible();
  await page.locator('.project-save-bar button[type="submit"]').click();
  await expect(page.getByRole('alert').filter({ hasText: 'Synthetic external source conflict' })).toBeVisible();
  expect(data.writes.at(-1)?.body.updated_at).toBe(stamp);
  expect(data.project.public_name.en).toBe('Saved by another editor');
  expect(data.project.public_name.th).toBe('Synthetic project');
  expect(data.ordinaryWrites).toHaveLength(0); expect(data.commands).toHaveLength(0);
  await expect(page.locator('#public_name')).toHaveValue('Keep my typed project text');
});

test('newer project workflow metadata alone cannot rebase a typed ordinary form', async ({ page }) => {
  const data = await fixture(page);
  data.snapshots.project.source_updated_at = newerStamp;
  const attempted: any[] = [];
  await page.route(`**/api/hub/v1/admin/projects/${publicId}`, route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    attempted.push(route.request().postDataJSON());
    return route.fulfill({ status: 409, json: { error: { message: 'Synthetic newer workflow source' } } });
  });
  await data.visit(`/website/project/${publicId}?tab=data&section=identity`);
  await page.locator('#public_name').fill('Typed before a metadata refresh');
  await expect(controls(page, 'project').getByRole('button', { name: text.save_approve, exact: true })).toBeDisabled();
  await page.locator('.project-save-bar button[type="submit"]').click();
  await expect(page.getByRole('alert').filter({ hasText: 'Synthetic newer workflow source' })).toBeVisible();
  expect(attempted).toHaveLength(1); expect(attempted[0].updated_at).toBe(stamp);
  await expect(page.locator('#public_name')).toHaveValue('Typed before a metadata refresh');
  expect(data.commands).toHaveLength(0); expect(data.ordinaryWrites).toHaveLength(0);
});

test('Approve without Edit can return the exact submitted section with a required reason', async ({ page }) => {
  const data = await fixture(page, ['view', 'approve']);
  data.snapshots.section = { ...data.snapshots.section, state: 'IN_REVIEW', can_approve: true, can_return: true, can_submit: false, can_edit: false, can_save_approve: false };
  await data.visit(`/website/project/${publicId}?tab=data&section=narrative`);
  await expect(page.locator('#section-body-th')).toHaveCount(0);
  await controls(page, 'section').getByRole('button', { name: text.return, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: text.return, exact: true })).toBeDisabled();
  await dialog.getByLabel(text.reason, { exact: true }).fill('Synthetic source needs correction');
  await dialog.getByRole('button', { name: text.return, exact: true }).click();
  await expect.poll(() => data.commands.length).toBe(1);
  expect(data.commands[0]).toEqual({ path: 'content-workflow/review', body: { kind: 'section', identity: { id: ids.section }, expected_hash: hash('section'), decision: 'return', reason: 'Synthetic source needs correction' } });
});

test('new sections use the ordinary creation writer before any saved workflow identity exists', async ({ page }) => {
  const data = await fixture(page), created = structuredClone(data.content.sections[0]);
  data.content.sections.length = 0;
  const saves: any[] = [];
  await page.route(`**/api/hub/v1/admin/projects/${publicId}/sections/section.concept`, async route => {
    expect(route.request().method()).toBe('PUT'); const body = route.request().postDataJSON(); saves.push(body);
    created.revision = 1; Object.assign(created.version, body.changes); data.content.sections.push(created);
    data.snapshots.section.source_revision = 1;
    await route.fulfill({ json: { data: created } });
  });
  await data.visit(`/website/project/${publicId}?tab=data&section=narrative`);
  await page.locator('[data-workspace-field="section.concept"] button').first().click();
  await page.locator('#section-body-th').fill('First ordinary section draft');
  await expect(controls(page, 'section')).toHaveCount(0);
  expect(data.reads.filter(kind => kind === 'section')).toHaveLength(0);
  await page.locator('form:has(#section-body-th) button:not([type="button"])').click();
  await expect(controls(page, 'section')).toBeVisible();
  expect(saves).toEqual([{ expected_revision: 0, changes: { body: { th: 'First ordinary section draft' }, source_ref: null, ai_exposure: 'internal' } }]);
  expect(data.commands).toHaveLength(0);
});
