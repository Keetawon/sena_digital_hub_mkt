"""W6 exact content scopes; all database work uses the documented disposable harness."""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import json
from uuid import UUID, uuid4

import asyncpg
import pytest
from pydantic import ValidationError

from sena_hub_api.accounts import PermissionBatch
from sena_hub_api.content_scopes import ContentScopeSelection, ContentScopeSettingsPreview
from test_permission_baseline import disposable_operator, ROOT
from content_workflow_fixture import load_sql_fixture
from test_permission_db_baseline import runtime
from test_permission_content import call, set_bit
from test_permission_foundations import permission_accounts, h
from test_website_content import project_fixture
from test_content_workflow import inventory_brand_fixture, contact_body
from test_business_content import question, answer

TABS = ('projects', 'brands', 'knowledge', 'promotions', 'releases')
NOW = datetime(2031, 1, 8, 12, tzinfo=timezone.utc)


async def codec(db):
    await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
    return db


@asynccontextmanager
async def scope_database():
    db = await codec(await disposable_operator())
    transaction = db.transaction()
    await transaction.start()
    try:
        yield db
    finally:
        await transaction.rollback()
        await db.close()


async def selected(db, account, tab, level, projects=(), bus=()):
    await db.execute("""insert into hub.account_content_scope(account_id,tab,level,project_ids,bu_ids)
        values($1,$2,$3,$4,$5) on conflict(account_id,tab,level) do update set
        project_ids=excluded.project_ids,bu_ids=excluded.bu_ids,revision=hub.account_content_scope.revision+1""",
        account, tab, level, list(projects), list(bus))


async def clock(db, stamp=NOW):
    # Private disposable-only function replacement, rolled back with the fixture.
    assert isinstance(stamp, datetime) and stamp.tzinfo is not None
    await db.execute("create or replace function hub.content_scope_now() returns timestamptz language sql volatile "
        "set search_path=pg_catalog,pg_temp as $$ select timestamptz '" + stamp.isoformat() + "' $$")


async def membership(db, rows, watermark=NOW, accepted=NOW):
    run = uuid4()
    await db.execute("""insert into hub.content_bu_run(id,status,source_watermark,accepted_at,digest,row_count,captured_epoch)
        values($1,'ACCEPTED',$2,$3,$4,$5,0)""", run, watermark, accepted, uuid4().hex * 2, len(rows))
    for project, bu in rows:
        await db.execute("""insert into hub.content_bu_membership(run_id,project_id,rem_bu_id,rem_bu_code,rem_bu_name,
            rem_bu_is_active,rem_bu_is_deleted,source_snapshot_at,project_status_code) values($1,$2,$3,$4,$5,false,true,$6,'CLOSED')""",
            run, project, bu, None if bu is None else ' CODE ' + bu, None if bu is None else 'Name ' + bu, watermark)
    await db.execute('update hub.content_scope_state set accepted_run_id=$1,acceptance_epoch=acceptance_epoch+1,authorization_epoch=authorization_epoch+1', run)
    return run


async def visible(db, account, project):
    rows = await call(db, account, "select coalesce(jsonb_agg(public_project_id),'[]') from hub.projects where id=$1", project['id'])
    return project['public_project_id'] in rows



async def source_guard(db, actor, kind, ref, level):
    # Private canonical guard is deliberately not an app RPC. The owning test
    # session invokes it with a real account; app rows/detail probes stay above.
    async with db.transaction():
        await db.execute("select set_config('app.actor_id',$1,true)", str(actor))
        return await db.fetchval('select hub.content_scope_access($1,$2,$3)', kind, ref, level)


def batch(account, tab='projects', level='view', projects=(), bus=(), mode='selected'):
    return {'selection': {'kind': 'accounts', 'account_ids': [str(account)]},
            'change': {'kind': 'content_scope', 'tab': tab, 'level': level,
                       'scope': {'mode': mode, 'project_ids': list(projects), 'bu_ids': list(bus)}}, 'note': 'Synthetic scope confirmation'}


@pytest.mark.parametrize('entry', ['scope', 'readiness'])
@pytest.mark.parametrize('change', ['selected_empty', 'revoked', 'unchanged'])
def test_content_scope_reads_recheck_after_account_lock(permission_accounts, entry, change):
    from test_publication_authority_wait import wait_for_account_lock
    _, ids = permission_accounts

    async def check():
        db = await codec(await disposable_operator())
        reader = await codec(await disposable_operator())
        transaction, pending = None, None
        try:
            public_id = await db.fetchval('select public_project_id from hub.projects where deleted_at is null order by public_project_id limit 1')

            async def read(actor):
                # Invoke private guards as their owner with the real caller's
                # identity; no helper execution grant is added for this probe.
                async with reader.transaction():
                    await reader.execute("select set_config('app.actor_id',$1,true)", str(actor))
                    query = ("select hub.content_scope_access('project',$1,'view')" if entry == 'scope'
                             else 'select hub.workspace_project_readiness($1)')
                    return await reader.fetchval(query, public_id)

            assert await read(ids['viewer'])
            transaction = db.transaction()
            await transaction.start()
            await db.execute("select pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0))")
            pending = asyncio.create_task(read(ids['viewer']))
            await wait_for_account_lock(db, reader, pending)
            if change == 'selected_empty':
                await selected(db, ids['viewer'], 'projects', 'view')
            elif change == 'revoked':
                await set_bit(ids['viewer'], 'projects', connection=db, manager=ids['admin'], can_view=False)
            await transaction.commit()
            transaction = None
            if change == 'unchanged':
                assert await asyncio.wait_for(pending, timeout=10)
            else:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await asyncio.wait_for(pending, timeout=10)
            assert await read(ids['admin']), 'Unrestricted neighbour must retain access'
        finally:
            if transaction is not None:
                await transaction.rollback()
            if pending is not None and not pending.done():
                pending.cancel()
            if pending is not None:
                await asyncio.gather(pending, return_exceptions=True)
            await reader.close()
            await db.close()
    asyncio.run(check())


def test_generic_tasks_do_not_rescan_native_rows_for_each_item(permission_accounts):
    _, ids = permission_accounts

    async def check():
        async with scope_database() as db:
            project = await project_fixture(db, ids['editor'])
            await db.execute("set local track_functions='all'")

            async def native_calls():
                return await db.fetchval("select coalesce((select calls from pg_stat_xact_user_functions "
                                         "where funcid='hub.workspace_native_rows()'::regprocedure),0)")

            async def tasks():
                await db.execute("select set_config('app.actor_id',$1,true)", str(ids['publisher']))
                before = await native_calls()
                rows = await db.fetchval("select coalesce(jsonb_agg(task),'[]') from hub.workspace_content_tasks() task")
                return rows, await native_calls() - before

            _, baseline_calls = await tasks()
            assert baseline_calls >= 2, 'Both native projections must be observed by the transaction-local counters'
            targets = []
            for index in range(4):
                item = await call(db, ids['editor'], "select hub.save_content_contact('project',$1,null,0,$2)",
                                  project['public_project_id'], contact_body(f'02123456{index}'))
                targets.append(('contact', {'id': item['id']}))
            for index in range(2):
                item = await call(db, ids['editor'], 'select hub.save_selling_point($1,null,0,$2)',
                                  project['public_project_id'], {'title': {'th': f'Synthetic scan point {index}'},
                                                               'detail': {'th': 'Synthetic detail'}})
                targets.append(('selling_point', {'project_id': str(project['id']), 'point_key': item['point_key']}))
            for kind, identity in targets:
                snapshot = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', kind, identity)
                await call(db, ids['editor'], 'select hub.content_workflow_submit($1,$2,$3)', kind, identity, snapshot['expected_hash'])
            rows, with_generic_calls = await tasks()
            expected = {(kind, json.dumps(identity, sort_keys=True)) for kind, identity in targets}
            actual = {(row['kind'], json.dumps(row['identity'], sort_keys=True))
                      for row in rows if row['category'] == 'approval'}
            assert expected <= actual
            assert with_generic_calls == baseline_calls, 'Generic items must not add full native-row scans'
    asyncio.run(check())


@pytest.mark.parametrize('tab', ['projects', 'knowledge'])
def test_home_filters_check_authority_only_for_matching_projects(permission_accounts, tab):
    _, ids = permission_accounts

    async def check():
        async with scope_database() as db:
            brand = await inventory_brand_fixture(db, ids['editor'])
            project = await project_fixture(db, ids['editor'])
            await project_fixture(db, ids['editor'])
            await db.execute('update hub.projects set brand_id=$1 where id=$2', brand['id'], project['id'])
            await db.execute("SET LOCAL track_functions='all'")
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['viewer']))
            query = ('select hub.workspace_scope_matches($1,$2,$3,$4,$5)' if tab == 'projects' else
                     "select hub.workspace_scope_matches_tab($1,$2,$3,$4,$5,'knowledge')")

            async def matches(brand_ref, expected_calls):
                counter = """select coalesce(sum(calls),0) from pg_stat_xact_user_functions
                    where funcid='hub.content_project_allowed(text,text,text)'::regprocedure"""
                before = await db.fetchval(counter)
                result = await db.fetchval(query, 'project', project['public_project_id'], [], None, brand_ref)
                assert await db.fetchval(counter) - before == expected_calls
                return result

            assert not await matches('missing-' + uuid4().hex, 0)
            assert await matches(brand['public_brand_id'], 1)
            await selected(db, ids['viewer'], tab, 'view')
            assert not await matches(brand['public_brand_id'], 1)
            await selected(db, ids['viewer'], tab, 'view', [project['rem_project_id']])
            assert await matches(brand['public_brand_id'], 1)
    asyncio.run(check())


def test_faq_rules_skip_expensive_lookups_for_unrelated_brands(permission_accounts):
    _, ids = permission_accounts

    async def check():
        async with scope_database() as db:
            brand = await inventory_brand_fixture(db, ids['editor'])
            projects = [await project_fixture(db, ids['editor']) for _ in range(5)]
            await db.execute("SET LOCAL track_functions='all'")

            async def resolve(rule):
                counts = """select coalesce(jsonb_object_agg(funcname,calls),'{}')
                    from pg_stat_xact_user_functions
                    where funcid in ('hub.business_project_matches(text,text)'::regprocedure,
                                     'hub.faq_project_form(uuid)'::regprocedure)"""
                before = await db.fetchval(counts)
                result = await db.fetchval("select hub.faq_rule_projects($1,'business','residential')", rule)
                after = await db.fetchval(counts)
                return result, {key: after.get(key, 0) - before.get(key, 0)
                                for key in ('business_project_matches', 'faq_project_form')}

            rule = {'brand_ids': [brand['public_brand_id']], 'product_forms': ['house']}
            result, calls = await resolve(rule)
            assert result == [] and all(count == 0 for count in calls.values())
            await db.execute('update hub.projects set brand_id=$1 where id=$2', brand['id'], projects[0]['id'])
            result, calls = await resolve({'brand_ids': rule['brand_ids']})
            assert result == [projects[0]['rem_project_id']]
            assert calls == {'business_project_matches': 1, 'faq_project_form': 0}
            result, calls = await resolve(rule)
            assert result == [] and calls['faq_project_form'] == 1 and calls['business_project_matches'] <= 1
            await db.execute('delete from hub.brand_business where brand_id=$1', brand['id'])
            assert (await resolve({'brand_ids': rule['brand_ids']}))[0] == []
    asyncio.run(check())


def test_home_projection_with_many_saved_projects(permission_accounts):
    _, ids = permission_accounts

    async def check():
        async with scope_database() as db:
            brand = await inventory_brand_fixture(db, ids['editor'])
            projects = [await project_fixture(db, ids['editor']) for _ in range(300)]
            await db.execute('update hub.projects set brand_id=$1 where id=any($2::uuid[])',
                             brand['id'], [row['id'] for row in projects])
            before = await db.fetchval('select count(*) from audit.change_log')
            pages = []
            await db.execute("SET LOCAL track_functions='all'")
            for offset in (0, 275):
                detailed_before = await db.fetchval("""select coalesce(sum(calls),0)
                    from pg_stat_xact_user_functions where funcid='hub.workspace_project_readiness(text)'::regprocedure""")
                home = await asyncio.wait_for(call(db, ids['viewer'], 'select hub.workspace_home(null,$1,$2)',
                                                  brand['public_brand_id'], offset), timeout=15)
                detailed_after = await db.fetchval("""select coalesce(sum(calls),0)
                    from pg_stat_xact_user_functions where funcid='hub.workspace_project_readiness(text)'::regprocedure""")
                assert detailed_after - detailed_before == 25, 'Only the visible page needs detailed checklist contexts'
                assert home['project_total'] == len(projects)
                assert len(home['projects']) == 25
                assert all(row['brand']['ref'] == brand['public_brand_id'] and row['readiness']['items']
                           for row in home['projects'])
                pages.append(home)
            assert not {row['ref'] for row in pages[0]['projects']} & {row['ref'] for row in pages[1]['projects']}
            assert pages[0]['brands'] == pages[1]['brands']
            assert await db.fetchval('select count(*) from audit.change_log') == before
    asyncio.run(check())


def test_legacy_section_versions_keep_exact_applicability_without_rewriting_scope_ids(permission_accounts):
    _, ids = permission_accounts

    async def check():
        async with scope_database() as db:
            one = await project_fixture(db, ids['editor'])
            two = await project_fixture(db, ids['editor'])
            batch_id = uuid4().hex * 2
            await db.execute("insert into staging.knowledge_batches(manifest_sha256,manifest) values($1,'{}')", batch_id)
            sections = []
            for index, projects in enumerate(([one['rem_project_id']], [two['rem_project_id']],
                                               [one['rem_project_id'], two['rem_project_id']])):
                candidate = uuid4()
                await db.execute("""insert into staging.knowledge_candidates(id,batch_sha256,source_key,kind,project_ids,topic,source_ref,evidence)
                    values($1,$2,$3,'section',$4,'design','synthetic',$5)""",
                    candidate, batch_id, str(index), projects,
                    {'title': {'th': 'Synthetic legacy title'}, 'body': {'th': 'Synthetic legacy body'}})
                await call(db, ids['editor'], 'select hub.review_knowledge_candidate($1,0,$2,$3,$4,false,null,null)',
                           candidate, 'accepted', projects, 'Synthetic accepted legacy section')
                section = await db.fetchrow('select id,scope_id from hub.content_sections where candidate_id=$1', candidate)
                assert section['scope_id'] == projects[0], 'Legacy REM identity must remain unchanged'
                sections.append((section['id'], candidate, projects))
            await selected(db, ids['viewer'], 'projects', 'view', [one['rem_project_id']])
            section_ids = [row[0] for row in sections]
            for table, key in (('content_sections', 'id'), ('content_section_versions', 'section_id')):
                visible_ids = await call(db, ids['viewer'], f'select array_agg({key}) from hub.{table} where {key}=any($1::uuid[])', section_ids)
                assert visible_ids == [sections[0][0]], 'Raw shared rows must not expose an excluded project'
            await call(db, ids['editor'], 'select hub.review_knowledge_candidate($1,1,$2,$3,$4,false,null,null)',
                       sections[0][1], 'rejected', sections[0][2], 'Synthetic legacy withdrawal')
            assert await call(db, ids['viewer'], "select bool_and(state='WITHDRAWN') from hub.content_section_versions where section_id=$1", sections[0][0])
            assert await db.fetchval('select scope_id from hub.content_sections where id=$1', sections[0][0]) == one['rem_project_id']
    asyncio.run(check())


def test_retained_media_proof_has_no_history_cycle_and_keeps_owning_scope(permission_accounts):
    from test_publication_authority_wait import publication_fixture
    _, ids = permission_accounts

    async def check():
        async with scope_database() as db:
            fixture = await publication_fixture(db, db, ids, {})
            version = await db.fetchval('select published_version_id from hub.web_pages where id=$1', UUID(fixture['page']['id']))
            dependency = await db.fetchval("""select d from hub.entity_versions v cross join lateral hub.web_dependencies(v.payload) d
                where v.id=$1 and d->>'table'='assets' limit 1""", version)
            assert dependency
            async def retained(actor):
                async with db.transaction():
                    await db.execute("select set_config('app.actor_id',$1,true)", str(actor))
                    return await db.fetchval('select hub.publication_retained_media_source($1)', dependency)
            assert await retained(ids['viewer'])
            await selected(db, ids['viewer'], 'brands', 'view', [])
            assert not await retained(ids['viewer'])
            assert await retained(ids['admin']), 'An unrestricted neighbour keeps exact retained evidence'
    asyncio.run(check())


def test_scope_selection_preserves_exact_ids_and_rejects_implicit_broadening():
    value = ContentScopeSelection(mode='selected', bu_ids=['001', ' BU '], project_ids=['0001'])
    assert value.bu_ids == ['001', ' BU ']
    assert ContentScopeSelection(mode='selected').project_ids == []
    assert PermissionBatch.model_validate(batch(uuid4())).change.kind == 'content_scope'
    for body in ({'mode': 'all', 'bu_ids': ['1']}, {'mode': 'selected', 'project_ids': ['x', 'x']},
                 {'mode': 'selected', 'bu_ids': [' ']}, {'mode': 'selected', 'effective_at': '2031-01-01'},
                 {'mode': 'selected', 'project_ids': ['bad\nvalue']}):
        with pytest.raises(ValidationError):
            ContentScopeSelection.model_validate(body)


@pytest.mark.parametrize('days', [0, 8, True, '7'])
def test_scope_grace_dto_is_strict_and_bounded(days):
    with pytest.raises(ValidationError):
        ContentScopeSettingsPreview(grace_days=days, expected_revision=1)


def test_scope_missing_is_unrestricted_selected_empty_denies_and_base_permission_still_wins(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            one = await project_fixture(db, ids['editor'])
            two = await project_fixture(db, ids['editor'])
            assert await visible(db, ids['viewer'], one) and await visible(db, ids['viewer'], two)
            await selected(db, ids['viewer'], 'projects', 'view', [one['rem_project_id']])
            assert await visible(db, ids['viewer'], one) and not await visible(db, ids['viewer'], two)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.project_detail($1)', two['public_project_id'])
            assert await call(db, ids['viewer'], 'select hub.project_detail($1)', one['public_project_id'])
            await selected(db, ids['viewer'], 'projects', 'view')
            assert not await visible(db, ids['viewer'], one)
            await db.execute('delete from hub.account_content_scope where account_id=$1', ids['viewer'])
            await db.execute("update hub.account_permission set can_view=false,can_edit=false,can_approve=false where account_id=$1 and tab='projects'", ids['viewer'])
            assert not await visible(db, ids['viewer'], one)
    asyncio.run(check())


def test_scope_edit_and_approve_intersect_their_own_view_independently(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            one = await project_fixture(db, ids['editor'])
            two = await project_fixture(db, ids['editor'])
            await db.execute("update hub.account_permission set can_view=true,can_edit=true,can_approve=true where account_id=$1 and tab='projects'", ids['second'])
            await selected(db, ids['second'], 'projects', 'view', [one['rem_project_id']])
            await selected(db, ids['second'], 'projects', 'edit', [two['rem_project_id']])
            await selected(db, ids['second'], 'projects', 'approve', [one['rem_project_id']])
            for item, action, allowed in [(one, 'view', True), (one, 'edit', False), (one, 'approve', True), (two, 'edit', False), (two, 'approve', False)]:
                if allowed:
                    assert await source_guard(db, ids['second'], 'project', item['public_project_id'], action)
                else:
                    with pytest.raises(asyncpg.InsufficientPrivilegeError):
                        await source_guard(db, ids['second'], 'project', item['public_project_id'], action)
    asyncio.run(check())


def test_unrestricted_scope_never_overrides_inactive_external_or_disabled_permissions(permission_accounts):
    _, ids = permission_accounts

    async def check():
        async with scope_database() as db:
            project = await project_fixture(db, ids['editor'])
            for role in ('viewer', 'editor', 'publisher', 'admin'):
                assert await visible(db, ids[role], project)
            for role in ('agency', 'service_consumer', 'pending'):
                assert not await visible(db, ids[role], project)
            await db.execute("update hub.permission_catalog set rollout_state='DISABLED' where tab='projects'")
            assert not await visible(db, ids['admin'], project)
    asyncio.run(check())


def test_shared_brand_editor_any_approver_all_and_no_empty_set_approval(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            await db.execute("update hub.account_permission set can_approve=true where account_id=$1 and tab='brands'", ids['second'])
            brand = await inventory_brand_fixture(db, ids['editor'])
            one = await project_fixture(db, ids['editor'])
            two = await project_fixture(db, ids['editor'])
            await db.execute('update hub.projects set brand_id=$1 where id=any($2::uuid[])', brand['id'], [one['id'], two['id']])
            for action in ('view', 'edit', 'approve'):
                await selected(db, ids['second'], 'brands', action, [one['rem_project_id']])
            assert await source_guard(db, ids['second'], 'brand', brand['public_brand_id'], 'edit')
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await source_guard(db, ids['second'], 'brand', brand['public_brand_id'], 'approve')
            for action in ('view', 'approve'):
                await selected(db, ids['second'], 'brands', action, [one['rem_project_id'], two['rem_project_id']])
            assert await source_guard(db, ids['second'], 'brand', brand['public_brand_id'], 'approve')
            await db.execute('update hub.projects set brand_id=null where id=any($1::uuid[])', [one['id'], two['id']])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await source_guard(db, ids['second'], 'brand', brand['public_brand_id'], 'approve')
    asyncio.run(check())


def test_knowledge_only_faq_keeps_own_authority_and_hides_neighbor_applicability(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            one = await project_fixture(db, ids['editor'])
            two = await project_fixture(db, ids['editor'])
            key = await question(db, ids)
            faq, body = await answer(db, ids, key, 'corporate', 'sena', [one['rem_project_id'], two['rem_project_id']])
            await db.execute("update hub.account_permission set can_view=false,can_edit=false,can_approve=false where account_id=$1 and tab in ('projects','brands')", ids['editor'])
            for action in ('view', 'edit', 'approve'):
                await selected(db, ids['editor'], 'knowledge', action, [one['rem_project_id']])
            value = await call(db, ids['editor'], 'select hub.faq_read($1)', UUID(faq['id']))
            serialized = json.dumps(value)
            assert one['rem_project_id'] in serialized and two['rem_project_id'] not in serialized
            assert '"applicability_complete": false' in serialized
            scope = await call(db, ids['editor'], "select hub.workspace_page('project',$1)", one['public_project_id'])
            assert scope['faq_only'] is True
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], 'select hub.project_detail($1)', one['public_project_id'])
            changed = {**body, 'short_answer': {'th': 'Changed visible shared text'}, 'applies_to_project_ids': [one['rem_project_id']]}
            await call(db, ids['editor'], 'select hub.save_faq($1,$2,$3)', UUID(faq['id']), faq['revision'], changed)
            stored = await db.fetchval('select v.applies_to_project_ids from hub.faqs f join hub.faq_versions v on v.id=f.draft_version_id where f.id=$1', UUID(faq['id']))
            assert set(stored) == {one['rem_project_id'], two['rem_project_id']}
    asyncio.run(check())


def test_bu_exact_identity_flags_and_null_are_not_authority_inferences(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            await clock(db)
            one = await project_fixture(db, ids['editor'])
            two = await project_fixture(db, ids['editor'])
            await membership(db, [(one['rem_project_id'], '001'), (two['rem_project_id'], None)])
            await selected(db, ids['viewer'], 'projects', 'view', bus=['001'])
            assert await visible(db, ids['viewer'], one) and not await visible(db, ids['viewer'], two)
            await selected(db, ids['viewer'], 'projects', 'view', bus=['1'])
            assert not await visible(db, ids['viewer'], one)
            await selected(db, ids['viewer'], 'projects', 'view', projects=[two['rem_project_id']], bus=['001'])
            assert await visible(db, ids['viewer'], two)
    asyncio.run(check())


def test_bu_expiry_is_enforced_without_maintenance_and_does_not_expire_explicit_projects(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            one = await project_fixture(db, ids['editor'])
            two = await project_fixture(db, ids['editor'])
            await membership(db, [(one['rem_project_id'], 'A'), (two['rem_project_id'], 'A')], NOW - timedelta(days=7))
            await selected(db, ids['viewer'], 'projects', 'view', projects=[two['rem_project_id']], bus=['A'])
            await clock(db, NOW - timedelta(microseconds=1))
            assert await visible(db, ids['viewer'], one)
            before = await db.fetchval("select count(*) from hub.permission_event where action='CONTENT_SCOPE_EFFECT'")
            await clock(db)
            assert not await visible(db, ids['viewer'], one) and await visible(db, ids['viewer'], two)
            assert await db.fetchval("select count(*) from hub.permission_event where action='CONTENT_SCOPE_EFFECT'") == before
            await membership(db, [(one['rem_project_id'], 'A'), (two['rem_project_id'], 'A')])
            assert await visible(db, ids['viewer'], one)
    asyncio.run(check())


def test_handover_current_and_old_bu_paths_are_separate_from_staleness(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            await clock(db)
            one = await project_fixture(db, ids['editor'])
            run = await membership(db, [(one['rem_project_id'], 'B')])
            await db.execute('insert into hub.content_bu_handover(project_id,rem_bu_id,started_at,accepted_run_id) values($1,$2,$3,$4)', one['rem_project_id'], 'A', NOW - timedelta(days=6), run)
            await selected(db, ids['viewer'], 'projects', 'view', bus=['A'])
            await selected(db, ids['publisher'], 'projects', 'view', bus=['B'])
            assert await visible(db, ids['viewer'], one) and await visible(db, ids['publisher'], one)
            await clock(db, NOW + timedelta(days=1))
            assert not await visible(db, ids['viewer'], one) and await visible(db, ids['publisher'], one)
            await clock(db)
            await membership(db, [(one['rem_project_id'], None)])
            assert not await visible(db, ids['viewer'], one) and not await visible(db, ids['publisher'], one)
    asyncio.run(check())


def test_scope_preview_is_atomic_stale_and_does_not_change_base_grants(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            one = await project_fixture(db, ids['editor'])
            before = await db.fetchval('select jsonb_agg(to_jsonb(p) order by tab) from hub.account_permission p where account_id=$1', ids['viewer'])
            payload = batch(ids['viewer'], projects=[one['rem_project_id']])
            preview = await call(db, ids['admin'], 'select hub.preview_account_permissions($1)', payload)
            assert set(preview['targets'][0]['effects']) == {'view', 'edit', 'approve'}
            await db.execute('update hub.content_scope_state set acceptance_epoch=acceptance_epoch+1')
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['admin'], 'select hub.apply_account_permissions($1,$2)', payload, preview['digest'])
            assert not await db.fetchval('select exists(select 1 from hub.account_content_scope where account_id=$1)', ids['viewer'])
            fresh = await call(db, ids['admin'], 'select hub.preview_account_permissions($1)', payload)
            await call(db, ids['admin'], 'select hub.apply_account_permissions($1,$2)', payload, fresh['digest'])
            assert await visible(db, ids['viewer'], one)
            assert await db.fetchval('select jsonb_agg(to_jsonb(p) order by tab) from hub.account_permission p where account_id=$1', ids['viewer']) == before
    asyncio.run(check())


def test_view_preview_includes_dependent_edit_and_approve_losses(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            one = await project_fixture(db, ids['editor'])
            two = await project_fixture(db, ids['editor'])
            await db.execute("update hub.account_permission set can_approve=true where account_id=$1 and tab='projects'", ids['second'])
            payload = batch(ids['second'], projects=[one['rem_project_id']])
            value = await call(db, ids['admin'], 'select hub.preview_account_permissions($1)', payload)
            effects = value['targets'][0]['effects']
            for level in ('view', 'edit', 'approve'):
                assert two['rem_project_id'] in effects[level]['lost']
                assert one['rem_project_id'] not in effects[level]['lost']
    asyncio.run(check())


def test_scope_confirmation_expires_at_the_current_time_boundary(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            await clock(db)
            one = await project_fixture(db, ids['editor'])
            await membership(db, [(one['rem_project_id'], 'A')], NOW - timedelta(days=7) + timedelta(seconds=1))
            payload = batch(ids['viewer'], bus=['A'])
            preview = await call(db, ids['admin'], 'select hub.preview_account_permissions($1)', payload)
            await clock(db, NOW + timedelta(seconds=1))
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['admin'], 'select hub.apply_account_permissions($1,$2)', payload, preview['digest'])
    asyncio.run(check())


def test_scope_survives_ordinary_template_clear_and_regrant(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            one = await project_fixture(db, ids['editor'])
            await selected(db, ids['viewer'], 'projects', 'view', [one['rem_project_id']])
            for levels in ([], ['view']):
                stamp = await db.fetchval('select updated_at from hub.user_account where id=$1', ids['viewer'])
                await call(db, ids['admin'], 'select hub.configure_account_access($1,$2)', ids['viewer'],
                           {'updated_at': stamp.isoformat(), 'tabs': {'projects': levels}})
                assert await db.fetchval("select project_ids from hub.account_content_scope where account_id=$1 and tab='projects' and level='view'", ids['viewer']) == [one['rem_project_id']]
            assert await visible(db, ids['viewer'], one)
            clear = batch(ids['viewer'], mode='all')
            preview = await call(db, ids['admin'], 'select hub.preview_account_permissions($1)', clear)
            await call(db, ids['admin'], 'select hub.apply_account_permissions($1,$2)', clear, preview['digest'])
            assert not await db.fetchval('select exists(select 1 from hub.account_content_scope where account_id=$1)', ids['viewer'])
    asyncio.run(check())


def test_scope_settings_require_actual_admin_and_current_confirmation(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            await db.execute('update hub.user_account set can_manage_users=true where id=$1', ids['editor'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], 'select hub.content_scope_settings_read()')
            value = await call(db, ids['admin'], 'select hub.content_scope_settings_read()')
            preview = await call(db, ids['admin'], 'select hub.content_scope_settings_preview($1,$2)', 1, value['revision'])
            await db.execute('update hub.content_scope_state set authorization_epoch=authorization_epoch+1')
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['admin'], 'select hub.content_scope_settings_apply($1,$2,$3)', 1, value['revision'], preview['digest'])
            assert (await call(db, ids['admin'], 'select hub.content_scope_settings_read()')) == value
    asyncio.run(check())


def test_scope_history_is_bounded_typed_account_specific_and_absent_from_directory(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            one = await project_fixture(db, ids['editor'])
            for index in range(105):
                item = {'account_id': str(ids['viewer']), 'project_id': one['rem_project_id'], 'tab': 'projects', 'level': 'view'}
                stamp = NOW + timedelta(seconds=index)
                assert await db.fetchval('select hub.content_scope_record_effects($1,$2,$3,$4)', [], [item], 'membership_accept', stamp) == 1
                assert await db.fetchval('select hub.content_scope_record_effects($1,$2,$3,$4)', [], [item], 'membership_accept', stamp) == 0
            page = await call(db, ids['admin'], 'select hub.content_scopes_read($1)', ids['viewer'])
            history = page['effective_history']; seen = set()
            while True:
                assert len(history['items']) <= 50
                for item in history['items']:
                    assert item['account_id'] == str(ids['viewer']) and item['kind'] == 'content_scope_effect'
                    assert 'after_value' not in item and 'before_value' not in item
                    assert item['id'] not in seen; seen.add(item['id'])
                if not history['next_cursor']:
                    break
                page = await call(db, ids['admin'], 'select hub.content_scopes_read($1,$2,null,$3,null,100,$4,50)',
                                  ids['viewer'], 'projects', '', history['next_cursor'])
                history = page['effective_history']
            assert len(seen) == 105
            directory = await call(db, ids['admin'], 'select hub.account_directory()')
            assert not any(x.get('action') == 'CONTENT_SCOPE_EFFECT' for x in directory['permission_events'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.content_scopes_read($1)', ids['viewer'])
    asyncio.run(check())


def test_scope_reads_do_not_write_and_fingerprint_changes_on_expiry(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            await clock(db)
            one = await project_fixture(db, ids['editor'])
            await membership(db, [(one['rem_project_id'], 'A')], NOW - timedelta(days=7) + timedelta(seconds=1))
            await selected(db, ids['viewer'], 'projects', 'view', bus=['A'])
            before = await db.fetchval('select count(*) from audit.change_log')
            old = await call(db, ids['viewer'], 'select hub.content_scope_identity()')
            await call(db, ids['admin'], 'select hub.content_scopes_read($1)', ids['viewer'])
            await call(db, ids['viewer'], 'select hub.workspace_home()')
            assert await db.fetchval('select count(*) from audit.change_log') == before
            await clock(db, NOW + timedelta(seconds=1))
            new = await call(db, ids['viewer'], 'select hub.content_scope_identity()')
            assert new['fingerprint'] != old['fingerprint']
            assert set(new) == {'fingerprint', 'expires_at'}
    asyncio.run(check())


def test_scope_http_manager_reference_and_settings_boundaries(permission_accounts):
    client, ids = permission_accounts
    for role in ('viewer', 'editor', 'agency', 'service_consumer', 'pending'):
        assert client.get('/v1/admin/accounts/content-scopes', headers=h(role)).status_code == 403
    allowed = client.get('/v1/admin/accounts/content-scopes', headers=h('admin'), params={'account_id': str(ids['viewer'])})
    assert allowed.status_code == 200, allowed.text
    assert allowed.headers['cache-control'] == 'no-store'
    assert len(allowed.json()['data']['scopes']) == 15
    assert client.get('/v1/admin/accounts/content-scopes', headers=h('admin'), params={'history_limit': 50}).status_code == 422
    assert client.get('/v1/admin/accounts/content-scopes', headers=h('admin'), params={'limit': 101}).status_code == 422
    assert client.post('/v1/admin/accounts/content-scope-settings/preview', headers=h('admin'), json={'grace_days': 8, 'expected_revision': 1}).status_code == 422


async def concurrency_scenarios():
    """Called only by the guarded DB runner; uses real two-connection barriers."""
    setup = await codec(await disposable_operator())
    first = await codec(await runtime())
    second = await codec(await runtime())
    actors = {role: uuid4() for role in ('admin', 'editor')}
    async def begin(db, role):
        await db.execute('begin')
        await db.execute('set local role hub_app')
        await db.execute("select set_config('app.actor_id',$1,true)", str(actors[role]))
    async def blocked(pid):
        for _ in range(200):
            if await setup.fetchval("select wait_event_type='Lock' from pg_stat_activity where pid=$1", pid):
                return
            await asyncio.sleep(0.01)
        raise AssertionError('Expected real database lock barrier was not reached')
    try:
        for role, uid in actors.items():
            await setup.execute("insert into hub.user_account(id,email,status,hub_role) values($1,$2,'ACTIVE',$3)", uid, str(uid)+'@example.test', role)
        one = await project_fixture(setup, actors['editor'])
        two = await project_fixture(setup, actors['editor'])
        payload = batch(actors['editor'], projects=[one['rem_project_id']])
        preview = await call(second, actors['admin'], 'select hub.preview_account_permissions($1)', payload)
        await begin(first, 'editor')
        old = await first.fetchval('select hub.project_detail($1)', two['public_project_id'])
        await first.fetchval('select hub.patch_project($1,$2,$3)', two['id'], {'meta_title': {'th': 'Serialized draft'}}, two['updated_at'])
        await begin(second, 'admin')
        pending = asyncio.create_task(second.fetchval('select hub.apply_account_permissions($1,$2)', payload, preview['digest']))
        await blocked(second.get_server_pid())
        assert not pending.done()
        await first.execute('commit')
        await asyncio.wait_for(pending, 10)
        await second.execute('commit')
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await call(first, actors['editor'], 'select hub.project_detail($1)', two['public_project_id'])
        assert await call(first, actors['editor'], 'select hub.project_detail($1)', one['public_project_id'])
        # Reverse completion: a source read starting while a scope confirmation
        # owns the lock observes the new scope after the confirmation commits.
        payload = batch(actors['editor'])
        preview = await call(second, actors['admin'], 'select hub.preview_account_permissions($1)', payload)
        await begin(second, 'admin')
        await second.fetchval('select hub.apply_account_permissions($1,$2)', payload, preview['digest'])
        await begin(first, 'editor')
        waiting = asyncio.create_task(first.fetchval('select hub.project_detail($1)', one['public_project_id']))
        await blocked(first.get_server_pid())
        await second.execute('commit')
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await asyncio.wait_for(waiting, 10)
        await first.execute('rollback')
        assert await setup.fetchval('select count(*) from hub.account_content_scope where account_id=$1', actors['editor']) == 1
    finally:
        await first.execute('rollback')
        await second.execute('rollback')
        await setup.execute('delete from hub.user_account where id=any($1::uuid[])', list(actors.values()))
        await first.close(); await second.close(); await setup.close()


def test_scope_preview_digest_is_independent_of_cached_plan(permission_accounts):
    _, ids = permission_accounts

    async def check():
        async with scope_database() as db:
            projects = [await project_fixture(db, ids['editor']) for _ in range(30)]
            for payload in (batch(ids['editor'], projects=[projects[0]['rem_project_id']]),
                            batch(ids['editor'], mode='all')):
                previews = []
                for mode in ('force_custom_plan', 'force_generic_plan'):
                    await db.execute("select set_config('plan_cache_mode',$1,true)", mode)
                    previews.append(await call(db, ids['admin'], 'select hub.preview_account_permissions($1)', payload))
                assert previews[0] == previews[1], 'Query planning must not invalidate identical reviewed scope effects'
                result = await call(db, ids['admin'], 'select hub.apply_account_permissions($1,$2)', payload, previews[0]['digest'])
                assert result['changed_count'] == 1
    asyncio.run(check())


def test_workflow_inventory_and_old_hash_recheck_current_scope_without_touching_draft(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            one = await project_fixture(db, ids['editor'])
            two = await project_fixture(db, ids['editor'])
            contact = await call(db, ids['editor'], "select hub.save_content_contact('project',$1,null,0,$2)", two['public_project_id'], contact_body())
            identity = {'id': contact['id']}
            value = await call(db, ids['editor'], "select hub.content_workflow_read('contact',$1)", identity)
            before = await db.fetchval('select to_jsonb(c) from hub.contacts c where id=$1', UUID(contact['id']))
            await selected(db, ids['editor'], 'projects', 'view', [one['rem_project_id']])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], "select hub.content_workflow_submit('contact',$1,$2)", identity, value['expected_hash'])
            faq_only = await call(db, ids['editor'], "select hub.content_workflow_items('project',$1)", two['public_project_id'])
            assert all(item['kind'] == 'faq' for item in faq_only['items'])
            await selected(db, ids['editor'], 'knowledge', 'view', [one['rem_project_id']])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], "select hub.content_workflow_items('project',$1)", two['public_project_id'])
            assert await db.fetchval('select to_jsonb(c) from hub.contacts c where id=$1', UUID(contact['id'])) == before
            assert await call(db, ids['editor'], "select hub.content_workflow_items('project',$1)", one['public_project_id'])
    asyncio.run(check())


def test_assistant_scope_fingerprint_and_promotion_reference_use_current_object(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            one = await project_fixture(db, ids['editor'])
            two = await project_fixture(db, ids['editor'])
            old = await call(db, ids['viewer'], 'select internal.assistant_access()')
            await selected(db, ids['viewer'], 'promotions', 'view', [one['rem_project_id']])
            new = await call(db, ids['viewer'], 'select internal.assistant_access()')
            assert old['fingerprint'] != new['fingerprint']
            assert 'project_ids' not in json.dumps(new) and 'bu_ids' not in json.dumps(new)
            assert await call(db, ids['viewer'], 'select internal.assistant_project_reference($1)', one['public_project_id']) == one['id']
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select internal.assistant_project_reference($1)', two['public_project_id'])
            await load_sql_fixture(db, ids['admin'])
            fixture = (ROOT / 'supabase/tests/residential_demo.sql').read_text(encoding='utf-8').split('-- Every new table')[0]
            await db.execute(fixture.replace('begin;', '', 1))
            for kind, table in (('project', 'projects'), ('brand', 'brands')):
                owner = await db.fetchrow(f'''select public_{kind}_id ref,published_version_id version
                    from hub.{table} where id=current_setting('test.residential_{kind}')::uuid''')
                assert owner['version'] is not None
                result = await call(db, ids['viewer'], 'select internal.assistant_content_version($1,$2,$3)',
                                    kind, owner['ref'], owner['version'])
                assert result is not None
                await selected(db, ids['viewer'], kind + 's', 'view', [one['rem_project_id']])
                assert await call(db, ids['viewer'], 'select internal.assistant_content_version($1,$2,$3)',
                                  kind, owner['ref'], owner['version']) is None
                assert await call(db, ids['second'], 'select internal.assistant_content_version($1,$2,$3)',
                                  kind, owner['ref'], owner['version']) is not None
    asyncio.run(check())


def test_rule_preview_filters_before_returning_project_ids_and_counts(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            one = await project_fixture(db, ids['editor'])
            two = await project_fixture(db, ids['editor'])
            brand = await inventory_brand_fixture(db, ids['editor'])
            await db.execute('update hub.projects set brand_id=$1 where id=any($2::uuid[])', brand['id'], [one['id'], two['id']])
            await selected(db, ids['editor'], 'projects', 'view', [one['rem_project_id']])
            await selected(db, ids['editor'], 'knowledge', 'view', [one['rem_project_id']])
            value = await call(db, ids['editor'], "select hub.faq_applicability_preview($1,'corporate','sena')", {'brand_ids': [brand['public_brand_id']]})
            assert two['rem_project_id'] not in json.dumps(value)
            assert value['project_ids'] == [one['rem_project_id']]
            assert value['affected_count_complete'] is False
    asyncio.run(check())


def test_exclusive_mutation_settles_elapsed_deadlines_before_scope_changes(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            one = await project_fixture(db, ids['editor'])
            await selected(db, ids['viewer'], 'projects', 'view', [one['rem_project_id']])
            await db.execute('create temporary table scope_settle_probe(project_ids text[]) on commit drop')
            await db.execute("""create or replace function hub.content_scope_settle_deadlines() returns void
                language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$ begin
                insert into pg_temp.scope_settle_probe select project_ids from hub.account_content_scope
                where account_id='""" + str(ids['viewer']) + """'::uuid and tab='projects' and level='view';end $$""")
            payload = batch(ids['viewer'])
            preview = await call(db, ids['admin'], 'select hub.preview_account_permissions($1)', payload)
            assert await db.fetchval('select count(*) from scope_settle_probe') == 0
            await call(db, ids['admin'], 'select hub.apply_account_permissions($1,$2)', payload, preview['digest'])
            observed = await db.fetch('select project_ids from scope_settle_probe')
            assert observed and all(row['project_ids'] == [one['rem_project_id']] for row in observed)
    asyncio.run(check())


async def translation_worker(db, query, *args):
    async with db.transaction():
        previous_role, previous_actor = await db.fetchrow("select current_setting('role'),current_setting('app.actor_id',true)")
        await db.execute('set local role hub_translation_worker')
        await db.execute("select set_config('app.actor_id','',true)")
        value = await db.fetchval(query, *args)
        await db.execute("select set_config('role',$1,true),set_config('app.actor_id',$2,true)", previous_role, previous_actor or '')
        return value


def test_translation_worker_rechecks_scope_at_claim_and_finish_without_provider(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            one = await project_fixture(db, ids['editor'])
            two = await project_fixture(db, ids['editor'])
            translations = []
            for project in (one, two, one):
                key = 'scope_' + uuid4().hex
                await call(db, ids['editor'], 'select hub.save_project_building($1,$2,0,$3)',
                           project['public_project_id'], key, {'name': {'th': 'Synthetic building'}, 'floors_above': 3, 'unit_count': 12})
                translations.append(await db.fetchrow("select id,th_text from hub.content_translations where owner_type='building' and row_ref->>'building_key'=$1", key))
            await selected(db, ids['editor'], 'projects', 'view', [one['rem_project_id']])
            assert await call(db, ids['editor'], "select hub.content_translation_list('projects',$1)", two['public_project_id']) == []
            denied = await translation_worker(db, 'select hub.claim_translation($1)', translations[1]['id'])
            assert denied is None
            assert await db.fetchval("select error_code from hub.translation_jobs where translation_id=$1", translations[1]['id']) == 'permission_revoked'
            allowed = await translation_worker(db, 'select hub.claim_translation($1)', translations[0]['id'])
            assert allowed['text'] == translations[0]['th_text']
            assert await translation_worker(db, 'select hub.finish_translation($1,$2,$3,$4,null)',
                UUID(allowed['id']), UUID(allowed['lease_token']), translations[0]['th_text'], 'stub-test') == 'done'
            pending = await translation_worker(db, 'select hub.claim_translation($1)', translations[2]['id'])
            await selected(db, ids['editor'], 'projects', 'view', [two['rem_project_id']])
            assert await translation_worker(db, 'select hub.finish_translation($1,$2,$3,$4,null)',
                UUID(pending['id']), UUID(pending['lease_token']), translations[2]['th_text'], 'stub-test') == 'failed'
            assert await db.fetchval("select error_code from hub.translation_jobs where id=$1", UUID(pending['id'])) == 'permission_revoked'
            assert await db.fetchval('select machine_en from hub.content_translations where id=$1', translations[2]['id']) is None
    asyncio.run(check())


def test_article_history_keeps_current_and_historical_authority_without_editor_payload(permission_accounts):
    from test_articles import content, paragraph, read, review_english
    _, ids = permission_accounts

    async def check():
        async with scope_database() as db:
            one, two = [await project_fixture(db, ids['editor']) for _ in range(2)]

            def body(project):
                return content(blocks={'type': 'doc', 'content': [paragraph(),
                    {'type': 'projectCard', 'attrs': {'project_id': project['public_project_id']}}]},
                    links=[{'kind': 'project', 'ref': project['public_project_id']}])

            article = await call(db, ids['editor'], 'select hub.article_save(null,0,$1)', body(one))
            article_id = UUID(article['id'])
            events = await db.fetch("""select distinct on (table_name) table_name,id from audit.change_log
                where table_name in ('hub.articles','hub.article_versions','hub.article_links','hub.content_translations')
                and (after_row->>'id'=$1 or after_row->>'article_id'=$1 or after_row#>>'{row_ref,article_id}'=$1)
                order by table_name,id""", str(article_id))
            assert {row['table_name'] for row in events} == {
                'hub.articles', 'hub.article_versions', 'hub.article_links', 'hub.content_translations'}

            async def event(row, actor=ids['viewer']):
                return await call(db, actor, "select hub.content_history_event('corporate','sena',$1)", row['id'])

            await db.execute("set local track_functions='all'")
            count_sql = """select coalesce(sum(calls),0) from pg_stat_xact_user_functions
                where funcid in ('hub.article_read(uuid)'::regprocedure,'hub.article_read_before_scopes(uuid)'::regprocedure)"""
            calls_before = await db.fetchval(count_sql)
            audit_before = await db.fetchval('select count(*) from audit.change_log')
            baseline = [await event(row) for row in events]
            assert all(value['entity']['kind'] == 'corporate' and value['diff_available'] for value in baseline)
            assert await db.fetchval(count_sql) == calls_before, 'History must not build discarded article editor payloads'
            assert await db.fetchval('select count(*) from audit.change_log') == audit_before

            reviewed = await review_english(db, ids, str(article_id))
            await call(db, ids['editor'], 'select hub.article_submit($1,$2)', article_id, reviewed['revision'])
            submitted = await read(db, ids, str(article_id))
            await call(db, ids['publisher'], "select hub.article_review($1,$2,'approve')", article_id, submitted['revision'])
            approved = await read(db, ids, str(article_id))
            await call(db, ids['editor'], 'select hub.article_save($1,$2,$3)', article_id, approved['revision'], body(two))
            old_version = next(row for row in events if row['table_name'] == 'hub.article_versions')

            await selected(db, ids['viewer'], 'knowledge', 'view', [one['rem_project_id']])
            with pytest.raises(asyncpg.NoDataFoundError):
                await event(old_version)
            assert await event(old_version, ids['publisher']), 'An unrestricted neighbour retains old history'

            await selected(db, ids['viewer'], 'knowledge', 'view', [one['rem_project_id'], two['rem_project_id']])
            await selected(db, ids['viewer'], 'projects', 'view', [two['rem_project_id']])
            with pytest.raises(asyncpg.NoDataFoundError):
                await event(old_version)
            await selected(db, ids['viewer'], 'projects', 'view', [one['rem_project_id'], two['rem_project_id']])
            assert await event(old_version)

            await selected(db, ids['viewer'], 'knowledge', 'view')
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await event(old_version)
            await membership(db, [(one['rem_project_id'], 'HISTORY-BU'), (two['rem_project_id'], 'HISTORY-BU')])
            await selected(db, ids['viewer'], 'knowledge', 'view', bus=['HISTORY-BU'])
            await clock(db)
            assert await event(old_version)
            await clock(db, NOW + timedelta(days=8))
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await event(old_version)
    asyncio.run(check())


def test_article_translation_composite_identity_uses_exact_version_scope(permission_accounts):
    from test_articles import content, paragraph
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            one = await project_fixture(db, ids['editor'])
            two = await project_fixture(db, ids['editor'])
            articles = []
            for project in (one, two):
                body = content(blocks={'type': 'doc', 'content': [paragraph(),
                    {'type': 'projectCard', 'attrs': {'project_id': project['public_project_id']}}]},
                    links=[{'kind': 'project', 'ref': project['public_project_id']}])
                articles.append(await call(db, ids['editor'], 'select hub.article_save(null,0,$1)', body))
            await selected(db, ids['editor'], 'knowledge', 'view', [one['rem_project_id']])
            visible_texts = await call(db, ids['editor'], "select hub.content_translation_list('knowledge',$1)", articles[0]['id'])
            assert visible_texts and all(':' in row['owner_key'] for row in visible_texts)
            assert all(row['row_ref']['article_id'] == articles[0]['id'] for row in visible_texts)
            assert await call(db, ids['editor'], "select hub.content_translation_list('knowledge',$1)", articles[1]['id']) == []
            hidden = await db.fetchrow("select id,revision,th_version from hub.content_translations where owner_type='article' and scope_id=$1 limit 1", articles[1]['id'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)',
                           hidden['id'], hidden['revision'], hidden['th_version'], 'Synthetic reviewed article')
    asyncio.run(check())


@pytest.mark.parametrize(('kind', 'owner'), [('disclosures', 'disclosure'), ('sales-terms', 'sales_term'),
                                            ('programmes', 'programme'), ('price', 'price')])
def test_commercial_translation_reads_preserve_own_project_scope(permission_accounts, kind, owner):
    from test_project_commercial import save as save_commercial
    from test_unit_type_workflow import create_type, save_price
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            one = await project_fixture(db, ids['editor'])
            two = await project_fixture(db, ids['editor'])
            for project in (one, two):
                if kind == 'price':
                    detail = await call(db, ids['editor'], 'select hub.project_detail($1)', project['public_project_id'])
                    item = await create_type(db, ids['editor'], detail)
                    await save_price(db, ids['editor'], project['public_project_id'], item)
                else:
                    await save_commercial(db, ids['editor'], project['public_project_id'], kind)
            await selected(db, ids['viewer'], 'projects', 'view', [one['rem_project_id']])
            allowed = await call(db, ids['viewer'], "select hub.content_translation_list('projects',$1)", one['public_project_id'])
            assert any(row['owner_type'] == owner for row in allowed)
            assert await call(db, ids['viewer'], "select hub.content_translation_list('projects',$1)", two['public_project_id']) == []
    asyncio.run(check())
