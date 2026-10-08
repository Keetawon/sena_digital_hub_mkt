import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';

// The H1 runner has stopped only its own API. Auth and Next remain real loopback processes.
let mode: 'ok' | '500' | 'network' | 'timeout' | '401' | '403' | 'pending' = 'ok';
const server=createServer((req,res)=>{
  if(mode==='network') return req.socket.destroy();
  if(mode==='timeout') return;
  const status=['500','401','403'].includes(mode)?Number(mode):200;
  res.writeHead(status,{'Content-Type':'application/json'});
  if(status!==200) return res.end(JSON.stringify({error:{message:'บัญชียังไม่ได้รับอนุมัติ'}}));
  const data=req.url==='/v1/me'?{id:'synthetic',status:mode==='pending'?'PENDING':'ACTIVE',role:'admin',agency:null}:
    req.url==='/v1/admin/accounts'?{items:[],events:[],agencies:[],actor_id:'synthetic'}:
    req.url==='/v1/admin/account-invites'?{items:[],login_url:'http://127.0.0.1:3001/login'}:[];
  res.end(JSON.stringify({data}));
});
async function login(page:Page) {
  mode='ok';await page.goto('/login?next=/admin/accounts');
  await page.getByLabel('อีเมล',{exact:true}).fill('hub-test-admin@example.test');
  await page.getByLabel('รหัสผ่าน',{exact:true}).fill('H1-synthetic-only!');
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
  await expect(page.getByRole('heading',{name:'ผู้ใช้และสิทธิ์',exact:true})).toBeVisible();
}

test.describe('Upstream availability is distinct from authentication',()=>{
  test.skip(process.env.HUB_ACCOUNT_OUTAGE_TEST!=='1','Owned loopback upstream only');
  test.use({baseURL:'http://127.0.0.1:3001'});
  test.beforeAll(async()=>{server.listen(8001,'127.0.0.1');await once(server,'listening');});
  test.afterAll(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  test.beforeEach(async({page})=>{await page.route('**/*',route=>['http:','https:'].includes(new URL(route.request().url()).protocol)&&new URL(route.request().url()).hostname!=='127.0.0.1'?route.abort():route.continue());});
  for(const failure of ['500','network','timeout'] as const) test(`${failure}: proxy API returns 503, edits survive, page shows retry without redirect`,async({page})=>{
    test.setTimeout(45000);await login(page);
    await page.getByLabel('ค้นหาชื่อ อีเมล บริษัท หรือทีม').fill('ข้อความยังไม่บันทึก');
    mode=failure;
    const started=Date.now();
    const response=await page.evaluate(async()=>{const r=await fetch('/api/hub/v1/me');return {status:r.status,body:await r.json()};});
    expect(response.status).toBe(503);expect(response.body.error.message).toBe('ระบบขัดข้องชั่วคราว กรุณาลองใหม่');
    if(failure==='timeout') expect(Date.now()-started).toBeGreaterThanOrEqual(9000);
    await expect(page.getByLabel('ค้นหาชื่อ อีเมล บริษัท หรือทีม')).toHaveValue('ข้อความยังไม่บันทึก');
    await expect(page.getByRole('link',{name:'เข้าสู่ระบบอีกครั้งในแท็บใหม่'})).toHaveCount(0);
    const cookiesBefore=await page.context().cookies();
    const result=await page.goto('/questions?keep=this');expect(result?.status()).toBe(503);
    await expect(page).toHaveURL('http://127.0.0.1:3001/questions?keep=this');
    await expect(page.getByRole('heading',{name:'ระบบขัดข้องชั่วคราว กรุณาลองใหม่'})).toBeVisible();
    expect((await page.context().cookies()).map(c=>c.name)).toEqual(cookiesBefore.map(c=>c.name));
    mode='ok';await page.getByRole('link',{name:'ลองใหม่',exact:true}).click();
    await expect(page.getByRole('heading',{name:'ระบบขัดข้องชั่วคราว กรุณาลองใหม่'})).toHaveCount(0);
  });
  test('OAuth callback outage keeps the new session and retries without exchanging the code twice',async({page})=>{
    mode='ok';await page.goto('/login?next=/questions');
    await page.route('**/auth/v1/authorize?**',route=>{const url=new URL(route.request().url());url.searchParams.set('login_hint',`outage-google-${Date.now()}@example.test`);return route.continue({url:url.href});});
    mode='500';await page.getByRole('button',{name:'เข้าสู่ระบบด้วย Google'}).click();
    await expect(page.getByRole('heading',{name:'ระบบขัดข้องชั่วคราว กรุณาลองใหม่'})).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/callback\?/);
    await expect(page.getByRole('link',{name:'ลองใหม่',exact:true})).toHaveAttribute('href','/questions');
    mode='ok';await page.getByRole('link',{name:'ลองใหม่',exact:true}).click();
    await expect(page).toHaveURL('http://127.0.0.1:3001/questions');
    await expect(page.getByRole('button',{name:'ออกจากระบบ',exact:true})).toBeVisible();
  });

  test('401 uses hosted wording and returns to sign-in; 403/pending goes to the request',async({page})=>{
    await login(page);mode='401';
    const denied=await page.request.get('/api/hub/v1/me');expect(denied.status()).toBe(401);
    expect((await denied.json()).error.message).toBe('กรุณาเข้าสู่ระบบ');
    await page.goto('/questions');await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByRole('heading',{name:'เข้าสู่ระบบ',exact:true})).toBeVisible();
    for(const value of ['403','pending'] as const) {
      mode=value;await page.goto('/questions');await expect(page).toHaveURL(/\/account\/request$/);
      expect((await page.request.get('/api/hub/v1/me')).status()).toBe(value==='403'?403:200);
    }
  });
});
