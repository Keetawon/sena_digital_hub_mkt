"""Versioned policy questions, separate from records and approval settings."""
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

CATALOG_PATH = Path(__file__).parent / "data" / "questions.json"
STAFF_ROLES = frozenset({"editor", "publisher", "viewer", "online_staff", "admin"})
OWNER_GROUPS = frozenset({"note", "finance", "dpo", "media", "marketing", "it"})
PRESENTATION_FIELDS = ("id", "status", "owner_group", "owner_th", "question_th", "default_th", "links")
DOC_FIELDS = ("id_label", "question", "owner", "blocks", "default")


def load_catalog(path: Path = CATALOG_PATH) -> dict:
    catalog = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(catalog, dict) or set(catalog) != {"schema_version", "questions"} or type(catalog["schema_version"]) is not int or catalog["schema_version"] != 1:
        raise ValueError("Invalid question catalog version")
    entries = catalog["questions"]
    if not isinstance(entries, list) or len(entries) < 41:
        raise ValueError("Question catalog must retain all Q1–Q41 decisions")
    ids = []
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {*PRESENTATION_FIELDS, "doc"}:
            raise ValueError("Invalid question fields")
        if not isinstance(entry["id"], str) or not re.fullmatch(r"Q[1-9][0-9]*", entry["id"]):
            raise ValueError("Invalid question ID")
        ids.append(entry["id"])
        if entry["status"] not in {"PENDING", "RESOLVED", "DEFERRED"} or entry["owner_group"] not in OWNER_GROUPS:
            raise ValueError("Invalid question status or owner group")
        for field in ("owner_th", "question_th", "default_th"):
            value = entry[field]
            if not isinstance(value, str) or not value.strip() or not re.search(r"[\u0e00-\u0e7f]", value) or "\x00" in value:
                raise ValueError("Thai question presentation is required")
        doc = entry["doc"]
        if not isinstance(doc, dict) or set(doc) != set(DOC_FIELDS):
            raise ValueError("Invalid documentation fields")
        if any(not isinstance(doc[field], str) or not doc[field].strip() or any(c in doc[field] for c in "\n\r\x00|") for field in DOC_FIELDS):
            raise ValueError("Documentation fields must be single Markdown table cells")
        if not re.match(rf"^{entry['id']}(?:\s|$)", doc["id_label"]):
            raise ValueError("Documentation question ID differs")
        links = entry["links"]
        if not isinstance(links, list) or not links:
            raise ValueError("Question needs an affected-screen link")
        for link in links:
            if not isinstance(link, dict) or set(link) != {"href", "label"}:
                raise ValueError("Invalid question link")
            href, label = link["href"], link["label"]
            if not isinstance(href, str) or not href.startswith("/") or href.startswith("//") or "\\" in href or re.search(r"[\x00-\x20]", href):
                raise ValueError("Question links must be local Hub routes")
            parts = urlsplit(href)
            if parts.scheme or parts.netloc or parts.path not in {"/", "/questions", "/ads/registry", "/ads/registry/new", "/ads/finance", "/ads/actuals", "/ads/documents", "/ads/exceptions", "/ads/archive", "/promotions", "/releases"}:
                raise ValueError("Unknown affected-screen route")
            if not isinstance(label, str) or not re.search(r"[\u0e00-\u0e7f]", label):
                raise ValueError("Question link needs a Thai label")
    if ids != [f"Q{number}" for number in range(1, len(ids) + 1)]:
        raise ValueError("Question IDs must be unique, complete and ordered")
    return catalog


def pending_questions(catalog: dict) -> list[dict]:
    return [{field: entry[field] for field in PRESENTATION_FIELDS}
            for entry in catalog["questions"] if entry["status"] == "PENDING"]


def register_question_routes(app, authentication):
    from fastapi import Depends, Request
    from .auth import Actor, failure

    catalog = load_catalog()

    @app.get("/v1/admin/questions")
    async def questions(request: Request, actor: Actor = Depends(authentication)):
        if actor.role not in STAFF_ROLES:
            raise failure(403, "questions_forbidden", "หน้านี้สำหรับเจ้าหน้าที่ SENA ที่ได้รับสิทธิ์เท่านั้น")
        if request.query_params:
            raise failure(422, "invalid_question_filter", "ไม่รองรับตัวกรองคำถามนี้")
        return {"data": {"questions": pending_questions(catalog)}}
