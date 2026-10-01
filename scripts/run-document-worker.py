"""Process bounded synthetic archive jobs locally; no external OCR or model calls."""
import argparse
import asyncio
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/api'))
from sena_hub_api.document_worker import local_connection, work_once  # noqa: E402


async def run(drain=False):
    results = []
    async with local_connection() as db:
        for _ in range(20 if drain else 1):
            result = await work_once(db)
            results.append(result)
            if result['status'] == 'IDLE':
                break
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--drain', action='store_true', help='Process at most twenty available jobs')
    parser.add_argument('--once', action='store_true', help='Process at most one job (default)')
    args = parser.parse_args()
    try:
        result = asyncio.run(run(args.drain))
        print(json.dumps(result))
        raise SystemExit(1 if any(row['status'] == 'FAILED' for row in result) else 0)
    except Exception:
        print('Local document worker stopped; inspect restricted job status. No external processing occurred.', file=sys.stderr)
        raise SystemExit(1) from None
