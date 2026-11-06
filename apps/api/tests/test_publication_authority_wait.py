"""Publication authority must survive the real account-decision lock wait."""
import asyncio
from datetime import datetime, timedelta, timezone
import json
from uuid import UUID, uuid4

import asyncpg
import pytest

from content_workflow_fixture import publication_persona, review_fixture_translations
from test_content_workflow import (
    approve_item, contact_body, inventory_asset_fixture, inventory_brand_fixture,
)
from test_permission_baseline import disposable_operator
from test_permission_content import call
from test_permission_db_baseline import runtime
from test_permission_foundations import permission_accounts
from test_website_content import project_fixture


async def publication_fixture(operator, db, ids, created):
    """Distinct author, approver and publisher; all lifecycle writes use hub_app."""
    await publication_persona(ids, operator=operator)
    async with operator.transaction():
        brand = await inventory_brand_fixture(operator, ids['editor'])
    created['brand'] = brand
    asset = await inventory_asset_fixture(db, ids['editor'])
    asset_id = UUID(asset['id'])
    await call(db, ids['editor'], 'select hub.bind_brand_asset($1,$2,$3,$4,$5)',
               brand['id'], asset_id, 'logo_primary', {'th': 'Synthetic lock-wait logo'}, brand['updated_at'])
    async with operator.transaction():
        context = await project_fixture(operator, ids['editor'])
    revision = await operator.fetchval('select media_revision from hub.assets where id=$1', asset_id)
    await call(db, ids['editor'], 'select hub.media_save_asset($1,$2,$3,$4)',
               context['public_project_id'], asset_id, revision,
               {'media_category': 'promotion_ad', 'alt_text': {'th': 'Synthetic lock-wait logo'},
                'metadata_state': 'confirmed', 'ai_exposure': 'web_only', 'marketing_publication': True})
    stamp = await operator.fetchval('select updated_at from hub.assets where id=$1', asset_id)
    await call(db, ids['publisher'], "select hub.review_asset($1,$2,'approved',$3,null,$4,$5)",
               asset_id, stamp, 'Synthetic owned fixture', datetime.now(timezone.utc) + timedelta(days=30),
               'Independent fixture rights review')
    binding = await operator.fetchval(
        'select id from hub.brand_assets where brand_id=$1 and asset_id=$2 and deleted_at is null',
        brand['id'], asset_id)
    await review_fixture_translations(db, ids, 'brands', brand['public_brand_id'])
    for kind, identity in [('brand', {'id': str(brand['id'])}), ('asset', {'id': str(asset_id)}),
                           ('brand_asset', {'id': str(binding)})]:
        await approve_item(db, ids, kind, identity, reason='Independent fixture content review')
    await call(db, ids['viewer'], 'select hub.publish_brand($1,$2)', brand['id'], 'Initial approved brand')

    contact = await call(db, ids['editor'], "select hub.save_content_contact('brand',$1,null,0,$2)",
                         brand['public_brand_id'], contact_body('021111111'))
    await approve_item(db, ids, 'contact', {'id': contact['id']})
    key = 'brand:' + brand['public_brand_id']
    page = await call(db, ids['editor'], 'select hub.web_page_save($1,0,$2)', key,
                      {'url': '/authority-wait/' + uuid4().hex, 'locales': ['th'], 'ai_policy': 'no_ai',
                       'max_faq_items': 20, 'project_ids': []})
    await approve_item(db, ids, 'page_config', {'id': page['id']})
    selection = [{'system': 'web', 'page_key': key}]
    initial = await call(db, ids['viewer'], 'select hub.publication_queue_prepare($1,$2)',
                         selection, 'Initial approved page')
    result = await call(db, ids['viewer'], 'select hub.publication_queue_publish($1,$2)',
                        UUID(initial['id']), initial['digest'])
    assert result['state'] == 'PUBLISHED' and result['page_count'] == 1, result
    await call(db, ids['editor'], "select hub.save_content_contact('brand',$1,$2,$3,$4)",
               brand['public_brand_id'], UUID(contact['id']), contact['revision'], contact_body('022222222'))
    approval = await approve_item(db, ids, 'contact', {'id': contact['id']})
    return {'brand': brand, 'page': page, 'key': key, 'contact': contact,
            'approval': approval, 'selection': selection}


async def observe(operator, ids, fixture):
    """Include pointer/state/audit effects and the complete immutable snapshots."""
    return await operator.fetchval('''select jsonb_build_object(
        'brand',(select to_jsonb(b) from hub.brands b where id=$1),
        'page',(select to_jsonb(p) from hub.web_pages p where id=$2),
        'contact',(select to_jsonb(c) from hub.contacts c where id=$3),
        'reviews',(select coalesce(jsonb_agg(to_jsonb(v) order by version_no),'[]')
            from hub.content_review_versions v where kind='contact' and identity=jsonb_build_object('id',$3::text)),
        'brand_versions',(select coalesce(jsonb_agg(to_jsonb(v) order by version_no),'[]')
            from hub.brand_versions v where brand_id=$1),
        'web_versions',(select coalesce(jsonb_agg(to_jsonb(v) order by version_no),'[]')
            from hub.entity_versions v where web_page_id=$2),
        'batches',(select coalesce(jsonb_agg(to_jsonb(b) order by created_at,id),'[]')
            from hub.web_publications b where created_by=$4),
        'changes',(select coalesce(jsonb_agg(to_jsonb(c) order by cursor),'[]')
            from hub.web_changes c where page_key=$5),
        'publisher_audit',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]')
            from audit.change_log a where actor=$4))''',
        fixture['brand']['id'], UUID(fixture['page']['id']), UUID(fixture['contact']['id']),
        ids['viewer'], fixture['key'])


async def wait_for_account_lock(operator, db, pending):
    async def blocked():
        while operator.get_server_pid() not in await operator.fetchval(
                'select pg_blocking_pids($1)', db.get_server_pid()):
            if pending.done():
                await pending
                pytest.fail('Publication did not wait for the account-decision lock')
            await asyncio.sleep(0.01)
    await asyncio.wait_for(blocked(), timeout=5)
    assert not pending.done()


@pytest.mark.parametrize('action', ['publish', 'prepare', 'return', 'withdraw'])
@pytest.mark.parametrize('revoke', [True, False], ids=['revoked-special', 'unchanged-special'])
def test_publication_rechecks_special_after_account_lock(permission_accounts, action, revoke):
    _, ids = permission_accounts

    async def check():
        operator, db = await disposable_operator(), await runtime()
        for connection in (operator, db):
            await connection.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        transaction, pending, created = None, None, {}
        try:
            fixture = await publication_fixture(operator, db, ids, created)
            if action == 'publish':
                batch = await call(db, ids['viewer'], 'select hub.publication_queue_prepare($1,$2)',
                                   fixture['selection'], 'Exact approved replacement')
                command = ('select hub.publication_queue_publish($1,$2)', UUID(batch['id']), batch['digest'])
            elif action == 'prepare':
                command = ('select hub.publication_queue_prepare($1,$2)', fixture['selection'], 'Prepare after waiting')
            elif action == 'return':
                command = ('select hub.publication_queue_return($1,$2,$3,$4)', 'contact',
                           {'id': fixture['contact']['id']}, fixture['approval']['expected_hash'], 'Return after waiting')
            else:
                command = ('select hub.withdraw_brand($1,$2)', fixture['brand']['id'], 'Withdraw after waiting')
            before = await observe(operator, ids, fixture)
            assert before['brand']['published_version_id'] is not None
            assert before['page']['published_version_id'] is not None
            assert len(before['brand_versions']) == len(before['web_versions']) == 1
            assert await call(db, ids['viewer'], "select hub.can_special('knowledge','knowledge.publish_web')")

            transaction = operator.transaction()
            await transaction.start()
            await operator.execute("select pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0))")
            pending = asyncio.create_task(call(db, ids['viewer'], *command))
            # The original special has passed: the real command now waits on
            # this connection before any source/publication lock or mutation.
            await wait_for_account_lock(operator, db, pending)
            tabs = await operator.fetchval('select hub.permission_rows($1)', ids['viewer'])
            account = await operator.fetchrow('select updated_at,can_manage_users from hub.user_account where id=$1', ids['viewer'])
            if revoke:
                tabs['knowledge'] = [level for level in tabs['knowledge'] if level != 'knowledge.publish_web']
            else:
                # A real unrelated grant change commits, while source View and
                # the publication special remain usable after the same wait.
                tabs['releases'] = []
            await call(operator, ids['admin'], 'select hub.save_account_permissions($1,$2,$3,$4)',
                       ids['viewer'], tabs, account['can_manage_users'], account['updated_at'])
            await transaction.commit()
            transaction = None

            if revoke:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await asyncio.wait_for(pending, timeout=10)
                assert await observe(operator, ids, fixture) == before
                assert not await call(db, ids['viewer'], "select hub.can_special('knowledge','knowledge.publish_web')")
            else:
                result = await asyncio.wait_for(pending, timeout=10)
                after = await observe(operator, ids, fixture)
                assert await call(db, ids['viewer'], "select hub.can_special('knowledge','knowledge.publish_web')")
                assert after['brand_versions'] == before['brand_versions']
                assert after['web_versions'][:len(before['web_versions'])] == before['web_versions']
                if action == 'publish':
                    assert result['state'] == 'PUBLISHED' and result['page_count'] == 1
                    assert len(after['web_versions']) == len(before['web_versions']) + 1
                    assert after['page']['published_version_id'] != before['page']['published_version_id']
                    public = await call(db, ids['service_consumer'], "select hub.web_public_page($1,'th')", fixture['key'])
                    assert any(item['value'] == '022222222' for item in public['content']['contacts'])
                elif action == 'prepare':
                    assert result['state'] == 'IN_REVIEW'
                    assert len(after['batches']) == len(before['batches']) + 1
                    assert after['page'] == before['page'] and after['web_versions'] == before['web_versions']
                elif action == 'return':
                    assert result['state'] == 'RETURNED'
                    assert after['reviews'][:-1] == before['reviews'][:-1]
                    for field in ('payload', 'source_hash', 'editors', 'approved_by', 'approved_at'):
                        assert after['reviews'][-1][field] == before['reviews'][-1][field]
                    assert after['reviews'][-1]['state'] == 'RETURNED'
                    assert after['page'] == before['page'] and after['web_versions'] == before['web_versions']
                else:
                    assert after['brand']['published_version_id'] is None
                    assert after['web_versions'] == before['web_versions']
                    assert not await call(db, ids['service_consumer'],
                                          'select exists(select 1 from public_api.read_brands() where public_brand_id=$1)',
                                          fixture['brand']['public_brand_id'])
        finally:
            if transaction is not None:
                await transaction.rollback()
            if pending is not None and not pending.done():
                pending.cancel()
            if pending is not None:
                await asyncio.gather(pending, return_exceptions=True)
            if 'brand' in created:
                # Hide only this test's committed synthetic source. Keep its
                # immutable publication/review rows intact for audit history.
                await operator.execute('update hub.brands set deleted_at=clock_timestamp() where id=$1', created['brand']['id'])
            await db.close()
            await operator.close()
    asyncio.run(check())
