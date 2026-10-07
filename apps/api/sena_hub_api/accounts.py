from typing import Literal
from uuid import UUID

from fastapi import Depends, Request
from pydantic import BaseModel, ConfigDict, Field, AwareDatetime

from .auth import Actor, failure

ACCESS_FIELD_MESSAGES = {
    'display_name_th': 'กรอกชื่อและนามสกุลภาษาไทย ไม่เกิน 200 ตัวอักษร',
    'phone': 'กรอกเบอร์โทรศัพท์ 8–30 ตัวอักษร ใช้ตัวเลข ช่องว่าง วงเล็บ ขีด และ + ที่ต้นเบอร์เท่านั้น',
    'team': 'กรอกทีม หรือบริษัทเอเจนซี ไม่เกิน 200 ตัวอักษร',
    'requested_tasks': 'เลือกงานที่ต้องการทำอย่างน้อยหนึ่งข้อจากรายการ',
    'reason': 'กรอกเหตุผล หรือโครงการที่รับผิดชอบ ไม่เกิน 2,000 ตัวอักษร',
    'privacy_acknowledged': 'กรุณารับทราบประกาศความเป็นส่วนตัว',
}

ACCOUNT_ERRORS = {
    'account_self_decision': (403, 'ไม่สามารถตัดสินใจหรือเปลี่ยนสิทธิ์ของบัญชีตนเองได้'),
    'account_last_admin': (403, 'ต้องเหลือผู้ดูแลระบบที่ใช้งานอยู่ อย่างน้อยหนึ่งคน'),
    'account_agency_invalid': (422, 'กรุณาเลือกรหัสเอเจนซีที่ถูกต้องและยังใช้งานอยู่'),
    'account_reject_reason': (422, 'กรุณาระบุเหตุผลที่ปฏิเสธ'),
    'account_anonymised': (422, 'เปิดคำขออีกครั้งไม่ได้ เนื่องจากลบข้อมูลส่วนบุคคลแล้ว'),
}


class AccessRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    display_name_th: str = Field(min_length=1, max_length=200, pattern='[ก-๙]')
    phone: str = Field(pattern=r'^\+?[0-9 ()-]{8,30}$')
    team: str = Field(min_length=1, max_length=200)
    requested_tasks: list[Literal['read', 'edit', 'publish', 'online', 'agency']] = Field(min_length=1, max_length=5)
    reason: str = Field(min_length=1, max_length=2000)
    privacy_acknowledged: Literal[True]


class Decision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['approve', 'role', 'suspend', 'reactivate', 'reject', 'reopen']
    hub_role: Literal['viewer', 'editor', 'publisher', 'admin', 'online_staff', 'agency'] | None = None
    agency_code: str | None = Field(default=None, max_length=20)
    note: str = Field(default='', max_length=2000)
    updated_at: AwareDatetime


def register_account_routes(app, authentication, database):
    @app.get('/v1/me')
    async def me(request: Request, actor: Actor = Depends(authentication)):
        return {'data': request.state.account}

    @app.post('/v1/me/access-request')
    @app.patch('/v1/me/access-request')
    async def submit(body: AccessRequest, request: Request, actor: Actor = Depends(authentication)):
        async with database(request, Actor(actor.id, 'viewer')) as db:
            return {'data': await db.fetchval('select hub.submit_access_request($1::jsonb)', body.model_dump())}

    @app.get('/v1/accounts/display-names')
    async def names(request: Request, actor: Actor = Depends(authentication)):
        if actor.role not in ('admin', 'editor', 'publisher', 'viewer', 'online_staff'):
            raise failure(403, 'forbidden', 'เฉพาะทีมงาน')
        async with database(request, actor) as db:
            return {'data': [dict(row) for row in await db.fetch('select * from hub.account_display_names()')]}

    async def admin(actor: Actor = Depends(authentication)):
        if actor.role != 'admin':
            raise failure(403, 'forbidden', 'เฉพาะผู้ดูแลระบบ')
        return actor

    @app.get('/v1/admin/accounts')
    async def accounts(request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as db:
            rows = await db.fetch('select * from hub.user_account order by created_at desc')
            events = await db.fetch('select * from hub.user_account_event order by created_at desc')
            agencies = await db.fetch("select code,label_th from ads.vocab where vocab_type='AGENCY' and status='ACTIVE' and alias_of is null order by code")
            return {'data': {'items': [dict(r) for r in rows], 'events': [dict(r) for r in events], 'agencies': [dict(r) for r in agencies]}}

    @app.post('/v1/admin/accounts/{account_id}/decision')
    async def decide(account_id: UUID, body: Decision, request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as db:
            return {'data': await db.fetchval('select hub.decide_account($1,$2,$3,$4,$5,$6)', account_id,
                body.action, body.hub_role, body.agency_code, body.note, body.updated_at)}
