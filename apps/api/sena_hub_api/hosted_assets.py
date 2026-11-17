"""Private, validated H1 originals. No browser key, public URL or redirect following."""
from __future__ import annotations

import hashlib
import json
import re
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .assets import FORMATS, MAX_BYTES, stored_byte_limit
from .auth import Settings, failure

BUCKET = "hub-test-assets"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class HostedAssets:
    # Retained only for the offline Auth/Storage simulation. Real H1 uses R2.
    provider = "supabase"
    bucket = BUCKET

    def __init__(self, settings: Settings):
        if settings.environment != "hosted-test" or not settings.hosted_test_simulation:
            raise ValueError("Supabase Storage double requires the offline H1 simulation")
        self.origin = settings.supabase_url
        self.key = settings.supabase_storage_key
        self.opener = build_opener(NoRedirect())

    def request(self, method, path, content=None, mime=None, limit=MAX_BYTES):
        headers = {"Authorization": f"Bearer {self.key}", "apikey": self.key}
        if mime:
            headers.update({"Content-Type": mime, "x-upsert": "false"})
        request = Request(self.origin + "/storage/v1/" + path, data=content, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=15) as response:
                body = response.read(limit + 1)
                if len(body) > limit:
                    raise failure(503, "file_unavailable", "ไฟล์ที่จัดเก็บเกินขนาดที่อนุญาต")
                return response.status, body
        except HTTPError as error:
            # Never include service response bodies, URLs or credentials in application errors.
            error.close()
            return error.code, b""
        except (OSError, URLError, ValueError):
            raise failure(503, "storage_unavailable", "พื้นที่ไฟล์ส่วนตัวยังไม่พร้อมใช้งาน กรุณาลองใหม่") from None

    def require_private_bucket(self):
        status, body = self.request("GET", "bucket/" + BUCKET, limit=16384)
        try:
            bucket = json.loads(body)
            valid = status == 200 and bucket["id"] == BUCKET and bucket["public"] is False
        except (ValueError, TypeError, KeyError):
            valid = False
        if not valid:
            raise failure(503, "storage_unavailable", "พื้นที่ไฟล์ต้องเป็นพื้นที่ส่วนตัวที่ผู้ดูแลตรวจสอบแล้ว")

    @staticmethod
    def key_for(metadata):
        name = metadata.get("storage_path")
        mime = metadata.get("mime_type")
        if (not isinstance(name, str) or not re.fullmatch(r"[0-9a-f]{64}\.(?:jpg|png|webp|svg|pdf)", name)
                or mime not in FORMATS or name != f"{metadata.get('checksum')}.{FORMATS[mime][1]}"):
            raise failure(404, "file_not_found", "ไม่พบไฟล์ที่จัดเก็บอย่างถูกต้อง")
        return name

    def read(self, metadata, *, check_bucket=True):
        name = self.key_for(metadata)
        if metadata.get("storage_bucket") != BUCKET or metadata.get("source_system") != "hub-hosted-test":
            raise failure(404, "file_not_found", "ไม่พบไฟล์ในพื้นที่ทดสอบที่ได้รับอนุญาต")
        if check_bucket:
            self.require_private_bucket()
        status, content = self.request("GET", f"object/authenticated/{BUCKET}/{name}", limit=stored_byte_limit(metadata.get("mime_type")))
        if status == 404:
            raise failure(404, "file_not_found", "ไม่พบไฟล์ที่จัดเก็บ")
        if (status != 200 or len(content) != metadata.get("file_size")
                or hashlib.sha256(content).hexdigest() != metadata.get("checksum")):
            raise failure(503, "file_unavailable", "ไฟล์ที่จัดเก็บไม่สมบูรณ์ กรุณาให้ผู้ดูแลตรวจสอบ")
        return content

    def install(self, content, metadata):
        name = self.key_for(metadata)
        self.require_private_bucket()
        status, _ = self.request("POST", f"object/{BUCKET}/{name}", content, metadata["mime_type"], limit=16384)
        # Supabase may use 400 or 409 for an existing object. Verify the private object
        # in either case; never overwrite or trust the status alone as deduplication.
        if status not in {200, 201, 400, 409}:
            raise failure(503, "storage_unavailable", "ไม่สามารถจัดเก็บไฟล์ส่วนตัวได้ กรุณาลองใหม่")
        if self.read(metadata, check_bucket=False) != content:
            raise failure(503, "file_unavailable", "ไฟล์ที่จัดเก็บไม่ตรงกับไฟล์ที่ตรวจสอบแล้ว")
        return status in {200, 201}
