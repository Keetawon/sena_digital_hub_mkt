"""Writing admission uses current source/scope after real database lock waits."""
import asyncio
from contextlib import asynccontextmanager
from datetime import timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_content_scopes import NOW, batch, clock, codec, membership, selected
from test_permission_content import call
from test_permission_db_baseline import runtime
from test_permission_foundations import permission_accounts
from test_website_content import operator
from test_writing_aid import BEGIN, FINISH, enable_field, invoke, seed_source


BUDGET_LOCK = "select pg_advisory_xact_lock(hashtextextended('writing_monthly_budget',0))"


async def cancel_queries(tasks):
    for task in tasks:
        if not task.done():
            task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


@asynccontextmanager
async def admission_fixture(ids, worker_count=1):
    """Committed disposable fixtures are visible to real non-bypass workers."""
    setup = await operator()
    workers, requests, tasks = [], [], []
    settings = await setup.fetchrow('select monthly_cap_usd,request_ceiling_usd,blocked_month from hub.writing_ai_settings')
    enabled = await setup.fetchval("select ai_writing_enabled from hub.field_catalog where field_key='section.project_intro'")
    try:
        spent = await setup.fetchval("select coalesce(sum(charged_usd),0) from hub.writing_ai_requests where budget_month=date_trunc('month',current_timestamp at time zone 'Asia/Bangkok')::date")
        await setup.execute('update hub.writing_ai_settings set monthly_cap_usd=$1,request_ceiling_usd=0.01,blocked_month=null', spent + Decimal('1'))
        for _ in range(worker_count):
            db = await codec(await runtime())
            await db.execute("set statement_timeout='15s'")
            workers.append(db)
        yield setup, workers, requests, tasks
    finally:
        await cancel_queries(tasks)
        if setup.is_in_transaction():
            await setup.execute('rollback')
        for db in workers:
            await db.close()
        await enable_field(setup, ids['admin'], 'section.project_intro', enabled)
        await setup.execute('update hub.writing_ai_settings set monthly_cap_usd=$1,request_ceiling_usd=$2,blocked_month=$3', *settings.values())
        await setup.execute('delete from hub.writing_ai_requests where id=any($1::uuid[])', requests)
        await setup.close()


async def advisory_barrier(observer, task, waiter, holder, held_mode='ExclusiveLock'):
    """Prove the exact held advisory lock blocks this command; time is no proof."""
    async with asyncio.timeout(10):
        while True:
            if task.done():
                await task
                pytest.fail('The writing command completed before its required lock barrier')
            blocked = await observer.fetchval("""select $2::integer=any(pg_blocking_pids($1)) and exists(
                select 1 from pg_locks waiting join pg_locks held
                using(locktype,database,classid,objid,objsubid)
                where waiting.locktype='advisory' and waiting.pid=$1 and not waiting.granted
                and held.pid=$2 and held.granted and held.mode=$3)""",
                waiter.get_server_pid(), holder.get_server_pid(), held_mode)
            if blocked:
                return


async def content_fingerprint(db):
    return await db.fetchval("""select md5(jsonb_build_object(
        'sections',(select jsonb_agg(to_jsonb(s) order by id) from hub.content_sections s),
        'versions',(select jsonb_agg(to_jsonb(v) order by id) from hub.content_section_versions v),
        'translations',(select jsonb_agg(to_jsonb(t) order by id) from hub.content_translations t))::text)""")


@pytest.mark.parametrize('changed', ['source', 'context'])
def test_blocked_admission_revalidates_ordinary_source_or_context_edit(permission_accounts, changed):
    _, ids = permission_accounts

    async def check():
        async with admission_fixture(ids) as (setup, workers, requests, tasks):
            _, source = await seed_source(setup, ids['editor'], ids['admin'])
            _, neighbour = await seed_source(setup, ids['editor'])
            edited = source if changed == 'source' else neighbour
            context = [] if changed == 'source' else [{'translation_id': str(edited['id']), 'expected_revision': edited['revision']}]
            mode = 'proofread' if changed == 'source' else 'draft'
            request, allowed = uuid4(), uuid4()
            requests.extend([request, allowed])
            async with setup.transaction():
                await setup.execute(BUDGET_LOCK)
                waiting = asyncio.create_task(call(workers[0], ids['editor'], BEGIN,
                    source['id'], source['revision'], 'th', mode, request, context))
                tasks.append(waiting)
                await advisory_barrier(setup, waiting, workers[0], setup)
                revision = await setup.fetchval('select revision from hub.content_sections where id=$1', UUID(edited['owner_key']))
                await invoke(setup, ids['editor'], "select hub.save_content_section('project',$1,'section.project_intro',$2,$3)",
                    edited['scope_id'], revision, {'body': {'th': 'Updated 20 homes {project}', 'en': 'Updated 20 homes {project}'}})
                assert await setup.fetchval('select revision from hub.content_translations where id=$1', edited['id']) > edited['revision']
                content = await content_fingerprint(setup)
            with pytest.raises(asyncpg.SerializationError, match='Writing (source|context) changed'):
                await asyncio.wait_for(waiting, 10)
            assert not await setup.fetchval('select exists(select 1 from hub.writing_ai_requests where id=$1)', request)
            # An unchanged neighbour remains usable, with actor-owned replay and
            # the full conservative charge retained after a provider failure.
            unchanged = neighbour if changed == 'source' else source
            args = (unchanged['id'], unchanged['revision'], 'th', 'proofread', allowed, [])
            assert (await call(workers[0], ids['editor'], BEGIN, *args))['status'] == 'ready'
            assert (await call(workers[0], ids['editor'], FINISH, allowed, 'provider_error', 1))['status'] == 'failed'
            replay = await call(workers[0], ids['editor'], BEGIN, *args)
            assert replay['replayed'] and 'input_text' not in replay
            assert await setup.fetchval('select charged_usd from hub.writing_ai_requests where id=$1', allowed) == Decimal('0.01')
            assert await content_fingerprint(setup) == content
    asyncio.run(check())


def test_blocked_admission_rechecks_bud_deadline_without_maintenance(permission_accounts):
    _, ids = permission_accounts

    async def check():
        async with admission_fixture(ids) as (setup, workers, requests, tasks):
            project, source = await seed_source(setup, ids['editor'], ids['admin'])
            other_project, neighbour = await seed_source(setup, ids['editor'])
            previous_clock = await setup.fetchval("select pg_get_functiondef('hub.content_scope_now()'::regprocedure)")
            previous_state = await setup.fetchrow('select accepted_run_id,acceptance_epoch,authorization_epoch,deadlines_settled_at from hub.content_scope_state')
            request, allowed = uuid4(), uuid4()
            requests.extend([request, allowed])
            run = None
            try:
                await clock(setup, NOW)
                bu = 'WRITING_' + uuid4().hex
                run = await membership(setup, [(project['rem_project_id'], bu)])
                for level in ('view', 'edit'):
                    await selected(setup, ids['editor'], 'projects', level, [other_project['rem_project_id']], [bu])
                assert (await call(workers[0], ids['editor'], 'select hub.writing_aid_state($1)', source['id']))['editable']
                days = await setup.fetchval('select grace_days from hub.content_scope_settings')
                content = await content_fingerprint(setup)
                await setup.execute('begin')
                await setup.execute(BUDGET_LOCK)
                waiting = asyncio.create_task(call(workers[0], ids['editor'], BEGIN,
                    source['id'], source['revision'], 'th', 'proofread', request, []))
                tasks.append(waiting)
                await advisory_barrier(setup, waiting, workers[0], setup)
                # Only the trusted disposable clock advances. No maintenance,
                # grant change or membership refresh makes this denial happen.
                await clock(setup, NOW + timedelta(days=days))
                await setup.execute('commit')
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await asyncio.wait_for(waiting, 10)
                assert not await setup.fetchval('select exists(select 1 from hub.writing_ai_requests where id=$1)', request)
                assert (await call(workers[0], ids['editor'], BEGIN,
                    neighbour['id'], neighbour['revision'], 'th', 'proofread', allowed, []))['status'] == 'ready'
                assert (await call(workers[0], ids['editor'], FINISH, allowed, None, 1))['status'] == 'done'
                assert await content_fingerprint(setup) == content
            finally:
                await cancel_queries(tasks)
                if setup.is_in_transaction():
                    await setup.execute('rollback')
                await setup.execute(previous_clock)
                await setup.execute('update hub.content_scope_state set accepted_run_id=$1,acceptance_epoch=$2,authorization_epoch=$3,deadlines_settled_at=$4', *previous_state.values())
                if run is not None:
                    await setup.execute('delete from hub.content_bu_membership where run_id=$1', run)
                    await setup.execute('delete from hub.content_bu_run where id=$1', run)
    asyncio.run(check())


def test_finish_admission_and_account_confirmation_share_a_deadlock_free_lock_order(permission_accounts):
    _, ids = permission_accounts

    async def check():
        async with admission_fixture(ids, 3) as (setup, workers, requests, tasks):
            project, source = await seed_source(setup, ids['editor'], ids['admin'])
            finish_db, begin_db, account_db = workers
            running, admission, neighbour = uuid4(), uuid4(), uuid4()
            requests.extend([running, admission, neighbour])
            args = (source['id'], source['revision'], 'th', 'proofread')
            assert (await call(finish_db, ids['editor'], BEGIN, *args, running, []))['status'] == 'ready'
            change = batch(ids['viewer'], projects=[project['rem_project_id']])
            preview = await call(account_db, ids['admin'], 'select hub.preview_account_permissions($1)', change)
            content = await content_fingerprint(setup)
            await setup.execute('begin')
            await setup.execute(BUDGET_LOCK)
            finishing = asyncio.create_task(call(finish_db, ids['editor'], FINISH, running, 'budget_exhausted', 1))
            tasks.append(finishing)
            await advisory_barrier(setup, finishing, finish_db, setup)
            beginning = asyncio.create_task(call(begin_db, ids['editor'], BEGIN, *args, admission, []))
            tasks.append(beginning)
            await advisory_barrier(setup, beginning, begin_db, setup)
            confirming = asyncio.create_task(call(account_db, ids['admin'], 'select hub.apply_account_permissions($1,$2)', change, preview['digest']))
            tasks.append(confirming)
            await advisory_barrier(setup, confirming, account_db, begin_db, 'ShareLock')
            # With the old finish order it owns budget next, then waits behind
            # account's exclusive scope request while begin owns shared scope
            # and waits for finish's budget: an actual three-session cycle.
            await setup.execute('commit')
            finished, admitted, _ = await asyncio.wait_for(asyncio.gather(finishing, beginning, confirming), 10)
            assert finished['status'] == admitted['status'] == 'budget_exhausted'
            assert Decimal(str(finished['charged_usd'])) == Decimal('0.01') and admitted['charged_usd'] == 0
            assert await setup.fetchval("select project_ids from hub.account_content_scope where account_id=$1 and tab='projects' and level='view'", ids['viewer']) == [project['rem_project_id']]
            # Reset only the synthetic cap fault: ordinary unchanged editor
            # admission still works after the other account's confirmation.
            await setup.execute('update hub.writing_ai_settings set blocked_month=null')
            assert (await call(begin_db, ids['editor'], BEGIN, *args, neighbour, []))['status'] == 'ready'
            assert (await call(begin_db, ids['editor'], FINISH, neighbour, None, 1))['status'] == 'done'
            assert await content_fingerprint(setup) == content
    asyncio.run(check())
