"""Dedicated hosted TEST image process. Never loads another service's env file."""
import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps/api'))
from sena_hub_api.hosted_media_worker import serve

if __name__ == '__main__':
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass
    except Exception:
        print('Image worker stopped; connection and provider details withheld.', file=sys.stderr)
        raise SystemExit(1) from None
