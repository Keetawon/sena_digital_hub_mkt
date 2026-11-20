import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { expectAssistantClearance } from './assistant-clearance';
import { legacyWorkspaceHref, workspaceQuestionLabel } from '../../apps/admin/lib/unified-workspace';
import { fitsWorkspace, workspaceHref, workspaceProjection, workspaceText as text } from './unified-workspace-helpers';

const api = '/api/hub/v1/admin', origin = 'http://127.0.0.1:3000';
const headers = { Origin: origin };

test('question labels replace project tokens literally only when project context exists', () => {
  const template = { th: '{project} · {project} · {brand}' };
  expect(workspaceQuestionLabel(template, { th: 'Phase $&' })).toBe('Phase $& · Phase $& · {brand}');
  expect(workspaceQuestionLabel(template)).toBe(template.th);
  expect(workspaceQuestionLabel(template, {})).toBe(template.th);
  expect(workspaceQuestionLabel({ en: '{project}' }, { en: 'Fallback project' })).toBe('Fallback project');
  expect(template.th).toBe('{project} · {project} · {brand}');
});

test('overview and FAQ question labels use the selected project name without changing the target', async ({ page }) => {
  const project = await projectFixture(page), id = project.public_project_id;
  const projection = workspaceProjection(project), phase = projection.selected_phase!;
  projection.entity.name = { th: 'Parent project' };
  projection.phases[0].name = { th: 'Selected $& project' };
  const target = { level: 'project' as const, id, tab: 'faq' as const, phase, question_key: 'project_overview' };
  const label = { th: '{project} overview' };
  projection.overview.tasks = [
    { code: 'project_overview', label, state: 'missing', target },
    { code: 'authored_title', label: { th: '{project} authored title' }, state: 'RETURNED', target: { level: 'project', id, tab: 'data', phase, section: 'narrative' } },
  ];
  await page.route(`**/content/workspace/project/${id}?**`, route => route.fulfill({ json: { data: projection } }));
  await page.route(`**/content/workspace/project/${id}/faq?**`, route => route.fulfill({ json: { data: {
    page_scope: { type: 'project', id: phase }, selected_phase: phase, next_cursor: null,
    items: [{ question_key: 'project_overview', label, is_core: true, answer_kind: 'text', display_state: 'missing', own_answer: null, effective_answer: null, facts: [], legacy_clusters: [], applicability: { state: 'applicable' }, targets: {} }],
  } } }));
  await page.goto(workspaceHref({ level: 'project', id, tab: 'overview', phase }));
  const tasks = page.getByRole('region', { name: text.tasks, exact: true });
  await expect(tasks.locator('summary')).toHaveCount(2);
  for (const summary of await tasks.locator('summary').all()) await summary.click();
  await expect(tasks.getByRole('link', { name: '{project} authored title', exact: true })).toBeVisible();
  const question = tasks.getByRole('link', { name: 'Selected $& project overview', exact: true });
  await expect(question).toHaveAttribute('href', workspaceHref(target));
  await question.click();
  await expect(page.locator('.workspace-faq-card h3')).toHaveText('Selected $& project overview');
});

test('pending FAQ tasks show approval status before opening the named explanation and question bank', async ({ page }) => {
  const project = await projectFixture(page), id = project.public_project_id;
  const projection = workspaceProjection(project), phase = projection.selected_phase!;
  projection.phases[0].name = { th: 'Selected $& project' };
  const bank = await read(page, api + '/faq/questions');
  const pendingKey = 'project_overview', heldKey = 'project_location';
  bank.items = bank.items.map((item: { question_key: string }) => item.question_key === pendingKey ? { ...item, status: 'proposed', question_template: { th: '{project} pending question' } } : item.question_key === heldKey ? { ...item, status: 'approved' } : item);
  let bankReads = 0;
  await page.route('**/faq/questions', route => { bankReads++; return route.fulfill({ json: { data: bank } }); });
  const target = (question_key: string) => ({ level: 'project' as const, id, tab: 'faq' as const, phase, question_key });
  projection.overview.tasks = [
    { code: pendingKey, label: { th: '{project} pending question' }, state: 'hold', target: target(pendingKey) },
    { code: heldKey, label: { th: '{project} held approved question' }, state: 'hold', target: target(heldKey) },
  ];
  await page.route(`**/content/workspace/project/${id}?**`, route => route.fulfill({ json: { data: projection } }));
  await page.route(`**/content/workspace/project/${id}/faq?**`, route => route.fulfill({ json: { data: { page_scope: { type: 'project', id: phase }, selected_phase: phase, items: [], next_cursor: null } } }));
  await page.goto(workspaceHref({ level: 'project', id, tab: 'overview', phase }));
  const tasks = page.getByRole('region', { name: text.tasks, exact: true });
  await expect(tasks).toContainText(text.project_tasks_hint);
  await tasks.locator('summary').click();
  const pendingTask = tasks.locator('li').filter({ has: page.getByRole('link', { name: 'Selected $& project pending question', exact: true }) });
  await expect(pendingTask).toContainText(text.faq_question_pending);
  await expect(tasks.locator('li').filter({ has: page.getByRole('link', { name: 'Selected $& project held approved question', exact: true }) })).not.toContainText(text.faq_question_pending);
  expect(bankReads).toBe(1);
  await pendingTask.getByRole('link').click();
  const explanation = page.locator('[data-workspace-question="project_overview"]');
  await expect(explanation.getByRole('heading')).toHaveText('Selected $& project pending question');
  await expect(explanation).toContainText(text.faq_question_pending_explanation);
  await expect(explanation.getByRole('button', { name: text.newFaq, exact: true })).toHaveCount(0);
  await expect(page.locator('.workspace-faq').getByText(text.faq_empty, { exact: true })).toHaveCount(0);
  const workflowLink = explanation.getByRole('link', { name: text.bank, exact: true });
  await expect(workflowLink).toHaveAttribute('href', '/settings?section=bank');
  await workflowLink.click();
  await expect(page).toHaveURL(/\/settings\?section=bank$/);
  await expect(page.getByRole('button', { name: 'แก้ไขคำถาม project_overview', exact: true })).toBeVisible();
});

test('a failed question-bank read never guesses that a held task awaits approval', async ({ page }) => {
  const project = await projectFixture(page), id = project.public_project_id;
  const projection = workspaceProjection(project), phase = projection.selected_phase!;
  projection.overview.tasks = [{ code: 'project_overview', label: { th: 'Held question' }, state: 'hold', target: { level: 'project', id, tab: 'faq', phase, question_key: 'project_overview' } }];
  await page.route(`**/content/workspace/project/${id}?**`, route => route.fulfill({ json: { data: projection } }));
  await page.route('**/faq/questions', route => route.fulfill({ status: 503, json: { error: { message: 'Synthetic unavailable bank' } } }));
  const failed = page.waitForResponse(response => new URL(response.url()).pathname === api + '/faq/questions');
  await page.goto(workspaceHref({ level: 'project', id, tab: 'overview', phase }));
  expect((await failed).status()).toBe(503);
  const tasks = page.getByRole('region', { name: text.tasks, exact: true });
  await tasks.locator('summary').click();
  await expect(tasks.getByRole('link', { name: 'Held question', exact: true })).toBeVisible();
  await expect(tasks.getByText(text.faq_question_pending, { exact: true })).toHaveCount(0);
  await expect(page.getByText('Synthetic unavailable bank', { exact: true })).toHaveCount(0);
});

test('held FAQ tasks never read question-bank status without Knowledge view', async ({ page }) => {
  const project = await projectFixture(page), id = project.public_project_id;
  const projection = workspaceProjection(project), phase = projection.selected_phase!;
  projection.tabs = projection.tabs.filter(tab => tab !== 'faq');
  projection.overview.tasks = [{ code: 'project_overview', label: { th: 'Held question' }, state: 'hold', target: { level: 'project', id, tab: 'faq', phase, question_key: 'project_overview' } }];
  const account = await read(page, '/api/hub/v1/me');
  account.capabilities.tabs.knowledge = { view: false, edit: false, approve: false };
  await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data: account } }));
  await page.route(`**/content/workspace/project/${id}?**`, route => route.fulfill({ json: { data: projection } }));
  let bankReads = 0;
  await page.route('**/faq/questions', route => { bankReads++; return route.fulfill({ json: { data: { items: [{ question_key: 'project_overview', status: 'proposed' }] } } }); });
  await page.goto(workspaceHref({ level: 'project', id, tab: 'overview', phase }));
  const tasks = page.getByRole('region', { name: text.tasks, exact: true });
  await tasks.locator('summary').click();
  await expect(tasks.getByRole('link', { name: 'Held question', exact: true })).toBeVisible();
  await expect(tasks.getByText(text.faq_question_pending, { exact: true })).toHaveCount(0);
  await expect(page.locator('#workspace-tab-faq')).toHaveCount(0);
  expect(bankReads).toBe(0);
});

test('W3.1 many-gap overview is compact, contextual, keyboard expandable and limited to five changes', async ({ page }) => {
  const project = await projectFixture(page), id = project.public_project_id;
  const projection = workspaceProjection(project);
  const sections = ['identity', 'narrative', 'facts', 'buildings', 'contacts', 'facilities', 'features', 'places', 'commercial', 'investor'];
  projection.overview.readiness.required = sections.flatMap((section, group) => Array.from({ length: 12 }, (_, index) => ({
    code: 'gap-' + group + '-' + index, label: { th: 'Synthetic field ' + index }, state: 'missing',
    context: { kind: 'selling_point' as const, label: String(index + 1) },
    target: { level: 'project' as const, id, tab: 'data' as const, section, field: 'selling_point.title', item: `point-${group}-${index}` },
  })));
  projection.overview.readiness.recommended = projection.overview.readiness.required.map(item => ({ ...item }));
  projection.overview.tasks = projection.overview.readiness.required.slice(0, 12);
  projection.overview.changes_since_publication = Array.from({ length: 30 }, (_, index) => ({
    audit_id: String(900 - index), occurred_at: '2026-11-06T00:00:00Z', actor: { id: 'fixture-author', name: 'Synthetic author' },
    action: 'edit', entity: { kind: 'project' as const, ref: id, name: { th: 'Synthetic project' } },
    source_tab: 'projects', section_key: 'identity', reason: 'Synthetic latest change ' + index,
    version: { id: null, number: 30 - index, state: 'DRAFT' },
    target: { level: 'project' as const, id, tab: 'data' as const, section: 'identity', field: 'project.public_name' }, diff_available: false,
  }));
  await page.route(`**/content/workspace/project/${id}`, route => route.fulfill({ json: { data: projection } }));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const inventoryLoaded = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === `${api}/content-workflow/items` && url.searchParams.get('level') === 'project' && url.searchParams.get('id') === id;
    });
    await page.goto(`/website/project/${id}?tab=overview`);
    expect((await inventoryLoaded).status()).toBe(200);
    const required = page.getByRole('region', { name: text.readiness, exact: true });
    await expect(required.locator('h2')).toContainText('240');
    await expect(page.locator('.workspace-heading [role="status"]')).toHaveCount(0);
    await expect(required.locator('.workspace-gap-counts').first()).toHaveText(text.required + ' 12 · ' + text.recommended + ' 12');
    await expect(required.locator('.workspace-gap-group')).toHaveCount(10);
    await expect(required.locator('.workspace-gap-group[open]')).toHaveCount(0);
    const changes = page.getByRole('region', { name: text.since_publication, exact: true });
    await expect(changes.locator('.workspace-timeline > li')).toHaveCount(5);
    await expect(changes).toContainText(text.version + ' 30');
    await expect(changes.getByRole('link', { name: text.view_history, exact: true })).toHaveAttribute('href', `/website/project/${id}?tab=history`);
    await fitsWorkspace(page);
    const width = page.viewportSize()!.width;
    if (width >= 1280) expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(page.viewportSize()!.height * 2.2);
    await page.screenshot({ path: `artifacts/unified-workspace/w3.1/overview-${theme}-${width}.png`, fullPage: true });
    const group = required.locator('.workspace-gap-group').first();
    await group.locator('summary').focus(); await page.keyboard.press('Enter');
    await expect(group.locator('a')).toHaveCount(5);
    await expect(group.locator('a').first()).toHaveText(text.context_selling_point + ' 1 · Synthetic field 0');
    await expect(group.locator('a').first()).toHaveAttribute('href', workspaceHref(projection.overview.readiness.required[0].target));
    await group.getByRole('button', { name: `${text.view_all} (24)`, exact: true }).click();
    await expect(group.locator('a')).toHaveCount(24);
    await group.getByRole('button', { name: `${text.show_less} (24)`, exact: true }).click();
    await expect(group.locator('a')).toHaveCount(5);
  }
  expect(errors).toEqual([]);
});
async function persona(page: Page, role: string) {
  expect((await page.request.post('/api/local-session', { headers, data: { role } })).ok()).toBeTruthy();
}
async function read(page: Page, path: string) {
  const result = await page.request.get(path); expect(result.ok(), path).toBeTruthy(); return (await result.json()).data;
}
async function projectFixture(page: Page) {
  await persona(page, 'editor');
  const rows = await read(page, api + '/projects');
  const project = rows.find((row: { source?: { rem_project_id?: string } }) => row.source?.rem_project_id === 'DEMO-001');
  expect(project).toBeTruthy(); return project;
}

async function approvedQuestion(page: Page) {
  const key = 'w3_workspace_' + randomUUID().replaceAll('-', '');
  await persona(page, 'editor');
  const created = await page.request.put(`${api}/faq/questions/${key}`, { headers, data: {
    expected_revision: 0, changes: { topic: 'design', default_level: 'project', question_template: { th: 'Synthetic workspace question' },
      answer_kind: 'text', is_core: true, show_on_project_pages: true },
  } });
  expect(created.ok()).toBeTruthy();
  await persona(page, 'publisher');
  expect((await page.request.post(`${api}/faq/questions/${key}/approve`, { headers, data: { expected_revision: 1, decision: 'approved' } })).ok()).toBeTruthy();
  await persona(page, 'editor');
  const question = (await read(page, api + '/faq/questions')).items.find((item: { question_key: string }) => item.question_key === key);
  expect(question?.status).toBe('approved');
  return question;
}

test('all temporary legacy aliases retain exact context and separate REM/public references', () => {
  const query = new URLSearchParams({ project: 'prj_public', tab: 'upload', field: 'asset.alt_text', target_type: 'building_floor', target_key: 'B-01', floor: '3', media_category: 'floor_plan', usage: 'gallery', tags: 'plan', rule_key: 'floor_plan_required', phase: 'REM-EXACT' });
  const media = new URL(legacyWorkspaceHref('/media', query)!, origin);
  expect(media.pathname).toBe('/website/project/prj_public');
  expect(Object.fromEntries(media.searchParams)).toMatchObject({ tab: 'media', section: 'upload', phase: 'REM-EXACT', target_type: 'building_floor', target_key: 'B-01', floor: '3', category: 'floor_plan', usage: 'gallery', tags: 'plan', rule: 'floor_plan_required', field: 'asset.alt_text' });
  query.set('tags', JSON.stringify(['plan', 'approved_plan']));
  const readiness = new URL(legacyWorkspaceHref('/media', query)!, origin);
  expect(Object.fromEntries(readiness.searchParams)).toMatchObject({ tab: 'media', section: 'upload', category: 'floor_plan', rule: 'floor_plan_required', target_type: 'building_floor', target_key: 'B-01', floor: '3', tags: 'plan,approved_plan' });
  const cases = [
    ['/', 'brand=brd_exact&version=v-1', '/website/brand/brd_exact', 'history'],
    ['/content', 'project=prj_exact&tab=narrative&field=section.concept&revision=4', '/website/project/prj_exact', 'data'],
    ['/content/fields', '', '/settings', null],
    ['/faq', 'tab=bank', '/settings', null],
    ['/faq', 'tab=glossary', '/settings', null],
    ['/faq', 'tab=contacts', '/website/corporate/sena', 'data'],
    ['/faq', 'faq=faq-uuid', '/website', null],
    ['/faq', 'tab=drafts&faq=new', '/website/corporate/sena', 'faq'],
    ['/faq', 'tab=intake&cluster=cluster-uuid', '/website', 'intake'],
    ['/faq', 'tab=coverage', '/home', null],
    ['/', 'view=projects&q=synthetic', '/website', null],
    ['/', 'view=brands', '/website', null],
    ['/', 'view=groups&group=unconfirmed', '/website', null],
  ] as const;
  for (const [path, values, pathname, tab] of cases) {
    const destination = new URL(legacyWorkspaceHref(path, new URLSearchParams(values))!, origin);
    expect(destination.pathname).toBe(pathname);
    if (tab) expect(destination.searchParams.get('tab')).toBe(tab);
  }
  expect(legacyWorkspaceHref('/faq', new URLSearchParams('tab=publication'))).toBe('/publish?tab=publication');
  for (const level of ['project', 'brand']) {
    const faq = new URL(legacyWorkspaceHref('/', new URLSearchParams({ [level]: level + '_exact', tab: 'faq', phase: 'REM-EXACT', question_key: 'approved-question' }))!, origin);
    expect(faq.pathname).toBe('/website/' + level + '/' + level + '_exact');
    expect(Object.fromEntries(faq.searchParams)).toEqual({ tab: 'faq', phase: 'REM-EXACT', question: 'approved-question' });
    const explicit = new URL(legacyWorkspaceHref('/', new URLSearchParams({ [level]: level + '_exact', tab: 'faq', question: 'explicit-question', question_key: 'old-alias' }))!, origin);
    expect(explicit.searchParams.get('question')).toBe('explicit-question'); expect(explicit.searchParams.has('question_key')).toBe(false);
  }
  const coverage = new URL(legacyWorkspaceHref('/faq', new URLSearchParams('tab=coverage&project=prj_exact&phase=REM-EXACT&locale=en&unit_type=unit-public&offset=10'))!, origin);
  expect(Object.fromEntries(coverage.searchParams)).toEqual({ section: 'coverage', project: 'prj_exact', phase: 'REM-EXACT', locale: 'en', unit_type: 'unit-public', offset: '10' });
  const target = new URL(workspaceHref({ level: 'project', id: 'prj_exact', tab: 'media', phase: 'REM-EXACT', media_slot: { rule_key: 'cover', media_category: 'exterior', target_type: 'project', target_key: 'REM-EXACT', tags: ['hero'], usage: 'banner', media_role: 'hero' } }), origin);
  expect(target.searchParams.get('media_role')).toBe('hero'); expect(target.searchParams.get('media_upload')).toBe('1');
  expect(target.searchParams.get('phase')).toBe('REM-EXACT');
});

test('website hierarchy keeps programmes separate and ambiguous phases individually addressable', async ({ page }) => {
  await persona(page, 'editor');
  const item = (kind: 'corporate' | 'project' | 'programme', ref: string, children = false) => ({ key: kind + ':' + ref, kind, ref, name: { th: ref }, target: { level: kind, id: ref, tab: 'overview' }, parent: null, has_children: children, visible_phase_count: 1, grouping: { state: 'unconfirmed', group_ref: null, review_href: kind === 'project' ? '/faq?tab=publication' : null } });
  const queries: string[] = [], writes: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/hub/') && request.method() !== 'GET') writes.push(request.url()); });
  await page.route('**/content/workspace/tree?**', route => {
    const query = new URL(route.request().url()).searchParams; queries.push(query.toString());
    return route.fulfill({ json: { data: { items: query.has('parent_ref') ? [item('project', 'exact-phase-A'), item('project', 'exact-phase-B')] : [item('corporate', 'sena', true)], programmes: query.has('parent_ref') ? [] : [item('programme', 'LIVNEX')], next_cursor: null } } });
  });
  await page.goto('/website');
  await expect(page.locator('.workspace-programmes').getByRole('link', { name: 'LIVNEX', exact: true })).toHaveAttribute('href', '/website/programme/LIVNEX?tab=overview');
  await expect(page.locator('.workspace-tree').getByRole('link', { name: 'LIVNEX', exact: true })).toHaveCount(0);
  await page.locator('.workspace-tree > li > details > summary').click();
  for (const ref of ['exact-phase-A', 'exact-phase-B']) await expect(page.getByRole('link', { name: ref, exact: true })).toHaveAttribute('href', `/website/project/${ref}?tab=overview`);
  await expect(page.locator('.workspace-tree a[href="/faq?tab=publication"]')).toHaveCount(2);
  expect(queries.some(query => query.includes('parent_kind=corporate') && query.includes('parent_ref=sena'))).toBe(true);
  expect(writes).toEqual([]); await fitsWorkspace(page);
  await page.screenshot({ path: 'artifacts/unified-workspace/w3/hierarchy.png', fullPage: true });
});

for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark'] as const) {
  test(`entity tabs use one shell and a private read-only preview in ${colorScheme} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const project = await projectFixture(page), id = project.public_project_id;
    const writes: string[] = []; page.on('request', request => { if (request.url().includes('/api/hub/') && request.method() !== 'GET') writes.push(request.url()); });
    await page.goto(`/website/project/${id}?tab=overview`);
    await expect(page.locator('.unified-workspace > .workspace-heading h1')).toBeVisible();
    await expect(page.locator('.app-shell')).toHaveCount(1);
    for (const tab of ['overview', 'data', 'unit-types', 'media', 'faq', 'history']) await expect(page.locator('#workspace-tab-' + tab)).toBeVisible();
    await fitsWorkspace(page);
    await page.screenshot({ path: `artifacts/unified-workspace/w3/entity-${colorScheme}-${width}.png`, fullPage: true });
    await page.locator('#workspace-tab-overview').focus(); await page.keyboard.press('ArrowRight');
    await expect(page.locator('#workspace-tab-data')).toBeFocused();
    await expect(page.locator('#workspace-tab-data')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End'); await expect(page.locator('#workspace-tab-history')).toBeFocused();
    await page.keyboard.press('Home'); await expect(page.locator('#workspace-tab-overview')).toBeFocused();
    await page.getByRole('link', { name: text.preview, exact: true }).click();
    await expect(page.locator('iframe.workspace-preview')).toBeVisible();
    await expect(page.locator('iframe.workspace-preview')).toHaveAttribute('sandbox', '');
    await expect(page.locator('iframe.workspace-preview')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('iframe.workspace-preview')).toHaveCSS('color-scheme', 'light');
    await fitsWorkspace(page); expect(writes).toEqual([]);
    await page.screenshot({ path: `artifacts/unified-workspace/w3/preview-${colorScheme}-${width}.png`, fullPage: true });
  });
}

for (const width of [1280, 390]) {
  test(`FAQ shows missing first, inheritance and a fixed REM phase at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const project = await projectFixture(page), id = project.public_project_id, phase = project.source.rem_project_id;
    const question = await approvedQuestion(page);
    const target = { level: 'project' as const, id, tab: 'faq' as const, phase, question_key: question.question_key };
    const base = { question_key: question.question_key, label: { th: 'Synthetic missing core' }, is_core: true, answer_kind: 'text', display_state: 'missing', content_state: null, own_answer: null, effective_answer: null, facts: [], legacy_clusters: [], applicability: { state: 'applicable' }, targets: { create_override: target } };
    const inherited = { ...base, question_key: 'synthetic_inherited', label: { th: 'Synthetic inherited' }, is_core: false, display_state: 'inherited', effective_answer: { id: 'faq-source', revision: 3, version_id: 'version-source', state: 'PUBLISHED', question: 'Synthetic inherited', short_answer: 'Inherited source answer', detail: '', source: { scope_type: 'brand', scope_id: 'exact-brand', name: { th: 'Source brand' }, target: { level: 'brand', id: 'exact-brand', tab: 'faq' }, affected_project_count: 2, affected_count_complete: false }, author: { id: 'actor-author', name: 'Synthetic author' }, approver: { id: 'actor-approver', name: 'Synthetic approver' } }, targets: { create_override: { ...target, question_key: 'synthetic_inherited' }, edit_source: { level: 'brand', id: 'exact-brand', tab: 'faq' } } };
    await page.route(`**/content/workspace/project/${id}/faq?**`, route => route.fulfill({ json: { data: { page_scope: { type: 'project', id: phase }, selected_phase: phase, items: [base, inherited], next_cursor: null } } }));
    await page.goto(`/website/project/${id}?tab=faq`);
    const cards = page.locator('.workspace-faq-card');
    await expect(cards.first()).toContainText('Synthetic missing core'); await expect(cards.nth(1)).toContainText('Inherited source answer');
    await expect(cards.first()).not.toContainText(text.faq_question_pending);
    await expect(cards.nth(1)).toContainText('Synthetic author'); await expect(cards.nth(1)).toContainText('Synthetic approver');
    await expect(cards.nth(1).getByRole('link', { name: new RegExp(text.editSource) })).toHaveAttribute('href', /\/website\/brand\/exact-brand\?tab=faq&faq=faq-source/);
    await fitsWorkspace(page); await page.screenshot({ path: `artifacts/unified-workspace/w3/faq-${width}.png`, fullPage: true });
    await cards.first().getByRole('button', { name: text.newFaq, exact: true }).click();
    await expect(page.locator('#faq-short_answer-th')).toBeVisible();
    await expect(page.locator('.entity-embedded-faq')).toContainText(phase);
    await expect(page.locator('select').filter({ has: page.locator('option[value="corporate"]') })).toHaveCount(0);
    const posted: Record<string, unknown>[] = [], faqId = '79000000-0000-4000-8000-000000000031';
    const version = { version_no: 1, question: { th: 'Synthetic question' }, alt_questions: {}, short_answer: { th: 'Synthetic scoped answer' }, detail: {}, answer_kind: 'text', fact_keys: [], applies_to_project_ids: [phase], applicability_rule: {}, review_due: null, effective_to: null, state: 'DRAFT', ai_exposure: 'internal', created_at: '2026-11-04T00:00:00Z' };
    const faq = { id: faqId, question_key: question.question_key, scope_type: 'project', scope_id: phase, revision: 1, state: 'DRAFT', version, history: [version], sources: [], translations: [] };
    await page.route('**/api/hub/v1/admin/faq', async route => { if (route.request().method() !== 'POST') return route.fallback(); posted.push(route.request().postDataJSON()); await route.fulfill({ json: { data: faq } }); });
    await page.route(`**/api/hub/v1/admin/faq/${faqId}`, route => route.fulfill({ json: { data: faq } }));
    await page.locator('#faq-short_answer-th').fill('Synthetic scoped answer');
    await page.locator('.entity-embedded-faq form').getByRole('button', { name: /./ }).last().click();
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toMatchObject({ expected_revision: 0, changes: { scope_type: 'project', scope_id: phase, applies_to_project_ids: [phase], question_key: question.question_key } });
  });
}

test('an exact FAQ deep link beyond the first 50 preserves list filters and cursors', async ({ page }) => {
  const project = await projectFixture(page), id = project.public_project_id, phase = project.source.rem_project_id;
  const key = (await approvedQuestion(page)).question_key;
  const question = (questionKey: string) => ({ question_key: questionKey, label: { th: questionKey }, is_core: true, answer_kind: 'text', display_state: 'missing', own_answer: null, effective_answer: null, facts: [], legacy_clusters: [], applicability: { state: 'applicable' }, targets: { create_override: { level: 'project', id, tab: 'faq', phase, question_key: questionKey } } });
  const requests: Record<string, string>[] = [];
  await page.route(`**/content/workspace/project/${id}/faq?**`, route => {
    const query = new URL(route.request().url()).searchParams; requests.push(Object.fromEntries(query));
    const exact = query.get('question_key'), filtered = query.get('q') === 'keep this filter', after = query.get('after');
    const items = exact ? [question(key)] : filtered ? [question(after ? 'filtered-next-row' : 'filtered-first-row')] : after ? [question(key), question('row-51')] : Array.from({ length: 50 }, (_, index) => question('row-' + index));
    const next_cursor = exact || after ? null : filtered ? 'filtered-next' : 'after-first-50';
    return route.fulfill({ json: { data: { page_scope: { type: 'project', id: phase }, selected_phase: phase, items, next_cursor, unmatched_clusters: [], unmatched_next_cursor: null } } });
  });
  await page.goto(legacyWorkspaceHref('/', new URLSearchParams({ project: id, tab: 'faq', phase, question_key: key }))!);
  const selected = page.locator('[data-workspace-question]').filter({ has: page.getByRole('heading', { name: key, exact: true }) });
  await expect(selected).toHaveCount(1); await expect(selected).toBeFocused();
  await expect(page.locator('.workspace-faq-card')).toHaveCount(51);
  await page.locator('.workspace-faq').getByRole('button', { name: text.more, exact: true }).click();
  await expect(page.locator('.workspace-faq-card')).toHaveCount(52); await expect(selected).toHaveCount(1);
  const filter = page.locator('.workspace-faq form'); await filter.getByRole('searchbox').fill('keep this filter'); await filter.getByRole('button', { name: text.search, exact: true }).click();
  await expect(page.locator('.workspace-faq-card')).toHaveCount(2); await expect(selected).toHaveCount(1);
  await page.locator('.workspace-faq').getByRole('button', { name: text.more, exact: true }).click();
  await expect(page.locator('.workspace-faq-card')).toHaveCount(3); await expect(filter.getByRole('searchbox')).toHaveValue('keep this filter');
  const exact = requests.filter(query => query.question_key); expect(exact).toEqual([{ question_key: key, locale: 'th', phase }]);
  expect(requests).toContainEqual({ q: 'keep this filter', limit: '50', locale: 'th', phase, after: 'filtered-next' });
  await selected.getByRole('button', { name: text.newFaq, exact: true }).click();
  await expect(page.locator('#faq-short_answer-th')).toBeVisible(); expect(new URL(page.url()).searchParams.get('question')).toBe(key);
});

test('since-publication overview renders audit events with actor, reason and exact targets', async ({ page }) => {
  const project = await projectFixture(page), id = project.public_project_id;
  const projection = workspaceProjection(project);
  projection.overview.changes_since_publication = [{ audit_id: '530', occurred_at: '2026-11-04T00:00:00Z', actor: { id: 'synthetic-actor', name: 'Synthetic author' }, action: 'edit', entity: { kind: 'project', ref: id, name: { th: 'Synthetic changed project' } }, source_tab: 'projects', section_key: 'identity', reason: 'Synthetic change after publication', version: { id: null, number: null, state: null }, target: { level: 'project', id, tab: 'data', section: 'identity', field: 'project.public_name' }, diff_available: false }];
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route(`**/content/workspace/project/${id}`, route => route.fulfill({ json: { data: projection } }));
  await page.goto(`/website/project/${id}?tab=overview`);
  const changes = page.getByRole('region', { name: text.since_publication, exact: true });
  await expect(changes).toContainText('Synthetic author'); await expect(changes).toContainText('Synthetic change after publication');
  await expect(changes.getByRole('link', { name: 'Synthetic changed project', exact: true })).toHaveAttribute('href', `/website/project/${id}?tab=data&section=identity&field=project.public_name`);
  expect(errors).toEqual([]); await fitsWorkspace(page);
  await page.screenshot({ path: 'artifacts/unified-workspace/w3/changes-since-publication.png', fullPage: true });
});

test('history renders authorized actor, reason and before/after without a second mutation', async ({ page }) => {
  const project = await projectFixture(page), id = project.public_project_id;
  const event = { audit_id: '531', occurred_at: '2026-11-04T00:00:00Z', actor: { id: 'synthetic-actor', name: 'Synthetic reviewer' }, action: 'return', entity: { kind: 'project', ref: id, name: project.public_name }, source_tab: 'projects', section_key: 'identity', reason: 'Synthetic return reason', version: { id: 'synthetic-version', number: 4, state: 'returned' }, target: { level: 'project', id, tab: 'data', section: 'identity', field: 'project.public_name' }, diff_available: true };
  const edits = ['project', 'brand'].map((kind, index) => ({ ...event, audit_id: String(532 + index), action: 'edit', entity: { kind, ref: kind === 'project' ? id : 'brd_exact', name: { th: 'Synthetic ' + kind + ' edit' } }, source_tab: kind + 's', reason: 'Synthetic ordinary ' + kind + ' change', version: { id: null, number: null, state: null }, target: { level: kind, id: kind === 'project' ? id : 'brd_exact', tab: 'data' }, diff_available: false }));
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message));
  const writes: string[] = []; page.on('request', request => { if (request.url().includes('/api/hub/') && request.method() !== 'GET') writes.push(request.url()); });
  await page.route(`**/content/workspace/project/${id}/history?**`, route => route.fulfill({ json: { data: { items: [event, ...edits], next_cursor: null } } }));
  await page.route(`**/content/workspace/project/${id}/history/531`, route => route.fulfill({ json: { data: { ...event, before: { public_name: { th: 'Before synthetic' } }, after: { public_name: { th: 'After synthetic' } }, changed_field_keys: ['public_name'] } } }));
  await page.goto(`/website/project/${id}?tab=history`);
  const timeline = page.locator('.workspace-timeline'); await expect(timeline).toContainText('Synthetic reviewer'); await expect(timeline).toContainText('Synthetic return reason');
  for (const edit of edits) { await expect(page.locator('#content-event-' + edit.audit_id)).toContainText(edit.reason); await expect(page.locator('#content-event-' + edit.audit_id).getByRole('link')).toHaveText(edit.entity.name.th); }
  await timeline.locator('summary').click(); await expect(timeline).toContainText('Before synthetic'); await expect(timeline).toContainText('After synthetic');
  expect(writes).toEqual([]); expect(pageErrors).toEqual([]); await fitsWorkspace(page);
  await page.screenshot({ path: 'artifacts/unified-workspace/w3/history.png', fullPage: true });
});

test('unmatched FAQ pagination retains approved questions and exact scoped cluster targets', async ({ page }) => {
  const project = await projectFixture(page), id = project.public_project_id, phase = project.source.rem_project_id;
  const target = { level: 'project' as const, id, tab: 'faq' as const, phase };
  const question = (key: string) => ({ question_key: key, label: { th: key }, is_core: true, answer_kind: 'text', display_state: 'missing', own_answer: null, effective_answer: null, facts: [], legacy_clusters: [], applicability: { state: 'applicable' }, targets: {} });
  const cluster = (key: string) => ({ id: key, label: { th: key }, question_key: null, state: 'held', holds: ['mapping_conflict'], target });
  const cursors: string[] = [];
  await page.route(`**/content/workspace/project/${id}/faq?**`, route => {
    const after = new URL(route.request().url()).searchParams.get('after'); cursors.push(after ?? 'initial');
    const unmatched = after?.startsWith('u:');
    return route.fulfill({ json: { data: { page_scope: { type: 'project', id: phase }, selected_phase: phase,
      items: unmatched ? [] : [question(after ? 'second_question' : 'first_question')], next_cursor: after ? null : 'question-page-2',
      unmatched_clusters: [cluster(unmatched ? 'cluster-second' : 'cluster-first')], unmatched_next_cursor: unmatched ? null : 'u:000000001:cluster-first' } } });
  });
  await page.goto(`/website/project/${id}?tab=faq`);
  const unmatched = page.locator('.workspace-unmatched-clusters');
  await unmatched.getByRole('button', { name: text.more, exact: true }).click();
  await expect(page.locator('.workspace-faq-card')).toHaveCount(1);
  await expect(unmatched.locator('article')).toHaveCount(2);
  await page.locator('.workspace-faq > button').click();
  await expect(page.locator('.workspace-faq-card')).toHaveCount(2);
  await expect(unmatched.locator('article')).toHaveCount(2);
  await expect(unmatched.getByRole('button')).toHaveCount(0);
  await expect(unmatched.locator('[data-workspace-cluster="cluster-second"] a')).toHaveAttribute('href', workspaceHref(target, { cluster: 'cluster-second' }));
  expect(cursors).toEqual(['initial', 'u:000000001:cluster-first', 'question-page-2']);
  await fitsWorkspace(page);
});

test('Knowledge-only FAQ and history never request project or brand editor data', async ({ page }) => {
  const project = await projectFixture(page), id = project.public_project_id, phase = project.source.rem_project_id;
  const account = await read(page, '/api/hub/v1/me');
  for (const [key, value] of Object.entries(account.capabilities.tabs) as [string, { view: boolean; edit: boolean; approve: boolean }][]) {
    value.view = key === 'knowledge'; value.edit = key === 'knowledge'; value.approve = false;
  }
  await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data: account } }));
  const projection = workspaceProjection(project, 'project'); projection.tabs = ['faq', 'history']; projection.sections = [];
  await page.route(`**/content/workspace/project/${id}`, route => route.fulfill({ json: { data: projection } }));
  await page.route(`**/content/workspace/project/${id}/faq?**`, route => route.fulfill({ json: { data: { page_scope: { type: 'project', id: phase }, selected_phase: phase, items: [], next_cursor: null } } }));
  await page.route(`**/content/workspace/project/${id}/history?**`, route => route.fulfill({ json: { data: { items: [], next_cursor: null } } }));
  const sourceReads: string[] = [];
  page.on('request', request => { if (/\/api\/hub\/v1\/admin\/(projects|brands)(\/|$)/.test(new URL(request.url()).pathname)) sourceReads.push(request.url()); });
  await page.goto(`/website/project/${id}?tab=faq`);
  await expect(page.locator('.entity-embedded-faq')).toBeVisible();
  await expect(page.locator('#workspace-tab-faq')).toHaveAttribute('aria-selected', 'true');
  for (const tab of ['overview', 'data', 'unit-types', 'media']) await expect(page.locator('#workspace-tab-' + tab)).toHaveCount(0);
  await expect(page.locator('.workspace-persistent-editor')).toHaveCount(0);
  await page.locator('#workspace-tab-history').click();
  await expect(page.locator('#workspace-panel-history')).toBeVisible();
  await expect(page.locator('#workspace-panel-history')).toContainText(text.content_history_empty);
  await expect(page.locator('#workspace-panel-history')).not.toContainText(text.empty);
  expect(sourceReads).toEqual([]); await fitsWorkspace(page);
  await page.screenshot({ path: 'artifacts/unified-workspace/w3/knowledge-only.png', fullPage: true });
});

for (const width of [1280, 390]) for (const colorScheme of ['light', 'dark'] as const) test(`project data keeps the enabled inline assistant clear at ${width}px ${colorScheme}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  const project = await projectFixture(page);
  await page.goto(`/website/project/${project.public_project_id}?tab=data&section=identity`);
  await expect(page.locator('.workspace-persistent-editor input#public_name')).toBeVisible();
  await expectAssistantClearance(page, page.locator('.workspace-persistent-editor'));
  await page.screenshot({ path: `artifacts/unified-workspace/polish-p1/after/clearance-project-enabled-${width}-${colorScheme}.png` });
});

test('inline website decisions retain revisions, show the registry default and preserve manual numeric evidence', async ({ page }) => {
  const project = await projectFixture(page), id = project.public_project_id;
  const content = await read(page, `${api}/projects/${id}/content`);
  const existing = content.sections.find((item: { section_key: string }) => item.section_key === 'concept');
  const base = { kind: 'concept', value: 'Synthetic source narrative', source: { page_url: 'https://www.sena.co.th/project/synthetic', fetched_at: '2026-11-04T00:00:00Z' }, wiring: [], holds: [], section_key: 'concept', default_ai_exposure: 'web_only', decision_id: null, decision: null, can_use: true, requires_manual_entry: false };
  const items = [{ ...base, id: 'suggestion-use' }, { ...base, id: 'suggestion-edit' }, { ...base, id: 'suggestion-manual', kind: 'nearby', value: 'Synthetic numeric distance 500 m', section_key: null, can_use: false, requires_manual_entry: true }];
  const decisions: { id: string; body: Record<string, unknown> }[] = [];
  await page.route(`**/projects/${id}/content/website**`, async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { data: items } });
    const suggestionId = new URL(request.url()).pathname.split('/').at(-2)!;
    const body = request.postDataJSON(); decisions.push({ id: suggestionId, body });
    Object.assign(items.find(item => item.id === suggestionId)!, { decision: body.decision, decision_id: `decision-${decisions.length}` });
    return route.fulfill({ json: { data: { decision_id: `decision-${decisions.length}`, decision: body.decision, section_key: 'concept', saved: null } } });
  });
  await page.goto(`/website/project/${id}?tab=data&section=narrative`);
  const use = page.locator('#website-suggestion-suggestion-use');
  await expect(use.getByRole('link', { name: text.source, exact: true })).toHaveAttribute('href', base.source.page_url);
  await use.getByRole('button', { name: text.use, exact: true }).click();
  await expect.poll(() => decisions.length).toBe(1);
  expect(decisions[0]).toEqual({ id: 'suggestion-use', body: { expected_decision_id: null, decision: 'use', expected_revision: existing?.revision ?? 0 } });
  const edit = page.locator('#website-suggestion-suggestion-edit');
  await edit.getByRole('button', { name: text.editUse, exact: true }).click();
  await expect(edit.locator('form [data-exposure]')).toHaveAttribute('data-exposure', 'web_only');
  await expect(edit.locator('select')).toHaveCount(0);
  await edit.locator('textarea').fill('Revised synthetic narrative');
  await edit.getByRole('button', { name: text.editUse, exact: true }).click();
  await expect.poll(() => decisions.length).toBe(2);
  expect(decisions[1].body).toMatchObject({ expected_decision_id: null, decision: 'edit_use', expected_revision: existing?.revision ?? 0, changes: { body: { th: 'Revised synthetic narrative' } } });
  expect(decisions[1].body.changes).not.toHaveProperty('ai_exposure');
  await page.goto(`/website/project/${id}?tab=data&section=places`);
  const manual = page.locator('#website-suggestion-suggestion-manual');
  await expect(manual).toContainText('Synthetic numeric distance 500 m');
  await expect(manual.getByRole('button', { name: text.use, exact: true })).toHaveCount(0);
  await expect(manual.getByRole('button', { name: text.editUse, exact: true })).toHaveCount(0);
  await manual.getByRole('button', { name: text.reject, exact: true }).click();
  await expect(manual.getByRole('button', { name: text.reject, exact: true })).toBeDisabled();
  await manual.locator('textarea').fill('Synthetic distance lacks an agreed measurement');
  await manual.getByRole('button', { name: text.reject, exact: true }).click();
  await expect.poll(() => decisions.length).toBe(3);
  expect(decisions[2].body).toEqual({ expected_decision_id: null, decision: 'reject', reason: 'Synthetic distance lacks an agreed measurement' });
  await fitsWorkspace(page); await page.screenshot({ path: 'artifacts/unified-workspace/w3/inline-suggestions.png', fullPage: true });
});

test('unit and media tabs retain matching manual source evidence without disturbing dirty forms or FAQ-only scope', async ({ page }) => {
  const project = await projectFixture(page), id = project.public_project_id, phase = project.source.rem_project_id;
  const kinds = ['unit_types', 'unit_plans', 'floor_plans', 'videos', 'tours', 'nearby'];
  const items = kinds.map(kind => ({ id: 'manual-' + kind, kind, value: 'Synthetic evidence ' + kind + ' 500', source: { page_url: 'https://www.sena.co.th/project/synthetic', fetched_at: '2026-11-04T00:00:00Z' }, wiring: [], holds: [], section_key: null, decision_id: null, decision: null, can_use: false, requires_manual_entry: true }));
  const decisions: Record<string, unknown>[] = []; let releaseDecision: (() => void) | undefined;
  await page.route(`**/projects/${id}/content/website**`, async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { data: items } });
    decisions.push(route.request().postDataJSON()); await new Promise<void>(resolve => { releaseDecision = resolve; });
    return route.fulfill({ json: { data: { decision_id: 'synthetic-decision', decision: 'reject', section_key: null, saved: null } } });
  });
  await page.goto(`/website/project/${id}?tab=data&section=identity`);
  const name = page.locator('#public_name'); await expect(name).toBeVisible(); const original = await name.inputValue();
  await name.fill('Synthetic retained unsaved project name'); await page.locator('#workspace-tab-unit-types').click();
  const source = page.locator('.workspace-suggestion'); await expect(source.locator('article')).toHaveCount(3);
  for (const kind of kinds.slice(0, 3)) await expect(source).toContainText('Synthetic evidence ' + kind + ' 500');
  for (const kind of kinds.slice(3)) await expect(page.locator('#website-suggestion-manual-' + kind)).toHaveCount(0);
  for (const button of await source.getByRole('button', { name: text.reject, exact: true }).all()) await expect(button).toBeDisabled();
  await page.locator('#workspace-tab-data').click(); await expect(name).toHaveValue('Synthetic retained unsaved project name');
  await name.fill(original); await page.locator('#workspace-tab-unit-types').click();
  await expect(source.getByRole('button', { name: text.use, exact: true })).toHaveCount(0); await expect(source.getByRole('button', { name: text.editUse, exact: true })).toHaveCount(0);
  const plan = page.locator('#website-suggestion-manual-floor_plans'); await plan.getByRole('button', { name: text.reject, exact: true }).click();
  await expect(page.locator('.workspace-persistent-editor')).toHaveAttribute('inert', '');
  await expect(page.locator('#workspace-tab-media')).toBeDisabled(); await plan.locator('textarea').fill('Synthetic plan needs manual verification');
  await plan.getByRole('button', { name: text.reject, exact: true }).click(); await expect.poll(() => decisions.length).toBe(1);
  await expect(page.locator('#workspace-tab-media')).toBeDisabled(); await expect(plan.locator('textarea')).toHaveValue('Synthetic plan needs manual verification');
  expect(decisions[0]).toEqual({ expected_decision_id: null, decision: 'reject', reason: 'Synthetic plan needs manual verification' });
  await expect.poll(() => Boolean(releaseDecision)).toBe(true); releaseDecision!(); await expect(plan.locator('textarea')).toHaveCount(0);
  await page.locator('#workspace-tab-media').click(); await expect(source.locator('article')).toHaveCount(2);
  for (const kind of ['videos', 'tours']) await expect(source).toContainText('Synthetic evidence ' + kind + ' 500');
  for (const kind of ['unit_types', 'unit_plans', 'floor_plans', 'nearby']) await expect(page.locator('#website-suggestion-manual-' + kind)).toHaveCount(0);
  await expect(source.getByRole('button', { name: text.use, exact: true })).toHaveCount(0); await expect(source.getByRole('button', { name: text.editUse, exact: true })).toHaveCount(0);
  await fitsWorkspace(page); await page.screenshot({ path: 'artifacts/unified-workspace/w3/unit-media-evidence.png', fullPage: true });
  const projection = workspaceProjection(project); projection.tabs = ['faq', 'history']; projection.sections = [];
  await page.route(`**/content/workspace/project/${id}`, route => route.fulfill({ json: { data: projection } }));
  await page.route(`**/content/workspace/project/${id}/faq?**`, route => route.fulfill({ json: { data: { page_scope: { type: 'project', id: phase }, selected_phase: phase, items: [], next_cursor: null } } }));
  const sourceReads: string[] = []; page.on('request', request => { if (new URL(request.url()).pathname.startsWith(`${api}/projects/`)) sourceReads.push(request.url()); });
  await page.goto(`/website/project/${id}?tab=faq`); await expect(page.locator('.entity-embedded-faq')).toBeVisible();
  await expect(page.locator('.workspace-suggestion')).toHaveCount(0); await expect(page.locator('.workspace-persistent-editor')).toHaveCount(0); expect(sourceReads).toEqual([]);
});

test('activity requires actual Admin and passes exact visible filter values', async ({ page }) => {
  await persona(page, 'editor'); let reads = 0;
  await page.route('**/api/hub/v1/admin/content/activity?**', route => { reads++; return route.fulfill({ json: { data: { items: [], next_cursor: null } } }); });
  const denied = await page.goto('/settings/activity'); expect(denied?.status()).toBe(403); expect(reads).toBe(0);
  await persona(page, 'admin'); await page.goto('/settings/activity');
  await expect(page.getByRole('heading', { name: text.activity, exact: true })).toBeVisible();
  await page.getByLabel(text.project, { exact: true }).fill('prj_exact');
  await page.getByLabel('BUD', { exact: true }).fill('000-BU');
  await page.getByLabel(text.date_from, { exact: true }).fill('2026-11-01');
  await page.getByLabel(text.date_to, { exact: true }).fill('2026-11-04');
  const query = page.waitForRequest(request => request.url().includes('/content/activity?') && request.url().includes('rem_bu_id=000-BU'));
  await page.getByRole('button', { name: text.search, exact: true }).click();
  const url = new URL((await query).url()); expect(url.searchParams.get('project')).toBe('prj_exact'); expect(url.searchParams.get('rem_bu_id')).toBe('000-BU');
  expect(url.searchParams.get('date_from')).toBe('2026-11-01T00:00:00+07:00');
  expect(url.searchParams.get('date_to')).toBe('2026-11-04T23:59:59.999+07:00');
  await fitsWorkspace(page); await page.screenshot({ path: 'artifacts/unified-workspace/w3/activity.png', fullPage: true });
});
