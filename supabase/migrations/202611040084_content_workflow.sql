-- W4: Manager decisions over exact content revisions. Existing records are not
-- backfilled or approved by migration. Publications keep their original history.
begin;

create function hub.content_definition_replace(definition text,needle text,replacement text) returns text language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
begin
 if strpos(definition,needle)=0 then raise exception 'Content guard extension did not match: %',needle;end if;
 return replace(definition,needle,replacement);
end $$;
revoke all on function hub.content_definition_replace(text,text,text) from public;

update hub.permission_catalog set separate_edit_approve=false where tab in ('projects','brands');

-- These kinds did not have an immutable review version. This is version storage,
-- not an activity log; all decisions also use the existing audit.change_log.
create table hub.content_review_versions (
 id uuid primary key default gen_random_uuid(), kind text not null, identity jsonb not null,
 version_no integer not null check(version_no>0), source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 payload jsonb not null, editors uuid[] not null default '{}',
 state text not null default 'IN_REVIEW' check(state in ('IN_REVIEW','APPROVED','RETURNED','WITHDRAWN')),
 approved_by uuid, approved_at timestamptz, decision_reason text, self_approval boolean not null default false,
 staged_invalidated_at timestamptz,staged_current_values jsonb,
 created_at timestamptz not null default clock_timestamp(),created_by uuid not null,
 updated_at timestamptz not null default clock_timestamp(),updated_by uuid not null,
 unique(kind,identity,version_no),check(jsonb_typeof(identity)='object' and identity<>'{}'),
 check(not self_approval or length(btrim(decision_reason)) between 1 and 2000)
);
create unique index content_one_submission on hub.content_review_versions(kind,identity) where state='IN_REVIEW';
alter table hub.content_review_versions enable row level security;
alter table hub.content_review_versions force row level security;
do $$ begin execute format('create policy workflow_owner on hub.content_review_versions to %I using(true) with check(true)',current_user);end $$;
create trigger workflow_audit after insert or update or delete on hub.content_review_versions for each row execute function audit.record_change();

-- Finite dispatch: a caller never chooses a SQL identifier or an arbitrary filter.
create function hub.content_workflow_table(kind text) returns text language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
begin
 case kind
 when 'project' then return 'projects'; when 'model' then return 'model_types'; when 'brand' then return 'brands';
 when 'faq' then return 'faqs'; when 'section' then return 'content_sections'; when 'selling_point' then return 'project_selling_points';
 when 'contact' then return 'contacts'; when 'fact' then return 'project_facts'; when 'building' then return 'project_buildings';
 when 'facility' then return 'project_facilities'; when 'feature' then return 'project_features'; when 'place' then return 'project_places';
 when 'asset' then return 'assets'; when 'project_asset' then return 'entity_assets'; when 'brand_asset' then return 'brand_assets';
 when 'type_asset' then return 'commercial_type_assets'; when 'asset_context' then return 'asset_links';
 when 'media_link' then return 'media_links'; when 'media_target' then return 'media_link_targets';
 when 'unit_type' then return 'commercial_types'; when 'price' then return 'project_prices';
 when 'disclosure' then return 'project_disclosures'; when 'sales_term' then return 'project_sales_terms';
 when 'programme' then return 'project_programmes'; when 'progress' then return 'project_progress';
 when 'solar' then return 'solar_estimates'; when 'article' then return 'articles';
 when 'question' then return 'faq_questions'; when 'glossary' then return 'translation_glossary';
 when 'promotion' then return 'public_promotions';
 when 'page_config' then return 'web_pages';
 else raise exception 'Unsupported content kind' using errcode='23514';end case;
end $$;
create function hub.content_workflow_identity(kind text,value jsonb) returns jsonb language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare keys text[];result jsonb;begin
 perform hub.content_workflow_table(kind);
 keys:=case kind when 'question' then array['question_key'] when 'glossary' then array['term_key']
  when 'facility' then array['project_id','facility_code'] when 'building' then array['project_id','building_key']
  when 'selling_point' then array['project_id','point_key'] else array['id'] end;
 select jsonb_object_agg(k,value->k) into result from unnest(keys) k;
 if result is null or exists(select 1 from jsonb_each(result) e where e.value='null'::jsonb or jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}') not between 1 and 200) then
  raise exception 'Invalid content identity' using errcode='23514';end if;
 return result;
end $$;
create function hub.content_workflow_material(value jsonb) returns jsonb language sql immutable set search_path=pg_catalog,pg_temp as $$
 select (value#-'{_staged_values,_disclosure_sources}')-array['created_at','created_by','updated_at','updated_by','approved_by','approved_at','state','review_state',
  'draft_version_id','published_version_id','approved_version_id','revision','media_revision','draft_revision',
  'decision_reason','approval_reason','self_approval','last_output_hashes','editors','_tab','_tabs','_form_updated_at']
$$;
create function hub.content_workflow_payload(kind text,value jsonb) returns jsonb language sql immutable set search_path=pg_catalog,pg_temp as $$
 select case when kind='asset' then hub.web_authored_content('assets',value)||jsonb_build_object('_staged_values',coalesce(value->'_staged_values','{}'))
  else hub.content_workflow_material(value)-case when kind in ('glossary','question','unit_type') then array['status']
   when kind='media_link' then array['checked_at','link_status','metadata_fetched_at','provider_metadata'] else '{}'::text[] end end
$$;
-- Owner clarification: local imported staging evidence is allowed. This helper
-- uses the existing staging-only projection, never a live REM/DW connection.
-- Values only: import dates, source snapshot times and BU membership are absent.
create function hub.content_workflow_staged_values(kind text,value jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare project uuid;staged jsonb;keys text[]:='{}';key text;result jsonb:='{}';field text;slot jsonb;
 sources jsonb;fact_sources jsonb;building_keys jsonb;building_values jsonb;begin
 project:=case when kind='project' then (value->>'id')::uuid else (value->>'project_id')::uuid end;
 if project is null or kind not in ('project','fact','building','disclosure') then return result;end if;
 staged:=hub.content_rem_values(project);
 if kind='fact' and value->>'source' in ('rem','computed') then keys:=array[value->>'fact_key'];
 elsif kind='building' and value->>'source'='rem' then
  select jsonb_build_object('name',b->'name','floors_above',b->'floors_above','unit_count',b->'unit_count') into slot
   from jsonb_array_elements(coalesce(staged->'buildings','[]')) b where b->>'building_key'=content_workflow_staged_values.value->>'building_key' limit 1;
  return jsonb_build_object('building',slot);
 elsif kind='disclosure' then
  -- The native comparison uses only grain=project facts and registered Hub
  -- buildings. Freeze those source selectors in the existing certificate;
  -- later source edits must not retarget evidence that a Manager reviewed.
  sources:=nullif(value->'_disclosure_sources','null');
  if sources is null then
   select coalesce(jsonb_object_agg(f.fact_key,case when f.fact_key='project.land_area_sqwah' then 'land_area_sqwah'
    when f.rem_value->>'choice'='rem_counted' then 'unit_counted' else 'unit_total' end),'{}') into fact_sources
    from hub.project_facts f where f.project_id=project and f.grain='project' and f.source in ('rem','computed')
     and f.value_number is not null and (f.fact_key='project.land_area_sqwah' and value->>'land_area_sqwah' is not null
      or f.fact_key='project.unit_total' and value->>'unit_total' is not null and f.rem_value->>'choice' is distinct from 'marketing');
   -- building_count counts saved rows, not imported rows. Unit counts enter
   -- the native comparison only when every registered building has a count.
   select coalesce(jsonb_agg(b.building_key order by b.building_key),'[]') into building_keys
    from hub.project_buildings b where b.project_id=project and b.source='rem' and value->>'unit_total' is not null
     and not exists(select 1 from hub.project_buildings missing where missing.project_id=project and missing.unit_count is null);
   sources:=jsonb_build_object('facts',fact_sources,'building_keys',building_keys);
  end if;
  for key,field in select k,v from jsonb_each_text(sources->'facts') e(k,v) where
   k='project.land_area_sqwah' and v='land_area_sqwah' or k='project.unit_total' and v in ('unit_total','unit_counted') loop
   result:=result||jsonb_build_object(key,staged->field);
  end loop;
  building_values:='{}';
  for key in select k from jsonb_array_elements_text(sources->'building_keys') e(k) where k ~ '^[A-Za-z0-9_-]{1,100}$' loop
   select to_jsonb(hub.content_number(b->>'unit_count')) into slot
    from jsonb_array_elements(coalesce(staged->'buildings','[]')) b where b->>'building_key'=key limit 1;
   building_values:=building_values||jsonb_build_object(key,slot);
  end loop;
  if building_values<>'{}' then result:=result||jsonb_build_object('disclosure.building_units',building_values);end if;
  -- Selectors are private evidence, never a value, hash input or UI diff.
  return result||jsonb_build_object('_disclosure_sources',sources);
 elsif kind='project' then
  -- Explicit fact/building records pin their own evidence. Only a value read
  -- directly from staging belongs to the project-level review certificate.
  for key in select field_key from hub.field_catalog where entity='project' and section='facts' and status='active' and default_ai_exposure<>'internal'
   and field_key in ('project.project_status','project.phase_count') loop
   slot:=hub.faq_fact_slot(project,key,'th',null,false);
   if coalesce((slot->>'available')::boolean,false) and not exists(select 1 from hub.project_facts f where f.project_id=project and f.fact_key=key
    and f.grain in ('project','phase:'||(select rem_project_id from hub.projects where id=project))) then
    if key='project.phase_count' then result:=result||jsonb_build_object(key,slot->'value');else keys:=array_append(keys,key);end if;
   end if;
  end loop;
 end if;
 foreach key in array keys loop
  field:=case key when 'project.land_area_sqwah' then 'land_area_sqwah' when 'project.unit_total' then 'unit_total' when 'project.project_status' then 'project_status' end;
  if kind='fact' and key='project.unit_total' then
   if value->>'grain' like 'building:%' then
    select b->'unit_count' into slot from jsonb_array_elements(coalesce(staged->'buildings','[]')) b where 'building:'||(b->>'building_key')=content_workflow_staged_values.value->>'grain';
    result:=result||jsonb_build_object(key,slot);continue;
   end if;
   if value#>>'{rem_value,choice}'='rem_counted' then field:='unit_counted';end if;
  end if;
  if field is not null then result:=result||jsonb_build_object(key,staged->field);
  elsif key='project.phase_count' then result:=result||jsonb_build_object(key,case when nullif(staged->>'group_id','') is not null then
   (select to_jsonb(count(*)) from staging.dw_projects where source_record->>'rem_project_group_id'=staged->>'group_id') end);
  elsif key='project.building_count' then result:=result||jsonb_build_object(key,jsonb_array_length(coalesce(staged->'buildings','[]')));
  elsif key='project.floors_max' then result:=result||jsonb_build_object(key,(select max(nullif(b->>'floors_above','')::integer) from jsonb_array_elements(coalesce(staged->'buildings','[]')) b));
  end if;
 end loop;return result;
end $$;
create function hub.content_workflow_source(kind text,identity jsonb,level text default 'view') returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare row_data jsonb;table_name text:=hub.content_workflow_table(kind);tab text;scope text;project uuid;tabs text[];required_tab text;begin
 if identity is distinct from hub.content_workflow_identity(kind,identity) then raise exception 'Invalid content identity' using errcode='23514';end if;
 execute format('select to_jsonb(t) from hub.%I t where to_jsonb(t) @> $1 %s',table_name,
  case when kind='selling_point' then 'order by revision desc limit 1' else '' end) into strict row_data using identity;
 if row_data is null or row_data->>'deleted_at' is not null then raise exception 'Content not found' using errcode='P0002';end if;
 scope:=row_data->>'scope_type';
 tab:=case when kind in ('faq','article','question','glossary','page_config') then 'knowledge'
  when kind in ('brand','brand_asset') or scope='brand' then 'brands'
  when kind='promotion' then 'promotions'
  when kind in ('article','question','glossary') or kind in ('faq','section','contact') and scope is distinct from 'project' then 'knowledge'
  else 'projects' end;
 if kind='asset' then
  perform hub.require_asset_access((row_data->>'id')::uuid);
  select coalesce(array_agg(name order by name),'{}') into tabs from (values
   ('projects',exists(select 1 from hub.entity_assets where asset_id=(row_data->>'id')::uuid and deleted_at is null)
     or exists(select 1 from hub.commercial_type_assets where asset_id=(row_data->>'id')::uuid and deleted_at is null)
     or exists(select 1 from hub.asset_links where asset_id=(row_data->>'id')::uuid and deleted_at is null)
     or exists(select 1 from hub.projects p join hub.entity_versions v on v.id=p.published_version_id where p.deleted_at is null and
      (jsonb_path_exists(v.payload,'$.assets[*].id ? (@ == $asset)',jsonb_build_object('asset',row_data->>'id'))
       or jsonb_path_exists(v.payload,'$.commercial_types[*].assets[*].id ? (@ == $asset)',jsonb_build_object('asset',row_data->>'id'))))),
   ('brands',exists(select 1 from hub.brand_assets where asset_id=(row_data->>'id')::uuid and deleted_at is null)
     or exists(select 1 from hub.brands b join hub.brand_versions v on v.id=b.published_version_id where b.deleted_at is null and
      jsonb_path_exists(v.payload,'$.assets[*].id ? (@ == $asset)',jsonb_build_object('asset',row_data->>'id')))),
   ('knowledge',exists(select 1 from hub.knowledge_asset_links where asset_id=(row_data->>'id')::uuid)),
   ('promotions',exists(select 1 from hub.asset_links where asset_id=(row_data->>'id')::uuid and target_type='promotion' and deleted_at is null))
  ) sources(name,owns) where owns;
  if cardinality(tabs)=0 then
   select array[name] into tabs from unnest(array['projects','brands','knowledge']) name where hub.can(name,level) limit 1;
  end if;
  if level='view' then
   select name into tab from unnest(tabs) name where hub.can(name,'view') limit 1;
  else
   foreach required_tab in array coalesce(tabs,'{}') loop perform hub.require_permission(required_tab,level);end loop;tab:=tabs[1];
  end if;
  if tab is null then raise exception 'Asset source permission required' using errcode='42501';end if;
 else perform hub.require_permission(tab,level);tabs:=array[tab];end if;
 if kind in ('section','contact') then perform hub.content_scope_access(scope,row_data->>'scope_id',level);end if;
 project:=case when kind='project' then (row_data->>'id')::uuid else (row_data->>'project_id')::uuid end;
 if project is not null and not exists(select 1 from hub.projects where id=project and deleted_at is null) then raise exception 'Content not found' using errcode='P0002';end if;
 if kind='asset' then
  perform hub.require_asset_access((row_data->>'id')::uuid);
 elsif kind in ('project_asset','brand_asset','type_asset','asset_context') then perform hub.require_asset_access((row_data->>'asset_id')::uuid);
 end if;
 if kind in ('asset_context','media_target') and not hub.media_target(project,row_data->>'target_type',row_data->>'target_key',level) then raise exception 'Content target is unavailable' using errcode='42501';end if;
 -- The ordinary model and native forms guard their owning project timestamp. Keep that
 -- concurrency token in expected_hash, never in authored approval material.
 if kind in ('model','unit_type','price','disclosure','sales_term','programme','progress') then
  row_data:=row_data||jsonb_build_object('_form_updated_at',(select updated_at from hub.projects where id=project));
 end if;
 return row_data||jsonb_build_object('_tab',tab,'_tabs',tabs,'_staged_values',hub.content_workflow_staged_values(kind,row_data));
 exception when no_data_found then raise exception 'Content not found' using errcode='P0002';
end $$;
create function hub.content_workflow_authors(kind text,identity jsonb,value jsonb) returns uuid[]
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 with previous as (select v.* from hub.content_review_versions v
  where v.kind=content_workflow_authors.kind and v.identity=content_workflow_authors.identity order by version_no desc limit 1),
 baseline as (select greatest((select created_at from previous),
  case kind when 'unit_type' then (select max(created_at) from hub.commercial_type_versions where commercial_type_id=(identity->>'id')::uuid)
   when 'price' then (select max(created_at) from hub.project_price_versions where price_id=(identity->>'id')::uuid)
   when 'disclosure' then (select max(created_at) from hub.project_commercial_versions where record_id=(identity->>'id')::uuid)
   when 'sales_term' then (select max(created_at) from hub.project_commercial_versions where record_id=(identity->>'id')::uuid)
   when 'programme' then (select max(created_at) from hub.project_commercial_versions where record_id=(identity->>'id')::uuid)
   when 'progress' then (select max(created_at) from hub.project_commercial_versions where record_id=(identity->>'id')::uuid) end) stamp),
 generic_authors as (
  select (value->>'version_author')::uuid actor
  union select (value->>'created_by')::uuid from baseline where stamp is null
  -- A new submission is not a new authored draft. Returned or staged-only
  -- reapproval keeps the contributors of the exact unchanged authored value.
  union select unnest(p.editors) from previous p where
   hub.content_workflow_payload(kind,value)-'_staged_values'=hub.content_workflow_payload(kind,p.payload)-'_staged_values'
  union select a.actor from audit.change_log a cross join baseline b where a.table_name='hub.'||hub.content_workflow_table(kind)
   and (b.stamp is null or a.occurred_at>b.stamp) and a.after_row @> identity
   and hub.content_workflow_payload(kind,a.after_row) is distinct from hub.content_workflow_payload(kind,a.before_row)
 ),
 point_authors as (
  -- Selling points are already immutable native revisions. Ordinary saves
  -- start a fresh row; English review carries its exact included contributors.
  select (value->>'created_by')::uuid actor
  union select jsonb_array_elements_text(coalesce(value->'editors','[]'))::uuid
 ),
 contributors as (
  select actor from generic_authors where kind<>'selling_point'
  union select actor from point_authors where kind='selling_point'
  union select t.reviewed_by from hub.content_translations t where t.owner_type=case kind when 'solar' then 'solar_estimate' when 'unit_type' then 'commercial_type' else kind end
   and t.row_ref @> identity and t.translation_state='reviewed' and t.en_from_th_version=t.th_version
   and (kind<>'selling_point' or t.row_ref @> jsonb_build_object('revision',value->'revision'))
 ) select coalesce(array_agg(distinct actor) filter(where actor is not null),'{}') from contributors
$$;
create function hub.content_review_reason(reason text,required boolean default false) returns text
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
begin
 if required and nullif(btrim(reason),'') is null or length(reason)>2000 then raise exception 'A decision reason is required' using errcode='23514';end if;
 return nullif(btrim(reason),'');
end $$;

-- New native versions capture contributors of this draft, not the lifetime
-- editor array on their mutable parent. Historical versions remain untouched.
create function hub.content_native_authors() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare kind text;identity jsonb;source jsonb;begin
 if tg_table_name='commercial_type_versions' then kind:='unit_type';identity:=jsonb_build_object('id',new.commercial_type_id);
 elsif tg_table_name='project_price_versions' then kind:='price';identity:=jsonb_build_object('id',new.price_id);
 else kind:=case new.kind when 'disclosures' then 'disclosure' when 'sales-terms' then 'sales_term' when 'programmes' then 'programme' else 'progress' end;
  identity:=jsonb_build_object('id',new.record_id);end if;
 execute format('select to_jsonb(t) from hub.%I t where id=$1',hub.content_workflow_table(kind)) into source using (identity->>'id')::uuid;
 new.editors:=array(select distinct actor from unnest(hub.content_workflow_authors(kind,identity,source)||array[hub.permission_actor()]) actor where actor is not null);
 if kind='unit_type' then
  -- The type snapshot also includes current tours. Capture their exact draft
  -- contributors without reintroducing the parent's lifetime editor array.
  new.editors:=array(select distinct actor from (
   select unnest(new.editors) actor
   union select unnest(hub.content_workflow_authors('media_link',jsonb_build_object('id',l.id),to_jsonb(l)))
    from hub.media_links l join hub.media_link_targets t on t.media_link_id=l.id
    where t.target_type='commercial_type' and t.target_key=new.commercial_type_id::text
     and exists(select 1 from jsonb_array_elements(coalesce(new.payload->'tours','[]')) tour
      where tour->>'url'=l.url and tour->>'provider'=l.provider)
  ) contributors where actor is not null);
 end if;
 return new;
end $$;
create trigger content_native_authors before insert on hub.commercial_type_versions for each row execute function hub.content_native_authors();
create trigger content_native_authors before insert on hub.project_price_versions for each row execute function hub.content_native_authors();
create trigger content_native_authors before insert on hub.project_commercial_versions for each row execute function hub.content_native_authors();
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.translation_editable(hub.content_translations)'::regprocedure);
 d:=hub.content_definition_replace(d,'FUNCTION hub.translation_editable(','FUNCTION hub.translation_editable_before_workflow(');execute d;
end $$;
create or replace function hub.translation_editable(t hub.content_translations) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select hub.translation_editable_before_workflow(t) and not exists(select 1 from hub.content_review_versions v
  where v.kind=case (t).owner_type when 'solar_estimate' then 'solar' when 'commercial_type' then 'unit_type' else (t).owner_type end
   and (t).row_ref @> v.identity and v.state='IN_REVIEW')
$$;
revoke all on function hub.translation_editable_before_workflow(hub.content_translations) from public,hub_app;
create function hub.content_self_review(editors uuid[]) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 if hub.permission_actor()=any(editors) then
  if nullif(btrim(current_setting('app.content_review_reason',true)),'') is null then return false;end if;
  perform hub.content_review_reason(current_setting('app.content_review_reason',true),true);
 end if;return true;
end $$;

-- Retain original immutable version tables for already versioned kinds.
do $$ declare name text;d text;begin
 foreach name in array array['faqs','content_sections','faq_versions','content_section_versions','project_selling_points'] loop
  execute format('alter table hub.%I drop constraint %I',name,name||'_state_check');
  execute format('alter table hub.%I add constraint %I check(state in (''DRAFT'',''IN_REVIEW'',''APPROVED'',''RETURNED'',''PUBLISHED'',''WITHDRAWN''))',name,name||'_state_check');
 end loop;
 alter table hub.content_section_versions add column approved_by uuid,add column approved_at timestamptz;
 alter table hub.project_selling_points add column approved_by uuid,add column approved_at timestamptz;
 alter table hub.faq_questions add column review_state text not null default 'DRAFT' check(review_state in ('DRAFT','IN_REVIEW','APPROVED','RETURNED','WITHDRAWN'));
 alter table hub.project_commercial_versions add column staged_evidence jsonb,add column staged_invalidated_at timestamptz,add column staged_current_values jsonb;
 foreach name in array array['faq_versions','content_section_versions','commercial_type_versions','project_price_versions','project_commercial_versions',
  'article_versions','faq_questions','translation_glossary','solar_estimates','project_selling_points'] loop
  execute format('alter table hub.%I add column decision_reason text,add column self_approval boolean not null default false',name);
 end loop;
 foreach name in array array['hub.content_version_guard()','hub.unit_version_guard()'] loop
  d:=pg_get_functiondef(name::regprocedure);
  d:=hub.content_definition_replace(d,'''approved_by'',''approved_at''','''approved_by'',''approved_at'',''decision_reason'',''self_approval'',''staged_invalidated_at'',''staged_current_values''');execute d;
 end loop;
 -- A reasoned withdrawal changes decision metadata, never approved figures.
 -- Keep the existing immutable-content comparison and all its other fields.
 d:=pg_get_functiondef('hub.c4_project_guard()'::regprocedure);
 d:=hub.content_definition_replace(d,'''state'',''revision'',''updated_at'',''updated_by''',
  '''state'',''revision'',''updated_at'',''updated_by'',''decision_reason'',''self_approval''');execute d;
end $$;
create function hub.content_decision_stamp() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare previous jsonb:=to_jsonb(old);current_row jsonb:=to_jsonb(new);authors uuid[];decision text;begin
 decision:=upper(coalesce(current_row->>'state',current_row->>'status',''));
 if decision in ('APPROVED','ACTIVE','RETURNED','RETIRED','WITHDRAWN') and
  (coalesce(current_row->>'state',current_row->>'status') is distinct from coalesce(previous->>'state',previous->>'status') or current_row->'approved_at' is distinct from previous->'approved_at') then
  authors:=array(select jsonb_array_elements_text(coalesce(current_row->'editors','[]'))::uuid)||array[(current_row->>'version_author')::uuid];
  if tg_table_name='project_selling_points' then authors:=hub.content_workflow_authors('selling_point',hub.content_workflow_identity('selling_point',current_row),current_row);end if;
  if tg_table_name='project_commercial_versions' and current_row->>'kind'='disclosures' and decision='APPROVED' and
   (current_row->>'staged_invalidated_at' is not null or (coalesce(current_row->'staged_evidence','{}')-'_disclosure_sources') is distinct from
    (hub.content_workflow_staged_values('disclosure',(select to_jsonb(d) from hub.project_disclosures d where id=(current_row->>'record_id')::uuid)
     ||jsonb_build_object('_disclosure_sources',current_row#>'{staged_evidence,_disclosure_sources}'))-'_disclosure_sources')) then
   raise exception 'Relevant imported values changed; return this item for re-approval' using errcode='40001';end if;
  new.decision_reason:=hub.content_review_reason(current_setting('app.content_review_reason',true),decision in ('RETURNED','RETIRED','WITHDRAWN') or hub.permission_actor()=any(authors));
  if decision in ('APPROVED','ACTIVE') then new.self_approval:=coalesce(hub.permission_actor()=any(authors),false);end if;
 end if;return new;
end $$;
do $$ declare name text;begin
 foreach name in array array['faq_versions','content_section_versions','commercial_type_versions','project_price_versions','project_commercial_versions',
  'article_versions','faq_questions','translation_glossary','solar_estimates','project_selling_points'] loop
  execute format('create trigger a_content_decision before update on hub.%I for each row execute function hub.content_decision_stamp()',name);
 end loop;
end $$;

-- Existing review paths keep their readiness, locks and DATA/LEGAL checks.
-- Only content self-review denial becomes a mandatory reason, recorded above.
do $$ declare signature text;d text;begin
 foreach signature in array array['hub.unit_type_review(text,text,timestamptz,text)','hub.project_price_review(text,uuid,timestamptz,text)',
  'hub.review_project_commercial(text,text,uuid,timestamptz,text)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  if strpos(d,'decision=''approve'' and actor=any(v.editors)')=0 then raise exception 'Missing review guard in %',signature;end if;
  d:=hub.content_definition_replace(d,'decision=''approve'' and actor=any(v.editors)','decision=''approve'' and not hub.content_self_review(v.editors)');execute d;
 end loop;
 d:=pg_get_functiondef('hub.article_review(uuid,integer,text)'::regprocedure);
 d:=hub.content_definition_replace(d,'if actor=any(v.editors) then','if not hub.content_self_review(v.editors) then');execute d;
 foreach signature in array array['hub.approve_faq_question(text,integer,text)','hub.approve_glossary(text,integer,text)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  if strpos(d,'if prior.version_author=actor then')=0 then raise exception 'Missing catalog review guard in %',signature;end if;
  d:=hub.content_definition_replace(d,'if prior.version_author=actor then','if not hub.content_self_review(array[prior.version_author]) then');execute d;
 end loop;
 d:=pg_get_functiondef('hub.save_faq_question(text,integer,jsonb)'::regprocedure);
 d:=hub.content_definition_replace(d,'version_author=actor,status=''proposed''','version_author=actor,status=''proposed'',review_state=''DRAFT''');execute d;
 d:=pg_get_functiondef('hub.approve_faq_question(text,integer,text)'::regprocedure);
 d:=hub.content_definition_replace(d,'set status=decision,approved_by=actor','set status=decision,review_state=case when decision=''approved'' then ''APPROVED'' else ''WITHDRAWN'' end,approved_by=actor');execute d;
 d:=pg_get_functiondef('hub.c4_item_save(text,text,uuid,integer,jsonb)'::regprocedure);
 d:=hub.content_definition_replace(d,'if prior is not null and prior->>''state''<>''draft'' then raise exception ''Create a new scenario to revise approved figures'' using errcode=''23514'';end if;',
  'if prior is not null and prior->>''state''<>''draft'' then
   if not exists(select 1 from hub.content_review_versions v where v.kind=''solar'' and v.identity=jsonb_build_object(''id'',item) and v.state=''APPROVED''
    and v.source_hash=hub.web_hash(hub.content_workflow_payload(''solar'',prior||jsonb_build_object(''_staged_values'',''{}''::jsonb)))) then
    raise exception ''A frozen approved scenario is required before creating its next draft'' using errcode=''23514'';end if;
   update hub.solar_estimates set state=''draft'' where id=item;
   select to_jsonb(workflow_solar) into prior from hub.solar_estimates workflow_solar where workflow_solar.id=item;
  end if;');execute d;
 d:=pg_get_functiondef('hub.review_knowledge_candidate(uuid,integer,text,text[],text,boolean,text,text)'::regprocedure);
 d:=hub.content_definition_replace(d,'return hub.review_knowledge_candidate_before_workspace(',
  'perform set_config(''app.content_review_reason'',reason,true);return hub.review_knowledge_candidate_before_workspace(');execute d;
end $$;

create function hub.content_review_version_guard() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if tg_op='DELETE' or (to_jsonb(new)-array['state','approved_by','approved_at','decision_reason','self_approval','updated_at','updated_by','staged_invalidated_at','staged_current_values'])
  is distinct from (to_jsonb(old)-array['state','approved_by','approved_at','decision_reason','self_approval','updated_at','updated_by','staged_invalidated_at','staged_current_values']) then
  raise exception 'Submitted content version is immutable' using errcode='23514';end if;
 return new;
end $$;
create trigger workflow_immutable before update or delete on hub.content_review_versions for each row execute function hub.content_review_version_guard();

-- Every source save, including old routes and direct guarded SQL, meets this
-- freeze. Changes to publication pointers and service status are not edits.
create function hub.content_submission_freeze() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
<<freeze_values>>
declare kind text:=tg_argv[0];value jsonb:=to_jsonb(old);identity jsonb;begin
 identity:=hub.content_workflow_identity(kind,value);
 perform pg_advisory_xact_lock(hashtextextended('content-review:'||kind||':'||identity::text,0));
 if exists(select 1 from hub.content_review_versions v where v.kind=freeze_values.kind and v.identity=freeze_values.identity and v.state='IN_REVIEW')
  and (tg_op='DELETE' or hub.content_workflow_payload(kind,to_jsonb(new)) is distinct from hub.content_workflow_payload(kind,value))
  and not (coalesce(tg_op='UPDATE' and (to_jsonb(new)->>'deleted_at' is not null and value->>'deleted_at' is null
   or to_jsonb(new)->>'ai_exposure'='internal' and value->>'ai_exposure'<>'internal'
   or kind='model' and to_jsonb(new)->>'match_status'='REJECTED'),false)
   and (hub.content_workflow_payload(kind,to_jsonb(new))-array['deleted_at','ai_exposure','match_status']) is not distinct from
    (hub.content_workflow_payload(kind,value)-array['deleted_at','ai_exposure','match_status'])) then
  raise exception 'Submitted content is frozen; return this item before editing' using errcode='23514';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
do $$ declare kind text;begin
 foreach kind in array array['project','model','brand','contact','fact','building','facility','feature','place',
  'asset','project_asset','brand_asset','type_asset','asset_context','media_link','media_target','solar','glossary','page_config'] loop
  execute format('create trigger content_submission_freeze before update or delete on hub.%I for each row execute function hub.content_submission_freeze(%L)',hub.content_workflow_table(kind),kind);
 end loop;
end $$;

create function hub.content_workflow_version(kind text,identity jsonb,source jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;begin
 case kind
 when 'faq' then select to_jsonb(v) into result from hub.faq_versions v where id=(source->>'draft_version_id')::uuid;
 when 'section' then select to_jsonb(v) into result from hub.content_section_versions v where id=(source->>'draft_version_id')::uuid;
 when 'article' then select to_jsonb(v) into result from hub.article_versions v where id=(source->>'draft_version_id')::uuid;
 when 'selling_point' then result:=source;
 when 'unit_type' then select to_jsonb(v) into result from hub.commercial_type_versions v where commercial_type_id=(source->>'id')::uuid and revision=(source->>'revision')::integer;
 when 'price' then select to_jsonb(v) into result from hub.project_price_versions v where price_id=(source->>'id')::uuid and revision=(source->>'revision')::integer;
 when 'disclosure','sales_term','programme','progress' then
  select to_jsonb(v) into result from hub.project_commercial_versions v where record_id=(source->>'id')::uuid and revision=(source->>'revision')::integer
   and v.kind=case content_workflow_version.kind when 'disclosure' then 'disclosures' when 'sales_term' then 'sales-terms' when 'programme' then 'programmes' else 'construction' end;
 when 'question' then select payload into result from hub.faq_question_versions where question_key=source->>'question_key' and revision=(source->>'revision')::integer;
 when 'promotion' then result:=jsonb_build_object('state',case when source->'returned_revision'=source->'draft_revision' then 'RETURNED' when (hub.promotion_readiness(hub.promotion_payload((source->>'id')::uuid))->>'ready')::boolean then 'APPROVED' else 'DRAFT' end,
  'reviews',(select coalesce(jsonb_agg(to_jsonb(r) order by reviewed_at),'[]') from hub.promotion_reviews r where promotion_id=(source->>'id')::uuid and review_revision=(source->>'draft_revision')::integer));
 else select to_jsonb(v) into result from hub.content_review_versions v where v.kind=content_workflow_version.kind and v.identity=content_workflow_version.identity order by version_no desc limit 1;
 end case;
 return result;
end $$;
create function hub.content_workflow_hash(source jsonb) returns text language sql immutable set search_path=pg_catalog,pg_temp as $$
 select hub.web_hash((source#-'{_staged_values,_disclosure_sources}')-array['_tab','_tabs','updated_at','updated_by'])
$$;
create function hub.content_workflow_read(kind text,identity jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare source jsonb;version jsonb;state text;history jsonb;old_values jsonb;new_values jsonb;drift boolean;
 may_approve boolean:=false;may_edit boolean:=false;may_submit boolean:=false;may_withdraw boolean:=false;may_save_approve boolean:=false;
 authors uuid[];current_actor uuid:=hub.permission_actor();begin
 source:=hub.content_workflow_source(kind,identity,'view');version:=hub.content_workflow_version(kind,identity,source);
 -- Use the same object-aware source guards as the commands; tab bits alone
 -- cannot advertise authority over a scoped source or a shared media binding.
 begin perform hub.content_workflow_source(kind,identity,'approve');may_approve:=true;
 exception when insufficient_privilege or no_data_found then null;end;
 begin perform hub.content_workflow_source(kind,identity,'edit');may_edit:=true;
 exception when insufficient_privilege or no_data_found then null;end;
 old_values:=coalesce(nullif(version#>'{payload,_staged_values}','null'),nullif(version->'staged_evidence','null'),'{}')-'_disclosure_sources';
 new_values:=case when kind='disclosure' and version is not null then hub.content_workflow_staged_values(kind,
  source||jsonb_build_object('_disclosure_sources',version#>'{staged_evidence,_disclosure_sources}'))
  else coalesce(source->'_staged_values','{}') end-'_disclosure_sources';
 drift:=old_values is distinct from new_values or version->>'staged_invalidated_at' is not null;
 state:=upper(coalesce(case when kind='question' and source->>'review_state' in ('IN_REVIEW','RETURNED') then source->>'review_state' end,version->>'state',case when kind='question' then case source->>'status' when 'approved' then 'APPROVED' when 'retired' then 'WITHDRAWN' else 'DRAFT' end end,'DRAFT'));
 if upper(coalesce(version->>'state',''))<>'IN_REVIEW' and version ? 'source_hash' and version->>'source_hash' is distinct from hub.web_hash(hub.content_workflow_payload(kind,source-'_tab')) then state:='DRAFT';end if;
 authors:=case when kind='selling_point' then hub.content_workflow_authors(kind,identity,source)
  when version ? 'editors' then array(select jsonb_array_elements_text(version->'editors')::uuid) else hub.content_workflow_authors(kind,identity,source) end;
 may_submit:=may_edit and kind<>'promotion' and case
  when kind in ('faq','section','article','selling_point') then state='DRAFT'
  when kind='question' then source->>'status'='proposed' and source->>'review_state'<>'IN_REVIEW'
  when kind='unit_type' then source->>'status'='draft'
  when kind in ('price','disclosure','sales_term','programme','progress') then source->>'state'='draft'
  else (state<>'APPROVED' or drift) and not exists(select 1 from hub.content_review_versions r where r.kind=content_workflow_read.kind and r.identity=content_workflow_read.identity and r.state='IN_REVIEW') end;
 may_withdraw:=case
  when kind='faq' and state='DRAFT' then may_edit and current_actor=any(authors)
  when kind in ('faq','section') then may_approve and state in ('DRAFT','IN_REVIEW','APPROVED')
  when kind='article' then may_approve and source->>'approved_version_id' is not null
  when kind in ('unit_type','price','disclosure','sales_term','programme','progress') then may_approve and state='APPROVED'
  when kind='selling_point' then may_approve and state='IN_REVIEW'
  when kind='question' then may_approve and source->>'status' in ('proposed','approved')
  when kind='promotion' then false
  else may_approve and state in ('IN_REVIEW','APPROVED') end;
 may_save_approve:=may_edit and may_approve and kind<>'promotion';
 if kind='asset' then
  -- The existing atomic metadata save uses an authorized project media editor.
  may_save_approve:=may_save_approve and hub.can('projects','edit') and exists(select 1 from hub.projects p where p.deleted_at is null
   and hub.content_scope_allowed('project',p.public_project_id,'edit') and (exists(select 1 from hub.entity_assets a where a.project_id=p.id and a.asset_id=(source->>'id')::uuid and a.deleted_at is null)
    or exists(select 1 from hub.asset_links a where a.project_id=p.id and a.asset_id=(source->>'id')::uuid and a.deleted_at is null)));
 end if;
 -- Metadata only: ordinary content readers retain their existing Legal and
 -- private-storage redactions. This projection does not introduce a raw reader.
 select coalesce(jsonb_agg(jsonb_build_object('operation',operation,'actor',actor,'occurred_at',occurred_at,
  'state',coalesce(after_row->>'state',after_row->>'status'),'reason',coalesce(after_row->>'decision_reason',reason),'self_approval',after_row->'self_approval',
  'staged_evidence',case when may_approve and after_row->>'staged_invalidated_at' is not null then
   jsonb_build_object('approved',coalesce(after_row#>'{payload,_staged_values}',after_row->'staged_evidence')-'_disclosure_sources',
    'current',(after_row->'staged_current_values')-'_disclosure_sources') end) order by occurred_at desc),'[]')
 into history from (select * from audit.change_log a where
  a.table_name='hub.'||hub.content_workflow_table(kind) and (a.after_row @> identity or a.before_row @> identity)
  or a.table_name='hub.content_review_versions' and a.after_row->>'kind'=kind and a.after_row->'identity'=identity
  or kind in ('faq','section','article','unit_type','price','disclosure','sales_term','programme','progress')
   and a.table_name=case kind when 'faq' then 'hub.faq_versions' when 'section' then 'hub.content_section_versions' when 'article' then 'hub.article_versions'
    when 'unit_type' then 'hub.commercial_type_versions' when 'price' then 'hub.project_price_versions' else 'hub.project_commercial_versions' end
   and a.after_row->>case kind when 'faq' then 'faq_id' when 'section' then 'section_id' when 'article' then 'article_id'
    when 'unit_type' then 'commercial_type_id' when 'price' then 'price_id' else 'record_id' end=identity->>'id'
  order by occurred_at desc limit 50) records;
 -- The UI compares these authoritative ordinary-form guards before using the
 -- workflow hash. Refreshing metadata cannot rebase a dirty, older form.
 return jsonb_build_object('kind',kind,'identity',identity,'source_tab',source->>'_tab','expected_hash',hub.content_workflow_hash(source),
  'source_revision',case kind when 'asset' then source->'media_revision' when 'promotion' then source->'draft_revision' else source->'revision' end,
  'source_updated_at',case when kind in ('model','unit_type','price','disclosure','sales_term','programme','progress') then
   (select to_jsonb(p.updated_at) from hub.projects p where p.id=(source->>'project_id')::uuid) else source->'updated_at' end,
  'state',state,'version_id',version->'id','version_no',coalesce(version->'version_no',version->'revision'),'approved_by',version->'approved_by',
  'approved_at',version->'approved_at','decision_reason',version->'decision_reason','self_approval',coalesce(version->'self_approval','false'),
  'history',history,'needs_reapproval',version is not null and drift,'staged_evidence',case when may_approve then jsonb_build_object('approved',old_values,'current',new_values) end,
  'can_edit',may_edit,'can_approve',may_approve and kind<>'promotion' and state='IN_REVIEW' and not drift,
  'can_submit',coalesce(may_submit,false),'can_return',may_approve and kind<>'promotion' and state='IN_REVIEW',
  'can_withdraw',coalesce(may_withdraw,false),'can_save_approve',may_save_approve,
  'approval_requires_reason',may_approve and current_actor=any(authors),'source_tabs',source->'_tabs');
end $$;

create function hub.content_workflow_lock(kind text,identity jsonb,expected_hash text,level text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare source jsonb;parent uuid;begin
 source:=hub.content_workflow_source(kind,identity,level);
 parent:=case when kind='project' then (source->>'id')::uuid else (source->>'project_id')::uuid end;
 if parent is not null then perform 1 from hub.projects where id=parent for update;end if;
 execute format('select 1 from hub.%I t where to_jsonb(t) @> $1 for update',hub.content_workflow_table(kind)) using identity;
 perform pg_advisory_xact_lock(hashtextextended('content-review:'||kind||':'||identity::text,0));
 source:=hub.content_workflow_source(kind,identity,level);
 if expected_hash is distinct from hub.content_workflow_hash(source) then raise exception 'Content revision changed' using errcode='40001';end if;
 return source;
end $$;
create function hub.content_workflow_submit(kind text,identity jsonb,expected_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare source jsonb;project hub.projects;version jsonb;actor uuid:=hub.permission_actor();commercial_kind text;begin
 source:=hub.content_workflow_lock(kind,identity,expected_hash,'edit');
 if kind='promotion' then raise exception 'Promotions require the existing DATA and LEGAL reviews' using errcode='23514';end if;
 if kind='fact' and source->>'source'='rem' and source->>'value_number' is not null and source->'_staged_values' ? (source->>'fact_key')
  and source->'value_number' is distinct from source#>array['_staged_values',source->>'fact_key'] then
  raise exception 'Confirm the current imported fact or save its justified override before submission' using errcode='40001';end if;
 if kind='building' and source->>'source'='rem' and (source#>'{name,th}' is distinct from source#>'{_staged_values,building,name,th}'
  or source->'floors_above' is distinct from source#>'{_staged_values,building,floors_above}'
  or source->'unit_count' is distinct from source#>'{_staged_values,building,unit_count}') then
  raise exception 'Confirm the current imported building before submission' using errcode='40001';end if;
 select * into project from hub.projects where id=(source->>'project_id')::uuid for update;
 case kind
 when 'faq' then perform hub.submit_faq((source->>'id')::uuid,(source->>'revision')::integer);
 when 'section' then perform hub.submit_content_section(source->>'scope_type',source->>'scope_id',source->>'section_key',(source->>'revision')::integer);
 when 'article' then perform hub.article_submit((source->>'id')::uuid,(source->>'revision')::integer);
 when 'unit_type' then perform hub.unit_type_review(project.public_project_id,source->>'public_commercial_type_id',project.updated_at,'submit');
 when 'price' then perform hub.project_price_review(project.public_project_id,(source->>'id')::uuid,project.updated_at,'submit');
 when 'disclosure','sales_term','programme','progress' then
  commercial_kind:=case kind when 'disclosure' then 'disclosures' when 'sales_term' then 'sales-terms' when 'programme' then 'programmes' else 'construction' end;
  perform hub.review_project_commercial(project.public_project_id,commercial_kind,(source->>'id')::uuid,project.updated_at,'submit');
 when 'selling_point' then
  if source->>'state'<>'DRAFT' then raise exception 'Only a current draft can be submitted' using errcode='23514';end if;
  update hub.project_selling_points set state='IN_REVIEW' where project_id=(source->>'project_id')::uuid and point_key=(source->>'point_key')::uuid and revision=(source->>'revision')::integer;
 when 'question' then
  -- The question already has a frozen JSON revision and its own review command.
  if source->>'status'<>'proposed' then raise exception 'Only a proposed question can be submitted' using errcode='23514';end if;
  update hub.faq_questions set review_state='IN_REVIEW' where question_key=source->>'question_key';
 else
  version:=hub.content_workflow_version(kind,identity,source);
  if version->>'state'='APPROVED' and version->>'staged_invalidated_at' is null
   and version->>'source_hash'=hub.web_hash(hub.content_workflow_payload(kind,source)) then
   raise exception 'This unchanged item is already approved' using errcode='23514';end if;
  if exists(select 1 from hub.content_review_versions v where v.kind=content_workflow_submit.kind and v.identity=content_workflow_submit.identity and v.state='IN_REVIEW') then
   raise exception 'This item is already submitted' using errcode='23514';end if;
  insert into hub.content_review_versions(kind,identity,version_no,source_hash,payload,editors,created_by,updated_by)
   select content_workflow_submit.kind,content_workflow_submit.identity,coalesce(max(v.version_no),0)+1,
    hub.web_hash(hub.content_workflow_payload(content_workflow_submit.kind,source-array['_tab','_tabs','_form_updated_at'])),source-array['_tab','_tabs','_form_updated_at'],
    hub.content_workflow_authors(content_workflow_submit.kind,content_workflow_submit.identity,source),actor,actor
    from hub.content_review_versions v where v.kind=content_workflow_submit.kind and v.identity=content_workflow_submit.identity;
 end case;
 return hub.content_workflow_read(kind,identity);
end $$;

create function hub.content_workflow_review(kind text,identity jsonb,expected_hash text,decision text,reason text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare source jsonb;version jsonb;actor uuid:=hub.permission_actor();authors uuid[];project hub.projects;commercial_kind text;new_state text;level text:='approve';begin
 if decision is null or decision not in ('approve','return','withdraw') then raise exception 'Invalid content decision' using errcode='23514';end if;
 if kind='promotion' then raise exception 'Promotions require the existing DATA and LEGAL reviews' using errcode='23514';end if;
 source:=hub.content_workflow_source(kind,identity,'view');version:=hub.content_workflow_version(kind,identity,source);
 if kind='faq' and decision='withdraw' and version->>'state'='DRAFT' then
  authors:=array(select jsonb_array_elements_text(coalesce(version->'editors','[]'))::uuid);
  if not actor=any(authors) then raise exception 'Only its author may withdraw a draft' using errcode='42501';end if;level:='edit';
 end if;
 source:=hub.content_workflow_lock(kind,identity,expected_hash,level);version:=hub.content_workflow_version(kind,identity,source);
 authors:=case when kind='selling_point' then hub.content_workflow_authors(kind,identity,source)
  when version ? 'editors' then array(select jsonb_array_elements_text(version->'editors')::uuid) else hub.content_workflow_authors(kind,identity,source) end;
 reason:=hub.content_review_reason(reason,decision in ('return','withdraw') or actor=any(authors));
 perform set_config('app.content_review_reason',coalesce(reason,''),true);perform set_config('app.change_reason',coalesce(reason,''),true);
 select * into project from hub.projects where id=(source->>'project_id')::uuid for update;
 new_state:=case decision when 'approve' then 'APPROVED' when 'return' then 'RETURNED' else 'WITHDRAWN' end;
 case kind
 when 'faq','section' then
  if version is null or decision in ('approve','return') and version->>'state'<>'IN_REVIEW'
   or decision='withdraw' and version->>'state' not in ('DRAFT','IN_REVIEW','APPROVED') then raise exception 'Invalid content review state' using errcode='23514';end if;
  if kind='faq' then
   update hub.faq_versions set state=new_state,approved_by=case when decision='approve' then actor else approved_by end,
    approved_at=case when decision='approve' then clock_timestamp() else approved_at end where id=(version->>'id')::uuid;
   update hub.faqs set state=new_state,revision=revision+1 where id=(source->>'id')::uuid;
  else
   update hub.content_section_versions set state=new_state,approved_by=case when decision='approve' then actor else approved_by end,
    approved_at=case when decision='approve' then clock_timestamp() else approved_at end where id=(version->>'id')::uuid;
   update hub.content_sections set state=new_state,revision=revision+1 where id=(source->>'id')::uuid;
  end if;
 when 'article' then perform hub.article_review((source->>'id')::uuid,(source->>'revision')::integer,decision);
 when 'unit_type' then perform hub.unit_type_review(project.public_project_id,source->>'public_commercial_type_id',project.updated_at,decision);
 when 'price' then perform hub.project_price_review(project.public_project_id,(source->>'id')::uuid,project.updated_at,decision);
 when 'disclosure','sales_term','programme','progress' then
  commercial_kind:=case kind when 'disclosure' then 'disclosures' when 'sales_term' then 'sales-terms' when 'programme' then 'programmes' else 'construction' end;
  perform hub.review_project_commercial(project.public_project_id,commercial_kind,(source->>'id')::uuid,project.updated_at,decision);
 when 'question' then
  if decision='return' then
   if source->>'review_state'<>'IN_REVIEW' then raise exception 'No submitted question' using errcode='23514';end if;
   update hub.faq_questions set review_state='RETURNED',revision=revision+1,decision_reason=reason where question_key=source->>'question_key';
   insert into hub.faq_question_versions(question_key,revision,payload) select question_key,revision,to_jsonb(q) from hub.faq_questions q where question_key=source->>'question_key';
  else
   perform hub.approve_faq_question(source->>'question_key',(source->>'revision')::integer,case when decision='approve' then 'approved' else 'retired' end);
   update hub.faq_questions set review_state=new_state where question_key=source->>'question_key';
  end if;
 when 'selling_point' then
  if source->>'state'<>'IN_REVIEW' then raise exception 'No submitted selling point' using errcode='23514';end if;
  update hub.project_selling_points set state=new_state,approved_by=case when decision='approve' then actor else approved_by end,
   approved_at=case when decision='approve' then clock_timestamp() else approved_at end,
   decision_reason=reason,self_approval=decision='approve' and actor=any(authors)
   where project_id=(source->>'project_id')::uuid and point_key=(source->>'point_key')::uuid and revision=(source->>'revision')::integer;
 else
  if version is null or decision in ('approve','return') and version->>'state'<>'IN_REVIEW'
   or decision='withdraw' and version->>'state' not in ('IN_REVIEW','APPROVED') then raise exception 'No submitted revision' using errcode='23514';end if;
  if decision='approve' and (version->>'source_hash' is distinct from hub.web_hash(hub.content_workflow_payload(kind,source-'_tab')) or version->>'staged_invalidated_at' is not null) then raise exception 'Submitted source changed; re-approval is required' using errcode='40001';end if;
  update hub.content_review_versions set state=new_state,approved_by=case when decision='approve' then actor else approved_by end,
   approved_at=case when decision='approve' then clock_timestamp() else approved_at end,decision_reason=reason,
   self_approval=case when decision='approve' then actor=any(authors) else self_approval end,updated_by=actor,updated_at=clock_timestamp() where id=(version->>'id')::uuid;
  if kind='solar' then update hub.solar_estimates set state=case decision when 'approve' then 'approved' when 'withdraw' then 'withdrawn' else 'draft' end,
   approved_by=case when decision='approve' then actor else approved_by end,approved_at=case when decision='approve' then clock_timestamp() else approved_at end where id=(source->>'id')::uuid;
  elsif kind='glossary' and decision<>'return' then perform hub.approve_glossary(source->>'term_key',(source->>'revision')::integer,case when decision='approve' then 'active' else 'retired' end);
  end if;
 end case;
 return hub.content_workflow_read(kind,identity);
end $$;

create function hub.content_workflow_save_approve(kind text,identity jsonb,expected_hash text,changes jsonb,reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare source jsonb;project hub.projects;result jsonb;commercial_kind text;ref text;begin
 reason:=hub.content_review_reason(reason,true);
 source:=hub.content_workflow_lock(kind,identity,expected_hash,'edit');perform hub.content_workflow_source(kind,identity,'approve');
 if kind='promotion' then raise exception 'Promotions require separated DATA and LEGAL reviews' using errcode='23514';end if;
 if jsonb_typeof(changes) is distinct from 'object' or octet_length(changes::text)>64000 then raise exception 'Invalid draft changes' using errcode='23514';end if;
 perform set_config('app.content_review_reason',reason,true);perform set_config('app.change_reason',reason,true);
 result:=hub.content_workflow_read(kind,identity);
 if result->>'state'='IN_REVIEW' then
  perform hub.content_workflow_review(kind,identity,expected_hash,'return',reason);
  source:=hub.content_workflow_source(kind,identity,'edit');
 end if;
 select * into project from hub.projects where id=(source->>'project_id')::uuid for update;
 -- Reuse the ordinary save commands: field restrictions, identity checks, source
 -- comparisons, media rights and reviewed-English readiness stay authoritative.
 case kind
 when 'project' then perform hub.patch_project((source->>'id')::uuid,changes,(source->>'updated_at')::timestamptz);
 when 'brand' then perform hub.update_brand_draft((source->>'id')::uuid,changes,(source->>'updated_at')::timestamptz);
 when 'model' then perform hub.patch_model((source->>'id')::uuid,changes);
 when 'faq' then perform hub.save_faq((source->>'id')::uuid,(source->>'revision')::integer,changes);
 when 'section' then perform hub.save_content_section(source->>'scope_type',source->>'scope_id',source->>'section_key',(source->>'revision')::integer,changes);
 when 'article' then perform hub.article_save((source->>'id')::uuid,(source->>'revision')::integer,changes);
 when 'page_config' then perform hub.web_page_save(source->>'page_key',(source->>'revision')::integer,changes);
 when 'selling_point' then perform hub.save_selling_point(project.public_project_id,(source->>'point_key')::uuid,(source->>'revision')::integer,changes);
 when 'contact' then perform hub.save_content_contact(source->>'scope_type',source->>'scope_id',(source->>'id')::uuid,(source->>'revision')::integer,changes);
 when 'fact' then perform hub.save_project_fact(project.public_project_id,source->>'fact_key',source->>'grain',(source->>'revision')::integer,changes);
 when 'building' then perform hub.save_project_building(project.public_project_id,source->>'building_key',(source->>'revision')::integer,changes);
 when 'facility' then perform hub.c4_facility_save(project.public_project_id,source->>'facility_code',(source->>'revision')::integer,changes);
 when 'feature','place','solar' then perform hub.c4_item_save(project.public_project_id,case kind when 'feature' then 'features' when 'place' then 'places' else kind end,(source->>'id')::uuid,(source->>'revision')::integer,changes);
 when 'unit_type' then perform hub.update_commercial_type(project.id,source->>'public_commercial_type_id',changes,project.updated_at);
 when 'price' then perform hub.save_project_price(project.public_project_id,(source->>'id')::uuid,project.updated_at,changes);
 when 'disclosure','sales_term','programme','progress' then
  commercial_kind:=case kind when 'disclosure' then 'disclosures' when 'sales_term' then 'sales-terms' when 'programme' then 'programmes' else 'construction' end;
  perform hub.save_project_commercial(project.public_project_id,commercial_kind,(source->>'id')::uuid,project.updated_at,changes);
 when 'question' then perform hub.save_faq_question(source->>'question_key',(source->>'revision')::integer,changes);
 when 'glossary' then perform hub.save_glossary(source->>'term_key',(source->>'revision')::integer,changes);
 when 'asset_context' then perform hub.media_link_save(project.public_project_id,(source->>'id')::uuid,(source->>'revision')::integer,changes);
 when 'media_link' then perform hub.media_clip_save(project.public_project_id,(source->>'id')::uuid,(source->>'revision')::integer,changes);
 when 'asset' then
  select p.public_project_id into ref from hub.projects p where p.id in (select project_id from hub.entity_assets where asset_id=(source->>'id')::uuid and deleted_at is null
   union select project_id from hub.asset_links where asset_id=(source->>'id')::uuid and deleted_at is null) order by p.id limit 1;
  if ref is null then raise exception 'Use an authorized project media context' using errcode='23514';end if;
  perform hub.media_save_asset(ref,(source->>'id')::uuid,(source->>'media_revision')::integer,changes);
 else
  -- Bindings/targets have no standalone draft text. Their existing guarded
  -- parent editor creates the identity; this captures a new review version.
  if changes<>'{}' then raise exception 'Edit this binding through its parent command' using errcode='23514';end if;
 end case;
 source:=hub.content_workflow_source(kind,identity,'edit');
 result:=hub.content_workflow_submit(kind,identity,hub.content_workflow_hash(source));
 return hub.content_workflow_review(kind,identity,result->>'expected_hash','approve',reason);
end $$;

-- Editing a returned/approved item creates the next version; submitted items
-- cannot be bypassed through an older save endpoint.
create function hub.content_native_freeze() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare row_data jsonb:=case when tg_op='INSERT' then to_jsonb(new) else to_jsonb(old) end;kind text:=tg_argv[0];begin
 if kind='selling_point' then
  if tg_op='INSERT' and exists(select 1 from hub.project_selling_points where project_id=new.project_id and point_key=new.point_key and state='IN_REVIEW') then
   raise exception 'Submitted content is frozen; return this item before editing' using errcode='23514';end if;
 elsif upper(coalesce(row_data->>'state',row_data->>'review_state',row_data->>'status',''))='IN_REVIEW' and
  (tg_op='DELETE' or to_jsonb(new)->'draft_version_id' is distinct from row_data->'draft_version_id'
   or hub.content_workflow_payload(kind,to_jsonb(new)) is distinct from hub.content_workflow_payload(kind,row_data)) then
  raise exception 'Submitted content is frozen; return this item before editing' using errcode='23514';
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
do $$ declare kind text;begin
 foreach kind in array array['faq','section','article','unit_type','price','disclosure','sales_term','programme','progress','question'] loop
  execute format('create trigger content_native_freeze before update or delete on hub.%I for each row execute function hub.content_native_freeze(%L)',hub.content_workflow_table(kind),kind);
 end loop;
 create trigger content_native_freeze before insert on hub.project_selling_points for each row execute function hub.content_native_freeze('selling_point');
end $$;

-- Solar had a direct draft approval path. It now shares the submitted review,
-- while retaining the original route, signature and returned source shape.
create or replace function hub.c4_solar_review(public_id text,item uuid,expected integer,decision text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare source jsonb;begin
 perform hub.media_project(public_id,'approve');source:=hub.content_workflow_source('solar',jsonb_build_object('id',item),'approve');
 if source->>'project_id' is distinct from (select id::text from hub.projects where public_project_id=c4_solar_review.public_id)
  or (source->>'revision')::integer is distinct from expected then raise exception 'Scenario changed' using errcode='40001';end if;
 perform hub.content_workflow_review('solar',jsonb_build_object('id',item),hub.content_workflow_hash(source),decision,current_setting('app.content_review_reason',true));
 return hub.content_workflow_source('solar',jsonb_build_object('id',item),'view')-'_tab';
end $$;

create function hub.content_staged_evidence() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if new.kind='disclosures' then new.staged_evidence:=hub.content_workflow_staged_values('disclosure',(select to_jsonb(d) from hub.project_disclosures d where id=new.record_id));end if;
 return new;
end $$;
create trigger content_staged_evidence before insert on hub.project_commercial_versions for each row execute function hub.content_staged_evidence();

-- Existing direct SQL evidence retains its Projects E/A RLS boundary. The
-- ordinary application reader must not expose internal dependency selectors.
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.project_commercial_workspace(text)'::regprocedure);
 d:=hub.content_definition_replace(d,'(to_jsonb(v)-''source_snapshot'')',
  '((to_jsonb(v)-''source_snapshot'')||jsonb_build_object(''staged_evidence'',v.staged_evidence-''_disclosure_sources'',
    ''staged_current_values'',v.staged_current_values-''_disclosure_sources''))');
 execute d;
end $$;

-- The original glossary approval route remains a Manager command. Capture its
-- newly approved revision rather than leaving an old endpoint unversioned.
create function hub.content_glossary_version() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
<<glossary_values>>
declare identity jsonb:=jsonb_build_object('term_key',new.term_key);payload jsonb;hash text;latest hub.content_review_versions;begin
 if new.status not in ('active','retired') or new.approved_at is not distinct from old.approved_at then return new;end if;
 payload:=to_jsonb(new)||jsonb_build_object('_staged_values','{}'::jsonb);hash:=hub.web_hash(hub.content_workflow_payload('glossary',payload));
 select * into latest from hub.content_review_versions v where kind='glossary' and v.identity=glossary_values.identity order by version_no desc limit 1;
 if new.status='retired' then
  if latest.source_hash=hash and latest.state in ('IN_REVIEW','APPROVED','WITHDRAWN') then
   if latest.state<>'WITHDRAWN' then
    update hub.content_review_versions set state='WITHDRAWN',decision_reason=new.decision_reason,updated_by=hub.permission_actor(),updated_at=clock_timestamp() where id=latest.id;
   end if;
   return new;
  end if;
 elsif latest.source_hash=hash and latest.state='APPROVED' then return new;end if;
 insert into hub.content_review_versions(kind,identity,version_no,source_hash,payload,editors,state,approved_by,approved_at,decision_reason,self_approval,created_by,updated_by)
  select 'glossary',glossary_values.identity,coalesce(max(version_no),0)+1,glossary_values.hash,glossary_values.payload,
   hub.content_workflow_authors('glossary',glossary_values.identity,glossary_values.payload),
   case new.status when 'active' then 'APPROVED' else 'WITHDRAWN' end,
   case when new.status='active' then new.approved_by end,case when new.status='active' then new.approved_at end,
   new.decision_reason,new.self_approval,new.approved_by,new.approved_by
   from hub.content_review_versions where kind='glossary' and content_review_versions.identity=glossary_values.identity;
 return new;
end $$;
create trigger content_glossary_version after update on hub.translation_glossary for each row execute function hub.content_glossary_version();

-- Imported-value drift is recorded by the existing version audit trigger, at
-- import time. GET remains read-only. The frozen payload/approval actor and all
-- previous drafts survive; a new review version is required to clear the flag.
create function hub.content_staged_invalidation() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare project uuid;affected uuid[]:='{}';old_group text;new_group text;old_ref text;new_ref text;
 version hub.content_review_versions;commercial hub.project_commercial_versions;current_values jsonb;
 prior_reason text:=current_setting('app.change_reason',true);begin
 if tg_op<>'INSERT' then old_group:=nullif(old.source_record->>'rem_project_group_id','');old_ref:=old.rem_project_id;end if;
 if tg_op<>'DELETE' then new_group:=nullif(new.source_record->>'rem_project_group_id','');new_ref:=new.rem_project_id;end if;
 -- Serialize with submit/review before scanning versions: an import waiting
 -- behind an uncommitted submit must see and invalidate its new certificate.
 -- Neighbour membership can change the displayed phase count for both groups.
 for project in select p.id from hub.projects p where p.rem_project_id in (old_ref,new_ref) or exists(
  select 1 from staging.dw_projects d where d.rem_project_id=p.rem_project_id
   and d.source_record->>'rem_project_group_id' in (old_group,new_group)) order by p.id for update loop
  affected:=array_append(affected,project);
 end loop;
 perform set_config('app.change_reason','Relevant imported values require Manager re-approval',true);
 foreach project in array affected loop
  for version in select * from hub.content_review_versions where kind in ('project','fact','building') and state in ('IN_REVIEW','APPROVED')
   and (payload->>'project_id'=project::text or kind='project' and payload->>'id'=project::text) order by id for update loop
   current_values:=hub.content_workflow_staged_values(version.kind,version.payload);
   if coalesce(version.payload->'_staged_values','{}') is distinct from current_values and version.staged_current_values is distinct from current_values then
    update hub.content_review_versions set staged_invalidated_at=coalesce(staged_invalidated_at,clock_timestamp()),staged_current_values=current_values where id=version.id;
   end if;
  end loop;
  for commercial in select * from hub.project_commercial_versions where project_id=project and kind='disclosures' and state in ('in_review','approved')
   and staged_evidence is not null order by id for update loop
   current_values:=hub.content_workflow_staged_values('disclosure',commercial.payload||jsonb_build_object('project_id',project,
    '_disclosure_sources',commercial.staged_evidence->'_disclosure_sources'))-'_disclosure_sources';
   if (commercial.staged_evidence-'_disclosure_sources') is distinct from current_values and commercial.staged_current_values is distinct from current_values then
    update hub.project_commercial_versions set staged_invalidated_at=coalesce(staged_invalidated_at,clock_timestamp()),staged_current_values=current_values where id=commercial.id;
   end if;
  end loop;
 end loop;
 perform set_config('app.change_reason',coalesce(prior_reason,''),true);return null;
end $$;
create trigger content_staged_invalidation after insert or update of source_record or delete on staging.dw_projects for each row execute function hub.content_staged_invalidation();

-- W3 history stays an audit projection: resolve the current object before
-- delegating to its finite mapper, and expose only the existing field allowlist.
create function hub.content_workflow_history_staged(value jsonb) returns jsonb
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select coalesce(jsonb_object_agg(k,case when k='building' and jsonb_typeof(v)='object' then
  (select coalesce(jsonb_object_agg(bk,bv),'{}') from jsonb_each(v) b(bk,bv) where bk in ('name','floors_above','unit_count')) else v end),'{}')
 from jsonb_each(coalesce(nullif(value,'null'),'{}')) x(k,v)
 where k in ('project.land_area_sqwah','project.unit_total','project.project_status','project.phase_count','project.building_count','project.floors_max','building','disclosure.building_units')
$$;
create function hub.content_workflow_history_review(table_name text,value jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare name text:=replace(table_name,'hub.','');kind text;identity jsonb;source jsonb;result jsonb;may_approve boolean:=false;begin
 if value is null then return '{}';end if;
 case name
 when 'content_review_versions' then kind:=value->>'kind';identity:=value->'identity';
 when 'faq_versions' then kind:='faq';identity:=jsonb_build_object('id',value->>'faq_id');
 when 'content_section_versions' then kind:='section';identity:=jsonb_build_object('id',value->>'section_id');
 when 'article_versions' then kind:='article';identity:=jsonb_build_object('id',value->>'article_id');
 when 'commercial_type_versions' then kind:='unit_type';identity:=jsonb_build_object('id',value->>'commercial_type_id');
 when 'project_price_versions' then kind:='price';identity:=jsonb_build_object('id',value->>'price_id');
 when 'project_commercial_versions' then
  kind:=case value->>'kind' when 'disclosures' then 'disclosure' when 'sales-terms' then 'sales_term' when 'programmes' then 'programme' when 'construction' then 'progress' end;
  identity:=jsonb_build_object('id',value->>'record_id');
 when 'faq_questions' then kind:='question';identity:=jsonb_build_object('question_key',value->>'question_key');
 when 'project_selling_points' then kind:='selling_point';identity:=hub.content_workflow_identity(kind,value);
 when 'translation_glossary' then kind:='glossary';identity:=jsonb_build_object('term_key',value->>'term_key');
 else return '{}';end case;
 source:=hub.content_workflow_source(kind,identity,'view');
 select coalesce(jsonb_object_agg(k,v),'{}') into result from jsonb_each(value) x(k,v)
  where k in ('version_no','revision','state','review_state','decision_reason','self_approval','staged_invalidated_at');
 if name='content_review_versions' then result:=result||jsonb_build_object('snapshot',
  hub.workspace_history_fields('hub.'||hub.content_workflow_table(kind),value->'payload'));end if;
 begin perform hub.content_workflow_source(kind,identity,'approve');may_approve:=true;
 exception when insufficient_privilege or no_data_found then may_approve:=false;end;
 if may_approve and value->>'staged_invalidated_at' is not null then result:=result||jsonb_build_object('staged_evidence',jsonb_build_object(
  'approved',hub.content_workflow_history_staged(coalesce(value#>'{payload,_staged_values}',value->'staged_evidence')),
  'current',hub.content_workflow_history_staged(value->'staged_current_values')));end if;
 return result;
 exception when insufficient_privilege or no_data_found then return '{}';
end $$;
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.workspace_history_contexts(text,jsonb)'::regprocedure);
 d:=hub.content_definition_replace(d,'if row_data is null or table_name not like ''hub.%'' then return;end if;',
  'if row_data is null or table_name not like ''hub.%'' then return;end if;
 if name=''content_review_versions'' then
  child:=hub.content_workflow_source(r->>''kind'',r->''identity'',''view'');
  return query select c||jsonb_build_object(''target'',c->''target''||jsonb_build_object(''version'',r->''id''))
   from hub.workspace_history_contexts(''hub.''||hub.content_workflow_table(r->>''kind''),child-array[''_tab'',''_tabs'',''_staged_values'']) c;
  return;
 elsif name=''translation_glossary'' then
  perform hub.content_workflow_source(''glossary'',jsonb_build_object(''term_key'',r->>''term_key''),''view'');
  return next jsonb_build_object(''kind'',''corporate'',''ref'',''sena'',''name'',hub.workspace_name(''corporate'',''sena''),
   ''source_tab'',''knowledge'',''section_key'',''glossary'',''project_ids'',''[]''::jsonb,
   ''target'',hub.workspace_target(''corporate'',''sena'',''history'',jsonb_build_object(''term'',r->>''term_key'',''item'',r->>''term_key'')));
  return;
 end if;');execute d;
 d:=pg_get_functiondef('hub.workspace_history_fields(text,jsonb)'::regprocedure);
 d:=hub.content_definition_replace(d,'if value is null then return null;end if;',
  'if value is null then return null;end if;
 if name=''content_review_versions'' then return hub.content_workflow_history_review(table_name,value);end if;');
 d:=hub.content_definition_replace(d,'when name=''content_translations'' then array',
  'when name=''translation_glossary'' then array[''term_key'',''term'',''status'',''revision'']
 when name=''content_translations'' then array');
 d:=hub.content_definition_replace(d,'return result;','return result||hub.content_workflow_history_review(table_name,value);');execute d;
 d:=pg_get_functiondef('hub.workspace_history_action(audit.change_log)'::regprocedure);
 d:=hub.content_definition_replace(d,'coalesce(event.before_row->>''state'',','coalesce(event.before_row->>''review_state'',event.before_row->>''state'',');
 d:=hub.content_definition_replace(d,'coalesce(event.after_row->>''state'',','coalesce(event.after_row->>''review_state'',event.after_row->>''state'',');
 d:=hub.content_definition_replace(d,'event.after_row->>''self_approved''=''true''','event.after_row->>''self_approved''=''true'' or event.after_row->>''self_approval''=''true''');
 d:=hub.content_definition_replace(d,'if event.table_name=''hub.web_changes'' then',
  'if event.after_row->>''staged_invalidated_at'' is not null and event.before_row->>''staged_invalidated_at'' is distinct from event.after_row->>''staged_invalidated_at'' then return ''needs_reapproval'';end if;
 if event.table_name=''hub.web_changes'' then');execute d;
 d:=pg_get_functiondef('hub.workspace_history_event(audit.change_log,jsonb,boolean)'::regprocedure);
 d:=hub.content_definition_replace(d,'''reason'',event.reason,','''reason'',coalesce(event.after_row->>''decision_reason'',event.reason),');execute d;
end $$;

-- No direct actor DML and no default PUBLIC execute on implementation helpers.
do $$ declare signature regprocedure;begin
 for signature in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub' and
  (p.proname like 'content_workflow_%' or p.proname in ('content_review_reason','content_self_review','content_decision_stamp','content_review_version_guard','content_submission_freeze','content_native_freeze','content_native_authors','content_staged_evidence','content_staged_invalidation','content_glossary_version')) loop
  execute format('revoke all on function %s from public,hub_app',signature);
 end loop;
end $$;
grant execute on function hub.content_workflow_read(text,jsonb),hub.content_workflow_submit(text,jsonb,text),
 hub.content_workflow_review(text,jsonb,text,text,text),hub.content_workflow_save_approve(text,jsonb,text,jsonb,text) to hub_app;

commit;
