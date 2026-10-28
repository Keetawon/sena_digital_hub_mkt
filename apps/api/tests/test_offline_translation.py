"""Provider-free operator guards on synthetic disposable source rows."""
import asyncio
from copy import deepcopy
from hashlib import sha256
import json
from uuid import uuid4

import asyncpg
import pytest

from sena_hub_api.offline_translation import apply_batch, apply_name_cleanup, clean_name_draft, name_cleanup_skip_reason, validate_text
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


def test_name_cleanup_removes_only_name_punctuation_and_keeps_real_abbreviations():
    for before, after in [('Concordian School.', 'Concordian School'), ('Campus  1.5 km.  ', 'Campus 1.5 km'),
                          ('Example Co., Ltd.', 'Example Co., Ltd.'), ('Main St.', 'Main St.'), ('U.S.', 'U.S.'), ('25 SQ.M.', '25 SQ.M.')]:
        assert clean_name_draft('place.name', 'Synthetic campus', before) == after
        assert clean_name_draft('place.name', 'Synthetic campus', after) == after
    assert clean_name_draft('section.concept_name', 'Short slogan', 'A new beginning.') == 'A new beginning'
    for source, english in [('A' * 121, 'Paragraph.'), ('Short source', 'One sentence. Another sentence.'), ('Short source', 'More...')]:
        assert clean_name_draft('section.concept_name', source, english) == english
    assert clean_name_draft('section.project_intro', 'Source', 'Keep this sentence.') == 'Keep this sentence.'
    with pytest.raises(ValueError, match='name_punctuation'):
        validate_text('Synthetic campus', 'Campus.', [], field_key='place.name')
    validate_text('Synthetic campus', 'Example Co., Ltd.', [], field_key='place.name')


def test_name_cleanup_reports_edited_reviewed_and_stale_rows():
    row = dict(translation_id=str(uuid4()), owner_type='place', owner_key='source', field_key='place.name',
               source_tab='projects', scope_id='scope', before_en='Campus.', after_en='Campus',
               th_version=1, th_sha256='source-hash', expected_revision=2)
    job = dict(translation_id=row['translation_id'], status='done', model='offline_batch', draft_en='Campus.')
    current = {**{k: row[k] for k in ('owner_type','owner_key','field_key','source_tab','scope_id','th_version','th_sha256')},
               'entered_en':None,'reviewed_en':None,'machine_en':'Campus.','translation_state':'machine',
               'en_from_th_version':1,'revision':2}
    assert name_cleanup_skip_reason(job,current,row) is None
    for field in ('entered_en','reviewed_en'):
        assert name_cleanup_skip_reason(job,{**current,field:'Human English'},row) == 'human_english'
    assert name_cleanup_skip_reason(job,{**current,'machine_en':'Edited English'},row) == 'edited_draft'
    assert name_cleanup_skip_reason(job,{**current,'th_version':2},row) == 'source_changed'
    assert name_cleanup_skip_reason(job,{**current,'revision':4},row) == 'edited_revision'
    assert name_cleanup_skip_reason(job,{**current,'machine_en':'Campus','revision':3},row) is None


def test_name_cleanup_guarded_completion_skip_stop_permission_and_exact_replay(permission_accounts):
    _, ids = permission_accounts
    async def check():
        db=await operator();tx=db.transaction();await tx.start()
        try:
            project=await project_fixture(db,ids['editor']);key=project['public_project_id']
            await db.fetchval("SELECT hub.save_content_section('project',$1,'section.concept_name',0,$2)",key,
                              {'body':{'th':'Synthetic campus'},'ai_exposure':'internal'})
            t=await db.fetchrow("SELECT * FROM hub.content_translations WHERE scope_id=$1 AND field_key='section.concept_name'",key)
            j=await db.fetchrow('SELECT * FROM hub.translation_jobs WHERE translation_id=$1',t['id'])
            await db.execute("UPDATE hub.translation_jobs SET status='done',model='offline_batch',draft_en='Campus.',completed_at=clock_timestamp() WHERE id=$1",j['id'])
            await db.execute("UPDATE hub.content_translations SET machine_en='Campus.',translation_state='machine',en_from_th_version=th_version,revision=revision+1 WHERE id=$1",t['id'])
            row={k:t[k] for k in ('owner_type','owner_key','field_key','source_tab','scope_id','th_text','th_sha256','th_version')}
            row.update(job_id=str(j['id']),translation_id=str(t['id']),before_en='Campus.',after_en='Campus',expected_revision=t['revision']+1)
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                async with db.transaction():await apply_name_cleanup(db,ids['viewer'],[row])
            for field in ('entered_en','reviewed_en','machine_en'):
                await db.execute(f'UPDATE hub.content_translations SET {field}=$2 WHERE id=$1',t['id'],'Human English')
                with pytest.raises(ValueError,match='skip_threshold'):
                    await apply_name_cleanup(db,ids['editor'],[row])
                assert await db.fetchval(f'SELECT {field} FROM hub.content_translations WHERE id=$1',t['id'])=='Human English'
                await db.execute(f'UPDATE hub.content_translations SET {field}=$2 WHERE id=$1',t['id'],'Campus.' if field=='machine_en' else None)
            job_before=dict(await db.fetchrow('SELECT * FROM hub.translation_jobs WHERE id=$1',j['id']))
            assert (await apply_name_cleanup(db,ids['editor'],[row]))['changed']==[str(j['id'])]
            saved=dict(await db.fetchrow('SELECT * FROM hub.content_translations WHERE id=$1',t['id']))
            assert saved['machine_en']=='Campus' and saved['translation_state']=='machine' and saved['en_from_th_version']==t['th_version']
            assert (await apply_name_cleanup(db,ids['editor'],[row]))['status']=='already_applied'
            assert dict(await db.fetchrow('SELECT * FROM hub.content_translations WHERE id=$1',t['id']))==saved
            assert dict(await db.fetchrow('SELECT * FROM hub.translation_jobs WHERE id=$1',j['id']))==job_before
        finally:
            await tx.rollback();await db.close()
    asyncio.run(check())
