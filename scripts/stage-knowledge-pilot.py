"""Verified, immutable, local-only private knowledge intake. Dry-run by default."""
import argparse,asyncio,hashlib,json,os,sys
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID
import asyncpg
ROOT=Path(__file__).resolve().parents[1]
def sha(data):return hashlib.sha256(data).hexdigest()
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def verify(folder,expected):
    data=(folder/'manifest.json').read_bytes()
    if sha(data)!=expected:raise ValueError('manifest_hash_mismatch')
    manifest=json.loads(data)
    if manifest['contract_version']!='sena-knowledge-pilot-v1':raise ValueError('unsupported_contract')
    for name,meta in manifest['files'].items():
        path=(folder/name).resolve()
        if not path.is_relative_to(folder.resolve()):raise ValueError('unsafe_path')
        data=path.read_bytes()
        if sha(data)!=meta['sha256'] or len(data)!=meta['bytes']:raise ValueError('payload_hash_or_size_mismatch')
        if meta.get('rows') is not None and len(json.loads(data))!=meta['rows']:raise ValueError('row_count_mismatch')
    rows=read(folder/'candidates.json')
    if len({r['source_key'] for r in rows})!=len(rows) or len({r['id'] for r in rows})!=len(rows):raise ValueError('duplicate_source_identity')
    for r in rows:
        if r['kind']!='asset':continue
        e=r['evidence'];loc=e['locations'][0];path=(Path(loc['package'])/loc['blob']).resolve()
        if not path.is_relative_to((ROOT/'.local/knowledge-intake').resolve()):raise ValueError('asset_outside_evidence')
        data=path.read_bytes()
        if sha(data)!=e['sha256'] or len(data)!=e['bytes']:raise ValueError('asset_hash_or_size_mismatch')
    return manifest,rows

async def run(args):
    folder=args.package.resolve();manifest,rows=verify(folder,args.manifest_sha256)
    result={'manifest_sha256':args.manifest_sha256,'verified_candidates':len(rows),'apply':args.apply,'published':0}
    if not args.apply:print(json.dumps(result));return
    # Explicit fixed local cluster + directory checks; never consume an arbitrary environment DSN.
    config=read(ROOT/'.local/development.json')
    db=await asyncpg.connect(host='127.0.0.1',port=55432,database='sena_hub_local',user='postgres',password=config['adminPassword'])
    try:
        directory=Path(await db.fetchval('SHOW data_directory')).resolve()
        expected=(ROOT/'.local/postgres').resolve()
        if directory!=expected or await db.fetchval('SELECT current_database()')!='sena_hub_local':raise ValueError('working_local_only_guard')
        for typename in ('json','jsonb'):await db.set_type_codec(typename,schema='pg_catalog',encoder=json.dumps,decoder=json.loads)
        async with db.transaction():
            await db.execute('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',args.manifest_sha256)
            if await db.fetchval('SELECT EXISTS(SELECT 1 FROM staging.knowledge_batches WHERE manifest_sha256=$1)',args.manifest_sha256):
                result.update(replay=True,inserted=0);print(json.dumps(result));return
            # A different source package must not silently overwrite reviewed candidates.
            existing=await db.fetchval('SELECT count(*) FROM staging.knowledge_candidates WHERE id=ANY($1::uuid[])',[UUID(r['id']) for r in rows])
            if existing:raise ValueError('candidate_identity_conflict_requires_new_evidence_version')
            root=ROOT/'.local/knowledge-assets';root.mkdir(exist_ok=True)
            for r in rows:
                if r['kind']!='asset':continue
                e=r['evidence'];loc=e['locations'][0];data=(Path(loc['package'])/loc['blob']).read_bytes();dest=root/e['sha256']
                if dest.is_symlink():raise ValueError('symlink_asset_path')
                if dest.exists():
                    if sha(dest.read_bytes())!=e['sha256']:raise ValueError('installed_asset_mismatch')
                else:
                    with dest.open('xb') as stream:stream.write(data)
            await db.execute('INSERT INTO staging.knowledge_batches VALUES($1,$2,now())',args.manifest_sha256,manifest)
            await db.executemany('''INSERT INTO staging.knowledge_candidates(id,batch_sha256,source_key,kind,project_ids,programme_ids,topic,source_url,source_ref,evidence,holds)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)''',[(UUID(r['id']),args.manifest_sha256,r['source_key'],r['kind'],r['project_ids'],r['programme_ids'],r['topic'],r['source_url'],r['source_ref'],r['evidence'],r['holds']) for r in rows])
            cards=read(folder/'fact-cards.json')
            await db.executemany('INSERT INTO rag.project_fact_cards(rem_project_id,batch_sha256,payload) VALUES($1,$2,$3)',[(r['rem_project_id'],args.manifest_sha256,r['payload']) for r in cards])
            chunks=read(folder/'preview-chunks.json')
            await db.executemany('''INSERT INTO rag.knowledge_preview_chunks(candidate_id,project_ids,locale,variant,chunk_text,keywords,content_sha256,embedding_model,embedding)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)''',[(UUID(r['candidate_id']),r['project_ids'],r['locale'],r['variant'],r['chunk_text'],r['keywords'],r['content_sha256'],r['embedding_model'],r['embedding']) for r in chunks])
            result.update(inserted=len(rows),cards=len(cards),preview_chunks=len(chunks),private_files=sum(r['kind']=='asset' for r in rows),replay=False)
        receipts=ROOT/'.local/knowledge-receipts';receipts.mkdir(exist_ok=True)
        receipt=receipts/(args.manifest_sha256+'.json')
        with receipt.open('x',encoding='utf-8') as stream:stream.write(json.dumps(result,indent=2)+'\n')
        print(json.dumps(result))
    finally:await db.close()
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--package',type=Path,required=True);p.add_argument('--manifest-sha256',required=True);p.add_argument('--apply',action='store_true');asyncio.run(run(p.parse_args()))
