import { expect, test } from '@playwright/test';
import { contentAllowsApi, contentAllowsQuery } from '../../apps/admin/lib/content-routes';
import { h1AllowsApi } from '../../apps/admin/lib/hosted-config';

const workflow = 'v1/admin/content-workflow', queue = 'v1/admin/publication-queue';
test('workflow transport admits only exact saved-item and queue commands', () => {
  for (const [method, paths] of [
    ['GET', [workflow, workflow + '/items', queue]],
    ['POST', [workflow + '/submit', workflow + '/review', workflow + '/save-approve', queue + '/prepare', queue + '/publish', queue + '/return']],
  ] as const) for (const path of paths) {
    expect(contentAllowsApi(path, method), path).toBe(true);
    expect(h1AllowsApi(path, method), path).toBe(true);
    for (const denied of ['PUT', 'PATCH', 'DELETE']) expect(contentAllowsApi(path, denied)).toBe(false);
    expect(contentAllowsApi(path + '/extra', method)).toBe(false);
    expect(h1AllowsApi(path + '/extra', method)).toBe(false);
  }
});
test('workflow query preserves native identities and rejects ambiguous or extra context', () => {
  const read = (kind: string, identity: unknown) => new URLSearchParams({kind, identity: JSON.stringify(identity)});
  const check = (query: URLSearchParams) => contentAllowsQuery(workflow, 'GET', query);
  expect(check(read('building', {project_id:'0001', building_key:'0002'}))).toBe(true);
  expect(check(read('faq', {id:'exact-id'}))).toBe(true);
  for (const query of [read('unknown', {id:'x'}), read('faq', {id:'x', project_id:'y'}), read('building', {project_id:'x'}),
    read('faq', ['x']), read('faq', {id:1}), read('faq', {id:'\u0000'}), new URLSearchParams('kind=faq&identity={'),
    new URLSearchParams('kind=faq&kind=brand&identity=%7B%22id%22%3A%22x%22%7D')]) expect(check(query)).toBe(false);
  const items = (query: string) => contentAllowsQuery(workflow + '/items', 'GET', new URLSearchParams(query));
  expect(items('level=project&id=prj_example&phase=0001&limit=100')).toBe(true);
  for (const query of ['level=project', 'id=prj_example', 'level=project&id=x&limit=101', 'level=project&id=x&unexpected=y', 'level=project&id=x&id=y']) expect(items(query)).toBe(false);
  expect(contentAllowsQuery(queue, 'GET', new URLSearchParams('unexpected=1'))).toBe(false);
  expect(contentAllowsQuery(queue + '/publish', 'POST', new URLSearchParams('kind=project'))).toBe(false);
});

test('workflow query rejects prototype names, controls and malformed family neighbours', () => {
  const path = workflow + '/items';
  for (const key of ['constructor', 'toString', '__proto__']) {
    const query = new URLSearchParams({ level: 'project', id: 'prj_exact', [key]: 'unexpected' });
    expect(contentAllowsQuery(path, 'GET', query), key).toBe(false);
  }
  for (const key of ['level', 'limit']) for (const suffix of ['\n', '\r', '\u2028', '\u2029']) {
    const query = new URLSearchParams({ level: 'project', id: 'prj_exact', limit: '50' });
    query.set(key, query.get(key)! + suffix);
    expect(contentAllowsQuery(path, 'GET', query), key + JSON.stringify(suffix)).toBe(false);
  }
  for (const family of [workflow, queue]) for (const suffix of ['/extra', '/../items', '/items/extra', '/items\n']) {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      expect(contentAllowsApi(family + suffix, method)).toBe(false);
      expect(h1AllowsApi(family + suffix, method)).toBe(false);
      expect(contentAllowsQuery(family + suffix, method, new URLSearchParams('q=unexpected'))).toBe(false);
    }
  }
});
