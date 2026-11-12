"""Pre-intake review; hosted TEST allows private files, never chatbot execution."""
from __future__ import annotations
import asyncio,hashlib,io,json,re
from datetime import datetime
from pathlib import Path
from typing import Annotated,Literal
from uuid import UUID
from fastapi import Depends,Request,HTTPException
from fastapi.responses import Response
from pydantic import BaseModel,ConfigDict,Field,StrictBool
from .auth import Actor,failure
from .provider_budget import ProviderBudgetExceeded
from .provider_messages import MESSAGES
from . import assets
from .knowledge_retrieval import embed,rank,route_question,answer_from_ranked,normalize
from .knowledge_progress import summarize
from .staff_media import THUMBNAILS_SQL
from .r2_assets import KNOWLEDGE_MAX_BYTES
from .content_permissions import require_content

ROOT=Path(__file__).resolve().parents[3]
PROGRAMMES={'LIVNEX':'LivNex','LIVNEX_GOLD':'LivNex Gold','RENTNEX':'RentNex','RENTNEX_BENEFIT':'RentNex Benefit','RENTNEX_INVEST':'RentNex Invest'}
PROJECTS_SQL=f'''WITH cards AS MATERIALIZED (
    SELECT rem_project_id,payload||jsonb_build_object('model_catalogue_complete',hub.knowledge_model_catalogue(rem_project_id)) AS payload
    FROM rag.project_fact_cards), candidates AS MATERIALIZED (
    SELECT c.project_ids,c.programme_ids,c.kind,c.holds,c.source_ref,
      CASE WHEN r.decision IS NOT NULL THEN jsonb_build_object('decision',r.decision,'reviewed_at',r.reviewed_at,'reviewed_by',r.reviewed_by) END AS review
    FROM hub.knowledge_candidate_rows() c LEFT JOIN hub.knowledge_reviews r ON r.candidate_id=c.id),
    media AS MATERIALIZED ({THUMBNAILS_SQL})
    SELECT 0 AS category,p.rem_project_id AS project_id,p.payload AS card,
      (SELECT count(*) FROM candidates c CROSS JOIN LATERAL unnest(c.project_ids) id WHERE id=p.rem_project_id) AS candidates,
      coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM candidates c WHERE p.rem_project_id=ANY(c.project_ids)),'[]') AS progress_candidates,
      (SELECT count(*) FROM hub.content_gaps g WHERE g.project_id=p.rem_project_id AND g.candidate_id IS NULL
        AND g.gap_code<>'NO_ANSWER' AND (g.question_key IS NULL OR g.state<>'resolved')) AS gaps,
      (SELECT jsonb_object_agg(source_id,image) FROM media WHERE kind='project')->p.rem_project_id AS thumbnail,
      (SELECT jsonb_object_agg(source_id,image) FROM media WHERE kind='brand')->(p.payload->>'brand_id') AS brand_logo
    FROM cards p
    UNION ALL SELECT 1,id,NULL,count(*),'[]',0,NULL,NULL FROM candidates c CROSS JOIN LATERAL unnest(c.programme_ids) id GROUP BY id
    UNION ALL SELECT 2,'KNOWLEDGE_TERMS',NULL,(SELECT count(*) FROM candidates WHERE kind='alias' AND cardinality(project_ids)=0),'[]',0,NULL,NULL
      WHERE EXISTS(SELECT 1 FROM cards)
    ORDER BY category,project_id'''

PACK_SQL='''WITH card AS MATERIALIZED (
    SELECT payload||jsonb_build_object('model_catalogue_complete',hub.knowledge_model_catalogue(rem_project_id)) AS payload
    FROM rag.project_fact_cards WHERE rem_project_id=$1), candidates AS MATERIALIZED (
    SELECT c.*,to_jsonb(r) AS review,
      coalesce(a.rights_status='approved' AND a.deleted_at IS NULL AND l.review_revision=r.revision
        AND (a.effective_from IS NULL OR a.effective_from<=now()) AND (a.effective_to IS NULL OR a.effective_to>now()),false) AS rights_approved
    FROM hub.knowledge_candidate_rows() c LEFT JOIN hub.knowledge_reviews r ON r.candidate_id=c.id
    LEFT JOIN hub.knowledge_asset_links l ON l.candidate_id=c.id LEFT JOIN hub.assets a ON a.id=l.asset_id
    WHERE $1=ANY(c.project_ids) OR $1=ANY(c.programme_ids)
      OR ($1='KNOWLEDGE_TERMS' AND c.kind='alias' AND cardinality(c.project_ids)=0)),
    faq_batches AS (SELECT array_agg(id) AS ids FROM (
      SELECT id,(row_number() OVER (ORDER BY id)-1)/500 AS batch FROM candidates WHERE kind='faq') numbered GROUP BY batch),
    faq_controls AS (SELECT control.* FROM faq_batches b CROSS JOIN LATERAL jsonb_each(hub.workspace_legacy_faq_candidates(b.ids)) control)
    SELECT CASE WHEN EXISTS(SELECT 1 FROM card) OR $1=ANY($2::text[]) THEN jsonb_build_object(
      'card',(SELECT payload FROM card),'items',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.kind,c.source_key) FROM candidates c),'[]'),
      'followup',coalesce(hub.knowledge_followup($1),'{}'),
      'faq_controls',coalesce((SELECT jsonb_object_agg(key,value) FROM faq_controls),'{}')) END'''

PREVIEW_CARDS_SQL='''WITH aliases AS MATERIALIZED (
    SELECT coalesce(r.applies_to_project_ids,c.project_ids) AS project_ids,c.evidence,
      public.similarity($1,c.evidence->>'normalized_alias') AS similarity
    FROM hub.knowledge_candidate_rows() c LEFT JOIN hub.knowledge_reviews r ON r.candidate_id=c.id
    WHERE c.kind='alias' AND cardinality(c.project_ids)>0 AND (r.candidate_id IS NULL OR r.decision='accepted')
      AND (strpos($1,c.evidence->>'normalized_alias')>0 OR public.similarity($1,c.evidence->>'normalized_alias')>.6))
    SELECT rem_project_id,payload||jsonb_build_object('model_catalogue_complete',hub.knowledge_model_catalogue(rem_project_id)) AS payload,
      coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM aliases a),'[]') AS aliases FROM rag.project_fact_cards'''

PREVIEW_SOURCE_SQL='''SELECT jsonb_build_object(
    'fact_card',p.payload||jsonb_build_object('model_catalogue_complete',hub.knowledge_model_catalogue(p.rem_project_id)),
    'chunks',coalesce((SELECT jsonb_agg(to_jsonb(k)||jsonb_build_object('kind',c.kind,'evidence',c.evidence,
      'source_url',c.source_url,'source_ref',c.source_ref,'batch_sha256',c.batch_sha256))
    FROM rag.knowledge_preview_chunks k JOIN hub.knowledge_candidate_rows() c ON c.id=k.candidate_id
    LEFT JOIN hub.knowledge_reviews r ON r.candidate_id=c.id
    WHERE $1=ANY(k.project_ids) AND k.locale='th'
      AND (cardinality(c.holds)=0 OR (c.holds <@ ARRAY['needs_phase_decision']::text[] AND r.decision='accepted'))
      AND (r.candidate_id IS NULL OR (r.decision='accepted' AND $1=ANY(r.applies_to_project_ids)))),'[]'))
    FROM rag.project_fact_cards p WHERE p.rem_project_id=$1'''

class Input(BaseModel):model_config=ConfigDict(extra='forbid')
class Review(Input):
    expected_revision:int=Field(ge=0)
    decision:Literal['accepted','rejected','missing']
    applies_to_project_ids:list[str]=Field(max_length=20)
    reason:str=Field(min_length=1,max_length=2000,pattern=r'\S')
    sena_owned:StrictBool=False
    asset_role:Literal['hero','gallery','master_plan','floor_plan','unit_plan','brochure','promotion_banner']|None=None
    alt_th:str|None=Field(default=None,max_length=1000)
class Selection(Input):
    candidate_id:UUID
    expected_revision:int=Field(ge=1)
class Rights(Input):
    items:list[Selection]=Field(min_length=1,max_length=50)
    reason:str=Field(min_length=1,max_length=2000,pattern=r'\S')
    confirmed:StrictBool
class Preview(Input):
    question:str=Field(min_length=1,max_length=1500,pattern=r'\S')
    project_id:str|None=Field(default=None,max_length=200)
    release_id:UUID|None=None
class QuestionReview(Input):
    expected_revision:int=Field(ge=0)
    decision:Literal['verified','rejected']
    expected_answer:str=Field(min_length=1,max_length=4000,pattern=r'\S')
    reason:str=Field(min_length=1,max_length=2000,pattern=r'\S')
class PreviewRelease(Input):
    expected_reviews:dict[UUID,Annotated[int,Field(ge=1)]]=Field(max_length=3000)
    reason:str=Field(min_length=1,max_length=2000,pattern=r'\S')
    confirmed:StrictBool

def file_path(evidence):
    # Only a server-derived checksum can select a private local file.
    sha=evidence.get('sha256','')
    if not re.fullmatch('[0-9a-f]{64}',sha):raise failure(422,'invalid_candidate_file','ข้อมูลไฟล์ต้นทางไม่ถูกต้อง')
    import os
    base=Path(os.environ.get('HUB_DISPOSABLE_TEST_RUN',ROOT/'.local'))/'knowledge-assets'
    root=base.resolve()
    path=root/sha
    if root!=base.absolute() or path.is_symlink() or path.resolve().parent!=root:
        raise failure(503,'knowledge_file_unavailable','ตำแหน่งจัดเก็บไฟล์ไม่ถูกต้อง กรุณาให้ผู้ดูแลตรวจสอบ')
    return path

def bulk_eligible(row):
    review=row.get('review') or {};evidence=row['evidence'];flags=evidence.get('classification',{})
    return (row['kind']=='asset' and review.get('decision')=='accepted' and review.get('sena_owned') is True
        and bool(review.get('applies_to_project_ids')) and all(flags.get(k)=='absent' for k in ('people','third_party_marks','stock_imagery'))
        and not evidence.get('file_validation_error') and evidence.get('validated_metadata') is not None)

def local_candidate_bytes(evidence):
    # Buffer a bounded original before the final authorization read. FileResponse
    # would open/stream the private file after the route had already returned.
    path=file_path(evidence)
    if not path.is_file():raise HTTPException(404)
    try:
        with path.open('rb') as source:return source.read(KNOWLEDGE_MAX_BYTES+1)
    except OSError:raise HTTPException(503) from None

def checked_candidate_bytes(content,evidence):
    expected_size=evidence.get('bytes',(evidence.get('validated_metadata') or {}).get('file_size'))
    if (not isinstance(content,bytes) or not 0<len(content)<=KNOWLEDGE_MAX_BYTES
        or hashlib.sha256(content).hexdigest()!=evidence.get('sha256')
        or expected_size is not None and (type(expected_size) is not int or len(content)!=expected_size)):
        raise HTTPException(503)
    return content

def private_thumbnail(content,evidence):
    metadata=evidence.get('validated_metadata') or {}
    if metadata.get('mime_type') not in {'image/png','image/jpeg','image/webp'}:
        raise failure(404,'knowledge_file_not_found','ไฟล์นี้ยังไม่มีภาพย่อที่ตรวจสอบแล้ว')
    data,checked=assets.prepare_upload(content,metadata['mime_type'],metadata.get('original_filename','candidate'))
    if checked['checksum']!=metadata.get('checksum'):
        raise failure(503,'knowledge_integrity','ไฟล์ไม่ตรงกับหลักฐานที่ตรวจสอบแล้ว')
    with assets.render_thumbnail(data,checked['mime_type']) as picture:
        picture.thumbnail((320,320))
        output=io.BytesIO();picture.save(output,'WEBP',quality=80)
        return output.getvalue()

def register_knowledge_routes(app,authentication,database,settings):
    async def staff(request:Request,actor:Actor=Depends(authentication)):
        # docs/48 W3 card: direct legacy evidence routes and files require actual Admin.
        account=getattr(request.state,'account',{})
        if account.get('status')!='ACTIVE' or account.get('hub_role')!='admin':
            raise HTTPException(403)
        if settings.environment!='local':
            if settings.environment!='hosted-test' or not settings.r2_credentials_file:
                raise failure(403,'knowledge_local_only','คลังความรู้ยังไม่พร้อมใช้งานในสภาพแวดล้อมนี้')
            if request.url.path.endswith(('/preview','/preview-release')):
                raise failure(503,'knowledge_preview_unavailable','ยังไม่เปิดทดลองคำตอบในพื้นที่ทดสอบนี้')
        require_content(request)
        return actor

    @app.get('/v1/admin/knowledge/projects')
    async def projects(request:Request,actor:Actor=Depends(staff)):
        actor=await staff(request,await authentication(request))
        async with database(request,actor) as db:
            projection=await db.fetch(PROJECTS_SQL)
        # All counts, progress and media come from the same guarded read.
        rows=[{'rem_project_id':r['project_id'],'payload':r['card']} for r in projection if r['category']==0]
        totals={r['project_id']:r['candidates'] for r in projection}
        summaries={r['project_id']:summarize(r['project_id'],r['progress_candidates'],r['gaps']) for r in projection if r['category']==0}
        media={'project':{r['project_id']:r['thumbnail'] for r in projection if r['category']==0},
               'brand':{r['card'].get('brand_id'):r['brand_logo'] for r in projection if r['category']==0}}
        programmes=[{'p':r['project_id'],'count':r['candidates']} for r in projection if r['category']==1]
        vocabulary_count=totals.get('KNOWLEDGE_TERMS',0)
        return {'data':[{'project_id':r['rem_project_id'],'card':r['payload'],'candidates':totals.get(r['rem_project_id'],0),'progress':summaries[r['rem_project_id']],
            'thumbnail':media['project'].get(r['rem_project_id']),'brand_logo':media['brand'].get(r['payload'].get('brand_id'))} for r in rows]+
            [{'project_id':r['p'],'card':{'name':{'th':PROGRAMMES.get(r['p'],r['p'])},'status':{'raw':None,'label':'เนื้อหาโปรแกรม รอตรวจขอบเขต'},'mode':'DRAFT_PREVIEW'},'candidates':r['count']} for r in programmes]+
            ([{'project_id':'KNOWLEDGE_TERMS','card':{'name':{'th':'คำศัพท์และชื่อเรียกกลาง'},'status':{'raw':None,'label':'คำศัพท์ ไม่ใช่โครงการ'},'mode':'DRAFT_PREVIEW'},'candidates':vocabulary_count}] if rows else [])}

    @app.get('/v1/admin/knowledge/projects/{project_id}')
    async def pack(project_id:str,request:Request,actor:Actor=Depends(staff)):
        actor=await staff(request,await authentication(request))
        async with database(request,actor) as db:
            projection=await db.fetchval(PACK_SQL,project_id,[*PROGRAMMES,'KNOWLEDGE_TERMS'])
        card=projection['card'] if projection else None
        if card is None and project_id not in {*PROGRAMMES,'KNOWLEDGE_TERMS'}:raise failure(404,'knowledge_not_found','ไม่พบโครงการนำร่องนี้')
        card=card or {'name':{'th':PROGRAMMES.get(project_id,'คำศัพท์และชื่อเรียกกลาง')},'status':{'raw':None,'label':'รอตรวจขอบเขตการใช้'},'mode':'DRAFT_PREVIEW'}
        rows=projection['items'];followup=projection['followup'];faq_controls=projection['faq_controls']
        data=[]
        for record in rows:
            row=dict(record);row['bulk_rights_eligible']=bulk_eligible(row)
            # No filesystem paths in browser payloads.
            row['evidence']={k:v for k,v in row['evidence'].items() if k not in {'locations','validated_metadata'}}
            if row['kind']=='faq':row.update(faq_controls.get(str(row['id']),{'read_only':True,'cluster_ids':[]}))
            data.append(row)
        return {'data':{'card':card,'items':data,'followup':followup,'mode':'DRAFT_PREVIEW'}}

    @app.post('/v1/admin/knowledge/questions/{question_id}/review')
    async def question_review(question_id:str,body:QuestionReview,request:Request,actor:Actor=Depends(staff)):
        async with database(request,actor) as db:
            result=await db.fetchval('SELECT hub.review_knowledge_question($1,$2,$3,$4,$5)',question_id,body.expected_revision,body.decision,body.expected_answer,body.reason)
        return {'data':result}

    @app.post('/v1/admin/knowledge/projects/{project_id}/preview-release')
    async def preview_release(project_id:str,body:PreviewRelease,request:Request,actor:Actor=Depends(staff)):
        if not body.confirmed:raise failure(422,'preview_confirmation_required','ต้องยืนยันพรีวิวอย่างชัดเจน')
        async with database(request,actor) as db:
            release=await db.fetchval('SELECT hub.publish_knowledge_preview($1,$2,$3)',project_id,{str(k):v for k,v in body.expected_reviews.items()},body.reason)
        return {'data':{'id':str(release),'mode':'PRIVATE_PREVIEW','published':False}}

    @app.post('/v1/admin/knowledge/candidates/{candidate_id}/review')
    async def review(candidate_id:UUID,body:Review,request:Request,actor:Actor=Depends(staff)):
        async with database(request,actor) as db:
            result=await db.fetchval('SELECT hub.review_knowledge_candidate($1,$2,$3,$4,$5,$6,$7,$8)',candidate_id,body.expected_revision,body.decision,body.applies_to_project_ids,body.reason,body.sena_owned,body.asset_role,body.alt_th)
        return {'data':result}

    @app.get('/v1/admin/knowledge/candidates/{candidate_id}/file')
    async def candidate_file(candidate_id:UUID,request:Request,thumbnail:bool=False,actor:Actor=Depends(staff)):
        query="SELECT evidence FROM hub.knowledge_candidate_rows() WHERE id=$1 AND kind='asset'"
        async with database(request,actor) as db:
            evidence=await db.fetchval(query,candidate_id)
        if not evidence:raise failure(404,'knowledge_file_not_found','ไม่พบไฟล์ที่ร้องขอ')
        hosted=settings.environment=='hosted-test'
        data=await asyncio.to_thread(request.app.state.hosted_assets.read_knowledge if hosted else local_candidate_bytes,evidence)
        data=checked_candidate_bytes(data,evidence)
        output=await asyncio.to_thread(private_thumbnail,data,evidence) if hosted and thumbnail else data
        actor=await staff(request,await authentication(request))
        async with database(request,actor) as db:
            current=await db.fetchval(query,candidate_id)
        if not current:raise HTTPException(404)
        if current!=evidence:raise HTTPException(409)
        headers={'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff'}
        if hosted and thumbnail:
            headers['Content-Security-Policy']="default-src 'none'"
            return Response(output,media_type='image/webp',headers=headers)
        mime=evidence.get('mime','application/octet-stream')
        inline=not hosted and mime in {'image/jpeg','image/png','image/webp','image/gif'}
        if not inline:headers['Content-Disposition']=f'attachment; filename="{evidence["sha256"]}"'
        if hosted:headers['X-Frame-Options']='DENY'
        return Response(output,media_type=mime if inline else 'application/octet-stream',headers=headers)

    @app.post('/v1/admin/knowledge/rights/approve')
    async def rights(body:Rights,request:Request,actor:Actor=Depends(staff)):
        if not body.confirmed or len({i.candidate_id for i in body.items})!=len(body.items):raise failure(422,'knowledge_confirmation','กรุณายืนยันรายการไฟล์ที่ไม่ซ้ำกัน')
        async with database(request,actor) as db:
            approved=[]
            # One DB transaction; a single ineligible/stale item rolls back every rights decision.
            for selected in sorted(body.items,key=lambda i:str(i.candidate_id)):
                record=await db.fetchval('SELECT hub.lock_knowledge_asset($1)',selected.candidate_id)
                if not record or not bulk_eligible(dict(record)) or record['review']['revision']!=selected.expected_revision:
                    raise failure(409,'knowledge_rights_ineligible','รายการเปลี่ยนแปลงหรือยังไม่ผ่านการยืนยันของ MKT กรุณาโหลดใหม่')
                evidence=record['evidence'];meta=dict(evidence['validated_metadata'])
                data=(await asyncio.to_thread(request.app.state.hosted_assets.read_knowledge,evidence)
                      if settings.environment=='hosted-test' else file_path(evidence).read_bytes())
                if hashlib.sha256(data).hexdigest()!=evidence['sha256']:raise failure(409,'knowledge_integrity','ไฟล์ไม่ตรงกับหลักฐานที่นำเข้า')
                if settings.environment=='hosted-test':
                    data,checked=await asyncio.to_thread(assets.prepare_upload,data,meta['mime_type'],meta['original_filename'])
                    if checked['checksum']!=meta['checksum']:raise failure(409,'knowledge_integrity','ผลตรวจไฟล์เปลี่ยนแล้ว กรุณาตรวจหลักฐานใหม่')
                    meta.update(storage_provider=request.app.state.hosted_assets.provider,storage_bucket=request.app.state.hosted_assets.bucket)
                await db.execute('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',evidence['sha256'])
                result=await db.fetchval('SELECT hub.register_uploaded_asset($1::jsonb)',meta)
                asset=result['asset']
                if settings.environment=='hosted-test':
                    await asyncio.to_thread(request.app.state.hosted_assets.install,data,{**meta,'source_system':'hub-hosted-test'})
                    await asyncio.to_thread(assets.install_thumbnail,data,meta)
                else:assets.install_file(data,meta)
                await db.fetchval("SELECT hub.review_asset($1,$2,'approved',$3,NULL,NULL,$3)",UUID(asset['id']),datetime.fromisoformat(asset['updated_at']),body.reason)
                await db.execute('SELECT hub.knowledge_link_approved_asset($1,$2,$3)',selected.candidate_id,UUID(asset['id']),selected.expected_revision)
                approved.append(str(selected.candidate_id))
        return {'data':{'approved':approved,'published':False}}

    @app.post('/v1/admin/knowledge/preview')
    async def preview(body:Preview,request:Request,actor:Actor=Depends(staff)):
        # No raw customer messages enter logs or a retrieval namespace.
        if re.search(r'[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}|(?:\+66|0)[0-9 -]{8,}',body.question):
            raise failure(422,'knowledge_private_input','กรุณาลบข้อมูลติดต่อส่วนบุคคลก่อนทดลองคำถาม')
        global_route=route_question(body.question,{})
        if global_route and (global_route[0] in {'unsafe_instruction','private_request'} or global_route[0]=='deferred_solar' and body.project_id is None):
            return {'data':{'route':global_route[0],'answer':global_route[1],'citations':[],'mode':'DRAFT_PREVIEW'}}
        if body.project_id in PROGRAMMES or body.project_id=='KNOWLEDGE_TERMS':
            routed=global_route or ('owner_review_handoff','เนื้อหาและกติกาโปรแกรมยังรอเจ้าของข้อมูลตรวจขอบเขตและช่วงใช้ได้ กรุณาติดต่อเจ้าหน้าที่')
            return {'data':{'route':routed[0],'answer':routed[1],'citations':[],'mode':'DRAFT_PREVIEW'}}
        async with database(request,actor) as db:
            records=await db.fetch(PREVIEW_CARDS_SQL,normalize(body.question))
            cards={r['rem_project_id']:r['payload'] for r in records}
            if body.project_id and body.project_id not in cards:raise failure(404,'knowledge_not_found','ไม่พบโครงการนำร่องนี้')
            project=body.project_id
            if not project:
                aliases=records[0].get('aliases',[]) if records else []
                normalized=normalize(body.question);matches=set()
                for row in aliases:
                    alias=normalize(row['evidence'].get('alias',''))
                    if len(alias)>2 and (alias in normalized or row['similarity']>.6):matches.update(p for p in row['project_ids'] if p in cards)
                for pid in cards:
                    if re.search(r'(?<![A-Za-z0-9])'+re.escape(pid)+r'(?![A-Za-z0-9])',body.question,re.I):matches.add(pid)
                if len(matches)==1:project=next(iter(matches))
                else:return {'data':{'route':'clarify_project','answer':'กรุณาระบุโครงการหรือระยะที่ต้องการให้ชัดเจน','choices':sorted(matches or cards),'citations':[],'mode':'DRAFT_PREVIEW'}}
            release=None
            if body.release_id:
                release=await db.fetchval('SELECT hub.knowledge_preview_read($1,$2)',body.release_id,project)
                if release is None:raise failure(404,'preview_release_not_found','ไม่พบชุดพรีวิวของโครงการนี้')
            card=release['fact_card'] if release else cards[project]
            routed=route_question(body.question,card)

        async def current_source():
            nonlocal actor
            actor=await staff(request,await authentication(request))
            async with database(request,actor) as db:
                source=await db.fetchval('SELECT hub.knowledge_preview_read($1,$2)',body.release_id,project) if body.release_id else await db.fetchval(PREVIEW_SOURCE_SQL,project)
            if body.release_id:
                if source is None:raise failure(404,'preview_release_not_found','ไม่พบชุดพรีวิวของโครงการนี้')
            elif source is None:raise HTTPException(404)
            return source

        def response(source,vector):
            card=source['fact_card'];release=body.release_id is not None
            routed=route_question(body.question,card)
            if routed:return {'data':{'route':routed[0],'answer':routed[1],'project_id':project,'fact_card':card,'citations':[{'source_ref':card['status']['source_ref'],'source_url':None}] if routed[0]=='closed' else [],'release_id':str(body.release_id) if release else None,'mode':'PRIVATE_PREVIEW' if release else 'DRAFT_PREVIEW'}}
            result=answer_from_ranked(rank([dict(r) for r in source['chunks']],vector,body.question))
            return {'data':{**result,'project_id':project,'fact_card':card,'release_id':str(body.release_id) if body.release_id else None,
                'mode':'PRIVATE_PREVIEW' if release else 'DRAFT_PREVIEW','warning':'ตัวอย่างส่วนตัว ยังไม่เผยแพร่สู่ผู้บริโภค'}}

        if routed:
            source=await current_source()
            if route_question(body.question,source['fact_card']):return response(source,None)
        try:query_vector=(await embed([body.question]))[0]
        except ProviderBudgetExceeded as error:
            async with database(request,actor) as db:
                await db.fetchval("SELECT hub.provider_budget_event('knowledge',$1)",error.code)
            raise failure(503,'knowledge_budget',MESSAGES['knowledge_budget']) from None
        except Exception:raise failure(503,'knowledge_embedding_unavailable','บริการค้นหาความหมายยังไม่พร้อม กรุณาลองใหม่') from None
        # Only a newly authorized projection may populate the response.
        result=response(await current_source(),query_vector)
        if result['data']['route']=='no_answer':
            async with database(request,actor) as db:
                await db.execute("SELECT hub.record_knowledge_gap($1,'NO_ANSWER',$2)",project,hashlib.sha256(normalize(body.question).encode()).hexdigest())
            result=response(await current_source(),query_vector)
        return result
