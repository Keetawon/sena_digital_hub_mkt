"""Tests for self-profile updates and private avatar storage/serving."""
import io

from PIL import Image

from test_accounts import REQUEST, accounts, decision, h


def _make_image_bytes(fmt: str, size=(320, 200), exif=False) -> bytes:
    img = Image.new("RGB", size, (15, 118, 110))
    buf = io.BytesIO()
    if fmt == "JPEG":
        kwargs = {}
        if exif:
            exif_obj = Image.Exif()
            exif_obj[0x010E] = "PrivateCameraNote"
            kwargs["exif"] = exif_obj.tobytes()
        img.save(buf, format="JPEG", **kwargs)
    else:
        img.save(buf, format=fmt)
    return buf.getvalue()


def test_self_profile_update_validation_and_agency_lock(accounts):
    client, _ = accounts
    assert client.post("/v1/me/access-request", headers=h("new"), json=REQUEST).status_code == 200
    # Pending account cannot update active self profile
    assert client.patch(
        "/v1/me/profile",
        headers=h("new"),
        json={
            "display_name_th": "ทดสอบ ใหม่",
            "phone": "0812345678",
            "team": "ทีมใหม่",
            "position": "ผู้จัดการ",
            "company_type": "SENA",
        },
    ).status_code == 403

    assert decision(client, "new", "approve", "editor").status_code == 200
    # Active staff update succeeds and persists in /v1/me
    updated = client.patch(
        "/v1/me/profile",
        headers=h("new"),
        json={
            "display_name_th": "กมลลักษณ์ แก้ไขแล้ว",
            "phone": "0891112222",
            "team": "ดิจิทัล",
            "position": "หัวหน้าทีม",
            "company_type": "SENA_SUBSIDIARY",
            "company_name": "เสนาโซลาร์",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["data"]["display_name_th"] == "กมลลักษณ์ แก้ไขแล้ว"
    assert client.get("/v1/me", headers=h("new")).json()["data"]["team"] == "ดิจิทัล"

    # Extra forbidden fields are rejected (422)
    escalate = client.patch(
        "/v1/me/profile",
        headers=h("new"),
        json={
            "display_name_th": "กมลลักษณ์ แก้ไขแล้ว",
            "phone": "0891112222",
            "team": "ดิจิทัล",
            "position": "หัวหน้าทีม",
            "company_type": "SENA",
            "hub_role": "admin",
        },
    )
    assert escalate.status_code == 422

    # Non-Thai name rejected (422)
    assert client.patch(
        "/v1/me/profile",
        headers=h("new"),
        json={
            "display_name_th": "EnglishOnly",
            "phone": "0891112222",
            "team": "ดิจิทัล",
            "position": "หัวหน้าทีม",
            "company_type": "SENA",
        },
    ).status_code == 422

    # Agency company lock (403)
    assert client.post("/v1/me/access-request", headers=h("other"), json={**REQUEST, "company_type": "AGENCY", "company_name": "KIN"}).status_code == 200
    assert decision(client, "other", "approve", "agency", "KIN").status_code == 200
    assert client.patch(
        "/v1/me/profile",
        headers=h("other"),
        json={
            "display_name_th": "เอเจนซี ทดสอบ",
            "phone": "0823334444",
            "team": "สื่อ",
            "position": "ผู้ประสานงาน",
            "company_type": "SENA",
        },
    ).status_code == 403


def test_avatar_upload_normalize_serve_and_remove(accounts):
    client, identities = accounts
    assert client.post("/v1/me/access-request", headers=h("new"), json=REQUEST).status_code == 200
    assert decision(client, "new", "approve", "editor").status_code == 200
    assert client.post("/v1/me/access-request", headers=h("other"), json={**REQUEST, "company_type": "AGENCY", "company_name": "KIN"}).status_code == 200
    assert decision(client, "other", "approve", "agency", "KIN").status_code == 200

    # Reject SVG and corrupt bytes
    assert client.post("/v1/me/avatar", headers={**h("new"), "Content-Type": "image/png"}, content=b"<svg></svg>").status_code == 422
    assert client.post("/v1/me/avatar", headers={**h("new"), "Content-Type": "image/jpeg"}, content=b"not-an-image").status_code == 422
    assert client.post("/v1/me/avatar", headers={**h("new"), "Content-Type": "image/svg+xml"}, content=b"<svg/>").status_code == 415
    assert client.post("/v1/me/avatar", headers={**h("new"), "Content-Type": "image/png"}, content=b"x" * (2 * 1024 * 1024 + 1)).status_code == 413

    # Upload JPEG with EXIF -> normalized WebP <= 256x256 without EXIF
    jpg = _make_image_bytes("JPEG", size=(640, 480), exif=True)
    up1 = client.post("/v1/me/avatar", headers={**h("new"), "Content-Type": "image/jpeg"}, content=jpg)
    assert up1.status_code == 200, up1.text
    assert up1.json()["data"]["has_avatar"] is True

    get_own = client.get("/v1/me/avatar", headers=h("new"))
    assert get_own.status_code == 200
    assert get_own.headers["content-type"].startswith("image/webp")
    assert get_own.headers["cache-control"] == "no-store"
    assert get_own.headers["x-content-type-options"] == "nosniff"
    with Image.open(io.BytesIO(get_own.content)) as parsed:
        assert parsed.format == "WEBP"
        assert parsed.size == (256, 256)
        assert not parsed.info.get("exif")

    # Staff admin can read colleague avatar; agency user is forbidden (403)
    assert client.get(f"/v1/accounts/{identities['new']}/avatar", headers=h("admin")).status_code == 200
    assert client.get(f"/v1/accounts/{identities['new']}/avatar", headers=h("other")).status_code == 403
    assert client.get("/v1/me/avatar").status_code == 401

    # Remove via POST /v1/me/avatar/remove
    rem = client.post("/v1/me/avatar/remove", headers=h("new"), json={})
    assert rem.status_code == 200 and rem.json()["data"]["has_avatar"] is False
    assert client.get("/v1/me/avatar", headers=h("new")).status_code == 404

    # Upload PNG then delete via DELETE /v1/me/avatar
    png = _make_image_bytes("PNG", size=(120, 120))
    assert client.post("/v1/me/avatar", headers={**h("new"), "Content-Type": "image/png"}, content=png).status_code == 200
    assert client.delete("/v1/me/avatar", headers=h("new")).status_code == 200
    assert client.get("/v1/me/avatar", headers=h("new")).status_code == 404
