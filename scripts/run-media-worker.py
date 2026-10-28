"""Drain local marketing media jobs; --watch also schedules weekly provider checks."""
import argparse
import asyncio
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/api'))
from sena_hub_api.document_worker import local_connection  # noqa: E402
from sena_hub_api.media_worker import work_once  # noqa: E402


async def run(watch):
    async with local_connection() as db:
        while True:
            result = await work_once(db, schedule=True)
            if result['status'] != 'idle':
                print(json.dumps(result), flush=True)
            if not watch and result['status'] == 'idle' or result.get('error_code') in ('provider_unavailable', 'budget_exhausted'):
                return
            if result['status'] == 'idle':
                await asyncio.sleep(30)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--watch', action='store_true')
    args = parser.parse_args()
    try:
        asyncio.run(run(args.watch))
    except KeyboardInterrupt:
        pass
    except Exception:
        print('Media worker stopped; review job status. Source and provider data are not logged.', file=sys.stderr)
        raise SystemExit(1) from None
