"""Private project-content and FAQ drafts. Every SQL entry rechecks authority."""
from __future__ import annotations

import json
import re
from typing import Any, Literal
from uuid import UUID

from fastapi import Depends, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .auth import Actor, failure
from .content_permissions import require_content, route_class
from .content_workflow import DecisionReason


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Draft(Input):
    expected_revision: int = Field(ge=0)
    changes: dict[str, Any] = Field(max_length=40)

    @field_validator('changes')
    @classmethod
    def bounded_content(cls, value):
        if len(json.dumps(value, ensure_ascii=False)) > 64000:
            raise ValueError('Content exceeds the draft limit')
        return value


class FactDraft(Draft):
    grain: str = Field(default='project', min_length=1, max_length=200)


class Revision(Input):
    expected_revision: int = Field(ge=1)


class QuestionDecision(Revision):
    decision: Literal['approved', 'retired']
    reason: DecisionReason | None = None


class GlossaryDecision(Revision):
    decision: Literal['active', 'retired']
    reason: DecisionReason | None = None


class Domain(Input):
    expected_revision: int = Field(ge=0)
    status: Literal['active', 'retired']


class TranslationReview(Revision):
    th_version: int = Field(ge=1)
    english: str = Field(min_length=1, max_length=12000, pattern=r'\S')


ALLOWED_SCOPE_TYPES = frozenset({'corporate', 'project_group', 'programme'})
SCOPE_ID_RE = re.compile(r'^[^\x00-\x1f/\\]{1,200}$')
SECTION_KEY_RE = re.compile(r'^[a-z][a-z0-9_.]{1,100}$')

SECTION_PROJECTION_SQL = """coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', s.id, 'section_key', s.section_key, 'revision', s.revision, 'state', s.state, 'version', to_jsonb(v),
        'history', (select coalesce(jsonb_agg(to_jsonb(h) order by version_no desc), '[]') from
            (select * from hub.content_section_versions where section_id = s.id order by version_no desc limit 50) h)
    ) order by s.section_key)
    from hub.content_sections s
    join lateral (select * from hub.content_section_versions where section_id = s.id order by version_no desc limit 1) v on true
    where s.scope_type = $1 and s.scope_id = $2
), '[]')"""


def register_project_content_routes(app, authentication, database):
    async def staff(request: Request, actor: Actor = Depends(authentication)):
        if require_content(request):
            return actor
        route = request.scope.get('route')
        boundary = route_class(request.method, getattr(route, 'path', None))
        level = 'view' if boundary == 'content_registry' else 'edit' if boundary == 'content_translation' else None
        capabilities = getattr(request.state, 'account', {}).get('capabilities', {})
        if level and any(capabilities.get('tabs', {}).get(tab, {}).get(level) is True for tab in ('projects', 'brands', 'knowledge', 'promotions')):
            return actor
        raise failure(403, 'content_permission', 'ไม่มีสิทธิ์เข้าถึงข้อมูลส่วนนี้')

    async def read(request, actor, sql, *args, reason=None):
        async with database(request, actor) as db:
            await db.execute("select set_config('app.content_review_reason',$1,true)", reason or '')
            return {'data': await db.fetchval(sql, *args)}

    @app.get('/v1/admin/content/fields')
    async def fields(request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.content_fields()')

    @app.patch('/v1/admin/content/fields/{field_key}')
    async def field_update(field_key: str, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.save_content_field($1,$2,$3)', field_key, body.expected_revision, body.changes)

    @app.put('/v1/admin/content/email-domains/{domain}')
    async def email_domain(domain: str, body: Domain, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.save_contact_domain($1,$2,$3)', domain, body.expected_revision, body.status)

    @app.post('/v1/admin/content/translations/{translation_id}/review')
    async def translation_review(translation_id: UUID, body: TranslationReview, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.review_content_translation($1,$2,$3,$4)', translation_id, body.expected_revision, body.th_version, body.english)

    @app.get('/v1/admin/content/glossary')
    async def glossary(request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.glossary_read()')

    @app.post('/v1/admin/content/translations/{translation_id}/retry')
    async def translation_retry(translation_id: UUID, body: Revision, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.retry_content_translation($1,$2)', translation_id, body.expected_revision)

    @app.put('/v1/admin/content/glossary/{term_key}')
    async def glossary_save(term_key: str, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.save_glossary($1,$2,$3)', term_key, body.expected_revision, body.changes)

    @app.post('/v1/admin/content/glossary/{term_key}/approve')
    async def glossary_approve(term_key: str, body: GlossaryDecision, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.approve_glossary($1,$2,$3)', term_key, body.expected_revision, body.decision, reason=body.reason)

    @app.get('/v1/admin/projects/{public_id}/content')
    async def project_content(public_id: str, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.project_content($1)', public_id)

    @app.put('/v1/admin/projects/{public_id}/facts/{fact_key}')
    async def fact(public_id: str, fact_key: str, body: FactDraft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.save_project_fact($1,$2,$3,$4,$5)', public_id, fact_key, body.grain, body.expected_revision, body.changes)

    @app.put('/v1/admin/projects/{public_id}/buildings/{building_key}')
    async def building(public_id: str, building_key: str, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.save_project_building($1,$2,$3,$4)', public_id, building_key, body.expected_revision, body.changes)

    @app.put('/v1/admin/projects/{public_id}/sections/{section_key}')
    async def section(public_id: str, section_key: str, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, "select hub.save_content_section('project',$1,$2,$3,$4)", public_id, section_key, body.expected_revision, body.changes)

    @app.post('/v1/admin/projects/{public_id}/sections/{section_key}/submit')
    async def section_submit(public_id: str, section_key: str, body: Revision, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, "select hub.submit_content_section('project',$1,$2,$3)", public_id, section_key, body.expected_revision)

    @app.post('/v1/admin/projects/{public_id}/selling-points')
    async def point_create(public_id: str, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.save_selling_point($1,null,$2,$3)', public_id, body.expected_revision, body.changes)

    @app.put('/v1/admin/projects/{public_id}/selling-points/{point_id}')
    async def point_save(public_id: str, point_id: UUID, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.save_selling_point($1,$2,$3,$4)', public_id, point_id, body.expected_revision, body.changes)

    @app.post('/v1/admin/projects/{public_id}/contacts')
    async def project_contact_create(public_id: str, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, "select hub.save_content_contact('project',$1,null,$2,$3)", public_id, body.expected_revision, body.changes)

    @app.put('/v1/admin/projects/{public_id}/contacts/{contact_id}')
    async def project_contact_save(public_id: str, contact_id: UUID, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, "select hub.save_content_contact('project',$1,$2,$3,$4)", public_id, contact_id, body.expected_revision, body.changes)

    @app.get('/v1/admin/brands/{public_id}/content')
    async def brand_content(public_id: str, request: Request, actor: Actor = Depends(staff)):
        return await read(
            request,
            actor,
            f"select jsonb_build_object('contacts',hub.content_contacts($1,$2),'sections',{SECTION_PROJECTION_SQL},'translations',hub.content_translation_list('brands',$2))",
            'brand',
            public_id,
        )

    @app.put('/v1/admin/brands/{public_id}/sections/{section_key}')
    async def brand_section(public_id: str, section_key: str, body: Draft, request: Request, actor: Actor = Depends(staff)):
        if not SECTION_KEY_RE.fullmatch(section_key):
            raise failure(422, 'invalid_section_key', 'รหัสหัวข้อเนื้อหาไม่ถูกต้อง')
        return await read(request, actor, "select hub.save_content_section('brand',$1,$2,$3,$4)", public_id, section_key, body.expected_revision, body.changes)

    @app.post('/v1/admin/brands/{public_id}/contacts')
    async def brand_contact_create(public_id: str, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, "select hub.save_content_contact('brand',$1,null,$2,$3)", public_id, body.expected_revision, body.changes)

    @app.put('/v1/admin/brands/{public_id}/contacts/{contact_id}')
    async def brand_contact_save(public_id: str, contact_id: UUID, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, "select hub.save_content_contact('brand',$1,$2,$3,$4)", public_id, contact_id, body.expected_revision, body.changes)

    @app.get('/v1/admin/content/scopes/{scope_type}/{scope_id}/content')
    async def scope_content(scope_type: str, scope_id: str, request: Request, actor: Actor = Depends(staff)):
        if actor.role not in {'viewer', 'editor', 'publisher', 'admin', 'online_staff'}:
            raise failure(403, 'content_permission', 'ไม่มีสิทธิ์เข้าถึงข้อมูลส่วนนี้')
        if scope_type not in ALLOWED_SCOPE_TYPES or not SCOPE_ID_RE.fullmatch(scope_id):
            raise failure(422, 'invalid_scope', 'ขอบเขตเนื้อหาไม่ถูกต้อง')
        return await read(
            request,
            actor,
            f"""select jsonb_build_object(
                'scope_type', $1::text,
                'scope_id', $2::text,
                'contacts', hub.content_contacts($1, $2),
                'sections', {SECTION_PROJECTION_SQL},
                'translations', coalesce((
                    select jsonb_agg(t) from jsonb_array_elements(hub.content_translation_list('knowledge', $2)) t
                    where t->>'owner_type' = 'section'
                      and exists(select 1 from hub.content_sections s where s.scope_type = $1 and s.scope_id = $2 and s.id::text = t->>'owner_key')
                ), '[]')
            )""",
            scope_type,
            scope_id,
        )

    @app.put('/v1/admin/content/scopes/{scope_type}/{scope_id}/sections/{section_key}')
    async def scope_section(scope_type: str, scope_id: str, section_key: str, body: Draft, request: Request, actor: Actor = Depends(staff)):
        if actor.role not in {'viewer', 'editor', 'publisher', 'admin', 'online_staff'}:
            raise failure(403, 'content_permission', 'ไม่มีสิทธิ์เข้าถึงข้อมูลส่วนนี้')
        if scope_type not in ALLOWED_SCOPE_TYPES or not SCOPE_ID_RE.fullmatch(scope_id) or not SECTION_KEY_RE.fullmatch(section_key):
            raise failure(422, 'invalid_scope', 'ขอบเขตหรือรหัสหัวข้อเนื้อหาไม่ถูกต้อง')
        return await read(request, actor, 'select hub.save_content_section($1,$2,$3,$4,$5)', scope_type, scope_id, section_key, body.expected_revision, body.changes)

    @app.get('/v1/admin/faq/corporate-contacts')
    async def corporate_contacts(request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, "select hub.content_contacts('corporate','sena')")

    @app.post('/v1/admin/faq/corporate-contacts')
    async def corporate_contact_create(body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, "select hub.save_content_contact('corporate','sena',null,$1,$2)", body.expected_revision, body.changes)

    @app.put('/v1/admin/faq/corporate-contacts/{contact_id}')
    async def corporate_contact_save(contact_id: UUID, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, "select hub.save_content_contact('corporate','sena',$1,$2,$3)", contact_id, body.expected_revision, body.changes)

    @app.get('/v1/admin/faq/questions')
    async def questions(request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.faq_question_list()')

    @app.put('/v1/admin/faq/questions/{question_key}')
    async def question_save(question_key: str, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.save_faq_question($1,$2,$3)', question_key, body.expected_revision, body.changes)

    @app.post('/v1/admin/faq/questions/{question_key}/approve')
    async def question_approve(question_key: str, body: QuestionDecision, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.approve_faq_question($1,$2,$3)', question_key, body.expected_revision, body.decision, reason=body.reason)

    @app.get('/v1/admin/faq')
    async def faq_list(request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.faq_read()')

    @app.get('/v1/admin/faq/references')
    async def faq_references(request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.faq_references()')

    @app.post('/v1/admin/faq')
    async def faq_create(body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.save_faq(null,$1,$2)', body.expected_revision, body.changes)

    @app.get('/v1/admin/faq/{faq_id}')
    async def faq_detail(faq_id: UUID, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, "select hub.faq_read($1)||jsonb_build_object('translations',hub.content_translation_list('knowledge',$1::text))", faq_id)

    @app.put('/v1/admin/faq/{faq_id}')
    async def faq_save(faq_id: UUID, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.save_faq($1,$2,$3)', faq_id, body.expected_revision, body.changes)

    @app.post('/v1/admin/faq/{faq_id}/submit')
    async def faq_submit(faq_id: UUID, body: Revision, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.submit_faq($1,$2)', faq_id, body.expected_revision)
