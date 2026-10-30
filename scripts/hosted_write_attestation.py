"""Thin asyncpg adapter; all H5i decisions live in hosted-write-attestation.mjs.

No credentials, SQL errors, Auth hashes or row values are logged. The child uses
private pipes. A lost child/parent fails closed and rolls back the connection.
"""
import asyncio
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class AttestedTransaction:
    def __init__(self, db, manifest, *, rehearsal=False):
        self.db, self.manifest, self.rehearsal = db, manifest, rehearsal
        self.process = None
        self.receipt = None
        self.derived_manifest = None

    async def _send(self, value):
        self.process.stdin.write((json.dumps(value, default=str) + '\n').encode('utf-8'))
        await self.process.stdin.drain()

    async def _until(self, expected):
        while True:
            raw = await asyncio.wait_for(self.process.stdout.readline(), timeout=180)
            if not raw:
                raise RuntimeError('attestation_pipe_closed')
            message = json.loads(raw)
            if message['event'] == expected:
                return message
            if message['event'] == 'stopped':
                self.receipt = message['receipt']
                raise RuntimeError('attestation_stopped')
            if message['event'] != 'query':
                raise RuntimeError('attestation_protocol_error')
            try:
                statement = await self.db.prepare(message['sql'])
                records = await statement.fetch(*message['params'])
                json_fields = {a.name for a in statement.get_attributes() if a.type.name in ('json', 'jsonb')}
                rows = [{k: json.loads(v) if k in json_fields and isinstance(v, str) else v
                         for k, v in dict(row).items()} for row in records]
                await self._send({'rows': rows})
            except Exception as error:
                await self._send({'error': getattr(error, 'sqlstate', None) or 'DB_ERROR'})

    async def start(self):
        if self.db.is_in_transaction():
            raise RuntimeError('nested_attestation_refused')
        connection = await self.db.fetchrow('select host(inet_server_addr()) host,inet_server_port() port,current_database() database')
        self.process = await asyncio.create_subprocess_exec(
            'node', str(ROOT / 'scripts/hosted-write-bridge.mjs'), cwd=ROOT,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        await self._send({'connection': dict(connection), 'remoteAddress': connection['host'],
                          'manifest': self.manifest, 'rehearsal': self.rehearsal})
        try:
            await self._until('ready')
        except BaseException:
            await self.rollback()
            raise
        return self

    async def commit(self):
        try:
            await self._send({'event': 'finish'})
            result = await self._until('complete')
            self.receipt, self.derived_manifest = result['receipt'], result.get('manifest')
            self.process.stdin.close()
            if await asyncio.wait_for(self.process.wait(), timeout=10) != 0:
                raise RuntimeError('attestation_process_failed')
        except BaseException:
            await self.rollback()
            raise

    async def rollback(self):
        if self.process and self.process.returncode is None:
            try:
                await self._send({'event': 'abort'})
                await self._until('complete')
            except Exception:
                pass
            if self.process.returncode is None:
                self.process.terminate()
            await self.process.wait()
        if self.db.is_in_transaction():
            await self.db.execute('rollback')

    async def __aenter__(self):
        return await self.start()

    async def __aexit__(self, kind, value, traceback):
        if kind:
            await self.rollback()
        else:
            await self.commit()


def load_manifest(file):
    """Only existing ignored, non-credential packages; never synthesize approval."""
    target = Path(file).resolve()
    if not target.is_relative_to(ROOT / '.local') or target.is_symlink():
        raise ValueError('attestation_manifest_path_refused')
    return json.loads(target.read_text(encoding='utf-8'))


class OperatorTransaction:
    """Preserve local operators; a hosted connection requires an H5i proof."""
    def __init__(self, db, manifest=None, *, rehearsal=False, local_isolation=None):
        self.db, self.manifest, self.rehearsal = db, manifest, rehearsal
        self.local_isolation = local_isolation
        self.transaction = None

    async def start(self):
        if self.manifest is not None:
            self.transaction = AttestedTransaction(self.db, self.manifest, rehearsal=self.rehearsal)
        else:
            target = await self.db.fetchrow('select host(inet_server_addr()) host,inet_server_port() port,current_database() database')
            if dict(target) != {'host': '127.0.0.1', 'port': 55432, 'database': 'sena_hub_local'}:
                raise RuntimeError('hosted_write_requires_disposable_rehearsal_manifest')
            self.transaction = self.db.transaction(isolation=self.local_isolation)
        await self.transaction.start()
        return self

    async def commit(self):
        await self.transaction.commit()

    async def rollback(self):
        await self.transaction.rollback()

    async def __aenter__(self):
        return await self.start()

    async def __aexit__(self, kind, value, traceback):
        if kind:
            await self.rollback()
        else:
            await self.commit()
