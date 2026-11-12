"""K3 composition through the real non-bypass runtime; synthetic drafts roll back."""
from datetime import date, timedelta
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_project_content_core import run, runtime
from test_permission_content import call, set_bit
from test_permission_foundations import permission_accounts, h


async def project(db, ids):
    return await call(db, ids['editor'], "select to_jsonb(p) from hub.projects p where deleted_at is null order by id limit 1")


async def question(db, ids, *, keys=None, kind='text', forms=None, show=True):
    key = 'synthetic_k3_' + uuid4().hex[:12]
    await call(db, ids['editor'], 'select hub.save_faq_question($1,0,$2)', key, {
        'topic': 'design', 'default_level': 'project', 'question_template': {'th': '{project} มีข้อมูลอะไร'},
        'answer_kind': kind, 'fact_keys': keys or [], 'property_types': forms or [], 'is_core': True, 'show_on_project_pages': show})
    await call(db, ids['publisher'], "select hub.approve_faq_question($1,1,'approved')", key)
    return key


async def answer(db, ids, p, key, **changes):
    return await call(db, ids['editor'], 'select hub.save_faq(null,0,$1)', {
        'question_key': key, 'scope_type': 'project', 'scope_id': p['rem_project_id'],
        'applies_to_project_ids': [p['rem_project_id']], 'question': {'th': '{project} มีข้อมูลอะไร'},
        'short_answer': {'th': '{project} มีพื้นที่สำหรับพักผ่อน'}, 'answer_kind': 'text', **changes})


def test_faq_coverage_missing_expired_zero_and_gap_lifecycle(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            # Earlier intake tests also create unnamed projects. This flow needs
            # the named seed; random UUID ordering must not choose its fixture.
            p = await call(db, ids['editor'], "select to_jsonb(p) from hub.projects p where rem_project_id='DEMO-001' and deleted_at is null")
            assert p['public_name']['th']
            key = await question(db, ids, keys=['project.common_fee'], kind='fact')
            faq = await answer(db, ids, p, key, answer_kind='fact', fact_keys=['project.common_fee'],
                               short_answer={'th': 'คำตอบ: {project} มีค่าส่วนกลาง {common_fee}\nกลับหน้าหลัก'})
            compose = lambda: call(db, ids['viewer'], "select hub.faq_composition($1,'th',null)", p['public_project_id'])
            result = await compose()
            assert next(c for c in result['cells'] if c['question_key'] == key)['state'] == 'waiting_for_fact'
            assert not any(c['question_key'] == key for c in result['items'])
            await compose()
            gaps = await call(db, ids['viewer'], 'select hub.faq_gaps($1)', p['public_project_id'])
            gap = next(g for g in gaps if g['question_key'] == key)
            assert sum(g['question_key'] == key for g in gaps) == 1 and gap['occurrences'] == 2
            claimed = await call(db, ids['editor'], "select hub.faq_gap_update($1,$2,'in_progress',true)", UUID(gap['id']), gap['revision'])
            assert claimed['assignee'] == str(ids['editor'])
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], "select hub.faq_gap_update($1,$2,'open',false)", UUID(gap['id']), gap['revision'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['admin'], "select hub.faq_gap_update($1,$2,'open',true)", UUID(gap['id']), claimed['revision'])
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], "select hub.faq_gap_update($1,$2,'resolved',null)", UUID(gap['id']), claimed['revision'])
            fact_sql = "select hub.save_project_fact($1,'project.common_fee','project',$2,$3)"
            fact = {'value_number': 0, 'unit': 'THB/sqm/month', 'as_of': date.today().isoformat()}
            saved = await call(db, ids['editor'], fact_sql, p['public_project_id'], 0, fact)
            result = await compose()
            item = next(c for c in result['items'] if c['question_key'] == key)
            assert item['state'] == 'draft' and '0 บาท/ตร.ม./เดือน' in item['short_answer']
            assert 'คำตอบ:' not in item['short_answer'] and 'กลับหน้าหลัก' not in item['short_answer']
            assert item['as_of'] == date.today().isoformat() and item['lint'] == []
            gap = next(g for g in await call(db, ids['viewer'], 'select hub.faq_gaps($1)', p['public_project_id']) if g['question_key'] == key)
            assert gap['state'] == 'resolved' and gap['resolved_by_faq_id'] == faq['id']
            await call(db, ids['editor'], fact_sql, p['public_project_id'], saved['revision'], {**fact, 'as_of': (date.today() - timedelta(days=181)).isoformat()})
            result = await compose()
            assert any(c['question_key'] == key for c in result['hidden'])
            gap = next(g for g in await call(db, ids['viewer'], 'select hub.faq_gaps($1)', p['public_project_id']) if g['question_key'] == key)
            assert gap['state'] == 'open' and gap['resolved_by_faq_id'] is None and gap['assignee'] == str(ids['editor'])
            coverage = await call(db, ids['viewer'], 'select hub.faq_coverage($1,0,10)', p['public_project_id'])
            assert coverage['total'] == 1 and coverage['rows'][0]['project']['public_id'] == p['public_project_id']
            assert await call(db, ids['viewer'], 'select count(*) from hub.content_gaps where question_key=$1', key) == 1
            await set_bit(ids['viewer'], 'projects', can_view=False, connection=db, manager=ids['admin'])
            assert await call(db, ids['viewer'], 'select count(*) from hub.content_gaps where question_key=$1', key) == 0
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.faq_gaps($1)', p['public_project_id'])
        finally:
            await db.close()
    run(check())


def test_faq_coverage_specificity_duplicate_conflict_corporate_flag_and_fallback(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            p = await project(db, ids)
            key = await question(db, ids)
            await answer(db, ids, p, key, scope_type='corporate', scope_id='sena', applies_to_project_ids=[], short_answer={'th': '{project} ใช้คำตอบองค์กร'})
            first = await call(db, ids['viewer'], "select hub.faq_composition($1,'en',null)", p['public_project_id'])
            item = next(i for i in first['items'] if i['question_key'] == key)
            assert item['inherited'] and item['is_fallback_locale'] and 'องค์กร' in item['short_answer']
            specific = await answer(db, ids, p, key)
            result = await call(db, ids['viewer'], 'select hub.faq_composition($1)', p['public_project_id'])
            assert next(i for i in result['items'] if i['question_key'] == key)['faq_id'] == specific['id']
            await answer(db, ids, p, key)
            result = await call(db, ids['viewer'], 'select hub.faq_composition($1)', p['public_project_id'])
            assert not result['ready'] and any(c['question_key'] == key for c in result['conflicts'])
            assert not any(i['question_key'] == key for i in result['items'])
            hidden_key = await question(db, ids, show=False)
            await answer(db, ids, p, hidden_key, scope_type='corporate', scope_id='sena', applies_to_project_ids=[])
            result = await call(db, ids['viewer'], 'select hub.faq_composition($1)', p['public_project_id'])
            assert next(c for c in result['cells'] if c['question_key'] == hidden_key)['state'] == 'missing'
        finally:
            await db.close()
    run(check())


def test_faq_coverage_lint_numbers_unknown_slots_and_expiry(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            p = await project(db, ids)
            key = await question(db, ids)
            await answer(db, ids, p, key, short_answer={'th': 'Question: {unknown}'})
            expired = await question(db, ids)
            await answer(db, ids, p, expired, effective_to=(date.today() - timedelta(days=1)).isoformat())
            result = await call(db, ids['viewer'], 'select hub.faq_composition($1)', p['public_project_id'])
            item = next(i for i in result['items'] if i['question_key'] == key)
            assert {'name_required', 'direct_answer_required', 'unknown_fact_slot'} <= set(item['lint'])
            assert next(i for i in result['hidden'] if i['question_key'] == expired)['reason'] == 'answer_expired'
        finally:
            await db.close()
    run(check())


@pytest.mark.parametrize('tab', ['projects', 'knowledge'])
def test_faq_coverage_requires_both_source_permissions_next_request(permission_accounts, tab):
    client, ids = permission_accounts
    p = client.get('/v1/admin/projects', headers=h('viewer')).json()['data'][0]['public_project_id']
    paths = ['/v1/admin/faq-coverage', '/v1/admin/faq-gaps', f'/v1/admin/faq-composition/{p}']
    for path in paths:
        response = client.get(path, headers=h('viewer'))
        assert response.status_code == 200, response.text
    run(set_bit(ids['viewer'], tab, can_view=False))
    for path in paths:
        assert client.get(path, headers=h('viewer')).status_code == 403
    assert client.post('/v1/admin/faq-applicability', headers=h('viewer'), json={'rule': {}, 'scope_type': 'corporate', 'scope_id': 'sena'}).status_code == 403
    assert client.get('/v1/admin/brands', headers=h('viewer')).status_code == 200


@pytest.mark.parametrize('role', ['agency', 'pending', 'service_consumer', 'online_staff'])
def test_faq_coverage_external_denial(permission_accounts, role):
    client, _ = permission_accounts
    assert client.get('/v1/admin/faq-coverage', headers=h(role)).status_code == 403
    assert client.get('/v1/admin/faq-gaps', headers=h(role)).status_code == 403
    assert client.post('/v1/admin/faq-applicability', headers=h(role), json={'rule': {}, 'scope_type': 'corporate', 'scope_id': 'sena'}).status_code == 403


def test_faq_coverage_rule_validation_and_bounded_api(permission_accounts):
    client, _ = permission_accounts
    valid = {'scope_type': 'corporate', 'scope_id': 'sena', 'rule': {'product_forms': ['condominium']}}
    result = client.post('/v1/admin/faq-applicability', headers=h('viewer'), json=valid)
    assert result.status_code == 200, result.text
    assert result.json()['data']['frozen'] is False
    for rule in [{'sql': 'true'}, {'product_forms': []}, {'product_forms': ['unknown']}]:
        assert client.post('/v1/admin/faq-applicability', headers=h('viewer'), json={**valid, 'rule': rule}).status_code == 422
    for rule in [{'product_forms': ['house', 'house']}, {'brand_ids': ['not-a-brand']}]:
        assert client.post('/v1/admin/faq-applicability', headers=h('viewer'), json={**valid, 'rule': rule}).status_code == 422
    assert client.get('/v1/admin/faq-coverage?limit=101', headers=h('viewer')).status_code == 422
    assert client.get('/v1/admin/faq-coverage?offset=100001', headers=h('viewer')).status_code == 422
    assert client.patch(f'/v1/admin/faq-gaps/{uuid4()}', headers=h('viewer'), json={'expected_revision': 1, 'state': 'open'}).status_code == 403
    assert client.patch(f'/v1/admin/faq-gaps/{uuid4()}', headers=h('editor'), json={'expected_revision': 1, 'state': 'open', 'assignee': str(uuid4())}).status_code == 422


def test_faq_coverage_approved_price_keeps_conditions_and_withdrawal_hides_answer(permission_accounts):
    from test_unit_type_workflow import create_type, review_english, type_action, save_price, price_action, project as full_project
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            p = await full_project(db, ids['editor'])
            core = await project(db, ids)
            unit = await create_type(db, ids['editor'], p)
            await review_english(db, ids['editor'], p['public_project_id'], unit['id'])
            await type_action(db, ids['editor'], p['public_project_id'], unit, 'submit')
            await type_action(db, ids['publisher'], p['public_project_id'], unit, 'approve')
            key = await question(db, ids, keys=['price.amount'], kind='fact')
            await answer(db, ids, core, key, answer_kind='fact', fact_keys=['price.amount'], short_answer={'th': '{project} ราคาเริ่มต้น {amount}'})
            price = await save_price(db, ids['editor'], p['public_project_id'], unit)
            result = await call(db, ids['viewer'], 'select hub.faq_composition($1)', p['public_project_id'])
            assert any(c['question_key'] == key for c in result['hidden'])
            await review_english(db, ids['editor'], p['public_project_id'], price['price_id'])
            await price_action(db, ids['editor'], p['public_project_id'], price, 'submit')
            await price_action(db, ids['publisher'], p['public_project_id'], price, 'approve')
            result = await call(db, ids['viewer'], 'select hub.faq_composition($1)', p['public_project_id'])
            item = next(i for i in result['items'] if i['question_key'] == key)
            assert '1800000' in item['short_answer'] and item['ai_exposure'] == 'web_only'
            evidence = item['facts'][0]
            assert evidence['basis_size_sqm'] == 25 and evidence['condition_text']['th'] == 'Selected units only'
            assert evidence['valid_to'] and evidence['as_of']
            assert not any(k.startswith('rem_') for k in evidence)
            await price_action(db, ids['publisher'], p['public_project_id'], price, 'withdraw')
            result = await call(db, ids['viewer'], 'select hub.faq_composition($1)', p['public_project_id'])
            assert any(c['question_key'] == key for c in result['hidden'])
        finally:
            await db.close()
    run(check())


def test_faq_coverage_submit_rejects_changed_rule_resolution(permission_accounts):
    from datetime import datetime
    from test_unit_type_workflow import create_type, project as full_project
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            p = await full_project(db, ids['editor'])
            await create_type(db, ids['editor'], p)
            core = await project(db, ids)
            key = await question(db, ids)
            saved = await answer(db, ids, core, key, scope_type='corporate', scope_id='sena', applies_to_project_ids=[], applicability_rule={'product_forms': ['condominium']})
            assert core['rem_project_id'] in saved['version']['applies_to_project_ids']
            translations = await call(db, ids['editor'], "select hub.content_translation_list('knowledge',$1)", saved['id'])
            for translation in translations:
                if translation['th_text'].strip():
                    await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)', UUID(translation['id']), translation['revision'], translation['th_version'], translation['th_text'])
            current_project = await full_project(db, ids['editor'])
            await call(db, ids['editor'], 'select hub.create_commercial_types($1,$2,$3)', UUID(core['id']),
                       [{'public_name': {'th': 'Synthetic mixed form'}, 'product_form': 'house'}], datetime.fromisoformat(current_project['updated_at']))
            faq = await call(db, ids['editor'], 'select hub.faq_read($1)', UUID(saved['id']))
            with pytest.raises(asyncpg.SerializationError, match='Applicability changed'):
                await call(db, ids['editor'], 'select hub.submit_faq($1,$2)', UUID(saved['id']), faq['revision'])
            latest = await call(db, ids['editor'], 'select hub.faq_read($1)', UUID(saved['id']))
            assert latest['state'] == 'DRAFT' and latest['version']['applies_to_project_ids'] == saved['version']['applies_to_project_ids']
        finally:
            await db.close()
    run(check())
