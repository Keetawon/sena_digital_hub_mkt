"""W4 decisions through the real runtime role on the disposable database."""
import asyncio
import json
from datetime import datetime
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4

import asyncpg
import pytest
from pydantic import ValidationError

from sena_hub_api.content_workflow import WorkflowDecision, WorkflowSaveApprove, WorkflowTarget, publication_targets
from test_permission_baseline import disposable_operator
from test_permission_content import call, set_bit
from test_permission_db_baseline import runtime as committed_runtime
from test_permission_foundations import permission_accounts, h
from test_project_content_core import runtime


def contact_body(number='021234567', **changes):
    return {'channel': 'phone', 'value': number, 'label': {'th': 'Synthetic contact', 'en': 'Synthetic contact'},
            'is_primary': False, 'ai_exposure': 'web_only', **changes}


async def approve_item(db, ids, kind, identity, *, editor='editor', manager='publisher', reason=None):
    """Explicit fixture step, never an auto-approval hidden in global setup."""
    current = await call(db, ids[editor], 'select hub.content_workflow_read($1,$2)', kind, identity)
    submitted = await call(db, ids[editor], 'select hub.content_workflow_submit($1,$2,$3)', kind, identity, current['expected_hash'])
    return await call(db, ids[manager], 'select hub.content_workflow_review($1,$2,$3,$4,$5)',
                      kind, identity, submitted['expected_hash'], 'approve', reason)


def test_workflow_inputs_close_arbitrary_sql_identity_and_require_reasons():
    for identity in ({'id': str(uuid4()), 'table': 'user_account'}, {'id': ''}, {'id': 12}):
        with pytest.raises(ValidationError):
            WorkflowTarget(kind='contact', identity=identity)
    with pytest.raises(ValidationError):
        WorkflowTarget(kind='user_account', identity={'id': str(uuid4())})
    with pytest.raises(ValidationError):
        WorkflowDecision(kind='contact', identity={'id': str(uuid4())}, expected_hash='a' * 64, decision='return')
    with pytest.raises(ValidationError):
        WorkflowSaveApprove(kind='contact', identity={'id': str(uuid4())}, expected_hash='a' * 64, changes={}, reason='   ')


def test_workflow_submit_freezes_old_save_and_returns_only_the_item(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            first = await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',null,0,$1)", contact_body())
            second = await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',null,0,$1)", contact_body('029876543'))
            target = {'id': first['id']}
            draft = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'contact', target)
            assert draft['source_revision'] == first['revision']
            assert datetime.fromisoformat(draft['source_updated_at']) == datetime.fromisoformat(first['updated_at'])
            assert draft['can_submit'] and not draft['can_return'] and not draft['can_withdraw']
            assert not draft['can_approve'] and not draft['can_save_approve']
            submitted = await call(db, ids['editor'], 'select hub.content_workflow_submit($1,$2,$3)', 'contact', target, draft['expected_hash'])
            assert submitted['state'] == 'IN_REVIEW' and not submitted['can_submit']
            manager = await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'contact', target)
            assert manager['can_approve'] and manager['can_return'] and not manager['approval_requires_reason']
            reader = await call(db, ids['viewer'], 'select hub.content_workflow_read($1,$2)', 'contact', target)
            assert all(reader[key] is False for key in ['can_submit', 'can_approve', 'can_return', 'can_withdraw', 'can_save_approve'])
            with pytest.raises(asyncpg.CheckViolationError, match='frozen'):
                await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',$1,1,$2)", UUID(first['id']), contact_body('020000000'))
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], "select hub.content_workflow_review($1,$2,$3,'approve',null)", 'contact', target, submitted['expected_hash'])
            with pytest.raises(asyncpg.CheckViolationError, match='reason'):
                await call(db, ids['publisher'], "select hub.content_workflow_review($1,$2,$3,'return',null)", 'contact', target, submitted['expected_hash'])
            returned = await call(db, ids['publisher'], "select hub.content_workflow_review($1,$2,$3,'return',$4)",
                                  'contact', target, submitted['expected_hash'], 'Correct this telephone')
            assert returned['state'] == 'RETURNED'
            neighbour = await call(db, ids['viewer'], 'select hub.content_workflow_read($1,$2)', 'contact', {'id': second['id']})
            assert neighbour['state'] == 'DRAFT'
            changed = await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',$1,1,$2)", UUID(first['id']), contact_body('020000000'))
            assert changed['revision'] == 2
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], 'select hub.content_workflow_submit($1,$2,$3)', 'contact', target, draft['expected_hash'])
        finally:
            await db.close()
    asyncio.run(check())


def test_workflow_manager_self_approval_reason_and_atomic_save(permission_accounts):
    _, ids = permission_accounts

    async def check():
        await set_bit(ids['editor'], 'knowledge', can_approve=True)
        db = await runtime()
        try:
            row = await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',null,0,$1)", contact_body())
            target = {'id': row['id']}
            draft = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'contact', target)
            assert draft['can_save_approve'] and draft['approval_requires_reason']
            assert not draft['can_approve']
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], 'select hub.content_workflow_save_approve($1,$2,$3,$4,$5)',
                           'contact', target, draft['expected_hash'], contact_body('invalid'), 'Manager confirmation')
            unchanged = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'contact', target)
            assert unchanged['expected_hash'] == draft['expected_hash'] and unchanged['state'] == 'DRAFT'
            approved = await call(db, ids['editor'], 'select hub.content_workflow_save_approve($1,$2,$3,$4,$5)',
                                  'contact', target, draft['expected_hash'], contact_body('021111111'), 'Manager confirmed source')
            assert approved['state'] == 'APPROVED' and approved['self_approval'] is True
            assert approved['decision_reason'] == 'Manager confirmed source'
            assert approved['approved_by'] == str(ids['editor'])
            await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',$1,2,$2)", UUID(row['id']), contact_body('022222222'))
            draft = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'contact', target)
            submitted = await call(db, ids['editor'], 'select hub.content_workflow_submit($1,$2,$3)', 'contact', target, draft['expected_hash'])
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], 'select hub.content_workflow_save_approve($1,$2,$3,$4,$5)',
                           'contact', target, submitted['expected_hash'], contact_body('invalid'), 'Correct submitted item')
            assert (await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'contact', target))['state'] == 'IN_REVIEW'
            approved = await call(db, ids['editor'], 'select hub.content_workflow_save_approve($1,$2,$3,$4,$5)',
                                  'contact', target, submitted['expected_hash'], contact_body('023333333'), 'Correct submitted item')
            assert approved['state'] == 'APPROVED' and approved['self_approval'] is True
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('source_tab', ['brands', 'knowledge'])
def test_asset_review_uses_its_own_source_without_projects_grants(permission_accounts, source_tab):
    from test_project_media import upload
    _, ids = permission_accounts

    async def check():
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        transaction = db.transaction()
        await transaction.start()
        try:
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['editor']))
            asset = await upload(db, ids['editor'])
            if source_tab == 'brands':
                await db.execute("insert into hub.brand_assets(brand_id,asset_id,asset_role,is_primary) select id,$1,'logo_primary',false from hub.brands where deleted_at is null order by id limit 1", UUID(asset['id']))
            else:
                batch, candidate = uuid4().hex + uuid4().hex, uuid4()
                await db.execute("insert into staging.knowledge_batches(manifest_sha256,manifest) values($1,'{}')", batch)
                await db.execute("insert into staging.knowledge_candidates(id,batch_sha256,source_key,kind,topic,source_ref,evidence) values($1,$2,$3,'asset','synthetic','Synthetic fixture','{}')", candidate, batch, uuid4().hex)
                await db.execute('insert into hub.knowledge_asset_links(candidate_id,asset_id,review_revision) values($1,$2,1)', candidate, UUID(asset['id']))
            for role in ['editor', 'publisher']:
                for tab in ['projects', 'brands', 'knowledge']:
                    if tab != source_tab:
                        await set_bit(ids[role], tab, can_view=False, can_edit=False, can_approve=False)
            reviewed = await approve_item(db, ids, 'asset', {'id': asset['id']})
            assert reviewed['state'] == 'APPROVED' and reviewed['source_tabs'] == [source_tab]
            source_stamp = await db.fetchval("select jsonb_build_object('revision',media_revision,'updated_at',updated_at) from hub.assets where id=$1", UUID(asset['id']))
            assert reviewed['source_revision'] == source_stamp['revision']
            assert datetime.fromisoformat(reviewed['source_updated_at']) == datetime.fromisoformat(source_stamp['updated_at'])
            assert reviewed['can_approve'] is False and reviewed['can_withdraw'] is True
            assert not await db.fetchval("select payload ? '_tabs' or payload ? '_tab' from hub.content_review_versions where id=$1", UUID(reviewed['version_id']))
            project = await db.fetchval('select id from hub.projects where deleted_at is null order by id limit 1')
            await db.execute("insert into hub.entity_assets(project_id,asset_id,asset_role,is_primary) values($1,$2,'hero',false)", project, UUID(asset['id']))
            current = await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'asset', {'id': asset['id']})
            assert current['can_approve'] is False
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['publisher'], "select hub.content_workflow_review($1,$2,$3,'withdraw',$4)",
                           'asset', {'id': asset['id']}, current['expected_hash'], 'Shared source requires all owners')
        finally:
            await transaction.rollback()
            await db.close()
    asyncio.run(check())


def test_review_certificate_pins_english_reviewer_and_freezes_submitted_translation(permission_accounts):
    _, ids = permission_accounts

    async def check():
        await set_bit(ids['viewer'], 'projects', can_view=True, can_edit=True)
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        transaction = db.transaction()
        await transaction.start()
        try:
            public_id = await db.fetchval('select public_project_id from hub.projects where deleted_at is null order by id limit 1')
            building = await call(db, ids['editor'], 'select hub.save_project_building($1,$2,0,$3)', public_id, 'w4_' + uuid4().hex,
                                  {'name': {'th': 'Synthetic building'}, 'floors_above': 3, 'unit_count': 12})
            identity = {'project_id': building['project_id'], 'building_key': building['building_key']}
            translation = next(row for row in await call(db, ids['viewer'], "select hub.content_translation_list('projects',$1)", public_id)
                               if row['row_ref'].get('building_key') == building['building_key'])
            await call(db, ids['viewer'], 'select hub.review_content_translation($1,$2,$3,$4)',
                       UUID(translation['id']), translation['revision'], translation['th_version'], 'Reviewed building')
            current = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'building', identity)
            submitted = await call(db, ids['editor'], 'select hub.content_workflow_submit($1,$2,$3)', 'building', identity, current['expected_hash'])
            current_translation = next(row for row in await call(db, ids['viewer'], "select hub.content_translation_list('projects',$1)", public_id)
                                       if row['id'] == translation['id'])
            assert current_translation['editable'] is False
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['viewer'], 'select hub.review_content_translation($1,$2,$3,$4)', UUID(translation['id']),
                           current_translation['revision'], current_translation['th_version'], 'Reviewed building')
            approved = await call(db, ids['publisher'], "select hub.content_workflow_review($1,$2,$3,'approve',null)",
                                  'building', identity, submitted['expected_hash'])
            assert ids['viewer'] in await db.fetchval('select editors from hub.content_review_versions where id=$1', UUID(approved['version_id']))
            await set_bit(ids['viewer'], 'projects', can_edit=False)
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['viewer']))
            dependency = await db.fetchval("select hub.web_dependency('project_buildings',$1,'projects')", identity)
            with pytest.raises(asyncpg.InsufficientPrivilegeError, match='English reviewer'):
                async with db.transaction():
                    await db.execute('select hub.publication_dependency_check($1,true,true)', dependency)
        finally:
            await transaction.rollback()
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('state', ['DRAFT', 'IN_REVIEW', 'APPROVED'])
def test_faq_withdraw_retains_the_exact_version_and_history(permission_accounts, state):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            question = 'w4_' + uuid4().hex
            await call(db, ids['editor'], 'select hub.save_faq_question($1,0,$2)', question,
                       {'topic': 'design', 'default_level': 'corporate', 'question_template': {'th': 'Synthetic question'}, 'answer_kind': 'text'})
            await call(db, ids['publisher'], "select hub.approve_faq_question($1,1,'approved')", question)
            saved = await call(db, ids['editor'], 'select hub.save_faq(null,0,$1)',
                               {'question_key': question, 'scope_type': 'corporate', 'scope_id': 'sena',
                                'question': {'th': 'Synthetic question'}, 'short_answer': {'th': 'Synthetic answer'},
                                'detail': {'th': 'Synthetic detail'}, 'answer_kind': 'text', 'source_ref': 'Synthetic evidence'})
            identity = {'id': saved['id']}
            if state != 'DRAFT':
                while True:
                    translations = await call(db, ids['editor'], "select hub.content_translation_list('knowledge',$1)", saved['id'])
                    pending = next((item for item in translations if item['editable'] and item['th_text'].strip() and item['translation_state'] != 'reviewed'), None)
                    if pending is None:
                        break
                    await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)',
                               UUID(pending['id']), pending['revision'], pending['th_version'], pending['th_text'])
                current = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'faq', identity)
                current = await call(db, ids['editor'], 'select hub.content_workflow_submit($1,$2,$3)', 'faq', identity, current['expected_hash'])
                if state == 'APPROVED':
                    await call(db, ids['publisher'], "select hub.content_workflow_review($1,$2,$3,'approve',null)", 'faq', identity, current['expected_hash'])
            before = await call(db, ids['viewer'], 'select hub.faq_read($1)', UUID(saved['id']))
            current = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'faq', identity)
            manager = await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'faq', identity)
            reader = await call(db, ids['viewer'], 'select hub.content_workflow_read($1,$2)', 'faq', identity)
            assert current['can_withdraw'] is (state == 'DRAFT')
            assert manager['can_withdraw'] is (state != 'DRAFT')
            assert reader['can_withdraw'] is False
            if state == 'DRAFT':
                with pytest.raises(asyncpg.InsufficientPrivilegeError, match='author'):
                    await call(db, ids['publisher'], "select hub.content_workflow_review($1,$2,$3,'withdraw',$4)", 'faq', identity, current['expected_hash'], 'Not the draft author')
            withdrawn = await call(db, ids['editor' if state == 'DRAFT' else 'publisher'],
                                   "select hub.content_workflow_review($1,$2,$3,'withdraw',$4)", 'faq', identity, current['expected_hash'], 'Withdraw this answer')
            after = await call(db, ids['viewer'], 'select hub.faq_read($1)', UUID(saved['id']))
            assert withdrawn['state'] == 'WITHDRAWN'
            assert len(after['history']) == len(before['history'])
            assert after['version']['id'] == before['version']['id']
            assert after['version']['short_answer'] == before['version']['short_answer']
            assert after['version']['decision_reason'] == 'Withdraw this answer'
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('role', ['viewer', 'agency', 'service_consumer', 'pending'])
def test_workflow_http_mutation_and_exact_source_denial(permission_accounts, role):
    client, _ = permission_accounts
    response = client.post('/v1/admin/content-workflow/submit', headers=h(role),
                           json={'kind': 'contact', 'identity': {'id': str(uuid4())}, 'expected_hash': 'a' * 64})
    assert response.status_code in {403, 404}


def test_staged_value_invalidation_ignores_reimport_unused_values_and_bu(permission_accounts):
    _, ids = permission_accounts

    async def check():
        operator = await disposable_operator()
        db = await committed_runtime()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        rem_id = 'W4-' + uuid4().hex
        public_id = 'prj_' + uuid4().hex
        project = uuid4()
        source = {'project_id': rem_id, 'area_rai': 1, 'area_ngan': 0, 'area_square_wah': 0,
                  'total_unit': 120, 'total_unit_count': 118, 'rem_bu_id': 'fixture-bu-1',
                  'buildings': [{'building_key': 'tower', 'name': {'th': 'Synthetic tower'}, 'floors_above': 12, 'unit_count': 118}]}
        try:
            await operator.execute("select set_config('app.actor_id',$1,false)", str(ids['editor']))
            await operator.execute("insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint) values($1,'W4 synthetic project',now(),repeat('4',64))", rem_id)
            await operator.execute("insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance) values($1,$2::jsonb,now(),repeat('4',64),'{}')", rem_id, json.dumps(source))
            await operator.execute('insert into hub.projects(id,public_project_id,rem_project_id) values($1,$2,$3)', project, public_id, rem_id)
            row = await call(db, ids['editor'], "select hub.save_project_building($1,'tower',0,$2)", public_id, {'use_rem': True})
            identity = {'project_id': str(project), 'building_key': 'tower'}
            approved = await approve_item(db, ids, 'building', identity)
            version_id = UUID(approved['version_id'])
            before = await operator.fetchval('select payload::text from hub.content_review_versions where id=$1', version_id)
            for changed in [source, {**source, 'total_unit': 999}, {**source, 'rem_bu_id': 'fixture-bu-2'}]:
                await operator.execute('update staging.dw_projects set source_record=$2::jsonb,source_snapshot_at=clock_timestamp() where rem_project_id=$1', rem_id, json.dumps(changed))
                current = await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'building', identity)
                assert current['needs_reapproval'] is False
            changed = {**source, 'buildings': [{**source['buildings'][0], 'floors_above': 13}]}
            await operator.execute('update staging.dw_projects set source_record=$2::jsonb where rem_project_id=$1', rem_id, json.dumps(changed))
            current = await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'building', identity)
            assert current['needs_reapproval'] is True
            assert current['staged_evidence']['approved']['building']['floors_above'] == 12
            assert current['staged_evidence']['current']['building']['floors_above'] == 13
            with pytest.raises(asyncpg.SerializationError, match='Confirm the current imported building'):
                await call(db, ids['editor'], 'select hub.content_workflow_submit($1,$2,$3)', 'building', identity, current['expected_hash'])
            assert await operator.fetchval('select payload::text from hub.content_review_versions where id=$1', version_id) == before
            assert await operator.fetchval("select count(*) from audit.change_log where table_name='hub.content_review_versions' and after_row->>'id'=$1 and after_row->>'staged_invalidated_at' is not null", str(version_id)) == 1
            view_only = await call(db, ids['viewer'], 'select hub.content_workflow_read($1,$2)', 'building', identity)
            assert view_only['staged_evidence'] is None
            event_id = await operator.fetchval("select id from audit.change_log where table_name='hub.content_review_versions' and after_row->>'id'=$1 and after_row->>'staged_invalidated_at' is not null order by id desc limit 1", str(version_id))
            detail = await call(db, ids['publisher'], 'select hub.content_history_event($1,$2,$3)', 'project', public_id, event_id)
            assert detail['action'] == 'needs_reapproval'
            assert detail['after']['staged_evidence']['approved']['building']['floors_above'] == 12
            assert detail['after']['staged_evidence']['current']['building']['floors_above'] == 13
            assert 'rem_bu_id' not in json.dumps(detail['after']) and 'source_snapshot_at' not in json.dumps(detail['after'])
            detail = await call(db, ids['viewer'], 'select hub.content_history_event($1,$2,$3)', 'project', public_id, event_id)
            assert 'staged_evidence' not in detail['after']
            home = await call(db, ids['publisher'], "select hub.workspace_home(null,null,0,100,'approval',null)")
            assert any(t['version_id'] == str(version_id) and t['needs_reapproval'] for t in home['tasks'])
            # Read-only projections cannot manufacture another audit decision.
            await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'building', identity)
            assert await operator.fetchval("select count(*) from audit.change_log where table_name='hub.content_review_versions' and after_row->>'id'=$1 and after_row->>'staged_invalidated_at' is not null", str(version_id)) == 1
        finally:
            # Keep immutable fixture review history; hide the dedicated synthetic
            # source from subsequent list tests. The disposable cluster is reset.
            await operator.execute('update hub.projects set deleted_at=clock_timestamp() where id=$1', project)
            await db.close()
            await operator.close()
    asyncio.run(check())


def test_home_tasks_use_exact_certificate_and_current_source_permissions(permission_accounts):
    _, ids = permission_accounts

    async def check():
        await set_bit(ids['viewer'], 'knowledge', special_actions=['knowledge.publish_web'])
        db = await runtime()
        try:
            row = await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',null,0,$1)", contact_body())
            identity = {'id': row['id']}
            draft = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'contact', identity)
            submitted = await call(db, ids['editor'], 'select hub.content_workflow_submit($1,$2,$3)', 'contact', identity, draft['expected_hash'])

            async def tasks(role, category):
                home = await call(db, ids[role], 'select hub.workspace_home(null,null,0,100,$1,null)', category)
                return [t for t in home['tasks'] if t['kind'] == 'contact' and t['item_id'] == row['id']]

            pending = await tasks('publisher', 'approval')
            assert len(pending) == 1 and pending[0]['version_id'] == submitted['version_id']
            assert pending[0]['context']['item'] == row['id'] and pending[0]['context']['version'] == submitted['version_id']
            assert await tasks('viewer', 'approval') == []
            returned = await call(db, ids['publisher'], "select hub.content_workflow_review($1,$2,$3,'return',$4)",
                                  'contact', identity, submitted['expected_hash'], 'Correct the exact contact')
            author_task = await tasks('editor', 'returned')
            assert author_task[0]['version_id'] == returned['version_id']
            await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',$1,1,$2)", UUID(row['id']), contact_body('029999999'))
            assert await tasks('editor', 'returned') == [], 'An edited replacement is not the returned revision'
            approved = await approve_item(db, ids, 'contact', identity)
            ready = await tasks('viewer', 'publish')
            assert len(ready) == 1 and ready[0]['version_id'] == approved['version_id']
            await set_bit(ids['publisher'], 'knowledge', special_actions=['knowledge.publish_web'])
            assert await tasks('publisher', 'publish') == [], 'The exact approver cannot publish'
            await set_bit(ids['viewer'], 'knowledge', can_view=False, special_actions=[])
            assert await tasks('viewer', 'publish') == []
        finally:
            await db.close()
    asyncio.run(check())


def test_native_question_tasks_require_submission_and_keep_knowledge_authority(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            key = 'w4_task_' + uuid4().hex
            await call(db, ids['editor'], 'select hub.save_faq_question($1,0,$2)', key,
                       {'topic': 'design', 'default_level': 'corporate', 'question_template': {'th': 'Synthetic question?'}, 'answer_kind': 'text'})
            await set_bit(ids['publisher'], 'projects', can_view=False, can_edit=False, can_approve=False)

            async def questions():
                home = await call(db, ids['publisher'], "select hub.workspace_home(null,null,0,100,'approval',null)")
                return [t for t in home['tasks'] if t['kind'] == 'question' and t['item_id'] == key]

            assert await questions() == []
            current = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'question', {'question_key': key})
            await call(db, ids['editor'], 'select hub.content_workflow_submit($1,$2,$3)', 'question', {'question_key': key}, current['expected_hash'])
            pending = await questions()
            assert len(pending) == 1 and pending[0]['source_tab'] == 'knowledge'
            assert pending[0]['context']['tab'] == 'bank' and pending[0]['context']['question'] == key
            assert pending[0]['version_no'] == 1
            await set_bit(ids['publisher'], 'knowledge', can_approve=False)
            assert await questions() == []
        finally:
            await db.close()
    asyncio.run(check())


def test_generic_review_history_is_bounded_and_permission_guarded(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            row = await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',null,0,$1)", contact_body())
            approved = await approve_item(db, ids, 'contact', {'id': row['id']})
            history = await call(db, ids['viewer'], "select hub.content_history('corporate','sena',null,100)")
            event = next(e for e in history['items'] if e['action'] == 'approve' and e['version']['id'] == approved['version_id'])
            detail = await call(db, ids['viewer'], "select hub.content_history_event('corporate','sena',$1)", int(event['audit_id']))
            assert detail['after']['snapshot']['value'] == row['value']
            assert detail['target']['version'] == approved['version_id']
            assert not {'payload', 'editors', 'identity', 'source_hash', 'created_by', 'updated_by', 'approved_by'} & detail['after'].keys()
            await set_bit(ids['viewer'], 'knowledge', can_view=False)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], "select hub.content_history_event('corporate','sena',$1)", int(event['audit_id']))
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('kind', ['unit_type', 'price', 'disclosure', 'sales_term', 'programme', 'progress'])
def test_workflow_native_form_stamp_tracks_parent_without_rebasing_a_dirty_form(permission_accounts, kind):
    from test_website_content import project_fixture
    from test_unit_type_workflow import create_type, save_price
    from test_project_commercial import save as save_commercial
    _, ids = permission_accounts

    async def check():
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        transaction = db.transaction()
        await transaction.start()
        try:
            created = await project_fixture(db, ids['editor'])
            project = await call(db, ids['editor'], 'select hub.project_detail($1)', created['public_project_id'])
            key = project['public_project_id']
            if kind in {'unit_type', 'price'}:
                unit = await create_type(db, ids['editor'], project)
                identity = {'id': unit['id']}
                if kind == 'price':
                    price = await save_price(db, ids['editor'], key, unit)
                    identity = {'id': price['price_id']}
            else:
                family = {'disclosure': 'disclosures', 'sales_term': 'sales-terms',
                          'programme': 'programmes', 'progress': 'construction'}[kind]
                row = await save_commercial(db, ids['editor'], key, family)
                identity = {'id': row['id']}
            current = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', kind, identity)
            loaded_parent = await call(db, ids['editor'], 'select hub.project_detail($1)', key)
            inventory = await call(db, ids['editor'], 'select hub.content_workflow_items($1,$2,null,null,100)', 'project', key)
            entry = next(item for item in inventory['items'] if item['kind'] == kind and item['identity'] == identity)
            assert entry['expected_hash'] == current['expected_hash'] and entry['can_submit'] and entry['can_edit']
            assert entry['source_tab'] == 'projects' and entry['source_tabs'] == ['projects']
            assert current['source_revision'] == (unit['revision'] if kind == 'unit_type' else 1)
            assert datetime.fromisoformat(current['source_updated_at']) == datetime.fromisoformat(loaded_parent['updated_at'])
            project_snapshot = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'project', {'id': project['id']})
            assert project_snapshot['source_revision'] is None
            assert datetime.fromisoformat(project_snapshot['source_updated_at']) == datetime.fromisoformat(loaded_parent['updated_at'])
            neighbour = await call(db, ids['editor'], "select hub.save_content_contact('project',$1,null,0,$2)", key, contact_body())
            neighbour_snapshot = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'contact', {'id': neighbour['id']})
            # The original inventory/form hash must fail after a parent edit,
            # including the interval between metadata validation and the POST.
            changed_parent = await call(db, ids['editor'], 'select hub.patch_project($1,$2,$3)',
                                        UUID(project['id']), {'meta_title': {'th': 'Concurrent parent draft'}},
                                        datetime.fromisoformat(loaded_parent['updated_at']))
            refreshed = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', kind, identity)
            assert refreshed['expected_hash'] != current['expected_hash']
            assert refreshed['source_revision'] == current['source_revision']
            assert datetime.fromisoformat(refreshed['source_updated_at']) == datetime.fromisoformat(changed_parent['updated_at'])
            assert refreshed['source_updated_at'] != current['source_updated_at']
            audit_count = await db.fetchval('select count(*) from audit.change_log')
            with pytest.raises(asyncpg.SerializationError, match='Content revision changed'):
                await call(db, ids['editor'], 'select hub.content_workflow_save_approve($1,$2,$3,$4,$5)',
                           kind, identity, entry['expected_hash'], {}, 'Old loaded form must not rebase')
            assert await db.fetchval('select count(*) from audit.change_log') == audit_count
            assert (await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', kind, identity))['state'] == 'DRAFT'
            allowed = await call(db, ids['editor'], 'select hub.content_workflow_submit($1,$2,$3)', 'contact',
                                 {'id': neighbour['id']}, neighbour_snapshot['expected_hash'])
            assert allowed['state'] == 'IN_REVIEW'
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], 'select hub.patch_project($1,$2,$3)', UUID(project['id']),
                           {'meta_title': {'th': 'Old dirty form'}}, datetime.fromisoformat(current['source_updated_at']))
        finally:
            await transaction.rollback()
            await db.close()
    asyncio.run(check())


def test_publication_entity_targets_match_existing_exact_editor_queries():
    asset, binding = str(uuid4()), str(uuid4())
    result = publication_targets({'items': [
        {'target': {'level': 'project', 'id': 'prj / exact', 'tab': 'media', 'section': 'upload',
                    'phase': 'REM/PHASE', 'asset_id': asset, 'item': binding, 'binding': binding,
                    'media_category': 'interior', 'rule_key': 'living/room', 'tags': ['living_room', 'corner'],
                    'target_type': 'commercial_type', 'target_key': 'source-row', 'unit_type': 'ctyp_public', 'floor_from': 2},
         'workflow': {'kind': 'asset_context', 'identity': {'id': binding}, 'expected_hash': 'a' * 64}},
        {'target': {'level': 'brand', 'id': 'brn_exact', 'tab': 'media', 'section': 'canonical',
                    'media_role': 'logo', 'asset_id': asset, 'binding': binding},
         'workflow': {'kind': 'brand_asset', 'identity': {'id': binding}}},
        {'target': {'level': 'project', 'id': 'prj_exact', 'tab': 'faq',
                    'question_key': 'question/key', 'question': 'canonical_question', 'faq': 'exact-faq', 'version': 'exact-version'},
         'workflow': {'kind': 'faq', 'identity': {'id': 'exact-faq'}}},
        {'target': {'level': 'project', 'id': 'prj_exact', 'tab': 'media', 'section': 'clips', 'item': 'exact-clip'},
         'workflow': {'kind': 'media_link', 'identity': {'id': 'exact-clip'}}},
    ]})
    first = urlsplit(result['items'][0]['href'])
    assert first.path == '/website/project/prj%20%2F%20exact'
    query = parse_qs(first.query)
    assert query['section'] == ['upload'] and query['asset'] == [asset]
    assert query['binding'] == query['item'] == [binding]
    assert query['phase'] == ['REM/PHASE'] and query['unit_type'] == ['ctyp_public']
    assert query['target_key'] == ['source-row'] and query['floor_from'] == ['2']
    assert query['category'] == ['interior'] and query['rule'] == ['living/room']
    assert query['tags'] == ['living_room,corner']
    assert not {'asset_id', 'media_category', 'rule_key'} & query.keys()
    brand = parse_qs(urlsplit(result['items'][1]['href']).query)
    assert brand['section'] == ['canonical'] and brand['media_role'] == ['logo'] and brand['asset'] == [asset]
    faq = parse_qs(urlsplit(result['items'][2]['href']).query)
    assert faq['question'] == ['canonical_question'] and 'question_key' not in faq
    assert faq['faq'] == ['exact-faq'] and faq['version'] == ['exact-version']
    clip = parse_qs(urlsplit(result['items'][3]['href']).query)
    assert clip['section'] == ['clips'] and clip['item'] == ['exact-clip']


def test_page_configuration_target_opens_exact_queue_configuration():
    identity = str(uuid4())
    result = publication_targets({'items': [{
        'target': {'level': 'project', 'id': 'prj_exact', 'tab': 'publication',
                   'page': 'project:prj_exact', 'field': 'page.url'},
        'workflow': {'kind': 'page_config', 'identity': {'id': identity}},
    }]})
    target = urlsplit(result['items'][0]['href'])
    assert target.path == '/publish'
    assert parse_qs(target.query) == {
        'tab': ['configuration'], 'page': ['project:prj_exact'],
        'item': [identity], 'field': ['page.url'],
    }


async def inventory_brand_fixture(db, actor):
    rem_id = 'W4-INVENTORY-' + uuid4().hex
    await db.execute("select set_config('app.actor_id',$1,true)", str(actor))
    await db.execute("insert into staging.rem_brands(rem_brand_id,brand_name_rem,source_updated_at,source_fingerprint) values($1,'Synthetic inventory brand',now(),repeat('9',64))", rem_id)
    return dict(await db.fetchrow("insert into hub.brands(rem_brand_id,public_name,description,slug,status) values($1,$2,$3,$4,'active') returning id,public_brand_id,updated_at",
                                rem_id, {'th': 'Synthetic inventory brand'}, {'th': 'Synthetic story'}, 'inventory-' + uuid4().hex))


async def inventory_asset_fixture(db, actor):
    import io
    from PIL import Image, PngImagePlugin
    from sena_hub_api.assets import prepare_upload
    stream = io.BytesIO()
    info = PngImagePlugin.PngInfo()
    info.add_text('synthetic_inventory', uuid4().hex)
    Image.new('RGB', (8, 8), (50, 80, 90)).save(stream, 'PNG', pnginfo=info)
    _, metadata = prepare_upload(stream.getvalue(), 'image/png', 'synthetic-inventory.png')
    return (await call(db, actor, 'select hub.register_uploaded_asset($1)', metadata))['asset']


async def inventory_question_fixture(db, ids):
    key = 'w4_inventory_' + uuid4().hex
    await call(db, ids['editor'], 'select hub.save_faq_question($1,0,$2)', key,
               {'topic': 'design', 'default_level': 'project', 'question_template': {'th': 'Synthetic own question?'}, 'answer_kind': 'text'})
    await call(db, ids['publisher'], "select hub.approve_faq_question($1,1,'approved')", key)
    return key


async def inventory_faq_fixture(db, ids, key, scope, ref, projects):
    return await call(db, ids['editor'], 'select hub.save_faq(null,0,$1)',
                      {'question_key': key, 'scope_type': scope, 'scope_id': ref,
                       'question': {'th': 'Synthetic own question?'}, 'short_answer': {'th': 'Synthetic saved answer'},
                       'answer_kind': 'text', 'applies_to_project_ids': projects, 'ai_exposure': 'web_only'})


def test_saved_item_inventory_pages_all_own_drafts_without_inherited_or_approved_items(permission_accounts):
    from test_website_content import project_fixture
    _, ids = permission_accounts

    async def check():
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        tx = db.transaction()
        await tx.start()
        try:
            brand = await inventory_brand_fixture(db, ids['editor'])
            key = brand['public_brand_id']
            contacts = [await call(db, ids['editor'], "select hub.save_content_contact('brand',$1,null,0,$2)", key,
                                   contact_body('02' + str(i).zfill(7), label={'th': 'Saved item ' + str(i)})) for i in range(105)]
            approved = await approve_item(db, ids, 'contact', {'id': contacts[0]['id']})
            assert approved['state'] == 'APPROVED' and approved['can_submit'] is False
            inherited = await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',null,0,$1)", contact_body())
            child = await project_fixture(db, ids['editor'])
            await db.execute('update hub.projects set brand_id=$1 where id=$2', brand['id'], child['id'])
            descendant = await call(db, ids['editor'], "select hub.save_content_contact('project',$1,null,0,$2)", child['public_project_id'], contact_body())
            question = await inventory_question_fixture(db, ids)
            own_faq = await inventory_faq_fixture(db, ids, question, 'brand', key, [child['rem_project_id']])
            asset = await inventory_asset_fixture(db, ids['editor'])
            unbound = await inventory_asset_fixture(db, ids['editor'])
            stamp = await db.fetchval('select updated_at from hub.brands where id=$1', brand['id'])
            await call(db, ids['editor'], 'select hub.bind_brand_asset($1,$2,$3,$4,$5)', brand['id'], UUID(asset['id']),
                       'logo_primary', {'th': 'Inventory logo'}, stamp)
            binding = await db.fetchval('select id from hub.brand_assets where brand_id=$1 and asset_id=$2 and deleted_at is null', brand['id'], UUID(asset['id']))
            audit_before = await db.fetchval('select count(*) from audit.change_log')
            pages, entries, cursor = [], [], None
            for _ in range(10):
                page = publication_targets(await call(db, ids['editor'], 'select hub.content_workflow_items($1,$2,null,$3,100)', 'brand', key, cursor))
                assert page['scope'] == {'level': 'brand', 'id': key, 'phase': None}
                assert set(page) == {'scope', 'items', 'next_cursor'}
                pages.append(page); entries.extend(page['items'])
                cursor = page['next_cursor']
                if cursor is None:
                    break
            assert cursor is None and len(pages) == 2 and len(pages[0]['items']) == 100
            assert await db.fetchval('select count(*) from audit.change_log') == audit_before
            targets = {(item['kind'], json.dumps(item['identity'], sort_keys=True)) for item in entries}
            assert len(targets) == len(entries)
            own_ids = {item['identity'].get('id') for item in entries}
            assert {row['id'] for row in contacts[1:]} <= own_ids
            assert not {contacts[0]['id'], inherited['id'], descendant['id'], unbound['id']} & own_ids
            assert {own_faq['id'], asset['id'], str(binding)} <= own_ids
            assert any(item['kind'] == 'contact' for item in entries), 'Saved off-tab data is enumerated'
            assert any(item['kind'] == 'faq' and item['source_tab'] == 'knowledge' for item in entries)
            assert all(item['can_submit'] and item['can_edit'] and item['expected_hash'] and item['href'] for item in entries)
            assert all(set(item) == {'kind', 'identity', 'expected_hash', 'source_revision', 'source_updated_at', 'state',
                                     'can_submit', 'can_edit', 'source_tab', 'source_tabs', 'label', 'target', 'href'} for item in entries)
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], 'select hub.content_workflow_items($1,$2,null,$3,100)', 'corporate', 'sena', pages[0]['next_cursor'])
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], 'select hub.content_workflow_items($1,$2,null,$3,100)', 'brand', key, 'not-a-cursor')
            # Removing one source's Edit hides only those submit candidates.
            await db.execute("update hub.account_permission set can_edit=false where account_id=$1 and tab='brands'", ids['editor'])
            remaining = await call(db, ids['editor'], 'select hub.content_workflow_items($1,$2,null,null,100)', 'brand', key)
            assert [item['identity'] for item in remaining['items']] == [{'id': own_faq['id']}]
            await db.execute("update hub.account_permission set can_edit=true where account_id=$1 and tab='brands'", ids['editor'])
            await db.execute("update hub.account_permission set can_view=false,can_edit=false,can_approve=false where account_id=$1 and tab='knowledge'", ids['editor'])
            remaining = await call(db, ids['editor'], 'select hub.content_workflow_items($1,$2,null,null,100)', 'brand', key)
            assert remaining['items'] and all(item['source_tab'] == 'brands' for item in remaining['items'])
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())


def test_saved_item_inventory_resolves_one_phase_and_preserves_knowledge_only_faq(permission_accounts):
    from test_website_content import project_fixture
    _, ids = permission_accounts

    async def check():
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        tx = db.transaction()
        await tx.start()
        try:
            projects = [await project_fixture(db, ids['editor']) for _ in range(2)]
            refs = [project['public_project_id'] for project in projects]
            await db.execute('update hub.projects set brand_id=$1 where id=$2', projects[0]['brand_id'], projects[1]['id'])
            question = await inventory_question_fixture(db, ids)
            own_faqs = [await inventory_faq_fixture(db, ids, question, 'project', project['rem_project_id'], [project['rem_project_id']]) for project in projects]
            inherited = await inventory_faq_fixture(db, ids, question, 'corporate', 'sena', [project['rem_project_id'] for project in projects])
            contacts = [await call(db, ids['editor'], "select hub.save_content_contact('project',$1,null,0,$2)", ref, contact_body()) for ref in refs]
            # Existing W3 legacy published-group fixture: scope resolution only;
            # its compatibility and new certificate boundary have dedicated tests.
            page = await db.fetchval("insert into hub.web_pages(page_key,page_type,entity_ref,url,project_ids,revision) values($1,'project',$2,$3,$4,1) returning id",
                                     'project:' + refs[0], refs[0], '/inventory-phases/' + uuid4().hex, refs)
            payload = {'config_revision': 1, '_publication': {'approved_by': str(ids['publisher'])},
                       'body': {'phases': [{'_item': True, 'data': {'public_project_id': ref}} for ref in refs]}}
            version = await db.fetchval("insert into hub.entity_versions(entity_type,web_page_id,version_no,payload,content_sha256,publisher,change_reason) values('web_page',$1,1,$2,hub.web_hash($2),$3,'Synthetic existing group fixture') returning id", page, payload, ids['publisher'])
            await db.execute('update hub.web_pages set published_version_id=$1 where id=$2', version, page)
            first = await call(db, ids['editor'], 'select hub.content_workflow_items($1,$2,null,null,100)', 'project', refs[0])
            second = await call(db, ids['editor'], 'select hub.content_workflow_items($1,$2,$3,null,100)', 'project', refs[0], projects[1]['rem_project_id'])
            for index, result in enumerate([first, second]):
                assert result['scope'] == {'level': 'project', 'id': refs[0], 'phase': projects[index]['rem_project_id']}
                selected = {item['identity'].get('id') for item in result['items']}
                assert {contacts[index]['id'], own_faqs[index]['id']} <= selected
                assert not {contacts[1-index]['id'], own_faqs[1-index]['id'], inherited['id']} & selected
                assert all(item['target']['id'] == refs[0] and item['target']['phase'] == projects[index]['rem_project_id'] for item in result['items'])
            page_one = await call(db, ids['editor'], 'select hub.content_workflow_items($1,$2,null,null,1)', 'project', refs[0])
            assert page_one['next_cursor']
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], 'select hub.content_workflow_items($1,$2,$3,$4,100)', 'project', refs[0], projects[1]['rem_project_id'], page_one['next_cursor'])
            await db.execute("update hub.account_permission set can_view=false,can_edit=false,can_approve=false where account_id=$1 and tab in ('projects','brands')", ids['editor'])
            audit_before = await db.fetchval('select count(*) from audit.change_log')
            faq_only = await call(db, ids['editor'], 'select hub.content_workflow_items($1,$2,null,null,100)', 'project', refs[0])
            assert await db.fetchval('select count(*) from audit.change_log') == audit_before
            assert [(item['kind'], item['identity']) for item in faq_only['items']] == [('faq', {'id': own_faqs[0]['id']})]
            assert faq_only['items'][0]['source_tab'] == 'knowledge' and faq_only['items'][0]['can_edit']
            await db.execute("update hub.account_permission set can_edit=false where account_id=$1 and tab='knowledge'", ids['editor'])
            assert (await call(db, ids['editor'], 'select hub.content_workflow_items($1,$2,null,null,100)', 'project', refs[0]))['items'] == []
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())


def test_saved_inventory_hash_conflict_does_not_replace_or_block_a_neighbour(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        tx = db.transaction()
        await tx.start()
        try:
            brand = await inventory_brand_fixture(db, ids['editor'])
            key = brand['public_brand_id']
            rows = [await call(db, ids['editor'], "select hub.save_content_contact('brand',$1,null,0,$2)", key, contact_body(number))
                    for number in ['021111111', '022222222']]
            result = await call(db, ids['editor'], 'select hub.content_workflow_items($1,$2,null,null,100)', 'brand', key)
            entries = [next(item for item in result['items'] if item['identity'] == {'id': row['id']}) for row in rows]
            await call(db, ids['editor'], "select hub.save_content_contact('brand',$1,$2,1,$3)", key, UUID(rows[0]['id']), contact_body('023333333'))
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], 'select hub.content_workflow_submit($1,$2,$3)', entries[0]['kind'], entries[0]['identity'], entries[0]['expected_hash'])
            next_item = await call(db, ids['editor'], 'select hub.content_workflow_submit($1,$2,$3)', entries[1]['kind'], entries[1]['identity'], entries[1]['expected_hash'])
            assert next_item['state'] == 'IN_REVIEW'
            unchanged = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', entries[0]['kind'], entries[0]['identity'])
            assert unchanged['state'] == 'DRAFT' and unchanged['expected_hash'] != entries[0]['expected_hash']
            assert (await call(db, ids['viewer'], 'select hub.content_workflow_items($1,$2,null,null,100)', 'brand', key))['items'] == []
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('query', [
    {'level': 'user_account', 'id': 'not-an-entity'}, {'level': 'project', 'id': ''},
    {'level': 'corporate', 'id': 'sena', 'limit': 0}, {'level': 'corporate', 'id': 'sena', 'limit': 101},
    {'level': 'corporate', 'id': 'sena', 'after': ''}, {'level': 'project', 'id': 'prj_missing', 'phase': ''},
])
def test_saved_item_http_inventory_rejects_unbounded_or_unknown_inputs(permission_accounts, query):
    client, _ = permission_accounts
    response = client.get('/v1/admin/content-workflow/items', params=query, headers=h('editor'))
    assert response.status_code == 422



def test_unchanged_returned_content_preserves_authors_and_approved_resubmit_denies(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        tx = db.transaction()
        await tx.start()
        try:
            row = await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',null,0,$1)", contact_body())
            identity = {'id': row['id']}
            draft = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'contact', identity)
            submitted = await call(db, ids['editor'], 'select hub.content_workflow_submit($1,$2,$3)', 'contact', identity, draft['expected_hash'])
            await call(db, ids['publisher'], "select hub.content_workflow_review($1,$2,$3,'return',$4)",
                       'contact', identity, submitted['expected_hash'], 'Confirm the same contact with its owner')
            approved = await approve_item(db, ids, 'contact', identity)
            certificate = await db.fetchrow('select payload,editors from hub.content_review_versions where id=$1', UUID(approved['version_id']))
            assert ids['editor'] in certificate['editors'] and approved['can_submit'] is False
            versions = await db.fetchval("select count(*) from hub.content_review_versions where kind='contact' and identity=$1", identity)
            with pytest.raises(asyncpg.CheckViolationError, match='already approved'):
                await call(db, ids['editor'], 'select hub.content_workflow_submit($1,$2,$3)', 'contact', identity, approved['expected_hash'])
            assert await db.fetchval("select count(*) from hub.content_review_versions where kind='contact' and identity=$1", identity) == versions
            assert await db.fetchval('select payload from hub.content_review_versions where id=$1', UUID(approved['version_id'])) == certificate['payload']
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['editor']))
            dependency = await db.fetchval("select hub.web_dependency('contacts',$1,'knowledge')", identity)
            with pytest.raises(asyncpg.InsufficientPrivilegeError, match='editor or English reviewer'):
                async with db.transaction():
                    await db.execute('select hub.publication_dependency_check($1,true,true)', dependency)
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())


async def staged_project_fixture(db, actor, group, *, status='Active'):
    from test_website_content import project_fixture
    project = await project_fixture(db, actor)
    source = {'project_id': project['rem_project_id'], 'rem_project_group_id': group,
              'project_status_detail': status, 'rem_bu_id': 'synthetic-bu'}
    await db.execute("insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance) values($1,$2,clock_timestamp(),repeat('6',64),'{}')",
                     project['rem_project_id'], source)
    return project, source


async def staged_neighbour_fixture(db, group):
    ref = 'W4-NEIGHBOUR-' + uuid4().hex
    await db.execute("insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint) values($1,'Synthetic staged neighbour',now(),repeat('6',64))", ref)
    source = {'project_id': ref, 'rem_project_group_id': group, 'rem_bu_id': 'synthetic-bu'}
    await db.execute("insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance) values($1,$2,clock_timestamp(),repeat('6',64),'{}')", ref, source)
    return ref, source


def test_phase_count_staging_changes_invalidate_affected_groups_and_retain_authors(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        tx = db.transaction()
        await tx.start()
        try:
            group_a, group_b = 'W4-GROUP-' + uuid4().hex, 'W4-GROUP-' + uuid4().hex
            first, source_a = await staged_project_fixture(db, ids['editor'], group_a)
            other, _ = await staged_project_fixture(db, ids['editor'], group_b)
            neighbour, neighbour_source = await staged_neighbour_fixture(db, group_a)
            identities = [{'id': str(p['id'])} for p in (first, other)]
            first_approval, other_approval = [await approve_item(db, ids, 'project', identity) for identity in identities]
            frozen = await db.fetchval('select payload from hub.content_review_versions where id=$1', UUID(first_approval['version_id']))
            assert frozen['_staged_values']['project.phase_count'] == 2
            assert frozen['_staged_values']['project.project_status'] == 'Active'
            for value in [source_a, source_a | {'rem_bu_id': 'different-bu', 'unused_value': 999}]:
                await db.execute('update staging.dw_projects set source_record=$2,source_snapshot_at=clock_timestamp() where rem_project_id=$1', first['rem_project_id'], value)
                assert not (await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'project', identities[0]))['needs_reapproval']
            inserted, _ = await staged_neighbour_fixture(db, group_a)
            current = await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'project', identities[0])
            assert current['needs_reapproval'] and current['staged_evidence']['current']['project.phase_count'] == 3
            assert not (await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'project', identities[1]))['needs_reapproval']
            reapproved = await approve_item(db, ids, 'project', identities[0])
            assert ids['editor'] in await db.fetchval('select editors from hub.content_review_versions where id=$1', UUID(reapproved['version_id']))
            assert await db.fetchval('select payload from hub.content_review_versions where id=$1', UUID(first_approval['version_id'])) == frozen
            await db.execute('delete from staging.dw_projects where rem_project_id=$1', inserted)
            assert (await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'project', identities[0]))['needs_reapproval']
            await approve_item(db, ids, 'project', identities[0])
            await db.execute('update staging.dw_projects set source_record=$2 where rem_project_id=$1', neighbour, neighbour_source | {'rem_project_group_id': group_b})
            for identity, expected in zip(identities, (1, 2)):
                changed = await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'project', identity)
                assert changed['needs_reapproval'] and changed['staged_evidence']['current']['project.phase_count'] == expected
                assert not any(key in json.dumps(changed['staged_evidence']) for key in ['rem_project_group_id', 'rem_bu_id', 'source_snapshot_at'])
                await approve_item(db, ids, 'project', identity)
            await db.execute('delete from staging.dw_projects where rem_project_id=$1', neighbour)
            assert not (await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'project', identities[0]))['needs_reapproval']
            assert (await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'project', identities[1]))['needs_reapproval']
            await db.execute('update staging.dw_projects set source_record=$2 where rem_project_id=$1', first['rem_project_id'], source_a | {'project_status_detail': 'Completed'})
            last = await approve_item(db, ids, 'project', identities[0])
            assert ids['editor'] in await db.fetchval('select editors from hub.content_review_versions where id=$1', UUID(last['version_id']))
            # Changing group identity alone does not invalidate an unchanged
            # displayed count (one member before and after this move).
            await db.execute('update staging.dw_projects set source_record=$2 where rem_project_id=$1', first['rem_project_id'],
                             source_a | {'project_status_detail': 'Completed', 'rem_project_group_id': 'W4-EMPTY-' + uuid4().hex})
            assert not (await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'project', identities[0]))['needs_reapproval']
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['editor']))
            dependency = await db.fetchval("select hub.web_dependency('projects',$1,'projects')", identities[0])
            with pytest.raises(asyncpg.InsufficientPrivilegeError, match='editor or English reviewer'):
                async with db.transaction():
                    await db.execute('select hub.publication_dependency_check($1,true,true)', dependency)
            assert await db.fetchval("select count(*) from audit.change_log where table_name='hub.content_review_versions' and after_row->>'id'=$1 and after_row->>'staged_invalidated_at' is not null", other_approval['version_id']) > 0
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())


def test_staging_import_waits_for_uncommitted_submission_and_records_durable_drift(permission_accounts):
    _, ids = permission_accounts

    async def check():
        operator, importer = await disposable_operator(), await disposable_operator()
        db = await committed_runtime()
        for connection in (operator, importer, db):
            await connection.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        transaction, pending, committed, project = None, None, False, None
        try:
            project, source = await staged_project_fixture(operator, ids['editor'], 'W4-RACE-' + uuid4().hex)
            identity = {'id': str(project['id'])}
            transaction = db.transaction()
            await transaction.start()
            draft = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'project', identity)
            submitted = await call(db, ids['editor'], 'select hub.content_workflow_submit($1,$2,$3)', 'project', identity, draft['expected_hash'])
            await importer.execute("set lock_timeout='10s'")
            pending = asyncio.create_task(importer.execute('update staging.dw_projects set source_record=$2 where rem_project_id=$1',
                                                          project['rem_project_id'], source | {'project_status_detail': 'Completed'}))

            async def blocked_by_submit():
                while db.get_server_pid() not in await operator.fetchval('select pg_blocking_pids($1)', importer.get_server_pid()):
                    if pending.done():
                        await pending
                        pytest.fail('The staging import bypassed the uncommitted submission lock')
                    await asyncio.sleep(0.01)
            await asyncio.wait_for(blocked_by_submit(), timeout=5)
            assert not await operator.fetchval('select exists(select 1 from hub.content_review_versions where id=$1)', UUID(submitted['version_id']))
            await transaction.commit()
            committed = True
            await asyncio.wait_for(pending, timeout=10)
            stored = await operator.fetchrow('select payload,staged_invalidated_at,staged_current_values from hub.content_review_versions where id=$1', UUID(submitted['version_id']))
            assert stored['staged_invalidated_at'] is not None
            assert stored['payload']['_staged_values']['project.project_status'] == 'Active'
            assert stored['staged_current_values']['project.project_status'] == 'Completed'
            assert await operator.fetchval("select count(*) from audit.change_log where table_name='hub.content_review_versions' and after_row->>'id'=$1 and after_row->>'staged_invalidated_at' is not null", submitted['version_id']) == 1
        finally:
            if transaction is not None and not committed:
                await transaction.rollback()
            if pending is not None and not pending.done():
                await asyncio.wait_for(pending, timeout=10)
            if project is not None:
                await operator.execute('update hub.projects set deleted_at=clock_timestamp() where id=$1', project['id'])
            await db.close()
            await importer.close()
            await operator.close()
    asyncio.run(check())


def test_native_glossary_retirement_updates_the_same_review_history(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        tx = db.transaction()
        await tx.start()
        try:
            key = 'w4-retired-' + uuid4().hex
            saved = await call(db, ids['editor'], 'select hub.save_glossary($1,0,$2)', key, {'th': 'Synthetic term', 'en': 'Synthetic term'})
            active = await call(db, ids['publisher'], "select hub.approve_glossary($1,$2,'active')", key, saved['revision'])
            snapshot = await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'glossary', {'term_key': key})
            frozen = await db.fetchrow('select payload,editors,approved_by from hub.content_review_versions where id=$1', UUID(snapshot['version_id']))
            assert snapshot['state'] == 'APPROVED'
            await db.execute("select set_config('app.content_review_reason','Retire the obsolete term',true)")
            await call(db, ids['publisher'], "select hub.approve_glossary($1,$2,'retired')", key, active['revision'])
            retired = await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'glossary', {'term_key': key})
            assert retired['state'] == 'WITHDRAWN' and retired['version_id'] == snapshot['version_id']
            assert retired['decision_reason'] == 'Retire the obsolete term'
            assert await db.fetchrow('select payload,editors,approved_by from hub.content_review_versions where id=$1', UUID(snapshot['version_id'])) == frozen
            assert any(item['state'] == 'WITHDRAWN' and item['reason'] == 'Retire the obsolete term' for item in retired['history'])
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())


def test_selling_point_contributors_belong_to_exact_revision_and_current_english_review(permission_accounts):
    from test_website_content import project_fixture
    _, ids = permission_accounts

    async def check():
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        tx = db.transaction()
        await tx.start()
        try:
            await db.execute("update hub.account_permission set can_view=true,can_edit=true,can_approve=true where account_id=$1 and tab='projects'", ids['second'])
            await db.execute("update hub.account_permission set can_view=true,can_edit=true,can_approve=false where account_id=$1 and tab='projects'", ids['admin'])
            project = await project_fixture(db, ids['editor'])
            first = await call(db, ids['editor'], 'select hub.save_selling_point($1,null,0,$2)', project['public_project_id'],
                               {'title': {'th': 'Original title'}, 'detail': {'th': 'Original detail'}})
            identity = {'project_id': str(project['id']), 'point_key': first['point_key']}
            original = await approve_item(db, ids, 'selling_point', identity)
            second = await call(db, ids['second'], 'select hub.save_selling_point($1,$2,$3,$4)', project['public_project_id'], UUID(first['point_key']), first['revision'],
                                {'title': {'th': 'Current title'}, 'detail': {'th': 'Current detail'}})
            own = await call(db, ids['second'], 'select hub.content_workflow_read($1,$2)', 'selling_point', identity)
            assert own['approval_requires_reason']
            submitted = await call(db, ids['second'], 'select hub.content_workflow_submit($1,$2,$3)', 'selling_point', identity, own['expected_hash'])
            with pytest.raises(asyncpg.CheckViolationError, match='reason'):
                await call(db, ids['second'], "select hub.content_workflow_review($1,$2,$3,'approve',null)", 'selling_point', identity, submitted['expected_hash'])
            own_approved = await call(db, ids['second'], "select hub.content_workflow_review($1,$2,$3,'approve',$4)",
                                      'selling_point', identity, submitted['expected_hash'], 'Manager checked own current revision')
            assert own_approved['self_approval'] is True
            current = await call(db, ids['second'], 'select hub.save_selling_point($1,$2,$3,$4)', project['public_project_id'], UUID(first['point_key']), second['revision'],
                                 {'title': {'th': 'Final title'}, 'detail': {'th': 'Final detail'}})
            for field in ('selling_point.title', 'selling_point.detail'):
                translation = await db.fetchrow('select id,revision,th_version,th_text from hub.content_translations where owner_type=$1 and owner_key=$2 and field_key=$3',
                                                'selling_point', first['point_key'], field)
                await call(db, ids['admin'], 'select hub.review_content_translation($1,$2,$3,$4)', translation['id'], translation['revision'], translation['th_version'], 'Reviewed ' + translation['th_text'])
            approved = await approve_item(db, ids, 'selling_point', identity, editor='second')
            assert approved['self_approval'] is False
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['editor']))
            revision = await db.fetchval('select max(revision) from hub.project_selling_points where project_id=$1 and point_key=$2', project['id'], UUID(first['point_key']))
            dependency = await db.fetchval("select hub.web_dependency('project_selling_points',$1,'projects')", identity | {'revision': revision})
            assert set(dependency['approval']['editors']) == {str(ids['second']), str(ids['admin'])}
            assert str(ids['editor']) not in dependency['editors']
            await db.execute('select hub.publication_dependency_check($1,true,true)', dependency)
            for role in ('second', 'admin', 'publisher'):
                await db.execute("select set_config('app.actor_id',$1,true)", str(ids[role]))
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    async with db.transaction():
                        await db.execute('select hub.publication_dependency_check($1,true,true)', dependency)
            assert await db.fetchval('select state from hub.project_selling_points where project_id=$1 and point_key=$2 and revision=$3',
                                     project['id'], UUID(first['point_key']), original['version_no']) == 'APPROVED'
            assert current['revision'] < revision
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())



def test_model_workflow_preserves_the_loaded_parent_form_guard_and_approved_material(permission_accounts):
    from test_website_content import project_fixture
    _, ids = permission_accounts

    async def check():
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        tx = db.transaction()
        await tx.start()
        try:
            await db.execute("update hub.account_permission set can_approve=true where account_id=$1 and tab='projects'", ids['editor'])
            projects, models, snapshots = [], [], []
            for _ in range(2):
                project = await project_fixture(db, ids['editor'])
                model_ref = 'W4-MODEL-' + uuid4().hex
                await db.execute("insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_updated_at,source_fingerprint) values($1,$2,'Synthetic model form',now(),repeat('7',64))",
                                 project['rem_project_id'], model_ref)
                parent = await call(db, ids['editor'], 'select hub.add_model_from_rem($1,$2,$3)',
                                    project['id'], model_ref, project['updated_at'])
                model = dict(await db.fetchrow('select id,project_id,public_model_id,public_name,updated_at from hub.model_types where project_id=$1 and rem_model_id=$2', project['id'], model_ref))
                snapshot = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'model', {'id': str(model['id'])})
                assert model['project_id'] == project['id']
                assert snapshot['source_revision'] is None
                assert datetime.fromisoformat(snapshot['source_updated_at']) == datetime.fromisoformat(parent['updated_at'])
                inventory = await call(db, ids['editor'], 'select hub.content_workflow_items($1,$2,null,null,100)', 'project', parent['public_project_id'])
                item = next(item for item in inventory['items'] if item['kind'] == 'model' and item['identity'] == {'id': str(model['id'])})
                assert item['expected_hash'] == snapshot['expected_hash'] and item['source_updated_at'] == snapshot['source_updated_at']
                projects.append(parent)
                models.append(model)
                snapshots.append(snapshot)
            changed = await call(db, ids['editor'], 'select hub.patch_project($1,$2,$3)', models[0]['project_id'],
                                 {'meta_title': {'th': 'Concurrent owning project update'}}, datetime.fromisoformat(projects[0]['updated_at']))
            refreshed = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'model', {'id': str(models[0]['id'])})
            assert refreshed['expected_hash'] != snapshots[0]['expected_hash']
            assert datetime.fromisoformat(refreshed['source_updated_at']) == datetime.fromisoformat(changed['updated_at'])
            audit_count = await db.fetchval('select count(*) from audit.change_log')
            with pytest.raises(asyncpg.SerializationError, match='Content revision changed'):
                await call(db, ids['editor'], 'select hub.content_workflow_save_approve($1,$2,$3,$4,$5)',
                           'model', {'id': str(models[0]['id'])}, snapshots[0]['expected_hash'],
                           {'public_name': {'th': 'Old dirty model form'}}, 'Check the original loaded form')
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], 'select hub.update_model($1,$2,$3,$4)', models[0]['project_id'], models[0]['public_model_id'],
                           {'public_name': {'th': 'Old ordinary model form'}}, datetime.fromisoformat(snapshots[0]['source_updated_at']))
            assert await db.fetchval('select count(*) from audit.change_log') == audit_count
            assert await db.fetchval('select public_name from hub.model_types where id=$1', models[0]['id']) == models[0]['public_name']
            with pytest.raises(asyncpg.CheckViolationError, match='identity'):
                await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'model',
                           {'id': str(models[0]['id']), 'project_id': str(models[1]['project_id'])})
            # A distinct parent's loaded form remains valid; no fresh metadata
            # is substituted into either action's original expected hash.
            approved = await call(db, ids['editor'], 'select hub.content_workflow_save_approve($1,$2,$3,$4,$5)',
                                  'model', {'id': str(models[1]['id'])}, snapshots[1]['expected_hash'],
                                  {'public_name': {'th': 'Approved neighbouring model'}}, 'Manager confirmed the unchanged-parent form')
            assert approved['state'] == 'APPROVED' and approved['self_approval'] is True
            stored = await db.fetchrow('select payload,source_hash,editors from hub.content_review_versions where id=$1', UUID(approved['version_id']))
            assert not {'_form_updated_at', '_tab', '_tabs'} & stored['payload'].keys()
            assert stored['source_hash'] == await db.fetchval("select hub.web_hash(hub.content_workflow_payload('model',$1))", stored['payload'])
            assert ids['editor'] in stored['editors']
            parent = await call(db, ids['editor'], 'select hub.project_detail($1)', projects[1]['public_project_id'])
            await call(db, ids['editor'], 'select hub.patch_project($1,$2,$3)', models[1]['project_id'],
                       {'meta_title': {'th': 'Later parent metadata only'}}, datetime.fromisoformat(parent['updated_at']))
            still_approved = await call(db, ids['editor'], 'select hub.content_workflow_read($1,$2)', 'model', {'id': str(models[1]['id'])})
            assert still_approved['expected_hash'] != approved['expected_hash']
            assert still_approved['state'] == 'APPROVED' and not still_approved['can_submit'] and not still_approved['needs_reapproval']
            assert await db.fetchrow('select payload,source_hash,editors from hub.content_review_versions where id=$1', UUID(approved['version_id'])) == stored
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())
