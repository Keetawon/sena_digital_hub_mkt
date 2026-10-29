"""Private, peer-authenticated Unix socket. There is deliberately no HTTP route."""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
import os
import socket
import stat
import struct
import warnings
from uuid import UUID

from PIL import Image, ImageOps

from . import assets

SOCKET_PATH = '/run/sena-hub-test-media/image.sock'
MAX_REQUEST = 256
MAX_JPEG = 1024 * 1024
TIMEOUT = 20


def jpeg_for_lease(metadata, reader):
    """Never return originals, metadata or a file name. Strip EXIF by re-encoding."""
    mime = metadata.get('mime_type')
    if mime not in ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'):
        raise ValueError('image_unavailable')
    size = metadata.get('file_size')
    if type(size) is not int or not 0 < size <= assets.MAX_BYTES:
        raise ValueError('image_unavailable')
    raw = reader(metadata)
    if len(raw) != size or hashlib.sha256(raw).hexdigest() != metadata.get('checksum'):
        raise ValueError('image_unavailable')
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        if mime == 'image/svg+xml':
            clean, width, height = assets.sanitize_svg(raw)
            if clean != raw or not 0 < width * height <= assets.MAX_PIXELS:
                raise ValueError('image_unavailable')
            import resvg_py
            scale = 768 / max(width, height)
            raw = resvg_py.svg_to_bytes(svg_string=clean.decode('utf8'), width=max(1, round(width * scale)),
                                       height=max(1, round(height * scale)), log_information=False)
        with Image.open(io.BytesIO(raw)) as source:
            if not 0 < source.width * source.height <= assets.MAX_PIXELS or getattr(source, 'n_frames', 1) != 1:
                raise ValueError('image_unavailable')
            with ImageOps.exif_transpose(source).convert('RGBA') as image:
                image.thumbnail((768, 768), Image.Resampling.LANCZOS)
                with Image.new('RGB', image.size, 'white') as flat:
                    flat.paste(image, mask=image.getchannel('A'))
                    output = io.BytesIO(); flat.save(output, 'JPEG', quality=80)
    data = output.getvalue()
    if not 0 < len(data) <= MAX_JPEG:
        raise ValueError('image_unavailable')
    return data


class ImageBroker:
    def __init__(self, pool, reader, expected_uid):
        self.pool, self.reader, self.expected_uid = pool, reader, expected_uid
        self.executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix='private-image')
        self.slots = asyncio.Semaphore(2)

    async def rpc(self, query, *args, readonly=False):
        async with self.pool.acquire(timeout=3) as db:
            async with db.transaction(readonly=readonly):
                await db.execute('SET LOCAL ROLE hub_app')
                return await db.fetchval(query, *args)

    async def handle(self, reader, writer):
        job_id, outcome, data = None, 'denied', b''
        try:
            async with asyncio.timeout(TIMEOUT):
                peer = writer.get_extra_info('socket')
                _, uid, _ = struct.unpack('3i', peer.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))
                if uid != self.expected_uid:
                    raise ValueError('peer_denied')
                raw = await reader.readuntil(b'\n')
                if len(raw) > MAX_REQUEST:
                    raise ValueError('request_denied')
                request = json.loads(raw)
                if not isinstance(request, dict) or set(request) != {'job_id', 'lease'}:
                    raise ValueError('request_denied')
                job_id, lease = UUID(request['job_id']), UUID(request['lease'])
                metadata = await self.rpc('select hub.media_image_lease($1,$2)', job_id, lease, readonly=True)
                if metadata is None:
                    raise ValueError('lease_denied')
                outcome = 'unavailable'
                await asyncio.wait_for(self.slots.acquire(), 1)
                future = asyncio.get_running_loop().run_in_executor(self.executor, jpeg_for_lease, metadata, self.reader)
                future.add_done_callback(lambda _: self.slots.release())
                data = await asyncio.wait_for(asyncio.shield(future), 15)
                # Recheck source revision and permission after reading/resizing bytes.
                if await self.rpc('select hub.media_image_lease($1,$2)', job_id, lease, readonly=True) is None:
                    data = b''; outcome = 'denied'
                else:
                    outcome = 'ok'
        except Exception:
            data = b''
        try:
            await asyncio.wait_for(self.rpc('select hub.media_image_fetch_audit($1,$2)', job_id, outcome), 5)
        except Exception:
            data = b''  # Never deliver bytes without their committed fetch audit.
        try:
            writer.write(struct.pack('!I', len(data)) + data)
            await asyncio.wait_for(writer.drain(), 2)
        except Exception:
            pass
        finally:
            writer.close()
            try:
                await asyncio.wait_for(writer.wait_closed(), 1)
            except Exception:
                if hasattr(writer, 'transport'):
                    writer.transport.abort()

    def close(self):
        self.executor.shutdown(wait=False, cancel_futures=True)


async def start_broker(pool, storage):
    if os.environ.get('HUB_MEDIA_BROKER_ENABLED') != '1':
        return None
    import pwd
    if (os.environ.get('LISTEN_PID') != str(os.getpid()) or os.environ.get('LISTEN_FDS') != '1'
            or os.environ.get('LISTEN_FDNAMES') != 'image-broker' or not hasattr(socket, 'SO_PEERCRED')):
        raise RuntimeError('Private image socket activation is invalid')
    listener = socket.socket(fileno=os.dup(3))
    info = os.stat(SOCKET_PATH, follow_symlinks=False)
    directory = os.stat(os.path.dirname(SOCKET_PATH), follow_symlinks=False)
    worker = pwd.getpwnam('sena-hub-media')
    if (listener.family != socket.AF_UNIX or listener.getsockname() != SOCKET_PATH or not stat.S_ISSOCK(info.st_mode)
            or stat.S_IMODE(info.st_mode) != 0o660 or info.st_gid != worker.pw_gid or info.st_uid != os.getuid()
            or not stat.S_ISDIR(directory.st_mode) or stat.S_IMODE(directory.st_mode) != 0o755
            or directory.st_uid != os.getuid() or directory.st_gid != os.getgid()
            or not listener.getsockopt(socket.SOL_SOCKET, socket.SO_ACCEPTCONN) or storage is None):
        listener.close(); raise RuntimeError('Private image socket boundary is invalid')
    broker = ImageBroker(pool, storage.read, worker.pw_uid)
    server = await asyncio.start_unix_server(broker.handle, sock=listener, limit=MAX_REQUEST + 1)
    return server, broker


async def fetch_image(job_id, lease, path=SOCKET_PATH):
    async with asyncio.timeout(TIMEOUT + 5):
        reader, writer = await asyncio.open_unix_connection(path, limit=MAX_JPEG + 4)
        try:
            writer.write(json.dumps({'job_id': str(job_id), 'lease': str(lease)}, separators=(',', ':')).encode('ascii') + b'\n')
            await writer.drain()
            length = struct.unpack('!I', await reader.readexactly(4))[0]
            if not 0 < length <= MAX_JPEG:
                raise ValueError('image_unavailable')
            data = await reader.readexactly(length)
            with Image.open(io.BytesIO(data)) as image:
                if image.format != 'JPEG' or max(image.size) > 768:
                    raise ValueError('image_unavailable')
                image.verify()
            return data
        finally:
            writer.close()
            try:
                await asyncio.wait_for(writer.wait_closed(), 1)
            except Exception:
                writer.transport.abort()
