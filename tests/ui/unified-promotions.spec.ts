import { expect, test, type Page } from '@playwright/test';
import { persona, readData, workflowText, mockWorkflowReads } from './content-workflow-fixtures';
import { fitsWorkspace, workspaceProjection, workspaceHref, workspaceText as text } from './unified-workspace-helpers';
import { contentScopeText } from '../../apps/admin/lib/content-scope-text';
import { promotionTiers } from '../../apps/admin/components/promotion-types';

const api = '/api/hub/v1/admin';
const projectId = '61000000-0000-4000-8000-000000000031';
const brandId = '61000000-0000-4000-8000-000000000032';
const promotionId = '61000000-0000-4000-8000-000000000033';
const assetId = '61000000-0000-4000-8000-000000000035';
const versionId = '61000000-0000-4000-8000-000000000036';
const project = { id: projectId, public_project_id: 'prj_w32', public_name: { th: 'Synthetic project' }, source: { rem_project_id: 'REM-W32' } };
const brand = { id: brandId, public_brand_id: 'brd_w32', public_name: { th: 'Synthetic brand' } };
const scope = { scope_hash: 'a'.repeat(64), count: 2, items: [
  { id: projectId, public_id: project.public_project_id, label: project.public_name },
  { id: '61000000-0000-4000-8000-000000000034', public_id: 'prj_neighbour', label: { th: 'Synthetic neighbour' } },
] };
type Write = { path: string; method: string; body: Record<string, any> };

for (const [tier, label] of Object.entries(promotionTiers)) {
  test(`unified editor creates and edits ${tier} with multiple benefits and live preview`, async ({ page }) => {
    const data = await fixture(page);
    await page.goto('/promotions?promotion=new');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: new RegExp(label.replace('/', '\\/')) }).check();
    if (tier === 'project') await dialog.locator('#promotion-project').selectOption(projectId);
    if (tier === 'brand') await dialog.locator('#promotion-brand').selectOption(brandId);
    if (tier === 'project_group') await dialog.locator('#promotion-project-group').selectOption('00031');
    if (tier === 'corporate') await dialog.locator('#promotion-programme').selectOption('livnex');
    if (tier === 'campaign') await dialog.getByLabel('ทุกโครงการที่เปิดใช้งาน', { exact: true }).check();
    await dialog.getByLabel('รหัสโปรโมชัน', { exact: true }).fill(`TIER-${tier.toUpperCase()}`);
    await dialog.getByLabel('ชื่อโปรโมชัน (ภาษาไทย)', { exact: true }).fill(`ข้อเสนอ ${label}`);
    await dialog.getByLabel('เริ่มใช้สิทธิ์', { exact: true }).fill('2026-11-01T09:00');
    await dialog.getByLabel('สิ้นสุดสิทธิ์ (ไม่รวมเวลานี้)', { exact: true }).fill('2026-12-31T23:59');
    await dialog.getByLabel('คำโปรยไฮไลต์บนการ์ด', { exact: true }).fill('จ่าย 0 บาท*');
    await dialog.locator('#promotion-benefit_type').selectOption('discount_amount');
    await dialog.getByLabel('มูลค่าสิทธิประโยชน์', { exact: true }).fill('120,000.50');
    await dialog.locator('#promotion-benefit_unit').selectOption('THB');
    await dialog.getByRole('button', { name: 'ฟรีค่าโอน', exact: true }).click();
    const preview = dialog.getByRole('complementary', { name: 'ตัวอย่างการ์ดบนเว็บไซต์' });
    await expect(preview).toContainText('120,000.5'); await expect(preview).toContainText('ฟรีค่าโอน');
    await expect(preview).toContainText('จ่าย 0 บาท*'); await expect(preview).toContainText(label);
    await dialog.getByRole('button', { name: 'บันทึกร่างโปรโมชัน', exact: true }).click();
    await expect.poll(() => data.writes.filter(write => write.path === 'promotions').length).toBe(1);
    const created = data.writes.find(write => write.path === 'promotions')!.body;
    expect(created.promotion_tier).toBe(tier); expect(created.benefit_items).toHaveLength(2);
    expect(created.benefit_value).toBe('120000.50');
    await expect(dialog.locator('#promotion-owner')).toBeDisabled();
    await dialog.getByLabel('ชื่อโปรโมชัน (ภาษาไทย)', { exact: true }).fill(`แก้ไข ${label}`);
    await dialog.getByRole('button', { name: 'บันทึกร่างโปรโมชัน', exact: true }).click();
    await expect.poll(() => data.writes.filter(write => write.method === 'PATCH').length).toBe(1);
    expect(data.writes.find(write => write.method === 'PATCH')!.body).not.toHaveProperty('promotion_tier');
  });
}

for (const theme of ['light', 'dark'] as const) for (const width of [1280, 390]) {
  test(`unified promotion editor and preview fit ${theme} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await fixture(page); await page.goto('/promotions?promotion=new');
    await expect(page.getByRole('complementary', { name: 'ตัวอย่างการ์ดบนเว็บไซต์' })).toBeVisible();
    await page.getByRole('button', { name: '+ เพิ่มรายการสิทธิประโยชน์', exact: true }).click();
    await fitsWorkspace(page);
    expect(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.getByRole('dialog').evaluate(node => { node.scrollTop = 0; });
    await page.screenshot({ path: `artifacts/unified-workspace/w3.2/five-tier-editor-${theme}-${width}.png` });
    const preview = page.getByRole('complementary', { name: 'ตัวอย่างการ์ดบนเว็บไซต์' });
    await preview.scrollIntoViewIfNeeded();
    await expect(preview).toBeInViewport();
    await preview.screenshot({ path: `artifacts/unified-workspace/w3.2/five-tier-preview-${theme}-${width}.png` });
  });
}

test('declining navigation from a dirty promotion retains its URL and copy', async ({ page }) => {
  await fixture(page);
  await page.goto(`/promotions?promotion=${promotionId}`);
  const dialog = page.getByRole('dialog');
  const title = dialog.getByLabel('ชื่อโปรโมชัน (ภาษาไทย)', { exact: true });
  await title.fill('ร่างที่ยังไม่บันทึก');
  const before = page.url();
  for (const selector of ['a[href^="/publish?"]', 'a[href^="/media?"]']) {
    page.once('dialog', confirm => confirm.dismiss());
    await dialog.locator(selector).first().click();
    await expect(page).toHaveURL(before);
    await expect(title).toHaveValue('ร่างที่ยังไม่บันทึก');
  }
});

test('contextual promotion cards show all five inheritance badges and benefit packages', async ({ page }) => {
  const data = await fixture(page);
  const template = data.items[0];
  data.items.splice(0, data.items.length, ...Object.keys(promotionTiers).map((tier, index) => ({ ...template,
    id: index === 0 ? promotionId : `61000000-0000-4000-8000-00000000005${index}`,
    promotion_tier: tier, applies_via: tier, highlight_badge: { th: 'ไฮไลต์เฉพาะรายการ' },
    benefit_items: [{ benefit_type: 'gift', benefit_value: '5000', benefit_unit: 'THB', label: { th: 'บัตรกำนัล' } }],
  })));
  await page.goto(`/website/project/${data.ref}?tab=promotions`);
  for (const label of Object.values(promotionTiers)) await expect(page.locator('.contextual-promotions .promo-badge').filter({ hasText: label }).first()).toBeVisible();
  await expect(page.locator('.contextual-promotions')).toContainText('บัตรกำนัล · 5,000 บาท');
  await expect(page.getByRole('button', { name: text.promotion_exclude_project, exact: true })).toHaveCount(4);
});

test('tier switches clear hidden scope selections and empty translations keep the drawer open', async ({ page }) => {
  await fixture(page); await page.goto('/promotions?promotion=new');
  const dialog = page.getByRole('dialog');
  await dialog.locator('#promotion-owner').selectOption('corporate');
  await dialog.locator('#promotion-programme').selectOption('livnex');
  await dialog.locator('#promotion-owner').selectOption('campaign');
  await expect(dialog.getByLabel('ทุกโครงการที่เปิดใช้งาน', { exact: true })).toBeVisible();
  await dialog.getByLabel('ทุกโครงการที่เปิดใช้งาน', { exact: true }).check();
  await dialog.locator('#promotion-owner').selectOption('project');
  await expect(dialog.getByRole('group', { name: 'แบบที่อยู่อาศัย', exact: true })).toBeVisible();
  const drawer = dialog.locator('details.promo-subdrawer');
  await drawer.locator('summary').click();
  await dialog.locator('#promotion-title-en').fill('Draft translation');
  await dialog.locator('#promotion-title-en').fill('');
  await expect(drawer).toHaveAttribute('open', '');
});

test('global create after a contextual edit does not lock an empty owner', async ({ page }) => {
  const data = await fixture(page, 'brand');
  await page.goto(`/website/brand/${data.ref}?tab=promotions`);
  await page.locator(`[data-workspace-item="${promotionId}"]`).getByRole('link', { name: text.promotion_open_editor, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'สร้างโปรโมชัน', exact: true }).click();
  await expect(page.locator('#promotion-owner')).toBeEnabled();
  await expect(page.locator('#promotion-project')).toBeEnabled();
});

test('server status filtering preserves paused rows and resets pagination', async ({ page }) => {
  const data = await fixture(page);
  Object.assign(data.row, { published_version_id: null, versions: [], ends_at: '2030-12-01T00:00:00Z', status_group: 'paused' });
  const queries: URLSearchParams[] = [];
  await page.route(`**${api}/promotions?**`, route => {
    queries.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: { data: { items: [data.row], total: 1, tier_counts: { all: 51, brand: 51 }, status_counts: { all: 51, live: 0, draft: 50, paused: 1 } } } });
  });
  await page.goto('/promotions?offset=50');
  await page.getByRole('button', { name: /งดแสดง \/ หมดอายุ/ }).click();
  await expect.poll(() => queries.at(-1)?.get('status')).toBe('paused');
  expect(queries.at(-1)?.get('offset')).toBe('0');
  await expect(page.locator('.promo-table')).toContainText('Synthetic shared offer');
  await expect(page.locator('.promo-kpis').getByRole('button', { name: /ทั้งหมด/ })).toContainText('51');
});

test('changing a project clears unit targets from the previous owner', async ({ page }) => {
  const data = await fixture(page);
  const neighbour = { id: scope.items[1].id, public_project_id: scope.items[1].public_id, public_name: scope.items[1].label };
  await page.route(`**${api}/projects?summary=1`, route => route.fulfill({ json: { data: [project, neighbour] } }));
  await page.route(`**${api}/promotions/references`, route => route.fulfill({ json: { data: { projects: scope.items, brands: [],
    commercial_types: [{ id: assetId, project_id: project.public_project_id, label: { th: 'แบบบ้านโครงการแรก' } }],
  } } }));
  await page.goto('/promotions?promotion=new');
  await page.locator('#promotion-project').selectOption(projectId);
  await page.getByRole('checkbox', { name: 'แบบบ้านโครงการแรก', exact: true }).check();
  await page.locator('#promotion-project').selectOption(neighbour.id);
  await expect.poll(() => data.writes.filter(write => write.path === 'promotions/resolve').at(-1)?.body.project_id).toBe(neighbour.id);
  expect(data.writes.filter(write => write.path === 'promotions/resolve').at(-1)?.body.targets).toEqual([]);
  await expect(page.getByRole('checkbox', { name: 'แบบบ้านโครงการแรก', exact: true })).toHaveCount(0);
});

async function fixture(page: Page, kind: 'project' | 'brand' = 'project', role = 'editor', promotionsView = true) {
  await persona(page, role);
  await mockWorkflowReads(page, { role });
  const account = await readData(page, '/api/hub/v1/me');
  const capabilities = { ...account.capabilities, tabs: { ...account.capabilities.tabs,
    ...Object.fromEntries(['projects', 'brands', 'knowledge', 'promotions'].map(tab => [tab, {
      view: tab !== 'promotions' || promotionsView, edit: role === 'editor', approve: role === 'publisher',
    }])),
  } };
  await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data: { ...account, capabilities } } }));
  const ref = kind === 'project' ? project.public_project_id : brand.public_brand_id;
  const projection = workspaceProjection(kind === 'project' ? project : brand, kind);
  projection.tabs = kind === 'project' ? ['overview', 'data', 'unit-types', 'promotions', 'media', 'faq', 'history'] : ['overview', 'data', 'promotions', 'media', 'faq', 'history'];
  projection.sections = [];
  const priceTarget = { level: kind, id: ref, tab: 'data' as const, section: 'commercial', item: 'price-w32' };
  projection.overview.promotions = { ending_soon: 2, banner_missing: 3, invalid_price_count: 1,
    invalid_prices: [{ id: 'price-w32', label: { th: 'Synthetic invalid price' }, target: priceTarget }] };
  const context = { kind, ref, phase: kind === 'project' ? 'REM-W32' : null,
    project_id: kind === 'project' ? projectId : null, owning_brand_id: kind === 'brand' ? brandId : null };
  const suggestion = { id: '61000000-0000-4000-8000-000000000037', source: 'website', source_url: 'https://www.sena.co.th/synthetic', captured_at: null,
    flags: { likely_expired: true, undated: true, not_a_promotion: true },
    text: { title: 'Synthetic offer 99', summary: 'Synthetic summary 12000 THB', conditions_public: 'Synthetic conditions 2020' } };
  const row: Record<string, any> = { id: promotionId, project_id: null, owning_brand_id: brandId, public_project_id: '', code: 'W32-OFFER',
    title: { th: 'Synthetic shared offer' }, summary: { th: 'Synthetic summary' }, conditions_public: {}, legal_terms: {}, disclaimer: {},
    benefit_type: 'other', benefit_value: null, benefit_unit: null, stackable: false, priority: 0,
    starts_at: '2026-11-01T00:00:00+07:00', ends_at: '2026-12-01T00:00:00+07:00', source_offer_key: null,
    draft_revision: 4, updated_at: '2026-11-01T00:00:00Z', synthetic: false,
    audience: 'investor', targets: [], excluded_project_ids: [] as string[], scope,
    booking_from: null, booking_to: null, transfer_from: null, transfer_to: null,
    reviews: [{ review_type: 'DATA', review_revision: 4, decision: 'APPROVED', evidence: 'Synthetic previous review', reviewed_at: '2026-11-01T00:00:00Z', reviewed_by: 'synthetic-reviewer', resolved_project_ids: scope.items.map(item => item.public_id) }],
    readiness: { ready: false, missing: [] }, published_version_id: versionId, published: null, versions: [{ id: versionId, version_no: 1, published_at: '2026-11-01T00:00:00Z' }],
  };
  row.published = { id: versionId, version_no: 1, published_at: '2026-11-01T00:00:00Z', payload: { ...structuredClone(row), target_project_ids: scope.items.map(item => item.public_id) } };
  const frozenPublication = structuredClone(row.published);
  const items = ['active', 'in_review', 'draft', 'expired'].map((group, index) => ({
    id: index === 0 ? promotionId : `61000000-0000-4000-8000-00000000004${index}`, title: { th: `Synthetic ${group}` }, group,
    publication_state: index === 1 ? 'scheduled' : index === 3 ? 'withdrawn' : group === 'active' ? 'active' : 'draft',
    draft_applies: index !== 3, published_applies: index === 0 || index === 3, scope_count: 2,
    source: { kind: index === 0 ? 'brand' : index === 1 ? 'shared' : 'project', label: brand.public_name },
    starts_at: row.starts_at, ends_at: row.ends_at, booking_from: '2026-11-01', booking_to: '2026-11-15', transfer_from: null, transfer_to: null,
    audience: 'investor', banner: index === 0 ? { asset_id: assetId, rights_status: 'approved', caption: { th: 'Synthetic banner' } } : null,
  }));
  const writes: Write[] = [], listingQueries: URLSearchParams[] = [];
  await page.route(`**${api}/**`, async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.slice(api.length + 1);
    const json = (data: unknown) => route.fulfill({ json: { data } });
    if (path === `content/workspace/${kind}/${ref}`) return json(projection);
    if (path === `content/workspace/${kind}/${ref}/promotions`) { listingQueries.push(url.searchParams); return json({ items, total: items.length, context, counts: { active: 1, in_review: 1, draft: 1, expired: 1, ending_soon: 2, banner_missing: 3 } }); }
    if (path === `content/workspace/${kind}/${ref}/promotions/suggestions`) return json({ items: [suggestion], total: 1 });
    if (path === `assets/${assetId}/thumbnail`) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="96"><rect width="144" height="96" fill="#08786e"/><circle cx="72" cy="48" r="24" fill="#ffffff"/></svg>' });
    if (path === 'projects') return json([project]);
    if (path === 'promotions/references') return json({ projects: scope.items, brands: [{ id: brandId, public_id: brand.public_brand_id, label: brand.public_name }], commercial_types: [], project_groups: [{ id: "00031", label: { th: "กลุ่มสาทร" }, member_project_count: 2, phase_count: 2 }], programmes: [{ id: "livnex", label: { th: "LivNex เช่าออมบ้าน" } }] });
    if (path === 'content/fields') return json({ items: [] });
    if (!/^promotions(?:\/|$)/.test(path)) return route.fallback();
    if (request.method() === 'GET') return json(path === 'promotions' ? { items: [row], total: 1 } : row);
    const body = request.postDataJSON(); writes.push({ path, method: request.method(), body });
    if (path === 'promotions/resolve') return json(body.excluded_project_ids?.includes(projectId) ? { scope_hash: 'b'.repeat(64), count: 1, items: scope.items.slice(1) } : scope);
    if (path === 'promotions' && request.method() === 'POST') { Object.assign(row, body, { id: promotionId, draft_revision: 1 }); return json(row); }
    if (request.method() === 'PATCH') {
      Object.assign(row, body, { draft_revision: row.draft_revision + 1, scope: { scope_hash: 'b'.repeat(64), count: 1, items: scope.items.slice(1) } });
      return json(row);
    }
    if (path.endsWith('/review')) { row.reviews.push({ ...body, review_revision: body.expected_revision, reviewed_at: '2026-11-06T00:00:00Z', reviewed_by: 'synthetic-reviewer', resolved_project_ids: row.scope.items.map((item: { public_id: string }) => item.public_id) }); return json(row); }
    throw new Error(`Unexpected promotion mutation ${request.method()} ${path}`);
  });
  return { ref, projection, priceTarget, context, row, items, writes, listingQueries, suggestion, frozenPublication };
}

for (const kind of ['project', 'brand'] as const) {
  test(`${kind} contextual Promotions tab follows the intended order and overview links preserve context`, async ({ page }) => {
    const data = await fixture(page, kind);
    await page.goto(`/website/${kind}/${data.ref}?tab=overview`);
    await expect(page.locator('#workspace-tab-promotions')).toBeVisible();
    const expected = kind === 'project' ? ['overview', 'data', 'unit-types', 'promotions', 'media', 'faq', 'history'] : ['overview', 'data', 'promotions', 'media', 'faq', 'history'];
    expect(await page.locator('[id^="workspace-tab-"]').evaluateAll(nodes => nodes.map(node => node.id.replace('workspace-tab-', '')))).toEqual(expected);
    for (const [label, filter, count] of [[text.promotion_ending_seven_days, 'ending_soon', 2], [text.promotion_missing_banner_rights, 'banner_missing', 3]] as const) {
      const link = page.getByRole('link', { name: `${label} ${count}`, exact: true });
      await expect(link).toHaveAttribute('href', workspaceHref({ level: kind, id: data.ref, phase: data.context.phase, tab: 'promotions' }, { filter }));
    }
    await page.locator('summary').filter({ hasText: text.promotion_invalid_starting_price }).click();
    await expect(page.getByRole('link', { name: 'Synthetic invalid price', exact: true })).toHaveAttribute('href', workspaceHref(data.priceTarget));
    await page.locator('#workspace-tab-promotions').click();
    await expect(page.locator('.contextual-promotions')).toBeVisible();
    await expect.poll(() => data.listingQueries.length).toBeGreaterThan(0);
    if (kind === 'project') expect(data.listingQueries[0].get('phase')).toBe('REM-W32');
    const create = page.getByRole('link', { name: kind === 'project' ? text.promotion_create_project : text.promotion_create_brand, exact: true });
    await create.click();
    await expect(page.locator('#promotion-owner')).toHaveValue(kind);
    await expect(page.locator(kind === 'brand' ? '#promotion-brand' : '#promotion-project')).toHaveValue(kind === 'brand' ? brandId : projectId);
    await expect(page.getByRole('link', { name: text.promotion_context_return, exact: true })).toHaveAttribute('href', workspaceHref({ level: kind, id: data.ref, phase: data.context.phase, tab: 'promotions' }));
    expect(data.writes.filter(write => write.path !== 'promotions/resolve')).toEqual([]);
  });

  test(`${kind} hides Promotions and private counts without Promotions View`, async ({ page }) => {
    const data = await fixture(page, kind, 'editor', false);
    await page.goto(`/website/${kind}/${data.ref}?tab=overview`);
    await expect(page.locator('#workspace-tab-overview')).toBeVisible();
    await expect(page.locator('#workspace-tab-promotions')).toHaveCount(0);
    await expect(page.getByRole('link', { name: new RegExp(text.promotion_ending_seven_days) })).toHaveCount(0);
    await page.goto(`/website/${kind}/${data.ref}?tab=promotions`);
    await expect(page.locator('.contextual-promotions')).toHaveCount(0);
    expect(data.listingQueries).toEqual([]);
  });
}

for (const theme of ['light', 'dark'] as const) for (const width of [1280, 390]) {
  test(`promotion groups, evidence and rights fit ${theme} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const data = await fixture(page);
    await page.goto(`/website/project/${data.ref}?tab=promotions`);
    const list = page.locator('.contextual-promotions');
    for (const label of [text.promotion_active, text.promotion_review, text.promotion_draft, text.promotion_expired]) await expect(list.getByRole('heading', { name: label, exact: true })).toBeVisible();
    const active = list.locator(`[data-workspace-item="${promotionId}"]`);
    for (const value of [text.promotion_from_brand.replace('{brand}', 'Synthetic brand'), text.promotion_banner_approved, text.promotion_booking_window, text.promotion_transfer_window, text.promotion_audience_investor]) await expect(active).toContainText(value);
    await expect(active.getByRole('img', { name: 'Synthetic banner' })).toHaveAttribute('src', `${api}/assets/${assetId}/thumbnail`);
    await expect(list).toContainText(text.promotion_shared.replace('{count}', '2'));
    for (const value of [text.promotion_scheduled, text.promotion_withdrawn, text.promotion_scope_pending, text.promotion_banner_missing]) await expect(list).toContainText(value);
    await list.locator('details > summary').click();
    for (const value of [text.promotion_likely_expired, text.promotion_undated, text.promotion_not_offer, text.promotion_capture_unknown, text.promotion_confirm_numbers]) await expect(list).toContainText(value);
    await expect(list.getByRole('link', { name: text.promotion_source_page, exact: true })).toHaveAttribute('href', data.suggestion.source_url);
    await expect.poll(() => active.getByRole('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await fitsWorkspace(page);
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await page.screenshot({ path: `artifacts/unified-workspace/w3.2/promotions-${theme}-${width}.png`, fullPage: true });
    expect(data.writes).toEqual([]);
  });
}

test('partial promotion references remain redacted and cannot be edited across hidden scope', async ({ page }) => {
  const data = await fixture(page);
  const visibleScope = { ...scope, items: scope.items.slice(0, 1), applicability_complete: false };
  Object.assign(data.row, { project_id: null, public_project_id: null, owning_brand_id: null, public_owning_brand_id: null,
    applies_via: { scope_level: 'brand' }, applicability_complete: false, scope: visibleScope, can_edit: false,
    targets: [{ type: 'project', id: projectId }], excluded_project_ids: [], reviews: [], published: null });
  await page.route(`**${api}/promotions/references`, route => route.fulfill({ json: { data: { projects: visibleScope.items, brands: [], commercial_types: [] } } }));
  await page.goto(`/promotions?promotion=${promotionId}&project_id=${projectId}`);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(contentScopeText.scope_references_partial);
  await expect(dialog).toContainText('การแก้ไขโปรโมชันนี้ต้องมีสิทธิ์ครบทุกโครงการที่ร่วมรายการ');
  await expect(dialog).not.toContainText('Synthetic neighbour'); await expect(dialog).not.toContainText('Synthetic brand');
  await expect(dialog.locator('#promotion-title')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'แก้ไขขอบเขตและช่วงเวลา', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'บันทึกร่างโปรโมชัน', exact: true })).toHaveCount(0);
  expect(data.writes).toEqual([]);
  await fitsWorkspace(page);
});

test('legacy suggestion copies only text into the contextual brand editor', async ({ page }) => {
  const data = await fixture(page, 'brand');
  await page.goto(`/website/brand/${data.ref}?tab=promotions`);
  await page.locator('.contextual-promotions details > summary').click();
  const link = page.getByRole('link', { name: text.promotion_create_suggestion, exact: true });
  const href = new URL((await link.getAttribute('href'))!, 'http://127.0.0.1:3000');
  expect(href.searchParams.get('suggestion')).toBe(data.suggestion.id);
  expect(href.searchParams.has('summary')).toBe(false);
  await link.click();
  await expect(page.locator('#promotion-owner')).toHaveValue('brand');
  await expect(page.locator('#promotion-brand')).toHaveValue(brandId);
  for (const key of ['title', 'summary', 'conditions_public'] as const) await expect(page.locator('#promotion-' + key)).toHaveValue(data.suggestion.text[key]);
  for (const key of ['starts_at', 'ends_at', 'benefit_value', 'benefit_unit', 'source_offer_key']) await expect(page.locator('#promotion-' + key)).toHaveValue('');
  expect(data.writes.filter(write => write.path !== 'promotions/resolve')).toEqual([]);
});

test('project exclusion saves a new draft, retains frozen publication and requires explicit scope review', async ({ page }) => {
  const data = await fixture(page);
  await page.goto(`/website/project/${data.ref}?tab=promotions`);
  const active = page.locator(`[data-workspace-item="${promotionId}"]`);
  await active.getByRole('button', { name: text.promotion_exclude_project, exact: true }).click();
  await expect.poll(() => data.writes.filter(write => write.method === 'PATCH').length).toBe(1);
  await active.getByRole('link', { name: text.promotion_open_editor, exact: true }).click();
  const dialog = page.getByRole('dialog');
  expect(data.writes.find(write => write.method === 'PATCH')!.body).toMatchObject({ expected_revision: 4, excluded_project_ids: [projectId] });
  expect(data.row.draft_revision).toBe(5); expect(data.row.reviews[0].review_revision).toBe(4);
  expect(data.row.published_version_id).toBe(versionId); expect(data.row.versions).toHaveLength(1);
  expect(data.row.published).toEqual(data.frozenPublication);
  expect(data.row.published.payload.target_project_ids).toEqual([project.public_project_id, 'prj_neighbour']);
  expect(data.row.scope.items.map((item: { public_id: string }) => item.public_id)).toEqual(['prj_neighbour']);
  await expect(dialog.getByRole('link', { name: workflowText.queue, exact: true })).toHaveAttribute('href', `/publish?source=promotion&id=${promotionId}`);
  await persona(page, 'publisher');
  await page.unroute('**/api/hub/v1/me');
  await page.goto(`/promotions?promotion=${promotionId}&context_kind=project&context_ref=${data.ref}`);
  for (const [index, reviewType] of ['DATA', 'LEGAL'].entries()) {
    await page.locator('#review-type').selectOption(reviewType);
    await page.locator('#review-evidence').fill('Synthetic evidence for excluded scope');
    await page.locator('#promotion-reason').fill('Synthetic independent review');
    await page.locator('#review-evidence').locator('xpath=ancestor::fieldset').getByRole('button').click();
    await expect.poll(() => data.writes.filter(write => write.path.endsWith('/review')).length).toBe(index + 1);
    expect(data.writes.filter(write => write.path.endsWith('/review'))[index].body).toMatchObject({ expected_revision: 5, review_type: reviewType, expected_scope_hash: 'b'.repeat(64) });
    await expect(page.locator('#review-evidence')).toHaveValue('');
  }
  expect(data.writes.every(write => write.path === 'promotions/resolve' || write.method === 'PATCH' || write.path.endsWith('/review'))).toBe(true);
});




test('failed contextual suggestion fetch exposes an error and never opens an empty draft', async ({ page }) => {
  const data = await fixture(page, 'brand');
  let release: (() => void) | undefined;
  await page.route(`**/content/workspace/brand/${data.ref}/promotions/suggestions?**`, async route => {
    if (!new URL(route.request().url()).searchParams.has('item')) return route.fallback();
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ status: 503, json: { error: { message: 'Synthetic suggestion unavailable' } } });
  });
  await page.goto(`/promotions?promotion=new&context_kind=brand&context_ref=${data.ref}&owning_brand_id=${brandId}&suggestion=${data.suggestion.id}&suggestion_source=website`);
  await expect.poll(() => Boolean(release)).toBe(true);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#promotion-title')).toHaveCount(0);
  release!();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Synthetic suggestion unavailable');
  await expect(page.locator('#promotion-title')).toHaveCount(0);
  expect(data.writes).toEqual([]);
});

test('promotions workspace shows Thai owner names, KPI status filters, search, and comma-safe benefit input', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const data = await fixture(page, 'project', 'editor');
  Object.assign(data.row, { benefit_type: 'discount_amount', benefit_value: '150000', benefit_unit: 'THB', publication_available: true });
  await page.goto('/promotions');
  await expect(page.locator('body')).not.toContainText('Q40');
  const table = page.locator('.promo-table');
  await expect(table).toContainText('แบรนด์: Synthetic brand');
  await expect(table).toContainText('ส่วนลดเป็นจำนวนเงิน · 150,000 บาท');
  await page.getByRole('button', { name: /ฉบับร่าง \/ รอตรวจ/ }).click();
  await expect(page.getByText('ไม่พบโปรโมชันตามตัวกรอง')).toBeVisible();
  await page.getByRole('button', { name: 'ล้างตัวกรอง', exact: true }).click();
  await expect(table).toContainText('Synthetic shared offer');
  await page.getByLabel('ค้นหาโปรโมชัน', { exact: true }).fill('W32-OFFER');
  await expect(table).toContainText('Synthetic shared offer');
  await page.getByRole('button', { name: 'Synthetic shared offer', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('มูลค่าสิทธิประโยชน์', { exact: true }).fill('250,000.50');
  await expect(dialog.getByLabel('มูลค่าสิทธิประโยชน์', { exact: true })).toHaveValue('250000.50');
  await fitsWorkspace(page);
});
