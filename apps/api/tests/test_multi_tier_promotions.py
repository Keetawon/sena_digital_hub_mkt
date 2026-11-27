"""Five-tier transport contracts; SQL remains the scope authority."""
import pytest
import asyncio
from uuid import UUID
import asyncpg

from test_promotions import boundary, headers, DRAFT, ID, PROJECT
from test_content_scopes import scope_database, selected
from test_permission_foundations import permission_accounts
from test_permission_content import call
from test_real_promotions import command, draft
from test_website_content import project_fixture


@pytest.mark.parametrize("tier,owner", [
    ("campaign", {"all_active_projects": True}),
    ("corporate", {"programme_key": "LIVNEX"}),
    ("brand", {"owning_brand_id": ID}),
    ("project_group", {"owning_project_group_id": "00031"}),
    ("project", {"project_id": PROJECT}),
])
def test_all_tiers_create_and_resolve(boundary, tier, owner):
    client, store = boundary
    scope = {"promotion_tier": tier, "project_id": None, **owner}
    benefits = [
        {"benefit_type": "discount_amount", "benefit_value": "120000.00", "benefit_unit": "THB", "label": {"th": "ส่วนลดเงินสด"}},
        {"benefit_type": "free_transfer_fee", "benefit_value": None, "benefit_unit": None, "label": {"th": "ฟรีค่าโอน"}},
    ]
    response = client.post('/v1/admin/promotions', headers=headers('editor'), json={
        **DRAFT, **scope, "benefit_items": benefits, "highlight_badge": {"th": "จ่าย 0 บาท*"},
        "campaign_name": {"th": "ดีลส่งท้ายปี"}, "campaign_slug": "year-end-2026",
    })
    assert response.status_code == 201, response.text
    payload = store.calls[-1][1][-1]
    assert payload['promotion_tier'] == tier
    assert payload['benefit_items'] == benefits
    assert payload['benefit_type'] == 'discount_amount'
    assert payload['benefit_value'] == '120000.00'
    assert client.post('/v1/admin/promotions/resolve', headers=headers('viewer'), json=scope).status_code == 200


@pytest.mark.parametrize('changes', [
    {'promotion_tier': 'corporate', 'project_id': PROJECT},
    {'promotion_tier': 'project_group', 'project_id': None},
    {'programme_key': 'LIVNEX'},
    {'campaign_slug': 'Bad Slug'},
    {'benefit_items': [{'benefit_type': 'gift', 'benefit_value': 100, 'label': {}}]},
    {'benefit_items': [{'benefit_type': 'discount_pct', 'benefit_value': '100.01', 'label': {}}]},
    {'benefit_items': [{'benefit_type': 'gift', 'label': {}}] * 21},
    {'targets': [{'type': 'project', 'id': '00031'}]},
    {'promotion_tier': 'campaign', 'project_id': None, 'all_active_projects': True, 'targets': [{'type': 'project', 'id': PROJECT}]},
])
def test_invalid_tier_owner_and_benefits_never_reach_sql(boundary, changes):
    client, store = boundary
    response = client.post('/v1/admin/promotions', headers=headers('editor'), json={**DRAFT, **changes})
    assert response.status_code == 422, response.text
    assert not store.calls


def test_patch_new_fields_filters_and_saved_scope(boundary):
    client, store = boundary
    body = {'expected_revision': 1, 'programme_key': None, 'benefit_items': [], 'highlight_badge': {'th': 'ใหม่'},
            'targets': [{'type': 'project_group', 'id': '00031'}]}
    assert client.patch(f'/v1/admin/promotions/{ID}', headers=headers('editor'), json=body).status_code == 200
    assert store.calls[-1][1][-1] == body
    query = {'tier': 'project_group', 'brand_id': ID, 'project_group_id': '00031', 'q': 'ดีล'}
    assert client.get('/v1/admin/promotions', headers=headers('viewer'), params=query).status_code == 200
    assert store.calls[-1][1][-1] == {**query, 'limit': 50, 'offset': 0}
    assert client.post('/v1/admin/promotions/resolve', headers=headers('viewer'), json={
        'promotion_id': ID, 'expected_revision': 1, 'programme_key': 'LIVNEX', 'all_active_projects': False,
    }).status_code == 200


@pytest.mark.parametrize('field,value', [('promotion_tier', 'campaign'), ('owning_project_group_id', '00031')])
def test_patch_cannot_change_tier_or_owner(boundary, field, value):
    client, store = boundary
    assert client.patch(f'/v1/admin/promotions/{ID}', headers=headers('editor'), json={
        'expected_revision': 1, field: value,
    }).status_code == 422
    assert not store.calls


@pytest.mark.parametrize('kind,ref', [('corporate', 'sena'), ('project_group', '00031')])
def test_new_contextual_routes_accept_exact_scope(boundary, kind, ref):
    client, store = boundary
    response = client.get(f'/v1/admin/content/workspace/{kind}/{ref}/promotions', headers=headers('editor'))
    assert response.status_code == 200
    assert store.calls[-1][1][:2] == (kind, ref)
    before = len(store.calls)
    assert client.get(f'/v1/admin/content/workspace/{kind}/{ref}/promotions?phase=001', headers=headers('editor')).status_code == 422
    assert len(store.calls) == before


@pytest.mark.parametrize('tier', ['campaign', 'corporate', 'project_group'])
def test_new_tiers_require_every_affected_project_for_create_and_patch(permission_accounts, tier):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            a, b = [await project_fixture(db, ids['editor']) for _ in range(2)]
            group = '00031-' + a['rem_project_id']
            for project in (a, b):
                await db.execute("""insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance)
                    values($1,jsonb_build_object('project_id',$1::text,'rem_project_group_id',$2::text),now(),repeat('a',64),'{}')""", project['rem_project_id'], group)
            owners = {'promotion_tier': tier, 'project_id': None,
                      **({'owning_project_group_id': group} if tier == 'project_group' else {
                          'targets': [{'type': 'project', 'id': str(p['id'])} for p in (a, b)]})}
            row = await command(db, ids['editor'], 'create', **(draft(a['id']) | owners))
            assert row['promotion_tier'] == tier
            assert set(row['target_project_ids']) == {a['public_project_id'], b['public_project_id']}
            for kind, ref in [('project', a['public_project_id']), ('project_group', group), ('corporate', 'sena')]:
                listing = await call(db, ids['editor'], 'select hub.workspace_promotions($1,$2)', kind, ref)
                found = next(item for item in listing['items'] if item['id'] == row['id'])
                assert found['promotion_tier'] == tier and found['applies_via'] == tier
            changed = await command(db, ids['editor'], 'update', row, highlight_badge={'th': 'ข้อเสนอพิเศษ'})
            assert changed['highlight_badge'] == {'th': 'ข้อเสนอพิเศษ'}
            for level in ('view', 'edit'):
                await selected(db, ids['editor'], 'promotions', level, [a['rem_project_id']])
            await selected(db, ids['editor'], 'projects', 'view', [a['rem_project_id']])
            before = await db.fetchval('select to_jsonb(p) from hub.public_promotions p where id=$1', UUID(row['id']))
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await command(db, ids['editor'], 'create', **(draft(a['id']) | owners))
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await command(db, ids['editor'], 'update', changed, excluded_project_ids=[str(b['id'])])
            assert await db.fetchval('select to_jsonb(p) from hub.public_promotions p where id=$1', UUID(row['id'])) == before
    asyncio.run(check())
