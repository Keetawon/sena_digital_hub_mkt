"""N2 publication separation and same-page partial outcomes."""
import asyncio
import json
from datetime import date, datetime, timedelta
from uuid import UUID, uuid4

import asyncpg
import pytest
from pydantic import ValidationError

from sena_hub_api.publication_queue import QueuePrepare
from sena_hub_api.content_workflow import publication_targets
from sena_hub_api.web_publication import reviewed_preview
from test_content_workflow import approve_item, contact_body
from test_permission_content import call, set_bit
from test_permission_baseline import disposable_operator
from test_permission_foundations import permission_accounts
from test_project_content_core import runtime


async def online(ids, role='viewer', *, connection=None):
    await set_bit(ids[role], 'knowledge', can_view=True, can_edit=False, can_approve=False,
                  special_actions=['knowledge.publish_web'], connection=connection,
                  manager=ids['second'] if role == 'admin' else ids['admin'])


async def corporate_page(db, ids):
    key = 'corporate:w4_' + uuid4().hex
    page = await call(db, ids['editor'], 'select hub.web_page_save($1,0,$2)', key,
                      {'url': '/w4/' + uuid4().hex, 'locales': ['th'], 'ai_policy': 'no_ai', 'max_faq_items': 20, 'project_ids': []})
    await approve_item(db, ids, 'page_config', {'id': page['id']})
    return key


async def prepare(db, ids, key, role='viewer'):
    return await call(db, ids[role], 'select hub.publication_queue_prepare($1,$2)',
                      [{'system': 'web', 'page_key': key}], 'Approved synthetic publication')


def test_queue_inputs_reject_duplicate_or_untyped_targets():
    with pytest.raises(ValidationError):
        QueuePrepare(selections=[{'system': 'web', 'page_key': 'corporate:sena'}] * 2, reason='Duplicate')
    with pytest.raises(ValidationError):
        QueuePrepare(selections=[{'system': 'release', 'entity_type': 'user_account', 'entity_id': str(uuid4())}], reason='No arbitrary target')


def test_publisher_has_view_and_special_but_cannot_publish_own_approval(permission_accounts):
    _, ids = permission_accounts

    async def check():
        await online(ids)
        db = await runtime()
        try:
            row = await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',null,0,$1)", contact_body())
            await approve_item(db, ids, 'contact', {'id': row['id']})
            key = await corporate_page(db, ids)
            batch = await prepare(db, ids, key)
            await set_bit(ids['publisher'], 'knowledge', special_actions=['knowledge.publish_web'], connection=db, manager=ids['admin'])
            denied = await call(db, ids['publisher'], 'select hub.publication_queue_publish($1,$2)', UUID(batch['id']), batch['digest'])
            assert denied['state'] == 'RETURNED' and denied['page_count'] == 0
            batch = await prepare(db, ids, key)
            published = await call(db, ids['viewer'], 'select hub.publication_queue_publish($1,$2)', UUID(batch['id']), batch['digest'])
            assert published['state'] == 'PUBLISHED' and published['page_count'] == 1
            public = await call(db, ids['service_consumer'], "select hub.web_public_page($1,'th')", key)
            assert any(contact['value'] == row['value'] for contact in public['content']['contacts'])
            await set_bit(ids['viewer'], 'knowledge', special_actions=[], connection=db, manager=ids['admin'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await prepare(db, ids, key)
        finally:
            await db.close()
    asyncio.run(check())


def test_same_page_stale_item_keeps_old_value_and_publishes_other_approved_item(permission_accounts):
    _, ids = permission_accounts

    async def check():
        await online(ids)
        db = await runtime()
        try:
            first = await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',null,0,$1)", contact_body('021111111'))
            second = await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',null,0,$1)", contact_body('022222222'))
            for row in [first, second]:
                await approve_item(db, ids, 'contact', {'id': row['id']})
            key = await corporate_page(db, ids)
            initial = await prepare(db, ids, key)
            await call(db, ids['viewer'], 'select hub.publication_queue_publish($1,$2)', UUID(initial['id']), initial['digest'])
            for row, number in [(first, '023333333'), (second, '024444444')]:
                await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',$1,1,$2)", UUID(row['id']), contact_body(number))
                await approve_item(db, ids, 'contact', {'id': row['id']})
            batch = await prepare(db, ids, key)
            await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',$1,2,$2)", UUID(first['id']), contact_body('025555555'))
            review = reviewed_preview(await call(db, ids['viewer'], "select hub.web_publication_read($1,'th')", UUID(batch['id'])))
            assert review['can_publish'] is True
            entries = [entry for page in review['pages'] for entry in page.get('items', [])]
            rejected = next(entry for entry in entries if entry.get('code') == 'stale')
            assert rejected['workflow']['kind'] == 'contact' and rejected['workflow']['identity'] == {'id': first['id']}
            assert rejected['can_return'] is False and rejected['label']['th'] == 'Synthetic contact'
            assert rejected['href'].startswith('/website/corporate/sena?') and 'item=' + first['id'] in rejected['href']
            assert any(entry['status'] == 'APPROVED' and entry['workflow']['identity'] == {'id': second['id']} for entry in entries)
            assert review['pages'][0]['html'] and review['pages'][0]['previous_html']
            published = await call(db, ids['viewer'], 'select hub.publication_queue_publish($1,$2)', UUID(batch['id']), batch['digest'])
            assert published['state'] == 'PARTIAL' and published['page_count'] == 1
            statuses = [item for page in published['outcomes'] for item in page.get('items', [])]
            assert any(item['status'] == 'REJECTED' and item['code'] == 'stale' for item in statuses)
            public = await call(db, ids['service_consumer'], "select hub.web_public_page($1,'th')", key)
            values = [contact['value'] for contact in public['content']['contacts']]
            assert first['value'] in values and '024444444' in values
            assert '023333333' not in values and '025555555' not in values
            history = await call(db, ids['viewer'], 'select hub.web_history($1)', key)
            assert len(history) == 2
        finally:
            await db.close()
    asyncio.run(check())


def test_publisher_return_changes_one_approved_item_and_keeps_review_history(permission_accounts):
    _, ids = permission_accounts

    async def check():
        await online(ids)
        db = await runtime()
        try:
            rows = [await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',null,0,$1)", contact_body(number))
                    for number in ['026666666', '027777777']]
            approvals = [await approve_item(db, ids, 'contact', {'id': row['id']}) for row in rows]
            returned = await call(db, ids['viewer'], 'select hub.publication_queue_return($1,$2,$3,$4)',
                                  'contact', {'id': rows[0]['id']}, approvals[0]['expected_hash'], 'Check the telephone')
            assert returned['state'] == 'RETURNED' and returned['approved_by'] == approvals[0]['approved_by']
            neighbour = await call(db, ids['viewer'], 'select hub.content_workflow_read($1,$2)', 'contact', {'id': rows[1]['id']})
            assert neighbour['state'] == 'APPROVED'
        finally:
            await db.close()
    asyncio.run(check())


def test_stale_page_config_rejects_only_its_page(permission_accounts):
    _, ids = permission_accounts

    async def check():
        await online(ids)
        db = await runtime()
        try:
            row = await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',null,0,$1)", contact_body())
            await approve_item(db, ids, 'contact', {'id': row['id']})
            keys = [await corporate_page(db, ids), await corporate_page(db, ids)]
            batch = await call(db, ids['viewer'], 'select hub.publication_queue_prepare($1,$2)',
                               [{'system': 'web', 'page_key': key} for key in keys], 'Two approved pages')
            await call(db, ids['editor'], 'select hub.web_page_save($1,1,$2)', keys[0],
                       {'url': '/changed/' + uuid4().hex, 'locales': ['th'], 'ai_policy': 'no_ai', 'max_faq_items': 20, 'project_ids': []})
            result = await call(db, ids['viewer'], 'select hub.publication_queue_publish($1,$2)', UUID(batch['id']), batch['digest'])
            assert result['state'] == 'PARTIAL' and result['page_count'] == 1
            with pytest.raises(asyncpg.NoDataFoundError):
                await call(db, ids['service_consumer'], "select hub.web_public_page($1,'th')", keys[0])
            assert (await call(db, ids['service_consumer'], "select hub.web_public_page($1,'th')", keys[1]))['content']['contacts']
        finally:
            await db.close()
    asyncio.run(check())


def test_superseded_revision_editor_is_not_permanently_excluded(permission_accounts):
    _, ids = permission_accounts

    async def check():
        await set_bit(ids['second'], 'knowledge', can_view=True, can_edit=True, can_approve=False)
        db = await runtime()
        try:
            row = await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',null,0,$1)", contact_body('021111111'))
            await approve_item(db, ids, 'contact', {'id': row['id']})
            await call(db, ids['second'], "select hub.save_content_contact('corporate','sena',$1,1,$2)", UUID(row['id']), contact_body('022222222'))
            await approve_item(db, ids, 'contact', {'id': row['id']}, editor='second')
            key = await corporate_page(db, {**ids, 'editor': ids['second']})
            await online(ids, 'editor', connection=db)
            batch = await prepare(db, ids, key, role='editor')
            result = await call(db, ids['editor'], 'select hub.publication_queue_publish($1,$2)', UUID(batch['id']), batch['digest'])
            assert result['state'] == 'PUBLISHED'
            output = await call(db, ids['service_consumer'], "select hub.web_public_page($1,'th')", key)
            assert any(item['value'] == '022222222' for item in output['content']['contacts'])
        finally:
            await db.close()
    asyncio.run(check())


def test_public_reader_pins_facts_and_solar_but_keeps_expiry_and_staged_revocation(permission_accounts):
    """Reader fixture: real reviewed sources, immutable page, ordinary public SQL.

    The owner connection assembles an isolated page from those approvals; queue
    authority and insertion are exercised separately by the publication tests.
    """
    _, ids = permission_accounts
    from test_project_media import upload

    async def check():
        await online(ids)
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        transaction = db.transaction()
        await transaction.start()
        try:
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['editor']))
            project, rem_id, public_id = uuid4(), 'W4-' + uuid4().hex, 'prj_' + uuid4().hex
            await db.execute("insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint) values($1,'Synthetic reader project',now(),repeat('5',64))", rem_id)
            staged = {'project_id': rem_id, 'area_rai': 1, 'area_ngan': 0, 'area_square_wah': 0, 'total_unit': 100, 'buildings': []}
            await db.execute("insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance) values($1,$2,now(),repeat('5',64),'{}')", rem_id, staged)
            await db.execute('insert into hub.projects(id,public_project_id,rem_project_id) values($1,$2,$3)', project, public_id, rem_id)
            fact_body = {'value_number': 400, 'as_of': str(date.today() - timedelta(days=2)), 'valid_to': str(date.today() + timedelta(days=30)), 'ai_exposure': 'open'}
            fact = await call(db, ids['editor'], "select hub.save_project_fact($1,'project.land_area_sqwah','project',0,$2)", public_id, fact_body)
            await approve_item(db, ids, 'fact', {'id': fact['id']})
            solar_id = uuid4()
            solar_body = {'system_kw': 5, 'usage_profile': {'th': 'Synthetic use'}, 'bill_before': 1000, 'bill_after': 500,
                          'saving_pct': 50, 'assumptions': {'th': 'Synthetic assumption'}, 'source_note': {'th': 'Synthetic evidence'},
                          'as_of': str(date.today()), 'ai_exposure': 'web_only'}
            await call(db, ids['editor'], "select hub.c4_item_save($1,'solar',$2,0,$3)", public_id, solar_id, solar_body)
            await approve_item(db, ids, 'solar', {'id': str(solar_id)})
            asset = await upload(db, ids['editor'])
            asset_id, link_id = UUID(asset['id']), uuid4()
            await call(db, ids['editor'], 'select hub.media_save_asset($1,$2,0,$3)', public_id, asset_id,
                       {'media_category': 'interior', 'alt_text': {'th': 'Synthetic image'}, 'metadata_state': 'confirmed', 'ai_exposure': 'web_only', 'marketing_publication': True})
            await call(db, ids['editor'], 'select hub.media_link_save($1,$2,0,$3)', public_id, link_id,
                       {'asset_id': str(asset_id), 'target_type': 'project', 'target_key': str(project), 'usage': 'gallery', 'ai_exposure': 'web_only'})
            asset = await call(db, ids['publisher'], 'select hub.asset_detail($1)', asset_id)
            await call(db, ids['publisher'], "select hub.review_asset($1,$2,'approved','Synthetic rights',null,null,'Synthetic review')", asset_id, datetime.fromisoformat(asset['updated_at']))
            await approve_item(db, ids, 'asset', {'id': str(asset_id)})
            await approve_item(db, ids, 'asset_context', {'id': str(link_id)})
            key = await corporate_page(db, ids)
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['viewer']))
            for kind, identity in [('asset', {'id': str(asset_id)}), ('asset_context', {'id': str(link_id)})]:
                descriptor = await db.fetchval('select hub.publication_workflow_descriptor($1,$2)', kind, identity)
                assert descriptor['target']['section'] == 'upload'
                assert descriptor['target']['asset_id'] == str(asset_id)
                assert descriptor['target']['item'] == identity['id']
                if kind == 'asset_context':
                    assert descriptor['target']['binding'] == str(link_id)
                assert 'asset=' + str(asset_id) in publication_targets(descriptor)['href']
            clip_id = uuid4()
            await call(db, ids['editor'], 'select hub.media_clip_save($1,$2,0,$3)', public_id, clip_id,
                       {'provider': 'matterport', 'kind': 'tour_360', 'url': 'https://my.matterport.com/show/?m=synthetic',
                        'title': {'th': 'Synthetic tour'}, 'targets': [{'target_type': 'project', 'target_key': str(project)}],
                        'ai_exposure': 'open', 'owner_type': 'sena_owned'})
            clip_target = await db.fetchval('select id from hub.media_link_targets where media_link_id=$1', clip_id)
            for kind, item_id in [('media_link', clip_id), ('media_target', clip_target)]:
                descriptor = await db.fetchval('select hub.publication_workflow_descriptor($1,$2)', kind, {'id': str(item_id)})
                assert descriptor['target']['section'] == 'clips' and descriptor['target']['item'] == str(item_id)
            snapshot = await db.fetchval('select hub.web_compose(p) from hub.web_pages p where page_key=$1', key)
            slots = {locale: await db.fetchval("select hub.faq_fact_slot($1,'project.land_area_sqwah',$2,null,false)", project, locale) for locale in ['th', 'en']}
            fact_node = {'_fact': True, 'project_id': str(project), 'field_key': 'project.land_area_sqwah',
                         'reviewed': slots, 'dependencies': [], 'ai_exposure': 'open'}
            solar_dep = await db.fetchval("select hub.web_dependency('solar_estimates',$1,'projects')", {'id': str(solar_id)})
            snapshot['body'] = {'facts': [fact_node], 'solar': [{'_item': True, 'data': {'system_kw': 5}, 'dependencies': [solar_dep], 'ai_exposure': 'web_only'}]}
            snapshot['body']['media'] = [await db.fetchval("select hub.web_asset($1,jsonb_build_array(hub.web_dependency('asset_links',$2,'projects')),'web_only')", asset_id, {'id': str(link_id)})]
            snapshot = await db.fetchval('select hub.publication_enrich($1)', snapshot)
            processed = await db.fetchval('select hub.publication_sanitize($1,null,true)', snapshot)
            assert not any(item['status'] == 'REJECTED' for item in processed['outcomes'])
            snapshot = processed['value']
            await db.execute("select hub.web_assert_sources($1,'view',true)", snapshot)
            page_id = await db.fetchval('select id from hub.web_pages where page_key=$1', key)
            version_id = await db.fetchval("insert into hub.entity_versions(entity_type,web_page_id,version_no,payload,content_sha256,publisher,change_reason) values('web_page',$1,1,$2,hub.web_hash($2),$3,'Synthetic pinned reader fixture') returning id", page_id, snapshot, ids['viewer'])
            await db.execute('update hub.web_pages set published_version_id=$2 where id=$1', page_id, version_id)

            async def public():
                return (await call(db, ids['service_consumer'], "select hub.web_public_page($1,'th')", key))['content']

            assert (await public())['facts'][0]['value'] == 400
            assert (await public())['solar'][0]['system_kw'] == 5
            assert (await public())['media']
            await call(db, ids['editor'], "select hub.save_project_fact($1,'project.land_area_sqwah','project',1,$2)",
                       public_id, {**fact_body, 'value_number': 450, 'override_reason': 'New survey draft'})
            revision = await db.fetchval('select revision from hub.solar_estimates where id=$1', solar_id)
            await call(db, ids['editor'], "select hub.c4_item_save($1,'solar',$2,$3,$4)", public_id, solar_id, revision, {'system_kw': 6})
            assert (await public())['facts'][0]['value'] == 400
            assert (await public())['solar'][0]['system_kw'] == 5
            expiry = db.transaction()
            await expiry.start()
            await db.execute("update hub.field_catalog set review_every_days=1 where field_key='project.land_area_sqwah'")
            assert (await public())['facts'] == []
            await expiry.rollback()
            assert (await public())['facts'][0]['value'] == 400
            await db.execute('update staging.dw_projects set source_record=$2 where rem_project_id=$1', rem_id, {**staged, 'area_rai': 2})
            assert (await public())['facts'] == []
            current_solar = await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'solar', {'id': str(solar_id)})
            await call(db, ids['publisher'], "select hub.content_workflow_review($1,$2,$3,'withdraw',$4)",
                       'solar', {'id': str(solar_id)}, current_solar['expected_hash'], 'Withdraw scenario')
            assert (await public())['solar'] == []
            asset = await call(db, ids['publisher'], 'select hub.asset_detail($1)', asset_id)
            await call(db, ids['publisher'], "select hub.review_asset($1,$2,'revoked','Rights revoked',null,null,'Rights revoked')", asset_id, datetime.fromisoformat(asset['updated_at']))
            assert (await public())['media'] == []
            assert await db.fetchval('select payload from hub.entity_versions where id=$1', version_id) == snapshot
        finally:
            await transaction.rollback()
            await db.close()
    asyncio.run(check())


def test_published_faq_and_question_keep_approved_text_during_new_drafts(permission_accounts):
    _, ids = permission_accounts

    async def check():
        await online(ids)
        db = await runtime()
        try:
            question = 'w4_pinned_' + uuid4().hex
            question_body = {'topic': 'design', 'default_level': 'corporate', 'question_template': {'th': 'Synthetic contact?'}, 'answer_kind': 'text'}
            await call(db, ids['editor'], 'select hub.save_faq_question($1,0,$2)', question, question_body)
            await call(db, ids['publisher'], "select hub.approve_faq_question($1,1,'approved')", question)
            body = {'question_key': question, 'scope_type': 'corporate', 'scope_id': 'sena', 'question': {'th': 'Synthetic contact?'},
                    'short_answer': {'th': 'Approved contact text'}, 'answer_kind': 'text', 'ai_exposure': 'open'}
            faq = await call(db, ids['editor'], 'select hub.save_faq(null,0,$1)', body)
            for translation in await call(db, ids['editor'], "select hub.content_translation_list('knowledge',$1)", faq['id']):
                if translation['th_text'].strip() and translation['editable'] and translation['translation_state'] != 'reviewed':
                    await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)', UUID(translation['id']), translation['revision'], translation['th_version'], translation['th_text'])
            await approve_item(db, ids, 'faq', {'id': faq['id']})
            key = await corporate_page(db, ids)
            batch = await prepare(db, ids, key)
            published = await call(db, ids['viewer'], 'select hub.publication_queue_publish($1,$2)', UUID(batch['id']), batch['digest'])
            assert published['page_count'] == 1

            async def answers():
                return (await call(db, ids['service_consumer'], "select hub.web_public_page($1,'th')", key))['faq']

            assert next(item for item in await answers() if item['question_key'] == question)['short_answer'] == 'Approved contact text'
            current = await call(db, ids['editor'], 'select hub.faq_read($1)', UUID(faq['id']))
            await call(db, ids['editor'], 'select hub.save_faq($1,$2,$3)', UUID(faq['id']), current['revision'], {**body, 'short_answer': {'th': 'Unreviewed replacement'}})
            await call(db, ids['editor'], 'select hub.save_faq_question($1,2,$2)', question, {**question_body, 'question_template': {'th': 'Unreviewed question'}})
            assert next(item for item in await answers() if item['question_key'] == question)['short_answer'] == 'Approved contact text'
            current = await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'question', {'question_key': question})
            await call(db, ids['publisher'], "select hub.content_workflow_review($1,$2,$3,'withdraw',$4)", 'question', {'question_key': question}, current['expected_hash'], 'Retire the question')
            assert all(item['question_key'] != question for item in await answers())
        finally:
            await db.close()
    asyncio.run(check())


def test_private_first_draft_preview_survives_approved_only_publication(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        transaction = db.transaction()
        await transaction.start()
        try:
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['editor']))
            rem_id = 'W4-PREVIEW-' + uuid4().hex
            await db.execute("insert into staging.rem_brands(rem_brand_id,brand_name_rem,source_updated_at,source_fingerprint) values($1,'Synthetic preview brand',now(),repeat('6',64))", rem_id)
            brand = await db.fetchrow("insert into hub.brands(rem_brand_id,public_name) values($1,'{\"th\":\"First draft brand\"}') returning id,public_brand_id", rem_id)
            ref = brand['public_brand_id']
            saved = await call(db, ids['editor'], "select hub.save_content_section('brand',$1,'section.project_intro',0,$2)", ref,
                               {'body': {'th': 'First draft narrative'}, 'ai_exposure': 'web_only'})
            assert not await db.fetchval("select exists(select 1 from hub.web_pages where page_type='brand' and entity_ref=$1)", ref)
            before = await db.fetchrow('select (select count(*) from audit.change_log) audits,(select count(*) from hub.web_pages) pages')
            preview = await call(db, ids['viewer'], "select hub.workspace_preview('brand',$1,null,'th')", ref)
            assert preview['mode'] == 'PRIVATE_DRAFT' and preview['saved'] is False
            assert preview['preview']['content']['fields']['public_name'] == 'First draft brand'
            assert any(x['body'] == 'First draft narrative' for x in preview['preview']['content']['sections'])
            after = await db.fetchrow('select (select count(*) from audit.change_log) audits,(select count(*) from hub.web_pages) pages')
            assert before == after
            assert await db.fetchval('select state from hub.content_section_versions where id=$1', UUID(saved['version']['id'])) == 'DRAFT'
            with pytest.raises(asyncpg.NoDataFoundError):
                await call(db, ids['service_consumer'], "select hub.web_public_page($1,'th')", 'brand:' + ref)
            await set_bit(ids['viewer'], 'brands', can_view=False, connection=db, manager=ids['admin'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], "select hub.workspace_preview('brand',$1,null,'th')", ref)
        finally:
            await transaction.rollback()
            await db.close()
    asyncio.run(check())


def test_retained_translation_requires_exact_published_approval_and_frozen_contributors(permission_accounts):
    """An immutable reader fixture uses real approved versions and full guards."""
    _, ids = permission_accounts

    async def check():
        await online(ids)
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        transaction = db.transaction()
        await transaction.start()
        try:
            key = 'w4_reviewer_' + uuid4().hex
            await call(db, ids['editor'], 'select hub.save_faq_question($1,0,$2)', key,
                       {'topic': 'design', 'default_level': 'corporate', 'question_template': {'th': 'Synthetic question?'}, 'answer_kind': 'text'})
            await call(db, ids['publisher'], "select hub.approve_faq_question($1,1,'approved')", key)
            body = {'question_key': key, 'scope_type': 'corporate', 'scope_id': 'sena', 'question': {'th': 'Synthetic question?'},
                    'short_answer': {'th': 'Original approved answer'}, 'answer_kind': 'text', 'ai_exposure': 'web_only'}
            faq = await call(db, ids['editor'], 'select hub.save_faq(null,0,$1)', body)
            translations = await call(db, ids['editor'], "select hub.content_translation_list('knowledge',$1)", faq['id'])
            for t in translations:
                if t['editable'] and t['th_text'].strip():
                    await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)', UUID(t['id']), t['revision'], t['th_version'], t['th_text'])
            approved = await approve_item(db, ids, 'faq', {'id': faq['id']})
            t = next(t for t in translations if t['field_key'] == 'faq.short_answer')
            page_key = await corporate_page(db, ids)
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['viewer']))
            old = await db.fetchval("select hub.web_dependency('content_translations',$1,'knowledge')", {'id': t['id']})
            assert await db.fetchval('select hub.publication_retained_reviewer_evidence($1,$2)', old, ids['viewer']) is False
            parent = await db.fetchval("select hub.web_dependency('faqs',$1,'knowledge')", {'id': faq['id']})
            exact = await db.fetchval("select hub.web_dependency('faq_versions',$1,'knowledge')", {'id': approved['version_id']})
            snapshot = await db.fetchval('select hub.web_compose(p) from hub.web_pages p where page_key=$1', page_key)
            snapshot['body'] = {'answer': {'_item': True, 'data': {'text': 'Original approved answer'},
                                           'dependencies': [parent, exact, old], 'ai_exposure': 'web_only'}}
            await db.execute("select hub.web_assert_sources($1,'view',true)", snapshot)
            page_id = await db.fetchval('select id from hub.web_pages where page_key=$1', page_key)
            version_id = await db.fetchval("insert into hub.entity_versions(entity_type,web_page_id,version_no,payload,content_sha256,publisher,change_reason) values('web_page',$1,1,$2,hub.web_hash($2),$3,'Synthetic reviewed translation reader') returning id", page_id, snapshot, ids['viewer'])
            await db.execute('update hub.web_pages set published_version_id=$2 where id=$1', page_id, version_id)
            current = await call(db, ids['editor'], 'select hub.faq_read($1)', UUID(faq['id']))
            await call(db, ids['editor'], 'select hub.save_faq($1,$2,$3)', UUID(faq['id']), current['revision'], {**body, 'short_answer': {'th': 'New unrelated draft answer'}})
            await set_bit(ids['viewer'], 'knowledge', can_edit=True, connection=db, manager=ids['admin'])
            newer = next(t for t in await call(db, ids['viewer'], "select hub.content_translation_list('knowledge',$1)", faq['id']) if t['field_key'] == 'faq.short_answer')
            await call(db, ids['viewer'], 'select hub.review_content_translation($1,$2,$3,$4)', UUID(newer['id']), newer['revision'], newer['th_version'], newer['th_text'])
            await set_bit(ids['viewer'], 'knowledge', can_edit=False, connection=db, manager=ids['admin'])
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['viewer']))
            assert await db.fetchval('select hub.publication_retained_reviewer_evidence($1,$2)', old, ids['viewer']) is True
            await db.execute('select hub.publication_dependency_check($1,true,false)', old)
            with pytest.raises(asyncpg.SerializationError):
                async with db.transaction():
                    await db.execute('select hub.publication_dependency_check($1,true,true)', old)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                async with db.transaction():
                    await db.execute('select hub.publication_dependency_check($1,true,false)', {**old, 'hash': '0' * 64})
            for role in ['editor', 'publisher']:
                assert await db.fetchval('select hub.publication_retained_reviewer_evidence($1,$2)', old, ids[role]) is False
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['editor']))
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                async with db.transaction():
                    await db.execute('select hub.publication_dependency_check($1,true,false)', old)
            public = await call(db, ids['service_consumer'], "select hub.web_public_page($1,'th')", page_key)
            assert public['content']['answer']['text'] == 'Original approved answer'
            assert await db.fetchval('select payload from hub.entity_versions where id=$1', version_id) == snapshot
        finally:
            await transaction.rollback()
            await db.close()
    asyncio.run(check())


def test_review_targets_are_encoded_and_release_html_is_escaped():
    review = reviewed_preview({'can_publish': True, 'pages': [{
        'system': 'release', 'member': {'entity_type': 'brand'}, 'label': {'th': '<script>label</script>'},
        'preview': {'public_name': {'th': '<img src=x onerror=alert(1)>'}},
        'target': {'level': 'brand', 'id': 'brd/a?b', 'tab': 'data', 'item': 'x&y', 'href': 'javascript:alert(1)'},
        'workflow': {'kind': 'brand', 'identity': {'id': 'synthetic'}, 'expected_hash': 'a' * 64},
        'can_return': True, 'items': [],
    }]})
    page = review['pages'][0]
    assert page['href'] == '/website/brand/brd%2Fa%3Fb?tab=data&item=x%26y'
    assert '<script>' not in page['html'] and '<img ' not in page['html']
    assert '&lt;img ' in page['html'] and page['title'] == page['label']
    denied = publication_targets({'target': {'level': 'user_account', 'id': 'secret', 'tab': 'data'},
                                  'workflow': {'kind': 'brand', 'identity': {}}, 'can_return': False})
    assert denied['href'] is None


@pytest.mark.parametrize('changed_child', [False, True])
def test_mixed_release_review_pins_child_hash_and_preserves_other_targets(permission_accounts, changed_child):
    from test_project_media import upload
    _, ids = permission_accounts

    async def check():
        await online(ids)
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        transaction = db.transaction()
        await transaction.start()
        try:
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['editor']))
            rem_id = 'W4-RELEASE-' + uuid4().hex
            await db.execute("insert into staging.rem_brands(rem_brand_id,brand_name_rem,source_updated_at,source_fingerprint) values($1,'Synthetic release brand',now(),repeat('8',64))", rem_id)
            brand = await db.fetchrow("insert into hub.brands(rem_brand_id,public_name,description,slug,status) values($1,$2,$3,$4,'active') returning id,public_brand_id,updated_at",
                                     rem_id, {'th': 'Synthetic release brand'}, {'th': 'Approved release description'}, 'w4-' + uuid4().hex)
            asset = await upload(db, ids['editor'])
            asset_id = UUID(asset['id'])
            await call(db, ids['editor'], 'select hub.bind_brand_asset($1,$2,$3,$4,$5)', brand['id'], asset_id,
                       'logo_primary', {'th': 'Synthetic release logo'}, brand['updated_at'])
            from test_website_content import project_fixture
            context = await project_fixture(db, ids['editor'])
            media_revision = await db.fetchval('select media_revision from hub.assets where id=$1', asset_id)
            await call(db, ids['editor'], 'select hub.media_save_asset($1,$2,$3,$4)', context['public_project_id'], asset_id, media_revision,
                       {'media_category': 'promotion_ad', 'alt_text': {'th': 'Synthetic release logo'},
                        'metadata_state': 'confirmed', 'ai_exposure': 'web_only', 'marketing_publication': True})
            asset_stamp = await db.fetchval('select updated_at from hub.assets where id=$1', asset_id)
            await call(db, ids['publisher'], "select hub.review_asset($1,$2,'approved',$3,null,$4,$5)", asset_id, asset_stamp,
                       'Synthetic owned fixture', datetime.now().astimezone() + timedelta(days=30), 'Fixture rights decision')
            binding = await db.fetchval('select id from hub.brand_assets where brand_id=$1 and asset_id=$2 and deleted_at is null', brand['id'], asset_id)
            for kind, identity in [('brand', {'id': str(brand['id'])}), ('asset', {'id': str(asset_id)}), ('brand_asset', {'id': str(binding)})]:
                await approve_item(db, ids, kind, identity, reason='Manager confirmed synthetic fixture')
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['viewer']))
            descriptor = await db.fetchval('select hub.publication_workflow_descriptor($1,$2)', 'brand_asset', {'id': str(binding)})
            assert descriptor['target']['section'] == 'canonical'
            assert descriptor['target']['asset_id'] == str(asset_id) and descriptor['target']['binding'] == str(binding)
            assert descriptor['target']['media_role'] == 'logo_primary'
            row = await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',null,0,$1)", contact_body('028888888'))
            await approve_item(db, ids, 'contact', {'id': row['id']})
            key = await corporate_page(db, ids)
            batch = await call(db, ids['viewer'], 'select hub.publication_queue_prepare($1,$2)',
                               [{'system': 'release', 'entity_type': 'brand', 'entity_id': str(brand['id'])}, {'system': 'web', 'page_key': key}],
                               'Mixed exact approved snapshots')
            before = await db.fetchrow('select updated_at,published_version_id from hub.brands where id=$1', brand['id'])
            if changed_child:
                asset_stamp = await db.fetchval('select updated_at from hub.assets where id=$1', asset_id)
                await call(db, ids['publisher'], "select hub.review_asset($1,$2,'approved',$3,null,$4,$5)", asset_id, asset_stamp,
                           'Synthetic owned fixture', datetime.now().astimezone() + timedelta(days=60), 'Reconfirm child validity')
                # A real authored child draft requires a new certificate;
                # rights-only metadata cannot duplicate unchanged approvals.
                from test_website_content import project_fixture
                context = await project_fixture(db, ids['editor'])
                media_revision = await db.fetchval('select media_revision from hub.assets where id=$1', asset_id)
                await call(db, ids['editor'], 'select hub.media_save_asset($1,$2,$3,$4)', context['public_project_id'], asset_id, media_revision,
                           {'media_category': 'interior', 'caption': {'th': 'Revised release logo caption'},
                            'alt_text': {'th': 'Revised release logo'}, 'metadata_state': 'confirmed',
                            'ai_exposure': 'open', 'marketing_publication': True})
                await approve_item(db, ids, 'asset', {'id': str(asset_id)}, reason='Manager confirmed revised child content and validity')
                assert await db.fetchval('select rights_status from hub.assets where id=$1', asset_id) == 'approved'
                assert await db.fetchrow('select updated_at,published_version_id from hub.brands where id=$1', brand['id']) == before
            audit_count = await db.fetchval('select count(*) from audit.change_log')
            review = reviewed_preview(await call(db, ids['viewer'], "select hub.web_publication_read($1,'th')", UUID(batch['id'])))
            assert await db.fetchval('select count(*) from audit.change_log') == audit_count
            assert review['can_publish'] is True
            release = next(page for page in review['pages'] if page['system'] == 'release')
            assert release['preview']['public_name']['th'] == 'Synthetic release brand'
            assert release['label']['th'] == 'Synthetic release brand' and release['items']
            assert release['href'].startswith('/website/brand/' + brand['public_brand_id'])
            assert not any(secret in json.dumps(release['preview']) for secret in ['review_evidence', 'storage_path', 'approved_by', '_workflow'])
            assert release['status'] == ('REJECTED' if changed_child else 'APPROVED')
            if changed_child:
                assert release['code'] == 'stale'
            result = await call(db, ids['viewer'], 'select hub.publication_queue_publish($1,$2)', UUID(batch['id']), batch['digest'])
            assert result['state'] == ('PARTIAL' if changed_child else 'PUBLISHED')
            assert result['page_count'] == (1 if changed_child else 2)
            current = await db.fetchval('select published_version_id from hub.brands where id=$1', brand['id'])
            assert (current is None) is changed_child
            if not changed_child:
                next_batch = await call(db, ids['viewer'], 'select hub.publication_queue_prepare($1,$2)',
                                        [{'system': 'release', 'entity_type': 'brand', 'entity_id': str(brand['id'])}], 'Review prior and prepared export')
                next_review = await call(db, ids['viewer'], "select hub.web_publication_read($1,'th')", UUID(next_batch['id']))
                assert next_review['pages'][0]['previous']['public_name']['th'] == 'Synthetic release brand'
                assert next_review['pages'][0]['preview']['public_name']['th'] == 'Synthetic release brand'
            assert (await call(db, ids['service_consumer'], "select hub.web_public_page($1,'th')", key))['content']['contacts']
            locked = await db.fetchval("select count(*)=4 from pg_locks where pid=pg_backend_pid() and granted and mode='ShareRowExclusiveLock' and relation=any(array['hub.assets'::regclass,'hub.brand_assets'::regclass,'hub.brands'::regclass,'hub.content_review_versions'::regclass])")
            assert locked, 'Snapshot hash check and writes must share locks against child/approval mutation'
            await set_bit(ids['viewer'], 'brands', can_view=False, connection=db, manager=ids['admin'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], "select hub.web_publication_read($1,'th')", UUID(batch['id']))
        finally:
            await transaction.rollback()
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('evidence', ['pinned', 'legacy', 'publisher_only', 'wrong_version', 'revision_mismatch', 'withdrawn', 'ambiguous', 'different_brand', 'hidden_source'])
def test_new_multiphase_grouping_requires_exact_pinned_page_configuration(permission_accounts, evidence):
    """Read projection fixture with real approvals and immutable snapshots.

    These isolated phase nodes exercise grouping evidence and source visibility;
    complete page readiness and queue publication are separate runtime tests.
    No review row or historical publication is rewritten by this fixture.
    """
    from copy import deepcopy
    from test_website_content import project_fixture
    _, ids = permission_accounts

    async def check():
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        transaction = db.transaction()
        await transaction.start()
        try:
            projects = [await project_fixture(db, ids['editor']) for _ in range(2)]
            refs = [project['public_project_id'] for project in projects]
            await db.execute('update hub.projects set brand_id=$1 where id=$2', projects[0]['brand_id'], projects[1]['id'])
            for project in projects:
                await approve_item(db, ids, 'project', {'id': str(project['id'])})
            changes = {'url': '/synthetic-group/' + uuid4().hex, 'locales': ['th'],
                       'ai_policy': 'no_ai', 'max_faq_items': 20, 'project_ids': refs}

            async def page_fixture(anchor, mode):
                key = 'project:' + anchor
                page = await call(db, ids['editor'], 'select hub.web_page_save($1,0,$2)', key, changes | {'url': '/synthetic-group/' + uuid4().hex})
                identity = {'id': page['id']}
                approved = await approve_item(db, ids, 'page_config', identity)
                if mode == 'revision_mismatch':
                    # An identical-value revision is deliberately not covered
                    # by the old configuration approval's exact revision.
                    page = await call(db, ids['editor'], 'select hub.web_page_save($1,$2,$3)', key, page['revision'],
                                      changes | {'url': page['url']})
                await db.execute("select set_config('app.actor_id',$1,true)", str(ids['viewer']))
                dependency = await db.fetchval("select hub.web_dependency('web_pages',$1,'knowledge')", identity)
                assert dependency['approval']['version_id'] == approved['version_id']
                phases = []
                for project in projects:
                    dep = await db.fetchval("select hub.web_dependency('projects',$1,'projects')", {'id': str(project['id'])})
                    phases.append({'_item': True, 'data': {'public_project_id': project['public_project_id']},
                                   'dependencies': [dep], 'ai_exposure': 'open'})
                payload = {'page_key': key, 'config_revision': page['revision'],
                           '_publication': {'published_by': str(ids['viewer'])},
                           '_page_dependencies': [dependency], 'body': {'phases': phases}}
                if mode == 'publisher_only':
                    payload.pop('_page_dependencies')
                elif mode == 'wrong_version':
                    payload = deepcopy(payload)
                    payload['_page_dependencies'][0]['approval']['version_id'] = str(uuid4())
                elif mode == 'legacy':
                    payload.pop('_page_dependencies')
                    payload['_publication'] = {'approved_by': str(ids['publisher'])}
                version = await db.fetchval('''insert into hub.entity_versions(entity_type,web_page_id,version_no,payload,content_sha256,publisher,change_reason)
                    values('web_page',$1,1,$2,hub.web_hash($2),$3,'Synthetic approved grouping reader fixture') returning id''',
                                           UUID(page['id']), payload, ids['viewer'])
                await db.execute('update hub.web_pages set published_version_id=$1 where id=$2', version, UUID(page['id']))
                return page, approved, version, payload

            page, approval, version, payload = await page_fixture(refs[0], evidence)
            if evidence == 'withdrawn':
                current = await call(db, ids['publisher'], 'select hub.content_workflow_read($1,$2)', 'page_config', {'id': page['id']})
                await call(db, ids['publisher'], "select hub.content_workflow_review($1,$2,$3,'withdraw',$4)",
                           'page_config', {'id': page['id']}, current['expected_hash'], 'Grouping configuration withdrawn')
            elif evidence == 'ambiguous':
                await page_fixture(refs[1], 'pinned')
            elif evidence == 'different_brand':
                # New fixture membership only; no old brand or content changes.
                other_brand = None if projects[0]['brand_id'] is not None else await db.fetchval('select id from hub.brands where deleted_at is null limit 1')
                assert other_brand != projects[0]['brand_id']
                await db.execute('update hub.projects set brand_id=$1 where id=$2', other_brand, projects[1]['id'])
            elif evidence == 'hidden_source':
                await db.execute("update hub.account_permission set can_view=false,can_edit=false,can_approve=false where account_id=$1 and tab='knowledge'", ids['viewer'])
            tree = await call(db, ids['viewer'], 'select hub.workspace_tree(null,null,$1,null,100)', refs[0])
            grouped = next(item for item in tree['items'] if item['ref'] == refs[0])
            expected = evidence in {'pinned', 'legacy'}
            assert (grouped['grouping']['state'] == 'confirmed') is expected
            assert grouped['visible_phase_count'] == (2 if expected else 1)
            assert await db.fetchval('select payload from hub.entity_versions where id=$1', version) == payload
            if evidence == 'pinned':
                identity = {'id': page['id']}
                certificate_count = await db.fetchval("select count(*) from hub.content_review_versions where kind='page_config' and identity=$1", identity)
                with pytest.raises(asyncpg.CheckViolationError, match='already approved'):
                    await approve_item(db, ids, 'page_config', identity)
                assert await db.fetchval("select count(*) from hub.content_review_versions where kind='page_config' and identity=$1", identity) == certificate_count
                again = await call(db, ids['viewer'], 'select hub.workspace_tree(null,null,$1,null,100)', refs[0])
                assert next(item for item in again['items'] if item['ref'] == refs[0])['grouping']['state'] == 'confirmed'
                # A legitimate edited configuration gets a new certificate,
                # but the old publication does not certify its new revision.
                await call(db, ids['editor'], 'select hub.web_page_save($1,$2,$3)', page['page_key'], page['revision'],
                           changes | {'url': page['url'], 'max_faq_items': changes['max_faq_items'] + 1})
                newer = await approve_item(db, ids, 'page_config', identity)
                assert newer['version_id'] != approval['version_id']
                assert await db.fetchval('select payload from hub.entity_versions where id=$1', version) == payload
                again = await call(db, ids['viewer'], 'select hub.workspace_tree(null,null,$1,null,100)', refs[0])
                assert next(item for item in again['items'] if item['ref'] == refs[0])['grouping']['state'] != 'confirmed'
        finally:
            await transaction.rollback()
            await db.close()
    asyncio.run(check())



@pytest.mark.parametrize('retained', [False, True])
@pytest.mark.parametrize('publisher', [False, True])
def test_review_redacts_hidden_previous_and_retained_sources_for_every_reader(permission_accounts, retained, publisher):
    """Guarded historical fixtures exercise reads; new drafts use real commands."""
    from copy import deepcopy
    from test_content_workflow import inventory_brand_fixture
    _, ids = permission_accounts

    async def check():
        await online(ids)
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        tx = db.transaction()
        await tx.start()
        try:
            secret = 'Hidden previous source ' + uuid4().hex
            brand = await inventory_brand_fixture(db, ids['editor'])
            old_source = await call(db, ids['editor'], "select hub.save_content_contact('brand',$1,null,0,$2)", brand['public_brand_id'], contact_body(label={'th': secret}))
            current = await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',null,0,$1)",
                                 contact_body('021234111', label={'th': secret if retained else 'Earlier allowed source'}))
            neighbour = await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',null,0,$1)",
                                   contact_body('021234999', label={'th': 'Allowed neighbouring source'}))
            for row in (old_source, current, neighbour):
                await approve_item(db, ids, 'contact', {'id': row['id']})
            keys = [await corporate_page(db, ids) for _ in range(2)]
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['viewer']))
            hidden_dependency = await db.fetchval("select hub.web_dependency('contacts',$1,'brands')", {'id': old_source['id']})
            versions = []
            for index, key in enumerate(keys):
                snapshot = await db.fetchval('select hub.web_compose(p) from hub.web_pages p where page_key=$1', key)
                def contact_node(identity):
                    return next(deepcopy(node) for node in snapshot['body']['contacts']
                                if any(d.get('table') == 'contacts' and d['identity'].get('id') == identity for d in node['dependencies']))
                own_node, allowed_node = contact_node(current['id']), contact_node(neighbour['id'])
                snapshot['body'] = {'contacts': [own_node, allowed_node] if index == 0 else [allowed_node]}
                if index == 0:
                    if retained:
                        # Older review proof may sit outside the primary item
                        # dependency list. Retention must recheck it as well.
                        own_node['_evidence'] = [hidden_dependency]
                    else:
                        snapshot['body']['previous_only'] = {'_item': True, 'data': {'text': secret},
                                                            'dependencies': [hidden_dependency], 'ai_exposure': 'web_only'}
                await db.execute("select hub.web_assert_sources($1,'view',true)", snapshot)
                page_id = await db.fetchval('select id from hub.web_pages where page_key=$1', key)
                version = await db.fetchval("insert into hub.entity_versions(entity_type,web_page_id,version_no,payload,content_sha256,publisher,change_reason) values('web_page',$1,1,$2,hub.web_hash($2),$3,'Guarded previous-source review fixture') returning id",
                                            page_id, snapshot, ids['viewer'])
                await db.execute('update hub.web_pages set published_version_id=$2 where id=$1', page_id, version)
                versions.append((version, snapshot))
            await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',$1,1,$2)", UUID(current['id']),
                       contact_body('021234222', label={'th': 'Allowed newly approved source'}))
            await approve_item(db, ids, 'contact', {'id': current['id']})
            batch = await call(db, ids['viewer'], 'select hub.publication_queue_prepare($1,$2)',
                               [{'system': 'web', 'page_key': key} for key in keys], 'Review independent before and after source permissions')
            if retained:
                await call(db, ids['editor'], "select hub.save_content_contact('corporate','sena',$1,2,$2)", UUID(current['id']),
                           contact_body('021234333', label={'th': 'Newer unapproved source'}))
            await db.execute("update hub.account_permission set can_view=false,can_edit=false,can_approve=false where account_id=$1 and tab='brands'", ids['viewer'])
            if not publisher:
                await db.execute("update hub.account_permission set special_actions='{}' where account_id=$1 and tab='knowledge'", ids['viewer'])
            audit_count = await db.fetchval('select count(*) from audit.change_log')
            result = reviewed_preview(await call(db, ids['viewer'], "select hub.web_publication_read($1,'th')", UUID(batch['id'])))
            assert await db.fetchval('select count(*) from audit.change_log') == audit_count
            assert result['can_publish'] is publisher
            hidden, allowed = [next(page for page in result['pages'] if page['page_key'] == key) for key in keys]
            assert hidden['previous_redacted'] is True
            assert not any(key in hidden for key in ('previous', 'previous_html', 'previous_assets'))
            assert hidden['preview_redacted'] is retained
            assert secret not in json.dumps(result)
            assert allowed['previous_redacted'] is False and allowed['preview_redacted'] is False
            assert allowed['previous_html'] and 'Allowed neighbouring source' in allowed['html']
            if retained:
                assert hidden['preview']['content'] == {} and hidden['code'] == 'retained_source_unavailable'
            else:
                assert 'Allowed newly approved source' in hidden['html']
                if publisher:
                    published = await call(db, ids['viewer'], 'select hub.publication_queue_publish($1,$2)', UUID(batch['id']), batch['digest'])
                    assert published['page_count'] == 2
            for version, snapshot in versions:
                assert await db.fetchval('select payload from hub.entity_versions where id=$1', version) == snapshot
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())


def test_release_review_checks_previous_source_evidence_independently(permission_accounts):
    from test_content_workflow import inventory_brand_fixture
    from test_website_content import project_fixture
    _, ids = permission_accounts

    async def check():
        await online(ids)
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        tx = db.transaction()
        await tx.start()
        try:
            brand = await inventory_brand_fixture(db, ids['editor'])
            project = await project_fixture(db, ids['editor'])
            # Isolated source fixture: the current project has no brand data.
            # Its older immutable payload retains an approved former brand.
            await db.execute('update hub.projects set brand_id=null where id=$1', project['id'])
            for kind, identity in [('brand', {'id': str(brand['id'])}), ('project', {'id': str(project['id'])})]:
                await approve_item(db, ids, kind, identity)
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['viewer']))
            payload = await db.fetchval("select hub.residential_payload('project',$1,false)", project['id'])
            payload['brand'] = await db.fetchval("select hub.residential_payload('brand',$1,false)", brand['id'])
            guarded = await db.fetchval("select hub.publication_legacy_certify('project',$1,$2,false)", project['id'], payload)
            assert any(d['tab'] == 'brands' for d in guarded['_workflow']['dependencies'])
            version = await db.fetchval("insert into hub.entity_versions(entity_type,project_id,version_no,payload,publisher,change_reason) values('project',$1,1,$2,$3,'Guarded previous release reader fixture') returning id",
                                        project['id'], payload, ids['viewer'])
            await db.execute('update hub.projects set published_version_id=$2 where id=$1', project['id'], version)
            current = await call(db, ids['editor'], 'select hub.project_detail($1)', project['public_project_id'])
            await call(db, ids['editor'], 'select hub.patch_project($1,$2,$3)', project['id'],
                       {'meta_title': {'th': 'New allowed project draft'}}, datetime.fromisoformat(current['updated_at']))
            await approve_item(db, ids, 'project', {'id': str(project['id'])})
            batch = await call(db, ids['viewer'], 'select hub.publication_queue_prepare($1,$2)',
                               [{'system': 'release', 'entity_type': 'project', 'entity_id': str(project['id'])}], 'Review a former brand source independently')
            visible = await call(db, ids['viewer'], "select hub.web_publication_read($1,'th')", UUID(batch['id']))
            assert visible['pages'][0]['previous_redacted'] is False and visible['pages'][0]['previous']
            await db.execute("update hub.account_permission set can_view=false,can_edit=false,can_approve=false where account_id=$1 and tab='brands'", ids['viewer'])
            await db.execute("select set_config('app.actor_id',$1,true)", str(ids['viewer']))
            assert (await db.fetchval("select hub.publication_review('project',$1)", payload))['publication_preview_redacted'] is True
            for absent in ({}, {'brand': None, 'brand_summary': None}):
                no_brand = {'public_project_id': project['public_project_id'], 'public_name': {'th': 'Allowed project'},
                            'models': [], 'assets': [], **absent}
                projection = await db.fetchval("select hub.publication_review('project',$1)", no_brand)
                assert projection['publication_preview_redacted'] is False
                assert projection['publication_preview']['brand'] is None
            audit_count = await db.fetchval('select count(*) from audit.change_log')
            result = reviewed_preview(await call(db, ids['viewer'], "select hub.web_publication_read($1,'th')", UUID(batch['id'])))
            assert await db.fetchval('select count(*) from audit.change_log') == audit_count
            page = result['pages'][0]
            assert page['previous_redacted'] is True and 'previous' not in page
            assert page['preview']['public_project_id'] == project['public_project_id'] and result['can_publish'] is True
            assert page['preview_redacted'] is False and page['preview'].get('brand') is None
            assert str(brand['id']) not in json.dumps(result)
            # Residential insertion freezes this catalogue flag; subsequent
            # review reads must preserve every stored field exactly.
            assert await db.fetchval('select payload from hub.entity_versions where id=$1', version) == payload | {'model_catalogue_complete': True}
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())
