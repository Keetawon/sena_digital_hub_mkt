"""Gap-only, replayable HYABC/FLEXI seed on the fixed local TEST database.

Original assets and suggested models are never reviewed, rebound or removed.
The publisher explicitly selects demo mode to publish the synthetic selection.
"""
from __future__ import annotations

import asyncio
import io
import json
from datetime import datetime
from pathlib import Path
import sys
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps/api"))
from sena_hub_api.assets import install_file, validate_file  # noqa: E402

TARGET = {"host": "127.0.0.1", "port": 55432, "database": "sena_hub_local"}
ACTOR = "00000000-0000-0000-0000-000000000031"
EVIDENCE = "SYNTHETIC-RESIDENTIAL-v1: local demo only; no real content or rights approval"
SOURCE = {"synthetic_only": True, "source": "local-demo", "seed_key": "residential-v1"}
MODEL = "DEMO-HYABC-01"


def missing_fields(existing: dict, proposed: dict) -> tuple[dict, list[str]]:
    """Fill empty values only; preserve every saved nonempty locale/value."""
    patch, marked = {}, []
    for key, value in proposed.items():
        before = existing.get(key)
        if isinstance(value, dict):
            merged = dict(before or {})
            for locale, text in value.items():
                if merged.get(locale) in (None, ""):
                    merged[locale] = text
                    marked.append(f"{key}.{locale}")
            if merged != (before or {}):
                patch[key] = merged
        elif before in (None, ""):
            patch[key] = value
            marked.append(key)
    return patch, marked


def synthetic_png(kind: str) -> bytes:
    """Simple generated test graphic, deliberately unlike a project photograph."""
    from PIL import Image, ImageDraw
    if kind not in {"hero", "thumbnail", "logo"}:
        raise ValueError("Unknown synthetic asset kind")
    picture = Image.new("RGB", (960, 540), "#073d32")
    draw = ImageDraw.Draw(picture)
    draw.rectangle((35, 35, 925, 505), outline="#d6bc79", width=4)
    draw.rectangle((90, 140, 385, 405), outline="#d6bc79", width=8)
    draw.line((238, 140, 238, 405), fill="#d6bc79", width=6)
    draw.line((90, 275, 385, 275), fill="#d6bc79", width=6)
    draw.text((430, 170), "SYNTHETIC DEMO", fill="#ffffff", font_size=38)
    draw.text((430, 235), kind.upper(), fill="#d6bc79", font_size=28)
    draw.text((430, 295), "NOT A REAL PROJECT IMAGE", fill="#ffffff", font_size=20)
    output = io.BytesIO()
    picture.save(output, format="PNG")
    return output.getvalue()


async def role(db, name: str):
    if name not in {"editor", "publisher", "admin", "none"}:
        raise ValueError("Invalid seed role")
    await db.execute("RESET ROLE" if name == "none" else f"SET LOCAL ROLE {name}")


async def seed(db) -> dict:
    """Caller owns one transaction; tests may roll it back without changing data."""
    await db.execute("SELECT pg_advisory_xact_lock(hashtextextended('residential-demo-v1',0))")
    await db.execute("SELECT set_config('app.actor_id',$1,true),set_config('app.change_reason',$2,true)", ACTOR, EVIDENCE)
    await role(db, "none")
    target = await db.fetchrow("SELECT current_database() AS database,host(inet_server_addr()) AS host,inet_server_port() AS port")
    if any(target[key] != value for key, value in TARGET.items()):
        raise ValueError("Not the fixed local TEST target")
    # Fresh local setup only: existing source rows win, including their exact text.
    await db.execute("""INSERT INTO staging.rem_brands(rem_brand_id,brand_name_rem,brand_name_en_rem,
        source_updated_at,source_fingerprint,source_record) VALUES('25','เฟล็กซี่','FLEXI',now(),$1,$2)
        ON CONFLICT DO NOTHING""", EVIDENCE, SOURCE)
    await db.execute("""INSERT INTO staging.rem_projects(rem_project_id,project_name_rem,rem_brand_id,
        source_updated_at,source_fingerprint,source_record)
        VALUES('HYABC','HYABC — ข้อมูลตัวอย่างสำหรับเดโม','25',now(),$1,$2) ON CONFLICT DO NOTHING""", EVIDENCE, SOURCE)
    brand = await db.fetchrow("SELECT * FROM hub.brands WHERE rem_brand_id='25' AND deleted_at IS NULL")
    if brand is None:
        await role(db, "admin")
        await db.fetchval("SELECT hub.create_brand_from_rem('25')")
        await role(db, "none")
        brand = await db.fetchrow("SELECT * FROM hub.brands WHERE rem_brand_id='25'")
    project = await db.fetchrow("SELECT * FROM hub.projects WHERE rem_project_id='HYABC' AND deleted_at IS NULL")
    if project is None:
        await role(db, "editor")
        await db.fetchval("SELECT hub.create_project_from_rem('HYABC')")
        await role(db, "none")
        project = await db.fetchrow("SELECT * FROM hub.projects WHERE rem_project_id='HYABC'")
    if project['brand_id'] not in (None, brand['id']):
        raise ValueError("Existing HYABC brand differs; preserved without mutation")
    introduced = []
    for kind, record, proposed, function in [
        ("brand", brand, {"slug": "flexi-demo", "description": {"th": "ข้อมูลตัวอย่าง: แนวคิดที่อยู่อาศัยเพื่อสาธิตการจัดการแบรนด์ ไม่ใช่ข้อความที่อนุมัติใช้งานจริง"}}, "hub.update_brand_draft"),
        ("project", project, {"slug": "hyabc-demo", "latitude": "13.7563", "longitude": "100.5018",
            "address": {"th": "ข้อมูลตัวอย่าง: ที่อยู่สำหรับเดโมเท่านั้น"},
            "ad_disclaimer": {"th": "ข้อมูลตัวอย่างและภาพประกอบใช้สาธิตระบบภายในเท่านั้น ไม่ใช่ข้อเสนอขายหรือข้อมูลโครงการที่ได้รับการรับรอง"},
            "meta_title": {"th": "HYABC — ข้อมูลตัวอย่าง"},
            "meta_description": {"th": "ตัวอย่างข้อมูลเพื่อทดลองแก้ไข ตรวจทาน และเผยแพร่แบบเป็นชุดใน Digital Hub"}}, "hub.patch_project"),
    ]:
        patch, fields = missing_fields(dict(record), proposed)
        if patch:
            await role(db, "editor")
            await db.fetchval(f"SELECT {function}($1,$2,$3)", record['id'], patch, record['updated_at'])
            await role(db, "none")
            await db.fetchval("SELECT hub.mark_demo_fields($1,$2,$3)", kind, record['id'], fields)
            introduced.extend(f"{kind}.{field}" for field in fields)
    project = await db.fetchrow("SELECT * FROM hub.projects WHERE id=$1", project['id'])
    if project['brand_id'] is None:
        await role(db, "editor")
        await db.fetchval("SELECT hub.assign_project_brand($1,$2,$3)", project['id'], brand['id'], project['updated_at'])
        await role(db, "none")

    source_model = await db.fetchrow("SELECT * FROM staging.rem_models WHERE rem_project_id='HYABC' AND rem_model_id=$1", MODEL)
    if source_model is not None and source_model['source_record'] != SOURCE:
        raise ValueError("Synthetic model key is occupied; no original model changed")
    await db.execute("""INSERT INTO staging.rem_models(rem_project_id,rem_model_id,model_name_rem,
        source_updated_at,source_fingerprint,source_record)
        VALUES('HYABC',$1,'แบบตัวอย่างสำหรับเดโม — ไม่ใช่แบบขายจริง',now(),$2,$3) ON CONFLICT DO NOTHING""", MODEL, EVIDENCE, SOURCE)
    model = await db.fetchrow("SELECT * FROM hub.model_types WHERE project_id=$1 AND rem_model_id=$2 AND deleted_at IS NULL", project['id'], MODEL)
    if model is None:
        stamp = await db.fetchval("SELECT updated_at FROM hub.projects WHERE id=$1", project['id'])
        await role(db, "editor")
        await db.fetchval("SELECT hub.add_model_from_rem($1,$2,$3)", project['id'], MODEL, stamp)
        await role(db, "none")
        model = await db.fetchrow("SELECT * FROM hub.model_types WHERE project_id=$1 AND rem_model_id=$2", project['id'], MODEL)
        stamp = await db.fetchval("SELECT updated_at FROM hub.projects WHERE id=$1", project['id'])
        await role(db, "editor")
        await db.fetchval("SELECT hub.update_model($1,$2,$3,$4)", project['id'], model['public_model_id'],
            {"public_name": {"th": "แบบตัวอย่าง 1 — ไม่ใช่แบบขายจริง"}, "bedrooms": 1, "bathrooms": 1, "usable_area_sqm": "30.00", "parking_spaces": 0}, stamp)
        await role(db, "none")
        stamp = await db.fetchval("SELECT updated_at FROM hub.projects WHERE id=$1", project['id'])
        await role(db, "editor")
        await db.fetchval("SELECT hub.review_model($1,$2,$3,'CONFIRMED',$4)", project['id'], model['public_model_id'], stamp, EVIDENCE)
        await role(db, "none")
        await db.fetchval("SELECT hub.mark_demo_fields('model',$1,$2)", model['id'],
            ['source','public_name.th','bedrooms','bathrooms','usable_area_sqm','parking_spaces','match_status'])

    selections = []
    for kind in ("hero", "thumbnail", "logo"):
        content = synthetic_png(kind)
        metadata = validate_file(content, "image/png", f"demo-residential-{kind}.png")
        install_file(content, metadata)
        await role(db, "editor")
        result = await db.fetchval("SELECT hub.register_uploaded_asset($1)", metadata)
        asset = result['asset']
        if not result['reused']:
            await role(db, "publisher")
            await db.fetchval("SELECT hub.review_asset($1,$2,'approved',$3,NULL,NULL,$4)",
                UUID(asset['id']), datetime.fromisoformat(asset['updated_at']), EVIDENCE, EVIDENCE)
        await role(db, "none")
        await db.fetchval("SELECT hub.mark_demo_asset($1,$2,$3)", UUID(asset['id']), metadata['checksum'], EVIDENCE)
        selections.append({"asset_id": asset['id'], "asset_role": 'logo_primary' if kind == 'logo' else kind,
            "alt_text": {"th": "ข้อมูลตัวอย่าง: ภาพกราฟิกสังเคราะห์ ไม่ใช่ภาพโครงการจริง"}})
    await db.fetchval("SELECT hub.configure_demo_selection('brand',$1,$2,$3,$4)", brand['id'], [selections[2]], [], EVIDENCE)
    await db.fetchval("SELECT hub.configure_demo_selection('project',$1,$2,$3,$4)", project['id'], selections[:2], [model['id']], EVIDENCE)

    promotion = await db.fetchrow("SELECT * FROM hub.public_promotions WHERE code='DEMO-HYABC-WELCOME'")
    if promotion is None:
        await role(db, "editor")
        result = await db.fetchval("SELECT hub.promotion_command('create',NULL,$1)", {
            "project_id": str(project['id']), "code": "DEMO-HYABC-WELCOME",
            "title": {"th": "โปรโมชั่นตัวอย่าง HYABC"}, "summary": {"th": "ของขวัญตัวอย่างเพื่อสาธิตระบบ ไม่มีสิทธิ์รับของจริง"},
            "conditions_public": {"th": "ข้อมูลตัวอย่างสำหรับการนำเสนอภายในเท่านั้น"},
            "legal_terms": {"th": "ไม่ใช่ข้อเสนอขาย ไม่ก่อให้เกิดสิทธิ์หรือภาระผูกพันใด"},
            "disclaimer": {"th": "ข้อมูลตัวอย่าง — ยังไม่ใช่ข้อความที่ฝ่ายกฎหมายอนุมัติใช้งานจริง"},
            "benefit_type": "gift", "benefit_value": "1.00", "benefit_unit": "items", "stackable": False, "priority": 100,
            "starts_at": "2026-10-01T00:00:00+07:00", "ends_at": "2027-04-01T00:00:00+07:00",
            "source_offer_key": None,
        })
        promotion_id = UUID(result['id'])
        await role(db, "publisher")
        for review in ("DATA", "LEGAL"):
            await db.fetchval("SELECT hub.promotion_command('review',$1,$2)", promotion_id, {
                "expected_revision": 1, "review_revision": 1, "review_type": review,
                "decision": "APPROVED", "evidence": EVIDENCE, "change_reason": EVIDENCE,
            })
        await role(db, "none")
    else:
        if not promotion['synthetic'] or promotion['project_id'] != project['id']:
            raise ValueError("Demo promotion code is occupied; existing content preserved")
        promotion_id = promotion['id']
    return {"status": "SEEDED", "environment": "local-test", "synthetic_only": True,
        "project_id": str(project['id']), "brand_id": str(brand['id']), "promotion_id": str(promotion_id),
        "introduced_fields": introduced, "publication": "Publisher selects explicit demo mode; no publication performed"}


async def run():
    import asyncpg
    config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf-8'))
    if any(config.get(key, value) != value for key, value in TARGET.items()):
        raise ValueError("Refusing a target other than the fixed local TEST database")
    db = await asyncpg.connect(**TARGET, user='postgres', password=config['adminPassword'], timeout=10)
    try:
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        async with db.transaction():
            return await seed(db)
    finally:
        await db.close()


if __name__ == '__main__':
    try:
        print(json.dumps(asyncio.run(run()), ensure_ascii=True, indent=2))
    except Exception as error:
        # Never emit connection strings, payloads or credentials on errors.
        print(f"Residential seed stopped ({type(error).__name__}); no database changes committed.", file=sys.stderr)
        raise SystemExit(1) from None
