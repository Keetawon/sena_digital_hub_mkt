"""Owner-review defaults and bounded private summary under real source guards."""
import json
from uuid import UUID, uuid4

import asyncpg
import pytest

from sena_hub_api.content_workflow import publication_targets
from test_content_workspace import setup_project, candidate_fixture, run
from test_faq_intake import app, rolled_back
from test_permission_foundations import permission_accounts  # noqa: F401


@pytest.mark.parametrize(('kind', 'field'), [
    ('description', 'section.project_intro'), ('concept', 'section.concept_detail'),
    ('concept_name', 'section.concept_name'),
])
@pytest.mark.parametrize('exposure', ['open', 'web_only', 'internal'])
def test_suggestion_permission_uses_exact_registry_default_and_keeps_old_versions(permission_accounts, kind, field, exposure):
    _, actors = permission_accounts

    async def check():
        projects = await setup_project(actors['editor'], count=2)
        candidate = await candidate_fixture(projects, kind=kind)
        ref = projects[0]['public_project_id']
        async with rolled_back() as db:
            await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
            await db.execute("update hub.field_catalog set default_ai_exposure=$2 where field_key=$1", field, exposure)
            saved = await app(db, actors['editor'], "select hub.save_content_section('project',$1,$2,0,$3)",
                              ref, field, {'body': {'th': 'Earlier private text', 'en': 'Keep English'}, 'ai_exposure': 'internal'})
            old_version = await db.fetchval('select to_jsonb(v) from hub.content_section_versions v where id=$1', UUID(saved['version']['id']))
            other = await app(db, actors['editor'], "select hub.save_content_section('project',$1,$2,0,$3)",
                              projects[1]['public_project_id'], field, {'body': {'th': 'Unaffected draft'}, 'ai_exposure': 'internal'})
            other_before = await app(db, actors['viewer'], 'select hub.project_content_sections($1)', projects[1]['public_project_id'])
            source = await app(db, actors['viewer'], 'select hub.website_content_sources($1)', ref)
            assert next(item for item in source if item['id'] == str(candidate))['default_ai_exposure'] == exposure
            sql = 'select hub.website_text_decide($1,$2,$3,$4,$5,$6,null)'
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await app(db, actors['viewer'], sql, ref, candidate, None, 'use', saved['revision'], {})
            used = await app(db, actors['editor'], sql, ref, candidate, None, 'use', saved['revision'], {})
            assert used['saved']['version']['ai_exposure'] == exposure
            assert used['saved']['version']['state'] == 'DRAFT'
            assert used['saved']['version']['body']['en'] == 'Keep English'
            if exposure != 'open':
                with pytest.raises(asyncpg.CheckViolationError, match='cannot exceed'):
                    await app(db, actors['editor'], sql, ref, candidate, int(used['decision_id']), 'edit_use', used['saved']['revision'],
                              {'body': {'th': 'Forged exposure'}, 'ai_exposure': 'open'})
            edited = await app(db, actors['editor'], sql, ref, candidate, int(used['decision_id']), 'edit_use', used['saved']['revision'],
                               {'body': {'th': 'User edited narrative'}, 'ai_exposure': 'internal'})
            assert edited['saved']['version']['ai_exposure'] == exposure
            assert edited['saved']['version']['state'] == 'DRAFT'
            assert await db.fetchval('select to_jsonb(v) from hub.content_section_versions v where id=$1', UUID(saved['version']['id'])) == old_version
            assert await app(db, actors['viewer'], 'select hub.project_content_sections($1)', projects[1]['public_project_id']) == other_before
            target = {'id': edited['saved']['id']}
            metadata = await app(db, actors['viewer'], "select hub.content_workflow_read('section',$1)", target)
            assert metadata['ai_exposure'] == exposure
            assert metadata['exposure_target']['field'] == 'ai_exposure'
            assert metadata['exposure_target']['item'] == target['id']
            assert 'version' not in metadata['exposure_target']
            assert metadata['can_submit'] is False
            included = await db.fetchval('select hub.publication_item_descriptor($1)', {
                '_item': True, 'field_key': field, 'dependencies': [
                    {'table': 'content_sections', 'identity': {'id': target['id']}},
                    {'table': 'content_section_versions', 'identity': {'id': saved['version']['id']}},
                ],
            })
            assert included['ai_exposure'] == 'internal', 'Included old version must not borrow the new draft exposure'
            with pytest.raises(asyncpg.NoDataFoundError):
                await app(db, actors['service_consumer'], "select hub.web_public_page($1,'th')", 'project:' + ref)
            page = await app(db, actors['viewer'], "select hub.workspace_page('project',$1,null)", ref)
            assert next(item for item in page['sections'] if item['key'] == field)['ai_exposure'] == exposure
            assert len(page['overview']['changes_since_publication']) <= 5
            for signature in ('hub.content_exposure(text,jsonb,jsonb,boolean)', 'hub.workspace_item_context(uuid,jsonb)'):
                assert not await db.fetchval("select has_function_privilege('hub_app',$1,'execute')", signature)
    run(check())


def test_media_exposure_inherits_only_the_exact_parent_and_saves_with_existing_guards(permission_accounts):
    from test_content_workflow import inventory_asset_fixture, inventory_brand_fixture, approve_item
    from test_unit_type_workflow import create_type
    _, actors = permission_accounts

    async def check():
        project = (await setup_project(actors['editor']))[0]
        ref = project['public_project_id']
        async with rolled_back() as db:
            await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
            asset = await inventory_asset_fixture(db, actors['editor'])
            other = await inventory_asset_fixture(db, actors['editor'])
            brand = await inventory_brand_fixture(db, actors['editor'])
            detail = await app(db, actors['editor'], 'select hub.project_detail($1)', ref)
            unit = await create_type(db, actors['editor'], detail)
            project_binding = await db.fetchval("insert into hub.entity_assets(project_id,asset_id,asset_role,is_primary) values($1,$2,'hero',false) returning id", project['id'], UUID(asset['id']))
            brand_binding = await db.fetchval("insert into hub.brand_assets(brand_id,asset_id,asset_role,is_primary) values($1,$2,'logo_primary',false) returning id", brand['id'], UUID(asset['id']))
            type_binding = await db.fetchval("insert into hub.commercial_type_assets(project_id,commercial_type_id,asset_id,asset_role,alt_text,title,display_order) values($1,$2,$3,'model_image','{}','Synthetic binding',0) returning id", project['id'], UUID(unit['id']), UUID(asset['id']))
            context = await app(db, actors['editor'], 'select hub.media_link_save($1,$2,0,$3)', ref, uuid4(),
                                {'asset_id': asset['id'], 'target_type': 'project', 'target_key': str(project['id']), 'ai_exposure': 'web_only'})
            clip = await app(db, actors['editor'], 'select hub.media_clip_save($1,$2,0,$3)', ref, uuid4(),
                             {'provider': 'tiktok', 'kind': 'walkthrough', 'url': 'https://www.tiktok.com/@synthetic/video/1234567890123456789',
                              'title': {'th': 'Synthetic clip'}, 'owner_type': 'sena_owned', 'ai_exposure': 'web_only',
                              'targets': [{'target_type': 'project', 'target_key': str(project['id'])}]})
            clip_target = await db.fetchval('select id from hub.media_link_targets where media_link_id=$1', UUID(clip['id']))
            for exposure in ('internal', 'web_only', 'open'):
                await db.execute('update hub.assets set ai_exposure=$2 where id=$1', UUID(asset['id']), exposure)
                for kind, binding in [('project_asset', project_binding), ('brand_asset', brand_binding), ('type_asset', type_binding)]:
                    result = await app(db, actors['viewer'], 'select hub.content_workflow_read($1,$2)', kind, {'id': str(binding)})
                    assert result['ai_exposure'] == exposure
                    assert result['exposure_editor'] == {'kind': 'asset', 'identity': {'id': asset['id']}}
                result = await app(db, actors['viewer'], "select hub.content_workflow_read('asset_context',$1)", {'id': context['id']})
                assert result['ai_exposure'] == 'web_only', 'Context owns a separate setting'
                result = await app(db, actors['viewer'], "select hub.content_workflow_read('media_target',$1)", {'id': str(clip_target)})
                assert result['ai_exposure'] == 'web_only' and result['exposure_editor']['identity']['id'] == clip['id']

            await db.execute("update hub.assets set ai_exposure='internal' where id=$1", UUID(asset['id']))
            await approve_item(db, actors, 'asset', {'id': asset['id']})
            await approve_item(db, actors, 'project_asset', {'id': str(project_binding)})
            dependencies = [await db.fetchval('select hub.web_dependency($1,$2,$3)', table, {'id': str(identity)}, 'projects')
                            for table, identity in [('entity_assets', project_binding), ('assets', asset['id'])]]
            before = await db.fetchval('select to_jsonb(a) from hub.assets a where id=$1', UUID(other['id']))
            target = {'id': asset['id']}
            snapshot = await app(db, actors['editor'], "select hub.content_workflow_read('asset',$1)", target)
            write = 'select hub.content_workflow_exposure_save($1,$2,$3,$4)'
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await app(db, actors['viewer'], write, 'asset', target, snapshot['expected_hash'], 'open')
            await db.execute("update hub.account_permission set can_edit=false where account_id=$1 and tab='brands'", actors['editor'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await app(db, actors['editor'], write, 'asset', target, snapshot['expected_hash'], 'open')
            await db.execute("update hub.account_permission set can_edit=true where account_id=$1 and tab='brands'", actors['editor'])
            saved = await app(db, actors['editor'], write, 'asset', target, snapshot['expected_hash'], 'open')
            assert saved['ai_exposure'] == 'open' and saved['state'] == 'DRAFT'
            with pytest.raises(asyncpg.SerializationError):
                await app(db, actors['editor'], write, 'asset', target, snapshot['expected_hash'], 'web_only')
            assert await db.fetchval('select to_jsonb(a) from hub.assets a where id=$1', UUID(other['id'])) == before
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await app(db, actors['viewer'], 'select hub.publication_item_descriptor($1)', {'_item': True, 'dependencies': dependencies})
            included = await db.fetchval('select hub.publication_item_descriptor($1)', {'_item': True, 'dependencies': dependencies})
            assert included['ai_exposure'] == 'internal', 'Pinned binding must retain its old parent exposure'
            assert included['exposure_editor'] == {'kind': 'asset', 'identity': target}

            for kind, identity in [('asset_context', context['id']), ('media_link', clip['id'])]:
                snapshot = await app(db, actors['editor'], 'select hub.content_workflow_read($1,$2)', kind, {'id': identity})
                saved = await app(db, actors['editor'], write, kind, {'id': identity}, snapshot['expected_hash'], 'internal')
                assert saved['ai_exposure'] == 'internal' and saved['state'] == 'DRAFT'
            await db.execute("update hub.assets set media_category='legal_document',ai_exposure='internal' where id=$1", UUID(other['id']))
            target = {'id': other['id']}
            snapshot = await app(db, actors['editor'], "select hub.content_workflow_read('asset',$1)", target)
            with pytest.raises(asyncpg.CheckViolationError, match='Legal documents'):
                await app(db, actors['editor'], write, 'asset', target, snapshot['expected_hash'], 'open')
            await db.execute("update hub.assets set media_category='exterior' where id=$1", UUID(other['id']))
            snapshot = await app(db, actors['editor'], "select hub.content_workflow_read('asset',$1)", target)
            submitted = await app(db, actors['editor'], "select hub.content_workflow_submit('asset',$1,$2)", target, snapshot['expected_hash'])
            with pytest.raises(asyncpg.CheckViolationError, match='Submitted content is frozen'):
                await app(db, actors['editor'], write, 'asset', target, submitted['expected_hash'], 'open')
    run(check())


def test_exposure_http_denies_viewer_and_preserves_normal_draft_save(permission_accounts):
    from test_content_workflow import inventory_asset_fixture
    from test_permission_baseline import disposable_operator
    from test_permission_foundations import h
    client, actors = permission_accounts

    async def fixture():
        db = await disposable_operator()
        try:
            await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
            asset = await inventory_asset_fixture(db, actors['editor'])
            await db.execute("select set_config('app.actor_id',$1,false)", str(actors['editor']))
            await db.execute("insert into hub.entity_assets(project_id,asset_id,asset_role,is_primary) select id,$1,'hero',false from hub.projects where deleted_at is null order by id limit 1", UUID(asset['id']))
            return asset
        finally:
            await db.close()

    asset = run(fixture())
    target = {'kind': 'asset', 'identity': {'id': asset['id']}}
    current = client.get('/v1/admin/content-workflow', headers=h('editor'), params={
        'kind': 'asset', 'identity': json.dumps(target['identity']),
    })
    assert current.status_code == 200, current.text
    assert client.get('/v1/admin/content-workflow', headers=h('viewer'), params={
        'kind': 'asset', 'identity': json.dumps(target['identity']),
    }).status_code == 200
    body = {**target, 'expected_hash': current.json()['data']['expected_hash'], 'exposure': 'web_only'}
    assert client.post('/v1/admin/content-workflow/exposure', headers=h('viewer'), json=body).status_code == 403
    result = client.post('/v1/admin/content-workflow/exposure', headers=h('editor'), json=body)
    assert result.status_code == 200, result.text
    assert result.json()['data']['ai_exposure'] == 'web_only' and result.json()['data']['state'] == 'DRAFT'
    assert client.post('/v1/admin/content-workflow/exposure', headers=h('editor'), json=body).status_code == 409
    assert client.post('/v1/admin/content-workflow/exposure', headers=h('editor'), json={**body, 'kind': 'promotion'}).status_code == 422


def test_inactive_registry_cannot_accept_website_suggestion(permission_accounts):
    _, actors = permission_accounts

    async def check():
        projects = await setup_project(actors['editor'])
        candidate = await candidate_fixture(projects)
        async with rolled_back() as db:
            await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
            await db.execute("update hub.field_catalog set status='retired' where field_key='section.project_intro'")
            ref = projects[0]['public_project_id']
            sources = await app(db, actors['editor'], 'select hub.website_content_sources($1)', ref)
            item = next(row for row in sources if row['id'] == str(candidate))
            assert item['default_ai_exposure'] is None and item['can_use'] is False
            with pytest.raises(asyncpg.CheckViolationError, match='Active field exposure'):
                await app(db, actors['editor'], "select hub.website_text_decide($1,$2,null,'use',0,'{}',null)", ref, candidate)
    run(check())


def test_exposure_edit_link_is_encoded_current_editor_not_history():
    source = {'kind': 'section', 'identity': {'id': 'source'}, 'exposure_target': {
        'level': 'project', 'id': 'prj_1', 'tab': 'data', 'section': 'narrative',
        'field': 'ai_exposure', 'item': 'source',
    }}
    result = publication_targets(source)
    assert result['exposure_href'] == '/website/project/prj_1?tab=data&section=narrative&field=ai_exposure&item=source'
    assert 'version=' not in result['exposure_href']


def test_workspace_context_names_repeated_points_without_changing_exact_field_targets(permission_accounts):
    _, actors = permission_accounts

    async def check():
        project = (await setup_project(actors['editor']))[0]
        ref = project['public_project_id']
        async with rolled_back() as db:
            await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
            points = []
            for index in range(2):
                points.append(await app(db, actors['editor'], 'select hub.save_selling_point($1,null,0,$2)', ref,
                                        {'title': {'th': 'Synthetic point'}, 'detail': {'th': 'Synthetic detail'}, 'sort': index}))
            await app(db, actors['editor'], "select hub.save_project_building($1,'A',0,$2)", ref,
                      {'name': {'th': 'Synthetic building A'}, 'floors_above': 10, 'skip_floors': []})
            page = await app(db, actors['viewer'], "select hub.workspace_page('project',$1,null)", ref)
            entries = page['overview']['readiness']['required'] + page['overview']['readiness']['recommended']
            for index, point in enumerate(points):
                gaps = [entry for entry in entries if entry['target'].get('item') == point['point_key']]
                assert gaps
                for gap in gaps:
                    assert gap['context'] == {'kind': 'selling_point', 'label': str(index + 1)}
                    assert gap['target']['field'] == gap['code']
                    assert gap['target']['section'] == 'narrative'
            building_gaps = [entry for entry in entries if entry['target'].get('building') == 'A']
            assert building_gaps
            assert all(entry['context'] == {'kind': 'building', 'label': {'th': 'Synthetic building A'}} for entry in building_gaps)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await app(db, actors['viewer'], "select hub.workspace_item_context($1,'{}')", project['id'])
    run(check())
