"""No live providers: structured suggestions, fixed destinations and leased SQL."""
import asyncio
import base64
import hashlib
import io
import json
from uuid import UUID, uuid4

import httpx
import pytest
import asyncpg
from PIL import Image, PngImagePlugin

from sena_hub_api import assets
from sena_hub_api.upload_pipeline import prepare_authorized_upload
from upload_optimization_fixtures import xmp_packet

from sena_hub_api.media_worker import MediaError, clip_identity, fetch_clip_metadata, resized_image, validate_suggestion, work_once
from test_permission_baseline import disposable_operator
from test_permission_foundations import permission_accounts
from test_permission_content import call
from test_project_content_core import runtime


def suggestion():
    return {'media_category': 'exterior', 'tags': ['day'], 'proposed_tags': [], 'caption': {'th': 'ภาพโครงการ', 'en': 'Project image'},
            'alt_text': {'th': 'ภายนอกโครงการ', 'en': 'Project exterior'}, 'image_kind': 'photo', 'people': 'unknown',
            'third_party_marks': 'unknown', 'sensitive_content': False, 'confidence': 0.6}


def test_image_suggestion_rejects_unknown_vocabulary_and_sensitive_output():
    context = {'categories': ['exterior'], 'tags': [{'code': 'day', 'allowed_categories': []}]}
    assert validate_suggestion(suggestion(), context)['people'] == 'unknown'
    for delta in ({'tags': ['unapproved']}, {'media_category': 'legal_document'}, {'sensitive_content': True},
                  {'confidence': 2}, {'caption': {'th': 'x' * 2001, 'en': ''}}, {'extra': 'untrusted'}):
        with pytest.raises(MediaError, match='invalid_result'):
            validate_suggestion({**suggestion(), **delta}, context)
    for mime in ('application/pdf', 'text/plain'):
        with pytest.raises(MediaError, match='file_unavailable'):
            resized_image({'mime_type': mime})


@pytest.mark.parametrize('url', [
    'http://www.youtube.com/watch?v=abcdefghijk', 'https://user:secret@www.youtube.com/watch?v=abcdefghijk',
    'https://www.youtube.com.attacker.invalid/watch?v=abcdefghijk', 'https://127.0.0.1/watch?v=abcdefghijk',
    'https://www.youtube.com:9443/watch?v=abcdefghijk', 'https://www.youtube.com/redirect?v=abcdefghijk',
])
def test_provider_identity_rejects_arbitrary_destinations(url):
    with pytest.raises(MediaError):
        clip_identity('youtube', url)


def test_provider_metadata_uses_only_fixed_endpoint_discards_html_and_never_follows_redirect():
    seen = []

    def respond(request):
        seen.append(request)
        assert request.url.host == 'www.youtube.com' and request.url.path == '/oembed'
        return httpx.Response(200, json={'type': 'video', 'title': 'Synthetic tour', 'author_name': 'Synthetic channel',
                                      'html': '<script>untrusted()</script>', 'thumbnail_url': 'http://127.0.0.1/private'})
    value = asyncio.run(fetch_clip_metadata('youtube', 'https://youtu.be/abcdefghijk', transport=httpx.MockTransport(respond)))
    assert value == {'link_status': 'ok', 'title': {'th': 'Synthetic tour'}, 'channel_name': {'th': 'Synthetic channel'},
                     'external_id': 'abcdefghijk', 'embed_url': 'https://www.youtube.com/embed/abcdefghijk'}
    assert len(seen) == 1
    for status, expected in [(403, 'private'), (404, 'removed'), (410, 'removed')]:
        result = asyncio.run(fetch_clip_metadata('youtube', 'https://youtu.be/abcdefghijk', transport=httpx.MockTransport(lambda _: httpx.Response(status))))
        assert result['link_status'] == expected
    for status in (302, 429, 503):
        with pytest.raises(MediaError, match='provider_error'):
            asyncio.run(fetch_clip_metadata('youtube', 'https://youtu.be/abcdefghijk', transport=httpx.MockTransport(lambda _: httpx.Response(status, headers={'location': 'http://127.0.0.1/private'}))))
    with pytest.raises(MediaError, match='manual_required'):
        asyncio.run(fetch_clip_metadata('other', 'https://example.invalid/tour', transport=httpx.MockTransport(lambda _: pytest.fail('No undocumented endpoint'))))


def test_worker_result_never_confirms_metadata_and_stale_source_is_discarded(permission_accounts, monkeypatch, tmp_path):
    _, ids = permission_accounts
    monkeypatch.setattr(assets, 'STORAGE_ROOT', tmp_path / 'assets')
    private_caption = 'W9 private worker caption'
    markers = (private_caption, 'synthetic-contact@example.invalid', 'SYNTHETIC_FACE_EXCLUDE',
               'SYNTHETIC_HISTORY_EXCLUDE', 'C:/SYNTHETIC_PATH_EXCLUDE/source.psd')
    info = PngImagePlugin.PngInfo()
    info.add_itxt('XML:com.adobe.xmp', xmp_packet().decode().replace('SYNTHETIC caption', private_caption))
    # Uniqueness is in visible grayscale pixels and survives metadata stripping.
    pixels = bytes(channel for value in uuid4().bytes * 3 for channel in (value, value, value))
    original = io.BytesIO()
    Image.frombytes('RGB', (8, 6), pixels).save(original, 'PNG', pnginfo=info)
    original = original.getvalue()
    assert all(marker.encode() in original for marker in markers)

    async def check():
        operator = await disposable_operator()
        await operator.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        transaction = operator.transaction()
        await transaction.start()
        try:
            await operator.execute('update hub.media_ai_settings set monthly_cap_usd=5; update hub.media_worker_status set provider_configured=true,worker_seen_at=clock_timestamp()')
            project = await call(operator, ids['editor'], "select public_project_id from hub.projects where rem_project_id='DEMO-001' and deleted_at is null")
            context = {'v': 1, 'kind': 'project', 'ref': project, 'category': 'exterior', 'purpose': 'media'}
            resolved = await call(operator, ids['editor'], 'select hub.asset_upload_context($1,$2)', context, 'image/png')
            prepared = prepare_authorized_upload(original, 'image/png', 'synthetic-worker.png', resolved)
            registered = await call(operator, ids['editor'], 'select hub.record_asset_upload_source($1,$2,$3,$4,$5,$6)',
                                    prepared.metadata, prepared.original, prepared.processing, prepared.suggestions,
                                    context, resolved['context_stamp'])
            assert registered['reuse_kind'] == 'none'
            asset = registered['asset']
            asset_id = UUID(asset['id'])
            assert assets.install_file(prepared.content, prepared.metadata)
            original_checksum = hashlib.sha256(original).hexdigest()
            assert prepared.original['checksum'] == original_checksum != asset['checksum']
            assert hashlib.sha256(prepared.content).hexdigest() == asset['checksum']
            evidence = await call(operator, ids['editor'], 'select hub.asset_upload_evidence($1,$2)', asset_id, context)
            assert evidence['suggestions']['values']['caption'] == private_caption
            assert evidence['suggestions']['confirmed'] is False
            assert all(marker not in json.dumps(evidence) for marker in markers[1:])
            mapping = await call(operator, ids['editor'], 'select hub.find_uploaded_asset_source($1,$2,$3)',
                                 original_checksum, 'image/png', context)
            assert mapping['original']['checksum'] == original_checksum and mapping['asset']['checksum'] == asset['checksum']
            assert all(marker.encode() not in prepared.content for marker in markers)
            real_reader = assets.readable_file
            stored_path = real_reader(asset)
            assert stored_path.read_bytes() == prepared.content and stored_path.stat().st_size == asset['file_size']
            assert not (assets.STORAGE_ROOT / f'{original_checksum}.png').exists()
            reads, calls = [], []

            def stored_reader(metadata):
                path = real_reader(metadata)
                assert metadata['checksum'] == asset['checksum'] and path == stored_path
                assert path.read_bytes() == prepared.content
                reads.append(path)
                return path

            monkeypatch.setattr(assets, 'readable_file', stored_reader)
            await call(operator, ids['editor'], 'select hub.media_save_asset($1,$2,0,$3)', project, asset_id,
                       {'media_category': 'exterior', 'ai_exposure': 'open', 'marketing_publication': True})
            await call(operator, ids['editor'], "select hub.media_job_request($1,'image_suggestion',$2,1)", project, asset_id)

            class Provider:
                from sena_hub_api.content_translation import DEFAULT_MODEL as model

                async def suggest(self, image, context):
                    calls.append((image, context))
                    return suggestion()

            assert (await work_once(operator, Provider()))['status'] == 'done'
            assert len(calls) == len(reads) == 1
            image_url, provider_context = calls[0]
            assert image_url.startswith('data:image/jpeg;base64,')
            provider_bytes = base64.b64decode(image_url.split(',', 1)[1], validate=True)
            with Image.open(io.BytesIO(provider_bytes)) as picture:
                assert picture.format == 'JPEG' and picture.size == (8, 6)
                assert not picture.getexif()
                assert not {'exif', 'xmp', 'XML:com.adobe.xmp', 'comment', 'photoshop', 'icc_profile'} & picture.info.keys()
                # JPEG is lossy, but it must still depict this stored fixture.
                decoded = picture.convert('RGB').tobytes()
                assert sum(abs(a - b) for a, b in zip(decoded, pixels)) / len(pixels) < 20
            assert set(provider_context) == {'chosen_category', 'categories', 'tags', 'facilities', 'commercial_types', 'buildings'}
            assert provider_context['chosen_category'] == 'exterior' and provider_context['categories'] and provider_context['tags']
            assert 'legal_document' not in provider_context['categories'] and 'brochure' not in provider_context['categories']
            provider_text = json.dumps(provider_context)
            assert all(marker.encode() not in provider_bytes and marker not in provider_text for marker in markers)
            assert all(value not in provider_text for value in
                       (original_checksum, asset['checksum'], evidence['source_id'], evidence['evidence_id'], 'file_metadata', 'suggestions',
                        'SYNTHETIC creator', 'SYNTHETIC copyright', 'SYNTHETIC usage terms', 'SYNTHETIC_UNKNOWN_TAG'))
            row = await call(operator, ids['editor'], 'select hub.asset_detail($1)', asset_id)
            assert row['ai_suggestion']['media_category'] == 'exterior' and row['metadata_state'] == 'needs_review'
            assert row['caption'] == {} and row['rights_status'] == 'pending'
            assert (await call(operator, ids['editor'], "select hub.media_job_request($1,'image_suggestion',$2,1)", project, asset_id))['status'] == 'done'
            await call(operator, ids['editor'], 'select hub.media_save_asset($1,$2,1,$3)', project, asset_id, {'credit': {'en': 'Synthetic revision'}})
            await call(operator, ids['editor'], "select hub.media_job_request($1,'image_suggestion',$2,2)", project, asset_id)

            class Stale(Provider):
                async def suggest(self, image, context):
                    await call(operator, ids['editor'], 'select hub.media_save_asset($1,$2,2,$3)', project, asset_id, {'media_category': 'map'})
                    return suggestion()

            assert (await work_once(operator, Stale()))['status'] == 'superseded'
            assert (await call(operator, ids['editor'], 'select hub.asset_detail($1)', asset_id))['media_category'] == 'map'
            await call(operator, ids['editor'], "select hub.media_job_request($1,'image_suggestion',$2,3)", project, asset_id)

            class Revoked(Provider):
                async def suggest(self, image, context):
                    await operator.execute('SET LOCAL ROLE postgres')
                    await operator.execute("update hub.account_permission set can_edit=false where account_id=$1 and tab='projects'", ids['editor'])
                    return suggestion()

            assert (await work_once(operator, Revoked()))['status'] == 'superseded'
            assert len(reads) == 3, 'Successful, stale and revoked jobs all read the real optimized file'
        finally:
            await transaction.rollback()
            await operator.close()
    asyncio.run(check())


def test_api_role_cannot_claim_finish_or_forge_results(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            for sql in ['select hub.media_claim()', 'select hub.media_schedule_checks()', 'select hub.media_finish(null,null,null,null,null)']:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['editor'], sql)
            assert not await db.fetchval("select pg_has_role(current_user,'hub_media_worker','MEMBER')")
        finally:
            await db.close()
    asyncio.run(check())


def test_clip_metadata_periodic_checks_and_stale_completion(permission_accounts):
    _, ids = permission_accounts

    async def check():
        operator = await disposable_operator()
        await operator.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        transaction = operator.transaction()
        await transaction.start()
        try:
            project = await call(operator, ids['editor'], "select public_project_id from hub.projects where rem_project_id='DEMO-001' and deleted_at is null")
            clip_id = uuid4()
            clip = await call(operator, ids['editor'], 'select hub.media_clip_save($1,$2,0,$3)', project, clip_id,
                              {'provider': 'youtube', 'kind': 'walkthrough', 'url': 'https://youtu.be/abcdefghijk', 'owner_type': 'sena_owned'})
            assert clip['title'] == {}, 'Pasting a URL must not require a title before fetching it'
            await call(operator, ids['editor'], "select hub.media_job_request($1,'clip_metadata',$2,1)", project, clip_id)
            transport = httpx.MockTransport(lambda _: httpx.Response(200, json={'type': 'video', 'title': 'Synthetic provider title', 'author_name': 'Synthetic channel'}))
            assert (await work_once(operator, transport=transport))['status'] == 'done'
            workspace = await call(operator, ids['editor'], 'select hub.project_media($1)', project)
            saved = next(c for c in workspace['clips'] if c['id'] == str(clip_id))
            assert saved['title'] == {} and saved['provider_metadata']['title']['th'] == 'Synthetic provider title'
            assert saved['updated_by'] == str(ids['editor']) and saved['external_id'] == 'abcdefghijk'
            # A later editor decision wins over an in-flight periodic check.
            await call(operator, ids['editor'], "select hub.media_job_request($1,'clip_check',$2,1)", project, clip_id)
            await operator.execute('SET LOCAL ROLE hub_media_worker')
            job = await operator.fetchval('select hub.media_claim()')
            await call(operator, ids['editor'], "select hub.media_clip_check($1,$2,1,'ok')", project, clip_id)
            await operator.execute('SET LOCAL ROLE hub_media_worker')
            assert await operator.fetchval('select hub.media_finish($1,$2,$3,null,null)', UUID(job['id']), UUID(job['lease_token']), {'link_status': 'removed'}) == 'superseded'
            await operator.execute('SET LOCAL ROLE postgres')
            # This explicit clock fixture still attributes the row to its editor.
            await operator.execute("select set_config('app.actor_id',$1,true)", str(ids['editor']))
            await operator.execute("update hub.media_links set checked_at=now()-interval '8 days' where id=$1", clip_id)
            await operator.execute("update hub.media_jobs set created_at=now()-interval '2 days' where subject_id=$1", clip_id)
            await operator.execute('SET LOCAL ROLE hub_media_worker')
            assert await operator.fetchval('select hub.media_schedule_checks()') >= 1
            result = await work_once(operator, transport=httpx.MockTransport(lambda _: httpx.Response(404)))
            assert result['status'] == 'done'
            workspace = await call(operator, ids['viewer'], 'select hub.project_media($1)', project)
            saved = next(c for c in workspace['clips'] if c['id'] == str(clip_id))
            assert saved['link_status'] == 'removed' and not saved['visible']
            assert any(c['id'] == str(clip_id) for c in workspace['checklist']['broken_links'])
        finally:
            await transaction.rollback()
            await operator.close()
    asyncio.run(check())
