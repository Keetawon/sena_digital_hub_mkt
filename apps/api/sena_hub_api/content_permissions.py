"""Reviewed content entry map. SQL rechecks every capability before work.

Unlisted groups retain their locked legacy dependency until their own phase.
No caller-supplied path or role chooses a broader database role.
"""

from fastapi import Request

from .auth import failure

CONTENT_RULES = {
    ('GET', '/v1/admin/brands/completeness'): ('brands', 'view'),
    ('GET', '/v1/admin/brands/completeness.csv'): ('brands', 'view'),
    ('GET', '/v1/admin/brands/bulk-preview'): ('brands', 'brands.manage_catalog'),
    ('POST', '/v1/admin/brands/bulk-create'): ('brands', 'brands.manage_catalog'),
    ('POST', '/v1/admin/brands/{public_id}/confirm-source-names'): ('brands', 'edit'),
    ('GET', '/v1/admin/projects/{public_id}/commercial-types'): ('projects', 'view'),
    ('POST', '/v1/admin/projects/{public_id}/commercial-types'): ('projects', 'edit'),
    ('PATCH', '/v1/admin/projects/{public_id}/commercial-types/{commercial_id}'): ('projects', 'edit'),
    ('POST', '/v1/admin/projects/{public_id}/commercial-types/{commercial_id}/assets'): ('projects', 'edit'),
    ('POST', '/v1/admin/projects/{public_id}/commercial-types/{commercial_id}/assets/{binding_id}/remove'): ('projects', 'edit'),
    ('PUT', '/v1/admin/projects/{public_id}/facilities/{code}'): ('projects', 'edit'),
    ('GET', '/v1/admin/assets'): ('assets', 'view'),
    ('POST', '/v1/admin/assets'): ('assets', 'edit'),
    ('GET', '/v1/admin/assets/{asset_id}'): ('assets', 'view'),
    ('POST', '/v1/admin/assets/{asset_id}/review'): ('knowledge', 'approve'),
    ('GET', '/v1/admin/assets/{asset_id}/file'): ('assets', 'view'),
    ('GET', '/v1/admin/assets/{asset_id}/thumbnail'): ('assets', 'view'),
    ('GET', '/v1/admin/projects'): ('projects', 'view'),
    ('GET', '/v1/admin/sources/projects'): ('projects', 'view'),
    ('GET', '/v1/admin/projects/progress'): ('projects', 'view'),
    ('POST', '/v1/admin/projects'): ('projects', 'edit'),
    ('GET', '/v1/admin/sources/brands'): ('brands', 'view'),
    ('GET', '/v1/admin/brands'): ('brands', 'view'),
    ('POST', '/v1/admin/brands'): ('brands', 'brands.manage_catalog'),
    ('GET', '/v1/admin/brands/{public_id}'): ('brands', 'view'),
    ('PATCH', '/v1/admin/brands/{public_id}'): ('brands', 'edit'),
    ('GET', '/v1/admin/brands/{public_id}/versions'): ('brands', 'view'),
    ('POST', '/v1/admin/brands/{public_id}/publish'): ('brands', 'approve'),
    ('POST', '/v1/admin/brands/{public_id}/withdraw'): ('brands', 'approve'),
    ('POST', '/v1/admin/brands/{public_id}/rollback'): ('brands', 'approve'),
    ('POST', '/v1/admin/brands/{public_id}/assets'): ('brands', 'edit'),
    ('POST', '/v1/admin/brands/{public_id}/assets/{binding_id}/remove'): ('brands', 'edit'),
    ('GET', '/v1/admin/brand-requests'): ('brands', 'view'),
    ('POST', '/v1/admin/brand-requests'): ('brands', 'edit'),
    ('POST', '/v1/admin/brand-requests/{request_id}/resolve'): ('brands', 'brands.manage_catalog'),
    ('GET', '/v1/admin/projects/{public_id}'): ('projects', 'view'),
    ('PATCH', '/v1/admin/projects/{public_id}'): ('projects', 'edit'),
    ('POST', '/v1/admin/projects/{public_id}/brand'): ('projects', 'edit'),
    ('GET', '/v1/admin/projects/{public_id}/source-models'): ('projects', 'view'),
    ('POST', '/v1/admin/projects/{public_id}/prefill'): ('projects', 'edit'),
    ('GET', '/v1/admin/projects/{public_id}/models/{public_model_id}'): ('projects', 'view'),
    ('POST', '/v1/admin/projects/{public_id}/models'): ('projects', 'edit'),
    ('PATCH', '/v1/admin/projects/{public_id}/models/{public_model_id}'): ('projects', 'edit'),
    ('POST', '/v1/admin/projects/{public_id}/models/{public_model_id}/review'): ('projects', 'edit'),
    ('GET', '/v1/admin/projects/{public_id}/versions'): ('projects', 'view'),
    ('POST', '/v1/admin/projects/{public_id}/assets'): ('projects', 'edit'),
    ('POST', '/v1/admin/projects/{public_id}/assets/{binding_id}/remove'): ('projects', 'edit'),
    ('POST', '/v1/admin/projects/{public_id}/models/{public_model_id}/assets'): ('projects', 'edit'),
    ('POST', '/v1/admin/projects/{public_id}/models/{public_model_id}/assets/{binding_id}/remove'): ('projects', 'edit'),
    ('POST', '/v1/admin/projects/{public_id}/publish'): ('projects', 'approve'),
    ('POST', '/v1/admin/projects/{public_id}/withdraw'): ('projects', 'approve'),
    ('POST', '/v1/admin/projects/{public_id}/rollback'): ('projects', 'approve'),
    ('GET', '/v1/admin/promotions'): ('promotions', 'view'),
    ('GET', '/v1/admin/promotions/{promotion_id}'): ('promotions', 'view'),
    ('POST', '/v1/admin/promotions'): ('promotions', 'edit'),
    ('PATCH', '/v1/admin/promotions/{promotion_id}'): ('promotions', 'edit'),
    ('POST', '/v1/admin/promotions/{promotion_id}/review'): ('promotions', 'approve'),
    ('POST', '/v1/admin/promotions/{promotion_id}/publish'): ('promotions', 'approve'),
    ('POST', '/v1/admin/promotions/{promotion_id}/withdraw'): ('promotions', 'approve'),
    ('GET', '/v1/admin/releases/candidates'): ('releases', 'view'),
    ('GET', '/v1/admin/releases'): ('releases', 'view'),
    ('GET', '/v1/admin/releases/{release_id}'): ('releases', 'view'),
    ('POST', '/v1/admin/releases/publish'): ('releases', 'approve'),
    ('POST', '/v1/admin/releases/{release_id}/rollback'): ('releases', 'approve'),
    ('GET', '/v1/admin/knowledge/projects'): ('knowledge', 'view'),
    ('GET', '/v1/admin/knowledge/projects/{project_id}'): ('knowledge', 'view'),
    ('POST', '/v1/admin/knowledge/questions/{question_id}/review'): ('knowledge', 'edit'),
    ('POST', '/v1/admin/knowledge/projects/{project_id}/preview-release'): ('knowledge', 'approve'),
    ('POST', '/v1/admin/knowledge/candidates/{candidate_id}/review'): ('knowledge', 'edit'),
    ('GET', '/v1/admin/knowledge/candidates/{candidate_id}/file'): ('knowledge', 'view'),
    ('POST', '/v1/admin/knowledge/rights/approve'): ('knowledge', 'approve'),
    ('POST', '/v1/admin/knowledge/preview'): ('knowledge', 'view'),
    ('GET', '/v1/admin/ads/settings'): ('registry', 'view'),
    ('GET', '/v1/admin/ads/vocab'): ('registry', 'view'),
    ('GET', '/v1/admin/ads/scopes'): ('registry', 'view'),
    ('POST', '/v1/admin/ads/registrations/preview'): ('registry', 'edit'),
    ('POST', '/v1/admin/ads/registrations'): ('registry', 'edit'),
    ('GET', '/v1/admin/ads/registrations'): ('registry', 'view'),
    ('GET', '/v1/admin/ads/registrations/{code}'): ('registry', 'view'),
    ('POST', '/v1/admin/ads/registrations/{code}/names'): ('registry', 'edit'),
    ('POST', '/v1/admin/ads/registrations/{code}/bindings'): ('registry', 'edit'),
    ('POST', '/v1/admin/ads/names/validate'): ('registry', 'view'),
    ('POST', '/v1/admin/ads/memos'): ('finance', 'edit'),
    ('PATCH', '/v1/admin/ads/memos/{record_id}'): ('finance', 'edit'),
    ('POST', '/v1/admin/ads/memos/{record_id}/confirm-record'): ('finance', 'approve'),
    ('POST', '/v1/admin/ads/memo-identifiers'): ('finance', 'edit'),
    ('POST', '/v1/admin/ads/memo-identifiers/{record_id}/review'): ('finance', 'finance.review_identifiers_corrections'),
    ('POST', '/v1/admin/ads/memo-identifiers/{record_id}/retire'): ('finance', 'finance.review_identifiers_corrections'),
    ('POST', '/v1/admin/ads/media-lines'): ('finance', 'edit'),
    ('POST', '/v1/admin/ads/media-lines/{record_id}/revisions'): ('finance', 'edit'),
    ('PATCH', '/v1/admin/ads/media-lines/{record_id}/revisions/{revision_id}'): ('finance', 'edit'),
    ('POST', '/v1/admin/ads/media-lines/{record_id}/revisions/{revision_id}/confirm'): ('finance', 'approve'),
    ('POST', '/v1/admin/ads/media-lines/{record_id}/archive'): ('finance', 'approve'),
    ('POST', '/v1/admin/ads/line-assignments'): ('finance', 'approve'),
    ('POST', '/v1/admin/ads/line-assignments/{record_id}/replace'): ('finance', 'approve'),
    ('POST', '/v1/admin/ads/line-assignments/{record_id}/end'): ('finance', 'approve'),
    ('POST', '/v1/admin/ads/line-assignments/{record_id}/acknowledge'): ('finance', 'approve'),
    ('POST', '/v1/admin/ads/corrections'): ('finance', 'edit'),
    ('POST', '/v1/admin/ads/corrections/{record_id}/review'): ('finance', 'finance.review_identifiers_corrections'),
    ('POST', '/v1/admin/ads/corrections/{record_id}/apply'): ('finance', 'approve'),
    ('POST', '/v1/admin/ads/corrections/{record_id}/retire'): ('finance', 'finance.review_identifiers_corrections'),
    ('POST', '/v1/admin/ads/ad-accounts'): ('finance', 'edit'),
    ('POST', '/v1/admin/ads/ad-accounts/{record_id}/versions'): ('finance', 'edit'),
    ('POST', '/v1/admin/ads/ad-accounts/{record_id}/versions/confirm'): ('finance', 'approve'),
    ('POST', '/v1/admin/ads/ad-accounts/{record_id}/versions/close'): ('finance', 'approve'),
    ('POST', '/v1/admin/ads/channel-accounts'): ('finance', 'edit'),
    ('POST', '/v1/admin/ads/channel-accounts/{record_id}/versions'): ('finance', 'edit'),
    ('POST', '/v1/admin/ads/channel-accounts/{record_id}/versions/confirm'): ('finance', 'approve'),
    ('POST', '/v1/admin/ads/channel-accounts/{record_id}/versions/close'): ('finance', 'approve'),
    ('POST', '/v1/admin/ads/commitments'): ('finance', 'edit'),
    ('POST', '/v1/admin/ads/commitments/{record_id}/revisions'): ('finance', 'edit'),
    ('POST', '/v1/admin/ads/commitments/{record_id}/activate'): ('finance', 'approve'),
    ('POST', '/v1/admin/ads/commitments/{record_id}/suspend'): ('finance', 'approve'),
    ('POST', '/v1/admin/ads/commitments/{record_id}/covers'): ('finance', 'edit'),
    ('POST', '/v1/admin/ads/commitments/{record_id}/occurrences'): ('finance', 'edit'),
    ('POST', '/v1/admin/ads/card-statements'): ('finance', ('edit', 'approve')),
    ('PATCH', '/v1/admin/ads/card-statements/{record_id}'): ('finance', ('edit', 'approve')),
    ('POST', '/v1/admin/ads/card-imports/{record_id}/confirm'): ('finance', 'approve'),
    ('POST', '/v1/admin/ads/card-imports/{record_id}/replace'): ('finance', 'approve'),
    ('POST', '/v1/admin/ads/card-import-rows/{record_id}/classify'): ('finance', 'edit'),
    ('POST', '/v1/admin/ads/cost-records/{record_id}/allocations'): ('finance', 'approve'),
    ('GET', '/v1/admin/ads/memos'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/memos/{record_id}'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/media-lines'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/media-lines/{record_id}'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/line-assignments'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/line-assignments/{record_id}'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/corrections'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/corrections/{record_id}'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/ledger-imports'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/ledger-imports/{record_id}'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/ad-accounts'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/ad-accounts/{record_id}'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/channel-accounts'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/channel-accounts/{record_id}'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/commitments'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/commitments/{record_id}'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/card-statements'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/card-statements/{record_id}'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/card-imports'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/card-imports/{record_id}'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/cost-records'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/cost-records/{record_id}'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/document-requirements'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/document-requirements/{record_id}'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/memo-identifiers'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/memo-identifiers/{record_id}'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/registrations/{code}/line-candidates'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/registrations/{code}/monthly-lines'): ('finance', 'view'),
    ('GET', '/v1/admin/ads/actuals'): ('actuals', 'view'),
    ('GET', '/v1/admin/ads/actuals/{line_id}'): ('actuals', 'view'),
    ('GET', '/v1/admin/ads/document-tracking'): ('documents', 'view'),
    ('GET', '/v1/admin/ads/document-tracking/{key}'): ('documents', 'view'),
    ('GET', '/v1/admin/ads/findings'): ('exceptions', 'view'),
    ('GET', '/v1/admin/ads/findings/{key}'): ('exceptions', 'view'),
    ('POST', '/v1/admin/ads/findings/{key}/workflow'): ('exceptions', 'edit'),
    ('POST', '/v1/admin/ads/document-tracking/{key}/follow-ups'): ('documents', 'edit'),
    ('GET', '/v1/admin/ads/archive'): ('archive', 'view'),
    ('GET', '/v1/admin/ads/archive/fixtures'): ('archive', 'view'),
    ('GET', '/v1/admin/ads/archive/search'): ('archive', 'view'),
    ('GET', '/v1/admin/ads/archive/{document_id}'): ('archive', 'view'),
    ('GET', '/v1/admin/ads/archive/{document_id}/file'): ('archive', 'view'),
    ('GET', '/v1/admin/ads/archive/{document_id}/page'): ('archive', 'view'),
    ('POST', '/v1/admin/ads/archive'): ('archive', 'edit'),
    ('POST', '/v1/admin/ads/archive/{document_id}/retry'): ('archive', 'edit'),
    ('POST', '/v1/admin/ads/archive/{document_id}/confirm'): ('archive', 'edit'),
    ('POST', '/v1/admin/ads/archive/{document_id}/apply'): ('archive', 'approve'),
    ('POST', '/v1/admin/ads/archive/{document_id}/hold'): ('archive', 'archive.legal_hold'),
}


def content_rule(request: Request):
    route = request.scope.get("route")
    return CONTENT_RULES.get((request.method, getattr(route, "path", None)))


def require_content(request: Request, *, error_code: str = "forbidden") -> bool:
    rule = content_rule(request)
    if rule is None:
        return False
    caps = getattr(request.state, "account", {}).get("capabilities", {})
    tab, level = rule
    if tab == "assets":
        allowed = any(caps.get("tabs", {}).get(t, {}).get(level) is True
                      for t in ("projects", "brands", "knowledge"))
        if level == "edit":
            # Rights reviewers retain upload intake, without gaining permission
            # to edit or bind a project/brand. SQL checks the same disjunction.
            allowed = allowed or caps.get("tabs", {}).get("knowledge", {}).get("approve") is True
    elif isinstance(level, tuple):
        # Statement writes: SQL checks the existing and requested review status
        # under its Finance lock. A draft needs E; a confirmed write needs A.
        allowed = any(caps.get("tabs", {}).get(tab, {}).get(item) is True for item in level)
    elif "." in level:
        allowed = caps.get("special_actions", {}).get(level) is True
    else:
        allowed = caps.get("tabs", {}).get(tab, {}).get(level) is True
    if tab == "registry" and caps.get("agency_registry") is True:
        # Fixed external profile: registry read and own-agency binding only.
        # SQL separately checks the target registration's canonical agency.
        allowed = level == "view" or rule == ('registry', 'edit') and getattr(
            request.scope.get('route'), 'path', None) == '/v1/admin/ads/registrations/{code}/bindings'
    if rule == ('archive', 'approve'):
        allowed = allowed and caps.get('tabs', {}).get('finance', {}).get('edit') is True
    if not allowed:
        raise failure(403, error_code, "บัญชีนี้ไม่มีสิทธิ์ดำเนินการในแท็บนี้")
    return True
