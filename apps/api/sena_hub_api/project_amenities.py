"""Phase 7 project drafts and controlled place references; SQL owns authority."""
import csv
import io
from typing import Literal
from uuid import UUID

from fastapi import Depends, Request
from pydantic import Field

from .auth import Actor, failure
from .content_permissions import require_content
from .content_workflow import DecisionReason
from .project_content import Draft, Input, Revision

ReferenceKind = Literal['rail_lines', 'rail_stations', 'expressways', 'expressway_ramps', 'features', 'facilities']
CSV_FIELDS = ['kind', 'code', 'expected_revision', 'name_th', 'name_en', 'line_code',
              'expressway_code', 'latitude', 'longitude', 'status', 'expected_open', 'source_ref', 'as_of']
PLACE_KINDS = {'rail_lines', 'rail_stations', 'expressways', 'expressway_ramps'}


class SolarDecision(Revision):
    decision: Literal['approve', 'return', 'withdraw']
    reason: DecisionReason | None = None


class Cover(Revision):
    link_id: UUID
    previous_cover_id: UUID | None = None
    previous_revision: int = Field(default=0, ge=0)


class ReferenceImport(Input):
    csv_text: str = Field(min_length=1, max_length=200_000)
    apply: bool = False


def reference_rows(value: str) -> list[dict]:
    """Parse the published template; IDs remain strings, including leading zeros."""
    reader = csv.DictReader(io.StringIO(value.lstrip('\ufeff')), strict=True)
    rows = []
    seen = set()
    try:
        if reader.fieldnames != CSV_FIELDS:
            raise failure(422, 'reference_csv', 'หัวคอลัมน์ไม่ตรงกับแม่แบบ CSV กรุณาดาวน์โหลดแม่แบบล่าสุด')
        for line, row in enumerate(reader, 2):
            if len(rows) >= 200 or None in row or any(v is None for v in row.values()):
                raise ValueError('shape')
            row = {k: v.strip() for k, v in row.items()}
            kind, code = row['kind'], row['code']
            if kind not in PLACE_KINDS or not code or (kind, code) in seen:
                raise ValueError('identity')
            seen.add((kind, code))
            if not row['expected_revision'].isascii() or not row['expected_revision'].isdigit():
                raise ValueError('revision')
            body = {'name': {'th': row['name_th'], 'en': row['name_en']},
                    'status': row['status'] or None, 'source_ref': row['source_ref'], 'as_of': row['as_of'] or None}
            for key in ('line_code', 'expressway_code', 'latitude', 'longitude', 'expected_open'):
                if row[key]:
                    body[key] = row[key]
            if kind in ('rail_stations', 'expressway_ramps'):
                body['latitude'] = row['latitude'] or None
                body['longitude'] = row['longitude'] or None
            if kind == 'rail_stations':
                body['expected_open'] = row['expected_open'] or None
            rows.append({'line': line, 'kind': kind, 'code': code,
                         'expected_revision': int(row['expected_revision']), 'changes': body})
    except (csv.Error, ValueError):
        raise failure(422, 'reference_csv', 'CSV ไม่ถูกต้อง: ใช้แม่แบบ ระบุรหัสไม่ซ้ำและฉบับข้อมูลเป็นจำนวนเต็ม จำกัด 200 แถว') from None
    if not rows:
        raise failure(422, 'reference_csv', 'CSV ยังไม่มีรายการข้อมูล')
    return rows


def register_project_amenity_routes(app, authentication, database):
    async def staff(request: Request, actor: Actor = Depends(authentication)):
        require_content(request)
        return actor

    async def call(request, actor, sql, *args, reason=None):
        async with database(request, actor) as db:
            await db.execute("select set_config('app.content_review_reason',$1,true)", reason or '')
            return {'data': await db.fetchval(sql, *args)}

    @app.get('/v1/admin/projects/{public_id}/amenities')
    async def workspace(public_id: str, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.c4_workspace($1)', public_id)

    @app.put('/v1/admin/projects/{public_id}/amenities/facilities/{code}')
    async def facility(public_id: str, code: str, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.c4_facility_save($1,$2,$3,$4)', public_id, code, body.expected_revision, body.changes)

    @app.put('/v1/admin/projects/{public_id}/amenities/features/{item_id}')
    async def feature(public_id: str, item_id: UUID, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.c4_item_save($1,$2,$3,$4,$5)', public_id, 'features', item_id, body.expected_revision, body.changes)

    @app.put('/v1/admin/projects/{public_id}/amenities/solar/{item_id}')
    async def solar(public_id: str, item_id: UUID, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.c4_item_save($1,$2,$3,$4,$5)', public_id, 'solar', item_id, body.expected_revision, body.changes)

    @app.put('/v1/admin/projects/{public_id}/amenities/places/{item_id}')
    async def place(public_id: str, item_id: UUID, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.c4_item_save($1,$2,$3,$4,$5)', public_id, 'places', item_id, body.expected_revision, body.changes)

    @app.post('/v1/admin/projects/{public_id}/amenities/solar/{item_id}/review')
    async def review(public_id: str, item_id: UUID, body: SolarDecision, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.c4_solar_review($1,$2,$3,$4)', public_id, item_id, body.expected_revision, body.decision, reason=body.reason)

    @app.post('/v1/admin/projects/{public_id}/amenities/facilities/{code}/cover')
    async def cover(public_id: str, code: str, body: Cover, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.c4_facility_cover($1,$2,$3,$4,$5,$6)', public_id, code,
                          body.link_id, body.expected_revision, body.previous_cover_id, body.previous_revision)

    @app.get('/v1/admin/place-references')
    async def references(request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.c4_references()')

    @app.get('/v1/admin/place-references/template')
    async def template(request: Request, actor: Actor = Depends(staff)):
        async with database(request, actor) as db:
            await db.fetchval("select hub.require_permission('projects','view')")
        out = io.StringIO(newline='')
        csv.writer(out).writerow(CSV_FIELDS)
        return {'data': {'filename': 'place-references.csv', 'content': out.getvalue()}}

    @app.put('/v1/admin/place-references/{kind}/{code}')
    async def reference(kind: ReferenceKind, code: str, body: Draft, request: Request, actor: Actor = Depends(staff)):
        return await call(request, actor, 'select hub.c4_reference_save($1,$2,$3,$4)', kind, code, body.expected_revision, body.changes)

    @app.post('/v1/admin/place-references/import')
    async def import_references(body: ReferenceImport, request: Request, actor: Actor = Depends(staff)):
        rows = reference_rows(body.csv_text)
        async with database(request, actor) as db:
            await db.fetchval("select hub.require_permission('projects','approve')")
            # The preview exercises the same SQL validation in a rolled-back savepoint.
            # Apply repeats all revision checks; the outer request remains atomic.
            preview = db.transaction()
            await preview.start()
            try:
                for row in rows:
                    await db.fetchval('select hub.c4_reference_save($1,$2,$3,$4)',
                                      row['kind'], row['code'], row['expected_revision'], row['changes'])
                if body.apply:
                    await preview.commit()
                else:
                    await preview.rollback()
            except BaseException:
                await preview.rollback()
                raise
        return {'data': {'applied': body.apply, 'rows': rows, 'count': len(rows)}}
