"""Install known synthetic document bytes and queue only the first demo versions."""
import asyncio
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/api'))
from sena_hub_api.document_storage import install_fixtures  # noqa: E402
from sena_hub_api.document_worker import local_connection  # noqa: E402


async def run():
    fixtures = install_fixtures()
    receipts = []
    async with local_connection() as db:
        async with db.transaction():
            await db.execute("SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000041',true)")
            for metadata, truth in fixtures:
                await db.fetchval('SELECT ads.archive_register_fixture($1,$2)', metadata, truth)
            await db.execute('SET LOCAL ROLE online_staff')
            for fixture_id in ('memo-hyabc-v1', 'statement-october-v1'):
                doc = await db.fetchval('SELECT ads.archive_receive($1)', {'fixture_id': fixture_id})
                receipts.append({'fixture_id': fixture_id, 'document_id': doc['id']})
    return {'status': 'SEEDED', 'environment': 'local-test', 'fixtures': len(fixtures), 'receipts': receipts,
            'next': 'npm run dev:document-worker -- --drain; transcription and P2 application remain explicit'}


if __name__ == '__main__':
    try:
        print(json.dumps(asyncio.run(run()), indent=2))
    except Exception:
        print('Synthetic document seed stopped; no database changes committed.', file=sys.stderr)
        raise SystemExit(1) from None
