import { expect, test } from '@playwright/test';
import { contentAllowsApi, contentAllowsQuery } from '../../apps/admin/lib/content-routes';
import { h1AllowsApi } from '../../apps/admin/lib/hosted-config';
import { canOpenPage, emptyCapabilities, type HubAccount } from '../../apps/admin/lib/hub-permissions';
import { safeNext } from '../../apps/admin/components/hub-navigation-data';

const root = 'v1/admin/content/workspace';
const id = '00000000-0000-4000-8000-000000000001';

test('workspace transport admits exact read and decision routes in local and H1', () => {
  for (const path of [`${root}/tree`, `${root}/resolve`, `${root}/project/prj_example`, `${root}/brand/brd_example/faq`, `${root}/corporate/sena/preview`, `${root}/programme/LIVNEX/history`, `${root}/unit_type/${id}/history/1`, 'v1/admin/content/activity']) {
    expect(contentAllowsApi(path, 'GET'), path).toBe(true);
    expect(h1AllowsApi(path, 'GET'), path).toBe(true);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(contentAllowsApi(path, method), `${method} ${path}`).toBe(false);
  }
  const decision = `v1/admin/projects/prj_example/content/website/${id}/decision`;
  expect(contentAllowsApi(decision, 'POST')).toBe(true);
  expect(h1AllowsApi(decision, 'POST')).toBe(true);
  expect(contentAllowsApi(decision, 'GET')).toBe(false);
  for (const path of [`${root}/new-unmapped`, `${root}/project/prj_example/new-unmapped`, `${root}/project/prj_example/history/9223372036854775808`, `${root}/project/prj_example/history/0`, decision + '/extra']) {
    expect(contentAllowsApi(path, 'GET'), path).toBe(false);
    expect(contentAllowsApi(path, 'POST'), path).toBe(false);
    expect(h1AllowsApi(path, 'GET'), path).toBe(false);
  }
});

test('workspace query bounds preserve exact filters and reject unknown or ambiguous context', () => {
  const check = (path: string, query: string) => contentAllowsQuery(path, 'GET', new URLSearchParams(query));
  expect(check(`${root}/tree`, 'parent_kind=brand&parent_ref=brd_example&q=001&limit=100')).toBe(true);
  expect(check(`${root}/tree`, 'parent_kind=brand')).toBe(false);
  expect(check(`${root}/tree`, 'limit=101')).toBe(false);
  expect(check(`${root}/resolve`, `faq=${id}&phase=0001`)).toBe(true);
  expect(check(`${root}/resolve`, `faq=${id}&cluster=${id}`)).toBe(false);
  expect(check(`${root}/project/prj_example/faq`, 'question_key=project_intro&phase=0001&locale=en')).toBe(true);
  for (const query of ['question_key=project_intro&q=', 'question_key=project_intro&after=x', 'locale=th&locale=en', 'unexpected=1', 'q=%00']) expect(check(`${root}/project/prj_example/faq`, query), query).toBe(false);
  expect(check('v1/admin/content/activity', 'date_from=2026-11-04T00%3A00%3A00%2B07%3A00&date_to=2026-11-05T00%3A00%3A00%2B07%3A00&rem_bu_id=0002')).toBe(true);
  expect(check('v1/admin/content/activity', 'date_from=2026-11-04T00%3A00%3A00')).toBe(false);
  expect(check(`${root}/project/prj_example/history`, 'before=9223372036854775808')).toBe(false);
  expect(check(`${root}/project/prj_example/history/1`, 'phase=0001')).toBe(false);
});

test('contextual Promotions transport preserves the exact local and H1 boundary', () => {
  const resolve = 'v1/admin/promotions/resolve';
  expect(contentAllowsApi(resolve, 'POST')).toBe(true);
  expect(h1AllowsApi(resolve, 'POST')).toBe(true);
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) expect(contentAllowsApi(resolve, method)).toBe(false);
  expect(contentAllowsQuery(resolve, 'POST', new URLSearchParams('unexpected=1'))).toBe(false);
  for (const kind of ['project', 'brand', 'project_group', 'corporate']) {
    const suffixes = kind === 'project' || kind === 'brand' ? ['promotions', 'promotions/suggestions'] : ['promotions'];
    for (const suffix of suffixes) {
      const path = `${root}/${kind}/example/${suffix}`;
      expect(contentAllowsApi(path, 'GET')).toBe(true);
      expect(h1AllowsApi(path, 'GET')).toBe(true);
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(contentAllowsApi(path, method)).toBe(false);
      const query = suffix.endsWith('suggestions') ? `item=${id}&source=website&limit=50&offset=0` : 'filter=ending_soon&limit=50&offset=0';
      expect(contentAllowsQuery(path, 'GET', new URLSearchParams(query))).toBe(true);
      for (const invalid of ['limit=101', 'offset=-1', 'source=secret', 'phase=a&phase=b', 'item=no', 'unknown=1'])
        expect(contentAllowsQuery(path, 'GET', new URLSearchParams(invalid)), `${path}?${invalid}`).toBe(false);
      expect(contentAllowsQuery(path, 'GET', new URLSearchParams('phase=0001'))).toBe(kind === 'project');
    }
  }
  for (const path of [`${root}/programme/LIVNEX/promotions`, `${root}/business/solar/promotions`, `${root}/corporate/sena/promotions/suggestions`, `${root}/project_group/00031/promotions/suggestions`, `${root}/project/example/promotions/extra`, `${resolve}/extra`]) {
    expect(contentAllowsApi(path, 'GET')).toBe(false);
    expect(contentAllowsApi(path, 'POST')).toBe(false);
    expect(h1AllowsApi(path, 'GET'), path).toBe(false);
  }
});

test('login return paths preserve entity context without admitting foreign or nested destinations', () => {
  for (const path of ['/website', '/settings?section=bank&question=project_intro', '/settings/activity', '/website/project/prj_example?tab=faq&phase=0001&question=project_intro#answer']) expect(safeNext(path)).toBe(path);
  for (const path of ['//example.test/website', '/website/project/a/extra', '/website/unknown/a', '/website/project/%2Foutside', '/website/project/%5Coutside', '/website/project/%00', '/website/project/%', '/website/project/' + 'x'.repeat(201)]) expect(safeNext(path)).toBe('/');
});


test('workspace page admission preserves Knowledge-only FAQ and actual Admin evidence boundaries', () => {
  const account: HubAccount = { id: 'synthetic', status: 'ACTIVE', role: 'viewer', hub_role: 'viewer', capabilities: { ...emptyCapabilities, published_consumer: true, tabs: { knowledge: { view: true } } } };
  const open = (path: string, value = account) => { const url = new URL(path, 'https://hub.invalid'); return canOpenPage(value, url.pathname, url.searchParams); };
  expect(open('/website')).toBe(true);
  expect(open('/website?view=brands')).toBe(false);
  expect(open('/website?view=projects')).toBe(false);
  expect(open('/website/project/prj_example?tab=faq')).toBe(true);
  expect(open('/?project=prj_example&tab=faq')).toBe(true);
  expect(open('/settings?section=bank')).toBe(true);
  for (const path of ['/content?project=prj_example', '/media?project=prj_example', '/settings?section=fields', '/knowledge', '/settings/activity']) expect(open(path), path).toBe(false);
  const manager = { ...account, capabilities: { ...account.capabilities!, can_manage_users: true } };
  expect(open('/knowledge', manager)).toBe(false);
  expect(open('/settings/activity', manager)).toBe(false);
  const admin = { ...account, role: 'admin', hub_role: 'admin' };
  expect(open('/knowledge', admin)).toBe(true);
  expect(open('/settings/activity', admin)).toBe(true);
  expect(open('/knowledge', { ...admin, capabilities: { ...emptyCapabilities } })).toBe(false);
  const demoted = { ...admin, hub_role: 'viewer' };
  expect(open('/knowledge', demoted)).toBe(false);
  expect(open('/settings/activity', demoted)).toBe(false);
});
