"""C5 real promotion versions retain DATA/LEGAL and public media boundaries."""
import asyncio
import json
from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_permission_baseline import disposable_operator, ROOT
from test_permission_content import call, set_bit
from test_permission_foundations import permission_accounts, h
from test_project_content_core import runtime
from test_unit_type_workflow import project


def draft(project_id, **changes):
    text = {'th': 'Synthetic terms', 'en': 'Synthetic terms'}
    return {'project_id': str(project_id), 'code': 'C5-' + uuid4().hex.upper(), 'synthetic': False,
            **{key: text for key in ('title', 'summary', 'conditions_public', 'legal_terms', 'disclaimer')},
            'benefit_type': 'other', 'starts_at': (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
            'ends_at': (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(), **changes}


async def command(db, actor, action, item=None, **values):
    return await call(db, actor, 'select hub.promotion_command($1,$2,$3)', action, UUID(item['id']) if item else None,
                      ({'expected_revision': item['draft_revision']} if item else {}) | values)


async def english(db, actor, item):
    for t in item['translations']:
        if t['th_text'].strip():
            await call(db, actor, 'select hub.review_content_translation($1,$2,$3,$4)', UUID(t['id']), t['revision'], t['th_version'], t['entered_en'])
    return await call(db, actor, 'select hub.promotion_read($1)', UUID(item['id']))


def test_real_promotion_scopes_manual_english_four_eyes_and_environment_guard(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            p = await project(db, ids['editor'])
            row = await command(db, ids['editor'], 'create', **draft(p['id'], audience='investor',
                                targets=[{'type': 'project', 'id': p['id']}], booking_from=date.today().isoformat(),
                                booking_to=(date.today() + timedelta(days=5)).isoformat()))
            assert row['synthetic'] is False and row['demo_fields'] == [] and row['audience'] == 'investor'
            assert row['targets'] == [{'type': 'project', 'id': p['id']}]
            assert any(i['field'].endswith('.en') for i in row['readiness']['missing'])
            assert await call(db, ids['editor'], 'select count(*) from hub.translation_jobs j join hub.content_translations t on t.id=j.translation_id where t.owner_key=$1', row['id']) == 0
            row = await english(db, ids['editor'], row)
            assert not any(i['field'].endswith('.en') for i in row['readiness']['missing'])
            await set_bit(ids['editor'], 'promotions', can_edit=False, can_approve=True)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await command(db, ids['editor'], 'review', row, review_type='DATA', decision='APPROVED', evidence='Synthetic evidence', change_reason='Synthetic')
            row = await command(db, ids['publisher'], 'review', row, review_type='DATA', decision='APPROVED', evidence='Synthetic evidence', change_reason='Synthetic')
            assert not row['readiness']['ready']  # LEGAL is still required.
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.promotion_target_projects($1)', UUID(row['id']))
            for role in ('viewer', 'agency', 'service_consumer', 'pending'):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await command(db, ids[role], 'create', **draft(p['id']))
            with pytest.raises(asyncpg.InvalidParameterValueError):
                await command(db, ids['admin'], 'update', row, synthetic=True)
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('changes', [
    {'audience': 'all'}, {'targets': [{'type': 'unrestricted', 'id': str(uuid4())}]},
    {'targets': [{'type': 'project', 'id': str(uuid4())}]}, {'booking_from': '2026-10-22'},
    {'booking_from': '2026-10-22', 'booking_to': '2026-10-21'},
    {'transfer_from': '2026-10-22', 'transfer_to': '2026-10-21'},
])
def test_real_promotion_sql_rejects_unknown_scopes_and_bad_windows(permission_accounts, changes):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            p = await project(db, ids['editor'])
            with pytest.raises((asyncpg.CheckViolationError, asyncpg.InvalidParameterValueError)):
                await command(db, ids['editor'], 'create', **draft(p['id'], **changes))
        finally:
            await db.close()
    asyncio.run(check())


def test_real_promotion_public_targets_banners_frozen_drafts_and_revoked_rights(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await disposable_operator(); transaction = db.transaction(); await transaction.start()
        try:
            fixture = (ROOT / 'supabase/tests/residential_demo.sql').read_text(encoding='utf-8').split('-- Every new table')[0].replace('begin;', '', 1)
            await db.execute(fixture)
            first = await db.fetchrow("select id,public_project_id,brand_id from hub.projects where id=current_setting('test.residential_project')::uuid")
            await db.execute(fixture.replace('SQL-RESIDENTIAL-21', 'SQL-RESIDENTIAL-21B').replace('sql-residential', 'sql-residential-b').replace('SYNTHETIC:SQL:000021', 'SYNTHETIC:SQL:000021B'))
            second = await db.fetchrow("select id,public_project_id,brand_id from hub.projects where id=current_setting('test.residential_project')::uuid")
            await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
            await db.execute('SET LOCAL SESSION AUTHORIZATION hub_runtime')
            assert tuple(await db.fetchrow('select rolsuper,rolbypassrls from pg_roles where rolname=session_user')) == (False, False)
            row = await command(db, ids['editor'], 'create', **draft(first['id'], targets=[{'type': 'brand', 'id': str(second['brand_id'])}]))
            checksum = uuid4().hex + uuid4().hex
            uploaded = await call(db, ids['editor'], 'select hub.register_uploaded_asset($1)', {
                'original_filename': 'synthetic-promotion.png', 'mime_type': 'image/png', 'asset_type': 'image', 'storage_path': checksum + '.png',
                'checksum': checksum, 'file_size': 100, 'width': 10, 'height': 10})
            asset = UUID(uploaded['asset']['id'])
            await call(db, ids['editor'], 'select hub.media_save_asset($1,$2,0,$3)', first['public_project_id'], asset, {
                'media_category': 'promotion_ad', 'metadata_state': 'confirmed', 'marketing_publication': True, 'ai_exposure': 'web_only',
                'caption': {'th': 'Synthetic banner', 'en': 'Synthetic banner'}, 'alt_text': {'th': 'Synthetic banner', 'en': 'Synthetic banner'},
                'image_kind': 'render', 'people': 'absent', 'third_party_marks': 'absent'})
            await call(db, ids['editor'], 'select hub.media_link_save($1,$2,0,$3)', first['public_project_id'], uuid4(), {
                'asset_id': str(asset), 'target_type': 'promotion', 'target_key': row['id'], 'usage': 'banner', 'ai_exposure': 'open'})
            approved_asset = await call(db, ids['publisher'], "select hub.review_asset(id,updated_at,'approved','Synthetic rights',null,null,'Synthetic') from hub.assets where id=$1", asset)
            assert approved_asset['rights_status'] == 'approved'
            changed = await call(db, ids['editor'], 'select hub.promotion_read($1)', UUID(row['id']))
            assert changed['draft_revision'] == row['draft_revision'] + 1
            other_media = await call(db, ids['editor'], 'select hub.project_media($1)', second['public_project_id'])
            assert any(str(p['key']) == row['id'] for p in other_media['context']['promotions'])
            other_checklist = await call(db, ids['editor'], 'select hub.media_checklist($1)', second['public_project_id'])
            promotion_checks = [i for i in other_checklist['items'] if i['rule_key'] == 'promotion_banner']
            primary_checklist = await call(db, ids['editor'], 'select hub.media_checklist($1)', first['public_project_id'])
            primary_checks = [i for i in primary_checklist['items'] if i['rule_key'] == 'promotion_banner']
            assert any(i['key'] == row['id'] and i['count'] == 1 for i in primary_checks), primary_checks
            assert any(i['key'] == row['id'] and i['count'] == 1 for i in promotion_checks), promotion_checks
            row = await english(db, ids['editor'], changed)
            for review_type in ('DATA', 'LEGAL'):
                row = await command(db, ids['publisher'], 'review', row, review_type=review_type, decision='APPROVED', evidence='Synthetic evidence', change_reason='Synthetic')
            assert row['readiness']['ready']
            row = await command(db, ids['publisher'], 'publish', row, expected_published_version_id=None, change_reason='Synthetic')
            assert row['published']['payload']['banners'][0]['ai_exposure'] == 'web_only'
            public = await call(db, ids['viewer'], "select jsonb_agg(payload order by public_project_id) from public_api.read_promotions() where code=$1", row['code'])
            assert {p['public_project_id'] for p in public} == {first['public_project_id'], second['public_project_id']}
            assert len(public[0]['banners']) == 1
            assert public[0]['targets'][0]['type'] == 'brand' and public[0]['targets'][0]['public_id'].startswith('brd_')
            assert str(second['brand_id']) not in json.dumps(public) and str(asset) not in json.dumps(public)
            public_asset = public[0]['banners'][0]['public_asset_id']
            assert await call(db, ids['viewer'], 'select hub.public_asset_file($1)', public_asset)
            draft_row = await command(db, ids['editor'], 'update', row, audience='livnex', targets=[])
            assert await call(db, ids['viewer'], "select jsonb_agg(payload order by public_project_id) from public_api.read_promotions() where code=$1", row['code']) == public
            assert draft_row['audience'] == 'livnex'
            await call(db, ids['publisher'], "select hub.review_asset(id,updated_at,'revoked','Synthetic revoked rights',null,null,'Synthetic') from hub.assets where id=$1", asset)
            after = await call(db, ids['viewer'], "select payload from public_api.read_promotions() where code=$1 limit 1", row['code'])
            assert after['banners'] == []
            with pytest.raises(asyncpg.NoDataFoundError):
                await call(db, ids['viewer'], 'select hub.public_asset_file($1)', public_asset)
            await command(db, ids['publisher'], 'review', draft_row, review_revision=row['draft_revision'], review_type='LEGAL', decision='REVOKED', evidence='Synthetic revocation', change_reason='Synthetic')
            assert await call(db, ids['viewer'], "select count(*) from public_api.read_promotions() where code=$1", row['code']) == 0
        finally:
            await transaction.rollback(); await db.close()
    asyncio.run(check())


def test_promotion_reference_http_permissions(permission_accounts):
    client, _ = permission_accounts
    path = '/v1/admin/promotions/references'
    assert client.get(path).status_code == 401
    assert client.get(path, headers=h('editor')).status_code == 200
    for role in ('agency', 'service_consumer', 'pending'):
        assert client.get(path, headers=h(role)).status_code == 403
