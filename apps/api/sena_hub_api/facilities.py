"""Staff-only amenity intake; publication remains a separate review step."""
from datetime import date
from typing import Annotated, Literal

from fastapi import Depends, Request
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .auth import Actor

Locale = Annotated[str, StringConstraints(pattern=r"^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$")]
Description = Annotated[str, StringConstraints(max_length=4000)]


class SaveFacility(BaseModel):
    model_config = ConfigDict(extra="forbid")
    updated_at: AwareDatetime
    status: Literal["present", "absent", "planned", "unknown"]
    description: dict[Locale, Description] = Field(default_factory=dict)
    location_note: str = Field(default="", max_length=2000)
    access_note: str = Field(default="", max_length=2000)
    evidence_note: str = Field(default="", max_length=2000)
    expected_open_date: date | None = None

    @model_validator(mode="after")
    def planned_date(self):
        if self.expected_open_date is not None and self.status != "planned":
            raise ValueError("วันที่คาดว่าจะเปิดใช้ระบุได้เฉพาะรายการที่อยู่ในแผน")
        return self


def register_facility_routes(app, admin, writer, database, detail):
    @app.put("/v1/admin/projects/{public_id}/facilities/{code}")
    async def save_facility(public_id: str, code: str, body: SaveFacility, request: Request,
                            actor: Actor = Depends(writer)):
        async with database(request, actor) as connection:
            project = await detail(connection, public_id)
            payload = body.model_dump(mode="json", exclude={"updated_at"})
            result = await connection.fetchval(
                "SELECT hub.save_project_facility($1,$2,$3::jsonb,$4)",
                project["id"], code, payload, body.updated_at,
            )
            return {"data": result}
