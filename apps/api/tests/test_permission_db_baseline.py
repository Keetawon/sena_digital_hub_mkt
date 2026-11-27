"""Reviewed legacy grants/RLS inventory and real runtime SQL entry probes."""
import asyncio
import json
import os
from pathlib import Path
import re

import asyncpg
import pytest

from sena_hub_api.auth import ALL_DEMO_ACTORS, DEMO_AGENCIES

BASELINE = json.loads((Path(__file__).resolve().parents[3] / 'tests/permissions/legacy-db.json').read_text(encoding='utf-8'))
SCHEMAS = ['hub', 'ads', 'audit', 'staging', 'internal', 'rag', 'public_api']
ROLES = ['admin', 'editor', 'publisher', 'viewer', 'online_staff', 'agency', 'service_consumer']
# Explicit Phase 1 additions. The 45-migration historical manifest is immutable;
# foundation tests below/next door verify the new FORCE RLS and closed ACLs.
FOUNDATION_TABLES = {'hub.permission_catalog', 'hub.permission_template', 'hub.account_permission', 'hub.permission_event'}
FOUNDATION_FUNCTIONS = {'hub.permission_actor', 'hub.validate_permission_row', 'hub.permission_rows',
    'hub.copy_account_template', 'hub.can', 'hub.can_special', 'hub.can_agency_registry',
    'hub.permission_projection', 'hub.permission_catalog_read', 'hub.save_account_permissions'}
ACCOUNT_UI_TABLES = {'hub.permission_notice_ack', 'hub.user_account_avatar'}
WEBSITE_TABLES = {'hub.website_asset_suggestions', 'staging.website_content_receipts'}
MEDIA_WORKER_TABLES = {'hub.media_ai_settings', 'hub.media_worker_status'}
WEBSITE_FUNCTIONS = {'hub.' + name for name in ('website_source_valid', 'website_media_agreement',
    'website_media_projects', 'website_media_queue', 'website_media_confirm', 'website_content_sources',
    'website_media_claim', 'website_media_finish')}
ACCOUNT_UI_FUNCTIONS = {'hub.' + name for name in (
    'normalise_permission_tabs', 'account_access', 'permission_catalog_digest', 'resolve_account_access',
    'write_account_access', 'configure_account_access', 'approve_account_access', 'permission_batch_preview',
    'preview_account_permissions', 'apply_account_permissions', 'ack_permission_notice',
    'update_own_profile', 'set_own_avatar', 'clear_own_avatar', 'read_avatar_metadata')}
CONTENT_TABLES = {'hub.' + name for name in (
    'projects', 'model_types', 'entity_assets', 'entity_versions', 'commercial_types', 'commercial_type_sources',
    'commercial_type_assets', 'facility_taxonomy', 'project_facilities', 'project_progress_cache', 'project_progress_dirty',
    'brands', 'brand_versions', 'brand_assets', 'brand_requests', 'brand_bulk_runs', 'assets')}
CONTENT_FUNCTIONS = {'hub.' + name for name in (
    'require_permission', 'require_special', 'can_upload_asset', 'require_asset_upload', 'remember_asset_binding',
    'can_read_asset', 'require_asset_access', 'project_permission_projection', 'project_versions', 'progress_permission_projection',
    'asset_registered_for_cleanup', 'asset_permission_projection', 'snapshot_assets_visible')}
CONTENT_FUNCTIONS |= {'hub.public_content_payload', 'hub.project_publication_preview', 'hub.publication_review', 'hub.public_asset_file'}
PROJECT_CONTENT_TABLES = {'hub.' + name for name in (
    'field_catalog', 'project_facts', 'project_buildings', 'project_selling_points', 'contact_domains', 'contacts',
    'knowledge_topics', 'faq_questions', 'faq_question_versions', 'content_section_versions', 'faq_versions', 'faq_sources',
    'translation_glossary', 'content_translations', 'translation_jobs')}
PROJECT_CONTENT_FUNCTIONS = {'hub.' + name for name in (
    'content_scope_allowed', 'workspace_require', 'workspace_project_bu', 'workspace_search',
    'workspace_faq_allowed', 'workspace_review_rows', 'workspace_home',
    'workspace_context', 'workspace_scope_matches', 'workspace_native_rows',
    'workspace_native_publishable', 'workspace_content_tasks',
    'workspace_project_readiness', 'workspace_brand_readiness',
    'content_scope_tab', 'content_scope_access', 'require_field_admin', 'content_fields', 'save_content_field',
    'save_contact_domain', 'content_number', 'content_rem_values', 'project_content_facts', 'save_project_fact',
    'save_project_building', 'content_contacts', 'save_content_contact', 'section_visible', 'content_version_guard',
    'content_locales', 'content_fact_keys', 'faq_question_list', 'save_faq_question', 'approve_faq_question',
    'project_content_sections', 'save_content_section', 'save_selling_point', 'faq_read', 'save_faq',
    'translation_allowed', 'translation_source_allowed', 'sync_content_translation', 'track_content_translation', 'translation_editable',
    'content_translation_list', 'review_content_translation', 'retry_content_translation', 'glossary_read', 'save_glossary', 'approve_glossary',
    'translation_requester_allowed', 'claim_translation', 'finish_translation', 'translation_complete',
    'project_content_readiness', 'project_content', 'faq_references', 'submit_faq', 'submit_content_section',
    'review_knowledge_candidate_before_versions', 'project_required_missing_summary', 'list_project_summaries')}
WORKSPACE_FUNCTIONS = {
    'hub.workspace_item_context',
    'hub.content_activity', 'hub.content_history', 'hub.content_history_event',
    'hub.review_knowledge_candidate_before_workspace', 'hub.website_text_decide', 'hub.website_text_key',
    'hub.website_text_latest', 'hub.website_text_numeric', 'hub.workspace_actor',
    'hub.workspace_admin', 'hub.workspace_confirmed_groups', 'hub.workspace_faq',
    'hub.workspace_faq_impact', 'hub.workspace_faq_scope_access', 'hub.workspace_faq_scope_allowed',
    'hub.workspace_faq_target', 'hub.workspace_faq_visible', 'hub.workspace_field_target',
    'hub.workspace_history_action', 'hub.workspace_history_contexts', 'hub.workspace_history_event',
    'hub.workspace_history_fields', 'hub.workspace_history_matches', 'hub.workspace_history_visible',
    'hub.workspace_legacy_faq_candidates', 'hub.workspace_missing_fact_cells', 'hub.workspace_name', 'hub.workspace_page',
    'hub.workspace_phase', 'hub.workspace_preview', 'hub.workspace_projects',
    'hub.workspace_resolve', 'hub.workspace_target', 'hub.workspace_tree',
}

WORKFLOW_TABLES = {'hub.content_review_versions'}
WORKFLOW_FUNCTIONS = {
    'hub.content_exposure',
    'hub.content_decision_stamp',
    'hub.content_definition_replace',
    'hub.content_glossary_version',
    'hub.content_native_authors',
    'hub.content_native_freeze',
    'hub.content_preview_compose',
    'hub.content_preview_faqs',
    'hub.content_preview_output',
    'hub.content_preview_project',
    'hub.content_preview_resolve',
    'hub.content_preview_scope_faq',
    'hub.content_preview_sections',
    'hub.content_preview_source_available',
    'hub.content_review_reason',
    'hub.content_review_version_guard',
    'hub.content_self_review',
    'hub.content_staged_evidence',
    'hub.content_staged_invalidation',
    'hub.content_submission_freeze',
    'hub.content_workflow_authors',
    'hub.content_workflow_hash',
    'hub.content_workflow_exposure_save',
    'hub.content_workflow_history_review',
    'hub.content_workflow_history_staged',
    'hub.content_workflow_identity',
    'hub.content_workflow_items',
    'hub.content_workflow_lock',
    'hub.content_workflow_material',
    'hub.content_workflow_payload',
    'hub.content_workflow_read',
    'hub.content_workflow_read_core',
    'hub.content_workflow_review',
    'hub.content_workflow_save_approve',
    'hub.content_workflow_source',
    'hub.content_workflow_staged_values',
    'hub.content_workflow_submit',
    'hub.content_workflow_table',
    'hub.content_workflow_version',
    'hub.publication_actor',
    'hub.publication_certificate',
    'hub.publication_commercial',
    'hub.publication_dependency_check',
    'hub.publication_enrich',
    'hub.publication_expiry_tasks',
    'hub.publication_fact_dependencies',
    'hub.publication_item_descriptor',
    'hub.publication_item_key',
    'hub.publication_legacy_certify',
    'hub.publication_legacy_dependencies',
    'hub.publication_page_visible',
    'hub.publication_pinned_fact',
    'hub.publication_pinned_source',
    'hub.publication_prices',
    'hub.publication_promotion_check',
    'hub.publication_queue_prepare',
    'hub.publication_queue_publish',
    'hub.publication_queue_read',
    'hub.publication_queue_return',
    'hub.publication_release_candidates',
    'hub.publication_release_core',
    'hub.publication_release_prepared',
    'hub.publication_replace',
    'hub.publication_retained_reviewer_evidence',
    'hub.publication_retained_media_source',
    'hub.publication_compose_faq',
    'hub.publication_rollback_check',
    'hub.publication_sanitize',
    'hub.publication_snapshot_guard',
    'hub.publication_source_kind',
    'hub.publication_task_context',
    'hub.publication_task_native_ready',
    'hub.publication_task_published',
    'hub.publication_workflow_descriptor',
    'hub.publication_write_lock',
    'hub.translation_editable_before_workflow',
    'hub.web_source_available_before_workflow',
}
WORKFLOW_APP_FUNCTIONS = {
    'hub.content_workflow_exposure_save',
    'hub.content_workflow_items',
    'hub.content_workflow_read',
    'hub.content_workflow_review',
    'hub.content_workflow_save_approve',
    'hub.content_workflow_submit',
    'hub.publication_queue_prepare',
    'hub.publication_queue_publish',
    'hub.publication_queue_read',
    'hub.publication_queue_return',
}

BUSINESS_TABLES = {'hub.businesses', 'hub.brand_business'}
BUSINESS_FUNCTIONS = {
    'internal.assistant_business_search',
    'hub.business_assign_brand',
    'hub.business_cluster_matches',
    'hub.business_content',
    'hub.business_project_matches',
    'hub.business_references',
    'hub.business_scope_faq_rows',
    'hub.faq_scope_rank',
    'internal.assistant_saved_source',
    'internal.assistant_saved_source_visible',
}

SCOPE_INVENTORY = json.loads((Path(__file__).resolve().parents[3] / 'tests/permissions/content-scope-db.json').read_text(encoding='utf-8'))
SCOPE_TABLES = {row['name'] for row in SCOPE_INVENTORY['new_tables']['tables']}
SCOPE_FUNCTIONS = set(SCOPE_INVENTORY['new_functions']['names'])

WRITING_INVENTORY = json.loads((Path(__file__).resolve().parents[3] / 'tests/permissions/content-writing-db.json').read_text(encoding='utf-8'))
WRITING_TABLES = {row['name'] for row in WRITING_INVENTORY['new_tables']['entries']}
WRITING_FUNCTIONS = {row['name'] for row in WRITING_INVENTORY['new_functions']['entries']}

UPLOAD_INVENTORY = json.loads((Path(__file__).resolve().parents[3] / 'tests/permissions/upload-optimization-db.json').read_text(encoding='utf-8-sig'))
UPLOAD_TABLES = set(UPLOAD_INVENTORY['tables'])
UPLOAD_FUNCTIONS = {row['name'] for row in UPLOAD_INVENTORY['functions']}

EVENT_TABLES = {'hub.' + name for name in (
    'event_sequence', 'events', 'event_attachments', 'event_participants', 'event_revisions', 'event_acknowledgements')}
EVENT_FUNCTIONS = {'hub.' + name for name in (
    'event_staff_allowed', 'event_require_staff', 'event_can_manage', 'event_can_read_finance',
    'event_next_code', 'event_live_status', 'event_record_critical_change',
    'can_read_asset_before_events', 'can_upload_asset_before_events',
    'event_references', 'event_list', 'event_read', 'event_save',
    'event_attachment_add', 'event_attachment_remove',
    'event_join_save', 'event_join_decide',
    'event_ack_alerts', 'event_acknowledge')}

# Phase 4 FAQ intake: owner-only tables, read and written only through guarded definers.
FAQ_COVERAGE_FUNCTIONS = {'hub.' + name for name in ('faq_project_form', 'faq_rule_projects', 'faq_applicability_preview', 'faq_fact_keys', 'faq_fact_slot', 'faq_clean_text', 'faq_lint', 'faq_sync_gap', 'compose_project_faq', 'faq_composition', 'faq_coverage', 'faq_gaps', 'faq_gap_update')}
FAQ_INTAKE_TABLES = {'staging.faq_clusters', 'hub.faq_intake_decisions'}
FAQ_INTAKE_FUNCTIONS = {'hub.faq_intake_text', 'hub.faq_intake_state', 'hub.faq_intake_clusters', 'hub.faq_intake_cluster',
                        'hub.decide_faq_cluster', 'staging.replace_faq_clusters'}
PRIVATE_PUBLIC_VIEWS = {'public_api.projects', 'public_api.brands', 'public_api.promotions'}
MEDIA_TABLES = {'hub.' + name for name in (
    'media_tags', 'asset_media_tags', 'asset_links', 'media_requirements', 'media_links', 'media_link_targets', 'media_jobs')}
MEDIA_FUNCTIONS = {'hub.' + name for name in (
    'media_categories', 'media_project', 'media_target', 'can_read_asset_before_media', 'media_tag_save',
    'media_tag_approve', 'media_tags_read', 'media_require_asset_edit', 'media_save_asset', 'media_link_save',
    'media_link_remove', 'media_legacy_binding_guard', 'media_requirements_read', 'media_requirement_save',
    'media_clip_save', 'media_checklist', 'project_media', 'media_thumbnail_binding', 'project_content_readiness_before_media',
    'media_job_allowed', 'media_job_request', 'media_jobs_read', 'media_claim', 'media_finish', 'media_schedule_checks', 'media_clip_check',
    'media_budget_blocked', 'provider_budget_event', 'media_budget_exhausted',
    'media_budget_totals', 'media_worker_heartbeat', 'media_ai_state', 'media_job_audit', 'media_image_claim',
    'media_image_lease', 'media_image_fetch_audit', 'media_image_begin', 'media_image_wait', 'media_image_finish',
    'media_clip_claim_legacy', 'media_finish_legacy')}
WEB_TABLES = {'hub.web_pages', 'hub.web_publications', 'hub.web_changes'}
WEB_FUNCTIONS = {'hub.' + name for name in (
    'web_publication_guard', 'web_hash', 'web_localized', 'web_fallback', 'web_source', 'web_source_content', 'web_authored_content', 'web_dependency', 'web_source_available', 'web_item', 'web_asset', 'web_registry_fields', 'web_sections', 'web_contacts', 'web_faqs', 'web_project', 'web_article_node', 'web_article', 'web_compose', 'web_scope_faq', 'web_nodes', 'web_dependencies', 'web_issues', 'web_assert_sources', 'web_resolve', 'web_output', 'web_limit_faq', 'web_changed_pages', 'web_workspace', 'web_page_save', 'web_prepare', 'web_preview_assets', 'web_publication_read', 'web_record_change', 'web_publish', 'web_history', 'web_pointer', 'web_version_preview', 'web_public_page', 'web_public_changes', 'web_public_ai')}
ARTICLE_TABLES = {'hub.articles', 'hub.article_versions', 'hub.article_links'}
ARTICLE_FUNCTIONS = {'hub.' + name for name in (
    'article_node_valid', 'article_nodes', 'article_doc_valid', 'article_tags_valid', 'article_link_guard', 'article_image_allowed', 'article_reference_allowed', 'article_reference_issues', 'article_english_doc', 'article_texts', 'track_article_translation', 'article_translation_write', 'article_readiness', 'article_save', 'article_submit', 'article_review', 'article_list', 'article_references', 'article_read', 'article_preview')}
COMMERCIAL_TABLES = {'hub.' + name for name in ('project_disclosures', 'project_sales_terms', 'project_programmes', 'project_progress', 'project_commercial_versions')}
COMMERCIAL_FUNCTIONS = {'hub.' + name for name in (
    'project_commercial_table', 'project_commercial_entity', 'project_commercial_fields', 'project_commercial_public',
    'project_commercial_snapshot', 'project_disclosure_comparison', 'project_commercial_readiness', 'save_project_commercial',
    'review_project_commercial', 'project_current_commercial', 'project_commercial_workspace', 'track_project_commercial_translation',
    'promotion_references', 'validate_promotion_targets', 'promotion_target_projects', 'promotion_banners',
    'promotion_banner_changed', 'track_promotion_translation', 'promotion_owner_guard',
    'promotion_scope_projects', 'validate_promotion_scope', 'promotion_scope_snapshot',
    'promotion_scope_access', 'promotion_scope_visible', 'promotion_resolve',
    'promotion_benefit_items_valid', 'promotion_benefit_sync', 'promotion_require_scope', 'promotion_filter_matches',
    'promotion_require_project_ids', 'promotion_frozen_scope_guard',
    'workspace_promotion_rows', 'workspace_promotions', 'workspace_promotion_suggestions')}
UNIT_TABLES = {'hub.' + name for name in ('commercial_type_versions', 'project_prices', 'project_price_versions')}
UNIT_FUNCTIONS = {'hub.' + name for name in (
    'unit_version_guard', 'unit_type_changed', 'unit_type_content_guard', 'unit_type_asset_guard',
    'unit_source_comparison', 'unit_type_readiness', 'unit_type_snapshot', 'unit_type_review',
    'unit_price_comparison', 'project_price_readiness', 'project_price_snapshot', 'save_project_price',
    'project_price_review', 'project_current_prices', 'unit_type_workspace')}
AMENITY_TABLES = {'hub.' + name for name in (
    'feature_catalog', 'project_features', 'solar_estimates', 'project_places',
    'ref_rail_lines', 'ref_rail_stations', 'ref_expressways', 'ref_expressway_ramps')}
AMENITY_FUNCTIONS = {'hub.' + name for name in (
    'c4_metric_defs_valid', 'c4_metrics_valid', 'c4_check_changes', 'c4_project_guard',
    'c4_facility_save', 'c4_item_save', 'c4_solar_review', 'c4_reference_save',
    'c4_references', 'c4_nearest_stations', 'c4_workspace', 'c4_facility_cover')}
PUBLICATION_TABLES = {'hub.' + name for name in (
    'public_promotions', 'promotion_reviews', 'promotion_versions', 'publication_releases', 'publication_release_members',
    'knowledge_reviews', 'content_sections', 'faqs', 'entity_aliases', 'content_gaps', 'knowledge_fact_candidates',
    'knowledge_asset_links', 'knowledge_evaluation_reviews', 'knowledge_preview_releases')}
PUBLICATION_TABLES |= {'staging.' + name for name in (
    'knowledge_batches', 'knowledge_candidates', 'knowledge_followup_batches', 'knowledge_eval_questions', 'knowledge_promotion_annotations')}
PUBLICATION_TABLES |= {'rag.knowledge_preview_chunks', 'rag.project_fact_cards'}
PUBLICATION_FUNCTIONS = {'hub.content_member_tab', 'hub.knowledge_preview_projection',
    'hub.knowledge_preview_visible', 'hub.knowledge_preview_read'}
REGISTRY_TABLES = {'ads.' + name for name in ('vocab', 'scope_code', 'scope_member', 'campaign_registration',
    'campaign_name', 'native_binding', 'setting', 'code_sequence')}
REGISTRY_FUNCTIONS = {'hub.registry_agency', 'hub.require_registry', 'hub.registry_startup_ready'}
REGISTRY_REPLACED_POLICIES = {'agency_vocab', 'agency_registration', 'agency_names', 'agency_bindings',
    'agency_binding_check', 'agency_scopes', 'agency_members'}
OPERATIONS_TABLES = {'ads.' + name for name in (
    'memo', 'memo_identifier', 'media_line', 'media_line_revision', 'media_line_component', 'line_budget_item',
    'correction', 'correction_target', 'line_assignment', 'document_requirement', 'ad_account', 'channel_account',
    'account_mapping', 'recurring_commitment', 'commitment_version', 'commitment_memo_cover', 'commitment_occurrence',
    'card_statement_control', 'cost_record', 'cost_allocation_set', 'cost_allocation',
    'finding_workflow', 'finding_history', 'document_follow_up', 'archive_fixture', 'archive_document', 'archive_version',
    'archive_receipt', 'archive_job', 'archive_attempt', 'archive_extraction', 'archive_confirmation', 'archive_application', 'archive_memo_chunk')}
OPERATIONS_TABLES |= {'staging.' + name for name in ('ads_ledger_batch', 'ads_ledger_row', 'ads_card_batch', 'ads_card_row',
    'ads_actuals_batch', 'ads_actuals_current', 'ads_actuals_dim', 'ads_actuals_bridge', 'ads_actuals_monthly', 'ads_actuals_finding')}
OPERATIONS_TABLES |= {'audit.archive_access'}
OPERATIONS_FUNCTIONS = {'hub.workflow_actor_label', 'hub.operations_projection'}
ASSISTANT_TABLES = {'internal.' + name for name in ('assistant_run', 'assistant_tool', 'assistant_citation',
    'assistant_proposal', 'assistant_proposal_application')} | {'audit.assistant_proposal_event'}
ASSISTANT_POLICIES = {'assistant_run_owner', 'assistant_tool_owner', 'assistant_citation_owner',
    'assistant_proposal_owner', 'assistant_application_owner', 'assistant_event_owner'}
ASSISTANT_FUNCTIONS = {'internal.' + name for name in ('assistant_require_actor', 'assistant_can_source',
    'assistant_access', 'assistant_content_version', 'assistant_project_reference', 'assistant_campaign_codes',
    'assistant_marketing_lines', 'assistant_scoped_promotion_source')}
SHARED_TABLES = {'audit.change_log', 'hub.asset_roles', 'hub.user_account', 'hub.user_account_event', 'hub.account_invite'}
SHARED_TABLES |= {'staging.' + name for name in ('ads_scope_import', 'dw_project_groups', 'dw_projects', 'intake_batches',
    'project_group_evidence', 'project_intake_evidence', 'project_intake_receipts', 'rem_brands', 'rem_companies', 'rem_models', 'rem_projects')}
SHARED_FUNCTIONS = {'hub.account_directory', 'hub.finance_references', 'hub.require_public_reader',
    'public_api.read_projects', 'public_api.read_brands', 'public_api.read_promotions'}
TECHNICAL_TABLES = {'hub.demo_assets', 'hub.demo_release_selection', 'staging.source_offers'}
TECHNICAL_ONLY_FUNCTIONS = {'ads.cancel_registration', 'ads.set_approval', 'ads.actuals_current_snapshot',
    'ads.apply_ads_actuals', 'ads.archive_claim', 'ads.archive_heartbeat', 'ads.archive_finish'}
FUNCTIONS_SQL = """select n.nspname||'.'||p.proname as name,pg_get_function_identity_arguments(p.oid) as arguments,
 p.prosecdef as security_definer,p.proconfig as config,
 array(select r from unnest($2::text[]) r where has_function_privilege(r,p.oid,'execute') order by r) as execute_roles
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=any($1) order by 1,2"""
RELATIONS_SQL = """select n.nspname||'.'||c.relname as name,c.relkind::text as kind,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,
 array(select r||':'||priv from unnest($2::text[]) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) priv
 where has_table_privilege(r,c.oid,priv) order by 1) as grants from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname=any($1) and c.relkind in ('r','p','v','m') order by 1"""
POLICIES_SQL = """select schemaname as schema,tablename as table,policyname as name,permissive,roles,cmd,qual,with_check
 from pg_policies where schemaname=any($1) order by 1,2,3"""
SCHEMAS_SQL = """select nspname as name,array(select r from unnest($2::text[]) r
 where has_schema_privilege(r,oid,'usage') order by r) as usage_roles from pg_namespace where nspname=any($1) order by 1"""


async def runtime(*, probe=False):
    db = await asyncpg.connect(os.environ['HUB_TEST_PROBE_DATABASE_URL' if probe else 'HUB_TEST_DATABASE_URL'])
    attributes = await db.fetchrow('select rolname,rolsuper,rolbypassrls from pg_roles where rolname=current_user')
    assert tuple(attributes.values()) == ('hub_permission_probe' if probe else 'hub_runtime', False, False)
    if probe:
        memberships = await db.fetch("select r.rolname,m.admin_option,m.inherit_option,m.set_option from pg_auth_members m join pg_roles r on r.oid=m.roleid where m.member=current_user::regrole")
        assert {r['rolname'] for r in memberships} == set(ROLES) | {'hub_app'}
        assert all(not r['admin_option'] and not r['inherit_option'] and r['set_option'] for r in memberships)
    return db


def test_live_catalog_matches_reviewed_local_baseline():
    async def check():
        db = await runtime()
        try:
            for name, sql, args in [('schemas', SCHEMAS_SQL, [SCHEMAS, ROLES]), ('functions', FUNCTIONS_SQL, [SCHEMAS, ROLES]), ('relations', RELATIONS_SQL, [SCHEMAS, ROLES]), ('policies', POLICIES_SQL, [SCHEMAS])]:
                actual = [dict(row) for row in await db.fetch(sql, *args)]
                if name in ('relations', 'functions'):
                    additions = FOUNDATION_TABLES | ACCOUNT_UI_TABLES | PROJECT_CONTENT_TABLES | MEDIA_TABLES | UNIT_TABLES | FAQ_INTAKE_TABLES | COMMERCIAL_TABLES | AMENITY_TABLES | ARTICLE_TABLES | WEB_TABLES if name == 'relations' else FOUNDATION_FUNCTIONS | CONTENT_FUNCTIONS | PUBLICATION_FUNCTIONS | REGISTRY_FUNCTIONS | OPERATIONS_FUNCTIONS | ASSISTANT_FUNCTIONS | SHARED_FUNCTIONS | ACCOUNT_UI_FUNCTIONS | PROJECT_CONTENT_FUNCTIONS | MEDIA_FUNCTIONS | UNIT_FUNCTIONS | FAQ_INTAKE_FUNCTIONS | COMMERCIAL_FUNCTIONS | FAQ_COVERAGE_FUNCTIONS | AMENITY_FUNCTIONS | ARTICLE_FUNCTIONS | WEB_FUNCTIONS
                    additions |= WEBSITE_TABLES | MEDIA_WORKER_TABLES | WORKFLOW_TABLES if name == 'relations' else WEBSITE_FUNCTIONS | WORKSPACE_FUNCTIONS | WORKFLOW_FUNCTIONS
                    additions |= BUSINESS_TABLES if name == 'relations' else BUSINESS_FUNCTIONS
                    additions |= SCOPE_TABLES if name == 'relations' else SCOPE_FUNCTIONS
                    additions |= WRITING_TABLES if name == 'relations' else WRITING_FUNCTIONS

                    additions |= UPLOAD_TABLES if name == 'relations' else UPLOAD_FUNCTIONS
                    additions |= EVENT_TABLES if name == 'relations' else EVENT_FUNCTIONS
                    assert {r['name'] for r in actual} - {r['name'] for r in BASELINE[name]} == additions
                    actual = [r for r in actual if r['name'] not in additions]
                if name == 'policies':
                    events = [r for r in actual if r['schema'] + '.' + r['table'] in EVENT_TABLES]
                    assert len(events) == len(EVENT_TABLES) == 6
                    assert all(r['name'] == 'event_owner' and r['roles'] == ['postgres'] and r['cmd'] == 'ALL'
                        and r['qual'] == r['with_check'] == 'true' for r in events)
                    actual = [r for r in actual if r not in events]
                    writing = [r for r in actual if r['schema'] + '.' + r['table'] in WRITING_TABLES]
                    assert len(writing) == len(WRITING_TABLES) == 2
                    assert all(r['name'] == 'writing_owner' and r['roles'] == ['postgres'] and r['cmd'] == 'ALL'
                        and r['qual'] == r['with_check'] == 'true' for r in writing)
                    actual = [r for r in actual if r not in writing]
                    # Explicit W6 additions are verified independently against
                    # the frozen inventory, before the older policy counts.
                    restrictive = [r for r in actual if r['name'] == 'content_object_scope']
                    expected_scope = SCOPE_INVENTORY['existing_restrictive_policies']
                    assert len(restrictive) == expected_scope['expected_count'] == 92
                    assert {r['schema'] + '.' + r['table'] for r in restrictive} == set(expected_scope['relations'])
                    assert all(r['permissive'] == 'RESTRICTIVE' and r['cmd'] == 'ALL'
                        and r['with_check'] == 'false' and 'hub.content_row_visible(' in r['qual'] for r in restrictive)
                    owners = [r for r in actual if r['schema'] + '.' + r['table'] in SCOPE_TABLES]
                    assert len(owners) == len(SCOPE_TABLES) == 7
                    assert all(r['name'] == 'scope_owner' and r['roles'] == ['postgres'] and r['cmd'] == 'ALL'
                        and r['qual'] == r['with_check'] == 'true' for r in owners)
                    actual = [r for r in actual if r not in restrictive + owners]
                    uploads = [r for r in actual if r['schema'] + '.' + r['table'] in UPLOAD_TABLES]
                    assert len(uploads) == 2
                    assert all(r['name'] == 'upload_owner' and r['roles'] == ['postgres']
                        and r['cmd'] == 'ALL' and r['qual'] == r['with_check'] == 'true' for r in uploads)
                    actual = [r for r in actual if r not in uploads]
                    business = [r for r in actual if r['schema'] + '.' + r['table'] in BUSINESS_TABLES]
                    assert len(business) == 2
                    assert all(r['name'] == 'business_owner' and r['roles'] == ['postgres']
                        and r['cmd'] == 'ALL' and r['qual'] == r['with_check'] == 'true' for r in business)
                    actual = [r for r in actual if r not in business]
                    workflow = [r for r in actual if r['schema'] + '.' + r['table'] in WORKFLOW_TABLES]
                    assert len(workflow) == 1 and workflow[0]['name'] == 'workflow_owner'
                    assert workflow[0]['roles'] == ['postgres'] and workflow[0]['cmd'] == 'ALL'
                    assert workflow[0]['qual'] == workflow[0]['with_check'] == 'true'
                    actual = [r for r in actual if r not in workflow]
                    media_worker = [r for r in actual if r['schema'] + '.' + r['table'] in MEDIA_WORKER_TABLES]
                    assert {(r['table'], r['name']) for r in media_worker} == {
                        ('media_ai_settings', 'media_ai_owner'), ('media_worker_status', 'media_worker_status_owner')}
                    assert len(media_worker) == 2 and all(r['roles'] == ['postgres'] and r['cmd'] == 'ALL'
                        and r['qual'] == r['with_check'] == 'true' for r in media_worker)
                    actual = [r for r in actual if r not in media_worker]
                    website = [r for r in actual if r['schema'] + '.' + r['table'] in WEBSITE_TABLES]
                    assert len(website) == 3
                    owners = [r for r in website if r['name'] in ('website_owner', 'website_operator')]
                    assert len(owners) == 2 and all(r['roles'] == ['postgres'] and r['cmd'] == 'ALL'
                        and r['qual'] == r['with_check'] == 'true' for r in owners)
                    readers = [r for r in website if r['name'] == 'website_read']
                    assert len(readers) == 1 and readers[0]['table'] == 'website_asset_suggestions'
                    assert readers[0]['roles'] == ['hub_app'] and readers[0]['cmd'] == 'SELECT' and readers[0]['with_check'] is None
                    assert "hub.can('projects'" in readers[0]['qual'] and 'hub.can_read_asset(asset_id)' in readers[0]['qual']
                    actual = [r for r in actual if r not in website]
                    web = [r for r in actual if r['schema'] + '.' + r['table'] in WEB_TABLES]
                    assert len(web) == 3 and all(r['name'] == 'web_owner' and r['roles'] == ['postgres'] and r['qual'] == r['with_check'] == 'true' for r in web)
                    restrictive = [r for r in actual if r['name'] == 'web_snapshot_private']
                    assert len(restrictive) == 1 and restrictive[0]['table'] == 'entity_versions' and restrictive[0]['permissive'] == 'RESTRICTIVE'
                    assert restrictive[0]['qual'] == "(entity_type = 'project'::text)" and restrictive[0]['with_check'] == 'false'
                    actual = [r for r in actual if r not in web and r not in restrictive]
                    articles = [r for r in actual if r['schema'] + '.' + r['table'] in ARTICLE_TABLES]
                    assert len(articles) == 2 * len(ARTICLE_TABLES)
                    assert all(r['name'] in ('article_owner', 'article_read') for r in articles)
                    assert all(r['roles'] == ['postgres'] and r['qual'] == r['with_check'] == 'true' for r in articles if r['name'] == 'article_owner')
                    assert all(r['roles'] == ['hub_app'] and r['cmd'] == 'SELECT' and r['with_check'] is None and "hub.can('knowledge'::text, 'view'::text)" == r['qual'] for r in articles if r['name'] == 'article_read')
                    actual = [r for r in actual if r not in articles]
                    commercial = [r for r in actual if r['schema'] + '.' + r['table'] in COMMERCIAL_TABLES]
                    assert len(commercial) == 2 * len(COMMERCIAL_TABLES)
                    assert all(r['name'] in ('commercial_owner', 'commercial_read') for r in commercial)
                    assert all(r['roles'] == ['postgres'] and r['qual'] == r['with_check'] == 'true' for r in commercial if r['name'] == 'commercial_owner')
                    assert all(r['roles'] == ['hub_app'] and r['cmd'] == 'SELECT' and r['with_check'] is None and 'hub.can(' in r['qual'] for r in commercial if r['name'] == 'commercial_read')
                    actual = [r for r in actual if r not in commercial]
                    amenities = [r for r in actual if r['schema'] + '.' + r['table'] in AMENITY_TABLES]
                    assert len(amenities) == 2 * len(AMENITY_TABLES)
                    assert all(r['name'] in ('c4_owner', 'c4_read') for r in amenities)
                    assert all(r['roles'] == ['postgres'] and r['qual'] == r['with_check'] == 'true' for r in amenities if r['name'] == 'c4_owner')
                    assert all(r['roles'] == ['hub_app'] and r['cmd'] == 'SELECT' and r['with_check'] is None and "hub.can('projects'" in r['qual'] for r in amenities if r['name'] == 'c4_read')
                    actual = [r for r in actual if r not in amenities]
                    units = [r for r in actual if r['schema'] + '.' + r['table'] in UNIT_TABLES]
                    assert len(units) == 2 * len(UNIT_TABLES)
                    assert all(r['name'] in ('unit_owner', 'unit_read') for r in units)
                    assert all(r['roles'] == ['postgres'] and r['qual'] == r['with_check'] == 'true' for r in units if r['name'] == 'unit_owner')
                    assert all(r['roles'] == ['hub_app'] and r['cmd'] == 'SELECT' and r['with_check'] is None and 'hub.can(' in r['qual'] for r in units if r['name'] == 'unit_read')
                    actual = [r for r in actual if r not in units]
                    media = [r for r in actual if r['schema'] + '.' + r['table'] in MEDIA_TABLES]
                    assert len(media) == 2 * len(MEDIA_TABLES)
                    assert all(r['name'] in ('media_owner', 'media_read') for r in media)
                    assert all(r['roles'] == ['postgres'] and r['qual'] == r['with_check'] == 'true' for r in media if r['name'] == 'media_owner')
                    assert all(r['roles'] == ['hub_app'] and r['cmd'] == 'SELECT' and r['with_check'] is None and
                               any(token in r['qual'] for token in ('hub.can(', 'hub.can_read_asset(', 'hub.media_target('))
                               for r in media if r['name'] == 'media_read')
                    actual = [r for r in actual if r not in media]
                    faq_sources = [r for r in actual if r['name'] == 'faq_gap_sources']
                    assert len(faq_sources) == 1 and faq_sources[0]['table'] == 'content_gaps'
                    assert faq_sources[0]['permissive'] == 'RESTRICTIVE' and 'projects' in faq_sources[0]['qual'] and faq_sources[0]['with_check'] == 'false'
                    actual = [r for r in actual if r not in faq_sources]
                    project_content = [r for r in actual if r['schema'] + '.' + r['table'] in PROJECT_CONTENT_TABLES]
                    assert len(project_content) == 2 * len(PROJECT_CONTENT_TABLES)
                    assert all(r['name'] in ('content_owner', 'content_read') for r in project_content)
                    assert all(r['roles'] == ['postgres'] and r['qual'] == r['with_check'] == 'true'
                               for r in project_content if r['name'] == 'content_owner')
                    assert all(r['roles'] == ['hub_app'] and r['cmd'] == 'SELECT' and r['with_check'] is None
                               and ('hub.can(' in r['qual'] or 'hub.section_visible(' in r['qual'])
                               for r in project_content if r['name'] == 'content_read')
                    actual = [r for r in actual if r not in project_content]
                    intake = [r for r in actual if r['schema'] + '.' + r['table'] in FAQ_INTAKE_TABLES]
                    assert len(intake) == len(FAQ_INTAKE_TABLES) and all(r['name'] == 'intake_owner' and r['roles'] == ['postgres']
                        and r['qual'] == r['with_check'] == 'true' for r in intake)
                    actual = [r for r in actual if r not in intake]
                    account_ui = [r for r in actual if r['schema'] + '.' + r['table'] in ACCOUNT_UI_TABLES]
                    assert len(account_ui) == 2 and all(r['name'] in ('permission_notice_owner', 'avatar_owner') and r['roles'] == ['postgres']
                        and r['qual'] == r['with_check'] == 'true' for r in account_ui)
                    actual = [r for r in actual if r not in account_ui]
                    added = [r for r in actual if r['schema'] + '.' + r['table'] in FOUNDATION_TABLES]
                    assert len(added) == 4 and all(r['name'] == 'permission_owner' for r in added)
                    actual = [r for r in actual if r not in added]
                    content = [r for r in actual if r['name'] in ('content_owner', 'content_app_read', 'content_permission', 'content_snapshot_brands', 'content_snapshot_assets')]
                    assert len(content) == 54
                    assert all(r['schema'] + '.' + r['table'] in CONTENT_TABLES for r in content)
                    assert all(r['permissive'] == 'RESTRICTIVE' and 'hub.can' in r['qual']
                               for r in content if r['name'] in ('content_permission', 'content_snapshot_brands'))
                    actual = [r for r in actual if r not in content]
                    publication = [r for r in actual if r['name'] in ('publication_owner', 'publication_app_read',
                        'publication_permission', 'publication_member_permission', 'publication_preview_projection')]
                    assert len(publication) == 65
                    assert all(r['schema'] + '.' + r['table'] in PUBLICATION_TABLES for r in publication)
                    assert all(r['permissive'] == 'RESTRICTIVE' and 'hub.can' in r['qual']
                               for r in publication if r['name'] in ('publication_permission', 'publication_member_permission'))
                    actual = [r for r in actual if r not in publication]
                    registry = [r for r in actual if r['name'] in ('registry_owner', 'registry_permission', 'registry_app_read')]
                    assert len(registry) == 22
                    assert all(r['schema'] + '.' + r['table'] in REGISTRY_TABLES for r in registry)
                    assert all(r['permissive'] == 'RESTRICTIVE' and r['with_check'] == 'false'
                               for r in registry if r['name'] == 'registry_permission')
                    actual = [r for r in actual if r not in registry]
                    operations = [r for r in actual if r['name'] in ('operations_owner', 'operations_permission')]
                    assert len(operations) == 2 * len(OPERATIONS_TABLES) == 90
                    assert all(r['schema'] + '.' + r['table'] in OPERATIONS_TABLES for r in operations)
                    assert all(r['permissive'] == 'RESTRICTIVE' and 'hub.can' in r['qual'] and r['with_check'] == 'false'
                               for r in operations if r['name'] == 'operations_permission')
                    actual = [r for r in actual if r not in operations]
                    assistant = [r for r in actual if r['name'] in ASSISTANT_POLICIES]
                    assert len(assistant) == 6
                    assert all(r['schema'] + '.' + r['table'] in ASSISTANT_TABLES and r['cmd'] == 'SELECT'
                               and 'hub.permission_actor()' in r['qual'] and 'current_setting' not in r['qual']
                               and set(r['roles']) == {'hub_app', 'admin', 'editor', 'publisher', 'viewer', 'online_staff'} for r in assistant)
                    owners = [r for r in actual if r['name'] in ('assistant_technical_owner', 'shared_owner')]
                    assert len(owners) == len(ASSISTANT_TABLES | SHARED_TABLES) == 22
                    assert all(r['qual'] == r['with_check'] == 'true' and r['roles'] == ['postgres'] for r in owners)
                    clock = [r for r in actual if r['name'] == 'actuals_audit_clock']
                    assert len(clock) == 1 and clock[0]['roles'] == ['ads_actuals_writer'] and clock[0]['cmd'] == 'SELECT'
                    actual = [r for r in actual if r not in assistant + owners + clock]
                expected = BASELINE[name]
                if name == 'policies':
                    expected = [r for r in expected if r['name'] not in REGISTRY_REPLACED_POLICIES | ASSISTANT_POLICIES]
                if name == 'functions':
                    public_files = [r for r in actual if r['name'] == 'public_api.asset_file' and r['arguments'] == 'public_id text']
                    assert len(public_files) == 1
                    assert public_files[0]['security_definer'] and public_files[0]['execute_roles'] == ['service_consumer']
                    assert public_files[0]['config'] == ['search_path=pg_catalog, pg_temp']
                    actual = [r for r in actual if r not in public_files]
                    expected = [{**r, 'security_definer': True} if r['name'] == 'ads.finance_invariant' else r for r in expected]
                    expected = [{**r, 'execute_roles': []} if r['name'] == 'public_api.asset_file' else r for r in expected]
                    expected = [{**r, 'execute_roles': []} if r['name'] in TECHNICAL_ONLY_FUNCTIONS else r for r in expected]
                    expected = [{**r, 'execute_roles': ['admin', 'editor', 'online_staff', 'publisher', 'viewer']}
                                if r['name'] in ('internal.assistant_proposal_create', 'internal.assistant_proposal_read', 'internal.assistant_proposal_apply') else r for r in expected]
                if name == 'relations':
                    expected = [{**r, 'grants': [g for g in r['grants'] if g != 'service_consumer:SELECT']}
                                if r['name'] in PRIVATE_PUBLIC_VIEWS else r for r in expected]
                    expected = [{**r, 'rls': True, 'force_rls': True} if r['name'] in CONTENT_TABLES | PUBLICATION_TABLES | SHARED_TABLES else r for r in expected]
                    expected = [{**r, 'grants': [g for g in r['grants'] if g not in ('admin:INSERT', 'admin:UPDATE')]}
                                if r['name'] in ('ads.vocab', 'ads.scope_code', 'ads.scope_member') else r for r in expected]
                assert actual == expected, name
            assert sum(f['security_definer'] for f in BASELINE['functions']) == 134
        finally:
            await db.close()
    asyncio.run(check())


@pytest.mark.parametrize('persona', tuple(ALL_DEMO_ACTORS))
def test_direct_relation_grants_under_disposable_legacy_probe(persona):
    async def check():
        db = await runtime(probe=True)
        role = 'agency' if persona in DEMO_AGENCIES else persona
        try:
            for relation in BASELINE['relations']:
                assert re.fullmatch(r'[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*', relation['name'])
                transaction = db.transaction()
                await transaction.start()
                try:
                    await db.execute(f'SET LOCAL ROLE {role}')
                    await db.execute("select set_config('app.actor_id',$1,true),set_config('app.agency_code',$2,true)", str(ALL_DEMO_ACTORS[persona]), DEMO_AGENCIES.get(persona, ''))
                    statement = f"select * from {relation['name']} limit 0"
                    usage = next(s['usage_roles'] for s in BASELINE['schemas'] if s['name'] == relation['name'].split('.')[0])
                    if (role + ':SELECT' in relation['grants'] and role in usage
                            and not (role == 'service_consumer' and relation['name'] in PRIVATE_PUBLIC_VIEWS)):
                        await db.execute(statement)
                    else:
                        with pytest.raises(asyncpg.InsufficientPrivilegeError):
                            await db.execute(statement)
                finally:
                    await transaction.rollback()
        finally:
            await db.close()
    asyncio.run(check())


READ_ENTRIES = [
    ('projects', "select hub.project_detail((select public_project_id from hub.projects where rem_project_id='DEMO-001'))", {'admin', 'editor', 'publisher', 'viewer'}),
    ('brands', 'select hub.list_brands()', {'admin', 'editor', 'publisher', 'viewer'}),
    ('promotions', "select hub.promotion_read(null,'{}'::jsonb)", {'admin', 'editor', 'publisher', 'viewer'}),
    ('releases', 'select hub.release_read(null)', {'admin', 'editor', 'publisher', 'viewer'}),
    ('knowledge', 'select * from hub.knowledge_candidate_rows()', {'admin', 'editor', 'publisher', 'viewer'}),
    ('registry', 'select ads.registry_settings()', {'admin', 'online_staff', 'agency'}),
    ('finance', "select ads.finance_read('memos',null,'{}'::jsonb)", {'admin', 'online_staff'}),
    ('actuals', "select ads.actuals_read('actuals',null,'{}'::jsonb)", {'admin', 'online_staff'}),
    ('documents', "select ads.actuals_read('document-tracking',null,'{}'::jsonb)", {'admin', 'online_staff'}),
    ('exceptions', "select ads.actuals_read('findings',null,'{}'::jsonb)", {'admin', 'online_staff'}),
    ('archive', "select ads.archive_read(null,'{}'::jsonb)", {'admin', 'online_staff'}),
]


@pytest.mark.parametrize('persona', tuple(ALL_DEMO_ACTORS))
def test_security_definer_read_entry_ceilings_and_positive_neighbours(persona):
    async def check():
        db = await runtime(probe=True)
        role = 'agency' if persona in DEMO_AGENCIES else persona
        try:
            for tab, sql, allowed in READ_ENTRIES:
                transaction = db.transaction()
                await transaction.start()
                try:
                    await db.execute(f'SET LOCAL ROLE {role}')
                    await db.execute("select set_config('app.actor_id',$1,true),set_config('app.agency_code',$2,true)", str(ALL_DEMO_ACTORS[persona]), DEMO_AGENCIES.get(persona, ''))
                    if role in allowed:
                        await db.execute(sql)
                    else:
                        with pytest.raises(asyncpg.InsufficientPrivilegeError):
                            await db.execute(sql)
                finally:
                    await transaction.rollback()
        finally:
            await db.close()
    asyncio.run(check())


async def assert_reviewed_database_boundary(db):
    """Read-only live coverage assertion, also exercised by mutation probes."""
    rows = await db.fetch(RELATIONS_SQL, SCHEMAS, ['hub_app'])
    tables = {r['name']: r for r in rows if r['kind'] in ('r', 'p')}
    classified = (FOUNDATION_TABLES | ACCOUNT_UI_TABLES | CONTENT_TABLES | PUBLICATION_TABLES | REGISTRY_TABLES |
                  OPERATIONS_TABLES | ASSISTANT_TABLES | SHARED_TABLES | TECHNICAL_TABLES | PROJECT_CONTENT_TABLES | MEDIA_TABLES | UNIT_TABLES | FAQ_INTAKE_TABLES | COMMERCIAL_TABLES | AMENITY_TABLES | ARTICLE_TABLES | WEB_TABLES)
    classified |= WEBSITE_TABLES | MEDIA_WORKER_TABLES | WORKFLOW_TABLES
    classified |= BUSINESS_TABLES | SCOPE_TABLES | WRITING_TABLES | UPLOAD_TABLES | EVENT_TABLES
    assert set(tables) == classified, {'unclassified': set(tables) - classified, 'missing': classified - set(tables)}
    assert all(r['rls'] and r['force_rls'] for r in tables.values())
    policies = await db.fetch(POLICIES_SQL, SCHEMAS)
    # Technical relations have no permissive policy or application grants.
    # The source-offer object policy is restrictive only and cannot grant access.
    policy_tables = {r['schema'] + '.' + r['table'] for r in policies}
    assert set(tables) - policy_tables == TECHNICAL_TABLES - {'staging.source_offers'}
    technical_policies = [r for r in policies if r['schema'] + '.' + r['table'] in TECHNICAL_TABLES]
    assert [(r['schema'] + '.' + r['table'], r['name'], r['permissive']) for r in technical_policies] == [
        ('staging.source_offers', 'content_object_scope', 'RESTRICTIVE')]
    # Domain tables need an actual permission predicate, not just RLS on.
    domain = CONTENT_TABLES | PUBLICATION_TABLES | REGISTRY_TABLES | OPERATIONS_TABLES | PROJECT_CONTENT_TABLES | MEDIA_TABLES | UNIT_TABLES | COMMERCIAL_TABLES | AMENITY_TABLES | ARTICLE_TABLES
    domain |= {'hub.website_asset_suggestions'}
    assert tables['hub.website_asset_suggestions']['grants'] == ['hub_app:SELECT']
    assert tables['staging.website_content_receipts']['grants'] == []
    assert all(tables[name]['grants'] == [] for name in MEDIA_WORKER_TABLES)
    assert all(not tables[name]["grants"] for name in WEB_TABLES), "Website storage is accessible only through guarded commands"
    assert all(not tables[name]['grants'] for name in WORKFLOW_TABLES), 'Content review versions have no application table grants'
    assert all(not tables[name]['grants'] for name in BUSINESS_TABLES), 'Business catalog uses guarded commands only'
    assert all(not tables[name]['grants'] for name in SCOPE_TABLES), 'Content scopes and membership are owner-only storage'
    assert all(not tables[name]['grants'] for name in WRITING_TABLES), 'Writing state is accessible only through exact guarded commands'

    assert all(not tables[name]['grants'] for name in UPLOAD_TABLES), 'Upload provenance and file evidence are owner-only storage'
    assert all(not tables[name]['grants'] for name in EVENT_TABLES), 'Event Hub tables are owner-only storage'
    guarded = {r['schema'] + '.' + r['table'] for r in policies if any(
        token in (r['qual'] or '') for token in ('hub.can(', 'hub.can_read_asset(', 'hub.require_registry(', 'hub.registry_agency(', 'hub.section_visible(', 'hub.media_target('))}
    # Registry children inherit the parent's RLS through EXISTS; the
    # issuance counter is entirely denied to application roles.
    for table, parent in {'scope_member': 'ads.scope_code', 'campaign_name': 'ads.campaign_registration',
                          'native_binding': 'ads.campaign_registration', 'code_sequence': None}.items():
        policy = next(r for r in policies if r['schema'] == 'ads' and r['table'] == table
                      and r['name'] == 'registry_permission')
        assert policy['permissive'] == 'RESTRICTIVE' and policy['with_check'] == 'false'
        assert ('EXISTS' in policy['qual'] and parent in policy['qual']) if parent else policy['qual'] == 'false'
        guarded.add('ads.' + table)
    assert domain <= guarded, domain - guarded
    assert all(not r['grants'] for name, r in tables.items()
               if name in FOUNDATION_TABLES | ACCOUNT_UI_TABLES | ASSISTANT_TABLES | SHARED_TABLES | TECHNICAL_TABLES | FAQ_INTAKE_TABLES)


def test_every_base_relation_has_a_reviewed_force_rls_boundary():
    async def check():
        db = await runtime()
        try:
            await assert_reviewed_database_boundary(db)
        finally:
            await db.close()
    asyncio.run(check())


def test_workflow_function_inventory_has_only_nine_runtime_entry_points():
    async def check():
        db = await runtime()
        try:
            rows = [dict(row) for row in await db.fetch(FUNCTIONS_SQL, ['hub'], ROLES + ['hub_app'])
                    if row['name'] in WORKFLOW_FUNCTIONS]
            assert len(rows) == len(WORKFLOW_FUNCTIONS)
            assert {row['name'] for row in rows} == WORKFLOW_FUNCTIONS
            for row in rows:
                assert row['config'] == ['search_path=pg_catalog, pg_temp'], row['name']
                assert row['execute_roles'] == (['hub_app'] if row['name'] in WORKFLOW_APP_FUNCTIONS else []), row['name']
                if row['name'] in WORKFLOW_APP_FUNCTIONS:
                    assert row['security_definer'], row['name']
        finally:
            await db.close()
    asyncio.run(check())


def test_multi_tier_promotion_helpers_have_no_runtime_execute_grants():
    from test_permission_baseline import disposable_operator
    signatures = (
        'hub.promotion_benefit_items_valid(jsonb)', 'hub.promotion_benefit_sync()',
        'hub.promotion_scope_projects(jsonb)', 'hub.validate_promotion_scope(jsonb)',
        'hub.promotion_require_scope(jsonb,text)',
        'hub.promotion_require_project_ids(text[],text)', 'hub.promotion_frozen_scope_guard()',
        'hub.promotion_filter_matches(hub.public_promotions,jsonb)',
        'internal.assistant_scoped_promotion_source(text,text,text,text)',
    )

    async def check():
        db = await disposable_operator()
        try:
            for signature in signatures:
                function = await db.fetchrow(
                    "select p.oid,p.proconfig from pg_proc p where p.oid=$1::regprocedure", signature)
                assert function is not None, signature
                assert function['proconfig'] == ['search_path=pg_catalog, pg_temp'], signature
                for role in ROLES + ['hub_app']:
                    assert not await db.fetchval(
                        "select has_function_privilege($1,$2::oid,'execute')", role, function['oid']), (signature, role)
                assert not await db.fetchval(
                    "select exists(select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a "
                    "where p.oid=$1 and a.grantee=0 and a.privilege_type='EXECUTE')", function['oid']), signature
        finally:
            await db.close()
    asyncio.run(check())
