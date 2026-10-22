"""FAQ intake from existing candidates (docs/41 Phase 4). SQL rechecks Knowledge authority."""
from __future__ import annotations

import json
from typing import Any, Literal
from uuid import UUID

import asyncpg
from fastapi import Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .auth import Actor, failure
from .content_permissions import require_content

LEVELS = Literal['corporate', 'brand', 'programme', 'project_group', 'project', 'unit_type']
KINDS = Literal['text', 'fact', 'handoff', 'auto']
HOLDS = Literal['none', 'numeric', 'commercial', 'programme_terms', 'phase_decision', 'mapping_conflict', 'prompt_injection', 'closed_project']
STATES = Literal['open', 'held', 'question_proposed', 'decided']
# Thai explanations for the intake rules in hub.decide_faq_cluster; other 23514s keep the shared message.
RULES = {
    'Cluster already decided': 'กลุ่มนี้ตัดสินใจแล้ว หลักฐานยังเก็บไว้ในประวัติ',
    'Choose candidates from this cluster': 'เลือกคำถามจากกลุ่มนี้อย่างน้อยหนึ่งรายการ',
    'A rejection reason is required': 'ระบุเหตุผลที่ไม่ใช้กลุ่มนี้',
    'A hold reason is required': 'ระบุเหตุผลที่พักกลุ่มนี้ไว้',
    'Question key already exists': 'รหัสคำถามนี้มีอยู่แล้ว เลือกรหัสใหม่หรือใช้คำถามเดิม',
    'This cluster can only be rejected or held until its hold is resolved': 'กลุ่มนี้มีเงื่อนไขที่ต้องแก้ก่อน (เงื่อนไขโครงการบริการรอคำตอบ Q70 หรือมีข้อความไม่ปลอดภัย) ใช้ได้เพียงพักไว้หรือไม่ใช้',
    'Choose a Manager-approved question': 'เลือกคำถามมาตรฐานที่ Manager อนุมัติแล้ว',
    'Select explicit applicable REM phases': 'เลือกเฟส REM ที่คำตอบนี้ใช้ได้อย่างน้อยหนึ่งเฟส',
    'Commercial or numeric source text must be edited before saving': 'ข้อความเดิมมีราคา ตัวเลข หรือเงื่อนไขการขาย ต้องแก้ไขก่อนบันทึก ห้ามใช้ข้อความเดิมโดยไม่แก้',
    'A closed project cannot receive selling content': 'โครงการที่ปิดแล้วรับเนื้อหาการขายไม่ได้ นำเฟสที่ปิดแล้วออกหรือเขียนคำตอบที่ไม่ใช่การขาย',
    'An answer for this question and scope already exists; add a version to it': 'มีคำตอบสำหรับคำถามและขอบเขตนี้แล้ว เลือกเพิ่มเป็นฉบับใหม่ของคำตอบเดิม',
}


class Decision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_revision: int = Field(ge=1)
    decision: Literal['create', 'reject', 'hold', 'propose_question']
    changes: dict[str, Any] = Field(default_factory=dict, max_length=10)

    @field_validator('changes')
    @classmethod
    def bounded(cls, value):
        if len(json.dumps(value, ensure_ascii=False)) > 64000:
            raise ValueError('Decision exceeds the draft limit')
        return value


def register_faq_intake_routes(app, authentication, database):
    async def staff(request: Request, actor: Actor = Depends(authentication)):
        if require_content(request):
            return actor
        raise failure(403, 'content_permission', 'ไม่มีสิทธิ์เข้าถึงข้อมูลส่วนนี้')

    async def read(request, actor, sql, *args):
        try:
            async with database(request, actor) as db:
                return {'data': await db.fetchval(sql, *args)}
        except asyncpg.PostgresError as error:
            message = RULES.get(getattr(error, 'message', '')) if error.sqlstate == '23514' else None
            if message:
                raise failure(422, 'intake_rule', message) from None
            raise

    @app.get('/v1/admin/faq-intake/clusters')
    async def clusters(request: Request, actor: Actor = Depends(staff), level: LEVELS | None = None, kind: KINDS | None = None,
                       hold: HOLDS | None = None, brand: str | None = Query(None, max_length=64, pattern=r'^[A-Za-z0-9_-]+$'),
                       state: STATES | None = None, after: int = Query(0, ge=0), limit: int = Query(25, ge=1, le=100)):
        filters = {k: v for k, v in {'level': level, 'kind': kind, 'hold': hold, 'brand': brand, 'state': state}.items() if v}
        return await read(request, actor, 'select hub.faq_intake_clusters($1,$2,$3)', filters, after, limit)

    @app.get('/v1/admin/faq-intake/clusters/{cluster_id}')
    async def cluster(cluster_id: UUID, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.faq_intake_cluster($1)', cluster_id)

    @app.post('/v1/admin/faq-intake/clusters/{cluster_id}/decision')
    async def decide(cluster_id: UUID, body: Decision, request: Request, actor: Actor = Depends(staff)):
        return await read(request, actor, 'select hub.decide_faq_cluster($1,$2,$3,$4)', cluster_id, body.expected_revision, body.decision, body.changes)
