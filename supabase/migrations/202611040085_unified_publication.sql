-- W4 N2/N6: one queue over the two existing publication histories. No old
-- snapshot, approval, account, grant or template is rewritten.
begin;

-- Capture the existing finite private draft-reader graph before changing
-- public composition. Only workspace_preview reaches these closed helpers;
-- its original View/object checks and read-only/no-gap-write call remain.
do $$ declare signature text;name text;old_name text;definition text;names text[]:=array[
 'web_source_available','web_resolve','web_output','web_sections','web_scope_faq','web_faqs','web_project','web_compose'];begin
 foreach signature in array array['web_source_available(jsonb)','web_resolve(jsonb,text,boolean,boolean)','web_output(jsonb,text,boolean)',
  'web_sections(text,text)','web_scope_faq(text,text)','web_faqs(uuid)','web_project(uuid)','web_compose(hub.web_pages)'] loop
  name:=split_part(signature,'(',1);definition:=pg_get_functiondef(('hub.'||signature)::regprocedure);
  definition:=hub.content_definition_replace(definition,'FUNCTION hub.'||name||'(','FUNCTION hub.content_preview_'||substr(name,5)||'(');
  foreach old_name in array names loop
   if strpos(definition,'hub.'||old_name||'(')>0 then definition:=hub.content_definition_replace(definition,
    'hub.'||old_name||'(','hub.content_preview_'||substr(old_name,5)||'(');end if;
  end loop;execute definition;
  execute 'revoke all on function hub.content_preview_'||substr(signature,5)||' from public,hub_app';
 end loop;
 definition:=pg_get_functiondef('hub.workspace_preview(text,text,text,text)'::regprocedure);
 definition:=hub.content_definition_replace(definition,'hub.web_compose(page)','hub.content_preview_compose(page)');
 definition:=hub.content_definition_replace(definition,'hub.web_output(snapshot,locale,false)','hub.content_preview_output(snapshot,locale,false)');execute definition;
end $$;

alter table hub.account_permission drop constraint web_publish_requires_approval;
alter table hub.account_permission add constraint web_publish_requires_view
 check(not 'knowledge.publish_web'=any(special_actions) or tab='knowledge' and can_view);
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.normalise_permission_tabs(jsonb)'::regprocedure);
 if strpos(d,'levels ? ''knowledge.publish_web'' and not levels ? ''approve''')=0 then raise exception 'Missing publication special prerequisite';end if;
 d:=hub.content_definition_replace(d,'levels ? ''knowledge.publish_web'' and not levels ? ''approve''','levels ? ''knowledge.publish_web'' and not levels ? ''view''');execute d;
end $$;

alter table hub.web_publications add column outcomes jsonb not null default '[]' check(jsonb_typeof(outcomes)='array');
alter table hub.web_publications drop constraint web_publications_state_check;
alter table hub.web_publications add constraint web_publications_state_check check(state in ('IN_REVIEW','PUBLISHED','PARTIAL','RETURNED'));
create or replace function hub.web_publication_guard() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if tg_op='DELETE' or (to_jsonb(new)-array['state','published_by','published_at','outcomes']) is distinct from (to_jsonb(old)-array['state','published_by','published_at','outcomes'])
  or old.state<>'IN_REVIEW' then raise exception 'Prepared publication is immutable' using errcode='23514';end if;return new;
end $$;

create function hub.publication_actor() returns uuid language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('knowledge','view');return hub.require_special('knowledge','knowledge.publish_web');
end $$;
create function hub.publication_source_kind(table_name text) returns text language sql immutable set search_path=pg_catalog,pg_temp as $$
 select case table_name
 when 'projects' then 'project' when 'model_types' then 'model' when 'brands' then 'brand'
 when 'project_selling_points' then 'selling_point' when 'contacts' then 'contact' when 'project_facts' then 'fact'
 when 'project_buildings' then 'building' when 'project_facilities' then 'facility' when 'project_features' then 'feature' when 'project_places' then 'place'
 when 'assets' then 'asset' when 'entity_assets' then 'project_asset' when 'brand_assets' then 'brand_asset'
 when 'commercial_type_assets' then 'type_asset' when 'asset_links' then 'asset_context' when 'media_links' then 'media_link' when 'media_link_targets' then 'media_target'
 when 'solar_estimates' then 'solar' when 'faq_questions' then 'question' when 'translation_glossary' then 'glossary'
 when 'web_pages' then 'page_config'
 end
$$;

-- Certificates identify the actual existing review version. Container rows
-- never substitute for their version dependency. Registry rows are explicit
-- non-content dependencies; they remain hashed and permission checked.
create function hub.publication_certificate(table_name text,identity jsonb,value jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
<<certificate_values>>
declare kind text:=hub.publication_source_kind(table_name);version jsonb;canonical jsonb;begin
 if table_name in ('field_catalog','feature_catalog','facility_taxonomy','content_translations') then return jsonb_build_object('registry',true);end if;
 if table_name in ('faqs','content_sections','articles','commercial_types','project_prices','project_disclosures','project_sales_terms','project_programmes','project_progress','article_links') then
  return jsonb_build_object('container',true);
 end if;
 if table_name in ('faq_versions','content_section_versions','article_versions','commercial_type_versions','project_price_versions','project_commercial_versions') then
  version:=value;if value->>'staged_invalidated_at' is not null then return null;end if;
  if table_name='project_commercial_versions' and value->>'kind'='disclosures' and
   (coalesce(value->'staged_evidence','{}')-'_disclosure_sources') is distinct from (hub.content_workflow_staged_values('disclosure',(value->'payload')||jsonb_build_object('project_id',value->'project_id','_disclosure_sources',value#>'{staged_evidence,_disclosure_sources}'))-'_disclosure_sources') then return null;end if;
 elsif table_name='faq_questions' then
  if value->>'status'<>'approved' then return null;end if;version:=value||jsonb_build_object('state','APPROVED','id',value->>'question_key','version_no',value->'revision');
 elsif table_name='project_selling_points' then version:=value||jsonb_build_object('editors',to_jsonb(hub.content_workflow_authors('selling_point',hub.content_workflow_identity('selling_point',value),value)));
 elsif kind is not null then
  value:=value||jsonb_build_object('_staged_values',hub.content_workflow_staged_values(kind,value));
  canonical:=hub.content_workflow_identity(kind,value);
  select to_jsonb(v) into version from hub.content_review_versions v where v.kind=certificate_values.kind and v.identity=canonical and v.state='APPROVED' and staged_invalidated_at is null
   and v.source_hash=hub.web_hash(hub.content_workflow_payload(certificate_values.kind,value)) order by version_no desc limit 1;
 else raise exception 'Unclassified publication source: %',table_name using errcode='23514';end if;
 if version is null or upper(coalesce(version->>'state','')) not in ('APPROVED','PUBLISHED') or version->>'approved_by' is null then return null;end if;
 return jsonb_build_object('kind',kind,'version_table',case when kind is not null and table_name not in ('faq_questions','project_selling_points') then 'content_review_versions' else table_name end,
  'version_id',version->'id','version_no',coalesce(version->'version_no',version->'revision'),'approved_by',version->'approved_by',
  'approved_at',version->'approved_at','self_approval',coalesce(version->'self_approval','false'),'editors',coalesce(version->'editors','[]'));
end $$;

do $$ declare d text;begin
 d:=pg_get_functiondef('hub.web_source(text,jsonb)'::regprocedure);
 d:=hub.content_definition_replace(d,'''projects'',''brands'',''assets''','''projects'',''model_types'',''web_pages'',''brands'',''assets''');execute d;
 -- Lifecycle metadata is not authored content and cannot stale its own batch.
 d:=pg_get_functiondef('hub.web_source_content(jsonb)'::regprocedure);
 d:=hub.content_definition_replace(d,'''approved_by'',''approved_at''','''approved_by'',''approved_at'',''decision_reason'',''self_approval'',''review_state'',''last_output_hashes''');execute d;
 d:=pg_get_functiondef('hub.web_dependency(text,jsonb,text)'::regprocedure);
 d:=hub.content_definition_replace(d,'''editors'',authors);','''editors'',authors,''approval'',hub.publication_certificate(table_name,identity,value));');
 if strpos(d,'hub.publication_certificate')=0 then raise exception 'Missing dependency envelope';end if;execute d;
end $$;

-- W3 accepts its legacy approval marker. New W4 publications instead carry
-- the actual approved page-config certificate; a publisher marker alone is
-- never grouping evidence. Preserve exact revision, membership, ambiguity,
-- same-brand and every existing source-View check in the original function.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('hub.workspace_confirmed_groups()'::regprocedure);
 definition:=hub.content_definition_replace(definition,
  'v.payload#>>''{_publication,approved_by}'' is not null',
  $replacement$(v.payload#>>'{_publication,approved_by}' is not null or exists(
   select 1 from jsonb_array_elements(coalesce(v.payload->'_page_dependencies','[]')) d
   join hub.content_review_versions approved on approved.id::text=d#>>'{approval,version_id}'
   where d->>'table'='web_pages' and d->'identity'=jsonb_build_object('id',p.id)
    and approved.kind='page_config' and approved.identity=jsonb_build_object('id',p.id)
    and approved.state='APPROVED' and approved.approved_by is not null and approved.staged_invalidated_at is null
    and approved.payload->>'revision'=p.revision::text
    and approved.source_hash=hub.web_hash(hub.content_workflow_payload('page_config',to_jsonb(p)||jsonb_build_object('_staged_values','{}'::jsonb)))
    and d->'approval'=jsonb_build_object('kind','page_config','version_table','content_review_versions',
     'version_id',approved.id,'version_no',approved.version_no,'approved_by',approved.approved_by,
     'approved_at',approved.approved_at,'self_approval',approved.self_approval,'editors',approved.editors)
    and d->>'hash'=hub.web_hash(hub.web_source_content(to_jsonb(p)))))$replacement$);
 execute definition;
end $$;

create or replace function hub.web_dependency(table_name text,identity jsonb,tab text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare value jsonb;authors jsonb;certificate jsonb;kind text:=hub.publication_source_kind(table_name);begin
 value:=hub.web_source(table_name,identity);
 if value is null then raise exception 'Website source disappeared' using errcode='40001';end if;
 certificate:=hub.publication_certificate(table_name,identity,value);
 if certificate ? 'editors' then authors:=certificate->'editors';
 elsif kind is not null then authors:=to_jsonb(hub.content_workflow_authors(kind,hub.content_workflow_identity(kind,value),value));
 elsif coalesce((certificate->>'container')::boolean,false) then authors:='[]';
 else authors:=coalesce(value->'editors','[]');end if;
 -- Frozen versions retain their exact English reviewers. Current translation
 -- records are independent dependencies and include their own reviewer.
 authors:=authors||coalesce((select jsonb_agg(distinct x) from jsonb_path_query(value,'$.translations.**.reviewed_by') x where x<>'null'::jsonb),'[]');
 if table_name='content_translations' and value->>'reviewed_by' is not null then authors:=authors||jsonb_build_array(value->'reviewed_by');end if;
 if table_name='faq_questions' and value->>'version_author' is not null then authors:=authors||jsonb_build_array(value->'version_author');end if;
 return jsonb_build_object('table',table_name,'identity',identity,'tab',tab,'hash',hub.web_hash(hub.web_source_content(value)),'editors',authors,'approval',certificate);
end $$;

-- A current translation/container reviewer is not contributor evidence for an older
-- included item. The only exception to the current-reviewer denial requires
-- that exact dependency in an immutable, already-published item, plus verified
-- still-approved version certificates and all its frozen contributors. Missing
-- or legacy evidence fails closed. This cannot admit a new/unreviewed revision.
create function hub.publication_retained_reviewer_evidence(dependency jsonb,actor uuid) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare item jsonb;d jsonb;certificate jsonb;version jsonb;has_approval boolean;verified boolean;begin
 if dependency->>'table' not in ('content_translations','faqs','content_sections','articles') then return false;end if;
 for item in
  select n from hub.entity_versions v cross join lateral hub.web_nodes(v.payload) n
   where v.entity_type='web_page' and n ? 'dependencies' and exists(select 1 from jsonb_array_elements(n->'dependencies') x where x=dependency)
  union all select jsonb_build_object('dependencies',v.review_evidence->'dependencies') from hub.entity_versions v
   where v.entity_type='project' and exists(select 1 from jsonb_array_elements(coalesce(v.review_evidence->'dependencies','[]')) x where x=dependency)
  union all select jsonb_build_object('dependencies',v.review_evidence->'dependencies') from hub.brand_versions v
   where exists(select 1 from jsonb_array_elements(coalesce(v.review_evidence->'dependencies','[]')) x where x=dependency)
 loop
  has_approval:=false;verified:=true;
  for d in select * from jsonb_array_elements(item->'dependencies') loop
   begin
    perform hub.publication_dependency_check(d,false,false);
    certificate:=d->'approval';
    if d->'editors'?actor::text or certificate->'editors'?actor::text or certificate->>'approved_by'=actor::text then verified:=false;exit;end if;
    if not certificate ? 'registry' and not certificate ? 'container' then
     if certificate->>'version_table'='content_review_versions' then
      select to_jsonb(v) into version from hub.content_review_versions v where id=(certificate->>'version_id')::uuid;
     elsif d->>'table'='faq_questions' then
      select payload into version from hub.faq_question_versions where question_key=d#>>'{identity,question_key}' and revision=(certificate->>'version_no')::integer;
     else version:=hub.web_source(d->>'table',d->'identity');end if;
     if d->>'table'='project_selling_points' then
      version:=version||jsonb_build_object('editors',to_jsonb(hub.content_workflow_authors('selling_point',hub.content_workflow_identity('selling_point',version),version)));
     end if;
     if version is null or coalesce(version->'editors','[]') is distinct from certificate->'editors'
      or version->>'approved_by' is distinct from certificate->>'approved_by'
      or version->>'reviewed_by'=actor::text or d->>'table'='faq_questions' and version->>'version_author'=actor::text
      or exists(select 1 from jsonb_path_query(version,'$.translations.**.reviewed_by') reviewer where reviewer=to_jsonb(actor::text)) then verified:=false;exit;end if;
     has_approval:=true;
    end if;
   exception when insufficient_privilege or no_data_found or check_violation or serialization_failure then verified:=false;exit;end;
  end loop;
  if verified and has_approval then return true;end if;
 end loop;return false;
end $$;

create function hub.publication_dependency_check(dependency jsonb,independent boolean default true,unchanged boolean default true) returns void
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid:=hub.require_permission(dependency->>'tab','view');source jsonb;certificate jsonb:=dependency->'approval';current_certificate jsonb;
 retained boolean:=false;available boolean;pinned jsonb;begin
 source:=hub.web_source(dependency->>'table',dependency->'identity');
 retained:=not unchanged and hub.publication_retained_media_source(dependency);
 available:=hub.web_source_available(dependency);
 if not coalesce(available,false) and retained and dependency->>'table' in ('entity_assets','brand_assets','commercial_type_assets','asset_links') then
  -- Replacing a draft binding soft-deletes it; the approved historical binding
  -- remains usable only if that tombstone is its sole material change.
  pinned:=hub.publication_pinned_source(dependency);
  available:=source->>'deleted_at' is not null and pinned is not null
   and hub.content_workflow_payload(hub.publication_source_kind(dependency->>'table'),source||'{"_staged_values":{}}')-'deleted_at'
    =hub.content_workflow_payload(hub.publication_source_kind(dependency->>'table'),pinned)-'deleted_at'
   and coalesce(source->>'ai_exposure','open')<>'internal'
   and (source->>'effective_from' is null or (source->>'effective_from')::timestamptz<=now())
   and (source->>'effective_to' is null or (source->>'effective_to')::timestamptz>now());
 end if;
 if source is null or not coalesce(available,false) then raise exception 'Source is withdrawn, expired or unavailable' using errcode='23514';end if;
 if dependency->>'table'='assets' and not retained then perform hub.require_asset_access((source->>'id')::uuid);end if;
 if unchanged and dependency->>'hash' is distinct from hub.web_hash(hub.web_source_content(source)) then raise exception 'Source revision changed' using errcode='40001';end if;
 if certificate is null or certificate='null'::jsonb then raise exception 'Manager-approved revision required' using errcode='23514';end if;
 if unchanged and not coalesce((certificate->>'container')::boolean,false) and not coalesce((certificate->>'registry')::boolean,false) then
  current_certificate:=hub.publication_certificate(dependency->>'table',dependency->'identity',source);
  if current_certificate is null or current_certificate->'version_id' is distinct from certificate->'version_id' then raise exception 'Approved source values changed; re-approval is required' using errcode='40001';end if;
 end if;
 if not coalesce((certificate->>'registry')::boolean,false) and not coalesce((certificate->>'container')::boolean,false) then
  if certificate->>'version_table'='content_review_versions' then
   select to_jsonb(v) into current_certificate from hub.content_review_versions v where id=(certificate->>'version_id')::uuid and state='APPROVED';
  elsif dependency->>'table'='faq_questions' then
   -- An old approved question revision remains evidence for an immutable page.
   select payload into current_certificate from hub.faq_question_versions where question_key=dependency#>>'{identity,question_key}' and revision=(certificate->>'version_no')::integer;
  else current_certificate:=source;
  end if;
  if current_certificate is null or upper(coalesce(current_certificate->>'state',case when current_certificate->>'status'='approved' then 'APPROVED' end,'')) not in ('APPROVED','PUBLISHED')
   or current_certificate->>'approved_by' is distinct from certificate->>'approved_by' then raise exception 'Approval is unavailable' using errcode='23514';end if;
  if independent and certificate->>'approved_by'=actor::text then raise exception 'The approver cannot publish this version' using errcode='42501';end if;
 end if;
 if independent then
  if dependency->'editors' ? actor::text or certificate->'editors' ? actor::text then
   raise exception 'An editor or English reviewer cannot publish this version' using errcode='42501';end if;
  if source->>'reviewed_by'=actor::text then
   if unchanged then raise exception 'The current English reviewer cannot publish this version' using errcode='42501';end if;
   if not hub.publication_retained_reviewer_evidence(dependency,actor) then
    raise exception 'Exact retained-version contributor evidence is required' using errcode='42501';end if;
  end if;
 end if;
end $$;
create or replace function hub.web_assert_sources(value jsonb,level text,independent boolean default false) returns void
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare d jsonb;actor uuid:=hub.require_permission('knowledge','view');begin
 for d in select * from hub.web_dependencies(value) loop
  perform hub.require_permission(d->>'tab','view');
  if independent then perform hub.publication_dependency_check(d,true,false);end if;
 end loop;
 if independent and exists(select 1 from hub.web_nodes(value) n where n->'_editors' ? actor::text or n->>'reviewed_by'=actor::text) then
  raise exception 'Page editors cannot publish their own version' using errcode='42501';end if;
end $$;

-- Read-time eligibility explicitly requires an existing APPROVED version for
-- mutable commercial parents. Draft rows never constitute that approval. New
-- publication separately requires the exact frozen certificate below.
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.web_source_available(jsonb)'::regprocedure);
 d:=hub.content_definition_replace(d,'FUNCTION hub.web_source_available(','FUNCTION hub.web_source_available_before_workflow(');execute d;
end $$;
create function hub.publication_pinned_source(dependency jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
<<pinned_values>>
declare certificate jsonb:=dependency->'approval';version jsonb;kind text:=hub.publication_source_kind(dependency->>'table');begin
 if certificate is null or certificate='null'::jsonb or certificate ? 'registry' or certificate ? 'container' then return null;end if;
 if certificate->>'version_table'='content_review_versions' then
  select to_jsonb(v) into version from hub.content_review_versions v where id=(certificate->>'version_id')::uuid and v.kind=pinned_values.kind;
  if version->>'staged_invalidated_at' is not null or version#>'{payload,_staged_values}' is distinct from
   hub.content_workflow_staged_values(kind,version->'payload') then return null;end if;
 elsif dependency->>'table'='faq_questions' then
  select payload into version from hub.faq_question_versions where question_key=dependency#>>'{identity,question_key}' and revision=(certificate->>'version_no')::integer;
 else version:=hub.web_source(dependency->>'table',dependency->'identity');end if;
 if version is null or upper(coalesce(version->>'state',case when version->>'status'='approved' then 'APPROVED' end,'')) not in ('APPROVED','PUBLISHED')
  or version->>'approved_by' is distinct from certificate->>'approved_by' then return null;end if;
 return case when certificate->>'version_table'='content_review_versions' then version->'payload' else version end;
end $$;
-- Current draft bindings do not authorize historical assets. Exact immutable
-- publication evidence plus the existing caller-scoped history projection does.
-- This private predicate grants no file access and admits no new publication.
create function hub.publication_retained_media_source(dependency jsonb) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 if dependency->>'table' not in ('assets','entity_assets','brand_assets','commercial_type_assets','asset_links')
  or hub.publication_pinned_source(dependency) is null then return false;end if;
 return exists(
  select 1 from hub.entity_versions v where
   (exists(select 1 from jsonb_array_elements(coalesce(v.review_evidence->'dependencies','[]')) d where d=dependency)
    or exists(select 1 from hub.web_dependencies(v.payload) d where d=dependency))
   and exists(select 1 from hub.workspace_history_contexts('hub.entity_versions',to_jsonb(v)))
  union all
  select 1 from hub.brand_versions v where
   exists(select 1 from jsonb_array_elements(coalesce(v.review_evidence->'dependencies','[]')) d where d=dependency)
   and exists(select 1 from hub.workspace_history_contexts('hub.brand_versions',to_jsonb(v)))
  union all
  select 1 from hub.promotion_versions v where
   exists(select 1 from jsonb_array_elements(coalesce(v.review_evidence->'dependencies','[]')) d where d=dependency)
   and exists(select 1 from hub.workspace_history_contexts('hub.promotion_versions',to_jsonb(v))));
 exception when insufficient_privilege or no_data_found then return false;
end $$;
create or replace function hub.web_source_available(dependency jsonb) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare kind text:=dependency->>'table';source jsonb;version jsonb;pinned jsonb;certificate jsonb:=dependency->'approval';today date:=(current_timestamp at time zone 'Asia/Bangkok')::date;begin
 if certificate is not null and certificate<>'null'::jsonb and not certificate ? 'registry' and not certificate ? 'container' then
  pinned:=hub.publication_pinned_source(dependency);if pinned is null then return false;end if;
 end if;
 if kind in ('project_facts','solar_estimates','faq_questions') and pinned is not null then
  source:=hub.web_source(kind,dependency->'identity');
  if source is null or source->>'deleted_at' is not null or source->>'ai_exposure'='internal' or upper(coalesce(source->>'state',''))='WITHDRAWN'
   or source->>'status' in ('withdrawn','retired') then return false;end if;
  if pinned->>'ai_exposure'='internal' or pinned->>'valid_from' is not null and (pinned->>'valid_from')::date>today
   or pinned->>'valid_to' is not null and (pinned->>'valid_to')::date<today or pinned->>'review_due' is not null and (pinned->>'review_due')::date<today then return false;end if;
  return true;
 end if;
 if kind not in ('commercial_types','project_prices','project_disclosures','project_sales_terms','project_programmes','project_progress','faqs','content_sections','articles') then
  return hub.web_source_available_before_workflow(dependency);
 end if;
 source:=hub.web_source(kind,dependency->'identity');
 if source is null or source->>'deleted_at' is not null or source->>'ai_exposure'='internal' then return false;end if;
 if kind in ('commercial_types','project_prices','project_disclosures','project_sales_terms','project_programmes','project_progress') and
  lower(coalesce(source->>'state',source->>'status',''))='withdrawn' then return false;end if;
 if kind='commercial_types' then
  select to_jsonb(v) into version from hub.commercial_type_versions v where commercial_type_id=(source->>'id')::uuid and state='approved' order by revision desc limit 1;
 elsif kind='project_prices' then
  select to_jsonb(v) into version from hub.project_price_versions v where price_id=(source->>'id')::uuid and state='approved' order by revision desc limit 1;
  if not exists(select 1 from hub.commercial_types c join hub.commercial_type_versions v on v.commercial_type_id=c.id and v.state='approved'
   where c.id=(source->>'commercial_type_id')::uuid and c.deleted_at is null and c.status<>'withdrawn' and c.price_mode='manual' and c.ai_exposure<>'internal') then return false;end if;
 elsif kind in ('project_disclosures','project_sales_terms','project_programmes','project_progress') then
  select to_jsonb(v) into version from hub.project_commercial_versions v where record_id=(source->>'id')::uuid and state='approved' order by revision desc limit 1;
 elsif kind='faqs' then
  if exists(select 1 from hub.faq_sources s join hub.knowledge_reviews r on r.candidate_id=s.candidate_id where s.faq_id=(source->>'id')::uuid and r.decision<>'accepted') then return false;end if;
  select to_jsonb(v) into version from hub.faq_versions v where faq_id=(source->>'id')::uuid and state in ('APPROVED','PUBLISHED') order by version_no desc limit 1;
 elsif kind='content_sections' then select to_jsonb(v) into version from hub.content_section_versions v where section_id=(source->>'id')::uuid and state in ('APPROVED','PUBLISHED') order by version_no desc limit 1;
 else select to_jsonb(v) into version from hub.article_versions v where article_id=(source->>'id')::uuid and state='APPROVED' order by version_no desc limit 1;
 end if;
 if version is null or version->>'approved_by' is null then return false;end if;
 if kind='project_prices' or kind='project_sales_terms' then
  if today not between (version#>>'{payload,valid_from}')::date and (version#>>'{payload,valid_to}')::date then return false;end if;
 end if;return true;
end $$;

-- A public read can use only the exact approval evidence already frozen in its
-- immutable page. No actor grants, live drafts or unreviewed values are used.
create function hub.publication_pinned_fact(slot jsonb,dependencies jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare dependency jsonb;review_days integer;today date:=(current_timestamp at time zone 'Asia/Bangkok')::date;approved boolean:=false;begin
 if not coalesce((slot->>'available')::boolean,false) or slot->>'ai_exposure'='internal' or slot->>'as_of' is null
  or (slot->>'as_of')::date>today or (slot->>'valid_to')::date<today then return jsonb_build_object('available',false);end if;
 select review_every_days into review_days from hub.field_catalog where field_key=slot->>'field_key' and status='active';
 if review_days is not null and (slot->>'as_of')::date+review_days<today then return jsonb_build_object('available',false);end if;
 for dependency in select * from jsonb_array_elements(coalesce(dependencies,'[]')) loop
  if not coalesce(hub.web_source_available(dependency),false) then return jsonb_build_object('available',false);end if;
  if dependency->'approval' is not null and dependency->'approval'<>'null'::jsonb and not dependency->'approval' ? 'registry' and not dependency->'approval' ? 'container' then
   if hub.publication_pinned_source(dependency) is null then return jsonb_build_object('available',false);end if;approved:=true;
  end if;
 end loop;
 return case when approved then slot else jsonb_build_object('available',false) end;
end $$;
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.web_resolve(jsonb,text,boolean,boolean)'::regprocedure);
 d:=hub.content_definition_replace(d,'current_slot:=hub.faq_fact_slot((value->>''project_id'')::uuid,value->>''field_key'',locale,null,false);',
  'current_slot:=case when value ? ''_pinned_facts'' then hub.publication_pinned_fact(value#>array[''reviewed'',locale],value->''dependencies'') else hub.faq_fact_slot((value->>''project_id'')::uuid,value->>''field_key'',locale,null,false) end;');
 d:=hub.content_definition_replace(d,'current_slot:=hub.faq_fact_slot((value->>''project_id'')::uuid,k,locale,null,false);',
  'current_slot:=case when value ? ''_pinned_facts'' then hub.publication_pinned_fact(old_slot,coalesce(value->''dependencies'',''[]'')||coalesce(value->''_evidence'',''[]'')) else hub.faq_fact_slot((value->>''project_id'')::uuid,k,locale,null,false) end;');execute d;
end $$;

-- The website composer selects approved version payloads; private draft and
-- readiness readers retain their original semantics.
create function hub.publication_prices(project_uuid uuid) returns jsonb language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce(jsonb_agg(v.payload||jsonb_build_object('_version_id',v.id) order by v.payload->>'kind',p.public_price_id),'[]')
 from hub.project_prices p join lateral (select * from hub.project_price_versions where price_id=p.id and state='approved' order by revision desc limit 1) v on true
 join hub.commercial_types c on c.id=p.commercial_type_id where p.project_id=project_uuid and p.state<>'withdrawn' and p.ai_exposure<>'internal'
  and c.deleted_at is null and c.status<>'withdrawn' and c.price_mode='manual' and c.ai_exposure<>'internal'
  and (current_timestamp at time zone 'Asia/Bangkok')::date between (v.payload->>'valid_from')::date and (v.payload->>'valid_to')::date
$$;
create function hub.publication_commercial(project_uuid uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare kind text;entry record;result jsonb:='{}';rows jsonb;today date:=(current_timestamp at time zone 'Asia/Bangkok')::date;begin
 foreach kind in array array['disclosures','sales-terms','programmes','construction'] loop
  rows:='[]';for entry in execute format('select v.* from hub.%I c join lateral (select * from hub.project_commercial_versions where record_id=c.id and kind=$2 and state=''approved'' order by revision desc limit 1) v on true where c.project_id=$1 and c.state<>''withdrawn'' and c.ai_exposure<>''internal'' order by c.public_content_id',hub.project_commercial_table(kind)) using project_uuid,kind loop
   if kind<>'sales-terms' or today between (entry.payload->>'valid_from')::date and (entry.payload->>'valid_to')::date then
    rows:=rows||jsonb_build_array(hub.project_commercial_public(entry.payload)||jsonb_build_object('_version_id',entry.id));end if;
  end loop;result:=result||jsonb_build_object(kind,rows);
 end loop;return result;
end $$;
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.compose_project_faq(uuid,text,text,boolean,boolean)'::regprocedure);
 d:=hub.content_definition_replace(d,'FUNCTION hub.compose_project_faq(','FUNCTION hub.publication_compose_faq(');
 d:=hub.content_definition_replace(d,'and (not published_only or x.id=f.published_version_id and x.state=''PUBLISHED'')','and x.state in (''APPROVED'',''PUBLISHED'')');
 d:=hub.content_definition_replace(d,'and f.state<>''WITHDRAWN''','');execute d;
 d:=pg_get_functiondef('hub.web_faqs(uuid)'::regprocedure);d:=hub.content_definition_replace(d,'hub.compose_project_faq(','hub.publication_compose_faq(');
 d:=hub.content_definition_replace(d,'''IN_REVIEW'',''PUBLISHED''','''APPROVED'',''PUBLISHED''');execute d;
 d:=pg_get_functiondef('hub.web_sections(text,text)'::regprocedure);
 d:=hub.content_definition_replace(d,'join hub.content_section_versions v on v.id=s.draft_version_id','join lateral (select * from hub.content_section_versions where section_id=s.id and state in (''APPROVED'',''PUBLISHED'') order by version_no desc limit 1) v on true');
 d:=hub.content_definition_replace(d,'and s.state<>''WITHDRAWN''','');d:=hub.content_definition_replace(d,'''IN_REVIEW'',''PUBLISHED''','''APPROVED'',''PUBLISHED''');execute d;
 d:=pg_get_functiondef('hub.web_scope_faq(text,text)'::regprocedure);
 d:=hub.content_definition_replace(d,'join hub.faq_versions v on v.id=f.draft_version_id','join lateral (select * from hub.faq_versions where faq_id=f.id and state in (''APPROVED'',''PUBLISHED'') order by version_no desc limit 1) v on true');
 d:=hub.content_definition_replace(d,'and f.state<>''WITHDRAWN'' and v.ai_exposure','and v.ai_exposure');
 d:=hub.content_definition_replace(d,'f.question_key=r.question_key and f.state<>''WITHDRAWN''','f.question_key=r.question_key and exists(select 1 from hub.faq_versions approved where approved.faq_id=f.id and approved.state in (''APPROVED'',''PUBLISHED''))');
 d:=hub.content_definition_replace(d,'''IN_REVIEW'',''PUBLISHED''','''APPROVED'',''PUBLISHED''');execute d;
 d:=pg_get_functiondef('hub.web_compose(hub.web_pages)'::regprocedure);
 d:=hub.content_definition_replace(d,'''config_revision'',page.revision,''body'',body',
  '''config_revision'',page.revision,''_page_dependencies'',jsonb_build_array(hub.web_dependency(''web_pages'',jsonb_build_object(''id'',page.id),''knowledge'')),''body'',body');execute d;
 d:=pg_get_functiondef('hub.web_project(uuid)'::regprocedure);
 d:=hub.content_definition_replace(d,'join hub.commercial_type_versions v on v.commercial_type_id=c.id and v.revision=c.revision','join lateral (select * from hub.commercial_type_versions where commercial_type_id=c.id and state=''approved'' order by revision desc limit 1) v on true');
 d:=hub.content_definition_replace(d,'c.status=''approved'' and v.state=''approved''','c.status<>''withdrawn'' and v.state=''approved''');
 d:=hub.content_definition_replace(d,'hub.project_current_prices(p.id)','hub.publication_prices(p.id)');
 d:=hub.content_definition_replace(d,'hub.project_current_commercial(p.id)','hub.publication_commercial(p.id)');
 d:=hub.content_definition_replace(d,'hub.web_item(r.payload,jsonb_build_array(hub.web_dependency(''project_prices''','hub.web_item(r.payload-''_version_id'',jsonb_build_array(hub.web_dependency(''project_price_versions'',jsonb_build_object(''id'',r.payload->>''_version_id''),''projects''),hub.web_dependency(''project_prices''');
 d:=hub.content_definition_replace(d,'hub.web_item(entry,jsonb_build_array(hub.web_dependency(hub.project_commercial_table(kind)','hub.web_item(entry-''_version_id'',jsonb_build_array(hub.web_dependency(''project_commercial_versions'',jsonb_build_object(''id'',entry->>''_version_id''),''projects''),hub.web_dependency(hub.project_commercial_table(kind)');
 execute d;
end $$;

create function hub.publication_item_key(value jsonb) returns text language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare dependency jsonb;begin
 if value ? '_fact' then return 'fact:'||(value->>'project_id')||':'||(value->>'field_key');end if;
 if value ? '_faq' then
  select d into dependency from jsonb_array_elements(value->'dependencies') d where d->>'table'='faqs' limit 1;
 else
  select d into dependency from jsonb_array_elements(coalesce(value->'dependencies','[]')) d
   where d->>'table' not in ('field_catalog','feature_catalog','facility_taxonomy','content_translations')
   order by case when d->>'table' in ('faq_versions','content_section_versions','commercial_type_versions','project_price_versions','project_commercial_versions','article_versions','assets') then 1 else 0 end limit 1;
 end if;
 return case when dependency is not null then (dependency->>'table')||':'||((dependency->'identity')-'revision')::text end;
end $$;

create function hub.publication_fact_dependencies(project uuid,key text,slot jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare keys text[];result jsonb:='[]';fact record;price record;unit_version uuid;begin
 if key='price.amount' then
  select p.id,p.commercial_type_id,v.id version_id into price from hub.project_prices p
   join lateral (select * from hub.project_price_versions where price_id=p.id and state='approved' order by revision desc limit 1) v on true
   where p.project_id=project and p.public_price_id=slot->>'public_price_id';
  if price.id is not null then
   select id into unit_version from hub.commercial_type_versions where commercial_type_id=price.commercial_type_id and state='approved' order by revision desc limit 1;
   result:=jsonb_build_array(hub.web_dependency('project_prices',jsonb_build_object('id',price.id),'projects'),
    hub.web_dependency('project_price_versions',jsonb_build_object('id',price.version_id),'projects'),
    hub.web_dependency('commercial_types',jsonb_build_object('id',price.commercial_type_id),'projects'));
   if unit_version is not null then result:=result||jsonb_build_array(hub.web_dependency('commercial_type_versions',jsonb_build_object('id',unit_version),'projects'));end if;
  end if;
 else
  keys:=case when exists(select 1 from hub.project_facts where project_id=project and fact_key=key) then array[key]
   when key='project.parking_pct_regular' then array['project.parking_regular','project.unit_total']
   when key='project.parking_pct_total' then array['project.parking_regular','project.parking_tandem','project.unit_total'] else array[key] end;
  for fact in select distinct on(f.fact_key) f.* from hub.project_facts f join hub.projects p on p.id=f.project_id
   where f.project_id=project and f.fact_key=any(keys) and f.grain in ('project','phase:'||p.rem_project_id) order by f.fact_key,(f.grain<>'project') desc loop
   result:=result||jsonb_build_array(hub.web_dependency('project_facts',jsonb_build_object('id',fact.id),'projects'));
  end loop;
  if result='[]' and key in ('project.building_count','project.floors_max') then
   for fact in select * from hub.project_buildings where project_id=project order by building_key loop
    result:=result||jsonb_build_array(hub.web_dependency('project_buildings',jsonb_build_object('project_id',project,'building_key',fact.building_key),'projects'));
   end loop;
  end if;
 end if;
 if result='[]' then result:=jsonb_build_array(hub.web_dependency('projects',jsonb_build_object('id',project),'projects'));end if;
 return result;
end $$;
create function hub.publication_enrich(value jsonb) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;child jsonb;k text;deps jsonb;slot jsonb;begin
 if jsonb_typeof(value)='array' then return coalesce((select jsonb_agg(hub.publication_enrich(v)) from jsonb_array_elements(value) v),'[]');end if;
 if jsonb_typeof(value)<>'object' then return value;end if;
 result:=value;
 -- Each approved content certificate already pins its contributing English
 -- reviewers. Page-wide mutable translation rows include unrelated drafts.
 if value ?& array['page_key','body','_page_dependencies'] then result:=result-'_evidence'-'_editors';end if;
 if value ? '_fact' then
  deps:=hub.publication_fact_dependencies((value->>'project_id')::uuid,value->>'field_key',value#>'{reviewed,th}');
  result:=jsonb_set(result,'{dependencies}',coalesce(result->'dependencies','[]')||deps);
  result:=result||jsonb_build_object('_pinned_facts',true);
 elsif value ? '_faq' then
  deps:='[]';for slot in select * from jsonb_array_elements(coalesce(value#>'{reviewed_facts,th}','[]')) loop
   deps:=deps||hub.publication_fact_dependencies((value->>'project_id')::uuid,slot->>'field_key',slot);
  end loop;
  result:=result||jsonb_build_object('_pinned_facts',true,'_evidence',deps);
 end if;
 for k,child in select e.k,e.v from jsonb_each(result) e(k,v) where e.k not in ('dependencies','_evidence','_issues') loop
  result:=jsonb_set(result,array[k],hub.publication_enrich(child));
 end loop;
 -- Evidence becomes local to the fact/FAQ item, so one stale source never
 -- invalidates unrelated contacts or narrative on the same project page.
 if result ? '_item' and result->'data' ? 'public_project_id' then result:=result-'_evidence';end if;
 return result;
end $$;

-- Review-only descriptors. Authority and exact identities come from the same
-- source dispatcher as decisions; item_key is never parsed into a command.
create function hub.publication_workflow_descriptor(kind text,identity jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare source jsonb;version jsonb;context jsonb;c jsonb;target jsonb;label jsonb;may_return boolean:=false;begin
 source:=hub.content_workflow_source(kind,identity,'view');version:=hub.content_workflow_version(kind,identity,source);
 context:=hub.publication_task_context(kind,source);
 select value into c from hub.workspace_history_contexts('hub.'||hub.content_workflow_table(kind),source) value limit 1;
 target:=c->'target';
 if target is not null then target:=target||coalesce(context,'{}')||jsonb_build_object('tab',case
  when kind='faq' then 'faq' when kind in ('unit_type','price','model') then 'unit-types'
  when kind in ('asset','project_asset','brand_asset','type_asset','asset_context','media_link','media_target') then 'media'
  else 'data' end);end if;
 target:=target||jsonb_strip_nulls(jsonb_build_object('version',coalesce(version->>'id',version->>'revision'),
  'unit_type',case when kind='unit_type' then source->>'public_commercial_type_id' else context->>'unit_type' end,
  'article',case when kind='article' then source->>'id' end,'promotion',case when kind='promotion' then source->>'id' end));
 if kind='faq' then
  select question_template into label from hub.faq_questions where question_key=source->>'question_key';
 elsif kind='question' then label:=source->'question_template';
 elsif kind='glossary' then label:=source->'term';
 elsif kind='facility' then select jsonb_build_object('th',name_th,'en',name_en) into label from hub.facility_taxonomy where code=source->>'facility_code';
 elsif kind='feature' then select f.label into label from hub.feature_catalog f where code=source->>'feature_code';
 elsif kind='price' then label:=source->'display_text';
 elsif kind in ('project_asset','brand_asset','type_asset','asset_context') then
  select jsonb_build_object('th',a.original_filename) into label from hub.assets a where id=(source->>'asset_id')::uuid;
 elsif kind='media_target' then select m.title into label from hub.media_links m where id=(source->>'media_link_id')::uuid;
 elsif kind='fact' then select f.label into label from hub.field_catalog f where f.field_key=source->>'fact_key';
 elsif kind='section' then select f.label into label from hub.field_catalog f where f.field_key=source->>'section_key';
 end if;
 label:=coalesce(nullif(label,'null'),nullif(source->'public_name','null'),nullif(source->'label','null'),nullif(source->'title','null'),nullif(source->'name','null'),nullif(version->'title','null'));
 if jsonb_typeof(label)='string' then label:=jsonb_build_object('th',label#>>'{}');end if;
 if jsonb_typeof(label) is distinct from 'object' or coalesce(nullif(label->>'th',''),nullif(label->>'en','')) is null then
  label:=jsonb_build_object('th',coalesce(source->>'original_filename',source->>'url',source->>'public_project_id',source->>'public_brand_id',source->>'public_commercial_type_id',
   source->>'question_key',source->>'term_key',source->>'field_key',source->>'fact_key',source->>'facility_code',source->>'section_key',source->>'code',c#>>'{name,th}',c#>>'{name,en}',kind));
 end if;
 if hub.can('knowledge','view') and hub.can_special('knowledge','knowledge.publish_web') then
  if kind='promotion' then may_return:=coalesce((hub.promotion_readiness(hub.promotion_payload((source->>'id')::uuid))->>'ready')::boolean,false)
    and source->'returned_revision' is distinct from source->'draft_revision';
  else may_return:=upper(coalesce(version->>'state',case when kind='question' and source->>'status'='approved' then 'APPROVED' end,''))='APPROVED';end if;
 end if;
 return jsonb_build_object('label',label,'target',target,'workflow',jsonb_build_object('kind',kind,'identity',identity,'expected_hash',hub.content_workflow_hash(source)),
  'can_return',may_return);
exception when insufficient_privilege or no_data_found then return jsonb_build_object('workflow',null,'target',null,'can_return',false);
end $$;

create function hub.publication_item_descriptor(value jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare dependency jsonb;row_data jsonb;kind text;identity jsonb;result jsonb;name text;begin
 for dependency in select d from jsonb_array_elements(coalesce(value->'dependencies',value->'_page_dependencies','[]')) d
  order by case when d->>'table' in ('faqs','content_sections','articles','commercial_types','project_prices','project_disclosures','project_sales_terms','project_programmes','project_progress') then 0
   when d->>'table' in ('field_catalog','feature_catalog','facility_taxonomy','content_translations') then 3
   when d->>'table' like '%versions' then 2 else 1 end loop
  name:=dependency->>'table';kind:=hub.publication_source_kind(name);
  row_data:=hub.web_source(name,dependency->'identity');
  if kind is null then
   kind:=case name when 'faqs' then 'faq' when 'faq_versions' then 'faq' when 'content_sections' then 'section' when 'content_section_versions' then 'section'
    when 'articles' then 'article' when 'article_versions' then 'article' when 'commercial_types' then 'unit_type' when 'commercial_type_versions' then 'unit_type'
    when 'project_prices' then 'price' when 'project_price_versions' then 'price' when 'project_disclosures' then 'disclosure' when 'project_sales_terms' then 'sales_term'
    when 'project_programmes' then 'programme' when 'project_progress' then 'progress' when 'project_commercial_versions' then
     case row_data->>'kind' when 'disclosures' then 'disclosure' when 'sales-terms' then 'sales_term' when 'programmes' then 'programme' else 'progress' end end;
  end if;
  if kind is null or row_data is null then continue;end if;
  identity:=case name when 'faq_versions' then jsonb_build_object('id',row_data->'faq_id') when 'content_section_versions' then jsonb_build_object('id',row_data->'section_id')
   when 'article_versions' then jsonb_build_object('id',row_data->'article_id') when 'commercial_type_versions' then jsonb_build_object('id',row_data->'commercial_type_id')
   when 'project_price_versions' then jsonb_build_object('id',row_data->'price_id') when 'project_commercial_versions' then jsonb_build_object('id',row_data->'record_id')
   else hub.content_workflow_identity(kind,row_data) end;
  result:=hub.publication_workflow_descriptor(kind,identity);
  if result->'workflow'='null'::jsonb then continue;end if;
  -- A stale review never advertises returning a different current revision.
  begin
   for dependency in select * from jsonb_array_elements(coalesce(value->'dependencies',value->'_page_dependencies','[]')) loop
    perform hub.publication_dependency_check(dependency,false,true);
   end loop;
  exception when insufficient_privilege or no_data_found or serialization_failure or check_violation then result:=result||jsonb_build_object('can_return',false);end;
  return result||jsonb_build_object('item_key',case when value ? '_page_dependencies' then 'page_config:'||(value->>'page_key') else hub.publication_item_key(value) end);
 end loop;
 return jsonb_build_object('item_key',hub.publication_item_key(value),'label',jsonb_build_object('th',coalesce(value->>'field_key',value->>'question_key','Item')),
  'workflow',null,'target',null,'can_return',false);
end $$;

create function hub.publication_sanitize(value jsonb,previous jsonb,independent boolean default true) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;child jsonb;old_child jsonb;k text;key text;processed jsonb;outcomes jsonb:='[]';accepted integer:=0;failure text;dependency jsonb;container boolean;begin
 if value is null then return jsonb_build_object('value',null,'outcomes',outcomes,'accepted',0);end if;
 if jsonb_typeof(value)='array' then
  result:='[]';for child in select * from jsonb_array_elements(value) loop
   key:=hub.publication_item_key(child);old_child:=null;
   if key is not null and jsonb_typeof(previous)='array' then select p into old_child from jsonb_array_elements(previous) p where hub.publication_item_key(p)=key limit 1;end if;
   processed:=hub.publication_sanitize(child,old_child,independent);outcomes:=outcomes||(processed->'outcomes');accepted:=accepted+(processed->>'accepted')::integer;
   if processed->'value'<>'null'::jsonb then result:=result||jsonb_build_array(processed->'value');end if;
  end loop;
  -- Draft-only removals do not silently withdraw the previously published item.
  if jsonb_typeof(previous)='array' then for old_child in select * from jsonb_array_elements(previous) loop
   key:=hub.publication_item_key(old_child);
   if key is null or exists(select 1 from jsonb_array_elements(value) n where hub.publication_item_key(n)=key) then continue;end if;
   begin
    for dependency in select * from hub.web_dependencies(old_child) loop perform hub.publication_dependency_check(dependency,independent,false);end loop;
    result:=result||jsonb_build_array(old_child);
   exception when insufficient_privilege or check_violation or serialization_failure then null;end;
  end loop;end if;
  return jsonb_build_object('value',result,'outcomes',outcomes,'accepted',accepted);
 elsif jsonb_typeof(value)<>'object' then return jsonb_build_object('value',value,'outcomes',outcomes,'accepted',0);end if;
 result:=value;container:=value ? '_item' and jsonb_typeof(value->'data')='object' and (value->'data' ? 'public_project_id' or value->'data' ? 'public_brand_id');
 if value ?& array['page_key','body','_page_dependencies'] then
  begin
   for dependency in select * from jsonb_array_elements(value->'_page_dependencies') loop perform hub.publication_dependency_check(dependency,independent,true);end loop;
  exception when serialization_failure or insufficient_privilege or check_violation then
   outcomes:=outcomes||jsonb_build_array(hub.publication_item_descriptor(value)||jsonb_build_object('status','REJECTED','code','page_config_changed_or_unapproved'));
   if previous is null or previous='null'::jsonb then return jsonb_build_object('value',null,'outcomes',outcomes,'accepted',0);end if;
   result:=previous||jsonb_build_object('body',value->'body');
  end;
 end if;
 if value ? '_item' or value ? '_fact' or value ? '_faq' then
  key:=hub.publication_item_key(value);failure:=null;
  begin
   for dependency in select * from jsonb_array_elements(coalesce(value->'dependencies','[]')) loop perform hub.publication_dependency_check(dependency,independent,true);end loop;
   if value ? '_faq' then for dependency in select * from jsonb_array_elements(coalesce(value->'_evidence','[]')) loop perform hub.publication_dependency_check(dependency,independent,true);end loop;end if;
   if coalesce(jsonb_array_length(value->'_issues'),0)>0 then raise exception 'Item readiness is incomplete' using errcode='23514';end if;
  exception when serialization_failure then failure:='stale';when insufficient_privilege then failure:='publisher_conflict';when check_violation then failure:='not_approved_or_available';end;
  if failure is not null then
   outcomes:=outcomes||jsonb_build_array(hub.publication_item_descriptor(value)||jsonb_build_object('status','REJECTED','code',failure));
   if previous is null or previous='null'::jsonb then return jsonb_build_object('value',null,'outcomes',outcomes,'accepted',0);end if;
   begin
    for dependency in select * from jsonb_array_elements(coalesce(previous->'dependencies','[]')) loop perform hub.publication_dependency_check(dependency,independent,false);end loop;
   exception when insufficient_privilege or check_violation or serialization_failure then return jsonb_build_object('value',null,'outcomes',outcomes,'accepted',0);end;
   if not container then return jsonb_build_object('value',previous,'outcomes',outcomes,'accepted',0);end if;
   result:=previous;
   -- Keep the old project fields, then process independent children from this
   -- batch against their own old item. A stale title does not block a contact.
   for k,child in select e.k,e.v from jsonb_each(value->'data') e(k,v) where jsonb_typeof(e.v)='array' or e.v ? '_item' or e.v ? '_fact' or e.v ? '_faq' loop
    result:=jsonb_set(result,array['data',k],child);
   end loop;
  else accepted:=1;outcomes:=outcomes||jsonb_build_array(hub.publication_item_descriptor(value)||jsonb_build_object('status','APPROVED'));end if;
 end if;
 for k,child in select e.k,e.v from jsonb_each(result) e(k,v) where e.k not in ('dependencies','_page_dependencies','_evidence','_issues') loop
  processed:=hub.publication_sanitize(child,previous->k,independent);
  result:=jsonb_set(result,array[k],processed->'value');outcomes:=outcomes||(processed->'outcomes');accepted:=accepted+(processed->>'accepted')::integer;
 end loop;
 return jsonb_build_object('value',result,'outcomes',outcomes,'accepted',accepted);
end $$;

create function hub.publication_page_visible(page hub.web_pages) returns boolean language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('knowledge','view');perform hub.web_assert_sources(hub.web_compose(page),'view');return true;
 exception when insufficient_privilege or no_data_found then return false;
end $$;
create or replace function hub.web_workspace() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('knowledge','view');
 return jsonb_build_object('pages',coalesce((select jsonb_agg(to_jsonb(w)-'last_output_hashes' order by page_key) from hub.web_pages w where hub.publication_page_visible(w)),'[]'),
  'publications',coalesce((select jsonb_agg(to_jsonb(r)) from (select id,digest,reason,state,created_at,created_by,published_at,published_by,jsonb_array_length(pages) page_count
   from hub.web_publications b where not exists(select 1 from hub.web_dependencies(b.pages) d where not hub.can(d->>'tab','view')) order by created_at desc limit 30) r),'[]'),
  'can_publish',hub.can_special('knowledge','knowledge.publish_web'));
end $$;

create function hub.publication_legacy_dependencies(kind text,entity uuid,payload jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;node jsonb;row_data record;begin
 result:=jsonb_build_array(hub.web_dependency(case kind when 'project' then 'projects' else 'brands' end,jsonb_build_object('id',entity),hub.content_member_tab(kind)));
 for node in select n from hub.web_nodes(payload) n where jsonb_typeof(n)='object' loop
  if node ? 'binding_id' and node ? 'id' then
   result:=result||jsonb_build_array(hub.web_dependency('assets',jsonb_build_object('id',node->>'id'),hub.content_member_tab(kind)));
   if exists(select 1 from hub.entity_assets where id=(node->>'binding_id')::uuid) then result:=result||jsonb_build_array(hub.web_dependency('entity_assets',jsonb_build_object('id',node->>'binding_id'),'projects'));
   elsif exists(select 1 from hub.brand_assets where id=(node->>'binding_id')::uuid) then result:=result||jsonb_build_array(hub.web_dependency('brand_assets',jsonb_build_object('id',node->>'binding_id'),'brands'));
   elsif exists(select 1 from hub.commercial_type_assets where id=(node->>'binding_id')::uuid) then result:=result||jsonb_build_array(hub.web_dependency('commercial_type_assets',jsonb_build_object('id',node->>'binding_id'),'projects'));end if;
  elsif node ? 'public_model_id' and node ? 'id' then result:=result||jsonb_build_array(hub.web_dependency('model_types',jsonb_build_object('id',node->>'id'),'projects'));
  elsif node ? 'public_brand_id' and node ? 'id' and node->>'id'<>entity::text then result:=result||jsonb_build_array(hub.web_dependency('brands',jsonb_build_object('id',node->>'id'),'brands'));
  elsif node ? 'public_commercial_type_id' and node ? 'id' then
   select v.id into row_data from hub.commercial_types c join hub.commercial_type_versions v on v.commercial_type_id=c.id and v.revision=c.revision
    where c.id=(node->>'id')::uuid and c.status='approved' and v.state='approved';
   if row_data.id is null then raise exception 'Approved unit type required' using errcode='23514';end if;
   result:=result||jsonb_build_array(hub.web_dependency('commercial_type_versions',jsonb_build_object('id',row_data.id),'projects'));
  end if;
 end loop;
 if kind='project' then
  for row_data in select * from hub.project_facilities where project_id=entity loop
   result:=result||jsonb_build_array(hub.web_dependency('project_facilities',jsonb_build_object('project_id',entity,'facility_code',row_data.facility_code),'projects'));
  end loop;
 end if;return result;
end $$;
create function hub.publication_legacy_certify(kind text,entity uuid,payload jsonb,rollback boolean default false) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid:=hub.publication_actor();deps jsonb;dependency jsonb;begin
 perform hub.require_permission(hub.content_member_tab(kind),'view');
 deps:=case when rollback then payload->'_workflow'->'dependencies' else hub.publication_legacy_dependencies(kind,entity,payload) end;
 if deps is null then raise exception 'This historical version has no Manager approval; review a new draft' using errcode='23514';end if;
 for dependency in select * from jsonb_array_elements(deps) loop perform hub.publication_dependency_check(dependency,true,not rollback);end loop;
 return payload||jsonb_build_object('_workflow',jsonb_build_object('dependencies',deps));
end $$;

-- Private evidence columns prevent contributor/account identifiers entering a
-- legacy public payload. They are immutable with the original version row.
alter table hub.entity_versions add column review_evidence jsonb;
alter table hub.brand_versions add column review_evidence jsonb;
alter table hub.promotion_versions add column review_evidence jsonb;
alter table hub.public_promotions add column returned_revision integer,add column return_reason text,add column returned_by uuid,add column returned_at timestamptz;

create function hub.publication_promotion_check(promotion uuid,revision integer,payload jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid:=hub.publication_actor();source hub.public_promotions;reviewers uuid[];editors uuid[];dependency jsonb;deps jsonb:='[]';r record;begin
 perform hub.require_permission('promotions','view');select * into source from hub.public_promotions where id=promotion;
 if not found or source.returned_revision=revision then raise exception 'Promotion was returned for editing' using errcode='23514';end if;
 if not(hub.promotion_readiness(payload)->>'ready')::boolean then raise exception 'Promotion DATA and LEGAL review are incomplete' using errcode='23514';end if;
 select array_agg(reviewed_by) into reviewers from (select distinct on(review_type) review_type,reviewed_by,decision
  from hub.promotion_reviews where promotion_id=promotion and review_revision=revision order by review_type,reviewed_at desc,id desc) latest where decision='APPROVED';
 if cardinality(reviewers) is distinct from 2 then raise exception 'Promotion DATA and LEGAL approvals are required' using errcode='23514';end if;
 editors:=source.editors||array(select reviewed_by from hub.content_translations where owner_type='promotion' and owner_key=promotion::text and en_from_th_version=th_version and reviewed_by is not null);
 if actor=any(reviewers) or actor=any(editors) then raise exception 'Promotion publisher must differ from its editors and reviewers' using errcode='42501';end if;
 for r in select id from hub.promotion_target_projects(promotion) loop perform hub.require_permission('projects','view');end loop;
 for r in select * from hub.asset_links where target_type='promotion' and target_key=promotion::text and deleted_at is null and usage='banner' loop
  dependency:=hub.web_dependency('asset_links',jsonb_build_object('id',r.id),'projects');perform hub.publication_dependency_check(dependency,true,true);deps:=deps||jsonb_build_array(dependency);
  dependency:=hub.web_dependency('assets',jsonb_build_object('id',r.asset_id),'projects');perform hub.publication_dependency_check(dependency,true,true);deps:=deps||jsonb_build_array(dependency);
 end loop;
 perform hub.validate_promotion_targets(source.targets);
 return jsonb_build_object('revision',revision,'editors',editors,'approvers',reviewers,'dependencies',deps);
end $$;
create function hub.publication_snapshot_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare verified jsonb;begin
 if tg_table_name='entity_versions' then
  if new.entity_type='web_page' then return new;end if;
  verified:=hub.publication_legacy_certify('project',new.project_id,new.payload,false);new.review_evidence:=verified->'_workflow';
 elsif tg_table_name='brand_versions' then
  verified:=hub.publication_legacy_certify('brand',new.brand_id,new.payload,false);new.review_evidence:=verified->'_workflow';
 else new.review_evidence:=hub.publication_promotion_check(new.promotion_id,new.draft_revision,new.payload);
 end if;return new;
end $$;
create trigger z_publication_approval before insert on hub.entity_versions for each row execute function hub.publication_snapshot_guard();
create trigger z_publication_approval before insert on hub.brand_versions for each row execute function hub.publication_snapshot_guard();
create trigger z_publication_approval before insert on hub.promotion_versions for each row execute function hub.publication_snapshot_guard();

-- The older residential catalogue trigger predates web-page versions. Their
-- composed payload and digest must stay exact; no residential defaults belong
-- in a new web snapshot. Existing versions are never rewritten.
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.freeze_project_catalogue()'::regprocedure);
 d:=hub.content_definition_replace(d,'begin',
  'begin if new.entity_type=''web_page'' then return new;end if;');execute d;
end $$;

create function hub.publication_replace(definition text,needle text,replacement text) returns text language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
begin
 if strpos(definition,needle)=0 then raise exception 'Publication guard extension did not match: %',needle;end if;
 return replace(definition,needle,replacement);
end $$;
create function hub.publication_rollback_check(kind text,entity uuid,version uuid) returns void language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare payload jsonb;evidence jsonb;dependency jsonb;actor uuid:=hub.publication_actor();begin
 perform hub.require_permission(hub.content_member_tab(kind),'view');
 if kind='project' then select v.payload,v.review_evidence into payload,evidence from hub.entity_versions v where id=version and project_id=entity;
 elsif kind='brand' then select v.payload,v.review_evidence into payload,evidence from hub.brand_versions v where id=version and brand_id=entity;
 elsif kind='promotion' then select v.payload,v.review_evidence into payload,evidence from hub.promotion_versions v where id=version and promotion_id=entity;
 else raise exception 'Invalid publication kind' using errcode='23514';end if;
 if payload is null then raise exception 'Publication version not found' using errcode='P0002';end if;
 if evidence is null then raise exception 'This historical version has no Manager approval; review a new draft' using errcode='23514';end if;
 if kind='promotion' and (evidence->'editors' ? actor::text or evidence->'approvers' ? actor::text) then raise exception 'Promotion publisher must be independent' using errcode='42501';end if;
 for dependency in select * from jsonb_array_elements(evidence->'dependencies') loop perform hub.publication_dependency_check(dependency,true,false);end loop;
end $$;

do $$ declare rule record;f record;d text;needle text;begin
 for rule in select * from (values
  ('projects',array['publish_project','withdraw_project','rollback_project','rollback_project_before_readiness_levels']),
  ('brands',array['publish_brand','withdraw_brand','rollback_brand'])) r(tab,names) loop
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub' and p.proname=any(rule.names) loop
   d:=pg_get_functiondef(f.oid);needle:=format('hub.require_permission(%L,%L)',rule.tab,'approve');
   d:=hub.publication_replace(d,needle,format('hub.require_permission(%L,''view''); perform hub.publication_actor()',rule.tab));execute d;
  end loop;
 end loop;
 d:=pg_get_functiondef('hub.rollback_project(uuid,uuid,text)'::regprocedure);
 d:=hub.publication_replace(d,'perform hub.rollback_project_before_readiness_levels(project_uuid,version_uuid,reason);',
  'perform hub.publication_rollback_check(''project'',project_uuid,version_uuid); perform hub.rollback_project_before_readiness_levels(project_uuid,version_uuid,reason);');execute d;
 d:=pg_get_functiondef('hub.rollback_brand(uuid,uuid,text)'::regprocedure);
 d:=hub.publication_replace(d,'update hub.brands set published_version_id=version_uuid',
  'perform hub.publication_rollback_check(''brand'',brand_uuid,version_uuid); update hub.brands set published_version_id=version_uuid');execute d;
 d:=pg_get_functiondef('hub.promotion_command(text,uuid,jsonb)'::regprocedure);
 d:=hub.publication_replace(d,'hub.require_permission(''promotions'',case when action in(''create'',''update'') then ''edit'' else ''approve'' end)',
  'hub.require_permission(''promotions'',case when action in(''create'',''update'') then ''edit'' when action in(''publish'',''withdraw'') then ''view'' else ''approve'' end)');
 d:=hub.publication_replace(d,'if action=''create'' then','if action in(''publish'',''withdraw'') then perform hub.publication_actor();end if; if action=''create'' then');execute d;
 foreach needle in array array['hub.release_publish(jsonb,text,boolean)','hub.release_rollback(uuid,text)'] loop
  d:=pg_get_functiondef(needle::regprocedure);
  d:=hub.publication_replace(d,'hub.require_permission(''releases'',''approve'')','hub.publication_actor()');
  d:=hub.publication_replace(d,'hub.can(hub.content_member_tab(item->>''entity_type''),''approve'')','hub.can(hub.content_member_tab(item->>''entity_type''),''view'')');
  if needle='hub.release_rollback(uuid,text)' then
   d:=hub.publication_replace(d,'if m.before_version_id is not null then','if m.before_version_id is not null then perform hub.publication_rollback_check(''promotion'',m.entity_id,m.before_version_id);');
  end if;execute d;
 end loop;
 d:=pg_get_functiondef('hub.web_pointer(text,uuid,uuid,text)'::regprocedure);
 d:=hub.publication_replace(d,'hub.require_permission(''knowledge'',''approve'')','hub.publication_actor()');
 d:=hub.publication_replace(d,'hub.web_assert_sources(snapshot,''approve'',target is not null)','hub.web_assert_sources(snapshot,''view'',target is not null)');execute d;
end $$;

create or replace function hub.release_read(p_id uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;begin
 if not(hub.can('releases','view') or hub.can('knowledge','view')) then raise exception 'Permission denied' using errcode='42501';end if;
 if p_id is null then return jsonb_build_object('items',coalesce((select jsonb_agg(hub.release_read(id) order by published_at desc,id) from hub.publication_releases r
  where exists(select 1 from hub.publication_release_members m where release_id=r.id and hub.can(hub.content_member_tab(m.entity_type),'view'))),'[]'),
  'total',(select count(*) from hub.publication_releases r where exists(select 1 from hub.publication_release_members m where release_id=r.id and hub.can(hub.content_member_tab(m.entity_type),'view'))));end if;
 select to_jsonb(r)||jsonb_build_object('members',coalesce((select jsonb_agg(to_jsonb(m)-'release_id' order by entity_type,entity_id) from hub.publication_release_members m
  where release_id=r.id and hub.can(hub.content_member_tab(m.entity_type),'view')),'[]')) into result from hub.publication_releases r where id=p_id
  and exists(select 1 from hub.publication_release_members m where release_id=r.id and hub.can(hub.content_member_tab(m.entity_type),'view'));
 if result is null then raise exception 'Release not found' using errcode='P0002';end if;return result;
end $$;

create function hub.publication_write_lock() returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('hub-web-publications',0));
 perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));
 -- A permission change may commit while this command waits for the account
 -- lock. Recheck the current special before locking sources or writing anything.
 perform hub.publication_actor();
 lock table staging.dw_projects in share mode;
 lock table hub.projects,hub.model_types,hub.brands,hub.assets,hub.entity_assets,hub.brand_assets,hub.asset_links,hub.commercial_types,hub.commercial_type_versions,
  hub.commercial_type_assets,hub.project_prices,hub.project_price_versions,hub.project_disclosures,hub.project_sales_terms,hub.project_programmes,hub.project_progress,
  hub.project_commercial_versions,hub.project_facts,hub.project_buildings,hub.project_selling_points,hub.content_sections,hub.content_section_versions,
  hub.faqs,hub.faq_versions,hub.faq_questions,hub.faq_sources,hub.knowledge_reviews,hub.contacts,hub.project_features,hub.feature_catalog,hub.project_facilities,
  hub.facility_taxonomy,hub.project_places,hub.solar_estimates,hub.media_links,hub.media_link_targets,hub.articles,hub.article_versions,hub.article_links,
  hub.field_catalog,hub.content_translations,hub.content_review_versions,hub.public_promotions,hub.promotion_reviews in share row exclusive mode;
end $$;
do $$ declare name text;d text;begin
 foreach name in array array['hub.publish_project(uuid,text)','hub.publish_brand(uuid,text)','hub.withdraw_project(uuid,text)','hub.withdraw_brand(uuid,text)',
  'hub.rollback_project(uuid,uuid,text)','hub.rollback_brand(uuid,uuid,text)'] loop
  d:=pg_get_functiondef(name::regprocedure);d:=hub.publication_replace(d,'perform hub.publication_actor()','perform hub.publication_actor(); perform hub.publication_write_lock()');execute d;
 end loop;
 d:=pg_get_functiondef('hub.promotion_command(text,uuid,jsonb)'::regprocedure);
 d:=hub.publication_replace(d,'then perform hub.publication_actor();end if;','then perform hub.publication_actor(); perform hub.publication_write_lock();end if;');execute d;
 d:=pg_get_functiondef('hub.web_pointer(text,uuid,uuid,text)'::regprocedure);
 d:=hub.publication_replace(d,'perform hub.require_special(''knowledge'',''knowledge.publish_web'');perform pg_advisory_xact_lock',
  'perform hub.publication_write_lock();perform hub.require_special(''knowledge'',''knowledge.publish_web'');perform pg_advisory_xact_lock');execute d;
 d:=pg_get_functiondef('hub.release_rollback(uuid,text)'::regprocedure);
 d:=hub.publication_replace(d,'actor:=hub.publication_actor();','actor:=hub.publication_actor();perform hub.publication_write_lock();');execute d;
 d:=pg_get_functiondef('hub.release_publish(jsonb,text,boolean)'::regprocedure);
 d:=hub.publication_replace(d,'FUNCTION hub.release_publish(','FUNCTION hub.publication_release_core(');execute d;
 d:=pg_get_functiondef('hub.release_candidates(boolean)'::regprocedure);
 d:=hub.publication_replace(d,'FUNCTION hub.release_candidates(','FUNCTION hub.publication_release_candidates(');
 d:=hub.publication_replace(d,'perform hub.require_permission(''releases'',''view'');','perform hub.require_permission(''knowledge'',''view'');');execute d;
end $$;

create or replace function hub.release_publish(members jsonb,reason text,demo_mode boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
<<release_values>>
declare actor uuid:=hub.publication_actor();item jsonb;rejected jsonb:='[]';source jsonb;payload jsonb;result jsonb;kind text;entity uuid;
 release_id uuid;candidate_release uuid;version_id uuid;public_id text;readiness jsonb;
begin
 perform hub.publication_write_lock();perform hub.residential_environment();reason:=hub.content_review_reason(reason,true);
 if jsonb_typeof(members) is distinct from 'array' or jsonb_array_length(members) not between 1 and 100 or demo_mode is null then raise exception 'Select publication members' using errcode='23514';end if;
 if (select count(distinct (value->>'entity_type',value->>'entity_id')) from jsonb_array_elements(members))<>jsonb_array_length(members) then raise exception 'Duplicate publication member' using errcode='23514';end if;
 for item in select * from jsonb_array_elements(members) loop
  kind:=item->>'entity_type';entity:=(item->>'entity_id')::uuid;
  if kind is null or kind not in ('project','brand','promotion') or entity is null
   or item-array['entity_type','entity_id','expected_updated_at','expected_revision','expected_published_version_id']<>'{}' then raise exception 'Invalid publication member' using errcode='23514';end if;
  perform hub.require_permission(hub.content_member_tab(kind),'view');
 end loop;
 perform hub.lock_release_members(members);perform set_config('app.change_reason',reason,true);
 -- A promotion may depend on a project first published in this same release.
 -- Each ordinary publication command rechecks approval and readiness after its
 -- predecessors. A rejected item rolls back only its own writes and audit rows.
 for item in select value from jsonb_array_elements(members)
  order by case value->>'entity_type' when 'brand' then 1 when 'project' then 2 else 3 end,value->>'entity_id' loop
  kind:=item->>'entity_type';entity:=(item->>'entity_id')::uuid;candidate_release:=release_id;
  begin
   source:=hub.content_workflow_source(kind,jsonb_build_object('id',entity),'view');
   if not item ? 'expected_published_version_id' or source->'published_version_id' is distinct from item->'expected_published_version_id'
    or kind='promotion' and source->'draft_revision' is distinct from item->'expected_revision'
    or kind<>'promotion' and (source->>'updated_at')::timestamptz is distinct from (item->>'expected_updated_at')::timestamptz then raise exception 'Publication member changed' using errcode='40001';end if;
   payload:=case when kind='promotion' then hub.promotion_payload(entity) else hub.residential_payload(kind,entity,demo_mode) end;
   if kind='promotion' then
    perform hub.publication_promotion_check(entity,(source->>'draft_revision')::integer,payload);
    result:=hub.promotion_command('publish',entity,jsonb_build_object('expected_revision',item->'expected_revision',
     'expected_published_version_id',item->'expected_published_version_id','change_reason',reason));
    version_id:=(result->>'published_version_id')::uuid;public_id:=result->>'code';
   else
    perform hub.publication_legacy_certify(kind,entity,payload,false);
    perform a.id from hub.assets a where a.id in
     (select (x->>'id')::uuid from jsonb_array_elements(coalesce(payload->'assets','[]')) x
      union select (x->>'id')::uuid from jsonb_array_elements(coalesce(payload#>'{brand,assets}','[]')) x) order by a.id for share;
    if not demo_mode then version_id:=case kind when 'brand' then hub.publish_brand(entity,reason) else hub.publish_project(entity,reason) end;
    else
     readiness:=case kind when 'brand' then hub.brand_snapshot_readiness(payload) else hub.snapshot_readiness(payload) end;
     if not (readiness->>'ready')::boolean then raise exception 'Publication item is not ready' using errcode='23514';end if;
     if kind='brand' then
      insert into hub.brand_versions(brand_id,version_no,payload,publisher,change_reason)
       select entity,coalesce(max(v.version_no),0)+1,release_values.payload,actor,reason from hub.brand_versions v where v.brand_id=entity returning id into version_id;
      update hub.brands set published_version_id=version_id where id=entity;
     else
      insert into hub.entity_versions(project_id,version_no,payload,publisher,change_reason)
       select entity,coalesce(max(v.version_no),0)+1,release_values.payload,actor,reason from hub.entity_versions v where v.project_id=entity returning id into version_id;
      update hub.projects set published_version_id=version_id where id=entity;
     end if;
    end if;
    public_id:=case kind when 'brand' then payload->>'public_brand_id' else payload->>'public_project_id' end;
   end if;
   if candidate_release is null then
    insert into hub.publication_releases(change_reason,demo_mode,published_by) values(reason,demo_mode,actor) returning id into candidate_release;
   end if;
   insert into hub.publication_release_members(release_id,entity_type,entity_id,public_id,before_version_id,after_version_id)
    values(candidate_release,kind,entity,public_id,(item->>'expected_published_version_id')::uuid,version_id);
   release_id:=candidate_release;
  exception when serialization_failure or no_data_found then rejected:=rejected||jsonb_build_array(jsonb_build_object('entity_type',kind,'entity_id',entity,'code','stale'));
   when check_violation then rejected:=rejected||jsonb_build_array(jsonb_build_object('entity_type',kind,'entity_id',entity,'code','not_approved_or_available'));
   when insufficient_privilege then rejected:=rejected||jsonb_build_array(jsonb_build_object('entity_type',kind,'entity_id',entity,'code','publisher_conflict'));
  end;
 end loop;
 if release_id is null then return jsonb_build_object('status','RETURNED','members','[]'::jsonb,'rejected',rejected);end if;
 return hub.release_read(release_id)||jsonb_build_object('rejected',rejected);
end $$;

create function hub.publication_queue_prepare(selections jsonb,reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid:=hub.publication_actor();selection jsonb;page hub.web_pages;snapshot jsonb;pages jsonb:='[]';batch hub.web_publications;source jsonb;payload jsonb;member jsonb;begin
 perform hub.publication_write_lock();reason:=hub.content_review_reason(reason,true);
 if jsonb_typeof(selections) is distinct from 'array' or jsonb_array_length(selections) not between 1 and 100
  or (select count(distinct value) from jsonb_array_elements(selections))<>jsonb_array_length(selections) then raise exception 'Select unique publication targets' using errcode='23514';end if;
 for selection in select * from jsonb_array_elements(selections) loop
  if selection->>'system'='web' and selection-array['system','page_key']='{}' then
   select * into page from hub.web_pages where page_key=selection->>'page_key';
   if not found then raise exception 'Page not found' using errcode='P0002';end if;
   snapshot:=hub.publication_enrich(hub.web_compose(page));perform hub.web_assert_sources(snapshot,'view');
   pages:=pages||jsonb_build_array(jsonb_build_object('system','web','snapshot',snapshot,'previous_version_id',page.published_version_id,'hash',hub.web_hash(snapshot),'issues',hub.web_issues(snapshot)));
  elsif selection->>'system'='release' and selection-array['system','entity_type','entity_id']='{}' and selection->>'entity_type' in ('project','brand','promotion') then
   source:=hub.content_workflow_source(selection->>'entity_type',jsonb_build_object('id',selection->>'entity_id'),'view');
   member:=jsonb_build_object('entity_type',selection->>'entity_type','entity_id',selection->>'entity_id','expected_published_version_id',source->'published_version_id');
   if selection->>'entity_type'='promotion' then
    member:=member||jsonb_build_object('expected_revision',source->'draft_revision');payload:=hub.promotion_payload((selection->>'entity_id')::uuid);
    perform hub.publication_promotion_check((selection->>'entity_id')::uuid,(source->>'draft_revision')::integer,payload);
   else
    member:=member||jsonb_build_object('expected_updated_at',source->'updated_at');payload:=hub.residential_payload(selection->>'entity_type',(selection->>'entity_id')::uuid,false);
    payload:=hub.publication_legacy_certify(selection->>'entity_type',(selection->>'entity_id')::uuid,payload,false);
   end if;
   pages:=pages||jsonb_build_array(jsonb_build_object('system','release','member',member,'hash',hub.web_hash(payload),'snapshot',payload));
  else raise exception 'Invalid publication selection' using errcode='23514';end if;
 end loop;
 insert into hub.web_publications(pages,digest,reason,editors) values(pages,hub.web_hash(pages),reason,'{}') returning * into batch;
 return jsonb_build_object('id',batch.id,'digest',batch.digest,'page_count',jsonb_array_length(pages),'state',batch.state);
end $$;

-- Pure revalidation of an immutable prepared release. The caller holds the
-- publication/source locks on writes; GET uses exactly the same comparison.
create function hub.publication_release_prepared(item jsonb,independent boolean default true) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare member jsonb:=item->'member';kind text:=member->>'entity_type';entity uuid:=(member->>'entity_id')::uuid;
 source jsonb;payload jsonb;deps jsonb;dependency jsonb;begin
 if kind not in ('project','brand','promotion') then raise exception 'Invalid release kind' using errcode='23514';end if;
 source:=hub.content_workflow_source(kind,jsonb_build_object('id',entity),'view');
 if source->'published_version_id' is distinct from member->'expected_published_version_id'
  or kind='promotion' and source->'draft_revision' is distinct from member->'expected_revision'
  or kind<>'promotion' and (source->>'updated_at')::timestamptz is distinct from (member->>'expected_updated_at')::timestamptz then
  raise exception 'Prepared release member changed' using errcode='40001';end if;
 payload:=case when kind='promotion' then hub.promotion_payload(entity) else hub.residential_payload(kind,entity,false) end;
 if kind<>'promotion' then
  deps:=hub.publication_legacy_dependencies(kind,entity,payload);payload:=payload||jsonb_build_object('_workflow',jsonb_build_object('dependencies',deps));
 end if;
 if item->>'hash' is distinct from hub.web_hash(payload) then raise exception 'Prepared release content changed' using errcode='40001';end if;
 if kind='promotion' then
  -- Source View is required even for a reader who cannot publish.
  perform hub.promotion_read(entity,'{}');
  if independent then perform hub.publication_promotion_check(entity,(source->>'draft_revision')::integer,payload);
  elsif not(hub.promotion_readiness(payload)->>'ready')::boolean then raise exception 'Promotion reviews are incomplete' using errcode='23514';end if;
 else
  for dependency in select * from jsonb_array_elements(deps) loop perform hub.publication_dependency_check(dependency,independent,true);end loop;
 end if;
 return payload;
end $$;

create function hub.publication_queue_publish(publication uuid,expected_digest text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
<<publication_values>>
declare actor uuid:=hub.publication_actor();batch hub.web_publications;item jsonb;page hub.web_pages;previous jsonb;processed jsonb;snapshot jsonb;version uuid;
 outcomes jsonb:='[]';page_count integer:=0;release_result jsonb;final_state text;dependency jsonb;begin
 perform hub.publication_write_lock();select * into batch from hub.web_publications where id=publication for update;
 if not found then raise exception 'Publication not found' using errcode='P0002';end if;
 if batch.state<>'IN_REVIEW' or batch.digest is distinct from expected_digest then raise exception 'Publication changed' using errcode='40001';end if;
 perform hub.web_assert_sources(batch.pages,'view');
 for item in select * from jsonb_array_elements(batch.pages) where value->>'system'='release' loop
  perform hub.content_workflow_source(item#>>'{member,entity_type}',jsonb_build_object('id',item#>>'{member,entity_id}'),'view');
 end loop;
 for item in select * from jsonb_array_elements(batch.pages) loop
  if item->>'system'='release' then
   -- Recheck the exact prepared children under the same source locks. A newly
   -- approved child cannot silently replace the concrete reviewed snapshot.
   begin
    perform hub.publication_release_prepared(item,true);
    release_result:=hub.release_publish(jsonb_build_array(item->'member'),batch.reason,false);
    outcomes:=outcomes||jsonb_build_array(hub.publication_workflow_descriptor(item#>>'{member,entity_type}',jsonb_build_object('id',item#>>'{member,entity_id}'))||
     jsonb_build_object('system','release','member',item->'member','release_id',release_result->'id',
      'status',case when release_result ? 'id' then 'PUBLISHED' else 'REJECTED' end,'rejected',release_result->'rejected'));
    if release_result ? 'id' then page_count:=page_count+1;end if;
   exception when serialization_failure or check_violation or insufficient_privilege then
    outcomes:=outcomes||jsonb_build_array(hub.publication_workflow_descriptor(item#>>'{member,entity_type}',jsonb_build_object('id',item#>>'{member,entity_id}'))||
     jsonb_build_object('system','release','member',item->'member','status','REJECTED',
      'code',case sqlstate when '40001' then 'stale' when '42501' then 'publisher_conflict' else 'not_approved_or_available' end));
   end;continue;
  end if;
  select * into page from hub.web_pages where page_key=item#>>'{snapshot,page_key}' for update;
  if not found or page.published_version_id is distinct from (item->>'previous_version_id')::uuid then
   outcomes:=outcomes||jsonb_build_array(hub.publication_item_descriptor(item->'snapshot')||jsonb_build_object('system','web','page_key',item#>>'{snapshot,page_key}','status','REJECTED','code','pointer_changed'));continue;
  end if;
  select payload into previous from hub.entity_versions where id=page.published_version_id;
  processed:=hub.publication_sanitize(item->'snapshot',previous,true);snapshot:=processed->'value';
  outcomes:=outcomes||jsonb_build_array(hub.publication_item_descriptor(item->'snapshot')||jsonb_build_object('system','web','page_key',page.page_key,'items',processed->'outcomes'));
  if snapshot='null'::jsonb or (processed->>'accepted')::integer=0 then continue;end if;
  -- The final pass includes retained old items and cross-page references, using
  -- their pinned approval evidence and the current source View permissions.
  begin perform hub.web_assert_sources(snapshot,'view',true);
  exception when insufficient_privilege or check_violation then
   outcomes:=outcomes||jsonb_build_array(hub.publication_item_descriptor(item->'snapshot')||jsonb_build_object('system','web','page_key',page.page_key,'status','REJECTED','code','retained_source_unavailable'));continue;
  end;
  snapshot:=snapshot-'json_ld'-'_publication';
  if previous is not null and hub.web_hash(snapshot)=hub.web_hash(previous-'json_ld'-'_publication') then continue;end if;
  insert into hub.entity_versions(entity_type,web_page_id,version_no,payload,content_sha256,publisher,change_reason)
   values('web_page',page.id,(select coalesce(max(version_no),0)+1 from hub.entity_versions where web_page_id=page.id),
    snapshot||jsonb_build_object('_publication',jsonb_build_object('batch_id',batch.id,'published_by',actor)),hub.web_hash(snapshot),actor,batch.reason) returning id into version;
  update hub.web_pages set published_version_id=version where id=page.id returning * into page;
  for dependency in select * from hub.web_dependencies(snapshot) loop
   if dependency->>'table'='faq_versions' then
    update hub.faq_versions set state='PUBLISHED' where id=(dependency#>>'{identity,id}')::uuid and state='APPROVED';
    update hub.faqs set published_version_id=(dependency#>>'{identity,id}')::uuid,state=case when draft_version_id=(dependency#>>'{identity,id}')::uuid then 'PUBLISHED' else state end
     where id=(select faq_id from hub.faq_versions where id=(dependency#>>'{identity,id}')::uuid);
   elsif dependency->>'table'='content_section_versions' then
    update hub.content_section_versions set state='PUBLISHED' where id=(dependency#>>'{identity,id}')::uuid and state='APPROVED';
    update hub.content_sections set published_version_id=(dependency#>>'{identity,id}')::uuid,state=case when draft_version_id=(dependency#>>'{identity,id}')::uuid then 'PUBLISHED' else state end
     where id=(select section_id from hub.content_section_versions where id=(dependency#>>'{identity,id}')::uuid);
   elsif dependency->>'table'='media_links' then update hub.media_links set state='PUBLISHED' where id=(dependency#>>'{identity,id}')::uuid and state<>'WITHDRAWN';
   end if;
  end loop;
  perform hub.web_record_change(page,'publish');page_count:=page_count+1;
 end loop;
 final_state:=case when page_count=0 then 'RETURNED' when exists(select 1 from hub.web_nodes(outcomes) n where n->>'status'='REJECTED') then 'PARTIAL' else 'PUBLISHED' end;
 update hub.web_publications set state=final_state,outcomes=publication_values.outcomes,published_by=actor,published_at=clock_timestamp() where id=batch.id;
 return jsonb_build_object('id',batch.id,'state',final_state,'page_count',page_count,'outcomes',outcomes);
end $$;
create or replace function hub.web_publish(publication uuid,expected_digest text) returns jsonb language sql security definer set search_path=pg_catalog,pg_temp as $$
 select hub.publication_queue_publish(publication,expected_digest)
$$;
create or replace function hub.web_prepare(reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare selections jsonb;begin
 perform hub.publication_actor();select coalesce(jsonb_agg(jsonb_build_object('system','web','page_key',page_key) order by page_key),'[]') into selections from hub.web_pages p where hub.publication_page_visible(p);
 return hub.publication_queue_prepare(selections,reason);
end $$;

create function hub.publication_queue_read() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare page hub.web_pages;candidate jsonb;prepared jsonb;source jsonb;payload jsonb;items jsonb:='[]';previous jsonb;begin
 perform hub.require_permission('knowledge','view');
 for page in select * from hub.web_pages p where hub.publication_page_visible(p) order by page_key loop
  prepared:=hub.publication_enrich(hub.web_compose(page));select v.payload into previous from hub.entity_versions v where id=page.published_version_id;
  candidate:=hub.publication_sanitize(prepared,previous,false);
  if (candidate->>'accepted')::integer>0 then items:=items||jsonb_build_array(jsonb_build_object('system','web','page_key',page.page_key,'items',candidate->'outcomes',
   'previous_version_id',page.published_version_id,'hash',hub.web_hash(prepared))||hub.publication_workflow_descriptor('page_config',jsonb_build_object('id',page.id)));end if;
 end loop;
 for candidate in select * from jsonb_array_elements(hub.publication_release_candidates(false)->'items') loop
  begin
   source:=hub.content_workflow_source(candidate->>'entity_type',jsonb_build_object('id',candidate->>'entity_id'),'view');
   if candidate->>'entity_type'='promotion' then
    if source->'returned_revision'=source->'draft_revision' or not(candidate#>>'{readiness,ready}')::boolean then continue;end if;
   else
    payload:=hub.residential_payload(candidate->>'entity_type',(candidate->>'entity_id')::uuid,false);
    for prepared in select * from jsonb_array_elements(hub.publication_legacy_dependencies(candidate->>'entity_type',(candidate->>'entity_id')::uuid,payload)) loop
     perform hub.publication_dependency_check(prepared,false,true);
    end loop;
   end if;
   items:=items||jsonb_build_array(jsonb_build_object('system','release','entity_type',candidate->>'entity_type','entity_id',candidate->>'entity_id','public_id',candidate->>'public_id',
    'expected_updated_at',candidate->'expected_updated_at','expected_revision',candidate->'expected_revision','expected_published_version_id',candidate->'expected_published_version_id')
    ||hub.publication_workflow_descriptor(candidate->>'entity_type',jsonb_build_object('id',candidate->>'entity_id')));
  exception when insufficient_privilege or check_violation or serialization_failure or no_data_found then null;end;
 end loop;
 return jsonb_build_object('items',items,'web_history',hub.web_workspace()->'publications','release_history',hub.release_read(null)->'items',
  'can_publish',hub.can_special('knowledge','knowledge.publish_web'));
end $$;

create function hub.publication_queue_return(kind text,identity jsonb,expected_hash text,reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid:=hub.publication_actor();source jsonb;version jsonb;table_name text;begin
 reason:=hub.content_review_reason(reason,true);perform hub.publication_write_lock();
 source:=hub.content_workflow_lock(kind,identity,expected_hash,'view');version:=hub.content_workflow_version(kind,identity,source);
 perform set_config('app.content_review_reason',reason,true);perform set_config('app.change_reason',reason,true);
 if kind='promotion' then
  if not(hub.promotion_readiness(hub.promotion_payload((source->>'id')::uuid))->>'ready')::boolean then raise exception 'Only an approved promotion can be returned' using errcode='23514';end if;
  update hub.public_promotions set returned_revision=draft_revision,return_reason=reason,returned_by=actor,returned_at=clock_timestamp() where id=(source->>'id')::uuid;
  return jsonb_build_object('kind',kind,'identity',identity,'state','RETURNED');
 end if;
 if upper(coalesce(version->>'state',case when kind='question' and source->>'status'='approved' then 'APPROVED' end,''))<>'APPROVED' then raise exception 'Only an approved item can be returned' using errcode='23514';end if;
 case kind
 when 'faq' then
  update hub.faq_versions set state='RETURNED' where id=(version->>'id')::uuid;
  update hub.faqs set state='RETURNED',revision=revision+1 where id=(source->>'id')::uuid;
 when 'section' then
  update hub.content_section_versions set state='RETURNED' where id=(version->>'id')::uuid;
  update hub.content_sections set state='RETURNED',revision=revision+1 where id=(source->>'id')::uuid;
 when 'article' then
  update hub.article_versions set state='RETURNED' where id=(version->>'id')::uuid;
  update hub.articles set state='RETURNED',revision=revision+1 where id=(source->>'id')::uuid;
 when 'unit_type' then
  update hub.commercial_type_versions set state='returned' where id=(version->>'id')::uuid;
  update hub.commercial_types set status='draft',revision=revision+1 where id=(source->>'id')::uuid;
 when 'price' then
  update hub.project_price_versions set state='returned' where id=(version->>'id')::uuid;
  update hub.project_prices set state='draft',revision=revision+1 where id=(source->>'id')::uuid;
 when 'disclosure','sales_term','programme','progress' then
  update hub.project_commercial_versions set state='returned' where id=(version->>'id')::uuid;
  table_name:=hub.content_workflow_table(kind);execute format('update hub.%I set state=''draft'',revision=revision+1 where id=$1',table_name) using (source->>'id')::uuid;
 when 'selling_point' then
  update hub.project_selling_points set state='RETURNED',decision_reason=reason where project_id=(source->>'project_id')::uuid and point_key=(source->>'point_key')::uuid and revision=(source->>'revision')::integer;
 when 'question' then
  update hub.faq_questions set review_state='RETURNED',status='proposed',revision=revision+1,decision_reason=reason where question_key=source->>'question_key';
  insert into hub.faq_question_versions(question_key,revision,payload) select question_key,revision,to_jsonb(q) from hub.faq_questions q where question_key=source->>'question_key';
 else
  update hub.content_review_versions set state='RETURNED',decision_reason=reason,updated_by=actor,updated_at=clock_timestamp() where id=(version->>'id')::uuid;
  if kind='solar' then update hub.solar_estimates set state='draft',revision=revision+1 where id=(source->>'id')::uuid;
  elsif kind='glossary' then update hub.translation_glossary set status='proposed',revision=revision+1 where term_key=source->>'term_key';end if;
 end case;
 return hub.content_workflow_read(kind,identity);
end $$;

-- A missing brand and a JSON-null brand both contain no source content.
-- Keep the existing cross-tab projection and its ACL; fix only presence tests.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('hub.project_permission_projection(jsonb)'::regprocedure);
 definition:=hub.publication_replace(definition,'payload->''brand'' is null','nullif(payload->''brand'',''null''::jsonb) is null');
 definition:=hub.publication_replace(definition,'payload->''brand_summary'' is null','nullif(payload->''brand_summary'',''null''::jsonb) is null');
 execute definition;
end $$;

-- One review route for both histories. The outgoing projections never return
-- raw source rows, approval contributor arrays or private storage metadata.
create or replace function hub.web_publication_read(publication uuid,locale text default 'th') returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare batch hub.web_publications;item jsonb;pages jsonb:='[]';previous jsonb;processed jsonb;preview jsonb;review jsonb;descriptor jsonb;
 source jsonb;dependency jsonb;items jsonb;entry jsonb;kind text;failure text;item_failure text;eligible boolean;publishable boolean:=false;
 previous_evidence jsonb;previous_review jsonb;preview_snapshot jsonb;previous_redacted boolean;preview_redacted boolean;begin
 if locale not in ('th','en') then raise exception 'Invalid locale' using errcode='23514';end if;
 perform hub.require_permission('knowledge','view');select * into batch from hub.web_publications where id=publication;
 if not found then raise exception 'Publication not found' using errcode='P0002';end if;
 perform hub.web_assert_sources(batch.pages,'view');
 eligible:=batch.state='IN_REVIEW' and hub.can_special('knowledge','knowledge.publish_web');
 for item in select * from jsonb_array_elements(batch.pages) loop
  previous_redacted:=false;preview_redacted:=false;previous_evidence:=null;
  if item->>'system'='release' then
   kind:=item#>>'{member,entity_type}';source:=hub.content_workflow_source(kind,jsonb_build_object('id',item#>>'{member,entity_id}'),'view');
   descriptor:=hub.publication_workflow_descriptor(kind,jsonb_build_object('id',item#>>'{member,entity_id}'));
   previous:=null;
   if kind='project' then select payload,review_evidence into previous,previous_evidence from hub.entity_versions where id=(item#>>'{member,expected_published_version_id}')::uuid and project_id=(source->>'id')::uuid;
   elsif kind='brand' then select payload,review_evidence into previous,previous_evidence from hub.brand_versions where id=(item#>>'{member,expected_published_version_id}')::uuid and brand_id=(source->>'id')::uuid;
   else select payload,review_evidence into previous,previous_evidence from hub.promotion_versions where id=(item#>>'{member,expected_published_version_id}')::uuid and promotion_id=(source->>'id')::uuid;end if;
   review:=hub.publication_review(kind,item->'snapshot',kind='project');
   preview:=review->'publication_preview';
   preview_redacted:=coalesce((review->>'publication_preview_redacted')::boolean,false);
   if previous is not null then
    begin
     perform hub.require_permission(hub.content_member_tab(kind),'view');
     perform hub.web_assert_sources(jsonb_build_array(previous,previous_evidence),'view');
     for dependency in select * from hub.web_dependencies(jsonb_build_array(previous,previous_evidence)) loop
      if dependency->>'table'='assets' then perform hub.require_asset_access((dependency#>>'{identity,id}')::uuid);end if;
     end loop;
     previous_review:=hub.publication_review(kind,previous);
     previous_redacted:=coalesce((previous_review->>'publication_preview_redacted')::boolean,false);
     previous:=case when not previous_redacted then previous_review->'publication_preview' end;
    exception when insufficient_privilege or no_data_found then previous:=null;previous_redacted:=true;end;
   end if;
   failure:=null;
   begin perform hub.publication_release_prepared(item,eligible);
   exception when serialization_failure then failure:='stale';when insufficient_privilege then failure:='publisher_conflict';
    when check_violation or no_data_found then failure:='not_approved_or_available';end;
   if coalesce((review->>'publication_preview_redacted')::boolean,false) then failure:='not_approved_or_available';end if;
   if eligible and failure is null then publishable:=true;end if;
   items:='[]';
   for dependency in select * from jsonb_array_elements(coalesce(item#>'{snapshot,_workflow,dependencies}','[]')) loop
    entry:=hub.publication_item_descriptor(jsonb_build_object('_item',true,'dependencies',jsonb_build_array(dependency)));item_failure:=null;
    begin perform hub.publication_dependency_check(dependency,eligible,true);
    exception when serialization_failure then item_failure:='stale';when insufficient_privilege then item_failure:='publisher_conflict';
     when check_violation or no_data_found then item_failure:='not_approved_or_available';end;
    if not exists(select 1 from jsonb_array_elements(items) prior where prior->'workflow'->'kind'=entry->'workflow'->'kind' and prior->'workflow'->'identity'=entry->'workflow'->'identity') then
     items:=items||jsonb_build_array(entry||jsonb_strip_nulls(jsonb_build_object('status',case when item_failure is null then 'APPROVED' else 'REJECTED' end,'code',item_failure)));
    end if;
   end loop;
   if items='[]' then items:=jsonb_build_array(descriptor||jsonb_strip_nulls(jsonb_build_object('item_key','release:'||kind||':'||(source->>'id'),
    'status',case when failure is null then 'APPROVED' else 'REJECTED' end,'code',failure)));end if;
   if failure='stale' then descriptor:=descriptor||jsonb_build_object('can_return',false);end if;
   pages:=pages||jsonb_build_array(descriptor||jsonb_strip_nulls(jsonb_build_object('system','release','member',item->'member','hash',item->'hash',
    'previous',previous,'previous_redacted',previous_redacted,'preview',preview,'preview_redacted',preview_redacted,'items',items,'status',case when failure is null then 'APPROVED' else 'REJECTED' end,'code',failure)));
   continue;
  end if;
  select payload into previous from hub.entity_versions where id=(item->>'previous_version_id')::uuid;
  processed:=hub.publication_sanitize(item->'snapshot',previous,eligible);
  -- The before pane has its own current View boundary. A hidden old-only
  -- source does not remove an independently authorized prepared after pane.
  if previous is not null then
   begin
    perform hub.web_assert_sources(previous,'view');
    for dependency in select * from hub.web_dependencies(previous) loop
     if dependency->>'table'='assets' then perform hub.require_asset_access((dependency#>>'{identity,id}')::uuid);end if;
    end loop;
   exception when insufficient_privilege or no_data_found then previous:=null;previous_redacted:=true;end;
  end if;
  failure:=null;
  if not exists(select 1 from hub.web_pages p where p.page_key=item#>>'{snapshot,page_key}' and p.published_version_id is not distinct from (item->>'previous_version_id')::uuid) then failure:='pointer_changed';end if;
  if processed->'value'<>'null'::jsonb then
   -- Sanitization may retain an older approved item. Check every retained
   -- dependency for all readers before producing any JSON, HTML or assets.
   begin
    perform hub.web_assert_sources(processed->'value','view');
    for dependency in select * from hub.web_dependencies(processed->'value') loop
     if dependency->>'table'='assets' then perform hub.require_asset_access((dependency#>>'{identity,id}')::uuid);end if;
    end loop;
   exception when insufficient_privilege or no_data_found then
    preview_redacted:=true;failure:='retained_source_unavailable';processed:=jsonb_set(processed,'{value}','null');end;
   if not preview_redacted and eligible then
    begin perform hub.web_assert_sources(processed->'value','view',true);
    exception when insufficient_privilege or check_violation then failure:='retained_source_unavailable';end;
   end if;
  end if;
  preview_snapshot:=coalesce(nullif(processed->'value','null'),jsonb_set(item->'snapshot','{body}','{}'));
  preview:=hub.web_output(preview_snapshot,case when item#>'{snapshot,locales}' ? locale then locale else 'th' end);
  descriptor:=hub.publication_item_descriptor(item->'snapshot');
  if eligible and failure is null and processed->'value'<>'null'::jsonb and (processed->>'accepted')::integer>0 then publishable:=true;end if;
  pages:=pages||jsonb_build_array(descriptor||jsonb_strip_nulls(jsonb_build_object('system','web','page_key',item#>>'{snapshot,page_key}','hash',item->'hash','issues',item->'issues',
   'previous',case when previous is not null then hub.web_output(previous,case when previous->'locales' ? locale then locale else 'th' end) end,
   'previous_redacted',previous_redacted,'preview_redacted',preview_redacted,
   'preview',preview,'preview_assets',hub.web_preview_assets(preview_snapshot),'previous_assets',case when previous is not null then hub.web_preview_assets(previous) end,
   'items',processed->'outcomes','accepted',(processed->>'accepted')::integer,'status',case when failure is null then 'APPROVED' else 'REJECTED' end,'code',failure,
   'resolved_phases',coalesce((select jsonb_agg(n->'data'->>'public_project_id') from hub.web_nodes(item->'snapshot') n where n->'data' ?& array['public_project_id','facts']),'[]'),
   'resolved_applicability',coalesce((select jsonb_agg(distinct jsonb_build_object('question_key',n->>'question_key','rem_project_ids',n->'resolved_project_ids'))
    from hub.web_nodes(item->'snapshot') n where n ? '_faq' and n ? 'resolved_project_ids'),'[]'))));
 end loop;
 -- A rejected item cannot disable an eligible neighbour, but a batch with no
 -- eligible item offers no publish action. The write rechecks each item again.
 return (to_jsonb(batch)-array['pages','editors'])||jsonb_build_object('pages',pages,'can_publish',publishable);
end $$;

-- Promotion return lifecycle metadata never enters the outgoing payload.
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.promotion_payload(uuid)'::regprocedure);
 d:=hub.publication_replace(d,'''published_version_id'',''editors''','''published_version_id'',''editors'',''returned_revision'',''return_reason'',''returned_by'',''returned_at''');execute d;
end $$;

-- Exact current-source targets for the private W2 task hook. Native rows
-- retain their established public-unit IDs and per-family expiry semantics.
create function hub.publication_task_context(kind text,source jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare c jsonb;context jsonb;tab text;field text;begin
 select value into c from hub.workspace_history_contexts('hub.'||hub.content_workflow_table(kind),source) value limit 1;
 if c is null then return null;end if;
 context:=hub.workspace_context(c->>'kind',c->>'ref');
 tab:=case kind when 'question' then 'bank' when 'glossary' then 'glossary' when 'section' then 'narrative'
  when 'selling_point' then 'narrative' when 'contact' then 'contacts' when 'fact' then 'facts' when 'building' then 'buildings'
  when 'facility' then 'facilities' when 'feature' then 'features' when 'solar' then 'features' when 'place' then 'nearby'
  when 'asset' then 'media' when 'project_asset' then 'media' when 'brand_asset' then 'media' when 'type_asset' then 'media'
  when 'asset_context' then 'media' when 'media_link' then 'media' when 'media_target' then 'media'
  when 'model' then 'unit-types' when 'page_config' then 'publication' else 'overview' end;
 field:=case kind when 'question' then 'faq_question.question_template' when 'glossary' then 'glossary.term'
  when 'section' then source->>'section_key' when 'selling_point' then 'selling_point.title'
  when 'contact' then 'contact.value' when 'fact' then source->>'fact_key' when 'building' then 'building.name'
  when 'facility' then 'facility.display_name' when 'feature' then 'feature.description' when 'solar' then 'solar_estimate.usage_profile'
  when 'place' then 'place.name' when 'asset' then 'asset.'||coalesce(source->>'media_category','metadata')
  when 'page_config' then 'page.url' when 'model' then 'model.public_name' when 'project' then 'project.public_name' when 'brand' then 'brand.public_name' end;
 return context||jsonb_strip_nulls(jsonb_build_object('tab',tab,'field',field,'kind',kind,
  'item',coalesce(source->>'id',source->>'point_key',source->>'question_key',source->>'term_key',source->>'building_key',source->>'facility_code'),
  'section',case when kind in ('asset','asset_context') then 'upload'
   when kind in ('project_asset','brand_asset','type_asset') then 'canonical'
   when kind in ('media_link','media_target') then 'clips' else source->>'section_key' end,
  'asset_id',case when kind='asset' then source->>'id' when kind in ('asset_context','project_asset','brand_asset','type_asset') then source->>'asset_id' end,
  'media_role',case when kind in ('project_asset','brand_asset','type_asset') then source->>'asset_role' end,
  'question',source->>'question_key','term',source->>'term_key','building',source->>'building_key',
  'grain',source->>'grain','facility',source->>'facility_code','media_category',source->>'media_category','usage',coalesce(source->>'usage',source->>'asset_role'),
  'target_type',source->>'target_type','target_key',source->>'target_key','floor_from',source->'floor_from','floor_to',source->'floor_to',
  'binding',case when kind in ('project_asset','brand_asset','type_asset','asset_context','media_target') then source->>'id' end,
  'unit_type',(select public_commercial_type_id from hub.commercial_types where id=(source->>'commercial_type_id')::uuid and deleted_at is null),
  'page',source->>'page_key'));
end $$;
-- A native narrative/FAQ/article task must pass the same included-item
-- graph as publication, including question/fact/reference authority and exact
-- dependency contributors. Registry question/glossary approvals have no
-- standalone publication action; their consumers supply publication tasks.
create function hub.publication_task_native_ready(kind text,source jsonb,version jsonb) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare nodes jsonb:='[]';project uuid;node jsonb;checked jsonb;scope text:=source->>'scope_type';begin
 if kind in ('question','glossary') then return false;end if;
 if kind='section' then nodes:=hub.web_sections(scope,source->>'scope_id');
 elsif kind='faq' then
  if scope in ('brand','corporate','programme') then nodes:=hub.web_scope_faq(scope,source->>'scope_id');
  else
   foreach project in array hub.workspace_projects(case scope when 'rem_project_group' then 'project_group' else scope end,source->>'scope_id') loop
    begin
     perform hub.content_scope_access('project',(select public_project_id from hub.projects where id=project),'view');
     nodes:=nodes||coalesce(hub.web_faqs(project)->'items','[]');
    exception when insufficient_privilege or no_data_found then continue;end;
   end loop;
  end if;
 elsif kind='article' then nodes:=jsonb_build_array(hub.web_article(source->>'slug'));
 else return true;end if;
 for node in select * from jsonb_array_elements(nodes) loop
  if not exists(select 1 from hub.web_dependencies(node) d where d#>>'{approval,version_id}'=version->>'id') then continue;end if;
  checked:=hub.publication_sanitize(hub.publication_enrich(node),null,true);
  if checked->'value' is not null and checked->'value'<>'null'::jsonb and (checked->>'accepted')::integer>0 then return true;end if;
 end loop;return false;
 exception when insufficient_privilege or no_data_found or check_violation or serialization_failure then return false;
end $$;
create function hub.publication_task_published(dependency jsonb) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from (
  select d from hub.web_pages p join hub.entity_versions v on v.id=p.published_version_id cross join lateral hub.web_dependencies(v.payload) d
  union all select d from hub.projects p join hub.entity_versions v on v.id=p.published_version_id
   cross join lateral jsonb_array_elements(coalesce(v.review_evidence->'dependencies','[]')) d
  union all select d from hub.brands b join hub.brand_versions v on v.id=b.published_version_id
   cross join lateral jsonb_array_elements(coalesce(v.review_evidence->'dependencies','[]')) d
  union all select d from hub.public_promotions p join hub.promotion_versions v on v.id=p.published_version_id
   cross join lateral jsonb_array_elements(coalesce(v.review_evidence->'dependencies','[]')) d
 ) included where d->>'table'=dependency->>'table' and d->'identity'=dependency->'identity'
  and d#>'{approval,version_id}'=dependency#>'{approval,version_id}' and d->>'hash'=dependency->>'hash')
$$;
-- Keep the original expiry/review-due projection, but replace every lifecycle
-- task with current guarded native or generic certificate evidence.
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.workspace_content_tasks(text,text)'::regprocedure);
 d:=hub.content_definition_replace(d,'FUNCTION hub.workspace_content_tasks(','FUNCTION hub.publication_expiry_tasks(');execute d;
end $$;
create or replace function hub.workspace_content_tasks(bud text default null,brand text default null) returns setof jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare actor text:=hub.workspace_require()::text;r jsonb;source jsonb;version jsonb;identity jsonb;kind text;state text;context jsonb;scope_type text;scope_id text;
 category text;base jsonb;dependency jsonb;native jsonb;can_review boolean;drift boolean;phases text[];table_name text;dependency_identity jsonb;authors jsonb;begin
 return query select x from hub.publication_expiry_tasks(bud,brand) x where x->>'category' in ('expiring','review_due');
 for r in
  select n||jsonb_build_object('kind',case n->>'kind' when 'construction_progress' then 'progress' else n->>'kind' end) from hub.workspace_native_rows() n
   where n->>'kind' in ('section','faq','unit_type','price','disclosure','sales_term','programme','construction_progress','article','question','promotion')
  union all
  select jsonb_build_object('kind',v.kind,'identity',v.identity,'version',to_jsonb(v)) from
   (select distinct on(cv.kind,cv.identity) cv.* from hub.content_review_versions cv order by cv.kind,cv.identity,cv.version_no desc) v
  union all
  select jsonb_build_object('kind','selling_point','identity',hub.content_workflow_identity('selling_point',to_jsonb(p)),'version',to_jsonb(p))
   from (select distinct on(project_id,point_key) * from hub.project_selling_points order by project_id,point_key,revision desc) p
 loop
  begin
   kind:=r->>'kind';native:=null;
   identity:=case when r ? 'item_id' then case kind when 'question' then jsonb_build_object('question_key',r->>'item_id') else jsonb_build_object('id',r->>'item_id') end else r->'identity' end;
   source:=hub.content_workflow_source(kind,identity,'view');version:=hub.content_workflow_version(kind,identity,source);
   -- Native return increments its mutable parent without editing the returned
   -- immutable version. The W2 selector verifies that exact one-revision gap.
   if version is null and r->>'state'='RETURNED' then version:=r->'version';end if;
   if version is null then continue;end if;
   state:=upper(coalesce(case when kind='question' then source->>'review_state' end,version->>'state',case when kind='question' and source->>'status'='approved' then 'APPROVED' end,'DRAFT'));
   if version ? 'source_hash' and hub.content_workflow_payload(kind,version->'payload')-'_staged_values'
    is distinct from hub.content_workflow_payload(kind,source)-'_staged_values' then continue;end if;
   if upper(coalesce(source->>'state',source->>'status','')) in ('WITHDRAWN','RETIRED') then continue;end if;
   if r ? 'context' then native:=r;
   else select n into native from hub.workspace_native_rows() n where n->>'kind'=kind and n->>'item_id'=coalesce(source->>'id',source->>'term_key') limit 1;end if;
   context:=coalesce(native->'context',hub.publication_task_context(kind,source));if context is null then continue;end if;
   scope_type:=coalesce(native->>'scope_type',context->>'scope_type');scope_id:=coalesce(native->>'scope_id',context->>'scope_id');
   phases:=array(select jsonb_array_elements_text(coalesce(native->'phases','[]')));
   if not hub.workspace_scope_matches(scope_type,scope_id,phases,bud,brand) then continue;end if;
   drift:=version->>'staged_invalidated_at' is not null or
    (coalesce(nullif(version#>'{payload,_staged_values}','null'),nullif(version->'staged_evidence','null'),'{}')-'_disclosure_sources') is distinct from ((case when kind='disclosure' then hub.content_workflow_staged_values(kind,source||jsonb_build_object('_disclosure_sources',version#>'{staged_evidence,_disclosure_sources}')) else coalesce(source->'_staged_values','{}') end)-'_disclosure_sources');
   can_review:=false;
   begin perform hub.content_workflow_source(kind,identity,'approve');can_review:=true;
   exception when insufficient_privilege or no_data_found then can_review:=false;end;
   authors:=case when kind='selling_point' then to_jsonb(hub.content_workflow_authors(kind,identity,source)) else coalesce(version->'editors',to_jsonb(hub.content_workflow_authors(kind,identity,source))) end;
   if kind='promotion' then
    authors:=coalesce(source->'editors','[]')||coalesce(native->'reviewers','[]');
    can_review:=can_review and not(authors?actor);
    if state='DRAFT' and native->>'state'='IN_REVIEW' then state:='IN_REVIEW';end if;
   end if;
   category:=case when state='RETURNED' and authors?actor then 'returned'
    when can_review and (state='IN_REVIEW' or state='APPROVED' and drift) then 'approval' end;
   if category is null and state='APPROVED' and not drift and hub.can_special('knowledge','knowledge.publish_web') then
    begin
     perform hub.publication_actor();
     if kind='promotion' then
      perform hub.publication_promotion_check((source->>'id')::uuid,(source->>'draft_revision')::integer,hub.promotion_payload((source->>'id')::uuid));
      if not exists(select 1 from hub.public_promotions p join hub.promotion_versions v on v.id=p.published_version_id
       where p.id=(source->>'id')::uuid and v.draft_revision=(source->>'draft_revision')::integer) then category:='publish';end if;
     else
      table_name:=case kind when 'faq' then 'faq_versions' when 'section' then 'content_section_versions' when 'article' then 'article_versions'
       when 'unit_type' then 'commercial_type_versions' when 'price' then 'project_price_versions'
       when 'disclosure' then 'project_commercial_versions' when 'sales_term' then 'project_commercial_versions'
       when 'programme' then 'project_commercial_versions' when 'progress' then 'project_commercial_versions' else hub.content_workflow_table(kind) end;
      dependency_identity:=case when table_name in ('faq_versions','content_section_versions','article_versions','commercial_type_versions','project_price_versions','project_commercial_versions')
       then jsonb_build_object('id',version->>'id') when kind='selling_point' then identity||jsonb_build_object('revision',source->'revision') else identity end;
      dependency:=hub.web_dependency(table_name,dependency_identity,source->>'_tab');
      perform hub.publication_dependency_check(dependency,true,true);
      if (native is null or coalesce((native->>'ready')::boolean,false) and coalesce((native->>'current_material')::boolean,false))
       and hub.publication_task_native_ready(kind,source,version) and not hub.publication_task_published(dependency) then category:='publish';end if;
     end if;
    exception when insufficient_privilege or no_data_found or check_violation or serialization_failure then category:=null;end;
   end if;
   if category is null then continue;end if;
   -- Keep the existing home-task kind while the workflow uses its own progress key.
   base:=jsonb_build_object('kind',case when kind='progress' then 'construction_progress' else kind end,'item_id',coalesce(r->>'item_id',source->>'id',source->>'point_key',source->>'question_key',source->>'term_key',source->>'building_key',source->>'facility_code'),
    'version_id',case when kind not in ('question','promotion') then version->'id' end,'version_no',coalesce(version->'version_no',version->'revision',source->'draft_revision'),
    'source_tab',source->>'_tab','scope_type',scope_type,'scope_id',scope_id,'label',coalesce(native->'label',source->'public_name',source->'label',source->'title',source->'name',jsonb_build_object('th',coalesce(source->>'fact_key',source->>'building_key',source->>'facility_code',source->>'page_key',kind))),
    'state',state,'identity',identity,'expected_hash',hub.content_workflow_hash(source),'needs_reapproval',drift,
    'context',context||jsonb_strip_nulls(jsonb_build_object('version',case when kind not in ('question','promotion') then version->'id' end,'revision',coalesce(version->'version_no',version->'revision',source->'draft_revision'))),
    'decision_reason',coalesce(version->'decision_reason',source->'decision_reason',source->'return_reason'));
   return next base||jsonb_build_object('id',category||':'||kind||':'||hub.web_hash(identity)||':'||coalesce(version->>'id',version->>'revision',source->>'draft_revision'),'category',category);
  exception when insufficient_privilege or no_data_found then continue;end;
 end loop;
end $$;
revoke all on function hub.workspace_content_tasks(text,text) from public,hub_app;

-- Header submission reads saved own-source drafts independently of mounted UI
-- sections. This is one bounded metadata RPC; mutations remain per-item and
-- retain the original submitted hash. It never expands inherited ownership.
create function hub.content_workflow_items(level text,ref text,phase text default null,after_key text default null,page_size integer default 50) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects;brand uuid;unit_id uuid;source_view boolean:=false;project_view boolean:=false;faq_scope jsonb;
 scope_phase text;scope_ref text:=ref;item record;metadata jsonb;descriptor jsonb;target jsonb;items jsonb:='[]';
 cursor jsonb;after_item text;last_item text;has_more boolean:=false;begin
 if level is null or level not in ('corporate','brand','project','programme','project_group','unit_type')
  or ref is null or length(ref) not between 1 and 200 or page_size is null or page_size not between 1 and 100
  or length(coalesce(phase,''))>200 or length(coalesce(after_key,''))>8192
  or phase is not null and level not in ('project','unit_type') then raise exception 'Invalid saved-item query' using errcode='23514';end if;
 source_view:=hub.content_scope_allowed(level,ref,'view');
 if source_view and level in ('project','unit_type') then p:=hub.workspace_phase(level,ref,phase);end if;
 begin faq_scope:=hub.workspace_faq_scope_access(level,ref,phase,'view');
 exception when insufficient_privilege or no_data_found then faq_scope:=null;end;
 if not source_view and faq_scope is null then perform hub.content_scope_access(level,ref,'view');end if;
 if p.id is null and level in ('project','unit_type') and faq_scope is not null then
  select * into p from hub.projects where id=(faq_scope#>>'{selected,id}')::uuid;
 end if;
 if level in ('project','unit_type') then
  if p.id is null then raise exception 'Saved-item phase not found' using errcode='P0002';end if;
  scope_phase:=p.rem_project_id;project_view:=hub.content_scope_allowed('project',p.public_project_id,'view');
 end if;
 if level='project' then scope_ref:=p.public_project_id;
 elsif level='brand' then select id into brand from hub.brands where public_brand_id=ref and deleted_at is null;
 elsif level='unit_type' then select id into unit_id from hub.commercial_types where id::text=ref and project_id=p.id and deleted_at is null;end if;
 if after_key is not null then
  begin cursor:=convert_from(decode(after_key,'hex'),'UTF8')::jsonb;
  exception when data_exception then raise exception 'Invalid saved-item cursor' using errcode='23514';end;
  if jsonb_typeof(cursor) is distinct from 'object' or cursor-array['level','ref','phase','key']<>'{}'
   or cursor->>'level' is distinct from level or cursor->>'ref' is distinct from ref
   or cursor->>'phase' is distinct from scope_phase or jsonb_typeof(cursor->'key') is distinct from 'string'
   or length(cursor->>'key') not between 1 and 800 then raise exception 'Saved-item cursor belongs to another scope' using errcode='23514';end if;
  after_item:=cursor->>'key';
 end if;
 for item in
  with own_bindings as (
   select 'project_asset'::text kind,to_jsonb(a) value,a.asset_id from hub.entity_assets a
    where project_view and level='project' and a.project_id=p.id and a.deleted_at is null
   union all select 'type_asset',to_jsonb(a),a.asset_id from hub.commercial_type_assets a
    where project_view and a.project_id=p.id and a.deleted_at is null and (level='project' or level='unit_type' and a.commercial_type_id=unit_id)
   union all select 'asset_context',to_jsonb(a),a.asset_id from hub.asset_links a
    where project_view and a.project_id=p.id and a.deleted_at is null and (level='project' or level='unit_type' and a.target_type='commercial_type' and a.target_key=unit_id::text)
   union all select 'brand_asset',to_jsonb(a),a.asset_id from hub.brand_assets a
    where source_view and level='brand' and a.brand_id=brand and a.deleted_at is null
  ), own_clips as (
   select m.* from hub.media_links m where project_view and m.project_id=p.id and m.state<>'WITHDRAWN'
    and (level='project' or level='unit_type' and exists(select 1 from hub.media_link_targets t where t.media_link_id=m.id and t.target_type='commercial_type' and t.target_key=unit_id::text))
  ), candidates as (
   select 'project'::text kind,to_jsonb(x) value from hub.projects x where project_view and level='project' and x.id=p.id and x.deleted_at is null
   union all select 'brand',to_jsonb(x) from hub.brands x where source_view and level='brand' and x.id=brand and x.deleted_at is null
   union all select 'model',to_jsonb(x) from hub.model_types x where project_view and level='project' and x.project_id=p.id and x.deleted_at is null and x.match_status<>'REJECTED'
   union all select 'section',to_jsonb(x) from hub.content_sections x where source_view
    and (x.scope_type=level or level='project_group' and x.scope_type='rem_project_group') and x.scope_id=scope_ref
   union all select 'contact',to_jsonb(x) from hub.contacts x where source_view and x.scope_type=level and x.scope_id=scope_ref
   union all select 'faq',to_jsonb(x) from hub.faqs x where faq_scope is not null
    and (x.scope_type=level or level='project_group' and x.scope_type='rem_project_group')
    and x.scope_id=case when level='project' then p.rem_project_id else ref end
   union all select 'selling_point',to_jsonb(x) from (select distinct on(point_key) * from hub.project_selling_points
    where project_view and level='project' and project_id=p.id order by point_key,revision desc) x
   union all select 'fact',to_jsonb(x) from hub.project_facts x where project_view and level='project' and x.project_id=p.id
   union all select 'building',to_jsonb(x) from hub.project_buildings x where project_view and level='project' and x.project_id=p.id
   union all select 'facility',to_jsonb(x) from hub.project_facilities x where project_view and level='project' and x.project_id=p.id
   union all select 'feature',to_jsonb(x) from hub.project_features x where project_view and level='project' and x.project_id=p.id
   union all select 'place',to_jsonb(x) from hub.project_places x where project_view and level='project' and x.project_id=p.id
   union all select 'solar',to_jsonb(x) from hub.solar_estimates x where project_view and level='project' and x.project_id=p.id and x.state<>'withdrawn'
   union all select 'unit_type',to_jsonb(x) from hub.commercial_types x where project_view and x.project_id=p.id and x.deleted_at is null
    and (level='project' or level='unit_type' and x.id=unit_id)
   union all select 'price',to_jsonb(x) from hub.project_prices x where project_view and x.project_id=p.id
    and (level='project' or level='unit_type' and x.commercial_type_id=unit_id)
   union all select 'disclosure',to_jsonb(x) from hub.project_disclosures x where project_view and level='project' and x.project_id=p.id
   union all select 'sales_term',to_jsonb(x) from hub.project_sales_terms x where project_view and level='project' and x.project_id=p.id
   union all select 'programme',to_jsonb(x) from hub.project_programmes x where project_view and level='project' and x.project_id=p.id
   union all select 'progress',to_jsonb(x) from hub.project_progress x where project_view and level='project' and x.project_id=p.id
   union all select kind,value from own_bindings
   union all select 'asset',to_jsonb(x) from hub.assets x where x.deleted_at is null and
    (exists(select 1 from own_bindings b where b.asset_id=x.id) or exists(select 1 from own_clips m where m.thumbnail_asset_id=x.id))
   union all select 'media_link',to_jsonb(x) from own_clips x
   union all select 'media_target',to_jsonb(x) from hub.media_link_targets x join own_clips m on m.id=x.media_link_id
    where level='project' or level='unit_type' and x.target_type='commercial_type' and x.target_key=unit_id::text
  ), identified as (
   select kind,hub.content_workflow_identity(kind,value) identity from candidates
  ) select kind,identity,kind||':'||identity::text key from identified order by key
 loop
  if after_item is not null and item.key<=after_item then continue;end if;
  begin
   -- Reuse the command metadata calculation exactly. The private read may
   -- inspect its bounded history, but none of that history leaves this RPC.
   metadata:=hub.content_workflow_read(item.kind,item.identity);
   if not coalesce((metadata->>'can_submit')::boolean,false)
    or not(metadata->>'state'='DRAFT' or coalesce((metadata->>'needs_reapproval')::boolean,false)) then continue;end if;
   if jsonb_array_length(items)=page_size then has_more:=true;exit;end if;
   descriptor:=hub.publication_workflow_descriptor(item.kind,item.identity);
   target:=descriptor->'target';
   if target is not null then target:=target||jsonb_build_object('level',level,'id',ref,'phase',scope_phase);end if;
   items:=items||jsonb_build_array(jsonb_build_object('kind',item.kind,'identity',item.identity,
    'expected_hash',metadata->'expected_hash','source_revision',metadata->'source_revision','source_updated_at',metadata->'source_updated_at',
    'state',metadata->'state','can_submit',metadata->'can_submit','can_edit',metadata->'can_edit',
    'source_tab',metadata->'source_tab','source_tabs',metadata->'source_tabs',
    'label',descriptor->'label','target',target,'href',null));last_item:=item.key;
  exception when insufficient_privilege or no_data_found then continue;end;
 end loop;
 return jsonb_build_object('scope',jsonb_build_object('level',level,'id',ref,'phase',scope_phase),'items',items,
  'next_cursor',case when has_more then encode(convert_to(jsonb_build_object('level',level,'ref',ref,'phase',scope_phase,'key',last_item)::text,'UTF8'),'hex') end);
end $$;
revoke all on function hub.content_workflow_items(text,text,text,text,integer) from public;
grant execute on function hub.content_workflow_items(text,text,text,text,integer) to hub_app;

-- Only the four public queue entry points are callable by runtime actors.
do $$ declare signature regprocedure;begin
 for signature in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub' and p.proname like 'publication_%'
  and p.proname not in ('publication_review') loop execute format('revoke all on function %s from public,hub_app',signature);end loop;
end $$;
grant execute on function hub.publication_queue_read(),hub.publication_queue_prepare(jsonb,text),
 hub.publication_queue_publish(uuid,text),hub.publication_queue_return(text,jsonb,text,text) to hub_app;
revoke all on function hub.web_source_available_before_workflow(jsonb) from public,hub_app;

commit;
