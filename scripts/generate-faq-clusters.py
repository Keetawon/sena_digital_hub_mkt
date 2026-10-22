"""Regenerate FAQ intake clusters (docs/41 Phase 4) from existing Knowledge candidates.

Default is a read-only plan. `--apply` replaces only undecided clusters in one
locked transaction on the working loopback database. Decided/held clusters stay
frozen and their candidates are never regrouped. No network or AI provider call.
"""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter
import json
from pathlib import Path
import sys

import asyncpg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/api'))
from sena_hub_api.faq_clusters import build_clusters  # noqa: E402


async def connect_working():
    config = json.loads((ROOT / '.local/development.json').read_text(encoding='utf-8'))
    db = await asyncpg.connect(host='127.0.0.1', port=55432, database='sena_hub_local', user='postgres', password=config['adminPassword'])
    if Path(await db.fetchval('SHOW data_directory')).resolve() != (ROOT / '.local/postgres').resolve() or await db.fetchval('SELECT current_database()') != 'sena_hub_local':
        await db.close()
        raise ValueError('working_local_only_guard')
    return db


async def load_inputs(db) -> dict:
    """Read-only inputs. Reviewed candidates and frozen cluster members are excluded."""
    await db.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads)
    candidates = [dict(r) for r in await db.fetch("""
        select k.id,k.project_ids,k.programme_ids,k.source_url,k.source_ref,k.holds,k.evidence
        from staging.knowledge_candidates k
        where k.kind='faq' and not exists(select 1 from hub.knowledge_reviews r where r.candidate_id=k.id)
          and not exists(select 1 from staging.faq_clusters c where k.id=any(c.member_candidate_ids)
                         and exists(select 1 from hub.faq_intake_decisions d where d.cluster_id=c.id))
        order by k.id""")]
    project_names, project_brands = {}, {}
    for r in await db.fetch("""select p.rem_project_id,p.project_name_rem,p.rem_brand_id,h.public_name
        from staging.rem_projects p left join hub.projects h on h.rem_project_id=p.rem_project_id and h.deleted_at is null"""):
        names = [r['project_name_rem'], *(r['public_name'] or {}).values()]
        project_names[r['rem_project_id']] = sorted({n for n in names if isinstance(n, str) and n.strip()})
        if r['rem_brand_id']:
            project_brands[r['rem_project_id']] = r['rem_brand_id']
    brand_names = {}
    for r in await db.fetch("""select b.rem_brand_id,b.brand_name_rem,b.brand_name_en_rem,h.public_name from staging.rem_brands b
        left join hub.brands h on h.rem_brand_id=b.rem_brand_id and h.deleted_at is null"""):
        names = [r['brand_name_rem'], r['brand_name_en_rem'], *(r['public_name'] or {}).values()]
        brand_names[r['rem_brand_id']] = sorted({n for n in names if isinstance(n, str) and n.strip()})
    ids = sorted({p for c in candidates for p in c['project_ids']} & project_names.keys())
    closed = {r['id'] for r in await db.fetch("select x id from unnest($1::text[]) x where hub.project_source_review(x)->>'status_raw'='3'", ids)}
    questions = [dict(r) for r in await db.fetch("""select question_key,revision,status,default_level,answer_kind,question_template,alt_questions
        from hub.faq_questions where status in ('approved','proposed') order by question_key""")]
    return {'candidates': candidates, 'project_names': project_names, 'project_brands': project_brands,
            'brand_names': brand_names, 'closed_projects': closed, 'questions': questions}


def summary(result: dict) -> dict:
    clusters = result['clusters']
    return {'generation_sha256': result['generation_sha256'], 'clusters': len(clusters),
            'candidates': sum(len(c['member_candidate_ids']) for c in clusters),
            'with_question_bank_suggestion': sum(c['suggestion_basis'] == 'question_bank' for c in clusters),
            'levels': dict(sorted(Counter(c['suggested_level'] for c in clusters).items())),
            'holds': dict(sorted(Counter(h for c in clusters for h in c['holds']).items()))}


async def main(apply: bool) -> None:
    db = await connect_working()
    try:
        async with db.transaction():
            inputs = await load_inputs(db)
            result = build_clusters(**inputs)
            report = summary(result)
            if apply:
                report['applied'] = json.loads(await db.fetchval('select staging.replace_faq_clusters($1,$2,$3)::text',
                    result['generation_sha256'], result['algorithm'], result['clusters']))
        print(json.dumps(report, ensure_ascii=False, indent=2))
    finally:
        await db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='replace undecided clusters (default: read-only plan)')
    asyncio.run(main(parser.parse_args().apply))
