"""Phase 7: real runtime authority, revisions, reference evidence and scenarios."""
import asyncio
import csv
import io
import json
from uuid import UUID, uuid4

import asyncpg
import pytest
from fastapi import HTTPException

from sena_hub_api.project_amenities import CSV_FIELDS, reference_rows
from test_permission_content import call, set_bit
from test_permission_foundations import permission_accounts, h
from test_project_content_core import runtime
from test_permission_db_baseline import runtime as unscoped_runtime
from test_unit_type_workflow import create_type


async def project(db, actor):
    return await call(db, actor, "select public_project_id from hub.projects where rem_project_id='DEMO-001'")


def csv_text(*rows):
    out = io.StringIO(newline='')
    writer = csv.DictWriter(out, fieldnames=CSV_FIELDS)
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue()


def reference(code='001', kind='rail_lines', **extra):
    return {'kind': kind, 'code': code, 'expected_revision': '0', 'name_th': 'ข้อมูลอ้างอิงสมมติ',
            'name_en': 'Synthetic reference', 'source_ref': 'Synthetic fixture, not a real place',
            'as_of': '2026-10-21', **extra}


def test_reference_csv_preserves_ids_and_rejects_ambiguous_or_excess_input():
    rows = reference_rows('\ufeff' + csv_text(reference()))
    assert rows[0]['code'] == '001' and rows[0]['expected_revision'] == 0
    assert rows[0]['changes']['name']['en'] == 'Synthetic reference'
    invalid = [csv_text(), 'wrong,headers\n', '"unterminated', csv_text(reference(), reference()),
               csv_text(reference(expected_revision='-1')), csv_text(reference(expected_revision='๑')),
               csv_text(reference(kind='features')), csv_text(*(reference(str(i)) for i in range(201)))]
    for value in invalid:
        with pytest.raises(HTTPException) as error:
            reference_rows(value)
        assert error.value.status_code == 422


@pytest.mark.parametrize('actor', ['viewer', 'publisher', 'online_staff', 'pending', 'agency', 'service_consumer'])
def test_project_writes_and_cover_deny_without_projects_edit(permission_accounts, actor):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            public_id = await project(db, ids['editor'])
            queries = [('select hub.c4_facility_save($1,$2,0,$3)', [public_id, 'lobby', {'status': 'present'}]),
                       ('select hub.c4_item_save($1,$2,$3,0,$4)', [public_id, 'features', uuid4(), {}]),
                       ('select hub.c4_item_save($1,$2,$3,0,$4)', [public_id, 'solar', uuid4(), {}]),
                       ('select hub.c4_item_save($1,$2,$3,0,$4)', [public_id, 'places', uuid4(), {}]),
                       ('select hub.c4_facility_cover($1,$2,$3,0,null,0)', [public_id, 'lobby', uuid4()])]
            for query, args in queries:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids[actor], query, *args)
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('actor', ['viewer', 'editor', 'admin', 'online_staff', 'pending', 'agency', 'service_consumer'])
def test_reference_maintenance_and_solar_review_require_approve(permission_accounts, actor):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            public_id = await project(db, ids['editor'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids[actor], "select hub.c4_reference_save('rail_lines','synthetic',0,'{}')")
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids[actor], "select hub.c4_solar_review($1,$2,1,'approve')", public_id, uuid4())
        finally:
            await db.close()
    asyncio.run(check())


def test_facility_extension_preserves_legacy_notes_and_translation_history(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            public_id = await project(db, ids['editor'])
            sql = "select hub.c4_facility_save($1,'lobby',$2,$3)"
            saved = await call(db, ids['editor'], sql, public_id, 0, {'status': 'present',
                'description': {'th': 'ล็อบบี้สมมติ'}, 'display_name': {'th': 'ล็อบบี้ 1', 'en': 'Lobby 1'},
                'location_note': 'Preserved legacy note', 'location_label': {'th': 'ชั้น 1'},
                'size_sqm': 42.5, 'opening_hours': {'th': 'เวลา 08:00–20:00'}, 'applies_to_project_ids': ['DEMO-001']})
            assert saved['revision'] == 1 and saved['size_sqm'] == 42.5
            translated = await call(db, ids['editor'], 'select hub.content_translation_list($1,$2)', 'projects', public_id)
            name = next(t for t in translated if t['field_key'] == 'facility.display_name' and t['th_text'] == 'ล็อบบี้ 1')
            assert name['job']['status'] == 'queued'
            await call(db, ids['editor'], 'select hub.review_content_translation($1,$2,$3,$4)', UUID(name['id']), name['revision'], name['th_version'], 'Lobby 1')
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], sql, public_id, 1, {'display_name': {'th': 'ร่างเก่า'}})
            saved = next(f for f in (await call(db, ids['viewer'], 'select hub.c4_workspace($1)', public_id))['facilities'] if f['code'] == 'lobby')
            saved = await call(db, ids['editor'], sql, public_id, saved['revision'], {'display_name': {'th': 'ล็อบบี้ใหม่ 1', 'en': 'Lobby 1'}})
            assert saved['location_note'] == 'Preserved legacy note'
            translated = await call(db, ids['editor'], 'select hub.content_translation_list($1,$2)', 'projects', public_id)
            name = next(t for t in translated if t['id'] == name['id'])
            assert name['reviewed_en'] == 'Lobby 1' and name['translation_state'] == 'stale'
            for changes in ({'applies_to_project_ids': ['not-an-existing-phase']}, {'size_sqm': -1}, {'project_id': str(uuid4())}):
                with pytest.raises(asyncpg.CheckViolationError):
                    await call(db, ids['editor'], sql, public_id, saved['revision'], changes)
            # The original facility screen must retain the new details and advance
            # the same revision, so an open Phase 7 draft cannot overwrite its save.
            legacy = {key: saved[key] for key in ('status', 'description', 'location_note', 'access_note', 'evidence_note', 'expected_open_date')}
            legacy['location_note'] = 'Updated in original facility screen'
            await call(db, ids['editor'], "select hub.save_project_facility($1,'lobby',$2,(select updated_at from hub.projects where id=$1))",
                       UUID(saved['project_id']), legacy)
            after = next(f for f in (await call(db, ids['viewer'], 'select hub.c4_workspace($1)', public_id))['facilities'] if f['code'] == 'lobby')
            assert after['revision'] == saved['revision'] + 1
            assert after['location_note'] == legacy['location_note']
            for key in ('display_name', 'location_label', 'size_sqm', 'opening_hours', 'applies_to_project_ids', 'ai_exposure'):
                assert after[key] == saved[key]
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], sql, public_id, saved['revision'], {'size_sqm': 55})
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('metrics', [{'count': -1}, {'count': 1.5}, {'count': '2'}, {'current_type': 'invented'}, {'unknown': 1}])
def test_project_metrics_reject_wrong_types_bounds_and_unknown_keys(permission_accounts, metrics):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            with pytest.raises(asyncpg.CheckViolationError, match='Metrics'):
                await call(db, ids['editor'], "select hub.c4_item_save($1,'features',$2,0,$3)", await project(db, ids['editor']), uuid4(),
                           {'feature_code': 'ev_charger', 'status': 'present', 'metrics': metrics})
        finally:
            await db.close()
    asyncio.run(check())


def test_feature_definition_changes_preserve_saved_metrics_and_glossary_decision(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            public_id = await project(db, ids['editor'])
            saved = await call(db, ids['editor'], "select hub.c4_item_save($1,'features',$2,0,$3)", public_id, uuid4(),
                {'feature_code': 'ev_charger', 'status': 'present', 'metrics': {'count': 2, 'power_kw': 22, 'current_type': 'AC'}, 'detail': {'th': 'จุดชาร์จสมมติ 2 จุด'}})
            with pytest.raises(asyncpg.SerializationError):
                await call(db, ids['editor'], "select hub.c4_item_save($1,'features',$2,0,$3)", public_id, UUID(saved['id']), {'status': 'absent'})
            refs = await call(db, ids['publisher'], 'select hub.c4_references()')
            ev = next(f for f in refs['features'] if f['code'] == 'ev_charger')
            with pytest.raises(asyncpg.CheckViolationError, match='saved project metrics'):
                await call(db, ids['publisher'], "select hub.c4_reference_save('features','ev_charger',$1,$2)", ev['revision'], {'metric_defs': {}})
            non_dee = next(f for f in refs['features'] if f['code'] == 'non_dee')
            assert non_dee['label']['en'] == ''
            with pytest.raises(asyncpg.CheckViolationError, match='Q75'):
                await call(db, ids['publisher'], "select hub.c4_reference_save('features','non_dee',$1,$2)", non_dee['revision'], {'label': {'th': 'นอนดี', 'en': 'Unapproved name'}})
            # Required metrics apply to present/planned assertions, not an unknown answer.
            await call(db, ids['editor'], "select hub.c4_item_save($1,'features',$2,0,$3)", public_id, uuid4(), {'feature_code': 'low_carbon', 'status': 'unknown'})
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['editor'], "select hub.c4_item_save($1,'features',$2,0,$3)", public_id, uuid4(), {'feature_code': 'joint_venture', 'status': 'present'})
            await call(db, ids['publisher'], "select hub.c4_reference_save('features','ev_charger',$1,$2)", ev['revision'], {'active': False})
            updated = await call(db, ids['editor'], "select hub.c4_item_save($1,'features',$2,$3,$4)", public_id, UUID(saved['id']), saved['revision'], {'status': 'absent', 'metrics': {}})
            assert updated['status'] == 'absent'  # Retired definitions do not strand existing drafts.
        finally:
            await db.close()
    asyncio.run(check())


def test_solar_is_entered_scenario_with_manual_english_four_eyes_and_immutable_approval(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            public_id = await project(db, ids['editor'])
            body = {'system_kw': 5, 'battery_kwh': 10, 'usage_profile': {'th': 'รูปแบบการใช้สมมติ'},
                    'bill_before': 4000, 'bill_after': 2500, 'saving_pct': 17,
                    'assumptions': {'th': 'สมมติฐานที่ผู้กรอกกำหนด'}, 'source_note': {'th': 'หลักฐานสมมติ'}, 'as_of': '2026-10-21'}
            saved = await call(db, ids['editor'], "select hub.c4_item_save($1,'solar',$2,0,$3)", public_id, uuid4(), body)
            assert saved['state'] == 'draft' and saved['saving_pct'] == 17  # Never recomputed from bills.
            texts = await call(db, ids['editor'], 'select hub.content_translation_list($1,$2)', 'projects', public_id)
            assert len([t for t in texts if t['owner_key'] == saved['id'] and t['job'] is None]) == 3
            await set_bit(ids['editor'], 'projects', can_edit=False, can_approve=True)
            with pytest.raises(asyncpg.InsufficientPrivilegeError, match='Another person'):
                await call(db, ids['editor'], "select hub.c4_solar_review($1,$2,$3,'approve')", public_id, UUID(saved['id']), saved['revision'])
            approved = await call(db, ids['publisher'], "select hub.c4_solar_review($1,$2,$3,'approve')", public_id, UUID(saved['id']), saved['revision'])
            assert approved['approved_by'] == str(ids['publisher'])
            with pytest.raises(asyncpg.CheckViolationError, match='new scenario'):
                await call(db, ids['admin'], "select hub.c4_item_save($1,'solar',$2,$3,$4)", public_id, UUID(saved['id']), approved['revision'], {'saving_pct': 99})
            withdrawn = await call(db, ids['publisher'], "select hub.c4_solar_review($1,$2,$3,'withdraw')", public_id, UUID(saved['id']), approved['revision'])
            assert withdrawn['state'] == 'withdrawn' and withdrawn['bill_after'] == 2500
        finally:
            await db.close()
    asyncio.run(check())


def test_places_require_valid_reference_and_measurement_pairs_and_real_coordinate_suggestions(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            public_id = await project(db, ids['editor'])
            assert await call(db, ids['viewer'], 'select hub.c4_nearest_stations($1)', public_id) == []
            sql = "select hub.c4_reference_save('rail_stations',$1,$2,$3)"
            source = {'name': {'th': 'สถานีสมมติสำหรับทดสอบเท่านั้น', 'en': 'Synthetic station'}, 'line_code': 'mrt_blue',
                      'status': 'planned', 'expected_open': '2030-01-01', 'source_ref': 'Synthetic fixture, not real coordinates', 'as_of': '2026-10-21'}
            station = await call(db, ids['publisher'], sql, 'test_station_001', 0, source)
            assert await call(db, ids['viewer'], 'select hub.c4_nearest_stations($1)', public_id) == []
            with pytest.raises(asyncpg.CheckViolationError):
                await call(db, ids['publisher'], sql, 'test_station_001', station['revision'], {'latitude': 13.7563})
            await call(db, ids['publisher'], sql, 'test_station_001', station['revision'], {'latitude': 13.7563, 'longitude': 100.5018})
            nearest = await call(db, ids['viewer'], 'select hub.c4_nearest_stations($1)', public_id)
            assert len(nearest) == 1 and nearest[0]['distance_m'] <= 1 and nearest[0]['distance_method'] == 'straight_line'
            place = {'category': 'rail', 'ref_id': 'test_station_001', 'name': source['name'], 'status': 'planned',
                     'expected_open': '2030-01-01', 'as_of': '2026-10-21', 'distance_m': 125, 'distance_method': 'road'}
            saved = await call(db, ids['editor'], "select hub.c4_item_save($1,'places',$2,0,$3)", public_id, uuid4(), place)
            assert saved['show_on_web'] is False and saved['status'] == 'planned'
            for invalid in ({'category': 'mall'}, {'ref_id': 'missing'}, {'distance_method': None}, {'travel_minutes': 5}, {'status': 'operating'}):
                with pytest.raises(asyncpg.CheckViolationError):
                    await call(db, ids['editor'], "select hub.c4_item_save($1,'places',$2,$3,$4)", public_id, UUID(saved['id']), saved['revision'], invalid)
        finally:
            await db.close()
    asyncio.run(check())


def test_revocation_clears_reads_but_preserves_neighbor_and_blocks_direct_dml(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            public_id = await project(db, ids['viewer'])
            assert (await call(db, ids['viewer'], 'select hub.c4_workspace($1)', public_id))['references']['features']
            await set_bit(ids['viewer'], 'projects', can_view=False)
            for query, args in [('select hub.c4_workspace($1)', [public_id]), ('select hub.c4_references()', []), ('select hub.c4_nearest_stations($1)', [public_id])]:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['viewer'], query, *args)
            assert await call(db, ids['viewer'], 'select count(*) from hub.feature_catalog') == 0
            assert await call(db, ids['viewer'], 'select hub.list_brands()') is not None
            for table in ['feature_catalog', 'project_features', 'solar_estimates', 'project_places', 'ref_rail_lines', 'ref_rail_stations', 'ref_expressways', 'ref_expressway_ramps']:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['admin'], f'update hub.{table} set revision=revision+1')
        finally:
            await db.close()
    asyncio.run(check())


def test_items_and_commercial_type_references_cannot_cross_projects(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            public_id = await project(db, ids['editor'])
            other = await call(db, ids['editor'], "select public_project_id from hub.projects where rem_project_id='DEMO-002'")
            if other is None:
                await call(db, ids['editor'], "select hub.create_project_from_rem('DEMO-002')")
                other = await call(db, ids['editor'], "select public_project_id from hub.projects where rem_project_id='DEMO-002'")
            unit = await create_type(db, ids['editor'], await call(db, ids['editor'], 'select hub.project_detail($1)', other))
            with pytest.raises(asyncpg.CheckViolationError, match='another project'):
                await call(db, ids['editor'], "select hub.c4_item_save($1,'features',$2,0,$3)", public_id, uuid4(),
                           {'feature_code': 'smart_home', 'status': 'present', 'commercial_type_id': unit['id']})
            saved = await call(db, ids['editor'], "select hub.c4_item_save($1,'features',$2,0,$3)", other, uuid4(),
                               {'feature_code': 'smart_home', 'status': 'present', 'commercial_type_id': unit['id']})
            with pytest.raises(asyncpg.NoDataFoundError):
                await call(db, ids['editor'], "select hub.c4_item_save($1,'features',$2,1,$3)", public_id, UUID(saved['id']), {'status': 'absent'})
            assert not await call(db, ids['viewer'], 'select hub.media_target($1,$2,$3,$4)',
                                  UUID(await call(db, ids['viewer'], 'select id::text from hub.projects where public_project_id=$1', public_id)), 'feature', saved['id'], 'view')
        finally:
            await db.close()
    asyncio.run(check())


def test_concurrent_facility_edit_has_one_winner_and_preserves_its_value(permission_accounts):
    client, ids = permission_accounts
    code = 'race_' + uuid4().hex
    reference_result = client.put('/v1/admin/place-references/facilities/' + code, headers=h('publisher'),
                                  json={'expected_revision': 0, 'changes': {'name_th': 'ส่วนกลางสมมติ', 'name_en': 'Synthetic facility'}})
    assert reference_result.status_code == 200

    async def check():
        left, right = await unscoped_runtime(), await unscoped_runtime()
        try:
            for db in (left, right):
                await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
            public_id = await project(left, ids['editor'])
            sql = 'select hub.c4_facility_save($1,$2,$3,$4)'
            await call(left, ids['editor'], sql, public_id, code, 0, {'status': 'present', 'size_sqm': 10})
            results = await asyncio.gather(call(left, ids['editor'], sql, public_id, code, 1, {'size_sqm': 21}),
                                           call(right, ids['admin'], sql, public_id, code, 1, {'size_sqm': 34}), return_exceptions=True)
            assert sum(isinstance(r, asyncpg.SerializationError) for r in results) == 1
            winner = next(r for r in results if isinstance(r, dict))
            final = next(f for f in (await call(left, ids['viewer'], 'select hub.c4_workspace($1)', public_id))['facilities'] if f['code'] == code)
            assert final['revision'] == 2 and final['size_sqm'] == winner['size_sqm']
        finally:
            await left.close()
            await right.close()
    asyncio.run(check())


def test_csv_http_preview_is_atomic_apply_rechecks_revisions_and_rejects_neighbors(permission_accounts):
    client, _ = permission_accounts
    code = 'synthetic_' + uuid4().hex
    value = csv_text(reference(code))
    path = '/v1/admin/place-references'
    assert client.get(path + '/template', headers=h('viewer')).json()['data']['content'].strip() == ','.join(CSV_FIELDS)
    for role in ['editor', 'admin', 'viewer', 'agency', 'service_consumer', 'pending']:
        assert client.post(path + '/import', headers=h(role), json={'csv_text': value}).status_code == 403
    preview = client.post(path + '/import', headers=h('publisher'), json={'csv_text': value})
    assert preview.status_code == 200 and preview.json()['data']['applied'] is False
    assert not any(r['code'] == code for r in client.get(path, headers=h('viewer')).json()['data']['rail_lines'])
    invalid_batch = csv_text(reference(code), reference(code + '_bad', kind='rail_stations', line_code='nonexistent', status='planned'))
    assert client.post(path + '/import', headers=h('publisher'), json={'csv_text': invalid_batch, 'apply': True}).status_code == 422
    assert not any(r['code'] == code for r in client.get(path, headers=h('viewer')).json()['data']['rail_lines'])
    applied = client.post(path + '/import', headers=h('publisher'), json={'csv_text': value, 'apply': True})
    assert applied.status_code == 200 and applied.json()['data']['count'] == 1
    assert client.put(path + '/rail_lines/' + code, headers=h('publisher'),
                      json={'expected_revision': 1, 'changes': {'source_ref': '   '}}).status_code == 422
    assert client.post(path + '/import', headers=h('publisher'), json={'csv_text': value, 'apply': True}).status_code == 409
    # Route matching and request validation stay exact even for privileged callers.
    assert client.put(path + '/not-a-kind/' + code, headers=h('publisher'), json={'expected_revision': 0, 'changes': {}}).status_code == 422
