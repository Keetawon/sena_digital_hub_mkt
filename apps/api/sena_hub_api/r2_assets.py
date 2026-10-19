"""Private TEST content. Callers must authorize the DB row before reading bytes.

Only immutable, hash-addressed objects are supported: no listing, deletion,
public URLs or presigning. Physical bucket/credentials stay outside DB payloads.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from .assets import MAX_BYTES
from .auth import Settings, failure
from .hosted_assets import HostedAssets

BUCKET = "r2-test-content"  # Logical DB alias, never the operator's physical bucket.
KNOWLEDGE_MAX_BYTES = 50 * 1024 * 1024


class R2Assets:
    provider = "r2"
    bucket = BUCKET

    def __init__(self, settings: Settings):
        if settings.environment != "hosted-test" or not settings.r2_private_bucket_confirmed:
            raise ValueError("Private R2 requires the approved TEST profile")
        try:
            config = json.loads(Path(settings.r2_credentials_file).read_text(encoding="utf-8-sig"))
            if set(config) != {"endpoint_url", "bucket", "access_key_id", "secret_access_key"}:
                raise ValueError()
            if any(not isinstance(v, str) or not v or v != v.strip() for v in config.values()):
                raise ValueError()
            endpoint = urlsplit(config["endpoint_url"])
            if settings.hosted_test_simulation:
                valid = config["endpoint_url"] == "http://127.0.0.1:54329/r2"
            else:
                valid = (endpoint.scheme == "https" and endpoint.port in {None, 443}
                         and re.fullmatch(r"[0-9a-f]{32}(?:\.(?:eu|fedramp|us))?\.r2\.cloudflarestorage\.com", endpoint.hostname or "")
                         and endpoint.path in {"", "/"})
            if (not valid or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment
                    or not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", config["bucket"])):
                raise ValueError()
            self._origin = (endpoint.scheme, endpoint.netloc)
            self._prefix = endpoint.path.rstrip("/") + "/" + config["bucket"]
            self._bucket = config["bucket"]
            self._client = boto3.client("s3", endpoint_url=config["endpoint_url"].rstrip("/"), region_name="auto",
                aws_access_key_id=config["access_key_id"], aws_secret_access_key=config["secret_access_key"],
                config=Config(signature_version="s3v4", connect_timeout=10, read_timeout=20,
                              retries={"max_attempts": 0}, s3={"addressing_style": "path"},
                              request_checksum_calculation="when_required", response_checksum_validation="when_required"))
            self._client.meta.events.register("before-send.s3", self._check_destination)
        except (OSError, ValueError, TypeError, KeyError, BotoCoreError):
            raise ValueError("R2 configuration is invalid; credential details withheld") from None

    def _check_destination(self, request, **kwargs):
        target = urlsplit(request.url)
        if ((target.scheme, target.netloc) != self._origin or target.query or target.fragment
                or target.path != self._prefix and not target.path.startswith(self._prefix + "/")):
            raise failure(503, "storage_unavailable", "พื้นที่ไฟล์ไม่ตรงกับการตั้งค่าที่ได้รับอนุญาต")

    def require_private_bucket(self):
        # Public r2.dev/custom-domain settings require an operator dashboard check;
        # HeadBucket proves connectivity only, not privacy. Startup fails without
        # HUB_R2_PRIVATE_BUCKET_CONFIRMED, separately from the four-field secret.
        try:
            self._client.head_bucket(Bucket=self._bucket)
        except (BotoCoreError, ClientError, OSError, ValueError):
            raise failure(503, "storage_unavailable", "พื้นที่ไฟล์ส่วนตัวยังไม่พร้อมใช้งาน กรุณาลองใหม่") from None

    @staticmethod
    def _integrity(content, checksum, size, limit):
        return (type(size) is int and 0 < size <= limit and len(content) == size
                and hashlib.sha256(content).hexdigest() == checksum)

    def _read(self, key, checksum, size, limit):
        if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum) or type(size) is not int or not 0 < size <= limit:
            raise failure(404, "file_not_found", "ข้อมูลไฟล์ต้นทางไม่ถูกต้อง")
        try:
            result = self._client.get_object(Bucket=self._bucket, Key=key)
            stream = result["Body"]
            try:
                if result.get("ContentLength") != size:
                    raise failure(503, "file_unavailable", "ขนาดไฟล์ไม่ตรงกับหลักฐานที่นำเข้า")
                content = stream.read(size + 1)
            finally:
                stream.close()
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in {"NoSuchKey", "404", "NotFound"}:
                raise failure(404, "file_not_found", "ไม่พบไฟล์ที่จัดเก็บ") from None
            raise failure(503, "storage_unavailable", "พื้นที่ไฟล์ส่วนตัวยังไม่พร้อมใช้งาน กรุณาลองใหม่") from None
        except (BotoCoreError, OSError, ValueError, KeyError, TypeError):
            raise failure(503, "storage_unavailable", "พื้นที่ไฟล์ส่วนตัวยังไม่พร้อมใช้งาน กรุณาลองใหม่") from None
        if not self._integrity(content, checksum, size, limit):
            raise failure(503, "file_unavailable", "ไฟล์ที่จัดเก็บไม่ตรงกับหลักฐาน กรุณาให้ผู้ดูแลตรวจสอบ")
        return content

    def _install(self, key, content, checksum, size, mime, limit):
        if not self._integrity(content, checksum, size, limit):
            raise failure(422, "invalid_file", "ไฟล์ไม่ตรงกับข้อมูลที่ตรวจสอบแล้ว")
        created = True
        try:
            self._client.put_object(Bucket=self._bucket, Key=key, Body=content, ContentType=mime,
                                    CacheControl="private, no-store", IfNoneMatch="*")
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") not in {"PreconditionFailed", "412"}:
                raise failure(503, "storage_unavailable", "ไม่สามารถจัดเก็บไฟล์ส่วนตัวได้ กรุณาลองใหม่") from None
            created = False
        except (BotoCoreError, OSError, ValueError):
            raise failure(503, "storage_unavailable", "ไม่สามารถจัดเก็บไฟล์ส่วนตัวได้ กรุณาลองใหม่") from None
        # Verify both newly created and concurrent/existing objects. Never overwrite
        # or delete after an ambiguous write/DB commit; a private orphan is safer.
        self._read(key, checksum, size, limit)
        return created

    @staticmethod
    def _asset_key(metadata):
        name = HostedAssets.key_for(metadata)
        if metadata.get("storage_bucket") != BUCKET or metadata.get("source_system") != "hub-hosted-test":
            raise failure(404, "file_not_found", "ไม่พบไฟล์ในพื้นที่ทดสอบที่ได้รับอนุญาต")
        return "originals/" + name

    def read(self, metadata):
        return self._read(self._asset_key(metadata), metadata.get("checksum"), metadata.get("file_size"), MAX_BYTES)

    def install(self, content, metadata):
        return self._install(self._asset_key(metadata), content, metadata.get("checksum"),
                             metadata.get("file_size"), metadata["mime_type"], MAX_BYTES)

    @staticmethod
    def _knowledge_key(evidence):
        checksum = evidence.get("sha256")
        if (not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum)
                or evidence.get("storage_bucket") != BUCKET):
            raise failure(404, "file_not_found", "ไม่พบไฟล์คลังความรู้ในพื้นที่ทดสอบที่ได้รับอนุญาต")
        return "knowledge/" + checksum

    def read_knowledge(self, evidence):
        return self._read(self._knowledge_key(evidence), evidence.get("sha256"), evidence.get("bytes"), KNOWLEDGE_MAX_BYTES)

    def install_knowledge(self, content, evidence):
        # Originals may be held/unsafe; force attachment delivery in the API.
        return self._install(self._knowledge_key(evidence), content, evidence.get("sha256"),
                             evidence.get("bytes"), "application/octet-stream", KNOWLEDGE_MAX_BYTES)
