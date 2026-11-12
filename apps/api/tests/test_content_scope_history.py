"""W6 invitation effects and notice cutoffs in the attested disposable database."""
import asyncio
from datetime import timedelta
import json
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_accounts import REQUEST
from test_bu_membership import NOW, accept, clock, database, rows_at, scope, timestamp
from test_permission_baseline import disposable_operator
from test_permission_content import call as runtime_call
from test_permission_db_baseline import runtime
from test_permission_foundations import permission_accounts


async def codec(db):
    await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
    return db


async def call(db, actor, query, *args):
    if not db.is_in_transaction():
        return await runtime_call(db, actor, query, *args)
    # SET LOCAL survives savepoint release. Restore only the fixture's original
    # context after the real hub_app command, keeping its writes for assertions.
    previous = await db.fetchrow("select current_user role,current_setting('app.actor_id',true) actor")
    try:
        return await runtime_call(db, actor, query, *args)
    finally:
        await db.execute("select set_config('role',$1,true),set_config('app.actor_id',$2,true)",
                         previous['role'], previous['actor'] or '')


@pytest.mark.parametrize('cutoff', ['stale_warning', 'stale_expired', 'handover'])
def test_notice_clock_is_read_after_a_real_waiting_scope_lock(permission_accounts, cutoff):
    _, ids = permission_accounts

    async def check():
        # Both connections use the existing attested operator/runtime helpers.
        # The sequence is a private fixture clock: setval is visible while the
        # runtime statement is blocked, without timing a sleep around midnight.
        db = await codec(await disposable_operator())
        reader = await codec(await runtime())
        sequence = 'scope_notice_clock_' + uuid4().hex
        original_clock = await db.fetchval("select pg_get_functiondef('hub.content_scope_now()'::regprocedure)")
        original_state = await db.fetchval('select to_jsonb(s) from hub.content_scope_state s')
        runs, waiting = [], None
        try:
            assert await db.fetchval('select grace_days from hub.content_scope_settings') == 7
            await clock(db, NOW)
            await scope(db, ids['viewer'], bus=[' BU A '])
            snapshots = [(NOW, rows_at())]
            if cutoff == 'handover':
                snapshots += [(NOW + timedelta(days=1), rows_at(NOW + timedelta(days=1), 'move')),
                              (NOW + timedelta(days=6), rows_at(NOW + timedelta(days=6), 'move'))]
            for moment, rows in snapshots:
                await clock(db, moment)
                result = await accept(db, rows)
                if result.get('run_id'):
                    runs.append(UUID(result['run_id']))
                assert result['status'] == 'ACCEPTED'
            days = {'stale_warning': 5, 'stale_expired': 7, 'handover': 8}[cutoff]
            boundary = NOW + timedelta(days=days)
            before = boundary - timedelta(microseconds=1)
            await db.execute(f'create sequence hub.{sequence} minvalue 0 maxvalue 1 start 0')
            await db.execute(
                'create or replace function hub.content_scope_now() returns timestamptz language sql volatile '
                'set search_path=pg_catalog,pg_temp as $$ select case when '
                f'(select last_value from hub.{sequence})=0 then timestamptz \'{before.isoformat()}\' '
                f'else timestamptz \'{boundary.isoformat()}\' end $$')
            assert await db.fetchval('select hub.content_scope_now()') == before
            await db.execute("select pg_advisory_lock(hashtextextended('hub-account-decisions',0))")
            waiting = asyncio.create_task(call(reader, ids['viewer'], 'select hub.content_bu_notices()'))
            for _ in range(200):
                blockers = await db.fetchval('select pg_blocking_pids($1)', reader.get_server_pid())
                if db.get_server_pid() in blockers:
                    break
                assert not waiting.done(), 'Notice must wait for the real scope lock'
                await asyncio.sleep(0.01)
            else:
                raise AssertionError('Notice did not reach the advisory-lock barrier')
            assert not waiting.done()
            await db.execute(f"select setval('hub.{sequence}',1,true)")
            assert await db.fetchval('select hub.content_scope_now()') == boundary
            await db.execute("select pg_advisory_unlock(hashtextextended('hub-account-decisions',0))")
            result = await asyncio.wait_for(waiting, 10)
            item = next(v for v in result['items'] if v['kind'] == cutoff)
            assert item['manager'] is False and item['href'] is None
            if cutoff == 'handover':
                assert item['expired'] is True
                assert timestamp(item['deadline']) == boundary
                assert timestamp(item['membership_deadline']) == NOW + timedelta(days=13)
            else:
                assert timestamp(item['deadline']) == NOW + timedelta(days=7)
            assert not result['has_more']
        finally:
            await db.execute("select pg_advisory_unlock(hashtextextended('hub-account-decisions',0))")
            if waiting is not None and not waiting.done():
                waiting.cancel()
            if waiting is not None:
                await asyncio.gather(waiting, return_exceptions=True)
            await reader.close()
            await db.execute(original_clock)
            await db.execute('''update hub.content_scope_state set
                (accepted_run_id,acceptance_epoch,authorization_epoch,deadlines_settled_at)=
                (select accepted_run_id,acceptance_epoch,authorization_epoch,deadlines_settled_at
                 from jsonb_populate_record(null::hub.content_scope_state,$1)) where singleton''', original_state)
            await db.execute('delete from hub.content_bu_handover where accepted_run_id=any($1::uuid[])', runs)
            await db.execute('delete from hub.content_bu_membership where run_id=any($1::uuid[])', runs)
            await db.execute('delete from hub.content_bu_membership_interval where opened_run_id=any($1::uuid[])', runs)
            await db.execute('''update hub.content_bu_membership_interval set valid_to=null,closed_run_id=null
                where closed_run_id=any($1::uuid[])''', runs)
            await db.execute('delete from hub.content_bu_run where id=any($1::uuid[])', runs)
            await db.execute(f'drop sequence if exists hub.{sequence}')
            await db.close()

    asyncio.run(check())


async def invited_account(db, manager):
    account = uuid4()
    address = str(account) + '@example.test'
    invitation = await call(db, manager, 'select hub.create_invite($1)', {
        'email': address, 'company_type': 'SENA', 'team': REQUEST['team'],
        'template': {'code': 'editor', 'version': 1},
    })
    assert invitation['permission_template'] == 'editor'
    await db.execute('''insert into hub.user_account(id,email,status,created_at)
        values($1,$2,'PENDING',clock_timestamp())''', account, address)
    await db.execute('create schema if not exists auth')
    await db.execute('''create table if not exists auth.users(
        id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz)''')
    await db.execute('''insert into auth.users(id,email,email_confirmed_at,created_at)
        values($1,$2,clock_timestamp(),clock_timestamp())''', account, address.upper())
    profile = {key: value for key, value in REQUEST.items() if key not in ('reason', 'requested_tasks')}
    return account, {**profile, 'invite_id': invitation['id']}


async def saved_scopes(db, account):
    return await db.fetchval('''select coalesce(jsonb_agg(to_jsonb(s) order by tab,level),'[]')
        from hub.account_content_scope s where account_id=$1''', account)


@pytest.mark.parametrize('unrestricted_view', [False, True])
def test_invitation_records_exact_gains_once_and_preserves_scopes(permission_accounts, unrestricted_view):
    _, ids = permission_accounts

    async def check():
        async with database() as db:
            await accept(db, rows_at())
            account, payload = await invited_account(db, ids['admin'])
            for tab in ('projects', 'brands', 'knowledge', 'promotions', 'releases'):
                for level in ('view', 'edit', 'approve'):
                    if unrestricted_view and (tab, level) == ('projects', 'view'):
                        continue
                    projects = {('projects', 'view'): ['00001', '00003'],
                                ('projects', 'edit'): ['00003'],
                                ('knowledge', 'view'): ['00002'],
                                ('knowledge', 'edit'): ['00002']}.get((tab, level), [])
                    await scope(db, account, tab=tab, level=level, projects=projects)
            prior_scopes = await saved_scopes(db, account)
            templates = await db.fetch('select * from hub.permission_template order by code,version')
            result = await call(db, account, 'select hub.accept_account_invite($1)', payload)
            assert result['status'] == 'ACTIVE' and result['hub_role'] == 'editor'
            assert result['can_manage_users'] is False
            assert await saved_scopes(db, account) == prior_scopes
            assert await db.fetch('select * from hub.permission_template order by code,version') == templates
            grants = await db.fetchval('select hub.permission_rows($1)', account)
            template = await db.fetchval(
                "select hub.normalise_permission_tabs(tabs) from hub.permission_template where code='editor' and version=1")
            assert {tab: sorted(bits) for tab, bits in grants.items()} == template
            projects = {r['project_id'] for r in await db.fetch('select * from hub.content_scope_project_references()')} if unrestricted_view else {'00001', '00003'}
            expected = {('projects', 'view', project) for project in projects} | {
                ('projects', 'edit', '00003'), ('knowledge', 'view', '00002'), ('knowledge', 'edit', '00002')}
            cursor, history = None, []
            size = 100 if unrestricted_view else 2
            while True:
                page = await call(db, ids['admin'], "select hub.content_scopes_read($1,'projects',null,'',null,1,$2,$3)", account, cursor, size)
                entries = page['effective_history']
                assert len(entries['items']) <= size
                history.extend(entries['items'])
                assert len(history) <= len(expected)
                cursor = entries['next_cursor']
                if cursor is None:
                    break
            assert len({item['id'] for item in history}) == len(history) == len(expected)
            assert {(item['tab'], item['level'], item['project_id']) for item in history} == expected
            assert all(item['account_id'] == str(account) and item['direction'] == 'gain'
                       and item['reason'] == 'account_status' and timestamp(item['effective_at']) == NOW
                       and timestamp(item['observed_at']) == NOW for item in history)
            assert await db.fetchval("select count(*) from hub.permission_event where account_id=$1 and action='INVITE_ACCEPT'", account) == 1
            assert await db.fetchval("select count(*) from hub.user_account_event where account_id=$1 and action='INVITE_ACCEPT'", account) == 1
            directory = await call(db, ids['admin'], 'select hub.account_directory()')
            assert not any(item['action'] == 'CONTENT_SCOPE_EFFECT' for item in directory['permission_events'])
            for actor in (account, ids['viewer'], ids['editor']):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, actor, 'select hub.content_scopes_read($1)', account)
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, account, 'select hub.accept_account_invite($1)', payload)
            assert await db.fetchval("select count(*) from hub.permission_event where account_id=$1 and action='CONTENT_SCOPE_EFFECT'", account) == len(history)

    asyncio.run(check())


@pytest.mark.parametrize('failure', ['unverified', 'wrong_actor', 'bad_profile', 'self_invite'])
def test_failed_invitation_has_no_access_effect_or_partial_activation(permission_accounts, failure):
    _, ids = permission_accounts

    async def check():
        async with database() as db:
            await accept(db, rows_at())
            account, payload = await invited_account(db, ids['admin'])
            await scope(db, account, projects=['00003'])
            actor = account
            error = asyncpg.CheckViolationError
            if failure == 'unverified':
                await db.execute('update auth.users set email_confirmed_at=null where id=$1', account)
            elif failure == 'wrong_actor':
                actor = ids['pending']
            elif failure == 'bad_profile':
                payload = {**payload, 'privacy_acknowledged': False}
            else:
                await db.execute('update hub.account_invite set created_by=$1 where id=$2', account, UUID(payload['invite_id']))
                error = asyncpg.InsufficientPrivilegeError
            prior_scopes = await saved_scopes(db, account)
            before = await db.fetchval("select count(*) from hub.permission_event where action='CONTENT_SCOPE_EFFECT'")
            with pytest.raises(error):
                await call(db, actor, 'select hub.accept_account_invite($1)', payload)
            assert await db.fetchval("select count(*) from hub.permission_event where action='CONTENT_SCOPE_EFFECT'") == before
            assert await saved_scopes(db, account) == prior_scopes
            assert await db.fetchval('select status from hub.user_account where id=$1', account) == 'PENDING'
            assert await db.fetchval('select status from hub.account_invite where id=$1', UUID(payload['invite_id'])) == 'INVITED'
            assert not await db.fetchval('select exists(select 1 from hub.account_permission where account_id=$1)', account)

    asyncio.run(check())


def test_invitation_wrapper_keeps_existing_acl_and_delegate_private(permission_accounts):
    async def check():
        async with database() as db:
            grantees = await db.fetchval("""select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text)
                from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                where p.oid='hub.accept_account_invite(jsonb)'::regprocedure
                and a.privilege_type='EXECUTE' and a.grantee<>p.proowner""")
            assert grantees == ['hub_app', 'viewer']
            assert not await db.fetchval("""select exists(select 1 from pg_proc p,
                lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                where p.oid='hub.accept_account_invite_before_scopes(jsonb)'::regprocedure
                and a.privilege_type='EXECUTE' and a.grantee<>p.proowner)""")

    asyncio.run(check())
