"""Exact old/proposed FAQ authority equivalence on rollback-only synthetic rows."""
import asyncio
import json
from uuid import UUID, uuid4

from test_business_content import answer, approve_faq, question
from test_content_scopes import clock, membership, scope_database, selected
from test_content_workflow import inventory_brand_fixture
from test_permission_content import call, set_bit
from test_permission_foundations import permission_accounts
from test_website_content import project_fixture


async def faq_cases(db, ids):
    projects = {label: await project_fixture(db, ids['editor']) for label in
                ('allowed', 'neighbour', 'excluded', 'other_brand', 'deleted_project', 'deleted_brand')}
    brands = {label: await inventory_brand_fixture(db, ids['editor']) for label in ('shared', 'other', 'deleted')}
    for label, project in projects.items():
        brand = brands['other' if label == 'other_brand' else 'deleted' if label == 'deleted_brand' else 'shared']
        await db.execute('update hub.projects set brand_id=$1 where id=$2', brand['id'], project['id'])
    group, digest = 'FAQ-EQUIVALENCE-' + uuid4().hex, uuid4().hex * 2
    await db.execute("insert into staging.intake_batches(manifest_sha256,manifest,datasets) values($1,'{}','{}')", digest)
    await db.execute('insert into staging.dw_project_groups(project_group_id,source_record,manifest_sha256) values($1,$2,$3)',
                     group, {'project_group_name': 'Synthetic predicate group'}, digest)
    for label in ('allowed', 'neighbour', 'excluded'):
        rem = projects[label]['rem_project_id']
        await db.execute("""insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance)
            values($1,$2,now(),$3,'{}')""", rem, {'project_id': rem, 'rem_project_group_id': group}, digest)
    cases = {}

    async def add(label, scope, ref, members, *, show=True, exposure='open'):
        key = await question(db, ids, show=show)
        row, body = await answer(db, ids, key, scope, ref,
                                 [projects[name]['rem_project_id'] for name in members], text='Synthetic ' + label)
        if exposure != 'open':
            row = await call(db, ids['editor'], 'select hub.save_faq($1,$2,$3)', UUID(row['id']), row['revision'],
                             {**body, 'ai_exposure': exposure})
        cases[label] = UUID(row['id'])
        return row, body, key

    for label, project in (('project_never_approved', 'allowed'), ('project_positive_neighbour', 'neighbour'),
                           ('project_excluded', 'excluded'), ('project_deleted_parent', 'deleted_project')):
        await add(label, 'project', projects[project]['rem_project_id'], [project])
    for label, brand, members in (('brand_partial_shared', 'shared', ['allowed', 'excluded']),
                                  ('brand_excluded', 'other', ['other_brand']),
                                  ('brand_deleted_parent', 'deleted', ['deleted_brand'])):
        await add(label, 'brand', brands[brand]['public_brand_id'], members)
    for scope, ref in (('business', 'residential'), ('group', group), ('corporate', 'sena')):
        kind = 'project_group' if scope == 'group' else scope
        await add(scope + '_partial_shared', kind, ref, ['allowed', 'excluded'])
        await add(scope + '_excluded', kind, ref, ['excluded'])
    await add('corporate_global', 'corporate', 'sena', [])
    await add('corporate_hidden_from_project', 'corporate', 'sena', [], show=False)
    await add('internal_exposure', 'project', projects['allowed']['rem_project_id'], ['allowed'], exposure='internal')
    row, _, _ = await add('withdrawn_archive', 'project', projects['allowed']['rem_project_id'], ['allowed'])
    target = {'id': row['id']}
    current = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'faq', target)
    await call(db, ids['editor'], "select hub.content_workflow_review($1,$2,$3,'withdraw',$4)",
               'faq', target, current['expected_hash'], 'Synthetic archive through supported withdrawal')
    _, _, key = await add('retired_question', 'project', projects['allowed']['rem_project_id'], ['allowed'])
    revision = await db.fetchval('select revision from hub.faq_questions where question_key=$1', key)
    await call(db, ids['publisher'], "select hub.approve_faq_question($1,$2,'retired')", key, revision)
    row, body, _ = await add('superseded_applicability', 'brand', brands['shared']['public_brand_id'], ['allowed'])
    await call(db, ids['editor'], 'select hub.save_faq($1,$2,$3)', UUID(row['id']), row['revision'],
               {**body, 'applies_to_project_ids': [projects['excluded']['rem_project_id']],
                'short_answer': {'th': 'Synthetic superseding answer'}})
    row, _, _ = await add('approved_positive', 'project', projects['allowed']['rem_project_id'], ['allowed'])
    await approve_faq(db, ids, row)
    # FAQ itself has no deletion/archive column. Exercise deleted parents and supported withdrawal.
    await db.execute('update hub.projects set deleted_at=clock_timestamp() where id=$1', projects['deleted_project']['id'])
    await db.execute('update hub.brands set deleted_at=clock_timestamp() where id=$1', brands['deleted']['id'])
    assert await db.fetchval('select count(*) from hub.faq_versions where faq_id=$1', cases['superseded_applicability']) == 2
    assert not await db.fetchval('select exists(select 1 from hub.faq_versions where faq_id=$1 and approved_by is not null)',
                                 cases['project_never_approved'])
    return projects, cases


async def native_rows(db, cases):
    return await db.fetchval("""select coalesce(jsonb_agg(r order by r->>'item_id'),'[]'::jsonb)
        from hub.workspace_native_rows() r where r->>'kind'='faq' and r->>'item_id'=any($1::text[])""",
                             [str(identity) for identity in cases.values()])


async def native_attributes(db):
    return await db.fetchval("""select jsonb_build_object('owner',proowner,'acl',proacl::text,
        'volatility',provolatile,'security_definer',prosecdef,'strict',proisstrict,'parallel',proparallel,
        'config',proconfig,'language',prolang,'cost',procost,'rows',prorows,
        'result',pg_get_function_result(oid),'arguments',pg_get_function_arguments(oid))
        from pg_proc where oid='hub.workspace_native_rows_before_scopes()'::regprocedure""")


async def observe(db, actor, cases):
    # Private projections are not app RPCs; exercise their actor guards from the disposable operator.
    await db.execute("select set_config('app.actor_id',$1,true)", str(actor))
    before = tuple(await db.fetchrow('select (select count(*) from audit.change_log),(select count(*) from hub.content_gaps)'))
    rows = await db.fetch("""select f.id,hub.workspace_faq_allowed(f.id) old,
        hub.content_source_allowed('faqs',to_jsonb(f),'knowledge') proposed,
        case when f.state<>'WITHDRAWN' and v.id is not null then hub.content_source_allowed(
            'faq_versions',hub.web_source('faq_versions',jsonb_build_object('id',v.id)),'knowledge')
          else false end native_eligible
        from hub.faqs f left join hub.faq_versions v on v.id=f.draft_version_id
        where f.id=any($1::uuid[])""", list(cases.values()))
    definition = await db.fetchval("select pg_get_functiondef('hub.workspace_native_rows_before_scopes()'::regprocedure)")
    proposed = "hub.content_source_allowed('faqs',to_jsonb(f),'knowledge')"
    assert definition.count(proposed) == 1, 'Expected exactly one approved predicate in 0092 definition'
    attributes = await native_attributes(db)
    try:
        # The savepoint makes restoration possible even if the old query raises; the outer fixture always rolls back.
        async with db.transaction():
            await db.execute(definition.replace(proposed, 'hub.workspace_faq_allowed(f.id)', 1))
            assert await native_attributes(db) == attributes, 'Temporary old predicate changed function attributes or ACL'
            old_rows = await native_rows(db, cases)
    finally:
        await db.execute(definition)
        restored = await db.fetchval("select pg_get_functiondef('hub.workspace_native_rows_before_scopes()'::regprocedure)")
        assert restored == definition, 'Exact function definition was not restored'
        assert await native_attributes(db) == attributes, 'Function attributes or ACL were not restored'
    current_rows = await native_rows(db, cases)
    canonical = lambda value: json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    actual = {UUID(row['item_id']): canonical(row) for row in current_rows}
    old_native = {UUID(row['item_id']): canonical(row) for row in old_rows}
    assert len(actual) == len(current_rows) and len(old_native) == len(old_rows), 'Duplicate native FAQ rows'
    by_id = {row['id']: row for row in rows}
    assert set(by_id) == set(cases.values()), 'Synthetic FAQ row unexpectedly absent'
    result = [{'label': label, 'old': row['old'], 'proposed': row['proposed'],
               'expected_native': bool(row['old'] and row['native_eligible']), 'actual_native': identity in actual,
               'old_native': identity in old_native, 'native_payload_equal': actual.get(identity) == old_native.get(identity)}
              for label, identity in sorted(cases.items()) for row in [by_id[identity]]]
    absent = uuid4()
    old_missing = await db.fetchval('select hub.workspace_faq_allowed($1)', absent)
    new_missing = await db.fetchval("select hub.content_source_allowed('faqs',null::jsonb,'knowledge')")
    result.append({'label': 'missing_faq', 'old': old_missing, 'proposed': new_missing,
                   'expected_native': False, 'actual_native': absent in actual, 'old_native': absent in old_native,
                   'native_payload_equal': absent not in actual and absent not in old_native})
    after = tuple(await db.fetchrow('select (select count(*) from audit.change_log),(select count(*) from hub.content_gaps)'))
    assert after == before, 'Predicate/native comparison wrote audit or gaps'
    return result

def test_native_faq_predicate_preserves_exact_authority_and_lifecycle(permission_accounts, record_property):
    _, ids = permission_accounts

    async def check():
        async with scope_database() as db:
            projects, cases = await faq_cases(db, ids)
            await clock(db)
            await membership(db, [(row['rem_project_id'], 'FAQ-A' if name == 'allowed' else 'FAQ-B')
                                  for name, row in projects.items()])
            scenarios = (
                ('unrestricted', None, [], True, True),
                ('selected_one', ['allowed'], [], True, True),
                ('selected_two', ['allowed', 'neighbour'], [], True, True),
                ('positive_neighbour_only', ['neighbour'], [], True, True),
                ('selected_empty', [], [], True, True),
                ('partial_shared_knowledge_only', ['allowed'], [], True, False),
                ('revoked_after_positive', ['allowed'], [], False, True),
                ('no_knowledge_view', None, [], False, True),
                ('selected_bud', [], ['FAQ-A'], True, True),
                ('selected_bud_with_exception', ['neighbour'], ['FAQ-A'], True, True),
            )
            receipts = []
            for label, selection, bus, knowledge, descendants in scenarios:
                # Restore a permitted baseline before the explicit revocation scenario.
                for tab, enabled in (('knowledge', True), ('projects', descendants), ('brands', descendants)):
                    await set_bit(ids['viewer'], tab, connection=db, manager=ids['admin'], can_view=enabled)
                await db.execute("delete from hub.account_content_scope where account_id=$1 and tab='knowledge'", ids['viewer'])
                if selection is not None:
                    await selected(db, ids['viewer'], 'knowledge', 'view',
                                   [projects[name]['rem_project_id'] for name in selection], bus=bus)
                if label == 'revoked_after_positive':
                    positive = await observe(db, ids['viewer'], cases)
                    assert next(row for row in positive if row['label'] == 'project_never_approved')['old'] is True
                if not knowledge:
                    await set_bit(ids['viewer'], 'knowledge', connection=db, manager=ids['admin'], can_view=False)
                rows = await observe(db, ids['viewer'], cases)
                receipt = {'case': label, 'rows': rows, 'counts': {
                    key: sum(bool(row[key]) for row in rows) for key in ('old', 'proposed', 'expected_native', 'actual_native', 'old_native', 'native_payload_equal')}}
                receipts.append(receipt)
                print('FAQ_PREDICATE_EQUIVALENCE ' + json.dumps(receipt, sort_keys=True))
                assert all(row['native_payload_equal'] for row in rows), label + ': complete native JSON mismatch; stop, do not change authority'
                assert all(row['old'] is row['proposed'] for row in rows), label + ': predicate mismatch; stop, do not change authority'
                assert all(row['expected_native'] is row['actual_native'] for row in rows), label + ': native row set mismatch'
                values = {row['label']: row for row in rows}
                included_projects = set(selection or ()) | ({'allowed'} if bus else set())
                if not knowledge or selection is not None and not included_projects:
                    assert receipt['counts']['old'] == receipt['counts']['actual_native'] == 0, label
                elif selection is None:
                    for positive_label in ('project_never_approved', 'approved_positive', 'project_positive_neighbour'):
                        assert values[positive_label]['old'] is True and values[positive_label]['actual_native'] is True, label + ': live positive missing'
                else:
                    for project, positive_label in (('allowed', 'project_never_approved'), ('neighbour', 'project_positive_neighbour')):
                        if project in included_projects:
                            assert values[positive_label]['actual_native'] is True, label + ': positive neighbour missing'
                    assert values['project_excluded']['old'] is False and values['brand_excluded']['old'] is False, label
                    assert values['superseded_applicability']['old'] is False, label + ': old applicability revived'
                    if label == 'selected_bud':
                        assert values['project_positive_neighbour']['old'] is False, 'BUD-only grant acquired an exception'
                    if 'allowed' in included_projects:
                        for scope in ('brand', 'business', 'group', 'corporate'):
                            assert values[scope + '_partial_shared']['actual_native'] is True, label + ': partial shared row missing'
                        assert values['withdrawn_archive']['actual_native'] is False, 'Withdrawn FAQ entered native rows'
            record_property('faq_predicate_equivalence', json.dumps(receipts, sort_keys=True))
    asyncio.run(check())


def test_native_faq_projection_scans_the_scoped_collection_once_at_scale(permission_accounts):
    _, ids = permission_accounts

    async def check():
        async with scope_database() as db:
            brand = await inventory_brand_fixture(db, ids['editor'])
            projects = [await project_fixture(db, ids['editor']) for _ in range(50)]
            await db.execute('update hub.projects set brand_id=$1 where id=any($2::uuid[])',
                             brand['id'], [row['id'] for row in projects])
            for _ in range(50):
                key = await question(db, ids)
                await answer(db, ids, key, 'corporate', 'sena', [])
            await db.execute("SET LOCAL track_functions='all'")
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['viewer']))
            counter = """select coalesce(sum(calls),0) from pg_stat_xact_user_functions
                where funcid='hub.content_faq_rows()'::regprocedure"""
            scans = await db.fetchval(counter)
            assert await db.fetchval("select count(*) from hub.workspace_native_rows() r where r->>'kind'='faq'") >= 50
            assert await db.fetchval(counter) - scans == 1, 'One native projection must not rescan the FAQ collection per row'
            counts = 'select (select count(*) from audit.change_log),(select count(*) from hub.content_gaps)'
            before = tuple(await db.fetchrow(counts))
            home = await asyncio.wait_for(call(db, ids['viewer'], 'select hub.workspace_home(brand=>$1)',
                                              brand['public_brand_id']), timeout=15)
            assert home['project_total'] == len(projects) == 50 and len(home['projects']) == 25
            assert tuple(await db.fetchrow(counts)) == before
    asyncio.run(check())
