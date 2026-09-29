"""Validate operator-exported DW group/member JSON; --apply stages A/B locally.

No DW connection is made. Export gold.dim_project_group and
gold.bridge_rem_project_group_member as JSON arrays. Optional --aliases is a JSON
array of {project_group_id, project_id, name_alias}; aliases must be steward-approved.
Any unresolved/conflicting row quarantines the entire batch, with raw evidence kept.
"""
import argparse
import asyncio
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GROUP = re.compile(r'[CHTS]-[A-Z0-9]{4}-[A-Z0-9]{5}\Z', re.ASCII)
LABEL = re.compile(r'[A-Z0-9][A-Z0-9 .-]{0,39}\Z', re.ASCII)
PHASE = re.compile(r'[A-Z0-9]+\Z', re.ASCII)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError('Source/export timestamp must be text with an explicit timezone')
    result = datetime.fromisoformat(value)
    if result.tzinfo is None:
        raise ValueError('Source/export timestamp needs a verified timezone')
    return result


def label(row, thai, english):
    th, en = row.get(thai), row.get(english)
    if not isinstance(th, str) or not th.strip() or '\ufffd' in th or not isinstance(en, str) or not en.isascii() or not LABEL.fullmatch(en.upper()):
        raise ValueError('Missing Thai label or English label is not naming-safe ASCII (1-40 characters)')
    return th, en.upper()


def validate(groups, members, aliases=None):
    if not isinstance(groups, list) or not groups or not isinstance(members, list) or not members:
        raise ValueError('Complete, non-empty JSON arrays of groups and members are required')
    aliases = [] if aliases is None else aliases
    if not isinstance(aliases, list):
        raise ValueError('Aliases must be a JSON array')
    canonical({'groups': groups, 'members': members, 'aliases': aliases})
    issues, scopes, masters, pairs, alias_map, snapshots = [], [], {}, {}, {}, []
    for row in aliases:
        if not isinstance(row, dict):
            issues.append('Invalid steward alias row')
            continue
        key = (row.get('project_group_id'), row.get('project_id'))
        if any(not isinstance(x, str) or not x for x in key) or key in alias_map or not isinstance(row.get('name_alias'), str) or not PHASE.fullmatch(row['name_alias']):
            issues.append('Missing, duplicate or invalid steward alias')
            continue
        alias_map[key] = row['name_alias']
    for index, row in enumerate(groups):
        try:
            if not isinstance(row, dict):
                raise ValueError('Group must be an object')
            key = row.get('project_group_id')
            if not isinstance(key, str) or not GROUP.fullmatch(key) or key in masters:
                raise ValueError('Missing, duplicate or conflicting exact group ID')
            ids = row.get('project_id_set')
            if not isinstance(ids, list) or not ids or any(not isinstance(x, str) or not x for x in ids) or len(set(ids)) != len(ids):
                raise ValueError('Master project_id_set must preserve distinct text IDs')
            if 'member_count' in row and (type(row['member_count']) is not int or row['member_count'] != len(ids)):
                raise ValueError('Master member_count differs from project_id_set')
            th, en = label(row, 'project_name_th', 'project_name_en')
            observed = timestamp(row.get('source_snapshot_at'))
            snapshots.append(observed)
            masters[key] = row
            scopes.append({'scope_code': key, 'kind': 'GROUP', 'label_th': th, 'label_en': en,
                           'parent_group_id': None, 'source_snapshot': observed,
                           'source_fingerprint': hashlib.sha256(canonical(row)).hexdigest(),
                           'members': [{'member_type': 'GROUP', 'member_id': key, 'parent_group_id': None,
                                        'name_alias': None, 'source_snapshot': observed}]})
        except (ValueError, TypeError) as error:
            issues.append(f'group[{index}]: {error}')
    phase_owners, tokens = {}, set()
    for index, row in enumerate(members):
        try:
            if not isinstance(row, dict):
                raise ValueError('Member must be an object')
            group, phase = row.get('project_group_id'), row.get('project_id')
            if not isinstance(group, str) or not isinstance(phase, str) or not phase or group not in masters:
                raise ValueError('Unknown parent or non-text member ID')
            pair = (group, phase)
            if pair in pairs or (phase in phase_owners and phase_owners[phase] != group):
                raise ValueError('Duplicate/conflicting current member identity')
            pairs[pair] = row
            phase_owners[phase] = group
            if row.get('membership_status') != 'CURRENT_REFERENCE' or row.get('valid_from') is not None or row.get('valid_to') is not None:
                raise ValueError('Only current reference bridge evidence is accepted; no invented historical dates')
            if row.get('is_deleted') not in (None, False):
                raise ValueError('Deleted member cannot be activated')
            alias = alias_map.get(pair)
            emitted = alias or phase
            if not PHASE.fullmatch(emitted):
                raise ValueError('Non-ASCII phase ID needs a steward alias; exact source ID will be retained')
            token = f'{group}-{emitted}'
            if token in tokens:
                raise ValueError('Phase aliases collide within the group')
            tokens.add(token)
            th, en = label(row, 'project_name', 'project_name_eng')
            observed = timestamp(row.get('reference_observed_at'))
            snapshots.append(observed)
            scopes.append({'scope_code': token, 'kind': 'PHASE', 'label_th': th, 'label_en': en,
                           'parent_group_id': group, 'source_snapshot': observed,
                           'source_fingerprint': hashlib.sha256(canonical({'member': row, 'alias': alias})).hexdigest(),
                           'members': [{'member_type': 'PHASE', 'member_id': phase, 'parent_group_id': group,
                                        'name_alias': alias, 'source_snapshot': observed}]})
        except (ValueError, TypeError) as error:
            issues.append(f'member[{index}]: {error}')
    for group, row in masters.items():
        actual = {phase for parent, phase in pairs if parent == group}
        if actual != set(row['project_id_set']):
            issues.append(f'{group}: master and bridge member sets differ; reconcile before activation')
    for pair in alias_map:
        if pair not in pairs:
            issues.append(f'Alias has no exact member pair: {pair}')
    return sorted(scopes, key=lambda s: (s['kind'], s['scope_code'])), issues, max(snapshots, default=None)


async def apply_local(payload, scopes, issues, snapshot, fingerprint, provenance):
    import asyncpg

    config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf-8'))
    connection = await asyncpg.connect(host='127.0.0.1', port=55432, database='sena_hub_local',
                                      user='postgres', password=config['adminPassword'], timeout=10)
    try:
        await connection.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        async with connection.transaction():
            await connection.execute("SELECT pg_advisory_xact_lock(hashtext('sena_hub_ads_scope_import'))")
            prior = await connection.fetchrow('SELECT status FROM staging.ads_scope_import WHERE source_fingerprint=$1', fingerprint)
            if prior:
                return 'already_' + prior['status'].lower()
            issues = list(issues)
            for scope in scopes:
                member_identity = [{k: v for k, v in m.items() if k in ('member_type', 'member_id', 'parent_group_id')} for m in scope['members']]
                signature = await connection.fetchval('SELECT ads.scope_signature($1)', member_identity)
                scope['member_signature'] = signature
                old_rows = await connection.fetch('''SELECT * FROM ads.scope_code
                    WHERE (scope_code=$1 AND kind<>'MULTI_PHASE') OR (kind=$2 AND member_signature=$3) FOR UPDATE''',
                    scope['scope_code'], scope['kind'], signature)
                if any(old['scope_code'] != scope['scope_code'] or old['kind'] != scope['kind'] or old['member_signature'] != signature
                            or old['label_th'] != scope['label_th'] or old['label_en'] != scope['label_en']
                            or old['status'] != 'ACTIVE' for old in old_rows):
                    issues.append(scope['scope_code'] + ': existing registry identity/label/status differs; steward review required')
            status = 'QUARANTINED' if issues else 'APPLIED'
            await connection.execute("SELECT set_config('app.change_reason','Stage reviewed operator-exported ads scope evidence',true)")
            await connection.execute('''INSERT INTO staging.ads_scope_import
                (source_fingerprint,source_record,provenance,source_snapshot_at,status,issues) VALUES($1,$2,$3,$4,$5,$6)''',
                fingerprint, payload, provenance, snapshot, status, issues)
            if not issues:
                for scope in scopes:
                    scope_id = await connection.fetchval('''INSERT INTO ads.scope_code
                        (scope_code,kind,label_th,label_en,parent_group_id,member_signature,status,source_snapshot,source_fingerprint)
                        VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',$7,$8) ON CONFLICT DO NOTHING RETURNING scope_id''',
                        *[scope[k] for k in ('scope_code', 'kind', 'label_th', 'label_en', 'parent_group_id', 'member_signature', 'source_snapshot', 'source_fingerprint')])
                    if scope_id:
                        for member in scope['members']:
                            await connection.execute('''INSERT INTO ads.scope_member
                                (scope_id,member_type,member_id,parent_group_id,name_alias,source_snapshot)
                                VALUES($1,$2,$3,$4,$5,$6)''', scope_id,
                                *[member[k] for k in ('member_type', 'member_id', 'parent_group_id', 'name_alias', 'source_snapshot')])
            return status.lower()
    finally:
        await connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--groups', type=Path, required=True)
    parser.add_argument('--members', type=Path, required=True)
    parser.add_argument('--aliases', type=Path)
    handoff = parser.add_mutually_exclusive_group(required=True)
    handoff.add_argument('--captured-at')
    handoff.add_argument('--received-at')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        handoff_at = timestamp(args.captured_at or args.received_at)
        files = {key: path.read_bytes() for key, path in [('groups', args.groups), ('members', args.members), ('aliases', args.aliases)] if path}
        payload = {key: json.loads(raw) for key, raw in files.items()}
        scopes, issues, snapshot = validate(payload['groups'], payload['members'], payload.get('aliases'))
        digest = hashlib.sha256(canonical(payload)).hexdigest()
        provenance = {'method': 'operator_exported_gold',
                      'relations': ['gold.dim_project_group', 'gold.bridge_rem_project_group_member'],
                      'captured_at': handoff_at.isoformat() if args.captured_at else None,
                      'received_at': handoff_at.isoformat() if args.received_at else None,
                      'files': {key: hashlib.sha256(raw).hexdigest() for key, raw in files.items()}}
        status = 'quarantined_dry_run' if issues else 'validated_dry_run'
        if args.apply:
            folder = ROOT / '.local/pilot-intake' / ('ads_scopes_' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
            folder.mkdir(parents=True, exist_ok=False)
            for key, raw in files.items():
                (folder / f'{key}.json').write_bytes(raw)
            (folder / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
            provenance['local_evidence_folder'] = str(folder.relative_to(ROOT))
            status = asyncio.run(apply_local(payload, scopes, issues, snapshot, digest, provenance))
        print(json.dumps({'status': status, 'scope_count': len(scopes), 'issues': issues,
                          'source_fingerprint': digest, 'dw_changed': False}, indent=2, ensure_ascii=True))
        return 1 if 'quarantined' in status else 0
    except (ValueError, OSError) as error:
        print(f'Ads scope intake stopped: {error}')
    except Exception:
        print('Ads scope intake stopped: check source JSON and local database; no partial database import committed.')
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
