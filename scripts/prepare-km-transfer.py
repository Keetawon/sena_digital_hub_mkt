"""Prepare the owner-approved content-only TEST transfer, without DB/provider calls."""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, uuid5

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/api'))
from sena_hub_api import assets
from sena_hub_api.knowledge_retrieval import safe_text
from legacy_knowledge_dump import load, SOURCE

DW = '89ccfc35f045b13d82005f0967c7c3d04c74e3a5dccfa429c1169b33ac8fc737'
BRANDS = '1512ac0bac74f5356617458b30bf2079896cce18db54393b5244c136ae54f877'
LEGACY = 'c7a863cbad771a796cfaceed22cc9ea5a56eebd145503fb56687928adbab921b'
PILOT = 'cbc635e269ec3e56b5201780b9a6f25c8010fc1dbd2d6fb206e819a01bd38ab4'
BUCKET = 'r2-test-content'
CONTRACT = 'sena-brand-project-km-transfer-v1'
# This one-time transfer requires content classification for local uploads too.
# Visual check, 19 October: the FLEXI logo belongs to this content scope. Two
# unmarked uploads with test captions were unrelated photos, not project media.
# This allowlist does not approve rights, publication or the original binding.
CONTENT_LOCAL_UPLOADS = frozenset({'800a30390a79ea32d3b90237ea3c95733d39ea16c329577b5ccbc3d32a22dd41'})
GOLD_FIELDS = '''project_id project_key project_name project_name_eng project_type rem_brand_id company_id
 rem_project_group_id marketing_project_group_id project_identity_conflict project_group_conflict
 project_status_code project_status_detail is_deleted source_created_at source_modified_at source_snapshot_at
 warehouse_loaded_at commercial_project_name commercial_project_name_eng commercial_project_type commercial_project_subtype
 commercial_website_url commercial_brand commercial_project_code project_address_th project_address_eng
 latitude longitude has_valid_coordinates coordinate_source address_source'''.split()
GOLD_MODEL_FIELDS = '''project_id project_key project_model_key model_ids model_name model_name_eng model_names_eng
 short_name model_type_ids model_type_count technical_model_count model_attribute_variant minimum_model_area maximum_model_area
 source_created_at source_modified_at source_snapshot_at warehouse_loaded_at'''.split()

def read(p): return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(data): return hashlib.sha256(data).hexdigest()
def write(p, value): Path(p).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
def require(ok, code):
    if not ok: raise ValueError(code)

def verify(folder, digest):
    raw=(folder/'manifest.json').read_bytes(); require(sha(raw)==digest, 'manifest_mismatch')
    m=json.loads(raw)
    for name, meta in m['files'].items():
        p=(folder/name).resolve(); require(p.is_relative_to(folder.resolve()), 'unsafe_package_path')
        data=p.read_bytes(); require(sha(data)==meta['sha256'] and len(data)==meta['bytes'], 'package_changed')
    return m

def non_demo(row, fields):
    result={k:deepcopy(row[k]) for k in fields if k in row}
    for field in row.get('demo_fields', []):
        parts=field.split('.')
        if len(parts)==2 and isinstance(result.get(parts[0]), dict): result[parts[0]].pop(parts[1], None)
        else: result.pop(field, None)
    return result

def local_upload_allowed(row, demo_asset_ids):
    return not row['deleted_at'] and row['id'] not in demo_asset_ids and row.get('checksum') in CONTENT_LOCAL_UPLOADS

def asset_evidence(data, mime, url, role='unclassified'):
    digest=sha(data); error=None; metadata=None
    try: metadata=assets.validate_file(data,mime,urlsplit(url).path.rsplit('/',1)[-1] or digest+'.bin')
    except Exception: error='ไฟล์ยังไม่ผ่านการตรวจสอบ ต้องตรวจแยกก่อนอนุมัติสิทธิ์'
    return {'sha256':digest,'bytes':len(data),'mime':mime,'dimensions':None,'validated_metadata':metadata,
        'file_validation_error':error,'storage_bucket':BUCKET,'url_aliases':[url],
        'classification':{'role':role,'alt_th':'ภาพหรือเอกสารจากคลังความรู้เดิม รอตรวจสอบ',
        'people':'unknown','third_party_marks':'unknown','stock_imagery':'unknown','confidence':0}}

def prepare(folder):
    folder.mkdir(parents=True,exist_ok=True)
    require(not (folder/'manifest.json').exists(), 'immutable_package_exists')
    base=ROOT/'.local/dw-project-intake'/DW/'original'; dm=verify(base,DW)
    bp=ROOT/'.local/dw-brand-intake'/BRANDS; bm=verify(bp,BRANDS)
    pilot=ROOT/'.local/knowledge-pilot/20261006T060343825439Z'; verify(pilot,PILOT)
    require(sha(SOURCE.read_bytes())==LEGACY,'legacy_dump_changed')
    working_raw=(folder/'working-content.json').read_bytes(); working=json.loads(working_raw)
    projects=read(base/'projects.json'); by_id={r['ProjectID']:r for r in projects}
    models=read(base/'models.json'); gold_models=read(base/'gold_models.json')
    # The reviewed local first intake excluded only deleted models absent from Gold.
    gold_ids={(r['project_id'], m) for r in gold_models for m in r['model_ids']}
    models=[r for r in models if not (r['isDeleted'] is True and (r['ProjectID'],r['ModelID']) not in gold_ids)]
    refs={'projects':projects,'models':models,'brands':read(bp/'brands.json'),
        'brand_exceptions':read(bp/'exceptions.json'),'exceptions':read(base/'exceptions.json'),
        'gold_projects':[{'project_id':r['project_id'],'gold':{k:v for k,v in r['gold'].items() if k in GOLD_FIELDS}} for r in read(base/'gold_projects.json')],
        'gold_models':[{k:v for k,v in r.items() if k in GOLD_MODEL_FIELDS} for r in gold_models],
        'project_groups':read(base/'project_groups.json'),'source_snapshot_at':dm['extracted_at'],
        'brand_snapshot_at':bm['snapshot_at'],'companies':working['rem_companies']}
    brands=[non_demo(r,['id','rem_brand_id','public_name','description','slug','status','unconfirmed_source_names','source_name_provenance']) for r in working['brands'] if not r['deleted_at']]
    drafts=[non_demo(r,['id','rem_project_id','public_name','slug','address','latitude','longitude','ad_disclaimer','meta_title','meta_description','website_content','brand_id']) for r in working['projects'] if not r['deleted_at'] and r['rem_project_id'] in by_id]
    content={'brands':brands,'projects':drafts,'models':[], 'assets':[], 'brand_assets':[], 'project_assets':[]}
    valid_projects={r['id'] for r in drafts}
    content['models']=[non_demo(r,['rem_project_id','rem_model_id','public_name','bedrooms','bathrooms','usable_area_sqm','parking_spaces']) for r in working['model_types'] if r['project_id'] in valid_projects and not r['deleted_at'] and 'source' not in r['demo_fields']]
    # Legacy local facility flags have no trustworthy review attribution. Retain them
    # as held claims, rather than claiming that a real person confirmed them.
    content['facility_claims']=[r for r in working['project_facilities'] if r['project_id'] in valid_projects]
    locations={}; candidates=[]
    for row in read(pilot/'candidates.json'):
        row=deepcopy(row); e=row['evidence']; places=e.pop('locations',[])
        if row['kind']=='asset':
            e['storage_bucket']=BUCKET
            for loc in places:
                p=(Path(loc['package'])/loc['blob']).resolve()
                if p.is_relative_to(ROOT/'.local') and p.is_file() and sha(p.read_bytes())==e['sha256']:
                    locations[e['sha256']]=str(p); break
            require(e['sha256'] in locations,'missing_pilot_asset')
        e['source_kind']='legacy_website_km'; candidates.append(row)
    covered={r['source_ref'] for r in candidates}
    for row in candidates: covered.update(row['evidence'].get('source_refs',[]))
    ids={r['id'] for r in candidates}
    def add(key,kind,pids,evidence,url=None,topic='design',holds=(),programmes=()):
        identifier=str(uuid5(NAMESPACE_URL,'sena-full-km:'+key))
        if key in covered or identifier in ids:return
        ids.add(identifier); covered.add(key)
        matched=sorted(set(pids)&by_id.keys())
        candidates.append({'id':identifier,'source_key':key,'kind':kind,'project_ids':matched,
            'programme_ids':list(programmes),'topic':topic,'source_url':url,'source_ref':key,
            'evidence':{**evidence,'source_kind':'legacy_website_km','source_project_ids':pids},'holds':sorted(set(holds)|({'needs_phase_decision'} if len(pids)>1 else set())|({'unmapped_source_scope'} if not matched and not programmes else set()))})
    project_ids={r['id']:r['rem_project_id'] for r in drafts}
    for row in content['facility_claims']:
        add('local-facility:'+project_ids[row['project_id']]+':'+row['facility_code'],'facility',[project_ids[row['project_id']]],
            {'source_value':{k:v for k,v in row.items() if k!='project_id'},'owner':'MKT project owner','as_of':None,'source_origin':'unverified_local_draft'},
            topic='facilities',holds=['unverified_local_claim'])
    tables,_=load(); links=defaultdict(list); page_names={r['id']:r['name'] for r in tables['campaign_projects']}
    for row in tables['campaign_project_links']: links[row['campaign_project_id']].append(row['project_id'])
    # Retain the previously reviewed closed/selling shared-page boundary.
    links['8']=sorted(set(links['8']+['TPRAK']))
    media=[]; history=[]; page_outcomes=[]
    def walk_urls(value, path, pids, page_url):
        if isinstance(value,dict):
            for k,v in value.items():walk_urls(v,path+'.'+k,pids,page_url)
        elif isinstance(value,list):
            for n,v in enumerate(value):walk_urls(v,path+f'[{n}]',pids,page_url)
        elif isinstance(value,str) and re.match(r'^https?://',value) and re.search(r'\.(?:png|jpe?g|webp|gif|svg|avif|pdf)(?:[?#]|$)',value,re.I):
            media.append({'url':value,'source_ref':path,'project_ids':sorted(set(pids)&by_id.keys()),'source_project_ids':pids,'programme_ids':[], 'page_url':page_url,'section':path})
    for snap in tables['project_content_snapshots']:
        raw=snap.get('content_json'); ref='legacy:project_content_snapshots:'+snap['id']
        # Preserve content history only. Worker errors and unrelated source fields are omitted.
        history.append({**{k:snap[k] for k in ['id','campaign_project_id','source_url','content_hash','status','content_json','fetched_at','approved_at']},'source_table':'project_content_snapshots'})
        if snap['status']!='approved' or not isinstance(raw,dict):continue
        pids=links[snap['campaign_project_id']]; data=raw.get('project') or {}; url=snap['source_url']
        page_outcomes.append({'page_id':snap['campaign_project_id'],'snapshot_id':snap['id'],'source_project_ids':pids,'matched_project_ids':sorted(set(pids)&by_id.keys())})
        walk_urls(data,ref+'.project',pids,url)
        for key,value in data.items():
            path=ref+'.project.'+key
            if value in (None,'',[],{}):continue
            if key=='concept':
                cleaned,holds=safe_text(str(value)); prefix=page_names[snap['campaign_project_id']]
                add(path,'section',pids,{'title':{'th':'แนวคิดโครงการ'},'body':{'th':prefix+' — '+cleaned},'summary':{'th':cleaned[:220]},'source_text':value,'source_timezone':'unknown'},url,holds=holds)
            elif key=='faqs':
                for n,faq in enumerate(value):
                    if not isinstance(faq,dict):continue
                    q=faq.get('question','');a=faq.get('answer','');_,holds=safe_text(str(a))
                    add(path+f'[{n}]','faq',pids,{'canonical_question':{'th':q},'alt_questions':{'th':[]},'short_answer':{'th':page_names[snap['campaign_project_id']]+' — '+str(a)},'source_refs':[path+f'[{n}]'],'live_fact_key':None},url,holds=holds)
            elif key in ('facilities','nearby_places'):
                for n,item in enumerate(value if isinstance(value,list) else [value]):
                    add(path+f'[{n}]','facility' if key=='facilities' else 'nearby',pids,{'source_value':item,'as_of':None,'owner':'MKT project owner'},url,key)
            else:
                add(path,'fact',pids,{'fact_key':key,'source_value':value,'as_of':None,'owner':'MKT project owner','source_timezone':'unknown'},url,holds=['source_claim_requires_review'])
    # These source versions/classifications are evidence only. Current programme
    # captures already live in the pilot; do not turn historical review labels
    # or staff IDs into a new Hub approval.
    for table,fields in {
        'solution_content_snapshots':['id','solution_key','solution_name','source_url','content_hash','status','content_json','fetched_at','approved_at'],
        'project_media_assets':['id','campaign_project_id','project_content_snapshot_id','image_url','source_group','source_label','approved_tag','approved_secondary_tags','unit_type','review_status'],
    }.items():
        history.extend({**{k:row[k] for k in fields},'source_table':table} for row in tables[table])
    for row in tables['project_knowledge_items']:
        ref='legacy:project_knowledge_items:'+row['id']; pids=links[row['campaign_project_id']]
        history.append({**{k:row[k] for k in ['id','campaign_project_id','knowledge_key','category','sample_questions_json','answer_text','source_type','source_path','source_excerpt','status','content_hash','created_at','updated_at']},'source_table':'project_knowledge_items'})
        if row['status']!='active':continue
        questions=row.get('sample_questions_json') or []; text=row.get('answer_text') or ''; _,holds=safe_text(text)
        if questions:add(ref,'faq',pids,{'canonical_question':{'th':questions[0]},'alt_questions':{'th':questions[1:]},'short_answer':{'th':page_names[row['campaign_project_id']]+' — '+text},'live_fact_key':None,'source_refs':[ref]},holds=holds)
        else:add(ref,'section',pids,{'title':{'th':row['category']},'body':{'th':page_names[row['campaign_project_id']]+' — '+text},'summary':{'th':text[:220]}},holds=holds)
    # Lack of a demo flag is not proof that an upload is Brand/Project content.
    excluded_uploads=[]
    for row in working['assets']:
        if not local_upload_allowed(row,working['demo_asset_ids']):
            excluded_uploads.append({'asset_id':row['id'],'checksum':row['checksum'],'reason':'deleted_or_synthetic_or_not_content_reviewed'})
            continue
        file=(ROOT/'.local/assets'/row['storage_path']).resolve()
        require(file.is_relative_to(ROOT/'.local/assets') and file.is_file(),'missing_local_original')
        data=file.read_bytes();require(sha(data)==row['checksum'],'local_original_changed')
        content['assets'].append({k:row[k] for k in ['id','original_filename','mime_type','asset_type','storage_path','checksum','file_size','width','height','language']})
        locations[row['checksum']]=str(file)
    asset_ids={a['id'] for a in content['assets']}
    content['brand_assets']=[r for r in working['brand_assets'] if not r['deleted_at'] and r['asset_id'] in asset_ids]
    content['project_assets']=[r for r in working['entity_assets'] if not r['deleted_at'] and r['asset_id'] in asset_ids and r['project_id'] in valid_projects]
    file_index={}
    for capture in sorted((ROOT/'.local/knowledge-intake').iterdir()):
        fp=capture/'file-references.json'
        if capture.name.startswith('.') or not fp.is_file() or not (capture/'manifest.json').is_file():continue
        cm=read(capture/'manifest.json');raw=fp.read_bytes();require(sha(raw)==cm['files']['file-references.json']['sha256'],'capture_reference_changed')
        for row in json.loads(raw):
            if row.get('status')=='downloaded' and row.get('blob'):
                file_index[row['url']]={**row,'path':str((capture/row['blob']).resolve())}
    write(folder/'references.json',refs);write(folder/'content.json',content)
    write(folder/'base-candidates.json',candidates);write(folder/'legacy-history.json',history)
    write(folder/'legacy-media.json',media);write(folder/'known-files.json',file_index);write(folder/'local-file-locations.json',locations)
    missing={r['url'] for r in media if r['url'] not in file_index}
    write(folder/'collection-input.json',{'schema_version':1,'pages':[],'file_refs':[dict(r,kind='file',tag='IMG') for r in media if r['url'] in missing], 'source_evidence':{'legacy_sha256':LEGACY}})
    result={'status':'prepared_for_file_reconciliation','source_hashes':{'dw':DW,'brands':BRANDS,'legacy':LEGACY,'pilot':PILOT,'working_content':sha(working_raw)},'references':{k:len(v) for k,v in refs.items() if isinstance(v,list)},'content':{k:len(v) for k,v in content.items()},'candidates_before_media':len(candidates),'legacy_media_refs':len(media),'legacy_media_urls':len({r['url'] for r in media}),'missing_file_urls':len(missing),'page_outcomes':page_outcomes,'excluded_local_uploads':excluded_uploads}
    write(folder/'preparation.json',result);print(json.dumps({k:v for k,v in result.items() if k!='page_outcomes'}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--package',type=Path,required=True)
    try:prepare(parser.parse_args().package.resolve())
    except Exception as error:print(json.dumps({'error':str(error) if isinstance(error,ValueError) else type(error).__name__}));raise SystemExit(1)
