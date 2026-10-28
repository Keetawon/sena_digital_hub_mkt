"""Guarded, provider-free completion of an explicitly reviewed backlog package.

This operator helper grants no API or database permission and changes no queue
rules. Call inside one transaction using the existing authorized operator.
"""
from collections import Counter
from hashlib import sha256
import re
from uuid import UUID

METHOD = 'offline_batch'
TOKENS = re.compile(r'\{[A-Za-z_][A-Za-z0-9_.]*\}|\d+(?:[.,]\d+)*')
THAI = re.compile(r'[\u0e00-\u0e7f]')
UNITS = ((r'(?<![ก-๙A-Za-z])ตร\.?\s*ม\.?|ตารางเมตร', r'(?i)(?:sq\.?\s*m\.?|square met(?:re|er)s?)'),
         (r'(?<![ก-๙A-Za-z])ตร\.?\s*ว\.?|ตารางวา', r'(?i)(?:sq\.?\s*w(?:ah)?\.?|square wah)'),
         (r'กม\.|กิโลเมตร', r'(?i)(?:km\b|kilomet(?:re|er)s?)'))
NAME_FIELDS = frozenset({'place.name', 'facility.display_name', 'commercial_type.public_name'})
ABBREVIATION_END = re.compile(r'(?i)(?:\b(?:Co|Ltd|St|Rd|Ave|Blvd|Dr|Mr|Mrs|Ms|Prof|Inc|Corp|Jr|Sr|No|Dept|Univ|Pte|Pvt|PLC|Bldg|Mt|Ft)\.|\bsq\.?\s*(?:m|ft)\.|(?:\b[A-Za-z]\.){2,})$')


def is_name_draft(field_key: str, source: str, english: str) -> bool:
    if field_key in NAME_FIELDS:
        return True
    # Ambiguous or paragraph-like concepts stay untouched for Marketing review.
    return (field_key == 'section.concept_name' and len(source) <= 120 and len(english) <= 240 and '..' not in english
            and not re.search(r'[\r\n!?]|\.\s+\S', english.rstrip().removesuffix('.')))


def clean_name_draft(field_key: str, source: str, english: str) -> str:
    if not is_name_draft(field_key, source, english):
        return english
    result = re.sub(r' {2,}', ' ', english).rstrip()
    result = re.sub(r'(?i)(?<![A-Za-z])km\.(?=$|\s)', lambda m: m[0][:-1], result)
    if result.endswith('.') and not ABBREVIATION_END.search(result):
        result = result[:-1].rstrip()
    return result


def validate_text(source: str, english: str, glossary: list[dict], *, field_key: str = '') -> None:
    if not isinstance(english, str) or not english.strip() or THAI.search(english):
        raise ValueError('empty_or_thai_output')
    if Counter(TOKENS.findall(source)) != Counter(TOKENS.findall(english)):
        raise ValueError('placeholder_or_number_changed')
    for thai_unit, english_unit in UNITS:
        if len(re.findall(thai_unit, source)) > len(re.findall(english_unit, english)):
            raise ValueError('unit_changed')
    terms = {r['term']['th']: r['term']['en'] for r in glossary if r['status'] != 'retired'
             and r['term'].get('th') and r['term'].get('en')}
    if terms:
        pattern = re.compile('|'.join(re.escape(t) for t in sorted(terms, key=lambda t: -len(t))))
        for term in pattern.findall(source):
            if terms[term] not in english:
                raise ValueError('glossary_changed')
    if re.search(r'นอนดี|non_dee', source, re.I):
        raise ValueError('non_dee_needs_review')
    if clean_name_draft(field_key, source, english) != english:
        raise ValueError('name_punctuation_needs_cleanup')


async def apply_batch(db, actor: UUID, rows: list[dict], glossary: list[dict]) -> dict:
    """The caller owns transaction, backup and protected-state comparisons."""
    await db.execute("SELECT set_config('app.actor_id',$1,true)", str(actor))
    # Check every tab before the first write; a viewer cannot partially import.
    for tab in sorted({r['source_tab'] for r in rows}):
        await db.fetchval('SELECT hub.require_permission($1,$2)', tab, 'edit')
    for row in rows:
        validate_text(row['th_text'], row['en'], glossary)
        if sha256(row['th_text'].encode()).hexdigest() != row['th_sha256']:
            raise ValueError('package_source_hash_changed')
        if row.get('flags'):
            raise ValueError('flagged_row_not_importable')
    completed, replayed, skipped = [], [], []
    for row in sorted(rows, key=lambda r: r['job_id']):
        key = UUID(row['job_id'])
        await db.fetchval('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', METHOD + ':' + str(key))
        job = await db.fetchrow('SELECT * FROM hub.translation_jobs WHERE id=$1 FOR UPDATE', key)
        if job is None or str(job['translation_id']) != row['translation_id']:
            raise ValueError('job_identity_changed')
        current = await db.fetchrow('SELECT * FROM hub.content_translations WHERE id=$1 FOR UPDATE', job['translation_id'])
        # An already completed source job is the durable replay marker.
        if job['status'] == 'done' and job['model'] == METHOD and job['draft_en'] == row['en']:
            if (current['th_version'] == row['th_version'] and current['th_sha256'] == row['th_sha256']
                    and current['machine_en'] == row['en'] and current['en_from_th_version'] == row['th_version']):
                replayed.append(str(key)); continue
            skipped.append({'job_id': str(key), 'reason': 'stale'}); continue
        if (job['th_version'] != row['th_version'] or job['th_sha256'] != row['th_sha256']
                or current['th_version'] != row['th_version'] or current['th_sha256'] != row['th_sha256']):
            skipped.append({'job_id': str(key), 'reason': 'stale'}); continue
        if any(current[name] is not None and current[name].strip() for name in ('reviewed_en', 'entered_en')):
            skipped.append({'job_id': str(key), 'reason': 'human_english'}); continue
        if current['machine_en'] is not None and current['machine_en'] != row['en']:
            skipped.append({'job_id': str(key), 'reason': 'existing_machine_draft'}); continue
        if job['status'] not in ('queued', 'failed'):
            skipped.append({'job_id': str(key), 'reason': 'job_state'}); continue
        for name in ('owner_type', 'owner_key', 'field_key', 'source_tab', 'scope_id'):
            if current[name] != row[name]:
                raise ValueError('source_identity_changed')
        allowed = await db.fetchval('''SELECT hub.translation_allowed($1) AND hub.translation_source_allowed($2,$3)
            AND hub.translation_editable(t) AND hub.translation_requester_allowed($5,$4)
            AND 'en'=ANY(f.locales_required) AND char_length($6)<=coalesce((f.validation->>'max_length')::int,12000)
            FROM hub.content_translations t JOIN hub.field_catalog f ON f.field_key=t.field_key WHERE t.id=$7''',
            current['field_key'], current['owner_type'], current['owner_key'], current['source_tab'], job['requested_by'], row['en'], current['id'])
        if not allowed:
            skipped.append({'job_id': str(key), 'reason': 'scope_or_permission_changed'}); continue
        validate_text(row['th_text'], row['en'], glossary, field_key=row['field_key'])
        await db.execute('''UPDATE hub.translation_jobs SET status='done',draft_en=$2,model=$3,
            completed_at=clock_timestamp(),lease_token=null,lease_expires=null,error_code=null WHERE id=$1''', key, row['en'], METHOD)
        await db.execute('''UPDATE hub.content_translations SET machine_en=$2,translation_state='machine',
            en_from_th_version=$3,revision=revision+1 WHERE id=$1''', current['id'], row['en'], row['th_version'])
        completed.append(str(key))
    return {'method': METHOD, 'status': 'already_applied' if replayed and not completed and not skipped else 'applied',
            'completed': completed, 'already_applied': replayed, 'skipped': skipped}


def name_cleanup_skip_reason(job, current, row) -> str | None:
    if job is None or current is None or str(job['translation_id']) != row['translation_id']:
        return 'job_identity_changed'
    if job['status'] != 'done' or job['model'] != METHOD or job['draft_en'] != row['before_en']:
        return 'not_original_offline_draft'
    if any(current[k] != row[k] for k in ('owner_type', 'owner_key', 'field_key', 'source_tab', 'scope_id')):
        return 'source_identity_changed'
    if (current['th_version'] != row['th_version'] or current['th_sha256'] != row['th_sha256']
            or current['en_from_th_version'] != row['th_version']):
        return 'source_changed'
    if current['entered_en'] is not None or current['reviewed_en'] is not None:
        return 'human_english'
    if current['translation_state'] != 'machine':
        return 'state_changed'
    replay = current['machine_en'] == row['after_en'] and current['revision'] == row['expected_revision'] + 1
    if not replay and current['machine_en'] != row['before_en']:
        return 'edited_draft'
    if not replay and current['revision'] != row['expected_revision']:
        return 'edited_revision'
    return None


async def apply_name_cleanup(db, actor: UUID, rows: list[dict]) -> dict:
    """H5d only; caller supplies the protected transaction and pinned originals."""
    if not rows or len({r['job_id'] for r in rows}) != len(rows):
        raise ValueError('invalid_cleanup_batch')
    await db.execute("SELECT set_config('app.actor_id',$1,true)", str(actor))
    for tab in sorted({r['source_tab'] for r in rows}):
        await db.fetchval('SELECT hub.require_permission($1,$2)', tab, 'edit')
    changed, replayed, skipped, pending = [], [], [], []
    for row in sorted(rows, key=lambda r: r['job_id']):
        if (not is_name_draft(row['field_key'], row['th_text'], row['before_en'])
                or clean_name_draft(row['field_key'], row['th_text'], row['before_en']) != row['after_en']
                or row['before_en'] == row['after_en']
                or sha256(row['th_text'].encode()).hexdigest() != row['th_sha256']):
            raise ValueError('invalid_cleanup_delta')
        key = UUID(row['job_id'])
        await db.fetchval('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', 'offline_name_cleanup:' + str(key))
        job = await db.fetchrow('SELECT * FROM hub.translation_jobs WHERE id=$1 FOR UPDATE', key)
        current = await db.fetchrow('SELECT * FROM hub.content_translations WHERE id=$1 FOR UPDATE', UUID(row['translation_id']))
        reason = name_cleanup_skip_reason(job, current, row)
        if reason:
            skipped.append({'job_id': str(key), 'reason': reason}); continue
        if current['machine_en'] == row['after_en']:
            replayed.append(str(key))
        else:
            pending.append((key, current['id'], row['after_en']))
    # Check the whole batch before its first write; over 5% is a hard STOP.
    if len(skipped) * 20 > len(rows):
        raise ValueError('name_cleanup_skip_threshold')
    for key, translation_id, english in pending:
        await db.execute('UPDATE hub.content_translations SET machine_en=$2,revision=revision+1 WHERE id=$1', translation_id, english)
        changed.append(str(key))
    return {'method': METHOD, 'status': 'already_applied' if not changed else 'applied',
            'changed': changed, 'already_applied': replayed, 'skipped': skipped}
