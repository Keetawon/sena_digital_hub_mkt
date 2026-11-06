"""Phase 2 uses real non-superuser SQL with disposable identities only."""
import asyncio
import json
from uuid import UUID, uuid4

import asyncpg
import pytest

from content_workflow_fixture import decide_item
from test_permission_baseline import disposable_operator
from test_permission_content import call, set_bit
from test_permission_db_baseline import runtime as base_runtime
from test_permission_foundations import permission_accounts, h


def run(coroutine):
    return asyncio.run(coroutine)


class ScopedConnection:
    def __init__(self, db, transaction):
        self.db, self.transaction_scope = db, transaction

    def __getattr__(self, name):
        return getattr(self.db, name)

    async def close(self):
        await self.transaction_scope.rollback()
        await self.db.close()


async def runtime(*, probe=False):
    db = await base_runtime(probe=probe)
    await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
    transaction = db.transaction()
    await transaction.start()
    return ScopedConnection(db, transaction)


def test_core_facts_buildings_sources_and_stale_writes(permission_accounts):
    _, ids = permission_accounts

    async def check():
        operator = await disposable_operator()
        db = await runtime()
        try:
            project = await operator.fetchrow("select id,public_project_id,rem_project_id from hub.projects where rem_project_id='DEMO-001' and deleted_at is null")
            original_source = await operator.fetchval('select source_record from staging.dw_projects where rem_project_id=$1', project['rem_project_id'])
            public_id = project['public_project_id']
            async with operator.transaction():
                await operator.execute("""insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance)
                    values($1,jsonb_build_object('project_id',$1::text,'area_rai',1,'area_ngan',2,'area_square_wah',3,'total_unit',100,'total_unit_count',98,'project_status_detail','active'),now(),repeat('a',64),'{}')
                    on conflict(rem_project_id) do update set source_record=excluded.source_record""", project['rem_project_id'])
            initial = await call(db, ids['editor'], 'select hub.project_content_facts($1)', public_id)
            assert initial['rem']['land_area_sqwah'] == 603
            assert initial['rem']['unit_counted'] == 98
            assert initial['computed']['building_count'] is None
            body = {'value_number': 610, 'as_of': '2026-10-21'}
            sql = "select hub.save_project_fact($1,'project.land_area_sqwah','project',0,$2)"
            with pytest.raises(asyncpg.CheckViolationError, match='override reason'):
                await call(db, ids['editor'], sql, public_id, body)
            saved = await call(db, ids['editor'], sql, public_id, {**body, 'override_reason': 'Survey confirmed by Marketing'})
            assert saved['value_number'] == 610 and saved['rem_value'] == 603 and saved['revision'] == 1
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], sql, public_id, {**body, 'override_reason': 'stale'})
            count_sql = "select hub.save_project_fact($1,'project.unit_total','project',0,$2)"
            with pytest.raises(asyncpg.CheckViolationError, match='Confirm'):
                await call(db, ids['editor'], count_sql, public_id, {'value_number': 98, 'as_of': '2026-10-21'})
            await call(db, ids['editor'], count_sql, public_id, {'value_number': 98, 'as_of': '2026-10-21', 'unit_count_choice': 'rem_counted'})
            with pytest.raises(asyncpg.CheckViolationError, match='not editable'):
                await call(db, ids['editor'], "select hub.save_project_fact($1,'project.parking_pct_total','project',0,$2)", public_id, body)
            await call(db, ids['editor'], "select hub.save_project_fact($1,'project.parking_regular','project',0,$2)", public_id, {'value_number': 49, 'as_of': '2026-10-21'})
            result = await call(db, ids['editor'], 'select hub.project_content_facts($1)', public_id)
            assert result['computed']['parking_pct_regular'] == 50
            assert result['computed']['parking_pct_total'] is None
            building = await call(db, ids['editor'], "select hub.save_project_building($1,'tower_a',0,$2)", public_id,
                                  {'name': {'th': 'อาคารทดสอบ'}, 'floors_above': 20, 'skip_floors': [13], 'unit_count': 98})
            assert building['rem_project_id'] == project['rem_project_id']
            result = await call(db, ids['viewer'], 'select hub.project_content_facts($1)', public_id)
            assert result['computed']['building_count'] == 1 and result['computed']['floors_max'] == 20
            await set_bit(ids['viewer'], 'projects', can_view=False)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.project_content_facts($1)', public_id)
            assert await call(db, ids['viewer'], 'select hub.list_brands()') is not None
        finally:
            await db.close()
            if original_source is None:
                await operator.execute('delete from staging.dw_projects where rem_project_id=$1', project['rem_project_id'])
            else:
                await operator.execute('update staging.dw_projects set source_record=$2::jsonb where rem_project_id=$1', project['rem_project_id'], original_source)
            await operator.close()
    run(check())


@pytest.mark.parametrize('actor', ['viewer', 'publisher', 'pending', 'agency', 'service_consumer'])
def test_core_draft_writes_deny_without_edit(permission_accounts, actor):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            for query in [
                'select hub.save_project_fact(null,null,null,0,\'{}\')',
                'select hub.save_project_building(null,null,0,\'{}\')',
                "select hub.save_content_contact('project',null,null,0,'{}')",
                "select hub.save_content_section('project',null,null,0,'{}')",
                'select hub.save_selling_point(null,null,0,\'{}\')',
            ]:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids[actor], query)
        finally:
            await db.close()
    run(check())


def test_registry_admin_is_explicit_not_manage_users(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['admin'], "select hub.save_content_field('project.common_fee',1,'{}')")
            await set_bit(ids['admin'], 'projects', special_actions=['projects.manage_field_catalog'])
            result = await call(db, ids['admin'], "select hub.save_content_field('project.common_fee',1,$1)", {'help': {'th': 'ทดสอบคำแนะนำ'}})
            assert result['revision'] == 2
            await set_bit(ids['editor'], 'projects', special_actions=['projects.manage_field_catalog'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], "select hub.save_content_field('project.common_fee',2,'{}')")
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['admin'], "update hub.field_catalog set label='{}'")
        finally:
            await db.close()
    run(check())


def test_translation_queue_masks_stale_source_and_keeps_reviewed_text(permission_accounts):
    _, ids = permission_accounts

    async def check():
        operator = await disposable_operator()
        await operator.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        db = await runtime(probe=True)
        await operator.execute('grant hub_translation_worker to hub_permission_probe with admin false, inherit false, set true')
        try:
            project = await operator.fetchrow("select id,public_project_id from hub.projects where rem_project_id='DEMO-001' and deleted_at is null")
            public_id = project['public_project_id']
            await call(db, ids['editor'], "select hub.save_content_section('project',$1,'section.project_intro',0,$2)", public_id,
                       {'body': {'th': 'โครงการตัวอย่างมีพื้นที่สีเขียว 20 ไร่ {project}', 'en': 'Previous English'}})
            translations = await call(db, ids['editor'], "select hub.content_translation_list('projects',$1)", public_id)
            t = next(t for t in translations if t['field_key'] == 'section.project_intro')
            assert t['translation_state'] == 'missing' and t['job']['status'] == 'queued'
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], 'select hub.claim_translation()')
            with pytest.raises(asyncpg.CheckViolationError, match='numbers'):
                await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)', UUID(t['id']), t['revision'], t['th_version'], 'Green space 21 rai {project}')
            reviewed = await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)', UUID(t['id']), t['revision'], t['th_version'], 'Green space 20 rai {project}')
            assert reviewed['translation_state'] == 'reviewed'
            sections = await call(db, ids['editor'], 'select hub.project_content_sections($1)', public_id)
            section = sections['sections'][0]
            await call(db, ids['editor'], "select hub.save_content_section('project',$1,'section.project_intro',$2,$3)", public_id, section['revision'],
                       {'body': {'th': 'โครงการตัวอย่างมีพื้นที่สีเขียว 30 ไร่ {project}', 'en': 'Green space 20 rai {project}'}})
            translations = await call(db, ids['editor'], "select hub.content_translation_list('projects',$1)", public_id)
            stale = next(t for t in translations if t['field_key'] == 'section.project_intro')
            assert stale['translation_state'] == 'stale' and stale['reviewed_en'] == 'Green space 20 rai {project}'
            assert stale['th_version'] == t['th_version'] + 1
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)', UUID(t['id']), t['revision'], t['th_version'], 'Green space 20 rai {project}')
            async with db.transaction():
                await db.execute('set local role hub_translation_worker')
                job = await db.fetchval('select hub.claim_translation($1)', UUID(t['id']))
            assert job['field_key'] == 'section.project_intro' and '30' in job['text']
            async with db.transaction():
                await db.execute('set local role hub_translation_worker')
                assert await db.fetchval('select hub.finish_translation($1,$2,$3,$4,null)', UUID(job['id']), UUID(job['lease_token']),
                                               'Green space 30 rai {project}', 'stub-translation') == 'done'
            translations = await call(db, ids['editor'], "select hub.content_translation_list('projects',$1)", public_id)
            completed = next(t for t in translations if t['field_key'] == 'section.project_intro')
            assert completed['translation_state'] == 'stale'
            assert completed['machine_en'] == 'Green space 30 rai {project}'
            assert completed['reviewed_en'] == 'Green space 20 rai {project}'
        finally:
            await db.close()
            await operator.execute('revoke hub_translation_worker from hub_permission_probe')
            await operator.close()
    run(check())


def test_translation_retry_rejects_stale_lease_and_revoked_author(permission_accounts):
    _, ids = permission_accounts

    async def check():
        operator = await disposable_operator()
        db = await runtime(probe=True)
        await operator.execute('grant hub_translation_worker to hub_permission_probe with admin false, inherit false, set true')

        async def worker(query, *args):
            async with db.transaction():
                await db.execute('set local role hub_translation_worker')
                return await db.fetchval(query, *args)

        try:
            public_id = await operator.fetchval("select public_project_id from hub.projects where rem_project_id='DEMO-001' and deleted_at is null")
            await call(db, ids['editor'], "select hub.save_content_section('project',$1,'section.project_intro',0,$2)",
                       public_id, {'body': {'th': 'พื้นที่สีเขียว 20 ไร่'}})
            translations = await call(db, ids['editor'], "select hub.content_translation_list('projects',$1)", public_id)
            current = next(t for t in translations if t['field_key'] == 'section.project_intro')
            translation_id = UUID(current['id'])
            first = await worker('select hub.claim_translation($1)', translation_id)
            finish = 'select hub.finish_translation($1,$2,$3,$4,$5)'
            assert await worker(finish, UUID(first['id']), UUID(first['lease_token']), None, None, 'provider_error') == 'failed'
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.retry_content_translation($1,$2)', translation_id, current['revision'])
            assert await call(db, ids['editor'], 'select hub.retry_content_translation($1,$2)', translation_id, current['revision']) == {'status': 'queued'}
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], 'select hub.retry_content_translation($1,$2)', translation_id, current['revision'])
            second = await worker('select hub.claim_translation($1)', translation_id)
            assert second['lease_token'] != first['lease_token']
            with pytest.raises(asyncpg.SerializationError):
                await worker(finish, UUID(first['id']), UUID(first['lease_token']), 'Green space 20 rai', 'stub', None)
            await set_bit(ids['editor'], 'projects', can_edit=False)
            assert await worker(finish, UUID(second['id']), UUID(second['lease_token']), 'Green space 20 rai', 'stub', None) == 'failed'
            translations = await call(db, ids['viewer'], "select hub.content_translation_list('projects',$1)", public_id)
            current = next(t for t in translations if t['id'] == str(translation_id))
            assert current['machine_en'] is None and current['job']['error_code'] == 'permission_revoked'
        finally:
            await db.close()
            await operator.execute('revoke hub_translation_worker from hub_permission_probe')
            await operator.close()
    run(check())


def test_faq_approval_corporate_draft_versions_and_scope_denial(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            proposal = {'topic': 'design', 'default_level': 'corporate', 'question_template': {'th': 'แนวคิดขององค์กรคืออะไร'}, 'answer_kind': 'text'}
            await call(db, ids['editor'], "select hub.save_faq_question('synthetic_corporate',0,$1)", proposal)
            await set_bit(ids['editor'], 'knowledge', can_approve=True)
            with pytest.raises(asyncpg.InsufficientPrivilegeError, match='cannot approve'):
                await call(db, ids['editor'], "select hub.approve_faq_question('synthetic_corporate',1,'approved')")
            await call(db, ids['publisher'], "select hub.approve_faq_question('synthetic_corporate',1,'approved')")
            body = {'question_key': 'synthetic_corporate', 'scope_type': 'corporate', 'scope_id': 'sena',
                    'question': {'th': 'แนวคิดของ SENA คืออะไร'}, 'short_answer': {'th': 'SENA ให้ความสำคัญกับการอยู่อาศัย'}, 'detail': {'th': 'เนื้อหาการตลาดสมมติ'},
                    'answer_kind': 'text', 'source_ref': 'Synthetic marketing evidence'}
            first = await call(db, ids['editor'], 'select hub.save_faq(null,0,$1)', body)
            second = await call(db, ids['editor'], 'select hub.save_faq($1,1,$2)', UUID(first['id']), {**body, 'detail': {'th': 'เนื้อหาฉบับแก้ไข'}})
            assert second['scope_type'] == 'corporate' and second['state'] == 'DRAFT'
            assert len(second['history']) == 2
            assert second['history'][1]['detail']['th'] == 'เนื้อหาการตลาดสมมติ'
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], 'select hub.save_faq($1,1,$2)', UUID(first['id']), body)
            await set_bit(ids['viewer'], 'knowledge', can_view=False)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.faq_read($1)', UUID(first['id']))
        finally:
            await db.close()
    run(check())


def test_content_api_registry_readiness_and_immediate_revocation(permission_accounts):
    client, ids = permission_accounts
    registry = client.get('/v1/admin/content/fields', headers=h('viewer'))
    assert registry.status_code == 200
    fields = {f['field_key']: f for f in registry.json()['data']['items']}
    assert len(fields) > 200
    assert fields['project.common_fee']['review_every_days'] == 180
    assert fields['disclosure.legal_document_asset_id']['default_ai_exposure'] == 'internal'
    assert fields['web_page.content_sha256']['status'] == 'active'
    project = client.get('/v1/admin/projects', headers=h('viewer')).json()['data'][0]
    public_id = project['public_project_id']
    content = client.get(f'/v1/admin/projects/{public_id}/content', headers=h('viewer'))
    assert content.status_code == 200, content.text
    ready = content.json()['data']['readiness']
    assert ready['mode'] == 'PRIVATE_DRAFT' and ready['published'] is False
    missing = {item['field_key'] for item in ready['items'] if item['required'] and not item['complete']}
    assert {'section.project_intro', 'section.selling_summary', 'section.concept_name', 'selling_point.count'} <= missing
    run(set_bit(ids['viewer'], 'projects', can_view=False))
    assert client.get(f'/v1/admin/projects/{public_id}/content', headers=h('viewer')).status_code == 403
    assert client.get('/v1/admin/faq/questions', headers=h('viewer')).status_code == 200
    assert client.get('/v1/admin/content/fields', headers=h('viewer')).status_code == 200
    run(set_bit(ids['viewer'], 'brands', can_view=False))
    run(set_bit(ids['viewer'], 'knowledge', can_view=False))
    promotion_registry = client.get('/v1/admin/content/fields', headers=h('viewer'))
    assert promotion_registry.status_code == 200
    assert {field['entity'] for field in promotion_registry.json()['data']['items']} == {'promotion'}
    run(set_bit(ids['viewer'], 'promotions', can_view=False))
    assert client.get('/v1/admin/content/fields', headers=h('viewer')).status_code == 403


@pytest.mark.parametrize('actor', ['agency', 'pending', 'service_consumer'])
def test_content_api_external_and_inactive_denial(permission_accounts, actor):
    client, _ = permission_accounts
    for path in ('/v1/admin/content/fields', '/v1/admin/content/glossary', '/v1/admin/faq', '/v1/admin/faq/questions'):
        assert client.get(path, headers=h(actor)).status_code == 403


def test_content_api_no_client_authority_or_invalid_draft_payload(permission_accounts):
    client, _ = permission_accounts
    assert client.patch('/v1/admin/content/fields/project.common_fee', headers=h('admin'),
                        json={'expected_revision': 1, 'changes': {}}).status_code == 403
    assert client.post('/v1/admin/faq', headers=h('editor'),
                       json={'expected_revision': 0, 'changes': {}, 'approved_by': str(uuid4())}).status_code == 422
    assert client.post('/v1/admin/faq', headers=h('viewer'),
                       json={'expected_revision': 0, 'changes': {}}).status_code == 403


def test_contacts_allow_any_domain_but_require_shared_mailbox_and_exact_scope(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            await set_bit(ids['admin'], 'projects', special_actions=['projects.manage_field_catalog'])
            with pytest.raises(asyncpg.CheckViolationError, match='allowlist retired'):
                await call(db, ids['admin'], "select hub.save_contact_domain('company.example',0,'active')")
            assert 'email_domains' not in await call(db, ids['editor'], 'select hub.content_fields()')
            sql = "select hub.save_content_contact('corporate','sena',null,0,$1)"
            body = {'channel': 'email', 'value': 'shared@company.example', 'url': 'mailto:shared@company.example', 'is_primary': True}
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], sql, body)
            body['shared_mailbox_confirmed'] = True
            for changes in ({'value': 'invalid address'}, {'value': 'shared@-invalid.example', 'url': None}, {'url': 'mailto:someone@company.example'}, {'label': {'unknown_locale': 'x'}}):
                with pytest.raises(asyncpg.CheckViolationError):
                    await call(db, ids['editor'], sql, {**body, **changes})
            contact = await call(db, ids['editor'], sql, body)
            for domain in ('gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'live.com', 'unlisted-group.example', 'GMAIL.COM'):
                address = 'synthetic-shared@' + domain
                draft = {**body, 'value': address, 'url': 'mailto:' + address, 'is_primary': False}
                with pytest.raises(asyncpg.CheckViolationError):
                    await call(db, ids['editor'], sql, {**draft, 'shared_mailbox_confirmed': False})
                saved = await call(db, ids['editor'], sql, draft)
                assert saved['value'] == address and saved['shared_mailbox_confirmed'] is True
            with pytest.raises(asyncpg.UniqueViolationError):
                await call(db, ids['editor'], sql, body)
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], sql, {'channel': 'facebook', 'value': 'page', 'url': 'https://facebook.com.evil.example/page'})
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], sql, {})
            changed = await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',$1,1,$2)", UUID(contact['id']), {**body, 'is_primary': False})
            assert changed['revision'] == 2
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',$1,1,$2)", UUID(contact['id']), body)
            await set_bit(ids['editor'], 'knowledge', can_edit=False)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], sql, body)
            assert await call(db, ids['editor'], "select hub.content_contacts('corporate','sena')")
        finally:
            await db.close()
    run(check())


def test_selling_point_english_review_advances_revision_and_preserves_old_text(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            project = await call(db, ids['editor'], "select public_project_id from hub.projects where rem_project_id='DEMO-001' and deleted_at is null")
            body = {'title': {'th': 'พื้นที่พักผ่อน'}, 'detail': {'th': 'สวนสำหรับทุกคน'}}
            point = await call(db, ids['editor'], 'select hub.save_selling_point($1,null,0,$2)', project, body)
            translations = await call(db, ids['editor'], "select hub.content_translation_list('projects',$1)", project)
            t = next(row for row in translations if row['owner_key'] == point['point_key'] and row['field_key'] == 'selling_point.title')
            await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)', UUID(t['id']), t['revision'], t['th_version'], 'A place to relax')
            latest = await call(db, ids['editor'], 'select hub.project_content_sections($1)', project)
            saved = next(row for row in latest['selling_points'] if row['point_key'] == point['point_key'])
            assert saved['revision'] == 2 and saved['title']['en'] == 'A place to relax'
            assert 'en' not in saved['history'][1]['title']
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], 'select hub.save_selling_point($1,$2,1,$3)', project, UUID(point['point_key']), body)
        finally:
            await db.close()
    run(check())


def test_submitted_faq_is_immutable_and_financial_topics_never_queue_ai(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            proposal = {'topic': 'commercial_terms', 'default_level': 'corporate', 'question_template': {'th': 'เงื่อนไข SENA คืออะไร'}, 'answer_kind': 'text'}
            await call(db, ids['editor'], "select hub.save_faq_question('synthetic_financial',0,$1)", proposal)
            await call(db, ids['publisher'], "select hub.approve_faq_question('synthetic_financial',1,'approved')")
            body = {'question_key': 'synthetic_financial', 'scope_type': 'corporate', 'scope_id': 'sena', 'question': proposal['question_template'],
                    'short_answer': {'th': 'SENA ให้ฝ่ายขายยืนยันเงื่อนไข'}, 'answer_kind': 'text'}
            saved = await call(db, ids['editor'], 'select hub.save_faq(null,0,$1)', body)
            faq = UUID(saved['id'])
            for bad in ({'source_ref': 'unsafe', 'source_url': 'javascript:alert(1)'}, {'answer_kind': None}):
                with pytest.raises(asyncpg.CheckViolationError):
                    await call(db, ids['editor'], 'select hub.save_faq($1,1,$2)', faq, {**body, **bad})
            translations = await call(db, ids['editor'], "select hub.content_translation_list('knowledge',$1)", str(faq))
            assert translations and all(row['job'] is None for row in translations)
            for t in translations:
                if t['field_key'] in ('faq.question', 'faq.short_answer'):
                    english = 'What are the SENA terms?' if t['field_key'] == 'faq.question' else 'Contact SENA Sales to confirm the terms.'
                    await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)', UUID(t['id']), t['revision'], t['th_version'], english)
            current = await call(db, ids['editor'], 'select hub.faq_read($1)', faq)
            submitted = await call(db, ids['editor'], 'select hub.submit_faq($1,$2)', faq, current['revision'])
            assert submitted['state'] == 'IN_REVIEW'
            translations = await call(db, ids['editor'], "select hub.content_translation_list('knowledge',$1)", str(faq))
            t = next(row for row in translations if row['field_key'] == 'faq.question')
            with pytest.raises(asyncpg.CheckViolationError, match='immutable'):
                await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)', UUID(t['id']), t['revision'], t['th_version'], 'Changed title')
            with pytest.raises(asyncpg.CheckViolationError, match='frozen'):
                await call(db, ids['editor'], 'select hub.save_faq($1,$2,$3)', faq, submitted['revision'], body)
            returned = await decide_item(db, ids['publisher'], 'faq', {'id': str(faq)}, 'return')
            newer = await call(db, ids['editor'], 'select hub.save_faq($1,$2,$3)', faq, returned['source_revision'], {**body, 'detail': {'th': 'ฉบับใหม่'}})
            assert newer['history'][1]['state'] == 'RETURNED'
            assert newer['history'][1]['short_answer']['en'] == 'Contact SENA Sales to confirm the terms.'
        finally:
            await db.close()
    run(check())


def test_legacy_faq_is_read_only_and_section_rejection_withdraws_versions(permission_accounts):
    _, ids = permission_accounts

    async def check():
        operator = await disposable_operator()
        db = await runtime()
        try:
            project = await operator.fetchval("select rem_project_id from hub.projects where rem_project_id='DEMO-001' and deleted_at is null")
            batch = uuid4().hex * 2
            await operator.execute("insert into staging.knowledge_batches(manifest_sha256,manifest) values($1,'{}')", batch)
            candidates = []
            for kind in ('faq', 'section'):
                candidate = uuid4()
                evidence = {'canonical_question': {'th': 'คำถามสมมติ'}, 'short_answer': {'th': 'คำตอบสมมติ'}, 'title': {'th': 'ชื่อสมมติ'}, 'body': {'th': 'เนื้อหาสมมติ'}}
                await operator.execute("insert into staging.knowledge_candidates(id,batch_sha256,source_key,kind,project_ids,topic,source_ref,evidence) values($1,$2,$3,$3,array[$4],'design','synthetic',$5::jsonb)", candidate, batch, kind, project, json.dumps(evidence))
                candidates.append((kind, candidate))
            # Seed before the runtime transaction takes the progress-cache lock.
            for kind, candidate in candidates:
                sql = 'select hub.review_knowledge_candidate($1,$2,$3,$4,$5,false,null,null)'
                if kind == 'faq':
                    for choice in ('accepted', 'rejected'):
                        with pytest.raises(asyncpg.CheckViolationError, match='read-only'):
                            await call(db, ids['editor'], sql, candidate, 0, choice, [project], 'Synthetic legacy decision')
                    assert not await call(db, ids['editor'], 'select exists(select 1 from hub.faqs where candidate_id=$1)', candidate)
                    continue
                await call(db, ids['editor'], sql, candidate, 0, 'accepted', [project], 'Synthetic acceptance')
                table = 'hub.faqs' if kind == 'faq' else 'hub.content_sections'
                # The RLS reader is the same runtime role used by HTTP requests.
                identity = await call(db, ids['editor'], f'select to_jsonb(t) from {table} t where candidate_id=$1', candidate)
                assert identity['state'] == 'DRAFT'
                await call(db, ids['editor'], sql, candidate, 1, 'rejected', [project], 'Synthetic rejection')
                withdrawn = await call(db, ids['editor'], f'select to_jsonb(t) from {table} t where candidate_id=$1', candidate)
                assert withdrawn['state'] == 'WITHDRAWN' and withdrawn['draft_version_id'] is None
                versions, fk = ('hub.faq_versions', 'faq_id') if kind == 'faq' else ('hub.content_section_versions', 'section_id')
                assert await call(db, ids['editor'], f'select bool_and(state=\'WITHDRAWN\') from {versions} where {fk}=$1', UUID(identity['id']))
        finally:
            await db.close()
            await operator.close()
    run(check())
