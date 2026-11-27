"""Verify KM content endpoints across brand, project_group, corporate, and programme scopes."""
from __future__ import annotations

import asyncio
from uuid import uuid4

from test_permission_baseline import disposable_operator
from test_permission_foundations import h, permission_accounts


def test_brand_km_sections_read_write_and_permission_guards(permission_accounts):
    client, _ = permission_accounts
    brands = client.get('/v1/admin/brands', headers=h('editor')).json()['data']
    assert brands
    brand_id = brands[0]['public_brand_id']

    initial = client.get(f'/v1/admin/brands/{brand_id}/content', headers=h('viewer'))
    assert initial.status_code == 200, initial.text
    payload = initial.json()['data']
    assert 'sections' in payload and 'contacts' in payload and 'translations' in payload

    existing = next((s for s in payload['sections'] if s['section_key'] == 'section.project_intro'), None)
    expected_rev = existing['revision'] if existing else 0

    # Viewer and agency cannot mutate brand KM sections
    denied_viewer = client.put(
        f'/v1/admin/brands/{brand_id}/sections/section.project_intro',
        headers=h('viewer'),
        json={'expected_revision': expected_rev, 'changes': {'body': {'th': 'ห้ามแก้ไข'}}},
    )
    assert denied_viewer.status_code == 403

    denied_agency = client.get(f'/v1/admin/brands/{brand_id}/content', headers=h('agency'))
    assert denied_agency.status_code == 403

    # Editor saves brand KM narrative
    saved = client.put(
        f'/v1/admin/brands/{brand_id}/sections/section.project_intro',
        headers=h('editor'),
        json={
            'expected_revision': expected_rev,
            'changes': {
                'body': {'th': 'ข้อมูล KM แบรนด์เสนาสำหรับสื่อสารลูกค้า', 'en': 'SENA Brand KM overview'},
                'ai_exposure': 'open',
            },
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()['data']['revision'] == expected_rev + 1

    # Stale revision rejected with 409
    stale = client.put(
        f'/v1/admin/brands/{brand_id}/sections/section.project_intro',
        headers=h('editor'),
        json={'expected_revision': expected_rev, 'changes': {'body': {'th': 'ข้อมูลซ้ำ'}}},
    )
    assert stale.status_code == 409

    refreshed = client.get(f'/v1/admin/brands/{brand_id}/content', headers=h('viewer')).json()['data']
    intro = next(s for s in refreshed['sections'] if s['section_key'] == 'section.project_intro')
    assert intro['version']['body']['th'] == 'ข้อมูล KM แบรนด์เสนาสำหรับสื่อสารลูกค้า'


def test_corporate_programme_and_project_group_km_scopes(permission_accounts):
    client, _ = permission_accounts

    async def ensure_group() -> tuple[str, str, str | None]:
        db = await disposable_operator()
        try:
            rem_id = await db.fetchval('select rem_project_id from hub.projects where deleted_at is null limit 1')
            prior_record = await db.fetchval('select source_record::text from staging.dw_projects where rem_project_id=$1', rem_id)
            gid = 'GRP-KM-' + uuid4().hex[:8].upper()
            digest = uuid4().hex * 2
            await db.execute("insert into staging.intake_batches(manifest_sha256,manifest,datasets) values($1,'{}','{}')", digest)
            await db.execute(
                """insert into staging.dw_project_groups(project_group_id, source_record, manifest_sha256)
                   values ($1, '{"project_group_name":"กลุ่มโครงการทดสอบ KM"}'::jsonb, $2)""",
                gid,
                digest,
            )
            await db.execute(
                """insert into staging.dw_projects(rem_project_id, source_record, source_snapshot_at, source_fingerprint, provenance)
                   values ($1, jsonb_build_object('project_id', $1::text, 'rem_project_group_id', $2::text), now(), $3, '{}'::jsonb)
                   on conflict (rem_project_id) do update
                   set source_record = staging.dw_projects.source_record || jsonb_build_object('rem_project_group_id', $2::text)""",
                rem_id,
                gid,
                digest,
            )
            return gid, rem_id, prior_record
        finally:
            await db.close()

    group_id, linked_rem, prior_record = asyncio.run(ensure_group())

    try:
        # 1. Corporate SENA KM (section.corporate_services so section.corporate_intro stays clean for web publication tests)
        corp_get = client.get('/v1/admin/content/scopes/corporate/sena/content', headers=h('viewer'))
        assert corp_get.status_code == 200, corp_get.text
        corp_existing = next((s for s in corp_get.json()['data']['sections'] if s['section_key'] == 'section.corporate_services'), None)
        corp_rev = corp_existing['revision'] if corp_existing else 0

        corp_put = client.put(
            '/v1/admin/content/scopes/corporate/sena/sections/section.corporate_services',
            headers=h('editor'),
            json={'expected_revision': corp_rev, 'changes': {'body': {'th': 'เสนาดีเวลลอปเม้นท์ บริการที่อยู่อาศัยครบวงจร'}}},
        )
        assert corp_put.status_code == 200, corp_put.text
        assert client.get('/v1/admin/content/scopes/corporate/unknown/content', headers=h('viewer')).status_code == 404
        assert client.get('/v1/admin/content/scopes/corporate/sena/content', headers=h('agency')).status_code == 403
        assert client.get('/v1/admin/content/scopes/invalid_kind/sena/content', headers=h('viewer')).status_code == 422

        # 2. Programme KM (LIVNEX)
        prog_get = client.get('/v1/admin/content/scopes/programme/LIVNEX/content', headers=h('viewer'))
        assert prog_get.status_code == 200, prog_get.text
        prog_existing = next((s for s in prog_get.json()['data']['sections'] if s['section_key'] == 'section.project_intro'), None)
        prog_rev = prog_existing['revision'] if prog_existing else 0

        prog_put = client.put(
            '/v1/admin/content/scopes/programme/LIVNEX/sections/section.project_intro',
            headers=h('editor'),
            json={'expected_revision': prog_rev, 'changes': {'body': {'th': 'เช่าออมบ้าน LivNex เปลี่ยนค่าเช่าเป็นเงินดาวน์'}}},
        )
        assert prog_put.status_code == 200, prog_put.text
        assert client.get('/v1/admin/content/scopes/programme/UNKNOWN_PROG/content', headers=h('viewer')).status_code == 404

        # 3. Project Group KM
        grp_get = client.get(f'/v1/admin/content/scopes/project_group/{group_id}/content', headers=h('viewer'))
        assert grp_get.status_code == 200, grp_get.text
        grp_existing = next((s for s in grp_get.json()['data']['sections'] if s['section_key'] == 'section.project_intro'), None)
        grp_rev = grp_existing['revision'] if grp_existing else 0

        grp_put = client.put(
            f'/v1/admin/content/scopes/project_group/{group_id}/sections/section.project_intro',
            headers=h('editor'),
            json={'expected_revision': grp_rev, 'changes': {'body': {'th': 'ข้อมูล KM ระดับกลุ่มโครงการสำหรับทุกเฟส'}}},
        )
        assert grp_put.status_code == 200, grp_put.text
        grp_after = client.get(f'/v1/admin/content/scopes/project_group/{group_id}/content', headers=h('viewer')).json()['data']
        assert any(s['version']['body']['th'] == 'ข้อมูล KM ระดับกลุ่มโครงการสำหรับทุกเฟส' for s in grp_after['sections'])
        assert client.get('/v1/admin/content/scopes/project_group/NON-EXISTENT-GROUP/content', headers=h('viewer')).status_code == 404
    finally:
        async def restore_dw_project():
            db = await disposable_operator()
            try:
                if prior_record is None:
                    await db.execute("delete from staging.dw_projects where rem_project_id=$1 and source_record->>'rem_project_group_id'=$2", linked_rem, group_id)
                else:
                    await db.execute('update staging.dw_projects set source_record=$2::jsonb where rem_project_id=$1', linked_rem, prior_record)
            finally:
                await db.close()

        asyncio.run(restore_dw_project())
