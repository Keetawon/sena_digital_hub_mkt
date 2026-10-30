"""Budget and broker boundaries on a disposable DB; no provider calls."""
import asyncio
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_permission_foundations import permission_accounts
from test_permission_content import call as actor_call
from test_project_media import upload
from test_website_content import operator, project_fixture


async def worker(db, sql, *args):
    try:
        async with db.transaction():
            await db.execute('SET LOCAL ROLE hub_media_worker')
            return await db.fetchval(sql, *args)
    finally:
        await db.execute('SET LOCAL ROLE postgres')


async def call(db, actor, sql, *args):
    try:
        return await actor_call(db, actor, sql, *args)
    finally:
        await db.execute('SET LOCAL ROLE postgres')


def test_image_budget_requests_lease_fetch_wait_and_charge(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await operator(); tx = db.transaction(); await tx.start()
        try:
            project = await project_fixture(db, ids['editor']); public = project['public_project_id']
            asset = await upload(db, ids['editor']); key = UUID(asset['id'])
            await call(db, ids['editor'], 'select hub.media_save_asset($1,$2,0,$3)', public, key,
                       {'media_category': 'exterior', 'ai_exposure': 'open', 'marketing_publication': True})
            request = "select hub.media_job_request($1,'image_suggestion',$2,1)"
            assert (await call(db, ids['editor'], request, public, key))['status'] == 'not_configured'
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], request, public, key)
            await db.execute('update hub.media_ai_settings set monthly_cap_usd=5; update hub.media_worker_status set provider_configured=true,worker_seen_at=clock_timestamp()')
            assert (await call(db, ids['editor'], request, public, key))['status'] == 'queued'
            assert (await call(db, ids['editor'], request, public, key))['status'] == 'queued'
            assert await db.fetchval('select count(*) from hub.media_jobs where subject_id=$1', key) == 1
            before = await db.fetchval("select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from hub.translation_jobs t")
            job = await worker(db, 'select hub.media_image_claim(null)')
            job_id, lease = UUID(job['id']), UUID(job['lease_token'])
            assert await db.fetchval('select attempts from hub.media_jobs where id=$1', job_id) == 0
            assert await call(db, ids['editor'], 'select hub.media_image_lease($1,$2)', job_id, lease)
            assert await call(db, ids['editor'], 'select hub.media_image_lease($1,$2)', job_id, uuid4()) is None
            assert await call(db, ids['editor'], 'select hub.media_image_lease($1,$2)', uuid4(), lease) is None
            for change in ["update hub.media_jobs set lease_expires=clock_timestamp()-interval '1 minute' where id=$1",
                           'update hub.assets set media_revision=media_revision+1 where id=$1',
                           "update hub.assets set media_category='legal_document' where id=$1"]:
                nested = db.transaction(); await nested.start()
                try:
                    await db.execute(change, job_id if 'media_jobs' in change else key)
                    assert await call(db, ids['editor'], 'select hub.media_image_lease($1,$2)', job_id, lease) is None
                finally: await nested.rollback()
            assert await worker(db, 'select hub.media_image_wait($1,$2)', job_id, lease) == 'queued'
            row = await db.fetchrow('select attempts,charged_usd,provider_attempted from hub.media_jobs where id=$1', job_id)
            assert row['attempts'] == 0 and row['charged_usd'] == 0 and not row['provider_attempted']
            await db.execute("update hub.media_jobs set available_after='-infinity' where id=$1", job_id)
            job = await worker(db, 'select hub.media_image_claim(null)'); lease = UUID(job['lease_token'])
            assert await worker(db, 'select hub.media_image_begin($1,$2)', job_id, lease)
            assert not await worker(db, 'select hub.media_image_begin($1,$2)', job_id, lease)
            assert await call(db, ids['editor'], 'select hub.media_image_lease($1,$2)', job_id, lease) is None
            usage = {'input_tokens': 100, 'cached_input_tokens': 10, 'output_tokens': 20}
            assert await worker(db, 'select hub.media_image_finish($1,$2,null,$3,$4,$5)', job_id, lease,
                                job['model'], 'provider_error', usage) == 'failed'
            assert await worker(db, 'select hub.media_image_claim(null)') is None
            row = await db.fetchrow('select provider_usage,charged_usd,attempts from hub.media_jobs where id=$1', job_id)
            assert row['provider_usage'] == usage and float(row['charged_usd']) == 0.000159 and row['attempts'] == 1
            # Failure never requeues itself. A new explicit staff action is a new job.
            assert (await call(db, ids['editor'], request, public, key))['status'] == 'queued'
            assert (await call(db, ids['editor'], request, public, key))['status'] == 'queued'
            assert await db.fetchval('select count(*) from hub.media_jobs where subject_id=$1', key) == 2
            assert await db.fetchval('select attempts from hub.media_jobs where id=$1', job_id) == 1
            assert before == await db.fetchval("select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from hub.translation_jobs t")
            assert not await db.fetchval("select exists(select 1 from audit.change_log where table_name='hub.media_jobs' and (after_row ? 'lease_token' or before_row ? 'lease_token'))")
            assert not await db.fetchval("select pg_has_role('hub_runtime','hub_media_worker','SET')")
        finally:
            await tx.rollback(); await db.close()
    asyncio.run(check())


def test_private_broker_has_no_http_route(permission_accounts):
    client, _ = permission_accounts
    assert not any('broker' in route.path for route in client.app.routes)
    assert client.get('/v1/admin/media/image-broker').status_code == 404


def test_budget_refusal_only_changes_waiting_images_and_runtime_cannot_claim(permission_accounts):
    _, ids = permission_accounts
    async def check():
        db = await operator(); tx = db.transaction(); await tx.start()
        try:
            project = await project_fixture(db, ids['editor'])
            keys = []
            for kind in ['image_suggestion', 'clip_metadata']:
                keys.append(await db.fetchval('insert into hub.media_jobs(project_id,kind,subject_id,source_revision,requested_by) values($1,$2,$3,0,$4) returning id',
                                              project['id'], kind, uuid4(), ids['editor']))
            await db.execute('update hub.media_ai_settings set monthly_cap_usd=0.01; update hub.media_worker_status set provider_configured=true,worker_seen_at=clock_timestamp()')
            assert await worker(db, 'select hub.media_image_claim(null)') is None
            assert await db.fetchval('select status from hub.media_jobs where id=$1', keys[0]) == 'budget_exhausted'
            assert await db.fetchval('select status from hub.media_jobs where id=$1', keys[1]) == 'queued'
            for sql in ['select hub.media_image_claim(null)', 'select hub.media_image_begin(null,null)', 'select hub.media_image_wait(null,null)',
                        'select hub.media_image_finish(null,null,null,null,null,null)', 'select hub.media_worker_heartbeat(true)']:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['editor'], sql)
        finally:
            await tx.rollback(); await db.close()
    asyncio.run(check())
