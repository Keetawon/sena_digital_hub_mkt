"""Local-only pre-intake review and private chatbot preview; no consumer publishing endpoints."""
from __future__ import annotations
import hashlib,json,re
from datetime import datetime
from pathlib import Path
from typing import Annotated,Literal
from uuid import UUID
from fastapi import Depends,Request
from fastapi.responses import FileResponse
from pydantic import BaseModel,ConfigDict,Field,StrictBool
from .auth import Actor,failure
from . import assets
from .knowledge_retrieval import embed,rank,route_question,answer_from_ranked,normalize
from .knowledge_progress import read_summaries
from .staff_media import thumbnails

ROOT=Path(__file__).resolve().parents[3]
PROGRAMMES={'LIVNEX':'LivNex','LIVNEX_GOLD':'LivNex Gold','RENTNEX':'RentNex','RENTNEX_BENEFIT':'RentNex Benefit','RENTNEX_INVEST':'RentNex Invest'}
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

def register_knowledge_routes(app,authentication,database,settings):
    async def staff(actor:Actor=Depends(authentication)):
        if settings.environment!='local':raise failure(403,'knowledge_local_only','คลังความรู้ระยะทดลองใช้ได้เฉพาะในเครื่อง')
        if actor.role not in {'editor','publisher','viewer','admin'}:raise failure(403,'knowledge_forbidden','ไม่มีสิทธิ์เข้าถึงคลังความรู้โครงการ')
        return actor
    async def writer(actor:Actor=Depends(staff)):
        if actor.role not in {'editor','admin'}:raise failure(403,'knowledge_review_forbidden','เฉพาะผู้แก้ไขหรือผู้ดูแลระบบที่ตรวจข้อมูลได้')
        return actor

    @app.get('/v1/admin/knowledge/projects')
    async def projects(request:Request,actor:Actor=Depends(staff)):
        async with database(request,actor) as db:
            rows=await db.fetch("SELECT rem_project_id,payload||jsonb_build_object('model_catalogue_complete',hub.knowledge_model_catalogue(rem_project_id)) AS payload FROM rag.project_fact_cards ORDER BY rem_project_id")
            counts=await db.fetch("SELECT p,count(*) AS count FROM hub.knowledge_candidate_rows() c CROSS JOIN LATERAL unnest(c.project_ids) p GROUP BY p")
            programmes=await db.fetch("SELECT p,count(*) AS count FROM hub.knowledge_candidate_rows() c CROSS JOIN LATERAL unnest(c.programme_ids) p GROUP BY p")
            vocabulary_count=await db.fetchval("SELECT count(*) FROM hub.knowledge_candidate_rows() WHERE kind='alias' AND cardinality(project_ids)=0")
            summaries=await read_summaries(db,[r['rem_project_id'] for r in rows])
            media=await thumbnails(db)
        totals={r['p']:r['count'] for r in counts}
        return {'data':[{'project_id':r['rem_project_id'],'card':r['payload'],'candidates':totals.get(r['rem_project_id'],0),'progress':summaries[r['rem_project_id']],
            'thumbnail':media['project'].get(r['rem_project_id']),'brand_logo':media['brand'].get(r['payload'].get('brand_id'))} for r in rows]+
            [{'project_id':r['p'],'card':{'name':{'th':PROGRAMMES.get(r['p'],r['p'])},'status':{'raw':None,'label':'เนื้อหาโปรแกรม รอตรวจขอบเขต'},'mode':'DRAFT_PREVIEW'},'candidates':r['count']} for r in programmes]+
            ([{'project_id':'KNOWLEDGE_TERMS','card':{'name':{'th':'คำศัพท์และชื่อเรียกกลาง'},'status':{'raw':None,'label':'คำศัพท์ ไม่ใช่โครงการ'},'mode':'DRAFT_PREVIEW'},'candidates':vocabulary_count}] if rows else [])}

    @app.get('/v1/admin/knowledge/projects/{project_id}')
    async def pack(project_id:str,request:Request,actor:Actor=Depends(staff)):
        async with database(request,actor) as db:
            card=await db.fetchval("SELECT payload||jsonb_build_object('model_catalogue_complete',hub.knowledge_model_catalogue(rem_project_id)) FROM rag.project_fact_cards WHERE rem_project_id=$1",project_id)
            if card is None and project_id not in {*PROGRAMMES,'KNOWLEDGE_TERMS'}:raise failure(404,'knowledge_not_found','ไม่พบโครงการนำร่องนี้')
            card=card or {'name':{'th':PROGRAMMES.get(project_id,'คำศัพท์และชื่อเรียกกลาง')},'status':{'raw':None,'label':'รอตรวจขอบเขตการใช้'},'mode':'DRAFT_PREVIEW'}
            rows=await db.fetch('''SELECT c.*,to_jsonb(r) AS review,
                coalesce(a.rights_status='approved' AND a.deleted_at IS NULL AND l.review_revision=r.revision
                  AND (a.effective_from IS NULL OR a.effective_from<=now()) AND (a.effective_to IS NULL OR a.effective_to>now()),false) AS rights_approved
                FROM hub.knowledge_candidate_rows() c LEFT JOIN hub.knowledge_reviews r ON r.candidate_id=c.id
                LEFT JOIN hub.knowledge_asset_links l ON l.candidate_id=c.id LEFT JOIN hub.assets a ON a.id=l.asset_id
                WHERE $1=ANY(c.project_ids) OR $1=ANY(c.programme_ids)
                  OR ($1='KNOWLEDGE_TERMS' AND c.kind='alias' AND cardinality(c.project_ids)=0) ORDER BY c.kind,c.source_key''',project_id)
            followup=await db.fetchval('SELECT hub.knowledge_followup($1)',project_id) or {}
        data=[]
        for record in rows:
            row=dict(record);row['bulk_rights_eligible']=bulk_eligible(row)
            # No filesystem paths in browser payloads.
            row['evidence']={k:v for k,v in row['evidence'].items() if k not in {'locations','validated_metadata'}}
            data.append(row)
        return {'data':{'card':card,'items':data,'followup':followup,'mode':'DRAFT_PREVIEW'}}

    @app.post('/v1/admin/knowledge/questions/{question_id}/review')
    async def question_review(question_id:str,body:QuestionReview,request:Request,actor:Actor=Depends(writer)):
        async with database(request,actor) as db:
            result=await db.fetchval('SELECT hub.review_knowledge_question($1,$2,$3,$4,$5)',question_id,body.expected_revision,body.decision,body.expected_answer,body.reason)
        return {'data':result}

    @app.post('/v1/admin/knowledge/projects/{project_id}/preview-release')
    async def preview_release(project_id:str,body:PreviewRelease,request:Request,actor:Actor=Depends(staff)):
        if actor.role!='publisher':raise failure(403,'preview_publisher_required','เฉพาะผู้เผยแพร่ที่ยืนยันชุดพรีวิวได้')
        if not body.confirmed:raise failure(422,'preview_confirmation_required','ต้องยืนยันพรีวิวอย่างชัดเจน')
        async with database(request,actor) as db:
            release=await db.fetchval('SELECT hub.publish_knowledge_preview($1,$2,$3)',project_id,{str(k):v for k,v in body.expected_reviews.items()},body.reason)
        return {'data':{'id':str(release),'mode':'PRIVATE_PREVIEW','published':False}}

    @app.post('/v1/admin/knowledge/candidates/{candidate_id}/review')
    async def review(candidate_id:UUID,body:Review,request:Request,actor:Actor=Depends(writer)):
        async with database(request,actor) as db:
            result=await db.fetchval('SELECT hub.review_knowledge_candidate($1,$2,$3,$4,$5,$6,$7,$8)',candidate_id,body.expected_revision,body.decision,body.applies_to_project_ids,body.reason,body.sena_owned,body.asset_role,body.alt_th)
        return {'data':result}

    @app.get('/v1/admin/knowledge/candidates/{candidate_id}/file')
    async def candidate_file(candidate_id:UUID,request:Request,actor:Actor=Depends(staff)):
        async with database(request,actor) as db:
            evidence=await db.fetchval("SELECT evidence FROM hub.knowledge_candidate_rows() WHERE id=$1 AND kind='asset'",candidate_id)
        if not evidence:raise failure(404,'knowledge_file_not_found','ไม่พบไฟล์ที่ร้องขอ')
        path=file_path(evidence)
        if not path.is_file():raise failure(404,'knowledge_file_not_found','ไม่พบไฟล์ต้นฉบับในเครื่อง')
        # SVG/HTML/PDF originals are attachments, never executable inline content.
        mime=evidence.get('mime','application/octet-stream')
        inline=mime in {'image/jpeg','image/png','image/webp','image/gif'}
        return FileResponse(path,media_type=mime if inline else 'application/octet-stream',
            filename=None if inline else evidence['sha256'],headers={'Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff'})

    @app.post('/v1/admin/knowledge/rights/approve')
    async def rights(body:Rights,request:Request,actor:Actor=Depends(staff)):
        if actor.role!='publisher':raise failure(403,'knowledge_rights_forbidden','เฉพาะผู้เผยแพร่ที่อนุมัติสิทธิ์ได้')
        if not body.confirmed or len({i.candidate_id for i in body.items})!=len(body.items):raise failure(422,'knowledge_confirmation','กรุณายืนยันรายการไฟล์ที่ไม่ซ้ำกัน')
        async with database(request,actor) as db:
            approved=[]
            # One DB transaction; a single ineligible/stale item rolls back every rights decision.
            for selected in sorted(body.items,key=lambda i:str(i.candidate_id)):
                record=await db.fetchval('SELECT hub.lock_knowledge_asset($1)',selected.candidate_id)
                if not record or not bulk_eligible(dict(record)) or record['review']['revision']!=selected.expected_revision:
                    raise failure(409,'knowledge_rights_ineligible','รายการเปลี่ยนแปลงหรือยังไม่ผ่านการยืนยันของ MKT กรุณาโหลดใหม่')
                evidence=record['evidence'];meta=evidence['validated_metadata'];data=file_path(evidence).read_bytes()
                if hashlib.sha256(data).hexdigest()!=evidence['sha256']:raise failure(409,'knowledge_integrity','ไฟล์ไม่ตรงกับหลักฐานที่นำเข้า')
                await db.execute('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',evidence['sha256'])
                result=await db.fetchval('SELECT hub.register_uploaded_asset($1::jsonb)',meta)
                asset=result['asset'];assets.install_file(data,meta)
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
            cards={r['rem_project_id']:r['payload'] for r in await db.fetch("SELECT rem_project_id,payload||jsonb_build_object('model_catalogue_complete',hub.knowledge_model_catalogue(rem_project_id)) AS payload FROM rag.project_fact_cards")}
            if body.project_id and body.project_id not in cards:raise failure(404,'knowledge_not_found','ไม่พบโครงการนำร่องนี้')
            project=body.project_id
            if not project:
                aliases=await db.fetch('''SELECT coalesce(r.applies_to_project_ids,c.project_ids) AS project_ids,c.evidence,
                  public.similarity($1,c.evidence->>'normalized_alias') AS similarity
                  FROM hub.knowledge_candidate_rows() c LEFT JOIN hub.knowledge_reviews r ON r.candidate_id=c.id
                  WHERE c.kind='alias' AND cardinality(c.project_ids)>0 AND (r.candidate_id IS NULL OR r.decision='accepted')
                  AND (strpos($1,c.evidence->>'normalized_alias')>0 OR public.similarity($1,c.evidence->>'normalized_alias')>.6)''',normalize(body.question))
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
                release=await db.fetchval('SELECT payload FROM hub.knowledge_preview_releases WHERE id=$1 AND rem_project_id=$2',body.release_id,project)
                if release is None:raise failure(404,'preview_release_not_found','ไม่พบชุดพรีวิวของโครงการนี้')
            card=release['fact_card'] if release else cards[project]
            routed=route_question(body.question,card)
            if routed:return {'data':{'route':routed[0],'answer':routed[1],'project_id':project,'fact_card':card,'citations':[{'source_ref':card['status']['source_ref'],'source_url':None}] if routed[0]=='closed' else [],'release_id':str(body.release_id) if release else None,'mode':'PRIVATE_PREVIEW' if release else 'DRAFT_PREVIEW'}}
        try:query_vector=(await embed([body.question]))[0]
        except Exception:raise failure(503,'knowledge_embedding_unavailable','บริการค้นหาความหมายยังไม่พร้อม กรุณาลองใหม่') from None
        if release:
            rows=release['chunks']
        else:
          async with database(request,actor) as db:
            rows=await db.fetch('''SELECT k.*,c.kind,c.evidence,c.source_url,c.source_ref,c.batch_sha256 FROM rag.knowledge_preview_chunks k
              JOIN hub.knowledge_candidate_rows() c ON c.id=k.candidate_id LEFT JOIN hub.knowledge_reviews r ON r.candidate_id=c.id
              WHERE $1=ANY(k.project_ids) AND k.locale='th'
                AND (cardinality(c.holds)=0 OR (c.holds <@ ARRAY['needs_phase_decision']::text[] AND r.decision='accepted'))
                AND (r.candidate_id IS NULL OR (r.decision='accepted' AND $1=ANY(r.applies_to_project_ids)))''',project)
        result=answer_from_ranked(rank([dict(r) for r in rows],query_vector,body.question))
        if result['route']=='no_answer':
            async with database(request,actor) as db:
                await db.execute("SELECT hub.record_knowledge_gap($1,'NO_ANSWER',$2)",project,hashlib.sha256(normalize(body.question).encode()).hexdigest())
        return {'data':{**result,'project_id':project,'fact_card':card,'release_id':str(body.release_id) if body.release_id else None,
            'mode':'PRIVATE_PREVIEW' if release else 'DRAFT_PREVIEW','warning':'ตัวอย่างส่วนตัว ยังไม่เผยแพร่สู่ผู้บริโภค'}}
