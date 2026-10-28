"""Image-only budget latch and audit boundaries on a disposable database."""
import asyncio
from uuid import uuid4
import asyncpg
import pytest
from test_permission_foundations import permission_accounts
from test_website_content import operator,project_fixture
from test_permission_content import call


def test_budget_exhausted_is_image_only_and_does_not_drain_other_queues(permission_accounts):
    _,ids=permission_accounts
    async def check():
        db=await operator();tx=db.transaction();await tx.start()
        try:
            project=await project_fixture(db,ids['editor'])
            values=[]
            for kind in ['image_suggestion','image_suggestion','clip_metadata']:
                values.append(await db.fetchval('''INSERT INTO hub.media_jobs(project_id,kind,subject_id,source_revision,requested_by)
                    VALUES($1,$2,$3,0,$4) RETURNING id''',project['id'],kind,uuid4(),ids['editor']))
            lease=uuid4()
            await db.execute("UPDATE hub.media_jobs SET status='running',lease_token=$2 WHERE id=$1",values[0],lease)
            translation_before=await db.fetchval('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,\'\')) FROM hub.translation_jobs t')
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db,ids['editor'],'SELECT hub.media_budget_exhausted($1,$2,$3)',values[0],lease,'insufficient_quota')
            for agent,code in [('knowledge',None),(None,'insufficient_quota')]:
                with pytest.raises(asyncpg.CheckViolationError):
                    await call(db,ids['editor'],'SELECT hub.provider_budget_event($1,$2)',agent,code)
            async with db.transaction():
                await db.execute('SET LOCAL ROLE hub_media_worker')
                assert await db.fetchval('SELECT hub.media_budget_exhausted($1,$2,$3)',values[0],lease,'insufficient_quota')=='budget_exhausted'
                assert await db.fetchval('SELECT hub.media_budget_blocked()') is True
                assert await db.fetchval('SELECT hub.media_claim()') is None
                assert await db.fetchval('SELECT hub.website_media_claim($1)',values[:2]) is None
            await db.execute('SET LOCAL ROLE postgres')
            statuses=await db.fetch('SELECT status FROM hub.media_jobs WHERE id=ANY($1) ORDER BY kind,id',values[:2])
            assert [r['status'] for r in statuses]==['budget_exhausted','budget_exhausted']
            assert await db.fetchval('SELECT status FROM hub.media_jobs WHERE id=$1',values[2])=='queued'
            assert translation_before==await db.fetchval('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,\'\')) FROM hub.translation_jobs t')
            with pytest.raises(asyncpg.CheckViolationError):
                async with db.transaction():
                    await db.execute("UPDATE hub.media_jobs SET status='budget_exhausted' WHERE id=$1",values[2])
            audit=await db.fetchval("SELECT after_row FROM audit.change_log WHERE table_name='hub.provider_budget' ORDER BY id DESC LIMIT 1")
            assert audit=={'agent':'media','code':'insufficient_quota','state':'budget_exhausted'}
            assert not await db.fetchval("SELECT pg_has_role('hub_runtime','hub_media_worker','SET')")
        finally:
            await tx.rollback();await db.close()
    asyncio.run(check())
