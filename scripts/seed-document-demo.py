"""Install known synthetic document bytes and queue only the first demo versions."""
import asyncio
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/api'))
from sena_hub_api.document_storage import install_fixtures  # noqa: E402
from sena_hub_api.document_worker import local_connection  # noqa: E402

ACTOR = '00000000-0000-0000-0000-000000000041'
INITIAL_FIXTURES = ('memo-hyabc-v1', 'statement-october-v1')


async def seed(db, fixtures):
    """Caller owns the transaction. Replays preserve existing versions and reviews."""
    receipts = []
    await db.execute('RESET ROLE')
    await db.execute('SELECT hub.require_demo_seeder()')
    await db.execute("SELECT set_config('app.actor_id',$1,true)", ACTOR)
    await db.execute('SELECT pg_advisory_xact_lock(1560022)')
    for metadata, truth in fixtures:
        await db.fetchval('SELECT ads.archive_register_fixture($1,$2)', metadata, truth)
    for fixture_id in INITIAL_FIXTURES:
        await db.execute('RESET ROLE')
        existing = await db.fetchrow('SELECT document_id,id FROM ads.archive_version WHERE fixture_id=$1', fixture_id)
        await db.execute('SET LOCAL ROLE online_staff')
        if existing:
            doc = await db.fetchval('SELECT ads.archive_read($1)', existing['document_id'])
            operation = 'PRESERVED'
        else:
            doc = await db.fetchval('SELECT ads.archive_receive($1)', {'fixture_id': fixture_id})
            operation = doc['receipt_status']
        receipts.append({'fixture_id': fixture_id, 'document_id': doc['id'],
                         'version_id': str(existing['id']) if existing else doc['current_version_id'],
                         'current_version_id': doc['current_version_id'], 'job_status': doc['job']['status'],
                         'legal_hold': doc['legal_hold'], 'operation': operation})
    await db.execute('RESET ROLE')
    return {'status': 'SEEDED', 'environment': 'local-test', 'fixtures': len(fixtures), 'receipts': receipts,
            'next': 'npm run dev:document-worker -- --drain; transcription and P2 application remain explicit'}


async def run():
    fixtures = install_fixtures()
    async with local_connection() as db:
        async with db.transaction():
            return await seed(db, fixtures)


if __name__ == '__main__':
    try:
        print(json.dumps(asyncio.run(run()), indent=2))
    except Exception:
        print('Synthetic document seed stopped; no database changes committed.', file=sys.stderr)
        raise SystemExit(1) from None
