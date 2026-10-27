"""Synthetic website evidence: no network, secrets, live AI or hosted data."""
import asyncio
from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest
from PIL import Image, PngImagePlugin

from sena_hub_api.assets import prepare_upload
from test_assets import image_bytes
from test_permission_baseline import disposable_operator
from test_permission_foundations import permission_accounts, h
from test_permission_content import call
from test_permission_db_baseline import runtime

spec = importlib.util.spec_from_file_location('website_content', Path(__file__).resolve().parents[3] / 'scripts/website-content.py')
website = importlib.util.module_from_spec(spec)
spec.loader.exec_module(website)


def source(rem_id):
    return {'source_kind': 'sena_public_website', 'source_remark': website.REMARK, 'page_url': 'https://www.sena.co.th/project/synthetic',
            'fetched_at': '2026-10-27T00:00:00+00:00', 'capture_sha256': 'e' * 64, 'source_project_ids': [rem_id],
            'project_ids': [rem_id], 'confirmed': False}


async def operator():
    db = await disposable_operator()
    await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
    return db


async def project_fixture(db, actor):
    rem_id = 'WEB_' + uuid4().hex[:12]
    await db.execute('''INSERT INTO staging.rem_projects SELECT (jsonb_populate_record(NULL::staging.rem_projects,
        (SELECT to_jsonb(r) FROM staging.rem_projects r LIMIT 1)||jsonb_build_object('rem_project_id',$1::text,
        'project_name_rem','โครงการเว็บไซต์จำลอง','is_deleted',false))).*''', rem_id)
    await db.execute("SELECT set_config('app.actor_id',$1,false)", str(actor))
    identity = await db.fetchval('SELECT hub.create_project_from_rem($1)', rem_id)
    return dict(await db.fetchrow('SELECT * FROM hub.projects WHERE id=$1', identity))


def asset_fixture(rem_id):
    with Image.open(io.BytesIO(image_bytes())) as image:
        info = PngImagePlugin.PngInfo(); info.add_text('synthetic', uuid4().hex)
        output = io.BytesIO(); image.save(output, format='PNG', pnginfo=info)
    _, metadata = prepare_upload(output.getvalue(), 'image/png', 'synthetic-website.png')
    position = {'media_category': 'interior', 'tags': ['living_room'], 'image_kind': None,
                'positions': [{'page_url': source(rem_id)['page_url'], 'project_ids': [rem_id],
                               'label': 'ห้องนั่งเล่น', 'context': {}}], 'confirmed': False}
    return {'sha256': metadata['checksum'], 'metadata': metadata, 'project_ids': [rem_id],
            'page_position': position, 'fetched_at': [source(rem_id)['fetched_at']]}


def test_website_position_and_labelled_values_do_not_invent_confirmation():
    tags = [{'code': 'living_room', 'label': {'th': 'ห้องนั่งเล่น'}, 'status': 'active', 'allowed_categories': ['interior']}]
    suggestion = website.position_suggestion({'url': 'https://www.sena.co.th/interior.webp', 'section': 'unit_type_gallery',
        'label': 'ห้องนั่งเล่น', 'type_label': 'A', 'page_url': source('X')['page_url'], 'project_ids': ['0001']}, tags)
    assert suggestion['media_category'] == 'interior' and suggestion['tags'] == ['living_room']
    assert suggestion['context'] == {'type_label': 'A'} and suggestion['confirmed'] is False
    plan = {'url': 'https://www.sena.co.th/masterplan/A-1st.webp', 'section': 'floor_plan', 'label': '1st FLOOR PLAN',
            'gallery_tab': 'Floor Plan', 'page_url': source('X')['page_url'], 'project_ids': ['0001']}
    assert website.position_suggestion(plan, tags)['media_category'] == 'floor_plan'
    assert website.position_suggestion({**plan, 'label': 'Master Plan'}, tags)['media_category'] == 'master_plan'
    assert website.unit_values({'size_text': '30–35 ตร.ม.', 'rooms': [{'label': 'ห้องนอน', 'count_text': '1'}]}) == {
        'area_min_sqm': 30, 'area_max_sqm': 35, 'bedrooms': 1}
    assert website.unit_values({'detail': 'ราคาเริ่มต้น 2.99 ล้านบาท ผ่อน 5,000 บาท'}) == {}
    assert website.contact_value('contacts', {'url': 'mailto:shared@gmail.com'})['channel'] == 'email'
    assert website.contact_value('call_centres', 'Call Center 1775 #35')['value'] == '35'
    assert website.contact_value('contacts', {'url': 'http://127.0.0.1/private'}) is None


def test_website_package_integrity_cleanup_and_exact_scope(tmp_path, monkeypatch):
    monkeypatch.setattr(website, 'ROOT', tmp_path)
    capture = tmp_path / '.local/knowledge-intake/synthetic'; capture.mkdir(parents=True)
    output = io.BytesIO()
    with Image.new('RGB', (640, 360), 'teal') as image:
        image.save(output, format='PNG')
    raw = output.getvalue(); checksum = website.sha(raw)
    (capture / 'original.png').write_bytes(raw)
    page_url = source('0001')['page_url']
    ref = {'url': 'https://www.sena.co.th/images/interior.png', 'page_url': page_url,
           'project_ids': ['0001', 'UNKNOWN'], 'section': 'interior', 'label': 'ห้องนั่งเล่น'}
    pages = [{'url': page_url, 'project_ids': ref['project_ids'], 'fetched_at': source('0001')['fetched_at'],
        'sections': [{'heading': 'แนวคิด', 'text': 'ข้อความสาธารณะจำลอง', 'locator': '#concept'}],
        'website': {'concept': 'แนวคิดจำลอง', 'nearby': [{'heading': 'การเดินทาง', 'text': 'สถานี 500 เมตร'}]}}]
    files = [{'url': ref['url'], 'references': [ref], 'status': 'downloaded', 'sha256': checksum,
        'blob': 'original.png', 'mime': 'image/png', 'bytes': len(raw), 'fetched_at': source('0001')['fetched_at']}]
    for name, data in [('pages.json', pages), ('file-references.json', files), ('video-links.json', [])]:
        website.public.write(capture / name, data)
    manifest = {'contract_version': 'sena-knowledge-preaudit-v1', 'source_evidence': {'manifest_sha256': 'b' * 64},
                'files': {p.name: {'sha256': website.sha(p.read_bytes()), 'bytes': p.stat().st_size} for p in capture.iterdir()}}
    website.public.write(capture / 'manifest.json', manifest)
    digest = website.sha((capture / 'manifest.json').read_bytes())
    business = {'manifest_sha256': 'b' * 64, 'datasets': {'business_projects': [{'record': {'Project ID': '0001', 'REM Project Name': 'จำลอง'}}]}}
    data = website.prepare(capture, digest, business, ['0001'], [])
    assert data['assets'][0]['project_ids'] == ['0001']
    assert data['structured'][0]['source']['source_project_ids'] == ['0001', 'UNKNOWN']
    assert all(row['project_ids'] == ['0001'] and 'needs_phase_decision' in row['holds'] for row in data['candidates'])
    assert data['assets'][0]['page_position']['media_category'] == 'interior'
    assert website.prepare(capture, digest, business, ['0001'], [], [{'sha256': checksum, 'decision': 'excluded', 'reason': 'ui_logo_social_icon_or_sprite'}])['assets'] == []
    package = tmp_path / '.local/website-content-intake/synthetic'; package.mkdir(parents=True)
    website.public.write(package / 'content.json', data)
    content = (package / 'content.json').read_bytes()
    website.public.write(package / 'manifest.json', {'contract_version': website.CONTRACT, 'capture': {'folder': str(capture), 'manifest_sha256': digest},
        'files': {'content.json': {'sha256': website.sha(content), 'bytes': len(content)}}, 'live_ai_calls': 0})
    package_hash = website.sha((package / 'manifest.json').read_bytes())
    assert website.verify_package(package, package_hash)[1] == data
    (capture / 'original.png').write_bytes(raw + b'changed')
    with pytest.raises(ValueError, match='evidence_hash_or_size_mismatch'):
        website.verify_package(package, package_hash)


def test_website_drafts_unknowns_human_preservation_and_exact_replay(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await operator()
        try:
            project = await project_fixture(db, ids['editor'])
            rem_id = project['rem_project_id']
            facility = dict(await db.fetchrow('SELECT * FROM hub.facility_taxonomy WHERE active ORDER BY code LIMIT 1'))
            values = [('concept_name', 'แนวคิดจำลอง'), ('concept', 'รายละเอียดแนวคิดจำลอง'),
                ('facilities', {'name': facility['name_th'], 'location_label': 'ชั้น 5'}),
                ('nearby', {'heading': 'โรงพยาบาล', 'text': 'โรงพยาบาลจำลอง 500 เมตร'}),
                ('contacts', {'url': 'mailto:shared@gmail.com', 'label': 'สำนักงานโครงการ'}),
                ('call_centres', 'Call Center 1775 #35'),
                ('unit_types', {'label': 'แบบ A', 'size_text': '30 ตร.ม.', 'rooms': [{'label': 'ห้องนอน', 'count_text': '1'}]}),
                ('construction', {'component_label': 'งานโครงสร้าง', 'percent_text': '40', 'as_of': None}),
                ('disclosures', {'text': 'รายละเอียดและเงื่อนไขจากต้นทางจำลอง'}),
                ('tours', {'url': 'https://my.matterport.com/show/?m=synthetic', 'label': 'ชมห้อง A'})]
            structured = [{'id': str(uuid4()), 'source_key': 'website-test:' + uuid4().hex,
                           'kind': kind, 'value': value, 'source': source(rem_id)} for kind, value in values]
            asset = asset_fixture(rem_id)
            # Unique content bytes avoid reusing a separate test's human asset.
            from PIL import Image
            import io
            output = io.BytesIO(); Image.new('RGB', (13, 11), (uuid4().int % 255, 73, 111)).save(output, 'PNG')
            _, asset['metadata'] = prepare_upload(output.getvalue(), 'image/png', 'website-test.png')
            asset['sha256'] = asset['metadata']['checksum']
            storage = {asset['sha256']: {'checksum': asset['sha256'], 'verified': True, 'storage_bucket': 'local-originals',
                                        'storage_path': asset['metadata']['storage_path']}}
            data = {'structured': structured, 'assets': [asset], 'candidates': []}
            digest = uuid4().hex * 2
            manifest = {'contract_version': website.CONTRACT, 'capture': {'manifest_sha256': 'e' * 64}}
            async with db.transaction():
                result = await website.import_rows(db, ids['editor'], digest, manifest, data, storage)
            assert result['status'] == 'applied' and result['prices_created'] == result['live_ai_calls'] == 0
            assert result['text_records'] == {'content_sections': 2, 'project_facilities': 1, 'project_places': 1,
                'contacts': 2, 'commercial_types': 1, 'project_progress': 1, 'project_disclosures': 1, 'media_links': 1}
            assert await db.fetchval('SELECT as_of FROM hub.project_progress WHERE project_id=$1', project['id']) is None
            contact = await db.fetchrow("SELECT * FROM hub.contacts WHERE scope_id=$1 AND channel='email'", project['public_project_id'])
            assert contact['shared_mailbox_confirmed'] is False and contact['ai_exposure'] == 'internal'
            place = await db.fetchrow('SELECT * FROM hub.project_places WHERE project_id=$1', project['id'])
            assert place['status'] is place['as_of'] is place['distance_m'] is None and place['show_on_web'] is False
            assert await db.fetchval('SELECT count(*) FROM hub.commercial_type_sources WHERE project_id=$1', project['id']) == 0
            image = await db.fetchrow('SELECT * FROM hub.assets WHERE checksum=$1', asset['sha256'])
            assert image['rights_status'] == 'pending' and image['metadata_state'] == 'needs_review'
            link = await db.fetchrow('SELECT * FROM hub.asset_links WHERE asset_id=$1', image['id'])
            assert link['binding_confirmed'] is False and link['ai_exposure'] == 'internal'
            before = await website.protected_rows(db)
            async with db.transaction():
                replay = await website.import_rows(db, ids['editor'], digest, manifest, data, storage)
            assert replay['status'] == 'already_applied' and before == await website.protected_rows(db)
            preserved = await website.wire_text(db, project, structured[0], [facility])
            assert preserved['outcome'] == 'conflict'
            shared = deepcopy(structured[2]); shared['source']['source_project_ids'].append('OTHER_PHASE')
            assert (await website.wire_text(db, project, shared, [facility]))['reason'] == 'shared_phase_scope_unconfirmed'
            with pytest.raises(asyncpg.CheckViolationError):
                await db.execute("UPDATE hub.project_places SET ai_exposure='open' WHERE id=$1", place['id'])
            with pytest.raises(asyncpg.CheckViolationError):
                await db.execute("UPDATE hub.contacts SET ai_exposure='open' WHERE id=$1", contact['id'])
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('kind', ['disclosures', 'construction'])
def test_imported_commercial_drafts_remain_editable_with_unconfirmed_source(permission_accounts, kind):
    client, ids = permission_accounts

    async def prepare():
        db = await operator()
        try:
            project = await project_fixture(db, ids['editor'])
            value = {'text': 'หลักฐานเว็บไซต์จำลอง'} if kind == 'disclosures' else {'component_label': 'overall', 'percent_text': '42'}
            item = {'kind': kind, 'value': value, 'source': source(project['rem_project_id']), 'source_key': uuid4().hex}
            result = await website.wire_text(db, project, item, [])
            return project['public_project_id'], result['id'], {**item['source'], 'source_value': value}
        finally:
            await db.close()

    public_id, record_id, evidence = asyncio.run(prepare())
    base = f'/v1/admin/projects/{public_id}/commercial'
    record = {'kind': kind, 'ai_exposure': 'internal'}
    record.update({'basis': 'website_import', 'notes': {'th': 'ตรวจร่างต่อโดย Marketing'}} if kind == 'disclosures'
                  else {'component': 'overall', 'percent': 43, 'source': 'website_import', 'as_of': None})
    stamp = client.get(base, headers=h('editor')).json()['data']['project']['updated_at']
    payload = {'updated_at': stamp, 'record': record}
    assert client.post(f'{base}/{kind}', headers=h('editor'), json=payload).status_code == 422
    assert client.put(f'{base}/{kind}/{uuid4()}', headers=h('editor'), json=payload).status_code == 422
    assert client.put(f'{base}/{kind}/{record_id}', headers=h('viewer'), json=payload).status_code == 403
    response = client.put(f'{base}/{kind}/{record_id}', headers=h('editor'), json=payload)
    assert response.status_code == 200, response.text
    saved = client.get(base, headers=h('editor')).json()['data']['records'][kind][0]
    assert saved['website_source'] == evidence and saved['state'] == 'draft'
    assert saved['ai_exposure'] == 'internal' and saved['readiness']['ready'] is False
    assert saved['as_of'] is None if kind == 'construction' else saved['basis'] == 'website_import'
    stamp = response.json()['data']['updated_at']
    assert client.post(f'{base}/{kind}/{record_id}/submit', headers=h('editor'), json={'updated_at': stamp}).status_code == 422
    if kind == 'construction':
        for changes in ({'source': 'mkt'}, {'source': 'construction'}, {'ai_exposure': 'open'}):
            assert client.put(f'{base}/{kind}/{record_id}', headers=h('editor'),
                json={'updated_at': stamp, 'record': {**record, **changes}}).status_code == 422


def test_website_confirmation_permissions_stale_atomicity_and_audit(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await operator()
        client = await runtime()
        await client.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        try:
            project = await project_fixture(db, ids['editor'])
            public_id, rem_id = project['public_project_id'], project['rem_project_id']
            batch = uuid4().hex * 2
            await db.execute('INSERT INTO staging.knowledge_batches(manifest_sha256,manifest) VALUES($1,$2)', batch, {})
            asset = asset_fixture(rem_id)
            storage = {'checksum': asset['sha256'], 'verified': True, 'storage_bucket': 'local-originals', 'storage_path': asset['metadata']['storage_path']}
            await website.register_asset(db, asset, storage, 'e' * 64, batch, {rem_id: project})
            await db.execute('UPDATE hub.assets SET ai_suggestion=$1 WHERE checksum=$2',
                {'media_category': 'interior', 'tags': ['living_room'], 'source_revision': 0}, asset['sha256'])
            queue = await call(client, ids['viewer'], 'SELECT hub.website_media_queue($1,0)', public_id)
            row = queue['items'][0]
            assert row['agreement'] == 1
            payload = {'id': row['id'], 'expected_revision': row['revision'], 'asset_revision': row['asset_revision'],
                'metadata': {'media_category': 'interior', 'tags': ['living_room'], 'image_kind': 'photo'},
                'links': [{'id': link['id'], 'expected_revision': link['revision'], 'changes': {}} for link in row['links']]}
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(client, ids['viewer'], 'SELECT hub.website_media_confirm($1,$2)', public_id, [payload])
            invalid = deepcopy(payload); invalid['metadata']['rights_status'] = 'approved'
            with pytest.raises(asyncpg.CheckViolationError):
                await call(client, ids['editor'], 'SELECT hub.website_media_confirm($1,$2)', public_id, [invalid])
            stale = deepcopy(payload); stale['links'][0]['expected_revision'] += 1
            with pytest.raises(asyncpg.SerializationError):
                await call(client, ids['editor'], 'SELECT hub.website_media_confirm($1,$2)', public_id, [stale])
            assert (await call(client, ids['viewer'], 'SELECT hub.website_media_queue($1,0)', public_id)) == queue
            result = await call(client, ids['editor'], 'SELECT hub.website_media_confirm($1,$2)', public_id, [payload])
            assert result['confirmed'] == [row['id']]
            assert await call(client, ids['editor'], 'SELECT hub.website_media_confirm($1,$2)', public_id, [payload]) == result
            saved = await db.fetchrow('SELECT * FROM hub.assets WHERE id=$1', UUID(row['asset_id']))
            assert saved['rights_status'] == 'pending' and saved['metadata_state'] == 'needs_review'
            assert saved['media_revision'] == row['asset_revision'] + 1
            assert (await call(client, ids['viewer'], 'SELECT hub.website_media_queue($1,0)', public_id))['total'] == 0
            assert await db.fetchval("SELECT count(*) FROM audit.change_log WHERE table_name='hub.website_asset_suggestions' AND after_row->>'id'=$1 AND after_row->>'status'='confirmed'", row['id']) == 1
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(client, ids['editor'], "UPDATE hub.website_asset_suggestions SET status='pending'")
        finally:
            await client.close(); await db.close()
    asyncio.run(check())


def test_website_worker_private_bytes_are_verified_before_resizing():
    import base64
    from sena_hub_api.media_worker import resized_image, MediaError
    raw = image_bytes()
    _, metadata = prepare_upload(raw, 'image/png', 'synthetic.png')
    metadata.update(storage_provider='r2', storage_bucket='r2-test-content', source_system='hub-hosted-test')
    with pytest.raises(MediaError, match='file_unavailable'):
        resized_image(metadata)
    with pytest.raises(MediaError, match='file_unavailable'):
        resized_image(metadata, authorized_reader=lambda _: raw + b'changed')
    image = resized_image(metadata, authorized_reader=lambda _: raw)
    with Image.open(io.BytesIO(base64.b64decode(image.split(',', 1)[1]))) as result:
        assert result.format == 'JPEG' and max(result.size) <= 768


def test_website_worker_approved_scope_usage_and_no_ambiguous_retry(permission_accounts, monkeypatch):
    from sena_hub_api.media_worker import work_once
    from test_media_worker import suggestion
    _, ids = permission_accounts
    monkeypatch.setattr('sena_hub_api.media_worker.resized_image', lambda _: 'data:image/jpeg;base64,c3ludGhldGlj')

    async def check():
        db = await operator()
        transaction = db.transaction(); await transaction.start()
        try:
            project = await project_fixture(db, ids['editor'])
            batch = uuid4().hex * 2
            await db.execute('INSERT INTO staging.knowledge_batches(manifest_sha256,manifest) VALUES($1,$2)', batch, {})
            jobs = []
            for _ in range(2):
                asset = asset_fixture(project['rem_project_id'])
                saved = await website.register_asset(db, asset, {'checksum': asset['sha256'], 'verified': True,
                    'storage_bucket': 'local-originals', 'storage_path': asset['metadata']['storage_path']}, 'e' * 64, batch,
                    {project['rem_project_id']: project})
                identity = UUID(saved['asset_id'])
                await db.fetchval("SELECT hub.media_job_request($1,'image_suggestion',$2,0)", project['public_project_id'], identity)
                jobs.append(await db.fetchval('SELECT id FROM hub.media_jobs WHERE subject_id=$1', identity))

            class Provider:
                model = 'synthetic-no-network'
                last_usage = {'input_tokens': 100, 'output_tokens': 20, 'cached_input_tokens': 10}
                calls = 0

                async def suggest(self, image, context):
                    self.calls += 1
                    assert 'chosen_category' not in context, 'AI must not be biased by the page-position suggestion'
                    return suggestion()

            provider = Provider()
            result = await work_once(db, provider, approved_job_ids=[jobs[1]])
            assert result['status'] == 'done' and result['job_id'] == str(jobs[1])
            assert result['usage'] == provider.last_usage and provider.calls == 1
            await db.execute('SET LOCAL ROLE postgres')
            assert await db.fetchval('SELECT provider_usage FROM hub.media_jobs WHERE id=$1', jobs[1]) == provider.last_usage
            assert await db.fetchval('SELECT status FROM hub.media_jobs WHERE id=$1', jobs[0]) == 'queued'
            assert (await work_once(db, provider, approved_job_ids=[jobs[1]]))['status'] == 'idle'
            await db.execute('SET LOCAL ROLE postgres')
            await db.execute("UPDATE hub.media_jobs SET status='running',attempts=1,lease_token=$2,lease_expires=now()-interval '1 minute' WHERE id=$1", jobs[0], uuid4())
            assert (await work_once(db, provider, approved_job_ids=[jobs[0]]))['status'] == 'idle'
            await db.execute('SET LOCAL ROLE postgres')
            assert await db.fetchval('SELECT status FROM hub.media_jobs WHERE id=$1', jobs[0]) == 'failed'
            assert provider.calls == 1
            with pytest.raises(asyncpg.CheckViolationError):
                async with db.transaction():
                    await work_once(db, provider, approved_job_ids=[])
            for sql in ('SELECT hub.website_media_claim($1)', 'SELECT hub.website_media_finish(null,null,null,null,null,null)'):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['editor'], sql, *([jobs] if '$1' in sql else []))
        finally:
            await transaction.rollback(); await db.close()
    asyncio.run(check())
