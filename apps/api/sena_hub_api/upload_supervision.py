"""One credential-free decoder child; admission stays with the parent until reaped."""
from __future__ import annotations

import asyncio
import hashlib
import io
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile

from PIL import Image

from . import assets
from .upload_admission import run_upload_work
from .upload_optimization import UploadProcessingError
from .upload_pipeline import UploadResult

CHILD_SCRIPT = Path(__file__).with_name("upload_child.py")
CHILD_TIMEOUT = 20.0
IPC_JSON_LIMIT = 256 * 1024
THUMBNAIL_LIMIT = 256 * 1024
ERROR_CODES = frozenset({
    "png_pixel_limit", "jpeg_pixel_limit", "png_hdr_requires_export", "pdf_pixel_limit",
    "pdf_image_pixel_limit", "webp_pixel_limit",
    "image_input_too_large", "pdf_input_too_large", "legal_input_too_large",
    "image_output_too_large", "pdf_output_too_large", "pdf_reexport_required",
    "image_color_space_requires_export", "invalid_image", "invalid_upload_file",
    "invalid_processing_class", "legal_processing_forbidden", "original_source_mismatch",
    "invalid_file_suggestions", "upload_processing_memory", "upload_processing_failed",
})


def child_environment(directory: Path) -> dict[str, str]:
    environment = {"PATH": os.pathsep.join((str(Path(sys.executable).parent), "/usr/bin", "/bin")),
                   "LANG": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1",
                   "VIPS_CONCURRENCY": "4", "MALLOC_ARENA_MAX": "2",
                   "TMPDIR": str(directory), "TMP": str(directory), "TEMP": str(directory)}
    if os.name == "nt":
        for name in ("SYSTEMROOT", "WINDIR"):
            if name in os.environ:
                environment[name] = os.environ[name]
        environment["PATH"] = str(Path(sys.executable).parent) + os.pathsep + str(Path(os.environ["SYSTEMROOT"]) / "System32")
    return environment


async def _terminate(process) -> None:
    if os.name == "posix":
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    elif process.returncode is None:
        process.terminate()
    if process.returncode is None:
        try:
            await asyncio.wait_for(process.wait(), 1.0)
        except asyncio.TimeoutError:
            pass
    # Include descendants even if the group leader has already exited.
    if os.name == "posix":
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    elif process.returncode is None:
        await asyncio.to_thread(subprocess.run, ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                                capture_output=True, timeout=5)
        if process.returncode is None:
            process.kill()
    await process.wait()


async def _reap_despite_cancellation(process) -> bool:
    cancelled = False
    cleanup = asyncio.create_task(_terminate(process))
    while not cleanup.done():
        try:
            await asyncio.shield(cleanup)
        except asyncio.CancelledError:
            cancelled = True
    cleanup.result()
    return cancelled


def _bounded_file(directory: Path, name: str, maximum: int) -> bytes:
    path = directory / name
    if path.is_symlink() or path.resolve().parent != directory.resolve() or not 0 <= path.stat().st_size <= maximum:
        raise UploadProcessingError("upload_processing_failed")
    value = path.read_bytes()
    if len(value) > maximum:
        raise UploadProcessingError("upload_processing_failed")
    return value


def _read_result(directory: Path, source: bytes, existing: dict | None) -> UploadResult:
    value = json.loads(_bounded_file(directory, "result.json", IPC_JSON_LIMIT))
    if not isinstance(value, dict):
        raise UploadProcessingError("upload_processing_failed")
    if value.get("ok") is not True:
        code = value.get("error")
        raise UploadProcessingError(code if code in ERROR_CODES else "upload_processing_failed")
    if any(not isinstance(value.get(key), dict) for key in ("metadata", "original", "processing", "suggestions")):
        raise UploadProcessingError("upload_processing_failed")
    if type(value.get("has_content")) is not bool or value["original"].get("checksum") != hashlib.sha256(source).hexdigest():
        raise UploadProcessingError("upload_processing_failed")
    content = _bounded_file(directory, "stored.bin", 20 * 1024 * 1024) if value["has_content"] else None
    metadata = value["metadata"]
    if content is None:
        if existing is None:
            raise UploadProcessingError("upload_processing_failed")
    else:
        mime = metadata.get("mime_type")
        checksum = hashlib.sha256(content).hexdigest()
        if (mime not in assets.FORMATS or metadata.get("checksum") != checksum
                or metadata.get("file_size") != len(content)
                or metadata.get("storage_path") != checksum + "." + assets.FORMATS[mime][1]):
            raise UploadProcessingError("upload_processing_failed")
    thumbnail = _bounded_file(directory, "thumbnail.webp", THUMBNAIL_LIMIT) if value.get("thumbnail") is True else None
    if thumbnail is not None:
        with Image.open(io.BytesIO(thumbnail)) as image:
            if image.format != "WEBP" or not 0 < max(image.size) <= assets.THUMBNAIL_SIZE:
                raise UploadProcessingError("upload_processing_failed")
    error = value.get("thumbnail_error")
    if error not in (None, "render_failed"):
        raise UploadProcessingError("upload_processing_failed")
    return UploadResult(content, metadata, value["original"], value["processing"], value["suggestions"], thumbnail, error)


async def prepare_supervised_upload(content: bytes, mime: str, filename: str, resolved: dict,
                                    existing: dict | None = None, *, timeout: float = CHILD_TIMEOUT, disconnected=None) -> UploadResult:
    if not math.isfinite(timeout) or timeout <= 0 or timeout > CHILD_TIMEOUT:
        raise ValueError("Invalid child deadline")
    if len(content) > 50 * 1024 * 1024:
        raise UploadProcessingError("pdf_input_too_large" if mime == "application/pdf" else "image_input_too_large")
    root = assets.STORAGE_ROOT.absolute()
    if root.resolve() != root:
        raise UploadProcessingError("upload_processing_failed")
    scratch = root / ".upload-work"
    scratch.mkdir(parents=True, exist_ok=True, mode=0o700)
    if scratch.is_symlink() or scratch.resolve().parent != root:
        raise UploadProcessingError("upload_processing_failed")
    with tempfile.TemporaryDirectory(prefix="upload-", dir=scratch) as temporary:
        directory = Path(temporary)
        assert directory.resolve().parent == scratch.resolve()
        process = None
        try:
            request = json.dumps({"mime": mime, "filename": filename, "resolved": resolved, "existing": existing},
                                 ensure_ascii=False).encode("utf-8")
            if len(request) > IPC_JSON_LIMIT:
                raise UploadProcessingError("upload_processing_failed")
            await run_upload_work((directory / "input.bin").write_bytes, content)
            await run_upload_work((directory / "request.json").write_bytes, request)
            spawn = asyncio.create_task(asyncio.create_subprocess_exec(
                sys.executable, "-I", "-B", str(CHILD_SCRIPT), str(directory),
                cwd=directory, env=child_environment(directory),
                stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL, start_new_session=os.name == "posix"))
            cancelled = False
            while True:
                try:
                    process = await asyncio.shield(spawn)
                    break
                except asyncio.CancelledError:
                    cancelled = True
            if cancelled:
                raise asyncio.CancelledError
            deadline = asyncio.get_running_loop().time() + timeout
            while process.returncode is None:
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    raise UploadProcessingError("upload_processing_timeout")
                if disconnected is not None and await disconnected():
                    raise asyncio.CancelledError
                try:
                    await asyncio.wait_for(process.wait(), min(0.25, remaining))
                except asyncio.TimeoutError:
                    continue
            prepared = await run_upload_work(_read_result, directory, content, existing)
            if process.returncode != 0:
                raise UploadProcessingError("upload_processing_failed")
            return prepared
        except (UploadProcessingError, asyncio.CancelledError):
            raise
        except Exception:
            raise UploadProcessingError("upload_processing_failed") from None
        finally:
            if process is not None:
                if await _reap_despite_cancellation(process):
                    raise asyncio.CancelledError


PROCESSING_MESSAGES = {
    'webp_pixel_limit': 'ภาพ WebP ต้องมีขนาดไม่เกิน 24 ล้านพิกเซล กรุณาลดความละเอียดแล้วอัปโหลดอีกครั้ง',
    'pdf_image_pixel_limit': 'ภาพแต่ละภาพใน PDF ต้องมีขนาดไม่เกิน 24 ล้านพิกเซลเมื่อรวมความลึกสีและมาสก์ กรุณาลดความละเอียดแล้วส่งออก PDF ใหม่',
    'jpeg_pixel_limit': 'ภาพ JPEG ต้องมีขนาดไม่เกิน 100 ล้านพิกเซล กรุณาลดความละเอียดแล้วอัปโหลดอีกครั้ง',
    'png_pixel_limit': 'ภาพ PNG ต้องมีขนาดไม่เกิน 24 ล้านพิกเซล กรุณาลดความละเอียดแล้วอัปโหลดอีกครั้ง',
    'png_hdr_requires_export': 'ไม่รองรับภาพ PNG แบบ HDR กรุณาส่งออกเป็นภาพ 8-bit sRGB แล้วอัปโหลดอีกครั้ง',
    'pdf_pixel_limit': 'ภาพภายใน PDF มีขนาดรวมเกิน 240 ล้านพิกเซล กรุณาลดความละเอียดของภาพแล้วส่งออก PDF ใหม่',
    'upload_processing_memory': 'ไฟล์นี้ใช้หน่วยความจำในการประมวลผลมากเกินไป กรุณาลดความซับซ้อนหรือส่งออกไฟล์ใหม่',
    'upload_processing_timeout': 'ประมวลผลไฟล์ไม่เสร็จภายในเวลาที่กำหนด กรุณาลดความซับซ้อนหรือส่งออกไฟล์ใหม่',
    'upload_processing_failed': 'ไม่สามารถประมวลผลไฟล์นี้ได้ กรุณาส่งออกไฟล์ใหม่แล้วอัปโหลดอีกครั้ง',
    'image_input_too_large': 'ภาพไม่เกิน 30 MB ต่อไฟล์',
    'pdf_input_too_large': 'PDF ไม่เกิน 50 MB ต่อไฟล์',
    'legal_input_too_large': 'เอกสารกฎหมายหรือไฟล์ที่ยังไม่ระบุประเภทต้องไม่เกิน 10 MB',
    'image_output_too_large': 'ภาพหลังปรับขนาดยังเกิน 10 MB กรุณาลดขนาดไฟล์แล้วอัปโหลดอีกครั้ง',
    'pdf_output_too_large': 'PDF หลังปรับขนาดยังเกิน 20 MB กรุณาลดขนาดไฟล์แล้วอัปโหลดอีกครั้ง',
    'pdf_reexport_required': 'ไม่สามารถลบข้อมูลแฝงของ PDF ได้อย่างปลอดภัย กรุณาส่งออก PDF ใหม่แล้วอัปโหลดอีกครั้ง',
    'image_color_space_requires_export': 'กรุณาส่งออกภาพเป็น sRGB แล้วอัปโหลดอีกครั้ง',
}


def processing_failure(error: UploadProcessingError):
    from .auth import failure
    code = error.args[0] if error.args and error.args[0] in PROCESSING_MESSAGES else 'invalid_upload_file'
    return failure(422, code, PROCESSING_MESSAGES.get(code,
        'ไม่สามารถประมวลผลไฟล์นี้ได้ กรุณาตรวจรูปแบบไฟล์แล้วลองอีกครั้ง'))
