from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Annotated, Literal
from uuid import UUID
from urllib.parse import quote

import asyncpg
from fastapi import Depends, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, model_validator
from starlette.exceptions import HTTPException

from .auth import Actor, Authentication, AUTH_ROLES, Settings, failure
from . import assets as asset_files
from .facilities import register_facility_routes
from .commercial_types import register_commercial_routes
from .ads import register_ads_routes
from .finance import register_finance_routes
from .questions import register_question_routes
from .actuals import register_actuals_routes
from .promotions import register_promotion_routes
from .archive import register_archive_routes
from .assistant import register_assistant_routes
from .hosted_assets import BUCKET, HostedAssets
from .brand_completeness import register_brand_completeness_routes


Locale = Annotated[str, StringConstraints(pattern=r"^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$")]
Text = Annotated[str, StringConstraints(max_length=20000)]
LocalizedText = dict[Locale, Text]


def source_id(value: str) -> str:
    if not value.strip() or "\x00" in value:
        raise ValueError("กรุณาระบุรหัสข้อมูลต้นทางที่ไม่ว่างและไม่มีอักขระ NUL")
    return value  # Source IDs are exact DW data, not slugs or URL paths.


SourceId = Annotated[str, StringConstraints(min_length=1, max_length=200), AfterValidator(source_id)]


class CreateProject(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rem_project_id: SourceId
    brand_id: UUID | None = None


class CreateBrand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rem_brand_id: SourceId


class PatchBrand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    updated_at: AwareDatetime
    public_name: LocalizedText | None = None
    description: LocalizedText | None = None
    slug: str | None = Field(default=None, max_length=160, pattern=r"^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$")
    status: Literal["active", "inactive"] | None = None

    @model_validator(mode="after")
    def editable_fields(self):
        fields = self.model_fields_set - {"updated_at"}
        if not fields or any(getattr(self, name) is None for name in fields):
            raise ValueError("ระบุฟิลด์ที่ต้องการแก้ไข; ใช้ค่าว่างได้แต่ห้ามเป็น null")
        return self


class AddModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rem_model_id: SourceId
    updated_at: AwareDatetime


class PatchModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    updated_at: AwareDatetime
    public_name: LocalizedText | None = None
    bedrooms: float | None = Field(default=None, ge=0, strict=True)
    bathrooms: float | None = Field(default=None, ge=0, strict=True)
    usable_area_sqm: float | None = Field(default=None, gt=0, strict=True)
    parking_spaces: int | None = Field(default=None, ge=0, le=2147483647, strict=True)

    @model_validator(mode="after")
    def editable_fields(self):
        if self.model_fields_set == {"updated_at"} or (
            "public_name" in self.model_fields_set and self.public_name is None
        ):
            raise ValueError("ระบุฟิลด์ที่ต้องการแก้ไข; ชื่อใช้ค่าว่างได้แต่ห้ามเป็น null")
        return self


class PatchProject(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    updated_at: AwareDatetime
    public_name: LocalizedText | None = None
    slug: str | None = Field(default=None, max_length=160, pattern=r"^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$")
    address: LocalizedText | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90, strict=True)
    longitude: float | None = Field(default=None, ge=-180, le=180, strict=True)
    ad_disclaimer: LocalizedText | None = None
    meta_title: LocalizedText | None = None
    meta_description: LocalizedText | None = None

    @model_validator(mode="after")
    def editable_fields(self):
        fields = self.model_fields_set - {"updated_at"}
        if not fields or any(getattr(self, name) is None for name in fields - {"latitude", "longitude"}):
            raise ValueError("ระบุฟิลด์ที่ต้องการแก้ไข; ข้อความใช้ค่าว่างได้แต่ห้ามเป็น null")
        return self


class PublishAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    change_reason: str = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def reason_required(self):
        self.change_reason = self.change_reason.strip()
        if not self.change_reason:
            raise ValueError("กรุณาระบุเหตุผล")
        return self


class PrefillProject(BaseModel):
    model_config = ConfigDict(extra="forbid")
    updated_at: AwareDatetime
    source_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")


class RollbackAction(PublishAction):
    version_id: UUID


class ReviewModel(PublishAction):
    updated_at: AwareDatetime
    decision: Literal["CONFIRMED", "REJECTED"]


class RequestBrand(PublishAction):
    requested_name: str = Field(min_length=1, max_length=200)
    rem_brand_id: SourceId | None = None

    @model_validator(mode="after")
    def name_required(self):
        self.requested_name = self.requested_name.strip()
        if not self.requested_name:
            raise ValueError("กรุณาระบุชื่อแบรนด์ที่ขอเพิ่ม")
        return self


class ResolveBrandRequest(PublishAction):
    brand_id: UUID | None
    decision: Literal["resolved", "rejected"]
    updated_at: AwareDatetime

    @model_validator(mode="after")
    def resolution_target(self):
        if (self.decision == "resolved") != (self.brand_id is not None):
            raise ValueError("การอนุมัติต้องเลือกแบรนด์; การปฏิเสธต้องไม่ระบุแบรนด์")
        return self


class ReviewAsset(PublishAction):
    updated_at: AwareDatetime
    decision: Literal["approved", "revoked"]
    rights_notes: str = Field(min_length=1, max_length=4000)
    effective_from: AwareDatetime | None
    effective_to: AwareDatetime | None

    @model_validator(mode="after")
    def review_details(self):
        self.rights_notes = self.rights_notes.strip()
        if not self.rights_notes or (self.effective_from and self.effective_to and self.effective_to <= self.effective_from):
            raise ValueError("กรุณาระบุหลักฐานสิทธิ์และช่วงเวลาที่ถูกต้อง")
        return self


class BindAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    updated_at: AwareDatetime
    asset_id: UUID
    asset_role: Literal["hero", "thumbnail", "master_plan", "floor_plan", "brochure"]
    alt_text: LocalizedText


class BindBrandAsset(BindAsset):
    asset_role: Literal["logo_primary", "logo_white", "logo_mono", "favicon"]


class BindModelAsset(BindAsset):
    asset_role: Literal["model_image", "floor_plan", "structural_plan"]


class AssignBrand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    brand_id: UUID
    updated_at: AwareDatetime


class RemoveAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    updated_at: AwareDatetime


async def initialize_connection(connection):
    for typename in ("json", "jsonb"):
        await connection.set_type_codec(typename, schema="pg_catalog", encoder=json.dumps, decoder=json.loads)


@asynccontextmanager
async def database(request: Request, actor: Actor):
    # Only server-mapped constant identifiers may enter SET ROLE.
    roles = {role: role for role in AUTH_ROLES}
    async with request.app.state.pool.acquire() as connection:
        async with connection.transaction():
            await connection.execute(f"SET LOCAL ROLE {roles[actor.role]}")
            await connection.execute("SELECT set_config('app.actor_id', $1, true)", str(actor.id))
            await connection.execute("SELECT set_config('app.agency_code', $1, true)", actor.agency_code or "")
            yield connection


async def detail(connection, public_id: str):
    result = await connection.fetchval("SELECT hub.project_detail($1)", public_id)
    if result is None:
        raise failure(404, "not_found", "ไม่พบโครงการที่มีสิทธิ์เข้าถึง")
    return result


async def brand_detail(connection, public_id: str):
    result = await connection.fetchval("SELECT hub.brand_detail($1)", public_id)
    if result is None:
        raise failure(404, "not_found", "ไม่พบแบรนด์ที่มีสิทธิ์เข้าถึง")
    return result


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    authentication = Authentication(settings)
    hosted_assets = HostedAssets(settings) if settings.environment == "hosted-test" else None

    @asynccontextmanager
    async def lifespan(app):
        try:
            app.state.pool = await asyncpg.create_pool(
                settings.database_url, min_size=1, max_size=5,
                command_timeout=15, init=initialize_connection,
            )
        except Exception:
            raise RuntimeError("เชื่อมต่อฐานข้อมูล Hub ไม่สำเร็จ กรุณาตรวจการตั้งค่าฝั่งเซิร์ฟเวอร์") from None
        try:
            if hosted_assets:
                async with app.state.pool.acquire() as connection:
                    if await connection.fetchval("SELECT hub.hosted_test_profile()") is not True:
                        raise RuntimeError("ฐานข้อมูลไม่ได้ใช้โปรไฟล์ H1 ที่ได้รับอนุญาต")
                    async with connection.transaction():
                        await connection.execute("SET LOCAL ROLE admin")
                        flags = await connection.fetchval("SELECT ads.registry_settings()")
                        issuing = await connection.fetchval("SELECT ads.test_issuing_enabled()")
                        if flags["sena_h_approved"] is not False or issuing is not False:
                            raise RuntimeError("H1 ต้องปิดการออกชื่อและคงสถานะรออนุมัติ")
            yield
        finally:
            await app.state.pool.close()

    app = FastAPI(title="SENA Hub API", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.authentication = authentication
    if hosted_assets:
        app.add_middleware(CORSMiddleware, allow_origins=[settings.admin_origin],
                           allow_credentials=False, allow_methods=["GET", "POST", "PATCH"],
                           allow_headers=["Authorization", "Content-Type", "X-Filename"],
                           expose_headers=["Content-Disposition"])

    @app.middleware("http")
    async def no_cache(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        messages = {404: "ไม่พบเส้นทางที่ร้องขอ", 405: "วิธีเรียกใช้งานไม่ถูกต้อง"}
        body = error.detail if isinstance(error.detail, dict) else {
            "code": "request_error", "message": messages.get(error.status_code, "ไม่สามารถดำเนินการตามคำขอได้")
        }
        headers = {"WWW-Authenticate": "Bearer"} if error.status_code == 401 else None
        return JSONResponse({"error": body}, error.status_code, headers=headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        details = [{
            "field": ".".join(str(item) for item in issue["loc"] if item != "body"),
            "message": "กรุณาระบุข้อมูลที่จำเป็น" if issue["type"] == "missing" else (
                "ฟิลด์นี้ไม่อนุญาตให้แก้ไข" if issue["type"] == "extra_forbidden" else "รูปแบบหรือค่าของข้อมูลไม่ถูกต้อง"
            ),
        } for issue in error.errors()]
        return JSONResponse({"error": {"code": "validation_error", "message": "กรุณาตรวจข้อมูลที่ระบุ", "details": details}}, 422)

    @app.exception_handler(asyncpg.PostgresError)
    async def postgres_error(request, error):
        errors = {
            "42501": (403, "forbidden", "สิทธิ์ของคุณไม่อนุญาตให้ดำเนินการนี้"),
            "23514": (422, "not_ready", "ข้อมูลยังไม่ผ่านเงื่อนไข กรุณาตรวจรายการที่ยังขาดและสิทธิ์สื่อ"),
            "23505": (409, "duplicate", "ข้อมูลนี้มีอยู่แล้ว กรุณาตรวจรหัสหรือชื่อเส้นทาง"),
            "22P02": (422, "invalid_value", "รูปแบบข้อมูลไม่ถูกต้อง"),
            "23503": (422, "invalid_reference", "ไม่พบรายการอ้างอิงที่ใช้งานได้ กรุณาเลือกข้อมูลใหม่"),
            "40001": (409, "conflict", "ข้อมูลเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก"),
            "P0002": (404, "not_found", "ไม่พบข้อมูลที่ร้องขอ"),
        }
        if error.sqlstate in errors:
            status, code, message = errors[error.sqlstate]
        else:
            logging.getLogger("sena_hub_api").error(
                "Database request failed: sqlstate=%s type=%s", error.sqlstate, type(error).__name__,
            )
            if (error.sqlstate or "").startswith(("08", "53", "57P")):
                status, code, message = 503, "database_unavailable", "ระบบข้อมูลไม่พร้อมใช้งาน กรุณาลองใหม่"
            else:
                status, code, message = 500, "server_error", "ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่"
        return JSONResponse({"error": {"code": code, "message": message}}, status)

    @app.exception_handler(Exception)
    async def unexpected_error(request, error):
        # Keep stack frames without exception values/chains that may contain private input.
        logging.getLogger("sena_hub_api").exception(
            "Request failed: %s", type(error).__name__,
            exc_info=(RuntimeError, RuntimeError(type(error).__name__), error.__traceback__),
        )
        return JSONResponse({"error": {"code": "server_error", "message": "ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่"}}, 500)

    async def admin(actor: Actor = Depends(authentication)):
        if actor.role not in {"editor", "publisher", "viewer", "admin"}:
            raise failure(403, "forbidden", "บัญชีนี้ไม่มีสิทธิ์เข้าถึงระบบจัดการ")
        return actor

    async def writer(actor: Actor = Depends(admin)):
        if actor.role not in {"editor", "publisher", "admin"}:
            raise failure(403, "forbidden", "บัญชีนี้ไม่มีสิทธิ์แก้ไขข้อมูล")
        return actor

    async def administrator(actor: Actor = Depends(admin)):
        if actor.role != "admin":
            raise failure(403, "forbidden", "เฉพาะผู้ดูแลระบบที่มีสิทธิ์ดำเนินการนี้")
        return actor

    async def brand_writer(actor: Actor = Depends(admin)):
        if actor.role not in {"editor", "admin"}:
            raise failure(403, "forbidden", "เฉพาะผู้แก้ไขหรือผู้ดูแลระบบที่แก้ไขแบรนด์ได้")
        return actor

    async def publisher(actor: Actor = Depends(admin)):
        if actor.role != "publisher":
            raise failure(403, "forbidden", "เฉพาะผู้เผยแพร่ที่มีสิทธิ์ดำเนินการนี้")
        return actor

    async def consumer(actor: Actor = Depends(authentication)):
        if actor.role != "service_consumer":
            raise failure(403, "forbidden", "กรุณาใช้บัญชี consumer สำหรับ API เผยแพร่")
        return actor

    def require_local_assets():
        if settings.environment not in {"local", "hosted-test"}:
            raise failure(503, "local_storage_only", "ระบบไฟล์ชุดนี้เปิดใช้เฉพาะสภาพแวดล้อมภายในเครื่อง")

    async def remove_unregistered_file(request, actor, metadata):
        # A failed COMMIT can be ambiguous. Recheck under the same cross-process lock;
        # retain a private orphan if the DB is unavailable rather than delete a shared file.
        try:
            async with database(request, actor) as connection:
                await connection.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", metadata["checksum"])
                registered = await connection.fetchval("SELECT EXISTS(SELECT 1 FROM hub.assets WHERE checksum=$1)", metadata["checksum"])
                if not registered:
                    await asyncio.to_thread(asset_files.storage_path(metadata["storage_path"]).unlink, missing_ok=True)
        except Exception:
            logging.getLogger("sena_hub_api").warning("Deferred cleanup of unregistered local asset")

    @app.get("/v1/admin/assets")
    async def list_assets(request: Request, actor: Actor = Depends(admin)):
        require_local_assets()
        async with database(request, actor) as connection:
            return {"data": await connection.fetchval("SELECT hub.list_assets()")}

    @app.post("/v1/admin/assets")
    async def upload_asset(request: Request, actor: Actor = Depends(writer)):
        require_local_assets()
        content, mime, filename = await asset_files.read_upload(request)
        content, metadata = await asyncio.to_thread(asset_files.prepare_upload, content, mime, filename)
        if hosted_assets:
            metadata.update(storage_provider="supabase", storage_bucket=BUCKET)
        created = False
        try:
            async with database(request, actor) as connection:
                await connection.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", metadata["checksum"])
                result = await connection.fetchval("SELECT hub.register_uploaded_asset($1)", metadata)
                if hosted_assets:
                    remote_metadata = {**metadata, "source_system": "hub-hosted-test"}
                    await asyncio.to_thread(hosted_assets.install, content, remote_metadata)
                else:
                    created = await asyncio.to_thread(asset_files.install_file, content, metadata)
        except Exception:
            if created:
                await remove_unregistered_file(request, actor, metadata)
            raise
        return JSONResponse({"data": result["asset"], "meta": {"reused": result["reused"]}}, 200 if result["reused"] else 201)

    @app.get("/v1/admin/assets/{asset_id}")
    async def asset_detail(asset_id: UUID, request: Request, actor: Actor = Depends(admin)):
        require_local_assets()
        async with database(request, actor) as connection:
            return {"data": await connection.fetchval("SELECT hub.asset_detail($1)", asset_id)}

    @app.post("/v1/admin/assets/{asset_id}/review")
    async def review_asset(asset_id: UUID, body: ReviewAsset, request: Request, actor: Actor = Depends(publisher)):
        require_local_assets()
        async with database(request, actor) as connection:
            return {"data": await connection.fetchval(
                "SELECT hub.review_asset($1, $2, $3, $4, $5, $6, $7)",
                asset_id, body.updated_at, body.decision, body.rights_notes,
                body.effective_from, body.effective_to, body.change_reason,
            )}

    async def asset_file_response(asset_id, request, actor, public):
        require_local_assets()
        async with database(request, actor) as connection:
            query = "SELECT public_api.asset_file($1)" if public else "SELECT hub.asset_file($1)"
            metadata = await connection.fetchval(query, asset_id)
        if metadata is None:
            raise failure(404, "file_not_found", "ไม่พบไฟล์ที่มีสิทธิ์เข้าถึง")
        if hosted_assets:
            content = await asyncio.to_thread(hosted_assets.read, metadata)
            disposition = "attachment" if metadata["mime_type"] == "application/pdf" else "inline"
            return Response(content, media_type=metadata["mime_type"], headers={
                "Content-Disposition": f"{disposition}; filename*=utf-8''{quote(metadata['original_filename'])}",
                "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
                "X-Frame-Options": "DENY",
            })
        path = await asyncio.to_thread(asset_files.readable_file, metadata)
        return FileResponse(path, media_type=metadata["mime_type"], filename=metadata["original_filename"],
                            content_disposition_type="attachment" if metadata["mime_type"] == "application/pdf" else "inline",
                            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                                     "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
                                     "X-Frame-Options": "DENY"})

    @app.get("/v1/admin/assets/{asset_id}/file")
    async def staff_asset_file(asset_id: UUID, request: Request, actor: Actor = Depends(admin)):
        return await asset_file_response(asset_id, request, actor, public=False)

    @app.get("/v1/assets/{asset_id}/file")
    async def published_asset_file(asset_id: UUID, request: Request, actor: Actor = Depends(consumer)):
        return await asset_file_response(asset_id, request, actor, public=True)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/v1/capabilities")
    async def capabilities(actor: Actor = Depends(authentication)):
        if actor.role == "service_consumer":
            raise failure(403, "forbidden", "บัญชีนี้ไม่มีสิทธิ์เข้าถึงระบบจัดการ")
        return {"data": {"environment": settings.environment,
                         "milestone": "H1" if hosted_assets else None,
                         "enabled": ["residential", "assets", "registry", "agency-inbox"],
                         "deferred": ["finance", "actuals", "documents", "assistant"] if hosted_assets else [],
                         "remark": "ยังไม่เปิดใช้ใน H1 รอความพร้อมระยะ H2 ขึ้นไป" if hosted_assets else None}}

    @app.get("/v1/admin/projects")
    async def projects(request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as connection:
            rows = await connection.fetch("SELECT hub.project_detail(public_project_id) AS detail FROM hub.projects ORDER BY public_project_id LIMIT 100")
            return {"data": [row["detail"] for row in rows if row["detail"] is not None]}

    @app.get("/v1/admin/sources/projects")
    async def source_projects(request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as connection:
            return {"data": await connection.fetchval("SELECT hub.list_rem_projects()")}

    @app.get("/v1/admin/projects/progress")
    async def project_progress(request: Request, actor: Actor = Depends(admin)):
        from .project_progress import read_progress
        async with database(request, actor) as connection:
            return {"data": await read_progress(connection)}

    @app.post("/v1/admin/projects", status_code=201)
    async def create_project(body: CreateProject, request: Request, actor: Actor = Depends(writer)):
        async with database(request, actor) as connection:
            project_id = await connection.fetchval("SELECT hub.create_project_from_rem($1)", body.rem_project_id)
            created = await connection.fetchrow("SELECT public_project_id, updated_at FROM hub.projects WHERE id=$1", project_id)
            if body.brand_id is not None:
                return {"data": await connection.fetchval(
                    "SELECT hub.assign_project_brand($1, $2, $3)", project_id, body.brand_id, created["updated_at"],
                )}
            return {"data": await detail(connection, created["public_project_id"])}

    @app.get("/v1/admin/sources/brands")
    async def source_brands(request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as connection:
            return {"data": await connection.fetchval("SELECT hub.list_rem_brands()")}

    @app.get("/v1/admin/brands")
    async def brands(request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as connection:
            return {"data": await connection.fetchval("SELECT hub.list_brands()")}

    @app.post("/v1/admin/brands", status_code=201)
    async def create_brand(body: CreateBrand, request: Request, actor: Actor = Depends(administrator)):
        async with database(request, actor) as connection:
            brand_id = await connection.fetchval("SELECT hub.create_brand_from_rem($1)", body.rem_brand_id)
            public_id = await connection.fetchval("SELECT public_brand_id FROM hub.brands WHERE id=$1", brand_id)
            return {"data": await brand_detail(connection, public_id)}

    register_brand_completeness_routes(app, admin, administrator, brand_writer, database, brand_detail, settings)

    @app.get("/v1/admin/brands/{public_id}")
    async def brand(public_id: str, request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as connection:
            return {"data": await brand_detail(connection, public_id)}

    @app.patch("/v1/admin/brands/{public_id}")
    async def patch_brand(public_id: str, body: PatchBrand, request: Request, actor: Actor = Depends(brand_writer)):
        async with database(request, actor) as connection:
            current = await brand_detail(connection, public_id)
            changes = body.model_dump(mode="json", exclude_unset=True, exclude={"updated_at"})
            return {"data": await connection.fetchval(
                "SELECT hub.update_brand_draft($1, $2, $3)", UUID(current["id"]), changes, body.updated_at,
            )}

    @app.get("/v1/admin/brands/{public_id}/versions")
    async def brand_versions(public_id: str, request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as connection:
            current = await brand_detail(connection, public_id)
            brand_id = UUID(current["id"])
            versions = await connection.fetchval("SELECT hub.brand_versions($1)", brand_id)
            # Keep the existing visibility guard and metadata. Comparisons need
            # the immutable payload, read under the same caller role and RLS.
            payloads = {str(row["id"]): row["payload"] for row in await connection.fetch(
                "SELECT id, payload FROM hub.brand_versions WHERE brand_id=$1", brand_id,
            )}
            return {"data": [{**version, "payload": payloads.get(version["version_id"])} for version in versions]}

    async def brand_publish_action(public_id, reason, request, actor, operation, version_id=None):
        async with database(request, actor) as connection:
            current = await brand_detail(connection, public_id)
            brand_id = UUID(current["id"])
            if operation == "rollback":
                await connection.fetchval("SELECT hub.rollback_brand($1, $2, $3)", brand_id, version_id, reason)
            elif operation == "withdraw":
                await connection.fetchval("SELECT hub.withdraw_brand($1, $2)", brand_id, reason)
            else:
                await connection.fetchval("SELECT hub.publish_brand($1, $2)", brand_id, reason)
            return {"data": await brand_detail(connection, public_id)}

    @app.post("/v1/admin/brands/{public_id}/publish")
    async def publish_brand(public_id: str, body: PublishAction, request: Request, actor: Actor = Depends(publisher)):
        return await brand_publish_action(public_id, body.change_reason, request, actor, "publish")

    @app.post("/v1/admin/brands/{public_id}/withdraw")
    async def withdraw_brand(public_id: str, body: PublishAction, request: Request, actor: Actor = Depends(publisher)):
        return await brand_publish_action(public_id, body.change_reason, request, actor, "withdraw")

    @app.post("/v1/admin/brands/{public_id}/rollback")
    async def rollback_brand(public_id: str, body: RollbackAction, request: Request, actor: Actor = Depends(publisher)):
        return await brand_publish_action(public_id, body.change_reason, request, actor, "rollback", body.version_id)

    @app.post("/v1/admin/brands/{public_id}/assets")
    async def bind_brand_asset(public_id: str, body: BindBrandAsset, request: Request, actor: Actor = Depends(brand_writer)):
        require_local_assets()
        async with database(request, actor) as connection:
            current = await brand_detail(connection, public_id)
            return {"data": await connection.fetchval(
                "SELECT hub.bind_brand_asset($1, $2, $3, $4, $5)",
                UUID(current["id"]), body.asset_id, body.asset_role, body.alt_text, body.updated_at,
            )}

    @app.post("/v1/admin/brands/{public_id}/assets/{binding_id}/remove")
    async def remove_brand_asset(public_id: str, binding_id: UUID, body: RemoveAsset, request: Request, actor: Actor = Depends(brand_writer)):
        require_local_assets()
        async with database(request, actor) as connection:
            current = await brand_detail(connection, public_id)
            return {"data": await connection.fetchval(
                "SELECT hub.unbind_brand_asset($1, $2, $3)", UUID(current["id"]), binding_id, body.updated_at,
            )}

    @app.post("/v1/admin/projects/{public_id}/brand")
    async def assign_brand(public_id: str, body: AssignBrand, request: Request, actor: Actor = Depends(writer)):
        async with database(request, actor) as connection:
            current = await detail(connection, public_id)
            return {"data": await connection.fetchval(
                "SELECT hub.assign_project_brand($1, $2, $3)", UUID(current["id"]), body.brand_id, body.updated_at,
            )}

    @app.get("/v1/admin/brand-requests")
    async def brand_requests(request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as connection:
            return {"data": await connection.fetchval("SELECT hub.list_brand_requests()")}

    @app.post("/v1/admin/brand-requests", status_code=201)
    async def request_brand(body: RequestBrand, request: Request, actor: Actor = Depends(brand_writer)):
        async with database(request, actor) as connection:
            return {"data": await connection.fetchval(
                "SELECT hub.request_brand($1, $2, $3)", body.requested_name, body.rem_brand_id, body.change_reason,
            )}

    @app.post("/v1/admin/brand-requests/{request_id}/resolve")
    async def resolve_brand_request(request_id: UUID, body: ResolveBrandRequest, request: Request, actor: Actor = Depends(administrator)):
        async with database(request, actor) as connection:
            return {"data": await connection.fetchval(
                "SELECT hub.resolve_brand_request($1, $2, $3, $4, $5)",
                request_id, body.brand_id, body.decision, body.change_reason, body.updated_at,
            )}

    @app.get("/v1/admin/projects/{public_id}")
    async def project(public_id: str, request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as connection:
            return {"data": await detail(connection, public_id)}

    @app.patch("/v1/admin/projects/{public_id}")
    async def patch_project(public_id: str, body: PatchProject, request: Request, actor: Actor = Depends(writer)):
        async with database(request, actor) as connection:
            current = await detail(connection, public_id)
            changes = body.model_dump(mode="json", exclude_unset=True, exclude={"updated_at"})
            await connection.fetchval("SELECT hub.patch_project($1, $2, $3)", UUID(current["id"]), changes, body.updated_at)
            return {"data": await detail(connection, public_id)}

    @app.get("/v1/admin/projects/{public_id}/source-models")
    async def source_models(public_id: str, request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as connection:
            current = await detail(connection, public_id)
            return {"data": await connection.fetchval("SELECT hub.list_rem_models($1)", UUID(current["id"]))}

    @app.post("/v1/admin/projects/{public_id}/prefill")
    async def prefill_project(public_id: str, body: PrefillProject, request: Request, actor: Actor = Depends(writer)):
        async with database(request, actor) as connection:
            current = await detail(connection, public_id)
            return {"data": await connection.fetchval(
                "SELECT hub.prefill_project_from_dw($1, $2, $3)",
                UUID(current["id"]), body.updated_at, body.source_fingerprint,
            )}

    @app.get("/v1/admin/projects/{public_id}/models/{public_model_id}")
    async def model_project(public_id: str, public_model_id: str, request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as connection:
            current = await detail(connection, public_id)
            if not any(model["public_model_id"] == public_model_id for model in current["models"]):
                raise failure(404, "not_found", "ไม่พบแบบบ้านในโครงการนี้")
            return {"data": current}

    @app.post("/v1/admin/projects/{public_id}/models")
    async def add_model(public_id: str, body: AddModel, request: Request, actor: Actor = Depends(writer)):
        async with database(request, actor) as connection:
            current = await detail(connection, public_id)
            return {"data": await connection.fetchval(
                "SELECT hub.add_model_from_rem($1, $2, $3)",
                UUID(current["id"]), body.rem_model_id, body.updated_at,
            )}

    @app.patch("/v1/admin/projects/{public_id}/models/{public_model_id}")
    async def patch_model(public_id: str, public_model_id: str, body: PatchModel, request: Request, actor: Actor = Depends(writer)):
        async with database(request, actor) as connection:
            current = await detail(connection, public_id)
            changes = body.model_dump(mode="json", exclude_unset=True, exclude={"updated_at"})
            return {"data": await connection.fetchval(
                "SELECT hub.update_model($1, $2, $3, $4)",
                UUID(current["id"]), public_model_id, changes, body.updated_at,
            )}

    @app.post("/v1/admin/projects/{public_id}/models/{public_model_id}/review")
    async def review_model(public_id: str, public_model_id: str, body: ReviewModel, request: Request, actor: Actor = Depends(writer)):
        async with database(request, actor) as connection:
            current = await detail(connection, public_id)
            return {"data": await connection.fetchval(
                "SELECT hub.review_model($1, $2, $3, $4, $5)",
                UUID(current["id"]), public_model_id, body.updated_at, body.decision, body.change_reason,
            )}

    @app.get("/v1/admin/projects/{public_id}/versions")
    async def versions(public_id: str, request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as connection:
            current = await detail(connection, public_id)
            rows = await connection.fetch(
                "SELECT id AS version_id, version_no, payload, published_at, publisher, change_reason FROM hub.entity_versions WHERE project_id=$1 ORDER BY version_no DESC LIMIT 100",
                UUID(current["id"]),
            )
            return {"data": [dict(row) for row in rows]}

    @app.post("/v1/admin/projects/{public_id}/assets")
    async def bind_asset(public_id: str, body: BindAsset, request: Request, actor: Actor = Depends(writer)):
        require_local_assets()
        async with database(request, actor) as connection:
            current = await detail(connection, public_id)
            return {"data": await connection.fetchval(
                "SELECT hub.bind_project_asset($1, $2, $3, $4, $5)",
                UUID(current["id"]), body.asset_id, body.asset_role, body.alt_text, body.updated_at,
            )}

    @app.post("/v1/admin/projects/{public_id}/assets/{binding_id}/remove")
    async def remove_asset(public_id: str, binding_id: UUID, body: RemoveAsset, request: Request, actor: Actor = Depends(writer)):
        require_local_assets()
        async with database(request, actor) as connection:
            current = await detail(connection, public_id)
            return {"data": await connection.fetchval(
                "SELECT hub.unbind_project_asset($1, $2, $3)", UUID(current["id"]), binding_id, body.updated_at,
            )}

    @app.post("/v1/admin/projects/{public_id}/models/{public_model_id}/assets")
    async def bind_model_asset(public_id: str, public_model_id: str, body: BindModelAsset, request: Request, actor: Actor = Depends(writer)):
        require_local_assets()
        async with database(request, actor) as connection:
            current = await detail(connection, public_id)
            return {"data": await connection.fetchval(
                "SELECT hub.bind_model_asset($1, $2, $3, $4, $5, $6)",
                UUID(current["id"]), public_model_id, body.asset_id, body.asset_role, body.alt_text, body.updated_at,
            )}

    @app.post("/v1/admin/projects/{public_id}/models/{public_model_id}/assets/{binding_id}/remove")
    async def remove_model_asset(public_id: str, public_model_id: str, binding_id: UUID, body: RemoveAsset, request: Request, actor: Actor = Depends(writer)):
        require_local_assets()
        async with database(request, actor) as connection:
            current = await detail(connection, public_id)
            return {"data": await connection.fetchval(
                "SELECT hub.unbind_model_asset($1, $2, $3, $4)",
                UUID(current["id"]), public_model_id, binding_id, body.updated_at,
            )}

    async def publish_action(public_id, reason, request, actor, operation, version_id=None):
        async with database(request, actor) as connection:
            current = await detail(connection, public_id)
            project_id = UUID(current["id"])
            if operation == "rollback":
                await connection.fetchval("SELECT hub.rollback_project($1, $2, $3)", project_id, version_id, reason)
            elif operation == "withdraw":
                await connection.fetchval("SELECT hub.withdraw_project($1, $2)", project_id, reason)
            else:
                await connection.fetchval("SELECT hub.publish_project($1, $2)", project_id, reason)
            return {"data": await detail(connection, public_id)}

    @app.post("/v1/admin/projects/{public_id}/publish")
    async def publish(public_id: str, body: PublishAction, request: Request, actor: Actor = Depends(publisher)):
        return await publish_action(public_id, body.change_reason, request, actor, "publish")

    @app.post("/v1/admin/projects/{public_id}/withdraw")
    async def withdraw(public_id: str, body: PublishAction, request: Request, actor: Actor = Depends(publisher)):
        return await publish_action(public_id, body.change_reason, request, actor, "withdraw")

    @app.post("/v1/admin/projects/{public_id}/rollback")
    async def rollback(public_id: str, body: RollbackAction, request: Request, actor: Actor = Depends(publisher)):
        return await publish_action(public_id, body.change_reason, request, actor, "rollback", body.version_id)

    def public_payload(row):
        return row["payload"]

    def public_meta(row):
        return {
            "version": "v1", "entity_version": row["version_no"],
            "published_at": row["published_at"], "publisher": row["publisher"],
            "source_updated_at": row["source_updated_at"], "data_freshness": "unknown",
            "locale": "th", "is_fallback_locale": False,
            "fallback_indicator": {"missing": []}, "cache_ttl": 0,
        }

    def public_list(rows):
        return {
            "data": [{**public_payload(row), "meta": public_meta(row)} for row in rows],
            "meta": {"version": "v1", "entity_version": None, "published_at": None,
                     "publisher": None, "source_updated_at": None, "data_freshness": "unknown",
                     "locale": "th", "is_fallback_locale": False,
                     "fallback_indicator": {"missing": []}, "cache_ttl": 0},
        }

    def check_query(request, allowed=()):
        if set(request.query_params) - set(allowed) or any(len(request.query_params.getlist(key)) != 1 for key in request.query_params):
            raise failure(422, "invalid_filter", "ตัวกรองไม่รองรับหรือระบุชื่อซ้ำ กรุณาตรวจพารามิเตอร์")

    @app.get("/v1/projects")
    async def published_projects(request: Request, brand_id: Annotated[SourceId | None, Query()] = None, actor: Actor = Depends(consumer)):
        check_query(request, allowed=("brand_id",))
        async with database(request, actor) as connection:
            rows = await connection.fetch(
                "SELECT * FROM public_api.projects WHERE ($1::text IS NULL OR payload#>>'{brand,public_brand_id}'=$1) ORDER BY public_project_id LIMIT 100",
                brand_id,
            )
            return public_list(rows)

    @app.get("/v1/brands")
    async def published_brands(request: Request, actor: Actor = Depends(consumer)):
        check_query(request)
        async with database(request, actor) as connection:
            rows = await connection.fetch("SELECT * FROM public_api.brands ORDER BY public_brand_id LIMIT 100")
            return public_list(rows)

    @app.get("/v1/brands/{public_id}")
    async def published_brand(public_id: str, request: Request, actor: Actor = Depends(consumer)):
        check_query(request)
        async with database(request, actor) as connection:
            row = await connection.fetchrow("SELECT * FROM public_api.brands WHERE public_brand_id=$1", public_id)
            if row is None:
                raise failure(404, "not_published", "ไม่พบแบรนด์ที่เผยแพร่และยังใช้งานได้")
            return {"data": public_payload(row), "meta": public_meta(row)}

    async def published_project_row(public_id, request, actor):
        async with database(request, actor) as connection:
            row = await connection.fetchrow("SELECT * FROM public_api.projects WHERE public_project_id=$1", public_id)
            if row is None:
                raise failure(404, "not_published", "ไม่พบโครงการที่เผยแพร่และยังใช้งานได้")
            return row

    @app.get("/v1/projects/{public_id}")
    async def published_project(public_id: str, request: Request, actor: Actor = Depends(consumer)):
        check_query(request)
        row = await published_project_row(public_id, request, actor)
        return {"data": public_payload(row), "meta": public_meta(row)}

    @app.get("/v1/projects/{public_id}/models")
    async def published_project_models(public_id: str, request: Request, actor: Actor = Depends(consumer)):
        check_query(request)
        row = await published_project_row(public_id, request, actor)
        return {"data": row["payload"].get("models", []), "meta": public_meta(row)}

    def frozen_assets(row, role, model_id=None):
        return [asset for asset in row["payload"].get("assets", [])
                if asset.get("public_model_id") == model_id and (role is None or asset["asset_role"] == role)]

    @app.get("/v1/projects/{public_id}/assets")
    async def published_project_assets(public_id: str, request: Request,
                                       role: Annotated[Literal["hero", "thumbnail", "master_plan", "floor_plan", "brochure"] | None, Query()] = None,
                                       actor: Actor = Depends(consumer)):
        check_query(request, ("role",))
        row = await published_project_row(public_id, request, actor)
        return {"data": frozen_assets(row, role), "meta": public_meta(row)}

    async def published_model_row(public_id, request, actor):
        async with database(request, actor) as connection:
            row = await connection.fetchrow(
                "SELECT p.*, m.item AS published_model FROM public_api.projects p "
                "CROSS JOIN LATERAL jsonb_array_elements(p.payload->'models') m(item) "
                "WHERE m.item->>'public_model_id'=$1", public_id)
            if row is None:
                raise failure(404, "not_published", "ไม่พบแบบที่อยู่ในโครงการที่เผยแพร่และยังใช้งานได้")
            return row

    @app.get("/v1/models/{public_id}")
    async def published_model(public_id: str, request: Request, actor: Actor = Depends(consumer)):
        check_query(request)
        row = await published_model_row(public_id, request, actor)
        return {"data": {**row["published_model"], "public_project_id": row["public_project_id"]}, "meta": public_meta(row)}

    @app.get("/v1/models/{public_id}/assets")
    async def published_model_assets(public_id: str, request: Request,
                                     role: Annotated[Literal["model_image", "floor_plan", "structural_plan"] | None, Query()] = None,
                                     actor: Actor = Depends(consumer)):
        check_query(request, ("role",))
        row = await published_model_row(public_id, request, actor)
        return {"data": frozen_assets(row, role, row["published_model"]["public_model_id"]), "meta": public_meta(row)}

    register_facility_routes(app, admin, writer, database, detail)
    register_commercial_routes(app, admin, writer, database, detail, require_local_assets)
    register_ads_routes(app, authentication, database, settings)
    register_question_routes(app, authentication)
    register_promotion_routes(app, admin, brand_writer, publisher, consumer, database, settings)
    if hosted_assets:
        @app.api_route("/v1/admin/ads/{deferred_path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
        @app.api_route("/v1/admin/assistant/{deferred_path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
        async def deferred_module(deferred_path: str, actor: Actor = Depends(authentication)):
            raise failure(503, "hosted_h1_unavailable", "ยังไม่เปิดใช้ใน H1 รอความพร้อมระยะ H2 ขึ้นไป")
    else:
        register_finance_routes(app, authentication, database)
        register_actuals_routes(app, authentication, database, settings)
        register_archive_routes(app, authentication, database, settings)
        register_assistant_routes(app, authentication, database, settings)
    return app
