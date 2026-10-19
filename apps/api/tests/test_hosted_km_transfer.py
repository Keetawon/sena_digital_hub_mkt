"""Content-only transfer invariants, using synthetic data and disposable PostgreSQL."""
import asyncio
import copy
import importlib
import json
import sys
from uuid import UUID

import asyncpg
import pytest
from test_permission_baseline import ROOT, disposable_operator

sys.path.insert(0,str(ROOT/'scripts'))
transfer=importlib.import_module('transfer-hub-km')
prep=transfer.prep
STAMP='2026-10-01T00:00:00+00:00'


def package():
    project={'ProjectID':'KM-TEST','ProjectName':'โครงการสังเคราะห์','ProjectNameEng':'Synthetic project',
      'BrandID':'KM-BRAND','CompanyID':None,'ProjectGroupID':'KM-GROUP','ProjectType':'H','ProjectStatus':'2','isDeleted':False}
    model={'ProjectID':'KM-TEST','ModelID':'KM-MODEL','ModelName':'แบบสังเคราะห์'}
    brand={'brand_id':'KM-BRAND','brand_name_th':'แบรนด์สังเคราะห์','brand_name_en':'Synthetic brand','deletion_status':'active',
      'has_residential_projects':True,'residential_project_count':1,'non_deleted_residential_project_count':1}
    gold={'project_id':'KM-TEST','project_key':'km-test-key','project_name':project['ProjectName'],
      'rem_brand_id':'KM-BRAND','project_type':'H','is_deleted':False,'project_status_code':'2',
      'rem_project_group_id':'KM-GROUP','marketing_project_group_id':'KM-GROUP','project_identity_conflict':False,
      'project_group_conflict':False,'source_snapshot_at':STAMP}
    return {'references':{'source_snapshot_at':STAMP,'brand_snapshot_at':STAMP,'brands':[brand],'companies':[],
      'projects':[project],'models':[model],'gold_projects':[{'project_id':'KM-TEST','gold':gold}],
      'gold_models':[],'project_groups':[{'project_group_id':'KM-GROUP','project_name_th':'กลุ่มสังเคราะห์','project_id_set':['KM-TEST'],'member_count':1}]},
      'content':{'brands':[{'id':'local-brand','rem_brand_id':'KM-BRAND','public_name':{'th':'แบรนด์สังเคราะห์'},'description':{'th':'เรื่องราวสังเคราะห์'}}],
        'projects':[{'id':'local-project','rem_project_id':'KM-TEST','public_name':{'th':'โครงการจากคลังเดิม'},'website_content':{'th':'เนื้อหาสังเคราะห์'},'address':{'th':'ที่อยู่สังเคราะห์'}}],
        'models':[{'rem_project_id':'KM-TEST','rem_model_id':'KM-MODEL','public_name':{'th':'ชื่อแบบจากคลังเดิม'},'bedrooms':2}],
        'assets':[],'brand_assets':[],'project_assets':[]},
      'candidates':[{'id':str(UUID(int=99871)),'source_key':'synthetic:km','kind':'section','project_ids':['KM-TEST'],
        'programme_ids':[],'topic':'design','source_url':None,'source_ref':'synthetic:km','evidence':{'body':{'th':'เนื้อหาสังเคราะห์'},'source_kind':'legacy_website_km'},'holds':['needs_phase_decision']}],
      'legacy-history':[],'file-gaps':[]}


def test_demo_fields_removed_without_losing_real_locales():
    row={'public_name':{'th':'จริง','en':'demo'},'slug':'demo','demo_fields':['public_name.en','slug']}
    assert prep.non_demo(row,['public_name','slug'])=={'public_name':{'th':'จริง'}}
    assert row['public_name']['en']=='demo'


def test_reference_projection_excludes_finance_inventory_and_staff_contacts():
    for key in ['sales_email','inventory_count','price_min','actual_revenue','staff_email']:
        assert key not in prep.GOLD_FIELDS and key not in prep.GOLD_MODEL_FIELDS
    assert {'marketing_project_group_id','project_status_code','is_deleted'} <= set(prep.GOLD_FIELDS)


def test_unmarked_uploads_are_not_assumed_to_be_project_content():
    row={'id':'synthetic-upload','deleted_at':None,'checksum':'1'*64,'original_filename':'brand-logo.jpg'}
    assert not prep.local_upload_allowed(row,[])
    row['checksum']=next(iter(prep.CONTENT_LOCAL_UPLOADS))
    assert prep.local_upload_allowed(row,[])
    assert not prep.local_upload_allowed(row,[row['id']])
    row['deleted_at']=STAMP
    assert not prep.local_upload_allowed(row,[])


def test_merge_never_replaces_nonempty_hosted_locales_or_numbers():
    assert transfer.merge_empty({'name':{'th':'เจ้าหน้าที่'},'latitude':13.1},
        {'name':{'th':'ต้นทาง','en':'Source'},'latitude':14,'address':{'th':'ถนน'}})=={
        'name':{'th':'เจ้าหน้าที่','en':'Source'},'address':{'th':'ถนน'}}


@pytest.mark.parametrize('status,retries,exists',[(503,3,False),(422,1,False),(503,0,True)])
def test_transfer_retries_only_transient_storage_failure_and_reports_permanent_gap(tmp_path,monkeypatch,status,retries,exists):
    monkeypatch.setattr(transfer,'ROOT',tmp_path)
    monkeypatch.setattr(transfer.time,'sleep',lambda seconds:None)
    folder=tmp_path/'.local';folder.mkdir()
    raw=b'synthetic original';digest=prep.sha(raw);file=folder/digest;file.write_bytes(raw)
    prep.write(folder/'local-file-locations.json',{digest:str(file)})
    data={'candidates':[{'kind':'asset','evidence':{'sha256':digest,'bytes':len(raw)}}],'content':{'assets':[]}}
    class Storage:
        calls=0
        def read_knowledge(self,evidence):
            if exists:return raw
            raise transfer.HTTPException(status_code=404,detail='synthetic')
        def install_knowledge(self,content,evidence):
            assert content==raw
            self.calls+=1
            if status==422 or self.calls<3:raise transfer.HTTPException(status_code=status,detail='synthetic')
            return True
    storage=Storage()
    if exists:assert transfer.upload(folder,data,storage)=={'verified':1,'created':0,'existing':1}
    elif status==503:assert transfer.upload(folder,data,storage)=={'verified':1,'created':1,'existing':0}
    else:
        with pytest.raises(ValueError,match='r2_verification_incomplete'):transfer.upload(folder,data,storage)
        assert prep.read(folder/'r2-failures.json')[0]['status']==422
    assert storage.calls==retries


def test_package_integrity_refuses_tampering_and_path_escape(tmp_path):
    prep.write(tmp_path/'content.json',{})
    raw=(tmp_path/'content.json').read_bytes()
    manifest={'files':{'content.json':{'sha256':prep.sha(raw),'bytes':len(raw)}}}
    prep.write(tmp_path/'manifest.json',manifest)
    digest=prep.sha((tmp_path/'manifest.json').read_bytes())
    assert prep.verify(tmp_path,digest)==manifest
    (tmp_path/'content.json').write_text('changed')
    with pytest.raises(ValueError,match='package_changed'):prep.verify(tmp_path,digest)
    manifest['files']={'../outside.json':{}}
    prep.write(tmp_path/'manifest.json',manifest)
    with pytest.raises(ValueError,match='unsafe_package_path'):prep.verify(tmp_path,prep.sha((tmp_path/'manifest.json').read_bytes()))


def test_km_transfer_atomic_replay_references_models_permissions_and_no_approval():
    async def check():
        db=await disposable_operator()
        for kind in ['json','jsonb']:await db.set_type_codec(kind,schema='pg_catalog',encoder=json.dumps,decoder=json.loads)
        outer=db.transaction();await outer.start()
        try:
            admin=await db.fetchval("select id from hub.user_account where hub_role='admin' and status='ACTIVE' limit 1")
            data=package();before=await transfer.fingerprints(db)
            await db.execute("create schema hub_deployment; create table hub_deployment.target(project_ref text,environment text,profile text,source text)")
            await db.execute("insert into hub_deployment.target values($1,'hosted-test','hosted-test-settings-v1','sena-hub-supabase-test-v2')",transfer.HOSTED_TEST_REF)
            for index in range(3):
                digest=str(index+6)*64
                data['content']['assets'].append({'id':f'asset-{index}','original_filename':'synthetic.png','mime_type':'image/png',
                    'checksum':digest,'storage_path':digest+'.png','file_size':100,'asset_type':'image','width':10,'height':10,'language':'th'})
            data['content']['brand_assets']=[{'brand_id':'local-brand','asset_id':'asset-0','asset_role':'logo_primary','alt_text':{'th':'ภาพสังเคราะห์'}}]
            data['content']['project_assets']=[{'project_id':'local-project','model_id':None,'asset_id':f'asset-{index+1}',
                'asset_role':'hero','alt_text':{'th':'ภาพสังเคราะห์'},'is_primary':index==0,'display_order':index} for index in range(2)]
            result=await transfer.import_rows(db,admin,'1'*64,{'synthetic':True},data)
            assert result['created_brands']==1 and result['created_projects']==1 and result['bound_project_brands']==1
            assert result['model_updates']==1 and await transfer.fingerprints(db)==before
            project=await db.fetchrow("select * from hub.projects where rem_project_id='KM-TEST'")
            model=await db.fetchrow('select * from hub.model_types where project_id=$1',project['id'])
            assert model['public_name']=={'th':'ชื่อแบบจากคลังเดิม'} and model['bedrooms']==2
            assert model['match_status']=='SUGGESTED' and model['verified_by'] is None
            assert project['published_version_id'] is None
            assert await db.fetchval('select count(*) from hub.entity_assets where project_id=$1 and deleted_at is null',project['id'])==2
            assert await db.fetchval('select count(*) from hub.entity_assets where project_id=$1 and is_primary and deleted_at is null',project['id'])==1
            assert await db.fetchval("select bool_and(rights_status<>'APPROVED') from hub.assets where checksum=any($1::text[])",[str(i+6)*64 for i in range(3)])
            assert await db.fetchval("select count(*) from staging.dw_project_groups where project_group_id='KM-GROUP'")==1
            assert (await db.fetchval("select hub.project_source_review('KM-TEST')"))['default_scope'] is True
            assert await db.fetchval('select holds from staging.knowledge_candidates where id=$1',UUID(int=99871))==['needs_phase_decision']
            assert (await transfer.import_rows(db,admin,'1'*64,{},data))=={'replay':True}
            # Protect both nonempty edits and deliberate clears, including locale clears.
            await db.fetchval('select hub.patch_project($1,$2,$3)',project['id'],{'website_content':{'th':'เจ้าหน้าที่แก้ไข'},'address':{}},project['updated_at'])
            newer=copy.deepcopy(data);newer['candidates'][0]['id']=str(UUID(int=99872));newer['candidates'][0]['source_key']='synthetic:next'
            await transfer.import_rows(db,admin,'2'*64,{},newer)
            saved=await db.fetchrow('select website_content,address from hub.projects where id=$1',project['id'])
            assert saved['website_content']=={'th':'เจ้าหน้าที่แก้ไข'} and saved['address']=={}
            assert await transfer.fingerprints(db)==before
            # An editor cannot import the brand catalog through an operator connection.
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                async with db.transaction():await transfer.import_rows(db,UUID(int=1),'3'*64,{},data)
            assert not await db.fetchval("select exists(select 1 from staging.intake_batches where manifest_sha256=$1)",'3'*64)
            # A late candidate collision rolls back earlier reference changes.
            with pytest.raises(asyncpg.UniqueViolationError):
                async with db.transaction():await transfer.import_rows(db,admin,'4'*64,{},data)
            assert not await db.fetchval("select exists(select 1 from staging.intake_batches where manifest_sha256=$1)",'4'*64)
        finally:
            await outer.rollback();await db.close()
    asyncio.run(check())
