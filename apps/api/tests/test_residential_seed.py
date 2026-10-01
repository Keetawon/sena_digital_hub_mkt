"""Seed preservation and replay, with an optional rollback-only local check."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
from uuid import UUID

import pytest

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("residential_seed", ROOT / "scripts/seed-residential-demo.py")
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)


def test_only_gaps_are_filled_and_zero_is_preserved():
    existing = {"title": {"th": "saved", "en": ""}, "number": 0, "missing": None, "slug": "saved"}
    patch, provenance = seed.missing_fields(existing, {"title": {"th": "demo", "en": "example"}, "number": 2, "missing": 0, "slug": "demo"})
    assert patch == {"title": {"th": "saved", "en": "example"}, "missing": 0}
    assert provenance == ["title.en", "missing"]
    assert existing['title']['en'] == ''
    assert seed.missing_fields({**existing, **patch}, {"title": patch['title'], "missing": 0}) == ({}, [])


def test_synthetic_assets_are_reproducible_distinct_valid_pngs():
    checksums = set()
    for kind in ('hero', 'thumbnail', 'logo'):
        content = seed.synthetic_png(kind)
        assert content == seed.synthetic_png(kind)
        metadata = seed.validate_file(content, 'image/png', f'demo-residential-{kind}.png')
        assert (metadata['width'], metadata['height']) == (960, 540)
        checksums.add(metadata['checksum'])
    assert len(checksums) == 3
    with pytest.raises(ValueError):
        seed.synthetic_png('real-image')


@pytest.mark.skipif(os.getenv('HUB_PROMOTIONS_TEST') != '1', reason='Opt-in fixed local TEST database')
def test_seed_replay_preserves_originals_and_user_edits():
    async def check():
        import asyncpg
        config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf-8'))
        db = await asyncpg.connect(**seed.TARGET, user='postgres', password=config['adminPassword'])
        await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
        tx = db.transaction()
        await tx.start()
        try:
            original_models = await db.fetch("SELECT to_jsonb(m) AS row FROM hub.model_types m WHERE rem_project_id='HYABC' AND rem_model_id<>$1 ORDER BY id", seed.MODEL)
            original_bindings = await db.fetch("SELECT to_jsonb(a) AS row FROM hub.entity_assets a JOIN hub.projects p ON p.id=a.project_id WHERE p.rem_project_id='HYABC' ORDER BY a.id")
            original_assets = await db.fetch("SELECT to_jsonb(a) AS row FROM hub.assets a WHERE original_filename NOT LIKE 'demo-residential-%' ORDER BY id")
            first = await seed.seed(db)
            counts = await db.fetchrow("SELECT (SELECT count(*) FROM hub.assets) AS assets,(SELECT count(*) FROM hub.model_types) AS models,(SELECT count(*) FROM hub.public_promotions) AS promotions")
            second = await seed.seed(db)
            assert second['introduced_fields'] == []
            assert first['project_id'] == second['project_id']
            assert counts == await db.fetchrow("SELECT (SELECT count(*) FROM hub.assets) AS assets,(SELECT count(*) FROM hub.model_types) AS models,(SELECT count(*) FROM hub.public_promotions) AS promotions")
            assert original_models == await db.fetch("SELECT to_jsonb(m) AS row FROM hub.model_types m WHERE rem_project_id='HYABC' AND rem_model_id<>$1 ORDER BY id", seed.MODEL)
            assert original_bindings == await db.fetch("SELECT to_jsonb(a) AS row FROM hub.entity_assets a JOIN hub.projects p ON p.id=a.project_id WHERE p.rem_project_id='HYABC' ORDER BY a.id")
            assert original_assets == await db.fetch("SELECT to_jsonb(a) AS row FROM hub.assets a WHERE original_filename NOT LIKE 'demo-residential-%' ORDER BY id")
            # Rehearse the actual HYABC alternate snapshot, then roll back every
            # member. Existing originals remain outside the demo selection.
            identifiers = {UUID(first['project_id']), UUID(first['brand_id']), UUID(first['promotion_id'])}
            await seed.role(db, 'publisher')
            candidates = await db.fetchval("SELECT hub.release_candidates(true)")
            members = [{key: row[key] for key in ('entity_type', 'entity_id', 'expected_updated_at', 'expected_revision', 'expected_published_version_id') if key in row}
                       for row in candidates['items'] if UUID(row['entity_id']) in identifiers]
            assert len(members) == 3
            release = await db.fetchval("SELECT hub.release_publish($1,$2,true)", members, seed.EVIDENCE)
            await seed.role(db, 'none')
            payload = await db.fetchval("SELECT payload FROM public_api.projects WHERE public_project_id=(SELECT public_project_id FROM hub.projects WHERE rem_project_id='HYABC')")
            assert payload['demo_mode'] is True
            assert len(payload['models']) == 1
            assert payload['models'][0]['demo_fields']
            assert payload['demo_excluded_model_count'] == len(original_models)
            assert all(asset['demo_fields'] for asset in payload['assets'])
            await seed.role(db, 'publisher')
            await db.fetchval("SELECT hub.release_rollback($1,$2)", UUID(release['id']), seed.EVIDENCE)
            await seed.role(db, 'none')
            # A saved edit is never reset to the seed's proposed text on replay.
            await db.execute("UPDATE hub.projects SET meta_title=$1 WHERE rem_project_id='HYABC'", {"th": "saved user edit"})
            await seed.seed(db)
            assert await db.fetchval("SELECT meta_title->>'th' FROM hub.projects WHERE rem_project_id='HYABC'") == 'saved user edit'
        finally:
            await tx.rollback()
            await db.close()
    asyncio.run(check())
