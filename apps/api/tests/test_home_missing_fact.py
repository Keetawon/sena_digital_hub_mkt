"""Home missing-fact task projection tests.
Verifies exact task equivalence against the composition path,
ACL denial on private helpers, and sub-5-second performance target.
"""
import asyncio
from datetime import date, timedelta
import json
import time
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_permission_baseline import disposable_operator, ROOT
from test_permission_content import call, set_bit
from test_permission_foundations import permission_accounts, h
from test_project_content_core import runtime
from test_content_workflow import inventory_brand_fixture
from test_unit_type_workflow import create_type, project as project_factory
from sena_hub_api.workspace_home import workspace_href


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
        db = await runtime()
        try:
            p = await project_factory(db, ids['editor'])
            p_core = await call(db, ids['editor'], 'select to_jsonb(p) from hub.projects p where id=$1', p['id'])
            unit = await create_type(db, ids['editor'], p)
            today = date.today()

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

            # Case 6: Form mismatch (question requires 'condo', project is 'house')
            q6 = f'q_form_mismatch_{uuid4().hex[:8]}'
            await create_q(q6, forms=['condo_non_matching'], q_keys=['project.common_fee'])
            await create_ans('project', p['rem_project_id'], q6, ans_keys=['project.common_fee'])

            # Compare helper cells vs composer cells for project context and unit context
            for u_pub in (None, unit['public_commercial_type_id']):
                helper_cells = (await call(db, ids['viewer'],
                    "select hub.workspace_missing_fact_cells($1, $2)", p['id'], u_pub))['cells']

                composer_raw = await call(db, ids['viewer'],
                    "select hub.compose_project_faq($1, 'th', $2, false, false)", p['id'], u_pub)
                expected_cells = [
                    {
                        'question_key': c['question_key'],
                        'question_label': c['question_label'],
                        'state': 'waiting_for_fact',
                        'missing_fact_keys': sorted(c['missing_fact_keys'])
                    }
                    for c in composer_raw.get('cells', [])
                    if c.get('state') == 'waiting_for_fact'
                ]
                expected_cells.sort(key=lambda x: (x.get('web_sort', 0), x['question_key']))

                # Filter both to our test questions
                test_q_keys = {q1, q2, q3, q4, q5, q6}
                matched_helper = [c for c in helper_cells if c['question_key'] in test_q_keys]
                matched_expected = [c for c in expected_cells if c['question_key'] in test_q_keys]

                assert len(matched_helper) == len(matched_expected)
                for h_cell, e_cell in zip(matched_helper, matched_expected):
                    assert h_cell['question_key'] == e_cell['question_key']
                    assert h_cell['question_label'] == e_cell['question_label']
                    assert h_cell['state'] == e_cell['state']
                    assert sorted(h_cell['missing_fact_keys']) == sorted(e_cell['missing_fact_keys'])
        finally:
            await db.close()

    asyncio.run(check())


def test_workspace_home_rollback_and_forward_equivalence(permission_accounts):
    """Full home output equivalence between the rollback composition path and forward projection helper."""
    client, ids = permission_accounts

    async def check():
        operator = await disposable_operator()
        try:
            # 1. Capture current forward output
            resp_forward = client.get('/v1/admin/content/home', params={'task': 'fact_missing', 'limit': 100}, headers=h('viewer'))
            assert resp_forward.status_code == 200, resp_forward.text
            data_forward = resp_forward.json()['data']

            # 2. Rollback workspace_home in the disposable database
            rollback_sql = """
            do $$
            declare definition text;
            begin
             definition := replace(pg_get_functiondef('hub.workspace_home(text,text,integer,integer,text,uuid)'::regprocedure), E'\\r\\n', E'\\n');
             definition := hub.content_definition_replace(definition,
              'preview:=hub.workspace_missing_fact_cells(p.id,faq_scope.public_id);',
              'preview:=hub.compose_project_faq(p.id,''th'',faq_scope.public_id,false,false);');
             execute definition;
            end $$;
            """
            await operator.execute(rollback_sql)

            # 3. Capture rollback output
            resp_rollback = client.get('/v1/admin/content/home', params={'task': 'fact_missing', 'limit': 100}, headers=h('viewer'))
            assert resp_rollback.status_code == 200, resp_rollback.text
            data_rollback = resp_rollback.json()['data']

            # 4. Compare every field
            assert data_forward['project_total'] == data_rollback['project_total']
            assert data_forward['task_total'] == data_rollback['task_total']
            assert len(data_forward['tasks']) == len(data_rollback['tasks'])

            for f_task, r_task in zip(data_forward['tasks'], data_rollback['tasks']):
                assert f_task['id'] == r_task['id']
                assert f_task['kind'] == r_task['kind']
                assert f_task['title'] == r_task['title']
                assert f_task['category'] == r_task['category']
                assert f_task['priority'] == r_task['priority']
                assert f_task['due'] == r_task['due']
                assert f_task['href'] == r_task['href']
                assert f_task['context'] == r_task['context']

            # 5. Restore forward definition
            forward_sql = """
            do $$
            declare definition text;
            begin
             definition := replace(pg_get_functiondef('hub.workspace_home(text,text,integer,integer,text,uuid)'::regprocedure), E'\\r\\n', E'\\n');
             definition := hub.content_definition_replace(definition,
              'preview:=hub.compose_project_faq(p.id,''th'',faq_scope.public_id,false,false);',
              'preview:=hub.workspace_missing_fact_cells(p.id,faq_scope.public_id);');
             execute definition;
            end $$;
            """
            await operator.execute(forward_sql)
        finally:
            await operator.close()

    asyncio.run(check())


def test_home_missing_fact_timing_benchmark(permission_accounts):
    """300-project scale benchmark asserting whole-home HTTP and SQL < 5.0 seconds."""
    client, ids = permission_accounts

    async def check():
        operator = await disposable_operator()
        try:
            # Check current project volume
            count = await operator.fetchval("select count(*) from hub.projects where deleted_at is null")
            if count < 300:
                needed = 300 - count
                brand = await operator.fetchrow("select id, public_brand_id from hub.brands where deleted_at is null limit 1")
                # Batch insert synthetic projects
                rem_ids = [f'SCALE_P_{i}_{uuid4().hex[:6]}' for i in range(needed)]
                for r_id in rem_ids:
                    await operator.execute("""
                        insert into staging.rem_projects(rem_project_id, project_name_rem, source_fingerprint)
                        values($1, $2, $3)
                    """, r_id, f'Scale Project {r_id}', 'scale-test')
                    await operator.execute("""
                        select hub.create_project_from_rem($1)
                    """, r_id)
                await operator.execute("""
                    update hub.projects set brand_id = $1 where brand_id is null
                """, brand['id'])

            # Benchmark SQL execution
            start_sql = time.perf_counter()
            row = await operator.fetchval("select hub.workspace_home(null, null, 0, 25, null, null)")
            elapsed_sql = time.perf_counter() - start_sql
            assert elapsed_sql < 5.0, f"SQL workspace_home took {elapsed_sql:.3f}s >= 5.0s"

            # Benchmark HTTP execution (5 repeated runs)
            http_times = []
            for _ in range(5):
                start_http = time.perf_counter()
                resp = client.get('/v1/admin/content/home', headers=h('viewer'))
                assert resp.status_code == 200, resp.text
                elapsed_http = time.perf_counter() - start_http
                http_times.append(elapsed_http)

            median_http = sorted(http_times)[len(http_times) // 2]
            max_http = max(http_times)
            assert max_http < 5.0, f"Max HTTP home request took {max_http:.3f}s >= 5.0s (median: {median_http:.3f}s)"
        finally:
            await operator.close()

    asyncio.run(check())
