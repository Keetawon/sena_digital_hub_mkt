import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';

// The H1 runner has stopped only its own API. Auth and Next remain real loopback processes.
let mode: 'ok' | '500' | 'network' | 'timeout' | '401' | '403' | 'pending' = 'ok';
let meReads=0;
const questions={tab:'questions',label_th:'คำถามที่รอคำตอบ',nav_group:null,levels:['view'],special_actions:[],special_labels:{},separate_edit_approve:false,agency_visible:false,sensitivity:'internal',rollout_state:'MIGRATED',guards_ready:true};
const catalog={tabs:[questions],templates:[{code:'admin',version:1,label_th:'ผู้ดูแลระบบ',tabs:{questions:['view']}}],catalog_digest:'0'.repeat(64)};
const server=createServer((req,res)=>{
  if(req.url==='/v1/me')meReads++;
  if(mode==='network') return req.socket.destroy();
  if(mode==='timeout') return;
  const status=['500','401','403'].includes(mode)?Number(mode):200;
  res.writeHead(status,{'Content-Type':'application/json'});
  if(status!==200) return res.end(JSON.stringify({error:{message:'บัญชียังไม่ได้รับอนุมัติ'}}));
  const active=mode!=='pending';
  const capabilities={tabs:active?{questions:{view:true,edit:false,approve:false}}:{},special_actions:{},can_manage_users:active,agency_registry:false,published_consumer:active,locked_tabs:[],template:active?'admin':null,template_version:active?1:null,catalog:[questions]};
  const data=req.url==='/v1/me'?{id:'synthetic',status:active?'ACTIVE':'PENDING',role:active?'admin':null,hub_role:active?'admin':null,agency:null,can_manage_users:active,capabilities,pending_count:0,
      email:'outage@example.test',display_name_th:'ผู้ทดสอบ ระบบขัดข้อง',phone:'',team:'',requested_tasks:[],reason:'',privacy_acknowledged_at:null,company_type:null,company_name:null,position:null,decision_note:'',agency_code:null,anonymised_at:null,updated_at:'2026-10-09T00:00:00Z'}:
    req.url==='/v1/admin/accounts'?{items:[],events:[],agencies:[],actor_id:'synthetic'}:
    req.url==='/v1/admin/account-invites'?{items:[],login_url:`${process.env.HUB_ADMIN_ORIGIN}/login`}:
    req.url==='/v1/admin/permissions/catalog'?catalog:[];
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
  test.use({baseURL:process.env.HUB_ADMIN_ORIGIN!});
  test.beforeAll(async()=>{server.listen(Number(new URL(process.env.HUB_API_URL!).port),'127.0.0.1');await once(server,'listening');});
  test.afterAll(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  test.beforeEach(async({page})=>{await page.route('**/*',route=>['http:','https:'].includes(new URL(route.request().url()).protocol)&&new URL(route.request().url()).hostname!=='127.0.0.1'?route.abort():route.continue());});
  test('each account response reads authority once and the next request sees a status change',async({page})=>{
    await login(page);await page.waitForLoadState('networkidle');
    await page.goto('about:blank'); // Stop page polling; keep its synthetic session cookie.
    let before=meReads;
    const active=await page.request.get('/api/hub/v1/me');
    expect(active.status()).toBe(200);expect((await active.json()).data.status).toBe('ACTIVE');
    expect(active.headers()['cache-control']).toContain('no-store');expect(meReads-before).toBe(1);
    before=meReads;
    expect((await page.request.get('/api/hub/v1/admin/accounts')).status()).toBe(200);
    expect(meReads-before).toBe(0); // The actual upstream request owns its account check.
    mode='pending';before=meReads;
    const pending=await page.request.get('/api/hub/v1/me');
    expect(pending.status()).toBe(200);expect((await pending.json()).data.status).toBe('PENDING');
    expect(meReads-before).toBe(1);mode='ok';
  });
  test('verified page projection starts the workspace without a blocking browser account lookup',async({page})=>{
    await login(page);await page.goto('about:blank');
    let browserReads=0;
    await page.route('**/api/hub/v1/me',route=>{browserReads++;return route.abort();});
    await page.goto('/admin/accounts');
    await expect(page.getByRole('heading',{name:'ผู้ใช้และสิทธิ์',exact:true})).toBeVisible();
    await expect(page.getByLabel('ค้นหาชื่อ อีเมล บริษัท หรือทีม')).toBeVisible();
    expect(browserReads).toBe(0);
    await page.unroute('**/api/hub/v1/me');
    mode='pending';
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('heading',{name:'ไม่มีสิทธิ์เข้าถึงหน้านี้',exact:true})).toBeVisible();
    mode='ok';
  });
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
    await expect(page).toHaveURL(`${process.env.HUB_ADMIN_ORIGIN}/questions?keep=this`);
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
    await expect(page).toHaveURL(`${process.env.HUB_ADMIN_ORIGIN}/questions`);
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
