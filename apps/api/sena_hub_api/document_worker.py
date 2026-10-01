"""Local extraction only. The worker never reads fixture validation ground truth."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
import io
import json
import os
from pathlib import Path
import re
import subprocess
from uuid import UUID
from contextlib import asynccontextmanager

from pypdf import PdfReader

from .assets import validate_pdf
from .document_storage import ROOT, STORAGE_ROOT, MAX_BYTES, MAX_PAGES, DocumentStorageError

FIELDS = ('memo_no', 'subject', 'requesting_bud', 'gross_amount', 'mirrored_status', 'approval_date', 'period_start', 'period_end')
MONEY = re.compile(r'-?(?:0|[1-9][0-9]{0,11})\.[0-9]{2}\Z')
DATE = re.compile(r'[0-9]{4}-[0-9]{2}-[0-9]{2}\Z')


def local_ocr(image, *, job_id: str, page: int) -> dict:
    if os.name != 'nt':
        raise DocumentStorageError('LOCAL_OCR_UNAVAILABLE')
    identifier = str(UUID(job_id))
    work = STORAGE_ROOT / 'work' / identifier
    if work.resolve() != work.absolute() or not 1 <= page <= MAX_PAGES:
        raise DocumentStorageError('OCR_PATH_INVALID')
    work.mkdir(parents=True, exist_ok=True)
    path = work / f'page-{page}.png'
    if path.is_symlink():
        raise DocumentStorageError('OCR_PATH_INVALID')
    image.save(path, format='PNG')
    # Execute our own literal commands, without changing the machine's script
    # execution policy. No document text, password or token is an argument.
    script = (ROOT / 'scripts/local-document-ocr.ps1').read_text(encoding='utf-8')
    script = re.sub(r'^param\([^\r\n]+\)\r?\n', '', script)
    literal = lambda value: "'" + str(value).replace("'", "''") + "'"
    script = f'$ImagePath={literal(path)}; $ArchiveWorkRoot={literal(STORAGE_ROOT / "work")}\n' + script
    try:
        result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
            capture_output=True, encoding='utf-8', timeout=45,
            creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode:
            raise DocumentStorageError('LOCAL_OCR_UNAVAILABLE')
        data = json.loads(result.stdout)
        if not isinstance(data.get('text'), str) or not isinstance(data.get('lines'), list):
            raise DocumentStorageError('LOCAL_OCR_INVALID_RESULT')
        return data
    except (OSError, subprocess.TimeoutExpired, ValueError):
        raise DocumentStorageError('LOCAL_OCR_UNAVAILABLE') from None
    finally:
        path.unlink(missing_ok=True)


def extract_pages(content: bytes, *, job_id: str):
    if not content or len(content) > MAX_BYTES:
        raise DocumentStorageError('DOCUMENT_SIZE_INVALID')
    validate_pdf(content)
    reader = PdfReader(io.BytesIO(content), strict=True)
    if not 1 <= len(reader.pages) <= MAX_PAGES:
        raise DocumentStorageError('DOCUMENT_PAGE_LIMIT')
    for page_no, source in enumerate(reader.pages, 1):
        text = source.extract_text() or ''
        if len(text.strip()) >= 80 and text.count('\ufffd') / max(len(text), 1) < .02:
            yield {'page': page_no, 'method': 'TEXT', 'text': text, 'confidence': None,
                   'engine_version': 'pypdf-6', 'line_boxes': []}
        else:
            # Known fixtures contain a single full-page raster; unsupported page
            # layouts stay reviewable, never synthesized from expected fixture rows.
            images = list(source.images)
            if len(images) != 1:
                raise DocumentStorageError('LOCAL_OCR_PAGE_UNSUPPORTED')
            result = local_ocr(images[0].image, job_id=job_id, page=page_no)
            yield {'page': page_no, 'method': 'OCR', 'text': result['text'], 'confidence': None,
                   'engine_version': f"{result['engine']} {result['version']} {result['language']}",
                   'line_boxes': result['lines']}


def _label(line: str):
    if ':' not in line:
        return None
    key, value = line.split(':', 1)
    return key.strip().upper().replace(' ', '_'), value.strip()


def _money(value: str | None):
    return format(Decimal(value), '.2f') if isinstance(value, str) and MONEY.fullmatch(value) else None


def _date(value: str | None):
    try:
        return date.fromisoformat(value).isoformat() if value and DATE.fullmatch(value) else None
    except ValueError:
        return None


def _cost_type(descriptor: str | None):
    if not descriptor:
        return None
    for prefix, value in [('LINEPAY ', 'CHANNEL'), ('GOOGLE ', 'MEDIA'), ('META ', 'MEDIA'),
                          ('PLUGIN ', 'TOOL'), ('SOFTWARE ', 'TOOL'), ('AGENCY ', 'AGENCY_FEE'), ('BANK ', 'BANK_FEE')]:
        if descriptor.startswith(prefix):
            return value
    return None


def extract_fields(pages: list[dict], document_type: str) -> dict:
    """Extract observed values only; duplicates and unsupported values remain issues."""
    if document_type == 'E_MEMO':
        fields = dict.fromkeys(FIELDS)
        sources, seen = {}, set()
        for page in pages:
            for line in page['text'].splitlines():
                labelled = _label(line)
                if not labelled or labelled[0].lower() not in fields:
                    continue
                field, value = labelled[0].lower(), labelled[1]
                if field in seen:
                    fields[field] = None
                    continue
                seen.add(field)
                fields[field] = _money(value) if field == 'gross_amount' else _date(value) if field in ('approval_date', 'period_start', 'period_end') else value
                sources[field] = {'page': page['page'], 'confidence': page['confidence'], 'method': page['method'], 'observed_text': line}
        return {'pages': pages, 'fields': fields, 'field_sources': sources, 'rows': [], 'controls': {}}
    if document_type != 'CARD_STATEMENT':
        raise DocumentStorageError('DOCUMENT_TYPE_INVALID')
    rows, controls, counts, conflicts = [], {}, [], set()
    for page in pages:
        current = None
        def append_row():
            if current is not None:
                descriptor = current.get('DETAIL')
                rows.append({'page': page['page'], 'occurrence': current.get('occurrence'),
                    'charge_date': _date(current.get('DATE')), 'descriptor': descriptor,
                    'amount': _money(current.get('AMOUNT')), 'cost_type': _cost_type(descriptor),
                    'payment_method': 'CORPORATE_CARD'})
        before = len(rows)
        for line in page['text'].splitlines():
            labelled = _label(line)
            if not labelled:
                continue
            key, value = labelled
            if key == 'ROW':
                append_row()
                current = {'occurrence': int(value) if value.isascii() and value.isdigit() else None}
            elif key in ('DATE', 'DETAIL', 'AMOUNT') and current is not None:
                current[key] = value if key not in current else None
            elif key in ('ISSUER', 'CYCLE_START', 'CYCLE_END', 'DUE_DATE', 'MEANING', 'STATEMENT_TOTAL'):
                control = key.lower()
                normalized = _money(value) if control == 'statement_total' else _date(value) if control in ('cycle_start', 'cycle_end', 'due_date') else value.replace(' ', '_') if control == 'meaning' else value
                if control in controls and controls[control] != normalized:
                    conflicts.add(control)
                controls[control] = normalized
        append_row()
        counts.append({'page': page['page'], 'count': len(rows) - before})
    for conflict in conflicts:
        controls[conflict] = None
    controls['page_counts'] = counts
    return {'pages': pages, 'rows': rows, 'controls': controls, 'fields': {}, 'field_sources': {}}


def extract_document(content: bytes, document_type: str, *, job_id: str) -> dict:
    return extract_fields(list(extract_pages(content, job_id=job_id)), document_type)


@asynccontextmanager
async def local_connection():
    """CLI only: fixed local TEST target, never an environment-supplied DSN."""
    import asyncpg
    target = {'host': '127.0.0.1', 'port': 55432, 'database': 'sena_hub_local'}
    config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf-8'))
    if any(config.get(key, value) != value for key, value in target.items()):
        raise DocumentStorageError('LOCAL_TARGET_REQUIRED')
    db = await asyncpg.connect(**target, user='postgres', password=config['adminPassword'], timeout=10)
    try:
        actual = await db.fetchrow('SELECT current_database() AS database,host(inet_server_addr()) AS host,inet_server_port() AS port')
        if any(actual[key] != value for key, value in target.items()):
            raise DocumentStorageError('LOCAL_TARGET_REQUIRED')
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        yield db
    finally:
        await db.close()


async def work_once(db, *, worker_id='local-synthetic-worker') -> dict:
    from .document_storage import read_document
    async def rpc(sql, *args):
        async with db.transaction():
            await db.execute('SET LOCAL ROLE ads_document_worker')
            await db.execute("SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000042',true)")
            return await db.fetchval(sql, *args)
    job = await rpc('SELECT ads.archive_claim($1,120)', worker_id)
    if job is None:
        return {'status': 'IDLE'}
    job_id, token = UUID(job['job_id']), UUID(job['lease_token'])
    try:
        pages = []
        content = read_document(job['storage_key'], job['sha256'])
        for page in extract_pages(content, job_id=str(job_id)):
            pages.append(page)
            await rpc('SELECT ads.archive_heartbeat($1,$2)', job_id, token)
        if len(pages) != job['page_count']:
            raise DocumentStorageError('DOCUMENT_PAGE_LIMIT')
        result = extract_fields(pages, job['document_type'])
    except Exception as error:
        code = 'LOCAL_OCR_UNAVAILABLE' if isinstance(error, DocumentStorageError) and str(error) == 'LOCAL_OCR_UNAVAILABLE' else 'EXTRACTION_FAILED'
        await rpc('SELECT ads.archive_finish($1,$2,NULL,$3)', job_id, token, code)
        return {'status': 'FAILED', 'job_id': str(job_id), 'error_code': code}
    await rpc('SELECT ads.archive_finish($1,$2,$3,NULL)', job_id, token, result)
    return {'status': 'DRAFT', 'job_id': str(job_id), 'document_id': job['document_id'],
            'pages': len(pages), 'rows': len(result['rows']), 'methods': [page['method'] for page in pages]}
