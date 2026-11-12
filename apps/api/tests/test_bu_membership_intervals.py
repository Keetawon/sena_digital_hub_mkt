"""Prepared W6 interval and content-preservation cases; disposable fixtures only."""
import asyncio
from copy import deepcopy
from datetime import timedelta

from test_bu_membership import NOW, accept, clock, database, fixture, utc_text
from test_content_workflow import approve_item
from test_permission_content import call
from test_permission_foundations import permission_accounts
from test_website_content import project_fixture


async def intervals(db, project='00001'):
    return [dict(row) for row in await db.fetch(
        'select * from hub.content_bu_membership_interval where project_id=$1 order by valid_from,id', project)]


def test_dated_membership_ignores_timestamp_only_refresh_but_records_exact_label_change(permission_accounts):
    async def check():
        async with database() as db:
            rows=fixture()['rows']
            first=await accept(db,rows)
            initial=await intervals(db)
            assert len(initial)==1 and initial[0]['rem_bu_id']==' BU A '
            assert initial[0]['valid_from']==NOW and initial[0]['valid_to'] is None
            assert str(initial[0]['opened_run_id'])==first['run_id']
            assert (await accept(db,rows))['status']=='UNCHANGED'
            assert await intervals(db)==initial
            moment=NOW+timedelta(hours=1)
            await clock(db,moment)
            rows=[dict(row,source_snapshot_at=utc_text(moment)) for row in rows]
            assert (await accept(db,rows))['status']=='ACCEPTED'
            assert await intervals(db)==initial
            moment+=timedelta(hours=1)
            await clock(db,moment)
            rows=[dict(row,source_snapshot_at=utc_text(moment)) for row in rows]
            rows[0]['rem_bu_name']=' Changed exact BU name '
            changed=await accept(db,rows)
            history=await intervals(db)
            assert len(history)==2
            assert history[0]['valid_to']==moment
            assert str(history[0]['closed_run_id'])==changed['run_id']
            assert history[1]['valid_from']==moment and history[1]['valid_to'] is None
            assert history[1]['rem_bu_name']==' Changed exact BU name '
            assert not await db.fetchval('select exists(select 1 from hub.content_bu_handover)')
            rejected=deepcopy(rows)
            rejected.append(rejected[0])
            assert (await accept(db,rejected))['failure_code']=='duplicate_project'
            assert await intervals(db)==history
    asyncio.run(check())


def test_dated_moves_null_and_missing_projects_preserve_separate_handover_deadlines(permission_accounts):
    async def check():
        async with database() as db:
            rows=fixture()['rows']
            await accept(db,rows)
            transitions=[('bu-b',True),('bu-c',True),(' BU A ',True),(None,True),(None,False),('bu-b',True)]
            expected=[' BU A ']
            for step,(bu,present) in enumerate(transitions,1):
                moment=NOW+timedelta(hours=step)
                await clock(db,moment)
                rows=[dict(row,source_snapshot_at=utc_text(moment)) for row in fixture()['rows']]
                rows[0]['rem_bu_id']=bu
                if not present:
                    rows=rows[1:]
                result=await accept(db,rows)
                assert result['status']=='ACCEPTED'
                if present:
                    expected.append(bu)
                history=await intervals(db)
                assert [row['rem_bu_id'] for row in history]==expected
                opened=[row for row in history if row['valid_to'] is None]
                assert len(opened)==int(present)
                for row in history[:-1]:
                    assert row['valid_to'] is not None and row['closed_run_id'] is not None
            handovers=await db.fetch('select rem_bu_id,started_at,closed_at from hub.content_bu_handover order by started_at')
            assert [(row['rem_bu_id'],row['started_at']) for row in handovers]==[
                (' BU A ',NOW+timedelta(hours=1)),('bu-b',NOW+timedelta(hours=2)),('bu-c',NOW+timedelta(hours=3))]
            assert all(row['closed_at']==NOW+timedelta(hours=4) for row in handovers)
            assert await db.fetchval('select count(*) from hub.content_bu_membership_interval where project_id=$1 and valid_to is null','00003')==1
    asyncio.run(check())


def test_bu_acceptance_and_interval_history_never_change_content_approval_or_staging(permission_accounts):
    _,ids=permission_accounts
    async def check():
        async with database() as db:
            project=await project_fixture(db,ids['editor'])
            identity={'id':str(project['id'])}
            approved=await approve_item(db,ids,'project',identity)
            assert approved['state']=='APPROVED'
            staging=await db.fetchval('select to_jsonb(r) from staging.rem_projects r where rem_project_id=$1',project['rem_project_id'])
            versions=await db.fetchval("select jsonb_agg(to_jsonb(v) order by id) from hub.content_review_versions v where kind='project' and identity=$1",identity)
            for step,bu in enumerate(('bu-a','bu-b',None)):
                moment=NOW+timedelta(hours=step)
                await clock(db,moment)
                rows=[dict(row,source_snapshot_at=utc_text(moment)) for row in fixture()['rows']]
                rows[0].update(project_id=project['rem_project_id'],rem_bu_id=bu)
                assert (await accept(db,rows))['status']=='ACCEPTED'
                after=await call(db,ids['editor'],'select hub.content_workflow_read($1,$2)','project',identity)
                assert after['state']=='APPROVED' and after['expected_hash']==approved['expected_hash']
                assert await db.fetchval('select to_jsonb(r) from staging.rem_projects r where rem_project_id=$1',project['rem_project_id'])==staging
                assert await db.fetchval("select jsonb_agg(to_jsonb(v) order by id) from hub.content_review_versions v where kind='project' and identity=$1",identity)==versions
            assert len(await intervals(db,project['rem_project_id']))==3
    asyncio.run(check())
