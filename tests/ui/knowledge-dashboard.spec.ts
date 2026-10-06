import { test, expect } from '@playwright/test';

test('knowledge progress filters pilots, preserves queue scope and shows no-KM coverage explicitly', async ({page}) => {
  await page.context().addCookies([{name:'sena_local_persona',value:'viewer',url:'http://127.0.0.1:3000'}]);
  const card={name:{th:'โครงการทดสอบ'},status:{raw:2,label:'พร้อมอยู่'},mode:'DRAFT_PREVIEW'};
  const progress={state:'reviewing',staged:10,reviewed:4,pending:{section:2,faq:1,fact:0,asset:2,promotion:1},pending_other:0,conflicts:1,gaps:2,has_legacy_km:true,last_reviewed_at:'2026-10-06T03:00:00Z',last_reviewed_by:'00000000-0000-0000-0000-000000000001'};
  const rows=[{project_id:'BNA7',card,candidates:10,progress},{project_id:'EKAMI',card:{...card,name:{th:'เอกมัยทดสอบ'}},candidates:5,progress:{...progress,state:'not_started',reviewed:0,staged:5,conflicts:0,has_legacy_km:false,last_reviewed_at:null}}];
  await page.route('**/api/hub/v1/admin/knowledge/**', async route => {
    const path=new URL(route.request().url()).pathname;
    await route.fulfill({json:{data:path.endsWith('/projects')?rows:{card:rows.find(p=>path.endsWith(p.project_id))?.card || card,items:[]}}});
  });
  await page.goto('/knowledge?project=EKAMI');
  await expect(page.getByLabel('โครงการหรือระยะ')).toHaveValue('EKAMI');
  const dashboard=page.getByRole('region',{name:'ความคืบหน้าคลังความรู้',exact:true});
  await expect(dashboard.getByRole('row')).toHaveCount(3);
  await expect(dashboard).toContainText('ตรวจแล้ว 40%');
  await expect(dashboard).toContainText('ไม่มี KM เดิม · ต้องเขียนใหม่');
  await expect(dashboard).toContainText('ผู้แก้ไข');
  await expect(dashboard).not.toContainText('00000000');
  await dashboard.getByRole('button',{name:'มีข้อขัดแย้ง',exact:true}).click();
  await expect(dashboard.getByRole('row')).toHaveCount(2);
  await dashboard.getByRole('link',{name:'โครงการทดสอบ',exact:true}).click();
  await expect(page.getByLabel('โครงการหรือระยะ')).toHaveValue('BNA7');
  await expect(page).toHaveURL(/project=BNA7/);
  await expect(page.getByRole('button',{name:'ถูก',exact:true})).toHaveCount(0);
});
