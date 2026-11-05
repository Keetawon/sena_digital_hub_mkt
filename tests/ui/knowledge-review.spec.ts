import { expect, test, type Page } from '@playwright/test';
const origin='http://127.0.0.1:3000',base='/api/hub/v1/admin/knowledge';
const id='00000000-0000-4000-9000-000000000001';
const section={id,kind:'section',project_ids:['TPRAK','SK2TR'],holds:['needs_phase_decision'],source_url:'https://www.sena.co.th/',source_ref:'synthetic:section',evidence:{title:{th:'สวนสมมติ'},body:{th:'โครงการทดสอบ มีสวนสำหรับพักผ่อน'}},review:null,bulk_rights_eligible:false};
async function setup(page:Page,role='editor',asset=false,faq=false){
  await page.context().addCookies([{name:'sena_local_persona',value:'admin',url:origin}]);
 const account = (await (await page.request.get('/api/hub/v1/me')).json()).data;
 account.capabilities.tabs.knowledge.edit = role === 'editor' || role === 'admin';
 account.capabilities.tabs.knowledge.approve = role === 'publisher' || role === 'admin';
 await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data: account } }));
  const calls:unknown[]=[];
  const card={name:{th:'ระยะทดสอบ'},status:{raw:1,label:'กำลังก่อสร้าง'},mode:'DRAFT_PREVIEW'};
  await page.route(`**${base}/**`,async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/review')){calls.push(route.request().postDataJSON());return route.fulfill({json:{data:{revision:1}}});}
    if(path.endsWith('/preview'))return route.fulfill({json:{data:{answer:'โครงการระยะนี้ปิดโครงการแล้ว',route:'closed',citations:[],mode:'DRAFT_PREVIEW'}}});
    if(path.endsWith('/projects'))return route.fulfill({json:{data:[{project_id:'SK2TR',card,candidates:12},{project_id:'TPRAK',card:{...card,status:{raw:3,label:'ปิดโครงการ'}},candidates:1}]}});
    const items=faq?[{...section,kind:'faq',read_only:true,cluster_ids:['cluster-one','cluster-two'],holds:[],project_ids:['SK2TR']}]:asset?[{...section,kind:'asset',holds:[],project_ids:['SK2TR'],evidence:{mime:'application/pdf',classification:{role:'brochure',alt_th:'เอกสารสมมติ',people:'unknown',stock_imagery:'unknown',third_party_marks:'unknown'}}}]:Array.from({length:12},(_,i)=>({...section,id:i===0?id:`00000000-0000-4000-9000-${String(i+1).padStart(12,'0')}`}));
    return route.fulfill({json:{data:{card:path.endsWith('TPRAK')?{...card,status:{raw:3,label:'ปิดโครงการ'}}:card,items}}});
  });
  await page.goto('/knowledge');await expect(page.getByRole('heading',{name:'ตรวจข้อมูลก่อนนำเข้า'})).toBeVisible();
  await expect(page.getByText('สถานะ REM:',{exact:false})).toBeVisible();return calls;
}
test('review is paginated and shared phase requires explicit choice',async({page})=>{
  const calls=await setup(page);await expect(page.locator('.knowledge-item')).toHaveCount(10);
  await page.getByRole('button',{name:'หน้าถัดไป',exact:true}).click();await expect(page.locator('.knowledge-item')).toHaveCount(2);
  await page.getByRole('button',{name:'หน้าก่อนหน้า',exact:true}).click();await page.getByRole('button',{name:'ถูก',exact:true}).first().click();
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog.getByRole('checkbox',{name:'SK2TR',exact:true})).not.toBeChecked();
  await expect(dialog.getByRole('checkbox',{name:'TPRAK',exact:false})).toBeDisabled();
  await dialog.getByRole('checkbox',{name:'SK2TR',exact:true}).check();await dialog.getByLabel('เหตุผลและสิ่งที่ตรวจแล้ว').fill('ตรวจระยะ SK2TR แล้ว');
  await dialog.getByRole('button',{name:'ยืนยันผลตรวจ',exact:true}).click();await expect(dialog).not.toBeVisible();
  expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({decision:'accepted',applies_to_project_ids:['SK2TR'],expected_revision:0});
});
test('Admin with Knowledge View reads evidence but has no review or rights controls',async({page})=>{
  await setup(page,'viewer');await expect(page.getByRole('button',{name:'ถูก',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'อนุมัติสิทธิ์ที่เลือก',exact:false})).toHaveCount(0);
});
test('Admin with Knowledge Approve sees why flagged files cannot be bulk approved',async({page})=>{
  await setup(page,'publisher',true);await page.getByLabel('ประเภทข้อมูล').selectOption('asset');
  await expect(page.getByRole('checkbox')).toBeDisabled();await expect(page.getByText('ต้องให้ MKT ยืนยันว่าเป็นไฟล์ของ SENA และไม่มีธงรอตรวจ',{exact:false})).toBeVisible();
});
test('closed phase warning and preview are visible on mobile',async({page})=>{
  await page.setViewportSize({width:390,height:844});await setup(page);await page.getByLabel('โครงการหรือระยะ').selectOption('TPRAK');
  await expect(page.getByText('ระยะนี้ปิดโครงการแล้ว ห้ามผูกเนื้อหาการขาย',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'ถูก',exact:true}).first()).toBeDisabled();
  await page.getByLabel('คำถามทดลอง').fill('ยังขายอยู่ไหม');await page.getByRole('button',{name:'ทดลองคำตอบ',exact:true}).click();
  await expect(page.getByText('โครงการระยะนี้ปิดโครงการแล้ว',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
});

test('legacy FAQ evidence is read-only and keeps each exact cluster reference', async ({ page }) => {
  const calls = await setup(page, 'editor', false, true);
  await page.locator('#knowledge-queue select').nth(1).selectOption('faq');
  const card = page.locator('.knowledge-item');
  await expect(card).toHaveCount(1); await expect(card.locator('.knowledge-actions')).toHaveCount(0);
  await expect(card.locator('a[href*="legacy_cluster=cluster-one"]')).toHaveAttribute('href', '/website?legacy_cluster=cluster-one&phase=SK2TR');
  await expect(card.locator('a[href*="legacy_cluster=cluster-two"]')).toHaveAttribute('href', '/website?legacy_cluster=cluster-two&phase=SK2TR');
  expect(calls).toEqual([]);
});
test('non-admin accounts cannot open imported evidence even with Knowledge View', async ({ page }) => {
  for (const role of ['viewer', 'editor', 'publisher']) {
    await page.context().addCookies([{ name: 'sena_local_persona', value: role, url: origin }]);
    await page.goto('/knowledge');
    await expect(page.locator('.knowledge-page')).toHaveCount(0);
    expect((await page.request.get(base + '/projects')).status()).toBe(403);
  }
});
