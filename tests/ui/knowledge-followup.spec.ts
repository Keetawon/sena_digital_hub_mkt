import { test,expect,type Page } from '@playwright/test';
const base='/api/hub/v1/admin/knowledge';
const id='00000000-0000-4000-9900-000000000001';
async function setup(page:Page,role='editor'){
 await page.context().addCookies([{name:'sena_local_persona',value:'admin',url:'http://127.0.0.1:3000'}]);
 const account = (await (await page.request.get('/api/hub/v1/me')).json()).data;
 account.capabilities.tabs.knowledge.edit = role === 'editor' || role === 'admin';
 account.capabilities.tabs.knowledge.approve = role === 'publisher' || role === 'admin';
 await page.route('**/api/hub/v1/me', route => route.fulfill({ json: { data: account } }));
 const calls:{path:string;body:Record<string,unknown>}[]=[];
 const card={name:{th:'โครงการบางนาทดสอบ'},status:{raw:2,label:'พร้อมอยู่'},mode:'DRAFT_PREVIEW'};
 const common={project_ids:['BNA7'],holds:[],source_ref:'synthetic',source_url:null,review:null,bulk_rights_eligible:false};
 const items=[{...common,id,kind:'section',evidence:{title:{th:'สวนสมมติ'},body:{th:'มีสวนส่วนกลาง'}}},
 { ...common,id:id.replace(/1$/,'2'),kind:'asset',evidence:{mime:'application/pdf',classification:{role:'hero',alt_th:'ภาพสวน'}}},
 ...['หมดอายุ','ยังใช้ได้','ข้อความทั่วไป'].map((title,i)=>({...common,id:`00000000-0000-4000-9900-00000000000${i+3}`,kind:'promotion',evidence:{title,benefit:title}}))];
 const followup={questions:[{id:'draft-BNA7-01',question:'มีสวนไหม',expected_answer:'มีสวนส่วนกลาง',candidate_ids:[id],split:'tuning',holds:[]},{id:'draft-BNA7-11',question:'พักผ่อนที่ไหน',expected_answer:'สวนส่วนกลาง',candidate_ids:[id],split:'held_out',holds:[]}],preview_releases:[] as {id:string;created_at:string}[],
 promotions:items.filter(i=>i.kind==='promotion').map((i,n)=>({candidate_id:i.id,cluster_id:`cluster-${n}`,cluster_size:1,category:n===2?'text_not_promotion':'promotion',likely_expired:n===0,date_unknown:n===2,ocr_end_date:n===0?'2020-01-01':'2099-01-01'}))};
 await page.route(`**${base}/**`,async route=>{
  const path=new URL(route.request().url()).pathname;
  if(route.request().method()==='POST'){
   calls.push({path,body:route.request().postDataJSON()});
   if(path.endsWith('/preview-release'))followup.preview_releases=[{id:'00000000-0000-4000-9900-000000000099',created_at:'2026-10-07T00:00:00Z'}];
   if(path.endsWith('/preview'))return route.fulfill({json:{data:{route:'sections',answer:'มีสวนส่วนกลาง',citations:[{candidate_id:id}]}}});
   return route.fulfill({json:{data:{revision:1}}});
  }
  return route.fulfill({json:{data:path.endsWith('/projects')?[{project_id:'BNA7',card,candidates:items.length},{project_id:'LIVNEX',card,candidates:1}]:{card,items,followup}}});
 });
 await page.goto('/knowledge?project=BNA7');await expect(page.getByRole('heading',{name:'รายการตรวจ BNA7 ก่อนส่งพรีวิว'})).toBeVisible();return calls;
}
test('Admin editor sees split draft labels and explicitly verifies expected answers',async({page})=>{
 const calls=await setup(page);await page.getByText('คำถามทดสอบ 2 ข้อ',{exact:false}).click();
 await expect(page.getByText('ชุดปรับเกณฑ์: 1 · ชุดทดสอบแยก: 1',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'ตรวจคำตอบที่คาดหวัง'}).first().click();
 await page.getByLabel('คำตอบที่ MKT ตรวจแล้ว').fill('มีสวนส่วนกลางสำหรับพักผ่อน');await page.getByLabel('เหตุผลตรวจคำถาม').fill('ตรวจแหล่งข้อมูลสมมติแล้ว');
 await page.getByRole('button',{name:'บันทึกผลตรวจคำถาม'}).click();
 expect(calls[0].body).toMatchObject({expected_revision:0,decision:'verified',expected_answer:'มีสวนส่วนกลางสำหรับพักผ่อน'});
});
test('hero suggestions start as gallery and promotions separate expired and non-offers',async({page})=>{
 await setup(page);await page.getByLabel('ประเภทข้อมูล').selectOption('asset');await page.getByRole('button',{name:'ถูก',exact:true}).click();
 await expect(page.getByRole('dialog').getByLabel('ประเภทไฟล์')).toHaveValue('gallery');await page.getByRole('dialog').getByRole('button',{name:'ยกเลิก'}).click();
 await page.getByLabel('ประเภทข้อมูล').selectOption('promotion');
 const headings=page.locator('.knowledge-items article h2');await expect(headings).toHaveText(['ยังใช้ได้','หมดอายุ']);
 await page.getByLabel('กรองภาพโปรโมชั่น').selectOption('text');await expect(headings).toHaveText(['ข้อความทั่วไป']);
});
test('Admin approver explicitly creates private preview then reruns BNA7 alone',async({page})=>{
 const calls=await setup(page,'publisher');const evaluate=page.getByRole('button',{name:'ทดสอบคำตอบ BNA7 จากชุดพรีวิวล่าสุด'});await expect(evaluate).toBeDisabled();
 await page.getByRole('button',{name:'ตรวจและยืนยันชุดพรีวิวส่วนตัว'}).click();
 const confirm=page.getByRole('button',{name:'ยืนยันพรีวิวส่วนตัว',exact:true});await expect(confirm).toBeDisabled();
 await page.getByLabel('เหตุผลสร้างชุดพรีวิว').fill('ตรวจตัวอย่างสมมติ');await page.getByLabel('ยืนยันชุดและขอบเขตโครงการนี้').check();await confirm.click();
 await expect(evaluate).toBeEnabled();await evaluate.click();await expect(page.getByText('พบหลักฐานที่คาดหวัง 2/2 คำถาม')).toBeVisible();
 expect(calls[0].body).toMatchObject({confirmed:true});expect(calls.filter(c=>c.path.endsWith('/preview')).every(c=>c.body.project_id==='BNA7' && c.body.release_id)).toBeTruthy();
});

test('programme queues do not offer project hero or preview controls',async({page})=>{
 await setup(page,'publisher');await page.getByLabel('โครงการหรือระยะ').selectOption('LIVNEX');
 await expect(page.getByRole('button',{name:'ตรวจและยืนยันชุดพรีวิวส่วนตัว'})).toHaveCount(0);
 await expect(page.getByRole('region',{name:'ตรวจครบวงจรและชุดคำถามทดสอบ'})).toHaveCount(0);
});
