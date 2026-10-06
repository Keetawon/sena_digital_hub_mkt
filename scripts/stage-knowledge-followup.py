"""Verified local-only follow-up evidence; dry-run default, exact replay is a no-op."""
import argparse,asyncio,json,sys
from pathlib import Path
from uuid import UUID
from importlib.util import spec_from_file_location,module_from_spec
import asyncpg
ROOT=Path(__file__).resolve().parents[1]
spec=spec_from_file_location('followup',ROOT/'scripts/prepare-knowledge-followup.py');helper=module_from_spec(spec);spec.loader.exec_module(helper)

async def run(args):
    folder=args.package.resolve();manifest=helper.verify(folder,args.manifest_sha256)
    if manifest['contract_version']!='sena-knowledge-followup-v1':raise ValueError('unsupported_contract')
    questions=helper.read(folder/'questions.json');promotions=helper.read(folder/'promotions.json')
    if len(questions)!=manifest['summary']['questions'] or len(promotions)!=manifest['summary']['promotion_images']:raise ValueError('count_mismatch')
    if len({q['id'] for q in questions})!=len(questions) or len({p['candidate_id'] for p in promotions})!=len(promotions):raise ValueError('duplicate_identity')
    for q in questions:
        if q['status']!='DRAFT_MKT_TO_VERIFY' or q['split'] not in ('tuning','held_out') or q['project_id'] not in helper.PILOTS or not q['candidate_ids']:raise ValueError('invalid_question')
        for key in q['candidate_ids']:UUID(key)
    for p in promotions:
        UUID(p['candidate_id'])
        if p['category'] not in ('promotion','text_not_promotion'):raise ValueError('invalid_promotion_category')
    result={'manifest_sha256':args.manifest_sha256,'questions':len(questions),'promotion_annotations':len(promotions),'apply':args.apply,'published':0}
    if not args.apply:print(json.dumps(result));return
    config=helper.read(ROOT/'.local/development.json')
    db=await asyncpg.connect(host='127.0.0.1',port=55432,database='sena_hub_local',user='postgres',password=config['adminPassword'])
    try:
        if Path(await db.fetchval('SHOW data_directory')).resolve()!=(ROOT/'.local/postgres').resolve() or await db.fetchval('SELECT current_database()')!='sena_hub_local':raise ValueError('working_local_only_guard')
        for name in ('json','jsonb'):await db.set_type_codec(name,schema='pg_catalog',encoder=json.dumps,decoder=json.loads)
        async with db.transaction():
            await db.execute('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',args.manifest_sha256)
            replay=await db.fetchval('SELECT EXISTS(SELECT 1 FROM staging.knowledge_followup_batches WHERE manifest_sha256=$1)',args.manifest_sha256)
            if replay:result.update(replay=True,inserted=0)
            else:
                if not await db.fetchval('SELECT EXISTS(SELECT 1 FROM staging.knowledge_batches WHERE manifest_sha256=$1)',manifest['source_manifest_sha256']):raise ValueError('source_batch_not_staged')
                candidates={str(r['id']):r for r in await db.fetch('SELECT id,project_ids,kind FROM staging.knowledge_candidates')}
                for q in questions:
                    if any(cid not in candidates or q['project_id'] not in candidates[cid]['project_ids'] for cid in q['candidate_ids']):raise ValueError('question_reference_or_scope_mismatch')
                if any(p['candidate_id'] not in candidates or candidates[p['candidate_id']]['kind']!='promotion' for p in promotions):raise ValueError('promotion_reference_mismatch')
                await db.execute('INSERT INTO staging.knowledge_followup_batches(manifest_sha256,manifest) VALUES($1,$2)',args.manifest_sha256,manifest)
                await db.executemany('''INSERT INTO staging.knowledge_eval_questions(id,batch_sha256,rem_project_id,question,expected_answer,candidate_ids,split,holds,source_refs)
                    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)''',[(q['id'],args.manifest_sha256,q['project_id'],q['question'],q['expected_answer'],[UUID(c) for c in q['candidate_ids']],q['split'],q['holds'],q['source_refs']) for q in questions])
                from datetime import date
                await db.executemany('''INSERT INTO staging.knowledge_promotion_annotations VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)''',
                    [(UUID(p['candidate_id']),args.manifest_sha256,p['cluster_id'],p['category'],p['phash'],p['cluster_size'],date.fromisoformat(p['ocr_end_date']) if p['ocr_end_date'] else None,p['likely_expired'],p['date_unknown']) for p in promotions])
                result.update(replay=False,inserted=len(questions)+len(promotions))
        receipts=ROOT/'.local/knowledge-followup-receipts';receipts.mkdir(exist_ok=True)
        receipt=receipts/(args.manifest_sha256+'.json')
        if not receipt.exists():
            with receipt.open('x',encoding='utf-8') as stream:stream.write(json.dumps(result,indent=2)+'\n')
        print(json.dumps(result))
    finally:await db.close()
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--package',type=Path,required=True);p.add_argument('--manifest-sha256',required=True);p.add_argument('--apply',action='store_true')
    asyncio.run(run(p.parse_args()))
