"""Port-free execution of the real Knowledge rights handler with finite service doubles.

AST loading avoids importing application/database/provider dependencies in this
isolated worker; these are sequencing tests, not a replacement for SQL/RLS tests.
"""
import ast
import asyncio
from contextlib import asynccontextmanager, contextmanager
from copy import deepcopy
from datetime import datetime
import hashlib
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from uuid import UUID

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'apps/api/sena_hub_api/knowledge.py'


class Failure(Exception):
    def __init__(self, status, code, message=''):
        self.status_code, self.code, self.message = status, code, message


class DatabaseFailure(Exception):
    def __init__(self, state='P0092'):
        self.sqlstate = state


class Fixture:
    def __init__(self, mode='normal', count=1):
        self.mode, self.depth, self.slot = mode, 0, False
        self.max_depth = 0
        self.events, self.approvals, self.links = [], [], []
        self.reads = 0
        self.raw = b'fixed original candidate bytes'
        self.digest = hashlib.sha256(self.raw).hexdigest()
        self.asset = {'id': '00000000-0000-4000-8000-000000000009', 'updated_at': '2026-11-12T00:00:00+00:00'}
        self.evidence = {'sha256': self.digest, 'bytes': len(self.raw),
            'classification': {'people': 'absent', 'third_party_marks': 'absent', 'stock_imagery': 'absent'},
            'validated_metadata': {'checksum': self.digest, 'mime_type': 'image/jpeg', 'original_filename': 'candidate.jpg'}}
        self.record = {'id': '00000000-0000-4000-8000-000000000001', 'kind': 'asset', 'evidence': self.evidence,
            'review': {'decision': 'accepted', 'sena_owned': True, 'applies_to_project_ids': ['P'], 'revision': 1},
            'file_stock_present': mode == 'existing_stock'}
        self.resolved = {'processing_class': 'private_exact' if mode in {'private', 'legacy', 'legacy_new'} else 'marketing_raster',
            'context_stamp': 'fixed-stamp', 'input_limit': 1000}
        self.body = NS(confirmed=True, reason='synthetic reviewed reason', items=[
            NS(candidate_id=UUID(f'00000000-0000-4000-8000-{i+1:012d}'), expected_revision=1) for i in range(count)])
        self.count = count
        self.env = {'asyncio': asyncio, 'hashlib': hashlib, 'datetime': datetime, 'UUID': UUID,
            'failure': Failure, 'HTTPException': Failure, 'KNOWLEDGE_MAX_BYTES': 1000,
            'JSONResponse': lambda content, status_code=200, headers=None: NS(content=content, status_code=status_code, headers=headers),
            'PACK_SQL': 'PACK_SQL', 'PROGRAMMES': {},
            'asyncpg': NS(PostgresError=DatabaseFailure), 'UploadAdmissionError': type('Admission', (Exception,), {}),
            'UploadProcessingError': type('Processing', (Exception,), {}), 'processing_failure': lambda error: Failure(422,'invalid_upload_file'), 'settings': NS(environment='local'),
            'database': self.database, 'staff': self.staff, 'authentication': self.authentication,
            'local_candidate_bytes': self.read, 'prepare_supervised_upload': self.prepare,
            'run_upload_work': self.work, 'upload_slot': self.admission,
            'assets': NS(install_file=self.install, readable_file=self.verify)}
        tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
        nodes = []
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in {
                    'bulk_eligible', 'knowledge_pack_eligibility', 'checked_candidate_bytes', 'cleanup_unregistered_knowledge_file', 'rights', 'pack'}:
                node.decorator_list = []
                for arg in node.args.args:
                    arg.annotation = None
                node.returns = None
                if node.name in {'rights', 'pack'}:
                    node.args.defaults = []
                nodes.append(node)
        exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), str(SOURCE), 'exec'), self.env)

    @asynccontextmanager
    async def database(self, request, actor):
        self.depth += 1
        self.max_depth = max(self.max_depth, self.depth)
        self.events.append('transaction')
        approved, linked = len(self.approvals), len(self.links)
        try:
            yield self
        except BaseException:
            del self.approvals[approved:]
            del self.links[linked:]
            raise
        finally:
            self.depth -= 1

    @contextmanager
    def admission(self):
        if self.mode == 'busy': raise self.env['UploadAdmissionError']('upload_busy')
        assert not self.slot
        self.slot = True
        try:
            yield
        finally:
            self.slot = False

    async def fetchval(self, sql, *args):
        self.events.append(sql.split('(')[0])
        if sql == 'PACK_SQL':
            items = [deepcopy(self.record) for _ in range(self.count)]
            for item in items: item.pop('file_stock_present', None)
            return {'card': {}, 'items': items, 'followup': {}, 'faq_controls': {}}
        if 'lock_knowledge_asset' in sql:
            if self.mode == 'pack_denied': raise DatabaseFailure('42501')
            self.reads += 1
            result = deepcopy(self.record)
            if self.mode == 'stale' and self.reads > self.count + 1:
                result['evidence']['sha256'] = 'changed'
            return result
        if 'asset_upload_context' in sql:
            return deepcopy(self.resolved)
        if 'find_uploaded_asset_source' in sql:
            return {'found': True} if self.mode == 'original' else None
        if 'record_asset_upload_source' in sql:
            assert args[1]['checksum'] == self.digest
            assert args[-1] == 'fixed-stamp'
            if self.mode in {'legacy', 'legacy_new'}:
                raise DatabaseFailure()
            return {'asset': deepcopy(self.asset), 'reused': self.mode == 'original',
                    'reuse_kind': 'original' if self.mode == 'original' else 'none'}
        if 'register_uploaded_asset' in sql:
            return {'asset': deepcopy(self.asset), 'reused': self.mode != 'legacy_new'}
        if 'review_asset' in sql:
            self.approvals.append(str(args[0]))
            return {}
        raise AssertionError(sql)

    async def execute(self, sql, *args):
        if 'knowledge_link_approved_asset' in sql:
            self.events.append('link')
            self.links.append(str(args[0]))
        elif 'pg_advisory_xact_lock' not in sql:
            raise AssertionError(sql)

    async def work(self, function, *args):
        assert self.slot
        return function(*args)

    def read(self, evidence, max_bytes=1000):
        assert self.depth == 0
        self.events.append('read')
        assert any('asset_upload_context' in event for event in self.events)
        return self.raw

    async def prepare(self, raw, mime, filename, resolved, existing, **kwargs):
        assert self.depth == 0
        self.events.append('prepare')
        assert any('find_uploaded_asset_source' in event for event in self.events)
        return NS(content=None if existing else b'processed output',
            metadata={'checksum': self.digest, 'storage_path': self.digest + '.jpg'},
            original={'checksum': self.digest}, processing={}, thumbnail=None, thumbnail_error='render_failed',
            suggestions={'values': {'stock': 'present'} if self.mode == 'new_stock' else {}})

    def install(self, content, metadata, prepared_thumbnail=None):
        assert self.depth == 1
        self.events.append('install')
        return True

    def verify(self, asset):
        assert self.depth == 1
        assert asset == self.asset
        self.events.append('verify')

    async def authentication(self, request):
        self.events.append('reauthenticate')
        return 'actor'

    async def staff(self, request, actor):
        return actor

    def run(self):
        async def disconnected(): return False
        return asyncio.run(self.env['rights'](self.body, NS(is_disconnected=disconnected), 'actor'))


class KnowledgeUploadChecks(unittest.TestCase):
    def test_current_stock_excludes_before_file_read(self):
        f = Fixture('existing_stock')
        with self.assertRaises(Failure) as error: f.run()
        self.assertEqual(error.exception.code, 'knowledge_rights_ineligible')
        self.assertNotIn('read', f.events)
        self.assertFalse(f.approvals)

    def test_new_file_prepares_outside_transaction_then_approves(self):
        f = Fixture()
        self.assertEqual(f.run()['data']['approved'], [str(f.body.items[0].candidate_id)])
        self.assertEqual(f.events.count('install'), 1)
        self.assertIn('reauthenticate', f.events)
        self.assertEqual(f.evidence['sha256'], f.digest)
        self.assertFalse(f.slot)

    def test_original_reuse_verifies_stored_winner(self):
        f = Fixture('original'); f.run()
        self.assertIn('verify', f.events)
        self.assertNotIn('install', f.events)

    def test_stock_or_unknown_private_source_never_auto_approved(self):
        for mode, code in [('private', 'knowledge_category_required'), ('new_stock', 'knowledge_rights_ineligible')]:
            f = Fixture(mode)
            with self.subTest(mode=mode), self.assertRaises(Failure) as error: f.run()
            self.assertEqual(error.exception.code, code)
            self.assertFalse(f.approvals or f.links)
            self.assertFalse(f.slot)

    def test_only_proven_existing_exact_history_uses_legacy_entry(self):
        f = Fixture('legacy'); f.run()
        self.assertIn('verify', f.events)
        self.assertNotIn('install', f.events)
        f = Fixture('legacy_new')
        with self.assertRaises(Failure): f.run()
        self.assertFalse(f.approvals or f.links)

    def test_stale_evidence_rolls_back_all_rights(self):
        f = Fixture('stale', count=2)
        with self.assertRaises(Failure): f.run()
        self.assertEqual(f.reads, 4)
        self.assertEqual(f.events.count('SELECT hub.review_asset'), 1)
        self.assertEqual(f.events.count('link'), 1)
        self.assertFalse(f.approvals or f.links)
        self.assertFalse(f.slot)

    def test_pack_excludes_known_stock_and_scoped_denial_without_file_work(self):
        for mode in ('existing_stock', 'pack_denied'):
            f = Fixture(mode)
            row = deepcopy(f.record); row.pop('file_stock_present')
            request = NS(state=NS(account={'capabilities': {'tabs': {'knowledge': {'approve': True}}}}))
            value = asyncio.run(f.env['knowledge_pack_eligibility'](row, request, 'actor', f.database))
            self.assertFalse(value)
            self.assertNotIn('read', f.events)
            self.assertNotIn('prepare', f.events)
            self.assertEqual(f.depth, 0)
            self.assertNotIn('file_stock_present', row)

    def test_pack_without_approve_does_not_call_rights_lock(self):
        f = Fixture()
        request = NS(state=NS(account={'capabilities': {'tabs': {'knowledge': {'view': True}}}}))
        value = asyncio.run(f.env['knowledge_pack_eligibility'](f.record, request, 'actor', f.database))
        self.assertTrue(value)
        self.assertFalse(f.events)

    def test_busy_response_retains_retry_headers_without_exception_handler(self):
        f = Fixture('busy'); response = f.run()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers, {'Retry-After': '1', 'Cache-Control': 'no-store'})
        self.assertEqual(response.content['error']['code'], 'upload_busy')
        self.assertFalse(f.events)

    def test_pack_finishes_original_transaction_before_each_eligibility_lock(self):
        f = Fixture(count=2)
        request = NS(state=NS(account={'capabilities': {'tabs': {'knowledge': {'approve': True}}}}))
        response = asyncio.run(f.env['pack']('P', request, 'actor'))
        self.assertEqual(len(response['data']['items']), 2)
        self.assertTrue(all(row['bulk_rights_eligible'] for row in response['data']['items']))
        self.assertEqual(f.max_depth, 1)
        self.assertEqual(f.depth, 0)
        self.assertEqual(f.events.count('transaction'), 3)
        self.assertNotIn('read', f.events)
        self.assertNotIn('prepare', f.events)

    def test_changed_copy_is_registered_in_shared_section(self):
        document = (ROOT / 'docs/47-unified-content-workspace.md').read_text(encoding='utf-8')
        section = document.split('### 8.5 Shared interface copy', 1)[1].split('### 8.6', 1)[0]
        labels = {parts[1].strip(): parts[2].strip() for line in section.splitlines()
                  if line.startswith('|') and len(parts := line.split('|')) >= 4}
        aliases = {'invalid_upload_file': 'upload_invalid_file', 'file_too_large': 'knowledge_upload_context_limit'}
        required = {'upload_context_changed', 'knowledge_category_required', 'knowledge_rights_ineligible',
                    'knowledge_integrity', 'invalid_upload_file', 'file_too_large'}
        found = set()
        for node in ast.walk(ast.parse(SOURCE.read_text(encoding='utf-8'))):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'failure'
                    and len(node.args) >= 3 and isinstance(node.args[1], ast.Constant) and node.args[1].value in required):
                code = node.args[1].value
                self.assertEqual(node.args[2].value, labels[aliases.get(code, code)])
                found.add(code)
        from sena_hub_api.upload_supervision import PROCESSING_MESSAGES, processing_failure
        for code in ('jpeg_pixel_limit','png_pixel_limit','png_hdr_requires_export','pdf_pixel_limit',
                     'upload_processing_memory','upload_processing_timeout','upload_processing_failed'):
            self.assertEqual(PROCESSING_MESSAGES[code], labels[code])
        self.assertEqual(processing_failure(ValueError('synthetic')).detail['message'],labels['upload_invalid_file'])
        found.add('invalid_upload_file')
        self.assertEqual(found, required)
        response = Fixture('busy').run()
        self.assertEqual(response.content['error']['message'], labels['upload_busy'])

    def test_shared_asset_in_batch_is_reviewed_once_and_linked_twice(self):
        f = Fixture(count=2); f.run()
        self.assertEqual(len(f.approvals), 1)
        self.assertEqual(len(f.links), 2)


if __name__ == '__main__':
    unittest.main()