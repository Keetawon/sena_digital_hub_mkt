"""Explicit local derived-index rebuild. Immutable sources/drafts/publications untouched."""
import argparse,asyncio,hashlib,json,sys
from datetime import datetime,timezone
from pathlib import Path
from uuid import UUID
import asyncpg
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'apps/api'))
from sena_hub_api.knowledge_retrieval import embed,keywords
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def sha(b):return hashlib.sha256(b).hexdigest()
async def run(args):
    package=args.package.resolve();data=(package/'manifest.json').read_bytes()
    if sha(data)!=args.manifest_sha256:raise ValueError('manifest_mismatch')
    manifest=json.loads(data)
    for name,meta in manifest['files'].items():
        b=(package/name).read_bytes()
        if sha(b)!=meta['sha256'] or len(b)!=meta['bytes']:raise ValueError('payload_mismatch')
    rows={r['id']:r for r in read(package/'candidates.json')};chunks=read(package/'preview-chunks.json');changed=[]
    for chunk in chunks:
        row=rows[chunk['candidate_id']]
        if row['kind']!='faq':continue
        questions=[row['evidence']['canonical_question']['th'],*row['evidence'].get('alt_questions',{}).get('th',[])]
        text=questions[chunk['variant']]
        if chunk['chunk_text']==text:continue
        chunk.update(chunk_text=text,keywords=keywords(text),content_sha256=sha(text.encode()))
        changed.append(chunk)
    print(json.dumps({'changed_faq_embeddings':len(changed),'total_chunks':len(chunks),'apply':args.apply}),flush=True)
    if not args.apply:return
    for start in range(0,len(changed),32):
        vectors=await embed([r['chunk_text'] for r in changed[start:start+32]])
        for r,v in zip(changed[start:start+32],vectors):r['embedding']=v
    out=ROOT/'.local/knowledge-index'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');out.mkdir(parents=True)
    content=(json.dumps(chunks,ensure_ascii=False,indent=2)+'\n').encode();(out/'chunks.json').write_bytes(content)
    index_manifest={'contract_version':'knowledge-preview-index-v2','source_manifest_sha256':args.manifest_sha256,'created_at':datetime.now(timezone.utc).isoformat(),'embedding_model':'text-embedding-3-large','dimensions':1536,'question_prefix':False,'files':{'chunks.json':{'sha256':sha(content),'bytes':len(content),'rows':len(chunks)}}}
    encoded=(json.dumps(index_manifest,ensure_ascii=False,indent=2)+'\n').encode();(out/'manifest.json').write_bytes(encoded);index_sha=sha(encoded)
    config=read(ROOT/'.local/development.json');db=await asyncpg.connect(host='127.0.0.1',port=55432,database='sena_hub_local',user='postgres',password=config['adminPassword'])
    try:
        if Path(await db.fetchval('SHOW data_directory')).resolve()!=(ROOT/'.local/postgres').resolve():raise ValueError('local_guard')
        for typename in ('json','jsonb'):await db.set_type_codec(typename,schema='pg_catalog',encoder=json.dumps,decoder=json.loads)
        async with db.transaction():
            await db.execute('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',args.manifest_sha256)
            if await db.fetchval('SELECT count(*) FROM staging.knowledge_candidates WHERE batch_sha256=$1',args.manifest_sha256)!=len(rows):raise ValueError('staged_candidates_mismatch')
            await db.execute('INSERT INTO staging.knowledge_batches(manifest_sha256,manifest) VALUES($1,$2)',index_sha,index_manifest)
            await db.executemany('''UPDATE rag.knowledge_preview_chunks SET chunk_text=$1,keywords=$2,content_sha256=$3,embedding=$4
                WHERE candidate_id=$5 AND locale=$6 AND variant=$7''',[(r['chunk_text'],r['keywords'],r['content_sha256'],r['embedding'],UUID(r['candidate_id']),r['locale'],r['variant']) for r in changed])
        print(json.dumps({'folder':str(out),'manifest_sha256':index_sha,'changed':len(changed),'published':0}))
    finally:await db.close()
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--package',type=Path,required=True);p.add_argument('--manifest-sha256',required=True);p.add_argument('--apply',action='store_true');asyncio.run(run(p.parse_args()))
