"""Drain local marketing-text translation jobs using the approved API environment."""
import argparse
import asyncio
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/api'))
from sena_hub_api.content_translation import work_once  # noqa: E402
from sena_hub_api.document_worker import local_connection  # noqa: E402


async def run(watch: bool):
    async with local_connection() as db:
        while True:
            result = await work_once(db)
            if result['status'] != 'idle':
                print(json.dumps(result), flush=True)
            if result['status'] == 'idle' and not watch:
                return
            if result.get('error_code') == 'provider_unavailable':
                return
            if result['status'] == 'idle':
                await asyncio.sleep(2)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--watch', action='store_true')
    args = parser.parse_args()
    try:
        asyncio.run(run(args.watch))
    except KeyboardInterrupt:
        pass
    except Exception:
        print('Translation worker stopped. Review private job status; no source text is logged.', file=sys.stderr)
        raise SystemExit(1) from None
