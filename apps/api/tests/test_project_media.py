"""Media SQL/API boundaries exercised under the non-superuser runtime."""
import asyncio
import io
import json
from uuid import UUID, uuid4

import asyncpg
import pytest
from PIL import Image

from sena_hub_api.assets import prepare_upload
from test_permission_content import call, set_bit
from test_permission_foundations import permission_accounts, h
from test_project_content_core import runtime
from test_permission_baseline import disposable_operator
from test_permission_db_baseline import runtime as unscoped_runtime


async def upload(db, actor):
    stream = io.BytesIO()
    Image.new('RGB', (8, 8), (uuid4().int % 255, 80, 90)).save(stream, 'PNG')
    _, metadata = prepare_upload(stream.getvalue(), 'image/png', 'synthetic-media.png')
    result = await call(db, actor, 'select hub.register_uploaded_asset($1)', metadata)
    return result['asset']


def test_media_metadata_vocabulary_links_coverage_and_revision(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            public_id = await call(db, ids['editor'], 'select public_project_id from hub.projects order by id limit 1')
            workspace = await call(db, ids['editor'], 'select hub.project_media($1)', public_id)
            assert workspace['tags'] and len(workspace['requirements']) == 17
            assert {r['rule_key'] for r in workspace['requirements'] if r['blocks_publish']} == {'hero', 'thumbnail'}
            asset = await upload(db, ids['editor'])
            asset_id = UUID(asset['id'])
            body = {'media_category': 'interior', 'caption': {'th': 'ภาพทดสอบ', 'en': 'Test image'}, 'alt_text': {'th': 'ห้องนั่งเล่น'},
                    'tags': ['living_room'], 'metadata_state': 'confirmed', 'ai_exposure': 'open', 'marketing_publication': True}
            save = 'select hub.media_save_asset($1,$2,$3,$4)'
            saved = await call(db, ids['editor'], save, public_id, asset_id, 0, body)
            assert saved['media_revision'] == 1 and saved['rights_status'] == asset['rights_status']
            assert saved['people'] == 'unknown' and saved['tags'] == ['living_room']
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], save, public_id, asset_id, 0, body)
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], save, public_id, asset_id, 1, {'tags': ['missing_tag']})
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], save, public_id, asset_id, 1, {'media_category': 'map'})
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], save, public_id, asset_id, 1, {'ai_suggestion': {'media_category': 'exterior'}})
            link_id = uuid4()
            link = await call(db, ids['editor'], 'select hub.media_link_save($1,$2,0,$3)', public_id, link_id,
                              {'asset_id': asset['id'], 'target_type': 'project', 'target_key': workspace['project']['id']})
            assert link['revision'] == 1
            assert await call(db, ids['viewer'], 'select hub.can_read_asset($1)', asset_id)
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], 'select hub.media_link_remove($1,$2,0)', public_id, link_id)
            await call(db, ids['editor'], 'select hub.media_link_remove($1,$2,1)', public_id, link_id)
            assert not await call(db, ids['editor'], 'select hub.can_read_asset($1)', asset_id), 'Unlink must not restore uploader exception'
        finally:
            await db.close()
    asyncio.run(check())


def test_media_tag_approval_rules_and_facility_cover(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            project = await call(db, ids['editor'], 'select public_project_id from hub.projects order by id limit 1')
            workspace = await call(db, ids['editor'], 'select hub.project_media($1)', project)
            code = 'media_' + uuid4().hex[:12]
            proposed = await call(db, ids['editor'], 'select hub.media_tag_save($1,0,$2)', code,
                                  {'label': {'th': 'มุมอ่านหนังสือ', 'en': 'Reading area'}, 'tag_group': 'room', 'allowed_categories': ['interior']})
            assert proposed['status'] == 'proposed'
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], "select hub.media_tag_approve($1,1,'active')", code)
            assert (await call(db, ids['publisher'], "select hub.media_tag_approve($1,1,'active')", code))['status'] == 'active'
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['publisher'], "select hub.media_requirement_save('building_plan',1,$1)", {'blocks_publish': True})
            assert (await call(db, ids['publisher'], "select hub.media_requirement_save('map',1,$1)", {'target_count': 5}))['target_count'] == 5
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], "select hub.media_requirement_save('map',2,$1)", {'target_count': 6})
            # The current project facility is required; a fabricated target is denied.
            first = await upload(db, ids['editor'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], 'select hub.media_link_save($1,$2,0,$3)', project, uuid4(),
                           {'asset_id': first['id'], 'target_type': 'facility', 'target_key': 'fabricated'})
            # Project context is still a valid positive neighbor.
            await call(db, ids['editor'], 'select hub.media_link_save($1,$2,0,$3)', project, uuid4(),
                       {'asset_id': first['id'], 'target_type': 'project', 'target_key': workspace['project']['id']})
        finally:
            await db.close()
    asyncio.run(check())


def test_legal_media_private_and_never_sent_to_worker_or_legacy_binding(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            project = await call(db, ids['editor'], 'select public_project_id from hub.projects order by id limit 1')
            workspace = await call(db, ids['editor'], 'select hub.project_media($1)', project)
            asset = await upload(db, ids['editor'])
            asset_id = UUID(asset['id'])
            legal = await call(db, ids['editor'], 'select hub.media_save_asset($1,$2,0,$3)', project, asset_id,
                               {'media_category': 'legal_document', 'ai_exposure': 'internal', 'alt_text': {'th': 'เอกสารทดสอบ'}})
            assert legal['media_revision'] == 1
            assert not await call(db, ids['viewer'], 'select hub.can_read_asset($1)', asset_id)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], "select hub.media_job_request($1,'image_suggestion',$2,1)", project, asset_id)
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], 'select hub.media_save_asset($1,$2,1,$3)', project, asset_id, {'media_category': 'exterior'})
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], "select hub.bind_project_asset($1,$2,'hero',$3,$4)", UUID(workspace['project']['id']), asset_id,
                           {'th': 'ภาพทดสอบ'}, __import__('datetime').datetime.fromisoformat(workspace['project']['updated_at']))
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], 'select hub.media_link_save($1,$2,0,$3)', project, uuid4(),
                           {'asset_id': asset['id'], 'target_type': 'project', 'target_key': workspace['project']['id']})
        finally:
            await db.close()
    asyncio.run(check())


def test_media_clips_preserve_editor_text_hide_broken_and_validate_targets(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            project = await call(db, ids['editor'], 'select public_project_id from hub.projects order by id limit 1')
            clip_id = uuid4()
            body = {'provider': 'tiktok', 'kind': 'walkthrough', 'url': 'https://www.tiktok.com/@synthetic/video/1234567890123456789',
                    'title': {'th': 'คลิปทดสอบ'}, 'owner_type': 'sena_owned', 'ai_exposure': 'open'}
            clip = await call(db, ids['editor'], 'select hub.media_clip_save($1,$2,0,$3)', project, clip_id, body)
            assert clip['revision'] == 1
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], 'select hub.media_clip_save($1,$2,1,$3)', project, clip_id, {'url': 'https://www.tiktok.com.attacker.invalid/video/123'})
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], 'select hub.media_clip_save($1,$2,1,$3)', project, clip_id, {'provider_metadata': {'title': 'forged'}})
            checked = await call(db, ids['editor'], "select hub.media_clip_check($1,$2,1,'broken')", project, clip_id)
            assert checked['title'] == body['title'] and checked['checked_at']
            workspace = await call(db, ids['viewer'], 'select hub.project_media($1)', project)
            assert next(c for c in workspace['clips'] if c['id'] == str(clip_id))['visible'] is False
            assert any(c['id'] == str(clip_id) for c in workspace['checklist']['broken_links'])
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], "select hub.media_clip_check($1,$2,1,'ok')", project, clip_id)
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('actor', ['viewer', 'publisher', 'pending', 'agency', 'service_consumer'])
def test_media_draft_commands_fail_closed(permission_accounts, actor):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            for sql, args in [
                ('select hub.media_save_asset($1,$2,0,$3)', ('absent', uuid4(), {})),
                ('select hub.media_link_save($1,$2,0,$3)', ('absent', uuid4(), {})),
                ('select hub.media_link_remove($1,$2,1)', ('absent', uuid4())),
                ('select hub.media_clip_save($1,$2,0,$3)', ('absent', uuid4(), {})),
                ("select hub.media_clip_check($1,$2,1,'ok')", ('absent', uuid4())),
                ("select hub.media_job_request($1,'clip_check',$2,1)", ('absent', uuid4())),
                ("select hub.media_tag_save('denied',0,$1)", ({},)),
            ]:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids[actor], sql, *args)
        finally:
            await db.close()
    asyncio.run(check())


def test_media_api_revocation_keeps_neighbor_access(permission_accounts):
    client, ids = permission_accounts
    projects = client.get('/v1/admin/projects', headers=h('editor')).json()['data']
    project = projects[0]['public_project_id']
    assert client.get(f'/v1/admin/projects/{project}/media', headers=h('editor')).status_code == 200
    asyncio.run(set_bit(ids['editor'], 'projects', can_edit=False, can_view=False))
    try:
        assert client.get(f'/v1/admin/projects/{project}/media', headers=h('editor')).status_code == 403
        assert client.get('/v1/admin/media/tags', headers=h('editor')).status_code == 403
        assert client.get('/v1/admin/brands', headers=h('editor')).status_code == 200
    finally:
        asyncio.run(set_bit(ids['editor'], 'projects', can_view=True, can_edit=True))


def test_competing_new_clips_cannot_overwrite_revision_zero(permission_accounts):
    _, ids = permission_accounts

    async def check():
        first, second = await unscoped_runtime(), await unscoped_runtime()
        clip_id = uuid4()
        pending = None
        try:
            for db in (first, second):
                await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
            project = await call(first, ids['editor'], 'select public_project_id from hub.projects order by id limit 1')
            body = {'provider': 'youtube', 'kind': 'walkthrough', 'url': 'https://youtu.be/abcdefghijk', 'owner_type': 'sena_owned'}
            tx = first.transaction()
            await tx.start()
            await call(first, ids['editor'], 'select hub.media_clip_save($1,$2,0,$3)', project, clip_id, body)
            pending = asyncio.create_task(call(second, ids['editor'], 'select hub.media_clip_save($1,$2,0,$3)', project, clip_id, {**body, 'title': {'th': 'Competing title'}}))
            await asyncio.sleep(0.2)
            assert not pending.done(), 'The competing create must wait for the first transaction'
            await tx.commit()
            with pytest.raises(asyncpg.SerializationError):
                await asyncio.wait_for(pending, 5)
            assert await call(first, ids['editor'], 'select title from hub.media_links where id=$1', clip_id) == {}
        finally:
            if pending and not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
            await first.close()
            await second.close()
            operator = await disposable_operator()
            try:
                await operator.execute('delete from hub.media_links where id=$1', clip_id)
            finally:
                await operator.close()
    asyncio.run(check())


def test_promotion_media_clamps_dates_and_requires_every_source_edit(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await disposable_operator()
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        tx = db.transaction()
        await tx.start()
        try:
            project = await db.fetchrow('select id,public_project_id from hub.projects order by id limit 1')
            promo = await db.fetchrow("insert into hub.public_promotions(project_id,code,benefit_type,starts_at,ends_at,created_by,updated_by) values($1,$2,'gift',now()-interval '1 day',now()+interval '10 days',$3,$3) returning id,starts_at,ends_at", project['id'], 'MEDIA_' + uuid4().hex.upper(), ids['editor'])
            asset = await upload(db, ids['editor'])
            link = await call(db, ids['editor'], 'select hub.media_link_save($1,$2,0,$3)', project['public_project_id'], uuid4(),
                              {'asset_id': asset['id'], 'target_type': 'promotion', 'target_key': str(promo['id']), 'usage': 'banner', 'effective_from': '2020-01-01T00:00:00Z', 'effective_to': '2090-01-01T00:00:00Z'})
            from datetime import datetime
            assert datetime.fromisoformat(link['effective_from']) == promo['starts_at']
            assert datetime.fromisoformat(link['effective_to']) == promo['ends_at']
            clip_id = uuid4()
            clip = {'provider': 'youtube', 'kind': 'ad', 'url': 'https://youtu.be/abcdefghijk', 'owner_type': 'sena_owned', 'targets': [{'target_type': 'promotion', 'target_key': str(promo['id'])}]}
            await call(db, ids['editor'], 'select hub.media_clip_save($1,$2,0,$3)', project['public_project_id'], clip_id, clip)
            await db.execute('SET LOCAL ROLE postgres')
            await db.execute("update hub.account_permission set can_edit=false where account_id=$1 and tab='promotions'", ids['editor'])
            for sql, args in [
                ('select hub.media_clip_save($1,$2,1,$3)', (project['public_project_id'], clip_id, {'title': {'th': 'Denied edit'}})),
                ("select hub.media_clip_check($1,$2,1,'ok')", (project['public_project_id'], clip_id)),
                ("select hub.media_job_request($1,'clip_metadata',$2,1)", (project['public_project_id'], clip_id)),
                ('select hub.media_save_asset($1,$2,0,$3)', (project['public_project_id'], UUID(asset['id']), {'media_category': 'promotion_ad'})),
            ]:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['editor'], sql, *args)
            clip['targets'] = []
            assert await call(db, ids['editor'], 'select hub.media_clip_save($1,$2,0,$3)', project['public_project_id'], uuid4(), clip)
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())
