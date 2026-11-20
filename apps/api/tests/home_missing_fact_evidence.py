"""Manual home comparison evidence and shared focused checks.

Explicitly select this file for corpus proofs. The accumulated old-path timeout
remains a recorded limitation, not an automatically collected regression.
The 300-project performance target is deferred by the owner to after UAT.
"""
import asyncio
from datetime import date, timedelta
import hashlib
import json
import time
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_permission_baseline import disposable_operator, ROOT
from test_permission_content import call, set_bit
from test_permission_foundations import permission_accounts, h
from test_project_content_core import runtime
from test_content_workflow import approve_item, inventory_brand_fixture
from test_unit_type_workflow import create_type, project as project_factory
from test_business_content import answer, approve_faq, question
from test_content_scopes import scope_database
from test_faq_coverage import question as core_question
from test_faq_intake import seed as intake_seed, generate as intake_generate, clusters, cluster_of
from test_publication_queue import online, prepare
from test_website_content import project_fixture
from content_workflow_fixture import decide_item
from sena_hub_api.workspace_home import workspace_href


# Forward (0094) and rollback (pre-0094) home call sites, exactly as in the migration.
HOME_SIGNATURE = 'hub.workspace_home(text,text,integer,integer,text,uuid)'
HELPER_CALL = 'preview:=hub.workspace_missing_fact_cells(p.id,faq_scope.public_id);'
COMPOSER_CALL = "preview:=hub.compose_project_faq(p.id,'th',faq_scope.public_id,false,false);"
# Every permission_accounts identity; denied identities must fail identically on both paths.
HOME_ACTORS = ('admin', 'second', 'viewer', 'editor', 'publisher', 'online_staff', 'agency', 'service_consumer', 'pending')
UNFILTERED = ((None, None, None), (None, None, 'fact_missing'))
PAGE = 100
# A timeout is not equivalence: both paths retain the ordinary 15-second bound.
REFERENCE_TIMEOUT = FORWARD_DEADLINE = 15
CONTEXTS = """select p.public_project_id,p.id project_id,null::text unit_id from hub.projects p where p.deleted_at is null
    union all select p.public_project_id,p.id,t.public_commercial_type_id from hub.projects p
    join hub.commercial_types t on t.project_id=p.id where p.deleted_at is null and t.deleted_at is null and t.status<>'withdrawn'
    order by 1,3 nulls first"""
canonical = lambda value: json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def with_links(value):
    """Copy of a home payload with hrefs derived exactly as the /v1/admin/content/home route does."""
    value = json.loads(json.dumps(value))
    for item in value['tasks']:
        item['href'] = workspace_href(item.get('kind', ''), item['context'])
    if value.get('selected_gap'):
        item = value['selected_gap']
        item['href'] = workspace_href(item.get('kind', ''), item['context'])
    for project in value['projects']:
        project['href'] = workspace_href('project', {'project': project['ref']})
        for field in project['readiness'].get('items', []):
            field['href'] = workspace_href('', field['context'])
    for brand_item in value['brands']:
        for field in brand_item['readiness']['items']:
            field['href'] = workspace_href('brand', field['context'])
    return value


async def guarded(db, query, *args):
    """Run one operator read in a savepoint so an expected error cannot abort the fixture."""
    try:
        async with db.transaction():
            return {'ok': await db.fetchval(query, *args)}
    except asyncpg.PostgresError as error:
        return {'error': [error.sqlstate, str(error)]}


async def home_attributes(db):
    return dict(await db.fetchrow("""select proowner,proacl::text acl,provolatile,prosecdef,proisstrict,proparallel,
        proconfig,prolang,procost,prorows,pg_get_function_result(oid) result,pg_get_function_arguments(oid) arguments
        from pg_proc where oid=$1::regprocedure""", HOME_SIGNATURE))


async def side_effect_counts(db):
    return tuple(await db.fetchrow('select (select count(*) from audit.change_log),(select count(*) from hub.content_gaps)'))


def waiting_cells(composed):
    """The composer's cells projected to the helper's exact four fields, in composer order."""
    return [{'question_key': cell['question_key'], 'question_label': cell['question_label'],
             'state': 'waiting_for_fact', 'missing_fact_keys': cell['missing_fact_keys']}
            for cell in composed['cells'] if cell.get('state') == 'waiting_for_fact']


async def compare_context_cells(db):
    """Per project/unit context: helper cells equal the composer's waiting_for_fact cells exactly (order included)."""
    rows = await db.fetch(CONTEXTS)
    differences, waiting = [], 0
    for row in rows:
        helper = await guarded(db, 'select hub.workspace_missing_fact_cells($1,$2)', row['project_id'], row['unit_id'])
        composer = await guarded(db, "select hub.compose_project_faq($1,'th',$2,false,false)", row['project_id'], row['unit_id'])
        if 'error' in helper or 'error' in composer:
            raise AssertionError(f'Unexpected context error; STOP: {canonical(dict(row))}: {helper.get("error")} / {composer.get("error")}')
        else:
            expected = waiting_cells(composer['ok'])
            same = helper['ok'] == {'cells': expected}
            waiting += len(expected)
        if not same:
            differences.append({'project': row['public_project_id'], 'unit': row['unit_id'],
                                'helper': helper, 'composer_waiting': composer.get('error') or waiting_cells(composer['ok'])})
    return {'contexts': len(rows), 'waiting_cells': waiting, 'differences': differences}


async def home_pages(db, ids, actor, bud, brand, task_kind, timeout):
    """Every page of one actor/filter home, with route hrefs; offsets cover both projects and tasks."""
    # Determine permission from the unchanged entry guard, not legacy role names.
    # In the baseline online_staff has no content View grant; ordinary fixtures
    # grant it explicitly. A matching pair of unexpected errors cannot pass.
    denial = None
    try:
        async with db.transaction():
            prior = await db.fetchval("select current_setting('app.actor_id',true)")
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids[actor]))
            await db.fetchval('select hub.workspace_require()')
            await db.execute("select set_config('app.actor_id',$1,true)", prior or '')
    except asyncpg.InsufficientPrivilegeError as error:
        denial = [error.sqlstate, str(error)]
    pages, offset, end = [], 0, None
    while end is None or offset < end:
        try:
            value = await asyncio.wait_for(call(db, ids[actor], 'select hub.workspace_home($1,$2,$3,$4,$5,null)',
                                                bud, brand, offset, PAGE, task_kind), timeout)
        except TimeoutError as error:
            raise AssertionError(f'Home reference/projection timeout at {timeout}s; STOP: '
                                 f'actor={actor},bud={bud},brand={brand},task={task_kind},offset={offset}') from error
        except asyncpg.InsufficientPrivilegeError as error:
            assert [error.sqlstate, str(error)] == denial, f'Unexpected home denial for {actor}; STOP'
            return {'error': [error.sqlstate, str(error)], 'offset': offset, 'pages': pages}
        assert denial is None, f'Home bypassed its unchanged entry guard for {actor}; STOP'
        pages.append(with_links(value))
        end = max(value['project_total'], value['task_total'], 1) if end is None else end
        offset += PAGE
    return {'pages': pages}


async def capture_home(db, ids, actors, filters, timeout):
    return {f'{actor}|{bud}|{brand}|{task_kind}': await home_pages(db, ids, actor, bud, brand, task_kind, timeout)
            for actor in actors for bud, brand, task_kind in filters}


def first_difference(forward, rollback):
    if 'error' in forward or 'error' in rollback:
        return {'forward_error': forward.get('error'), 'rollback_error': rollback.get('error')}
    if len(forward['pages']) != len(rollback['pages']):
        return {'page_count': [len(forward['pages']), len(rollback['pages'])]}
    for index, (left, right) in enumerate(zip(forward['pages'], rollback['pages'])):
        for field in sorted(set(left) | set(right)):
            if canonical(left.get(field)) != canonical(right.get(field)):
                detail = {'page': index, 'field': field}
                if field == 'tasks':
                    a, b = [row['id'] for row in left['tasks']], [row['id'] for row in right['tasks']]
                    detail.update(only_forward=sorted(set(a) - set(b))[:10], only_rollback=sorted(set(b) - set(a))[:10],
                                  same_ids_different_order_or_body=set(a) == set(b))
                return detail
    return {}


async def compare_home_forward_rollback(db, ids, label, *, filters=UNFILTERED, actors=HOME_ACTORS):
    """Exact whole-home equality: forward helper vs the documented rollback composer call.

    Runs only inside an owned scope_database rollback transaction. The rollback definition
    exists only inside a savepoint and is rolled back before returning; the exact original
    definition, attributes/ACL and audit/gap counts are re-asserted afterwards.
    """
    assert db.is_in_transaction(), 'Compare only inside the scope_database rollback fixture'
    original = await db.fetchval('select pg_get_functiondef($1::regprocedure)', HOME_SIGNATURE)
    forward_source = original.replace('\r\n', '\n')
    assert forward_source.count(HELPER_CALL) == 1 and COMPOSER_CALL not in forward_source, 'Forward home must call only the helper'
    attributes, effects = await home_attributes(db), await side_effect_counts(db)

    cells = await compare_context_cells(db)
    assert not cells['differences'], f'{label}: helper/composer cell mismatch; STOP: {canonical(cells["differences"][:3])}'

    assert await side_effect_counts(db) == effects, 'Context reads changed audit/gap counts'
    forward = await capture_home(db, ids, actors, filters, FORWARD_DEADLINE)
    assert await side_effect_counts(db) == effects, 'Forward reads changed audit/gap counts'
    savepoint = db.transaction()
    await savepoint.start()
    try:
        await db.execute(forward_source.replace(HELPER_CALL, COMPOSER_CALL, 1))
        rollback_source = (await db.fetchval('select pg_get_functiondef($1::regprocedure)', HOME_SIGNATURE)).replace('\r\n', '\n')
        assert rollback_source.count(COMPOSER_CALL) == 1 and HELPER_CALL not in rollback_source
        assert await home_attributes(db) == attributes, 'Rollback reference changed home attributes or ACL'
        started = time.perf_counter()
        rollback = await capture_home(db, ids, actors, filters, REFERENCE_TIMEOUT)
        reference_seconds = time.perf_counter() - started
        assert await side_effect_counts(db) == effects, 'Rollback reads changed audit/gap counts before rollback'
    finally:
        await savepoint.rollback()
        assert await db.fetchval('select pg_get_functiondef($1::regprocedure)', HOME_SIGNATURE) == original, 'Forward definition not restored'
        assert await home_attributes(db) == attributes, 'Forward attributes/ACL not restored'
    assert await side_effect_counts(db) == effects, 'Home reads changed audit/gap counts'

    mismatched = [key for key in forward if canonical(forward[key]) != canonical(rollback[key])]
    assert not mismatched, (f'{label}: home forward/rollback mismatch for {mismatched[:5]}; STOP: '
                            f'{canonical(first_difference(forward[mismatched[0]], rollback[mismatched[0]]))}')
    summary = {}
    for key, value in forward.items():
        if 'error' in value:
            summary[key] = {'error': value['error'][0]}
        else:
            first = value['pages'][0]
            summary[key] = {'pages': len(value['pages']), 'project_total': first['project_total'], 'task_total': first['task_total'],
                            'fact_missing_tasks': sum(row['category'] == 'fact_missing' for page in value['pages'] for row in page['tasks'])}
    return {'snapshot': label, 'status': 'EXACT_HOME_JSON_EQUAL', 'contexts': cells['contexts'], 'waiting_cells': cells['waiting_cells'],
            'comparisons': len(forward), 'reference_seconds_not_acceptance': round(reference_seconds, 3), 'summary': summary,
            'forward_digest': hashlib.sha256(canonical(forward).encode()).hexdigest()}


def test_private_missing_fact_cells_is_not_callable_directly(permission_accounts):
    """Direct execution of hub.workspace_missing_fact_cells is denied to all non-owner roles."""
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            for actor in ('viewer', 'editor', 'publisher', 'agency', 'pending', 'service_consumer'):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids[actor], "select hub.workspace_missing_fact_cells('00000000-0000-0000-0000-000000000000'::uuid, null)")
            operator = await disposable_operator()
            try:
                # hub_app also cannot execute private helper directly
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    async with operator.transaction():
                        await operator.execute("set local role hub_app; select hub.workspace_missing_fact_cells('00000000-0000-0000-0000-000000000000'::uuid, null)")
                # Search path must be pg_catalog, pg_temp
                row = await operator.fetchrow("""
                    select prosecdef, proconfig
                    from pg_proc
                    where proname = 'workspace_missing_fact_cells'
                      and pronamespace = 'hub'::regnamespace
                """)
                assert row['prosecdef'] is True, "Must be SECURITY DEFINER"
                assert any('search_path=pg_catalog, pg_temp' in cfg or 'search_path=pg_catalog,pg_temp' in cfg for cfg in (row['proconfig'] or [])), "search_path must be pg_catalog,pg_temp"
            finally:
                await operator.close()
        finally:
            await db.close()

    asyncio.run(check())


def test_missing_fact_projection_equivalence_matrix(permission_accounts):
    """Matrix of equivalence: scope precedence, overrides, conflicts, holds, forms, and fact slots.
    Compares hub.workspace_missing_fact_cells against compose_project_faq filtered to waiting_for_fact.
    """
    _, ids = permission_accounts

    async def check():
        async with scope_database() as db:
            p = await project_fixture(db, ids['editor'])
            detail = await call(db, ids['editor'], 'select hub.project_detail($1)', p['public_project_id'])
            unit = await create_type(db, ids['editor'], detail)
            today = await db.fetchval("select (current_timestamp at time zone 'Asia/Bangkok')::date")
            form = await db.fetchval('select hub.faq_project_form($1)', p['id'])
            other_form = 'townhome' if form != 'townhome' else 'house'
            assert other_form != unit['product_form']

            # Helper to create question and approved answer
            async def create_q(key, forms=None, q_keys=None, exposure='web_only'):
                await call(db, ids['editor'], 'select hub.save_faq_question($1,0,$2)', key, {
                    'topic': 'design', 'default_level': 'project',
                    'question_template': {'th': f'{key} template th', 'en': f'{key} template en'},
                    'answer_kind': 'fact', 'fact_keys': q_keys or [], 'property_types': forms or [],
                    'is_core': True, 'show_on_project_pages': True, 'ai_exposure': exposure
                })
                await call(db, ids['publisher'], "select hub.approve_faq_question($1,1,'approved')", key)

            async def create_ans(scope_type, scope_id, key, ans_keys=None, exposure='web_only', effective_to=None, review_due=None, applies=None):
                return await call(db, ids['editor'], 'select hub.save_faq(null,0,$1)', {
                    'question_key': key, 'scope_type': scope_type, 'scope_id': scope_id,
                    'applies_to_project_ids': applies if applies is not None else [p['rem_project_id']],
                    'question': {'th': f'{key} th', 'en': f'{key} en'},
                    'short_answer': {'th': f'{key} ans th', 'en': f'{key} ans en'},
                    'answer_kind': 'fact', 'fact_keys': ans_keys or [],
                    'ai_exposure': exposure,
                    'effective_to': effective_to.isoformat() if effective_to else None,
                    'review_due': review_due.isoformat() if review_due else None,
                })

            # Case 1: Simple fact waiting
            q1 = f'q_wait_{uuid4().hex[:8]}'
            await create_q(q1, q_keys=['project.common_fee'])
            await create_ans('project', p['rem_project_id'], q1, ans_keys=['project.common_fee'])

            # Case 2: Unit-type specific answer overriding project answer
            q2 = f'q_unit_override_{uuid4().hex[:8]}'
            await create_q(q2, q_keys=['price.amount'])
            await create_ans('project', p['rem_project_id'], q2, ans_keys=['project.common_fee'])
            await create_ans('unit_type', str(unit['id']), q2, ans_keys=['price.amount'])

            # Case 3: Same-rank conflict (two project answers for same question)
            # Produces 'hold', suppressing waiting_for_fact
            q3 = f'q_conflict_{uuid4().hex[:8]}'
            await create_q(q3, q_keys=['project.common_fee'])
            await create_ans('project', p['rem_project_id'], q3, ans_keys=['project.common_fee'])
            await create_ans('project', p['rem_project_id'], q3, ans_keys=['project.common_fee'])

            # Case 4: AI exposure internal produces hold, not waiting
            q4 = f'q_internal_{uuid4().hex[:8]}'
            await create_q(q4, q_keys=['project.common_fee'], exposure='internal')
            await create_ans('project', p['rem_project_id'], q4, ans_keys=['project.common_fee'])

            # Case 5: Expired answer (effective_to < today) produces hold
            q5 = f'q_expired_{uuid4().hex[:8]}'
            await create_q(q5, q_keys=['project.common_fee'])
            await create_ans('project', p['rem_project_id'], q5, ans_keys=['project.common_fee'], effective_to=today - timedelta(days=1))

            # Case 6: A valid form that matches neither owned project nor unit
            q6 = f'q_form_mismatch_{uuid4().hex[:8]}'
            await create_q(q6, forms=[other_form], q_keys=['project.common_fee'])
            await create_ans('project', p['rem_project_id'], q6, ans_keys=['project.common_fee'])

            # Owner-only calls preserve the private ACL; compare complete ordered arrays.
            for u_pub in (None, unit['public_commercial_type_id']):
                helper_cells = (await db.fetchval('select hub.workspace_missing_fact_cells($1,$2)', p['id'], u_pub))['cells']
                composed = await db.fetchval("select hub.compose_project_faq($1,'th',$2,false,false)", p['id'], u_pub)
                assert helper_cells == waiting_cells(composed), 'Exact matrix cell mismatch; STOP'
                ours = {c['question_key']: c for c in composed['cells'] if c['question_key'] in {q1,q2,q3,q4,q5,q6}}
                assert set(ours) == {q1,q2,q3,q4,q5,q6}
                assert ours[q1]['state'] == ours[q2]['state'] == 'waiting_for_fact'
                assert ours[q1]['missing_fact_keys'] == ['project.common_fee']
                assert ours[q2]['scope_type'] == ('project' if u_pub is None else 'unit_type')
                assert ours[q3]['reason'] == 'same_level_conflict'
                assert ours[q4]['reason'] == 'internal'
                assert ours[q5]['reason'] == 'answer_expired'
                assert ours[q6]['state'] in ('not_applicable', 'hold')

    asyncio.run(check())



def test_workspace_home_rollback_and_forward_equivalence(permission_accounts, record_property):
    """Ambient corpus: whole home JSON, hrefs, totals and ordering equal on forward and rollback paths.

    Rollback-only: the composer reference exists inside a savepoint of the scope_database
    transaction, never as a committed definition.
    """
    _, ids = permission_accounts

    async def check():
        async with scope_database() as db:
            receipt = await compare_home_forward_rollback(db, ids, 'ambient')
            record_property('home_forward_rollback_ambient', canonical(receipt))
    asyncio.run(check())


# Recorded accumulated reproduction (0092 composer-measurement): run after exactly these
# modules in one fresh disposable session, then this test. Counts are a STOP precondition.
ACCUMULATED_PREFIX = ('test_business_assistant.py', 'test_business_content.py',
                      'test_content_workspace.py', 'test_website_content.py')
ACCUMULATED_CORPUS = {'projects': 103, 'brands': 38, 'faqs': 70, 'units': 9, 'questions': 144, 'contexts': 112}
CORPUS_COUNTS = """select (select count(*) from hub.projects) projects,(select count(*) from hub.brands) brands,
    (select count(*) from hub.faqs) faqs,(select count(*) from hub.commercial_types) units,
    (select count(*) from hub.faq_questions) questions,(select count(*) from (""" + CONTEXTS + """) c) contexts"""


def test_home_forward_matches_rollback_on_accumulated_repro_corpus(permission_accounts, record_property):
    """103 projects / 70 FAQs / 112 contexts: the unfiltered home that timed out on the composer path.

    Fixture is the same builder sequence as
    test_native_faq_predicate_equivalence::test_native_faq_projection_scans_the_scoped_collection_once_at_scale
    (one brand, 50 projects, 50 corporate FAQs) on top of the accumulated prefix modules.
    """
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
            corpus = dict(await db.fetchrow(CORPUS_COUNTS))
            assert corpus == ACCUMULATED_CORPUS, f'Accumulated corpus precondition failed; STOP: {corpus}'

            # Unfiltered forward home first, under the unchanged 15-second deadline, unprofiled.
            started = time.perf_counter()
            home = await asyncio.wait_for(call(db, ids['viewer'], 'select hub.workspace_home()'), timeout=FORWARD_DEADLINE)
            forward_seconds = time.perf_counter() - started
            assert home['project_total'] == corpus['projects'] and len(home['projects']) == 25

            # Profiled separately, outside the timed request: no full composition on the forward path.
            await db.execute("SET LOCAL track_functions='all'")
            calls = """select coalesce(sum(calls) filter(where funcname='compose_project_faq'),0),
                coalesce(sum(calls) filter(where funcname='workspace_missing_fact_cells'),0)
                from pg_stat_xact_user_functions where schemaname='hub'"""
            before = tuple(map(int, await db.fetchrow(calls)))
            await call(db, ids['viewer'], 'select hub.workspace_home()')
            after = tuple(map(int, await db.fetchrow(calls)))
            assert after[0] - before[0] == 0, 'Forward home must make zero full compose_project_faq calls'

            # Function profiling is diagnostic only; do not carry its overhead
            # into either bounded equality path or the ordinary rollback oracle.
            await db.execute("SET LOCAL track_functions='none'")
            print('HOME_ACCUMULATED_FORWARD ' + canonical({'corpus': corpus,
                'unprofiled_seconds': forward_seconds, 'full_composer_calls': after[0]-before[0],
                'helper_calls': after[1]-before[1]}), flush=True)
            receipt = await compare_home_forward_rollback(db, ids, 'accumulated_103_project_repro')
            receipt.update(corpus=corpus, forward_unfiltered_seconds=round(forward_seconds, 3),
                           forward_helper_calls=after[1] - before[1])
            record_property('home_forward_rollback_accumulated', canonical(receipt))
            print('HOME_FORWARD_ROLLBACK_ACCUMULATED ' + canonical(receipt))
    asyncio.run(check())


async def build_ordinary_composer_corpus(db, ids, snapshot):
    """The 0092 ordinary composer corpus (49 explicit preconditions, four snapshots).

    Same builder sequence as composer-ordinary-measurement/passed-temporary-test.py, with the
    composer-guard probe replaced by ``snapshot(label)``. Every write stays in scope_database.
    Returns (labels, fixture_deltas, brand).
    """
    labels = {}
    population_sql = '''select (select count(*) from hub.projects) projects,
        (select count(*) from hub.brands) brands,(select count(*) from hub.faqs) faqs,
        (select count(*) from hub.faq_questions) questions,(select count(*) from hub.commercial_types) units'''
    ambient = dict(await db.fetchrow(population_sql))

    def proved(label, condition):
        assert condition, 'Fixture precondition failed; STOP: ' + label
        labels[label] = True

    brand = await inventory_brand_fixture(db, ids['editor'])
    deleted_brand = await inventory_brand_fixture(db, ids['editor'])
    p, outside, deleted_project, deleted_brand_child = [await project_fixture(db, ids['editor']) for _ in range(4)]
    await db.execute('update hub.projects set brand_id=$1 where id=any($2::uuid[])', brand['id'], [p['id'], deleted_project['id']])
    await db.execute('update hub.projects set brand_id=$1 where id=$2', deleted_brand['id'], deleted_brand_child['id'])
    await db.execute('update hub.projects set public_name=$1 where id=$2',
                     {'th': 'Synthetic business project', 'en': 'Synthetic business project'}, p['id'])
    assert await db.fetchval("select hub.business_project_matches('residential',$1)", p['rem_project_id'])
    assert not await db.fetchval("select hub.business_project_matches('residential',$1)", outside['rem_project_id'])
    group, digest = 'GUARD-' + uuid4().hex, uuid4().hex * 2
    await db.execute("insert into staging.intake_batches(manifest_sha256,manifest,datasets) values($1,'{}','{}')", digest)
    await db.execute('insert into staging.dw_project_groups(project_group_id,source_record,manifest_sha256) values($1,$2,$3)',
                     group, {'project_group_name': 'Synthetic guard group'}, digest)
    await db.execute("insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance) values($1,$2,now(),$3,'{}')",
                     p['rem_project_id'], {'project_id': p['rem_project_id'], 'rem_project_group_id': group}, digest)
    detail = await call(db, ids['editor'], 'select hub.project_detail($1)', p['public_project_id'])
    unit = await create_type(db, ids['editor'], detail)
    keys, rows, bodies = {}, {}, {}

    async def add(label, *, scope='business', ref='residential', members=None, key=None, **extra):
        key = key or await question(db, ids)
        members = [p['rem_project_id']] if members is None else members
        row, body = await answer(db, ids, key, scope, str(ref), members, text='Synthetic ' + label, **extra)
        keys[label], rows[label], bodies[label] = key, row, body
        return row

    async def composed(project=p, *, locale='th', published=False, unit_id=None):
        return await db.fetchval('select hub.compose_project_faq($1,$2,$3,$4,false)', project['id'], locale, unit_id, published)

    def find(value, field, key):
        matches = [row for row in value[field] if row['question_key'] == key]
        assert len(matches) == 1, 'Expected one synthetic ' + field + ' cell'
        return matches[0]

    await add('positive_business')
    await answer(db, ids, keys['positive_business'], 'corporate', 'sena', [], text='Synthetic negative membership fallback')
    await add('empty_business_applicability', members=[])
    fallback, _ = await answer(db, ids, keys['empty_business_applicability'], 'corporate', 'sena', [], text='Synthetic explicit fallback')
    await add('business_rule', members=[], applicability_rule={'brand_ids': [brand['public_brand_id']]})
    await add('unrelated_question', scope='project', ref=outside['rem_project_id'], members=[outside['rem_project_id']])
    await add('rekey_latest')
    rekey_new = await question(db, ids)
    await add('withdraw_latest')
    rows['withdraw_latest'] = await call(db, ids['editor'], 'select hub.save_faq($1,$2,$3)', UUID(rows['withdraw_latest']['id']),
        rows['withdraw_latest']['revision'], {**bodies['withdraw_latest'], 'short_answer': {'th': 'Synthetic second version'}})
    await add('published_new_draft')
    await add('approved_new_draft')
    await add('deleted_project_parent', scope='project', ref=deleted_project['rem_project_id'], members=[deleted_project['rem_project_id']])
    await add('deleted_brand_parent', scope='brand', ref=deleted_brand['public_brand_id'], members=[deleted_brand_child['rem_project_id']])
    hidden_key = await question(db, ids, show=False)
    await add('corporate_opt_out', scope='corporate', ref='sena', members=[], key=hidden_key)
    keys['missing_core'] = await core_question(db, ids)
    keys['property_form'] = await core_question(db, ids, forms=['house'])
    keys['unit_fact'] = await core_question(db, ids, keys=['price.amount'], kind='fact')
    await add('unit_fact', key=keys['unit_fact'], answer_kind='fact', fact_keys=['price.amount'],
              short_answer={'th': '{project} {amount}'})
    today = await db.fetchval("select (current_timestamp at time zone 'Asia/Bangkok')::date")
    for label, extra in [('internal', {'ai_exposure': 'internal'}), ('web_only', {'ai_exposure': 'web_only'}),
                         ('expired', {'effective_to': (today - timedelta(days=1)).isoformat()}),
                         ('review_due', {'review_due': (today - timedelta(days=1)).isoformat()})]:
        await add(label, **extra)
    await add('locale_fallback')
    levels = [('corporate', 'sena'), ('business', 'residential'), ('brand', brand['public_brand_id']),
              ('programme', 'LIVNEX'), ('project_group', group), ('project', p['rem_project_id']), ('unit_type', unit['id'])]
    for index, (expected, _) in enumerate(levels):
        key = await question(db, ids)
        keys['precedence_' + expected] = key
        for level, ref in levels[:index + 1]:
            row, _ = await answer(db, ids, key, level, str(ref), [] if level == 'corporate' else [p['rem_project_id']], text='Synthetic precedence ' + level)
        rows['precedence_' + expected] = row
    conflict = await question(db, ids)
    keys['same_rank_conflict'] = conflict
    for _ in range(2):
        await answer(db, ids, conflict, 'business', 'residential', [p['rem_project_id']], text='Synthetic equal-rank answer')

    # Ordinary intake generator; never a fabricated legacy cluster.
    candidates = await intake_seed(db, ids)
    await intake_generate(db)
    legacy = cluster_of(await clusters(db, ids['viewer']), candidates['loc1'])
    legacy_key = legacy['suggestion']['question_key']
    assert legacy_key
    legacy_question = await db.fetchrow('select status,revision from hub.faq_questions where question_key=$1', legacy_key)
    assert legacy_question and legacy_question['status'] in ('proposed', 'approved')
    if legacy_question['status'] == 'proposed':
        await call(db, ids['publisher'], "select hub.approve_faq_question($1,$2,'approved')", legacy_key, legacy_question['revision'])
    proved('legacy_question_approved', await db.fetchval("select status='approved' from hub.faq_questions where question_key=$1", legacy_key))
    legacy_id = await call(db, ids['editor'], "select hub.create_project_from_rem('ZZFAQ1')")
    legacy_project = dict(await db.fetchrow('select * from hub.projects where id=$1', legacy_id))
    proved('legacy_intake_cell', (find(await composed(legacy_project), 'cells', legacy_key).get('legacy') or {}).get('cluster_id') == legacy['id'])

    current = dict(await db.fetchrow(population_sql))
    fixture_deltas = {key: current[key] - ambient[key] for key in ambient}
    assert fixture_deltas == {'projects': 5, 'brands': 2, 'faqs': 49, 'questions': 29, 'units': 1}, f'STOP: {fixture_deltas}'
    first, other = await composed(), await composed(outside)
    proved('deleted_project_initial_positive', find(await composed(deleted_project), 'items', keys['deleted_project_parent'])['faq_id'] == rows['deleted_project_parent']['id'])
    proved('deleted_brand_initial_positive', find(await composed(deleted_brand_child), 'items', keys['deleted_brand_parent'])['faq_id'] == rows['deleted_brand_parent']['id'])
    proved('positive_business_membership', find(first, 'items', keys['positive_business'])['faq_id'] == rows['positive_business']['id'])
    proved('negative_business_membership', find(other, 'items', keys['positive_business'])['scope_type'] == 'corporate')
    proved('explicit_empty_not_business_wide', find(first, 'items', keys['empty_business_applicability'])['faq_id'] == fallback['id'])
    proved('rule_applicability', find(first, 'items', keys['business_rule'])['faq_id'] == rows['business_rule']['id'])
    proved('unrelated_question_missing_cell', find(first, 'cells', keys['unrelated_question'])['state'] == 'missing')
    proved('rekey_initial_answer', find(first, 'items', keys['rekey_latest'])['faq_id'] == rows['rekey_latest']['id'])
    proved('latest_draft_before_withdraw', find(first, 'items', keys['withdraw_latest'])['version_no'] == 2)
    proved('core_missing_cell', find(first, 'cells', keys['missing_core'])['state'] == 'missing')
    proved('corporate_opt_out', find(first, 'cells', hidden_key)['state'] == 'missing')
    proved('property_form_not_applicable', find(first, 'cells', keys['property_form'])['state'] == 'not_applicable')
    proved('property_form_unknown_hold', find(other, 'cells', keys['property_form'])['reason'] == 'unknown_property_form')
    proved('internal_exposure', find(first, 'hidden', keys['internal'])['reason'] == 'internal')
    proved('web_only_exposure', find(first, 'items', keys['web_only'])['ai_exposure'] == 'web_only')
    proved('expiry', find(first, 'hidden', keys['expired'])['reason'] == 'answer_expired')
    proved('review_due', find(first, 'hidden', keys['review_due'])['reason'] == 'review_due')
    proved('locale_fallback', find(await composed(locale='en'), 'items', keys['locale_fallback'])['is_fallback_locale'] is True)
    proved('same_rank_conflict', find(first, 'cells', conflict)['reason'] == 'same_level_conflict')
    unit_value = await composed(unit_id=unit['public_commercial_type_id'])
    for expected, _ in levels:
        proved('precedence_' + expected, find(unit_value, 'items', keys['precedence_' + expected])['scope_type'] == expected)
    fact = find(unit_value, 'cells', keys['unit_fact'])
    proved('inherited_unit_missing_fact', fact['state'] == 'waiting_for_fact' and fact['missing_fact_keys'] == ['price.amount'] and fact['scope_type'] == 'business')
    home = await call(db, ids['viewer'], "select hub.workspace_home(null,$1,0,25,'fact_missing')", brand['public_brand_id'])
    proved('unit_fact_home_context', any(row['context'].get('unit_type') == unit['public_commercial_type_id']
        and row['context'].get('question') == keys['unit_fact'] for row in home['tasks']))
    await snapshot('draft_static_all_levels_and_legacy', brand)

    await approve_faq(db, ids, rows['published_new_draft'])
    approved_published_id = await db.fetchval('select draft_version_id from hub.faqs where id=$1', UUID(rows['published_new_draft']['id']))
    proved('published_source_approved', await db.fetchval("select state='APPROVED' from hub.faq_versions where id=$1", approved_published_id))
    await online(ids, connection=db)
    key = 'business:residential'
    revision = await db.fetchval('select coalesce((select revision from hub.web_pages where page_key=$1),0)', key)
    page = await call(db, ids['editor'], 'select hub.web_page_save($1,$2,$3)', key, revision,
        {'url': '/guard/' + uuid4().hex, 'locales': ['th'], 'ai_policy': 'no_ai', 'max_faq_items': 100, 'project_ids': []})
    await approve_item(db, ids, 'page_config', {'id': page['id']})
    batch = await prepare(db, ids, key)
    published = await call(db, ids['viewer'], 'select hub.publication_queue_publish($1,$2)', UUID(batch['id']), batch['digest'])
    assert published['page_count'] == 1
    public_before = find(await composed(published=True), 'items', keys['published_new_draft'])
    stored_publication = await db.fetchrow('select f.published_version_id,v.state from hub.faqs f join hub.faq_versions v on v.id=f.published_version_id where f.id=$1', UUID(rows['published_new_draft']['id']))
    proved('published_pointer_positive', public_before['faq_id'] == rows['published_new_draft']['id']
           and public_before['version_id'] == str(approved_published_id)
           and stored_publication['published_version_id'] == approved_published_id and stored_publication['state'] == 'PUBLISHED')
    published_page = await call(db, ids['service_consumer'], "select hub.web_public_page($1,'th')", key)
    proved('published_public_projection', find(published_page, 'faq', keys['published_new_draft'])['short_answer'] == public_before['short_answer'])
    published_page_pointer = await db.fetchval('select published_version_id from hub.web_pages where page_key=$1', key)
    proved('page_published_pointer', published_page_pointer is not None)
    proved('published_page_exact_version_dependency', await db.fetchval('''select exists(
        select 1 from hub.web_dependencies((select payload from hub.entity_versions where id=$1)) dependency
        where dependency->>'table'='faq_versions' and dependency#>>'{identity,id}'=$2)''',
        published_page_pointer, str(approved_published_id)))
    await snapshot('published_version_before_new_draft', brand)
    await approve_faq(db, ids, rows['approved_new_draft'])
    approved_id = await db.fetchval('select draft_version_id from hub.faqs where id=$1', UUID(rows['approved_new_draft']['id']))
    proved('approved_unpublished_positive', await db.fetchval("select state='APPROVED' from hub.faq_versions where id=$1", approved_id))
    await snapshot('approved_version_before_new_draft', brand)

    for label in ('published_new_draft', 'approved_new_draft', 'rekey_latest'):
        current = await call(db, ids['editor'], 'select hub.faq_read($1)', UUID(rows[label]['id']))
        body = {**bodies[label], 'short_answer': {'th': 'Synthetic newer draft ' + label}}
        if label == 'rekey_latest':
            body['question_key'] = rekey_new
        await call(db, ids['editor'], 'select hub.save_faq($1,$2,$3)', UUID(current['id']), current['revision'], body)
    await decide_item(db, ids['editor'], 'faq', {'id': rows['withdraw_latest']['id']}, 'withdraw')
    # Existing rollback-fixture lifecycle pattern; FAQ has no deleted/archive field.
    await db.execute('update hub.projects set deleted_at=clock_timestamp() where id=$1', deleted_project['id'])
    await db.execute('update hub.brands set deleted_at=clock_timestamp() where id=$1', deleted_brand['id'])
    final, published_final = await composed(), await composed(published=True)
    proved('rekey_old_version_not_revived', find(final, 'cells', keys['rekey_latest'])['state'] == 'missing')
    proved('rekey_latest_new_question', find(final, 'items', rekey_new)['faq_id'] == rows['rekey_latest']['id'])
    proved('withdrawn_latest_older_not_revived', find(final, 'cells', keys['withdraw_latest'])['state'] == 'missing')
    proved('withdrawn_old_version_retained', await db.fetchval("select count(*)=2 and bool_or(version_no=1 and state<>'WITHDRAWN') and bool_or(version_no=2 and state='WITHDRAWN') from hub.faq_versions where faq_id=$1", UUID(rows['withdraw_latest']['id'])))
    proved('published_old_version_survives_new_draft', find(published_final, 'items', keys['published_new_draft'])['version_id'] == public_before['version_id'])
    proved('private_new_draft_selected', find(final, 'items', keys['published_new_draft'])['version_id'] != public_before['version_id'])
    proved('published_page_unchanged_after_new_draft',
        await call(db, ids['service_consumer'], "select hub.web_public_page($1,'th')", key) == published_page
        and await db.fetchval('select published_version_id from hub.web_pages where page_key=$1', key) == published_page_pointer)
    proved('published_faq_pointer_unchanged_after_new_draft',
        await db.fetchval('select published_version_id from hub.faqs where id=$1', UUID(rows['published_new_draft']['id'])) == approved_published_id)
    proved('approved_old_version_retained', await db.fetchval("select state='APPROVED' from hub.faq_versions where id=$1", approved_id))
    proved('approved_new_draft_selected', find(final, 'items', keys['approved_new_draft'])['version_id'] != str(approved_id))
    proved('deleted_brand_parent_excluded', find(await composed(deleted_brand_child), 'cells', keys['deleted_brand_parent'])['state'] == 'missing')
    proved('deleted_project_marked', await db.fetchval('select deleted_at is not null from hub.projects where id=$1', deleted_project['id']))
    proved('deleted_project_parent_excluded', not any(row.get('faq_id') == rows['deleted_project_parent']['id'] for row in final['items']))
    await snapshot('rekey_withdraw_new_drafts_and_deleted_parents', brand)
    return labels, fixture_deltas, brand


def test_home_forward_matches_rollback_on_ordinary_composer_corpus(permission_accounts, record_property):
    """0092 ordinary corpus: four snapshots, unfiltered and own-brand, all actors, exact home JSON."""
    _, ids = permission_accounts

    async def check():
        async with scope_database() as db:
            receipts = []

            async def snapshot(label, brand):
                filters = UNFILTERED + ((None, brand['public_brand_id'], None), (None, brand['public_brand_id'], 'fact_missing'))
                receipts.append(await compare_home_forward_rollback(db, ids, label, filters=filters))

            labels, deltas, brand = await build_ordinary_composer_corpus(db, ids, snapshot)
            assert len(labels) == 49 and all(labels.values()), f'Expected 49 explicit preconditions, got {len(labels)}'
            assert len(receipts) == 4
            # The corpus must exercise the projection: the own-brand unit price task exists on both paths.
            assert receipts[0]['waiting_cells'] > 0
            assert receipts[0]['summary'][f"viewer|None|{brand['public_brand_id']}|fact_missing"]['fact_missing_tasks'] > 0
            result = {'coverage': sorted(labels), 'fixture_deltas': deltas, 'snapshots': receipts}
            record_property('home_forward_rollback_ordinary', canonical(result))
            print('HOME_FORWARD_ROLLBACK_ORDINARY ' + canonical(result))
    asyncio.run(check())
