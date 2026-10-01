"""Install one wholly fictional project for the closed live assistant golden case.

Never refresh expectations from mutable business content; replay rejects changes.
"""
import asyncio
import json
from pathlib import Path
import sys
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps/api"))
from sena_hub_api.assistant_model import LIVE_PROJECT_UUID, LIVE_VALUES  # noqa: E402
from sena_hub_api.document_worker import local_connection  # noqa: E402


async def seed(db):
    await db.execute("SELECT hub.require_demo_seeder()")
    await db.execute("SELECT pg_advisory_xact_lock(hashtextextended('assistant-synthetic-v1',0))")
    await db.execute("SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000031',true)")
    await db.execute("""INSERT INTO staging.rem_projects(rem_project_id,project_name_rem,
        source_updated_at,source_fingerprint,source_record) VALUES($1,$2,now(),
        'assistant-synthetic-v1','{"synthetic_only":true,"source":"local-demo"}') ON CONFLICT DO NOTHING""",
        LIVE_VALUES['rem_project_id'], LIVE_VALUES['public_name.th'])
    existing = await db.fetchrow("SELECT * FROM hub.projects WHERE id=$1", UUID(LIVE_PROJECT_UUID))
    if existing is None:
        await db.execute("""INSERT INTO hub.projects(id,public_project_id,rem_project_id,
            public_name,meta_title,meta_description,name_source,demo_fields)
            VALUES($1,$2,$3,$4,$5,$6,'marketing_override',ARRAY['public_name.th','meta_title.th','meta_description.th'])""",
            UUID(LIVE_PROJECT_UUID), LIVE_VALUES['public_project_id'], LIVE_VALUES['rem_project_id'],
            {'th': LIVE_VALUES['public_name.th']}, {'th': LIVE_VALUES['meta_title.th']}, {'th': LIVE_VALUES['meta_description.th']})
    else:
        actual = {key: existing[key.split('.')[0]]['th'] if '.' in key else existing[key] for key in LIVE_VALUES}
        if actual != LIVE_VALUES or existing['deleted_at'] is not None or existing['published_version_id'] is not None:
            raise ValueError("Synthetic fixture changed; existing data preserved")
    return {'environment':'local-test','synthetic_only':True,'project_id':LIVE_VALUES['public_project_id'],
            'golden_id':'synthetic-project','network_calls':0}


async def run():
    async with local_connection() as db:
        async with db.transaction():
            return await seed(db)


if __name__ == '__main__':
    try:
        print(json.dumps(asyncio.run(run()), ensure_ascii=True))
    except Exception as error:
        print(f'Assistant demo seed stopped ({type(error).__name__}); no changes committed.', file=sys.stderr)
        raise SystemExit(1) from None
