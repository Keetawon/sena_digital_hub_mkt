"""Finite upload context and non-queued, cancellation-safe process admission."""
from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
import json
import os
from threading import Lock
from typing import TypeVar
from uuid import UUID

T = TypeVar('T')
_SLOT = Lock()
_FIELDS = {
    'intake': set(),
    'project': {'ref', 'category', 'purpose'},
    'brand': {'ref', 'purpose'},
    'model': {'project_ref', 'ref', 'category', 'purpose'},
    'commercial_type': {'project_ref', 'ref', 'category', 'purpose'},
    'media_target': {'project_ref', 'target_type', 'target_key', 'category', 'usage'},
    'disclosure': {'project_ref', 'ref'},
    'knowledge': {'candidate_id'},
}
_PURPOSES = {
    'project': {'media', 'hero', 'thumbnail', 'master_plan', 'floor_plan', 'brochure'},
    'brand': {'logo_primary', 'logo_white', 'logo_mono', 'favicon'},
    'model': {'model_image', 'floor_plan', 'structural_plan'},
    'commercial_type': {'media', 'floor_plan', 'unit_plan', 'structural_plan'},
}
_TARGETS = {'project', 'commercial_type', 'facility', 'feature', 'place',
            'promotion', 'article', 'building_floor', 'selling_point', 'disclosure'}
_USAGES = {'hero', 'thumbnail', 'gallery', 'card', 'banner', 'evidence'}


class UploadAdmissionError(ValueError):
    """Fixed error code only; never retain the supplied header or decoder text."""


def _object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise UploadAdmissionError('invalid_upload_context')
        result[key] = value
    return result


def _constant(_value: str) -> None:
    raise UploadAdmissionError('invalid_upload_context')


def parse_upload_context(values: Sequence[str]) -> dict:
    if len(values) != 1 or not values[0] or len(values[0]) > 2048:
        raise UploadAdmissionError('invalid_upload_context')
    header = values[0]
    if any(ord(char) < 32 or ord(char) > 126 for char in header):
        raise UploadAdmissionError('invalid_upload_context')
    try:
        value = json.loads(header, object_pairs_hook=_object, parse_constant=_constant)
    except (ValueError, RecursionError):
        raise UploadAdmissionError('invalid_upload_context') from None
    if not isinstance(value, dict) or type(value.get('v')) is not int or value['v'] != 1:
        raise UploadAdmissionError('invalid_upload_context')
    kind = value.get('kind')
    if not isinstance(kind, str) or kind not in _FIELDS or set(value) != {'v', 'kind'} | _FIELDS[kind]:
        raise UploadAdmissionError('invalid_upload_context')
    for key in _FIELDS[kind]:
        item = value[key]
        if item is None and (key == 'category' or kind == 'disclosure' and key == 'ref'):
            continue
        if not isinstance(item, str) or not 1 <= len(item) <= 200 or any(ord(char) < 32 or ord(char) > 126 for char in item):
            raise UploadAdmissionError('invalid_upload_context')
    if kind in _PURPOSES and value['purpose'] not in _PURPOSES[kind]:
        raise UploadAdmissionError('invalid_upload_context')
    if kind == 'media_target' and (value['target_type'] not in _TARGETS or value['usage'] not in _USAGES):
        raise UploadAdmissionError('invalid_upload_context')
    uuid_key = 'candidate_id' if kind == 'knowledge' else 'ref' if kind == 'disclosure' else None
    if uuid_key and value[uuid_key] is not None:
        try:
            value[uuid_key] = str(UUID(value[uuid_key]))
        except ValueError:
            raise UploadAdmissionError('invalid_upload_context') from None
    return value


@contextmanager
def upload_slot() -> Iterator[None]:
    if not _SLOT.acquire(blocking=False):
        raise UploadAdmissionError('upload_busy')
    descriptor = None
    try:
        from . import assets
        root = assets.STORAGE_ROOT.absolute()
        if root.resolve() != root:
            raise UploadAdmissionError('upload_busy')
        root.mkdir(parents=True, exist_ok=True)
        path = root / '.upload-processing.lock'
        if path.is_symlink():
            raise UploadAdmissionError('upload_busy')
        descriptor = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            if os.name == 'nt':
                import msvcrt
                if os.fstat(descriptor).st_size == 0:
                    os.write(descriptor, b'0')
                os.lseek(descriptor, 0, os.SEEK_SET)
                msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise UploadAdmissionError('upload_busy') from None
        yield
    finally:
        if descriptor is not None:
            os.close(descriptor)
        _SLOT.release()


async def run_upload_work(function: Callable[..., T], *args: object) -> T:
    """Keep the caller's admission held until its off-thread work has ended."""
    task = asyncio.create_task(asyncio.to_thread(function, *args))
    cancelled = False
    while True:
        try:
            result = await asyncio.shield(task)
            break
        except asyncio.CancelledError:
            cancelled = True
            if task.done():
                break
        except Exception:
            if cancelled:
                raise asyncio.CancelledError from None
            raise
    if cancelled:
        if not task.cancelled():
            task.exception()
        raise asyncio.CancelledError
    return result
