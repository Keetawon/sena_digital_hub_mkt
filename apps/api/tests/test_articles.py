"""Article authority, version lifecycle and closed rendering on disposable data."""
from uuid import UUID, uuid4

import asyncpg
import pytest

from sena_hub_api.articles import render_blocks
from content_workflow_fixture import decide_item
from test_permission_baseline import disposable_operator
from test_permission_content import call, set_bit
from test_permission_foundations import permission_accounts, h
from test_project_content_core import run, runtime


def paragraph(text='Synthetic article body'):
    return {'type': 'paragraph', 'content': [{'type': 'text', 'text': text}]}


def content(**changes):
    return {'slug': 'synthetic-' + uuid4().hex, 'category': 'design', 'title': {'th': 'Synthetic article'},
            'excerpt': {'th': 'Synthetic introduction'}, 'blocks': {'type': 'doc', 'content': [paragraph()]}, **changes}


async def read(db, ids, article):
    return await call(db, ids['viewer'], 'select hub.article_read($1)', UUID(article))


async def review_english(db, ids, article):
    # Each leaf review increments metadata revisions; refresh the queue each time.
    while True:
        data = await read(db, ids, article)
        pending = next((t for t in data['translations'] if t['editable'] and t['th_text'].strip() and t['translation_state'] != 'reviewed'), None)
        if pending is None:
            return data
        await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)',
                   UUID(pending['id']), pending['revision'], pending['th_version'], pending['th_text'])


def test_article_version_review_stale_and_four_eyes_survive_role_change(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            body = content(author={'th': 'Synthetic author'}, tags=[{'th': 'Synthetic tag'}])
            item = await call(db, ids['editor'], 'select hub.article_save(null,0,$1)', body)
            article = item['id']
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], 'select hub.article_save($1,99,$2)', UUID(article), body)
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], 'select hub.article_submit($1,1)', UUID(article))
            data = await review_english(db, ids, article)
            assert data['readiness'] == []
            await call(db, ids['editor'], 'select hub.article_submit($1,$2)', UUID(article), data['revision'])
            frozen = await read(db, ids, article)
            assert frozen['state'] == 'IN_REVIEW' and frozen['version']['translations']
            t = next(t for t in frozen['translations'] if t['th_text'])
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)', UUID(t['id']), t['revision'], t['th_version'], t['th_text'])
            await set_bit(ids['editor'], 'knowledge', can_edit=False, can_approve=True)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], "select hub.article_review($1,$2,'approve')", UUID(article), frozen['revision'])
            await call(db, ids['publisher'], "select hub.article_review($1,$2,'approve')", UUID(article), frozen['revision'])
            approved = await read(db, ids, article)
            assert approved['approved_version_id'] == frozen['version']['id'] and approved['state'] == 'APPROVED'
            await set_bit(ids['editor'], 'knowledge', can_edit=True, can_approve=False)
            body['blocks'] = {'type': 'doc', 'content': [paragraph('Changed source')]}
            await call(db, ids['editor'], 'select hub.article_save($1,$2,$3)', UUID(article), approved['revision'], body)
            changed = await read(db, ids, article)
            assert changed['version']['version_no'] == 2 and changed['approved_version_id'] == approved['approved_version_id']
            assert changed['history'][1]['blocks'] == frozen['version']['blocks']
            assert any(t['translation_state'] == 'stale' and t['reviewed_en'] == 'Synthetic article body' for t in changed['translations'])
            await decide_item(db, ids['publisher'], 'article', {'id': article}, 'withdraw')
            withdrawn = await read(db, ids, article)
            assert withdrawn['approved_version_id'] is None and withdrawn['state'] == 'DRAFT'
            assert withdrawn['history'][1]['state'] == 'WITHDRAWN'
            data = await review_english(db, ids, article)
            await call(db, ids['editor'], 'select hub.article_submit($1,$2)', UUID(article), data['revision'])
            submitted = await read(db, ids, article)
            await decide_item(db, ids['publisher'], 'article', {'id': article}, 'return')
            assert (await read(db, ids, article))['state'] == 'RETURNED'
        finally:
            await db.close()
    run(check())


@pytest.mark.parametrize('category', ['design', 'commercial_terms', 'investment_context', 'buying_process', 'programmes'])
def test_article_translation_only_marketing_text_and_superseded_jobs(permission_accounts, category):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            body = content(category=category, blocks={'type': 'doc', 'content': [paragraph('Synthetic body 25 {project}') ]})
            item = await call(db, ids['editor'], 'select hub.article_save(null,0,$1)', body)
            data = await read(db, ids, item['id'])
            jobs = await call(db, ids['editor'], "select count(*) from hub.translation_jobs j join hub.content_translations t on t.id=j.translation_id where t.scope_id=$1", item['id'])
            assert (jobs == 3) if category == 'design' else (jobs == 0)
            body_text = next(t for t in data['translations'] if t['field_key'] == 'article.blocks')
            assert body_text['th_text'] == 'Synthetic body 25 {project}' and '{"type"' not in body_text['th_text']
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)', UUID(body_text['id']), body_text['revision'], body_text['th_version'], 'Missing protected values')
            body['blocks'] = {'type': 'doc', 'content': [paragraph('Changed 25 {project}') ]}
            await call(db, ids['editor'], 'select hub.article_save($1,$2,$3)', UUID(item['id']), data['revision'], body)
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)', UUID(body_text['id']), body_text['revision'], body_text['th_version'], 'Old 25 {project}')
            final = await review_english(db, ids, item['id'])
            assert final['version']['blocks']['en']['content'][0]['content'][0]['text'] == 'Changed 25 {project}'
            assert final['readiness'] == []
        finally:
            await db.close()
    run(check())


def test_article_references_and_preview_recheck_source_and_knowledge_permissions(permission_accounts):
    client, ids = permission_accounts
    project = client.get('/v1/admin/projects', headers=h('viewer')).json()['data'][0]['public_project_id']
    body = content(blocks={'type': 'doc', 'content': [paragraph(), {'type': 'projectCard', 'attrs': {'project_id': project}}]}, links=[{'kind': 'project', 'ref': project}])
    response = client.post('/v1/admin/articles', headers=h('editor'), json=body)
    assert response.status_code == 200, response.text
    article = response.json()['data']['id']
    path = f'/v1/admin/articles/{article}'
    assert client.get(path + '/preview', headers=h('viewer')).status_code == 200
    run(set_bit(ids['viewer'], 'projects', can_view=False))
    preview = client.get(path + '/preview', headers=h('viewer')).json()['data']
    assert 'article-unavailable' in preview['html'] and 'article-project' not in preview['html']
    refs = client.get('/v1/admin/articles/references', headers=h('viewer')).json()['data']
    assert refs['videos'] == refs['questions'] == refs['programmes'] == []
    assert client.get('/v1/admin/brands', headers=h('viewer')).status_code == 200
    run(set_bit(ids['viewer'], 'knowledge', can_view=False))
    for suffix in ('', '/preview'):
        assert client.get(path + suffix, headers=h('viewer')).status_code == 403
    assert client.get('/v1/admin/articles', headers=h('viewer')).status_code == 403
    assert client.get('/v1/admin/articles/references', headers=h('viewer')).status_code == 403
    assert client.get('/v1/articles', headers=h('service_consumer')).status_code == 404


@pytest.mark.parametrize('role', ['viewer', 'publisher', 'agency', 'online_staff', 'pending', 'service_consumer'])
def test_article_edit_denials_and_external_read_denials(permission_accounts, role):
    client, _ = permission_accounts
    assert client.post('/v1/admin/articles', headers=h(role), json=content()).status_code == 403
    if role not in ('viewer', 'publisher'):
        assert client.get('/v1/admin/articles', headers=h(role)).status_code == 403
        assert client.get('/v1/admin/articles/references', headers=h(role)).status_code == 403


def test_article_image_rights_and_current_validity_are_required(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        operator = await disposable_operator()
        asset = uuid4()
        try:
            await operator.execute("select set_config('app.actor_id',$1,false)", str(ids['editor']))
            await operator.execute("""insert into hub.assets(id,original_filename,mime_type,public_url,rights_status,asset_type,ai_exposure,media_category,alt_text,created_by,updated_by)
                values($1,'synthetic-article.png','image/png','/synthetic-article.png','approved','image','web_only','interior','{"th":"Synthetic article image"}',$2,$2)""", asset, ids['editor'])
            await operator.execute("""insert into hub.entity_assets(project_id,asset_id,asset_role,is_primary,created_by,updated_by)
                select id,$1,'thumbnail',false,$2,$2 from hub.projects where rem_project_id='DEMO-001' and deleted_at is null""", asset, ids['editor'])
            refs = await call(db, ids['editor'], 'select hub.article_references()')
            assert any(image['id'] == str(asset) for image in refs['images'])
            body = content(cover_asset_id=str(asset), blocks={'type': 'doc', 'content': [paragraph(), {'type': 'libraryImage', 'attrs': {'asset_id': str(asset)}}]})
            saved = await call(db, ids['editor'], 'select hub.article_save(null,0,$1)', body)
            preview = await call(db, ids['editor'], 'select hub.article_preview($1)', UUID(saved['id']))
            assert preview['references'][f'libraryImage:{asset}']['asset_id'] == str(asset)
            await operator.execute("update hub.assets set effective_to=now()-interval '1 second' where id=$1", asset)
            preview = await call(db, ids['editor'], 'select hub.article_preview($1)', UUID(saved['id']))
            assert preview['references'][f'libraryImage:{asset}'] is None
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], 'select hub.article_save(null,0,$1)', {**body, 'slug': 'synthetic-expired-' + uuid4().hex})
            assert any(i['code'] == 'cover_unavailable' for i in (await read(db, ids, saved['id']))['readiness'])
            await operator.execute('update hub.assets set effective_to=null where id=$1', asset)
            await operator.execute("update hub.assets set rights_status='pending' where id=$1", asset)
            assert not any(i['id'] == str(asset) for i in (await call(db, ids['editor'], 'select hub.article_references()'))['images'])
        finally:
            await db.close()
            await operator.execute('delete from hub.entity_assets where asset_id=$1', asset)
            await operator.execute('delete from hub.assets where id=$1', asset)
            await operator.close()
    run(check())


def test_article_faq_embed_resolves_current_answer_and_hides_missing_facts(permission_accounts):
    from test_faq_coverage import question, answer
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            project = await call(db, ids['editor'], "select to_jsonb(p) from hub.projects p where rem_project_id='DEMO-001' and deleted_at is null")
            key = await question(db, ids, keys=['project.common_fee'], kind='fact')
            await answer(db, ids, project, key, answer_kind='fact', fact_keys=['project.common_fee'], short_answer={'th': '{project} has a common fee of {common_fee}'})
            body = content(blocks={'type': 'doc', 'content': [paragraph(), {'type': 'faqEmbed', 'attrs': {'project_id': project['public_project_id'], 'question_key': key}}]})
            created = await call(db, ids['editor'], 'select hub.article_save(null,0,$1)', body)
            article = UUID(created['id']); ref = f'faqEmbed:{project["public_project_id"]}:{key}'
            before = await call(db, ids['viewer'], 'select hub.article_preview($1)', article)
            assert before['references'][ref] is None
            from datetime import date
            await call(db, ids['editor'], "select hub.save_project_fact($1,'project.common_fee','project',0,$2)", project['public_project_id'],
                       {'value_number': 0, 'unit': 'THB/sqm/month', 'as_of': date.today().isoformat()})
            after = await call(db, ids['viewer'], 'select hub.article_preview($1)', article)
            assert '0 ' in after['references'][ref]['short_answer'] and after['references'][ref]['as_of_label']
            assert 'facts' not in after['references'][ref]
            await set_bit(ids['viewer'], 'projects', can_view=False)
            hidden = await call(db, ids['viewer'], 'select hub.article_preview($1)', article)
            assert hidden['references'][ref] is None
        finally:
            await db.close()
    run(check())


BAD_NODES = [
    {'type': []},
    {'type': 'html', 'text': '<script>alert(1)</script>'},
    {'type': 'paragraph', 'attrs': {'onclick': 'alert(1)'}},
    {'type': 'libraryImage', 'attrs': {'src': 'javascript:alert(1)'}},
    {'type': 'text', 'text': 'Click', 'marks': [{'type': 'link', 'attrs': {'href': 'javascript:alert(1)'}}]},
    {'type': 'heading', 'attrs': {'level': 9}},
    {'type': 'tableCell', 'attrs': {'colspan': 100000}},
    {'type': 'tableCell', 'attrs': {'align': 'center;position:fixed'}},
]


@pytest.mark.parametrize('node', BAD_NODES)
def test_article_renderer_rejects_unsafe_nodes(node):
    with pytest.raises(ValueError):
        render_blocks({'type': 'doc', 'content': [node]}, {})


def test_article_renderer_escapes_every_text_surface_and_bounds_recursion():
    malicious = '<img src=x onerror="alert(1)"><script>bad()</script>'
    rendered = render_blocks({'type': 'doc', 'content': [paragraph(malicious), {'type': 'callout', 'content': [paragraph('Safe')]},
        {'type': 'faqEmbed', 'attrs': {'project_id': 'synthetic', 'question_key': 'synthetic_question'}}]},
        {'faqEmbed:synthetic:synthetic_question': {'question': malicious, 'short_answer': malicious, 'detail': malicious, 'as_of_label': malicious}})
    assert '<script>' not in rendered and '<img ' not in rendered and '&lt;script&gt;' in rendered
    cell = {'type': 'tableCell', 'attrs': {'colspan': 1, 'rowspan': 1, 'colwidth': None, 'align': None}, 'content': [paragraph('Cell')]}
    table = {'type': 'doc', 'content': [{'type': 'table', 'content': [{'type': 'tableRow', 'content': [cell]}]}]}
    assert '<td colspan="1" rowspan="1">' in render_blocks(table, {})
    cell['attrs']['align'] = 'center'
    assert 'class="article-align-center"' in render_blocks(table, {})
    deep = paragraph()
    for _ in range(12):
        deep = {'type': 'blockquote', 'content': [deep]}
    with pytest.raises(ValueError):
        render_blocks({'type': 'doc', 'content': [deep]}, {})
    with pytest.raises(ValueError):
        render_blocks({'type': 'doc', 'content': [paragraph()] * 201}, {})


@pytest.mark.parametrize('url', ['javascript:alert(1)', 'data:text/html,bad', 'http://example.test/video', 'https://[invalid', 'https://example.test:bad/video', 'https://user:password@example.test/video'])
def test_article_renderer_never_passes_unsafe_media_urls(url):
    media = str(uuid4())
    result = render_blocks({'type': 'doc', 'content': [{'type': 'mediaVideo', 'attrs': {'media_link_id': media}}]},
                           {f'mediaVideo:{media}': {'url': url, 'title': 'Video'}})
    assert 'article-unavailable' in result and 'href=' not in result


def test_article_media_links_are_safe_anchors_and_source_labels_are_escaped():
    media = str(uuid4())
    result = render_blocks({'type': 'doc', 'content': [{'type': 'mediaVideo', 'attrs': {'media_link_id': media}}]},
                           {f'mediaVideo:{media}': {'url': 'https://www.facebook.com/synthetic', 'title': '<script>bad()</script>'}})
    assert 'rel="noopener noreferrer"' in result and '<iframe' not in result and '<script>' not in result


def test_article_api_and_direct_sql_reject_unknown_oversized_and_cross_scope_input(permission_accounts):
    client, ids = permission_accounts
    for node in BAD_NODES:
        response = client.post('/v1/admin/articles', headers=h('editor'), json=content(blocks={'type': 'doc', 'content': [node]}))
        assert response.status_code == 422, response.text
    assert client.post('/v1/admin/articles', headers=h('editor'), json={**content(), 'approved_by': str(uuid4())}).status_code == 422
    assert client.post('/v1/admin/articles', headers=h('editor'), json=content(blocks={'type': 'doc', 'content': [paragraph('a' * 12001)]})).status_code == 422
    assert client.get('/v1/admin/articles?limit=101', headers=h('viewer')).status_code == 422
    assert client.get(f'/v1/admin/articles/{uuid4()}/preview?locale=fr', headers=h('viewer')).status_code == 422

    async def check():
        db = await runtime()
        try:
            for node in BAD_NODES:
                with pytest.raises(asyncpg.CheckViolationError):
                    await call(db, ids['editor'], 'select hub.article_save(null,0,$1)', content(blocks={'type': 'doc', 'content': [node]}))
            p = await call(db, ids['viewer'], 'select public_project_id from hub.projects where deleted_at is null limit 1')
            await set_bit(ids['editor'], 'projects', can_edit=False, can_view=False)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], 'select hub.article_save(null,0,$1)', content(blocks={'type': 'doc', 'content': [paragraph(), {'type': 'projectCard', 'attrs': {'project_id': p}}]}))
            created = await call(db, ids['editor'], 'select hub.article_save(null,0,$1)', content())
            for search, offset, limit in ((None, 0, 25), ('', None, 25), ('', 0, None)):
                with pytest.raises(asyncpg.CheckViolationError):
                    await call(db, ids['viewer'], 'select hub.article_list($1,$2,$3)', search, offset, limit)
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['publisher'], 'select hub.article_review($1,$2,null)', UUID(created['id']), created['revision'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], "update hub.article_versions set state='APPROVED' where article_id=$1", UUID(created['id']))
            await set_bit(ids['viewer'], 'knowledge', can_view=False)
            for table in ('articles', 'article_versions', 'article_links'):
                assert await call(db, ids['viewer'], f'select count(*) from hub.{table}') == 0
            assert await call(db, ids['viewer'], 'select count(*) from hub.brands') > 0
        finally:
            await db.close()
    run(check())
