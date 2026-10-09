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
}


def content_rule(request: Request):
    route = request.scope.get("route")
    return CONTENT_RULES.get((request.method, getattr(route, "path", None)))


def require_content(request: Request) -> bool:
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
    elif "." in level:
        allowed = caps.get("special_actions", {}).get(level) is True
    else:
        allowed = caps.get("tabs", {}).get(tab, {}).get(level) is True
    if tab == "registry" and caps.get("agency_registry") is True:
        # Fixed external profile: registry read and own-agency binding only.
        # SQL separately checks the target registration's canonical agency.
        allowed = level == "view" or rule == ('registry', 'edit') and getattr(
            request.scope.get('route'), 'path', None) == '/v1/admin/ads/registrations/{code}/bindings'
    if not allowed:
        raise failure(403, "forbidden", "บัญชีนี้ไม่มีสิทธิ์ดำเนินการในแท็บนี้")
    return True
