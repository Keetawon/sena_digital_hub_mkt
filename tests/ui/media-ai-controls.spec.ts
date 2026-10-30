import {expect,test,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import {mediaAiText as text} from '../../apps/admin/components/media-ai-text';

const headers={Origin:'http://127.0.0.1:3000'},api='/api/hub/v1/admin';
async function read(page:Page,url:string){const r=await page.request.get(url);expect(r.ok()).toBeTruthy();return (await r.json()).data;}
async function persona(page:Page,role:string){expect((await page.request.post('/api/local-session',{headers,data:{role}})).ok()).toBeTruthy();}
async function operator(){
  const directory=await realpath(process.env.HUB_DISPOSABLE_TEST_RUN!);
  expect(directory.startsWith(await realpath('.local/test-runs')+path.sep)).toBe(true);
  const marker=JSON.parse(await readFile(path.join(directory,'run.json'),'utf8'));
  const config=JSON.parse(await readFile('.local/development.json','utf8'));
  const db=new pg.Client({host:'127.0.0.1',port:55432,database:'sena_hub_local',user:'postgres',password:config.adminPassword});await db.connect();
  expect(await realpath((await db.query('show data_directory')).rows[0].data_directory)).toBe(await realpath(path.join(directory,'postgres')));
  expect((await db.query('select run_id from public.disposable_test_run')).rows[0].run_id).toBe(marker.run_id);return db;
}

for(const width of [1280,390])test(`Per-image AI controls, budget, permissions and footer placement at ${width}px`,async({page})=>{
  test.setTimeout(120000);await page.setViewportSize({width,height:950});await persona(page,'editor');
  page.on('dialog',dialog=>dialog.accept());
  const project=(await read(page,`${api}/projects`)).find((p:{source:{rem_project_id:string}})=>p.source.rem_project_id==='DEMO-001');
  const base=`${api}/projects/${project.public_project_id}/media`,stamp=randomUUID(),ids:string[]=[];
  const db=await operator(),original=(await db.query('select monthly_cap_usd,provider_configured,worker_seen_at from hub.media_ai_settings join hub.media_worker_status using(singleton)')).rows[0];
  const name=`ai-footer-${width}-${stamp}.svg`;
  try{
    await db.query('update hub.media_ai_settings set monthly_cap_usd=0; update hub.media_worker_status set provider_configured=false');
    for(const [index,category,exposure] of [[0,'exterior','web_only'],[1,'legal_document','internal'],[2,'brochure','web_only'],[3,'exterior','internal'],[4,'exterior','web_only']] as const){
      const upload=await page.request.post(`${api}/assets`,{headers:{...headers,'Content-Type':'image/svg+xml','X-Filename':index?`held-${index}-${name}`:name},
        data:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#18523d"/><text x="1" y="15">${stamp}-${index}</text></svg>`)});
      expect(upload.ok()).toBeTruthy();const asset=(await upload.json()).data;ids.push(asset.id);
      await db.query("select set_config('app.actor_id',$1,false)",[asset.created_by]);
      expect((await page.request.put(`${base}/assets/${asset.id}`,{headers,data:{expected_revision:0,changes:{media_category:category,marketing_publication:category!=='legal_document',ai_exposure:exposure}}})).ok()).toBeTruthy();
      if(index!==1)expect((await page.request.put(`${base}/links/${randomUUID()}`,{headers,data:{expected_revision:0,changes:{asset_id:asset.id,target_type:'project',target_key:project.id,usage:'gallery'}}})).ok()).toBeTruthy();
    }
    // UI projection fixture for a non-image, without installing a broken original.
    const projection=async()=>{const value=await read(page,base);value.assets.find((a:{id:string})=>a.id===ids[4]).mime_type='application/pdf';return value;};
    let projected=await projection();
    await page.route(`**${base}`,route=>route.fulfill({json:{data:projected}}));
    await page.goto(`/media?project=${project.public_project_id}&tab=library`);
    const card=()=>page.locator('.media-card').filter({has:page.getByRole('heading',{name,exact:true})});
    await expect(card().getByRole('button',{name:text.state_not_configured,exact:true})).toBeDisabled();
    for(const index of [1,2,3,4])await expect(page.locator('.media-card').filter({hasText:`held-${index}-${name}`}).locator('.media-ai-footer')).toHaveCount(0);
    await db.query('update hub.media_ai_settings set monthly_cap_usd=5; update hub.media_worker_status set provider_configured=true,worker_seen_at=clock_timestamp()');
    await page.reload();const ready=card().getByRole('button',{name:text.button_label,exact:true});await expect(ready).toBeEnabled();
    const buttons=card().getByRole('button');expect(await buttons.last().textContent()).toBe(text.button_label);
    await expect(card()).toContainText(`${text.budget_spent_label} US$0.00 · ${text.budget_remaining_label} US$5.00`);
    await card().getByRole('button',{name:'แก้ไขข้อมูลภาพ',exact:true}).click();
    const footer=page.locator('.media-ai-footer');
    await expect(footer).toHaveCount(1);
    const save=page.getByRole('button',{name:'อัปโหลดและบันทึกข้อมูล',exact:true});
    expect((await footer.boundingBox())!.y).toBeGreaterThan((await save.boundingBox())!.y);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await footer.getByRole('button').evaluate(e=>getComputedStyle(e).animationName)).toBe('none');
    await page.screenshot({path:`artifacts/hosted-content-rollout/h5e-ai-editor-${width}.png`,fullPage:true});
    // A real, guarded one-image request. No local provider worker is running.
    await footer.getByRole('button',{name:text.button_label,exact:true}).click();
    await expect(footer.getByRole('button',{name:text.state_waiting,exact:true})).toBeDisabled();
    const repeat=await page.request.post(`${base}/jobs`,{headers,data:{kind:'image_suggestion',subject_id:ids[0],expected_revision:1}});
    expect(repeat.ok()).toBeTruthy();expect((await repeat.json()).data.status).toBe('queued');
    expect((await db.query('select count(*)::int n from hub.media_jobs where subject_id=$1',[ids[0]])).rows[0].n).toBe(1);
    // A previous month's refusal is history; the current ledger governs a new explicit request.
    await db.query("update hub.media_jobs set status='budget_exhausted',error_code='budget_exhausted',completed_at=(date_trunc('month',clock_timestamp() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok')-interval '1 day' where subject_id=$1",[ids[0]]);
    await page.goto(`/media?project=${project.public_project_id}&tab=library`);
    await expect(card().locator('.media-ai-footer').getByRole('button',{name:text.button_label,exact:true})).toBeEnabled();
    const renewed=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(`${base}/jobs`));
    await card().locator('.media-ai-footer').getByRole('button',{name:text.button_label,exact:true}).click();
    expect((await renewed).ok()).toBeTruthy();
    await expect(card().locator('.media-ai-footer').getByRole('button',{name:text.state_waiting,exact:true})).toBeDisabled();
    await expect.poll(async()=>(await db.query('select count(*)::int n from hub.media_jobs where subject_id=$1',[ids[0]])).rows[0].n).toBe(2);
    await db.query('update hub.media_ai_settings set monthly_cap_usd=0.01');
    await page.goto(`/media?project=${project.public_project_id}&tab=library`);await expect(card().locator('.media-ai-footer').getByRole('button',{name:text.state_budget,exact:true})).toBeDisabled();
    await db.query('update hub.media_ai_settings set monthly_cap_usd=5');
    const source={source_kind:'sena_public_website',source_remark:'ดึงจากเว็บไซต์สาธารณะ SENA',page_url:'https://www.sena.co.th/project/synthetic-ai-footer',fetched_at:'2026-10-28T00:00:00Z',capture_sha256:'e'.repeat(64),confirmed:false};
    const batch=stamp.replaceAll('-','').repeat(2);
    await db.query('insert into staging.knowledge_batches(manifest_sha256,manifest) values($1,$2)',[batch,{purpose:'synthetic AI footer'}]);
    await db.query('insert into hub.website_asset_suggestions(project_id,asset_id,batch_sha256,page_position,source) values($1,$2,$3,$4,$5)',[project.id,ids[0],batch,{media_category:'exterior',tags:[],image_kind:'photo',positions:[]},source]);
    await page.goto(`/media?project=${project.public_project_id}&tab=website`);
    const webCard=page.locator('.website-media .media-card').filter({has:page.getByRole('heading',{name,exact:true})});
    await webCard.locator('summary').filter({hasText:'แก้ไขหมวด แท็ก และบริบท'}).click();
    await expect(webCard.locator('.media-ai-footer').getByRole('button',{name:text.state_waiting,exact:true})).toBeDisabled();
    const after=await read(page,base),asset=after.assets.find((a:{id:string})=>a.id===ids[0]);
    expect(asset.metadata_state).toBe('needs_review');expect(asset.rights_status).toBe('pending');
    await page.screenshot({path:`artifacts/hosted-content-rollout/h5e-ai-website-${width}.png`,fullPage:true});
    // Mock completion: display a suggestion, with all confirmed values and rights intact.
    await db.query('update hub.assets set ai_suggestion=$1 where id=$2',[{media_category:'interior',tags:['day'],image_kind:'photo',source_revision:1,
      caption:{th:'Synthetic caption'},alt_text:{th:'Synthetic alt text'},proposed_tags:[],confidence:0.7,model:'synthetic-only',suggested_at:source.fetched_at},ids[0]]);
    await db.query("update hub.media_jobs set status='done' where subject_id=$1",[ids[0]]);
    projected=await projection();
    await page.reload();await webCard.locator('summary').filter({hasText:'แก้ไขหมวด แท็ก และบริบท'}).click();
    await expect(webCard.locator('[data-ai-state="done"]').getByRole('button',{name:text.button_label,exact:true})).toBeDisabled();
    const untouched=(await read(page,base)).assets.find((a:{id:string})=>a.id===ids[0]);
    expect(untouched.media_category).toBe('exterior');expect(untouched.caption).toEqual({});expect(untouched.rights_status).toBe('pending');expect(untouched.metadata_state).toBe('needs_review');
    // An automatic request must never prevent a Marketing upload from saving.
    await page.unroute(`**${base}`);
    await db.query('update hub.media_ai_settings set monthly_cap_usd=0.01');
    await page.goto(`/media?project=${project.public_project_id}&tab=upload`);
    const uploadName=`budget-upload-${stamp}.svg`;
    await page.locator('input[type="file"]').setInputFiles({name:uploadName,mimeType:'image/svg+xml',
      buffer:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="42" height="31"><text x="1" y="15">${stamp}-budget</text></svg>`)});
    const uploadCard=page.locator('.media-card').filter({has:page.getByRole('heading',{name:uploadName,exact:true})});
    await uploadCard.getByRole('checkbox',{name:/ภาพการตลาดเพื่อเผยแพร่/}).check();
    const saved=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(`${api}/assets`));
    await page.getByRole('button',{name:'อัปโหลดและบันทึกข้อมูล',exact:true}).click();
    const uploaded=(await (await saved).json()).data;ids.push(uploaded.id);
    await expect(uploadCard).toContainText(text.upload_budget_notice);
    await expect(page.locator('.media-ai-footer').getByRole('button',{name:text.state_budget,exact:true})).toBeDisabled();
    expect((await db.query("select status,attempts from hub.media_jobs where subject_id=$1",[uploaded.id])).rows).toEqual([]);
    expect((await db.query('select rights_status,metadata_state from hub.assets where id=$1',[uploaded.id])).rows).toEqual([{rights_status:'pending',metadata_state:'needs_review'}]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await db.query("update hub.media_jobs set status='budget_exhausted',error_code='budget_exhausted',completed_at=clock_timestamp() where subject_id=$1",[ids[0]]);
    await page.reload();
    const history=page.locator('details.content-section').filter({hasText:'สถานะคำแนะนำและการตรวจลิงก์'});
    await history.locator('summary').click();await expect(history).toContainText(text.state_budget);await expect(history).not.toContainText('budget_exhausted');
    await persona(page,'viewer');await page.goto(`/media?project=${project.public_project_id}&tab=library`);
    await expect(page.locator('.media-ai-footer')).toHaveCount(0);
    expect((await page.request.post(`${base}/jobs`,{headers,data:{kind:'image_suggestion',subject_id:ids[0],expected_revision:1}})).status()).toBe(403);
  }finally{
    await db.query('delete from hub.media_jobs where subject_id=any($1::uuid[])',[ids]);
    await db.query('delete from hub.website_asset_suggestions where asset_id=any($1::uuid[])',[ids]);
    await db.query('delete from hub.asset_links where asset_id=any($1::uuid[])',[ids]);
    await db.query('update hub.assets set deleted_at=clock_timestamp() where id=any($1::uuid[])',[ids]);
    await db.query('update hub.media_ai_settings set monthly_cap_usd=$1',[original.monthly_cap_usd]);
    await db.query('update hub.media_worker_status set provider_configured=$1,worker_seen_at=$2',[original.provider_configured,original.worker_seen_at]);
    await db.end();
  }
});
