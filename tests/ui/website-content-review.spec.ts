import { expect, test, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const headers = { Origin: 'http://127.0.0.1:3000' }, api = '/api/hub/v1/admin';
async function persona(page: Page, role: string) { expect((await page.request.post('/api/local-session', { headers, data: { role } })).ok()).toBeTruthy(); }
async function read(page: Page, url: string) { const response = await page.request.get(url); expect(response.ok()).toBeTruthy(); return (await response.json()).data; }
async function operator() {
  const run = process.env.HUB_DISPOSABLE_TEST_RUN;
  expect(run).toBeTruthy();
  const directory = await realpath(run!);
  expect(directory.startsWith(await realpath('.local/test-runs') + path.sep)).toBe(true);
  const marker = JSON.parse(await readFile(path.join(directory, 'run.json'), 'utf8'));
  const config = JSON.parse(await readFile('.local/development.json', 'utf8'));
  const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'sena_hub_local', user: 'postgres', password: config.adminPassword });
  await db.connect();
  expect(await realpath((await db.query('show data_directory')).rows[0].data_directory)).toBe(await realpath(path.join(directory, 'postgres')));
  expect((await db.query('select run_id from public.disposable_test_run')).rows[0].run_id).toBe(marker.run_id);
  return db;
}

for (const width of [1280, 390]) {
  test(`Website image suggestions require batch confirmation and retain stale edits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await persona(page, 'editor');
    const project = (await read(page, `${api}/projects`)).find((row: { source: { rem_project_id: string } }) => row.source.rem_project_id === 'DEMO-001');
    const base = `${api}/projects/${project.public_project_id}`, media = `${base}/media`;
    const stamp = randomUUID(), batch = createHash('sha256').update(stamp).digest('hex');
    const source = { source_kind: 'sena_public_website', source_remark: 'ดึงจากเว็บไซต์สาธารณะ SENA',
      page_url: 'https://www.sena.co.th/project/synthetic-website-review', fetched_at: '2026-10-27T00:00:00Z', capture_sha256: 'e'.repeat(64), confirmed: false };
    const assetIds: string[] = [];
    const db = await operator();
    try {
      await db.query('insert into staging.knowledge_batches(manifest_sha256,manifest) values($1,$2)', [batch, { purpose: 'synthetic website browser test' }]);
      for (const [index, name] of ['agreement-first', 'pending-ai'].entries()) {
        const uploaded = await page.request.post(`${api}/assets`, { headers: { ...headers, 'Content-Type': 'image/svg+xml', 'X-Filename': `${name}-${width}.svg` },
          data: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#177A75"/><text x="10" y="80" fill="white">Synthetic ${stamp}-${index}</text></svg>`) });
        expect(uploaded.ok()).toBeTruthy();
        const asset = (await uploaded.json()).data; assetIds.push(asset.id);
        await db.query("select set_config('app.actor_id',$1,false)", [asset.created_by]);
        await db.query("update hub.assets set media_category='interior',image_kind='render' where id=$1", [asset.id]);
        if (index === 0) await db.query('update hub.assets set ai_suggestion=$1 where id=$2', [{ media_category: 'interior', image_kind: 'render', tags: ['living_room'], source_revision: 0,
          caption: { th: 'ห้องนั่งเล่นจำลอง' }, alt_text: { th: 'ภาพจำลอง' }, proposed_tags: [], confidence: 0.8, model: 'synthetic-only', suggested_at: source.fetched_at }, asset.id]);
        await db.query("insert into hub.asset_links(project_id,asset_id,target_type,target_key,usage,ai_exposure,binding_confirmed,website_source) values($1,$2,'project',$3,'gallery','internal',false,$4)",
          [project.id, asset.id, project.id, source]);
        await db.query('insert into hub.website_asset_suggestions(project_id,asset_id,batch_sha256,page_position,source) values($1,$2,$3,$4,$5)',
          [project.id, asset.id, batch, { media_category: 'interior', image_kind: 'render', tags: ['living_room'], positions: [{ label: 'ห้องนั่งเล่น', context: { gallery_tab: 'ภายใน' } }] }, source]);
      }
      await db.query(`insert into staging.knowledge_candidates(batch_sha256,source_key,kind,project_ids,topic,source_url,source_ref,evidence)
        values($1,$2,'nearby',array['DEMO-001'],'design',$3,$2,$4)`, [batch, stamp, source.page_url,
        { source_kind: 'sena_public_website', website_item_kind: 'nearby', website_value: { heading: 'สถานศึกษา', text: 'โรงเรียนจำลอง 500 เมตร' }, website_source: source, website_wiring: [{ project_id: 'DEMO-001', outcome: 'needs_review' }] }]);
    } finally { await db.end(); }
    await persona(page, 'viewer');
    await page.goto(`/media?project=${project.public_project_id}&tab=website`);
    await expect(page.getByRole('heading', { name: 'รูปจากเว็บไซต์ (รอยืนยัน)', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /ยืนยัน \d+ ภาพที่เลือก/ })).toHaveCount(0);
    expect((await page.request.post(`${media}/website/confirm`, { headers, data: { items: [] } })).status()).toBe(403);
    await persona(page, 'editor'); await page.goto(`/media?project=${project.public_project_id}&tab=website`);
    const queue = page.locator('.website-media'), cards = queue.locator('.media-card');
    await expect(cards.first()).toContainText(`agreement-first-${width}.svg`);
    await expect(cards.first()).toContainText('ตรงกัน 100%');
    await expect(cards.last()).toContainText('ยังไม่มีผล AI');
    const batchControls = queue.getByRole('group', { name: 'ตรวจและยืนยันเป็นชุด', exact: true });
    await batchControls.getByLabel('เลือกทั้งหมดในหน้านี้', { exact: true }).check();
    await batchControls.getByLabel('หมวดสำหรับรายการที่เลือก', { exact: true }).selectOption('interior');
    await batchControls.getByRole('button', { name: 'ใช้ค่ากับภาพที่เลือก', exact: true }).click();
    let failed = false;
    await page.route(`**${media}/website/confirm`, route => {
      if (!failed) { failed = true; return route.fulfill({ status: 409, json: { error: { message: 'ข้อมูลสมมติเปลี่ยนระหว่างตรวจ กรุณาตรวจแล้วลองใหม่' } } }); }
      return route.continue();
    });
    await batchControls.getByRole('button', { name: 'ยืนยัน 2 ภาพที่เลือก', exact: true }).click();
    await expect(queue.getByRole('alert')).toContainText('รายการที่เลือกและสิ่งที่แก้ไขยังอยู่');
    await expect(batchControls.getByRole('button', { name: 'ยืนยัน 2 ภาพที่เลือก', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/hosted-content-rollout/website-review-${width}.png`, fullPage: true });
    await batchControls.getByRole('button', { name: 'ยืนยัน 2 ภาพที่เลือก', exact: true }).click();
    await expect(queue.getByRole('status')).toContainText('ยืนยันหมวด แท็ก และบริบทแล้ว 2 ภาพ');
    const saved = await read(page, media);
    for (const id of assetIds) {
      const asset = saved.assets.find((row: { id: string }) => row.id === id);
      expect(asset.rights_status).toBe('pending'); expect(asset.metadata_state).toBe('needs_review');
      expect(asset.tags).toEqual(['living_room']);
      expect(saved.links.filter((row: { asset_id: string }) => row.asset_id === id).every((row: { binding_confirmed: boolean; ai_exposure: string }) => row.binding_confirmed && row.ai_exposure === 'internal')).toBe(true);
    }
    await page.goto(`/content?project=${project.public_project_id}&tab=website`);
    await expect(page.getByRole('heading', { name: 'ข้อมูลจากเว็บไซต์ที่รอตรวจ' })).toBeVisible();
    await page.getByText('ทำเลและการเดินทาง · สถานศึกษา · โรงเรียนจำลอง 500 เมตร', { exact: true }).last().click();
    await expect(page.getByText('ระยะทางจากหน้าเว็บยังไม่ยืนยัน และยังไม่ได้ระบุวิธีวัด', { exact: true }).last()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/hosted-content-rollout/website-sources-${width}.png`, fullPage: true });
  });
}
