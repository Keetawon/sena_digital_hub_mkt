"""Pure SENA-H grammar; registry membership and authorization belong to PostgreSQL."""
from __future__ import annotations

import re
from urllib.parse import quote

ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
WEIGHTS = (3, 5, 7, 9, 11, 13, 15)
OBJECTIVES = ("LEADS", "TRAFFIC", "AWARENESS", "ENGAGEMENT", "SALES", "VIDEOVIEWS", "CONVERSION")
SENA_H_PATTERN = (
    r"^[A-Z0-9][A-Z0-9 .\-]{0,39}__(LEADS|TRAFFIC|AWARENESS|ENGAGEMENT|SALES|VIDEOVIEWS|CONVERSION)__"
    r"((C|H|T|S)-[A-Z0-9]{4}-[A-Z0-9]{5}(-[A-Z0-9]+)?|ZONE-[A-Z0-9-]+|BRAND-[A-Z0-9-]+|CORP-[A-Z0-9-]+|BU-[A-Z0-9-]+)__"
    r"[A-Z0-9]{2,20}__SN[0-9]{7}[2-9A-HJ-NP-Z](__[A-Z0-9-]{1,24})?$"
)
SENA_H = re.compile(SENA_H_PATTERN)
LABEL = re.compile(r"[A-Z0-9][A-Z0-9 .\-]{0,39}")
CODE = re.compile(r"SN([0-9]{2})([0-9]{5})([2-9A-HJ-NP-Z])")
FIELD_NAMES = ("label", "objective", "scope", "agency", "code", "variant")


def sn_code(yy: int, seq: int) -> str:
    if type(yy) is not int or type(seq) is not int or not 0 <= yy <= 99 or not 1 <= seq <= 99999:
        raise ValueError("ปีและลำดับรหัสอยู่นอกช่วงที่รองรับ")
    digits = f"{yy:02d}{seq:05d}"
    return "SN" + digits + ALPHABET[sum(weight * int(digit) for weight, digit in zip(WEIGHTS, digits)) % 32]


def check(code: str) -> bool:
    match = CODE.fullmatch(code)
    return bool(match and int(match[2]) > 0 and sn_code(int(match[1]), int(match[2])) == code)


def parse(name: str) -> dict[str, str | None]:
    if not SENA_H.fullmatch(name) or len(name) > 150:
        raise ValueError("รูปแบบชื่อ SENA-H ไม่ถูกต้องหรือยาวเกิน 150 ตัวอักษร")
    parts = name.split("__")
    if not check(parts[4]):
        raise ValueError("รหัส SN หรืออักขระตรวจสอบไม่ถูกต้อง")
    return dict(zip(FIELD_NAMES, parts + ([None] if len(parts) == 5 else [])))


def generate(label: str, objective: str, scope: str, agency: str, code: str, variant: str | None = None) -> str:
    parts = [label, objective, scope, agency, code]
    if variant is not None:
        parts.append(variant)
    name = "__".join(parts)
    parse(name)
    return name


def validate(name: str) -> bool:
    try:
        parse(name)
    except ValueError:
        return False
    return True


def explain(name: str) -> dict:
    """Observed names are read-only evidence, never inputs to issue or bind."""
    parts = name.split("__")
    if len(parts) in {5, 6} or any(part.startswith("SN") for part in parts[4:5]):
        try:
            fields = parse(name)
        except ValueError as error:
            return {"template": "SENA-H", "valid": False, "message": str(error), "fields": None}
        return {"template": "SENA-H", "valid": True, "fields": fields,
                "message": "รูปแบบและอักขระตรวจสอบถูกต้อง ยังไม่ยืนยันว่าชื่อนี้ถูกออกโดยทะเบียน"}
    if len(parts) in {7, 8}:
        fields = dict(zip(("label", "objective", "scope", "bud", "memo", "agency", "po", "variant"),
                          parts + ([None] if len(parts) == 7 else [])))
        return {"template": "SENA-7", "valid": False, "fields": fields,
                "message": "ชื่อรูปแบบเดิม ใช้อธิบายข้อมูลเท่านั้น ไม่ใช่ชื่อ SENA-H ที่ออกใหม่"}
    return {"template": "V1/UNKNOWN", "valid": False, "fields": None,
            "message": "ชื่อเก่าหรือรูปแบบที่ยังไม่รองรับ กรุณาให้ทีมออนไลน์ตรวจสอบ"}


def launch_pack(name: str) -> dict[str, str]:
    """Encode campaign once; preserve the verified Google ValueTrack macro."""
    parse(name)
    google = "utm_campaign=" + quote(name, safe="") + "&utm_id={campaignid}"
    note = "utm_id ใช้รหัสแคมเปญของแพลตฟอร์ม; Google ใช้ {campaignid}; ห้ามใช้รหัส SN แทน"
    return {"utm_google": google, "launch_pack": f"ชื่อแคมเปญ: {name}\nutm_campaign: {name}\nGoogle: {google}\n{note}"}
