const id = '[a-zA-Z0-9_-]{1,128}', code = '[A-Za-z0-9_-]{1,80}', uuid = '[0-9a-fA-F-]{36}';
const references = '(?:rail_lines|rail_stations|expressways|expressway_ramps|features|facilities)';
const routes: Record<string, RegExp> = {
  GET: new RegExp(`^v1/admin/(?:projects/${id}/amenities|place-references(?:/template)?)$`),
  PUT: new RegExp(`^v1/admin/(?:projects/${id}/amenities/(?:facilities/${code}|(?:features|solar|places)/${uuid})|place-references/${references}/${code})$`),
  POST: new RegExp(`^v1/admin/(?:projects/${id}/amenities/(?:facilities/${code}/cover|solar/${uuid}/review)|place-references/import)$`),
};
export function amenityAllowsApi(path: string, method: string) { return routes[method]?.test(path) ?? false; }
