"""BU membership contract and caller notices. No source connector or credential loader.

The injected source adapter describes the future verified read-only transaction.
The local CLI only validates checked-in fixtures. Hub acceptance is authoritative
and rechecks the full snapshot under its own clock/epoch; it is not an HTTP API.
"""
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends, Query, Request, Response
from pydantic import StringConstraints

from .auth import Actor, failure

COLUMNS = (
    'project_id', 'rem_bu_id', 'rem_bu_code', 'rem_bu_name',
    'rem_bu_is_active', 'rem_bu_is_deleted', 'source_snapshot_at', 'project_status_code',
)
SOURCE_SELECT = 'SELECT ' + ', '.join(COLUMNS) + ' FROM serving.hub_project_bu ORDER BY project_id'
SOURCE_SSLMODE = 'verify-full'
MAX_SOURCE_AGE = timedelta(hours=48)
ProjectRef = Annotated[str, StringConstraints(min_length=1, max_length=200, pattern=r'^[^\x00-\x1f]+$')]


class InvalidSnapshot(ValueError):
    """Finite diagnostic only: source row values never enter exception text."""
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def timestamp(value: Any) -> datetime:
    try:
        result = value if isinstance(value, datetime) else datetime.fromisoformat(value)
        if result.tzinfo is None or result.utcoffset() is None:
            raise ValueError('Missing timezone')
        return result.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        raise InvalidSnapshot('invalid_timestamp') from None


def utc_text(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')


@dataclass(frozen=True)
class Snapshot:
    rows: tuple[dict[str, Any], ...]
    source_watermark: datetime
    digest: str


def validate_snapshot(rows: Any, *, now: datetime) -> Snapshot:
    """Pure clock-injected fixture validation; never a runtime authorization clock."""
    now = timestamp(now)
    if not isinstance(rows, (list, tuple)):
        raise InvalidSnapshot('invalid_shape')
    if not rows:
        raise InvalidSnapshot('empty')
    normalized, seen, stamps = [], set(), []
    for source in rows:
        if not isinstance(source, Mapping) or set(source) != set(COLUMNS):
            raise InvalidSnapshot('invalid_shape')
        project = source['project_id']
        if not isinstance(project, str) or not project.strip() or '\x00' in project:
            raise InvalidSnapshot('invalid_project')
        if project in seen:
            raise InvalidSnapshot('duplicate_project')
        seen.add(project)
        for key in ('rem_bu_id', 'rem_bu_code', 'rem_bu_name', 'project_status_code'):
            value = source[key]
            if value is not None and (not isinstance(value, str) or '\x00' in value):
                raise InvalidSnapshot('invalid_bu')
        if source['rem_bu_id'] is not None and not source['rem_bu_id'].strip():
            raise InvalidSnapshot('invalid_bu')
        for key in ('rem_bu_is_active', 'rem_bu_is_deleted'):
            if source[key] is not None and type(source[key]) is not bool:
                raise InvalidSnapshot('invalid_bu')
        stamp = timestamp(source['source_snapshot_at'])
        if stamp > now:
            raise InvalidSnapshot('future_snapshot')
        if stamp < now - MAX_SOURCE_AGE:
            raise InvalidSnapshot('old_snapshot')
        stamps.append(stamp)
        normalized.append(dict(source, source_snapshot_at=utc_text(stamp)))
    normalized.sort(key=lambda row: row['project_id'].encode('utf-8'))
    canonical = [[row[column] for column in COLUMNS] for row in normalized]
    digest = hashlib.sha256(json.dumps(canonical, ensure_ascii=False).encode('utf-8')).hexdigest()
    return Snapshot(tuple(normalized), min(stamps), digest)


async def read_source(connection_factory: Callable) -> list[dict[str, Any]]:
    """Injected only; no driver import, endpoint, password or connection constructor.

    A future enabled adapter must provide an async context manager honoring this
    verified TLS mode. One transaction reads the complete exact eight-column view.
    """
    async with connection_factory(sslmode=SOURCE_SSLMODE) as connection:
        async with connection.transaction(readonly=True):
            return [dict(row) for row in await connection.fetch(SOURCE_SELECT)]


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


class MembershipStore:
    """Private operator connection supplied by the separately authorized job.

    Each Hub call is an independent statement transaction; no Hub lock is held
    across the awaited source read. The source itself uses its own one read-only
    transaction. Connections already inside a transaction are rejected.
    """
    def __init__(self, connection):
        self.connection = connection

    def independent_transaction(self):
        if self.connection.is_in_transaction():
            raise RuntimeError('BU refresh requires independent Hub transactions')

    async def maintain(self):
        self.independent_transaction()
        return _json(await self.connection.fetchval('select hub.content_bu_maintain()'))

    async def capture(self):
        self.independent_transaction()
        return _json(await self.connection.fetchval('select hub.content_bu_capture()'))

    async def accept(self, rows, captured):
        self.independent_transaction()
        # SQL validates at acceptance time. A naive datetime is intentionally not
        # assigned a timezone here: SQL rejects it instead of inventing evidence.
        def encode(value):
            if isinstance(value, datetime):
                return value.isoformat()
            raise TypeError('Unsupported source value')
        try:
            payload = json.dumps(rows, default=encode, ensure_ascii=False, allow_nan=False)
        except (TypeError, ValueError):
            return await self.reject(captured, 'invalid_shape')
        return _json(await self.connection.fetchval('select hub.content_bu_accept($1::text::jsonb,$2::uuid,$3::bigint)',
            payload, UUID(str(captured['accepted_run_id'])) if captured['accepted_run_id'] else None, captured['acceptance_epoch']))

    async def reject(self, captured, code):
        self.independent_transaction()
        return _json(await self.connection.fetchval('select hub.content_bu_reject($1::uuid,$2::bigint,$3::text,0)',
            UUID(str(captured['accepted_run_id'])) if captured['accepted_run_id'] else None, captured['acceptance_epoch'], code))

    async def failed(self, captured):
        return await self.reject(captured, 'read_failed')


async def refresh_membership(store, reader: Callable):
    """One attempt: capture BEFORE fetch; stale completion requires a new attempt.

    No automatic retry follows either a stale result or an ambiguous Hub write.
    Calling this function again always captures and reads again. Source failures
    store only read_failed, never connection or exception details.
    """
    captured = await store.capture()
    try:
        rows = await reader()
    except Exception:
        return await store.failed(captured)
    return await store.accept(rows, captured)


async def run_membership_job(hub_connection, source_connection_factory: Callable):
    """One disabled-by-configuration job entry point, with injected connections.

    The authorized scheduler supplies connections; this module never loads a
    credential or constructs a live source connection. Local tests supply fakes.
    No automatic retry follows an ambiguous write or a stale completion.
    """
    return await refresh_membership(MembershipStore(hub_connection),
                                    lambda: read_source(source_connection_factory))


async def maintain_membership(hub_connection):
    """Record elapsed access boundaries independently of new source deliveries."""
    return await MembershipStore(hub_connection).maintain()


def register_bu_membership_routes(app, authentication, database):
    async def staff(request: Request, actor: Actor = Depends(authentication)):
        account = getattr(request.state, 'account', {})
        if account.get('status') != 'ACTIVE' or actor.role not in {'viewer', 'editor', 'publisher', 'admin', 'online_staff'}:
            raise failure(403, 'bu_notice_permission', 'Active staff account required')
        return actor

    @app.get('/v1/admin/content/bu-notices')
    async def notices(request: Request, response: Response,
                      project: ProjectRef | None = None,
                      limit: int = Query(default=20, ge=1, le=100), actor: Actor = Depends(staff)):
        if set(request.query_params) - {'project', 'limit'}:
            raise failure(422, 'bu_notice_query', 'Unknown notice query')
        async with database(request, actor) as db:
            value = await db.fetchval('select hub.content_bu_notices($1,$2)', project, limit)
        response.headers['Cache-Control'] = 'private, no-store'
        return {'data': value}
