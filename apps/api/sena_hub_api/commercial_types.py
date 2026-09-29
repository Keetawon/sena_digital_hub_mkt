"""Private Marketing Unit Type drafts; source references never imply inventory allocation."""
from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, Request
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .auth import Actor


Locale = Annotated[str, StringConstraints(pattern=r"^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$")]
Text = Annotated[str, StringConstraints(max_length=20000)]
LocalizedText = dict[Locale, Text]
ModelId = Annotated[str, StringConstraints(pattern=r"^mdl_[a-f0-9]{32}$")]
PositiveArea = Annotated[float, Field(gt=0, strict=True)]
Count = Annotated[float, Field(ge=0, strict=True)]


class CommercialFields(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    public_name: LocalizedText | None = None
    description: LocalizedText | None = None
    product_form: Literal["condominium", "house", "townhome", "other"] | None = None
    area_min_sqm: PositiveArea | None = None
    area_max_sqm: PositiveArea | None = None
    bedrooms: Count | None = None
    bathrooms: Count | None = None
    kitchens: Count | None = None
    storeys: int | None = Field(default=None, ge=1, le=2147483647, strict=True)
    parking_spaces: int | None = Field(default=None, ge=0, le=2147483647, strict=True)
    land_area_sqm: PositiveArea | None = None
    source_model_ids: list[ModelId] | None = Field(default=None, max_length=200)
    source_notes: str | None = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def validate_fields(self):
        for field in {"public_name", "description", "source_model_ids", "source_notes"} & self.model_fields_set:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        if self.public_name is not None and not self.public_name.get("th", "").strip():
            raise ValueError("A Thai marketing unit name is required")
        if self.source_model_ids is not None and len(set(self.source_model_ids)) != len(self.source_model_ids):
            raise ValueError("Source references must be unique")
        if self.area_min_sqm is not None and self.area_max_sqm is not None and self.area_min_sqm > self.area_max_sqm:
            raise ValueError("Minimum area cannot exceed maximum area")
        return self


class CreateCommercialType(CommercialFields):
    public_name: LocalizedText


class CreateCommercialSet(BaseModel):
    model_config = ConfigDict(extra="forbid")
    updated_at: AwareDatetime
    types: list[CreateCommercialType] = Field(min_length=1, max_length=50)


class PatchCommercialType(CommercialFields):
    updated_at: AwareDatetime

    @model_validator(mode="after")
    def require_changes(self):
        if self.model_fields_set == {"updated_at"}:
            raise ValueError("At least one editable field is required")
        return self


class BindCommercialAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    updated_at: AwareDatetime
    asset_id: UUID
    asset_role: Literal["model_image", "floor_plan", "structural_plan"]
    alt_text: LocalizedText
    title: str = Field(min_length=1, max_length=300)
    floor_label: str = Field(default="", max_length=100)
    plan_revision: str = Field(default="", max_length=100)
    applicability_model_ids: list[ModelId] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def require_descriptions(self):
        if not self.title.strip() or not self.alt_text.get("th", "").strip():
            raise ValueError("Title and Thai alternative text are required")
        if len(set(self.applicability_model_ids)) != len(self.applicability_model_ids):
            raise ValueError("Plan source references must be unique")
        return self


class RemoveCommercialAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    updated_at: AwareDatetime


def register_commercial_routes(app, admin, writer, database, detail, require_local_assets):
    """Use the existing authentication, transaction and file-storage boundaries."""
    prefix = "/v1/admin/projects/{public_id}/commercial-types"

    @app.get(prefix)
    async def list_types(public_id: str, request: Request, actor: Actor = Depends(admin)):
        async with database(request, actor) as connection:
            return {"data": await detail(connection, public_id)}

    @app.post(prefix)
    async def create_set(public_id: str, body: CreateCommercialSet, request: Request, actor: Actor = Depends(writer)):
        async with database(request, actor) as connection:
            current = await detail(connection, public_id)
            return {"data": await connection.fetchval(
                "SELECT hub.create_commercial_types($1, $2, $3)", UUID(current["id"]),
                [item.model_dump(mode="json", exclude_unset=True) for item in body.types], body.updated_at,
            )}

    @app.patch(prefix + "/{commercial_id}")
    async def edit_type(public_id: str, commercial_id: str, body: PatchCommercialType, request: Request,
                        actor: Actor = Depends(writer)):
        async with database(request, actor) as connection:
            current = await detail(connection, public_id)
            return {"data": await connection.fetchval(
                "SELECT hub.update_commercial_type($1, $2, $3, $4)", UUID(current["id"]), commercial_id,
                body.model_dump(mode="json", exclude_unset=True, exclude={"updated_at"}), body.updated_at,
            )}

    @app.post(prefix + "/{commercial_id}/assets")
    async def bind_asset(public_id: str, commercial_id: str, body: BindCommercialAsset, request: Request,
                         actor: Actor = Depends(writer)):
        require_local_assets()
        async with database(request, actor) as connection:
            current = await detail(connection, public_id)
            return {"data": await connection.fetchval(
                "SELECT hub.bind_commercial_asset($1, $2, $3, $4)", UUID(current["id"]), commercial_id,
                body.model_dump(mode="json", exclude={"updated_at"}), body.updated_at,
            )}

    @app.post(prefix + "/{commercial_id}/assets/{binding_id}/remove")
    async def remove_asset(public_id: str, commercial_id: str, binding_id: UUID, body: RemoveCommercialAsset,
                           request: Request, actor: Actor = Depends(writer)):
        require_local_assets()
        async with database(request, actor) as connection:
            current = await detail(connection, public_id)
            return {"data": await connection.fetchval(
                "SELECT hub.unbind_commercial_asset($1, $2, $3, $4)", UUID(current["id"]), commercial_id,
                binding_id, body.updated_at,
            )}
