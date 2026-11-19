"""Local-only, content-addressed original files; no network or public static mount."""
from __future__ import annotations

import hashlib
import io
import json
import logging
import math
import os
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
import re
import tempfile
from threading import Lock
import unicodedata
from urllib.parse import unquote
import warnings

from PIL import Image, ImageOps
from pypdf import PdfReader
from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject, NameObject
from starlette.requests import ClientDisconnect, Request

from .auth import failure
from .svg import sanitize_svg


MAX_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 40_000_000
MAX_PDF_PAGES = 200
STORAGE_ROOT = (Path(os.environ["HUB_DISPOSABLE_TEST_RUN"]) / "assets" if os.environ.get("HUB_DISPOSABLE_TEST_RUN")
                else Path(__file__).resolve().parents[3] / ".local" / "assets")
FORMATS = {"image/png": ("PNG", "png"), "image/jpeg": ("JPEG", "jpg"),
           "image/webp": ("WEBP", "webp"), "image/svg+xml": (None, "svg"), "application/pdf": (None, "pdf")}
ACTIVE_PDF_NAMES = {"/JavaScript", "/JS", "/OpenAction", "/AA", "/Launch", "/SubmitForm",
                    "/ImportData", "/EmbeddedFiles", "/EmbeddedFile", "/RichMedia", "/XFA",
                    "/AcroForm", "/URI"}
PDF_RENDER_LOCK = Lock()  # PDFium must never be called concurrently, even for different documents.
THUMBNAIL_SIZE = 96
logger = logging.getLogger(__name__)


class ThumbnailRenderError(ValueError):
    """Stable private failure reason, without original document text."""


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


async def read_upload(request: Request, *, max_bytes: int = MAX_BYTES, too_large: str = "ไฟล์ต้องมีขนาดไม่เกิน 10 MiB") -> tuple[bytes, str, str]:
    mime = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if mime not in FORMATS:
        raise failure(415, "unsupported_file", "รองรับเฉพาะ PNG, JPEG, WebP, SVG และ PDF")
    filename = decode_filename(request.headers.get("x-filename"))
    declared = request.headers.get("content-length")
    if declared is not None and (not re.fullmatch(r"[0-9]{1,20}", declared) or int(declared) < 1):
        raise failure(400, "invalid_length", "ขนาดไฟล์ที่ระบุไม่ถูกต้อง")
    if declared is not None and int(declared) > max_bytes:
        raise failure(413, "file_too_large", too_large)
    content = bytearray()
    try:
        async for chunk in request.stream():
            if len(content) + len(chunk) > max_bytes:
                raise failure(413, "file_too_large", too_large)
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


def stored_byte_limit(mime: str) -> int:
    return 20 * 1024 * 1024 if mime == 'application/pdf' else MAX_BYTES


def validate_file(content: bytes, mime: str, filename: str, *, max_bytes: int = MAX_BYTES) -> dict:
    width = height = None
    try:
        if not content or len(content) > max_bytes or mime not in FORMATS:
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


def install_file(content: bytes, metadata: dict, prepared_thumbnail: tuple[bytes | None, str | None] | None = None) -> bool:
    """Atomic no-overwrite install. Caller holds the checksum's DB advisory lock."""
    path = storage_path(metadata["storage_path"])
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        if path.exists():
            if path.stat().st_size != len(content) or hashlib.sha256(path.read_bytes()).hexdigest() != metadata["checksum"]:
                raise failure(503, "file_unavailable", "ไฟล์ที่จัดเก็บไม่สมบูรณ์ กรุณาให้ผู้ดูแลตรวจสอบ")
            install_thumbnail(content, metadata, prepared_thumbnail)
            return False
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".upload-", delete=False) as output:
            temporary = Path(output.name)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        install_thumbnail(content, metadata, prepared_thumbnail)
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
            or path.stat().st_size > stored_byte_limit(metadata.get("mime_type"))
            or hashlib.sha256(path.read_bytes()).hexdigest() != metadata.get("checksum")):
        raise failure(503, "file_unavailable", "ไฟล์ที่จัดเก็บไม่สมบูรณ์ กรุณาให้ผู้ดูแลตรวจสอบ")
    return path


def thumbnail_path(metadata: dict) -> Path:
    checksum = metadata.get('checksum')
    if not isinstance(checksum, str) or not re.fullmatch('[0-9a-f]{64}', checksum):
        raise failure(404, 'file_not_found', 'ยังไม่มีภาพย่อ')
    root = STORAGE_ROOT.resolve()
    folder = root / 'thumbnails-v1'
    path = folder / f'{checksum}.webp'
    if root != STORAGE_ROOT.absolute() or folder.is_symlink() or path.is_symlink() or path.resolve().parent != folder:
        raise failure(404, 'file_not_found', 'ไม่พบภาพย่อที่จัดเก็บอย่างถูกต้อง')
    return path


def thumbnail_failure_path(metadata: dict) -> Path:
    path = thumbnail_path(metadata).with_suffix('.failure.json')
    if path.is_symlink() or path.resolve().parent != path.parent:
        raise failure(404, 'file_not_found', 'ตำแหน่งบันทึกภาพย่อไม่ถูกต้อง')
    return path


def record_thumbnail_failure(metadata: dict, reason: str, error: Exception) -> None:
    """Private diagnostics only; renderer messages may contain filenames or source text."""
    record = {'checksum': metadata['checksum'], 'mime_type': metadata.get('mime_type'), 'reason': reason,
              'exception_type': type(error).__name__, 'attempted_at': datetime.now(timezone.utc).isoformat()}
    logger.warning('Thumbnail failed checksum=%s mime=%s reason=%s type=%s',
                   record['checksum'], record['mime_type'], reason, record['exception_type'])
    temporary = None
    try:
        path = thumbnail_failure_path(metadata)
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.thumbnail-', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(json.dumps(record).encode('utf8')); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    except OSError:
        logger.error('Thumbnail failure record unavailable checksum=%s', record['checksum'])
    finally:
        if temporary is not None: temporary.unlink(missing_ok=True)


def thumbnail_failure(metadata: dict) -> dict | None:
    if thumbnail_path(metadata).is_file():
        return None
    path = thumbnail_failure_path(metadata)
    return json.loads(path.read_text(encoding='utf8')) if path.is_file() else None


def render_thumbnail(content: bytes, mime: str) -> Image.Image:
    """Keep private source metadata out of decoder logs, including legal files."""
    from .upload_optimization import _private_decoding
    with _private_decoding():
        return _render_thumbnail(content, mime)


def _render_thumbnail(content: bytes, mime: str) -> Image.Image:
    """Render only bounded static source bytes; never open a supplied URL or path."""
    if mime == 'image/svg+xml':
        import resvg_py
        try:
            clean, width, height = sanitize_svg(content)
        except Exception:
            raise ThumbnailRenderError('invalid_svg') from None
        if clean != content:
            raise ThumbnailRenderError('svg_not_sanitized')
        scale = THUMBNAIL_SIZE / max(width, height)
        png = resvg_py.svg_to_bytes(svg_string=clean.decode('utf8'), width=max(1, round(width * scale)),
                                   height=max(1, round(height * scale)), background=None, log_information=False)
        with Image.open(io.BytesIO(png)) as picture:
            return picture.convert('RGBA')
    if mime == 'application/pdf':
        try:
            validate_pdf(content)
        except Exception:
            raise ThumbnailRenderError('invalid_pdf') from None
        with PDF_RENDER_LOCK:
            import pypdfium2 as pdfium
            with pdfium.PdfDocument(content) as document:
                with closing(document[0]) as page:
                    width, height = page.get_size()
                    if not all(math.isfinite(v) and v > 0 for v in (width, height)):
                        raise ThumbnailRenderError('invalid_pdf_dimensions')
                    with closing(page.render(scale=THUMBNAIL_SIZE / max(width, height), draw_annots=False)) as bitmap:
                        return bitmap.to_pil().convert('RGBA')  # Copy pixels before closing native handles.
    if mime not in ('image/png', 'image/jpeg', 'image/webp'):
        raise ThumbnailRenderError('unsupported_format')
    with Image.open(io.BytesIO(content)) as original:
        return ImageOps.exif_transpose(original).convert('RGBA')


def install_thumbnail(content: bytes, metadata: dict, prepared: tuple[bytes | None, str | None] | None = None) -> bool:
    """Generate once at intake/backfill; keep a valid original when rendering fails."""
    path = thumbnail_path(metadata)
    failure_path = thumbnail_failure_path(metadata)
    if path.exists():
        return False
    try:
        if prepared is not None:
            data, reason = prepared
            if data is None or reason is not None:
                raise ThumbnailRenderError('render_failed')
        else:
            with render_thumbnail(content, metadata.get('mime_type')) as picture:
                picture.thumbnail((THUMBNAIL_SIZE, THUMBNAIL_SIZE), Image.Resampling.LANCZOS)
                output = io.BytesIO()
                picture.save(output, 'WEBP', quality=80, method=4)
            data = output.getvalue()
    except Exception as error:
        record_thumbnail_failure(metadata, str(error) if isinstance(error, ThumbnailRenderError) else 'render_failed', error)
        return False
    temporary = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.thumbnail-', delete=False) as stream:
            temporary = Path(stream.name); stream.write(data); stream.flush(); os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            return False
        failure_path.unlink(missing_ok=True)
        return True
    except OSError as error:
        record_thumbnail_failure(metadata, 'storage_failed', error)
        return False
    finally:
        if temporary is not None: temporary.unlink(missing_ok=True)


def readable_thumbnail(metadata: dict) -> Path:
    path = thumbnail_path(metadata)
    if not path.is_file():
        raise failure(404, 'file_not_found', 'ยังไม่มีภาพย่อ')
    return path
