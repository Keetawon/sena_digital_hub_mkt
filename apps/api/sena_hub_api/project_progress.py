"""Read-only staff progress, derived from existing readiness and frozen versions."""
from datetime import datetime, timedelta, timezone


def review_content(value):
    value = value or {}
    localized = lambda field: {key: text for key, text in (value.get(field) or {}).items() if text}
    result = {field: localized(field) for field in ("public_name", "address", "ad_disclaimer", "meta_title", "meta_description")}
    result.update({field: value.get(field) for field in ("latitude", "longitude", "brand_id", "brand_version_id")})
    result["slug"] = value.get("slug") or ""
    models = [model for model in value.get("models", []) if model.get("match_status") != "REJECTED"]
    result["models"] = sorted([{key: model.get(key) for key in (
        "public_model_id", "rem_model_id", "public_name", "bedrooms", "bathrooms", "usable_area_sqm", "parking_spaces", "match_status"
    )} for model in models], key=lambda model: model["public_model_id"])
    model_ids = {model["public_model_id"] for model in models}
    result["assets"] = sorted([{key: asset.get(key) for key in (
        "id", "asset_role", "public_model_id", "is_primary", "alt_text", "display_order", "public_url", "rights_status", "effective_from", "effective_to"
    )} for asset in value.get("assets", []) if not asset.get("public_model_id") or asset["public_model_id"] in model_ids],
        key=lambda asset: (asset["id"], asset["asset_role"], asset["public_model_id"] or ""))
    return result


def timestamp(value):
    if isinstance(value, datetime):
        return value if value.tzinfo else None
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else None
        except ValueError:
            pass
    return None


def gap_group(field, project):
    if "brand" in field.lower():
        return "brand"
    if "model" in field.lower() or any(asset.get("public_model_id") and asset["id"] in field.split(".") for asset in project.get("assets", [])):
        return "models"
    if any(word in field.lower() for word in ("hero", "thumbnail", "asset")):
        return "media"
    return "core"


def source_membership(source):
    """Staff navigation only: REM identity and Gold claims remain distinct."""
    raw = source.get("source_record") or {}
    gold = (source.get("gold_source") or {}).get("record") or {}
    rem_group = raw.get("ProjectGroupID") if "ProjectGroupID" in raw else raw.get("rem_project_group_id")
    marketing_group = gold.get("marketing_project_group_id")
    # Treat a blank reference as missing without normalizing any nonblank key.
    text_id = lambda value: value if isinstance(value, str) and value.strip() else None
    rem_group, marketing_group = text_id(rem_group), text_id(marketing_group)
    exceptions = (source.get("source_review") or {}).get("exceptions") or []
    conflict = any(item.get("code") == "GOLD_PROJECT_IDENTITY_OR_GROUP_CONFLICT" for item in exceptions)
    conflict = conflict or gold.get("project_group_conflict") in (True, "true") or gold.get("project_identity_conflict") in (True, "true")
    # REM and Marketing group IDs belong to separate namespaces.
    return {"rem_brand_id": text_id(source.get("rem_brand_id")), "rem_project_group_id": rem_group,
            "marketing_project_group_id": marketing_group,
            "group_status": "conflict" if conflict else "rem_reference" if rem_group else "missing"}


def build_progress(records, sources, assets, now=None):
    now = now or datetime.now(timezone.utc)
    asset_by_id = {str(asset["id"]): asset for asset in assets}
    source_by_id = {source["rem_project_id"]: source for source in sources}
    rows = []

    def source_review(source):
        if source.get('source_review'):
            return source['source_review']
        raw = source.get('source_record') or {}
        status = raw.get('ProjectStatus', raw.get('project_status'))
        status = str(status) if status is not None else None
        deleted = raw.get('isDeleted', raw.get('is_deleted'))
        return {'status_raw': status, 'status_label': {'0': 'พรีเซล', '1': 'กำลังก่อสร้าง', '2': 'พร้อมอยู่', '3': 'ปิดโครงการ'}.get(status, 'ไม่ทราบสถานะ'),
                'is_deleted': deleted, 'default_scope': deleted is False and status in ('0', '1', '2'), 'flags': [], 'exceptions': []}

    def age(source):
        first = timestamp(source.get("first_seen_at"))
        imported = timestamp(source.get("mirror_imported_at"))
        observed = first or imported
        return {"first_seen_at": observed.isoformat() if observed else None,
                "age_days": max(0, (now - observed).days) if observed else None,
                "age_basis": "first_import" if first and source_review(source).get('first_import_only') else "first_seen" if first else "mirror_import" if imported else "unknown"}

    for record in records:
        project = record["detail"]
        if not project:
            continue
        source_id = project["source"]["rem_project_id"]
        source = source_by_id.get(source_id, project["source"])
        raw = source.get("source_record") or {}
        review = source_review(source)
        live = record.get("live_payload")
        has_changes = not live or review_content(project) != review_content(live)
        readiness = project["readiness"]
        gaps = {group: [] for group in ("core", "media", "models", "brand")}
        for item in readiness["missing"]:
            gaps[gap_group(item["field"], project)].append(item)
        pending_rights = any(asset.get("rights_status") == "pending" for asset in project.get("assets", []))
        attention = []
        if project.get("published_version_id"):
            if record.get("live_brand_withdrawn"):
                attention.append({"field": "brand", "message": "แบรนด์ที่เผยแพร่ถูกถอนการเผยแพร่แล้ว"})
            for binding in (live or {}).get("assets", []):
                if binding.get("asset_role") not in ("hero", "thumbnail") or binding.get("public_model_id"):
                    continue
                current = asset_by_id.get(binding["id"], {})
                name = "ภาพหลัก" if binding["asset_role"] == "hero" else "ภาพย่อ"
                field = f"assets.{binding['id']}.rights"
                if current.get("rights_status") == "revoked":
                    attention.append({"field": field, "message": f"{name}ถูกเพิกถอนสิทธิ์"})
                elif any(expiry and expiry <= now + timedelta(days=30) for expiry in (timestamp(current.get("effective_to")), timestamp(binding.get("effective_to")))):
                    attention.append({"field": field, "message": f"สิทธิ์{name}หมดอายุหรือจะหมดภายใน 30 วัน"})
            if review.get("is_deleted") is True:
                attention.append({"field": "source", "message": "โครงการต้นทาง REM ถูกลบ"})
            elif review.get('status_raw') == '3':
                attention.append({'field': 'source', 'message': 'โครงการต้นทาง REM ปิดโครงการ (3)'})
            elif raw.get("is_active") is False or str(raw.get("project_status", "")).lower() == "inactive":
                attention.append({"field": "source", "message": "โครงการต้นทาง REM ไม่ใช้งาน"})
        awaiting = bool((readiness["ready"] and has_changes) or pending_rights)
        editor_gaps = any(not (pending_rights and "rights" in item["field"]) for item in readiness["missing"])
        models = project.get("models", [])
        facilities = project.get("facilities") or {}
        rows.append({"public_project_id": project["public_project_id"], "rem_project_id": source_id,
                     "name": project.get("public_name", {}).get("th") or source.get("project_name_rem") or source_id,
                     "brand_name": (project.get("brand_summary") or {}).get("public_name", {}).get("th") or source.get("brand_name_rem"),
                     "new_from_rem": False, "filling": not readiness["ready"], "awaiting_publisher": awaiting,
                     "published": bool(project.get("publication_available")), "needs_attention": bool(attention), "attention": attention,
                     "has_unpublished_changes": has_changes, "withdrawn": not project.get("published_version_id") and bool(record.get("version_count")),
                     "gaps": gaps, "confirmed_models": sum(model["match_status"] == "CONFIRMED" for model in models), "total_models": len(models),
                     "amenities": {"collected": facilities.get("collected_count", 0), "total": facilities.get("expected_count", 0)},
                     "waiting_on": (["editor"] if editor_gaps else []) + (["publisher"] if awaiting else []),
                     "updated_at": project.get("updated_at"), 'source_review': review, **age(source), **source_membership(source)})

    for source in sources:
        if source.get("public_project_id"):
            continue
        rows.append({"public_project_id": None, "rem_project_id": source["rem_project_id"], "name": source["project_name_rem"],
                     "brand_name": source.get("brand_name_rem"), "new_from_rem": True, "filling": False, "awaiting_publisher": False,
                     "published": False, "needs_attention": False, "attention": [], "has_unpublished_changes": False, "withdrawn": False,
                     "gaps": {group: [] for group in ("core", "media", "models", "brand")}, "confirmed_models": 0, "total_models": source["model_count"],
                     "amenities": None, "waiting_on": ["editor"], "updated_at": None, 'source_review': source_review(source), **age(source), **source_membership(source)})
    counts = {key: sum(bool(row[key]) and (row['source_review']['default_scope'] or key == 'needs_attention') for row in rows)
              for key in ("new_from_rem", "filling", "awaiting_publisher", "published", "needs_attention")}
    counts["all"] = sum(row['source_review']['default_scope'] for row in rows)
    return {"rows": sorted(rows, key=lambda row: (-sum(len(items) for items in row["gaps"].values()), row["rem_project_id"])), "counts": counts}


async def read_progress(connection):
    records = await connection.fetch("""
        SELECT hub.project_detail(p.public_project_id) AS detail, live.payload AS live_payload,
          (SELECT count(*) FROM hub.entity_versions history WHERE history.project_id=p.id) AS version_count,
          (b.published_version_id IS NULL AND EXISTS(SELECT 1 FROM hub.brand_versions history WHERE history.brand_id=b.id)) AS live_brand_withdrawn
        FROM hub.projects p LEFT JOIN hub.entity_versions live ON live.id=p.published_version_id
        LEFT JOIN hub.brands b ON b.id=(live.payload->>'brand_id')::uuid
        WHERE p.deleted_at IS NULL ORDER BY p.public_project_id
    """)
    sources = await connection.fetchval("SELECT hub.list_rem_projects()")
    assets = await connection.fetch("SELECT id,rights_status,effective_to FROM hub.assets")
    return build_progress(records, sources, assets)
