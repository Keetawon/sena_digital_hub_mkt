"""Staff review counts. A recorded decision is distinct from acceptance/publication."""
from collections import Counter

KINDS = ('section', 'faq', 'fact', 'asset', 'promotion')


def summarize(project_id, candidates, gaps=0, published=False):
    rows = [c for c in candidates if project_id in c['project_ids']]
    reviewed = [c for c in rows if c.get('review')]
    pending = Counter(c['kind'] for c in rows if not c.get('review'))
    latest = max(reviewed, key=lambda c: str(c['review']['reviewed_at']), default=None)
    return {
        'staged': len(rows), 'reviewed': len(reviewed),
        'state': 'published' if published else 'complete' if rows and len(reviewed) == len(rows) else 'reviewing' if reviewed else 'not_started',
        'pending': {kind: pending[kind] for kind in KINDS},
        'pending_other': sum(n for kind, n in pending.items() if kind not in KINDS),
        'conflicts': sum(bool(c.get('holds')) and (not c.get('review') or c['review']['decision'] == 'missing') for c in rows),
        'gaps': gaps + sum(c['kind'] == 'gap' for c in rows),
        'has_legacy_km': any(c['kind'] in ('section', 'faq') and c['source_ref'].startswith('legacy:') for c in rows),
        'has_public_website': any(c['source_ref'].startswith('sena-public:') for c in rows),
        'last_reviewed_at': latest['review']['reviewed_at'] if latest else None,
        'last_reviewed_by': str(latest['review']['reviewed_by']) if latest else None,
    }


async def read_summaries(db, project_ids):
    candidates = await db.fetch('''SELECT c.project_ids,c.kind,c.holds,c.source_ref,
        jsonb_build_object('decision',r.decision,'reviewed_at',r.reviewed_at,'reviewed_by',r.reviewed_by) AS review
        FROM hub.knowledge_candidate_rows() c LEFT JOIN hub.knowledge_reviews r ON r.candidate_id=c.id''')
    candidates = [{**c, 'review': c['review'] if (c.get('review') or {}).get('decision') else None} for c in candidates]
    # Candidate-linked gaps already occur in the staged rows; count only additional named gaps here.
    gaps = {r['project_id']: r['count'] for r in await db.fetch('''SELECT project_id,count(*) AS count
        FROM hub.content_gaps WHERE candidate_id IS NULL AND gap_code<>'NO_ANSWER' GROUP BY project_id''')}
    return {pid: summarize(pid, candidates, gaps.get(pid, 0)) for pid in project_ids}
