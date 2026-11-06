"""C5 runtime permissions, frozen reviews, private Legal evidence and validity."""
import asyncio
from datetime import date, datetime, timedelta
from uuid import UUID, uuid4

import asyncpg
import pytest
from pydantic import ValidationError

from sena_hub_api.project_commercial import SaveCommercial
from content_workflow_fixture import decide_item
from test_permission_baseline import disposable_operator
from test_permission_content import call, set_bit
from test_permission_foundations import permission_accounts, h
from test_project_content_core import runtime
from test_unit_type_workflow import project


def body(kind):
    today = date.today().isoformat()
    text = {'th': 'Synthetic reviewed content', 'en': 'Synthetic reviewed content'}
    if kind == 'disclosures':
        return {**{k: text for k in ('owner_company', 'owner_address', 'managing_director', 'legal_project_name', 'location_text', 'building_description')},
                'registered_capital': 1000, 'paid_capital': 500, 'land_area_sqwah': 400, 'building_count': 1, 'unit_total': 10,
                'title_deeds': ['0007'], 'land_numbers': ['0009'], 'encumbrance': 'none', 'eia_status': 'not_required',
                'construction_start_year': 2025, 'construction_completion_year': 2027, 'basis': 'mkt_entered',
                'override_reason': 'Synthetic source comparison checked independently', 'ai_exposure': 'web_only'}
    if kind == 'sales-terms':
        return {'booking_fee': 0, 'contract_fee': 20000, 'down_payment': None, 'installment_from': 5000,
                'installment_basis': text, 'interest_rate': 3, 'rate_period': text, 'lender': text, 'conditions': text,
                'valid_from': today, 'valid_to': (date.today() + timedelta(days=30)).isoformat(), 'ai_exposure': 'web_only'}
    if kind == 'programmes':
        return {'programme_key': 'synthetic-programme', 'participating': True, 'monthly_from': 6000, 'basis': text,
                'units_offered': None, 'as_of': today, 'ai_exposure': 'web_only'}
    return {'component': 'overall', 'percent': 42.5, 'as_of': today, 'source': 'construction', 'ai_exposure': 'web_only'}


async def workspace(db, actor, key):
    return await call(db, actor, 'select hub.project_commercial_workspace($1)', key)


async def save(db, actor, key, kind, changes=None, record=None, stamp=None):
    data = await workspace(db, actor, key)
    return await call(db, actor, 'select hub.save_project_commercial($1,$2,$3,$4,$5)', key, kind,
                      UUID(record) if record else None, datetime.fromisoformat(stamp or data['project']['updated_at']), body(kind) | (changes or {}))


async def review(db, actor, key, kind, record, decision):
    if decision in ('return', 'withdraw'):
        workflow_kind = {'disclosures': 'disclosure', 'sales-terms': 'sales_term', 'programmes': 'programme', 'construction': 'progress'}[kind]
        return await decide_item(db, actor, workflow_kind, {'id': record}, decision)
    data = await workspace(db, actor, key)
    return await call(db, actor, 'select hub.review_project_commercial($1,$2,$3,$4,$5)', key, kind, UUID(record),
                      datetime.fromisoformat(data['project']['updated_at']), decision)


async def english(db, actor, key, record):
    for t in (await workspace(db, actor, key))['translations']:
        if t['owner_key'] == record and t['th_text'].strip():
            await call(db, actor, 'select hub.review_content_translation($1,$2,$3,$4)', UUID(t['id']), t['revision'], t['th_version'], t['entered_en'] or t['th_text'])


@pytest.mark.parametrize('kind', ['disclosures', 'sales-terms', 'programmes', 'construction'])
def test_commercial_frozen_review_four_eyes_return_withdraw_and_no_provider_jobs(permission_accounts, kind):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            p = await project(db, ids['editor']); key = p['public_project_id']
            before = await call(db, ids['viewer'], 'select hub.project_versions($1)', UUID(p['id']))
            item = await save(db, ids['editor'], key, kind); record = item['id']
            if kind != 'construction':
                with pytest.raises(asyncpg.CheckViolationError):
                    await review(db, ids['editor'], key, kind, record, 'submit')
            await english(db, ids['editor'], key, record)
            assert await call(db, ids['editor'], "select count(*) from hub.translation_jobs j join hub.content_translations t on t.id=j.translation_id where t.owner_key=$1", record) == 0
            await review(db, ids['editor'], key, kind, record, 'submit')
            frozen = (await workspace(db, ids['viewer'], key))['records'][kind][0]
            assert frozen['state'] == 'in_review'
            with pytest.raises(asyncpg.CheckViolationError):
                await save(db, ids['editor'], key, kind, record=record)
            await set_bit(ids['editor'], 'projects', can_edit=False, can_approve=True)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await review(db, ids['editor'], key, kind, record, 'approve')
            await review(db, ids['publisher'], key, kind, record, 'approve')
            approved = (await workspace(db, ids['publisher'], key))['records'][kind][0]
            assert approved['state'] == 'approved' and approved['history'][0]['approved_by'] == str(ids['publisher'])
            assert approved['history'][0]['revision'] == frozen['revision']
            await review(db, ids['publisher'], key, kind, record, 'withdraw')
            assert (await workspace(db, ids['viewer'], key))['records'][kind][0]['state'] == 'withdrawn'
            assert await call(db, ids['viewer'], 'select hub.project_versions($1)', UUID(p['id'])) == before
        finally:
            await db.close()
    asyncio.run(check())


def test_legal_file_private_versions_and_source_mismatch(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            p = await project(db, ids['editor']); key = p['public_project_id']
            checksum = uuid4().hex + uuid4().hex
            uploaded = await call(db, ids['editor'], 'select hub.register_uploaded_asset($1)', {
                'original_filename': 'synthetic-legal.pdf', 'mime_type': 'application/pdf', 'asset_type': 'document',
                'storage_path': checksum + '.pdf', 'checksum': checksum, 'file_size': 100})
            asset = uploaded['asset']['id']
            await call(db, ids['editor'], 'select hub.media_save_asset($1,$2,0,$3)', key, UUID(asset),
                       {'media_category': 'legal_document', 'ai_exposure': 'internal', 'marketing_publication': False})
            item = await save(db, ids['editor'], key, 'disclosures', {'legal_document_asset_id': asset, 'legal_doc_ref': 'SYNTHETIC-LEGAL',
                              'legal_doc_date': date.today().isoformat(), 'basis': 'legal_document', 'override_reason': None})
            assert await call(db, ids['publisher'], 'select hub.can_read_asset($1)', UUID(asset))
            assert not await call(db, ids['viewer'], 'select hub.can_read_asset($1)', UUID(asset))
            assert await call(db, ids['viewer'], 'select count(*) from hub.project_disclosures') == 0
            assert (await workspace(db, ids['viewer'], key))['legal_documents'] == []
            visible = (await workspace(db, ids['viewer'], key))['records']['disclosures'][0]
            assert 'legal_document_asset_id' not in visible and 'legal_doc_ref' not in visible
            await english(db, ids['editor'], key, item['id'])
            assert any(i.get('mismatch') for i in (await workspace(db, ids['editor'], key))['records']['disclosures'][0]['readiness']['items'])
            with pytest.raises(asyncpg.CheckViolationError):
                await review(db, ids['editor'], key, 'disclosures', item['id'], 'submit')
            await save(db, ids['editor'], key, 'disclosures', {'legal_document_asset_id': asset}, record=item['id'])
            await english(db, ids['editor'], key, item['id'])
            await review(db, ids['editor'], key, 'disclosures', item['id'], 'submit')
            await review(db, ids['publisher'], key, 'disclosures', item['id'], 'approve')
            visible = (await workspace(db, ids['viewer'], key))['records']['disclosures'][0]
            assert 'legal_document_asset_id' not in visible['history'][0]['payload']
            with pytest.raises(asyncpg.NoDataFoundError):
                await call(db, ids['viewer'], 'select hub.asset_file($1)', UUID(asset))
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], 'select hub.media_job_request($1,$2,$3,$4)', key, 'image_suggestion', UUID(asset), 1)
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('kind,change', [
    ('construction', {'percent': 101}), ('construction', {'percent': -1}), ('construction', {'percent': '50'}),
    ('construction', {'source': 'ai'}), ('construction', {'component': 'readiness'}),
    ('programmes', {'units_offered': 0}), ('programmes', {'monthly_from': -1}), ('programmes', {'participating': 'true'}),
    ('sales-terms', {'interest_rate': 101}), ('sales-terms', {'booking_fee': 'NaN'}),
    ('sales-terms', {'approved_by': str(uuid4())}), ('disclosures', {'paid_capital': -1}),
    ('disclosures', {'paid_capital': 2000}), ('disclosures', {'state': 'approved'}), ('disclosures', {'title_deeds': [7]}),
])
def test_commercial_sql_rejects_forged_sources_and_invalid_values(permission_accounts, kind, change):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            p = await project(db, ids['editor'])
            with pytest.raises((asyncpg.CheckViolationError, asyncpg.InvalidTextRepresentationError)):
                await save(db, ids['editor'], p['public_project_id'], kind, change)
        finally:
            await db.close()
    asyncio.run(check())


def test_commercial_stale_revision_private_helpers_and_revocation(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            p = await project(db, ids['editor']); key = p['public_project_id']
            saved = await save(db, ids['editor'], key, 'construction')
            with pytest.raises(asyncpg.SerializationError):
                await save(db, ids['editor'], key, 'construction', record=saved['id'], stamp=p['updated_at'])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.project_current_commercial($1)', UUID(p['id']))
            for kind in ('disclosures', 'sales-terms', 'programmes', 'construction'):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await save(db, ids['viewer'], key, kind)
            for table in ('project_disclosures', 'project_sales_terms', 'project_programmes', 'project_progress', 'project_commercial_versions'):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await call(db, ids['editor'], f'delete from hub.{table}')
            await set_bit(ids['editor'], 'projects', can_edit=False, can_view=False)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await workspace(db, ids['editor'], key)
            assert await call(db, ids['editor'], "select hub.can('brands','view')")
            for role in ('agency', 'service_consumer', 'pending'):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await workspace(db, ids[role], key)
        finally:
            await db.close()
    asyncio.run(check())


def test_commercial_expiry_future_dates_unknown_participation_and_return(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await runtime()
        try:
            key = (await project(db, ids['editor']))['public_project_id']
            for kind, changes in [('sales-terms', {'valid_from': '2020-01-01', 'valid_to': '2020-02-01'}),
                                  ('programmes', {'participating': None}), ('construction', {'as_of': '2200-01-01'})]:
                saved = await save(db, ids['editor'], key, kind, changes)
                await english(db, ids['editor'], key, saved['id'])
                with pytest.raises(asyncpg.CheckViolationError):
                    await review(db, ids['editor'], key, kind, saved['id'], 'submit')
            saved = await save(db, ids['editor'], key, 'disclosures')
            await english(db, ids['editor'], key, saved['id'])
            await review(db, ids['editor'], key, 'disclosures', saved['id'], 'submit')
            frozen = (await workspace(db, ids['editor'], key))['records']['disclosures'][0]['history'][0]['payload']
            await review(db, ids['publisher'], key, 'disclosures', saved['id'], 'return')
            await save(db, ids['editor'], key, 'disclosures', {'owner_company': {'th': 'Changed company', 'en': 'Changed company'}}, record=saved['id'])
            current = (await workspace(db, ids['editor'], key))['records']['disclosures'][0]
            assert current['history'][0]['payload'] == frozen and not current['readiness']['ready']
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('method,suffix,level', [('GET', '', 'view'), ('POST', '/construction', 'edit'),
    ('PUT', '/construction/00000000-0000-0000-0000-000000000001', 'edit'),
    ('POST', '/construction/00000000-0000-0000-0000-000000000001/submit', 'edit'),
    ('POST', '/construction/00000000-0000-0000-0000-000000000001/review', 'approve')])
def test_commercial_http_permissions(permission_accounts, method, suffix, level):
    client, _ = permission_accounts
    target = '/v1/admin/projects/missing/commercial' + suffix
    assert client.request(method, target).status_code == 401
    for role in ('agency', 'service_consumer', 'pending'):
        assert client.request(method, target, headers=h(role)).status_code == 403
    if level != 'view':
        assert client.request(method, target, headers=h('viewer')).status_code == 403
    if level == 'approve':
        for role in ('editor', 'admin'):
            assert client.request(method, target, headers=h(role)).status_code == 403


@pytest.mark.parametrize('kind,change', [('programmes', {'units_offered': 1}), ('construction', {'percent': True}),
    ('construction', {'percent': float('nan')}), ('construction', {'percent': 101}), ('disclosures', {'registered_capital': -1}),
    ('sales-terms', {'interest_rate': 101}), ('sales-terms', {'approved_by': str(uuid4())})])
def test_commercial_request_validation(kind, change):
    with pytest.raises(ValidationError):
        SaveCommercial(updated_at='2026-10-22T00:00:00Z', record={'kind': kind, **body(kind), **change})


def test_commercial_project_lock_serializes_edits(permission_accounts):
    _, ids = permission_accounts

    async def check():
        first = await runtime(); second = await runtime()
        try:
            p = await project(first, ids['editor'])
            await save(first, ids['editor'], p['public_project_id'], 'construction')
            await second.execute("set local lock_timeout='150ms'")
            with pytest.raises(asyncpg.LockNotAvailableError):
                await save(second, ids['editor'], p['public_project_id'], 'programmes')
        finally:
            await second.close(); await first.close()
    asyncio.run(check())
