import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { SIMULATION_PASSWORD } from '../../scripts/hosted-test-fixtures.mjs';

const auth='http://127.0.0.1:54329/auth/v1',api='http://127.0.0.1:8001';
const profile={display_name_th:'ผู้สมัคร สมมติ',phone:'020000000',company_type:'SENA',position:'ผู้ประสานงาน',team:'ฝ่ายทดสอบ',requested_tasks:['edit'],reason:'ตรวจข้อมูลโครงการสมมติ',privacy_acknowledged:true};
async function identity(request:APIRequestContext,email=`redesign-${Date.now()}@example.test`,submitted=true) {
  const password=randomBytes(20).toString('hex');
  expect((await request.post(`${auth}/signup`,{data:{email,password}})).ok()).toBe(true);
  const outbox=JSON.parse(await readFile('.local/hosted-test-simulation/auth-outbox.json','utf8'));
  const token=outbox.findLast((r:{email:string})=>r.email===email).token;
  const session=await(await request.post(`${auth}/verify`,{data:{email,token,type:'email'}})).json();
  const headers={Authorization:`Bearer ${session.access_token}`};
  const me=await(await request.get(`${api}/v1/me`,{headers})).json();
  if(submitted)expect((await request.post(`${api}/v1/me/access-request`,{headers,data:profile})).status()).toBe(200);
  return {email,password,headers,id:me.data.id};
}
async function login(page:Page,email='hub-test-admin@example.test',password=SIMULATION_PASSWORD) {
  await page.goto('/login');await page.getByLabel('อีเมล',{exact:true}).fill(email);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password);
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await expect(page.getByRole('button',{name:'ออกจากระบบ',exact:true})).toBeVisible();
}
async function findUser(page:Page,email:string) {
  await page.getByRole('tab',{name:'ผู้ใช้ทั้งหมด'}).click();await page.getByLabel('ค้นหาชื่อ อีเมล บริษัท หรือทีม').fill(email);
  return page.getByRole('row').filter({hasText:email});
}

test.describe('Accounts redesign on isolated loopback H1',()=>{
  test.skip(process.env.HUB_HOSTED_TEST_SIMULATION!=='1','Loopback only');
  test.use({baseURL:'http://127.0.0.1:3001'});
  test.beforeEach(async({page})=>{await page.route('**/*',route=>['http:','https:'].includes(new URL(route.request().url()).protocol)&&new URL(route.request().url()).hostname!=='127.0.0.1'?route.abort():route.continue());});

  test('approve confirms success, appears in today and users, requester polls without reload',async({page,browser})=>{
    const user=await identity(page.request);const requester=await browser.newPage({baseURL:'http://127.0.0.1:3001'});
    await requester.clock.install();await login(requester,user.email,user.password);await expect(requester.getByRole('heading',{name:'รออนุมัติ',exact:true})).toBeVisible();
    let navigations=0;requester.on('framenavigated',()=>navigations++);
    await login(page);await page.goto('/admin/accounts');await page.getByLabel('ค้นหาชื่อ อีเมล บริษัท หรือทีม').fill(user.email);
    const card=page.getByRole('article').filter({hasText:user.email});
    await expect(card.getByRole('combobox',{name:'แม่แบบสิทธิ์',exact:true})).toHaveValue('editor:1');
    await expect(page.getByLabel('บัญชีรออนุมัติ')).toHaveText(/^\d+$/);
    await page.screenshot({path:'artifacts/accounts-queue.png',fullPage:true});
    await card.getByRole('button',{name:'อนุมัติเป็น ผู้แก้ไขข้อมูล',exact:true}).click();
    await expect(page.locator('.accounts-feedback[role=status]')).toHaveText('อนุมัติ ผู้สมัคร สมมติ เป็น ผู้แก้ไขข้อมูล แล้ว');
    await expect(card).toHaveCount(0);await expect(page.getByRole('region',{name:'ตัดสินใจแล้ววันนี้'})).toContainText('ผู้สมัคร สมมติ');
    const row=await findUser(page,user.email);await expect(row).toContainText('ใช้งานอยู่');await expect(row.getByText('ใหม่',{exact:true})).toBeVisible();
    await page.screenshot({path:'artifacts/accounts-users.png',fullPage:true});
    await requester.bringToFront();await requester.clock.fastForward(30001);
    await expect(requester.getByRole('link',{name:'เข้าสู่พื้นที่ทำงาน'})).toBeVisible();expect(navigations).toBe(0);
    await requester.close();
  });

  test('manage diff, admin confirmation and keyboard-only focus containment',async({page})=>{
    const user=await identity(page.request);await login(page);await page.goto('/admin/accounts');await page.getByLabel('ค้นหาชื่อ อีเมล บริษัท หรือทีม').fill(user.email);
    await page.getByRole('article').filter({hasText:user.email}).getByRole('button',{name:/^อนุมัติเป็น/}).click();
    await expect(page.locator('.accounts-feedback[role=status]')).toContainText('อนุมัติ');
    const row=await findUser(page,user.email),opener=row.getByRole('button',{name:'จัดการ'});
    await opener.focus();await page.keyboard.press('Enter');const panel=page.getByRole('dialog');
    await expect(panel.getByRole('button',{name:'ปิด',exact:true})).toBeFocused();await expect(panel.getByRole('button',{name:'บันทึก',exact:true})).toBeDisabled();
    await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('dialog'))).toBe(true);
    await panel.getByLabel('แม่แบบสิทธิ์',{exact:true}).selectOption('publisher:1');await panel.getByRole('button',{name:'ใช้แม่แบบนี้',exact:true}).click();
    const diff=panel.getByLabel('ความแตกต่างของสิทธิ์').first();await expect(diff).toContainText('แม่แบบ: ผู้แก้ไขข้อมูล · รุ่น 1 → Manager — อนุมัติและเผยแพร่ · รุ่น 1');
    await panel.getByLabel('บันทึกสำหรับผู้ดูแล (ไม่บังคับ)').fill('บันทึกเฉพาะผู้ดูแล');
    await page.screenshot({path:'artifacts/accounts-manage.png',fullPage:false});
    await panel.getByRole('button',{name:'บันทึก',exact:true}).click();await expect(diff).toHaveText('ยังไม่มีการเปลี่ยนแปลง');
    await panel.getByRole('checkbox',{name:'จัดการผู้ใช้และสิทธิ์',exact:true}).check();await expect(panel.getByRole('button',{name:'บันทึก',exact:true})).toBeDisabled();
    const confirm=panel.getByRole('checkbox',{name:/ยืนยันให้สิทธิ์ผู้ดูแลระบบ/});await confirm.focus();await page.keyboard.press('Space');
    await expect(panel.getByRole('button',{name:'บันทึก',exact:true})).toBeEnabled();
    await panel.getByRole('button',{name:'บันทึก',exact:true}).click();await expect(diff).toHaveText('ยังไม่มีการเปลี่ยนแปลง');
    await expect(panel.getByRole('checkbox',{name:'จัดการผู้ใช้และสิทธิ์',exact:true})).toBeChecked();
    await panel.getByRole('checkbox',{name:'จัดการผู้ใช้และสิทธิ์',exact:true}).uncheck();await panel.getByRole('button',{name:'บันทึก',exact:true}).click();await expect(diff).toHaveText('ยังไม่มีการเปลี่ยนแปลง');
    for(let n=0;n<20;n++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('dialog'))).toBe(true);}
    await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(opener).toBeFocused();
    const me=await(await page.request.get(`${api}/v1/me`,{headers:user.headers})).json();expect(me.data.decision_note).toBe('');
  });

  test('invite by email, sign in, short acceptance form and workspace',async({page,browser})=>{
    const email=`invited-${Date.now()}@example.test`;await login(page);await page.goto('/admin/accounts');
    await page.getByRole('button',{name:'+ เพิ่มผู้ใช้',exact:true}).click();const panel=page.getByRole('dialog');
    await panel.getByLabel('อีเมล',{exact:true}).fill(email);await panel.getByLabel('ชื่อสำหรับอ้างอิง (ไม่บังคับ)').fill('เพื่อนร่วมงาน สมมติ');
    await panel.getByRole('combobox',{name:'แม่แบบสิทธิ์',exact:true}).selectOption('agency:1');await panel.getByLabel('รหัสเอเจนซี').selectOption('KIN');await panel.getByLabel('ทีม / ฝ่าย').fill('ทีมเอเจนซีสมมติ');
    await expect(panel.getByRole('option',{name:/ผู้ดูแลระบบ/})).toHaveCount(0);
    await page.screenshot({path:'artifacts/accounts-invite-create.png',fullPage:false});
    await panel.getByRole('button',{name:'สร้างคำเชิญ',exact:true}).click();await expect(panel).toHaveCount(0);
    await expect(page.getByRole('article').filter({hasText:email})).toContainText('รอตอบรับ');
    const user=await identity(page.request,email,false),requester=await browser.newPage({baseURL:'http://127.0.0.1:3001'});
    await login(requester,email,user.password);await expect(requester.getByRole('heading',{name:'ตอบรับคำเชิญ',exact:true})).toBeVisible();
    await expect(requester.getByLabel('ทีม / ฝ่าย')).toHaveValue('ทีมเอเจนซีสมมติ');await expect(requester.getByLabel('ชื่อบริษัท',{exact:true})).toHaveValue('KIN');await expect(requester.getByLabel('ชื่อบริษัท',{exact:true})).toHaveAttribute('readonly','');
    await requester.getByLabel('ชื่อและนามสกุลภาษาไทย').fill('ผู้รับเชิญ สมมติ');await requester.getByLabel('เบอร์โทรศัพท์ที่ทำงาน').fill('020000000');await requester.getByLabel('ตำแหน่ง',{exact:true}).fill('ผู้ประสานงาน');await requester.getByLabel('รับทราบประกาศความเป็นส่วนตัว').check();
    await expect(requester.getByLabel('เหตุผล / โครงการที่รับผิดชอบ')).toHaveCount(0);await requester.screenshot({path:'artifacts/accounts-invite-accept.png',fullPage:true});
    let failAccessRead=false,acceptPosts=0;
    await requester.route('**/api/hub/v1/me/invite-accept',async route=>{acceptPosts++;const response=await route.fetch();if(response.ok())failAccessRead=true;await route.fulfill({response});});
    await requester.route('**/api/hub/v1/me',route=>{if(failAccessRead){failAccessRead=false;return route.fulfill({status:503,json:{error:{message:'ระบบขัดข้องชั่วคราว'}}});}return route.continue();});
    await requester.getByRole('button',{name:'ตอบรับคำเชิญ',exact:true}).click();
    await expect(requester.getByRole('alert').filter({hasText:'บัญชีเปิดใช้งานแล้ว'})).toBeVisible();
    await expect(requester.getByRole('status')).toContainText('ใช้งานอยู่');await expect(requester.locator('.account-summary')).toContainText('ผู้ประสานงาน');
    await expect(requester.getByRole('link',{name:'เข้าสู่พื้นที่ทำงาน'})).toHaveCount(0);
    await requester.getByRole('button',{name:'ตรวจสถานะพื้นที่ทำงานอีกครั้ง',exact:true}).click();
    await expect(requester.getByRole('link',{name:'เข้าสู่พื้นที่ทำงาน'})).toHaveAttribute('href','/ads/registry');expect(acceptPosts).toBe(1);
    await requester.getByRole('link',{name:'เข้าสู่พื้นที่ทำงาน'}).click();await expect(requester).toHaveURL(/\/ads\/registry$/);
    await page.reload();await page.getByRole('tab',{name:/^คำเชิญ/}).click();await expect(page.getByRole('article').filter({hasText:email})).toContainText('ตอบรับแล้ว');await requester.close();
  });

  test('request focus refresh preserves dirty text after approval; mobile table stays contained',async({page,browser})=>{
    const user=await identity(page.request);const requester=await browser.newPage({baseURL:'http://127.0.0.1:3001'});
    await login(requester,user.email,user.password);await requester.getByRole('button',{name:'แก้ไขคำขอ'}).click();await requester.getByLabel('ตำแหน่ง',{exact:true}).fill('ข้อความยังไม่บันทึก');
    await login(page);await page.goto('/admin/accounts');await page.getByLabel('ค้นหาชื่อ อีเมล บริษัท หรือทีม').fill(user.email);await page.getByRole('article').filter({hasText:user.email}).getByRole('button',{name:/^อนุมัติเป็น/}).click();
    await expect(page.locator('.accounts-feedback[role=status]')).toContainText('อนุมัติ');await requester.bringToFront();await requester.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(requester.getByLabel('ตำแหน่ง',{exact:true})).toHaveValue('ข้อความยังไม่บันทึก');await expect(requester.getByRole('button',{name:'ส่งคำขอ',exact:true})).toBeDisabled();await expect(requester.getByRole('link',{name:'เข้าสู่พื้นที่ทำงาน'})).toBeVisible();
    await page.setViewportSize({width:400,height:860});await findUser(page,user.email);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'artifacts/accounts-mobile.png',fullPage:true});
    await page.getByRole('row').filter({hasText:user.email}).getByRole('button',{name:'จัดการ'}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('dialog')).toBeVisible();await requester.close();
  });

  test('request refresh after a real session identity switch discards the prior identity fields',async({page,browser})=>{
    const first=await identity(page.request,`request-first-${Date.now()}@example.test`);
    const second=await identity(page.request,`request-second-${Date.now()}@example.test`);
    // Make the first account newer, so timestamp ordering cannot stand in for identity.
    expect((await page.request.patch(`${api}/v1/me/access-request`,{headers:first.headers,data:{...profile,position:'ตำแหน่งบัญชีแรก'}})).status()).toBe(200);
    const context=await browser.newContext({baseURL:'http://127.0.0.1:3001'});const requester=await context.newPage();
    await login(requester,first.email,first.password);await requester.getByRole('button',{name:'แก้ไขคำขอ'}).click();
    await requester.getByLabel('ตำแหน่ง',{exact:true}).fill('ข้อความส่วนตัวของบัญชีแรกที่ยังไม่บันทึก');
    const switcher=await context.newPage();await login(switcher,second.email,second.password);
    await requester.bringToFront();await requester.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(requester.getByText(`อีเมล: ${second.email}`,{exact:true})).toBeVisible();
    await expect(requester.getByLabel('ตำแหน่ง',{exact:true})).toHaveValue(profile.position);
    expect(await requester.locator('input,textarea').evaluateAll(nodes=>nodes.some(node=>(node as HTMLInputElement).value==='ข้อความส่วนตัวของบัญชีแรกที่ยังไม่บันทึก'))).toBe(false);
    await context.close();
  });

  test('stale queue reload keeps typed text when another admin decision removes the pending status',async({page})=>{
    const user=await identity(page.request);await login(page);await page.goto('/admin/accounts');await page.getByLabel('ค้นหาชื่อ อีเมล บริษัท หรือทีม').fill(user.email);
    const card=page.getByRole('article').filter({hasText:user.email});await card.getByRole('button',{name:'ปฏิเสธ',exact:true}).click();await card.getByLabel('เหตุผลที่ปฏิเสธ').fill('ข้อความในหน้าที่ยังไม่บันทึก');
    const me=await(await page.request.get(`${api}/v1/me`,{headers:user.headers})).json();
    const result=await page.request.post(`/api/hub/v1/admin/accounts/${user.id}/decision`,{headers:{Origin:'http://127.0.0.1:3001'},data:{action:'reject',note:'คำตัดสินจากอีกหน้าหนึ่ง',updated_at:me.data.updated_at}});expect(result.status()).toBe(200);
    await card.getByRole('button',{name:'ยืนยันปฏิเสธ'}).click();await expect(card.getByRole('alert')).toContainText('ข้อมูลเปลี่ยนแล้ว');await card.getByRole('button',{name:'โหลดข้อมูลล่าสุด'}).click();
    await expect(card.getByRole('status')).toContainText('สถานะเปลี่ยนแล้ว');await expect(card.getByLabel('เหตุผลที่ปฏิเสธ')).toHaveValue('ข้อความในหน้าที่ยังไม่บันทึก');await expect(card.getByRole('button',{name:'ยืนยันปฏิเสธ'})).toBeDisabled();
  });
});
