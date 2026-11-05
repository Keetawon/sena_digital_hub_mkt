import { expect, type Page, type Route } from '@playwright/test';
import { workspaceText, workspaceHref, type WorkspaceEntity, type WorkspaceTarget } from '../../apps/admin/lib/unified-workspace';
export { workspaceText, workspaceHref };
export function entityRef(page: Page, kind: 'project' | 'brand') {
  const url = new URL(page.url()), match = url.pathname.match(new RegExp('^/website/' + kind + '/([^/]+)$'));
  return match ? decodeURIComponent(match[1]) : url.searchParams.get(kind);
}
type Source = { public_project_id?: string; public_brand_id?: string; public_name?: { th?: string; en?: string }; name?: string; name_th?: string; source?: { rem_project_id?: string }; rem_project_id?: string };
export type FixtureSources = Source | Source[] | ((id: string) => Source | undefined);
const sourceFor = (sources: FixtureSources, id: string) => typeof sources === 'function' ? sources(id) : Array.isArray(sources) ? sources.find(item => item.public_project_id === id || item.public_brand_id === id) : sources;
export function workspaceProjection(source: Source, kind: 'project' | 'brand' = 'project'): WorkspaceEntity {
  const id = (kind === 'brand' ? source.public_brand_id : source.public_project_id)!;
  const rem = source.source?.rem_project_id ?? source.rem_project_id ?? id;
  const name = source.public_name ?? { th: source.name ?? source.name_th ?? id };
  return {
    entity: { kind, ref: id, name, scope_type: kind, scope_id: kind === 'project' ? rem : id },
    phases: kind === 'project' ? [{ rem_project_id: rem, public_project_id: id, name }] : [], selected_phase: kind === 'project' ? rem : null,
    tabs: kind === 'project' ? ['overview', 'data', 'unit-types', 'media', 'faq', 'history'] : ['overview', 'data', 'media', 'faq', 'history'],
    sections: [{ key: 'identity', label: workspaceText.identity, tab: 'data', state: 'DRAFT', revision: 0, suggestion_count: 0, target: { level: kind, id, tab: 'data', section: 'identity' } }],
    overview: { readiness: { required: [], recommended: [] }, tasks: [], changes_since_publication: [], preview_target: { level: kind, id, tab: 'overview', section: 'preview' } },
  };
}
/** Extend existing editor fixtures with the new read-only container; never intercept their writes. */
export async function fulfilWorkspaceProjection(route: Route, sources: FixtureSources): Promise<boolean> {
  if (route.request().method() !== 'GET') return false;
  const url = new URL(route.request().url()), path = url.pathname;
  const match = path.match(/\/content\/workspace\/(project|brand)\/([^/]+)(?:\/(history|faq|preview))?$/);
  if (match) {
    const id = decodeURIComponent(match[2]), source = sourceFor(sources, id);
    if (!source) return false;
    const projection = workspaceProjection({ ...source, [match[1] === 'brand' ? 'public_brand_id' : 'public_project_id']: id }, match[1] as 'project' | 'brand');
    const data = match[3] === 'history' ? { items: [], next_cursor: null } : match[3] === 'faq' ? { page_scope: { type: projection.entity.scope_type, id: projection.entity.scope_id }, selected_phase: projection.selected_phase, items: [], next_cursor: null } : match[3] === 'preview' ? { mode: 'PRIVATE_DRAFT', saved: false, preview: {}, issues: [], html: '<p>Private fixture preview</p>' } : projection;
    await route.fulfill({ json: { data } }); return true;
  }
  const content = path.match(/\/(projects|brands)\/([^/]+)\/content$/);
  if (content && sourceFor(sources, decodeURIComponent(content[2]))) {
    await route.fulfill({ json: { data: { facts: [], rem: {}, computed: {}, buildings: [], sections: [], selling_points: [], contacts: [], translations: [], readiness: { required_missing: 0, ready: true, items: [] } } } }); return true;
  }
  return false;
}
export async function mockWorkspaceProjection(page: Page, sources: FixtureSources) {
  await page.route('**/api/hub/v1/admin/content/workspace/**', async route => { if (!await fulfilWorkspaceProjection(route, sources)) await route.fallback(); });
  await page.route(/\/api\/hub\/v1\/admin\/(projects|brands)\/[^/]+\/content$/, async route => { if (!await fulfilWorkspaceProjection(route, sources)) await route.fallback(); });
}
export async function openWorkspaceTab(page: Page, tab: 'data' | 'supplementary' | 'media' | 'unit-types' | 'history') {
  const target = tab === 'supplementary' ? 'data' : tab;
  await page.locator('#workspace-tab-' + target).click();
  if (tab === 'supplementary') await page.getByRole('button', { name: workspaceText.supplementary, exact: true }).click();
  if (tab === 'media') await page.getByRole('button', { name: workspaceText.canonicalMedia, exact: true }).click();
  if (tab === 'history') { const editor = page.locator('.workspace-persistent-editor'); if (await editor.getAttribute('open') === null) await editor.locator(':scope > summary').click(); }
}
export async function fitsWorkspace(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
