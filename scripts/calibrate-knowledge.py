"""Offline tuning-only calibration; never changes runtime thresholds or the index."""
import argparse,asyncio,hashlib,json,sys
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'apps/api'))
from sena_hub_api.knowledge_retrieval import rank,route_question,embed
from importlib.util import spec_from_file_location,module_from_spec
spec=spec_from_file_location('followup',ROOT/'scripts/prepare-knowledge-followup.py');helper=module_from_spec(spec);spec.loader.exec_module(helper)

def metric(n,d):return {'numerator':n,'denominator':d,'score':n/d if d else None}
def prediction(ranked,threshold,margin):
    faqs={}
    for r in ranked:
        if r['kind']=='faq' and (r['candidate_id'] not in faqs or r['cosine']>faqs[r['candidate_id']]['cosine']):faqs[r['candidate_id']]=r
    ordered=sorted(faqs.values(),key=lambda r:r['cosine'],reverse=True)
    if ordered and ordered[0]['cosine']>=threshold and (len(ordered)==1 or ordered[0]['cosine']-ordered[1]['cosine']>=margin):return 'faq',[ordered[0]['candidate_id']]
    sections=[r['candidate_id'] for r in ranked if r['kind']=='section' and r['cosine']>=.45][:5]
    return ('sections',sections) if sections else ('no_answer',[])

async def run(args):
    helper.verify(args.followup,args.manifest_sha256)
    helper.verify(args.index,args.index_manifest_sha256)
    helper.verify(args.source,args.source_manifest_sha256)
    questions=helper.read(args.followup/'questions.json');vectors={r['id']:r['embedding'] for r in helper.read(args.followup/'question-embeddings.json')}
    candidates={r['id']:r for r in helper.read(args.source/'candidates.json')};cards={r['rem_project_id']:{**r['payload'],'model_catalogue_complete':False} for r in helper.read(args.source/'fact-cards.json')}
    chunks=[{**candidates[r['candidate_id']],**r,'id':f"{r['candidate_id']}:{r['variant']}"} for r in helper.read(args.index/'chunks.json')]
    scored=[];blocked=[]
    for q in questions:
        guard=route_question(q['question'],cards[q['project_id']])
        if q['holds'] or guard:
            blocked.append({'id':q['id'],'split':q['split'],'reason':q['holds'] or [guard[0]]});continue
        ranked=rank([r for r in chunks if q['project_id'] in r['project_ids']],vectors[q['id']],q['question'])
        scored.append({'question':q,'ranked':ranked,'expected_faq':any(candidates[c]['kind']=='faq' for c in q['candidate_ids'])})
    tuning=[r for r in scored if r['question']['split']=='tuning'];held=[r for r in scored if r['question']['split']=='held_out']
    def evaluate(rows,threshold,margin):
        faq=correct=section=supported=refused=0
        for r in rows:
            route,ids=prediction(r['ranked'],threshold,margin);relevant=bool(set(ids)&set(r['question']['candidate_ids']))
            if route=='faq':faq+=1;correct+=relevant
            elif route=='sections':section+=1;supported+=relevant
            else:refused+=1
        return {'threshold':threshold,'margin':margin,'faq_precision':metric(correct,faq),'faq_recall':metric(correct,sum(r['expected_faq'] for r in rows)),
            'section_answers':section,'section_expected_candidate_support':metric(supported,section),'refusals':refused,'cases':len(rows)}
    grid=[evaluate(tuning,t/100,m) for t in range(80,93) for m in (0,.03,.05,.08)]
    diagnostics=[]
    legacy=[r for r in helper.read(args.source/'heldout-legacy.json') if r['id'] in ('legacy-heldout-481','legacy-heldout-537')]
    legacy_vectors=await embed([r['prompt'] for r in legacy])
    for case,vector in zip(legacy,legacy_vectors):
        ranked=rank([r for r in chunks if case['project_id'] in r['project_ids']],vector,case['prompt'])
        target=[(i+1,r) for i,r in enumerate(ranked) if r['candidate_id']==case['expected_candidate_id']]
        diagnostics.append({'id':case['id'],'expected_candidate_id':case['expected_candidate_id'],'ranks':[i for i,r in target],
            'best_cosine':max((r['cosine'] for i,r in target),default=None),'recall_at_5':any(i<=5 for i,r in target),
            'runtime_prediction':prediction(ranked,.88,.05)[0],
            'top5':[{'candidate_id':r['candidate_id'],'kind':r['kind'],'cosine':r['cosine'],'keyword_score':r['keyword_score']} for r in ranked[:5]],
            'used_for_tuning':False})
    summary={'mode':'OFFLINE_FROZEN_INDEX_DRAFT_LABELS','question_manifest':args.manifest_sha256,'index_manifest':args.index_manifest_sha256,
        'questions':len(questions),'eligible_tuning':len(tuning),'eligible_held_out':len(held),'blocked':blocked,'human_verified':0,
        'grid':grid,'current_tuning':evaluate(tuning,.88,.05),'current_held_out':evaluate(held,.88,.05),'legacy_diagnostics':diagnostics,
        'proposal':'Keep runtime 0.88 and margin 0.05 until MKT verifies labels and the tuning evidence supports a safe change.',
        'limitations':['Candidate-support scoring of draft labels is provisional, not human-verified semantic correctness.','Held-out scores and legacy diagnostics never select thresholds.','Required model catalogue guard remains active.','No approved public knowledge or private preview release was created by calibration.']}
    out=ROOT/'.local/knowledge-calibration'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');out.mkdir(parents=True)
    helper.write(out/'report.json',summary)
    helper.write(out/'manifest.json',{'files':{'report.json':{'sha256':helper.sha((out/'report.json').read_bytes()),'bytes':(out/'report.json').stat().st_size}}})
    print(json.dumps({'folder':str(out),**{k:v for k,v in summary.items() if k in ('questions','eligible_tuning','eligible_held_out','current_tuning','current_held_out','legacy_diagnostics','proposal')}}))

if __name__=='__main__':
    p=argparse.ArgumentParser()
    for name in ('followup','index','source'):p.add_argument('--'+name,type=Path,required=True)
    for name in ('manifest-sha256','index-manifest-sha256','source-manifest-sha256'):p.add_argument('--'+name,required=True)
    asyncio.run(run(p.parse_args()))
