"""Local-only, content-addressed original files; no network or public static mount."""
from __future__ import annotations

import hashlib
import io
import os
from pathlib import Path
import re
import tempfile
import unicodedata
from urllib.parse import unquote
import warnings

from PIL import Image
from pypdf import PdfReader
from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject, NameObject
from starlette.requests import ClientDisconnect, Request

from .auth import failure
from .svg import sanitize_svg


MAX_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 40_000_000
MAX_PDF_PAGES = 200
STORAGE_ROOT = Path(__file__).resolve().parents[3] / ".local" / "assets"
FORMATS = {"image/png": ("PNG", "png"), "image/jpeg": ("JPEG", "jpg"),
           "image/webp": ("WEBP", "webp"), "image/svg+xml": (None, "svg"), "application/pdf": (None, "pdf")}
ACTIVE_PDF_NAMES = {"/JavaScript", "/JS", "/OpenAction", "/AA", "/Launch", "/SubmitForm",
                    "/ImportData", "/EmbeddedFiles", "/EmbeddedFile", "/RichMedia", "/XFA",
                    "/AcroForm", "/URI"}


def decode_filename(header: str | None) -> str:
    if not header or not header.isascii() or len(header) > 2400 or re.search(r"%(?![0-9A-Fa-f]{2})", header):
        raise failure(422, "invalid_filename", "กรุณาระบุชื่อไฟล์ด้วย X-Filename ที่เข้ารหัส UTF-8")
    try:
        name = unquote(header, encoding="utf-8", errors="strict")
    except UnicodeError:
        raise failure(422, "invalid_filename", "ชื่อไฟล์ต้องเป็น UTF-8 ที่ถูกต้อง") from None
    stem = name.split(".")[0].upper()
    reserved = stem in {"CON", "PRN", "AUX", "NUL"} or bool(re.fullmatch(r"(?:COM|LPT)[1-9]", stem))
    if not name.strip() or len(name) > 200 or name in {".", ".."} or name.endswith((".", " ")) or reserved or any(
        char in '<>:"/\\|?*' or unicodedata.category(char).startswith("C") for char in name
    ):
        raise failure(422, "invalid_filename", "ชื่อไฟล์ต้องเป็นชื่อเดี่ยวไม่เกิน 200 ตัวอักษรและไม่มีอักขระต้องห้าม")
    return name


async def read_upload(request: Request) -> tuple[bytes, str, str]:
    mime = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if mime not in FORMATS:
        raise failure(415, "unsupported_file", "รองรับเฉพาะ PNG, JPEG, WebP, SVG และ PDF")
    filename = decode_filename(request.headers.get("x-filename"))
    declared = request.headers.get("content-length")
    if declared is not None and (not re.fullmatch(r"[0-9]{1,20}", declared) or int(declared) < 1):
        raise failure(400, "invalid_length", "ขนาดไฟล์ที่ระบุไม่ถูกต้อง")
    if declared is not None and int(declared) > MAX_BYTES:
        raise failure(413, "file_too_large", "ไฟล์ต้องมีขนาดไม่เกิน 10 MiB")
    content = bytearray()
    try:
        async for chunk in request.stream():
            if len(content) + len(chunk) > MAX_BYTES:
                raise failure(413, "file_too_large", "ไฟล์ต้องมีขนาดไม่เกิน 10 MiB")
            content.extend(chunk)
    except ClientDisconnect:
        raise failure(400, "upload_incomplete", "การส่งไฟล์ไม่สมบูรณ์ กรุณาลองใหม่") from None
    if not content or (declared is not None and len(content) != int(declared)):
        raise failure(400, "invalid_length", "ขนาดไฟล์จริงไม่ตรงกับข้อมูลที่ระบุ")
    return bytes(content), mime, filename


def validate_pdf(content: bytes) -> None:
    if not content.startswith(b"%PDF-"):
        raise ValueError("Missing PDF header")
    reader = PdfReader(io.BytesIO(content), strict=True)
    if reader.is_encrypted:
        raise ValueError("Encrypted PDF")
    # Walk the reachable object graph with bounds; do not decompress content streams.
    stack = [(reader.trailer, 0)]
    seen = set()
    visited = 0
    while stack:
        item, depth = stack.pop()
        visited += 1
        if visited > 100000 or depth > 64:
            raise ValueError("PDF structure exceeds limits")
        if isinstance(item, IndirectObject):
            key = (item.idnum, item.generation)
            if key in seen:
                continue
            seen.add(key)
            item = item.get_object()
        if isinstance(item, NameObject) and str(item) in ACTIVE_PDF_NAMES:
            raise ValueError("Active PDF content")
        if isinstance(item, DictionaryObject):
            if ACTIVE_PDF_NAMES.intersection(item.keys()):
                raise ValueError("Active PDF content")
            stack.extend((value, depth + 1) for value in item.values())
        elif isinstance(item, ArrayObject):
            stack.extend((value, depth + 1) for value in item)
    if not 1 <= len(reader.pages) <= MAX_PDF_PAGES:
        raise ValueError("PDF page count exceeds limits")


def validate_file(content: bytes, mime: str, filename: str) -> dict:
    width = height = None
    try:
        if not content or len(content) > MAX_BYTES or mime not in FORMATS:
            raise ValueError("Invalid file")
        if mime == "application/pdf":
            validate_pdf(content)
        elif mime == "image/svg+xml":
            sanitized, width, height = sanitize_svg(content)
            if sanitized != content or width * height > MAX_PIXELS:
                raise ValueError("SVG must be sanitized before registry validation")
        else:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(content)) as picture:
                    width, height = picture.size
                    if picture.format != FORMATS[mime][0] or width * height > MAX_PIXELS or width < 1 or height < 1:
                        raise ValueError("Invalid image type or dimensions")
                    if getattr(picture, "is_animated", False) or getattr(picture, "n_frames", 1) != 1:
                        raise ValueError("Animated images are not supported")
                    picture.verify()
                with Image.open(io.BytesIO(content)) as picture:
                    picture.load()  # Decode pixels too, including formats with a minimal verify().
    except Exception:
        raise failure(422, "invalid_file", "ไฟล์ไม่ถูกต้อง: ภาพต้องไม่เคลื่อนไหวและไม่เกิน 40 ล้านพิกเซล; PDF ต้องไม่เข้ารหัส ไม่มีเนื้อหาโต้ตอบ และไม่เกิน 200 หน้า") from None
    checksum = hashlib.sha256(content).hexdigest()
    return {"original_filename": filename, "mime_type": mime, "checksum": checksum,
            "storage_path": f"{checksum}.{FORMATS[mime][1]}", "file_size": len(content),
            "asset_type": "document" if mime == "application/pdf" else "image",
            "width": width, "height": height, "language": "th"}


def prepare_upload(content: bytes, mime: str, filename: str) -> tuple[bytes, dict]:
    """Never content-address or install raw SVG bytes."""
    if mime == "image/svg+xml":
        try:
            content, _, _ = sanitize_svg(content)
        except Exception:
            raise failure(422, "invalid_file", "SVG ต้องเป็นภาพนิ่ง XML ที่ถูกต้อง ไม่เกิน 2 MiB และระบุขนาดหรือ viewBox; ไม่รองรับ DTD หรือเอนทิตี") from None
    return content, validate_file(content, mime, filename)


def storage_path(name: str) -> Path:
    if not isinstance(name, str) or not re.fullmatch(r"[0-9a-f]{64}\.(?:jpg|png|webp|svg|pdf)", name):
        raise failure(404, "file_not_found", "ไม่พบไฟล์ที่จัดเก็บอย่างถูกต้อง")
    root = STORAGE_ROOT.resolve()
    if root != STORAGE_ROOT.absolute():
        raise failure(503, "file_unavailable", "ตำแหน่งจัดเก็บไฟล์ไม่ถูกต้อง กรุณาให้ผู้ดูแลตรวจสอบ")
    path = root / name
    if path.is_symlink() or path.resolve().parent != root:
        raise failure(404, "file_not_found", "ไม่พบไฟล์ที่จัดเก็บอย่างถูกต้อง")
    return path


def install_file(content: bytes, metadata: dict) -> bool:
    """Atomic no-overwrite install. Caller holds the checksum's DB advisory lock."""
    path = storage_path(metadata["storage_path"])
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        if path.exists():
            if path.stat().st_size != len(content) or hashlib.sha256(path.read_bytes()).hexdigest() != metadata["checksum"]:
                raise failure(503, "file_unavailable", "ไฟล์ที่จัดเก็บไม่สมบูรณ์ กรุณาให้ผู้ดูแลตรวจสอบ")
            return False
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".upload-", delete=False) as output:
            temporary = Path(output.name)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, path)  # Atomic creation that never replaces an existing original.
        return True
    except FileExistsError:
        raise failure(409, "upload_conflict", "มีการจัดเก็บไฟล์เดียวกันพร้อมกัน กรุณาลองใหม่") from None
    except OSError:
        raise failure(503, "file_unavailable", "ไม่สามารถจัดเก็บไฟล์ได้ กรุณาตรวจพื้นที่จัดเก็บ") from None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def readable_file(metadata: dict) -> Path:
    path = storage_path(metadata.get("storage_path"))
    if metadata.get("mime_type") not in FORMATS or not path.is_file():
        raise failure(404, "file_not_found", "ไม่พบไฟล์ที่จัดเก็บ")
    if (path.name != f"{metadata.get('checksum')}.{FORMATS[metadata['mime_type']][1]}"
            or path.stat().st_size != metadata.get("file_size")
            or path.stat().st_size > MAX_BYTES
            or hashlib.sha256(path.read_bytes()).hexdigest() != metadata.get("checksum")):
        raise failure(503, "file_unavailable", "ไฟล์ที่จัดเก็บไม่สมบูรณ์ กรุณาให้ผู้ดูแลตรวจสอบ")
    return path
