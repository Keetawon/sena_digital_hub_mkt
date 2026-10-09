import { expect, test, type Page } from '@playwright/test';

const actor='71000000-0000-4000-8000-000000000001',target='71000000-0000-4000-8000-000000000002',pending='71000000-0000-4000-8000-000000000003';
const labels:Record<string,string>={projects:'โครงการ',brands:'แบรนด์',promotions:'โปรโมชัน',releases:'ชุดเผยแพร่',knowledge:'ความรู้',registry:'ทะเบียนแคมเปญ',finance:'งบการตลาด',actuals:'ยอดใช้จริง',documents:'ติดตามเอกสาร',archive:'คลังเอกสาร',exceptions:'ข้อยกเว้น',questions:'คำถาม'};
type Access={tabs:Record<string,string[]>;template:{code:string;version:number}|null;customised:boolean;can_manage_users:boolean};
function access(code='editor',manager=false):Access {const tabs:Record<string,string[]>=code==='viewer'?{projects:['view'],brands:['view'],questions:['view']}:code==='publisher'?{projects:['view','approve'],brands:['view','approve'],questions:['view']}:code==='agency'?{registry:['view']}:{projects:['view','edit'],brands:['view','edit'],knowledge:['view','edit'],questions:['view']};if(code==='admin'){tabs.brands.push('brands.manage_catalog');tabs.finance=['view','edit','approve','finance.review_identifiers_corrections'];tabs.archive=['view','edit','approve','archive.legal_hold'];}return{tabs,template:{code,version:1},customised:false,can_manage_users:manager};}
function account(id:string,name:string,code='editor',manager=false){return{id,email:`${id}@example.test`,display_name_th:name,phone:'020000000',sign_in_method:'email',company_type:'SENA',company_name:null,position:'ผู้ทดสอบ',team:'ทีมสมมติ',requested_tasks:['edit'],reason:'ตรวจข้อมูลสมมติ',privacy_acknowledged_at:'2026-10-09T00:00:00Z',status:'ACTIVE',hub_role:code,can_manage_users:manager,agency_code:null as string|null,decision_note:'',updated_at:'2026-10-09T00:00:00Z',anonymised_at:null,access:access(code,manager)};}
async function setup(page:Page,{last=false,newTab=false,stale=false,newVersion=false,agencyHistory=false}={}){
  await page.context().addCookies([{name:'sena_local_persona',value:'admin',url:'http://127.0.0.1:3000'}]);
  const items=[account(actor,'ผู้ดูแล สมมติ','admin',!last),account(target,'สมชาย ทดสอบ',last?'viewer':'editor',last),{...account(pending,'ผู้ขอ ทดสอบ'),status:'PENDING',hub_role:null,access:{tabs:{},template:null,customised:false,can_manage_users:false} as Access}];
  if(agencyHistory)items[1]={...items[1],hub_role:'agency',agency_code:'COMBAY',access:access('agency')};
  const permission_events=agencyHistory?[{id:'synthetic-agency-history',account_id:target,actor_id:actor,action:'AGENCY_CODE',created_at:'2026-10-09T01:00:00Z',before_value:{agency_code:'KIN'},after_value:{agency_code:'COMBAY',note:'แก้รหัสตามข้อมูลสมมติ'}}]:[];
  const tabs=Object.entries(labels).map(([tab,label_th])=>({tab,label_th,nav_group:'content',levels:['questions','actuals'].includes(tab)?['view']:tab==='releases'?['view','approve']:['registry','documents','exceptions'].includes(tab)?['view','edit']:['view','edit','approve'],special_actions:tab==='brands'?['brands.manage_catalog']:tab==='finance'?['finance.review_identifiers_corrections']:tab==='archive'?['archive.legal_hold']:[],special_labels:{'brands.manage_catalog':'จัดการทะเบียนแบรนด์','finance.review_identifiers_corrections':'ตรวจเลขอ้างอิงและรายการแก้ไข','archive.legal_hold':'กำหนดการเก็บรักษาเอกสาร'},separate_edit_approve:['projects','brands','promotions','releases'].includes(tab),rollout_state:'MIGRATED',guards_ready:true,agency_visible:tab==='registry',sensitivity:'internal',new_for_actor:false}));
  if(newTab)tabs.push({...tabs[0],tab:'synthetic_feature',label_th:'แท็บสมมติใหม่',levels:['view','edit'],special_actions:[],separate_edit_approve:false,new_for_actor:true});
  const names:Record<string,string>={viewer:'ผู้อ่านข้อมูล',editor:'ผู้แก้ไขข้อมูล',publisher:'Manager — อนุมัติและเผยแพร่',admin:'ผู้ดูแลระบบ',online_staff:'ทีมออนไลน์',agency:'เอเจนซี'};
  const catalog={tabs,templates:Object.entries(names).map(([code,label_th])=>({code,label_th,version:1,tabs:access(code).tabs})),catalog_digest:'synthetic-catalog-digest'};
  if(newVersion)catalog.templates.push({code:'editor',label_th:names.editor,version:2,tabs:{...access('editor').tabs,projects:['view']}});
  const calls:{path:string;body:Record<string,any>}[]=[];let staleOnce=stale;let previewBody:Record<string,any>|null=null;
  await page.route('**/api/hub/v1/admin/**',async route=>{
    const path=new URL(route.request().url()).pathname.replace('/api/hub/v1/admin/','');
    const body=route.request().method()==='POST'?route.request().postDataJSON():null;
    if(body)calls.push({path,body});
    const respond=(data:unknown)=>route.fulfill({json:{data}});
    if(path==='accounts')return respond({items,events:[],permission_events,actor_id:actor,agencies:[{code:'KIN',label_th:'เอเจนซีสมมติ'},{code:'COMBAY',label_th:'เอเจนซีสมมติสอง'}]});
    if(path==='permissions/catalog')return respond(catalog);
    if(path==='account-invites')return body?respond({id:'synthetic-invite'}):respond({items:[],login_url:'http://127.0.0.1:3000/login'});
    if(path===`accounts/${target}/permissions`){
      if(staleOnce){staleOnce=false;items[1].updated_at='2026-10-09T01:00:00Z';return route.fulfill({status:409,json:{error:{code:'conflict',message:'ข้อมูลถูกเปลี่ยนแล้ว กรุณาโหลดใหม่'}}});}
      items[1].access={tabs:body.tabs,template:body.template,can_manage_users:body.can_manage_users,customised:true};items[1].can_manage_users=body.can_manage_users;items[1].updated_at='2026-10-09T02:00:00Z';return respond({account_id:target,access:items[1].access,updated_at:items[1].updated_at,changed:true});
    }
    if(path===`accounts/${pending}/decision`){items[2]={...items[2],status:'ACTIVE',hub_role:body.template.code,access:{tabs:body.tabs,template:body.template,can_manage_users:body.can_manage_users||false,customised:true},updated_at:'2026-10-09T02:00:00Z'};return respond(items[2]);}
    if(path==='permissions/preview'){previewBody=body;const after=body.change.kind==='template'?access(body.change.template.code):{...items[1].access,tabs:{...items[1].access.tabs,[body.change.tab]:body.change.levels},customised:true};return respond({digest:'synthetic-reviewed-digest',catalog_digest:catalog.catalog_digest,targets:[{account_id:target,display_name_th:items[1].display_name_th,email:items[1].email,updated_at:items[1].updated_at,before:items[1].access,after,changed:true}],excluded:body.selection.account_ids?.includes(actor)?[{account_id:actor,reason:'self'}]:[],change_count:1});}
    if(path==='permissions/apply'){expect(body).toEqual({...previewBody,digest:'synthetic-reviewed-digest',confirmed:true});return respond({changed_count:1,items:[]});}
    if(path==='permissions/notices/synthetic_feature/ack'){catalog.tabs.find(t=>t.tab==='synthetic_feature')!.new_for_actor=false;return respond({tab:'synthetic_feature',acknowledged:true});}
    return route.continue();
  });
  await page.goto('/admin/accounts');await expect(page.getByLabel('ค้นหาชื่อ อีเมล บริษัท หรือทีม')).toBeVisible();return{items,catalog,calls};
}
async function manage(page:Page,id=target){await page.getByRole('tab',{name:'ผู้ใช้ทั้งหมด'}).click();await page.getByRole('row').filter({hasText:`${id}@example.test`}).getByRole('button',{name:'จัดการ'}).click();return page.getByRole('dialog');}

test('template copy stages boxes; special actions need view and editorial edit/approve exclude each other',async({page})=>{
  const state=await setup(page);const panel=await manage(page);
  await expect(panel.getByRole('button',{name:'บันทึก',exact:true})).toBeDisabled();
  await panel.getByLabel('แม่แบบสิทธิ์',{exact:true}).selectOption('publisher:1');await panel.getByRole('button',{name:'ใช้แม่แบบนี้',exact:true}).click();
  await expect(panel.getByRole('checkbox',{name:'โครงการ อนุมัติ',exact:true})).toBeChecked();await expect(panel.getByRole('checkbox',{name:'โครงการ แก้ไข',exact:true})).toBeDisabled();
  await expect(panel.getByLabel('ความแตกต่างของสิทธิ์').first()).toContainText('โครงการ: ดู · แก้ไข → ดู · อนุมัติ');expect(state.calls).toHaveLength(0);
  await panel.getByLabel('แม่แบบสิทธิ์',{exact:true}).selectOption('admin:1');await panel.getByRole('button',{name:'ใช้แม่แบบนี้',exact:true}).click();
  await expect(panel.getByRole('checkbox',{name:'จัดการผู้ใช้และสิทธิ์',exact:true})).not.toBeChecked();await expect(panel.getByRole('checkbox',{name:'จัดการทะเบียนแบรนด์',exact:true})).toBeChecked();
  await panel.getByRole('checkbox',{name:'แบรนด์ ดู',exact:true}).uncheck();await expect(panel.getByRole('checkbox',{name:'แบรนด์ แก้ไข',exact:true})).not.toBeChecked();await expect(panel.getByRole('checkbox',{name:'จัดการทะเบียนแบรนด์',exact:true})).toBeDisabled();
  await panel.getByRole('button',{name:'บันทึก',exact:true}).click();await expect(panel.getByRole('status')).toContainText('ปรับสิทธิ์');
  expect(state.calls[0].body.template).toEqual({code:'admin',version:1});expect(state.calls[0].body.tabs.brands).toEqual([]);expect(state.calls[0].body.can_manage_users).toBe(false);
  await page.keyboard.press('Escape');await expect(page.getByRole('row').filter({hasText:`${target}@example.test`})).toContainText('กำหนดเอง (จาก ผู้ดูแลระบบ)');
  await page.getByLabel('แก้ไขแท็บได้').selectOption('brands');await expect(page.getByRole('row').filter({hasText:`${target}@example.test`})).toHaveCount(0);
});

test('a newer server template does not change pinned boxes until explicitly applied',async({page})=>{
  const state=await setup(page,{newVersion:true});const panel=await manage(page);
  await expect(panel.getByLabel('แม่แบบสิทธิ์',{exact:true})).toHaveValue('editor:2');
  await expect(panel.getByRole('checkbox',{name:'โครงการ แก้ไข',exact:true})).toBeChecked();
  await expect(panel.getByRole('button',{name:'บันทึก',exact:true})).toBeDisabled();
  await panel.getByRole('checkbox',{name:'แบรนด์ แก้ไข',exact:true}).uncheck();
  await panel.getByRole('button',{name:'บันทึก',exact:true}).click();await expect(panel.getByRole('status')).toContainText('ปรับสิทธิ์');
  expect(state.calls[0].body.template).toEqual({code:'editor',version:1});
  expect(state.calls[0].body.tabs.projects).toContain('edit');
  await panel.getByRole('button',{name:'ใช้แม่แบบนี้',exact:true}).click();
  await expect(panel.getByRole('checkbox',{name:'โครงการ แก้ไข',exact:true})).not.toBeChecked();
  await expect(panel.getByRole('checkbox',{name:'แบรนด์ แก้ไข',exact:true})).toBeChecked();
  await expect(panel.getByLabel('ความแตกต่างของสิทธิ์').first()).toContainText('กำหนดเอง (จาก ผู้แก้ไขข้อมูล) · รุ่น 1 → ผู้แก้ไขข้อมูล · รุ่น 2');
  await panel.getByRole('button',{name:'บันทึก',exact:true}).click();await expect.poll(()=>state.calls.length).toBe(2);
  expect(state.calls[1].body.template).toEqual({code:'editor',version:2});
});

test('manager flag requires explicit confirmation independent of template, and self remains read-only',async({page})=>{
  const state=await setup(page);let panel=await manage(page);
  await panel.getByRole('checkbox',{name:'จัดการผู้ใช้และสิทธิ์',exact:true}).check();await expect(panel.getByRole('button',{name:'บันทึก',exact:true})).toBeDisabled();
  await panel.getByRole('checkbox',{name:/ยืนยันให้สิทธิ์ผู้ดูแลระบบ/}).focus();await page.keyboard.press('Space');await panel.getByRole('button',{name:'บันทึก',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('ปรับสิทธิ์');expect(state.calls[0].body).toMatchObject({can_manage_users:true,confirm_manage_users:true,template:{code:'editor',version:1}});
  await page.keyboard.press('Escape');panel=await manage(page,actor);await expect(panel.getByText('นี่คือบัญชีของคุณ')).toBeVisible();await expect(panel.getByLabel('แม่แบบสิทธิ์',{exact:true})).toBeDisabled();await expect(panel.getByRole('checkbox',{name:'โครงการ ดู',exact:true})).toBeDisabled();await expect(panel.getByRole('button',{name:'บันทึก',exact:true})).toHaveCount(0);
});

test('last manager lock follows the independent flag even when the legacy role is viewer',async({page})=>{
  await setup(page,{last:true});const panel=await manage(page);await expect(panel.getByText('ต้องเหลือผู้ดูแลระบบอย่างน้อย 1 คน')).toBeVisible();
  await expect(panel.getByRole('checkbox',{name:'จัดการผู้ใช้และสิทธิ์',exact:true})).toBeChecked();await expect(panel.getByRole('checkbox',{name:'จัดการผู้ใช้และสิทธิ์',exact:true})).toBeDisabled();await expect(panel.getByRole('button',{name:'ระงับบัญชี',exact:true})).toBeDisabled();
  await expect(panel.getByLabel('แม่แบบสิทธิ์',{exact:true})).toBeEnabled();
});

test('fixed agency history shows the actual code correction and admin note',async({page})=>{
  await setup(page,{agencyHistory:true});const panel=await manage(page);
  await expect(panel.getByText(/บัญชีเอเจนซีใช้สิทธิ์คงที่/)).toBeVisible();
  const history=panel.locator('.account-history');
  await expect(history).toContainText('เปลี่ยนรหัสเอเจนซี');
  await expect(history).toContainText('รหัสเอเจนซี: KIN → COMBAY');
  await expect(history).toContainText('แก้รหัสตามข้อมูลสมมติ');
  await expect(history).not.toContainText('ยังไม่มีการเปลี่ยนแปลง');
});

test('custom approval submits one atomic decision with the reviewed grid',async({page})=>{
  const state=await setup(page);const card=page.getByRole('article').filter({hasText:`${pending}@example.test`});await card.getByRole('button',{name:'อนุมัติและปรับสิทธิ์',exact:true}).click();const panel=page.getByRole('dialog');
  await panel.getByRole('checkbox',{name:'แบรนด์ แก้ไข',exact:true}).uncheck();await panel.getByLabel('บันทึกสำหรับผู้ดูแล (ไม่บังคับ)').fill('บันทึกอนุมัติเฉพาะผู้ดูแล');await panel.getByRole('button',{name:'อนุมัติและบันทึกสิทธิ์',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('อนุมัติ');expect(state.calls).toHaveLength(1);expect(state.calls[0].path).toBe(`accounts/${pending}/decision`);expect(state.calls[0].body).toMatchObject({action:'approve',template:{code:'editor',version:1},tabs:{brands:['view']},can_manage_users:false});
});

test('stale save retains checkbox changes and note after authoritative reload',async({page})=>{
  const state=await setup(page,{stale:true});const panel=await manage(page);await panel.getByRole('checkbox',{name:'แบรนด์ แก้ไข',exact:true}).uncheck();await panel.getByLabel('บันทึกสำหรับผู้ดูแล (ไม่บังคับ)').fill('ร่างบันทึกยังอยู่');await panel.getByRole('button',{name:'บันทึก',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('ข้อมูลเปลี่ยนแล้ว');await panel.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click();await expect(panel.getByRole('checkbox',{name:'แบรนด์ แก้ไข',exact:true})).not.toBeChecked();await expect(panel.getByLabel('บันทึกสำหรับผู้ดูแล (ไม่บังคับ)')).toHaveValue('ร่างบันทึกยังอยู่');
  await panel.getByRole('button',{name:'บันทึก',exact:true}).click();await expect(panel.getByRole('status')).toContainText('ปรับสิทธิ์');expect(state.calls[1].body.updated_at).toBe('2026-10-09T01:00:00Z');
});

test('manager revocation removes directory source data and preserves only the authored admin note',async({page})=>{
  await setup(page);const panel=await manage(page);
  const authored='บันทึกที่ฉันพิมพ์เองและยังไม่บันทึก';
  await panel.getByLabel('บันทึกสำหรับผู้ดูแล (ไม่บังคับ)').fill(authored);
  const me=(await (await page.request.get('/api/hub/v1/me')).json()).data;
  me.capabilities={...me.capabilities,can_manage_users:false};me.can_manage_users=false;
  await page.route('**/api/hub/v1/me',route=>route.fulfill({json:{data:me}}));
  const recovery=page.getByRole('complementary',{name:'ข้อความที่คุณกรอก',exact:true});
  await expect.poll(async()=>{await page.evaluate(()=>window.dispatchEvent(new Event('focus')));return recovery.count();}).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'ไม่มีสิทธิ์เข้าถึงหน้านี้',exact:true})).toBeVisible();
  await expect(page.getByText(`${target}@example.test`,{exact:true})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'ตารางผู้ใช้',exact:true})).toHaveCount(0);
  await expect(recovery.getByLabel('บันทึกสำหรับผู้ดูแล (ไม่บังคับ)',{exact:true})).toHaveValue(authored);
  await expect(recovery.getByRole('textbox')).toHaveCount(1);
  await expect(recovery).not.toContainText('สมชาย ทดสอบ');
  await expect(recovery).not.toContainText('ทีมสมมติ');
});

test('batch template review shows exclusions, invalidates on selection change and requires confirmation',async({page})=>{
  const state=await setup(page);await page.getByRole('button',{name:'ปรับสิทธิ์หลายบัญชี',exact:true}).click();const panel=page.getByRole('dialog');
  await panel.getByRole('checkbox',{name:new RegExp(`${target}@example.test`)}).check();await panel.getByRole('checkbox',{name:new RegExp(`${actor}@example.test`)}).check();await panel.getByRole('button',{name:'ดูความแตกต่างก่อนยืนยัน',exact:true}).click();
  await expect(panel.getByRole('region',{name:'ตัวอย่างการปรับสิทธิ์'})).toContainText('บัญชีของคุณ');await expect(panel.getByRole('button',{name:'ใช้กับ 1 คน',exact:true})).toBeDisabled();
  await panel.getByLabel('เลือกกลุ่มด้วย').selectOption('team');await expect(panel.getByRole('region',{name:'ตัวอย่างการปรับสิทธิ์'})).toHaveCount(0);await panel.getByLabel('ทีมที่ต้องการ').selectOption('ทีมสมมติ');await panel.getByRole('button',{name:'ดูความแตกต่างก่อนยืนยัน',exact:true}).click();await panel.getByRole('checkbox',{name:'ยืนยันความแตกต่างของทุกบัญชีที่แสดง'}).check();await panel.getByRole('button',{name:'ใช้กับ 1 คน',exact:true}).click();
  await expect(page.locator('.accounts-feedback[role=status]')).toContainText('ปรับสิทธิ์ 1 คนแล้ว');expect(state.calls.at(-1)?.body.selection).toEqual({kind:'team',team:'ทีมสมมติ'});
});

test('new tab assignment changes only that tab and acknowledgement grants nothing',async({page})=>{
  const state=await setup(page,{newTab:true});const notice=page.getByRole('region',{name:'แท็บใหม่ แท็บสมมติใหม่'});await notice.getByRole('button',{name:'กำหนดสิทธิ์แท็บนี้'}).click();let panel=page.getByRole('dialog');
  await panel.getByLabel('เลือกกลุ่มด้วย').selectOption('template');await panel.getByLabel('แม่แบบเดิม',{exact:true}).selectOption('editor');await panel.getByRole('checkbox',{name:'แท็บสมมติใหม่ ดู',exact:true}).check();await panel.getByRole('checkbox',{name:'แท็บสมมติใหม่ แก้ไข',exact:true}).check();await panel.getByRole('button',{name:'ดูความแตกต่างก่อนยืนยัน'}).click();await expect(panel.getByLabel('ความแตกต่างของสิทธิ์')).toContainText('แท็บสมมติใหม่: ไม่มีสิทธิ์ → ดู · แก้ไข');
  await panel.getByRole('checkbox',{name:'ยืนยันความแตกต่างของทุกบัญชีที่แสดง'}).check();await panel.getByRole('button',{name:'ใช้กับ 1 คน',exact:true}).click();await expect(panel).toHaveCount(0);expect(state.calls.at(-1)?.body.change).toEqual({kind:'tab',tab:'synthetic_feature',levels:['view','edit']});
  await notice.getByRole('button',{name:'รับทราบโดยไม่ให้สิทธิ์'}).click();await expect(notice).toHaveCount(0);expect(state.calls.at(-1)).toEqual({path:'permissions/notices/synthetic_feature/ack',body:{catalog_digest:'synthetic-catalog-digest'}});
});

test('invite pins an explicit server template version and 400px panel stays keyboard-contained',async({page})=>{
  const state=await setup(page);await page.setViewportSize({width:400,height:860});const opener=page.getByRole('button',{name:'+ เพิ่มผู้ใช้',exact:true});await opener.click();const panel=page.getByRole('dialog');
  await expect(panel.getByRole('option',{name:/ผู้ดูแลระบบ/})).toHaveCount(0);await panel.getByLabel('อีเมล',{exact:true}).fill('permission-invite@example.test');await panel.getByLabel('แม่แบบสิทธิ์',{exact:true}).selectOption('publisher:1');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);for(let n=0;n<18;n++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('dialog'))).toBe(true);}
  await panel.getByRole('button',{name:'สร้างคำเชิญ',exact:true}).click();await expect(panel).toHaveCount(0);expect(state.calls[0].body.template).toEqual({code:'publisher',version:1});expect(state.calls[0].body).not.toHaveProperty('can_manage_users');
});
