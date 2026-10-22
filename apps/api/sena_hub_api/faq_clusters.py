"""Deterministic FAQ intake clusters over existing Knowledge candidates.

No network or AI provider call. The same candidates, names and question bank
always produce the same clusters, keys and order (docs/41 section 3.8, Phase 4).
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata

from pythainlp.tokenize import word_tokenize

from .knowledge_retrieval import AVAILABILITY, COMMERCIAL, INJECTION, NUMERIC

ALGORITHM = 'faq-clusters-v1'
QUESTION_THRESHOLD = 0.72
BANK_THRESHOLD = 0.55
ANSWER_THRESHOLD = 0.9
LEVELS = ('corporate', 'brand', 'programme', 'project_group', 'project', 'unit_type')
HOLDS = ('numeric', 'commercial', 'programme_terms', 'phase_decision', 'mapping_conflict', 'prompt_injection', 'closed_project')
HOLD_MAP = {
    'numeric_claim': 'numeric', 'commercial_text': 'commercial', 'prompt_injection': 'prompt_injection',
    'needs_phase_decision': 'phase_decision', 'mapping_conflict': 'mapping_conflict',
    'unmapped_source_scope': 'mapping_conflict', 'needs_scope_review': 'mapping_conflict',
}
HANDOFF = re.compile(r'ผ่อน|งวด|ดาวน์|installment', re.I)
POLITE = re.compile(r'(?:\s*(?:ครับ|ค่ะ|คะ|นะคะ|นะครับ|นะ|จ้า|คับ))+$')
PUNCT = re.compile(r'[?？!！"“”\'‘’.,:;()\[\]]+')
# KM answers were stored as "<page name> — <answer>"; the prefix is not answer content.
PREFIX = re.compile(r'^[^—\n]{1,200}\s—\s')


def normalize(text: str | None) -> str:
    """Unicode NFC, case folding and whitespace collapse."""
    return ' '.join(unicodedata.normalize('NFC', text or '').casefold().split())


def strip_prefix(answer: str | None) -> str:
    return PREFIX.sub('', answer or '', count=1)


def template(text: str | None, projects: list[str], brands: list[str]) -> str:
    """Question/answer text with its own project and brand names as slots."""
    value = PUNCT.sub(' ', normalize(text))
    for name, slot in sorted([(normalize(n), '{project}') for n in projects] + [(normalize(n), '{brand}') for n in brands],
                             key=lambda item: (-len(item[0]), item[0])):
        if len(name) >= 3:
            value = value.replace(name, slot)
    value = POLITE.sub('', ' '.join(value.split()))
    return re.sub(r'(?:\{project\}\s*)+', '{project} ', re.sub(r'(?:\{brand\}\s*)+', '{brand} ', value)).strip()


def trigrams(text: str) -> frozenset[str]:
    compact = text.replace(' ', '')
    return frozenset(compact[i:i + 3] for i in range(max(1, len(compact) - 2)))


def tokens(text: str) -> frozenset[str]:
    return frozenset(t for t in (normalize(x) for x in word_tokenize(text, engine='newmm', keep_whitespace=False)) if t and t not in '{}')


def jaccard(a: frozenset, b: frozenset) -> float:
    return len(a & b) / len(a | b) if a or b else 1.0


class _Text:
    __slots__ = ('value', 'grams', 'words')

    def __init__(self, value: str):
        self.value, self.grams, self.words = value, trigrams(value), tokens(value)

    def similarity(self, other: '_Text') -> float:
        if self.value == other.value:
            return 1.0
        return (jaccard(self.grams, other.grams) + jaccard(self.words, other.words)) / 2


def _components(items: list, similar) -> list[list]:
    parent = list(range(len(items)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if similar(items[i], items[j]):
                a, b = root(i), root(j)
                parent[max(a, b)] = min(a, b)
    groups: dict[int, list] = {}
    for i, item in enumerate(items):
        groups.setdefault(root(i), []).append(item)
    return list(groups.values())


def _sha(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()


def build_clusters(candidates: list[dict], project_names: dict[str, list[str]], project_brands: dict[str, str],
                   brand_names: dict[str, list[str]], closed_projects: set[str], questions: list[dict]) -> dict:
    """Return {'generation_sha256', 'clusters'} for staging.replace_faq_clusters.

    candidates: id, project_ids, programme_ids, source_url, source_ref, holds and
    evidence (canonical_question/alt_questions/short_answer locale maps).
    questions: question_key, revision, status, default_level, answer_kind,
    question_template and alt_questions (proposed/approved bank entries).
    """
    known = set(project_names)
    rows = []
    for c in sorted(candidates, key=lambda c: str(c['id'])):
        evidence = c['evidence'] or {}
        question = (evidence.get('canonical_question') or {}).get('th') or ''
        alternatives = (evidence.get('alt_questions') or {}).get('th') or []
        answer = strip_prefix((evidence.get('short_answer') or {}).get('th'))
        pids = sorted(set(c.get('project_ids') or []))
        names = [n for p in pids for n in project_names.get(p, [])]
        prefix = PREFIX.match((evidence.get('short_answer') or {}).get('th') or '')
        if prefix:
            names.append(prefix.group(0).rstrip(' —'))
        brands = sorted({project_brands[p] for p in pids if p in project_brands})
        brand_text = [n for b in brands for n in brand_names.get(b, [])]
        holds = {HOLD_MAP[h] for h in c.get('holds') or [] if h in HOLD_MAP}
        if c.get('programme_ids'):
            holds.add('programme_terms')
        if any(p not in known for p in pids):
            holds.add('mapping_conflict')
        if set(pids) & closed_projects:
            holds.add('closed_project')
        if INJECTION.search(question) or INJECTION.search(answer):
            holds.add('prompt_injection')
        if COMMERCIAL.search(question) or COMMERCIAL.search(answer):
            holds.add('commercial')
        if NUMERIC.search(answer):
            holds.add('numeric')
        rows.append({
            'id': str(c['id']), 'question': question, 'alternatives': list(alternatives), 'answer': answer,
            'project_ids': pids, 'programme_ids': sorted(set(c.get('programme_ids') or [])), 'brand_ids': brands,
            'source_url': c.get('source_url'), 'source_ref': c.get('source_ref'),
            'source_kind': evidence.get('source_kind') or 'public_website', 'holds': sorted(holds),
            'template': _Text(template(question, names, brand_text)),
            'answer_template': _Text(template(answer, names, brand_text)),
        })
    bank = [(q, [_Text(template(t, [], [])) for t in [(q['question_template'] or {}).get('th', ''),
                                                        *_lines((q.get('alt_questions') or {}).get('th'))] if t])
            for q in sorted(questions, key=lambda q: q['question_key'])]

    clusters = []
    for members in _components(rows, lambda a, b: a['template'].similarity(b['template']) >= QUESTION_THRESHOLD):
        members.sort(key=lambda r: r['id'])
        counts: dict[str, int] = {}
        for r in members:
            counts[r['template'].value] = counts.get(r['template'].value, 0) + 1
        representative = min(counts, key=lambda t: (-counts[t], t))
        groups = []
        for group in _components(members, lambda a, b: a['answer_template'].similarity(b['answer_template']) >= ANSWER_THRESHOLD):
            group.sort(key=lambda r: r['id'])
            groups.append({'group_key': _sha(sorted(r['answer_template'].value for r in group))[:16], 'answer': group[0]['answer'],
                           'candidate_ids': [r['id'] for r in group],
                           'project_ids': sorted({p for r in group for p in r['project_ids']}),
                           'brand_ids': sorted({b for r in group for b in r['brand_ids']})})
        groups.sort(key=lambda g: (-len(g['candidate_ids']), g['candidate_ids'][0]))
        suggestion = _suggest(_Text(representative), bank, members, groups)
        holds = sorted({h for r in members for h in r['holds']})
        member_ids = [r['id'] for r in members]
        clusters.append({
            'cluster_key': _sha(member_ids), 'template': representative, 'member_candidate_ids': member_ids,
            'variants': [{'candidate_id': r['id'], 'question': r['question'], 'alt_questions': r['alternatives'],
                          'source_url': r['source_url'], 'source_ref': r['source_ref'], 'source_kind': r['source_kind'],
                          'project_ids': r['project_ids'], 'programme_ids': r['programme_ids'], 'holds': r['holds']} for r in members],
            'answer_groups': groups,
            'project_ids': sorted({p for r in members for p in r['project_ids']}),
            'brand_ids': sorted({b for r in members for b in r['brand_ids']}),
            'holds': holds, **suggestion,
        })
    clusters.sort(key=lambda c: (-len(c['member_candidate_ids']), c['template'], c['member_candidate_ids'][0]))
    for n, cluster in enumerate(clusters, 1):
        cluster['sort_key'] = n
    generation = _sha({'algorithm': ALGORITHM, 'clusters': [(c['cluster_key'], c['suggested_question_key'], c['holds']) for c in clusters],
                       'answers': [[g['group_key'] for g in c['answer_groups']] for c in clusters],
                       'questions': [(q['question_key'], q.get('revision')) for q, _ in bank]})
    return {'algorithm': ALGORITHM, 'generation_sha256': generation, 'clusters': clusters}


def _lines(value) -> list[str]:
    if isinstance(value, list):
        return [str(v) for v in value if v]
    return [line for line in str(value or '').splitlines() if line.strip()]


def _suggest(representative: _Text, bank, members, groups) -> dict:
    best = None
    for question, texts in bank:
        score = max((representative.similarity(t) for t in texts), default=0.0)
        if score >= BANK_THRESHOLD and (best is None or score > best[1]):
            best = (question, score)
    if best:
        q, score = best
        return {'suggested_question_key': q['question_key'], 'suggested_level': q['default_level'],
                'suggested_kind': q['answer_kind'], 'suggestion_score': round(score, 4), 'suggestion_basis': 'question_bank'}
    if any(r['programme_ids'] for r in members):
        level = 'programme'
    elif any(len(g['brand_ids']) > 1 for g in groups):
        level = 'corporate'
    elif any(len(g['project_ids']) > 1 for g in groups):
        level = 'brand'
    else:
        level = 'project'
    text = ' '.join(r['question'] for r in members)
    if AVAILABILITY.search(text) or HANDOFF.search(text):
        kind = 'handoff'
    elif sum(bool(NUMERIC.search(r['answer'])) for r in members) * 2 > len(members):
        kind = 'fact'
    else:
        kind = 'text'
    return {'suggested_question_key': None, 'suggested_level': level, 'suggested_kind': kind,
            'suggestion_score': None, 'suggestion_basis': 'heuristic'}
