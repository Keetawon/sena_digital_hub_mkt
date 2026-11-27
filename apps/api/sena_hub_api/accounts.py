import asyncio
import hashlib
import io
import os
import re
import tempfile
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, Request, HTTPException
from fastapi.responses import Response
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, AwareDatetime, StrictBool, field_validator, model_validator

from .auth import Actor, failure
from .content_scopes import ContentScopeAssignment

ACCESS_FIELD_MESSAGES = {
    'display_name_th': 'กรอกชื่อและนามสกุลภาษาไทย ไม่เกิน 200 ตัวอักษร',
    'phone': 'กรอกเบอร์โทรศัพท์ 8–30 ตัวอักษร ใช้ตัวเลข ช่องว่าง วงเล็บ ขีด และ + ที่ต้นเบอร์เท่านั้น',
    'team': 'กรอกทีม / ฝ่าย ไม่เกิน 200 ตัวอักษร',
    'company_type': 'กรุณาเลือกประเภทบริษัท',
    'company_name': 'กรอกชื่อบริษัท ไม่เกิน 200 ตัวอักษร',
    'position': 'กรอกตำแหน่ง 1–100 ตัวอักษร',
    'requested_tasks': 'เลือกงานที่ต้องการทำอย่างน้อยหนึ่งข้อจากรายการ',
    'reason': 'กรอกเหตุผล หรือโครงการที่รับผิดชอบ ไม่เกิน 2,000 ตัวอักษร',
    'privacy_acknowledged': 'กรุณารับทราบประกาศความเป็นส่วนตัว',
}

ACCOUNT_ERRORS = {
    'account_self_decision': (403, 'ไม่สามารถตัดสินใจหรือเปลี่ยนสิทธิ์ของบัญชีตนเองได้'),
    'account_company_locked': (403, 'บัญชีเอเจนซีไม่สามารถเปลี่ยนประเภทหรือชื่อบริษัทด้วยตนเองได้'),
    'account_last_admin': (403, 'ต้องเหลือผู้ดูแลระบบที่ใช้งานอยู่ อย่างน้อยหนึ่งคน'),
    'account_agency_invalid': (422, 'กรุณาเลือกรหัสเอเจนซีที่ถูกต้องและยังใช้งานอยู่'),
    'account_reject_reason': (422, 'กรุณาระบุเหตุผลที่ปฏิเสธ'),
    'account_anonymised': (422, 'เปิดคำขออีกครั้งไม่ได้ เนื่องจากลบข้อมูลส่วนบุคคลแล้ว'),
    'account_suspend_reason': (422, 'กรุณาระบุเหตุผลที่ระงับบัญชี'),
    'account_company_invalid': (422, 'กรุณาเลือกประเภทบริษัทและกรอกชื่อบริษัทให้ครบถ้วน'),
    'account_position_invalid': (422, 'กรอกตำแหน่ง 1–100 ตัวอักษร'),
    'account_profile_invalid': (422, 'กรุณาตรวจชื่อภาษาไทย เบอร์โทร ทีม และการรับทราบความเป็นส่วนตัว'),
    'invite_exists': (409, 'มีคำเชิญที่ยังใช้งานได้สำหรับอีเมลนี้แล้ว'),
    'invite_role_invalid': (422, 'คำเชิญไม่สามารถให้สิทธิ์ผู้ดูแลระบบได้'),
    'invite_unavailable': (422, 'คำเชิญไม่พร้อมใช้งาน กรุณาตรวจสถานะแล้วส่งคำขอตามปกติ'),
    'permission_combination': (422, 'ชุดสิทธิ์ไม่ถูกต้อง กรุณาตรวจสิทธิ์ดู แก้ไข และอนุมัติ'),
    'permission_locked': (403, 'สิทธิ์ส่วนนี้ยังไม่เปิดให้ปรับ รอการตรวจสอบฐานข้อมูลให้ครบก่อน'),
    'permission_fixed_profile': (403, 'ไม่สามารถปรับตารางสิทธิ์ของบัญชีภายนอกหรือบัญชีที่ไม่ได้ใช้งาน'),
    'permission_admin_confirmation': (422, 'กรุณายืนยันการให้สิทธิ์จัดการผู้ใช้'),
    'template_version_stale': (409, 'แม่แบบเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่'),
    'permission_preview_stale': (409, 'ข้อมูลเปลี่ยนแล้ว กรุณาดูตัวอย่างสิทธิ์ใหม่ก่อนยืนยัน'),
}


class AccountProfile(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    display_name_th: str = Field(min_length=1, max_length=200, pattern='[ก-๙]')
    phone: str = Field(pattern=r'^\+?[0-9 ()-]{8,30}$')
    team: str = Field(min_length=1, max_length=200)
    company_type: Literal['SENA', 'SENA_SUBSIDIARY', 'AGENCY', 'CONTRACTOR']
    company_name: str | None = Field(default=None, max_length=200, validate_default=True)
    position: str = Field(min_length=1, max_length=100)
    privacy_acknowledged: Literal[True]

    @field_validator('company_name')
    @classmethod
    def company_required(cls, value, info):
        if info.data.get('company_type') not in (None, 'SENA') and not value:
            raise ValueError('Company name required')
        return value


class AccessRequest(AccountProfile):
    requested_tasks: list[Literal['read', 'edit', 'publish', 'online', 'agency']] = Field(min_length=1, max_length=5)
    reason: str = Field(min_length=1, max_length=2000)


class InviteAcceptance(AccountProfile):
    invite_id: UUID


class SelfProfileUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    display_name_th: str = Field(min_length=1, max_length=200, pattern='[ก-๙]')
    phone: str = Field(pattern=r'^\+?[0-9 ()-]{8,30}$')
    team: str = Field(min_length=1, max_length=200)
    company_type: Literal['SENA', 'SENA_SUBSIDIARY', 'AGENCY', 'CONTRACTOR']
    company_name: str | None = Field(default=None, max_length=200, validate_default=True)
    position: str = Field(min_length=1, max_length=100)

    @field_validator('company_name')
    @classmethod
    def company_required(cls, value, info):
        if info.data.get('company_type') not in (None, 'SENA') and not value:
            raise ValueError('Company name required')
        return value


AVATAR_MAX_BYTES = 2 * 1024 * 1024
AVATAR_FORMATS = {'JPEG', 'PNG', 'WEBP'}
AVATAR_MIME_TYPES = {'image/jpeg', 'image/png', 'image/webp'}
AVATAR_KEY_RE = re.compile(r'^avatars/[0-9a-f-]{36}/[0-9a-f]{64}\.webp$')


def _local_avatar_path(key: str) -> Path:
    from .assets import STORAGE_ROOT
    if not AVATAR_KEY_RE.fullmatch(key):
        raise failure(404, 'file_not_found', 'ไม่พบรูปโปรไฟล์ที่ระบุ')
    root = STORAGE_ROOT.resolve()
    target = (root / key).resolve()
    if root not in target.parents:
        raise failure(404, 'file_not_found', 'ไม่พบรูปโปรไฟล์ที่ระบุ')
    return target


def _write_local_avatar(key: str, content: bytes) -> None:
    path = _local_avatar_path(key)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_file():
        return
    temp = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.avatar-', delete=False) as handle:
            temp = Path(handle.name)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)


def _read_local_avatar(key: str, checksum: str, size: int) -> bytes:
    path = _local_avatar_path(key)
    if not path.is_file():
        raise failure(404, 'file_not_found', 'ไม่พบรูปโปรไฟล์')
    data = path.read_bytes()
    if len(data) != size or hashlib.sha256(data).hexdigest() != checksum:
        raise failure(503, 'file_unavailable', 'ไฟล์รูปโปรไฟล์ไม่ตรงกับข้อมูลอ้างอิง')
    return data


def _delete_local_avatar(key: str) -> None:
    try:
        path = _local_avatar_path(key)
        path.unlink(missing_ok=True)
    except (OSError, HTTPException):
        pass


def _normalize_avatar_webp(raw: bytes) -> bytes:
    if not raw or len(raw) > AVATAR_MAX_BYTES:
        raise failure(422, 'invalid_file', 'ไฟล์รูปโปรไฟล์ต้องมีขนาดไม่เกิน 2 MiB')
    head = raw[:512].lstrip().lower()
    if b'<svg' in head or head.startswith(b'<?xml'):
        raise failure(422, 'unsupported_file', 'รองรับเฉพาะไฟล์ภาพ PNG, JPEG หรือ WebP (ไม่รองรับ SVG)')
    from .upload_optimization import _private_decoding
    with _private_decoding():
        try:
            with Image.open(io.BytesIO(raw)) as img:
                if img.format not in AVATAR_FORMATS:
                    raise failure(422, 'unsupported_file', 'รองรับเฉพาะไฟล์ภาพ PNG, JPEG หรือ WebP')
                if img.width * img.height > 40_000_000:
                    raise failure(422, 'invalid_file', 'ขนาดความละเอียดภาพสูงเกินกำหนด')
                oriented = ImageOps.exif_transpose(img)
                mode = 'RGBA' if oriented.mode in ('RGBA', 'LA') or (oriented.mode == 'P' and 'transparency' in oriented.info) else 'RGB'
                converted = oriented.convert(mode)
                fitted = ImageOps.fit(converted, (256, 256), method=Image.Resampling.LANCZOS)
                buf = io.BytesIO()
                fitted.save(buf, format='WEBP', quality=84, method=4)
                output = buf.getvalue()
        except HTTPException:
            raise
        except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError, TypeError):
            raise failure(422, 'invalid_file', 'ไม่สามารถอ่านไฟล์รูปภาพได้ กรุณาเลือกไฟล์ PNG, JPEG หรือ WebP ที่สมบูรณ์') from None
    if not output or len(output) > AVATAR_MAX_BYTES:
        raise failure(422, 'invalid_file', 'ไฟล์รูปโปรไฟล์หลังแปลงมีขนาดเกินกำหนด')
    return output


async def _read_avatar_upload_bytes(request: Request) -> bytes:
    content_type = (request.headers.get('content-type') or '').split(';', 1)[0].strip().lower()
    if content_type in AVATAR_MIME_TYPES:
        data = await request.body()
        if len(data) > AVATAR_MAX_BYTES:
            raise failure(413, 'file_too_large', 'ไฟล์รูปโปรไฟล์ต้องมีขนาดไม่เกิน 2 MiB')
        return data
    if content_type == 'multipart/form-data':
        form = await request.form()
        file = form.get('file')
        if file is None or not hasattr(file, 'read'):
            raise failure(422, 'invalid_file', 'กรุณาเลือกไฟล์รูปโปรไฟล์')
        file_type = (getattr(file, 'content_type', '') or '').split(';', 1)[0].strip().lower()
        if file_type and file_type not in AVATAR_MIME_TYPES:
            raise failure(415, 'unsupported_file', 'รองรับเฉพาะไฟล์ภาพ PNG, JPEG หรือ WebP')
        data = await file.read(AVATAR_MAX_BYTES + 1)
        if len(data) > AVATAR_MAX_BYTES:
            raise failure(413, 'file_too_large', 'ไฟล์รูปโปรไฟล์ต้องมีขนาดไม่เกิน 2 MiB')
        return data
    raise failure(415, 'unsupported_file', 'รองรับเฉพาะไฟล์ภาพ PNG, JPEG หรือ WebP')


class TemplateRef(BaseModel):
    model_config = ConfigDict(extra='forbid')
    code: Literal['viewer', 'editor', 'publisher', 'admin', 'online_staff', 'agency']
    version: int = Field(gt=0, strict=True)


class InviteCreate(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    email: str = Field(max_length=254, pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
    display_hint: str = Field(default='', max_length=200)
    company_type: Literal['SENA', 'SENA_SUBSIDIARY', 'AGENCY', 'CONTRACTOR']
    company_name: str | None = Field(default=None, max_length=200)
    team: str = Field(default='', max_length=200)
    hub_role: Literal['viewer', 'editor', 'publisher', 'online_staff', 'agency'] | None = None
    template: TemplateRef | None = None
    agency_code: str | None = Field(default=None, max_length=20)


class InviteChange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['cancel', 'extend']
    expires_at: AwareDatetime


class Decision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['approve', 'role', 'suspend', 'reactivate', 'reject', 'reopen']
    hub_role: Literal['viewer', 'editor', 'publisher', 'admin', 'online_staff', 'agency'] | None = None
    agency_code: str | None = Field(default=None, max_length=20)
    note: str = Field(default='', max_length=2000)
    updated_at: AwareDatetime
    template: TemplateRef | None = None
    tabs: dict[str, list[str]] | None = Field(default=None, max_length=64)
    can_manage_users: StrictBool | None = None
    confirm_manage_users: StrictBool = False

    @model_validator(mode='after')
    def approval_fields(self):
        if self.action != 'approve' and self.model_fields_set & {
            'template', 'tabs', 'can_manage_users', 'confirm_manage_users'
        }:
            raise ValueError('Custom permissions require an approval or permission update')
        return self


class PermissionChange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    template: TemplateRef | None = None
    tabs: dict[str, list[str]] | None = Field(default=None, max_length=64)
    can_manage_users: StrictBool | None = None
    confirm_manage_users: StrictBool = False
    agency_code: str | None = Field(default=None, max_length=20)
    note: str = Field(default='', max_length=2000)
    updated_at: AwareDatetime


class AccountsSelection(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['accounts']
    account_ids: list[UUID] = Field(min_length=1, max_length=100)


class TemplateSelection(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['template']
    code: TemplateRef.__annotations__['code']


class TeamSelection(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    kind: Literal['team']
    team: str = Field(min_length=1, max_length=200)


class TemplateAssignment(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['template']
    template: TemplateRef


class TabAssignment(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['tab']
    tab: str = Field(min_length=1, max_length=64)
    levels: list[str] = Field(max_length=16)


class PermissionBatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    selection: Annotated[AccountsSelection | TemplateSelection | TeamSelection, Field(discriminator='kind')]
    change: Annotated[TemplateAssignment | TabAssignment | ContentScopeAssignment, Field(discriminator='kind')]
    note: str = Field(default='', max_length=2000)


class PermissionBatchApply(PermissionBatch):
    digest: str = Field(pattern='^[a-f0-9]{64}$')
    confirmed: Literal[True]


class PermissionNoticeAck(BaseModel):
    model_config = ConfigDict(extra='forbid')
    catalog_digest: str = Field(pattern='^[a-f0-9]{64}$')


def register_account_routes(app, authentication, database):
    @app.get('/v1/me')
    async def me(request: Request, actor: Actor = Depends(authentication)):
        if hasattr(request.state, 'content_scope'):
            scope = request.state.content_scope
        else:
            async with database(request, actor) as db:
                scope = await db.fetchval('select hub.content_scope_identity()')
        return {'data': {**request.state.account, 'content_scope': scope}}

    @app.post('/v1/me/access-request')
    @app.patch('/v1/me/access-request')
    async def submit(body: AccessRequest, request: Request, actor: Actor = Depends(authentication)):
        async with database(request, actor) as db:
            return {'data': await db.fetchval('select hub.submit_access_request($1::jsonb)', body.model_dump())}

    @app.post('/v1/me/invite-accept')
    async def accept(body: InviteAcceptance, request: Request, actor: Actor = Depends(authentication)):
        async with database(request, actor) as db:
            return {'data': await db.fetchval('select hub.accept_account_invite($1::jsonb)', body.model_dump(mode='json'))}

    async def human_actor(actor: Actor = Depends(authentication)) -> Actor:
        if actor.role not in ('admin', 'editor', 'publisher', 'viewer', 'online_staff', 'agency'):
            raise failure(403, 'forbidden', 'บัญชีผู้บริโภคบริการไม่สามารถจัดการโปรไฟล์บุคคลได้')
        return actor

    async def staff_actor(actor: Actor = Depends(authentication)) -> Actor:
        if actor.role not in ('admin', 'editor', 'publisher', 'viewer', 'online_staff'):
            raise failure(403, 'forbidden', 'เฉพาะทีมงาน')
        return actor

    @app.patch('/v1/me/profile')
    async def update_own_profile(body: SelfProfileUpdate, request: Request, actor: Actor = Depends(human_actor)):
        async with database(request, actor) as db:
            updated = await db.fetchval('select hub.update_own_profile($1::jsonb)', body.model_dump(mode='json'))
            scope = await db.fetchval('select hub.content_scope_identity()')
        return {'data': {**updated, 'role': actor.role, 'agency': actor.agency_code, 'content_scope': scope}}

    @app.post('/v1/me/avatar')
    async def upload_own_avatar(request: Request, actor: Actor = Depends(human_actor)):
        raw = await _read_avatar_upload_bytes(request)
        webp = await asyncio.to_thread(_normalize_avatar_webp, raw)
        checksum = hashlib.sha256(webp).hexdigest()
        key = f'avatars/{actor.id}/{checksum}.webp'
        storage = getattr(request.app.state, 'hosted_assets', None)
        if storage is not None:
            await asyncio.to_thread(storage.install_avatar, webp, key, checksum, len(webp))
        else:
            await asyncio.to_thread(_write_local_avatar, key, webp)
        async with database(request, actor) as db:
            res = await db.fetchval('select hub.set_own_avatar($1,$2,$3,$4)', key, checksum, 'image/webp', len(webp))
        prev = res.get('previous_object_key')
        if prev and prev != key:
            if storage is not None:
                await asyncio.to_thread(storage.delete_avatar, prev)
            else:
                await asyncio.to_thread(_delete_local_avatar, prev)
        return {'data': {'has_avatar': True, 'avatar_updated_at': res.get('avatar_updated_at')}}

    async def _remove_avatar(request: Request, actor: Actor):
        async with database(request, actor) as db:
            res = await db.fetchval('select hub.clear_own_avatar()')
        prev = res.get('previous_object_key')
        if prev:
            storage = getattr(request.app.state, 'hosted_assets', None)
            if storage is not None:
                await asyncio.to_thread(storage.delete_avatar, prev)
            else:
                await asyncio.to_thread(_delete_local_avatar, prev)
        return {'data': {'has_avatar': False, 'avatar_updated_at': None}}

    @app.delete('/v1/me/avatar')
    async def delete_own_avatar(request: Request, actor: Actor = Depends(human_actor)):
        return await _remove_avatar(request, actor)

    @app.post('/v1/me/avatar/remove')
    async def remove_own_avatar(request: Request, actor: Actor = Depends(human_actor)):
        return await _remove_avatar(request, actor)

    async def _serve_avatar(target_id: UUID, request: Request, actor: Actor):
        async with database(request, actor) as db:
            meta = await db.fetchval('select hub.read_avatar_metadata($1)', target_id)
        if not meta:
            raise failure(404, 'file_not_found', 'ยังไม่มีรูปโปรไฟล์')
        storage = getattr(request.app.state, 'hosted_assets', None)
        if storage is not None:
            content = await asyncio.to_thread(storage.read_avatar, meta['object_key'], meta['sha256'], meta['size_bytes'])
        else:
            content = await asyncio.to_thread(_read_local_avatar, meta['object_key'], meta['sha256'], meta['size_bytes'])
        return Response(
            content=content,
            media_type='image/webp',
            headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'},
        )

    @app.get('/v1/me/avatar')
    async def get_own_avatar(request: Request, actor: Actor = Depends(human_actor)):
        return await _serve_avatar(actor.id, request, actor)

    @app.get('/v1/accounts/{account_id}/avatar')
    async def get_account_avatar(account_id: UUID, request: Request, actor: Actor = Depends(staff_actor)):
        return await _serve_avatar(account_id, request, actor)

    @app.get('/v1/accounts/display-names')
    async def names(request: Request, actor: Actor = Depends(staff_actor)):
        async with database(request, actor) as db:
            return {'data': [dict(row) for row in await db.fetch('select * from hub.account_display_names()')]}

    async def admin(actor: Actor = Depends(authentication)):
        if not actor.can_manage_users:
            raise failure(403, 'forbidden', 'เฉพาะผู้ดูแลระบบ')
        return actor

    @app.get('/v1/admin/permissions/catalog')
    async def permission_catalog(request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as db:
            return {'data': await db.fetchval('select hub.permission_catalog_read()')}

    @app.post('/v1/admin/accounts/{account_id}/permissions')
    async def permissions(account_id: UUID, body: PermissionChange, request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as db:
            return {'data': await db.fetchval('select hub.configure_account_access($1,$2::jsonb)',
                account_id, body.model_dump(mode='json', exclude_unset=True))}

    @app.post('/v1/admin/permissions/preview')
    async def preview_permissions(body: PermissionBatch, request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as db:
            return {'data': await db.fetchval('select hub.preview_account_permissions($1::jsonb)', body.model_dump(mode='json'))}

    @app.post('/v1/admin/permissions/apply')
    async def apply_permissions(body: PermissionBatchApply, request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as db:
            return {'data': await db.fetchval('select hub.apply_account_permissions($1::jsonb,$2)',
                body.model_dump(mode='json', exclude={'digest', 'confirmed'}), body.digest)}

    @app.post('/v1/admin/permissions/notices/{tab}/ack')
    async def acknowledge_notice(tab: str, body: PermissionNoticeAck, request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as db:
            return {'data': await db.fetchval('select hub.ack_permission_notice($1,$2)', tab, body.catalog_digest)}

    @app.get('/v1/admin/accounts')
    async def accounts(request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as db:
            return {'data': await db.fetchval('select hub.account_directory()')}

    @app.get('/v1/admin/account-invites')
    async def invites(request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as db:
            return {'data': {'items': await db.fetchval('select hub.list_account_invites()'),
                             'login_url': (authentication.settings.admin_origin or 'http://127.0.0.1:3000') + '/login'}}

    @app.post('/v1/admin/account-invites')
    async def invite(body: InviteCreate, request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as db:
            result = await db.fetchval('select hub.create_invite($1::jsonb)', body.model_dump(mode='json', exclude_unset=True))
            if result.get('error') == 'account_exists':
                raise HTTPException(409, {'code': 'account_exists', 'message': 'มีบัญชีนี้แล้ว กรุณาจัดการบัญชีเดิม', 'account_id': result['account_id']})
            return {'data': result}

    @app.post('/v1/admin/account-invites/{invite_id}/decision')
    async def change_invite(invite_id: UUID, body: InviteChange, request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as db:
            return {'data': await db.fetchval('select hub.change_invite($1,$2,$3)', invite_id, body.action, body.expires_at)}

    @app.post('/v1/admin/accounts/{account_id}/decision')
    async def decide(account_id: UUID, body: Decision, request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as db:
            if body.action == 'approve':
                return {'data': await db.fetchval('select hub.approve_account_access($1,$2::jsonb)',
                    account_id, body.model_dump(mode='json', exclude_unset=True))}
            return {'data': await db.fetchval('select hub.decide_account($1,$2,$3,$4,$5,$6)', account_id,
                body.action, body.hub_role, body.agency_code, body.note, body.updated_at)}
