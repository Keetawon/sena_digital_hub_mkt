"""Private naming registry: structured inputs, trusted actors, transaction-scoped RLS."""
from contextlib import asynccontextmanager
from typing import Annotated, Literal
from uuid import UUID

import asyncpg
from fastapi import Depends, Query, Request
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .auth import Actor, failure
from . import naming

ScopeKind = Literal["A", "B", "C", "D", "E", "F"]


def exact_source_id(value: str) -> str:
    if not value.strip() or "\x00" in value:
        raise ValueError("รหัสต้นทางต้องไม่ว่างและไม่มีอักขระ NUL")
    return value


SourceId = Annotated[str, StringConstraints(min_length=1, max_length=200, strict=True), AfterValidator(exact_source_id)]
Token = Annotated[str, StringConstraints(pattern=r"^[A-Z0-9-]{1,24}$")]
KINDS = {"A": ("GROUP",), "B": ("PHASE",), "C": ("MULTI_PHASE",), "D": ("ZONE",),
         "E": ("BRAND",), "F": ("CORP", "BU")}


class RegistrationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scope_kind: ScopeKind
    scope_id: UUID | None = None
    parent_group_id: SourceId | None = None
    member_ids: list[SourceId] = Field(default_factory=list, max_length=100)
    objective: Literal["LEADS", "TRAFFIC", "AWARENESS", "ENGAGEMENT", "SALES", "VIDEOVIEWS", "CONVERSION"]
    agency: Annotated[str, StringConstraints(pattern=r"^[A-Z0-9]{2,20}$")]
    variant: Token | None = None
    content_label: Annotated[str, StringConstraints(pattern=r"^[A-Z0-9][A-Z0-9 .\-]{0,39}$")] | None = None
    content_label_approved: bool = Field(default=False, strict=True)

    @model_validator(mode="after")
    def exact_selection(self):
        if self.scope_kind in {"C", "D"}:
            if self.scope_id is not None or len(self.member_ids) < 2 or len(set(self.member_ids)) != len(self.member_ids):
                raise ValueError("กรุณาเลือกสมาชิกต่างกันอย่างน้อยสองรายการ")
            if (self.scope_kind == "C") != (self.parent_group_id is not None):
                raise ValueError("กรุณาเลือกกลุ่มแม่สำหรับหลายเฟสของโครงการเดียว")
        elif self.scope_id is None or self.member_ids or self.parent_group_id is not None:
            raise ValueError("กรุณาเลือกขอบเขตจากทะเบียนโดยไม่ส่งสมาชิกเพิ่ม")
        if self.content_label is not None and (self.scope_kind != "F" or not self.content_label_approved):
            raise ValueError("ชื่อเนื้อหาต้องเป็นรายการองค์กรที่ทีมออนไลน์ยืนยันว่าอนุมัติแล้ว")
        if self.content_label is None and self.content_label_approved:
            raise ValueError("กรุณาระบุชื่อเนื้อหาที่ได้รับอนุมัติ")
        return self


class VariantInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    variant: Token | None


class BindingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name_id: UUID
    platform: Literal["META", "GOOGLE", "TIKTOK", "CHATGPT"]
    account_id: SourceId
    campaign_id: SourceId

class ObservedName(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=1000)


def decorate_detail(result):
    if result is None:
        raise failure(404, "not_found", "ไม่พบรายการที่มีสิทธิ์เข้าถึง")
    for name in result["names"]:
        name.update(naming.launch_pack(name["frozen_name"]))
    return result


def decorate_scope(scope, members):
    return {**scope, "scope_kind": next(key for key, kinds in KINDS.items() if scope["kind"] in kinds),
            "member_ids": [member["member_id"] for member in members], "members": members,
            "can_use": scope["status"] == "ACTIVE"}


def register_ads_routes(app, authentication, database, settings):
    @asynccontextmanager
    async def ads_database(request, actor):
        try:
            async with database(request, actor) as connection:
                yield connection
        except asyncpg.PostgresError as error:
            messages = {
                "23514": (422, "invalid_registry_data", "ข้อมูลทะเบียนไม่ผ่านเงื่อนไข กรุณาตรวจขอบเขตและค่าที่อนุมัติ"),
                "23503": (422, "invalid_registry_reference", "ไม่พบรายการอ้างอิงที่ใช้งานได้ กรุณาเลือกข้อมูลใหม่"),
                "23505": (409, "binding_conflict", "ข้อมูลนี้ถูกผูกไว้แล้ว กรุณาให้ทีมออนไลน์ตรวจสอบ ห้ามผูกทับรายการเดิม"),
                "40001": (409, "conflict", "ข้อมูลเปลี่ยนไปแล้ว กรุณาตรวจรายการล่าสุดก่อนลองใหม่"),
            }
            if error.sqlstate in messages:
                raise failure(*messages[error.sqlstate]) from None
            raise

    async def reader(request: Request, actor: Actor = Depends(authentication)):
        if actor.role not in {"admin", "online_staff", "agency"}:
            raise failure(403, "forbidden", "บัญชีนี้ไม่มีสิทธิ์เข้าถึงทะเบียนชื่อแคมเปญ")
        if actor.role == "agency":
            async with ads_database(request, actor) as connection:
                active = await active_vocab(connection, "AGENCY", actor.agency_code)
            if not active:
                raise failure(403, "agency_unavailable", "บัญชีนี้ยังไม่มีเอเจนซีที่ได้รับอนุมัติในทะเบียน")
        return actor

    async def writer(actor: Actor = Depends(authentication)):
        if actor.role not in {"admin", "online_staff"}:
            raise failure(403, "forbidden", "เฉพาะทีมออนไลน์และผู้ดูแลทะเบียนที่ออกชื่อได้")
        return actor

    async def active_vocab(connection, kind, code):
        return await connection.fetchval("SELECT ads.active_vocab($1,$2)", kind, code)

    async def registry_settings(connection):
        flags = await connection.fetchval("SELECT ads.registry_settings()")
        approved = flags["sena_h_approved"]
        test_mode = settings.environment == "local" and await connection.fetchval("SELECT ads.test_issuing_enabled()")
        return {"sena_h_approved": approved is True, "test_mode": bool(test_mode),
                "can_issue": approved is True or bool(test_mode)}

    async def selected_scope(connection, body):
        if body.scope_kind in {"C", "D"}:
            result = await connection.fetchval("SELECT ads.preview_scope($1,$2,$3::text[])",
                                               KINDS[body.scope_kind][0], body.parent_group_id, body.member_ids)
        else:
            result = await connection.fetchval("SELECT ads.preview_existing_scope($1)", body.scope_id)
            if result["scope"]["kind"] not in KINDS[body.scope_kind]:
                raise failure(422, "invalid_scope", "ขอบเขตนี้ไม่พร้อมใช้หรือไม่ตรงประเภท กรุณาเลือกใหม่")
        for kind, value in (("OBJECTIVE", body.objective), ("AGENCY", body.agency), ("VARIANT", body.variant)):
            if value is not None and not await active_vocab(connection, kind, value):
                raise failure(422, "inactive_vocab", "ค่าที่เลือกยังไม่ได้รับอนุมัติหรือเลิกใช้แล้ว กรุณาเลือกใหม่")
        scope = result["scope"]
        if scope["kind"] == "CORP" and body.content_label is None:
            raise failure(422, "approved_label_required", "กรุณาระบุชื่อเนื้อหาต่อบูสต์ที่ทีมออนไลน์ยืนยันว่าอนุมัติแล้ว")
        if body.content_label is not None and scope["kind"] != "CORP":
            raise failure(422, "invalid_label", "ชื่อเนื้อหาที่อนุมัติใช้ได้เฉพาะขอบเขตองค์กร")
        label = body.content_label if body.content_label is not None else scope["label_en"]
        try:
            example = naming.generate(label, body.objective, scope["scope_code"], body.agency,
                                      naming.sn_code(26, 1), body.variant)
        except ValueError as error:
            raise failure(422, "invalid_name_fields", str(error)) from None
        return result, example

    @app.get("/v1/admin/ads/settings")
    async def get_settings(request: Request, actor: Actor = Depends(reader)):
        async with ads_database(request, actor) as connection:
            return {"data": await registry_settings(connection)}

    @app.get("/v1/admin/ads/vocab")
    async def get_vocab(request: Request, actor: Actor = Depends(reader)):
        async with ads_database(request, actor) as connection:
            rows = await connection.fetch(
                "SELECT vocab_type,code,label_th,label_en,status,ads.active_vocab(vocab_type,code) AS can_use FROM ads.vocab "
                "WHERE alias_of IS NULL ORDER BY vocab_type,code COLLATE \"C\""
            )
            return {"data": [dict(row) for row in rows]}

    @app.get("/v1/admin/ads/scopes")
    async def get_scopes(request: Request, kind: ScopeKind = "A", parent_group_id: SourceId | None = None,
                         actor: Actor = Depends(reader)):
        async with ads_database(request, actor) as connection:
            rows = await connection.fetch(
                "SELECT to_jsonb(s) AS scope, COALESCE((SELECT jsonb_agg(to_jsonb(m) "
                "ORDER BY member_type COLLATE \"C\",member_id COLLATE \"C\") FROM ads.scope_member m "
                "WHERE m.scope_id=s.scope_id),'[]'::jsonb) AS members FROM ads.scope_code s "
                "WHERE kind=ANY($1::text[]) "
                "AND ($2::text IS NULL OR parent_group_id=$2) ORDER BY scope_code COLLATE \"C\",scope_id", list(KINDS[kind]), parent_group_id,
            )
            return {"data": [decorate_scope(row["scope"], row["members"]) for row in rows]}

    @app.post("/v1/admin/ads/registrations/preview")
    async def preview(body: RegistrationInput, request: Request, actor: Actor = Depends(writer)):
        async with ads_database(request, actor) as connection:
            result, example = await selected_scope(connection, body)
            fields = example.split("__")
            fields[4] = "รหัสจะออกเมื่อบันทึก"
            return {"data": {**result, **await registry_settings(connection), "preview_name": "__".join(fields),
                             "code_note": "รหัสจะออกเมื่อบันทึก"}}

    @app.post("/v1/admin/ads/registrations", status_code=201)
    async def register(body: RegistrationInput, request: Request, actor: Actor = Depends(writer)):
        async with ads_database(request, actor) as connection:
            await selected_scope(connection, body)
            if not (await registry_settings(connection))["can_issue"]:
                raise failure(409, "pattern_pending", "รออนุมัติรูปแบบชื่อ ยังไม่สามารถออกชื่อสำหรับใช้งานจริง")
            scope_id = body.scope_id
            if body.scope_kind in {"C", "D"}:
                scope_id = await connection.fetchval("SELECT ads.create_scope($1,$2,$3::text[])",
                                                      KINDS[body.scope_kind][0], body.parent_group_id, body.member_ids)
            result = await connection.fetchval("SELECT ads.issue_registration($1,$2,$3,$4,$5,$6)", scope_id,
                                               body.objective, body.agency, body.variant, body.content_label,
                                               body.content_label_approved)
            return {"data": decorate_detail(result)}

    @app.get("/v1/admin/ads/registrations")
    async def registrations(request: Request, q: Annotated[str, Query(max_length=200, pattern=r"^[^\x00]*$")] = "",
                            limit: Annotated[int, Query(ge=1, le=100)] = 25,
                            offset: Annotated[int, Query(ge=0, le=9223372036854775807)] = 0,
                            agency: Annotated[str | None, Query(pattern=r"^[A-Z0-9]{2,20}$")] = None,
                            status: Literal["REGISTERED", "CANCELLED"] | None = None,
                            binding_status: Literal["pending", "bound"] | None = None,
                            actor: Actor = Depends(reader)):
        async with ads_database(request, actor) as connection:
            # One statement keeps rows/counts in the same snapshot; RLS also filters search matches.
            result = await connection.fetchval(
                "WITH matches AS (SELECT r.code,r.created_at FROM ads.campaign_registration r "
                "WHERE ($4::text IS NULL OR r.agency=$4) AND ($5::text IS NULL OR r.status=$5) "
                "AND ($6::text IS NULL OR EXISTS(SELECT 1 FROM ads.native_binding b WHERE b.code=r.code)=($6='bound')) "
                "AND ($1='' OR strpos(lower(r.code||' '||r.label||' '||r.agency),lower($1))>0 "
                "OR EXISTS(SELECT 1 FROM ads.campaign_name n WHERE n.code=r.code AND strpos(lower(n.frozen_name),lower($1))>0))), "
                "page AS (SELECT * FROM matches ORDER BY created_at DESC,code DESC LIMIT $2 OFFSET $3) "
                "SELECT jsonb_build_object('total',(SELECT count(*) FROM matches),'rows',COALESCE(" 
                "(SELECT jsonb_agg(ads.registration_detail(code) ORDER BY created_at DESC,code DESC) FROM page),'[]'::jsonb))",
                q, limit, offset, agency, status, binding_status,
            )
            return {"data": [decorate_detail(row) for row in result["rows"]],
                    "meta": {"total": result["total"], "limit": limit, "offset": offset}}

    @app.get("/v1/admin/ads/registrations/{code}")
    async def registration(code: str, request: Request, actor: Actor = Depends(reader)):
        async with ads_database(request, actor) as connection:
            return {"data": decorate_detail(await connection.fetchval("SELECT ads.registration_detail($1)", code))}

    @app.post("/v1/admin/ads/registrations/{code}/names")
    async def add_name(code: str, body: VariantInput, request: Request, actor: Actor = Depends(writer)):
        async with ads_database(request, actor) as connection:
            if not (await registry_settings(connection))["can_issue"]:
                raise failure(409, "pattern_pending", "รออนุมัติรูปแบบชื่อ ยังไม่สามารถออกชื่อสำหรับใช้งานจริง")
            return {"data": decorate_detail(await connection.fetchval("SELECT ads.add_variant($1,$2)", code, body.variant))}

    @app.post("/v1/admin/ads/registrations/{code}/bindings", status_code=201)
    async def bind(code: str, body: BindingInput, request: Request, actor: Actor = Depends(reader)):
        async with ads_database(request, actor) as connection:
            return {"data": await connection.fetchval("SELECT ads.bind_native($1,$2,$3,$4,$5)", code, body.name_id,
                                                       body.platform, body.account_id, body.campaign_id)}

    @app.post("/v1/admin/ads/names/validate")
    async def explain_name(body: ObservedName, actor: Actor = Depends(reader)):
        return {"data": naming.explain(body.name)}
