"""Read-only operator-export validation for P2; never archives an original workbook.

Profiles are explicit handoff evidence, not discovered headers. This module performs
no network/database access until apply_local is called with a validated projection.
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import hashlib
import io
import json
import re
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parents[3]
COST_TYPES = frozenset({"MEDIA", "AGENCY_FEE", "CHANNEL", "TOOL", "BANK_FEE"})
LEDGER_REQUIRED = {"rem_project_id", "formatted_mapping", "bud", "agency", "gross_amount", "fee_po_ref"}
LEDGER_OPTIONAL = {"memo_no"}
CARD_REQUIRED = {"charge_date", "amount", "category", "bud", "detail"}
CARD_OPTIONAL = {"posting_date", "direction", "memo_no", "account_id", "platform"}
MONEY = re.compile(r"(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?\Z", re.ASCII)
FORBIDDEN_HEADER = re.compile(r"card.?number|card.?holder|last.?4|last.?four|address|เลขบัตร|ท้ายบัตร|ชื่อผู้ถือ|ที่อยู่", re.I)
SENSITIVE_CELL = re.compile(r"(?:[xX*•]{3,}[- ]*[0-9]{4})|(?:\b[0-9]{4}[- ][0-9]{4}[- ][0-9]{4}[- ][0-9]{4}\b)|(?:\b[0-9]{16}\b)")
LIMIT_BYTES = 10 * 1024 * 1024
LIMIT_ROWS = 5000


class ImportFormatError(ValueError):
    """Safe structural error: messages never include discarded cells/headers."""


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value: object) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def text(value: object, label: str, maximum: int = 200) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum or any(ord(c) < 32 for c in value):
        raise ImportFormatError(f"ข้อมูล {label} ต้องเป็นข้อความที่ถูกต้อง")
    return value


def money(value: object) -> str:
    if not isinstance(value, str) or not MONEY.fullmatch(value):
        raise ImportFormatError("จำนวนเงินต้องเป็นข้อความทศนิยมไม่เกิน 2 ตำแหน่ง ไม่มีเครื่องหมายคั่นหลัก")
    return format(Decimal(value), ".2f")


def iso_date(value: object, *, month: bool = False) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ImportFormatError("วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ImportFormatError("วันที่ไม่ถูกต้อง") from None
    if month and parsed.day != 1:
        raise ImportFormatError("เดือนต้องเป็นวันที่ 1 ตามปฏิทิน Asia/Bangkok")
    return value


def _profile(manifest: dict, kind: str) -> tuple[dict, dict[str, str]]:
    profile = manifest.get("header_profile")
    if not isinstance(profile, dict) or type(profile.get("version")) is not int or profile["version"] != 1:
        raise ImportFormatError("ไม่พบรุ่นของรูปแบบหัวคอลัมน์ที่รองรับ")
    text(profile.get("id"), "รหัสรูปแบบ")
    synthetic = profile.get("synthetic") is True
    if not synthetic:
        if profile.get("status") != "APPROVED":
            raise ImportFormatError("รูปแบบข้อมูลจริงต้องมีหลักฐานการทบทวนก่อนใช้งาน")
        text(profile.get("evidence_ref"), "หลักฐานรูปแบบ", 500)
        text(profile.get("reviewed_by"), "ผู้ทบทวนรูปแบบ")
    if manifest.get("safe_projection_reviewed") is not True:
        raise ImportFormatError("กรุณายืนยันว่าไฟล์ส่งออกตัดข้อมูลส่วนบุคคลและเลขบัตรแล้ว")
    headers = profile.get("headers")
    required, optional = (LEDGER_REQUIRED, LEDGER_OPTIONAL) if kind == "ledger" else (CARD_REQUIRED, CARD_OPTIONAL)
    if not isinstance(headers, dict) or not required.issubset(headers) or set(headers) - required - optional:
        raise ImportFormatError("ความหมายของหัวคอลัมน์ไม่ครบหรือไม่รองรับ")
    values = [text(v, "หัวคอลัมน์") for v in headers.values()]
    if len(set(values)) != len(values) or any(FORBIDDEN_HEADER.search(v) for v in values):
        raise ImportFormatError("หัวคอลัมน์กำกวมหรือมีข้อมูลที่ไม่อนุญาตให้เก็บ")
    discarded = profile.get("discard_headers", [])
    if not isinstance(discarded, list) or any(not isinstance(v, str) for v in discarded) or set(discarded) & set(values):
        raise ImportFormatError("รายการคอลัมน์ที่ตัดออกไม่ถูกต้อง")
    if kind == "ledger" and discarded:
        raise ImportFormatError("ไฟล์รายการงบต้องส่งออกเฉพาะคอลัมน์ที่อนุญาต")
    if kind == "card":
        mapping = profile.get("category_map", {})
        if not isinstance(mapping, dict) or any(not isinstance(k, str) or not isinstance(v, str) or v not in COST_TYPES for k, v in mapping.items()):
            raise ImportFormatError("การจับคู่ประเภทค่าใช้จ่ายไม่ถูกต้อง")
    return profile, headers


def validate_export(manifest: dict, csv_text: str, kind: str) -> dict:
    """Return safe RPC payload, including semantic issues for atomic quarantine.

    Structural and privacy failures raise before producing any retainable payload.
    Hashes cover only the reviewed retained projection; identical card hashes are legal.
    """
    if kind not in {"ledger", "card"} or not isinstance(manifest, dict) or type(manifest.get("format_version")) is not int or manifest["format_version"] != 1:
        raise ImportFormatError("ชนิดหรือรุ่นของไฟล์นำเข้าไม่ถูกต้อง")
    if not isinstance(csv_text, str) or len(csv_text.encode("utf-8")) > LIMIT_BYTES:
        raise ImportFormatError("ไฟล์นำเข้ามีขนาดเกินกำหนด")
    profile, headers = _profile(manifest, kind)
    source = text(manifest.get("logical_source_id"), "รหัสแหล่งข้อมูล")
    source_file = text(manifest.get("source_file"), "ชื่อไฟล์", 250)
    tab = text(manifest.get("tab"), "ชื่อแท็บ")
    if kind == "ledger" and tab.casefold() in {"draft", "summary", "payment", "target"}:
        raise ImportFormatError("แท็บนี้ไม่ใช่รายการงบรายเดือน")
    try:
        exported_at = datetime.fromisoformat(manifest["exported_at"])
        if exported_at.tzinfo is None:
            raise ValueError
    except (KeyError, TypeError, ValueError):
        raise ImportFormatError("เวลาส่งออกต้องระบุเขตเวลา") from None
    source_rows = manifest.get("source_rows")
    if not isinstance(source_rows, list) or not source_rows or len(source_rows) > LIMIT_ROWS or any(type(n) is not int or n < 1 for n in source_rows) or len(set(source_rows)) != len(source_rows):
        raise ImportFormatError("หมายเลขแถวต้นทางต้องไม่ซ้ำและอยู่ในขอบเขตที่รองรับ")
    header_row = manifest.get("source_header_row")
    if type(header_row) is not int or header_row < 1 or any(n <= header_row for n in source_rows):
        raise ImportFormatError("ตำแหน่งหัวตารางและแถวต้นทางไม่ถูกต้อง")
    reader = csv.reader(io.StringIO(csv_text.lstrip("\ufeff")), strict=True)
    try:
        actual = next(reader)
    except (StopIteration, csv.Error):
        raise ImportFormatError("ไฟล์ CSV ไม่มีหัวตารางที่ถูกต้อง") from None
    optional = LEDGER_OPTIONAL if kind == "ledger" else CARD_OPTIONAL
    required_names = {v for k, v in headers.items() if k not in optional}
    allowed = set(headers.values()) | set(profile.get("discard_headers", []))
    if len(actual) != len(set(actual)) or not required_names.issubset(actual) or set(actual) - allowed:
        raise ImportFormatError("หัวตารางขาด ซ้ำ หรือมีคอลัมน์ที่ไม่ได้รับการทบทวน")
    # Resolve by exact header, never by its position in another month's export.
    positions = {semantic: actual.index(header) for semantic, header in headers.items() if header in actual}
    retained_headers = {semantic: headers[semantic] for semantic in positions}
    payload = {"logical_source_id": source, "source_file": source_file, "tab": tab,
               "profile_id": profile["id"], "profile_version": profile["version"], "rows": [], "issues": [],
               "provenance": {"exported_at": exported_at.isoformat(), "header_map": retained_headers,
                              "source_header_row": header_row, "synthetic": profile.get("synthetic") is True,
                              "safe_projection_reviewed": True}}
    if kind == "ledger":
        payload["month"] = iso_date(manifest.get("month"), month=True)
    else:
        try:
            payload["statement_control_id"] = str(UUID(manifest["statement_control_id"]))
        except (ValueError, TypeError, KeyError, AttributeError):
            raise ImportFormatError("กรุณาระบุรหัสใบแจ้งยอดที่ถูกต้อง") from None
        payload["control_total"] = money(manifest.get("control_total"))
    debit, credit, keys = Decimal(0), Decimal(0), set()
    try:
        for index, values in enumerate(reader):
            if index >= len(source_rows) or len(values) != len(actual):
                raise ImportFormatError("จำนวนแถวหรือคอลัมน์ไม่ตรงกับข้อมูลกำกับ")
            row_no = source_rows[index]
            raw = {headers[k]: values[pos] for k, pos in positions.items()}
            # Known high-risk shapes fail closed; operator review is still required
            # for free-text PII that cannot be identified by a general regex.
            # A reviewed account-ID column can contain a long numeric identifier.
            # Do not mistake that typed source ID for card text in free-form cells.
            if any(len(values[pos]) > 2000 or "\x00" in values[pos] or
                   (SENSITIVE_CELL.search(values[pos]) and not
                    (semantic == "account_id" and re.fullmatch(r"[0-9]+", values[pos])))
                   for semantic, pos in positions.items()):
                raise ImportFormatError("พบข้อมูลที่ต้องตัดออกหรือทบทวนในไฟล์ส่งออก")
            data = {k: values[pos] for k, pos in positions.items()}
            row = {"row_no": row_no, "row_hash": digest(raw), "raw_row": raw}

            def issue(code: str, field: str, message: str) -> None:
                payload["issues"].append({"code": code, "row_no": row_no, "field": field, "message": message})

            if kind == "ledger":
                for field in ("rem_project_id", "formatted_mapping", "bud", "agency"):
                    try:
                        row[field] = text(data[field], field)
                    except ImportFormatError:
                        issue("missing_identity", field, "รหัสอ้างอิงไม่ครบ กรุณาตรวจต้นทาง")
                try:
                    row["gross_amount"] = money(data["gross_amount"])
                except ImportFormatError:
                    issue("invalid_amount", "gross_amount", "จำนวนเงินไม่ถูกต้อง")
                row["memo_no"] = data.get("memo_no") or None
                row["fee_po_ref"] = data.get("fee_po_ref") or None
                natural = (row.get("rem_project_id"), payload["month"], row.get("agency"))
                if natural in keys:
                    issue("duplicate_phase", "rem_project_id", "พบรายการเฟส เดือน และเอเจนซีซ้ำ")
                keys.add(natural)
            else:
                for field in ("charge_date", "posting_date"):
                    if field == "posting_date" and not data.get(field):
                        row[field] = None
                        continue
                    try:
                        row[field] = iso_date(data[field])
                    except ImportFormatError:
                        issue("invalid_date", field, "วันที่ไม่ถูกต้อง")
                direction = data.get("direction") or "DEBIT"
                row.update({"direction": direction, "category": data["category"], "bud": data["bud"],
                            "detail": data["detail"], "cost_type": profile.get("category_map", {}).get(data["category"]),
                            "payment_method": "CORPORATE_CARD", "memo_no": data.get("memo_no") or None,
                            "account_id": data.get("account_id") or None, "platform": data.get("platform") or None})
                if direction not in {"DEBIT", "CREDIT"}:
                    issue("invalid_direction", "direction", "กรุณาระบุ DEBIT หรือ CREDIT")
                try:
                    row["amount"] = money(data["amount"])
                    if direction == "DEBIT":
                        debit += Decimal(row["amount"])
                    elif direction == "CREDIT":
                        credit += Decimal(row["amount"])
                except ImportFormatError:
                    issue("invalid_amount", "amount", "จำนวนเงินไม่ถูกต้อง")
                # This is a profile-confirmed literal rule, not a fuzzy classifier.
                rule = profile.get("account_descriptor_rule")
                if rule is not None:
                    if not isinstance(rule, dict) or set(rule) != {"prefix", "suffix", "platform", "digits"} or rule["platform"] != "GOOGLE" or rule["digits"] != 10:
                        raise ImportFormatError("กฎรหัสบัญชีในคำอธิบายไม่รองรับ")
                    prefix, suffix = rule["prefix"], rule["suffix"]
                    if not isinstance(prefix, str) or not prefix or not isinstance(suffix, str):
                        raise ImportFormatError("กฎรหัสบัญชีในคำอธิบายไม่ถูกต้อง")
                    match = re.fullmatch(re.escape(prefix) + r"([0-9]{10})" + re.escape(suffix), data["detail"])
                    if match:
                        parsed = match.group(1)
                        if row["account_id"] not in {None, parsed} or row["platform"] not in {None, "GOOGLE"}:
                            issue("account_conflict", "account_id", "รหัสบัญชีไม่ตรงกับหลักฐานคำอธิบาย")
                        else:
                            row["account_id"], row["platform"] = parsed, "GOOGLE"
            payload["rows"].append(row)
    except csv.Error:
        raise ImportFormatError("รูปแบบ CSV ไม่ถูกต้อง") from None
    if len(payload["rows"]) != len(source_rows):
        raise ImportFormatError("จำนวนแถวไม่ตรงกับข้อมูลกำกับ")
    if kind == "card":
        payload.update(net_total=format(debit - credit, ".2f"), debit_total=format(debit, ".2f"), credit_total=format(credit, ".2f"))
        if debit - credit != Decimal(payload["control_total"]):
            payload["issues"].append({"code": "statement_total_mismatch", "field": "amount", "message": "ยอดรวมไม่ตรงกับใบแจ้งยอด ห้ามเติมรายการปรับยอด"})
    identity = {k: v for k, v in payload.items() if k not in {"source_file", "provenance", "issues"}}
    identity["header_map"] = retained_headers
    identity["profile_rules"] = {k: profile[k] for k in ("category_map", "account_descriptor_rule") if k in profile}
    payload["source_fingerprint"] = digest(identity)
    return payload


async def apply_local(kind: str, payload: dict, actor_id: UUID) -> dict:
    """Local trusted operator only; runtime role and guarded SQL enforce domain rules."""
    import asyncpg

    config = json.loads((ROOT / ".local/development.json").read_text(encoding="utf-8"))
    connection = await asyncpg.connect(host="127.0.0.1", port=55432, database="sena_hub_local",
                                      user="hub_runtime", password=config["runtimePassword"], timeout=10)
    try:
        await connection.set_type_codec("jsonb", schema="pg_catalog", encoder=json.dumps, decoder=json.loads)
        async with connection.transaction():
            await connection.execute("SET LOCAL ROLE hub_app")
            await connection.execute("SELECT set_config('app.actor_id',$1,true)", str(actor_id))
            await connection.execute("SELECT set_config('app.change_reason','Validated operator finance export',true)")
            return await connection.fetchval("SELECT ads.finance_command($1,$2::jsonb)", kind + "_import", payload)
    finally:
        await connection.close()


def main(kind: str) -> int:
    parser = argparse.ArgumentParser(description="ตรวจไฟล์ส่งออกรายการงบ/ค่าใช้จ่าย โดยไม่เปลี่ยนข้อมูลต้นทาง")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--actor-id", type=UUID, default=UUID(int=6), help="ผู้ดำเนินการทดสอบในฐานข้อมูลภายในเครื่อง")
    args = parser.parse_args()
    try:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
        csv_file = text(manifest.get("csv_file"), "ไฟล์ CSV", 500)
        path = (args.manifest.parent / csv_file).resolve()
        if path.stat().st_size > LIMIT_BYTES:
            raise ImportFormatError("ไฟล์นำเข้ามีขนาดเกินกำหนด")
        payload = validate_export(manifest, path.read_text(encoding="utf-8-sig"), kind)
        result = asyncio.run(apply_local(kind, payload, args.actor_id)) if args.apply else None
        status = result.get("status", "APPLIED") if result else ("QUARANTINED_DRY_RUN" if payload["issues"] else "VALIDATED_DRY_RUN")
        # Only safe summaries leave the importer. No raw source values or credentials.
        print(json.dumps({"status": status, "id": result.get("id") if result else None,
                          "replayed": result.get("replayed", False) if result else False,
                          "row_count": len(payload["rows"]), "source_fingerprint": payload["source_fingerprint"],
                          "net_total": payload.get("net_total"), "issue_codes": [x["code"] for x in payload["issues"]],
                          "external_sources_changed": False}, ensure_ascii=True))
        return 1 if "QUARANTINED" in status else 0
    except (ImportFormatError, OSError, UnicodeError, json.JSONDecodeError) as error:
        safe = str(error) if isinstance(error, ImportFormatError) else "อ่านไฟล์ส่งออกไม่ได้ กรุณาตรวจรูปแบบและตำแหน่งไฟล์"
        print(json.dumps({"status": "REJECTED", "message": safe}, ensure_ascii=True))
    except Exception:
        print(json.dumps({"status": "REJECTED", "message": "นำเข้าไม่สำเร็จ กรุณาตรวจฐานข้อมูลภายในเครื่อง ไม่มีการบันทึกบางส่วน"}, ensure_ascii=True))
    return 1
