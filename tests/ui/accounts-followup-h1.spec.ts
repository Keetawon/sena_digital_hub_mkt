import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const auth = 'http://127.0.0.1:54329/auth/v1';
const api = 'http://127.0.0.1:8001';
const requestBody = { display_name_th:'ผู้สมัคร ทดสอบเพิ่มเติม', phone:'020000000', team:'ทีมสมมติ', company_type:'SENA', position:'ผู้ประสานงาน', requested_tasks:['agency'], reason:'โครงการสมมติ', privacy_acknowledged:true };
async function identity(request: APIRequestContext, suffix: string, submitted = false) {
  const email = `followup-${suffix}-${Date.now()}@example.test`, password='Synthetic-followup-12!';
  await request.post(`${auth}/signup`, { data:{email,password} });
  const outbox=JSON.parse(await readFile('.local/hosted-test-simulation/auth-outbox.json','utf8'));
  const token=outbox.findLast((r:{email:string})=>r.email===email).token;
  const session=await(await request.post(`${auth}/verify`,{data:{email,token,type:'email'}})).json();
  const headers={Authorization:`Bearer ${session.access_token}`};
  const account=await(await request.get(`${api}/v1/me`,{headers})).json();
  if(submitted) expect((await request.post(`${api}/v1/me/access-request`,{headers,data:requestBody})).status()).toBe(200);
  return {email,password,headers,id:account.data.id};
}
async function login(page: Page, email='hub-test-admin@example.test', password='H1-synthetic-only!') {
  await page.goto('/login');
  await expect(page.getByRole('heading',{name:'เข้าสู่ระบบ',exact:true})).toBeVisible();
  await expect(page.locator('.eyebrow')).toContainText('LOCAL H1');
  await page.getByLabel('อีเมล',{exact:true}).fill(email);
  await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password);
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
  await expect(page.getByRole('button',{name:'ออกจากระบบ',exact:true})).toBeVisible();
}

test.describe('Account follow-up on loopback H1',()=>{
  test.skip(process.env.HUB_HOSTED_TEST_SIMULATION!=='1','Loopback only');
  test.use({baseURL:'http://127.0.0.1:3001'});
  test.beforeEach(async({page})=>{
    await page.route('**/*',route=>['http:','https:'].includes(new URL(route.request().url()).protocol)&&new URL(route.request().url()).hostname!=='127.0.0.1'?route.abort():route.continue());
  });

  test('Latin Google prefill is a placeholder; field errors preserve text and phone validity matches API',async({page})=>{
    await page.route('**/auth/v1/authorize?**',route=>{const url=new URL(route.request().url());url.searchParams.set('login_hint',`latin-${Date.now()}@example.test`);return route.continue({url:url.href});});
    await page.goto('/login');await page.getByRole('button',{name:'เข้าสู่ระบบด้วย Google'}).click();
    const name=page.getByLabel('ชื่อและนามสกุลภาษาไทย'),phone=page.getByLabel('เบอร์โทรศัพท์ที่ทำงาน');
    await expect(name).toHaveValue('');await expect(name).toHaveAttribute('placeholder','Synthetic Google User');
    await expect(page.getByText('กรอกชื่อและนามสกุลภาษาไทย',{exact:true})).toBeVisible();
    await name.fill('Latin Only');await phone.fill('02+000000');
    await page.getByRole('button',{name:'ส่งคำขอ',exact:true}).click();
    await expect(page.locator('.account-page').getByRole('alert')).toBeFocused();
    for(const field of ['display_name_th','phone','team','requested_tasks','reason','privacy_acknowledged']) await expect(page.locator(`#${field}-error`)).toBeVisible();
    await expect(name).toHaveValue('Latin Only');await expect(phone).toHaveValue('02+000000');
    await page.screenshot({path:'artifacts/accounts-field-errors.png',fullPage:true});
    for(const [value,valid] of [['+66 (02) 123-4567',true],['02000000',true],['+'+'0'.repeat(30),true],['02+000000',false],['++02000000',false],['0200000',false],['0'.repeat(31),false],['๐๒๐๐๐๐๐๐',false]] as const) {
      await phone.fill(value);
      expect(await phone.evaluate((input:HTMLInputElement)=>input.validity.valid)).toBe(valid);
      const result=await page.request.post('/api/hub/v1/me/access-request',{headers:{Origin:'http://127.0.0.1:3001'},data:{...requestBody,phone:value}});
      expect(result.status()).toBe(valid?200:422);
    }
    await expect(name).toHaveValue('Latin Only');
    await page.reload();await expect(page.locator('.account-summary')).toContainText('Google');
  });

  test('verification hint is uniform and an unconfirmed password signup cannot sign in',async({page})=>{
    const email=`unconfirmed-${Date.now()}@example.test`,password='Synthetic-password-12!';
    await page.request.post(`${auth}/signup`,{data:{email,password}});
    const outbox=JSON.parse(await readFile('.local/hosted-test-simulation/auth-outbox.json','utf8'));
    const wrong=outbox.findLast((r:{email:string})=>r.email===email).token==='999999'?'888888':'999999';
    expect((await page.request.post(`${auth}/token?grant_type=password`,{data:{email,password}})).status()).toBe(400);
    await page.goto('/signup/verify');
    await expect(page.getByText('ถ้าไม่ได้รับรหัสภายในไม่กี่นาที อีเมลนี้อาจมีบัญชีอยู่แล้ว ลองเข้าสู่ระบบด้วย Google หรือใช้ลืมรหัสผ่าน')).toBeVisible();
    for(const address of [email,'missing-followup@example.test']) {
      await page.getByLabel('อีเมล',{exact:true}).fill(address);await page.getByLabel('รหัส 6 หลัก').fill(wrong);
      await page.getByRole('button',{name:'ยืนยันรหัส',exact:true}).click();
      await expect(page.getByRole('status')).toHaveText('รหัสไม่ถูกต้อง หมดอายุ หรือเกินจำนวนครั้ง กรุณาตรวจรหัสหรือขอใหม่');
    }
  });

  test('submitted counts, agency gates, rejection and reopen history',async({page,browser})=>{
    const pending=await identity(page.request,'pending',true), draft=await identity(page.request,'draft');
    await login(page);await page.goto('/admin/accounts');
    const data=await(await page.request.get('/api/hub/v1/admin/accounts')).json();
    const count=data.data.items.filter((a:{status:string;privacy_acknowledged_at:string})=>a.status==='PENDING'&&a.privacy_acknowledged_at).length;
    await expect(page.getByRole('tab',{name:`คำขอรออนุมัติ (${count})`,exact:true})).toBeVisible();
    await expect(page.getByLabel('บัญชีรออนุมัติ')).toHaveText(String(count));
    await page.getByLabel('ค้นหาชื่อ อีเมล บริษัท หรือทีม').fill(draft.email);
    const unsubmitted=page.getByRole('region',{name:'ยังไม่ส่งคำขอ'});
    await expect(unsubmitted.getByRole('button',{name:/อนุมัติ/})).toHaveCount(0);
    await expect(unsubmitted).toContainText('อีเมลและรหัสผ่าน');
    await page.getByLabel('ค้นหาชื่อ อีเมล บริษัท หรือทีม').fill(pending.email);
    const row=page.getByRole('article').filter({hasText:pending.email});
    await expect(row.getByRole('button',{name:/^อนุมัติเป็น/})).toBeDisabled();
    await row.getByRole('button',{name:'ปฏิเสธ',exact:true}).click();
    await expect(row.getByText('ผู้ขอจะเห็นข้อความนี้')).toBeVisible();
    await expect(row.getByRole('button',{name:'ยืนยันปฏิเสธ'})).toBeDisabled();
    await row.getByLabel('เหตุผลที่ปฏิเสธ').fill('กรุณาระบุโครงการเพิ่มเติม');
    await row.getByRole('button',{name:'ยืนยันปฏิเสธ'}).click();await expect(row).toHaveCount(0);
    const applicant=await browser.newPage({baseURL:'http://127.0.0.1:3001'});
    await login(applicant,pending.email,pending.password);await expect(applicant.getByText('เหตุผลจากผู้ดูแล: กรุณาระบุโครงการเพิ่มเติม')).toBeVisible();
    await page.getByRole('tab',{name:'ผู้ใช้ทั้งหมด'}).click();
    await page.getByRole('row').filter({hasText:pending.email}).getByRole('button',{name:'จัดการ'}).click();
    const panel=page.getByRole('dialog');
    await panel.getByLabel('บันทึกสำหรับผู้ดูแล (ไม่บังคับ)').fill('เปิดให้แก้ไขแล้ว');await panel.getByRole('button',{name:'เปิดรับคำขออีกครั้ง'}).click();
    await expect(panel.getByText('เหตุผลที่ปฏิเสธก่อนหน้า: กรุณาระบุโครงการเพิ่มเติม')).toBeVisible();
    await page.screenshot({path:'artifacts/accounts-reopen-history.png',fullPage:true});
    await panel.getByRole('button',{name:'ปิด',exact:true}).click();
    await applicant.reload();await expect(applicant.getByLabel('ทีม / ฝ่าย')).toHaveValue(requestBody.team);
    await applicant.getByLabel('เหตุผล / โครงการที่รับผิดชอบ').fill('โครงการสมมติเพิ่มเติม');
    await applicant.getByLabel('รับทราบประกาศความเป็นส่วนตัว').check();await applicant.getByRole('button',{name:'ส่งคำขอ',exact:true}).click();
    await expect(applicant.getByRole('heading',{name:'รออนุมัติ',exact:true})).toBeVisible();
    await page.reload();await page.getByLabel('ค้นหาชื่อ อีเมล บริษัท หรือทีม').fill(pending.email);
    await row.getByLabel('รหัสเอเจนซี').selectOption('KIN');
    await page.route('**/api/hub/v1/admin/accounts/*/decision',route=>route.continue({postData:JSON.stringify({...route.request().postDataJSON(),agency_code:'NOTREAL'})}),{times:1});
    await row.getByRole('button',{name:/^อนุมัติเป็น/}).click();await expect(row.getByRole('alert')).toHaveText('กรุณาเลือกรหัสเอเจนซีที่ถูกต้องและยังใช้งานอยู่');
    await row.getByRole('button',{name:/^อนุมัติเป็น/}).click();await expect(row).toHaveCount(0);
    await page.getByRole('tab',{name:'ผู้ใช้ทั้งหมด'}).click();await page.getByRole('row').filter({hasText:pending.email}).getByRole('button',{name:'จัดการ'}).click();
    await panel.getByLabel('รหัสเอเจนซี').selectOption('');await expect(panel.getByRole('button',{name:'บันทึก',exact:true})).toBeDisabled();
    await applicant.close();
  });

  test('stale reload keeps typed rejection text and agency choice',async({page})=>{
    const applicant=await identity(page.request,'stale',true);
    await login(page);await page.goto('/admin/accounts');await page.getByLabel('ค้นหาชื่อ อีเมล บริษัท หรือทีม').fill(applicant.email);
    const row=page.getByRole('article').filter({hasText:applicant.email});
    await row.getByLabel('รหัสเอเจนซี').selectOption('KIN');await row.getByRole('button',{name:'ปฏิเสธ',exact:true}).click();
    await row.getByLabel('เหตุผลที่ปฏิเสธ').fill('รอตรวจคำขอฉบับใหม่');
    expect((await page.request.patch(`${api}/v1/me/access-request`,{headers:applicant.headers,data:{...requestBody,reason:'แก้ไขโครงการหลังเปิดหน้าตรวจ'}})).status()).toBe(200);
    await row.getByRole('button',{name:'ยืนยันปฏิเสธ'}).click();
    await expect(row.getByRole('alert')).toContainText('ข้อมูลเปลี่ยนแล้ว');
    await row.getByRole('button',{name:'โหลดข้อมูลล่าสุด'}).click();
    await expect(row).toContainText('แก้ไขโครงการหลังเปิดหน้าตรวจ');
    await expect(row.getByLabel('เหตุผลที่ปฏิเสธ')).toHaveValue('รอตรวจคำขอฉบับใหม่');
    await expect(row.getByLabel('รหัสเอเจนซี')).toHaveValue('KIN');
  });

  test('self is read-only and the last active admin cannot be removed',async({page})=>{
    await login(page);await page.goto('/admin/accounts');await page.getByRole('tab',{name:'ผู้ใช้ทั้งหมด'}).click();
    await page.getByLabel('ค้นหาชื่อ อีเมล บริษัท หรือทีม').fill('hub-test-admin@example.test');
    const row=page.getByRole('row').filter({hasText:'hub-test-admin@example.test'});await expect(row.getByText('คุณ',{exact:true})).toBeVisible();
    const opener=row.getByRole('button',{name:'จัดการ'});await opener.click();const panel=page.getByRole('dialog');
    await expect(panel.getByText('นี่คือบัญชีของคุณ')).toBeVisible();
    await expect(panel.getByRole('radio',{name:/ผู้แก้ไขข้อมูล/})).toBeDisabled();
    await expect(panel.getByRole('button',{name:'บันทึก',exact:true})).toHaveCount(0);
    await page.screenshot({path:'artifacts/accounts-manage-self.png',fullPage:false});
    await expect(panel.getByText('ต้องเหลือผู้ดูแลระบบอย่างน้อย 1 คน')).toBeVisible();
    await page.screenshot({path:'artifacts/accounts-manage-last-admin.png',fullPage:false});
    await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(opener).toBeFocused();
  });
});
