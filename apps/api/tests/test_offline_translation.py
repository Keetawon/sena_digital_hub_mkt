"""Provider-free operator guards on synthetic disposable source rows."""
import asyncio
from copy import deepcopy
from hashlib import sha256
import json
from uuid import uuid4

import asyncpg
import pytest

from sena_hub_api.offline_translation import apply_batch, validate_text
from test_permission_foundations import permission_accounts
from test_website_content import operator, project_fixture


def test_offline_placeholder_number_unit_and_glossary_guards():
    glossary = [{'status': 'active', 'term': {'th': 'สวนสาธารณะ', 'en': 'Park'}}]
    validate_text('สวนสาธารณะ 1.5 กม. {place}', 'Park 1.5 km {place}', glossary)
    for english in ('Park 2 km {place}', 'Park 1.5 km', 'Garden 1.5 km {place}', '', 'สวน 1.5 km {place}', 'Park 1.5 {place}'):
        with pytest.raises(ValueError):
            validate_text('สวนสาธารณะ 1.5 กม. {place}', english, glossary)
    with pytest.raises(ValueError, match='non_dee'):
        validate_text('นอนดี', 'Unapproved feature', [])


def test_offline_completion_stale_human_english_replay_and_permission(permission_accounts):
    _, ids = permission_accounts

    async def check():
        db = await operator()
        transaction = db.transaction()
        await transaction.start()
        try:
            project = await project_fixture(db, ids['editor'])
            key = project['public_project_id']
            await db.fetchval("SELECT hub.save_content_section('project',$1,'section.project_intro',0,$2)", key,
                {'body': {'th': 'บ้าน 12 หลัง'}, 'ai_exposure': 'internal'})
            t = await db.fetchrow("SELECT * FROM hub.content_translations WHERE scope_id=$1 AND field_key='section.project_intro'", key)
            j = await db.fetchrow('SELECT * FROM hub.translation_jobs WHERE translation_id=$1', t['id'])
            row = {name: t[name] for name in ('owner_type','owner_key','field_key','source_tab','scope_id','th_text','th_sha256','th_version')}
            row.update(job_id=str(j['id']), translation_id=str(t['id']), en='12 homes', flags=[])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                async with db.transaction():
                    await apply_batch(db, ids['viewer'], [row], [])
            stale = {**row, 'th_version': row['th_version'] + 1}
            async with db.transaction():
                assert (await apply_batch(db, ids['editor'], [stale], []))['skipped'][0]['reason'] == 'stale'
            for column in ('reviewed_en', 'entered_en'):
                async with db.transaction():
                    await db.execute(f'UPDATE hub.content_translations SET {column}=$2 WHERE id=$1', t['id'], 'Human draft')
                    result = await apply_batch(db, ids['editor'], [row], [])
                    assert result['skipped'][0]['reason'] == 'human_english'
                    assert await db.fetchval(f'SELECT {column} FROM hub.content_translations WHERE id=$1', t['id']) == 'Human draft'
                    await db.execute(f'UPDATE hub.content_translations SET {column}=null WHERE id=$1', t['id'])
            async with db.transaction():
                result = await apply_batch(db, ids['editor'], [row], [])
            assert result['completed'] == [row['job_id']]
            saved = dict(await db.fetchrow('SELECT * FROM hub.content_translations WHERE id=$1', t['id']))
            assert saved['machine_en'] == '12 homes' and saved['translation_state'] == 'machine'
            assert saved['en_from_th_version'] == saved['th_version'] and saved['reviewed_en'] is saved['entered_en'] is None
            before = dict(saved)
            async with db.transaction():
                assert (await apply_batch(db, ids['editor'], [row], []))['status'] == 'already_applied'
            assert dict(await db.fetchrow('SELECT * FROM hub.content_translations WHERE id=$1', t['id'])) == before
            assert await db.fetchval('SELECT model FROM hub.translation_jobs WHERE id=$1', j['id']) == 'offline_batch'
        finally:
            await transaction.rollback()
            await db.close()
    asyncio.run(check())
