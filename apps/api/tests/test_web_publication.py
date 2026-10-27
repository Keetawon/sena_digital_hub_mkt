"""Reviewed website snapshots and live withdrawal on the disposable cluster."""
import asyncio
import json
import re
from datetime import datetime
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_articles import content, review_english
from test_permission_baseline import disposable_operator, ROOT
from test_permission_content import call, set_bit
from test_permission_db_baseline import runtime as committed_runtime
from test_permission_foundations import permission_accounts, h
from test_project_content_core import run, runtime


def config(url='/synthetic', **changes):
    return {'url': url, 'locales': ['th', 'en'], 'ai_policy': 'open', 'max_faq_items': 20, 'project_ids': [], **changes}


async def approved_article(db, ids):
    body = content(ai_exposure='open')
    a = await call(db, ids['editor'], 'select hub.article_save(null,0,$1)', body)
    data = await review_english(db, ids, a['id'])
    await call(db, ids['editor'], 'select hub.article_submit($1,$2)', UUID(a['id']), data['revision'])
    data = await call(db, ids['viewer'], 'select hub.article_read($1)', UUID(a['id']))
    await call(db, ids['publisher'], "select hub.article_review($1,$2,'approve')", UUID(a['id']), data['revision'])
    return a, body


def test_web_publication_article_lifecycle_and_no_implicit_special(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        transaction = db.transaction()
        await transaction.start()
        try:
            a, body = await approved_article(db, ids)
            key = 'article:' + body['slug']
            await call(db, ids['editor'], 'select hub.web_page_save($1,0,$2)', key, config())
            batch = await call(db, ids['editor'], 'select hub.web_prepare($1)', 'Synthetic review')
            preview = await call(db, ids['viewer'], "select hub.web_publication_read($1,'th')", UUID(batch['id']))
            assert preview['pages'][0]['issues'] == []
            assert preview['pages'][0]['preview']['content']['article']['title'] == 'Synthetic article'
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['publisher'], 'select hub.web_publish($1,$2)', UUID(batch['id']), batch['digest'])
            await set_bit(ids['publisher'], 'knowledge', can_approve=True, special_actions=['knowledge.publish_web'])
            result = await call(db, ids['publisher'], 'select hub.web_publish($1,$2)', UUID(batch['id']), batch['digest'])
            assert result['state'] == 'PUBLISHED'
            public = await call(db, ids['service_consumer'], "select hub.web_public_page($1,'en')", key)
            assert public['content']['article']['title'] == 'Synthetic article'
            assert len(public['content_sha256']) == 64
            changes = await call(db, ids['service_consumer'], 'select hub.web_public_changes(0)')
            assert len(changes['items']) == 2
            history = await call(db, ids['viewer'], 'select hub.web_history($1)', key)
            version = UUID(history[0]['id'])
            await call(db, ids['publisher'], 'select hub.web_pointer($1,$2,null,$3)', key, version, 'Synthetic withdrawal')
            with pytest.raises(asyncpg.NoDataFoundError):
                await call(db, ids['service_consumer'], "select hub.web_public_page($1,'th')", key)
            await call(db, ids['publisher'], 'select hub.web_pointer($1,null,$2,$3)', key, version, 'Synthetic rollback')
            assert (await call(db, ids['service_consumer'], "select hub.web_public_page($1,'th')", key))['content']['article']
        finally:
            await transaction.rollback()
            await db.close()
    run(check())


def test_web_publication_stale_batch_atomic_four_eyes_and_revocation(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        transaction = db.transaction()
        await transaction.start()
        try:
            _, first = await approved_article(db, ids)
            _, second = await approved_article(db, ids)
            keys = ['article:' + first['slug'], 'article:' + second['slug']]
            for key in keys:
                await call(db, ids['editor'], 'select hub.web_page_save($1,0,$2)', key, config())
            batch = await call(db, ids['editor'], 'select hub.web_prepare($1)', 'Atomic review')
            await set_bit(ids['publisher'], 'knowledge', special_actions=['knowledge.publish_web'])
            await call(db, ids['editor'], 'select hub.web_page_save($1,1,$2)', keys[1], config('/changed'))
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['publisher'], 'select hub.web_publish($1,$2)', UUID(batch['id']), batch['digest'])
            assert all(not p['published_version_id'] for p in (await call(db, ids['viewer'], 'select hub.web_workspace()'))['pages'] if p['page_key'] in keys)
            batch = await call(db, ids['editor'], 'select hub.web_prepare($1)', 'Fresh review')
            await set_bit(ids['editor'], 'knowledge', can_edit=False, can_approve=True, special_actions=['knowledge.publish_web'])
            assert not (await call(db, ids['editor'], "select hub.web_publication_read($1,'th')", UUID(batch['id'])))['can_publish']
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], 'select hub.web_publish($1,$2)', UUID(batch['id']), batch['digest'])
            await set_bit(ids['publisher'], 'knowledge', special_actions=[])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['publisher'], 'select hub.web_publish($1,$2)', UUID(batch['id']), batch['digest'])
            await set_bit(ids['publisher'], 'knowledge', special_actions=['knowledge.publish_web'])
            assert (await call(db, ids['publisher'], 'select hub.web_publish($1,$2)', UUID(batch['id']), batch['digest']))['page_count'] == 2
            for key in keys:
                output = await call(db, ids['service_consumer'], "select hub.web_public_page($1,'th')", key)
                assert not re.search(r'[0-9a-f]{8}-[0-9a-f-]{27}', json.dumps(output))
                assert 'dependencies' not in json.dumps(output) and 'editors' not in json.dumps(output)
        finally:
            await transaction.rollback()
            await db.close()
    run(check())


def test_web_publication_http_auth_cache_and_no_draft_substitution(permission_accounts):
    client, ids = permission_accounts

    async def seed():
        db = await committed_runtime()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        try:
            article, body = await approved_article(db, ids)
            key = 'article:' + body['slug']
            await call(db, ids['editor'], 'select hub.web_page_save($1,0,$2)', key, config())
            batch = await call(db, ids['editor'], 'select hub.web_prepare($1)', 'HTTP review')
            await set_bit(ids['publisher'], 'knowledge', special_actions=['knowledge.publish_web'])
            await call(db, ids['publisher'], 'select hub.web_publish($1,$2)', UUID(batch['id']), batch['digest'])
            return key, article, body, batch
        finally:
            await db.close()
    key, article, body, batch = run(seed())
    route = '/v1/web/pages/' + key
    assert client.get('/v1/admin/web', headers=h('service_consumer')).status_code == 403
    assert client.get(route).status_code == 401
    assert client.get(route, headers=h('agency')).status_code == 403
    first = client.get(route, headers=h('service_consumer'))
    assert first.status_code == 200, first.text
    etag = first.headers['etag']
    assert etag.strip('"') == first.json()['data']['content_sha256']
    assert client.get(route, headers={**h('service_consumer'), 'If-None-Match': etag}).status_code == 304
    assert client.get(route + '?locale=xx', headers=h('service_consumer')).status_code == 422
    html = client.get(f"/v1/admin/web/publications/{batch['id']}/preview", headers=h('viewer'))
    assert html.status_code == 200 and 'text/html' in html.headers['content-type']
    assert 'Synthetic article' in html.text and "default-src 'none'" in html.headers['content-security-policy']
    assert client.get('/v1/web/llms.txt', headers=h('service_consumer')).status_code == 200
    assert 'User-agent:' in client.get('/v1/web/robots-ai', headers=h('service_consumer')).text

    async def change(withdraw=False):
        db = await committed_runtime()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        try:
            data = await call(db, ids['viewer'], 'select hub.article_read($1)', UUID(article['id']))
            if withdraw:
                await call(db, ids['publisher'], "select hub.article_review($1,$2,'withdraw')", UUID(article['id']), data['revision'])
            else:
                await call(db, ids['editor'], 'select hub.article_save($1,$2,$3)', UUID(article['id']), data['revision'], {**body, 'title': {'th': 'Unreviewed replacement'}})
        finally:
            await db.close()
    run(change())
    assert client.get(route, headers=h('service_consumer')).json()['data']['content']['article']['title'] == 'Synthetic article'
    run(change(True))
    hidden = client.get(route, headers={**h('service_consumer'), 'If-None-Match': etag})
    assert hidden.status_code == 200 and hidden.headers['etag'] != etag
    assert hidden.json()['data']['content']['article'] is None
    feed = client.get('/v1/web/changes', headers=h('service_consumer')).json()['data']
    assert any(item['page_key'] == key and item['operation'] == 'visibility' for item in feed['items'])
    # Restore this synthetic source's approval so later composition tests do not
    # inherit an unrelated withdrawn source. Never change a frozen body.
    async def restore():
        db = await disposable_operator()
        try:
            await db.execute("update hub.article_versions set state='APPROVED' where id=$1", UUID(article['version_id']))
            await db.execute('update hub.articles set approved_version_id=$2 where id=$1', UUID(article['id']), UUID(article['version_id']))
        finally:
            await db.close()
    run(restore())


@pytest.mark.parametrize('role', ['viewer', 'editor', 'publisher', 'admin', 'online_staff', 'agency', 'service_consumer', 'pending'])
def test_web_publication_closed_storage_and_special_is_never_inherited(permission_accounts, role):
    client, ids = permission_accounts
    assert client.post('/v1/admin/web/publications/00000000-0000-0000-0000-000000000000/publish', headers=h(role), json={'expected_digest': '0' * 64}).status_code == 403

    async def check():
        db = await runtime()
        try:
            for table in ('web_pages', 'web_publications', 'web_changes'):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids[role], f'select count(*) from hub.{table}')
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids[role], "select hub.web_source('articles','{}')")
        finally:
            await db.close()
    run(check())


def test_web_publication_project_and_brand_composition_compile(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        transaction = db.transaction()
        await transaction.start()
        try:
            projects = await call(db, ids['viewer'], 'select jsonb_agg(public_project_id) from hub.projects where deleted_at is null')
            for project in projects[:2]:
                await call(db, ids['editor'], 'select hub.web_page_save($1,0,$2)', 'project:' + project, config(project_ids=[project]))
            brands = await call(db, ids['viewer'], 'select jsonb_agg(public_brand_id) from hub.brands where deleted_at is null')
            for brand in brands[:1]:
                await call(db, ids['editor'], 'select hub.web_page_save($1,0,$2)', 'brand:' + brand, config())
            batch = await call(db, ids['editor'], 'select hub.web_prepare($1)', 'Synthetic readiness')
            preview = await call(db, ids['viewer'], "select hub.web_publication_read($1,'th')", UUID(batch['id']))
            assert len(preview['pages']) == min(2, len(projects)) + min(1, len(brands))
            brand_page = next(p for p in preview['pages'] if p['page_key'].startswith('brand:'))
            assert {'brand.public_name', 'brand.description'} <= {i.get('field_key') for i in brand_page['issues']}
        finally:
            await transaction.rollback()
            await db.close()
    run(check())


def test_web_publication_read_filters_sql():
    async def check():
        db = await disposable_operator()
        try:
            await db.execute((ROOT / 'supabase/tests/web_publication.sql').read_text(encoding='utf-8'))
        finally:
            await db.close()
    run(check())


def test_web_publication_publishes_submitted_narrative_and_corporate_faq(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            question = 'synthetic_web_' + uuid4().hex
            await call(db, ids['editor'], 'select hub.save_faq_question($1,0,$2)', question, {'topic': 'design', 'default_level': 'corporate', 'question_template': {'th': 'Synthetic contact?'}, 'answer_kind': 'text'})
            await call(db, ids['publisher'], "select hub.approve_faq_question($1,1,'approved')", question)
            faq = await call(db, ids['editor'], 'select hub.save_faq(null,0,$1)', {'question_key': question, 'scope_type': 'corporate', 'scope_id': 'sena', 'question': {'th': 'Synthetic contact?'}, 'short_answer': {'th': 'Contact the synthetic team.'}, 'answer_kind': 'text', 'ai_exposure': 'open'})
            await call(db, ids['editor'], "select hub.save_content_section('corporate','sena','section.corporate_intro',0,$1)", {'body': {'th': 'Synthetic corporate introduction'}, 'ai_exposure': 'open'})
            for scope in (faq['id'], 'sena'):
                translations = await call(db, ids['editor'], "select hub.content_translation_list('knowledge',$1)", scope)
                for t in translations:
                    if t['th_text'].strip() and t['editable'] and t['translation_state'] != 'reviewed':
                        await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)', UUID(t['id']), t['revision'], t['th_version'], t['th_text'])
            current = await call(db, ids['editor'], 'select hub.faq_read($1)', UUID(faq['id']))
            await call(db, ids['editor'], 'select hub.submit_faq($1,$2)', UUID(faq['id']), current['revision'])
            revision = await call(db, ids['editor'], "select revision from hub.content_sections where scope_type='corporate' and scope_id='sena' and section_key='section.corporate_intro'")
            await call(db, ids['editor'], "select hub.submit_content_section('corporate','sena','section.corporate_intro',$1)", revision)
            await call(db, ids['editor'], 'select hub.web_page_save($1,0,$2)', 'corporate:faq', config('/corporate/faq'))
            batch = await call(db, ids['editor'], 'select hub.web_prepare($1)', 'Corporate publication review')
            await set_bit(ids['publisher'], 'knowledge', special_actions=['knowledge.publish_web'])
            await call(db, ids['publisher'], 'select hub.web_publish($1,$2)', UUID(batch['id']), batch['digest'])
            public = await call(db, ids['service_consumer'], "select hub.web_public_page('corporate:faq','en')")
            assert any(item['question_key'] == question for item in public['faq'])
            assert public['content']['sections'][0]['body'] == 'Synthetic corporate introduction'
            assert any(item['@type'] == 'FAQPage' for item in public['json_ld']['@graph'])
            assert (await call(db, ids['viewer'], 'select hub.faq_read($1)', UUID(faq['id'])))['state'] == 'PUBLISHED'
        finally:
            await db.close()
    run(check())


def test_web_publication_concurrent_publish_has_one_winner(permission_accounts):
    _, ids = permission_accounts

    async def connect():
        db = await committed_runtime()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        return db

    async def check():
        db = await connect()
        try:
            _, body = await approved_article(db, ids)
            key = 'article:' + body['slug']
            await call(db, ids['editor'], 'select hub.web_page_save($1,0,$2)', key, config())
            batch = await call(db, ids['editor'], 'select hub.web_prepare($1)', 'Concurrent publication')
            for role in ('publisher', 'second'):
                await set_bit(ids[role], 'knowledge', can_edit=False, can_approve=True, special_actions=['knowledge.publish_web'])

            async def publish(role):
                connection = await connect()
                try:
                    return await call(connection, ids[role], 'select hub.web_publish($1,$2)', UUID(batch['id']), batch['digest'])
                except asyncpg.SerializationError:
                    return 'stale'
                finally:
                    await connection.close()
            results = await asyncio.gather(publish('publisher'), publish('second'))
            assert sum(result == 'stale' for result in results) == 1
            assert sum(isinstance(result, dict) and result['state'] == 'PUBLISHED' for result in results) == 1
            assert len(await call(db, ids['viewer'], 'select hub.web_history($1)', key)) == 1
        finally:
            await db.close()
    run(check())


def test_web_publication_composes_reviewed_types_prices_commercial_and_facility_media(permission_accounts):
    from test_unit_type_workflow import create_type, review_english as unit_english, type_action, save_price, price_action
    from test_project_commercial import save, review, english
    from test_project_media import upload
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            public_id = await call(db, ids['editor'], "select public_project_id from hub.projects where rem_project_id='DEMO-001' and deleted_at is null")
            project = await call(db, ids['editor'], 'select hub.project_detail($1)', public_id)
            unit = await create_type(db, ids['editor'], project)
            await unit_english(db, ids['editor'], public_id, unit['id'])
            await type_action(db, ids['editor'], public_id, unit, 'submit')
            await type_action(db, ids['publisher'], public_id, unit, 'approve')
            price = await save_price(db, ids['editor'], public_id, unit)
            await unit_english(db, ids['editor'], public_id, price['price_id'])
            await price_action(db, ids['editor'], public_id, price, 'submit')
            await price_action(db, ids['publisher'], public_id, price, 'approve')
            for kind in ('disclosures', 'sales-terms', 'programmes', 'construction'):
                record = await save(db, ids['editor'], public_id, kind)
                await english(db, ids['editor'], public_id, record['id'])
                await review(db, ids['editor'], public_id, kind, record['id'], 'submit')
                await review(db, ids['publisher'], public_id, kind, record['id'], 'approve')
            await call(db, ids['editor'], "select hub.c4_facility_save($1,'lobby',0,$2)", public_id, {'status': 'present', 'display_name': {'th': 'Synthetic lobby'}})
            asset = await upload(db, ids['editor'])
            asset = await call(db, ids['editor'], 'select hub.media_save_asset($1,$2,0,$3)', public_id, UUID(asset['id']), {'media_category': 'facility', 'metadata_state': 'confirmed', 'marketing_publication': True, 'ai_exposure': 'open', 'caption': {'th': 'Synthetic lobby photo'}, 'alt_text': {'th': 'Synthetic lobby'}})
            await call(db, ids['editor'], 'select hub.media_link_save($1,$2,0,$3)', public_id, uuid4(), {'asset_id': asset['id'], 'target_type': 'facility', 'target_key': 'lobby', 'ai_exposure': 'open', 'is_primary': True})
            asset = await call(db, ids['publisher'], 'select hub.asset_detail($1)', UUID(asset['id']))
            await call(db, ids['publisher'], "select hub.review_asset($1,$2,'approved','Synthetic rights',null,null,'Synthetic review')", UUID(asset['id']), datetime.fromisoformat(asset['updated_at']))
            await call(db, ids['editor'], 'select hub.media_clip_save($1,$2,0,$3)', public_id, uuid4(), {'provider': 'youtube', 'kind': 'review', 'url': 'https://www.youtube.com/watch?v=synthetic', 'title': {'th': 'Synthetic clip'}, 'owner_type': 'sena_owned', 'ai_exposure': 'open', 'targets': []})
            await call(db, ids['editor'], 'select hub.web_page_save($1,0,$2)', 'project:synthetic-rich', config(project_ids=[public_id]))
            batch = await call(db, ids['editor'], 'select hub.web_prepare($1)', 'Rich source review')
            data = await call(db, ids['viewer'], "select hub.web_publication_read($1,'th')", UUID(batch['id']))
            await set_bit(ids['publisher'], 'knowledge', special_actions=['knowledge.publish_web'])
            await set_bit(ids['publisher'], 'projects', can_approve=False)
            assert not (await call(db, ids['publisher'], "select hub.web_publication_read($1,'th')", UUID(batch['id'])))['can_publish']
            result = next(p for p in data['pages'] if p['page_key'] == 'project:synthetic-rich')['preview']['content']['phases'][0]
            assert result['unit_types'] and result['prices'] and result['disclosures'] and result['sales_terms'] and result['programmes'] and result['construction']
            from sena_hub_api.web_publication import reviewed_preview
            rendered = reviewed_preview(data)
            html = next(p for p in rendered['pages'] if p['page_key'] == 'project:synthetic-rich')['html']
            assert f'/api/hub/v1/admin/assets/{asset["id"]}/file' in html
            assert 'preview_assets' not in rendered['pages'][0]
            lobby = next(f for f in result['facilities'] if f['code'] == 'lobby')
            assert lobby['status'] == 'present' and lobby['photos'][0]['is_primary'] is True
            assert result['videos'][0]['title'] == 'Synthetic clip'
            assert not {'legal_document_asset_id', 'legal_doc_ref', 'legal_reviewed_by', 'override_reason'} & result['disclosures'][0].keys()
            assert str(asset['id']) not in json.dumps(result) and 'DEMO-001' not in json.dumps(result)
        finally:
            await db.close()
    run(check())
