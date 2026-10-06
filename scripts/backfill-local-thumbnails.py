"""Generate missing 96px derivatives from verified local originals; no DB writes."""
import asyncio
import json
from pathlib import Path
from sena_hub_api import assets

ROOT = Path(__file__).resolve().parents[1]


async def main():
    import asyncpg
    config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf8'))
    db = await asyncpg.connect(host='127.0.0.1', port=55432, database='sena_hub_local', user='postgres', password=config['adminPassword'])
    try:
        if Path(await db.fetchval('SHOW data_directory')).resolve() != (ROOT / '.local/postgres').resolve():
            raise RuntimeError('Only the local working database is supported')
        rows = await db.fetch("SELECT checksum,mime_type,storage_path,file_size FROM hub.assets WHERE deleted_at IS NULL AND storage_path IS NOT NULL")
        counts = {'created': 0, 'existing_or_unsupported': 0, 'missing_original': 0}
        for row in rows:
            path = assets.readable_file(dict(row))
            counts['created' if assets.install_thumbnail(path.read_bytes(), dict(row)) else 'existing_or_unsupported'] += 1
        print(json.dumps(counts))
    finally:
        await db.close()


if __name__ == '__main__':
    asyncio.run(main())
