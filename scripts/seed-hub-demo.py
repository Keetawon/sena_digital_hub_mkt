"""Prepare the coherent local TEST walkthrough; never reset changed records.

Business seeds commit together. OCR follows outside that transaction. A later
failure is PARTIAL and safely resumable, not a claim that the seed rolled back.
An unrelated queued document blocks this command rather than being processed.
"""
import asyncio
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlencode
from uuid import UUID, NAMESPACE_URL, uuid5

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/api'))
from sena_hub_api.actuals_import import validate_package  # noqa: E402
from sena_hub_api.document_storage import install_fixtures, read_document  # noqa: E402
from sena_hub_api.document_worker import extract_document, local_connection, work_once  # noqa: E402

RECEIPT_ROOT = ROOT / '.local/hub-demo'
SEED_ACTOR = '00000000-0000-0000-0000-000000000041'
REVIEW_ACTOR = '00000000-0000-0000-0000-000000000061'
REVIEW_EVIDENCE = 'SYNTHETIC-DEMO fixture-review: exact generated memo text-layer extraction; local sample only, not human review or E-memo approval'
PACKAGE_NAMES = frozenset({'manifest.json', 'dim_media_line.json', 'bridge_native_campaign_media_line.json',
    'fact_media_line_monthly.json', 'fact_marketing_ops_finding.json'})


def helper(filename):
    spec = importlib.util.spec_from_file_location(filename.replace('-', '_'), ROOT / 'scripts' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def prepare(db, fixtures):
    """Caller owns one transaction, including the finance generation apply."""
    await db.execute('RESET ROLE')
    await db.execute('SELECT hub.require_demo_seeder()')
    await db.execute("SELECT pg_advisory_xact_lock(hashtextextended('hub-demo-oct2026-v1',0))")
    result = {'environment': 'local-test', 'presentation_month': '2026-10-01', 'synthetic_only': True}
    for key, filename in (('residential', 'seed-residential-demo.py'), ('finance', 'seed-demo-finance.py'), ('assistant', 'seed-assistant-demo.py')):
        await db.execute('RESET ROLE')
        result[key] = await helper(filename).seed(db)
    await db.execute('RESET ROLE')
    result['documents'] = await helper('seed-document-demo.py').seed(db, fixtures)
    await db.execute('RESET ROLE')
    result['residential']['public_project_id'] = await db.fetchval('SELECT public_project_id FROM hub.projects WHERE id=$1', UUID(result['residential']['project_id']))
    result['residential']['public_brand_id'] = await db.fetchval('SELECT public_brand_id FROM hub.brands WHERE id=$1', UUID(result['residential']['brand_id']))
    approved = await db.fetchval("SELECT value FROM ads.setting WHERE key='sena_h_approved'")
    if approved is not False:
        raise ValueError('SENA_H_APPROVAL_CONFLICT')
    result['sena_h_approved'] = False
    return result


async def document_states(db, receipts):
    async with db.transaction():
        await db.execute('SET LOCAL ROLE online_staff')
        await db.execute("SELECT set_config('app.actor_id',$1,true)", REVIEW_ACTOR)
        return {item['fixture_id']: await db.fetchval('SELECT ads.archive_read($1)', UUID(item['document_id'])) for item in receipts}


async def process_documents(db, receipts):
    """Never retry failed/held work or touch a different queued document."""
    allowed = {item['document_id'] for item in receipts}
    versions = {item['document_id']: item['version_id'] for item in receipts}
    outcomes = []
    for _ in range(4):
        states = await document_states(db, receipts)
        if any(doc['current_version_id'] != versions[doc['id']] for doc in states.values()):
            outcomes.append({'status': 'PRESERVED', 'error_code': 'DEMO_VERSION_CONFLICT'})
            break
        pending = [doc for doc in states.values() if not doc['legal_hold'] and
            (doc['job']['status'] in {'QUEUED', 'RETRY'} or (doc['job']['status'] == 'RUNNING'
             and doc['job']['lease_until'] and datetime.fromisoformat(doc['job']['lease_until']) <= datetime.now(timezone.utc)))]
        if not pending:
            break
        outcome = await work_once(db, worker_id='hub-demo-local-worker', allowed_document_ids=allowed, allowed_document_versions=versions)
        outcomes.append(outcome)
        if outcome['status'] in {'IDLE', 'FAILED'}:
            break
    return outcomes


def statement_review_ready(document, seeded_version_id):
    return (not document['legal_hold'] and document['current_version_id'] == seeded_version_id
            and document['job']['status'] in {'DRAFT', 'CONFIRMED'})


async def confirm_seed_memo(db, document_id, memo_id, metadata, extracted):
    """Only a pristine owned memo is auto-reviewed as an explicit synthetic fixture."""
    await db.execute('RESET ROLE')
    await db.execute('SELECT hub.require_demo_seeder()')
    await db.execute('SELECT pg_advisory_xact_lock(1560022)')
    ownership = await db.fetchrow('''SELECT d.created_by,d.updated_by,v.received_by FROM ads.archive_document d
        JOIN ads.archive_version v ON v.id=d.current_version_id WHERE d.id=$1 FOR UPDATE OF d''', UUID(document_id))
    await db.execute('SET LOCAL ROLE online_staff')
    await db.execute("SELECT set_config('app.actor_id',$1,true)", REVIEW_ACTOR)
    doc = await db.fetchval('SELECT ads.archive_read($1)', UUID(document_id))
    result = {'document_id': document_id, 'version_id': doc['current_version_id'], 'memo_id': str(memo_id), 'status': 'PRESERVED'}
    application, confirmation = doc.get('application'), doc.get('confirmation')
    if (not doc['legal_hold'] and doc['current_version']['fixture_id'] == 'memo-hyabc-v1'
            and doc['current_version']['sha256'] == metadata['sha256'] and application and confirmation
            and application['target_id'] == str(memo_id)
            and confirmation['corrected_result'] == extracted):
        # A valid human-reviewed link is already useful. Preserve its reviewer and evidence.
        found = await db.fetchval("SELECT ads.archive_search($1,'{}'::jsonb)", extracted['fields']['memo_no'])
        if any(item['document_id'] == document_id and item['version_id'] == doc['current_version_id'] for item in found['items']):
            return {**result, 'status': 'SEARCH_READY', 'operation': 'PRESERVED', 'review': 'EXISTING_REVIEW', 'application_id': application['id']}
    if (not ownership or str(ownership['created_by']) != SEED_ACTOR or str(ownership['received_by']) != SEED_ACTOR
            or str(ownership['updated_by']) not in {SEED_ACTOR, REVIEW_ACTOR}
            or doc['legal_hold'] or len(doc['versions']) != 1
            or doc['current_version']['fixture_id'] != 'memo-hyabc-v1'
            or doc['current_version']['sha256'] != metadata['sha256']):
        return {**result, 'reason': 'CHANGED_OR_UNOWNED_DOCUMENT'}
    if not doc['extraction'] or doc['extraction']['original_result'] != extracted or not doc['extraction']['validation']['valid']:
        return {**result, 'reason': 'EXTRACTION_REQUIRES_REVIEW'}
    if confirmation and (confirmation['confirmed_by'] != REVIEW_ACTOR or confirmation['evidence'] != REVIEW_EVIDENCE or confirmation['corrected_result'] != extracted):
        return {**result, 'reason': 'EXISTING_REVIEW_PRESERVED'}
    if application:
        return {**result, 'reason': 'EXISTING_APPLICATION_PRESERVED'}
    if not confirmation:
        if doc['job']['status'] != 'DRAFT':
            return {**result, 'reason': 'DRAFT_NOT_READY'}
        doc = await db.fetchval("SELECT ads.archive_command('confirm',$1,$2)", UUID(document_id), {
            'expected_revision': doc['revision'], 'expected_version_id': doc['current_version_id'],
            'expected_job_id': doc['job']['id'], 'corrected_result': extracted, 'evidence': REVIEW_EVIDENCE})
    memo = await db.fetchval("SELECT ads.finance_read('memos',$1)", str(memo_id))
    doc = await db.fetchval("SELECT ads.archive_command('apply',$1,$2)", UUID(document_id), {
        'expected_revision': doc['revision'], 'expected_version_id': doc['current_version_id'], 'expected_job_id': doc['job']['id'],
        'mode': 'LINK_MEMO', 'target_id': str(memo_id), 'expected_target_version': memo['row_version'],
        'reason': REVIEW_EVIDENCE, 'request_id': str(uuid5(NAMESPACE_URL, 'sena-hub-demo-memo:' + doc['current_version_id']))})
    return {**result, 'status': 'SEARCH_READY', 'operation': 'APPLIED', 'application_id': doc['application']['id']}


def safe_directory(path):
    base = RECEIPT_ROOT.absolute()
    target = path.absolute()
    if base.resolve() != base or target.resolve() != target or not target.is_relative_to(base):
        raise ValueError('DEMO_OUTPUT_PATH_INVALID')
    target.mkdir(parents=True, exist_ok=True)
    return target


def atomic_write(path, content, *, immutable=False):
    safe_directory(path.parent)
    if path.is_symlink():
        raise ValueError('DEMO_OUTPUT_PATH_INVALID')
    if immutable and path.exists():
        if path.read_bytes() != content: raise ValueError('DEMO_PACKAGE_FILE_CONFLICT')
        return
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.demo-', delete=False) as stream:
            temporary = Path(stream.name); stream.write(content); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists(): temporary.unlink()


def persist_package(files):
    if set(files) != PACKAGE_NAMES or any(not isinstance(content, bytes) for content in files.values()):
        raise ValueError('DEMO_PACKAGE_FILES_INVALID')
    import hashlib
    generation = hashlib.sha256(files['manifest.json']).hexdigest()
    path = safe_directory(RECEIPT_ROOT / 'ads_actuals' / generation)
    for name, content in files.items(): atomic_write(path / name, content, immutable=True)
    package = validate_package(path)
    return {'path': str(path.relative_to(ROOT)), **package.summary()}


def links(receipt):
    res, finance = receipt['residential'], receipt['finance']
    documents = {item['fixture_id']: item['document_id'] for item in receipt['documents']['receipts']}
    result = {'project': '/?' + urlencode({'project': res['public_project_id']}),
        'brand': '/?' + urlencode({'brand': res['public_brand_id']}),
        'promotion': '/promotions?' + urlencode({'promotion': res['promotion_id']}),
        'memo': '/ads/finance?' + urlencode({'view': 'memos', 'record': finance['memo_id']}),
        'card_batch': '/ads/finance?' + urlencode({'view': 'card-imports', 'record': finance['card_batch_id']}),
        'commitment': '/ads/finance?' + urlencode({'view': 'commitments', 'record': finance['commitment_id']}),
        'actuals': '/ads/actuals?month=2026-10-01', 'exceptions': '/ads/exceptions?month=2026-10-01',
        'memo_document': '/ads/archive?' + urlencode({'document': documents['memo-hyabc-v1']}),
        'statement_document': '/ads/archive?' + urlencode({'document': documents['statement-october-v1']})}
    for kind in ('group', 'brand'):
        result[kind + '_line'] = '/ads/finance?' + urlencode({'view': 'media-lines', 'record': finance['line_ids'][kind], 'month': '2026-10-01'})
        result[kind + '_actuals'] = '/ads/actuals?' + urlencode({'line': finance['line_ids'][kind], 'month': '2026-10-01'})
        result[kind + '_campaign'] = '/ads/registry?' + urlencode({'registration': finance['codes'][kind]})
    return result


async def run():
    receipt = {'status': 'FAILED', 'environment': 'local-test', 'business_seed_committed': False, 'stage': 'LOCAL_TARGET'}
    try:
        async with local_connection() as db:
            fixtures = install_fixtures()
            receipt['stage'] = 'BUSINESS_SEED'
            async with db.transaction():
                seeded = await prepare(db, fixtures)
            receipt.update(status='PARTIAL', business_seed_committed=True, stage='PACKAGE_RECEIPT')
            package_files = seeded['finance'].pop('_package_files')
            receipt.update(seeded)
            receipt['package'] = persist_package(package_files)
            receipt['links'] = links(receipt)
            receipt['stage'] = 'LOCAL_EXTRACTION'
            receipt['worker'] = await process_documents(db, receipt['documents']['receipts'])
            states = await document_states(db, receipt['documents']['receipts'])
            receipt['stage'] = 'SYNTHETIC_MEMO_REVIEW'
            metadata = next(metadata for metadata, _ in fixtures if metadata['fixture_id'] == 'memo-hyabc-v1')
            # Compare the actual known PDF's text extraction; never replace OCR output with fixture truth.
            extracted = extract_document(read_document(metadata['storage_key'], metadata['sha256']), 'E_MEMO', job_id=str(UUID(int=1)))
            async with db.transaction():
                receipt['memo_review'] = await confirm_seed_memo(db, states['memo-hyabc-v1']['id'], receipt['finance']['memo_id'], metadata, extracted)
            states = await document_states(db, receipt['documents']['receipts'])
            receipt['document_statuses'] = {key: {'document_id': doc['id'], 'version_id': doc['current_version_id'],
                'job_status': doc['job']['status'], 'legal_hold': doc['legal_hold']} for key, doc in states.items()}
            receipt['statement_link'] = {'mode': 'LINK_CARD', 'target_id': receipt['finance']['card_batch_id'],
                'status': 'MANUAL_REVIEW_REQUIRED', 'warning': 'Compare source rows, correct OCR and confirm transcription; link the existing batch without creating expenses.'}
            statement_version = next(item['version_id'] for item in receipt['documents']['receipts'] if item['fixture_id'] == 'statement-october-v1')
            ready = receipt['memo_review']['status'] == 'SEARCH_READY' and statement_review_ready(states['statement-october-v1'], statement_version)
            receipt.update(status='READY' if ready else 'PARTIAL', stage='COMPLETE' if ready else 'MANUAL_REVIEW_REQUIRED')
    except Exception as error:
        # No exception details: database errors and connection strings may contain secrets/data.
        safe_codes = {'DEMO_QUEUE_CONFLICT', 'DEMO_VERSION_CONFLICT', 'DEMO_SCOPE_INVALID', 'LOCAL_TARGET_REQUIRED', 'DOCUMENT_HASH_MISMATCH',
                      'DEMO_OUTPUT_PATH_INVALID', 'DEMO_PACKAGE_FILES_INVALID', 'DEMO_PACKAGE_FILE_CONFLICT'}
        receipt['error_code'] = str(error) if str(error) in safe_codes else type(error).__name__
    receipt['generated_at'] = datetime.now(timezone.utc).isoformat()
    if receipt['business_seed_committed']:
        try:
            atomic_write(RECEIPT_ROOT / 'receipt.json', json.dumps(receipt, ensure_ascii=False, indent=2).encode('utf-8') + b'\n')
        except Exception:
            receipt.update(status='PARTIAL', stage='RECEIPT_WRITE', error_code='RECEIPT_WRITE_FAILED')
    return receipt


if __name__ == '__main__':
    result = asyncio.run(run())
    print(json.dumps(result, ensure_ascii=True, indent=2))
    raise SystemExit(0 if result['status'] == 'READY' else 1)
