"""Staff completeness projection and confirmed local source-prefilled registration."""
from __future__ import annotations

import csv
import io
import json
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, Query, Request
from fastapi.responses import Response
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictBool, field_validator

from .auth import Actor, failure
from .staff_media import thumbnails

MANIFEST = "1512ac0bac74f5356617458b30bf2079896cce18db54393b5244c136ae54f877"
REASONS = {"deleted": "ต้นทางถูกลบ", "unknown_status": "ยังไม่ทราบสถานะต้นทาง", "blank_name": "ไม่มีชื่อภาษาไทย",
           "duplicate": "ชื่อซ้ำ ต้องตรวจตามรหัส", "no_residential_project": "ไม่มีโครงการที่อยู่อาศัย",
           "already_created": "มีแบรนด์ใน Hub แล้ว", "archived": "เคยสร้างและเก็บถาวรแล้ว"}
CSV_COLUMNS = ("name_th", "name_en", "rem_brand_id", "public_brand_id", "residential_project_count", "status",
               "name_th_confirmed", "description_present", "slug_present", "primary_logo_present", "logo_rights_valid",
               "optional_logos", "readiness_percent", "missing", "not_created_reasons", "updated_at", "updated_by")


class Filters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["all", "missing_data", "ready", "published", "published_changes", "not_created"] = "all"
    missing: Literal["all", "name_th_confirmed", "description", "slug", "primary_logo", "logo_rights"] = "all"
    search: str = Field(default="", max_length=200)


class BulkCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preview_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    confirmed: StrictBool
    change_reason: str = Field(min_length=1, max_length=1000, pattern=r"\S")

    @field_validator("confirmed")
    @classmethod
    def explicit_confirmation(cls, value):
        if value is not True:
            raise ValueError("ต้องยืนยันพรีวิวอย่างชัดเจน")
        return value


class ConfirmNames(BaseModel):
    model_config = ConfigDict(extra="forbid")
    updated_at: AwareDatetime


def filter_rows(rows, filters):
    def matches(row):
        created = row["status"] != "not_created"
        ready = row["readiness"]["ready"]
        published = row.get("publication_available", False)
        status_match = {"all": True, "missing_data": created and not ready,
                        "ready": created and ready and (not published or row.get("has_unpublished_changes", False)),
                        "published": published, "published_changes": row["status"] == "published_changes",
                        "not_created": not created}[filters.status]
        text = " ".join(str(row.get(key) or "") for key in ("name_th", "name_en", "rem_brand_id", "public_brand_id"))
        return status_match and (filters.missing == "all" or not row["checks"].get(filters.missing, False)) and filters.search.casefold().strip() in text.casefold()
    return [row for row in rows if matches(row)]


def csv_content(rows):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(CSV_COLUMNS)
    for row in rows:
        checks = row["checks"]
        values = [row.get(key) for key in CSV_COLUMNS[:6]] + [str(bool(checks.get(key))).lower() for key in
                  ("name_th_confirmed", "description", "slug", "primary_logo", "logo_rights")]
        values += [" | ".join(row["optional_logos"]), row["readiness"]["percent"],
                   " | ".join(item["message"] for item in row["readiness"]["missing"]),
                   " | ".join(REASONS.get(code, code) for code in row.get("reason_codes", []) if row["status"] == "not_created"),
                   row.get("updated_at"), row.get("updated_by")]
        # Source/public text remains data when opened in a spreadsheet.
        writer.writerow(["'" + value if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")) else value for value in values])
    return "\ufeff" + output.getvalue()


def register_brand_completeness_routes(app, admin, administrator, writer, database, brand_detail, settings):
    def local_only():
        if settings.environment != "local":
            raise failure(403, "brand_bulk_local_only", "การสร้างแบรนด์จากพจนานุกรมชุดนี้ใช้ได้เฉพาะภายในเครื่อง")

    def query(request, allowed=()):
        if set(request.query_params) - set(allowed) or any(len(request.query_params.getlist(key)) != 1 for key in request.query_params):
            raise failure(422, "invalid_brand_filter", "ตัวกรองไม่รองรับหรือระบุซ้ำ")

    async def dashboard(request, actor, filters):
        query(request, ("status", "missing", "search"))
        async with database(request, actor) as db:
            data = await db.fetchval("SELECT hub.brand_completeness()")
            media = await thumbnails(db)
        data = json.loads(data) if isinstance(data, str) else data
        return {**data, "rows": [{**r, 'thumbnail': media['brand'].get(r['rem_brand_id'])} for r in filter_rows(data["rows"], filters)]}

    # Registered before the generic /brands/{public_id} route.
    @app.get("/v1/admin/brands/completeness")
    async def completeness(request: Request, filters: Annotated[Filters, Query()], actor: Actor = Depends(admin)):
        return {"data": await dashboard(request, actor, filters)}

    @app.get("/v1/admin/brands/completeness.csv")
    async def completeness_csv(request: Request, filters: Annotated[Filters, Query()], actor: Actor = Depends(admin)):
        data = await dashboard(request, actor, filters)
        return Response(csv_content(data["rows"]), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="brand-completeness.csv"', "Cache-Control": "no-store"})

    @app.get("/v1/admin/brands/bulk-preview")
    async def preview(request: Request, actor: Actor = Depends(administrator)):
        local_only(); query(request)
        async with database(request, actor) as db:
            return {"data": await db.fetchval("SELECT hub.brand_bulk_preview()")}

    @app.post("/v1/admin/brands/bulk-create")
    async def create(body: BulkCreate, request: Request, actor: Actor = Depends(administrator)):
        local_only(); query(request)
        async with database(request, actor) as db:
            return {"data": await db.fetchval("SELECT hub.brand_bulk_create($1,$2,$3,$4)", MANIFEST, body.preview_sha256, body.confirmed, body.change_reason)}

    @app.post("/v1/admin/brands/{public_id}/confirm-source-names")
    async def confirm_names(public_id: str, body: ConfirmNames, request: Request, actor: Actor = Depends(writer)):
        query(request)
        async with database(request, actor) as db:
            current = await brand_detail(db, public_id)
            return {"data": await db.fetchval("SELECT hub.confirm_brand_source_names($1,$2)", UUID(current["id"]), body.updated_at)}
