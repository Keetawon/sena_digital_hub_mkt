"""Shared promotion references, partial saves and exact reviewed applicability."""
import asyncio
from uuid import UUID

import asyncpg
import pytest

from test_content_scopes import scope_database, selected
from test_permission_content import call
from test_permission_foundations import permission_accounts
from test_permission_baseline import ROOT
from content_workflow_fixture import load_sql_fixture, publication_persona
from test_real_promotions import command, draft, english
from test_website_content import project_fixture


def test_shared_promotion_partial_editor_can_read_but_cannot_mutate_hidden_scope(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            a, b, c, d = [await project_fixture(db, ids['editor']) for _ in range(4)]
            targets = [{'type': 'project', 'id': str(p['id'])} for p in (a, c, d)]
            row = await command(db, ids['editor'], 'create', **draft(b['id'], targets=targets,
                                excluded_project_ids=[str(d['id'])]))
            promotion = UUID(row['id'])
            original_hash = row['scope']['scope_hash']
            for level in ('view', 'edit'):
                await selected(db, ids['editor'], 'promotions', level, [a['rem_project_id']])
            await selected(db, ids['editor'], 'projects', 'view', [a['rem_project_id']])
            visible = await call(db, ids['editor'], 'select hub.promotion_read($1)', promotion)
            assert visible['project_id'] is None and visible['public_project_id'] is None
            assert visible['targets'] == targets[:1] and visible['excluded_project_ids'] == []
            assert visible['scope']['count'] == 3 and visible['scope']['scope_hash'] == original_hash
            assert [p['id'] for p in visible['scope']['items']] == [str(a['id'])]
            assert visible['applicability_complete'] is False and visible['scope']['applicability_complete'] is False
            contextual = await call(db, ids['editor'], 'select hub.workspace_promotions($1,$2)', 'project', a['public_project_id'])
            contextual_row = next(item for item in contextual['items'] if item['id'] == row['id'])
            assert contextual_row['project_id'] is None and contextual_row['scope_count'] == 3
            assert contextual_row['draft_project_ids'] == [a['public_project_id']]
            assert contextual_row['applicability_complete'] is False
            references = await call(db, ids['editor'], 'select hub.promotion_references()')
            assert [item['id'] for item in references['projects']] == [str(a['id'])]
            tasks = await call(db, ids['editor'], 'select hub.workspace_home()')
            import json
            serialized = json.dumps(tasks)
            assert b['public_project_id'] not in serialized and str(b['id']) not in serialized
            raw = await call(db, ids['editor'], "select coalesce(jsonb_agg(to_jsonb(p)),'[]') from hub.public_promotions p where id=$1", promotion)
            assert raw == []
            proposal = {'promotion_id': str(promotion), 'expected_revision': row['draft_revision'],
                        'targets': visible['targets'], 'excluded_project_ids': []}
            resolved = await call(db, ids['editor'], 'select hub.promotion_resolve($1)', proposal)
            assert resolved['scope_hash'] == original_hash and resolved['count'] == 3
            assert resolved['items'] == visible['scope']['items'] and resolved['applicability_complete'] is False
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await command(db, ids['editor'], 'update', visible,
                              audience='investor', targets=visible['targets'], excluded_project_ids=[])
            stored = await db.fetchrow('select project_id,targets,excluded_project_ids,draft_revision from hub.public_promotions where id=$1', promotion)
            assert stored['project_id'] == b['id'] and stored['targets'] == targets and stored['excluded_project_ids'] == [d['id']]
            assert stored['draft_revision'] == visible['draft_revision']
            assert (await call(db, ids['editor'], 'select hub.promotion_resolve($1)', proposal))['scope_hash'] == original_hash
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['editor'], 'select hub.promotion_resolve($1)', {'project_id': str(b['id'])})
            assert await call(db, ids['editor'], 'select hub.promotion_resolve($1)', {'project_id': str(a['id'])})

            before = await db.fetchval('select to_jsonb(p) from hub.public_promotions p where id=$1', promotion)
            audit_before = await db.fetchval('select count(*) from audit.change_log')
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await command(db, ids['editor'], 'update', visible, targets=[], excluded_project_ids=[str(a['id'])])
            assert await db.fetchval('select to_jsonb(p) from hub.public_promotions p where id=$1', promotion) == before
            assert await db.fetchval('select count(*) from audit.change_log') == audit_before
    asyncio.run(check())


def test_brand_owned_promotion_requires_all_editor_and_reviewer_scope(permission_accounts):
    from test_content_workflow import inventory_brand_fixture
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            brand = await inventory_brand_fixture(db, ids['editor'])
            a, b = [await project_fixture(db, ids['editor']) for _ in range(2)]
            await db.execute('update hub.projects set brand_id=$1 where id=any($2::uuid[])', brand['id'], [a['id'], b['id']])
            for level in ('view', 'edit'):
                await selected(db, ids['editor'], 'promotions', level, [a['rem_project_id']])
            await selected(db, ids['editor'], 'projects', 'view', [a['rem_project_id']])
            await selected(db, ids['editor'], 'brands', 'view', [a['rem_project_id']])
            body = draft(a['id'], owning_brand_id=str(brand['id']))
            body['project_id'] = None
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await command(db, ids['editor'], 'create', **body)
            for level in ('view', 'edit'):
                await selected(db, ids['editor'], 'promotions', level, [a['rem_project_id'], b['rem_project_id']])
            await selected(db, ids['editor'], 'projects', 'view', [a['rem_project_id'], b['rem_project_id']])
            await selected(db, ids['editor'], 'brands', 'view', [a['rem_project_id'], b['rem_project_id']])
            row = await command(db, ids['editor'], 'create', **body)
            assert row['project_id'] is None and row['owning_brand_id'] == str(brand['id'])
            assert row['scope']['count'] == 2 and row.get('applicability_complete', True) is True
            assert {item['id'] for item in row['scope']['items']} == {str(a['id']), str(b['id'])}
            for level in ('view', 'edit'):
                await selected(db, ids['editor'], 'promotions', level, [a['rem_project_id']])
            for level in ('view', 'approve'):
                await selected(db, ids['publisher'], 'promotions', level, [a['rem_project_id']])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await command(db, ids['publisher'], 'review', row, review_type='LEGAL', decision='APPROVED', evidence='Synthetic legal review', change_reason='Synthetic scope')
            for level in ('view', 'approve'):
                await selected(db, ids['publisher'], 'promotions', level, [a['rem_project_id'], b['rem_project_id']])
            reviewed = await command(db, ids['publisher'], 'review', row, review_type='LEGAL', decision='APPROVED', evidence='Synthetic legal review', change_reason='Synthetic scope')
            assert reviewed['reviews'][0]['decision'] == 'APPROVED'
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await command(db, ids['editor'], 'update', row, excluded_project_ids=[str(a['id'])])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await command(db, ids['editor'], 'update', row, excluded_project_ids=[str(b['id'])])
            stored = await db.fetchrow('select draft_revision,excluded_project_ids from hub.public_promotions where id=$1', UUID(row['id']))
            assert stored['draft_revision'] == row['draft_revision'] and stored['excluded_project_ids'] == []
    asyncio.run(check())


def test_shared_promotion_review_requires_all_resolved_projects_and_retains_full_hash(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            a, b = [await project_fixture(db, ids['editor']) for _ in range(2)]
            row = await command(db, ids['editor'], 'create', **draft(a['id'], targets=[{'type': 'project', 'id': str(b['id'])}]))
            for level in ('view', 'approve'):
                await selected(db, ids['publisher'], 'promotions', level, [a['rem_project_id']])
            review = dict(review_type='DATA', decision='APPROVED', evidence='Synthetic exact scope',
                          change_reason='Synthetic complete review', expected_scope_hash=row['scope']['scope_hash'])
            audit_before = await db.fetchval('select count(*) from audit.change_log')
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await command(db, ids['publisher'], 'review', row, **review)
            assert await db.fetchval('select count(*) from audit.change_log') == audit_before
            assert not await db.fetchval('select exists(select 1 from hub.promotion_reviews where promotion_id=$1)', UUID(row['id']))
            for level in ('view', 'approve'):
                await selected(db, ids['publisher'], 'promotions', level, [a['rem_project_id'], b['rem_project_id']])
            approved = await command(db, ids['publisher'], 'review', row, **review)
            assert set(approved['reviews'][0]['resolved_project_ids']) == {a['public_project_id'], b['public_project_id']}
            await selected(db, ids['publisher'], 'promotions', 'view', [])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['publisher'], 'select hub.promotion_read($1)', UUID(row['id']))
    asyncio.run(check())


def test_old_promotion_version_scope_stays_frozen_after_a_later_draft_moves(permission_accounts):
    _, ids = permission_accounts
    async def check():
        async with scope_database() as db:
            await publication_persona(ids, operator=db)
            await load_sql_fixture(db, ids['admin'])
            fixture = (ROOT / 'supabase/tests/residential_demo.sql').read_text(encoding='utf-8').split('-- Every new table')[0].replace('begin;', '', 1)
            await db.execute(fixture)
            a = dict(await db.fetchrow("select * from hub.projects where id=current_setting('test.residential_project')::uuid"))
            b = await project_fixture(db, ids['editor'])
            row = await command(db, ids['editor'], 'create', **draft(a['id']))
            promotion = UUID(row['id'])
            row = await english(db, ids['editor'], row)
            for review_type in ('DATA', 'LEGAL'):
                row = await command(db, ids['publisher'], 'review', row, review_type=review_type,
                                    decision='APPROVED', evidence='Synthetic frozen scope', change_reason='Synthetic review')
            row = await command(db, ids['viewer'], 'publish', row,
                                expected_published_version_id=None, change_reason='Synthetic frozen scope')
            version = UUID(row['published_version_id'])
            frozen = await db.fetchval('select to_jsonb(v) from hub.promotion_versions v where id=$1', version)
            changed = await command(db, ids['editor'], 'update', row,
                                    targets=[{'type': 'project', 'id': str(b['id'])}], excluded_project_ids=[str(a['id'])])
            assert changed['target_project_ids'] == [b['public_project_id']]
            assert await db.fetchval('select to_jsonb(v) from hub.promotion_versions v where id=$1', version) == frozen
            await selected(db, ids['viewer'], 'promotions', 'view', [a['rem_project_id']])
            await selected(db, ids['viewer'], 'projects', 'view', [a['rem_project_id']])
            assert await call(db, ids['viewer'], 'select count(*) from hub.promotion_versions where id=$1', version) == 1
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select hub.promotion_read($1)', promotion)
            live_a = await call(db, ids['viewer'], 'select hub.promotion_read(null,$1)',
                                {'published_project_id': str(a['id']), 'limit': 50})
            live_row = next(item for item in live_a['items'] if item['id'] == row['id'])
            assert live_row['published']['id'] == str(version)
            assert live_row['publication_available'] is True
            assert 'target_project_ids' not in live_row['published']['payload']
            assert 'editors' not in live_row['published']['payload']
            run = await call(db, ids['viewer'], 'select internal.assistant_run_create($1)',
                             {'mode': 'SYNTHETIC', 'config_version': 'multi-tier-regression'})
            receipt = await call(db, ids['viewer'], 'select internal.assistant_tool_record($1,$2)', UUID(run['id']),
                                 {'tool_name': 'get_promotions', 'outcome': 'SUCCESS', 'duration_ms': 1, 'sources': [{
                                     'namespace': 'internal_content', 'entity_type': 'promotion', 'entity_id': str(promotion),
                                     'version': str(version), 'scope': {'project_id': a['public_project_id']}}]})
            citation_id = UUID(receipt['citations'][0]['id'])
            citation = await call(db, ids['viewer'], 'select internal.assistant_citation_read($1,$2)', UUID(run['id']), citation_id)
            assert citation['scope'] == {'project_id': a['public_project_id']}
            history = await call(db, ids['viewer'], 'select internal.assistant_run_read($1)', UUID(run['id']))
            assert history['citations'][0]['id'] == str(citation_id)
            await selected(db, ids['viewer'], 'promotions', 'view', [b['rem_project_id']])
            await selected(db, ids['viewer'], 'projects', 'view', [b['rem_project_id']])
            assert await call(db, ids['viewer'], 'select count(*) from hub.promotion_versions where id=$1', version) == 0
            current = await call(db, ids['viewer'], 'select hub.promotion_read($1)', promotion)
            assert current['id'] == row['id'] and current['versions'] == []
            live_b = await call(db, ids['viewer'], 'select hub.promotion_read(null,$1)',
                                {'published_project_id': str(b['id']), 'limit': 50})
            assert row['id'] not in [item['id'] for item in live_b['items']]
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await call(db, ids['viewer'], 'select internal.assistant_citation_read($1,$2)', UUID(run['id']), citation_id)
    asyncio.run(check())
