"""Prepare seven-project candidates from verified local public-source evidence. No DB writes."""
from __future__ import annotations
import argparse, asyncio, collections, csv, hashlib, json, re, sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid5,NAMESPACE_URL
from legacy_knowledge_dump import load

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'apps/api'))
from sena_hub_api.knowledge_retrieval import safe_text,normalize,keywords,embed,STATUS
from sena_hub_api import assets
PILOTS=['EKAMI','RAMK','BNA7','TPRAK','SK2TR','BPHGH','HYABC']
DW='6251c4663d85303caeb5bb7469d79bd00b022f64f470486afcf14db050955ed3'
BACKUP='c7a863cbad771a796cfaceed22cc9ea5a56eebd145503fb56687928adbab921b'
def read(p):return json.loads(Path(p).read_text(encoding='utf-8'))
def sha(data):return hashlib.sha256(data).hexdigest()
def write(p,v):Path(p).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def verify(folder,expected):
    if sha((folder/'manifest.json').read_bytes())!=expected:raise ValueError('manifest_mismatch')
    manifest=read(folder/'manifest.json')
    for name,meta in manifest['files'].items():
        p=(folder/name).resolve()
        if not p.is_relative_to(folder.resolve()):raise ValueError('unsafe_path')
        data=p.read_bytes()
        if sha(data)!=meta['sha256'] or len(data)!=meta['bytes']:raise ValueError('payload_mismatch')
    return manifest

async def prepare(args):
    cleanup=args.cleanup.resolve();verify(cleanup,args.manifest_sha256)
    if sha(args.backup.read_bytes())!=BACKUP:raise ValueError('backup_mismatch')
    original=ROOT/'.local/dw-project-intake'/DW/'original'
    if sha((original/'manifest.json').read_bytes())!=DW:raise ValueError('DW_manifest_mismatch')
    dw_manifest=read(original/'manifest.json');project_bytes=(original/'projects.json').read_bytes();meta=dw_manifest['files']['projects.json']
    if sha(project_bytes)!=meta['sha256'] or len(project_bytes)!=meta['bytes'] or len(json.loads(project_bytes))!=meta['row_count']:raise ValueError('DW_projects_payload_mismatch')
    projects={r['ProjectID']:r for r in json.loads(project_bytes)}
    if not set(PILOTS)<=projects.keys() or projects['TPRAK']['ProjectStatus']!='3' or projects['SK2TR']['ProjectStatus']!='1':raise ValueError('pilot_identity_or_status_conflict')
    out=ROOT/'.local/knowledge-pilot'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');out.mkdir(parents=True)
    items=[];cards=[];heldout=[];by_source_key={}
    def add(key,kind,pids,topic,evidence,url,ref,holds=(),programmes=()):
        shared={'TPRAK','SK2TR'}<=set(pids)
        row={'id':str(uuid5(NAMESPACE_URL,'sena-knowledge:'+key)),'source_key':key,'kind':kind,'project_ids':sorted(set(pids)),
             'programme_ids':list(programmes),'topic':topic,'evidence':evidence,'source_url':url,'source_ref':ref,
             'holds':sorted(set(holds)|({'needs_phase_decision'} if shared else set()))}
        if key in by_source_key:
            if by_source_key[key]!=row:raise ValueError('source_key_conflict:'+key)
            return by_source_key[key]
        by_source_key[key]=row;items.append(row);return row
    for pid in PILOTS:
        p=projects[pid];status=int(p['ProjectStatus'])
        cards.append({'rem_project_id':pid,'payload':{'name':{'th':p['ProjectName'],'en':p['ProjectNameEng']},'brand_id':p['BrandID'],'group_id':p['ProjectGroupID'],
            'status':{'raw':status,'label':STATUS.get(status,'ไม่ทราบสถานะ'),'as_of':'2026-10-05','source_ref':f'dw:{DW}/projects.json#{pid}'},
            'location':None,'bedroom_range':None,'area_sqm_range':None,'facility_codes':[],'nearby_places':[],'contacts':[],
            'as_of':{'identity':'2026-10-05','location':None,'unit_ranges':None,'facilities':None,'contacts':None},'mode':'DRAFT_PREVIEW','publication_version_id':None}})
        for alias in [pid,p['ProjectName'],p['ProjectNameEng']]:
            if alias:add('rem-alias:'+pid+':'+sha(alias.encode()),'alias',[pid],'identity',{'alias':alias,'normalized_alias':normalize(alias),'entity_type':'project','locale':'th'},None,f'dw:{DW}/projects.json#{pid}')
    # Business mapping includes aliases only, never internal average prices or staff email.
    with (ROOT/'.local/km-review/business-sheet.csv').open(encoding='utf-8-sig',newline='') as stream:
        for row in csv.DictReader(stream):
            pid=row['Project ID']
            if pid not in PILOTS:continue
            for field in ['Project','Project Name EN','Super Project Mapping','WARROOM NAME','LINE OA TAG NAME']:
                for value in re.split(r'[|\n]',row[field]):
                    if value.strip():add('business-alias:'+pid+':'+field+':'+sha(value.encode()),'alias',[pid],'identity',{'alias':value.strip(),'normalized_alias':normalize(value),'entity_type':'project','locale':'th'},row['Website URL'],'business-sheet:'+pid+':'+field)
    tables,_=load(args.backup)
    # Retain all vocabulary as non-project candidates unless an exact project mapping exists.
    terms={r['id']:r for r in tables['ai_language_terms']}
    for r in tables['ai_language_aliases']:
        term=terms[r['term_id']]
        pids=[p for p in PILOTS if normalize(r['alias_text']) in {normalize(projects[p]['ProjectName']),normalize(projects[p]['ProjectNameEng'] or ''),normalize(p)}]
        add('legacy-alias:'+r['id'],'alias',pids,'identity',{'alias':r['alias_text'],'normalized_alias':normalize(r['alias_text']),'entity_type':'project' if pids else 'knowledge_term','term':{k:term[k] for k in ['id','canonical_key','category','label_th','label_en']},'locale':r['language']},None,'legacy:ai_language_aliases:'+r['id'])
    for term in terms.values():add('legacy-term:'+term['id'],'alias',[],'identity',{'alias':term['label_th'],'normalized_alias':normalize(term['label_th']),'entity_type':'knowledge_term','term_id':term['id']},None,'legacy:ai_language_terms:'+term['id'])
    page_ids={'20':['RAMK'],'16':['BNA7'],'8':['TPRAK','SK2TR'],'49':['BPHGH'],'17':['HYABC']}
    snapshot_ids={'570','576','525','566','534'};faq_groups={}
    def text_candidate(key,pids,title,text,url,ref,topic='design',programmes=()):
        clean,holds=safe_text(str(text));prefix=' / '.join(projects[p]['ProjectName'] for p in pids) or ' / '.join(programmes)
        if clean.strip():add(key,'section',pids,topic,{'title':{'th':title},'body':{'th':prefix+' — '+clean},'summary':{'th':clean[:220]},'source_text':text,'source_timezone':'unknown'},url,ref,programmes=programmes)
        if holds:add(key+':held','fact',pids,topic,{'fact_key':'source_claim','source_value':text,'as_of':None,'owner':'MKT project owner','source_timezone':'unknown'},url,ref,holds,programmes)
    for snap in tables['project_content_snapshots']:
        if snap['id'] not in snapshot_ids:continue
        pids=page_ids[snap['campaign_project_id']];p=snap['content_json']['project'];url=snap['source_url'];ref='legacy:project_content_snapshots:'+snap['id']
        text_candidate(ref+':concept',pids,'แนวคิดโครงการ',p.get('concept',''),url,ref+'.project.concept')
        facts=p.get('facts') or {}
        for key,value in (facts.items() if isinstance(facts,dict) else enumerate(facts)):
            if value not in (None,'',[]):add(ref+':fact:'+str(key),'fact',pids,'identity',{'fact_key':str(key),'source_value':value,'as_of':None,'owner':'MKT project owner','source_timezone':'unknown'},url,ref+'.project.facts.'+str(key),['mapping_conflict'] if pids==['HYABC'] and re.search('unit|floor|building',str(key),re.I) else [])
        for kind,key in [('facility','facilities'),('nearby','nearby_places')]:
            for n,value in enumerate(p.get(key,[]) or []):add(ref+':'+key+':'+str(n),kind,pids,key,{'source_value':value,'as_of':None,'owner':'MKT project owner'},url,ref+'.project.'+key+'['+str(n)+']')
        for n,faq in enumerate(p.get('faqs',[])):
            question=faq.get('question','');answer=faq.get('answer','');_,holds=safe_text(answer)
            signature=normalize(question)+'\n'+normalize(answer)
            if signature in faq_groups:
                old=faq_groups[signature];old['project_ids']=sorted(set(old['project_ids']+pids));old['evidence']['source_refs'].append(ref+f'.project.faqs[{n}]');continue
            row=add('faq:'+sha(signature.encode()),'faq',pids,'design',{'canonical_question':{'th':question},'alt_questions':{'th':[]},'short_answer':{'th':answer},'source_refs':[ref+f'.project.faqs[{n}]'],'live_fact_key':None},url,ref+f'.project.faqs[{n}]',holds)
            faq_groups[signature]=row
    for r in tables['project_knowledge_items']:
        if r['campaign_project_id']!='16' or r['status']!='active':continue
        questions=r.get('sample_questions_json') or []
        item_key='legacy-km:'+r['id'];ref='legacy:project_knowledge_items:'+r['id']
        if questions:
            _,holds=safe_text(r['answer_text']);row=add(item_key,'faq',['BNA7'],'design',{'canonical_question':{'th':questions[0]},'alt_questions':{'th':questions[1:-1]},'short_answer':{'th':r['answer_text']},'source_refs':[ref],'live_fact_key':None},None,ref,holds)
            if len(questions)>1 and len(heldout)<14:heldout.append({'id':'legacy-heldout-'+r['id'],'prompt':questions[-1],'project_id':'BNA7','expected_candidate_id':row['id'],'expected_answer':r['answer_text'],'held_claim':bool(holds)})
        else:text_candidate(item_key,['BNA7'],r['category'],r['answer_text'],None,ref)
    capture=ROOT/'.local/knowledge-intake/2026-10-06T04-13-14-334Z-250abbaf'
    for n,page in enumerate(read(capture/'pages.json')):
        if page.get('coverage')=='partial_render_failed':add('coverage:'+str(n),'gap',page['project_ids'],'identity',{'gap_code':'EKAMI_RENDER_PARTIAL' if 'EKAMI' in page['project_ids'] else 'PAGE_RENDER_PARTIAL','detail':'เก็บ HTML ได้ แต่แสดงผลหน้าเว็บไม่ครบ','owner':'Web team'},page['url'],'crawler:page:'+str(n),programmes=page['programme_ids'])
        for i,s in enumerate(page.get('sections',[])):
            text_candidate(f'crawl:{n}:section:{i}',page['project_ids'],s['heading'],s['text'],page['url'],'crawler:'+s['locator'],programmes=page['programme_ids'])
    records=read(cleanup/'cleaned-files.json')
    for r in records:
        if r['decision']!='candidate':continue
        aliases=[u for v in records if v['canonical_sha256']==r['sha256'] for u in v['urls']]
        loc=r['locations'][0];data=(Path(loc['package'])/loc['blob']).read_bytes();metadata=None;error=None
        try:metadata=assets.validate_file(data,r['mime'],r['sha256']+'.'+{'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/svg+xml':'svg','application/pdf':'pdf'}.get(r['mime'],'bin'))
        except Exception:error='ไฟล์ต้นฉบับเกินขีดจำกัดหรือยังไม่ผ่านการตรวจความปลอดภัย ต้องตรวจแยกก่อนอนุมัติสิทธิ์'
        evidence={k:r[k] for k in ['sha256','bytes','mime','dimensions','classification','locations']}
        evidence.update(url_aliases=sorted(set(aliases)),validated_metadata=metadata,file_validation_error=error)
        add('asset:'+r['sha256'],'asset',r['project_ids'],'media_documents',evidence,r['urls'][0],'cleanup:'+r['sha256'],programmes=r['programme_ids'])
        promo=r['classification'].get('promotion')
        if r['classification']['role']=='promotion_banner':
            holds=[];promo=promo or {}
            if not promo.get('valid_from') or not promo.get('valid_to'):holds.append('undated_promotion')
            if promo.get('uncertainty') or re.search(r'\d[,=]+\d.*=|\d=\d|3,6=700',promo.get('verbatim_numeric_text') or ''):holds.append('invalid_promotion')
            add('promotion:'+r['sha256'],'promotion',r['project_ids'],'commercial_terms',{'image_sha256':r['sha256'],**promo,'review_state':'QUARANTINED' if holds else 'DRAFT_CANDIDATE','as_of':None,'rag_eligible':False},r['urls'][0],'vision:'+r['sha256'],holds,r['programme_ids'])
    for row in items:
        if row['kind']=='faq':
            prefix=' / '.join(projects[p]['ProjectName'] for p in row['project_ids'])
            row['evidence']['short_answer']['th']=prefix+' — '+row['evidence']['short_answer']['th']
    chunks=[]
    for row in items:
        if row['holds'] or not row['project_ids'] or row['kind'] not in ('section','faq'):continue
        evidence=row['evidence'];texts=[evidence['canonical_question']['th'],*evidence.get('alt_questions',{}).get('th',[])] if row['kind']=='faq' else [evidence['body']['th'][i:i+1800] for i in range(0,len(evidence['body']['th']),1800)]
        prefix=' / '.join(projects[p]['ProjectName'] for p in row['project_ids'])
        for variant,text in enumerate(texts):
            if row['kind']=='section':text=prefix+' — '+text
            chunks.append({'candidate_id':row['id'],'project_ids':row['project_ids'],'locale':'th','variant':variant,'chunk_text':text,'keywords':keywords(text),'content_sha256':sha(text.encode()),'embedding_model':'text-embedding-3-large'})
    write(out/'candidates.json',items);write(out/'fact-cards.json',cards);write(out/'heldout-legacy.json',heldout)
    cache={}
    if args.reuse_package:
        verify(args.reuse_package,args.reuse_manifest)
        cache={r['content_sha256']:r['embedding'] for r in read(args.reuse_package/'preview-chunks.json') if r['embedding_model']=='text-embedding-3-large' and len(r['embedding'])==1536 and sha(r['chunk_text'].encode())==r['content_sha256']}
    for r in chunks:
        if r['content_sha256'] in cache:r['embedding']=cache[r['content_sha256']]
    pending=[r for r in chunks if 'embedding' not in r]
    for start in range(0,len(pending),32):
        vectors=await embed([r['chunk_text'] for r in pending[start:start+32]])
        for r,v in zip(pending[start:start+32],vectors):r['embedding']=v
        print(json.dumps({'embedded':min(start+32,len(pending)),'total':len(pending)}),flush=True)
    write(out/'preview-chunks.json',chunks)
    summary={'candidates':len(items),'kinds':dict(collections.Counter(r['kind'] for r in items)),'holds':dict(collections.Counter(h for r in items for h in r['holds'])),'preview_chunks':len(chunks),'heldout':len(heldout),'published':0}
    write(out/'summary.json',summary)
    manifest={'contract_version':'sena-knowledge-pilot-v1','created_at':datetime.now(timezone.utc).isoformat(),'cleanup':{'folder':str(cleanup),'manifest_sha256':args.manifest_sha256},'backup_sha256':BACKUP,'dw_manifest_sha256':DW,'files':{}}
    for p in out.iterdir():
        data=p.read_bytes();manifest['files'][p.name]={'sha256':sha(data),'bytes':len(data),'rows':len(json.loads(data)) if p.name!='summary.json' else None}
    write(out/'manifest.json',manifest);print(json.dumps({'folder':str(out),'manifest_sha256':sha((out/'manifest.json').read_bytes()),**summary}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--cleanup',type=Path,required=True);parser.add_argument('--manifest-sha256',required=True);parser.add_argument('--backup',type=Path,default=Path(r'D:\tmp\sena-production-2026-10-05.sql.gz'));parser.add_argument('--reuse-package',type=Path);parser.add_argument('--reuse-manifest');args=parser.parse_args();asyncio.run(prepare(args))
