"""Guarded content-only transfer to the owner's Supabase TEST and private R2."""
from __future__ import annotations
import argparse
import asyncio
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import importlib.util
import json
import os
import re
from pathlib import Path
import sys
import time
from uuid import UUID, uuid5, NAMESPACE_URL

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'));sys.path.insert(0,str(ROOT/'apps/api'))
import importlib
prep=importlib.import_module('prepare-km-transfer')
public=importlib.import_module('transfer-sena-public')
from sena_hub_api.auth import Settings,HOSTED_TEST_REF
from sena_hub_api.r2_assets import R2Assets,BUCKET
from fastapi import HTTPException
read,write,sha,require=prep.read,prep.write,prep.sha,prep.require
CONFIRM='IMPORT BRAND PROJECT KM TO '+HOSTED_TEST_REF
PROTECTED=('hub.user_account','hub.user_account_event','hub.account_permission','hub.permission_event',
 'hub.account_invite','hub.entity_versions','hub.brand_versions','hub.knowledge_reviews','hub.knowledge_asset_links',
 'rag.knowledge_preview_chunks')

def finalize(folder):
    require(not (folder/'manifest.json').exists(),'immutable_package_exists')
    preparation=read(folder/'preparation.json');candidates=read(folder/'base-candidates.json')
    files=read(folder/'known-files.json'); locations=read(folder/'local-file-locations.json')
    for row in read(folder/'collected-files.json'):files[row['url']]=row
    groups=defaultdict(list)
    for row in read(folder/'legacy-media.json'):groups[(row['url'],tuple(row['project_ids']))].append(row)
    failed=[]
    covered={(url,tuple(sorted(r['project_ids']))) for r in candidates if r['kind']=='asset' for url in r['evidence'].get('url_aliases',[r['source_url']])}
    for (url,projects),refs in groups.items():
        if (url,projects) in covered:continue
        file=files.get(url);key='legacy-media:'+sha(json.dumps([url,projects]).encode())
        holds=['needs_phase_decision'] if len(refs[0]['source_project_ids'])>1 else []
        if not projects:holds.append('unmapped_source_scope')
        if not file or file['status']!='downloaded':
            kind='gap';e={'source_url':url,'gap_type':'unavailable_media','reason':(file or {}).get('reason','not_downloaded'),'source_refs':[r['source_ref'] for r in refs]};failed.append(e)
        else:
            file_path=Path(file['path']).resolve();require(file_path.is_relative_to(ROOT/'.local'),'unsafe_local_file')
            data=file_path.read_bytes();require(sha(data)==file['sha256'] and len(data)==file['bytes'],'file_changed')
            kind='asset';e=prep.asset_evidence(data,file['mime'],url);e['source_refs']=[r['source_ref'] for r in refs]
            locations[e['sha256']]=str(file_path)
        candidates.append({'id':str(uuid5(NAMESPACE_URL,key)),'source_key':key,'kind':kind,'project_ids':list(projects),'programme_ids':[],
            'topic':'media_documents','source_url':url,'source_ref':refs[0]['source_ref'],'evidence':{**e,'source_kind':'legacy_website_km'},'holds':holds})
    write(folder/'candidates.json',candidates);write(folder/'file-gaps.json',failed);write(folder/'local-file-locations.json',locations)
    metadata={}
    for name in ['references.json','content.json','candidates.json','legacy-history.json','file-gaps.json']:
        raw=(folder/name).read_bytes();metadata[name]={'sha256':sha(raw),'bytes':len(raw)}
    manifest={'contract_version':prep.CONTRACT,'target_project_ref':HOSTED_TEST_REF,'created_at':datetime.now(timezone.utc).isoformat(),
        'source_hashes':preparation['source_hashes'],'files':metadata,'counts':{**preparation['content'],'candidates':len(candidates),
        'kinds':dict(__import__('collections').Counter(r['kind'] for r in candidates)),
        'unique_knowledge_files':len({r['evidence']['sha256'] for r in candidates if r['kind']=='asset'}),'media_gaps':len(failed)},
        'scope':'content_required_reference_projection_and_drafts','human_approved':False}
    write(folder/'manifest.json',manifest);print(json.dumps({'manifest_sha256':sha((folder/'manifest.json').read_bytes()),**manifest['counts']}))

def load_package(folder,digest):
    m=prep.verify(folder,digest);require(m['contract_version']==prep.CONTRACT and m['target_project_ref']==HOSTED_TEST_REF,'wrong_package_target')
    return m,{name[:-5]:read(folder/name) for name in m['files']}

async def fingerprints(db):
    tables=(*PROTECTED,'auth.users') if await db.fetchval("select to_regclass('auth.users') is not null") else PROTECTED
    return {table:await db.fetchval(f"select md5(coalesce(string_agg(v::text,'|' order by v::text),'')) from (select to_jsonb(t) v from {table} t) q") for table in tables}

def merge_empty(current,incoming):
    """Add only missing locales/fields; no replacement of nonempty hosted content."""
    patch={}
    for key,value in incoming.items():
        old=current.get(key)
        if isinstance(value,dict):
            new={**(old or {})}
            for locale,text in value.items():
                if text not in (None,'') and not new.get(locale):new[locale]=text
            if new!=(old or {}):patch[key]=new
        elif old in (None,'') and value not in (None,''):patch[key]=value
    return patch

async def safe_patch(db,table,row,incoming):
    patch=merge_empty(dict(row),incoming)
    if not patch:return patch
    # A deliberate clearing is an edit too. Never refill a previously edited field.
    edited=await db.fetchval('''select coalesce(array_agg(distinct k),'{}'::text[]) from audit.change_log a,
      lateral jsonb_object_keys(a.after_row) k where a.table_name=$1 and a.after_row->>'id'=$2
      and a.before_row is not null and a.before_row->k is distinct from a.after_row->k''',table,str(row['id']))
    return {k:v for k,v in patch.items() if k not in edited}

async def import_rows(db,actor,digest,manifest,data):
    await db.execute('select pg_advisory_xact_lock(710054)')
    await db.execute("select set_config('app.actor_id',$1,true)",str(actor))
    await db.execute("select set_config('app.change_reason','Imported source content; human review and publication remain pending',true)")
    for tab,action in [('projects','edit'),('brands','edit'),('knowledge','view')]:
        await db.fetchval('select hub.require_permission($1,$2)',tab,action)
    await db.fetchval("select hub.require_special('brands','brands.manage_catalog')")
    if await db.fetchval('select exists(select 1 from staging.knowledge_batches where manifest_sha256=$1)',digest):
        require(await db.fetchval('select count(*) from staging.knowledge_candidates where batch_sha256=$1',digest)==len(data['candidates']),'replay_count_mismatch')
        return {'replay':True}
    protected=await fingerprints(db); refs=data['references'];content=data['content']
    stamp=datetime.fromisoformat(refs['source_snapshot_at']);bstamp=datetime.fromisoformat(refs['brand_snapshot_at'])
    await db.execute('insert into staging.intake_batches(manifest_sha256,manifest,datasets) values($1,$2,$3)',digest,manifest,
                     {**refs,'legacy_history':data['legacy-history'],'draft_content_source':content})
    for r in refs['brands']:
        # Existing reviewed source identities are immutable for this one-time transfer.
        old=await db.fetchrow('select source_record from staging.rem_brands where rem_brand_id=$1',r['brand_id'])
        if old:require(old['source_record']==r,'existing_brand_reference_conflict');continue
        await db.execute('''insert into staging.rem_brands(rem_brand_id,brand_name_rem,brand_name_en_rem,is_deleted,source_snapshot_at,source_fingerprint,source_record,intake_manifest_sha256)
          values($1,$2,$3,$4,$5,$6,$7,$8)''',r['brand_id'],r['brand_name_th'],r['brand_name_en'],{'active':False,'deleted':True,'unknown':None}[r['deletion_status']],bstamp,sha(json.dumps(r,sort_keys=True).encode()),r,digest)
    for r in refs['companies']:
        await db.execute('''insert into staging.rem_companies(rem_company_id,company_name_rem,company_name_en_rem,is_deleted,source_fingerprint,intake_manifest_sha256)
          values($1,$2,$3,$4,$5,$6) on conflict(rem_company_id) do nothing''',r['rem_company_id'],r['company_name_rem'],r['company_name_en_rem'],r['is_deleted'],r['source_fingerprint'],digest)
    evidence=[]
    for r in refs['projects']:
        pid=r['ProjectID'];old=await db.fetchrow('select source_record from staging.rem_projects where rem_project_id=$1 for update',pid)
        if old:require(old['source_record'].get('source_kind')=='sena_public_website' or old['source_record']==r,'existing_project_reference_conflict')
        await db.execute('''insert into staging.rem_projects(rem_project_id,project_name_rem,rem_brand_id,rem_company_id,source_snapshot_at,source_fingerprint,source_record,intake_manifest_sha256,first_seen_at)
          values($1,$2,$3,$4,$5,$6,$7,$8,now()) on conflict(rem_project_id) do update set
          project_name_rem=excluded.project_name_rem,rem_brand_id=excluded.rem_brand_id,rem_company_id=excluded.rem_company_id,
          source_updated_at=null,source_snapshot_at=excluded.source_snapshot_at,source_fingerprint=excluded.source_fingerprint,source_record=excluded.source_record,intake_manifest_sha256=excluded.intake_manifest_sha256''',
          pid,r['ProjectName'] or '',r['BrandID'],r['CompanyID'],stamp,sha(json.dumps(r,sort_keys=True).encode()),r,digest)
        evidence.append((digest,'projects',pid,'','baseline' if old else 'new',r,old['source_record'] if old else None))
    await db.executemany('''insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_snapshot_at,source_fingerprint,source_record,intake_manifest_sha256,first_seen_at)
          values($1,$2,$3,$4,$5,$6,$7,now()) on conflict(rem_project_id,rem_model_id) do nothing''',[(r['ProjectID'],r['ModelID'],r['ModelName'] or '',stamp,sha(json.dumps(r,sort_keys=True).encode()),r,digest) for r in refs['models']])
    for r in refs['models']:
        evidence.append((digest,'models',r['ProjectID'],r['ModelID'],'new',r,None))
    grouped=defaultdict(list)
    for r in refs['gold_models']:grouped[r['project_id']].append(r)
    for r in refs['gold_projects']:
        pid=r['project_id'];g=r['gold'];groups=grouped[pid]
        await db.execute('''insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,model_groups,provenance)
          values($1,$2,$3,$4,$5,$6) on conflict(rem_project_id) do nothing''',pid,g,datetime.fromisoformat(g['source_snapshot_at']),
          sha(json.dumps([g,groups],sort_keys=True).encode()),groups,{'method':'reviewed_dw_content_projection','manifest_sha256':digest,'original_manifest_sha256':prep.DW,'human_approved':False,'excluded':'financial inventory and staff-contact fields'})
        evidence.append((digest,'gold_projects',pid,'','new',g,None))
    await db.executemany('insert into staging.project_intake_evidence(manifest_sha256,kind,rem_project_id,source_id,outcome,record,previous_record) values($1,$2,$3,$4,$5,$6,$7)',evidence)
    for r in refs['project_groups']:
        await db.execute('insert into staging.dw_project_groups(project_group_id,source_record,manifest_sha256) values($1,$2,$3) on conflict do nothing',r['project_group_id'],r,digest)
        await db.execute("insert into staging.project_group_evidence(manifest_sha256,project_group_id,outcome,record) values($1,$2,'new',$3)",digest,r['project_group_id'],r)
    await db.execute('insert into staging.project_intake_receipts(manifest_sha256,outcomes) values($1,$2)',digest,{'source_projection':True,'human_approved':False})
    brand_map={};created_brands=0
    for b in content['brands']:
        row=await db.fetchrow('select * from hub.brands where rem_brand_id=$1 and deleted_at is null for update',b['rem_brand_id'])
        created=row is None
        if created:
            bid=await db.fetchval('select hub.create_brand_from_rem($1)',b['rem_brand_id']);created_brands+=1
            row=await db.fetchrow('select * from hub.brands where id=$1',bid)
        patch=await safe_patch(db,'hub.brands',row,{k:b[k] for k in ['public_name','description','slug'] if k in b})
        if patch:await db.fetchval('select hub.update_brand_draft($1,$2,$3)',row['id'],patch,row['updated_at'])
        if created:await db.execute('update hub.brands set unconfirmed_source_names=$1,source_name_provenance=$2 where id=$3',list(b.get('public_name',{})),{'method':'local_content_transfer','manifest_sha256':digest,'names_require_review':True},row['id'])
        brand_map[b['id']]=row['id']
    project_map={};bound=0;filled=0;created_projects=0;created_models=set()
    for p in content['projects']:
        row=await db.fetchrow('select * from hub.projects where rem_project_id=$1 and deleted_at is null for update',p['rem_project_id'])
        created=row is None
        if row is None:
            pid=await db.fetchval('select hub.create_project_from_rem($1)',p['rem_project_id']);created_projects+=1
            row=await db.fetchrow('select * from hub.projects where id=$1',pid)
        patch=await safe_patch(db,'hub.projects',row,{k:v for k,v in p.items() if k not in ['id','rem_project_id','brand_id']})
        if patch:await db.fetchval('select hub.patch_project($1,$2,$3)',row['id'],patch,row['updated_at']);filled+=1
        project_map[p['id']]=row['id']
        # Bind only the canonical exact source brand, never a name match.
        source=next(r for r in refs['projects'] if r['ProjectID']==p['rem_project_id'])
        brand=await db.fetchrow('select id from hub.brands where rem_brand_id=$1 and deleted_at is null',source['BrandID'])
        if brand and row['brand_id'] is None and await db.fetchval("select (hub.project_source_review($1)->>'brand_binding_allowed')::boolean",p['rem_project_id']):
            current=await db.fetchrow('select updated_at from hub.projects where id=$1',row['id'])
            await db.fetchval('select hub.assign_project_brand($1,$2,$3)',row['id'],brand['id'],current['updated_at']);bound+=1
        # Source identity rows only; model matches remain unconfirmed.
        added=await db.fetch('''insert into hub.model_types(project_id,rem_project_id,rem_model_id,public_name)
          select $1,s.rem_project_id,s.rem_model_id,jsonb_build_object('th',s.model_name_rem) from staging.rem_models s
          where s.rem_project_id=$2 and not exists(select 1 from hub.model_types m where m.project_id=$1 and m.rem_model_id=s.rem_model_id) returning id''',row['id'],p['rem_project_id'])
        created_models.update(r['id'] for r in added)
        if created:created_models.update(r['id'] for r in await db.fetch('select id from hub.model_types where project_id=$1',row['id']))
    # Preserve genuine local model specifications as drafts, without copying match approvals.
    model_updates=0
    model_rows={(r['rem_project_id'],r['rem_model_id']):r for r in await db.fetch('select * from hub.model_types where project_id=any($1::uuid[]) and deleted_at is null',list(project_map.values()))}
    for m in content['models']:
        row=model_rows.get((m['rem_project_id'],m['rem_model_id']))
        require(row is not None,'missing_model_identity')
        patch=await safe_patch(db,'hub.model_types',row,{k:v for k,v in m.items() if k not in ['rem_project_id','rem_model_id']})
        # A new identity's REM name is only a default, not a hosted human edit.
        if row['id'] in created_models and m.get('public_name') and m['public_name']!=row['public_name']:patch['public_name']=m['public_name']
        if patch:
            updated=await db.fetchval('select updated_at from hub.projects where id=$1',row['project_id'])
            await db.fetchval('select hub.update_model($1,$2,$3,$4)',row['project_id'],row['public_model_id'],patch,updated);model_updates+=1
    # Original uploads use the normal upload guard, and preserve draft binding semantics.
    asset_map={}
    for a in content['assets']:
        metadata={k:v for k,v in a.items() if k!='id'};metadata['file_size']=int(metadata['file_size'])
        metadata.update(storage_bucket=BUCKET,storage_provider='r2')
        result=await db.fetchval('select hub.register_uploaded_asset($1)',metadata)
        asset_map[a['id']]=UUID(result['asset']['id'])
    for b in content['brand_assets']:
        if b['brand_id'] not in brand_map:continue
        if await db.fetchval('select exists(select 1 from hub.brand_assets where brand_id=$1 and asset_role=$2 and deleted_at is null)',brand_map[b['brand_id']],b['asset_role']):continue
        alt=b['alt_text'] if '\ufffd' not in json.dumps(b['alt_text'],ensure_ascii=False) else {'th':'ภาพจากคลังเดิม รอตรวจสอบคำอธิบาย'}
        updated=await db.fetchval('select updated_at from hub.brands where id=$1',brand_map[b['brand_id']])
        await db.fetchval('select hub.bind_brand_asset($1,$2,$3,$4,$5)',brand_map[b['brand_id']],asset_map[b['asset_id']],b['asset_role'],alt,updated)
    for b in sorted(content['project_assets'],key=lambda b:not b['is_primary']):
        if b['model_id']:continue # Model IDs require a separately verified binding; no guessed match.
        target=project_map[b['project_id']]
        if await db.fetchval('select exists(select 1 from hub.entity_assets where project_id=$1 and asset_id=$2 and asset_role=$3 and deleted_at is null)',target,asset_map[b['asset_id']],b['asset_role']):continue
        if not b['is_primary']:
            await db.execute('''insert into hub.entity_assets(project_id,asset_id,asset_role,alt_text,is_primary,display_order)
              values($1,$2,$3,$4,false,$5)''',target,asset_map[b['asset_id']],b['asset_role'],b['alt_text'],b['display_order']);continue
        if await db.fetchval('select exists(select 1 from hub.entity_assets where project_id=$1 and asset_role=$2 and is_primary and deleted_at is null)',target,b['asset_role']):continue
        updated=await db.fetchval('select updated_at from hub.projects where id=$1',project_map[b['project_id']])
        await db.fetchval('select hub.bind_project_asset($1,$2,$3,$4,$5)',project_map[b['project_id']],asset_map[b['asset_id']],b['asset_role'],b['alt_text'],updated)
    await db.execute('insert into staging.knowledge_batches values($1,$2,now())',digest,manifest)
    await db.executemany('''insert into staging.knowledge_candidates(id,batch_sha256,source_key,kind,project_ids,programme_ids,topic,source_url,source_ref,evidence,holds)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)''',[(UUID(r['id']),digest,r['source_key'],r['kind'],r['project_ids'],r['programme_ids'],r['topic'],r['source_url'],r['source_ref'],r['evidence'],r['holds']) for r in data['candidates']])
    for r in refs['projects']:
        card={'name':{'th':r['ProjectName'] or r['ProjectID'],'en':r['ProjectNameEng']},'brand_id':r['BrandID'],'group_id':r['ProjectGroupID'],
          'status':{'raw':int(r['ProjectStatus']) if r['ProjectStatus'] in ['0','1','2','3'] else None,'as_of':stamp.date().isoformat(),'source_ref':'dw:'+prep.DW},
          'mode':'DRAFT_PREVIEW','publication_version_id':None,'source_kind':'reviewed_reference_snapshot'}
        await db.execute('''insert into rag.project_fact_cards(rem_project_id,batch_sha256,payload) values($1,$2,$3)
          on conflict(rem_project_id) do update set payload=rag.project_fact_cards.payload||jsonb_build_object('brand_id',excluded.payload->'brand_id','group_id',excluded.payload->'group_id','status',excluded.payload->'status')''',r['ProjectID'],digest,card)
    await db.execute('select hub.refresh_project_progress(array(select rem_project_id from staging.rem_projects))')
    require(await fingerprints(db)==protected,'protected_state_changed')
    return {'replay':False,'created_brands':created_brands,'created_projects':created_projects,'filled_projects':filled,'bound_project_brands':bound,'model_updates':model_updates,'knowledge_candidates':len(data['candidates'])}

def upload(folder,data,storage):
    locations=read(folder/'local-file-locations.json'); jobs={}
    for r in data['candidates']:
        if r['kind']=='asset':jobs[('knowledge',r['evidence']['sha256'])]=r['evidence']
    for r in data['content']['assets']:jobs[('asset',r['checksum'])]={**r,'file_size':int(r['file_size']),'storage_bucket':BUCKET,'source_system':'hub-hosted-test'}
    def one(item):
        (kind,digest),e=item;p=Path(locations[digest]).resolve();require(p.is_relative_to(ROOT/'.local'),'unsafe_local_path')
        raw=p.read_bytes();require(sha(raw)==digest,'file_changed_before_upload')
        for attempt in range(3):
            try:
                try:
                    storage.read_knowledge(e) if kind=='knowledge' else storage.read(e)
                    return False
                except HTTPException as error:
                    if error.status_code!=404:raise
                return storage.install_knowledge(raw,e) if kind=='knowledge' else storage.install(raw,e)
            except HTTPException as error:
                if error.status_code<500 or attempt==2:raise
                time.sleep(attempt+1)
    done=created=0;failed=[]
    with ThreadPoolExecutor(max_workers=6) as pool:
        pending={pool.submit(one,item):item[0] for item in jobs.items()}
        for future in as_completed(pending):
            try:created+=int(future.result())
            except Exception as error:
                kind,digest=pending[future]
                failed.append({'kind':kind,'sha256':digest,'error_class':type(error).__name__,'status':getattr(error,'status_code',None)})
            done+=1
            if done%100==0 or done==len(jobs):print(json.dumps({'r2_verified':done-len(failed),'r2_total':len(jobs),'created':created,'failed':len(failed)}),flush=True)
    write(folder/'r2-failures.json',failed)
    require(not failed,'r2_verification_incomplete')
    return {'verified':done,'created':created,'existing':done-created}

async def hosted(args):
    require(args.hosted and args.confirm==CONFIRM,'explicit_target_required')
    manifest,data=load_package(args.package,args.manifest_sha256)
    db=await public.connect(public.checked_dsn(os.environ['HUB_TRANSFER_OPERATOR_DSN']))
    try:
        actor=await public.preflight(db)
        if args.command=='check':
            async with db.transaction(readonly=True):
                await db.execute("select set_config('app.actor_id',$1,true)",str(actor))
                require(await db.fetchval("select hub.can('projects','edit') and hub.can('brands','edit') and hub.can_special('brands','brands.manage_catalog')"),'operator_permission_missing')
            print(json.dumps({'status':'read_only_preflight_passed',**manifest['counts']}));return
        backup=read(args.backup_receipt)
        require(backup['status']=='backed_up' and backup['target_project_ref']==HOSTED_TEST_REF and backup['manifest_sha256']==args.manifest_sha256,'backup_required')
        require(0<=(datetime.now(timezone.utc)-datetime.fromisoformat(backup['at'].replace('Z','+00:00'))).total_seconds()<86400,'backup_expired')
        require(sha((args.backup_receipt.parent/'supabase-before-content.dump').read_bytes())==backup['dump_sha256'],'backup_changed')
        print(json.dumps({'stage':'transaction_rehearsal_after_backup'}),flush=True)
        tx=db.transaction();await tx.start()
        try:rehearsal=await import_rows(db,actor,args.manifest_sha256,manifest,data)
        finally:await tx.rollback()
        print(json.dumps({'stage':'rehearsal_passed',**rehearsal}),flush=True)
        await db.close()
        storage=R2Assets(Settings(database_url=os.environ['HUB_TRANSFER_RUNTIME_DSN']+'?sslmode=verify-full',auth_mode='supabase',environment='hosted-test',supabase_url=f'https://{HOSTED_TEST_REF}.supabase.co',admin_origin='https://72.62.253.205',r2_credentials_file=os.environ['HUB_TRANSFER_R2_FILE'],r2_private_bucket_confirmed=True))
        storage.require_private_bucket();files=await asyncio.to_thread(upload,args.package,data,storage)
        db=await public.connect(public.checked_dsn(os.environ['HUB_TRANSFER_OPERATOR_DSN']))
        actor=await public.preflight(db)
        async with db.transaction():result=await import_rows(db,actor,args.manifest_sha256,manifest,data)
        receipt={'status':'committed','at':datetime.now(timezone.utc).isoformat(),'manifest_sha256':args.manifest_sha256,'files':files,**result}
        write(args.package/'transfer-receipt.json',receipt);print(json.dumps(receipt))
    finally:await db.close()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('command',choices=['finalize','check','apply']);p.add_argument('--package',type=Path,required=True);p.add_argument('--manifest-sha256');p.add_argument('--hosted',action='store_true');p.add_argument('--confirm');p.add_argument('--backup-receipt',type=Path);a=p.parse_args();a.package=a.package.resolve()
    try:finalize(a.package) if a.command=='finalize' else asyncio.run(hosted(a))
    except Exception as e:print(json.dumps({'error':str(e) if isinstance(e,ValueError) and re.fullmatch('[a-z_]+',str(e)) else type(e).__name__,'sqlstate':getattr(e,'sqlstate',None)}));raise SystemExit(1)
