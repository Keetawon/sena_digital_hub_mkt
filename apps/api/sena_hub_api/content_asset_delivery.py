"""Buffered staff-only asset delivery with a final, current authorization read."""
from __future__ import annotations

from asyncio import to_thread
import hashlib
from pathlib import Path
from urllib.parse import quote
from uuid import UUID

from fastapi import HTTPException, Request
from fastapi.responses import Response

from . import assets
from .auth import Actor


ASSET_FILE_SQL = "SELECT hub.asset_file($1)"


def _bounded_bytes(path: Path) -> bytes:
    if not path.is_file():
        raise HTTPException(404)
    try:
        with path.open("rb") as source:
            content = source.read(assets.MAX_BYTES + 1)
    except FileNotFoundError:
        raise HTTPException(404) from None
    except OSError:
        raise HTTPException(503) from None
    if not 0 < len(content) <= assets.MAX_BYTES:
        raise HTTPException(503)
    return content


def _checked_original(content: bytes, metadata: dict) -> bytes:
    size = metadata.get("file_size")
    if (not isinstance(content, bytes) or type(size) is not int
            or not 0 < size <= assets.MAX_BYTES or len(content) != size
            or hashlib.sha256(content).hexdigest() != metadata.get("checksum")):
        raise HTTPException(503)
    return content


def _original_bytes(metadata: dict, hosted_assets) -> bytes:
    mime = metadata.get("mime_type")
    if mime not in assets.FORMATS:
        raise HTTPException(404)
    if hosted_assets is not None:
        return _checked_original(hosted_assets.read(metadata), metadata)
    path = assets.storage_path(metadata.get("storage_path"))
    if path.name != f"{metadata.get('checksum')}.{assets.FORMATS[mime][1]}":
        raise HTTPException(503)
    return _checked_original(_bounded_bytes(path), metadata)


def _delivery_bytes(metadata: dict, hosted_assets, thumbnail: bool) -> bytes:
    if not thumbnail:
        return _original_bytes(metadata, hosted_assets)
    if hosted_assets is not None and not assets.thumbnail_path(metadata).is_file():
        # Reuse the existing private cache and renderer, never a supplied URL.
        assets.install_thumbnail(_original_bytes(metadata, hosted_assets), metadata)
    return _bounded_bytes(assets.readable_thumbnail(metadata))


async def staff_asset_response(
    asset_id: UUID, request: Request, actor: Actor, *, authentication, database,
    authorize, hosted_assets=None, thumbnail: bool = False,
) -> Response:
    """Called after the normal staff dependency and storage-mode guard.

    Storage, rendering and local reads finish before fresh authentication and the
    ordinary exact-object SQL guard. No private file is opened after this return.
    """
    async with database(request, actor) as connection:
        metadata = await connection.fetchval(ASSET_FILE_SQL, asset_id)
    if metadata is None:
        raise HTTPException(404)
    content = await to_thread(_delivery_bytes, metadata, hosted_assets, thumbnail)

    current_actor = await authentication(request)
    if current_actor.id != actor.id:
        raise HTTPException(403)
    current_actor = await authorize(request, current_actor)
    async with database(request, current_actor) as connection:
        current = await connection.fetchval(ASSET_FILE_SQL, asset_id)
    if current is None:
        raise HTTPException(404)
    if current != metadata:
        raise HTTPException(409)

    headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    if thumbnail:
        headers["Content-Security-Policy"] = "default-src 'none'"
        return Response(content, media_type="image/webp", headers=headers)

    disposition = "attachment" if metadata["mime_type"] == "application/pdf" else "inline"
    filename = metadata["original_filename"]
    encoded_filename = quote(filename)
    headers["Content-Disposition"] = (
        f"{disposition}; filename*=utf-8''{encoded_filename}"
        if hosted_assets is not None or encoded_filename != filename
        else f'{disposition}; filename="{filename}"'
    )
    headers["Content-Security-Policy"] = "sandbox; default-src 'none'; frame-ancestors 'none'"
    headers["X-Frame-Options"] = "DENY"
    return Response(content, media_type=metadata["mime_type"], headers=headers)
