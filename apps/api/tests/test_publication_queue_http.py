"""W4 HTTP and hub_app decisions on one attested, rollback-only connection."""
from contextlib import asynccontextmanager
import json
from uuid import UUID, uuid4

import asyncpg
import pytest

from sena_hub_api.main import initialize_connection
from test_permission_content import call
from test_permission_foundations import permission_accounts, h
from test_permission_publication import rows

QUEUE = '/v1/admin/publication-queue'
WORKFLOW = '/v1/admin/content-workflow'
REASON = 'Explicit synthetic W4 HTTP decision'


def request(test, method, path, *, role='viewer', body=None, status=200, params=None):
    client, _, _, _ = test
    response = client.request(method, path, headers=h(role), params=params,
                              **({'json': body} if body is not None else {}))
    assert response.status_code == status, response.text
    assert response.headers['cache-control'] == 'no-store'
    return response.json().get('data')


def sql(test, role, statement, *args):
    client, ids, db, _ = test
    return client.portal.call(call, db, ids[role], statement, *args)


def read_tabs(*, publish=False):
    result = {tab: ['view'] for tab in ('projects', 'brands', 'promotions', 'releases')}
    result['knowledge'] = ['view', 'knowledge.publish_web'] if publish else ['view']
    return result


def grant(test, role, tabs):
    # Only this fixture's newly generated UUID is changed. The existing Accounts
    # command validates the assignment; the surrounding transaction rolls it back.
    _, ids, _, _ = test
    account = request(test, 'GET', '/v1/me', role=role)
    request(test, 'POST', f'/v1/admin/accounts/{ids[role]}/permissions', role='admin',
            body={'updated_at': account['updated_at'], 'tabs': tabs})


@pytest.fixture
def queue_http(permission_accounts):
    client, ids = permission_accounts
    original_pool = client.app.state.pool
    scope = rows(ids)

    async def start():
        db, evidence = await scope.__aenter__()
        try:
            await initialize_connection(db)
            assert await db.fetchval('select session_user') == 'hub_runtime'
            assert tuple(await db.fetchrow('select rolsuper,rolbypassrls from pg_roles where rolname=session_user')) == (False, False)
            return db, evidence
        except BaseException:
            await scope.__aexit__(None, None, None)
            raise

    db, evidence = client.portal.call(start)

    class RollbackPool:
        @asynccontextmanager
        async def acquire(self):
            yield db

    # Preserve the real authentication lookup and main.database route/role checks.
    # Only pool acquisition changes so HTTP and SQL see the same rolled-back rows.
    client.app.state.pool = RollbackPool()
    test = client, ids, db, evidence
    try:
        assert sql(test, 'viewer', 'select current_user') == 'hub_app'
        grant(test, 'second', {**read_tabs(), 'knowledge': ['view', 'edit']})
        grant(test, 'online_staff', {**read_tabs(), 'knowledge': ['view', 'approve']})
        grant(test, 'viewer', read_tabs(publish=True))
        yield test
    finally:
        client.app.state.pool = original_pool
        client.portal.call(scope.__aexit__, None, None, None)


def workflow(test, kind, identity, *, role='editor'):
    return request(test, 'GET', WORKFLOW, role=role,
                   params={'kind': kind, 'identity': json.dumps(identity)})


def approve(test, kind, identity, *, author='editor', reviewer='publisher'):
    current = workflow(test, kind, identity, role=author)
    if current['state'] == 'APPROVED' and not current['needs_reapproval']:
        return current
    submitted = request(test, 'POST', WORKFLOW + '/submit', role=author,
                        body={'kind': kind, 'identity': identity, 'expected_hash': current['expected_hash']})
    assert submitted['state'] == 'IN_REVIEW'
    approved = request(test, 'POST', WORKFLOW + '/review', role=reviewer,
                       body={'kind': kind, 'identity': identity, 'expected_hash': submitted['expected_hash'],
                             'decision': 'approve', 'reason': REASON})
    assert approved['state'] == 'APPROVED'
    assert approved['approved_by'] == str(test[1][reviewer])
    return approved


def contact(test, number, *, author='editor', path='/v1/admin/faq/corporate-contacts', current=None):
    return request(test, 'PUT' if current else 'POST', path + ('/' + current['id'] if current else ''), role=author,
                   body={'expected_revision': current['revision'] if current else 0,
                         'changes': {'channel': 'phone', 'value': number,
                                     'label': {'th': 'Synthetic HTTP contact', 'en': 'Synthetic HTTP contact'},
                                     'is_primary': False, 'ai_exposure': 'web_only'}})


def page(test, key=None):
    key = key or 'corporate:w4_http_' + uuid4().hex
    existing = request(test, 'GET', '/v1/admin/web', role='second')['pages']
    revision = next((item['revision'] for item in existing if item['page_key'] == key), 0)
    saved = request(test, 'PUT', '/v1/admin/web/pages/' + key, role='second',
                    body={'expected_revision': revision, 'config': {'url': '/w4-http/' + uuid4().hex,
                          'locales': ['th'], 'ai_policy': 'no_ai', 'max_faq_items': 100, 'project_ids': []}})
    approve(test, 'page_config', {'id': saved['id']}, author='second', reviewer='online_staff')
    return key


def prepare(test, key):
    return request(test, 'POST', QUEUE + '/prepare',
                   body={'selections': [{'system': 'web', 'page_key': key}], 'reason': REASON})


def publish(test, batch, *, role='viewer', transport='http'):
    if transport == 'sql':
        return sql(test, role, 'select hub.publication_queue_publish($1,$2)', UUID(batch['id']), batch['digest'])
    return request(test, 'POST', QUEUE + '/publish', role=role,
                   body={'publication_id': batch['id'], 'expected_digest': batch['digest']})


def outcomes(result):
    return [item for page_result in result['outcomes'] for item in page_result.get('items', [])]


def public_page(test, key):
    return sql(test, 'service_consumer', "select hub.web_public_page($1,'th')", key)


def test_view_and_special_without_approve_reach_real_http_publication(queue_http):
    test = queue_http
    row = contact(test, '021111111')
    approved = approve(test, 'contact', {'id': row['id']})
    key = page(test)
    capabilities = request(test, 'GET', '/v1/me')['capabilities']
    assert capabilities['tabs']['knowledge'] == {'view': True, 'edit': False, 'approve': False}
    assert capabilities['special_actions']['knowledge.publish_web'] is True
    assert any(item.get('page_key') == key for item in request(test, 'GET', QUEUE)['items'])
    snapshot = workflow(test, 'contact', {'id': row['id']}, role='viewer')
    assert not snapshot['can_edit'] and not snapshot['can_approve']
    batch = prepare(test, key)
    review = request(test, 'GET', '/v1/admin/web/publications/' + batch['id'])
    assert review['can_publish'] is True
    result = publish(test, batch)
    assert result['state'] == 'PUBLISHED' and result['page_count'] == 1
    assert any(item['value'] == row['value'] for item in public_page(test, key)['content']['contacts'])
    assert sql(test, 'viewer', "select hub.web_publication_read($1,'th')->>'state'", UUID(batch['id'])) == 'PUBLISHED'
    assert workflow(test, 'contact', {'id': row['id']}, role='viewer')['approved_by'] == approved['approved_by']


def test_missing_special_denies_all_queue_mutations_without_changing_items(queue_http):
    test = queue_http
    row, neighbour = contact(test, '022111111'), contact(test, '022222222')
    approved = approve(test, 'contact', {'id': row['id']})
    approve(test, 'contact', {'id': neighbour['id']})
    key, target = page(test), {'id': row['id']}
    batch = prepare(test, key)
    grant(test, 'viewer', read_tabs())
    assert request(test, 'GET', QUEUE)['can_publish'] is False
    before = sql(test, 'editor', 'select hub.web_workspace()')
    attempts = [
        ('/prepare', {'selections': [{'system': 'web', 'page_key': key}], 'reason': REASON},
         'select hub.publication_queue_prepare($1,$2)', ([{'system': 'web', 'page_key': key}], REASON)),
        ('/publish', {'publication_id': batch['id'], 'expected_digest': batch['digest']},
         'select hub.publication_queue_publish($1,$2)', (UUID(batch['id']), batch['digest'])),
        ('/return', {'kind': 'contact', 'identity': target, 'expected_hash': approved['expected_hash'], 'reason': REASON},
         'select hub.publication_queue_return($1,$2,$3,$4)', ('contact', target, approved['expected_hash'], REASON)),
    ]
    for suffix, body, statement, args in attempts:
        request(test, 'POST', QUEUE + suffix, body=body, status=403)
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            sql(test, 'viewer', statement, *args)
    assert sql(test, 'editor', 'select hub.web_workspace()') == before
    assert workflow(test, 'contact', target, role='viewer')['expected_hash'] == approved['expected_hash']
    assert workflow(test, 'contact', {'id': neighbour['id']}, role='viewer')['state'] == 'APPROVED'
    grant(test, 'viewer', read_tabs(publish=True))
    returned = request(test, 'POST', QUEUE + '/return', body=attempts[2][1])
    assert returned['state'] == 'RETURNED' and returned['approved_by'] == approved['approved_by']
    assert workflow(test, 'contact', {'id': neighbour['id']}, role='viewer')['state'] == 'APPROVED'


def test_source_view_revocation_denies_exact_brand_and_preserves_corporate_neighbour(queue_http):
    test = queue_http
    brand = next(item for item in request(test, 'GET', '/v1/admin/brands', role='editor') if item['published_version_id'])
    target = contact(test, '023111111', path=f"/v1/admin/brands/{brand['public_brand_id']}/contacts")
    approved = approve(test, 'contact', {'id': target['id']})
    approve(test, 'brand', {'id': brand['id']})
    key = page(test, 'brand:' + brand['public_brand_id'])
    batch = prepare(test, key)
    neighbour = contact(test, '023222222')
    approve(test, 'contact', {'id': neighbour['id']})
    neighbour_key = page(test)
    neighbour_batch = prepare(test, neighbour_key)
    grant(test, 'viewer', {tab: levels for tab, levels in read_tabs(publish=True).items() if tab != 'brands'})
    before = sql(test, 'editor', 'select hub.web_workspace()')
    assert not any(item.get('page_key') == key for item in request(test, 'GET', QUEUE)['items'])
    request(test, 'GET', '/v1/admin/web/publications/' + batch['id'], status=403)
    request(test, 'POST', QUEUE + '/prepare', status=403,
            body={'selections': [{'system': 'web', 'page_key': key}], 'reason': REASON})
    request(test, 'POST', QUEUE + '/publish', status=403,
            body={'publication_id': batch['id'], 'expected_digest': batch['digest']})
    request(test, 'POST', QUEUE + '/return', status=403,
            body={'kind': 'contact', 'identity': {'id': target['id']}, 'expected_hash': approved['expected_hash'], 'reason': REASON})
    for statement, args in [
        ('select hub.publication_queue_prepare($1,$2)', ([{'system': 'web', 'page_key': key}], REASON)),
        ('select hub.publication_queue_publish($1,$2)', (UUID(batch['id']), batch['digest'])),
        ('select hub.publication_queue_return($1,$2,$3,$4)', ('contact', {'id': target['id']}, approved['expected_hash'], REASON)),
    ]:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            sql(test, 'viewer', statement, *args)
    assert sql(test, 'editor', 'select hub.web_workspace()') == before
    assert workflow(test, 'contact', {'id': target['id']})['expected_hash'] == approved['expected_hash']
    result = publish(test, neighbour_batch)
    assert result['state'] == 'PUBLISHED' and result['page_count'] == 1
    assert any(item['value'] == neighbour['value'] for item in public_page(test, neighbour_key)['content']['contacts'])


def faq(test, *, author, english_reviewer):
    question = 'w4_http_' + uuid4().hex
    request(test, 'PUT', '/v1/admin/faq/questions/' + question, role='second',
            body={'expected_revision': 0, 'changes': {'topic': 'design', 'default_level': 'corporate',
                  'question_template': {'th': 'Synthetic HTTP question?'}, 'answer_kind': 'text'}})
    approve(test, 'question', {'question_key': question}, author='second', reviewer='online_staff')
    row = request(test, 'POST', '/v1/admin/faq', role=author,
                  body={'expected_revision': 0, 'changes': {'question_key': question, 'scope_type': 'corporate',
                        'scope_id': 'sena', 'question': {'th': 'Synthetic HTTP question?'},
                        'short_answer': {'th': 'Exact synthetic reviewed answer'}, 'answer_kind': 'text', 'ai_exposure': 'open'}})
    reviewed = set()
    while True:
        translations = request(test, 'GET', '/v1/admin/faq/' + row['id'], role=english_reviewer)['translations']
        translation = next((item for item in translations if item['th_text'].strip() and item['editable']
                            and item['translation_state'] != 'reviewed'), None)
        if translation is None:
            break
        assert translation['id'] not in reviewed
        request(test, 'POST', f"/v1/admin/content/translations/{translation['id']}/review", role=english_reviewer,
                body={'expected_revision': translation['revision'], 'th_version': translation['th_version'],
                      'english': 'Reviewed ' + translation['th_text']})
        reviewed.add(translation['id'])
    assert reviewed
    return row, question


@pytest.mark.parametrize('transport', ['http', 'sql'])
@pytest.mark.parametrize('contributor', ['editor', 'english_reviewer', 'approver', 'self_approver'])
def test_included_contributor_cannot_publish_but_independent_item_can(queue_http, contributor, transport):
    test = queue_http
    actor = {'editor': 'editor', 'english_reviewer': 'viewer', 'approver': 'publisher', 'self_approver': 'publisher'}[contributor]
    author = 'publisher' if contributor == 'self_approver' else 'editor'
    reviewer = 'viewer' if contributor == 'english_reviewer' else 'second'
    if contributor == 'self_approver':
        grant(test, 'publisher', {**read_tabs(), 'knowledge': ['view', 'edit', 'approve']})
    if contributor == 'english_reviewer':
        grant(test, 'viewer', {**read_tabs(), 'knowledge': ['view', 'edit']})
    row, question = faq(test, author=author, english_reviewer=reviewer)
    approved = approve(test, 'faq', {'id': row['id']}, author=author)
    assert approved['self_approval'] is (contributor == 'self_approver')
    neighbour = contact(test, '024111111', author='second')
    approve(test, 'contact', {'id': neighbour['id']}, author='second', reviewer='online_staff')
    key = page(test)
    grant(test, 'viewer', read_tabs(publish=True))
    batch = prepare(test, key)
    grant(test, actor, read_tabs(publish=True))
    capabilities = request(test, 'GET', '/v1/me', role=actor)['capabilities']
    assert not capabilities['tabs']['knowledge']['edit'] and not capabilities['tabs']['knowledge']['approve']
    result = publish(test, batch, role=actor, transport=transport)
    assert result['state'] == 'PARTIAL' and result['page_count'] == 1
    entries = outcomes(result)
    for entry in entries:
        workflow_target = entry['workflow']
        assert set(workflow_target) == {'kind', 'identity', 'expected_hash'}
        assert len(workflow_target['expected_hash']) == 64
    assert any(item['status'] == 'REJECTED' and item['code'] == 'publisher_conflict'
               and item['workflow']['kind'] == 'faq' and item['workflow']['identity'] == {'id': row['id']} for item in entries), entries
    assert any(item['status'] == 'APPROVED' and item['workflow']['kind'] == 'contact'
               and item['workflow']['identity'] == {'id': neighbour['id']} for item in entries)
    published = public_page(test, key)
    assert not any(item['question_key'] == question for item in published['faq'])
    assert any(item['value'] == neighbour['value'] for item in published['content']['contacts'])
    current = workflow(test, 'faq', {'id': row['id']}, role=actor)
    assert current['state'] == 'APPROVED' and current['version_id'] == approved['version_id']
    assert current['approved_by'] == approved['approved_by'] and current['self_approval'] == approved['self_approval']


@pytest.mark.parametrize('transport', ['http', 'sql'])
def test_stale_item_keeps_its_published_value_and_accepts_the_valid_neighbour(queue_http, transport):
    test = queue_http
    first, second = contact(test, '025111111'), contact(test, '025222222')
    for row in (first, second):
        approve(test, 'contact', {'id': row['id']})
    key = page(test)
    assert publish(test, prepare(test, key))['state'] == 'PUBLISHED'
    history_path = '/v1/admin/web/pages/' + key + '/history'
    old_history = request(test, 'GET', history_path)
    old_version_path = '/v1/admin/web/pages/' + key + '/versions/' + old_history[0]['id']
    old_snapshot = request(test, 'GET', old_version_path)
    first_draft = contact(test, '025333333', current=first)
    second_draft = contact(test, '025444444', current=second)
    for row in (first_draft, second_draft):
        approve(test, 'contact', {'id': row['id']})
    batch = prepare(test, key)
    contact(test, '025555555', current=first_draft)
    review = request(test, 'GET', '/v1/admin/web/publications/' + batch['id'])
    assert any(item['code'] == 'stale' and item['workflow']['identity'] == {'id': first['id']}
               for page_result in review['pages'] for item in page_result['items'] if item.get('code'))
    result = publish(test, batch, transport=transport)
    assert result['state'] == 'PARTIAL' and result['page_count'] == 1
    assert any(item.get('code') == 'stale' and item['workflow']['identity'] == {'id': first['id']} for item in outcomes(result))
    assert any(item['status'] == 'APPROVED' and item['workflow']['identity'] == {'id': second['id']} for item in outcomes(result))
    values = [item['value'] for item in public_page(test, key)['content']['contacts']]
    assert first['value'] in values and second_draft['value'] in values
    assert first_draft['value'] not in values and '025555555' not in values
    assert len(request(test, 'GET', history_path)) == len(old_history) + 1
    assert request(test, 'GET', old_version_path) == old_snapshot


@pytest.mark.parametrize('entry', ['releases', 'knowledge'])
def test_history_entry_permissions_are_independent_of_queue_and_source_authority(queue_http, entry):
    test = queue_http
    release_id = str(test[3]['release'])
    tabs = {'projects': ['view'], 'brands': ['view'], entry: ['view']}
    grant(test, 'viewer', tabs)
    history = request(test, 'GET', '/v1/admin/releases')
    assert any(item['id'] == release_id for item in history['items'])
    detail = request(test, 'GET', '/v1/admin/releases/' + release_id)
    assert detail['members'] and all(item['entity_type'] == 'project' for item in detail['members'])
    assert sql(test, 'viewer', 'select hub.release_read($1)', UUID(release_id)) == detail
    assert any(item['id'] == release_id for item in sql(test, 'viewer', 'select hub.release_read()')['items'])
    if entry == 'releases':
        request(test, 'GET', QUEUE, status=403)
        request(test, 'GET', '/v1/admin/releases/candidates')
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            sql(test, 'viewer', 'select hub.publication_queue_read()')
    else:
        assert request(test, 'GET', QUEUE)['can_publish'] is False
        request(test, 'GET', '/v1/admin/releases/candidates', status=403)
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            sql(test, 'viewer', 'select hub.release_candidates(false)')
    prepare_body = {'selections': [{'system': 'web', 'page_key': 'corporate:sena'}], 'reason': REASON}
    request(test, 'POST', QUEUE + '/prepare', body=prepare_body, status=403)
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        sql(test, 'viewer', 'select hub.publication_queue_prepare($1,$2)', prepare_body['selections'], REASON)
    grant(test, 'viewer', {'brands': ['view'], entry: ['view']})
    assert not any(item['id'] == release_id for item in request(test, 'GET', '/v1/admin/releases')['items'])
    request(test, 'GET', '/v1/admin/releases/' + release_id, status=404)
    with pytest.raises(asyncpg.NoDataFoundError):
        sql(test, 'viewer', 'select hub.release_read($1)', UUID(release_id))
    grant(test, 'viewer', {'brands': ['view']})
    request(test, 'GET', '/v1/admin/releases', status=403)
    request(test, 'GET', '/v1/admin/releases/' + release_id, status=403)
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        sql(test, 'viewer', 'select hub.release_read()')
    request(test, 'GET', '/v1/admin/brands')
    assert sql(test, 'viewer', 'select hub.list_brands()')
