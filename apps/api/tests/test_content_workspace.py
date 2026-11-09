"""W3 caller-scope and audit regressions on the verified disposable cluster."""
import json
from uuid import UUID, uuid4

import asyncpg
import pytest
from pydantic import ValidationError

from sena_hub_api.content_workspace import WebsiteDecision
from test_permission_baseline import disposable_operator
from test_permission_content import call, set_bit
from test_permission_foundations import permission_accounts, h
from test_project_content_core import run, runtime as rolled_back_runtime
from test_permission_db_baseline import runtime as permission_runtime
from test_website_content import project_fixture, source
from test_unit_type_workflow import create_type, save_price
from test_faq_intake import app as operator_call, rolled_back
from test_articles import content as article_content


async def runtime():
    # These tests observe committed state through HTTP and separate operator
    # connections. Each guarded call owns its transaction; an outer rollback
    # transaction would hide those writes and deadlock an operator update.
    db = await permission_runtime()
    await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
    return db


@pytest.mark.parametrize('body', [
    {}, {'expected_decision_id': None, 'decision': 'publish'},
    {'expected_decision_id': None, 'decision': 'use'},
    {'expected_decision_id': None, 'decision': 'use', 'expected_revision': True},
    {'expected_decision_id': '9223372036854775808', 'decision': 'reject', 'reason': 'Synthetic'},
    {'expected_decision_id': None, 'decision': 'reject', 'reason': ' '},
    {'expected_decision_id': None, 'decision': 'reject', 'reason': 'Synthetic', 'expected_revision': 1},
    {'expected_decision_id': None, 'decision': 'use', 'expected_revision': 0, 'changes': {'body': {'th': 'Override'}}},
    {'expected_decision_id': None, 'decision': 'edit_use', 'expected_revision': 0, 'changes': {'source_ref': 'https://invalid.test/'}},
    {'expected_decision_id': None, 'decision': 'edit_use', 'expected_revision': 0, 'changes': {'body': {'th': 'x' * 64001}}},
])
def test_website_decision_rejects_ambiguous_or_unbounded_requests(body):
    with pytest.raises(ValidationError):
        WebsiteDecision.model_validate(body)


@pytest.mark.parametrize('choice', ['use', 'edit_use', 'reject'])
def test_website_decision_accepts_only_normal_draft_fields(choice):
    body = {'expected_decision_id': None, 'decision': choice}
    if choice == 'reject':
        body['reason'] = 'Not applicable to this phase'
    else:
        body['expected_revision'] = 0
        if choice == 'edit_use':
            body['changes'] = {'body': {'th': 'Confirmed narrative'}, 'ai_exposure': 'internal'}
    assert WebsiteDecision.model_validate(body).decision == choice


async def setup_project(actor, *, count=1):
    db = await disposable_operator()
    await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
    try:
        projects = []
        for _ in range(count):
            project = await project_fixture(db, actor)
            # The generic website fixture deliberately leaves brand assignment
            # unresolved. These workspace cases exercise both exact source
            # references, so give each synthetic project its own explicit brand.
            rem_brand = 'W3_BRAND_' + uuid4().hex
            await db.execute('''insert into staging.rem_brands
                (rem_brand_id,brand_name_rem,is_deleted,source_updated_at,source_fingerprint)
                values($1,'Synthetic workspace brand',false,now(),$2)''', rem_brand, uuid4().hex * 2)
            brand = await db.fetchval('''insert into hub.brands(rem_brand_id,public_name)
                values($1,$2) returning id''', rem_brand, {'th': 'Synthetic workspace brand'})
            await db.execute('update staging.rem_projects set rem_brand_id=$2 where rem_project_id=$1',
                             project['rem_project_id'], rem_brand)
            await db.execute('update hub.projects set brand_id=$2 where id=$1', project['id'], brand)
            projects.append(dict(await db.fetchrow('select * from hub.projects where id=$1', project['id'])))
        return projects
    finally:
        await db.close()


async def candidate_fixture(projects, value='Synthetic narrative', kind='description', legacy_kind='fact'):
    db = await disposable_operator()
    await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
    try:
        digest = uuid4().hex * 2
        await db.execute("insert into staging.knowledge_batches(manifest_sha256,manifest) values($1,'{}')", digest)
        identity = uuid4()
        evidence = {'source_kind': 'sena_public_website', 'website_item_kind': kind, 'website_value': value,
                    'website_source': {**source(projects[0]['rem_project_id']), 'project_ids': [p['rem_project_id'] for p in projects]},
                    'website_wiring': {'outcome': 'not_created'}}
        await db.execute('''insert into staging.knowledge_candidates(id,batch_sha256,source_key,kind,project_ids,topic,source_ref,source_url,evidence,holds)
            values($1,$2,$3,$4,$5,'design','synthetic','https://www.sena.co.th/project/synthetic',$6,'{}')''',
            identity, digest, str(identity), legacy_kind, [p['rem_project_id'] for p in projects], evidence)
        return identity
    finally:
        await db.close()


async def audit_count():
    db = await disposable_operator()
    try:
        return await db.fetchval('select count(*) from audit.change_log')
    finally:
        await db.close()


def test_workspace_tree_page_and_faq_gets_are_read_only_and_bounded(permission_accounts):
    client, ids = permission_accounts

    async def setup():
        return (await setup_project(ids['editor']))[0]
    p = run(setup())
    before = run(audit_count())
    paths = [
        '/v1/admin/content/workspace/tree?limit=1',
        f"/v1/admin/content/workspace/project/{p['public_project_id']}",
        f"/v1/admin/content/workspace/project/{p['public_project_id']}/faq",
        f"/v1/admin/content/workspace/project/{p['public_project_id']}/history",
        f"/v1/admin/content/workspace/project/{p['public_project_id']}/promotions?limit=1",
        f"/v1/admin/content/workspace/project/{p['public_project_id']}/promotions/suggestions?limit=1",
    ]
    for path in paths:
        response = client.get(path, headers=h('viewer'))
        assert response.status_code == 200, response.text
        assert response.headers['cache-control'] == 'no-store'
    assert run(audit_count()) == before
    page = client.get(paths[1], headers=h('viewer')).json()['data']
    assert page['selected_phase'] == p['rem_project_id']
    assert page['entity']['ref'] == p['public_project_id']
    roots = client.get('/v1/admin/content/workspace/tree', headers=h('viewer')).json()['data']
    assert all(item['parent'] is None and item['kind'] != 'programme' for item in roots['items'])
    assert all(item['kind'] == 'programme' for item in roots['programmes'])
    searched = client.get('/v1/admin/content/workspace/tree', params={'q': p['public_project_id']}, headers=h('viewer')).json()['data']
    assert any(item['ref'] == p['public_project_id'] for item in searched['items'])
    assert page['tabs'] == ['overview', 'data', 'unit-types', 'promotions', 'media', 'faq', 'history']
    for entry in page['overview']['readiness']['required'] + page['overview']['readiness']['recommended']:
        assert entry['target']['field'] if entry['target']['tab'] != 'media' else entry['target']['media_slot']['rule_key']
    assert client.get('/v1/admin/content/workspace/tree?limit=101', headers=h('viewer')).status_code == 422
    assert client.get('/v1/admin/content/workspace/tree?parent_kind=brand', headers=h('viewer')).status_code == 422
    assert client.get(paths[1] + '?phase=UNRELATED', headers=h('viewer')).status_code == 404


def test_workspace_source_denial_positive_neighbour_and_admin_without_management(permission_accounts):
    client, ids = permission_accounts
    p = run(setup_project(ids['editor']))[0]
    path = f"/v1/admin/content/workspace/project/{p['public_project_id']}"
    assert client.get(path, headers=h('viewer')).status_code == 200
    run(set_bit(ids['viewer'], 'projects', can_view=False))
    faq_only = client.get(path, headers=h('viewer'))
    assert faq_only.status_code == 200 and faq_only.json()['data']['tabs'] == ['faq', 'history']
    assert faq_only.json()['data']['faq_only'] is True
    assert client.get(path + '/preview', headers=h('viewer')).status_code == 403
    tree = client.get('/v1/admin/content/workspace/tree', params={'q': p['public_project_id']}, headers=h('viewer'))
    assert tree.status_code == 200
    fallback = next(x for x in tree.json()['data']['items'] if x['ref'] == p['public_project_id'])
    assert fallback['target']['tab'] == 'faq' and fallback['faq_only'] is True
    assert fallback['visible_phase_count'] == 0 and fallback['parent'] is None and fallback['has_children'] is False
    assert client.get(path, headers=h('editor')).status_code == 200
    for role in ('viewer', 'editor', 'publisher', 'agency', 'service_consumer', 'pending'):
        assert client.get('/v1/admin/content/activity', headers=h(role)).status_code == 403
        assert client.get('/v1/admin/knowledge/projects', headers=h(role)).status_code == 403
    async def remove_account_management():
        db = await disposable_operator()
        try:
            await db.execute('update hub.user_account set can_manage_users=false where id=$1', ids['admin'])
        finally:
            await db.close()
    run(remove_account_management())
    assert client.get('/v1/admin/content/activity', headers=h('admin')).status_code == 200
    assert client.get('/v1/admin/knowledge/projects', headers=h('admin')).status_code == 200
    run(set_bit(ids['admin'], 'knowledge', can_edit=False, can_approve=False, special_actions=[], can_view=False))
    assert client.get('/v1/admin/knowledge/projects', headers=h('admin')).status_code == 403


def test_website_use_edit_reject_are_atomic_phase_specific_and_keep_evidence(permission_accounts):
    _, ids = permission_accounts

    async def check():
        projects = await setup_project(ids['editor'], count=2)
        candidate = await candidate_fixture(projects)
        db = await runtime()
        sql = 'select hub.website_text_decide($1,$2,$3,$4,$5,$6,$7)'
        try:
            one = await call(db, ids['editor'], sql, projects[0]['public_project_id'], candidate, None, 'use', 0, {}, 'Confirmed source')
            assert one['saved']['version']['state'] == 'DRAFT'
            assert one['saved']['version']['body']['th'] == 'Synthetic narrative'
            assert one['saved']['version']['source_ref'] == 'https://www.sena.co.th/project/synthetic'
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], sql, projects[0]['public_project_id'], candidate, None, 'use', 0, {}, None)
            two = await call(db, ids['editor'], sql, projects[1]['public_project_id'], candidate, None, 'reject', None, {}, 'Does not apply here')
            assert two['saved'] is None
            changed = await call(db, ids['editor'], sql, projects[0]['public_project_id'], candidate, int(one['decision_id']), 'edit_use',
                                 one['saved']['revision'], {'body': {'th': 'Independently confirmed text', 'en': 'English preserved'}}, 'Edited and confirmed')
            assert changed['saved']['revision'] == one['saved']['revision'] + 1
            rejected = await call(db, ids['editor'], sql, projects[0]['public_project_id'], candidate, int(changed['decision_id']), 'reject', None, {}, 'Dismiss source')
            assert rejected['saved'] is None
            section = await call(db, ids['viewer'], 'select hub.project_content_sections($1)', projects[0]['public_project_id'])
            item = next(x for x in section['sections'] if x['section_key'] == 'section.project_intro')
            assert item['state'] == 'DRAFT' and item['version']['body']['en'] == 'English preserved'
            assert len(item['history']) == 2
            sources = await call(db, ids['viewer'], 'select hub.website_content_sources($1)', projects[1]['public_project_id'])
            row = next(x for x in sources if x['id'] == str(candidate))
            assert row['decision'] == 'reject' and row['source']['confirmed'] is False
            assert row['wiring'] == {'outcome': 'not_created'}
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], sql, projects[1]['public_project_id'], candidate, int(two['decision_id']), 'use', 0, {}, None)
        finally:
            await db.close()
    run(check())


def test_numeric_evidence_and_legacy_faq_never_use_old_accept_path(permission_accounts):
    client, ids = permission_accounts

    async def check():
        projects = await setup_project(ids['editor'])
        numeric = await candidate_fixture(projects, 'Synthetic 500 amount')
        faq = await candidate_fixture(projects, legacy_kind='faq')
        db = await runtime()
        try:
            for choice in ('use', 'edit_use'):
                with pytest.raises(asyncpg.CheckViolationError):
                    await call(db, ids['editor'], 'select hub.website_text_decide($1,$2,null,$3,0,$4,null)',
                               projects[0]['public_project_id'], numeric, choice,
                               {} if choice == 'use' else {'body': {'th': 'Synthetic 500 amount'}})
            for choice in ('accepted', 'rejected', 'missing'):
                with pytest.raises(asyncpg.CheckViolationError, match='read-only'):
                    await call(db, ids['admin'], 'select hub.review_knowledge_candidate($1,0,$2,$3,$4,false,null,null)',
                               faq, choice, [projects[0]['rem_project_id']], 'Synthetic N7 check')
            assert await call(db, ids['admin'], 'select count(*) from hub.faqs where candidate_id=$1', faq) == 0
            assert await call(db, ids['admin'], 'select count(*) from hub.knowledge_reviews where candidate_id=$1', faq) == 0
        finally:
            await db.close()
        result = client.post(f'/v1/admin/knowledge/candidates/{faq}/review', headers=h('admin'), json={
            'expected_revision': 0, 'decision': 'accepted', 'applies_to_project_ids': [projects[0]['rem_project_id']], 'reason': 'Synthetic N7 check'})
        assert result.status_code == 422
    run(check())


def test_history_allowlist_diffs_and_current_revocation(permission_accounts):
    client, ids = permission_accounts

    async def check():
        projects = await setup_project(ids['editor'])
        p = projects[0]
        db = await runtime()
        try:
            saved = await call(db, ids['editor'], "select hub.save_content_section('project',$1,'section.project_intro',0,$2)",
                               p['public_project_id'], {'body': {'th': 'First narrative'}, 'source_ref': 'synthetic'})
            await call(db, ids['editor'], "select hub.save_content_section('project',$1,'section.project_intro',$2,$3)",
                       p['public_project_id'], saved['revision'], {'body': {'th': 'Second narrative'}, 'source_ref': 'synthetic'})
            listing = await call(db, ids['viewer'], 'select hub.content_history($1,$2,null,100)', 'project', p['public_project_id'])
            assert listing['items']
            event = next(x for x in listing['items'] if x['section_key'] == 'section.project_intro' and x['diff_available'])
            detail = await call(db, ids['viewer'], 'select hub.content_history_event($1,$2,$3)', 'project', p['public_project_id'], int(event['audit_id']))
            assert 'before' in detail and 'after' in detail and detail['changed_field_keys']
            serialized = json.dumps(detail)
            for secret in ('email', 'can_manage_users', 'special_actions', 'storage_path', 'database_role', 'before_row', 'after_row'):
                assert secret not in serialized
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.content_activity($1,null,50)', {})
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['admin'], 'select * from audit.change_log limit 1')
            for helper in ('workspace_history_fields(text,jsonb)', 'workspace_history_contexts(text,jsonb)',
                           'website_text_latest(uuid,uuid)', 'review_knowledge_candidate_before_workspace(uuid,integer,text,text[],text,boolean,text,text)'):
                assert not await call(db, ids['admin'], "select has_function_privilege('hub_app',$1,'execute')", 'hub.' + helper)
            await set_bit(ids['viewer'], 'projects', can_view=False)
            with pytest.raises(asyncpg.NoDataFoundError):
                await call(db, ids['viewer'], 'select hub.content_history_event($1,$2,$3)', 'project', p['public_project_id'], int(event['audit_id']))
        finally:
            await db.close()
    run(check())


def test_article_leaf_translation_history_uses_its_article_reference(permission_accounts):
    _, ids = permission_accounts

    async def check():
        async with rolled_back() as operator:
            await operator.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
            article = await operator_call(operator, ids['editor'], 'select hub.article_save(null,0,$1)', article_content())
            assert await operator.fetchval("""select exists(select 1 from hub.content_translations
                where owner_type='article' and row_ref->>'article_id'=$1 and owner_key like '%:blocks.%')""", article['id'])
            history = await operator_call(operator, ids['viewer'], 'select hub.content_history($1,$2,null,100)', 'corporate', 'sena')
            assert any(item['section_key'] == 'article.blocks' for item in history['items'])
            await operator.execute("update hub.account_permission set can_view=false where account_id=$1 and tab='knowledge'", ids['viewer'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await operator_call(operator, ids['viewer'], 'select hub.content_history($1,$2,null,100)', 'corporate', 'sena')
    run(check())


def test_faq_all_approved_questions_names_and_exact_legacy_resolution(permission_accounts):
    client, ids = permission_accounts

    async def check():
        p = (await setup_project(ids['editor']))[0]
        db = await runtime()
        try:
            key = 'workspace_' + uuid4().hex[:16]
            await call(db, ids['editor'], 'select hub.save_faq_question($1,0,$2)', key, {
                'topic': 'design', 'default_level': 'project', 'question_template': {'th': 'Synthetic empty optional question'},
                'answer_kind': 'text', 'is_core': False, 'show_on_project_pages': True})
            await call(db, ids['publisher'], "select hub.approve_faq_question($1,1,'approved')", key)
            data = await call(db, ids['viewer'], 'select hub.workspace_faq($1,$2,null,$3,null,50,$4)', 'project', p['public_project_id'], 'Synthetic empty', 'th')
            item = next(x for x in data['items'] if x['question_key'] == key)
            assert item['display_state'] == 'missing'
            saved = await call(db, ids['editor'], 'select hub.save_faq(null,0,$1)', {
                'question_key': key, 'scope_type': 'project', 'scope_id': p['rem_project_id'], 'applies_to_project_ids': [p['rem_project_id']],
                'question': {'th': 'Synthetic question'}, 'short_answer': {'th': 'Synthetic answer'}, 'answer_kind': 'text'})
            target = await call(db, ids['viewer'], 'select hub.workspace_resolve($1,null)', UUID(saved['id']))
            assert target == {'level': 'project', 'id': p['public_project_id'], 'tab': 'faq', 'phase': p['rem_project_id'], 'question_key': key, 'item': saved['id']}
            data = await call(db, ids['viewer'], 'select hub.workspace_faq($1,$2,null,$3,null,50,$4)', 'project', p['public_project_id'], 'Synthetic empty', 'th')
            item = next(x for x in data['items'] if x['question_key'] == key)
            assert item['own_answer']['revision'] == saved['revision']
            assert item['effective_answer']['author']['id'] == str(ids['editor'])
            assert item['effective_answer']['source']['scope_id'] == p['rem_project_id']
            await set_bit(ids['viewer'], 'knowledge', can_view=False)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.workspace_resolve($1,null)', UUID(saved['id']))
        finally:
            await db.close()
    run(check())


def test_exact_faq_question_beyond_first_page_keeps_scope_and_regular_cursors(permission_accounts):
    client, ids = permission_accounts

    async def check():
        p, neighbour = await setup_project(ids['editor'], count=2)
        db = await runtime()
        prefix = 'workspace_exact_' + uuid4().hex[:12] + '_'
        try:
            keys = [prefix + f'{index:03d}' for index in range(65)]
            for index, key in enumerate(keys + [prefix + 'proposed']):
                await call(db, ids['editor'], 'select hub.save_faq_question($1,0,$2)', key, {
                    'topic': 'design', 'default_level': 'project',
                    'question_template': {'th': 'Synthetic exact-selection question'},
                    'answer_kind': 'text', 'is_core': False, 'show_on_project_pages': True,
                    'web_sort': 9000 + index})
                if key in keys:
                    await call(db, ids['publisher'], "select hub.approve_faq_question($1,1,'approved')", key)
            saved = await call(db, ids['editor'], 'select hub.save_faq(null,0,$1)', {
                'question_key': keys[-1], 'scope_type': 'project', 'scope_id': p['rem_project_id'],
                'applies_to_project_ids': [p['rem_project_id']], 'question': {'th': 'Synthetic exact question'},
                'short_answer': {'th': 'Exact answer belongs only to this phase'}, 'answer_kind': 'text'})
            base = f"/v1/admin/content/workspace/project/{p['public_project_id']}/faq"
            before = await audit_count()
            first = client.get(base, params={'q': prefix, 'limit': 50}, headers=h('viewer'))
            assert first.status_code == 200
            page = first.json()['data']
            assert [row['question_key'] for row in page['items']] == keys[:50]
            assert page['next_cursor'] and keys[-1] not in [row['question_key'] for row in page['items']]
            selected = client.get(base, params={'question_key': keys[-1], 'phase': p['rem_project_id']}, headers=h('viewer'))
            assert selected.status_code == 200 and selected.headers['cache-control'] == 'no-store'
            exact = selected.json()['data']
            assert [row['question_key'] for row in exact['items']] == [keys[-1]]
            assert exact['items'][0]['own_answer']['id'] == saved['id']
            assert exact['next_cursor'] is None and exact['unmatched_next_cursor'] is None and exact['unmatched_clusters'] == []
            # Exact selection is independent of, and does not consume, normal cursors.
            again = client.get(base, params={'q': prefix, 'limit': 50}, headers=h('viewer')).json()['data']
            assert again == page
            rest = client.get(base, params={'q': prefix, 'after': page['next_cursor'], 'limit': 50}, headers=h('viewer')).json()['data']
            assert [row['question_key'] for row in rest['items']] == keys[50:] and rest['next_cursor'] is None
            # Search now matches the key even when the visible question text does not.
            searched = client.get(base, params={'q': keys[-1]}, headers=h('viewer')).json()['data']
            assert [row['question_key'] for row in searched['items']] == [keys[-1]]
            other_key = client.get(base, params={'question_key': keys[-2]}, headers=h('viewer')).json()['data']
            assert [row['question_key'] for row in other_key['items']] == [keys[-2]]
            assert other_key['items'][0]['effective_answer'] is None
            other_page = client.get(f"/v1/admin/content/workspace/project/{neighbour['public_project_id']}/faq",
                                    params={'question_key': keys[-1]}, headers=h('viewer')).json()['data']
            assert len(other_page['items']) == 1 and other_page['items'][0]['effective_answer'] is None
            for key in (prefix + 'missing', prefix + 'proposed'):
                absent = client.get(base, params={'question_key': key}, headers=h('viewer'))
                assert absent.status_code == 200 and absent.json()['data']['items'] == []
                assert absent.json()['data']['unmatched_clusters'] == []
            for parameters in ({'question_key': ''}, {'question_key': 'bad/key'}, {'question_key': 'x' * 102},
                               {'question_key': keys[-1], 'q': prefix}, {'question_key': keys[-1], 'q': ''},
                               {'question_key': keys[-1], 'after': page['next_cursor']}):
                assert client.get(base, params=parameters, headers=h('viewer')).status_code == 422
            assert client.get(base, params={'question_key': keys[-1], 'phase': neighbour['rem_project_id']}, headers=h('viewer')).status_code == 404
            assert client.get('/v1/admin/content/workspace/project/unknown_exact_source/faq', params={'question_key': keys[-1]}, headers=h('viewer')).status_code == 404
            assert await audit_count() == before
            await set_bit(ids['viewer'], 'knowledge', can_view=False)
            assert client.get(base, params={'question_key': keys[-1]}, headers=h('viewer')).status_code == 403
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.workspace_faq($1,$2,null,$3,$4,1,$5)',
                           'project', p['public_project_id'], '', 'q:' + keys[-1], 'th')
            allowed = client.get(base, params={'question_key': keys[-1]}, headers=h('editor'))
            assert allowed.status_code == 200 and allowed.json()['data']['items'][0]['question_key'] == keys[-1]
        finally:
            await db.close()
    run(check())


def test_corporate_faq_impact_requires_explicit_global_opt_in_and_preserves_manual_scope(permission_accounts):
    _, ids = permission_accounts

    async def check():
        p = (await setup_project(ids['editor']))[0]
        db = await rolled_back_runtime()
        prefix = 'Synthetic impact ' + uuid4().hex[:10]
        cases = {}
        try:
            for suffix, global_opt_in, projects in [('global', True, []), ('none', False, []), ('manual', True, [p['rem_project_id']])]:
                key = 'workspace_impact_' + uuid4().hex[:12]
                await call(db, ids['editor'], 'select hub.save_faq_question($1,0,$2)', key, {
                    'topic': 'design', 'default_level': 'corporate', 'question_template': {'th': prefix + suffix},
                    'answer_kind': 'text', 'show_on_project_pages': global_opt_in})
                await call(db, ids['publisher'], "select hub.approve_faq_question($1,1,'approved')", key)
                saved = await call(db, ids['editor'], 'select hub.save_faq(null,0,$1)', {
                    'question_key': key, 'scope_type': 'corporate', 'scope_id': 'sena', 'applies_to_project_ids': projects,
                    'question': {'th': prefix + suffix}, 'short_answer': {'th': 'Synthetic corporate answer'}, 'answer_kind': 'text'})
                cases[suffix] = (key, saved)
            composition = await call(db, ids['viewer'], 'select hub.faq_composition($1)', p['public_project_id'])
            cells = {row['question_key']: row for row in composition['cells']}
            assert cells[cases['global'][0]]['faq_id'] == cases['global'][1]['id']
            assert cells[cases['manual'][0]]['faq_id'] == cases['manual'][1]['id']
            assert cells[cases['none'][0]].get('faq_id') is None
            expected_global = await call(db, ids['viewer'], """select count(*) from hub.projects p where p.deleted_at is null
                and exists(select 1 from jsonb_array_elements(hub.faq_references()->'projects') x where x->>'id'=p.rem_project_id)""")
            await set_bit(ids['viewer'], 'projects', can_view=False)
            before = await audit_count()
            data = await call(db, ids['viewer'], 'select hub.workspace_faq($1,$2,null,$3,null,50,$4)', 'corporate', 'sena', prefix, 'th')
            rows = {row['question_key']: row for row in data['items']}
            assert rows[cases['global'][0]]['effective_answer']['source']['affected_project_count'] == expected_global
            assert rows[cases['none'][0]]['effective_answer']['source']['affected_project_count'] == 0
            assert rows[cases['manual'][0]]['effective_answer']['source']['affected_project_count'] == 1
            assert await audit_count() == before
        finally:
            await db.close()
    run(check())


@pytest.mark.parametrize('kind', ['project', 'brand', 'unit_type'])
def test_knowledge_only_faq_text_editor_targets_and_history_keep_source_tabs_closed(permission_accounts, kind):
    client, ids = permission_accounts

    async def check():
        p = (await setup_project(ids['editor']))[0]
        db = await runtime()
        operator = await disposable_operator()
        await operator.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        try:
            brand = await operator.fetchval('select public_brand_id from hub.brands where id=$1', p['brand_id'])
            full = await call(db, ids['editor'], 'select hub.project_detail($1)', p['public_project_id'])
            unit = await create_type(db, ids['editor'], full)
            ref = p['public_project_id'] if kind == 'project' else brand if kind == 'brand' else unit['id']
            scope_id = p['rem_project_id'] if kind == 'project' else ref
            questions = {}
            for suffix, answer_kind, keys in [('own', 'text', []), ('inherited', 'text', []), ('fact', 'fact', ['project.common_fee'])]:
                key = 'workspace_knowledge_' + uuid4().hex[:12]
                await call(db, ids['editor'], 'select hub.save_faq_question($1,0,$2)', key, {
                    'topic': 'design', 'default_level': kind, 'question_template': {'th': 'Synthetic Knowledge-only ' + suffix},
                    'answer_kind': answer_kind, 'fact_keys': keys, 'show_on_project_pages': True})
                await call(db, ids['publisher'], "select hub.approve_faq_question($1,1,'approved')", key)
                body = {'question_key': key, 'scope_type': 'corporate' if suffix == 'inherited' else kind,
                        'scope_id': 'sena' if suffix == 'inherited' else scope_id,
                        'applies_to_project_ids': [] if suffix == 'inherited' else [p['rem_project_id']],
                        'question': {'th': 'Synthetic Knowledge-only ' + suffix},
                        'short_answer': {'th': 'Knowledge text ' + suffix if suffix != 'fact' else 'Fact token {common_fee}'},
                        'answer_kind': answer_kind, 'fact_keys': keys,
                        'ai_exposure': 'internal'}
                saved = await call(db, ids['editor'], 'select hub.save_faq(null,0,$1)', body)
                questions[suffix] = (key, saved, body)
            source_event = await operator.fetchval('''insert into audit.change_log(database_role,table_name,operation,actor,after_row,reason)
                values('hub_app','hub.projects','UPDATE',$1,$2,'Synthetic source-only audit') returning id''', ids['editor'],
                {'id': str(p['id']), 'public_name': {'th': 'W3_SOURCE_ONLY_SECRET'}})
            private_name = 'W3_PRIVATE_PROJECT_NAME_' + uuid4().hex
            await operator.execute("select set_config('app.actor_id',$1,false)", str(ids['editor']))
            await operator.execute('update hub.projects set public_name=$2 where id=$1', p['id'], {'th': private_name})
            for role in ('viewer', 'editor', 'publisher'):
                await set_bit(ids[role], 'projects', can_edit=False, can_approve=False, special_actions=[], can_view=False)
                await set_bit(ids[role], 'brands', can_edit=False, can_approve=False, special_actions=[], can_view=False)
            before = await audit_count()
            path = f'/v1/admin/content/workspace/{kind}/{ref}'
            page_response = client.get(path, headers=h('viewer'))
            assert page_response.status_code == 200, page_response.text
            page = page_response.json()['data']
            assert page['faq_only'] is True and page['tabs'] == ['faq', 'history'] and page['sections'] == []
            assert page['overview'] == {'readiness': {'required': [], 'recommended': []}, 'tasks': [],
                                        'changes_since_publication': [], 'preview_target': None}
            assert set(page['entity']) == {'kind', 'ref', 'name', 'scope_type', 'scope_id'}
            assert all(set(phase) == {'public_project_id', 'rem_project_id', 'name'} for phase in page['phases'])
            references = (await call(db, ids['viewer'], 'select hub.faq_references()'))
            for discovery_kind, discovery_ref, reference_key, source_id in [
                    ('project', p['public_project_id'], 'projects', p['rem_project_id']), ('brand', brand, 'brands', brand)]:
                minimal_name = next(row['name'] for row in references[reference_key] if row['id'] == source_id)
                tree = client.get('/v1/admin/content/workspace/tree', params={'q': discovery_ref}, headers=h('viewer'))
                assert tree.status_code == 200, tree.text
                node = next(row for row in tree.json()['data']['items'] if row['kind'] == discovery_kind and row['ref'] == discovery_ref)
                assert node['name'] == {'th': minimal_name} and node['faq_only'] is True
                assert node['target'] == {'level': discovery_kind, 'id': discovery_ref, 'tab': 'faq'}
                expected_parent = {'kind': 'business', 'ref': 'residential'} if discovery_kind == 'brand' else None
                assert node['parent'] == expected_parent and node['has_children'] is False and node['visible_phase_count'] == 0
                assert node['grouping']['review_href'] is None
                search = client.get('/v1/admin/content/search', params={'q': discovery_ref}, headers=h('viewer'))
                assert search.status_code == 200, search.text
                found = [row for row in search.json()['data']['items'] if row['kind'] == discovery_kind and row['ref'] == discovery_ref]
                assert len(found) == 1 and found[0]['label'] == {'th': minimal_name}
                assert found[0]['context'] == {discovery_kind: discovery_ref, 'tab': 'faq'} and 'tab=faq' in found[0]['href']
            assert client.get('/v1/admin/content/search', params={'q': private_name}, headers=h('viewer')).json()['data']['items'] == []
            assert client.get('/v1/admin/content/workspace/tree', params={'q': private_name}, headers=h('viewer')).json()['data']['items'] == []
            for role in ('viewer', 'editor', 'publisher'):
                response = client.get(path + '/faq', params={'q': 'Synthetic Knowledge-only'}, headers=h(role))
                assert response.status_code == 200, response.text
                rows = {row['question_key']: row for row in response.json()['data']['items']}
                own = rows[questions['own'][0]]
                assert own['own_answer']['id'] == questions['own'][1]['id']
                assert own['effective_answer']['short_answer']['th'] == 'Knowledge text own'
                assert rows[questions['inherited'][0]]['effective_answer']['short_answer']['th'] == 'Knowledge text inherited'
                assert rows[questions['inherited'][0]]['display_state'] == 'inherited'
                assert rows[questions['inherited'][0]]['effective_answer']['source']['affected_project_count'] > 0
                assert all(rows[key]['facts'] == [] and rows[key]['effective_answer']['rendered'] is None
                           for key, _, _ in questions.values())
                target = own['effective_answer']['source']['target']
                assert target['level'] == kind and target['id'] == ref and target['item'] == questions['own'][1]['id']
                assert client.get('/v1/admin/content/workspace/resolve', params={'faq': target['item']}, headers=h(role)).json()['data'] == target
                assert client.get(f"/v1/admin/faq/{target['item']}", headers=h(role)).status_code == 200
                if role == 'editor':
                    assert own['targets']['edit_source'] == target
                    assert rows[questions['inherited'][0]]['targets']['create_override']['id'] == ref
                else:
                    assert 'edit_source' not in own['targets']
                if role == 'publisher':
                    assert await call(db, ids[role], "select hub.can('knowledge','approve')")
                assert client.get(f"/v1/admin/projects/{p['public_project_id']}", headers=h(role)).status_code == 403
                assert client.get(f'/v1/admin/brands/{brand}', headers=h(role)).status_code == 403
                assert client.get(f"/v1/admin/content/workspace/project/{p['public_project_id']}/preview", headers=h(role)).status_code == 403
                for sql in ('select hub.project_content($1)', 'select hub.faq_composition($1)'):
                    with pytest.raises(asyncpg.InsufficientPrivilegeError):
                        await call(db, ids[role], sql, p['public_project_id'])
            timeline = await call(db, ids['viewer'], 'select hub.content_history($1,$2,null,100)', kind, ref)
            own_events = [event for event in timeline['items'] if event['target'].get('item') == questions['own'][1]['id'] and event['section_key'] == 'faq']
            assert own_events and all(event['source_tab'] == 'knowledge' for event in timeline['items'])
            detail = await call(db, ids['viewer'], 'select hub.content_history_event($1,$2,$3)', kind, ref, int(own_events[0]['audit_id']))
            assert detail['source_tab'] == 'knowledge' and detail['section_key'] == 'faq'
            assert 'W3_SOURCE_ONLY_SECRET' not in json.dumps(timeline) + json.dumps(detail)
            with pytest.raises(asyncpg.NoDataFoundError):
                await call(db, ids['viewer'], 'select hub.content_history_event($1,$2,$3)', kind, ref, source_event)
            assert await audit_count() == before
            key, saved, body = questions['own']
            edited = client.put(f"/v1/admin/faq/{saved['id']}", headers=h('editor'), json={
                'expected_revision': saved['revision'], 'changes': {**body, 'short_answer': {'th': 'Knowledge-only saved draft'}}})
            assert edited.status_code == 200 and edited.json()['data']['revision'] == saved['revision'] + 1
            await set_bit(ids['viewer'], 'knowledge', can_view=False)
            for suffix in ('', '/faq', '/history'):
                assert client.get(path + suffix, headers=h('viewer')).status_code == 403
            assert client.get('/v1/admin/content/workspace/resolve', params={'faq': saved['id']}, headers=h('viewer')).status_code == 403
            assert client.get('/v1/admin/content/search', params={'q': p['public_project_id']}, headers=h('viewer')).json()['data']['items'] == []
            assert client.get('/v1/admin/content/workspace/tree', params={'q': p['public_project_id']}, headers=h('viewer')).status_code == 403
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.content_history_event($1,$2,$3)', kind, ref, int(own_events[0]['audit_id']))
            assert client.get(path + '/faq', headers=h('editor')).status_code == 200
            assert client.get(path + '/faq', headers=h('publisher')).status_code == 200
        finally:
            await db.close()
            await operator.close()
    run(check())


def test_first_draft_preview_is_ephemeral_escaped_and_rechecks_sources(permission_accounts):
    client, ids = permission_accounts
    p = run(setup_project(ids['editor']))[0]
    path = f"/v1/admin/content/workspace/project/{p['public_project_id']}/preview"
    before = run(audit_count())
    response = client.get(path, headers=h('viewer'))
    assert response.status_code == 200, response.text
    data = response.json()['data']
    assert data['mode'] == 'PRIVATE_DRAFT' and data['saved'] is False
    assert '<article' in data['html'] and 'preview_assets' not in data
    assert run(audit_count()) == before
    assert client.get(path + '?locale=xx', headers=h('viewer')).status_code == 422
    assert client.get(path + '?phase=UNRELATED', headers=h('viewer')).status_code == 404
    run(set_bit(ids['viewer'], 'knowledge', can_view=False))
    assert client.get(path, headers=h('viewer')).status_code == 403
    assert client.get(path, headers=h('editor')).status_code == 200
    assert run(audit_count()) >= before  # only the explicit permission fixture changed


def test_only_unambiguous_published_page_membership_groups_projects(permission_accounts):
    _, ids = permission_accounts

    async def check():
        projects = await setup_project(ids['editor'], count=2)
        operator = await disposable_operator()
        await operator.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        scope = operator.transaction()
        await scope.start()
        refs = [p['public_project_id'] for p in projects]

        async def publish_fixture(anchor, *, revision=1):
            page = await operator.fetchval('''insert into hub.web_pages(page_key,page_type,entity_ref,url,project_ids,revision)
                values($1,'project',$2,$3,$4,$5) returning id''', 'project:' + anchor, anchor, '/synthetic/' + uuid4().hex, refs, revision)
            payload = {'config_revision': revision, '_publication': {'approved_by': str(ids['publisher'])},
                       'body': {'phases': [{'_item': True, 'data': {'public_project_id': ref}} for ref in refs]}}
            version = await operator.fetchval('''insert into hub.entity_versions(entity_type,web_page_id,version_no,payload,content_sha256,publisher,change_reason)
                values('web_page',$1,1,$2,$3,$4,'Synthetic reviewed grouping') returning id''', page, payload, uuid4().hex * 2, ids['publisher'])
            await operator.execute('update hub.web_pages set published_version_id=$1 where id=$2', version, page)
            return page

        try:
            await operator.execute("select set_config('app.actor_id',$1,false)", str(ids['editor']))
            await operator.execute('update hub.projects set brand_id=$1 where id=$2', projects[0]['brand_id'], projects[1]['id'])
            get_tree = lambda: operator_call(operator, ids['viewer'], 'select hub.workspace_tree(null,null,$1,null,100)', refs[0])
            first = await get_tree()
            assert next(x for x in first['items'] if x['ref'] == refs[0])['grouping']['state'] == 'unconfirmed'
            page = await publish_fixture(refs[0])
            first = await get_tree()
            grouped = next(x for x in first['items'] if x['ref'] == refs[0])
            assert grouped['grouping']['state'] == 'confirmed' and grouped['visible_phase_count'] == 2
            detail = await operator_call(operator, ids['viewer'], 'select hub.workspace_page($1,$2,$3)', 'project', refs[0], projects[1]['rem_project_id'])
            assert detail['selected_phase'] == projects[1]['rem_project_id'] and len(detail['phases']) == 2
            legacy = await operator_call(operator, ids['viewer'], 'select hub.workspace_page($1,$2,null)', 'project', refs[1])
            assert legacy['selected_phase'] == projects[1]['rem_project_id'] and len(legacy['phases']) == 2
            assert legacy['entity']['grouping']['group_ref'] == refs[0]
            await operator.execute('update hub.web_pages set revision=revision+1 where id=$1', page)
            assert next(x for x in (await get_tree())['items'] if x['ref'] == refs[0])['grouping']['state'] == 'unconfirmed'
            await operator.execute('update hub.web_pages set revision=1 where id=$1', page)
            await publish_fixture(refs[1])
            assert next(x for x in (await get_tree())['items'] if x['ref'] == refs[0])['grouping']['state'] == 'unconfirmed'
        finally:
            await scope.rollback()
            await operator.close()
    run(check())


def test_history_omits_account_legal_and_hidden_batch_members(permission_accounts):
    _, ids = permission_accounts

    async def check():
        p = (await setup_project(ids['editor']))[0]
        operator = await disposable_operator()
        await operator.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        scope = operator.transaction()
        await scope.start()
        try:
            brand = await operator.fetchrow('select id,public_brand_id from hub.brands where deleted_at is null limit 1')
            assert brand is not None
            for kind, ref in [('project', p['public_project_id']), ('brand', brand['public_brand_id'])]:
                await operator.execute('''insert into hub.web_pages(page_key,page_type,entity_ref,url,project_ids)
                    values($1,$2,$3,$4,$5) on conflict(page_key) do nothing''', kind + ':' + ref, kind, ref,
                    '/synthetic/' + uuid4().hex, [ref] if kind == 'project' else [])
            entries = {
                'hub.account_permission': {'account_id': str(ids['admin']), 'project_id': str(p['id']), 'special_actions': ['private_account_value']},
                'hub.project_disclosures': {'id': str(uuid4()), 'project_id': str(p['id']), 'owner_company': 'private_legal_value'},
                'hub.web_publications': {'id': str(uuid4()), 'state': 'PUBLISHED', 'pages': [
                    {'snapshot': {'page_key': 'project:' + p['public_project_id']}},
                    {'snapshot': {'page_key': 'brand:' + brand['public_brand_id'], 'private_note': 'hidden_brand_member'}}]},
            }
            events = {}
            for table, value in entries.items():
                events[table] = await operator.fetchval('''insert into audit.change_log(actor,database_role,table_name,operation,after_row)
                    values($1,'hub_app',$2,'INSERT',$3) returning id''', ids['editor'], table, value)
            await set_bit(ids['viewer'], 'brands', can_view=False)
            history = await operator_call(operator, ids['viewer'], 'select hub.content_history($1,$2,null,100)', 'project', p['public_project_id'])
            visible = {int(x['audit_id']) for x in history['items']}
            assert events['hub.account_permission'] not in visible and events['hub.project_disclosures'] not in visible
            assert events['hub.web_publications'] in visible
            detail = await operator_call(operator, ids['viewer'], 'select hub.content_history_event($1,$2,$3)', 'project', p['public_project_id'], events['hub.web_publications'])
            serialized = json.dumps(detail)
            assert 'hidden_brand_member' not in serialized and brand['public_brand_id'] not in serialized and 'pages' not in detail['after']
            for table in ('hub.account_permission', 'hub.project_disclosures'):
                with pytest.raises(asyncpg.NoDataFoundError):
                    await operator_call(operator, ids['viewer'], 'select hub.content_history_event($1,$2,$3)', 'project', p['public_project_id'], events[table])
            legal = await operator_call(operator, ids['editor'], 'select hub.content_history_event($1,$2,$3)', 'project', p['public_project_id'], events['hub.project_disclosures'])
            assert legal['after']['owner_company'] == 'private_legal_value'
        finally:
            await scope.rollback()
            await operator.close()
    run(check())


def test_cluster_resolver_uses_exact_rem_brand_mapping_and_rechecks_view(permission_accounts):
    _, ids = permission_accounts

    async def check():
        p = (await setup_project(ids['editor']))[0]
        candidate = await candidate_fixture([p], legacy_kind='faq')
        operator = await disposable_operator()
        await operator.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        scope = operator.transaction()
        await scope.start()
        try:
            brand = await operator.fetchrow('select rem_brand_id,public_brand_id from hub.brands where id=$1', p['brand_id'])
            assert brand is not None
            cluster = await operator.fetchval('''insert into staging.faq_clusters(cluster_key,generation_sha256,algorithm,sort_key,
                template,member_candidate_ids,variants,answer_groups,project_ids,brand_ids,suggested_level,suggested_kind,suggestion_basis)
                values($1,$2,'synthetic',1,'Synthetic brand question',$3,'[{}]','[]',$4,$5,'brand','text','heuristic') returning id''',
                uuid4().hex * 2, uuid4().hex * 2, [candidate], [p['rem_project_id']], [brand['rem_brand_id']])
            target = await operator_call(operator, ids['viewer'], 'select hub.workspace_resolve(null,$1,$2)', cluster, p['rem_project_id'])
            assert target['level'] == 'brand' and target['id'] == brand['public_brand_id']
            assert target['phase'] == p['rem_project_id'] and target['item'] == str(cluster)
            controls = await operator_call(operator, ids['admin'], 'select hub.workspace_legacy_faq_candidates($1)', [candidate])
            assert controls[str(candidate)] == {'read_only': True, 'cluster_ids': [str(cluster)]}
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await operator_call(operator, ids['viewer'], 'select hub.workspace_legacy_faq_candidates($1)', [candidate])
            await set_bit(ids['viewer'], 'brands', can_view=False)
            assert (await operator_call(operator, ids['viewer'], 'select hub.workspace_resolve(null,$1,$2)', cluster, p['rem_project_id']))['id'] == brand['public_brand_id']
            await set_bit(ids['viewer'], 'knowledge', can_view=False)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await operator_call(operator, ids['viewer'], 'select hub.workspace_resolve(null,$1,$2)', cluster, p['rem_project_id'])
            neighbour = await operator_call(operator, ids['editor'], 'select hub.workspace_resolve(null,$1,$2)', cluster, p['rem_project_id'])
            assert neighbour['id'] == brand['public_brand_id']
        finally:
            await scope.rollback()
            await operator.close()
    run(check())


def test_unmatched_clusters_preserve_scoped_hold_propose_reject_and_pagination(permission_accounts):
    _, ids = permission_accounts

    async def check():
        projects = await setup_project(ids['editor'], count=2)
        p, neighbour = projects
        candidates = [await candidate_fixture([project], legacy_kind='faq') for project in (p, p, neighbour)]
        operator = await disposable_operator()
        await operator.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        scope = operator.transaction()
        await scope.start()
        clusters = []
        try:
            for position, (project, candidate) in enumerate(zip((p, p, neighbour), candidates), 1):
                clusters.append(await operator.fetchval('''insert into staging.faq_clusters(cluster_key,generation_sha256,algorithm,sort_key,
                    template,member_candidate_ids,variants,answer_groups,project_ids,holds,suggested_level,suggested_kind,suggestion_basis)
                    values($1,$2,'synthetic',$3,'Synthetic unmatched question',$4,'[{}]','[]',$5,$6,'project','text','heuristic') returning id''',
                    uuid4().hex * 2, uuid4().hex * 2, position, [candidate], [project['rem_project_id']], ['prompt_injection'] if position == 1 else []))
            held = await operator_call(operator, ids['editor'], "select hub.decide_faq_cluster($1,1,'hold',$2)", clusters[0],
                              {'hold_code': 'prompt_injection', 'note': 'Synthetic unsafe source stays held'})
            proposed_key = 'workspace_unmatched_' + uuid4().hex[:12]
            await operator_call(operator, ids['editor'], "select hub.decide_faq_cluster($1,1,'propose_question',$2)", clusters[1], {
                'question_key': proposed_key, 'note': 'Synthetic new question proposal',
                'question': {'topic': 'design', 'default_level': 'project', 'question_template': {'th': 'Synthetic proposed question'}, 'answer_kind': 'text'}})
            await set_bit(ids['viewer'], 'projects', can_view=False)
            sql = 'select hub.workspace_faq($1,$2,null,$3,$4,1,$5)'
            before = await operator.fetchval('select count(*) from audit.change_log')
            first = await operator_call(operator, ids['viewer'], sql, 'project', p['public_project_id'], 'Synthetic unmatched', None, 'th')
            assert len(first['unmatched_clusters']) == 1 and first['unmatched_next_cursor'].startswith('u:')
            item = first['unmatched_clusters'][0]
            assert item['id'] == str(clusters[0]) and item['state'] == 'held' and item['holds'] == ['prompt_injection']
            assert item['target'] == {'level': 'project', 'id': p['public_project_id'], 'tab': 'faq', 'phase': p['rem_project_id'], 'item': str(clusters[0]), 'section': 'intake'}
            assert set(item) == {'id', 'cursor', 'label', 'question_key', 'state', 'holds', 'target'}
            second = await operator_call(operator, ids['viewer'], sql, 'project', p['public_project_id'], 'Synthetic unmatched', first['unmatched_next_cursor'], 'th')
            assert second['items'] == [] and second['unmatched_next_cursor'] is None
            item = second['unmatched_clusters'][0]
            assert item['id'] == str(clusters[1]) and item['state'] == 'question_proposed' and item['question_key'] == proposed_key
            assert all(x['id'] != str(clusters[2]) for x in first['unmatched_clusters'] + second['unmatched_clusters'])
            timeline = await operator_call(operator, ids['viewer'], 'select hub.content_history($1,$2,null,100)', 'project', p['public_project_id'])
            assert any(event['target'].get('item') == str(clusters[0]) for event in timeline['items'])
            assert all(event['source_tab'] == 'knowledge' and event['target'].get('item') != str(clusters[2]) for event in timeline['items'])
            assert await operator.fetchval('select count(*) from audit.change_log') == before
            await operator_call(operator, ids['editor'], "select hub.decide_faq_cluster($1,$2,'reject',$3)", clusters[0], held['revision'], {'note': 'Synthetic source rejected'})
            visible = await operator_call(operator, ids['viewer'], sql, 'project', p['public_project_id'], 'Synthetic unmatched', None, 'th')
            assert [x['id'] for x in visible['unmatched_clusters']] == [str(clusters[1])]
            await set_bit(ids['viewer'], 'knowledge', can_view=False)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await operator_call(operator, ids['viewer'], sql, 'project', p['public_project_id'], 'Synthetic unmatched', None, 'th')
            assert (await operator_call(operator, ids['editor'], sql, 'project', p['public_project_id'], 'Synthetic unmatched', None, 'th'))['unmatched_clusters']
        finally:
            await scope.rollback()
            await operator.close()
    run(check())


def test_history_action_projection_includes_approval_with_no_content_change(permission_accounts):
    _, ids = permission_accounts

    async def check():
        p = (await setup_project(ids['editor']))[0]
        operator = await disposable_operator()
        await operator.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        db = await runtime()
        try:
            fact = {'id': str(uuid4()), 'project_id': str(p['id']), 'fact_key': 'project.unit_total',
                    'grain': 'project', 'value_number': 10, 'approved_by': None}
            approved = {**fact, 'approved_by': str(ids['publisher'])}
            event = await operator.fetchval('''insert into audit.change_log(actor,database_role,table_name,operation,before_row,after_row,reason)
                values($1,'hub_app','hub.project_facts','UPDATE',$2,$3,'Synthetic approval') returning id''', ids['publisher'], fact, approved)
            history = await call(db, ids['viewer'], 'select hub.content_history($1,$2,null,100)', 'project', p['public_project_id'])
            assert next(x for x in history['items'] if x['audit_id'] == str(event))['action'] == 'approve'
            detail = await call(db, ids['viewer'], 'select hub.content_history_event($1,$2,$3)', 'project', p['public_project_id'], event)
            assert detail['actor']['id'] == str(ids['publisher']) and detail['reason'] == 'Synthetic approval'
            assert 'approved_by' not in detail['after'] and detail['before'] == detail['after']
            first, second = str(uuid4()), str(uuid4())
            pointers = [(None, first, 'publish'), (first, second, 'publish'), (second, first, 'rollback'), (first, None, 'withdraw')]
            for old, new, action in pointers:
                before = {'id': str(p['id']), 'published_version_id': old}
                after = {**before, 'published_version_id': new}
                event = await operator.fetchval('''insert into audit.change_log(actor,database_role,table_name,operation,before_row,after_row,reason)
                    values($1,'hub_app','hub.projects','UPDATE',$2,$3,'Synthetic pointer') returning id''', ids['publisher'], before, after)
                if action in {'rollback', 'withdraw'}:
                    detail = await call(db, ids['viewer'], 'select hub.content_history_event($1,$2,$3)', 'project', p['public_project_id'], event)
                    assert detail['action'] == action and detail['before']['published_version_id'] == old
                else:
                    # The immutable version carries the publish event; parent-pointer mirrors stay hidden.
                    with pytest.raises(asyncpg.NoDataFoundError):
                        await call(db, ids['viewer'], 'select hub.content_history_event($1,$2,$3)', 'project', p['public_project_id'], event)
        finally:
            await db.close()
            await operator.close()
    run(check())


def test_readiness_keeps_public_type_and_exact_media_slot_context(permission_accounts):
    _, ids = permission_accounts

    async def check():
        p = (await setup_project(ids['editor']))[0]
        db = await runtime()
        try:
            current = await call(db, ids['editor'], 'select hub.project_detail($1)', p['public_project_id'])
            unit = await create_type(db, ids['editor'], current)
            await save_price(db, ids['editor'], p['public_project_id'], unit)
            before = await audit_count()
            page = await call(db, ids['viewer'], 'select hub.workspace_page($1,$2,null)', 'project', p['public_project_id'])
            assert await audit_count() == before
            entries = page['overview']['readiness']['required'] + page['overview']['readiness']['recommended']
            typed = [entry for entry in entries if entry['code'].startswith(('commercial_type.', 'price.'))]
            assert typed and any(entry['code'].startswith('price.') for entry in typed)
            for entry in typed:
                assert entry['target']['tab'] == 'unit-types'
                assert entry['target']['unit_type'] == unit['public_commercial_type_id']
                assert entry['target']['phase'] == p['rem_project_id'] and entry['target']['item']
                assert entry['context']['kind'] == ('price' if entry['code'].startswith('price.') else 'unit_type')
                assert unit['public_name']['th'] in entry['context']['label']['th']
            hero = next(entry for entry in entries if entry['code'] == 'hero')
            assert hero['target']['media_slot']['media_role'] == 'hero'
            assert hero['target']['media_slot']['target_type'] == 'project'
            assert hero['target']['media_slot']['target_key'] == str(p['id'])
            brand = await call(db, ids['viewer'], 'select public_brand_id from hub.brands where id=$1', p['brand_id'])
            if brand:
                data = await call(db, ids['viewer'], 'select hub.workspace_page($1,$2,null)', 'brand', brand)
                for entry in data['overview']['readiness']['required']:
                    assert entry['target']['level'] == 'brand' and entry['target']['id'] == brand
                    assert entry['target'].get('field')
        finally:
            await db.close()
    run(check())


@pytest.mark.parametrize('path', [
    '/v1/admin/content/workspace/tree', '/v1/admin/content/activity',
    '/v1/admin/content/workspace/resolve?faq=00000000-0000-4000-8000-000000000001',
    '/v1/admin/content/workspace/corporate/sena', '/v1/admin/content/workspace/corporate/sena/faq',
    '/v1/admin/content/workspace/corporate/sena/history', '/v1/admin/content/workspace/corporate/sena/history/1',
    '/v1/admin/content/workspace/corporate/sena/preview',
])
def test_workspace_direct_routes_require_authentication(permission_accounts, path):
    client, _ = permission_accounts
    assert client.get(path).status_code == 401
