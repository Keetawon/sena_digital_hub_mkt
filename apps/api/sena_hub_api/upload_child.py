"""Private file IPC entry point. No settings, database or network credentials."""
import io
import json
import os
from pathlib import Path
import sys

MEMORY_LIMIT = 896 * 1024 * 1024
_job_handle = None


def limit_memory():
    global _job_handle
    if os.name == "posix":
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (MEMORY_LIMIT, MEMORY_LIMIT))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    else:
        import ctypes
        from ctypes import wintypes
        class Basic(ctypes.Structure):
            _fields_ = [("process_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong),
                        ("flags", wintypes.DWORD), ("min_ws", ctypes.c_size_t), ("max_ws", ctypes.c_size_t),
                        ("active", wintypes.DWORD), ("affinity", ctypes.c_size_t),
                        ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]
        class Counters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]
        class Extended(ctypes.Structure):
            _fields_ = [("basic", Basic), ("io", Counters), ("process_memory", ctypes.c_size_t),
                        ("job_memory", ctypes.c_size_t), ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        _job_handle = kernel.CreateJobObjectW(None, None)
        limits = Extended()
        limits.basic.flags = 0x100 | 0x2000
        limits.process_memory = MEMORY_LIMIT
        if (not _job_handle or not kernel.SetInformationJobObject(_job_handle, 9, ctypes.byref(limits), ctypes.sizeof(limits))
                or not kernel.AssignProcessToJobObject(_job_handle, kernel.GetCurrentProcess())):
            raise OSError("Child memory boundary unavailable")


def main():
    directory = Path(sys.argv[1]).resolve()
    result = {"ok": False, "error": "upload_processing_failed"}
    reserve = bytearray(64 * 1024)
    try:
        limit_memory()
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from sena_hub_api import assets
        from sena_hub_api.upload_optimization import UploadProcessingError
        from sena_hub_api.upload_pipeline import prepare_authorized_upload
        request_path, input_path = directory / "request.json", directory / "input.bin"
        if request_path.stat().st_size > 256 * 1024 or input_path.stat().st_size > 50 * 1024 * 1024:
            raise ValueError("IPC size")
        request = json.loads(request_path.read_bytes())
        content = input_path.read_bytes()
        prepared = prepare_authorized_upload(content, request["mime"], request["filename"],
                                             request["resolved"], request["existing"])
        result = {"ok": True, "has_content": prepared.content is not None,
                  "metadata": prepared.metadata, "original": prepared.original,
                  "processing": prepared.processing, "suggestions": prepared.suggestions,
                  "thumbnail": False, "thumbnail_error": None}
        if prepared.content is not None:
            (directory / "stored.bin").write_bytes(prepared.content)
            try:
                with assets.render_thumbnail(prepared.content, prepared.metadata["mime_type"]) as picture:
                    from PIL import Image
                    picture.thumbnail((assets.THUMBNAIL_SIZE, assets.THUMBNAIL_SIZE), Image.Resampling.LANCZOS)
                    output = io.BytesIO()
                    picture.save(output, "WEBP", quality=80, method=4)
                data = output.getvalue()
                if len(data) > 256 * 1024:
                    raise ValueError("Thumbnail size")
                (directory / "thumbnail.webp").write_bytes(data)
                result["thumbnail"] = True
            except MemoryError:
                raise
            except Exception:
                result["thumbnail_error"] = "render_failed"
    except MemoryError:
        reserve = None
        result = {"ok": False, "error": "upload_processing_memory"}
    except Exception as error:
        reserve = None
        from sena_hub_api.upload_optimization import UploadProcessingError
        from sena_hub_api.upload_supervision import ERROR_CODES
        code = error.args[0] if isinstance(error, UploadProcessingError) and error.args else "upload_processing_failed"
        result = {"ok": False, "error": code if code in ERROR_CODES else "invalid_upload_file"}
    finally:
        reserve = None
        (directory / "result.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
