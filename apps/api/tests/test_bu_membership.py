"""Whole-snapshot BU import and dated access: fixtures only, no DW connection."""
import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from uuid import UUID

import asyncpg
import pytest

from sena_hub_api.bu_membership import (
    COLUMNS, SOURCE_SELECT, InvalidSnapshot, MembershipStore, read_source,
    refresh_membership, timestamp, utc_text, validate_snapshot,
)
from test_permission_baseline import disposable_operator
from test_permission_foundations import permission_accounts, h
from test_permission_content import call
from test_website_content import project_fixture

FIXTURES = Path(__file__).resolve().parents[3] / 'supabase/tests/fixtures/bu_membership'
NOW = datetime(2031, 1, 1, tzinfo=timezone.utc)


def fixture(name='valid'):
    return json.loads((FIXTURES / (name + '.json')).read_text(encoding='utf-8'))


def rows_at(stamp=NOW, name='valid'):
    return [dict(row, source_snapshot_at=utc_text(stamp)) for row in fixture(name)['rows']]


def test_exact_identity_and_nullable_evidence_do_not_infer_membership():
    rows = fixture()['rows']
    value = validate_snapshot(rows, now=NOW)
    assert value.rows[0]['project_id'] == '00001'
    assert value.rows[0]['rem_bu_id'] == ' BU A '
    assert value.rows[0]['rem_bu_code'] == ' Shared code '
    assert value.rows[0]['rem_bu_is_active'] is False
    assert value.rows[0]['rem_bu_is_deleted'] is True
    assert value.rows[0]['project_status_code'] == '3'
    assert value.rows[1]['rem_bu_is_active'] is None
    assert value.rows[2]['rem_bu_id'] is None
    assert value.digest == validate_snapshot(list(reversed(rows)), now=NOW).digest
    assert validate_snapshot(rows, now=NOW + timedelta(hours=48)).source_watermark == NOW
    changed = deepcopy(rows)
    changed[0]['rem_bu_code'] = 'Shared code'
    assert validate_snapshot(changed, now=NOW).digest != value.digest


INVALID_ROWS = [
    ('invalid_shape', lambda r: {}), ('empty', lambda r: []),
    ('invalid_shape', lambda r: [dict(r[0], invented=True)]),
    ('invalid_shape', lambda r: [{k: v for k, v in r[0].items() if k != 'rem_bu_is_active'}]),
    ('invalid_project', lambda r: [dict(r[0], project_id=None)]),
    ('invalid_project', lambda r: [dict(r[0], project_id=1)]),
    ('invalid_project', lambda r: [dict(r[0], project_id=' ')]),
    ('invalid_project', lambda r: [dict(r[0], project_id='\t')]),
    ('duplicate_project', lambda r: [r[0], r[0]]),
    ('invalid_bu', lambda r: [dict(r[0], rem_bu_id=' ')]),
    ('invalid_bu', lambda r: [dict(r[0], rem_bu_is_active=1)]),
    ('invalid_bu', lambda r: [dict(r[0], rem_bu_is_deleted='false')]),
    ('invalid_bu', lambda r: [dict(r[0], rem_bu_name=1)]),
    ('invalid_timestamp', lambda r: [dict(r[0], source_snapshot_at=None)]),
    ('invalid_timestamp', lambda r: [dict(r[0], source_snapshot_at='bad')]),
    ('invalid_timestamp', lambda r: [dict(r[0], source_snapshot_at='2031-01-01T00:00:00')]),
    ('future_snapshot', lambda r: [r[0], dict(r[1], source_snapshot_at=utc_text(NOW + timedelta(microseconds=1)))]),
    ('old_snapshot', lambda r: [r[0], dict(r[1], source_snapshot_at=utc_text(NOW - timedelta(hours=48, microseconds=1)))]),
]


@pytest.mark.parametrize('code,change', INVALID_ROWS)
def test_whole_snapshot_validation_has_finite_diagnostics(code, change):
    with pytest.raises(InvalidSnapshot) as error:
        validate_snapshot(change(fixture()['rows']), now=NOW)
    assert error.value.code == code
    assert str(error.value) == code


def test_historical_package_keeps_actual_source_times_and_unknown_flags():
    evidence = fixture()['historical']
    assert evidence['manifest_sha256'] == '6251c4663d85303caeb5bb7469d79bd00b022f64f470486afcf14db050955ed3'
    assert evidence['gold_projects_sha256'] == '46d44700de5f3f289adda71ffd4a167dd5564ef1e1556b263a9562a388547151'
    assert evidence['gold_projects_bytes'] == 1414248 and len(evidence['rows']) == evidence['row_count'] == 278
    times = [timestamp(row['source_snapshot_at']) for row in evidence['rows']]
    assert min(times) == timestamp('2026-10-03T18:06:28.930549+07:00')
    assert max(times) == timestamp('2026-10-03T18:07:51.923220+07:00')
    assert all(row['rem_bu_is_active'] is None and row['rem_bu_is_deleted'] is None for row in evidence['rows'])
    value = validate_snapshot(evidence['rows'], now=timestamp('2026-10-05T02:50:00.717680+00:00'))
    assert value.source_watermark == min(times)
    assert value.digest == 'f194cb1c1177522ac33db167f07e5e00f47da8b7d774bee7f300b2c346cc8332'
    with pytest.raises(InvalidSnapshot, match='old_snapshot'):
        validate_snapshot(evidence['rows'], now=timestamp('2026-11-05T00:00:00+00:00'))


def test_injected_source_uses_exact_eight_columns_one_readonly_transaction_and_verified_tls():
    events = []
    class Connection:
        @asynccontextmanager
        async def transaction(self, **options):
            assert options == {'readonly': True}
            events.append('begin')
            yield
            events.append('commit')
        async def fetch(self, query):
            assert query == SOURCE_SELECT == 'SELECT ' + ', '.join(COLUMNS) + ' FROM serving.hub_project_bu ORDER BY project_id'
            events.append('select')
            return fixture()['rows']
    @asynccontextmanager
    async def connect(**options):
        assert options == {'sslmode': 'verify-full'}
        events.append('connect')
        yield Connection()
        events.append('close')
    result = asyncio.run(read_source(connect))
    assert result == fixture()['rows'] and events == ['connect', 'begin', 'select', 'commit', 'close']


def test_stale_refresh_retry_always_recaptures_and_rereads_and_ambiguous_write_is_not_retried():
    events = []
    class Store:
        attempt = 0
        async def capture(self):
            self.attempt += 1
            events.append('capture')
            return {'accepted_run_id': None, 'acceptance_epoch': self.attempt}
        async def accept(self, rows, captured):
            events.append(('accept', rows[0]['rem_bu_id'], captured['acceptance_epoch']))
            return {'status': 'REJECTED', 'failure_code': 'stale_refresh', 'requires_reread': True} if self.attempt == 1 else {'status': 'ACCEPTED'}
        async def failed(self, captured):
            raise AssertionError('No source failure')
    async def reader():
        events.append('read')
        return [dict(fixture()['rows'][0], rem_bu_id=str(events.count('read')))]
    async def check():
        store = Store()
        assert (await refresh_membership(store, reader))['requires_reread']
        assert events == ['capture', 'read', ('accept', '1', 1)]
        assert (await refresh_membership(store, reader))['status'] == 'ACCEPTED'
        assert events == ['capture', 'read', ('accept', '1', 1), 'capture', 'read', ('accept', '2', 2)]
        async def ambiguous(*args):
            raise ConnectionError('synthetic ambiguous result')
        store.accept = ambiguous
        with pytest.raises(ConnectionError):
            await refresh_membership(store, reader)
        assert events.count('read') == 3
    asyncio.run(check())


def test_source_failure_records_only_finite_failure_and_never_retries():
    events = []
    class Store:
        async def capture(self):
            events.append('capture')
            return {'accepted_run_id': None, 'acceptance_epoch': 0}
        async def failed(self, captured):
            events.append(('failed', captured['acceptance_epoch']))
            return {'status': 'FAILED', 'failure_code': 'read_failed'}
    async def reader():
        events.append('read')
        raise RuntimeError('Private connection details must not escape')
    assert asyncio.run(refresh_membership(Store(), reader)) == {'status': 'FAILED', 'failure_code': 'read_failed'}
    assert events == ['capture', 'read', ('failed', 0)]


async def clock(db, stamp):
    # Operator-only disposable fixture, always reverted by the surrounding rollback.
    value = utc_text(timestamp(stamp))
    await db.execute("create or replace function hub.content_scope_now() returns timestamptz language sql volatile "
                     "set search_path=pg_catalog,pg_temp as $$ select timestamptz '" + value + "' $$")


@asynccontextmanager
async def database():
    db = await disposable_operator()
    await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
    tx = db.transaction()
    await tx.start()
    try:
        await clock(db, NOW)
        await db.execute('update hub.content_scope_state set deadlines_settled_at=null')
        yield db
    finally:
        await tx.rollback()
        await db.close()


async def capture(db):
    return await db.fetchval('select hub.content_bu_capture()')


async def accept(db, rows, captured=None):
    token = captured if captured is not None else await capture(db)
    return await db.fetchval('select hub.content_bu_accept($1,$2,$3)', rows,
                             UUID(token['accepted_run_id']) if token['accepted_run_id'] else None, token['acceptance_epoch'])


async def scope(db, account, *, bus=(), projects=(), tab='projects', level='view'):
    await db.execute("""insert into hub.account_content_scope(account_id,tab,level,bu_ids,project_ids)
        values($1,$2,$3,$4,$5) on conflict(account_id,tab,level) do update set bu_ids=excluded.bu_ids,project_ids=excluded.project_ids""", account, tab, level, list(bus), list(projects))


async def allowed(db, account, project='00001', level='view'):
    return await db.fetchval("select hub.content_account_project_allowed($1,'projects',$2,$3,hub.content_scope_now())", account, level, project)


async def evidence(db):
    return await db.fetchval("""select jsonb_build_object('state',(select to_jsonb(s)-'deadlines_settled_at' from hub.content_scope_state s),
        'members',(select coalesce(jsonb_agg(to_jsonb(m) order by run_id,project_id),'[]') from hub.content_bu_membership m),
        'handovers',(select coalesce(jsonb_agg(to_jsonb(h) order by id),'[]') from hub.content_bu_handover h))""")


@pytest.mark.parametrize('code,change', INVALID_ROWS)
def test_sql_rejects_entire_snapshot_without_replacing_last_good(permission_accounts, code, change):
    async def check():
        async with database() as db:
            initial = await accept(db, fixture()['rows'])
            assert initial['status'] == 'ACCEPTED'
            before = await evidence(db)
            result = await accept(db, change(fixture()['rows']))
            assert result['status'] == 'REJECTED' and result['failure_code'] == code
            assert await evidence(db) == before
            assert result['accepted_run_id'] == initial['run_id']
    asyncio.run(check())


def test_sql_digest_exact_boundary_noop_does_not_rejuvenate_last_good(permission_accounts):
    async def check():
        async with database() as db:
            rows = fixture()['rows']
            await clock(db, NOW + timedelta(hours=48))
            result = await accept(db, rows)
            assert result['status'] == 'ACCEPTED'
            digest = await db.fetchval('select digest from hub.content_bu_run where id=$1', UUID(result['run_id']))
            assert digest == validate_snapshot(rows, now=NOW + timedelta(hours=48)).digest
            run = await db.fetchrow('select * from hub.content_bu_run where id=$1', UUID(result['run_id']))
            before = await evidence(db)
            assert (await accept(db, list(reversed(rows))))['status'] == 'UNCHANGED'
            assert await evidence(db) == before
            assert await db.fetchrow('select * from hub.content_bu_run where id=$1', UUID(result['run_id'])) == run
            await clock(db, NOW + timedelta(hours=48, microseconds=1))
            assert (await accept(db, rows))['failure_code'] == 'old_snapshot'
            assert await evidence(db) == before
    asyncio.run(check())


def test_reverse_completion_and_equal_watermark_are_fenced_and_require_new_read(permission_accounts):
    async def check():
        async with database() as db:
            first = await capture(db)
            second = await capture(db)
            newer = fixture()['rows']
            newer[0]['rem_bu_id'] = 'new-value-same-watermark'
            completed = await accept(db, newer, second)
            before = await evidence(db)
            stale = await accept(db, fixture()['rows'], first)
            assert stale['failure_code'] == 'stale_refresh' and stale['requires_reread']
            assert await evidence(db) == before
            assert stale['accepted_run_id'] == completed['run_id']
            assert (await accept(db, newer, await capture(db)))['status'] == 'UNCHANGED'
            fresh = deepcopy(newer)
            fresh[0]['rem_bu_id'] = 'another-current-read'
            assert (await accept(db, fresh, await capture(db)))['status'] == 'ACCEPTED'
            assert (await capture(db))['acceptance_epoch'] == completed['acceptance_epoch'] + 1
    asyncio.run(check())


def test_moves_null_and_removal_keep_exact_dated_intervals_and_exceptions(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with database() as db:
            await scope(db, ids['viewer'], bus=[' BU A '])
            await scope(db, ids['editor'], bus=['bu-b'])
            await scope(db, ids['publisher'], projects=['00001', '00002'])
            await accept(db, fixture()['rows'])
            assert await allowed(db, ids['viewer']) and not await allowed(db, ids['editor'])
            await clock(db, NOW + timedelta(days=1))
            moved = await accept(db, fixture('move')['rows'])
            assert await allowed(db, ids['viewer']) and await allowed(db, ids['editor'])
            handover = await db.fetchrow("select * from hub.content_bu_handover where project_id='00001'")
            assert handover['rem_bu_id'] == ' BU A ' and handover['started_at'] == NOW + timedelta(days=1)
            assert (await accept(db, fixture('move')['rows']))['status'] == 'UNCHANGED'
            assert await db.fetchrow('select * from hub.content_bu_handover where id=$1', handover['id']) == handover
            # A -> B -> C -> A keeps each original dated interval; no code-based mapping.
            for offset, bu in [(2, 'bu-c'), (3, ' BU A ')]:
                await clock(db, NOW + timedelta(days=offset))
                rows = rows_at(NOW + timedelta(days=offset), 'move')
                rows[0]['rem_bu_id'] = bu
                await accept(db, rows)
            assert await db.fetchval("select count(*) from hub.content_bu_handover where project_id='00001'") == 3
            assert await db.fetchval('select started_at from hub.content_bu_handover where id=$1', handover['id']) == handover['started_at']
            # A -> NULL and removed 00002 close all old handovers immediately.
            await clock(db, NOW + timedelta(days=4))
            await accept(db, rows_at(NOW + timedelta(days=4), 'no-bu'))
            assert not await allowed(db, ids['viewer']) and not await allowed(db, ids['editor'])
            assert await allowed(db, ids['publisher']) and await allowed(db, ids['publisher'], '00002')
            assert not await db.fetchval("select exists(select 1 from hub.permission_event where account_id=$1 and action='CONTENT_SCOPE_EFFECT' and after_value->>'direction'='loss')", ids['publisher'])
            assert not await db.fetchval('select exists(select 1 from hub.content_bu_handover where closed_at is null)')
            assert moved['run_id'] != (await capture(db))['accepted_run_id']
    asyncio.run(check())


def test_day5_day7_fail_closed_without_tick_and_idempotent_effect_history(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with database() as db:
            await scope(db, ids['viewer'], bus=[' BU A '])
            await scope(db, ids['editor'], bus=[' BU A '], projects=['00001'])
            await accept(db, fixture()['rows'])
            await clock(db, NOW + timedelta(days=5))
            count = await db.fetchval('select count(*) from audit.change_log')
            notices = await call(db, ids['viewer'], 'select hub.content_bu_notices()')
            assert [x['kind'] for x in notices['items']] == ['stale_warning']
            assert timestamp(notices['items'][0]['deadline']) == NOW + timedelta(days=7)
            assert not (await call(db, ids['editor'], 'select hub.content_bu_notices()'))['items']
            assert await db.fetchval('select count(*) from audit.change_log') == count
            await clock(db, NOW + timedelta(days=7, microseconds=-1))
            assert await allowed(db, ids['viewer'])
            await clock(db, NOW + timedelta(days=7))
            assert not await allowed(db, ids['viewer'])
            assert await allowed(db, ids['editor']) and await allowed(db, ids['admin'])
            notices = await call(db, ids['viewer'], 'select hub.content_bu_notices()')
            assert [x['kind'] for x in notices['items']] == ['stale_expired']
            await clock(db, NOW + timedelta(days=9))
            await db.fetchval('select hub.content_bu_maintain()')
            effects = await db.fetch("""select after_value from hub.permission_event where account_id=$1
                and action='CONTENT_SCOPE_EFFECT' and after_value->>'reason'='membership_stale' """, ids['viewer'])
            assert len(effects) == 1
            value = effects[0]['after_value']
            assert value['direction'] == 'loss' and timestamp(value['effective_at']) == NOW + timedelta(days=7)
            assert timestamp(value['observed_at']) == NOW + timedelta(days=9)
            before = await db.fetchval("select count(*) from hub.permission_event where action='CONTENT_SCOPE_EFFECT'")
            await db.fetchval('select hub.content_bu_maintain()')
            assert await db.fetchval("select count(*) from hub.permission_event where action='CONTENT_SCOPE_EFFECT'") == before
            assert not await db.fetchval("""select exists(select 1 from hub.permission_event where account_id=$1
                and action='CONTENT_SCOPE_EFFECT' and after_value->>'reason'='membership_stale')""", ids['editor'])
            await accept(db, rows_at(NOW + timedelta(days=9)))
            assert await allowed(db, ids['viewer'])
    asyncio.run(check())


def test_handover_expires_once_with_fresh_current_membership_and_private_banner(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with database() as db:
            project = await project_fixture(db, ids['editor'])
            await scope(db, ids['viewer'], bus=[' BU A '])
            await scope(db, ids['viewer'], bus=[' BU A '], tab='knowledge')
            await scope(db, ids['publisher'], bus=['bu-b'])
            await scope(db, ids['second'], bus=[' BU A ', 'bu-b'])
            original = fixture()['rows']
            original[0]['project_id'] = project['rem_project_id']
            await accept(db, original)
            await clock(db, NOW + timedelta(days=1))
            moved = rows_at(NOW + timedelta(days=1), 'move')
            moved[0]['project_id'] = project['rem_project_id']
            await accept(db, moved)
            notice = await call(db, ids['viewer'], 'select hub.content_bu_notices($1)', project['public_project_id'])
            handover = next(x for x in notice['items'] if x['kind'] == 'handover')
            assert handover['project_ref'] == project['public_project_id'] and handover['tab'] == 'overview'
            assert timestamp(handover['deadline']) == NOW + timedelta(days=8)
            # Fresh evidence extends stale time, never the original move cutoff.
            await clock(db, NOW + timedelta(days=6))
            await accept(db, [dict(row, source_snapshot_at=utc_text(NOW + timedelta(days=6))) for row in moved])
            await clock(db, NOW + timedelta(days=8))
            assert not await allowed(db, ids['viewer'], project['rem_project_id'])
            assert await allowed(db, ids['publisher'], project['rem_project_id'])
            assert await allowed(db, ids['second'], project['rem_project_id'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.content_bu_notices($1)', project['public_project_id'])
            own = await call(db, ids['viewer'], 'select hub.content_bu_notices()')
            expired = next(x for x in own['items'] if x['kind'] == 'handover')
            assert expired['expired'] and expired['project_ref'] is None and expired['tab'] is None
            assert str(ids['publisher']) not in json.dumps(own)
            await db.fetchval('select hub.content_bu_maintain()')
            losses = await db.fetchval("""select count(*) from hub.permission_event where account_id=$1 and action='CONTENT_SCOPE_EFFECT'
                and after_value->>'reason'='handover_end' and after_value->>'direction'='loss' """, ids['viewer'])
            assert losses == 2  # Projects and Knowledge View each lose their own scope.
            assert not await db.fetchval("select exists(select 1 from hub.permission_event where account_id=$1 and action='CONTENT_SCOPE_EFFECT' and after_value->>'reason'='handover_end' and after_value->>'direction'='loss')", ids['second'])
    asyncio.run(check())


def test_expiry_is_settled_before_scope_changes_and_settings_do_not_replay_old_losses(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with database() as db:
            await scope(db, ids['viewer'], bus=[' BU A '])
            await accept(db, fixture()['rows'])
            await clock(db, NOW + timedelta(days=8))
            body = {'selection': {'kind': 'accounts', 'account_ids': [str(ids['viewer'])]},
                    'change': {'kind': 'content_scope', 'tab': 'projects', 'level': 'view',
                               'scope': {'mode': 'selected', 'bu_ids': [], 'project_ids': ['00001']}},
                    'note': 'Synthetic explicit exception after stale deadline'}
            preview = await call(db, ids['admin'], 'select hub.preview_account_permissions($1)', body)
            await call(db, ids['admin'], 'select hub.apply_account_permissions($1,$2)', body, preview['digest'])
            assert await allowed(db, ids['viewer'])
            history = await db.fetch("""select after_value from hub.permission_event where account_id=$1
                and action='CONTENT_SCOPE_EFFECT' order by created_at,id""", ids['viewer'])
            values = [r['after_value'] for r in history]
            assert any(v['reason'] == 'membership_stale' and v['direction'] == 'loss' and timestamp(v['effective_at']) == NOW + timedelta(days=7) for v in values)
            assert any(v['reason'] == 'scope_change' and v['direction'] == 'gain' and timestamp(v['effective_at']) == NOW + timedelta(days=8) for v in values)
            await db.fetchval('select hub.content_bu_maintain()')
            assert len(await db.fetch("select id from hub.permission_event where account_id=$1 and action='CONTENT_SCOPE_EFFECT'", ids['viewer'])) == len(values)
    asyncio.run(check())


def test_failure_notices_are_manager_only_and_helper_acl_cannot_import_or_set_clock(permission_accounts):
    client, ids = permission_accounts
    async def check():
        async with database() as db:
            await accept(db, fixture()['rows'])
            token = await capture(db)
            result = await db.fetchval("select hub.content_bu_reject($1,$2,'read_failed',0)",
                                       UUID(token['accepted_run_id']) if token['accepted_run_id'] else None, token['acceptance_epoch'])
            assert result['failure_code'] == 'read_failed'
            manager = await call(db, ids['admin'], 'select hub.content_bu_notices()')
            assert manager['items'][0]['kind'] == 'sync_failed' and manager['items'][0]['href'] == '/admin/accounts'
            assert not (await call(db, ids['viewer'], 'select hub.content_bu_notices()'))['items']
            for query in ('select hub.content_bu_capture()', 'select hub.content_bu_maintain()', 'select hub.content_scope_now()',
                          "select hub.content_bu_accept('[]',null,0)", "select hub.content_bu_reject(null,0,'read_failed',0)"):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['admin'], query)
            for who in ('pending', 'agency', 'service_consumer'):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids[who], 'select hub.content_bu_notices()')
    asyncio.run(check())
    assert client.get('/v1/admin/content/bu-notices?now=2031-01-01', headers=h('viewer')).status_code == 422
    for who in ('pending', 'agency', 'service_consumer'):
        assert client.get('/v1/admin/content/bu-notices', headers=h(who)).status_code in (401, 403)
    assert client.get('/v1/admin/content/bu-notices?limit=101', headers=h('viewer')).status_code == 422


def test_grace_setting_effects_and_deadline_catchup_do_not_invent_or_repeat_losses(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with database() as db:
            await scope(db, ids['viewer'], bus=[' BU A '])
            await accept(db, fixture()['rows'])
            await clock(db, NOW + timedelta(days=4))
            for days, expected in [(2, False), (7, True)]:
                cfg = await call(db, ids['admin'], 'select hub.content_scope_settings_read()')
                preview = await call(db, ids['admin'], 'select hub.content_scope_settings_preview($1,$2)', days, cfg['revision'])
                await call(db, ids['admin'], 'select hub.content_scope_settings_apply($1,$2,$3)', days, cfg['revision'], preview['digest'])
                assert await allowed(db, ids['viewer']) is expected
            await db.fetchval('select hub.content_bu_maintain()')
            values = await db.fetch("select after_value from hub.permission_event where account_id=$1 and action='CONTENT_SCOPE_EFFECT'", ids['viewer'])
            changes = [r['after_value'] for r in values if r['after_value']['reason'] == 'settings_change']
            assert sorted(r['direction'] for r in changes) == ['gain', 'loss']
            assert not any(r['after_value']['reason'] == 'membership_stale' for r in values)
            await clock(db, NOW + timedelta(days=7))
            await db.fetchval('select hub.content_bu_maintain()')
            assert not await allowed(db, ids['viewer'])
            assert await db.fetchval("select count(*) from hub.permission_event where account_id=$1 and action='CONTENT_SCOPE_EFFECT' and after_value->>'reason'='membership_stale'", ids['viewer']) == 1
    asyncio.run(check())


def test_notice_exact_source_authority_retains_knowledge_faq_and_hides_neighbour(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with database() as db:
            one = await project_fixture(db, ids['editor'])
            two = await project_fixture(db, ids['editor'])
            await db.execute("update hub.account_permission set can_view=false,can_edit=false,can_approve=false where account_id=$1 and tab='projects'", ids['viewer'])
            await scope(db, ids['viewer'], projects=[one['rem_project_id']], tab='knowledge')
            await call(db, ids['viewer'], 'select hub.content_bu_notices($1)', one['public_project_id'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.content_bu_notices($1)', two['public_project_id'])
            await db.execute("update hub.account_permission set can_view=false,can_edit=false,can_approve=false where account_id=$1 and tab='knowledge'", ids['viewer'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.content_bu_notices($1)', one['public_project_id'])
            assert not (await call(db, ids['viewer'], 'select hub.content_bu_notices()'))['items']
    asyncio.run(check())


def test_attribute_changes_and_unknown_ids_do_not_revoke_or_invent_effects(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with database() as db:
            await scope(db, ids['viewer'], bus=[' BU A '])
            first = await accept(db, fixture()['rows'])
            assert await allowed(db, ids['viewer'])
            before = await db.fetchval("select count(*) from hub.permission_event where action='CONTENT_SCOPE_EFFECT'")
            rows = fixture()['rows']
            rows[0].update(rem_bu_code='changed exact label', rem_bu_name='', rem_bu_is_active=None,
                           rem_bu_is_deleted=None, project_status_code='4')
            rows.append(dict(rows[2], project_id='unknown-leading-00004'))
            second = await accept(db, rows)
            assert second['status'] == 'ACCEPTED' and second['run_id'] != first['run_id']
            assert await allowed(db, ids['viewer'])
            assert await db.fetchval("select count(*) from hub.permission_event where action='CONTENT_SCOPE_EFFECT'") == before
            assert not await db.fetchval('select exists(select 1 from hub.content_bu_handover)')
            rows[0]['rem_bu_id'] = None  # Code/name remain present: never infer an assignment.
            await accept(db, rows)
            assert not await allowed(db, ids['viewer'])
    asyncio.run(check())


def test_move_audience_uses_exact_original_destination_and_project_banner_is_visible(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with database() as db:
            project = await project_fixture(db, ids['editor'])
            await scope(db, ids['viewer'], bus=['bu-c'])
            # Also scope Knowledge so it cannot silently provide unrelated page authority.
            await scope(db, ids['viewer'], bus=['bu-c'], tab='knowledge')
            rows = fixture()['rows']
            rows[0]['project_id'] = project['rem_project_id']
            await accept(db, rows)
            for offset, bu in [(1, 'bu-b'), (2, 'bu-c')]:
                await clock(db, NOW + timedelta(days=offset))
                rows = [dict(row, source_snapshot_at=utc_text(NOW + timedelta(days=offset))) for row in rows]
                rows[0]['rem_bu_id'] = bu
                await accept(db, rows)
            home = await call(db, ids['viewer'], 'select hub.content_bu_notices()')
            moves = [v for v in home['items'] if v['kind'] == 'handover']
            assert len(moves) == 1 and timestamp(moves[0]['started_at']) == NOW + timedelta(days=2)
            # An unrestricted authorized project reader sees the project handover banner,
            # without being subscribed to every unrelated move in their home list.
            assert not [v for v in (await call(db, ids['editor'], 'select hub.content_bu_notices()'))['items'] if v['kind'] == 'handover']
            page = await call(db, ids['editor'], 'select hub.content_bu_notices($1)', project['public_project_id'])
            assert len([v for v in page['items'] if v['kind'] == 'handover']) == 2
            for item in page['items']:
                assert not any(key in item for key in ('account_id', 'bu_ids', 'before_value', 'after_value', 'rem_bu_id'))
            limited = await call(db, ids['editor'], 'select hub.content_bu_notices($1,1)', project['public_project_id'])
            assert len(limited['items']) == 1 and limited['has_more']
    asyncio.run(check())


def test_operator_store_never_holds_hub_transaction_during_source_fetch_and_serializes_safely():
    events = []
    class Connection:
        inside = False
        def is_in_transaction(self):
            return self.inside
        async def fetchval(self, query, *args):
            events.append((query, args))
            if 'capture' in query:
                return json.dumps({'accepted_run_id': None, 'acceptance_epoch': 0})
            return {'status': 'ACCEPTED'}
    async def check():
        connection = Connection()
        store = MembershipStore(connection)
        token = await store.capture()
        rows = rows_at()
        rows[0]['source_snapshot_at'] = NOW
        await store.accept(rows, token)
        query, args = events[-1]
        assert '$1::text::jsonb' in query
        assert json.loads(args[0])[0]['source_snapshot_at'] == NOW.isoformat()
        assert args[1:] == (None, 0)
        await store.accept([{'bad': float('nan')}], token)
        assert 'content_bu_reject' in events[-1][0] and events[-1][1][-1] == 'invalid_shape'
        connection.inside = True
        before = len(events)
        with pytest.raises(RuntimeError, match='independent Hub transactions'):
            await store.capture()
        assert len(events) == before
    asyncio.run(check())


def test_mixed_row_watermark_not_acceptance_time_controls_stale_boundary(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with database() as db:
            await scope(db, ids['viewer'], bus=[' BU A '])
            rows = fixture()['rows']
            oldest = NOW - timedelta(hours=47)
            rows[1]['source_snapshot_at'] = utc_text(oldest)
            accepted = await accept(db, rows)
            assert timestamp(accepted['source_watermark']) == oldest
            deadline = oldest + timedelta(days=7)
            await clock(db, deadline - timedelta(microseconds=1))
            assert await allowed(db, ids['viewer'])
            await clock(db, deadline)
            assert not await allowed(db, ids['viewer'])
            notices = await call(db, ids['viewer'], 'select hub.content_bu_notices()')
            assert timestamp(notices['items'][0]['deadline']) == deadline
    asyncio.run(check())


def test_session_timezone_cannot_extend_stale_or_handover_deadline_or_change_fingerprint(permission_accounts):
    _, ids = permission_accounts
    async def check():
        for mode in ('stale', 'handover'):
            async with database() as db:
                await scope(db, ids['viewer'], bus=[' BU A '])
                source = timestamp('2031-10-30T12:00:00+00:00')
                await clock(db, source)
                await accept(db, rows_at(source))
                deadline = source + timedelta(days=7)
                if mode == 'handover':
                    moved_at = source + timedelta(days=1)
                    await clock(db, moved_at)
                    moved = rows_at(moved_at, 'move')
                    await accept(db, moved)
                    refreshed_at = source + timedelta(days=6)
                    await clock(db, refreshed_at)
                    await accept(db, [dict(row, source_snapshot_at=utc_text(refreshed_at)) for row in moved])
                    deadline = moved_at + timedelta(days=7)
                await clock(db, deadline - timedelta(microseconds=1))
                await db.execute("set local time zone 'UTC'")
                identity = await call(db, ids['viewer'], 'select hub.content_scope_identity()')
                await db.execute("set local time zone 'America/New_York'")
                assert await call(db, ids['viewer'], 'select hub.content_scope_identity()') == identity
                assert await allowed(db, ids['viewer'])
                await clock(db, deadline)
                assert not await allowed(db, ids['viewer'])
                notice = await call(db, ids['viewer'], 'select hub.content_bu_notices()')
                item = next(v for v in notice['items'] if v['kind'] == ('stale_expired' if mode == 'stale' else 'handover'))
                assert timestamp(item['deadline']) == deadline
    asyncio.run(check())


def test_settlement_only_cursor_preserves_confirmation_real_state_changes_still_invalidate(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with database() as db:
            await scope(db, ids['viewer'], bus=[' BU A '])
            await accept(db, fixture()['rows'])
            body = {'selection': {'kind': 'accounts', 'account_ids': [str(ids['viewer'])]},
                    'change': {'kind': 'content_scope', 'tab': 'projects', 'level': 'view',
                               'scope': {'mode': 'selected', 'bu_ids': [], 'project_ids': ['00001']}},
                    'note': 'Synthetic confirmation remains valid after maintenance-only settlement'}
            before = await call(db, ids['admin'], 'select hub.preview_account_permissions($1)', body)
            await clock(db, NOW + timedelta(hours=1))
            await db.fetchval('select hub.content_bu_maintain()')
            assert (await call(db, ids['admin'], 'select hub.preview_account_permissions($1)', body))['digest'] == before['digest']
            await call(db, ids['admin'], 'select hub.apply_account_permissions($1,$2)', body, before['digest'])
            body['change']['scope'] = {'mode': 'all', 'bu_ids': [], 'project_ids': []}
            for mutation in ('grant', 'membership', 'settings'):
                preview = await call(db, ids['admin'], 'select hub.preview_account_permissions($1)', body)
                if mutation == 'grant':
                    await db.execute("update hub.account_permission set can_edit=true where account_id=$1 and tab='projects'", ids['viewer'])
                elif mutation == 'membership':
                    await accept(db, rows_at(NOW + timedelta(hours=1)))
                else:
                    cfg = await call(db, ids['admin'], 'select hub.content_scope_settings_read()')
                    changed = await call(db, ids['admin'], 'select hub.content_scope_settings_preview($1,$2)', 6, cfg['revision'])
                    await call(db, ids['admin'], 'select hub.content_scope_settings_apply($1,$2,$3)', 6, cfg['revision'], changed['digest'])
                with pytest.raises(asyncpg.SerializationError):
                    await call(db, ids['admin'], 'select hub.apply_account_permissions($1,$2)', body, preview['digest'])
    asyncio.run(check())


def test_historical_rows_accept_only_at_historical_clock_in_real_importer(permission_accounts):
    async def check():
        async with database() as db:
            rows = fixture()['historical']['rows']
            await clock(db, timestamp('2026-10-05T02:50:00.717680+00:00'))
            accepted = await accept(db, rows)
            assert accepted['status'] == 'ACCEPTED' and accepted['row_count'] == 278
            assert timestamp(accepted['source_watermark']) == timestamp('2026-10-03T18:06:28.930549+07:00')
            assert await db.fetchval('select digest from hub.content_bu_run where id=$1', UUID(accepted['run_id'])) == 'f194cb1c1177522ac33db167f07e5e00f47da8b7d774bee7f300b2c346cc8332'
            before = await evidence(db)
            await clock(db, timestamp('2026-11-05T00:00:00+00:00'))
            rejected = await accept(db, rows)
            assert rejected['status'] == 'REJECTED' and rejected['failure_code'] == 'old_snapshot'
            assert await evidence(db) == before
    asyncio.run(check())


def test_rejected_49_hour_refresh_keeps_grace_and_manager_only_early_alert(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with database() as db:
            await scope(db, ids['viewer'], bus=[' BU A '])
            initial = await accept(db, fixture()['rows'])
            await clock(db, NOW + timedelta(hours=49))
            result = await accept(db, fixture()['rows'])
            assert result['failure_code'] == 'old_snapshot' and result['accepted_run_id'] == initial['run_id']
            assert await allowed(db, ids['viewer'])
            assert not (await call(db, ids['viewer'], 'select hub.content_bu_notices()'))['items']
            notices = await call(db, ids['admin'], 'select hub.content_bu_notices()')
            assert {v['kind'] for v in notices['items']} == {'sync_failed', 'stale_data'}
            assert all(v['href'] == '/admin/accounts' for v in notices['items'])
            cfg = await call(db, ids['admin'], 'select hub.content_scope_settings_read()')
            preview = await call(db, ids['admin'], 'select hub.content_scope_settings_preview($1,$2)', 1, cfg['revision'])
            await call(db, ids['admin'], 'select hub.content_scope_settings_apply($1,$2,$3)', 1, cfg['revision'], preview['digest'])
            assert not await allowed(db, ids['viewer'])
            expiry = (await call(db, ids['viewer'], 'select hub.content_bu_notices()'))['items'][0]
            assert expiry['kind'] == 'stale_expired' and timestamp(expiry['deadline']) == NOW + timedelta(days=1)
    asyncio.run(check())
