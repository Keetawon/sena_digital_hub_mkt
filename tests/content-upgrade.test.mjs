import { initialiseDisposableDb } from '../scripts/initialise-disposable-db.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,mkdtemp,realpath,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import { beforePhase7, afterPhase7 } from './phase7-upgrade-fixture.mjs';

test('populated content upgrade preserves accounts and asset editors, audits backfill and drains deferred cache work',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const base=path.join(root,'.local/test-runs');
  await mkdir(base,{recursive:true});
  await new Promise((resolve,reject)=>{
    const probe=createServer();probe.once('error',()=>reject(new Error('Upgrade test port 55435 is occupied')));
    probe.listen(55435,'127.0.0.1',()=>probe.close(resolve));
  });
  const directory=await mkdtemp(path.join(base,'upgrade-'));
  const dataDirectory=path.join(directory,'postgres');
  const config=JSON.parse(await readFile(path.join(root,'.local/development.json'),'utf8'));
  const server=new EmbeddedPostgres({databaseDir:dataDirectory,user:'postgres',password:config.adminPassword,
    port:55435,persistent:true,authMethod:'scram-sha-256',initdbFlags:['--encoding=UTF8','--locale=C'],
    postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
  let started=false,db;
  try{
    await initialiseDisposableDb(dataDirectory,config.adminPassword);await server.start();started=true;
    db=server.getPgClient('postgres','127.0.0.1');await db.connect();
    assert.equal(await realpath((await db.query('SHOW data_directory')).rows[0].data_directory),await realpath(dataDirectory));
    const migrations=path.join(root,'supabase/migrations');
    for(const name of (await readdir(migrations)).filter(name=>name.endsWith('.sql')&&name<'202610090047_content_permissions.sql').sort())
      await db.query(await readFile(path.join(migrations,name),'utf8'));
    for(const file of ['scripts/sample-accounts.sql','supabase/seed.sql','scripts/sample-intake.sql','scripts/sample-brands.sql'])
      await db.query(await readFile(path.join(root,file),'utf8'));
    const accounts=async()=>(await db.query('select to_jsonb(a) row from hub.user_account a order by id')).rows;
    const editors=async()=>(await db.query('select id,updated_at,updated_by from hub.assets order by id')).rows;
    const beforeAccounts=await accounts(),beforeEditors=await editors();
    assert.ok(beforeAccounts.length>=8&&beforeEditors.length>=3);
    const bound=(await db.query('select asset_id from hub.entity_assets union select asset_id from hub.brand_assets')).rows.map(row=>row.asset_id);
    assert.ok(bound.length>0);
    await db.query("select set_config('app.actor_id','',false),set_config('app.change_reason','',false)");
    const contentState=async()=>(await db.query(`select name,rows from (
      select 'projects' name,jsonb_agg(to_jsonb(t) order by id) rows from hub.projects t union all
      select 'project_versions',jsonb_agg(to_jsonb(t)-array['entity_type','web_page_id','content_sha256'] order by id) from hub.entity_versions t union all
      select 'brands',jsonb_agg(to_jsonb(t) order by id) from hub.brands t union all
      select 'brand_versions',jsonb_agg(to_jsonb(t) order by id) from hub.brand_versions t union all
      select 'reviews',jsonb_agg(to_jsonb(t) order by candidate_id) from hub.knowledge_reviews t union all
      select 'permissions',jsonb_agg(to_jsonb(t) order by account_id,tab) from hub.account_permission t
    ) evidence order by name`)).rows;
    let phase2State,phase3State,phase5State,legacyFaq,legacySection,phase7State;
    const unitState=async()=>(await db.query(`select name,rows from (
      select 'types' name,jsonb_agg(to_jsonb(t)-array['category','special_rooms','ceiling_height_m','furniture_package','highlights','price_mode','ai_exposure','revision','editors','approved_by','approved_at','website_source'] order by id) rows from hub.commercial_types t union all
      select 'sources',jsonb_agg(to_jsonb(t) order by commercial_type_id,model_id) from hub.commercial_type_sources t
    ) evidence order by name`)).rows;
    const mediaState=async()=>(await db.query(`select name,rows from (
      select 'assets' name,jsonb_agg(to_jsonb(t)-array['media_category','caption','alt_text','image_kind','taken_at','people','third_party_marks','credit','ai_suggestion','metadata_state','media_revision','ai_exposure','marketing_publication'] order by id) rows from hub.assets t union all
      select 'project_bindings',jsonb_agg(to_jsonb(t) order by id) from hub.entity_assets t union all
      select 'brand_bindings',jsonb_agg(to_jsonb(t) order by id) from hub.brand_assets t union all
      select 'type_bindings',jsonb_agg(to_jsonb(t)-array['room_tag','caption','floor_number'] order by id) from hub.commercial_type_assets t
    ) evidence order by name`)).rows;
    const legacyState=async()=>(await db.query(`select 'faq' name,to_jsonb(f)-array['question_key','state','revision','draft_version_id','published_version_id','pinned_on'] payload from hub.faqs f
      union all select 'section',to_jsonb(s)-array['section_key','state','revision','draft_version_id','published_version_id','website_source'] from hub.content_sections s order by name`)).rows;
    for(const name of (await readdir(migrations)).filter(name=>name.endsWith('.sql')&&name>='202610090047_content_permissions.sql').sort()) {
      if(name==='202610210058_project_content_core.sql') {
        const project=(await db.query('select rem_project_id from staging.rem_projects order by rem_project_id limit 1')).rows[0].rem_project_id;
        const actor=(await db.query("select id from hub.user_account where hub_role='editor' order by id limit 1")).rows[0].id;
        await db.query("insert into staging.knowledge_batches(manifest_sha256,manifest) values(repeat('c',64),'{\"purpose\":\"synthetic upgrade preservation\"}')");
        const candidate=async kind=>(await db.query("insert into staging.knowledge_candidates(batch_sha256,source_key,kind,project_ids,topic,source_ref,evidence) values(repeat('c',64),$1,$1,array[$2],'design','synthetic upgrade','{}') returning id",[kind,project])).rows[0].id;
        const faqCandidate=await candidate('faq'),sectionCandidate=await candidate('section');
        legacyFaq=(await db.query(`insert into hub.faqs(candidate_id,scope_type,scope_id,applies_to_project_ids,topic,canonical_question,alt_questions,short_answer,source_ref,reviewed_by)
          values($1,'project',$2,array[$2],'design','{"th":"คำถามเดิม"}','["อีกคำถามเดิม"]','{"th":"คำตอบเดิม"}','synthetic original FAQ',$3) returning id`,[faqCandidate,project,actor])).rows[0].id;
        legacySection=(await db.query(`insert into hub.content_sections(candidate_id,scope_type,scope_id,applies_to_project_ids,topic,title,body,source_ref,reviewed_by)
          values($1,'project',$2,array[$2],'design','{"th":"ชื่อเดิม"}','{"th":"เนื้อหาเดิม"}','synthetic original section',$3) returning id`,[sectionCandidate,project,actor])).rows[0].id;
        await db.query("insert into hub.knowledge_reviews(candidate_id,decision,applies_to_project_ids,note,reviewed_by) values($1,'accepted',array[$3],'original accepted',$4),($2,'accepted',array[$3],'original accepted',$4)",[faqCandidate,sectionCandidate,project,actor]);
        phase2State={content:await contentState(),legacy:await legacyState(),accounts:await accounts()};
      }
      const before=name==='202610210057_public_content_boundary.sql'?await contentState():null;
      if(name==='202610210062_media_metadata.sql')phase3State=await mediaState();
      if(name==='202610220066_unit_type_workflow.sql') {
        const p=(await db.query('select id from hub.projects order by id limit 1')).rows[0].id;
        await db.query("select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',false)");
        const type=(await db.query(`insert into hub.commercial_types(project_id,public_name,description,source_notes)
          values($1,'{"th":"Preserved type","en":"Preserved type"}','{"th":"Existing wording"}','Original source notes') returning id`,[p])).rows[0].id;
        await db.query(`insert into hub.commercial_type_sources(project_id,commercial_type_id,model_id)
          select $1,$2,id from hub.model_types where project_id=$1 order by id limit 1`,[p,type]);
        await db.query(`insert into hub.commercial_type_assets(project_id,commercial_type_id,asset_id,asset_role,alt_text,title,display_order)
          select $1,$2,id,'model_image','{"th":"Original alternative text"}','Original media title',0 from hub.assets
          where mime_type like 'image/%' and deleted_at is null order by id limit 1`,[p,type]);
        phase3State=await mediaState();phase5State=await unitState();
        await db.query("select set_config('app.actor_id','',false)");
      }
      phase7State=await beforePhase7(db,name,phase7State);
      await db.query(await readFile(path.join(migrations,name),'utf8'));
      if(name==='202610270078_website_content_suggestions.sql') {
        for(const table of ['contacts','project_facilities','project_places','commercial_types','project_progress','project_disclosures','media_links','content_sections','asset_links']) {
          assert.equal(Number((await db.query(`select count(*) from hub.${table} where website_source is not null`)).rows[0].count),0,`${name} assigned website provenance to existing ${table}`);
        }
        assert.equal(Number((await db.query('select count(*) from hub.asset_links where not binding_confirmed')).rows[0].count),0,'Existing bindings retain their confirmation');
      }
      await afterPhase7(db,name,phase7State);
      if(phase5State)assert.deepEqual(await unitState(),phase5State,`${name} rewrote commercial content or source references`);
      if(phase3State)assert.deepEqual(await mediaState(),phase3State,`${name} rewrote asset metadata, rights or bindings`);
      if(before)assert.deepEqual(await contentState(),before,'Phase 1 changed content, reviews or account permissions');
      if(phase2State) {
        assert.deepEqual(await contentState(),phase2State.content,`${name} rewrote existing content, reviews or permissions`);
        assert.deepEqual(await legacyState(),phase2State.legacy,`${name} rewrote legacy FAQ/section fields`);
        assert.deepEqual(await accounts(),phase2State.accounts,`${name} rewrote accounts`);
      }
    }
    assert.equal((await db.query('select question,alt_questions,short_answer from hub.faq_versions where faq_id=$1',[legacyFaq])).rowCount,1);
    assert.deepEqual((await db.query('select alt_questions from hub.faq_versions where faq_id=$1',[legacyFaq])).rows[0].alt_questions,['อีกคำถามเดิม']);
    assert.equal((await db.query('select body from hub.content_section_versions where section_id=$1',[legacySection])).rows[0].body.th,'เนื้อหาเดิม');
    assert.equal((await db.query('select count(*) from hub.faq_sources where faq_id=$1',[legacyFaq])).rows[0].count,'1');
    assert.equal(Number((await db.query("select count(*) from hub.entity_versions where entity_type<>'project' or web_page_id is not null or content_sha256 is not null")).rows[0].count),0,'Legacy project versions retain their identity');
    assert.equal(Number((await db.query('select count(*) from hub.web_pages')).rows[0].count),0,'Upgrade must not register or publish pages');
    assert.equal(Number((await db.query("select count(*) from hub.account_permission where 'knowledge.publish_web'=any(special_actions)")).rows[0].count),0,'Upgrade must not grant publication');
    assert.deepEqual(await accounts(),beforeAccounts);
    assert.deepEqual(await editors(),beforeEditors);
    assert.equal(Number((await db.query('select count(*) from hub.assets where id=any($1::uuid[]) and first_bound_at is not null',[bound])).rows[0].count),bound.length);
    assert.equal((await db.query("select tgenabled::text from pg_trigger where tgrelid='hub.assets'::regclass and tgname='touch'")).rows[0].tgenabled,'O');
    assert.equal(Number((await db.query('select count(*) from hub.project_progress_dirty')).rows[0].count),0);
    assert.equal(Number((await db.query("select count(*) from audit.change_log where table_name='hub.assets' and actor is null and reason='Phase 2 migration: historical asset binding backfill'")).rows[0].count),bound.length);
  }finally{
    if(db)await db.end();if(started)await server.stop();
    const actual=await realpath(directory),allowed=await realpath(base);
    assert.ok(actual.startsWith(allowed+path.sep)&&path.basename(actual).startsWith('upgrade-'));
    await rm(actual,{recursive:true,force:true});
  }
});
