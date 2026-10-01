"""Validate a complete synthetic DW read-back; --apply stages only the local Hub.

No DW connection, source writes, real-data import or production route exists.
The SQL function owns publication, replay, conflict quarantine and its pointer lock.
"""
import argparse
import asyncio
import json
from pathlib import Path
import sys
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps' / 'api'))
from sena_hub_api.actuals_import import validate_package  # noqa: E402

LOCAL_TARGET = {'host': '127.0.0.1', 'port': 55432, 'database': 'sena_hub_local'}
AUTO_POINTER = object()
ADMIN_ACTOR = '00000000-0000-0000-0000-000000000005'


async def apply_local(package, *, expected_snapshot_id=AUTO_POINTER):
    import asyncpg

    config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf-8'))
    if any(config.get(key, value) != value for key, value in LOCAL_TARGET.items()):
        raise ValueError('Refusing a target other than the fixed local Hub TEST database')
    connection = await asyncpg.connect(**LOCAL_TARGET, user='postgres', password=config['adminPassword'], timeout=10)
    try:
        target = await connection.fetchrow('SELECT current_database() AS database, host(inet_server_addr()) AS host, inet_server_port() AS port')
        if any(target[key] != value for key, value in LOCAL_TARGET.items()):
            raise ValueError('Connected database is not the fixed local Hub TEST target')
        await connection.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        async with connection.transaction():
            await connection.execute('SET LOCAL ROLE admin')
            await connection.execute("SELECT set_config('app.actor_id',$1,true)", ADMIN_ACTOR)
            await connection.execute("SELECT set_config('app.change_reason','Apply verified synthetic DW P3 TEST snapshot',true)")
            if expected_snapshot_id is AUTO_POINTER:
                expected_snapshot_id = await connection.fetchval('SELECT ads.actuals_current_snapshot()')
            return await connection.fetchval('SELECT ads.apply_ads_actuals($1,$2,$3,$4)',
                package.manifest, package.relations, package.fingerprint, expected_snapshot_id)
    finally:
        await connection.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, required=True, help='Directory with manifest and four JSON arrays')
    parser.add_argument('--apply', action='store_true', help='Apply atomically to the fixed local TEST Hub')
    parser.add_argument('--expected-current', help='Expected current snapshot UUID, or none; default observes the pointer before apply')
    args = parser.parse_args(argv)
    try:
        expected = AUTO_POINTER
        if args.expected_current is not None:
            if not args.apply:
                raise ValueError('--expected-current is valid only with --apply')
            expected = None if args.expected_current == 'none' else str(UUID(args.expected_current))
        package = validate_package(args.package)
        result = {'status': 'VALIDATED_DRY_RUN', **package.summary()}
        if args.apply:
            result.update(asyncio.run(apply_local(package, expected_snapshot_id=expected)))
        print(json.dumps(result, indent=2))
        return 1 if result['status'] == 'QUARANTINED' else 0
    except (OSError, ValueError):
        print('Actuals intake stopped: invalid or incomplete TEST package; no partial snapshot published.', file=sys.stderr)
    except Exception:
        # Database exceptions and JSON parsing errors can contain values or credentials.
        print('Actuals intake stopped: check the local database and restricted diagnostics; no partial snapshot published.', file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
