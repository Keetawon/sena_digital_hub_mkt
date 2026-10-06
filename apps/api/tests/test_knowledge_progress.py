from sena_hub_api.knowledge_progress import summarize


def candidate(kind='section', review=None, **extra):
    return {'project_ids': ['BNA7'], 'kind': kind, 'holds': [], 'source_ref': 'legacy:test', 'review': review, **extra}


def test_review_progress_counts_decisions_not_acceptances_and_keeps_pending_types():
    review = {'decision': 'rejected', 'reviewed_at': '2026-10-07T10:00:00Z', 'reviewed_by': 'actor'}
    rows = [candidate(review=review), candidate('faq'), candidate('asset'), candidate('promotion', holds=['invalid_promotion']), candidate('alias')]
    result = summarize('BNA7', rows)
    assert result['reviewed'] == 1 and result['staged'] == 5 and result['state'] == 'reviewing'
    assert result['pending'] == {'section': 0, 'faq': 1, 'fact': 0, 'asset': 1, 'promotion': 1}
    assert result['pending_other'] == 1 and result['conflicts'] == 1
    assert result['last_reviewed_by'] == 'actor' and result['has_legacy_km']
    assert summarize('OTHER', rows)['staged'] == 0


def test_no_legacy_km_is_not_zero_percent_and_complete_is_not_published():
    review = {'decision': 'accepted', 'reviewed_at': '2026-10-07T10:00:00Z', 'reviewed_by': 'actor'}
    rows = [candidate(review=review, source_ref='crawler:section')]
    result = summarize('BNA7', rows, gaps=2)
    assert not result['has_legacy_km'] and result['state'] == 'complete' and result['gaps'] == 2
    assert summarize('BNA7', rows, published=True)['state'] == 'published'


def test_shared_scope_and_latest_reviewer_are_deterministic():
    older = {'decision': 'missing', 'reviewed_at': '2026-10-06T10:00:00Z', 'reviewed_by': 'old'}
    newer = {**older, 'reviewed_at': '2026-10-07T10:00:00Z', 'reviewed_by': 'new'}
    rows = [candidate(review=older, project_ids=['TPRAK','SK2TR']), candidate(review=newer, project_ids=['SK2TR'])]
    assert summarize('TPRAK', rows)['staged'] == 1
    assert summarize('SK2TR', rows)['last_reviewed_by'] == 'new'
