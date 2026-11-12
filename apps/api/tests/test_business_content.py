"""W5 fixed references, explicit inheritance and exact saved evidence on disposable SQL."""
import json
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4

import asyncpg
import pytest
from pydantic import TypeAdapter, ValidationError

from sena_hub_api.content_workspace import Kind
from sena_hub_api.content_workflow import WorkflowTarget, publication_targets
from sena_hub_api.faq_coverage import Applicability
from sena_hub_api.publication_queue import QueuePrepare
from sena_hub_api.web_publication import PageKey
from sena_hub_api.workspace_home import workspace_href
from test_content_workflow import approve_item, contact_body, inventory_brand_fixture
from test_permission_baseline import disposable_operator
from test_permission_content import call, set_bit
from test_permission_foundations import permission_accounts, h
from test_permission_db_baseline import runtime as committed_runtime
from test_project_content_core import run, runtime
from test_publication_queue import online, prepare
from test_unit_type_workflow import create_type
from test_website_content import project_fixture


async def setup_business(ids):
    db = await disposable_operator()
    await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
    transaction = db.transaction()
    await transaction.start()
    try:
        brand = await inventory_brand_fixture(db, ids['editor'])
        project = await project_fixture(db, ids['editor'])
        other = await project_fixture(db, ids['editor'])
        await db.execute('update hub.projects set brand_id=$1,public_name=$2 where id=$3',
                         brand['id'], {'th': 'Synthetic business project', 'en': 'Synthetic business project'}, project['id'])
        group = 'W5_' + uuid4().hex
        digest = uuid4().hex * 2
        await db.execute("insert into staging.intake_batches(manifest_sha256,manifest,datasets) values($1,'{}','{}')", digest)
        await db.execute('insert into staging.dw_project_groups(project_group_id,source_record,manifest_sha256) values($1,$2,$3)',
                         group, {'project_group_name': 'Synthetic business group'}, digest)
        await db.execute("insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance) values($1,$2,now(),$3,'{}')",
                         project['rem_project_id'], {'project_id': project['rem_project_id'], 'rem_project_group_id': group}, digest)
        await transaction.commit()
        return brand, project, other, group
    finally:
        await db.close()


async def question(db, ids, *, show=True, exposure='open'):
    key = 'w5_' + uuid4().hex
    await call(db, ids['editor'], 'select hub.save_faq_question($1,0,$2)', key,
               {'topic': 'design', 'default_level': 'business', 'question_template': {'th': 'Synthetic business question?'},
                'answer_kind': 'text', 'show_on_project_pages': show, 'ai_exposure': exposure})
    await call(db, ids['publisher'], "select hub.approve_faq_question($1,1,'approved')", key)
    return key


async def answer(db, ids, key, scope, ref, projects, text='Synthetic saved answer', **extra):
    body = {'question_key': key, 'scope_type': scope, 'scope_id': ref,
            'question': {'th': 'Synthetic business question?'}, 'short_answer': {'th': text},
            'answer_kind': 'text', 'applies_to_project_ids': projects, 'ai_exposure': 'open', **extra}
    return await call(db, ids['editor'], 'select hub.save_faq(null,0,$1)', body), body


async def approve_faq(db, ids, faq):
    for value in await call(db, ids['editor'], "select hub.content_translation_list('knowledge',$1)", faq['id']):
        if value['th_text'].strip() and value['editable'] and value['translation_state'] != 'reviewed':
            await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)',
                       UUID(value['id']), value['revision'], value['th_version'], value['th_text'])
    return await approve_item(db, ids, 'faq', {'id': faq['id']})


def test_business_models_and_targets_add_one_finite_level_without_catalog_workflow():
    assert TypeAdapter(Kind).validate_python('business') == 'business'
    assert TypeAdapter(PageKey).validate_python('business:residential') == 'business:residential'
    Applicability.model_validate({'scope_type': 'business', 'scope_id': 'residential', 'rule': {'brand_ids': ['br_synthetic']}})
    QueuePrepare.model_validate({'selections': [{'system': 'web', 'page_key': 'business:residential'}], 'reason': 'Synthetic'})
    with pytest.raises(ValidationError):
        WorkflowTarget(kind='business', identity={'id': 'residential'})
    for invalid in ['business:../escape', 'business:residential/other', 'arbitrary:residential']:
        with pytest.raises(ValidationError):
            TypeAdapter(PageKey).validate_python(invalid)
    target = publication_targets({'target': {'level': 'business', 'id': 'residential', 'tab': 'faq', 'question_key': 'own_question', 'item': str(uuid4())}})
    assert urlsplit(target['href']).path == '/website/business/residential'
    assert parse_qs(urlsplit(target['href']).query)['question'] == ['own_question']
    href = workspace_href('section', {'scope_type': 'business', 'scope_id': 'residential', 'tab': 'narrative', 'item': 'exact'})
    assert urlsplit(href).path == '/website/business/residential'
    assert parse_qs(urlsplit(href).query)['tab'] == ['data']
    assert parse_qs(urlsplit(href).query)['item'] == ['exact']


def test_business_catalog_http_is_read_only_private_and_does_not_grant_descendants(permission_accounts):
    client, ids = permission_accounts
    brand, project, _, _ = run(setup_business(ids))
    response = client.get('/v1/admin/content/businesses', headers=h('viewer'))
    assert response.status_code == 200, response.text
    assert 'no-store' in {value.strip().lower() for value in response.headers['cache-control'].split(',')}
    assert response.json()['data']['items'][0]['code'] == 'residential'
    assert set(response.json()['data']['items'][0]) == {'code', 'label'}
    for method in ('post', 'patch', 'delete'):
        assert getattr(client, method)('/v1/admin/content/businesses', headers=h('admin')).status_code in (404, 405)
    for role in ('agency', 'service_consumer', 'pending'):
        assert client.get('/v1/admin/content/businesses', headers=h(role)).status_code == 403
    run(set_bit(ids['viewer'], 'projects', can_view=False))
    run(set_bit(ids['viewer'], 'brands', can_view=False))
    page = client.get('/v1/admin/content/workspace/business/residential', headers=h('viewer'))
    assert page.status_code == 200 and page.json()['data']['phases'] == []
    assert page.json()['data']['overview']['readiness']['required'] == []
    assert client.get('/v1/admin/content/workspace/business/unknown', headers=h('viewer')).status_code == 404
    assert client.get('/v1/admin/content/workspace/business/residential/faq', headers=h('viewer')).status_code == 200
    assert client.get(f"/v1/admin/projects/{project['public_project_id']}/content", headers=h('viewer')).status_code == 403
    assert client.get('/v1/admin/content/workspace/brand/' + brand['public_brand_id'] + '/preview', headers=h('viewer')).status_code == 403
    run(set_bit(ids['viewer'], 'knowledge', can_view=False))
    assert client.get('/v1/admin/content/businesses', headers=h('viewer')).status_code == 403
    assert client.get('/v1/admin/content/workspace/business/residential', headers=h('viewer')).status_code == 403
    run(set_bit(ids['viewer'], 'brands', can_view=True))
    assert client.get('/v1/admin/content/businesses', headers=h('viewer')).status_code == 200
    assert client.get('/v1/admin/content/workspace/business/residential', headers=h('viewer')).status_code == 403


def test_new_brand_gets_additive_fixed_membership_and_app_cannot_change_catalog(permission_accounts):
    _, ids = permission_accounts
    async def check():
        operator = await disposable_operator()
        db = await runtime()
        try:
            rem = 'W5-NEW-' + uuid4().hex
            await operator.execute("insert into staging.rem_brands(rem_brand_id,brand_name_rem,source_updated_at,source_fingerprint) values($1,'Synthetic new business brand',now(),repeat('5',64))", rem)
            brand = await call(operator, ids['admin'], 'select hub.create_brand_from_rem($1)', rem)
            # The operator read only verifies the trigger result after the guarded command commits.
            actual = await operator.fetchval('select business_code from hub.brand_business where brand_id=$1', brand)
            assert actual == 'residential'
            for sql in ["insert into hub.businesses values('other','{\"th\":\"Other\"}')", "update hub.businesses set label='{}'", 'delete from hub.brand_business']:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['admin'], sql)
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['admin'], "select hub.content_workflow_read('business','{\"id\":\"residential\"}')")
        finally:
            await db.close()
            await operator.close()
    run(check())


def test_seven_levels_precedence_unit_context_and_same_rank_hold(permission_accounts):
    _, ids = permission_accounts
    brand, project, _, group = run(setup_business(ids))
    async def check():
        db = await runtime()
        try:
            detail = await call(db, ids['editor'], 'select hub.project_detail($1)', project['public_project_id'])
            unit = await create_type(db, ids['editor'], detail)
            key = await question(db, ids)
            levels = [('corporate', 'sena'), ('business', 'residential'), ('brand', brand['public_brand_id']),
                      ('programme', 'LIVNEX'), ('project_group', group), ('project', project['rem_project_id']), ('unit_type', unit['id'])]
            saved = []
            for level, ref in levels:
                row, _ = await answer(db, ids, key, level, str(ref), [] if level == 'corporate' else [project['rem_project_id']], text='Answer at ' + level)
                saved.append(row)
                composed = await call(db, ids['viewer'], 'select hub.faq_composition($1,$2,$3)', project['public_project_id'], 'th', unit['public_commercial_type_id'])
                chosen = next(item for item in composed['items'] if item['question_key'] == key)
                assert chosen['faq_id'] == row['id'] and chosen['scope_type'] == level
                assert chosen['inherited'] == (level not in ('project', 'unit_type'))
            without_unit = await call(db, ids['viewer'], 'select hub.faq_composition($1)', project['public_project_id'])
            assert next(item for item in without_unit['items'] if item['question_key'] == key)['faq_id'] == saved[-2]['id']
            await answer(db, ids, key, 'unit_type', unit['id'], [project['rem_project_id']], text='Conflicting same rank')
            conflict = await call(db, ids['viewer'], 'select hub.faq_composition($1,$2,$3)', project['public_project_id'], 'th', unit['public_commercial_type_id'])
            assert next(item for item in conflict['cells'] if item['question_key'] == key)['reason'] == 'same_level_conflict'
            assert not any(item['question_key'] == key for item in conflict['items'])
        finally:
            await db.close()
    run(check())


def test_business_membership_never_implies_faq_applicability_and_corporate_opt_in_survives(permission_accounts):
    _, ids = permission_accounts
    brand, project, outside, _ = run(setup_business(ids))
    async def check():
        db = await runtime()
        try:
            key = await question(db, ids)
            corporate, _ = await answer(db, ids, key, 'corporate', 'sena', [])
            empty, body = await answer(db, ids, key, 'business', 'residential', [])
            composition = await call(db, ids['viewer'], 'select hub.faq_composition($1)', project['public_project_id'])
            assert next(item for item in composition['items'] if item['question_key'] == key)['faq_id'] == corporate['id']
            with pytest.raises(asyncpg.CheckViolationError, match='outside this business'):
                await answer(db, ids, key, 'business', 'residential', [outside['rem_project_id']])
            with pytest.raises(asyncpg.CheckViolationError):
                await answer(db, ids, key, 'business', 'unknown', [project['rem_project_id']])
            preview = await call(db, ids['viewer'], "select hub.faq_applicability_preview($1,'business','residential')", {'brand_ids': [brand['public_brand_id']]})
            assert preview['project_ids'] == [project['rem_project_id']]
            assert (await call(db, ids['viewer'], "select hub.faq_applicability_preview('{}','business','residential')"))['project_ids'] == []
            changed = await call(db, ids['editor'], 'select hub.save_faq($1,$2,$3)', UUID(empty['id']), empty['revision'],
                                 {**body, 'applicability_rule': {'brand_ids': [brand['public_brand_id']]}})
            assert changed['version']['applies_to_project_ids'] == [project['rem_project_id']]
            composition = await call(db, ids['viewer'], 'select hub.faq_composition($1)', project['public_project_id'])
            assert next(item for item in composition['items'] if item['question_key'] == key)['faq_id'] == empty['id']
            hidden_key = await question(db, ids, show=False)
            await answer(db, ids, hidden_key, 'corporate', 'sena', [])
            composition = await call(db, ids['viewer'], 'select hub.faq_composition($1)', project['public_project_id'])
            assert not any(item['question_key'] == hidden_key for item in composition['items'])
        finally:
            await db.close()
    run(check())


def test_business_knowledge_only_own_drafts_tasks_and_history_are_bounded_read_projections(permission_accounts):
    _, ids = permission_accounts
    brand, project, _, _ = run(setup_business(ids))
    async def check():
        db = await committed_runtime()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        operator = await disposable_operator()
        try:
            key = await question(db, ids)
            own, _ = await answer(db, ids, key, 'business', 'residential', [project['rem_project_id']])
            inherited, _ = await answer(db, ids, await question(db, ids), 'corporate', 'sena', [])
            contact = await call(db, ids['editor'], "select hub.save_content_contact('business','residential',null,0,$1)", contact_body())
            await set_bit(ids['editor'], 'projects', can_view=False, can_edit=False)
            await set_bit(ids['editor'], 'brands', can_view=False, can_edit=False)
            before = await operator.fetchval('select count(*) from audit.change_log')
            inventory = await call(db, ids['editor'], "select hub.content_workflow_items('business','residential',null,null,100)")
            assert inventory['scope'] == {'level': 'business', 'id': 'residential', 'phase': None}
            identities = {item['identity']['id'] for item in inventory['items']}
            assert own['id'] in identities and contact['id'] in identities and inherited['id'] not in identities
            assert all(item['source_tab'] == 'knowledge' and item['can_submit'] for item in inventory['items'])
            page = await call(db, ids['editor'], "select hub.workspace_faq('business','residential',null,'',$1,1,'th')", 'q:' + key)
            assert page['items'][0]['own_answer']['id'] == own['id'] and page['items'][0]['facts'] == []
            history = await call(db, ids['editor'], "select hub.content_history('business','residential',null,100)")
            event = next(item for item in history['items'] if item['section_key'] == 'faq')
            detail = await call(db, ids['editor'], "select hub.content_history_event('business','residential',$1)", int(event['audit_id']))
            assert detail['target']['level'] == 'business'
            assert not {'email', 'account_id', 'password', 'payload'} & set(detail.get('after') or {})
            home = await call(db, ids['editor'], 'select hub.workspace_home(null,null,0,100,null,null)')
            assert all(item.get('context', {}).get('scope_type') != 'business' or item['context']['scope_id'] == 'residential' for item in home['tasks'])
            assert await operator.fetchval('select count(*) from audit.change_log') == before
            await set_bit(ids['editor'], 'knowledge', can_edit=False)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], "select hub.save_content_contact('business','residential',null,0,$1)", contact_body())
            await set_bit(ids['editor'], 'brands', can_view=True, can_edit=True)
            assert await call(db, ids['editor'], 'select hub.brand_detail($1)', brand['public_brand_id'])
        finally:
            await db.close()
            await operator.close()
    run(check())


def test_business_publication_uses_approved_faq_keeps_new_draft_private_and_enforces_n2(permission_accounts):
    _, ids = permission_accounts
    _, project, _, _ = run(setup_business(ids))
    async def check():
        await online(ids)
        db = await runtime()
        try:
            key = await question(db, ids)
            faq, body = await answer(db, ids, key, 'business', 'residential', [project['rem_project_id']], text='Approved business answer')
            private = await call(db, ids['editor'], "select hub.workspace_preview('business','residential',null,'th')")
            assert next(item for item in private['preview']['faq'] if item['question_key'] == key)['short_answer'] == 'Approved business answer'
            assert private['mode'] == 'PRIVATE_DRAFT' and private['saved'] is False
            await approve_faq(db, ids, faq)
            page_key = 'business:residential'
            page = await call(db, ids['editor'], 'select hub.web_page_save($1,0,$2)', page_key,
                              {'url': '/w5/' + uuid4().hex, 'locales': ['th'], 'ai_policy': 'no_ai', 'max_faq_items': 20, 'project_ids': []})
            await approve_item(db, ids, 'page_config', {'id': page['id']})
            batch = await prepare(db, ids, page_key)
            await set_bit(ids['publisher'], 'knowledge', special_actions=['knowledge.publish_web'], connection=db, manager=ids['admin'])
            denied = await call(db, ids['publisher'], 'select hub.publication_queue_publish($1,$2)', UUID(batch['id']), batch['digest'])
            assert denied['page_count'] == 0
            batch = await prepare(db, ids, page_key)
            result = await call(db, ids['viewer'], 'select hub.publication_queue_publish($1,$2)', UUID(batch['id']), batch['digest'])
            assert result['page_count'] == 1
            history_before = await call(db, ids['viewer'], 'select hub.web_history($1)', page_key)
            current = await call(db, ids['editor'], 'select hub.faq_read($1)', UUID(faq['id']))
            await call(db, ids['editor'], 'select hub.save_faq($1,$2,$3)', UUID(faq['id']), current['revision'], {**body, 'short_answer': {'th': 'Unreviewed business replacement'}})
            published = await call(db, ids['service_consumer'], "select hub.web_public_page($1,'th')", page_key)
            assert next(item for item in published['faq'] if item['question_key'] == key)['short_answer'] == 'Approved business answer'
            private = await call(db, ids['editor'], "select hub.workspace_preview('business','residential',null,'th')")
            assert next(item for item in private['preview']['faq'] if item['question_key'] == key)['short_answer'] == 'Unreviewed business replacement'
            assert await call(db, ids['viewer'], 'select hub.web_history($1)', page_key) == history_before
            await set_bit(ids['viewer'], 'knowledge', can_view=False, special_actions=[], connection=db, manager=ids['admin'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await prepare(db, ids, page_key)
        finally:
            await db.close()
    run(check())


def test_business_faq_publish_task_needs_only_own_source_view_and_keeps_n2_denials(permission_accounts):
    _, ids = permission_accounts
    _, project, _, _ = run(setup_business(ids))

    async def check():
        await online(ids)
        db = await committed_runtime()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        try:
            faq, _ = await answer(db, ids, await question(db, ids), 'business', 'residential', [project['rem_project_id']])
            # Keep creator, English reviewer and Manager separate so every N2
            # denial is tested against that actor's own included contribution.
            for value in await call(db, ids['second'], "select hub.content_translation_list('knowledge',$1)", faq['id']):
                if value['th_text'].strip() and value['editable'] and value['translation_state'] != 'reviewed':
                    await call(db, ids['second'], 'select hub.review_content_translation($1,$2,$3,$4)',
                               UUID(value['id']), value['revision'], value['th_version'], value['th_text'])
            approved = await approve_item(db, ids, 'faq', {'id': faq['id']})
            for tab in ('projects', 'brands'):
                await set_bit(ids['viewer'], tab, can_view=False, can_edit=False, can_approve=False)

            async def tasks(role):
                offset, found = 0, []
                while True:
                    home = await call(db, ids[role], "select hub.workspace_home(null,null,$1,100,'publish',null)", offset)
                    if role == 'viewer':
                        assert home['projects'] == [] and home['brands'] == []
                    found.extend(item for item in home['tasks'] if item['kind'] == 'faq' and item['item_id'] == faq['id'])
                    offset += len(home['tasks'])
                    if offset >= home['task_total']:
                        return found
                    assert home['tasks'], 'Task paging must advance'

            ready = await tasks('viewer')
            assert len(ready) == 1 and ready[0]['version_id'] == approved['version_id']
            assert ready[0]['source_tab'] == 'knowledge' and ready[0]['state'] == 'APPROVED'
            assert ready[0]['scope_type'] == 'business' and ready[0]['scope_id'] == 'residential'
            assert ready[0]['context']['question'] and ready[0]['expected_hash']
            for role in ('editor', 'second', 'publisher'):
                await set_bit(ids[role], 'knowledge', special_actions=['knowledge.publish_web'])
                assert await tasks(role) == [], role
            await set_bit(ids['viewer'], 'knowledge', can_view=False, special_actions=[])
            assert await tasks('viewer') == []
            await online(ids)
            assert (await tasks('viewer'))[0]['version_id'] == approved['version_id']
        finally:
            await db.close()
    run(check())


@pytest.mark.parametrize('drift_at', ['before_prepare', 'after_prepare'])
def test_shared_brand_business_faq_pins_rule_resolution_and_rejects_only_changed_item(permission_accounts, drift_at):
    _, ids = permission_accounts
    brand, project, other, _ = run(setup_business(ids))

    async def check():
        await online(ids)
        db = await committed_runtime()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        operator = await disposable_operator()
        await operator.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        try:
            # Synthetic initial relationships only; the later membership of the
            # rule changes through the ordinary commercial-type writer.
            async with operator.transaction():
                await operator.execute("select set_config('app.actor_id',$1,true)", str(ids['editor']))
                await operator.execute('update hub.projects set brand_id=$1 where id=$2', brand['id'], other['id'])
            detail = await call(db, ids['editor'], 'select hub.project_detail($1)', project['public_project_id'])
            await create_type(db, ids['editor'], detail)
            key, neighbour_key = await question(db, ids), await question(db, ids)
            changed, _ = await answer(db, ids, key, 'business', 'residential', [], 'Rule-selected approved answer',
                                      applicability_rule={'brand_ids': [brand['public_brand_id']], 'product_forms': ['condominium']})
            neighbour, _ = await answer(db, ids, neighbour_key, 'business', 'residential', [project['rem_project_id']], 'Independent approved neighbour')
            assert changed['version']['applies_to_project_ids'] == [project['rem_project_id']]
            for faq in (changed, neighbour):
                await approve_faq(db, ids, faq)
            for value in await call(db, ids['editor'], "select hub.content_translation_list('brands',$1)", brand['public_brand_id']):
                if value['th_text'].strip() and value['editable'] and value['translation_state'] != 'reviewed':
                    await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)',
                               UUID(value['id']), value['revision'], value['th_version'], value['th_text'])
            await approve_item(db, ids, 'brand', {'id': str(brand['id'])})
            page_key = 'brand:' + brand['public_brand_id']
            page = await call(db, ids['editor'], 'select hub.web_page_save($1,0,$2)', page_key,
                              {'url': '/w5/' + uuid4().hex, 'locales': ['th'], 'ai_policy': 'no_ai', 'max_faq_items': 20, 'project_ids': []})
            await approve_item(db, ids, 'page_config', {'id': page['id']})
            saved = await operator.fetchrow('select * from hub.faq_versions where id=(select draft_version_id from hub.faqs where id=$1)', UUID(changed['id']))
            prepared = None
            if drift_at == 'after_prepare':
                prepared = await prepare(db, ids, page_key)
                initial = await call(db, ids['viewer'], "select hub.web_publication_read($1,'th')", UUID(prepared['id']))
                assert any(item['status'] == 'APPROVED' and (item.get('workflow') or {}).get('identity') == {'id': changed['id']}
                           for page in initial['pages'] for item in page['items'])
            detail = await call(db, ids['editor'], 'select hub.project_detail($1)', other['public_project_id'])
            await create_type(db, ids['editor'], detail)
            assert await operator.fetchval('select hub.faq_rule_projects($1,$2,$3)',
                saved['applicability_rule'], 'business', 'residential') == sorted([project['rem_project_id'], other['rem_project_id']])
            private = await call(db, ids['viewer'], "select hub.workspace_preview('brand',$1,null,'th')", brand['public_brand_id'])
            assert any(issue['code'] == 'faq_applicability_changed' for issue in private['issues'])
            assert next(item['rem_project_ids'] for item in private['resolved_applicability'] if item['question_key'] == key) == sorted([project['rem_project_id'], other['rem_project_id']])
            if prepared is None:
                prepared = await prepare(db, ids, page_key)
                pages = await operator.fetchval('select pages from hub.web_publications where id=$1', UUID(prepared['id']))
                assert any(issue['code'] == 'faq_applicability_changed' for page in pages for issue in page['issues'])
            review = await call(db, ids['viewer'], "select hub.web_publication_read($1,'th')", UUID(prepared['id']))
            assert review['can_publish'] is True
            assert next(item['rem_project_ids'] for page in review['pages'] for item in page['resolved_applicability'] if item['question_key'] == key) == [project['rem_project_id']]
            outcomes = [item for page in review['pages'] for item in page['items']]
            rejected = next(item for item in outcomes if (item.get('workflow') or {}).get('identity') == {'id': changed['id']})
            assert rejected['status'] == 'REJECTED' and rejected['code'] == 'stale'
            assert any(item['status'] == 'APPROVED' and (item.get('workflow') or {}).get('identity') == {'id': neighbour['id']} for item in outcomes)
            published = await call(db, ids['viewer'], 'select hub.publication_queue_publish($1,$2)', UUID(prepared['id']), prepared['digest'])
            assert published['state'] == 'PARTIAL' and published['page_count'] == 1
            public = await call(db, ids['service_consumer'], "select hub.web_public_page($1,'th')", page_key)
            assert any(item['question_key'] == neighbour_key for item in public['faq'])
            assert all(item['question_key'] != key for item in public['faq'])
            assert await operator.fetchrow('select * from hub.faq_versions where id=$1', saved['id']) == saved
        finally:
            await db.close()
            await operator.close()
    run(check())


def test_business_shared_preview_inheritance_matches_approved_prepared_graph(permission_accounts):
    _, ids = permission_accounts
    brand, project, _, _ = run(setup_business(ids))
    async def check():
        await online(ids)
        db = await committed_runtime()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        operator = await disposable_operator()
        await operator.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        try:
            key = await question(db, ids)
            corporate, _ = await answer(db, ids, key, 'corporate', 'sena', [project['rem_project_id']], 'Corporate fallback')
            business, body = await answer(db, ids, key, 'business', 'residential', [project['rem_project_id']], 'Approved inherited business')
            for faq in (corporate, business):
                await approve_faq(db, ids, faq)
            for level, ref in [('business', 'residential'), ('brand', brand['public_brand_id']), ('corporate', 'sena')]:
                private = await call(db, ids['viewer'], "select hub.workspace_preview($1,$2,null,'th')", level, ref)
                wanted = 'Corporate fallback' if level == 'corporate' else 'Approved inherited business'
                assert next(item for item in private['preview']['faq'] if item['question_key'] == key)['short_answer'] == wanted
            current = await call(db, ids['editor'], 'select hub.faq_read($1)', UUID(business['id']))
            await call(db, ids['editor'], 'select hub.save_faq($1,$2,$3)', UUID(business['id']), current['revision'],
                       {**body, 'short_answer': {'th': 'Unreviewed inherited replacement'}})
            selections = []
            for level, ref in [('brand', brand['public_brand_id']), ('project', project['public_project_id'])]:
                page_key = level + ':' + ref
                await call(db, ids['editor'], 'select hub.web_page_save($1,0,$2)', page_key,
                           {'url': '/w5/' + uuid4().hex, 'locales': ['th'], 'ai_policy': 'no_ai', 'max_faq_items': 20,
                            'project_ids': [ref] if level == 'project' else []})
                selections.append({'system': 'web', 'page_key': page_key})
            prepared = await call(db, ids['viewer'], 'select hub.publication_queue_prepare($1,$2)', selections, 'Compare approved inheritance')
            # Inspect only the immutable batch just created by the guarded runtime.
            pages = await operator.fetchval('select pages from hub.web_publications where id=$1', UUID(prepared['id']))
            def nodes(value):
                if isinstance(value, dict):
                    yield value
                    for child in value.values():
                        yield from nodes(child)
                elif isinstance(value, list):
                    for child in value:
                        yield from nodes(child)
            for page in pages:
                faq_nodes = [node for node in nodes(page['snapshot']) if node.get('_faq') and node.get('question_key') == key]
                assert len(faq_nodes) == 1
                assert faq_nodes[0]['data']['th']['short_answer'] == 'Approved inherited business'
                assert any(dep['table'] == 'businesses' and dep['identity'] == {'code': 'residential'} for dep in faq_nodes[0]['dependencies'])
            before = await operator.fetchval('select pages from hub.web_publications where id=$1', UUID(prepared['id']))
            await set_bit(ids['viewer'], 'brands', can_view=False)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.publication_queue_prepare($1,$2)', selections, 'Hidden brand is still hidden')
            assert await operator.fetchval('select pages from hub.web_publications where id=$1', UUID(prepared['id'])) == before
            assert await call(db, ids['viewer'], "select hub.workspace_preview('business','residential',null,'th')")
        finally:
            await db.close()
            await operator.close()
    run(check())


def test_business_tree_keeps_knowledge_only_brand_references_minimal(permission_accounts):
    _, ids = permission_accounts
    brand, project, _, _ = run(setup_business(ids))
    async def check():
        db = await runtime()
        try:
            tree = await call(db, ids['viewer'], "select hub.workspace_tree('corporate','sena','',null,100)")
            business = next(item for item in tree['items'] if item['kind'] == 'business')
            assert business['ref'] == 'residential' and business['parent'] == {'kind': 'corporate', 'ref': 'sena'}
            await set_bit(ids['viewer'], 'brands', can_view=False, connection=db, manager=ids['admin'])
            await set_bit(ids['viewer'], 'projects', can_view=False, connection=db, manager=ids['admin'])
            children = await call(db, ids['viewer'], "select hub.workspace_tree('business','residential',$1,null,100)", brand['public_brand_id'])
            reference = next(item for item in children['items'] if item['ref'] == brand['public_brand_id'])
            assert reference['faq_only'] is True and reference['target']['tab'] == 'faq'
            assert not {'description', 'assets', 'contacts', 'versions', 'project_ids'} & reference.keys()
            assert reference['visible_phase_count'] == 0
            assert any(item['kind'] == 'business' and item['ref'] == 'residential' for item in (await call(db, ids['viewer'], "select hub.workspace_search('residential',30)"))['items'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.project_detail($1)', project['public_project_id'])
        finally:
            await db.close()
    run(check())


def test_assistant_saved_business_faq_and_section_evidence_rechecks_exact_source_and_version(permission_accounts):
    _, ids = permission_accounts
    brand, project, _, _ = run(setup_business(ids))
    async def check():
        db = await runtime()
        operator = await disposable_operator()
        try:
            key = await question(db, ids)
            faq, body = await answer(db, ids, key, 'business', 'residential', [project['rem_project_id']])
            business_section = await call(db, ids['editor'], "select hub.save_content_section('business','residential','section.project_intro',0,$1)", {'body': {'th': 'Saved business narrative'}})
            brand_section = await call(db, ids['editor'], "select hub.save_content_section('brand',$1,'section.project_intro',0,$2)", brand['public_brand_id'], {'body': {'th': 'Saved brand narrative'}})
            catalog_version = await operator.fetchval("select hub.web_hash(to_jsonb(b)) from hub.businesses b where code='residential'")
            session = await call(db, ids['viewer'], 'select internal.assistant_run_create($1)', {'mode': 'SYNTHETIC', 'config_version': 'w5-evidence'})
            sources = [
                {'namespace': 'internal_content', 'entity_type': 'business', 'entity_id': 'residential', 'version': catalog_version},
                {'namespace': 'internal_content', 'entity_type': 'faq', 'entity_id': faq['id'], 'version': faq['version']['id']},
                *[{'namespace': 'internal_content', 'entity_type': 'section', 'entity_id': section['id'], 'version': section['version']['id']} for section in (business_section, brand_section)],
            ]
            receipt = await call(db, ids['viewer'], 'select internal.assistant_tool_record($1,$2)', UUID(session['id']),
                                 {'tool_name': 'search_content', 'outcome': 'SUCCESS', 'duration_ms': 1, 'sources': sources})
            evidence = []
            for citation in receipt['citations']:
                row = await call(db, ids['viewer'], 'select internal.assistant_citation_read($1,$2)', UUID(session['id']), UUID(citation['id']))
                assert row['evidence']['version'] == citation['version']
                assert not {'email', 'editors', 'created_by', 'payload', 'sources'} & row['evidence']['fields'].keys()
                evidence.append(row)
            assert evidence[0]['evidence']['fields']['code'] == 'residential'
            assert evidence[1]['evidence']['target']['level'] == 'business'
            await call(db, ids['editor'], 'select hub.save_faq($1,$2,$3)', UUID(faq['id']), faq['revision'], {**body, 'short_answer': {'th': 'New saved evidence'}})
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['viewer'], 'select internal.assistant_citation_read($1,$2)', UUID(session['id']), UUID(evidence[1]['id']))
            history = await call(db, ids['viewer'], 'select internal.assistant_run_read($1)', UUID(session['id']))
            assert all(item['id'] != evidence[1]['id'] for item in history['citations'])
            await set_bit(ids['viewer'], 'knowledge', can_view=False, connection=db, manager=ids['admin'])
            for item in (evidence[0], evidence[2]):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['viewer'], 'select internal.assistant_citation_read($1,$2)', UUID(session['id']), UUID(item['id']))
            allowed = await call(db, ids['viewer'], 'select internal.assistant_citation_read($1,$2)', UUID(session['id']), UUID(evidence[3]['id']))
            assert allowed['evidence']['fields']['body']['th'] == 'Saved brand narrative'
            history = await call(db, ids['viewer'], 'select internal.assistant_run_read($1)', UUID(session['id']))
            assert [item['id'] for item in history['citations']] == [evidence[3]['id']]
            with pytest.raises(asyncpg.NoDataFoundError):
                await call(db, ids['second'], 'select internal.assistant_citation_read($1,$2)', UUID(session['id']), UUID(evidence[3]['id']))
            access = await call(db, ids['viewer'], 'select internal.assistant_access()')
            assert 'search_content' in access['allowed_tools'] and 'business' not in access['proposal_fields']
        finally:
            await db.close()
            await operator.close()
    run(check())


def test_business_content_http_reuses_revision_and_source_ownership_guards(permission_accounts):
    client, ids = permission_accounts
    base = '/v1/admin/content/businesses/residential'
    brand, _, _, _ = run(setup_business(ids))
    corporate_before = client.get('/v1/admin/faq/corporate-contacts', headers=h('viewer')).json()['data']
    foreign_response = client.post(f"/v1/admin/brands/{brand['public_brand_id']}/contacts",
                                  json={'expected_revision': 0, 'changes': contact_body()}, headers=h('editor'))
    assert foreign_response.status_code == 200, foreign_response.text
    foreign = foreign_response.json()['data']
    assert foreign['scope_type'] == 'brand' and foreign['scope_id'] == brand['public_brand_id']
    for role in ('viewer', 'publisher', 'agency', 'service_consumer', 'pending'):
        assert client.post(base + '/contacts', json={'expected_revision': 0, 'changes': contact_body()}, headers=h(role)).status_code == 403
    run(set_bit(ids['editor'], 'projects', can_view=False, can_edit=False))
    run(set_bit(ids['editor'], 'brands', can_view=False, can_edit=False))
    created = client.post(base + '/contacts', json={'expected_revision': 0, 'changes': contact_body()}, headers=h('editor'))
    assert created.status_code == 200, created.text
    row = created.json()['data']
    assert row['scope_type'] == 'business' and row['scope_id'] == 'residential'
    changed = client.put(base + '/contacts/' + row['id'], json={'expected_revision': row['revision'], 'changes': contact_body('028888888')}, headers=h('editor'))
    assert changed.status_code == 200 and changed.json()['data']['revision'] == row['revision'] + 1
    stale = client.put(base + '/contacts/' + row['id'], json={'expected_revision': row['revision'], 'changes': contact_body('029999999')}, headers=h('editor'))
    assert stale.status_code == 409
    assert client.post('/v1/admin/content/businesses/unknown/contacts', json={'expected_revision': 0, 'changes': contact_body()}, headers=h('editor')).status_code == 404
    assert client.put(base + '/contacts/' + foreign['id'], json={'expected_revision': foreign['revision'], 'changes': contact_body('020000000')}, headers=h('editor')).status_code == 404
    section_path = base + '/sections/section.project_intro'
    saved = client.put(section_path, json={'expected_revision': 0, 'changes': {'body': {'th': 'Saved business HTTP narrative'}}}, headers=h('editor'))
    assert saved.status_code == 200, saved.text
    section = saved.json()['data']
    assert section['version']['state'] == 'DRAFT'
    assert client.put(section_path, json={'expected_revision': 0, 'changes': {'body': {'th': 'Stale override'}}}, headers=h('editor')).status_code == 409
    forbidden_field = client.put(base + '/sections/project.public_name', json={'expected_revision': 0, 'changes': {'body': {'th': 'Cannot change descendant'}}}, headers=h('editor'))
    assert forbidden_field.status_code == 404
    result = client.get(base + '/content', headers=h('viewer'))
    assert result.status_code == 200
    assert 'no-store' in {value.strip().lower() for value in result.headers['cache-control'].split(',')}
    data = result.json()['data']
    assert data['scope_type'] == 'business' and data['scope_id'] == 'residential'
    assert any(item['id'] == row['id'] and item['value'] == '028888888' for item in data['contacts'])
    assert not any(item['id'] == foreign['id'] for item in data['contacts'])
    assert any(item['id'] == section['id'] for item in data['sections'])
    assert all(item['owner_type'] == 'section' and item['owner_key'] in {entry['id'] for entry in data['sections']} for item in data['translations'])
    assert client.get('/v1/admin/faq/corporate-contacts', headers=h('viewer')).json()['data'] == corporate_before
    run(set_bit(ids['viewer'], 'knowledge', can_view=False))
    assert client.get(base + '/content', headers=h('viewer')).status_code == 403
    assert client.get('/v1/admin/content/businesses', headers=h('viewer')).status_code == 200
    run(set_bit(ids['editor'], 'knowledge', can_edit=False))
    assert client.post(base + '/contacts', json={'expected_revision': 0, 'changes': contact_body()}, headers=h('editor')).status_code == 403
    assert client.get(base + '/content', headers=h('editor')).status_code == 200


def test_business_page_configuration_target_uses_publication_configuration():
    identity = str(uuid4())
    value = publication_targets({'workflow': {'kind': 'page_config', 'identity': {'id': identity}},
                                 'target': {'level': 'business', 'id': 'residential', 'tab': 'publication', 'page': 'business:residential'}})
    parsed = urlsplit(value['href'])
    assert parsed.path == '/publish'
    assert parse_qs(parsed.query) == {'tab': ['configuration'], 'page': ['business:residential'], 'item': [identity], 'field': ['page.url']}
    task_href = workspace_href('page_config', {'scope_type': 'business', 'scope_id': 'residential',
                                             'tab': 'publication', 'page': 'business:residential', 'item': identity})
    assert urlsplit(task_href).path == parsed.path
    assert parse_qs(urlsplit(task_href).query) == parse_qs(parsed.query)
