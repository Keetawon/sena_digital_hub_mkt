"""One-command seed boundaries, exact fixture review and non-destructive replay."""
import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from sena_hub_api import document_storage, document_worker

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('hub_demo', ROOT / 'scripts/seed-hub-demo.py')
demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo)


class BoundaryDB:
    def __init__(self): self.events = []; self.claimed = False; self.foreign_expired = False; self.version_changed = False
    @asynccontextmanager
    async def transaction(self):
        before = self.claimed; self.events.append('begin')
        try:
            yield
        except BaseException:
            self.claimed = before; self.events.append('rollback'); raise
        else:
            self.events.append('commit')
    async def execute(self, sql, *args): self.events.append(sql)
    async def fetchval(self, sql, *args):
        self.events.append(sql)
        if 'FROM unnest' in sql: return self.version_changed
        if 'SELECT EXISTS' in sql: return self.foreign_expired
        if 'archive_claim' in sql:
            self.claimed = True
            return {'document_id': 'another-document'}
        raise AssertionError(sql)


def test_scoped_worker_rolls_back_foreign_claim_before_reading_bytes(monkeypatch):
    db = BoundaryDB()
    monkeypatch.setattr(document_storage, 'read_document', lambda *a: pytest.fail('Read a foreign document'))
    async def run():
        with pytest.raises(document_storage.DocumentStorageError, match='DEMO_QUEUE_CONFLICT'):
            await document_worker.work_once(db, allowed_document_ids={str(uuid4())})
    asyncio.run(run())
    assert not db.claimed and db.events[-1] == 'rollback'


def test_scoped_worker_does_not_expire_an_unrelated_lease():
    db = BoundaryDB(); db.foreign_expired = True
    async def run():
        with pytest.raises(document_storage.DocumentStorageError, match='DEMO_QUEUE_CONFLICT'):
            await document_worker.work_once(db, allowed_document_ids={str(uuid4())})
    asyncio.run(run())
    assert not db.claimed and db.events[-1] == 'rollback'
    lock = 'LOCK TABLE ads.archive_document IN EXCLUSIVE MODE'
    preflight = next(event for event in db.events if event.startswith('SELECT EXISTS'))
    assert db.events.index('SELECT hub.require_demo_seeder()') < db.events.index(lock) < db.events.index(preflight)
    assert "j.status IN('QUEUED','RETRY','RUNNING')" in preflight
    assert 'lease_until' not in preflight  # Active leases can expire while this check runs.


def test_regular_idle_worker_keeps_existing_unscoped_behavior():
    class IdleDB(BoundaryDB):
        async def fetchval(self, sql, *args):
            self.events.append(sql)
            assert 'archive_claim' in sql
            return None
    db = IdleDB()
    assert asyncio.run(document_worker.work_once(db)) == {'status': 'IDLE'}
    assert not any('LOCK TABLE' in event or 'require_demo_seeder' in event or 'SELECT EXISTS' in event for event in db.events)
    assert db.events[-1] == 'commit'


def test_scoped_version_change_is_checked_under_lock_before_claim():
    db = BoundaryDB(); db.version_changed = True
    document, version = str(uuid4()), str(uuid4())
    async def run():
        with pytest.raises(document_storage.DocumentStorageError, match='DEMO_VERSION_CONFLICT'):
            await document_worker.work_once(db, allowed_document_ids={document}, allowed_document_versions={document: version})
    asyncio.run(run())
    check = next(event for event in db.events if 'FROM unnest' in event)
    assert db.events.index('LOCK TABLE ads.archive_document IN EXCLUSIVE MODE') < db.events.index(check)
    assert not db.claimed and db.events[-1] == 'rollback'


def test_claimed_version_mismatch_rolls_back_without_reading_document(monkeypatch):
    document, version = str(uuid4()), str(uuid4())
    class ChangedClaimDB(BoundaryDB):
        async def fetchval(self, sql, *args):
            if 'archive_claim' in sql:
                self.claimed = True
                return {'document_id': document, 'version_id': str(uuid4())}
            return await super().fetchval(sql, *args)
    db = ChangedClaimDB()
    monkeypatch.setattr(document_storage, 'read_document', lambda *args: pytest.fail('Read a newer version'))
    async def run():
        with pytest.raises(document_storage.DocumentStorageError, match='DEMO_VERSION_CONFLICT'):
            await document_worker.work_once(db, allowed_document_ids={document}, allowed_document_versions={document: version})
    asyncio.run(run())
    assert not db.claimed and db.events[-1] == 'rollback'


def test_local_connection_refuses_configured_remote_before_connect(tmp_path, monkeypatch):
    import asyncpg
    (tmp_path / '.local').mkdir()
    (tmp_path / '.local/development.json').write_text(json.dumps({'host': 'remote.invalid', 'port': 55432, 'database': 'sena_hub_local', 'adminPassword': 'never-print'}))
    monkeypatch.setattr(document_worker, 'ROOT', tmp_path)
    monkeypatch.setattr(asyncpg, 'connect', lambda **kw: pytest.fail('Connected to a rejected target'))
    async def run():
        with pytest.raises(document_storage.DocumentStorageError, match='LOCAL_TARGET_REQUIRED'):
            async with document_worker.local_connection(): pytest.fail('Entered rejected local connection')
    asyncio.run(run())


@pytest.mark.parametrize('status,lease,expected_calls', [('RUNNING', '2000-01-01T00:00:00+00:00', 1),
    ('RUNNING', '2999-01-01T00:00:00+00:00', 0), ('FAILED', None, 0)])
def test_resume_only_processes_expired_lease_or_queued_work(monkeypatch, status, lease, expected_calls):
    calls = []
    async def states(db, receipts):
        return {'memo-hyabc-v1': {'id': 'owned-document', 'current_version_id': 'seed-v1', 'legal_hold': False, 'job': {'status': 'DRAFT' if calls else status, 'lease_until': lease}}}
    async def worker(db, **kwargs):
        calls.append(kwargs)
        return {'status': 'DRAFT'}
    monkeypatch.setattr(demo, 'document_states', states)
    monkeypatch.setattr(demo, 'work_once', worker)
    asyncio.run(demo.process_documents(None, [{'document_id': 'owned-document', 'version_id': 'seed-v1'}]))
    assert len(calls) == expected_calls
    if calls: assert calls[0]['allowed_document_ids'] == {'owned-document'}


def test_replay_never_extracts_presenters_queued_memo_v2(monkeypatch):
    current = {'id': 'owned-document', 'current_version_id': 'presenter-v2', 'legal_hold': False, 'job': {'status': 'QUEUED'}}
    async def states(db, receipts): return {'memo-hyabc-v1': current}
    async def worker(*args, **kwargs): pytest.fail('Seed processed a presenter version')
    monkeypatch.setattr(demo, 'document_states', states)
    monkeypatch.setattr(demo, 'work_once', worker)
    before = deepcopy(current)
    assert asyncio.run(demo.process_documents(None, [{'document_id': 'owned-document', 'version_id': 'seed-v1'}])) == [
        {'status': 'PRESERVED', 'error_code': 'DEMO_VERSION_CONFLICT'}]
    assert current == before


@pytest.mark.parametrize('held,version,status,expected', [(False, 'seed-v1', 'DRAFT', True),
    (False, 'seed-v1', 'CONFIRMED', True), (True, 'seed-v1', 'DRAFT', False),
    (True, 'seed-v1', 'CONFIRMED', False), (False, 'presenter-v2', 'DRAFT', False),
    (False, 'presenter-v2', 'CONFIRMED', False), (False, 'seed-v1', 'QUEUED', False)])
def test_statement_ready_requires_unheld_exact_seed_version(held, version, status, expected):
    assert demo.statement_review_ready({'legal_hold': held, 'current_version_id': version, 'job': {'status': status}}, 'seed-v1') == expected


@pytest.mark.parametrize('failure_stage', ['connect', 'seed', 'package', 'worker'])
def test_partial_failure_is_honest_and_resume_receipt_contains_no_secret(monkeypatch, failure_stage):
    db = BoundaryDB(); writes = []
    @asynccontextmanager
    async def connect():
        if failure_stage == 'connect': raise ValueError('postgresql://private:password@host')
        yield db
    async def prepare(db, fixtures):
        if failure_stage == 'seed': raise ValueError('private database details')
        return {'finance': {'_package_files': {'manifest.json': b'{}'}}, 'documents': {'receipts': []}}
    def package(files):
        assert db.events[-1] == 'commit'
        if failure_stage == 'package': raise ValueError('private filename')
        return {'path': 'ignored-path'}
    async def worker(db, receipts):
        assert db.events[-1] == 'commit'
        raise document_storage.DocumentStorageError('DEMO_QUEUE_CONFLICT')
    monkeypatch.setattr(demo, 'local_connection', connect)
    monkeypatch.setattr(demo, 'install_fixtures', lambda: [])
    monkeypatch.setattr(demo, 'prepare', prepare)
    monkeypatch.setattr(demo, 'persist_package', package)
    monkeypatch.setattr(demo, 'links', lambda receipt: {})
    monkeypatch.setattr(demo, 'process_documents', worker)
    monkeypatch.setattr(demo, 'atomic_write', lambda path, content: writes.append(json.loads(content)))
    result = asyncio.run(demo.run())
    committed = failure_stage in {'package', 'worker'}
    assert result['business_seed_committed'] == committed
    assert result['status'] == ('PARTIAL' if committed else 'FAILED')
    assert bool(writes) == committed
    assert 'private' not in json.dumps(result) and 'password' not in json.dumps(result)
    assert '_package_files' not in result.get('finance', {})
    if failure_stage == 'worker': assert result['error_code'] == 'DEMO_QUEUE_CONFLICT'


def test_package_bytes_are_frozen_validated_and_path_bounded(tmp_path, monkeypatch):
    monkeypatch.setattr(demo, 'ROOT', tmp_path)
    monkeypatch.setattr(demo, 'RECEIPT_ROOT', tmp_path / '.local/hub-demo')
    source = ROOT / 'supabase/tests/fixtures/ads_actuals'
    files = {name: (source / name).read_bytes() for name in demo.PACKAGE_NAMES}
    first = demo.persist_package(files)
    assert demo.persist_package(files) == first
    assert all((tmp_path / first['path'] / name).read_bytes() == content for name, content in files.items())
    with pytest.raises(ValueError, match='FILES_INVALID'):
        demo.persist_package({**files, '../secret.json': b'{}'})
    with pytest.raises(ValueError, match='PATH_INVALID'):
        demo.safe_directory(tmp_path / 'outside')
    (tmp_path / first['path'] / 'dim_media_line.json').write_bytes(b'[]')
    with pytest.raises(ValueError, match='FILE_CONFLICT'):
        demo.persist_package(files)


class MemoDB:
    def __init__(self):
        fixture = document_storage.fixture_catalog()[0]
        self.metadata = fixture['metadata']
        self.extracted = document_worker.extract_document(fixture['content'], 'E_MEMO', job_id=str(uuid4()))
        self.ownership = {'created_by': UUID(demo.SEED_ACTOR), 'updated_by': UUID(demo.SEED_ACTOR), 'received_by': UUID(demo.SEED_ACTOR)}
        self.calls = []
        self.search_eligible = True
        self.doc = {'id': str(uuid4()), 'current_version_id': str(uuid4()), 'revision': 3, 'legal_hold': False,
            'versions': [{}], 'current_version': {'fixture_id': 'memo-hyabc-v1', 'sha256': self.metadata['sha256']},
            'job': {'id': str(uuid4()), 'status': 'DRAFT'}, 'extraction': {'original_result': self.extracted, 'validation': {'valid': True}},
            'confirmation': None, 'application': None}
    async def execute(self, *args): pass
    async def fetchrow(self, *args): return self.ownership
    async def fetchval(self, sql, *args):
        if 'archive_read' in sql: return deepcopy(self.doc)
        if 'archive_search' in sql: return {'items': [{'document_id': self.doc['id'], 'version_id': self.doc['current_version_id']}] if self.search_eligible else []}
        if 'finance_read' in sql: return {'row_version': 3}
        self.calls.append((sql, deepcopy(args)))
        payload = args[1]
        if "'confirm'" in sql:
            assert payload['corrected_result'] == self.extracted
            assert payload['evidence'] == demo.REVIEW_EVIDENCE
            self.doc['confirmation'] = {'confirmed_by': demo.REVIEW_ACTOR, 'evidence': payload['evidence'], 'corrected_result': payload['corrected_result']}
            self.doc['job']['status'] = 'CONFIRMED'
        elif "'apply'" in sql:
            assert payload['mode'] == 'LINK_MEMO'
            self.doc['application'] = {'id': str(uuid4()), 'mode': payload['mode'], 'target_id': payload['target_id'], 'applied_by': demo.REVIEW_ACTOR}
        else: raise AssertionError(sql)
        self.doc['revision'] += 1
        self.ownership['updated_by'] = UUID(demo.REVIEW_ACTOR)
        return deepcopy(self.doc)


def test_pristine_memo_review_links_once_without_creating_financial_data():
    db = MemoDB(); memo_id = str(uuid4())
    async def run():
        first = await demo.confirm_seed_memo(db, db.doc['id'], memo_id, db.metadata, db.extracted)
        second = await demo.confirm_seed_memo(db, db.doc['id'], memo_id, db.metadata, db.extracted)
        assert first['status'] == second['status'] == 'SEARCH_READY'
        assert first['operation'] == 'APPLIED' and second['operation'] == 'PRESERVED'
    asyncio.run(run())
    assert len(db.calls) == 2
    assert not any('finance_command' in sql for sql, _ in db.calls)


def test_already_eligible_human_review_is_preserved_and_search_ready():
    db = MemoDB(); memo_id = str(uuid4()); human = str(uuid4())
    db.ownership['updated_by'] = UUID(human)
    db.doc['job']['status'] = 'CONFIRMED'
    db.doc['confirmation'] = {'confirmed_by': human, 'evidence': 'Human review preserved', 'corrected_result': db.extracted}
    db.doc['application'] = {'id': str(uuid4()), 'mode': 'LINK_MEMO', 'target_id': memo_id, 'applied_by': human}
    before = deepcopy(db.doc)
    result = asyncio.run(demo.confirm_seed_memo(db, db.doc['id'], memo_id, db.metadata, db.extracted))
    assert result['status'] == 'SEARCH_READY' and result['operation'] == 'PRESERVED' and result['review'] == 'EXISTING_REVIEW'
    assert db.doc == before and not db.calls
    db.search_eligible = False
    assert asyncio.run(demo.confirm_seed_memo(db, db.doc['id'], memo_id, db.metadata, db.extracted))['status'] == 'PRESERVED'


@pytest.mark.parametrize('change', ['owner', 'hold', 'version', 'hash', 'extraction', 'human_review', 'other_application'])
def test_archive_review_preserves_changed_or_human_owned_state(change):
    db = MemoDB(); memo_id = str(uuid4())
    if change == 'owner': db.ownership['created_by'] = uuid4()
    elif change == 'hold': db.doc['legal_hold'] = True
    elif change == 'version': db.doc['versions'].append({})
    elif change == 'hash': db.doc['current_version']['sha256'] = 'f' * 64
    elif change == 'extraction': db.doc['extraction']['original_result'] = {**db.extracted, 'fields': {'memo_no': 'OTHER'}}
    elif change == 'human_review': db.doc['confirmation'] = {'confirmed_by': str(uuid4()), 'evidence': 'Human review', 'corrected_result': db.extracted}
    else:
        db.doc['confirmation'] = {'confirmed_by': demo.REVIEW_ACTOR, 'evidence': demo.REVIEW_EVIDENCE, 'corrected_result': db.extracted}
        db.doc['application'] = {'id': str(uuid4()), 'mode': 'LINK_MEMO', 'target_id': str(uuid4()), 'applied_by': demo.REVIEW_ACTOR}
    before = deepcopy(db.doc)
    result = asyncio.run(demo.confirm_seed_memo(db, db.doc['id'], memo_id, db.metadata, db.extracted))
    assert result['status'] == 'PRESERVED' and db.doc == before and not db.calls


@pytest.mark.integration
@pytest.mark.skipif(os.getenv('HUB_DEMO_TEST') != '1', reason='Opt-in rollback-only fixed local TEST demo seed')
def test_complete_business_seed_replay_rolls_back_and_preserves_document_work():
    async def run():
        fixtures = document_storage.install_fixtures()
        async with document_worker.local_connection() as db:
            tables = ('hub.projects', 'hub.brands', 'hub.public_promotions', 'ads.campaign_registration', 'ads.campaign_name',
                'ads.memo', 'ads.media_line', 'ads.line_assignment', 'ads.cost_record', 'ads.archive_document', 'ads.archive_version',
                'ads.archive_job', 'ads.archive_receipt', 'ads.archive_confirmation', 'ads.archive_application')
            async def counts():
                await db.execute('RESET ROLE')
                return {table: await db.fetchval('SELECT count(*) FROM ' + table) for table in tables}
            before = await counts()
            outer = db.transaction(); await outer.start()
            try:
                first = await demo.prepare(db, fixtures)
                counted = await counts()
                second = await demo.prepare(db, fixtures)
                assert await counts() == counted
                assert first['finance']['memo_id'] == second['finance']['memo_id']
                assert first['finance']['card_batch_id'] == second['finance']['card_batch_id']
                assert first['finance']['_package_files'] == second['finance']['_package_files']
                assert len(first['documents']['receipts']) == 2
                assert {row['fixture_id'] for row in first['documents']['receipts']} == {'memo-hyabc-v1', 'statement-october-v1'}
                assert not second['residential']['introduced_fields']
                assert second['sena_h_approved'] is False
                # Receipt helpers never queue V2 or change an existing human-owned current pointer.
                assert all(row['operation'] == 'PRESERVED' for row in second['documents']['receipts'])
                await demo.process_documents(db, first['documents']['receipts'])
                states = await demo.document_states(db, first['documents']['receipts'])
                metadata = next(item for item, _ in fixtures if item['fixture_id'] == 'memo-hyabc-v1')
                extracted = document_worker.extract_document(document_storage.read_document(metadata['storage_key'], metadata['sha256']), 'E_MEMO', job_id=str(uuid4()))
                review = await demo.confirm_seed_memo(db, states['memo-hyabc-v1']['id'], first['finance']['memo_id'], metadata, extracted)
                assert review['status'] == 'SEARCH_READY', review
                after_link = await counts()
                assert after_link['ads.cost_record'] == counted['ads.cost_record'] and after_link['ads.memo'] == counted['ads.memo']
                repeated = await demo.prepare(db, fixtures)
                assert repeated['finance']['_package_files'] == first['finance']['_package_files']
                assert await counts() == after_link
                linked = await demo.confirm_seed_memo(db, states['memo-hyabc-v1']['id'], first['finance']['memo_id'], metadata, extracted)
                assert linked['status'] == 'SEARCH_READY' and linked['operation'] == 'PRESERVED'
                states = await demo.document_states(db, first['documents']['receipts'])
                assert states['statement-october-v1']['job']['status'] == 'DRAFT' and states['statement-october-v1']['application'] is None
                # Real asyncpg UUID-array casts and savepoint rollback: a presenter
                # explicitly queues V2, which the V1 demo selection must never claim.
                memo_document = states['memo-hyabc-v1']
                await db.execute('SET LOCAL ROLE online_staff')
                await db.execute("SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000007',true)")
                newer = await db.fetchval('SELECT ads.archive_receive($1)', {
                    'fixture_id': 'memo-hyabc-v2', 'document_id': memo_document['id'],
                    'expected_revision': memo_document['revision']})
                assert newer['current_version_id'] != memo_document['current_version_id']
                assert newer['job']['status'] == 'QUEUED' and newer['job']['attempt'] == 0
                version_map = {item['document_id']: item['version_id'] for item in first['documents']['receipts']}
                with pytest.raises(document_storage.DocumentStorageError, match='DEMO_VERSION_CONFLICT'):
                    await document_worker.work_once(db, allowed_document_ids=set(version_map), allowed_document_versions=version_map)
                await db.execute('SET LOCAL ROLE online_staff')
                untouched = await db.fetchval('SELECT ads.archive_read($1)', UUID(memo_document['id']))
                assert untouched == {key: value for key, value in newer.items() if key not in {'receipt_status', 'received_version_id'}}
                assert untouched['extraction'] is None and untouched['confirmation'] is None
                assert await demo.process_documents(db, first['documents']['receipts']) == [
                    {'status': 'PRESERVED', 'error_code': 'DEMO_VERSION_CONFLICT'}]
            finally:
                await outer.rollback()
                assert await counts() == before
    asyncio.run(run())
