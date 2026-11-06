"""No live providers: structured suggestions, fixed destinations and leased SQL."""
import asyncio
import json
from uuid import UUID, uuid4

import httpx
import pytest
import asyncpg

from sena_hub_api.media_worker import MediaError, clip_identity, fetch_clip_metadata, resized_image, validate_suggestion, work_once
from test_permission_baseline import disposable_operator
from test_permission_foundations import permission_accounts
from test_permission_content import call
from test_project_media import upload
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


def test_worker_result_never_confirms_metadata_and_stale_source_is_discarded(permission_accounts, monkeypatch):
    _, ids = permission_accounts
    monkeypatch.setattr('sena_hub_api.media_worker.resized_image', lambda _: 'data:image/jpeg;base64,c3ludGhldGlj')

    async def check():
        operator = await disposable_operator()
        await operator.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        transaction = operator.transaction()
        await transaction.start()
        try:
            await operator.execute('update hub.media_ai_settings set monthly_cap_usd=5; update hub.media_worker_status set provider_configured=true,worker_seen_at=clock_timestamp()')
            project = await call(operator, ids['editor'], "select public_project_id from hub.projects where rem_project_id='DEMO-001' and deleted_at is null")
            asset = await upload(operator, ids['editor'])
            asset_id = UUID(asset['id'])
            await call(operator, ids['editor'], 'select hub.media_save_asset($1,$2,0,$3)', project, asset_id,
                       {'media_category': 'exterior', 'ai_exposure': 'open', 'marketing_publication': True})
            await call(operator, ids['editor'], "select hub.media_job_request($1,'image_suggestion',$2,1)", project, asset_id)

            class Provider:
                from sena_hub_api.content_translation import DEFAULT_MODEL as model

                async def suggest(self, image, context):
                    assert image.startswith('data:image/jpeg;base64,')
                    assert 'legal_document' not in context['categories'] and 'brochure' not in context['categories']
                    assert set(context) == {'chosen_category', 'categories', 'tags', 'facilities', 'commercial_types', 'buildings'}
                    return suggestion()

            assert (await work_once(operator, Provider()))['status'] == 'done'
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
