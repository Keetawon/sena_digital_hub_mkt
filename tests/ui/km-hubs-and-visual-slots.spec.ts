import { expect, test, type Page } from '@playwright/test';

const origin = 'http://127.0.0.1:3000';

async function enterAs(page: Page, role: 'admin' | 'editor' = 'editor') {
  const res = await page.request.post('/api/local-session', {
    headers: { Origin: origin },
    data: { role },
  });
  expect(res.ok()).toBeTruthy();
}

test('2.2 KM กลุ่มโครงการ shows member projects & phase counts and edits group KM narrative', async ({ page }) => {
  await enterAs(page, 'editor');
  let savedGroupBody: Record<string, unknown> | null = null;

  await page.route('**/api/hub/v1/admin/projects/progress?**', route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('view') === 'groups') {
      return route.fulfill({
        json: {
          data: {
            page: 1,
            pages: 1,
            total: 1,
            rows: [
              {
                state: 'marketing_reference',
                id: 'GRP-FLEXI-CNK',
                name_th: 'เฟล็กซี่ สาทร - เจริญนคร',
                count: 2,
                published: 1,
                filling: 1,
                awaiting_publisher: 0,
                names: ['เฟล็กซี่ สาทร - เจริญนคร เฟส 1', 'เฟล็กซี่ สาทร - เจริญนคร เฟส 2'],
                brand_count: 1,
              },
            ],
          },
        },
      });
    }
    return route.fulfill({
      json: {
        data: {
          total: 2,
          rows: [
            { public_project_id: 'prj_cnk_1', rem_project_id: 'CNK-P1', name_th: 'เฟล็กซี่ สาทร - เจริญนคร เฟส 1', marketing_project_group_id: 'GRP-FLEXI-CNK', group_status: 'marketing_reference' },
            { public_project_id: 'prj_cnk_2', rem_project_id: 'CNK-P2', name_th: 'เฟล็กซี่ สาทร - เจริญนคร เฟส 2', marketing_project_group_id: 'GRP-FLEXI-CNK', group_status: 'marketing_reference' },
          ],
        },
      },
    });
  });

  await page.route('**/api/hub/v1/admin/content/workspace/project_group/GRP-FLEXI-CNK**', route =>
    route.fulfill({
      json: {
        data: {
          entity: { kind: 'project_group', ref: 'GRP-FLEXI-CNK', name: { th: 'เฟล็กซี่ สาทร - เจริญนคร' }, scope_type: 'project_group', scope_id: 'GRP-FLEXI-CNK' },
          phases: [
            { rem_project_id: 'CNK-P1', public_project_id: 'prj_cnk_1', name: { th: 'เฟล็กซี่ สาทร - เจริญนคร เฟส 1' } },
            { rem_project_id: 'CNK-P2', public_project_id: 'prj_cnk_2', name: { th: 'เฟล็กซี่ สาทร - เจริญนคร เฟส 2' } },
          ],
          selected_phase: null,
          tabs: ['overview', 'faq', 'history'],
          sections: [],
          overview: { readiness: { required: [], recommended: [] }, tasks: [], changes_since_publication: [], preview_target: null },
        },
      },
    })
  );

  await page.route('**/api/hub/v1/admin/content/scopes/project_group/GRP-FLEXI-CNK/**', async route => {
    if (route.request().method() === 'PUT') {
      savedGroupBody = route.request().postDataJSON();
      return route.fulfill({ json: { data: { id: '10000000-0000-4000-8000-000000000001', revision: 1 } } });
    }
    return route.fulfill({
      json: {
        data: {
          scope_type: 'project_group',
          scope_id: 'GRP-FLEXI-CNK',
          contacts: [],
          translations: [],
          sections: savedGroupBody
            ? [{ id: '10000000-0000-4000-8000-000000000001', section_key: 'section.project_intro', revision: 1, state: 'DRAFT', version: { version_no: 1, body: (savedGroupBody as any).changes.body, state: 'DRAFT', source_ref: null, ai_exposure: 'open', created_at: '2026-11-25T10:00:00Z' }, history: [] }]
            : [],
        },
      },
    });
  });

  await page.route('**/api/hub/v1/admin/content-workflow**', route =>
    route.fulfill({ json: { data: { items: [], counts: { draft: 0, in_review: 0, approved: 0, returned: 0 } } } })
  );

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/website?view=groups');
    await expect(page.getByRole('heading', { name: 'KM กลุ่มโครงการ (Project Group)', exact: true })).toBeVisible();
    await expect(page.getByText('2 เฟส / โครงการ', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'เฟล็กซี่ สาทร - เจริญนคร เฟส 1 · CNK-P1', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'เฟล็กซี่ สาทร - เจริญนคร เฟส 2 · CNK-P2', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('link', { name: 'แก้ไข KM กลุ่ม', exact: true }).click();
  await expect(page).toHaveURL(/\/website\/project_group\/GRP-FLEXI-CNK\?tab=data$/);
  await expect(page.getByText('โครงการสมาชิกและเฟสในกลุ่มนี้ (2 เฟส REM)', { exact: true })).toBeVisible();
  await page.locator('#section-body-section\\.project_intro-th').fill('คอนโดใกล้รถไฟฟ้าเชื่อมต่อสาทร รองรับทั้งเฟส 1 และเฟส 2');
  await page.getByRole('button', { name: 'บันทึกเนื้อหา', exact: true }).click();
  await expect(page.locator('#section-body-section\\.project_intro-th')).toHaveValue('คอนโดใกล้รถไฟฟ้าเชื่อมต่อสาทร รองรับทั้งเฟส 1 และเฟส 2');
  expect((savedGroupBody as any)?.changes?.body?.th).toBe('คอนโดใกล้รถไฟฟ้าเชื่อมต่อสาทร รองรับทั้งเฟส 1 และเฟส 2');
});

test('2.4 KM องค์กรและธุรกิจอื่น pins Corporate SENA and programmes cleanly in light and dark', async ({ page }) => {
  await enterAs(page, 'editor');
  await page.route('**/api/hub/v1/admin/content/businesses', route =>
    route.fulfill({
      json: {
        data: {
          items: [
            { code: 'residential', label: { th: 'ที่อยู่อาศัย', en: 'Residential' } },
            { code: 'solar', label: { th: 'เสนา โซลาร์ เอนเนอร์ยี่', en: 'SENA Solar Energy' } },
            { code: 'senx', label: { th: 'เซ็น เอกซ์', en: 'SenX' } },
            { code: 'ngernsod_jaidee', label: { th: 'เงินสดใจดี', en: 'Ngernsod Jaidee' } },
          ],
        },
      },
    })
  );
  await page.route('**/api/hub/v1/admin/content/workspace/tree?**', route =>
    route.fulfill({
      json: {
        data: {
          items: [],
          programmes: [
            { key: 'programme:LIVNEX', kind: 'programme', ref: 'LIVNEX', name: { th: 'LivNex เช่าออมบ้าน' }, target: { level: 'programme', id: 'LIVNEX', tab: 'overview' }, parent: null, has_children: false, visible_phase_count: 12, grouping: { state: 'confirmed', group_ref: null } },
          ],
          next_cursor: null,
        },
      },
    })
  );

  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto('/website?view=businesses');
    await expect(page.getByRole('heading', { name: 'KM องค์กรและธุรกิจอื่น', exact: true })).toBeVisible();
    const switcherLinks = page.locator('.km-switcher-bar a');
    await expect(switcherLinks).toHaveText(['KM องค์กรและธุรกิจอื่น', 'KM แบรนด์', 'KM กลุ่มโครงการ', 'KM โครงการ']);
    await expect(page.locator('[data-corporate-card="sena"]')).toBeVisible();
    await expect(page.locator('[data-corporate-card="sena"] img[alt="SENA Development"]')).toBeVisible();
    await expect(page.locator('[data-programme-card="LIVNEX"]')).toContainText('LivNex เช่าออมบ้าน');
    await expect(page.locator('[data-business-card="residential"]')).toHaveCount(0);
    await expect(page.locator('[data-business-card="solar"]')).toContainText('เสนา โซลาร์ เอนเนอร์ยี่');
    await expect(page.locator('[data-business-card="senx"]')).toContainText('เซ็น เอกซ์');
    await expect(page.locator('[data-business-card="ngernsod_jaidee"]')).toContainText('เงินสดใจดี');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('2.3 Project unit-types collapses 40 legacy floor-plan suggestions with image previews and renders REM comparison table', async ({ page }) => {
  await enterAs(page, 'editor');
  const projects = (await (await page.request.get('/api/hub/v1/admin/projects')).json()).data;
  const project = projects[0];
  const publicId = project.public_project_id as string;

  const fortySuggestions = Array.from({ length: 12 }, (_, idx) => ({
    id: `20000000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`,
    kind: 'floor_plans',
    value: {
      label: `Floor ${idx + 1} Plan`,
      url: `http://127.0.0.1:3000/brand/sena-development-mark.png`,
    },
    source: { page_url: 'https://sena.co.th/example', fetched_at: '2026-10-27T09:12:07Z' },
    wiring: [],
    holds: ['needs_phase_decision'],
    can_use: false,
    requires_manual_entry: true,
  }));

  await page.route(`**/api/hub/v1/admin/projects/${publicId}/content/website`, route =>
    route.fulfill({ json: { data: fortySuggestions } })
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/website/project/${publicId}?tab=unit-types`);

  // Suggestions > 5 are collapsed into a compact drawer so they do not push CommercialTypes screens down
  const drawer = page.locator('details.website-sources-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer).not.toHaveAttribute('open', '');
  const suggestionBox = await page.locator('.workspace-suggestion').boundingBox();
  expect(suggestionBox!.height).toBeLessThan(200);
  await expect(page.locator('#commercial-types-title')).toBeVisible();

  // Opening the drawer shows clean label + image preview
  await drawer.locator('summary').click();
  await expect(drawer).toHaveAttribute('open', '');
  await expect(drawer.locator('img.website-source-thumb').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('2.5 Detail screens across Project, Brand, and Corporate provide guided steppers, next-step flow, and FAQ status filters without overflow', async ({ page }) => {
  await enterAs(page, 'editor');
  const projects = (await (await page.request.get('/api/hub/v1/admin/projects')).json()).data;
  const project = projects[0];
  const publicId = project.public_project_id as string;

  for (const width of [1280, 390]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });

      await page.goto(`/website/project/${publicId}?tab=data`);
      await expect(page.locator('.workspace-hub-crumb')).toHaveAttribute('href', '/website?view=projects');
      await expect(page.locator('#workspace-tab-data .workspace-tab-step')).toBeVisible();

      const projectSteps = page.getByRole('group', { name: 'ขั้นตอนข้อมูลโครงการ', exact: true });
      await expect(projectSteps.locator('.km-step-group-btn')).toHaveCount(5);
      await projectSteps.getByRole('button', { name: /ขั้นที่ 2.*เรื่องเล่าและข้อมูลจำเพาะ/ }).click();
      await expect(page.locator('.content-tabs button[aria-current="page"]')).toHaveText('เนื้อหาและจุดขาย');
      await expect(page.locator('.km-section-guide')).toContainText('เรื่องเล่าและจุดขายหลัก');
      await expect(page.locator('.workspace-flow-footer')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }

  // Verify Corporate guided stepper + next-step flow
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/website/corporate/sena?tab=data');
  await expect(page.locator('.workspace-hub-crumb')).toHaveAttribute('href', '/website?view=businesses');
  const corpSteps = page.getByRole('group', { name: 'ขั้นตอนการกรอกเนื้อหาในระดับนี้', exact: true });
  await expect(corpSteps.locator('.km-step-group-btn')).toHaveCount(3);
  await page.getByRole('button', { name: 'ถัดไปในหมวดข้อมูล: ช่องทางติดต่อองค์กร →', exact: true }).click();
  await expect(page.locator('.content-tabs button[aria-current="page"]')).toHaveText('ช่องทางติดต่อองค์กร');

  // Verify FAQ status filter pills
  await page.route(`**/api/hub/v1/admin/content/workspace/project/${publicId}/faq?**`, route =>
    route.fulfill({
      json: {
        data: {
          page_scope: { type: 'project', id: project.source.rem_project_id },
          selected_phase: project.source.rem_project_id,
          next_cursor: null,
          items: [
            { question_key: 'q_missing', label: { th: 'คำถามที่ยังขาด' }, is_core: true, answer_kind: 'text', display_state: 'missing', own_answer: null, effective_answer: null, facts: [], legacy_clusters: [], applicability: { state: 'applicable' }, targets: {} },
            { question_key: 'q_inherited', label: { th: 'คำถามที่สืบทอดแล้ว' }, is_core: false, answer_kind: 'text', display_state: 'inherited', own_answer: null, effective_answer: { id: 'faq-inh', revision: 1, version_id: 'v-inh', question: { th: 'คำถามที่สืบทอดแล้ว' }, short_answer: { th: 'คำตอบจากแบรนด์' }, detail: {}, source: { scope_type: 'brand', scope_id: 'brd-1', name: { th: 'SENA' }, affected_project_count: 3, affected_count_complete: true }, author: null, approver: null }, facts: [], legacy_clusters: [], applicability: { state: 'applicable' }, targets: {} },
          ],
        },
      },
    })
  );
  await page.goto(`/website/project/${publicId}?tab=faq`);
  const filterBar = page.getByRole('group', { name: 'กรองคำถามตามสถานะ', exact: true });
  await expect(filterBar).toBeVisible();
  await expect(page.locator('.workspace-faq-card')).toHaveCount(2);
  await filterBar.getByRole('button', { name: 'ยังไม่มีคำตอบ (1)', exact: true }).click();
  await expect(page.locator('.workspace-faq-card')).toHaveCount(1);
  await expect(page.locator('.workspace-faq-card').first()).toContainText('คำถามที่ยังขาด');
  await filterBar.getByRole('button', { name: 'สืบทอดแล้ว (1)', exact: true }).click();
  await expect(page.locator('.workspace-faq-card')).toHaveCount(1);
  await expect(page.locator('.workspace-faq-card').first()).toContainText('คำถามที่สืบทอดแล้ว');
});
