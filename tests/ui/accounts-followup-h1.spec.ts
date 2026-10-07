import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const auth = 'http://127.0.0.1:54329/auth/v1';
const api = 'http://127.0.0.1:8001';
const requestBody = { display_name_th:'ผู้สมัคร ทดสอบเพิ่มเติม', phone:'020000000', team:'ทีมสมมติ', requested_tasks:['agency'], reason:'โครงการสมมติ', privacy_acknowledged:true };
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

  test('submitted counts match, agency gates and rejection/reopen history work through the admin page',async({page,browser})=>{
    const pending=await identity(page.request,'pending',true), draft=await identity(page.request,'draft');
    await login(page);await page.goto('/admin/accounts');
    const data=await(await page.request.get('/api/hub/v1/admin/accounts')).json();
    const count=data.data.items.filter((a:{status:string;privacy_acknowledged_at:string})=>a.status==='PENDING'&&a.privacy_acknowledged_at).length;
    await expect(page.getByRole('button',{name:`รออนุมัติ (${count})`,exact:true})).toBeVisible();
    await expect(page.getByLabel('บัญชีรออนุมัติ')).toHaveText(String(count));
    await page.getByLabel('ค้นหาชื่อ อีเมล หรือทีม').fill(draft.email);
    const unsubmitted=page.getByRole('region',{name:'ยังไม่ส่งคำขอ'});
    await unsubmitted.locator('summary').first().click();
    await expect(unsubmitted.getByRole('button',{name:'อนุมัติ',exact:true})).toHaveCount(0);
    await expect(unsubmitted).toContainText('อีเมลและรหัสผ่าน');
    await page.getByLabel('ค้นหาชื่อ อีเมล หรือทีม').fill(pending.email);
    let row=page.locator('details.registry-panel').filter({hasText:pending.email});await row.locator('summary').first().click();
    await expect(row.getByRole('button',{name:'อนุมัติ',exact:true})).toBeDisabled();
    await expect(row.getByText('ผู้ขอจะเห็นข้อความนี้')).toBeVisible();
    await row.getByRole('button',{name:'ปฏิเสธ',exact:true}).click();
    await expect(row.getByRole('alert')).toHaveText('กรุณาระบุเหตุผลที่ปฏิเสธ');
    await row.getByLabel('รหัสเอเจนซี').selectOption('KIN');
    await expect(row.getByRole('button',{name:'อนุมัติ',exact:true})).toBeEnabled();
    await row.getByLabel('เหตุผลการตัดสินใจ').fill('กรุณาระบุโครงการเพิ่มเติม');
    await row.getByRole('button',{name:'ปฏิเสธ',exact:true}).click();await expect(row).toHaveCount(0);
    const applicant=await browser.newPage({baseURL:'http://127.0.0.1:3001'});
    await login(applicant,pending.email,pending.password);await expect(applicant.getByText('เหตุผลจากผู้ดูแล: กรุณาระบุโครงการเพิ่มเติม')).toBeVisible();
    await page.getByRole('button',{name:/^ปฏิเสธ \(/}).click();
    row=page.locator('details.registry-panel').filter({hasText:pending.email});await row.locator('summary').first().click();
    await row.getByLabel('เหตุผลการตัดสินใจ').fill('เปิดให้แก้ไขแล้ว');await row.getByRole('button',{name:'เปิดรับคำขออีกครั้ง'}).click();await expect(row).toHaveCount(0);
    await page.getByRole('button',{name:/^รออนุมัติ \(/}).click();
    row=page.getByRole('region',{name:'ยังไม่ส่งคำขอ'}).locator('details.registry-panel');await row.locator('summary').first().click();
    await expect(row.getByRole('button',{name:'อนุมัติ',exact:true})).toHaveCount(0);
    await row.getByText('ประวัติ',{exact:true}).click();await expect(row.getByText('เหตุผลที่ปฏิเสธก่อนหน้า: กรุณาระบุโครงการเพิ่มเติม')).toBeVisible();
    await page.screenshot({path:'artifacts/accounts-reopen-history.png',fullPage:true});
    await applicant.reload();await expect(applicant.getByLabel('ทีม / บริษัทเอเจนซี')).toHaveValue(requestBody.team);
    await applicant.getByLabel('เหตุผล / โครงการที่รับผิดชอบ').fill('โครงการสมมติเพิ่มเติม');
    await applicant.getByLabel('รับทราบประกาศความเป็นส่วนตัว').check();await applicant.getByRole('button',{name:'ส่งคำขอ',exact:true}).click();
    await expect(applicant.getByRole('heading',{name:'รออนุมัติ',exact:true})).toBeVisible();
    await page.reload();row=page.locator('details.registry-panel').filter({hasText:pending.email});await row.locator('summary').first().click();
    await row.getByLabel('รหัสเอเจนซี').selectOption('KIN');
    await page.route('**/api/hub/v1/admin/accounts/*/decision',route=>route.continue({postData:JSON.stringify({...route.request().postDataJSON(),agency_code:'NOTREAL'})}),{times:1});
    await row.getByRole('button',{name:'อนุมัติ',exact:true}).click();await expect(row.getByRole('alert')).toHaveText('กรุณาเลือกรหัสเอเจนซีที่ถูกต้องและยังใช้งานอยู่');
    await row.getByRole('button',{name:'อนุมัติ',exact:true}).click();await expect(row).toHaveCount(0);
    await page.getByRole('button',{name:/^ใช้งานอยู่ \(/}).click();row=page.locator('details.registry-panel').filter({hasText:pending.email});await row.locator('summary').first().click();
    await row.getByLabel('รหัสเอเจนซี').selectOption('');await expect(row.getByRole('button',{name:'เปลี่ยนบทบาท'})).toBeDisabled();
    await applicant.close();
  });

  test('a request edited after admin review returns a stale error without losing the decision note',async({page})=>{
    const applicant=await identity(page.request,'stale',true);
    await login(page);await page.goto('/admin/accounts');
    await page.getByLabel('ค้นหาชื่อ อีเมล หรือทีม').fill(applicant.email);
    const row=page.locator('details.registry-panel');await row.locator('summary').first().click();
    await row.getByLabel('รหัสเอเจนซี').selectOption('KIN');
    await row.getByLabel('เหตุผลการตัดสินใจ').fill('รอตรวจคำขอฉบับใหม่');
    expect((await page.request.patch(`${api}/v1/me/access-request`,{headers:applicant.headers,data:{...requestBody,reason:'แก้ไขโครงการหลังเปิดหน้าตรวจ'}})).status()).toBe(200);
    await row.getByRole('button',{name:'อนุมัติ',exact:true}).click();
    await expect(row.getByRole('alert')).toHaveText('ข้อมูลเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก');
    await expect(row.getByLabel('เหตุผลการตัดสินใจ')).toHaveValue('รอตรวจคำขอฉบับใหม่');
    await expect(row.getByLabel('รหัสเอเจนซี')).toHaveValue('KIN');
  });

  test('self-decision and last-admin errors are specific and retain the typed note',async({page})=>{
    await login(page);await page.goto('/admin/accounts');await page.getByRole('button',{name:/^ใช้งานอยู่ \(/}).click();
    await page.getByLabel('ค้นหาชื่อ อีเมล หรือทีม').fill('hub-test-admin@example.test');
    const row=page.locator('details.registry-panel');await row.locator('summary').first().click();
    await row.getByLabel('เหตุผลการตัดสินใจ').fill('ข้อความที่ยังต้องอยู่');
    page.once('dialog',d=>d.accept());await row.getByRole('button',{name:'เปลี่ยนบทบาท'}).click();
    await expect(row.getByRole('alert')).toHaveText('ไม่สามารถตัดสินใจหรือเปลี่ยนสิทธิ์ของบัญชีตนเองได้');
    await row.getByRole('combobox',{name:'บทบาท',exact:true}).selectOption('viewer');await row.getByRole('button',{name:'เปลี่ยนบทบาท'}).click();
    await expect(row.getByRole('alert')).toHaveText('ต้องเหลือผู้ดูแลระบบที่ใช้งานอยู่ อย่างน้อยหนึ่งคน');
    await expect(row.getByLabel('เหตุผลการตัดสินใจ')).toHaveValue('ข้อความที่ยังต้องอยู่');
  });
});
