"""Dedicated hosted TEST image process. Never loads another service's env file."""
import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps/api'))

if __name__ == '__main__':
    if sys.argv[1:] == ['--self-check']:
        from production_runtime_check import main
        raise SystemExit(main(['worker']))
    try:
        if sys.argv[1:]:
            raise ValueError('Unsupported worker arguments')
        from sena_hub_api.hosted_media_worker import serve
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass
    except Exception as error:
        import json
        from operator_diagnostics import diagnostic
        print(json.dumps(diagnostic(error, step='worker/startup')), file=sys.stderr)
        raise SystemExit(1) from None
