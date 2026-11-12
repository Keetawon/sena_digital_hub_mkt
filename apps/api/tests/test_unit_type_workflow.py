"""Phase 5 runs source, approval and price boundaries as the real runtime."""
import asyncio
from datetime import datetime, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import asyncpg
import pytest

from sena_hub_api.unit_types import MarketingPrice
from pydantic import ValidationError
from content_workflow_fixture import decide_item
from test_permission_baseline import disposable_operator
from test_permission_content import call, set_bit
from test_permission_foundations import permission_accounts, h
from test_project_content_core import runtime


async def project(db, actor):
    key = await call(db, actor, "select public_project_id from hub.projects where deleted_at is null order by id limit 1")
    return await call(db, actor, "select hub.project_detail($1)", key)


async def workspace(db, actor, key):
    return await call(db, actor, "select hub.unit_type_workspace($1)", key)


async def create_type(db, actor, p):
    name = "Synthetic unit " + uuid4().hex[:8]
    result = await call(db, actor, "select hub.create_commercial_types($1,$2,$3)", UUID(p['id']), [{
        'public_name': {'th': name, 'en': name}, 'description': {'th': 'Marketing concept', 'en': 'Marketing concept'},
        'category': '1br', 'product_form': 'condominium', 'area_min_sqm': 25, 'area_max_sqm': 30,
        'price_mode': 'manual', 'special_rooms': ['walk_in_closet'], 'ceiling_height_m': 2.7,
        'source_model_ids': [p['models'][0]['public_model_id']] if p.get('models') else [],
    }], datetime.fromisoformat(p['updated_at']))
    return next(t for t in result['commercial_types'] if t['public_name']['th'] == name)


async def review_english(db, actor, key, owner):
    data = await workspace(db, actor, key)
    for text in data['translations']:
        if text['owner_key'] == str(owner) and text['th_text'].strip():
            await call(db, actor, "select hub.review_content_translation($1,$2,$3,$4)", UUID(text['id']),
                       text['revision'], text['th_version'], text['entered_en'] or text['th_text'])


async def type_action(db, actor, key, item, decision):
    if decision in ('return', 'withdraw'):
        return await decide_item(db, actor, 'unit_type', {'id': item['id']}, decision)
    current = await workspace(db, actor, key)
    return await call(db, actor, "select hub.unit_type_review($1,$2,$3,$4)", key, item['public_commercial_type_id'],
                      datetime.fromisoformat(current['project']['updated_at']), decision)


def price_body(item):
    today = datetime.now(ZoneInfo('Asia/Bangkok')).date()
    return {'kind': 'starting', 'commercial_type_id': item['id'], 'amount': 1800000, 'basis_size_sqm': 25,
            'display_text': {'th': 'Starting price', 'en': 'Starting price'},
            'basis': {'th': 'Selected unit size', 'en': 'Selected unit size'},
            'condition_text': {'th': 'Selected units only', 'en': 'Selected units only'},
            'valid_from': today.isoformat(), 'valid_to': (today + timedelta(days=60)).isoformat()}


async def save_price(db, actor, key, item, **changes):
    data = await workspace(db, actor, key)
    return await call(db, actor, 'select hub.save_project_price($1,null,$2,$3)', key,
                      datetime.fromisoformat(data['project']['updated_at']), price_body(item) | changes)


async def price_action(db, actor, key, price, decision):
    if decision in ('return', 'withdraw'):
        return await decide_item(db, actor, 'price', {'id': price['price_id']}, decision)
    data = await workspace(db, actor, key)
    return await call(db, actor, 'select hub.project_price_review($1,$2,$3,$4)', key, UUID(price['price_id']),
                      datetime.fromisoformat(data['project']['updated_at']), decision)


def test_type_translation_submission_immutable_version_and_separate_approver(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            p = await project(db, ids['editor']); key = p['public_project_id']
            before = await call(db, ids['viewer'], 'select hub.project_versions($1)', UUID(p['id']))
            item = await create_type(db, ids['editor'], p)
            data = await workspace(db, ids['editor'], key)
            current = next(t for t in data['types'] if t['id'] == item['id'])
            assert not current['workflow']['ready']
            assert current['bedrooms'] is None and current['bathrooms'] is None
            assert current['category'] == '1br' and current['special_rooms'] == ['walk_in_closet']
            with pytest.raises(asyncpg.CheckViolationError):
                await type_action(db, ids['editor'], key, item, 'submit')
            await set_bit(ids['second'], 'projects', can_approve=False, can_edit=True, connection=db, manager=ids['admin'])
            await call(db, ids['second'], 'select hub.media_clip_save($1,$2,0,$3)', key, uuid4(), {
                'provider': 'matterport', 'kind': 'tour_360', 'url': 'https://my.matterport.com/show/?m=synthetic',
                'title': {'th': 'Tour text', 'en': 'Tour text'}, 'targets': [{'target_type': 'commercial_type', 'target_key': item['id']}],
                'ai_exposure': 'open', 'owner_type': 'sena_owned'})
            await review_english(db, ids['editor'], key, item['id'])
            await type_action(db, ids['editor'], key, item, 'submit')
            data = await workspace(db, ids['publisher'], key)
            current = next(t for t in data['types'] if t['id'] == item['id'])
            version = current['history'][0]
            assert version['state'] == 'in_review' and str(ids['editor']) in version['editors'] and str(ids['second']) in version['editors']
            await set_bit(ids['second'], 'projects', can_edit=False, can_approve=True, connection=db, manager=ids['admin'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError, match='Another person'):
                await type_action(db, ids['second'], key, item, 'approve')
            assert not {'id', 'rem_model_id', 'source_notes', 'source_model_ids', 'updated_by', 'comparison'} & version['payload'].keys()
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], 'select hub.update_commercial_type($1,$2,$3,$4)', UUID(p['id']), item['public_commercial_type_id'],
                           {'description': {'th': 'Changed'}}, datetime.fromisoformat(data['project']['updated_at']))
            await set_bit(ids['editor'], 'projects', can_edit=False, can_approve=True, connection=db, manager=ids['admin'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError, match='Another person'):
                await type_action(db, ids['editor'], key, item, 'approve')
            await set_bit(ids['editor'], 'projects', can_approve=False, can_edit=True, connection=db, manager=ids['admin'])
            await type_action(db, ids['publisher'], key, item, 'approve')
            data = await workspace(db, ids['editor'], key)
            current = next(t for t in data['types'] if t['id'] == item['id'])
            assert current['status'] == 'approved'
            assert (await call(db, ids['viewer'], 'select hub.project_versions($1)', UUID(p['id']))) == before
            await call(db, ids['editor'], 'select hub.update_commercial_type($1,$2,$3,$4)', UUID(p['id']), item['public_commercial_type_id'],
                       {'description': {'th': 'New concept', 'en': 'New concept'}}, datetime.fromisoformat(data['project']['updated_at']))
            data = await workspace(db, ids['editor'], key)
            current = next(t for t in data['types'] if t['id'] == item['id'])
            assert current['status'] == 'draft' and current['history'][0]['payload'] == version['payload']
            assert any(t['translation_state'] == 'stale' for t in data['translations'] if t['owner_key'] == item['id'])
        finally:
            await db.close()
    asyncio.run(check())


def test_price_e2_e3_validity_review_no_ai_and_read_time_filter(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            p = await project(db, ids['editor']); key = p['public_project_id']; item = await create_type(db, ids['editor'], p)
            await review_english(db, ids['editor'], key, item['id'])
            await type_action(db, ids['editor'], key, item, 'submit'); await type_action(db, ids['publisher'], key, item, 'approve')
            today = datetime.now(ZoneInfo('Asia/Bangkok')).date()
            for changes in ({'valid_to': (today + timedelta(days=61)).isoformat()}, {'valid_to': (today - timedelta(days=1)).isoformat()},
                            {'basis': {'th': ''}}, {'condition_text': {}}, {'basis_size_sqm': 0}, {'amount': 0}, {'rem_min_available': 1}, {'state': 'approved'}):
                with pytest.raises((asyncpg.CheckViolationError, asyncpg.NotNullViolationError)):
                    await save_price(db, ids['editor'], key, item, **changes)
            price = await save_price(db, ids['editor'], key, item)
            data = await workspace(db, ids['editor'], key)
            translations = [t for t in data['translations'] if t['owner_key'] == price['price_id']]
            assert len(translations) == 3 and all(t['job'] is None for t in translations)
            with pytest.raises(asyncpg.CheckViolationError):
                await price_action(db, ids['editor'], key, price, 'submit')
            await review_english(db, ids['editor'], key, price['price_id'])
            await price_action(db, ids['editor'], key, price, 'submit')
            await price_action(db, ids['publisher'], key, price, 'approve')
            # Read this private composer as an operator only: hub_app cannot call helpers.
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.project_current_prices($1)', UUID(p['id']))
            data = await workspace(db, ids['publisher'], key)
            row = next(v for v in data['prices'] if v['id'] == price['price_id'])
            assert row['state'] == 'approved' and row['ai_exposure'] == 'web_only'
            assert row['history'][0]['payload']['basis_size_sqm'] == 25
            assert not any(k.startswith('rem_') for k in row['history'][0]['payload'])
            await price_action(db, ids['publisher'], key, price, 'withdraw')
            assert next(v for v in (await workspace(db, ids['viewer'], key))['prices'] if v['id'] == price['price_id'])['state'] == 'withdrawn'
        finally:
            await db.close()
    asyncio.run(check())


def test_type_and_price_runtime_permission_denial_neighbors_and_stale(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            p = await project(db, ids['editor']); key = p['public_project_id']; item = await create_type(db, ids['editor'], p)
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], 'select hub.save_project_price($1,null,$2,$3)', key,
                           datetime.fromisoformat(p['updated_at']), price_body(item))
            await set_bit(ids['editor'], 'projects', can_edit=False, can_view=False, connection=db, manager=ids['admin'])
            for sql, args in [('select hub.unit_type_workspace($1)', (key,)),
                              ('select hub.unit_type_review($1,$2,$3,$4)', (key, item['public_commercial_type_id'], datetime.fromisoformat(p['updated_at']), 'submit')),
                              ('select hub.save_project_price($1,null,$2,$3)', (key, datetime.fromisoformat(p['updated_at']), price_body(item)))]:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['editor'], sql, *args)
            assert await call(db, ids['editor'], "select hub.can('brands','view')")
            for role in ('agency', 'service_consumer', 'pending'):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await workspace(db, ids[role], key)
            assert (await workspace(db, ids['viewer'], key))['project']['public_project_id'] == key
            for table in ('commercial_type_versions', 'project_prices', 'project_price_versions'):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['viewer'], f'delete from hub.{table}')
        finally:
            await db.close()
    asyncio.run(check())


def test_tour_edit_serializes_with_unit_revision_and_leaves_neighbor_available(permission_accounts):
    _, ids = permission_accounts

    async def check():
        first = await runtime(); second = await runtime()
        operator = await disposable_operator(); source = 'UNIT-NEIGHBOR-' + uuid4().hex
        try:
            await operator.execute("insert into staging.rem_projects(rem_project_id,project_name_rem,source_fingerprint) values($1,'Synthetic neighbor','synthetic')", source)
            p = await project(first, ids['editor'])
            await create_type(first, ids['editor'], p)  # Holds the project revision lock until rollback.
            await second.execute("set local lock_timeout='150ms'")
            body = {'provider': 'matterport', 'kind': 'tour_360', 'url': 'https://my.matterport.com/show/?m=synthetic',
                    'title': {'th': 'Concurrent tour'}, 'owner_type': 'sena_owned'}
            with pytest.raises(asyncpg.LockNotAvailableError):
                await call(second, ids['editor'], 'select hub.media_clip_save($1,$2,0,$3)', p['public_project_id'], uuid4(), body)
            other_id = await call(second, ids['editor'], 'select hub.create_project_from_rem($1)', source)
            other = await call(second, ids['editor'], 'select public_project_id from hub.projects where id=$1', other_id)
            saved = await call(second, ids['editor'], 'select hub.media_clip_save($1,$2,0,$3)', other, uuid4(), body)
            assert saved['title']['th'] == 'Concurrent tour'
        finally:
            await second.close(); await first.close()
            await operator.execute('delete from staging.rem_projects where rem_project_id=$1', source)
            await operator.close()
    asyncio.run(check())


@pytest.mark.parametrize('method,path,level', [
    ('GET', '/unit-types', 'view'), ('POST', '/commercial-types/ctyp_test/submit', 'edit'),
    ('POST', '/commercial-types/ctyp_test/review', 'approve'), ('POST', '/prices', 'edit'),
    ('PUT', '/prices/00000000-0000-0000-0000-000000000001', 'edit'),
    ('POST', '/prices/00000000-0000-0000-0000-000000000001/submit', 'edit'),
    ('POST', '/prices/00000000-0000-0000-0000-000000000001/review', 'approve'),
])
def test_unit_http_exact_permissions(permission_accounts, method, path, level):
    client, ids = permission_accounts
    target = '/v1/admin/projects/missing' + path
    assert client.request(method, target).status_code == 401
    for role in ('agency', 'service_consumer', 'pending'):
        assert client.request(method, target, headers=h(role)).status_code == 403
    if level != 'view':
        assert client.request(method, target, headers=h('viewer')).status_code == 403
    if level == 'approve':
        assert client.request(method, target, headers=h('editor')).status_code == 403
        assert client.request(method, target, headers=h('admin')).status_code == 403


@pytest.mark.parametrize('change', [{'amount': float('inf')}, {'amount': True}, {'basis_size_sqm': -1}, {'rem_min_available': 1},
                                     {'condition_text': {'th': ''}}, {'state': 'approved'}, {'valid_to': '2026-12-22'}])
def test_price_input_rejects_forged_source_and_invalid_values(change):
    body = price_body({'id': str(uuid4())}) | {'valid_from': '2026-10-22', 'valid_to': '2026-12-21', 'updated_at': '2026-10-22T00:00:00Z'}
    with pytest.raises(ValidationError):
        MarketingPrice(**(body | change))
