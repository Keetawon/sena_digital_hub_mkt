"""Disclosure evidence follows saved comparison sources on a disposable database."""
import asyncio
from contextlib import asynccontextmanager
import json
from uuid import UUID

import asyncpg
import pytest

from test_content_workflow import approve_item
from test_permission_baseline import disposable_operator
from test_permission_content import call
from test_permission_foundations import permission_accounts
from test_project_commercial import english, save, workspace
from test_website_content import project_fixture


SOURCE = {
    'area_rai': 1, 'area_ngan': 0, 'area_square_wah': 0,
    'total_unit': 120, 'total_unit_count': 118,
    'rem_bu_id': 'SYNTHETIC-BU-A',
    'buildings': [
        {'building_key': 'reviewed', 'name': {'th': 'Synthetic reviewed tower'},
         'floors_above': 12, 'unit_count': 118},
        {'building_key': 'unregistered', 'name': {'th': 'Synthetic unused tower'},
         'floors_above': 30, 'unit_count': 600},
    ],
}


@asynccontextmanager
async def fixture(actor, source=None):
    # Existing attested disposable operator; ordinary content writes below run
    # through hub_app. Roll back staging, source drafts, reviews and audit rows.
    db = await disposable_operator()
    await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
    transaction = db.transaction()
    await transaction.start()
    try:
        project = await project_fixture(db, actor)
        imported = (source or SOURCE) | {'project_id': project['rem_project_id']}
        await db.execute("""insert into staging.dw_projects
            (rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance)
            values($1,$2,clock_timestamp(),repeat('d',64),'{}')""",
            project['rem_project_id'], imported)
        yield db, project, imported
    finally:
        await transaction.rollback()
        await db.close()


async def fact(db, actor, project, key, number, *, choice=None, revision=0, grain='project'):
    body = {'value_number': number, 'as_of': '2026-10-21',
            'override_reason': 'Synthetic saved comparison value checked independently'}
    if choice is not None:
        body['unit_count_choice'] = choice
    return await call(db, actor, 'select hub.save_project_fact($1,$2,$3,$4,$5)',
                      project['public_project_id'], key, grain, revision, body)


async def building(db, actor, project, key='reviewed', *, imported=False, units=118, revision=0):
    body = {'use_rem': True} if imported else {
        'name': {'th': 'Synthetic manual tower'}, 'floors_above': 9, 'unit_count': units,
    }
    return await call(db, actor, 'select hub.save_project_building($1,$2,$3,$4)',
                      project['public_project_id'], key, revision, body)


async def disclosure(db, ids, project, changes=None):
    item = await save(db, ids['editor'], project['public_project_id'], 'disclosures', changes)
    await english(db, ids['editor'], project['public_project_id'], item['id'])
    identity = {'id': item['id']}
    approved = await approve_item(db, ids, 'disclosure', identity)
    version = await db.fetchval('select to_jsonb(v) from hub.project_commercial_versions v where id=$1',
                               UUID(approved['version_id']))
    assert approved['state'] == 'APPROVED' and not approved['needs_reapproval']
    return identity, approved, version


async def imported_update(db, project, source):
    await db.execute("""update staging.dw_projects set source_record=$2,
        source_snapshot_at=clock_timestamp() where rem_project_id=$1""", project['rem_project_id'], source)


async def read(db, ids, identity, actor='publisher'):
    return await call(db, ids[actor], 'select hub.content_workflow_read($1,$2)', 'disclosure', identity)


async def assert_frozen_and_private(db, ids, project, identity, version, *, invalidated):
    current = await read(db, ids, identity)
    assert current['needs_reapproval'] is invalidated
    stored = await db.fetchval('select to_jsonb(v) from hub.project_commercial_versions v where id=$1',
                               UUID(version['id']))
    for key in ('payload', 'source_snapshot', 'staged_evidence', 'editors', 'approved_by', 'approved_at'):
        assert stored[key] == version[key], key
    assert bool(stored['staged_invalidated_at']) is invalidated
    assert '_disclosure_sources' not in json.dumps(current)
    for actor in ('publisher', 'viewer'):
        visible = await workspace(db, ids[actor], project['public_project_id'])
        assert '_disclosure_sources' not in json.dumps(visible)
    assert (await read(db, ids, identity, 'viewer'))['staged_evidence'] is None
    count = await db.fetchval("""select count(*) from audit.change_log
        where table_name='hub.project_commercial_versions' and after_row->>'id'=$1
        and after_row->>'staged_invalidated_at' is not null""", version['id'])
    if invalidated:
        assert count == 1
        event = await db.fetchval("""select id from audit.change_log
            where table_name='hub.project_commercial_versions' and after_row->>'id'=$1
            and after_row->>'staged_invalidated_at' is not null order by id desc limit 1""", version['id'])
        history = await call(db, ids['publisher'], 'select hub.content_history_event($1,$2,$3)',
                             'project', project['public_project_id'], event)
        assert history['action'] == 'needs_reapproval'
        assert history['after']['staged_evidence'] == current['staged_evidence']
        assert '_disclosure_sources' not in json.dumps(history)
        assert 'rem_bu_id' not in json.dumps(history['after']['staged_evidence'])
        assert 'source_snapshot_at' not in json.dumps(history['after']['staged_evidence'])
        hidden = await call(db, ids['editor'], 'select hub.content_history_event($1,$2,$3)',
                            'project', project['public_project_id'], event)
        assert 'staged_evidence' not in hidden['after']
        assert '_disclosure_sources' not in json.dumps(hidden)
        # W3's existing Legal-history boundary is stricter than the metadata
        # reader: ordinary View cannot open a disclosure audit event at all.
        with pytest.raises(asyncpg.NoDataFoundError, match='History event not found'):
            await call(db, ids['viewer'], 'select hub.content_history_event($1,$2,$3)',
                       'project', project['public_project_id'], event)
    else:
        assert count == 0
    # Projection reads cannot create another effective review or audit write.
    assert await db.fetchval("""select count(*) from audit.change_log
        where table_name='hub.project_commercial_versions' and after_row->>'id'=$1
        and after_row->>'staged_invalidated_at' is not null""", version['id']) == count
    return current


@pytest.mark.parametrize('mode', ['missing', 'manual_override', 'marketing_equal_rem'])
def test_manual_disclosure_does_not_acquire_unrelated_raw_rem_dependencies(permission_accounts, mode):
    _, ids = permission_accounts

    async def check():
        async with fixture(ids['editor']) as (db, project, source):
            changes = {}
            if mode != 'missing':
                units = 120 if mode == 'marketing_equal_rem' else 119
                area = await fact(db, ids['editor'], project, 'project.land_area_sqwah', 450)
                units_fact = await fact(db, ids['editor'], project, 'project.unit_total', units, choice='marketing')
                assert area['source'] == 'mkt'
                # The legacy writer labels coincidentally equal marketing
                # values rem; its explicit saved source choice still wins.
                assert units_fact['rem_value']['choice'] == 'marketing'
                await building(db, ids['editor'], project, units=units)
                changes = {'land_area_sqwah': 450, 'unit_total': units, 'building_count': 1, 'override_reason': None}
            identity, approved, version = await disclosure(db, ids, project, changes)
            assert approved['staged_evidence'] == {'approved': {}, 'current': {}}
            assert version['staged_evidence']['_disclosure_sources'] == {'facts': {}, 'building_keys': []}
            changed = source | {'area_rai': 9, 'total_unit': 999, 'total_unit_count': 888,
                                'rem_bu_id': 'SYNTHETIC-BU-B',
                                'buildings': source['buildings'] + [{'building_key': 'extra', 'unit_count': 900}]}
            await imported_update(db, project, changed)
            current = await assert_frozen_and_private(db, ids, project, identity, version, invalidated=False)
            assert current['expected_hash'] == approved['expected_hash']
    asyncio.run(check())


@pytest.mark.parametrize('choice,used,unused', [
    ('rem_total', 'total_unit', 'total_unit_count'),
    ('rem_counted', 'total_unit_count', 'total_unit'),
])
def test_disclosure_tracks_the_saved_project_count_choice_and_no_other_grain(permission_accounts, choice, used, unused):
    _, ids = permission_accounts

    async def check():
        async with fixture(ids['editor']) as (db, project, source):
            units = source[used]
            await fact(db, ids['editor'], project, 'project.land_area_sqwah', 450)
            selected = await fact(db, ids['editor'], project, 'project.unit_total', units, choice=choice)
            assert selected['source'] == 'rem'
            await fact(db, ids['editor'], project, 'project.unit_total', 7,
                       choice='marketing', grain='phase:' + project['rem_project_id'])
            await building(db, ids['editor'], project, units=units)
            identity, approved, version = await disclosure(db, ids, project, {
                'land_area_sqwah': 450, 'unit_total': units, 'building_count': 1, 'override_reason': None})
            assert approved['staged_evidence']['approved'] == {'project.unit_total': units}
            changed = source | {unused: 777, 'area_rai': 8, 'rem_bu_id': 'SYNTHETIC-BU-B'}
            await imported_update(db, project, changed)
            current = await assert_frozen_and_private(db, ids, project, identity, version, invalidated=False)
            assert current['expected_hash'] == approved['expected_hash']
            await imported_update(db, project, changed | {used: units + 1})
            current = await assert_frozen_and_private(db, ids, project, identity, version, invalidated=True)
            assert current['staged_evidence'] == {
                'approved': {'project.unit_total': units}, 'current': {'project.unit_total': units + 1}}
            assert current['can_approve'] is False
    asyncio.run(check())


def test_used_area_drift_is_visible_but_frozen_draft_and_review_survive(permission_accounts):
    _, ids = permission_accounts

    async def check():
        async with fixture(ids['editor']) as (db, project, source):
            await fact(db, ids['editor'], project, 'project.land_area_sqwah', 400)
            await fact(db, ids['editor'], project, 'project.unit_total', 119, choice='marketing')
            await building(db, ids['editor'], project, units=119)
            identity, approved, version = await disclosure(db, ids, project, {
                'land_area_sqwah': 400, 'unit_total': 119, 'building_count': 1, 'override_reason': None})
            assert approved['staged_evidence']['approved'] == {'project.land_area_sqwah': 400}
            await imported_update(db, project, source | {'area_rai': 2})
            current = await assert_frozen_and_private(db, ids, project, identity, version, invalidated=True)
            assert current['staged_evidence']['current'] == {'project.land_area_sqwah': 800}
    asyncio.run(check())


def test_disclosure_uses_only_registered_imported_building_units(permission_accounts):
    _, ids = permission_accounts

    async def check():
        async with fixture(ids['editor']) as (db, project, source):
            await fact(db, ids['editor'], project, 'project.land_area_sqwah', 450)
            await fact(db, ids['editor'], project, 'project.unit_total', 118, choice='marketing')
            await building(db, ids['editor'], project, imported=True)
            await building(db, ids['editor'], project, 'local', units=0)
            identity, approved, version = await disclosure(db, ids, project, {
                'land_area_sqwah': 450, 'unit_total': 118, 'building_count': 2, 'override_reason': None})
            assert approved['staged_evidence']['approved'] == {'disclosure.building_units': {'reviewed': 118}}
            changed = source | {'buildings': [source['buildings'][0] | {'floors_above': 99, 'name': {'th': 'New unused name'}},
                                              source['buildings'][1] | {'unit_count': 999},
                                              {'building_key': 'extra', 'unit_count': 9999}]}
            await imported_update(db, project, changed)
            current = await assert_frozen_and_private(db, ids, project, identity, version, invalidated=False)
            assert current['expected_hash'] == approved['expected_hash']
            await imported_update(db, project, changed | {'buildings': [changed['buildings'][0] | {'unit_count': 119}, *changed['buildings'][1:]]})
            current = await assert_frozen_and_private(db, ids, project, identity, version, invalidated=True)
            assert current['staged_evidence']['current'] == {'disclosure.building_units': {'reviewed': 119}}
    asyncio.run(check())


def test_incomplete_building_sum_is_not_an_imported_disclosure_dependency(permission_accounts):
    _, ids = permission_accounts

    async def check():
        async with fixture(ids['editor']) as (db, project, source):
            await fact(db, ids['editor'], project, 'project.land_area_sqwah', 450)
            await fact(db, ids['editor'], project, 'project.unit_total', 119, choice='marketing')
            await building(db, ids['editor'], project, imported=True)
            await building(db, ids['editor'], project, 'unknown', units=None)
            identity, approved, version = await disclosure(db, ids, project, {
                'land_area_sqwah': 450, 'unit_total': 119, 'building_count': 2, 'override_reason': None})
            assert approved['staged_evidence']['approved'] == {}
            await imported_update(db, project, source | {'buildings': [source['buildings'][0] | {'unit_count': 999}]})
            await assert_frozen_and_private(db, ids, project, identity, version, invalidated=False)
    asyncio.run(check())


def test_frozen_count_selector_is_not_retargeted_by_a_later_fact_save(permission_accounts):
    _, ids = permission_accounts

    async def check():
        async with fixture(ids['editor'], SOURCE | {'total_unit_count': 120}) as (db, project, source):
            await fact(db, ids['editor'], project, 'project.land_area_sqwah', 450)
            selected = await fact(db, ids['editor'], project, 'project.unit_total', 120, choice='rem_total')
            await building(db, ids['editor'], project, units=120)
            identity, approved, version = await disclosure(db, ids, project, {
                'land_area_sqwah': 450, 'unit_total': 120, 'building_count': 1, 'override_reason': None})
            assert version['staged_evidence']['_disclosure_sources']['facts'] == {'project.unit_total': 'unit_total'}
            await fact(db, ids['editor'], project, 'project.unit_total', 120, choice='rem_counted', revision=selected['revision'])
            current = await assert_frozen_and_private(db, ids, project, identity, version, invalidated=False)
            # Only the selected source changed: no number, parent form stamp,
            # workflow command hash or approval material may change for that.
            assert current['expected_hash'] == approved['expected_hash']
            await imported_update(db, project, source | {'total_unit_count': 121})
            await assert_frozen_and_private(db, ids, project, identity, version, invalidated=False)
            await imported_update(db, project, source | {'total_unit': 122, 'total_unit_count': 121})
            current = await assert_frozen_and_private(db, ids, project, identity, version, invalidated=True)
            assert current['staged_evidence']['current'] == {'project.unit_total': 122}
    asyncio.run(check())


def test_frozen_building_keys_survive_local_reassignment_and_ignore_new_rows(permission_accounts):
    _, ids = permission_accounts

    async def check():
        async with fixture(ids['editor']) as (db, project, source):
            await fact(db, ids['editor'], project, 'project.land_area_sqwah', 450)
            await fact(db, ids['editor'], project, 'project.unit_total', 118, choice='marketing')
            original = await building(db, ids['editor'], project, imported=True)
            identity, _, version = await disclosure(db, ids, project, {
                'land_area_sqwah': 450, 'unit_total': 118, 'building_count': 1})
            assert version['staged_evidence']['_disclosure_sources']['building_keys'] == ['reviewed']
            await building(db, ids['editor'], project, units=118, revision=original['revision'])
            await building(db, ids['editor'], project, 'unregistered', imported=True)
            changed = source | {'buildings': [source['buildings'][0], source['buildings'][1] | {'unit_count': 777}]}
            await imported_update(db, project, changed)
            await assert_frozen_and_private(db, ids, project, identity, version, invalidated=False)
            await imported_update(db, project, changed | {'buildings': [changed['buildings'][0] | {'unit_count': 119}, changed['buildings'][1]]})
            current = await assert_frozen_and_private(db, ids, project, identity, version, invalidated=True)
            assert current['staged_evidence']['current'] == {'disclosure.building_units': {'reviewed': 119}}
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['publisher'], 'select hub.content_workflow_staged_values($1,$2)', 'disclosure', {})
    asyncio.run(check())


def test_used_import_change_denies_pending_approval_but_preserves_manual_neighbour(permission_accounts):
    _, ids = permission_accounts

    async def check():
        async with fixture(ids['editor']) as (db, project, source):
            group = 'DISCLOSURE-' + project['public_project_id']
            source = source | {'rem_project_group_id': group}
            await imported_update(db, project, source)
            await fact(db, ids['editor'], project, 'project.land_area_sqwah', 400)
            await fact(db, ids['editor'], project, 'project.unit_total', 119, choice='marketing')
            await building(db, ids['editor'], project, units=119)
            item = await save(db, ids['editor'], project['public_project_id'], 'disclosures', {
                'land_area_sqwah': 400, 'unit_total': 119, 'building_count': 1, 'override_reason': None})
            await english(db, ids['editor'], project['public_project_id'], item['id'])
            identity = {'id': item['id']}
            current = await read(db, ids, identity, 'editor')
            submitted = await call(db, ids['editor'], 'select hub.content_workflow_submit($1,$2,$3)',
                                   'disclosure', identity, current['expected_hash'])
            version = await db.fetchval('select to_jsonb(v) from hub.project_commercial_versions v where id=$1',
                                       UUID(submitted['version_id']))
            neighbour = await project_fixture(db, ids['editor'])
            await db.execute("""insert into staging.dw_projects
                (rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance)
                values($1,$2,clock_timestamp(),repeat('d',64),'{}')""",
                neighbour['rem_project_id'], source | {'project_id': neighbour['rem_project_id']})
            other_identity, other_approved, other_version = await disclosure(db, ids, neighbour)
            await imported_update(db, project, source | {'area_rai': 2})
            changed = await assert_frozen_and_private(db, ids, project, identity, version, invalidated=True)
            assert changed['state'] == 'IN_REVIEW' and not changed['can_approve']
            assert changed['staged_evidence'] == {
                'approved': {'project.land_area_sqwah': 400}, 'current': {'project.land_area_sqwah': 800}}
            with pytest.raises(asyncpg.SerializationError, match='Relevant imported values changed'):
                await call(db, ids['publisher'], "select hub.content_workflow_review($1,$2,$3,'approve',null)",
                           'disclosure', identity, changed['expected_hash'])
            still_pending = await db.fetchval('select to_jsonb(v) from hub.project_commercial_versions v where id=$1',
                                             UUID(version['id']))
            assert still_pending['state'] == 'in_review' and still_pending['approved_by'] is None
            other = await assert_frozen_and_private(db, ids, neighbour, other_identity, other_version, invalidated=False)
            assert other['state'] == 'APPROVED' and other['expected_hash'] == other_approved['expected_hash']
    asyncio.run(check())
