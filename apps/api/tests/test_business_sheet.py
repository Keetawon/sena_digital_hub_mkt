"""Synthetic CSV integrity checks; no network, credentials or database."""
import csv
import asyncio
from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

import asyncpg
from sena_hub_api.auth import DEMO_ACTORS

spec = importlib.util.spec_from_file_location('business_sheet', Path(__file__).resolve().parents[3] / 'scripts/business-sheet.py')
sheet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sheet)


def csv_bytes(headers, rows):
    text = io.StringIO(newline='')
    writer = csv.DictWriter(text, fieldnames=headers)
    writer.writeheader()
    writer.writerows(rows)
    return text.getvalue().encode('utf8')


class BusinessSheetTests(unittest.TestCase):
    def test_exact_ids_allowed_fields_exceptions_and_source_spelling(self):
        header = [*sheet.PROJECT_FIELDS, 'SALES EMAIL', 'Average Price Per unit', 'WARROOM NAME', 'Project Code']
        rows = [dict.fromkeys(header, '') for _ in range(4)]
        for row, identity in zip(rows, ['0001', '0001 ', '0001', '']):
            row.update({'Project ID': identity, 'SALES EMAIL': 'excluded@example.test',
                        'Average Price Per unit': '987654321', 'Project': 'ชื่อ, มีเครื่องหมาย\nและบรรทัดใหม่',
                        'Super Project Mapping': ' Name |NAME|ชื่อเดิม', 'LINE OA TAG NAME': 'staff-only'})
        selected, exceptions = sheet.project_rows(csv_bytes(header, rows))
        self.assertEqual([r['record']['Project ID'] for r in selected], ['0001', '0001 ', '0001'])
        self.assertEqual(exceptions[0]['code'], 'PROJECT_ID_MISSING')
        self.assertEqual(exceptions[0]['row'], 5)
        self.assertEqual(set(selected[0]['record']), set(sheet.PROJECT_FIELDS))
        self.assertNotIn('excluded@example.test', json.dumps([selected, exceptions]))
        self.assertNotIn('987654321', json.dumps([selected, exceptions]))
        self.assertEqual(selected[0]['record']['Project'], rows[0]['Project'])
        self.assertEqual(selected[0]['alias_candidates'][0]['source_spellings'], [' Name ', 'NAME'])
        self.assertTrue(any(f['code'] == 'IDENTIFIER_WHITESPACE_PRESERVED' for f in selected[1]['findings']))

    def test_group_contract_and_suspicious_characters_are_preserved(self):
        row = dict.fromkeys(sheet.GROUP_FIELDS, '')
        row.update(ProjectGroupID='001', MemberCount='2', ProjectID_Set='0001,0002 ', ProjectName_EN='สSynthetic group', PostCode='00100')
        headers, rows = sheet.group_rows(csv_bytes(sheet.GROUP_FIELDS, [row]))
        self.assertEqual(len(headers), 16)
        self.assertEqual(rows[0]['record'], row)
        self.assertEqual(rows[0]['members'], ['0001', '0002 '])
        self.assertIn('THAI_CHARACTER_IN_ENGLISH_NAME', [f['code'] for f in rows[0]['findings']])
        self.assertIn('IDENTIFIER_WHITESPACE_PRESERVED', [f['code'] for f in rows[0]['findings']])
        with self.assertRaisesRegex(ValueError, 'group_header_contract_changed'):
            sheet.group_rows(csv_bytes(['ProjectGroupID'], [{'ProjectGroupID': '001'}]))

    def test_package_verifies_source_normalization_and_cannot_be_replaced(self):
        project = dict.fromkeys(sheet.PROJECT_FIELDS, '')
        project['Project ID'] = '0001'
        group = dict.fromkeys(sheet.GROUP_FIELDS, '')
        group.update(ProjectGroupID='001', MemberCount='1', ProjectID_Set='0001')
        args = (csv_bytes(sheet.PROJECT_FIELDS, [project]), csv_bytes(sheet.GROUP_FIELDS, [group]), '2026-10-27T00:00:00+00:00')
        with tempfile.TemporaryDirectory() as tmp:
            folder, digest, manifest = sheet.write_package(tmp, *args)
            self.assertEqual(sheet.verify_package(folder, digest)['manifest'], manifest)
            with self.assertRaises(FileExistsError):
                sheet.write_package(tmp, *args)
            (folder / 'projects.json').write_bytes(b'[]')
            with self.assertRaisesRegex(ValueError, 'package_member_mismatch'):
                sheet.verify_package(folder, digest)

    def test_only_two_tabs_and_valid_csv_are_accepted(self):
        self.assertIn('gid=0', sheet.export_url('Project'))
        self.assertIn('gid=633899292', sheet.export_url('ProjectGroupMaster'))
        with self.assertRaisesRegex(ValueError, 'tab_not_authorized'):
            sheet.export_url('AgencyFee')
        with self.assertRaisesRegex(ValueError, 'duplicate_or_blank_header'):
            sheet.csv_rows(b'Project ID,Project ID\n1,2\n')
        with self.assertRaisesRegex(ValueError, 'csv_column_count_mismatch'):
            sheet.csv_rows(b'Project ID,Name\n1,2,3\n')
        redirect = sheet.PublicExportRedirect()
        for url in ['http://docs.google.com/a', 'https://accounts.google.com/login', 'https://evil.test/a', 'https://docs.google.com:444/a']:
            with self.assertRaisesRegex(ValueError, 'export_redirect_not_authorized'):
                redirect.redirect_request(None, None, 302, '', {}, url)

    def test_crawl_input_preserves_shared_scopes_and_records_refusals(self):
        rows = []
        for identity, url in [('0001', 'https://www.sena.co.th/project/synthetic/'),
                              ('0002', 'https://www.sena.co.th/project/synthetic/'),
                              ('0003', 'https://brands.sena.co.th/synthetic/'),
                              ('0004', 'https://www.sena.co.th.evil.test/a'),
                              ('0005', 'http://www.sena.co.th/a'), ('0006', 'N/A'),
                              ('0007', 'https://private:secret@sena.co.th/a')]:
            row = dict.fromkeys(sheet.PROJECT_FIELDS, '')
            row.update({'Project ID': identity, 'Website URL': url})
            rows.append(row)
        projects, _ = sheet.project_rows(csv_bytes(sheet.PROJECT_FIELDS, rows))
        package = {'manifest_sha256': 'a' * 64, 'manifest': {'extracted_at': '2026-10-27T00:00:00+00:00'},
                   'datasets': {'business_projects': projects}}
        result, gaps = sheet.crawl_input(package)
        self.assertEqual(len(result['pages']), 2)
        shared = next(p for p in result['pages'] if '/project/' in p['url'])
        self.assertEqual(shared['project_ids'], ['0001', '0002'])
        self.assertEqual(len(gaps), 4)
        self.assertEqual(sum(g['code'] == 'WEBSITE_URL_NOT_ALLOWED' for g in gaps), 3)
        self.assertEqual(result['source_evidence']['manifest_sha256'], 'a' * 64)

    def test_snapshot_date_uses_bangkok_and_timezone_is_required(self):
        project = dict.fromkeys(sheet.PROJECT_FIELDS, '')
        project['Project ID'] = '0001'
        groups = csv_bytes(sheet.GROUP_FIELDS, [])
        with tempfile.TemporaryDirectory() as tmp:
            folder, digest, manifest = sheet.write_package(tmp, csv_bytes(sheet.PROJECT_FIELDS, [project]),
                                                          groups, '2026-10-26T20:30:00+00:00')
            self.assertEqual(manifest['source_snapshot_date'], '2026-10-27')
            sheet.verify_package(folder, digest)
            with self.assertRaisesRegex(ValueError, 'snapshot_timezone_required'):
                sheet.write_package(tmp, csv_bytes(sheet.PROJECT_FIELDS, [project]), groups, '2026-10-26T20:30:00')


if __name__ == '__main__':
    unittest.main()


def test_business_snapshot_is_append_only_replay_safe_and_cannot_replace_dw_policy(tmp_path):
    """Exercise real transactions, immutable evidence, RLS and a later DW refresh."""
    root = Path(__file__).resolve().parents[3]
    dw_spec = importlib.util.spec_from_file_location('business_test_dw', root / 'scripts/stage-dw-projects.py')
    dw = importlib.util.module_from_spec(dw_spec)
    dw_spec.loader.exec_module(dw)

    async def run():
        config = json.loads((root / '.local/development.json').read_text(encoding='utf-8'))
        db = await asyncpg.connect(host='127.0.0.1', port=55432, database='sena_hub_local',
                                   user='postgres', password=config['adminPassword'])
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        outer = db.transaction(isolation='serializable')
        await outer.start()
        try:
            fixture = root / 'supabase/tests/fixtures/dw_projects'
            original = dw.review.load_package(fixture, (fixture / 'manifest.sha256').read_text().split()[0])
            original['datasets']['project_groups'] = [dict(project_group_id='SYN-G', project_name_th='Accepted group',
                project_name_en='Accepted group', member_count=5, project_id_set=[row['ProjectID'] for row in original['datasets']['projects']], source_snapshot_at='2026-10-05T07:00:00+07:00')]
            await dw.stage_package(db, original, True, True)
            await db.execute("SELECT set_config('app.actor_id',$1,true)", str(DEMO_ACTORS['editor']))
            async with db.transaction():
                await db.execute('SET LOCAL ROLE editor')
                project_id = await db.fetchval("SELECT hub.create_project_from_rem('SYN-DW-A')")
            await db.execute('RESET ROLE')
            await db.execute("UPDATE hub.projects SET public_name=$2 WHERE id=$1", project_id, {'th': 'Human name'})
            protected_tables = ['hub.projects', 'hub.model_types', 'hub.user_account', 'hub.account_permission',
                                'hub.permission_template', 'staging.rem_projects', 'staging.rem_models', 'staging.dw_projects']

            async def protected():
                return {table: await db.fetchval(f"SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM {table} t")
                        for table in protected_tables}

            before = await protected()
            review_before = await db.fetchval("SELECT hub.project_source_review('SYN-DW-A')")
            group_before = await db.fetchval("SELECT source_record FROM staging.dw_project_groups WHERE project_group_id='SYN-G'")
            row = dict.fromkeys(sheet.PROJECT_FIELDS, '')
            row.update({'Project ID': 'SYN-DW-A', 'Project': 'New source name', 'Project Name EN': 'New English name',
                        'Brand': 'Source spelling', 'Project Group ID': 'SYN-G', 'Website URL': 'https://www.sena.co.th/project/synthetic/',
                        'LINE OA TAG NAME': 'staff-only-synthetic'})
            unknown = dict(row, **{'Project ID': 'UNKNOWN-EXACT', 'Project Group ID': ''})
            group = dict.fromkeys(sheet.GROUP_FIELDS, '')
            group.update(ProjectGroupID='SYN-G', MemberCount='1', ProjectID_Set='SYN-DW-A', ProjectName_TH='Changed group', ProjectName_EN='Changed group')
            folder, digest, _ = sheet.write_package(tmp_path, csv_bytes(sheet.PROJECT_FIELDS, [row, unknown]),
                                                   csv_bytes(sheet.GROUP_FIELDS, [group]), '2026-10-27T00:00:00+00:00')
            package = sheet.verify_package(folder, digest)
            batches = await db.fetchval('SELECT count(*) FROM staging.intake_batches')
            preview = await sheet.stage_package(db, package)
            assert preview['status'] == 'validated_dry_run'
            assert await db.fetchval('SELECT count(*) FROM staging.intake_batches') == batches
            assert any(c['code'] == 'HUMAN_NAME_PRESERVED' for p in preview['projects'] for c in p['conflicts'])
            assert any(c['code'] == 'UNKNOWN_EXACT_PROJECT_ID' for p in preview['projects'] for c in p['conflicts'])
            applied = await sheet.stage_package(db, package, apply=True)
            assert applied['status'] == 'staged' and applied['new_group_references'] == 0
            assert await protected() == before
            assert await db.fetchval("SELECT hub.project_source_review('SYN-DW-A')") == review_before
            assert await db.fetchval("SELECT source_record FROM staging.dw_project_groups WHERE project_group_id='SYN-G'") == group_before
            assert not await db.fetchval("SELECT EXISTS(SELECT 1 FROM staging.rem_projects WHERE rem_project_id='UNKNOWN-EXACT')")
            count = await db.fetchval('SELECT count(*) FROM staging.project_intake_evidence')
            replay = await sheet.stage_package(db, package, apply=True)
            assert replay['status'] == 'already_staged'
            assert await db.fetchval('SELECT count(*) FROM staging.project_intake_evidence') == count
            # New dictionaries are accepted only without membership conflicts;
            # a competing claim remains evidence and cannot become a mirror.
            empty_group = dict(group, ProjectGroupID='SYN-BIZ-EMPTY', MemberCount='0', ProjectID_Set='',
                               ProjectName_TH='New empty group', ProjectName_EN='New empty group')
            competing = dict(group, ProjectGroupID='SYN-BIZ-CONFLICT')
            next_folder, next_digest, _ = sheet.write_package(tmp_path, csv_bytes(sheet.PROJECT_FIELDS, [row, unknown]),
                csv_bytes(sheet.GROUP_FIELDS, [group, empty_group, competing]), '2026-10-28T00:00:00+00:00')
            next_package = sheet.verify_package(next_folder, next_digest)
            next_result = await sheet.stage_package(db, next_package, apply=True)
            assert next_result['new_group_references'] == 1
            assert await db.fetchval("SELECT EXISTS(SELECT 1 FROM staging.dw_project_groups WHERE project_group_id='SYN-BIZ-EMPTY')")
            assert not await db.fetchval("SELECT EXISTS(SELECT 1 FROM staging.dw_project_groups WHERE project_group_id='SYN-BIZ-CONFLICT')")
            assert await protected() == before
            assert await db.fetchval("SELECT hub.project_source_review('SYN-DW-A')") == review_before
            # A later DW snapshot keeps its own first-import/deleted policy and
            # does not turn business evidence into missing DW identities/groups.
            refreshed = deepcopy(original)
            refreshed['manifest_sha256'] = '6' * 64
            refreshed['manifest']['extracted_at'] = '2026-10-06T00:00:00+00:00'
            refreshed['datasets']['projects'][0]['ProjectStatus'] = '3'
            refreshed['datasets']['project_groups'][0]['project_name_th'] = 'DW changed group'
            result = await dw.stage_package(db, refreshed, True, True)
            assert result['status'] == 'staged' and result['discarded_deleted_models'] == 1
            assert (await db.fetchval("SELECT hub.project_source_review('SYN-DW-A')"))['status_raw'] == '3'
            assert await db.fetchval("SELECT count(*) FROM staging.project_intake_evidence WHERE kind='business_projects'") == 2
            assert not await db.fetchval("SELECT EXISTS(SELECT 1 FROM staging.project_intake_evidence WHERE kind='business_projects' AND outcome='missing')")
            for role in ['hub_app', 'service_consumer', 'agency']:
                async with db.transaction():
                    await db.execute('SET LOCAL ROLE ' + role)
                    try:
                        async with db.transaction():
                            await db.fetch('SELECT * FROM staging.intake_batches WHERE manifest_sha256=$1', digest)
                    except asyncpg.InsufficientPrivilegeError:
                        pass
                    else:
                        raise AssertionError('Raw sheet evidence must remain private')
                await db.execute('RESET ROLE')
        finally:
            await outer.rollback()
            await db.close()
    asyncio.run(run())
