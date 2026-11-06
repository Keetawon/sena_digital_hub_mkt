// Transport allowlist; SQL resolves each saved item's current source authority.
const workflow = 'v1/admin/content-workflow', queue = 'v1/admin/publication-queue';
const kinds = new Set(['project', 'model', 'brand', 'faq', 'section', 'selling_point', 'contact',
  'fact', 'building', 'facility', 'feature', 'place', 'asset', 'project_asset', 'brand_asset',
  'type_asset', 'asset_context', 'media_link', 'media_target', 'unit_type', 'price', 'disclosure',
  'sales_term', 'programme', 'progress', 'solar', 'article', 'question', 'glossary', 'promotion', 'page_config']);
const bounded = (value: string | null, max: number) => value !== null && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

export function workflowAllowsApi(path: string, method: string) {
  if (method === 'GET') return [workflow, workflow + '/items', queue].includes(path);
  return method === 'POST' && [workflow + '/submit', workflow + '/review', workflow + '/save-approve',
    queue + '/prepare', queue + '/publish', queue + '/return'].includes(path);
}

export function workflowAllowsQuery(path: string, method: string, query: URLSearchParams) {
  if (!workflowAllowsApi(path, method) || method !== 'GET') return false;
  if ([...query.keys()].some(key => query.getAll(key).length !== 1)) return false;
  if (path === queue) return query.size === 0;
  if (path.endsWith('/items')) {
    const rules: Record<string, (value: string | null) => boolean> = {
      level: value => ['corporate','brand','project','programme','project_group','unit_type'].includes(value ?? ''),
      id: value => bounded(value, 200), phase: value => bounded(value, 200),
      after: value => bounded(value, 8192), limit: value => /^(?:[1-9]\d?|100)$/.exec(value ?? '')?.[0] === value,
    };
    return query.has('level') && query.has('id') && [...query.keys()].every(key => Object.hasOwn(rules, key) && rules[key](query.get(key)));
  }
  const kind = query.get('kind'), raw = query.get('identity');
  if (query.size !== 2 || !kind || !kinds.has(kind) || !bounded(raw, 1000)) return false;
  try {
    const value: unknown = JSON.parse(raw!);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const expected = ({ question: ['question_key'], glossary: ['term_key'], building: ['project_id', 'building_key'],
      facility: ['project_id', 'facility_code'], selling_point: ['project_id', 'point_key'] } as Record<string, string[]>)[kind] ?? ['id'];
    return Object.keys(value).length === expected.length && expected.every(key => {
      const item = (value as Record<string, unknown>)[key];
      return typeof item === 'string' && bounded(item, 200);
    });
  } catch { return false; }
}
