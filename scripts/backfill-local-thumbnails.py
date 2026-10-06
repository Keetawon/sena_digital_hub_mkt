"""Generate missing 96px derivatives from verified local originals; no DB writes."""
import asyncio
import json
from pathlib import Path
from sena_hub_api import assets
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]


async def main():
    import asyncpg
    config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf8'))
    db = await asyncpg.connect(host='127.0.0.1', port=55432, database='sena_hub_local', user='postgres', password=config['adminPassword'])
    try:
        if Path(await db.fetchval('SHOW data_directory')).resolve() != (ROOT / '.local/postgres').resolve():
            raise RuntimeError('Only the local working database is supported')
        rows = await db.fetch("SELECT checksum,mime_type,storage_path,file_size FROM hub.assets WHERE deleted_at IS NULL AND storage_path IS NOT NULL")
        print(json.dumps(backfill(rows)))
    finally:
        await db.close()


def backfill(rows):
    counts = {'created': 0, 'existing': 0, 'failed': 0, 'missing_or_invalid_original': 0}
    failures = []
    for row in rows:
        metadata = dict(row)
        if assets.thumbnail_path(metadata).is_file():
            counts['existing'] += 1
            continue
        try:
            path = assets.readable_file(metadata)
            created = assets.install_thumbnail(path.read_bytes(), metadata)
        except (HTTPException, OSError) as error:
            assets.record_thumbnail_failure(metadata, 'original_unavailable', error)
            counts['missing_or_invalid_original'] += 1
        else:
            counts['created' if created else 'existing' if assets.thumbnail_path(metadata).is_file() else 'failed'] += 1
        failure = assets.thumbnail_failure(metadata)
        if failure:
            failures.append({'checksum': metadata['checksum'], 'reason': failure['reason']})
    return {**counts, 'failures': failures}


if __name__ == '__main__':
    asyncio.run(main())
