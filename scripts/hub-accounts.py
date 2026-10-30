"""Operator-only first-admin bootstrap and rejected-request retention. Local by default."""
import argparse
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import asyncpg

ROOT = Path(__file__).resolve().parents[1]
REF = 'eqlrtevwpyboplljgowo'


def connection(args):
    if args.hosted:
        url = os.getenv('HUB_SUPABASE_TEST_ADMIN_DATABASE_URL', '')
        parsed = urlparse(url)
        if (parsed.scheme not in ('postgres', 'postgresql') or parsed.hostname != f'db.{REF}.supabase.co'
                or parsed.path != '/postgres' or parsed.port not in (None, 5432)
                or parse_qs(parsed.query) != {'sslmode': ['verify-full']} or parsed.fragment):
            raise ValueError('Hosted requires the allowlisted TEST operator connection with verify-full TLS.')
        if input(f'Type PROMOTE {REF} to use hosted TEST: ') != f'PROMOTE {REF}':
            raise ValueError('Confirmation did not match; no connection attempted.')
        return {'dsn': url}
    config = json.loads((ROOT / '.local/development.json').read_text())
    return dict(host='127.0.0.1', port=55432, database='sena_hub_local', user='postgres', password=config['adminPassword'])


async def promote_admin(db, email):
    """Operator transaction only; explicit template copy, never a role trigger."""
    if await db.fetchval("select exists(select 1 from hub.user_account where status='ACTIVE' and can_manage_users)"):
        raise ValueError('An active admin already exists. Use the admin page.')
    rows = await db.fetch('select id from hub.user_account where lower(email)=lower($1) and anonymised_at is null for update', email)
    if len(rows) != 1:
        raise ValueError('Exactly one existing verified sign-in/account row is required. Sign in once first.')
    target = rows[0]['id']
    await db.execute("update hub.user_account set status='ACTIVE',hub_role='admin',agency_code=null,decided_at=now(),decision_note='',updated_at=clock_timestamp() where id=$1", target)
    await db.execute("""select hub.write_account_access(a.id,hub.resolve_account_access(a,
        jsonb_build_object('template',(select jsonb_build_object('code',code,'version',version)
            from hub.permission_template where code='admin' order by version desc limit 1),
            'can_manage_users',true,'confirm_manage_users',true)),null,'BOOTSTRAP','Operator bootstrap')
        from hub.user_account a where a.id=$1""", target)
    await db.execute("insert into hub.user_account_event(account_id,action,new_status,new_role,decision_note) values($1,'BOOTSTRAP','ACTIVE','admin','Operator bootstrap')", target)


async def run(args):
    from hosted_write_attestation import OperatorTransaction, load_manifest
    db = await asyncpg.connect(**connection(args))
    try:
        manifest = load_manifest(args.attestation_manifest) if args.hosted else None
        async with OperatorTransaction(db, manifest):
            await db.execute("select pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0))")
            if args.command == 'purge-rejected':
                count = await db.fetchval('select hub.purge_rejected_accounts()')
                print(f'Anonymised {count} rejected requests older than 90 days.')
                return
            await promote_admin(db, args.email)
            print('First ACTIVE admin created; operator action audited. No Auth secret or email used.')
    finally:
        await db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    promote = sub.add_parser('promote-admin')
    promote.add_argument('--email', required=True)
    promote.add_argument('--hosted', action='store_true')
    promote.add_argument('--attestation-manifest', type=Path)
    purge = sub.add_parser('purge-rejected')
    purge.add_argument('--hosted', action='store_true')
    purge.add_argument('--attestation-manifest', type=Path)
    try:
        asyncio.run(run(parser.parse_args()))
    except Exception as error:
        # Driver errors can contain credentials or personal fields; never echo them.
        print(str(error) if isinstance(error, ValueError) else 'Operator action failed; connection details withheld.')
        raise SystemExit(1)
