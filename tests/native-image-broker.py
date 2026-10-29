"""Candidate readiness: real Linux SO_PEERCRED, in-memory fixtures, no DB/provider."""
import asyncio
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import struct
import sys
from uuid import uuid4

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps/api'))
from sena_hub_api.image_broker import ImageBroker


async def check(accepted):
    assert sys.platform == 'linux' and hasattr(socket, 'SO_PEERCRED')
    image = io.BytesIO(); Image.new('RGB', (12, 8), 'green').save(image, 'PNG'); original = image.getvalue()
    metadata = {'mime_type': 'image/png', 'file_size': len(original), 'checksum': hashlib.sha256(original).hexdigest()}
    server_sock, client_sock = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
    reader, writer = await asyncio.open_connection(sock=server_sock, limit=257)
    response, sender = await asyncio.open_connection(sock=client_sock)
    service = ImageBroker(None, lambda _: original, os.getuid() if accepted else os.getuid() + 1)
    calls = []
    async def rpc(query, *args, **kwargs):
        calls.append((query, args))
        if 'media_image_lease' in query:
            assert kwargs['readonly'] is True
            return metadata
    service.rpc = rpc
    task = asyncio.create_task(service.handle(reader, writer))
    sender.write(json.dumps({'job_id': str(uuid4()), 'lease': str(uuid4())}).encode() + b'\n'); await sender.drain()
    length = struct.unpack('!I', await response.readexactly(4))[0]
    assert (length > 0) == accepted
    if length:
        result = await response.readexactly(length)
        assert result != original
        with Image.open(io.BytesIO(result)) as decoded:
            assert decoded.format == 'JPEG' and max(decoded.size) <= 768 and not decoded.getexif()
    await task
    assert sum('media_image_fetch_audit' in q for q, _ in calls) == 1
    assert any('media_image_lease' in q for q, _ in calls) == accepted
    sender.close(); await sender.wait_closed(); service.close()


async def main():
    await check(True); await check(False)


if __name__ == '__main__':
    asyncio.run(main())
    print('PASS: 2 native Unix peer/JPEG checks; no database or provider connection.')
