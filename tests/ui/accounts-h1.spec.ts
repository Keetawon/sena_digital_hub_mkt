import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { closeMobileMenu, openMobileMenu } from './hub-navigation-helpers';

test.describe('Accounts on loopback H1', () => {
  test.skip(process.env.HUB_HOSTED_TEST_SIMULATION !== '1', 'Local H1 protocol simulation only');
  test.use({ baseURL: process.env.HUB_ADMIN_ORIGIN! });
  test.beforeEach(async ({ page }) => {
    await page.route('**/*', route => ['http:', 'https:'].includes(new URL(route.request().url()).protocol) && new URL(route.request().url()).hostname !== '127.0.0.1' ? route.abort() : route.continue());
  });
  async function login(page: Page, email = 'hub-test-admin@example.test') {
    await page.goto('/login');
    await page.getByLabel('อีเมล', { exact: true }).fill(email);
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill('H1-synthetic-only!');
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
    await expect(page.getByRole('button', { name: 'ออกจากระบบ', exact: true })).toBeVisible();
  }
  async function request(page: Page, name: string) {
    await expect(page.getByRole('heading', { name: 'ขอสิทธิ์ใช้งาน' })).toBeVisible();
    await page.getByLabel('ชื่อและนามสกุลภาษาไทย').fill(name);
    await page.getByLabel('เบอร์โทรศัพท์ที่ทำงาน').fill('020000000');
    await page.getByLabel('ทีม / ฝ่าย').fill('ทีมทดสอบ');
    await page.getByLabel('บริษัท',{exact:true}).selectOption('SENA');await page.getByLabel('ตำแหน่ง',{exact:true}).fill('ผู้ประสานงาน');
    await page.getByLabel('อ่านข้อมูลโครงการ', { exact: true }).check();
    await page.getByLabel('เหตุผล / โครงการที่รับผิดชอบ').fill('ดูแลข้อมูลสมมติ');
    await page.getByLabel('รับทราบประกาศความเป็นส่วนตัว').check();
    await page.getByRole('button', { name: 'ส่งคำขอ', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'รออนุมัติ', exact: true })).toBeVisible();
    expect((await page.request.get('/api/hub/v1/admin/projects')).status()).toBe(403);
  }
  async function approve(page: Page, name: string) {
    await page.goto('/admin/accounts');
    await page.getByLabel('ค้นหาชื่อ อีเมล บริษัท หรือทีม').fill(name);
    const names = await page.request.get('/api/hub/v1/accounts/display-names');
    expect(names.status()).toBe(200);
    await openMobileMenu(page);
    await expect(page.getByRole('link', {name: /ผู้ใช้และสิทธิ์/})).toBeVisible();
    await closeMobileMenu(page);
    const row = page.getByRole('article').filter({ hasText: name });
    await page.screenshot({path:'artifacts/accounts-admin.png',fullPage:true});
    await row.getByRole('button', { name: /^อนุมัติเป็น/ }).click();
    await expect(row).toHaveCount(0);
  }
  test('Google PKCE first sign-in, request, admin approval, access and suspension', async ({ page, browser }) => {
    await page.goto('/login?next=//evil.example');
    await page.getByRole('button', { name: 'เข้าสู่ระบบด้วย Google' }).click();
    await expect(page).toHaveURL(/\/account\/request$/);
    await expect(page.getByRole('heading', {name:'ขอสิทธิ์ใช้งาน'})).toBeVisible();
    await page.screenshot({path:'artifacts/accounts-request.png',fullPage:true});
    await request(page, 'กูเกิล สมมติ');
    const admin = await browser.newPage({ baseURL: process.env.HUB_ADMIN_ORIGIN! });
    await login(admin); await approve(admin, 'กูเกิล สมมติ');
    await page.reload(); await page.getByRole('link', { name: 'เข้าสู่พื้นที่ทำงาน' }).click();
    await expect(page).toHaveURL(`${process.env.HUB_ADMIN_ORIGIN}/home`);
    await expect(page.locator('.topbar-right')).toContainText('ผู้อ่านข้อมูล');
    await page.getByRole('button',{name:'ออกจากระบบ',exact:true}).click();
    await page.route('**/auth/v1/authorize?**', route => {
      const url=new URL(route.request().url());
      url.searchParams.set('redirect_to',`${process.env.HUB_ADMIN_ORIGIN}/auth/callback?next=//evil.example`);
      return route.continue({url:url.href});
    }, {times:1});
    await page.getByRole('button',{name:'เข้าสู่ระบบด้วย Google'}).click();
    await expect(page.locator('.topbar-right')).toContainText('ผู้อ่านข้อมูล');
    expect(new URL(page.url()).origin).toBe(process.env.HUB_ADMIN_ORIGIN!);
    await admin.getByRole('tab', { name: 'ผู้ใช้ทั้งหมด' }).click();
    const row = admin.getByRole('row').filter({ hasText: 'กูเกิล สมมติ' });
    await row.getByRole('button',{name:'จัดการ'}).click();
    const panel=admin.getByRole('dialog');await panel.getByLabel('เหตุผลที่ระงับบัญชี').fill('ระงับเพื่อทดสอบ');
    await panel.getByRole('button',{name:'ระงับบัญชี',exact:true}).click();
    await expect(panel.locator('.account-pill-suspended')).toBeVisible();
    expect((await page.request.get('/api/hub/v1/admin/projects')).status()).toBe(403);
    await page.goto('/knowledge'); await expect(page).toHaveURL(/\/account\/request$/);
    await admin.close();
  });
  test('email signup, wrong OTP, cooldown, request edit and approval', async ({ page, browser }) => {
    await page.setViewportSize({width:390,height:844}); await page.emulateMedia({reducedMotion:'reduce'});
    const email=`signup-${Date.now()}@example.test`;
    await page.goto('/signup');
    await page.getByLabel('อีเมล', { exact: true }).fill(email);
    await page.getByLabel('รหัสผ่านใหม่ (อย่างน้อย 12 ตัวอักษร)', { exact: true }).fill('Synthetic-password-12!');
    await page.getByLabel('ยืนยันรหัสผ่าน', { exact: true }).fill('Synthetic-password-12!');
    await page.getByRole('button', { name: 'ส่งรหัสยืนยัน' }).click();
    await expect(page).toHaveURL(/\/signup\/verify$/);
    await expect(page.getByText(/ส่งรหัสใหม่ได้ใน/)).toBeVisible();
    const outbox=JSON.parse(await readFile('.local/hosted-test-simulation/auth-outbox.json','utf8'));
    const code=outbox.findLast((r: {email:string})=>r.email===email).token;
    await page.getByLabel('รหัส 6 หลัก').fill(code==='000000'?'111111':'000000');
    await page.getByRole('button', { name: 'ยืนยันรหัส', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('รหัสไม่ถูกต้อง');
    await page.getByLabel('รหัส 6 หลัก').fill(code);
    await page.getByRole('button', { name: 'ยืนยันรหัส', exact: true }).click();
    await request(page, 'อีเมล สมมติ');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:'artifacts/accounts-request-mobile.png',fullPage:true});
    await page.getByRole('button', { name: 'แก้ไขคำขอ' }).click();
    await page.getByLabel('ทีม / ฝ่าย').fill('ทีมแก้ไข');
    await page.getByRole('button', { name: 'ส่งคำขอ', exact: true }).click();
    await expect(page.getByText('ทีมแก้ไข', { exact: true })).toBeVisible();
    const admin=await browser.newPage({baseURL:process.env.HUB_ADMIN_ORIGIN!});
    await login(admin); await approve(admin,'อีเมล สมมติ');
    await page.reload(); await page.getByRole('link',{name:'เข้าสู่พื้นที่ทำงาน'}).click();
    await expect(page).toHaveURL(`${process.env.HUB_ADMIN_ORIGIN}/home`);
    await expect(page.locator('.topbar-right')).toContainText('ผู้อ่านข้อมูล');
    await admin.close();
  });
  test('forgot password keeps an identical public response for missing accounts', async ({page}) => {
    await page.goto('/login/forgot');
    await page.getByLabel('อีเมล',{exact:true}).fill('does-not-exist@example.test');
    await page.getByRole('button',{name:'ส่งรหัสยืนยัน'}).click();
    await expect(page.getByRole('status')).toContainText('หากอีเมลนี้สามารถรับรหัสได้');
    await expect(page.getByLabel('รหัส 6 หลัก')).toBeVisible();
  });
  test('recovery OTP sets a new password and revokes previous refresh sessions', async ({page}) => {
    const email=`recovery-${Date.now()}@example.test`, old='Synthetic-old-password!', password='Synthetic-new-password!';
    const auth=`${process.env.HUB_SUPABASE_URL}/auth/v1`;
    await page.request.post(`${auth}/signup`,{data:{email,password:old}});
    const code=async(type:string)=>(JSON.parse(await readFile('.local/hosted-test-simulation/auth-outbox.json','utf8'))).findLast((r:{email:string;type:string})=>r.email===email&&r.type===type).token;
    const previous=await(await page.request.post(`${auth}/verify`,{data:{email,type:'email',token:await code('email')}})).json();
    await page.goto('/login/forgot');
    await page.getByLabel('อีเมล',{exact:true}).fill(email); await page.getByRole('button',{name:'ส่งรหัสยืนยัน'}).click();
    await expect(page.getByRole('status')).toContainText('หากอีเมลนี้สามารถรับรหัสได้');
    await page.getByLabel('รหัส 6 หลัก').fill(await code('recovery')); await page.getByRole('button',{name:'ยืนยันรหัส',exact:true}).click();
    await page.getByLabel('รหัสผ่านใหม่ (อย่างน้อย 12 ตัวอักษร)', { exact: true }).fill(password);
    await page.getByLabel('ยืนยันรหัสผ่าน',{exact:true}).fill(password);
    await page.getByRole('button',{name:'บันทึกรหัสผ่านใหม่'}).click();
    await expect(page.getByRole('status')).toContainText('ออกจากระบบทุกเซสชันแล้ว');
    expect((await page.request.post(`${auth}/token?grant_type=refresh_token`,{data:{refresh_token:previous.refresh_token}})).status()).toBe(400);
    expect((await page.request.post(`${auth}/token?grant_type=password`,{data:{email,password:old}})).status()).toBe(400);
    expect((await page.request.post(`${auth}/token?grant_type=password`,{data:{email,password}})).status()).toBe(200);
  });
  test('401 keeps unsaved text and offers sign-in to the same page in a new tab', async ({page}) => {
    await login(page); await page.goto('/admin/accounts');
    await page.getByRole('tab',{name:'ผู้ใช้ทั้งหมด'}).click();
    await page.getByLabel('ค้นหาชื่อ อีเมล บริษัท หรือทีม').fill('hub-test-editor@example.test');
    await page.getByRole('row').filter({hasText:'hub-test-editor@example.test'}).getByRole('button',{name:'จัดการ'}).click();
    const row=page.getByRole('dialog');
    await row.getByLabel('แม่แบบสิทธิ์',{exact:true}).selectOption('viewer:1');
    await row.getByRole('button',{name:'ใช้แม่แบบนี้',exact:true}).click();
    await row.getByLabel('บันทึกสำหรับผู้ดูแล (ไม่บังคับ)').fill('ข้อความยังไม่บันทึก');
    await page.route('**/api/hub/v1/admin/accounts/*/permissions',r=>r.fulfill({status:401,json:{error:{message:'เซสชันหมดอายุ'}}}));
    await row.getByRole('button',{name:'บันทึก',exact:true}).click();
    await expect(row.getByLabel('บันทึกสำหรับผู้ดูแล (ไม่บังคับ)')).toHaveValue('ข้อความยังไม่บันทึก');
    const link=page.getByRole('link',{name:'เข้าสู่ระบบอีกครั้งในแท็บใหม่'});
    await expect(link).toHaveAttribute('target','_blank'); await expect(link).toHaveAttribute('href','/login?next=%2Fadmin%2Faccounts');
  });
});
