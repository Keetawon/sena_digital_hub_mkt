import { expect, test, type Page } from '@playwright/test';
import { confirmPublication, mockReleaseQueue, mockWorkflowReads, refreshSyntheticAuthority, workflowText } from './content-workflow-fixtures';

const origin='http://127.0.0.1:3000',api='/api/hub/v1/admin';
const stamp='2026-10-02T00:00:00Z';
const ready=(id:string,name:string)=>({ id,public_brand_id:`brd_${id.slice(-2)}`,rem_brand_id:`000-${id.slice(-2)}`,name_th:name,name_en:'Synthetic English',status:'ready',residential_project_count:1,reason_codes:[],readiness:{ready:true,percent:100,missing:[]},checks:{name_th_confirmed:true,description:true,slug:true,primary_logo:true,logo_rights:true},optional_logos:['favicon'],updated_at:stamp,updated_by:'ผู้แก้ไขสมมติ',published_version_id:null,publication_available:false,has_unpublished_changes:true });
async function fixture(page:Page,role='publisher',extraCount=0) {
  await page.context().addCookies([{name:'sena_local_persona',value:role,url:origin}]);
  const a=ready('28000000-0000-4000-8000-000000000001','แบรนด์สมมติพร้อม ก'),b=ready('28000000-0000-4000-8000-000000000002','แบรนด์สมมติพร้อม ข');
  const incomplete={...ready('28000000-0000-4000-8000-000000000003','แบรนด์สมมติยังไม่พร้อม'),status:'missing_data',unconfirmed_source_names:['th','en'],readiness:{ready:false,percent:70,missing:[{field:'description.th',message:'กรอกคำอธิบายแบรนด์ภาษาไทย'},{field:'assets.logo_primary',message:'เลือกโลโก้หลัก'}]},checks:{...a.checks,name_th_confirmed:false,description:false,primary_logo:false,logo_rights:false}};
  const uncreated={...ready('28000000-0000-4000-8000-000000000004','ต้นทางสมมติชื่อซ้ำ'),id:null,public_brand_id:null,status:'not_created',reason_codes:['duplicate'],readiness:{ready:false,percent:0,missing:[]},checks:{},updated_at:null,updated_by:null};
  const extraRows=Array.from({length:extraCount},(_,index)=>ready(`28000000-0000-4000-8000-${String(index+5).padStart(12,'0')}`,`แบรนด์สมมติลำดับ ${String(index+5).padStart(2,'0')}`));
  const rows=[uncreated,incomplete,a,b,...extraRows],writes:{path:string;body:any}[]=[];
  await page.route(`**${api}/brands**`,async route=>{
    const path=new URL(route.request().url()).pathname;
    if(route.request().method()==='POST') { writes.push({path,body:route.request().postDataJSON()});return route.fulfill({json:{data:{created_count:2}}}); }
    if(path===`${api}/brands/completeness`)return route.fulfill({json:{data:{rows,counts:{total:rows.length,missing_data:1,ready:rows.length-2,published:0,published_changes:0,not_created:1}}}});
    if(path===`${api}/brands/bulk-preview`)return route.fulfill({json:{data:{preview_sha256:'a'.repeat(64),create_count:2,rows:[{rem_brand_id:'000-new-a',eligible:true,public_name:{th:'ชื่อสมมติ ก',en:'Synthetic A'},suggested_slug:'synthetic-a',reason_codes:[],residential_project_count:2},{rem_brand_id:'000-new-b',eligible:true,public_name:{th:'ชื่อสมมติ ข'},suggested_slug:'',reason_codes:[],residential_project_count:1},{rem_brand_id:'000-dup',eligible:false,public_name:{th:'ชื่อสมมติซ้ำ'},suggested_slug:'',reason_codes:['duplicate'],residential_project_count:1}]}}});
    if(path===`${api}/brands`)return route.fulfill({json:{data:[]}});
    return route.fulfill({json:{data:[]}});
  });
  await page.route(`**${api}/brand-requests`,route=>route.fulfill({json:{data:[]}}));
  await mockWorkflowReads(page, { role, publish: role === 'publisher' });
  const queue = await mockReleaseQueue(page, [a,b,...extraRows].map(row => ({ entity_type: 'brand', entity_id: row.id, public_id: row.public_brand_id, title: { th: row.name_th }, expected_updated_at: stamp })), writes);
  return {rows,writes,a,b,queue};
}

for(const viewport of [{width:1366,height:768},{width:390,height:844}]) {
  test(`brand pages retain selection and reset after filtering at ${viewport.width}x${viewport.height}`,async({page})=>{
    await page.setViewportSize(viewport);const f=await fixture(page,'publisher',20);await page.goto('/?view=brands');
    await refreshSyntheticAuthority(page);
    const top=page.getByRole('navigation',{name:'หน้ารายการแบรนด์ด้านบน',exact:true});
    const bottom=page.getByRole('navigation',{name:'หน้ารายการแบรนด์ด้านล่าง',exact:true});
    const rows=page.locator('.brand-table-row');
    await expect(page.getByRole('button',{name:'ทั้งหมด 24',exact:true})).toBeVisible();
    await expect(rows).toHaveCount(10);
    await expect(page.locator('#brand-page-range')).toContainText('แสดง 1–10 จาก 24 รายการ');
    await expect(top.getByRole('button',{name:'หน้าก่อนหน้า',exact:true})).toBeDisabled();
    await page.getByRole('checkbox',{name:'เลือกเผยแพร่ แบรนด์สมมติพร้อม ก',exact:true}).check();
    await top.getByRole('button',{name:'หน้าถัดไป',exact:true}).click();
    await expect(top.getByLabel('หน้า',{exact:true})).toHaveValue('2');
    await expect(rows).toHaveCount(10);
    await expect(rows.first()).toContainText('แบรนด์สมมติลำดับ 11');
    await expect(page.locator('.brand-selection-summary')).toContainText('เลือกไว้ 1 แบรนด์ · อยู่นอกหน้านี้ 1 แบรนด์');
    await page.getByRole('checkbox',{name:'เลือกเผยแพร่ แบรนด์สมมติลำดับ 11',exact:true}).check();
    await bottom.getByRole('button',{name:'หน้าถัดไป',exact:true}).click();
    await expect(rows).toHaveCount(4);
    await expect(page.locator('#brand-page-range')).toContainText('แสดง 21–24 จาก 24 รายการ');
    await expect(page.getByRole('region',{name:'ตารางความครบถ้วนของแบรนด์',exact:true})).toBeFocused();
    await expect(top.getByRole('button',{name:'หน้าถัดไป',exact:true})).toBeDisabled();
    await expect(page.locator('.brand-selection-summary')).toContainText('เลือกไว้ 2 แบรนด์ · อยู่นอกหน้านี้ 2 แบรนด์');
    await top.getByLabel('หน้า',{exact:true}).selectOption('1');
    await expect(page.getByRole('checkbox',{name:'เลือกเผยแพร่ แบรนด์สมมติพร้อม ก',exact:true})).toBeChecked();
    await top.getByLabel('หน้า',{exact:true}).selectOption('3');
    await page.getByLabel('ค้นหาชื่อหรือรหัสแบรนด์',{exact:true}).fill('แบรนด์สมมติพร้อม ก');
    await expect(rows).toHaveCount(1);await expect(top.getByLabel('หน้า',{exact:true})).toHaveValue('1');
    await expect(page.getByRole('checkbox',{name:'เลือกเผยแพร่ แบรนด์สมมติพร้อม ก',exact:true})).not.toBeChecked();
    await expect(page.locator('.brand-dashboard-actions').getByRole('button',{name:`${workflowText.queue} (0)`,exact:true})).toBeDisabled();
    const csv=page.getByRole('link',{name:'ดาวน์โหลด CSV ตามตัวกรอง',exact:true});
    const query=new URL(await csv.getAttribute('href') ?? '',origin).searchParams;
    expect(query.get('search')).toBe('แบรนด์สมมติพร้อม ก');expect(query.has('page')).toBe(false);
    await page.getByLabel('ค้นหาชื่อหรือรหัสแบรนด์',{exact:true}).fill('');
    await top.getByLabel('หน้า',{exact:true}).selectOption('3');
    await page.getByRole('button',{name:'พร้อมเผยแพร่ 22',exact:true}).click();
    await expect(top.getByLabel('หน้า',{exact:true})).toHaveValue('1');
    await expect(page.locator('#brand-page-range')).toContainText('แสดง 1–10 จาก 22 รายการ');
    await top.getByLabel('หน้า',{exact:true}).selectOption('2');
    await page.getByLabel('ฟิลด์ที่ยังขาด',{exact:true}).selectOption('description');
    await expect(rows).toHaveCount(0);await expect(top.getByLabel('หน้า',{exact:true})).toHaveValue('1');
    await expect(page.locator('#brand-page-range')).toContainText('แสดง 0–0 จาก 0 รายการ');
    await expect(bottom.getByRole('button',{name:'หน้าถัดไป',exact:true})).toBeDisabled();
    await page.getByLabel('สถานะแบรนด์',{exact:true}).selectOption('all');
    await expect(rows).toHaveCount(2);
    await page.getByLabel('ฟิลด์ที่ยังขาด',{exact:true}).selectOption('all');
    await top.getByLabel('รายการต่อหน้า',{exact:true}).selectOption('25');
    await expect(rows).toHaveCount(24);await expect(bottom.getByLabel('รายการต่อหน้า',{exact:true})).toHaveValue('25');
    await top.getByLabel('รายการต่อหน้า',{exact:true}).selectOption('50');
    await expect(rows).toHaveCount(24);await expect(top.getByRole('button',{name:'หน้าถัดไป',exact:true})).toBeDisabled();
    await page.getByRole('checkbox',{name:'เลือกเผยแพร่ แบรนด์สมมติพร้อม ก',exact:true}).check();
    await expect(page.locator('.brand-dashboard-actions').getByRole('button',{name:`${workflowText.queue} (1)`,exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'ล้างรายการที่เลือก',exact:true}).click();
    await expect(page.locator('.brand-dashboard-actions').getByRole('button',{name:`${workflowText.queue} (0)`,exact:true})).toBeDisabled();
    await top.getByLabel('รายการต่อหน้า',{exact:true}).selectOption('10');
    await top.scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`artifacts/brand-pagination-${viewport.width}.png`});
    expect(f.writes).toEqual([]);
  });

  test(`completeness reasons, checks, filter and exact ready-only queue handoff at ${viewport.width}x${viewport.height}`,async({page})=>{
    await page.setViewportSize(viewport);const f=await fixture(page);await page.goto('/?view=brands');
    await refreshSyntheticAuthority(page);
    await expect(page.getByRole('button',{name:'ทั้งหมด 4',exact:true})).toBeVisible();
    await expect(page.locator('.brand-table-row td[data-label="ชื่อแบรนด์"]')).toHaveCount(4);
    await expect(page.locator('.brand-table-row').first()).toContainText('ชื่อซ้ำ ต้องตรวจตามรหัส');
    await expect(page.getByLabel('เลือกเผยแพร่ แบรนด์สมมติยังไม่พร้อม',{exact:true})).toBeDisabled();
    await expect(page.getByLabel('เลือกเผยแพร่ แบรนด์สมมติยังไม่พร้อม',{exact:true})).toHaveAccessibleDescription('ข้อมูลยังไม่ครบสำหรับเผยแพร่');
    const uncreated=page.locator('.brand-table-row').first();
    await expect(uncreated.getByRole('checkbox')).toBeDisabled();
    await expect(uncreated.getByRole('checkbox')).toHaveAccessibleDescription('ยังไม่มีฉบับร่างให้ตรวจ');
    await expect(uncreated.getByRole('link',{name:/เปิดตรวจแบรนด์/})).toHaveCount(0);
    await page.getByLabel('ฟิลด์ที่ยังขาด',{exact:true}).selectOption('description');
    await expect(page.locator('.brand-table-row')).toHaveCount(2);
    await page.getByLabel('ฟิลด์ที่ยังขาด',{exact:true}).selectOption('all');
    await page.getByRole('button',{name:'พร้อมเผยแพร่ 2',exact:true}).click();
    await expect(page.locator('.brand-table-row')).toHaveCount(2);
    for(const name of ['แบรนด์สมมติพร้อม ก','แบรนด์สมมติพร้อม ข'])await page.getByLabel(`เลือกเผยแพร่ ${name}`,{exact:true}).check();
    await page.locator('.brand-dashboard-actions').getByRole('button',{name:`${workflowText.queue} (2)`,exact:true}).click();
    await expect(page).toHaveURL(/\/publish\?/);
    await refreshSyntheticAuthority(page);
    expect(new URL(page.url()).searchParams.getAll('brand')).toEqual([f.a.public_brand_id, f.b.public_brand_id]);
    expect(f.writes).toEqual([]);
    for (const row of [f.a,f.b]) await expect(page.locator(`[data-publication-target="release:brand:${row.id}"]`).getByRole('checkbox')).toBeChecked();
    const form=page.locator('.publication-workspace > form'), prepare=form.getByRole('button',{name:`${workflowText.prepare_review} (2)`,exact:true});
    await expect(prepare).toBeDisabled();await form.getByLabel(workflowText.reason,{exact:true}).fill('ทดสอบชุดแบรนด์สมมติ');
    await prepare.click();
    const review=page.getByRole('region',{name:workflowText.review_publication,exact:true});
    await expect(review.locator('.publication-reviewed-page')).toHaveCount(2);
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]).toEqual({path:'publication-queue/prepare',body:{selections:[f.a,f.b].map(row=>({system:'release',entity_type:'brand',entity_id:row.id})),reason:'ทดสอบชุดแบรนด์สมมติ'}});
    await confirmPublication(page,review);
    expect(f.writes).toHaveLength(2);
    expect(f.writes[1]).toEqual({path:'publication-queue/publish',body:{publication_id:f.queue.publicationId,expected_digest:f.queue.digest}});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`artifacts/brand-completeness-${viewport.width}.png`});
  });
}

for(const viewport of [{width:1366,height:768},{width:844,height:390}]) {
  test(`brand headers stay visible inside the scrolling table at ${viewport.width}x${viewport.height}`,async({page})=>{
    await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:'reduce'});await fixture(page,'publisher',20);await page.goto('/?view=brands');
    await refreshSyntheticAuthority(page);
    const table=page.getByRole('region',{name:'ตารางความครบถ้วนของแบรนด์',exact:true});
    await expect(page.locator('.brand-table-row')).toHaveCount(10);
    await table.scrollIntoViewIfNeeded();
    await table.evaluate(element=>{element.scrollTop=300;element.scrollLeft=180;});
    await expect.poll(()=>table.evaluate(element=>element.scrollTop)).toBeGreaterThanOrEqual(300);
    const bounds=await table.evaluate(element=>{
      const header=element.querySelector('th')!,row=element.querySelector('tbody tr')!;
      return {tableTop:element.getBoundingClientRect().top,headerTop:header.getBoundingClientRect().top,rowTop:row.getBoundingClientRect().top,position:getComputedStyle(header).position,left:element.scrollLeft};
    });
    expect(bounds.position).toBe('sticky');expect(Math.abs(bounds.headerTop-bounds.tableTop)).toBeLessThanOrEqual(2);
    expect(bounds.rowTop).toBeLessThan(bounds.headerTop);expect(bounds.left).toBeGreaterThan(0);
    await table.screenshot({path:`artifacts/brand-sticky-header-${viewport.width}.png`});
    const top=page.getByRole('navigation',{name:'หน้ารายการแบรนด์ด้านบน',exact:true});
    await top.getByRole('button',{name:'หน้าถัดไป',exact:true}).click();
    await expect.poll(()=>table.evaluate(element=>element.scrollTop)).toBe(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}

test('viewer can page through brands without publication controls',async({page})=>{
  const f=await fixture(page,'viewer',20);await page.goto('/?view=brands');
  await refreshSyntheticAuthority(page);
  await page.getByRole('navigation',{name:'หน้ารายการแบรนด์ด้านบน',exact:true}).getByRole('button',{name:'หน้าถัดไป',exact:true}).click();
  await expect(page.locator('#brand-page-range')).toContainText('แสดง 11–20 จาก 24 รายการ');
  await expect(page.locator('.brand-table-row').getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('.brand-dashboard-actions').getByRole('button',{name:new RegExp(`^${workflowText.queue} \\(`)})).toHaveCount(0);
  expect(f.writes).toEqual([]);
});

test('brand last editor displays account names and keeps legacy identities honest',async({page})=>{
  const f=await fixture(page);
  f.rows[1].updated_by='00000000-0000-0000-0000-000000000001';
  f.a.updated_by='00000000-0000-0000-0000-000000000005';
  f.b.updated_by='28000000-0000-4000-8000-000000000099';
  await page.goto('/?view=brands');
  const cells=page.locator('.brand-table-row td[data-label="ปรับปรุงล่าสุด / โดย"]');
  await expect(cells.nth(0)).toContainText('ยังไม่สร้าง');
  await expect(cells.nth(1)).toContainText('สมชาย แก้ไข');
  await expect(cells.nth(2)).toContainText('ผู้ดูแล ตัวอย่าง');
  await expect(cells.nth(3)).toContainText('ผู้ใช้เดิม');
  for(const cell of await cells.all()) expect(await cell.innerText()).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
  expect(f.writes).toEqual([]);
});

test('admin bulk preview requires confirmation and uses the exact displayed hash',async({page})=>{
  const f=await fixture(page,'admin');await page.goto('/?view=brands');
  await page.getByRole('button',{name:'พรีวิวสร้างฉบับร่างจาก DW',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'ตรวจรายการก่อนสร้างฉบับร่างแบรนด์',exact:true});
  await expect(dialog).toContainText('ค่าจากต้นทาง ยังไม่ยืนยัน');await expect(dialog).toContainText('ชื่อซ้ำ ต้องตรวจตามรหัส');expect(f.writes).toHaveLength(0);
  const confirm=dialog.getByRole('button',{name:'ยืนยันสร้างฉบับร่างแบรนด์',exact:true});
  await expect(confirm).toBeDisabled();await dialog.getByLabel('เหตุผลในการสร้างฉบับร่าง',{exact:true}).fill('ตรวจต้นทางสมมติแล้ว');await expect(confirm).toBeDisabled();
  await dialog.getByLabel('ยืนยันสร้างเฉพาะรายการที่ผ่านในพรีวิวนี้',{exact:true}).check();await confirm.click();await expect(dialog).toHaveCount(0);
  expect(f.writes).toHaveLength(1);expect(f.writes[0].body).toEqual({preview_sha256:'a'.repeat(64),confirmed:true,change_reason:'ตรวจต้นทางสมมติแล้ว'});
});

test('staff CSV goes through the authenticated proxy and excludes files and rights evidence',async({page})=>{
  await page.context().addCookies([{name:'sena_local_persona',value:'viewer',url:origin}]);await page.goto('/?view=brands');
  await expect(page.getByRole('button',{name:/^ทั้งหมด \d+$/,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'พรีวิวสร้างฉบับร่างจาก DW',exact:true})).toHaveCount(0);
  // Use the synthetic seed, never the real reviewed DW dictionary.
  const response=await page.request.get(`${api}/brands/completeness.csv?status=all&search=DEMO-BRAND-01`);
  expect(response.status()).toBe(200);expect(response.headers()['content-type']).toContain('text/csv');
  const csv=await response.text();expect(csv).toContain('name_th,name_en,rem_brand_id,public_brand_id,residential_project_count,status');expect(csv).toContain('DEMO-BRAND-01');expect(csv).not.toMatch(/rights_notes|storage_path|public_url|https?:\/\//);
});
