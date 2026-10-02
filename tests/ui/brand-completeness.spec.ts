import { expect, test, type Page } from '@playwright/test';

const origin='http://127.0.0.1:3000',api='/api/hub/v1/admin';
const stamp='2026-10-02T00:00:00Z';
const ready=(id:string,name:string)=>({ id,public_brand_id:`brd_${id.slice(-2)}`,rem_brand_id:`000-${id.slice(-2)}`,name_th:name,name_en:'Synthetic English',status:'ready',residential_project_count:1,reason_codes:[],readiness:{ready:true,percent:100,missing:[]},checks:{name_th_confirmed:true,description:true,slug:true,primary_logo:true,logo_rights:true},optional_logos:['favicon'],updated_at:stamp,updated_by:'ผู้แก้ไขสมมติ',published_version_id:null,publication_available:false,has_unpublished_changes:true });
async function fixture(page:Page,role='publisher') {
  await page.context().addCookies([{name:'sena_local_persona',value:role,url:origin}]);
  const a=ready('28000000-0000-4000-8000-000000000001','แบรนด์สมมติพร้อม ก'),b=ready('28000000-0000-4000-8000-000000000002','แบรนด์สมมติพร้อม ข');
  const incomplete={...ready('28000000-0000-4000-8000-000000000003','แบรนด์สมมติยังไม่พร้อม'),status:'missing_data',unconfirmed_source_names:['th','en'],readiness:{ready:false,percent:70,missing:[{field:'description.th',message:'กรอกคำอธิบายแบรนด์ภาษาไทย'},{field:'assets.logo_primary',message:'เลือกโลโก้หลัก'}]},checks:{...a.checks,name_th_confirmed:false,description:false,primary_logo:false,logo_rights:false}};
  const uncreated={...ready('28000000-0000-4000-8000-000000000004','ต้นทางสมมติชื่อซ้ำ'),id:null,public_brand_id:null,status:'not_created',reason_codes:['duplicate'],readiness:{ready:false,percent:0,missing:[]},checks:{},updated_at:null,updated_by:null};
  const rows=[uncreated,incomplete,a,b],writes:{path:string;body:any}[]=[];
  await page.route(`**${api}/brands**`,async route=>{
    const path=new URL(route.request().url()).pathname;
    if(route.request().method()==='POST') { writes.push({path,body:route.request().postDataJSON()});return route.fulfill({json:{data:{created_count:2}}}); }
    if(path===`${api}/brands/completeness`)return route.fulfill({json:{data:{rows,counts:{total:4,missing_data:1,ready:2,published:0,published_changes:0,not_created:1}}}});
    if(path===`${api}/brands/bulk-preview`)return route.fulfill({json:{data:{preview_sha256:'a'.repeat(64),create_count:2,rows:[{rem_brand_id:'000-new-a',eligible:true,public_name:{th:'ชื่อสมมติ ก',en:'Synthetic A'},suggested_slug:'synthetic-a',reason_codes:[],residential_project_count:2},{rem_brand_id:'000-new-b',eligible:true,public_name:{th:'ชื่อสมมติ ข'},suggested_slug:'',reason_codes:[],residential_project_count:1},{rem_brand_id:'000-dup',eligible:false,public_name:{th:'ชื่อสมมติซ้ำ'},suggested_slug:'',reason_codes:['duplicate'],residential_project_count:1}]}}});
    if(path===`${api}/brands`)return route.fulfill({json:{data:[]}});
    return route.fulfill({json:{data:[]}});
  });
  await page.route(`**${api}/brand-requests`,route=>route.fulfill({json:{data:[]}}));
  await page.route(`**${api}/releases/publish`,route=>{writes.push({path:`${api}/releases/publish`,body:route.request().postDataJSON()});return route.fulfill({json:{data:{id:'28000000-0000-4000-8000-000000000010'}}});});
  return {rows,writes,a,b};
}

for(const viewport of [{width:1366,height:768},{width:390,height:844}]) {
  test(`completeness reasons, checks, filter and atomic ready-only selection at ${viewport.width}x${viewport.height}`,async({page})=>{
    await page.setViewportSize(viewport);const f=await fixture(page);await page.goto('/?view=brands');
    await expect(page.getByRole('button',{name:'ทั้งหมด 4',exact:true})).toBeVisible();
    await expect(page.locator('.brand-table-row td[data-label="ชื่อแบรนด์"]')).toHaveCount(4);
    await expect(page.locator('.brand-table-row').first()).toContainText('ชื่อซ้ำ ต้องตรวจตามรหัส');
    await expect(page.getByLabel('เลือกเผยแพร่ แบรนด์สมมติยังไม่พร้อม',{exact:true})).toBeDisabled();
    await page.getByLabel('ฟิลด์ที่ยังขาด',{exact:true}).selectOption('description');
    await expect(page.locator('.brand-table-row')).toHaveCount(2);
    await page.getByLabel('ฟิลด์ที่ยังขาด',{exact:true}).selectOption('all');
    await page.getByRole('button',{name:'พร้อมเผยแพร่ 2',exact:true}).click();
    await expect(page.locator('.brand-table-row')).toHaveCount(2);
    for(const name of ['แบรนด์สมมติพร้อม ก','แบรนด์สมมติพร้อม ข'])await page.getByLabel(`เลือกเผยแพร่ ${name}`,{exact:true}).check();
    await page.getByRole('button',{name:'เผยแพร่แบรนด์ที่เลือก (2)',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'ตรวจชุดเผยแพร่แบรนด์',exact:true});
    const confirm=dialog.getByRole('button',{name:'ยืนยันเผยแพร่แบรนด์ทั้งชุด',exact:true});
    await expect(confirm).toBeDisabled();await dialog.getByLabel('เหตุผลเผยแพร่แบรนด์ทั้งชุด',{exact:true}).fill('ทดสอบชุดแบรนด์สมมติ');
    await expect(confirm).toBeDisabled();await dialog.getByLabel('ยืนยันเผยแพร่แบรนด์ที่เลือกเป็นชุดเดียว',{exact:true}).check();
    await confirm.click();await expect(dialog).toHaveCount(0);
    expect(f.writes).toHaveLength(1);expect(f.writes[0].path).toBe(`${api}/releases/publish`);expect(f.writes[0].body.demo_mode).toBe(false);
    expect(f.writes[0].body.members.map((r:any)=>r.entity_id)).toEqual([f.a.id,f.b.id]);expect(f.writes[0].body.members.every((r:any)=>r.expected_updated_at===stamp&&r.expected_published_version_id===null)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`artifacts/brand-completeness-${viewport.width}.png`});
  });
}

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
  const response=await page.request.get(`${api}/brands/completeness.csv?status=not_created&search=35`);
  expect(response.status()).toBe(200);expect(response.headers()['content-type']).toContain('text/csv');
  const csv=await response.text();expect(csv).toContain('name_th,name_en,rem_brand_id,public_brand_id,residential_project_count,status');expect(csv).toContain('ยังไม่ทราบสถานะต้นทาง');expect(csv).not.toMatch(/rights_notes|storage_path|public_url|https?:\/\//);
});
