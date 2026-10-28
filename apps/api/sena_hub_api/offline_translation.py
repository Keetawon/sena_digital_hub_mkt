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


def validate_text(source: str, english: str, glossary: list[dict]) -> None:
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
        await db.execute('''UPDATE hub.translation_jobs SET status='done',draft_en=$2,model=$3,
            completed_at=clock_timestamp(),lease_token=null,lease_expires=null,error_code=null WHERE id=$1''', key, row['en'], METHOD)
        await db.execute('''UPDATE hub.content_translations SET machine_en=$2,translation_state='machine',
            en_from_th_version=$3,revision=revision+1 WHERE id=$1''', current['id'], row['en'], row['th_version'])
        completed.append(str(key))
    return {'method': METHOD, 'status': 'already_applied' if replayed and not completed and not skipped else 'applied',
            'completed': completed, 'already_applied': replayed, 'skipped': skipped}
