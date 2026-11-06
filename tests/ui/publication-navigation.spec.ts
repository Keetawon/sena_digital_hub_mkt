import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { can, canOpenPage, emptyCapabilities, type HubAccount } from '../../apps/admin/lib/hub-permissions';
import { hubCurrentMenuKey, hubMenuItem, hubPermissionTab, hubServices, safeNext } from '../../apps/admin/components/hub-navigation-data';
import { legacyWorkspaceHref, queryParameters, workspaceText } from '../../apps/admin/lib/unified-workspace';
import { workflowText } from '../../apps/admin/lib/content-workflow';
import { openMobileMenu, closeMobileMenu } from './hub-navigation-helpers';

const requireAdmin = createRequire(resolve('apps/admin/package.json'));
const compiler = requireAdmin('typescript') as typeof import('../../apps/admin/node_modules/typescript');
const origin = 'http://127.0.0.1:3000';
const releaseId = '67000000-0000-4000-8000-000000000001';
const publicationId = '67000000-0000-4000-8000-000000000002';
const aliases = ['/publish', '/releases', '/faq?tab=publication'];
function account(tabs: Record<string, { view?: boolean; edit?: boolean; approve?: boolean }>, status = 'ACTIVE'): HubAccount {
  return { id: 'synthetic-publication-reader', status, role: 'viewer', capabilities: { ...emptyCapabilities, published_consumer: true, tabs } };
}
const allowed = (value: HubAccount, path: string) => { const url = new URL(path, origin); return canOpenPage(value, url.pathname, url.searchParams); };

test('one publication menu uses Knowledge View first and Releases View as its history fallback', () => {
  const item = hubMenuItem('publishing')!;
  expect(item.targets).toEqual([{ section: 'faq', href: '/publish' }, { section: 'releases', href: '/publish' }]);
  const rows = hubServices.flatMap(service => service.groups.flatMap(group => group.items));
  expect(rows.filter(row => row.key === 'publishing')).toHaveLength(1);
  expect(rows.flatMap(row => row.targets).filter(target => target.href === '/releases' || target.href === '/faq?tab=publication')).toEqual([]);
  const resolveTarget = (value: HubAccount) => item.targets.find(target => can(value.capabilities, hubPermissionTab(target.section)));
  expect(resolveTarget(account({ knowledge: { view: true } }))?.section).toBe('faq');
  expect(resolveTarget(account({ releases: { view: true } }))?.section).toBe('releases');
  expect(resolveTarget(account({ knowledge: { view: true }, releases: { view: true } }))?.section).toBe('faq');
  expect(resolveTarget(account({ projects: { view: true } }))).toBeUndefined();
});

for (const tab of ['knowledge', 'releases']) test(`${tab}-only View admits the publication destination and both old URLs`, () => {
  const value = account({ [tab]: { view: true } });
  for (const path of aliases) expect(allowed(value, path), path).toBe(true);
  expect(allowed(value, '/faq?tab=bank')).toBe(tab === 'knowledge');
});

test('inactive and missing-View accounts cannot use any publication alias', () => {
  for (const status of ['PENDING', 'SUSPENDED', 'REJECTED']) for (const path of aliases) {
    expect(allowed(account({ knowledge: { view: true }, releases: { view: true } }, status), path), `${status} ${path}`).toBe(false);
  }
  const withoutView: Parameters<typeof account>[0][] = [{}, { projects: { view: true } }, { knowledge: { edit: true, approve: true } }, { releases: { approve: true } }];
  for (const tabs of withoutView) {
    for (const path of aliases) expect(allowed(account(tabs), path), path).toBe(false);
  }
});

test('safe return paths retain publication context and menu activation is independent of the source section', () => {
  for (const path of ['/publish', `/publish?release=${releaseId}&project=prj_exact#history`, `/releases?release=${releaseId}`, '/faq?tab=publication&brand=brd_one&brand=brd_two']) expect(safeNext(path)).toBe(path);
  for (const path of ['//foreign.invalid/publish', 'https://foreign.invalid/publish', '/publish/extra', '/publish\\extra', '/publish\u0000']) expect(safeNext(path)).toBe('/');
  for (const section of ['projects', 'faq', 'releases'] as const) for (const path of aliases) expect(hubCurrentMenuKey(section, path)).toBe('publishing');
});

const preserved = { project: 'prj_exact', brand: ['brd_one', 'brd_two'], item: 'exact-item', publication: publicationId,
  release: releaseId, page: 'project:prj_exact', phase: '0001', tab: 'publication', absent: undefined };
test('legacy redirects retain every query value including repeated brand selections', () => {
  const query = queryParameters(preserved);
  expect(query.getAll('brand')).toEqual(preserved.brand);
  expect(query.has('absent')).toBe(false);
  for (const path of ['/releases', '/faq']) {
    const destination = new URL(legacyWorkspaceHref(path, query)!, origin);
    expect(destination.pathname).toBe('/publish');
    expect([...destination.searchParams]).toEqual([...query]);
  }
  expect(legacyWorkspaceHref('/releases', new URLSearchParams())).toBe('/publish');
  expect(legacyWorkspaceHref('/faq', new URLSearchParams('tab=bank'))).toBe('/settings?section=bank');
});

type Element = { type: string; props: Record<string, unknown> };
function serverPage(path: string, value: HubAccount | null, local: boolean) {
  const module = { exports: {} as { default: (props?: object) => Promise<Element> } };
  const notFound = new Error('synthetic-not-found');
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const modules: Record<string, unknown> = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/navigation': { notFound: () => { throw notFound; }, redirect: (href: string) => { throw { redirect: href }; } },
    '@/lib/hub-permissions': { can }, '@/lib/hosted-session': { getHubAccount: async () => value, getHubRole: async () => 'viewer' },
    '@/lib/local-session': { isLocalMode: () => local, roleLabels: { viewer: 'Synthetic reader' } },
    '@/lib/content-workflow': { workflowText }, '@/lib/unified-workspace': { legacyWorkspaceHref, queryParameters },
    '@/components/hub-shell': { HubShell: 'shell' }, '@/components/publication-workspace': { PublicationWorkspace: 'publication' },
    '@/components/accounts': { LocalPersonaPicker: 'persona' }, '@/components/faq-workspace': { FaqWorkspace: 'old-faq' },
  };
  const code = compiler.transpileModule(readFileSync(resolve(path), 'utf8'), { compilerOptions: {
    module: compiler.ModuleKind.CommonJS, target: compiler.ScriptTarget.ES2022, jsx: compiler.JsxEmit.ReactJSX,
  } }).outputText;
  runInNewContext(code, { module, exports: module.exports, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected server-page dependency: ${name}`);
    return modules[name];
  } });
  return { render: async (props?: object) => await module.exports.default(props), notFound };
}

for (const tab of ['knowledge', 'releases']) test(`actual publication server page admits ${tab} View and only renders the persona in local mode`, async () => {
  for (const local of [true, false]) {
    const page = serverPage('apps/admin/app/publish/page.tsx', account({ [tab]: { view: true } }), local);
    const result = await page.render();
    expect(result.type).toBe('shell');
    expect(result.props.section).toBe(tab === 'knowledge' ? 'faq' : 'releases');
    expect((result.props.children as Element).type).toBe('publication');
    expect(local ? (result.props.toolbar as Element).type : result.props.toolbar).toBe(local ? 'persona' : false);
  }
});

test('actual publication server page retains its separate inactive/no-View notFound guard', async () => {
  for (const value of [null, account({}), account({ projects: { view: true } }), account({ knowledge: { view: true } }, 'SUSPENDED')]) {
    const page = serverPage('apps/admin/app/publish/page.tsx', value, true);
    await expect(page.render()).rejects.toBe(page.notFound);
  }
});

for (const path of ['releases', 'faq']) test(`actual /${path} server page redirects with the same query and repeated selections`, async () => {
  const page = serverPage(`apps/admin/app/${path}/page.tsx`, account({ releases: { view: true } }), true);
  await expect(page.render({ searchParams: Promise.resolve(preserved) })).rejects.toEqual({ redirect: '/publish?' + queryParameters(preserved) });
});

async function enter(page: Page, role = 'viewer') {
  expect((await page.request.post('/api/local-session', { headers: { Origin: origin }, data: { role } })).ok()).toBe(true);
}

for (const tab of ['knowledge', 'releases'] as const) test(`local ${tab}-only reader sees one active publication link and the permitted history`, async ({ page }) => {
  await enter(page);
  const response = await page.request.get('/api/hub/v1/me'); expect(response.ok()).toBe(true);
  const value = (await response.json()).data as HubAccount;
  value.capabilities = { ...value.capabilities!, tabs: { [tab]: { view: true } }, special_actions: {} };
  await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data: value } }));
  const reads: string[] = [];
  for (const path of ['publication-queue', 'web', 'releases']) await page.route(`**/api/hub/v1/admin/${path}`, route => {
    reads.push(path);
    return route.fulfill({ json: { data: path === 'publication-queue' ? { items: [], web_history: [], release_history: [], can_publish: false }
      : path === 'web' ? { pages: [], can_publish: false } : { items: [], total: 0 } } });
  });
  await page.goto('/publish');
  await expect(page.getByRole('heading', { name: workflowText.release_history, exact: true })).toBeVisible();
  await expect(page.locator('.local-persona-picker [role="note"]')).toContainText(workspaceText.local_testing);
  await openMobileMenu(page);
  const navigation = page.locator('.hub-navigation');
  await expect(navigation.locator('a[href="/publish"]')).toHaveCount(1);
  await expect(navigation.locator('a[href="/publish"]')).toHaveAttribute('aria-current', 'page');
  await expect(navigation.locator('a[href="/releases"], a[href="/faq?tab=publication"]')).toHaveCount(0);
  await closeMobileMenu(page);
  if (tab === 'releases') {
    await expect(page.getByRole('heading', { name: workflowText.web_history, exact: true })).toHaveCount(0);
    expect(reads).toEqual(['releases']);
  } else {
    await expect(page.getByRole('heading', { name: workflowText.web_history, exact: true })).toBeVisible();
    expect(new Set(reads)).toEqual(new Set(['publication-queue', 'web']));
  }
  await expect(page.getByRole('button', { name: workflowText.publish, exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/unified-workspace/w4/publication-navigation-${tab}-${page.viewportSize()?.width}.png`, fullPage: true });
});

for (const legacy of ['/releases', '/faq?tab=publication']) test(`local ${legacy} redirects without losing project/item/brand context`, async ({ page }) => {
  await enter(page);
  const query = new URLSearchParams('project=prj_exact&item=exact-item&brand=brd_one&brand=brd_two');
  const url = legacy + (legacy.includes('?') ? '&' : '?') + query;
  const response = await page.goto(url);
  expect(response?.ok()).toBe(true);
  const destination = new URL(page.url());
  expect(destination.pathname).toBe('/publish');
  for (const [key, value] of query) expect(destination.searchParams.getAll(key)).toContain(value);
  if (legacy.startsWith('/faq')) expect(destination.searchParams.get('tab')).toBe('publication');
});

test('an authenticated no-View local persona is denied before publication content renders', async ({ page }) => {
  await enter(page, 'agency_kin');
  for (const path of aliases) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(403);
    await expect(page.locator('.publication-workspace')).toHaveCount(0);
  }
});
