-- K4: reviewed local website publications. Existing content and grants are preserved.
begin;

update hub.permission_catalog set special_actions=array_append(special_actions,'knowledge.publish_web'),
 special_labels=special_labels||'{"knowledge.publish_web":"เผยแพร่ขึ้นเว็บ"}'::jsonb where tab='knowledge';
update hub.field_catalog set status='active' where entity='web_page' and status='planned';
alter table hub.account_permission add constraint web_publish_requires_approval
 check(not 'knowledge.publish_web'=any(special_actions) or tab='knowledge' and can_view and can_approve);
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.normalise_permission_tabs(jsonb)'::regprocedure);
 d:=replace(d,'or (c.separate_edit_approve and levels ? ''edit'' and levels ? ''approve'') then',
  'or (c.separate_edit_approve and levels ? ''edit'' and levels ? ''approve'')
   or (levels ? ''knowledge.publish_web'' and not levels ? ''approve'') then');
 if strpos(d,'levels ? ''knowledge.publish_web''')=0 then raise exception 'Missing special validation extension';end if;execute d;
end $$;

create table hub.web_pages (
 id uuid primary key default gen_random_uuid(),page_key text not null unique,
 page_type text not null check(page_type in ('project','brand','programme','corporate','article','location')),
 entity_ref text not null check(entity_ref ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
 project_ids text[] not null default '{}' check(cardinality(project_ids)<=30),
 url text not null check(url ~ '^/[A-Za-z0-9_/%.-]+$' and url !~ '//|\.\.' and length(url)<=500),
 locales text[] not null default array['th','en'] check(locales <@ array['th','en'] and 'th'=any(locales) and cardinality(locales)<=2),
 ai_policy text not null default 'no_ai' check(ai_policy in ('open','search_only','no_ai')),
 max_faq_items integer not null default 20 check(max_faq_items between 0 and 100),
 revision integer not null default 1 check(revision>0),editors uuid[] not null default '{}',
 published_version_id uuid,last_output_hashes jsonb not null default '{}',
 check(page_key=page_type||':'||entity_ref),check(page_type='project' or cardinality(project_ids)=0)
);
create table hub.web_publications (
 id uuid primary key default gen_random_uuid(),pages jsonb not null check(jsonb_typeof(pages)='array' and jsonb_array_length(pages) between 1 and 100),
 digest text not null check(digest ~ '^[a-f0-9]{64}$'),reason text not null check(length(btrim(reason)) between 1 and 2000),
 editors uuid[] not null,state text not null default 'IN_REVIEW' check(state in ('IN_REVIEW','PUBLISHED','RETURNED')),
 published_by uuid,published_at timestamptz
);
create table hub.web_changes (
 cursor bigint generated always as identity primary key,page_key text not null references hub.web_pages(page_key),
 locale text not null check(locale in ('th','en')),operation text not null check(operation in ('publish','withdraw','rollback','visibility')),
 content_sha256 text,occurred_at timestamptz not null default clock_timestamp()
);
alter table hub.entity_versions alter column project_id drop not null;
alter table hub.entity_versions add column entity_type text not null default 'project',
 add column web_page_id uuid references hub.web_pages,add column content_sha256 text,
 add constraint web_snapshot_identity check(entity_type='project' and project_id is not null and web_page_id is null
  or entity_type='web_page' and project_id is null and web_page_id is not null and content_sha256 ~ '^[a-f0-9]{64}$'),
 add unique(web_page_id,version_no),add unique(web_page_id,id);
alter table hub.web_pages add foreign key(id,published_version_id) references hub.entity_versions(web_page_id,id);
-- Legacy Projects SELECT policies must never expose a private website batch.
create policy web_snapshot_private on hub.entity_versions as restrictive to hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer
 using(entity_type='project') with check(false);

do $$ declare name text;begin
 foreach name in array array['web_pages','web_publications','web_changes'] loop
  execute format('alter table hub.%I add column created_at timestamptz not null default clock_timestamp(),
   add column created_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid,
   add column updated_at timestamptz not null default clock_timestamp(),
   add column updated_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid',name);
  execute format('alter table hub.%I enable row level security',name);execute format('alter table hub.%I force row level security',name);
  execute format('create policy web_owner on hub.%I to %I using(true) with check(true)',name,current_user);
  execute format('create trigger web_audit after insert or update or delete on hub.%I for each row execute function audit.record_change()',name);
 end loop;
end $$;
create function hub.web_publication_guard() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if tg_op='DELETE' or (to_jsonb(new)-array['state','published_by','published_at']) is distinct from (to_jsonb(old)-array['state','published_by','published_at']) then
  raise exception 'Prepared publication is immutable' using errcode='23514';end if;return new;
end $$;
create trigger web_publication_immutable before update or delete on hub.web_publications for each row execute function hub.web_publication_guard();

create function hub.web_hash(value jsonb) returns text language sql immutable set search_path=pg_catalog,pg_temp as $$
 select encode(sha256(convert_to(value::text,'UTF8')),'hex')
$$;
create function hub.web_localized(value jsonb,locale text) returns jsonb language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare result jsonb;k text;v jsonb;begin
 if jsonb_typeof(value)='object' then
  if value ? 'th' and not exists(select 1 from jsonb_object_keys(value) x where x not in ('th','en')) then
   return to_jsonb(coalesce(nullif(value->>locale,''),value->>'th',''));end if;
  result:='{}';for k,v in select * from jsonb_each(value) loop result:=result||jsonb_build_object(k,hub.web_localized(v,locale));end loop;return result;
 elsif jsonb_typeof(value)='array' then
  return coalesce((select jsonb_agg(hub.web_localized(x,locale)) from jsonb_array_elements(value) x),'[]');
 end if;return value;
end $$;
create function hub.web_fallback(value jsonb,locale text) returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v jsonb;begin
 if locale='th' then return false;end if;
 if jsonb_typeof(value)='object' then
  if value ? 'th' and btrim(coalesce(value->>'th',''))<>'' and btrim(coalesce(value->>locale,''))='' then return true;end if;
  for v in select x from jsonb_each(value) e(k,x) loop if hub.web_fallback(v,locale) then return true;end if;end loop;
 elsif jsonb_typeof(value)='array' then for v in select * from jsonb_array_elements(value) loop if hub.web_fallback(v,locale) then return true;end if;end loop;
 end if;return false;
end $$;
create function hub.web_source(table_name text,identity jsonb) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;begin
 if table_name not in ('projects','brands','assets','entity_assets','brand_assets','asset_links','commercial_types','commercial_type_versions',
  'commercial_type_assets','project_prices','project_price_versions','project_disclosures','project_sales_terms','project_programmes','project_progress',
  'project_commercial_versions','project_facts','project_buildings','project_selling_points','content_sections','content_section_versions',
  'faqs','faq_versions','faq_questions','contacts','project_features','feature_catalog','project_facilities','facility_taxonomy','project_places',
  'solar_estimates','media_links','media_link_targets','articles','article_versions','article_links','field_catalog','content_translations')
  or jsonb_typeof(identity) is distinct from 'object' or identity='{}' then raise exception 'Invalid website source' using errcode='23514';end if;
 execute format('select to_jsonb(t) from hub.%I t where to_jsonb(t) @> $1',table_name) into strict result using identity;
 return result;
 exception when no_data_found then return null;
end $$;
create function hub.web_source_content(value jsonb) returns jsonb language sql immutable set search_path=pg_catalog,pg_temp as $$
 select value-array['created_at','created_by','updated_at','updated_by','approved_by','approved_at','state','draft_version_id','published_version_id','approved_version_id','revision']
$$;
create function hub.web_authored_content(table_name text,value jsonb) returns jsonb language sql immutable set search_path=pg_catalog,pg_temp as $$
 select case when table_name='assets' then (select coalesce(jsonb_object_agg(k,v),'{}') from jsonb_each(value) e(k,v)
  where k=any(array['original_filename','checksum','public_url','media_category','caption','alt_text','image_kind','taken_at','people','third_party_marks','credit','ai_exposure','marketing_publication','metadata_state']))
  when table_name='faq_questions' then hub.web_source_content(value)-'status'
  else hub.web_source_content(value) end
$$;
create function hub.web_dependency(table_name text,identity jsonb,tab text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare value jsonb;authors jsonb;begin
 value:=hub.web_source(table_name,identity);
 if value is null then raise exception 'Website source disappeared' using errcode='40001';end if;
 if jsonb_array_length(coalesce(value->'editors','[]'))>0 then authors:=value->'editors';
 else
  select coalesce(jsonb_agg(actor order by actor),'[]') into authors from (
   select distinct actor from audit.change_log where change_log.table_name='hub.'||web_dependency.table_name and actor is not null
    and after_row @> identity and hub.web_authored_content(web_dependency.table_name,after_row) is distinct from hub.web_authored_content(web_dependency.table_name,before_row)
   union select (value->>'created_by')::uuid where value->>'created_by' is not null) a;
 end if;
 authors:=authors||coalesce((select jsonb_agg(distinct x) from jsonb_path_query(value,'$.translations.**.reviewed_by') x where x<>'null'::jsonb),'[]');
 return jsonb_build_object('table',table_name,'identity',identity,'tab',tab,'hash',hub.web_hash(hub.web_source_content(value)),'editors',authors);
end $$;
create function hub.web_source_available(dependency jsonb) returns boolean language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare value jsonb;kind text:=dependency->>'table';today date:=(current_timestamp at time zone 'Asia/Bangkok')::date;begin
 value:=hub.web_source(kind,dependency->'identity');
 if value is null or value->>'deleted_at' is not null or value->>'ai_exposure'='internal' or upper(coalesce(value->>'state',''))='WITHDRAWN'
  or value->>'status' in ('withdrawn','retired') then return false;end if;
 if value->>'effective_from' is not null and (value->>'effective_from')::timestamptz>now()
  or value->>'effective_to' is not null and (value->>'effective_to')::timestamptz<=now()
  or value->>'valid_from' is not null and (value->>'valid_from')::date>today
  or value->>'valid_to' is not null and (value->>'valid_to')::date<today
  or value->>'review_due' is not null and (value->>'review_due')::date<today then return false;end if;
 if kind='assets' then return value->>'rights_status'='approved' and value->>'metadata_state'='confirmed'
  and (value->>'marketing_publication')::boolean and value->>'media_category' is distinct from 'legal_document';
 elsif kind='media_links' then return value->>'state'<>'WITHDRAWN' and value->>'link_status'='ok';
 elsif kind='project_prices' then return value->>'state'='approved' and exists(select 1 from hub.commercial_types c where c.id=(value->>'commercial_type_id')::uuid and c.deleted_at is null and c.status='approved' and c.price_mode='manual' and c.ai_exposure<>'internal');
 elsif kind in ('project_disclosures','project_sales_terms','project_programmes','project_progress','solar_estimates') then return value->>'state'='approved';
 elsif kind='commercial_types' then return value->>'status'='approved';
 elsif kind='brands' then return value->>'status' is distinct from 'inactive';
 elsif kind='faqs' then return not exists(select 1 from hub.faq_sources s join hub.knowledge_reviews r on r.candidate_id=s.candidate_id where s.faq_id=(value->>'id')::uuid and r.decision<>'accepted');
 elsif kind='article_versions' then return value->>'state'='APPROVED';
 elsif kind='faq_questions' then return value->>'status'='approved';
 elsif kind='project_places' then return (value->>'show_on_web')::boolean;
 elsif kind='project_selling_points' then return exists(select 1 from (select state,ai_exposure from hub.project_selling_points where project_id=(value->>'project_id')::uuid and point_key=(value->>'point_key')::uuid order by revision desc limit 1) latest where latest.state<>'WITHDRAWN' and latest.ai_exposure<>'internal' and latest.ai_exposure=value->>'ai_exposure');
 elsif kind='feature_catalog' then return (value->>'active')::boolean;
 elsif kind='field_catalog' then return value->>'status'='active' and value->>'default_ai_exposure'<>'internal' and value->'surfaces'<>'["hub_only"]'::jsonb;
 end if;return true;
end $$;
create function hub.web_item(data jsonb,dependencies jsonb,exposure text default 'open') returns jsonb language sql immutable set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('_item',true,'data',data,'dependencies',dependencies,'ai_exposure',exposure)
$$;
create function hub.web_asset(asset uuid,bindings jsonb,exposure text default 'open') returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.assets;dep jsonb;binding jsonb;l hub.asset_links;context jsonb;kind text;begin
 select * into a from hub.assets where id=asset;
 if not found then return null;end if;
 if not hub.can_read_asset(asset) then raise exception 'Website asset permission required' using errcode='42501';end if;
 dep:=hub.web_dependency('assets',jsonb_build_object('id',asset),coalesce(bindings->0->>'tab','projects'));
 if not hub.web_source_available(dep) then return null;end if;
 for binding in select * from jsonb_array_elements(bindings) where value->>'table'='asset_links' loop
  select * into l from hub.asset_links where id=(binding#>>'{identity,id}')::uuid;
  kind:=case l.target_type when 'facility' then 'project_facilities' when 'feature' then 'project_features' when 'place' then 'project_places' when 'commercial_type' then 'commercial_types' end;
  if kind is not null then
   context:=hub.web_dependency(kind,case when l.target_type='facility' then jsonb_build_object('project_id',l.project_id,'facility_code',l.target_key) else jsonb_build_object('id',l.target_key) end,'projects');
   bindings:=bindings||jsonb_build_array(context);
   if not coalesce(hub.web_source_available(context),false) then return null;end if;
   if hub.web_source(kind,context->'identity')->>'ai_exposure'='web_only' then exposure:='web_only';end if;
  end if;
 end loop;
 return hub.web_item(hub.public_content_payload('asset',to_jsonb(a))||jsonb_build_object('caption',a.caption,'alt_text',a.alt_text,'credit',a.credit,'media_category',a.media_category),
  jsonb_build_array(dep)||bindings,case when 'web_only' in (exposure,a.ai_exposure) then 'web_only' else exposure end);
end $$;

create function hub.web_registry_fields(entity_name text,value jsonb) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb:='{}';f hub.field_catalog;k text;begin
 for f in select * from hub.field_catalog where entity=entity_name and status='active' and default_ai_exposure<>'internal'
  and exists(select 1 from unnest(surfaces) s where s like 'web.%') order by field_key loop
  k:=split_part(f.field_key,'.',2);
  if value ? k then result:=result||jsonb_build_object(k,hub.web_item(value->k,
   jsonb_build_array(hub.web_dependency('field_catalog',jsonb_build_object('field_key',f.field_key),case when entity_name='brand' then 'brands' else 'projects' end)),f.default_ai_exposure));end if;
 end loop;return result;
end $$;
create function hub.web_sections(kind text,ref text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare r record;items jsonb:='[]';tab text:=case kind when 'project' then 'projects' when 'brand' then 'brands' else 'knowledge' end;item jsonb;begin
 for r in select s.id identity_id,s.state identity_state,v.* from hub.content_sections s join hub.content_section_versions v on v.id=s.draft_version_id
  where s.scope_type=kind and s.scope_id=ref and s.state<>'WITHDRAWN' and v.ai_exposure<>'internal' and s.section_key is not null order by s.section_key loop
  item:=hub.web_item(jsonb_build_object('section_key',r.section_key,'title',r.title,'body',r.body,'summary',r.summary),
   jsonb_build_array(hub.web_dependency('content_sections',jsonb_build_object('id',r.identity_id),tab),
    hub.web_dependency('content_section_versions',jsonb_build_object('id',r.id),tab),
    hub.web_dependency('field_catalog',jsonb_build_object('field_key',r.section_key),tab)),r.ai_exposure);
  if r.state not in ('IN_REVIEW','PUBLISHED') then item:=item||jsonb_build_object('_issues',jsonb_build_array(jsonb_build_object('code','section_not_submitted','field_key',r.section_key)));end if;
  items:=items||jsonb_build_array(item);
 end loop;return items;
end $$;
create function hub.web_contacts(kind text,ref text) returns jsonb language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce(jsonb_agg(hub.web_item(jsonb_build_object('channel',channel,'value',value,'url',url,'label',label,'is_primary',is_primary),
  jsonb_build_array(hub.web_dependency('contacts',jsonb_build_object('id',id),case kind when 'project' then 'projects' when 'brand' then 'brands' else 'knowledge' end)),ai_exposure) order by sort,id),'[]')
 from hub.contacts where scope_type=kind and scope_id=ref and ai_exposure<>'internal'
$$;
create function hub.web_faqs(project uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare th jsonb;en jsonb;i jsonb;e jsonb;v hub.faq_versions;f hub.faqs;node jsonb;deps jsonb;items jsonb:='[]';issues jsonb:='[]';proof jsonb;begin
 th:=hub.compose_project_faq(project,'th',null,false,false);en:=hub.compose_project_faq(project,'en',null,false,false);
 if not (th->>'ready')::boolean or not(en->>'ready')::boolean then issues:=issues||'[{"code":"faq_conflict_or_lint"}]';end if;
 for i in select * from jsonb_array_elements(th->'items') loop
  select * into v from hub.faq_versions where id=(i->>'version_id')::uuid;
  select * into f from hub.faqs where id=v.faq_id;
  select x into e from jsonb_array_elements(en->'items') x where x->>'version_id'=v.id::text;
  deps:=jsonb_build_array(hub.web_dependency('projects',jsonb_build_object('id',project),'projects'),hub.web_dependency('faqs',jsonb_build_object('id',f.id),'knowledge'),hub.web_dependency('faq_versions',jsonb_build_object('id',v.id),'knowledge'),
   hub.web_dependency('faq_questions',jsonb_build_object('question_key',v.question_key),'knowledge'));
  select coalesce(jsonb_agg(d),'[]') into proof from (
   select hub.web_dependency('project_facts',jsonb_build_object('id',pf.id),'projects') d from hub.project_facts pf where pf.project_id=project
   union all select hub.web_dependency('project_buildings',jsonb_build_object('project_id',pb.project_id,'building_key',pb.building_key),'projects') from hub.project_buildings pb where pb.project_id=project
   union all select hub.web_dependency('project_prices',jsonb_build_object('id',pp.id),'projects') from hub.project_prices pp where pp.project_id=project and pp.state='approved') evidence;
  node:=jsonb_build_object('_faq',true,'project_id',project,'version_id',v.id,'question_key',v.question_key,'dependencies',deps,
   'data',jsonb_build_object('th',i-array['faq_id','version_id','version_no','scope_type','inherited','state','lint','applies_to_project_ids','applicability_changed','facts','question_label'],
    'en',e-array['faq_id','version_id','version_no','scope_type','inherited','state','lint','applies_to_project_ids','applicability_changed','facts','question_label']),
   '_evidence',proof,'reviewed_facts',jsonb_build_object('th',i->'facts','en',e->'facts'),'resolved_project_ids',i->'applies_to_project_ids',
   'ai_exposure',case when 'web_only' in (i->>'ai_exposure',e->>'ai_exposure') then 'web_only' else 'open' end);
  if v.state not in ('IN_REVIEW','PUBLISHED') then node:=node||'{"_issues":[{"code":"faq_not_submitted"}]}';end if;
  if v.applicability_rule<>'{}' and v.applies_to_project_ids is distinct from hub.faq_rule_projects(v.applicability_rule,f.scope_type,f.scope_id) then
   node:=node||'{"_issues":[{"code":"faq_applicability_changed"}]}';end if;
  items:=items||jsonb_build_array(node);
 end loop;
 return jsonb_build_object('items',items,'_issues',issues,'hidden',coalesce((select jsonb_agg(jsonb_build_object('question_key',x->>'question_key','reason',x->>'reason','missing_fact_keys',x->'missing_fact_keys')) from jsonb_array_elements(th->'hidden') x),'[]'));
end $$;
create function hub.web_project(project uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects;body jsonb;items jsonb;deps jsonb;issues jsonb;ready jsonb;r record;b record;entry jsonb;item jsonb;facts jsonb:='[]';kind text;faq jsonb;slot jsonb;asset_uuid uuid;begin
 select * into p from hub.projects where id=project and deleted_at is null;
 if not found then raise exception 'Project not found' using errcode='P0002';end if;
 perform hub.require_permission('projects','view');perform hub.require_permission('knowledge','view');
 ready:=hub.project_content_readiness(p.public_project_id);
 select coalesce(jsonb_agg(jsonb_build_object('code','required_field','field_key',x->>'field_key','label',x->'label')),'[]') into issues
  from jsonb_array_elements(ready->'items') x where (x->>'required')::boolean and not(x->>'complete')::boolean;
 deps:=jsonb_build_array(hub.web_dependency('projects',jsonb_build_object('id',p.id),'projects'));
 body:=jsonb_build_object('public_project_id',p.public_project_id,'slug',p.slug,'fields',hub.web_registry_fields('project',to_jsonb(p)),
  'sections',hub.web_sections('project',p.public_project_id),'contacts',hub.web_contacts('project',p.public_project_id));
 for r in select * from hub.field_catalog where entity='project' and section='facts' and status='active' and default_ai_exposure<>'internal' order by sort,field_key loop
  slot:=hub.faq_fact_slot(p.id,r.field_key,'th',null,false);
  if (slot->>'available')::boolean then facts:=facts||jsonb_build_array(jsonb_build_object('_fact',true,'project_id',p.id,'field_key',r.field_key,
   'reviewed',jsonb_build_object('th',slot,'en',hub.faq_fact_slot(p.id,r.field_key,'en',null,false)),
   'dependencies',jsonb_build_array(hub.web_dependency('field_catalog',jsonb_build_object('field_key',r.field_key),'projects')),'ai_exposure',slot->>'ai_exposure'));end if;
 end loop;
 -- Every input author participates in the page's fact review, including derived inputs.
 for r in select id from hub.project_facts where project_id=p.id loop deps:=deps||jsonb_build_array(hub.web_dependency('project_facts',jsonb_build_object('id',r.id),'projects'));end loop;
 for r in select building_key from hub.project_buildings where project_id=p.id loop deps:=deps||jsonb_build_array(hub.web_dependency('project_buildings',jsonb_build_object('project_id',p.id,'building_key',r.building_key),'projects'));end loop;
 body:=body||jsonb_build_object('facts',facts);
 items:='[]';for r in select * from (select distinct on(point_key) * from hub.project_selling_points where project_id=p.id order by point_key,revision desc) t where state<>'WITHDRAWN' and ai_exposure<>'internal' order by sort,point_key loop
  items:=items||jsonb_build_array(hub.web_item(jsonb_build_object('title',r.title,'detail',r.detail,'icon_code',r.icon_code,'linked_feature_code',r.linked_feature_code,'linked_fact_keys',r.linked_fact_keys),
   jsonb_build_array(hub.web_dependency('project_selling_points',jsonb_build_object('project_id',p.id,'point_key',r.point_key,'revision',r.revision),'projects')),r.ai_exposure));
 end loop;body:=body||jsonb_build_object('selling_points',items);
 items:='[]';for r in select * from hub.entity_assets where project_id=p.id and deleted_at is null order by display_order,id loop
  item:=hub.web_asset(r.asset_id,jsonb_build_array(hub.web_dependency('entity_assets',jsonb_build_object('id',r.id),'projects')));
  if item is not null then item:=jsonb_set(item,'{data}',item->'data'||jsonb_build_object('usage',r.asset_role,'is_primary',r.is_primary));items:=items||jsonb_build_array(item);end if;
 end loop;
 for r in select * from hub.asset_links where project_id=p.id and deleted_at is null and target_type in ('project','facility','feature','place','building_floor','selling_point') and ai_exposure<>'internal' order by sort,id loop
  item:=hub.web_asset(r.asset_id,jsonb_build_array(hub.web_dependency('asset_links',jsonb_build_object('id',r.id),'projects')),r.ai_exposure);
  if item is not null then item:=jsonb_set(item,'{data}',item->'data'||jsonb_build_object('usage',r.usage,'context',r.target_type,'is_primary',r.is_primary));items:=items||jsonb_build_array(item);end if;
 end loop;body:=body||jsonb_build_object('media',items);
 items:='[]';for r in select * from hub.media_links where project_id=p.id and state<>'WITHDRAWN' and link_status='ok' and ai_exposure<>'internal' order by sort,id loop
  items:=items||jsonb_build_array(hub.web_item(jsonb_build_object('provider',r.provider,'kind',r.kind,'url',r.url,'title',r.title,'description',r.description,
   'published_at',r.published_at,'duration_sec',r.duration_sec,'language',r.language,'channel_name',r.channel_name),jsonb_build_array(hub.web_dependency('media_links',jsonb_build_object('id',r.id),'projects')),r.ai_exposure));
 end loop;body:=body||jsonb_build_object('videos',items);
 items:='[]';for r in select c.id,c.ai_exposure,v.id version_id,v.payload from hub.commercial_types c join hub.commercial_type_versions v on v.commercial_type_id=c.id and v.revision=c.revision
  where c.project_id=p.id and c.deleted_at is null and c.status='approved' and v.state='approved' and c.ai_exposure<>'internal' order by c.public_commercial_type_id loop
  item:=hub.web_item(r.payload-'assets'-'tours',jsonb_build_array(hub.web_dependency('commercial_types',jsonb_build_object('id',r.id),'projects'),hub.web_dependency('commercial_type_versions',jsonb_build_object('id',r.version_id),'projects')),r.ai_exposure);
  entry:='[]';for b in select a.id asset_id,c.id binding_id,c.asset_role,c.caption,c.room_tag,c.floor_label,c.floor_number,c.alt_text
   from hub.commercial_type_assets c join hub.assets a on a.id=c.asset_id where c.commercial_type_id=r.id and c.deleted_at is null and c.asset_role<>'structural_plan'
    and exists(select 1 from jsonb_array_elements(coalesce(r.payload->'assets','[]')) v where v->>'public_asset_id'='ast_'||coalesce(a.checksum,encode(sha256(convert_to(a.id::text,'UTF8')),'hex'))) order by c.display_order,c.id loop
   slot:=hub.web_asset(b.asset_id,jsonb_build_array(hub.web_dependency('commercial_type_assets',jsonb_build_object('id',b.binding_id),'projects')),r.ai_exposure);
   if slot is not null then slot:=jsonb_set(slot,'{data}',(slot->'data')||jsonb_build_object('asset_role',b.asset_role,'caption',b.caption,'room_tag',b.room_tag,'floor_label',b.floor_label,'floor_number',b.floor_number,'alt_text',b.alt_text));entry:=entry||jsonb_build_array(slot);end if;
  end loop;
  item:=jsonb_set(item,'{data}',item->'data'||jsonb_build_object('assets',entry));entry:='[]';
  for b in select l.*,t.id binding_id from hub.media_links l join hub.media_link_targets t on t.media_link_id=l.id where t.target_type='commercial_type' and t.target_key=r.id::text and l.state<>'WITHDRAWN' and l.link_status='ok' and l.ai_exposure<>'internal' order by l.sort,l.id loop
   entry:=entry||jsonb_build_array(hub.web_item(jsonb_build_object('url',b.url,'title',b.title,'description',b.description,'provider',b.provider,'kind',b.kind),
    jsonb_build_array(hub.web_dependency('media_links',jsonb_build_object('id',b.id),'projects'),hub.web_dependency('media_link_targets',jsonb_build_object('id',b.binding_id),'projects')),b.ai_exposure));end loop;
  item:=jsonb_set(item,'{data}',(item->'data')||jsonb_build_object('tours',entry));items:=items||jsonb_build_array(item);
 end loop;body:=body||jsonb_build_object('unit_types',items);
 items:='[]';for r in select f.*,t.name_th,t.name_en,t.icon_code from hub.project_facilities f join hub.facility_taxonomy t on t.code=f.facility_code
  where f.project_id=p.id and f.ai_exposure<>'internal' order by t.sort_order,t.code loop
  entry:='[]';for b in select * from hub.asset_links where project_id=p.id and target_type='facility' and target_key=r.facility_code and deleted_at is null and ai_exposure<>'internal' order by sort,id loop
   slot:=hub.web_asset(b.asset_id,jsonb_build_array(hub.web_dependency('asset_links',jsonb_build_object('id',b.id),'projects')),b.ai_exposure);
   if slot is not null then slot:=jsonb_set(slot,'{data}',(slot->'data')||jsonb_build_object('is_primary',b.is_primary));entry:=entry||jsonb_build_array(slot);end if;end loop;
  items:=items||jsonb_build_array(hub.web_item(jsonb_build_object('photos',entry,'code',r.facility_code,'name',case when r.display_name='{}' then jsonb_build_object('th',r.name_th,'en',r.name_en) else r.display_name end,
   'status',r.status,'description',r.description,'location_label',r.location_label,'size_sqm',r.size_sqm,'opening_hours',r.opening_hours,'expected_open',r.expected_open_date,'icon_code',r.icon_code),
   jsonb_build_array(hub.web_dependency('project_facilities',jsonb_build_object('project_id',p.id,'facility_code',r.facility_code),'projects'),hub.web_dependency('facility_taxonomy',jsonb_build_object('code',r.facility_code),'projects')),r.ai_exposure));
 end loop;body:=body||jsonb_build_object('facilities',items);
 items:='[]';for r in select f.*,c.label,c.explanation,c.ai_exposure catalog_exposure from hub.project_features f join hub.feature_catalog c on c.code=f.feature_code
  where f.project_id=p.id and c.active and f.ai_exposure<>'internal' and c.ai_exposure<>'internal' order by f.feature_code,f.id loop
  items:=items||jsonb_build_array(hub.web_item(jsonb_build_object('code',r.feature_code,'name',r.label,'explanation',r.explanation,'status',r.status,'detail',r.detail,'metrics',r.metrics,
   'source_note',r.source_note,'unit_type',(select public_commercial_type_id from hub.commercial_types where id=r.commercial_type_id)),
   jsonb_build_array(hub.web_dependency('project_features',jsonb_build_object('id',r.id),'projects'),hub.web_dependency('feature_catalog',jsonb_build_object('code',r.feature_code),'projects')),
   case when 'web_only' in(r.ai_exposure,r.catalog_exposure) then 'web_only' else 'open' end));
 end loop;body:=body||jsonb_build_object('features',items);
 items:='[]';for r in select * from hub.project_places where project_id=p.id and show_on_web and ai_exposure<>'internal' order by sort,id loop
  items:=items||jsonb_build_array(hub.web_item(jsonb_build_object('category',r.category,'reference',r.ref_id,'name',r.name,'distance_m',r.distance_m,'distance_method',r.distance_method,
   'travel_minutes',r.travel_minutes,'travel_mode',r.travel_mode,'status',r.status,'expected_open',r.expected_open,'as_of',r.as_of),jsonb_build_array(hub.web_dependency('project_places',jsonb_build_object('id',r.id),'projects')),r.ai_exposure));
 end loop;body:=body||jsonb_build_object('places',items);
 items:='[]';for r in select * from hub.solar_estimates where project_id=p.id and state='approved' and ai_exposure<>'internal' order by as_of,id loop
  items:=items||jsonb_build_array(hub.web_item(to_jsonb(r)-array['id','project_id','created_by','created_at','updated_by','updated_at','editors','approved_by','approved_at','revision','state'],
   jsonb_build_array(hub.web_dependency('solar_estimates',jsonb_build_object('id',r.id),'projects')),'web_only'));
 end loop;body:=body||jsonb_build_object('solar_estimates',items);
 items:='[]';for r in select c.id,c.commercial_type_id,c.ai_exposure,x.value payload from jsonb_array_elements(hub.project_current_prices(p.id)) x(value)
  join hub.project_prices c on c.public_price_id=x.value->>'public_price_id' loop
  items:=items||jsonb_build_array(hub.web_item(r.payload,jsonb_build_array(hub.web_dependency('project_prices',jsonb_build_object('id',r.id),'projects'),hub.web_dependency('commercial_types',jsonb_build_object('id',r.commercial_type_id),'projects')),r.ai_exposure));
 end loop;body:=body||jsonb_build_object('prices',items);
 for kind in select unnest(array['disclosures','sales-terms','programmes','construction']) loop
  items:='[]';for entry in select * from jsonb_array_elements(hub.project_current_commercial(p.id)->kind) loop
   execute format('select id,ai_exposure from hub.%I where public_content_id=$1',hub.project_commercial_table(kind)) into r using entry->>'public_content_id';
   items:=items||jsonb_build_array(hub.web_item(entry,jsonb_build_array(hub.web_dependency(hub.project_commercial_table(kind),jsonb_build_object('id',r.id),'projects')),r.ai_exposure));
  end loop;body:=body||jsonb_build_object(replace(kind,'-','_'),items);
 end loop;
 faq:=hub.web_faqs(p.id);body:=body||jsonb_build_object('faq',faq->'items','hidden',faq->'hidden');issues:=issues||(faq->'_issues');
 return hub.web_item(body,jsonb_build_array(deps->0),'open')||jsonb_build_object('_evidence',deps,'_issues',issues,'_fact_context',hub.web_hash(jsonb_build_object('rem',hub.content_rem_values(p.id),
  'facts',(select coalesce(jsonb_agg(hub.web_source_content(to_jsonb(f)) order by fact_key,grain),'[]') from hub.project_facts f where project_id=p.id),
  'buildings',(select coalesce(jsonb_agg(hub.web_source_content(to_jsonb(building_input)) order by building_key),'[]') from hub.project_buildings building_input where project_id=p.id))));
end $$;

-- Article references are resolved at review time. No internal reference IDs occur
-- in the resulting document; dependencies remain in the private envelope only.
create function hub.web_article_node(node jsonb) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare kind text:=node->>'type';a jsonb:=node->'attrs';r record;value jsonb;result jsonb;child jsonb;project uuid;begin
 if kind='libraryImage' then value:=hub.web_asset((a->>'asset_id')::uuid,'[]','web_only');
 elsif kind='mediaVideo' then
  perform hub.require_permission('projects','view');
  select * into r from hub.media_links where id=(a->>'media_link_id')::uuid and state<>'WITHDRAWN' and link_status='ok' and ai_exposure<>'internal';
  if found then value:=hub.web_item(jsonb_build_object('url',r.url,'title',r.title,'description',r.description,'provider',r.provider,'published_at',r.published_at,'duration_sec',r.duration_sec),
   jsonb_build_array(hub.web_dependency('media_links',jsonb_build_object('id',r.id),'projects')),r.ai_exposure);end if;
 elsif kind in ('projectCard','faqEmbed') then
  perform hub.require_permission('projects','view');
  select * into r from hub.projects where public_project_id=a->>'project_id' and deleted_at is null;
  if found then
   if kind='projectCard' then value:=hub.web_item(jsonb_build_object('public_project_id',r.public_project_id,'name',r.public_name,'slug',r.slug),
    jsonb_build_array(hub.web_dependency('projects',jsonb_build_object('id',r.id),'projects')));
   else select x into value from jsonb_array_elements(hub.web_faqs(r.id)->'items') x where x->>'question_key'=a->>'question_key';end if;
  end if;
 else
  result:=node-'content';
  if node ? 'content' then value:='[]';for child in select * from jsonb_array_elements(node->'content') loop value:=value||jsonb_build_array(hub.web_article_node(child));end loop;
   result:=result||jsonb_build_object('content',value);end if;return result;
 end if;
 return jsonb_build_object('type','reference','kind',kind,'value',value)||case when value is null then '{"_issues":[{"code":"article_reference_unavailable"}]}'::jsonb else '{}'::jsonb end;
end $$;
create function hub.web_article(slug text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.articles;v hub.article_versions;body jsonb;cover jsonb;deps jsonb;begin
 perform hub.require_permission('knowledge','view');select * into a from hub.articles where articles.slug=web_article.slug;
 if not found then raise exception 'Article not found' using errcode='P0002';end if;
 select * into v from hub.article_versions where id=a.approved_version_id and state='APPROVED';
 if not found then return '{"_issues":[{"code":"article_not_approved"}]}';end if;
 deps:=jsonb_build_array(hub.web_dependency('articles',jsonb_build_object('id',a.id),'knowledge'),hub.web_dependency('article_versions',jsonb_build_object('id',v.id),'knowledge'));
 if v.metadata->>'cover_asset_id' is not null then cover:=hub.web_asset((v.metadata->>'cover_asset_id')::uuid,'[]',v.metadata->>'ai_exposure');end if;
 body:=jsonb_build_object('slug',v.metadata->>'slug','title',v.title,'excerpt',v.excerpt,'seo_title',v.seo_title,'seo_description',v.seo_description,
  'author',v.metadata->'author','tags',v.metadata->'tags','category',v.metadata->>'category','cover',cover,
  'blocks',jsonb_build_object('_locale',true,'data',jsonb_build_object('th',hub.web_article_node(v.blocks->'th'),'en',hub.web_article_node(v.blocks->'en'))));
 return hub.web_item(body,deps,v.metadata->>'ai_exposure');
end $$;
create function hub.web_compose(page hub.web_pages) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare body jsonb:='{}';items jsonb:='[]';r record;binding record;ref text;deps jsonb:='[]';proof jsonb:='[]';begin
 perform hub.require_permission('knowledge','view');
 if page.page_type='project' then
  foreach ref in array page.project_ids loop
   select id into r from hub.projects where public_project_id=ref and deleted_at is null;
   if not found then raise exception 'Unknown page phase' using errcode='23514';end if;
   items:=items||jsonb_build_array(hub.web_project(r.id));
  end loop;
  if cardinality(page.project_ids)=0 then raise exception 'Explicit page phases required' using errcode='23514';end if;
  body:=jsonb_build_object('phases',items);
 elsif page.page_type='article' then body:=jsonb_build_object('article',hub.web_article(page.entity_ref));
 elsif page.page_type='brand' then
  perform hub.require_permission('brands','view');select * into r from hub.brands where public_brand_id=page.entity_ref and deleted_at is null;
  if not found then raise exception 'Brand not found' using errcode='P0002';end if;
  deps:=jsonb_build_array(hub.web_dependency('brands',jsonb_build_object('id',r.id),'brands'));
  for binding in select * from hub.brand_assets where brand_id=r.id and deleted_at is null order by display_order,id loop
   items:=items||jsonb_build_array(hub.web_asset(binding.asset_id,jsonb_build_array(hub.web_dependency('brand_assets',jsonb_build_object('id',binding.id),'brands'))));
  end loop;
  body:=hub.web_item(jsonb_build_object('public_brand_id',r.public_brand_id,'slug',r.slug,'fields',hub.web_registry_fields('brand',to_jsonb(r)),
   'sections',hub.web_sections('brand',page.entity_ref),'contacts',hub.web_contacts('brand',page.entity_ref),'media',items,'faq',hub.web_scope_faq('brand',page.entity_ref)),deps);
  for binding in select * from hub.field_catalog where entity='brand' and status='active' and required_for->>'all'='required' loop
   if not hub.translation_complete('brand',r.id::text,binding.field_key,to_jsonb(r)->split_part(binding.field_key,'.',2)) then
    body:=jsonb_set(body,'{_issues}',coalesce(body->'_issues','[]')||jsonb_build_array(jsonb_build_object('code','required_field','field_key',binding.field_key,'label',binding.label)));
   end if;
  end loop;
  for binding in select * from hub.field_catalog where entity='brand' and status='active' and required_for->>'all'='required' loop
   if not hub.translation_complete('brand',r.id::text,binding.field_key,to_jsonb(r)->split_part(binding.field_key,'.',2)) then
    body:=jsonb_set(body,'{_issues}',coalesce(body->'_issues','[]')||jsonb_build_array(jsonb_build_object('code','required_field','field_key',binding.field_key,'label',binding.label)));
   end if;
  end loop;
 else
  -- These registry types reuse submitted narratives and contacts; no Phase 10
  -- content generation, automatic group membership or new source ingestion.
  ref:=case when page.page_type='corporate' then 'sena' else page.entity_ref end;
  body:=jsonb_build_object('sections',hub.web_sections(page.page_type,ref),'contacts',hub.web_contacts(page.page_type,ref),'faq',hub.web_scope_faq(page.page_type,ref));
 end if;
 -- Translation reviewers are authors for four-eyes even if their role changes.
 for r in select t.id from hub.content_translations t where (t.source_tab=case page.page_type when 'brand' then 'brands' when 'project' then 'projects' else 'knowledge' end and t.scope_id=page.entity_ref)
  or (t.source_tab='projects' and t.scope_id=any(page.project_ids)) loop
  proof:=proof||jsonb_build_array(hub.web_dependency('content_translations',jsonb_build_object('id',r.id),case page.page_type when 'brand' then 'brands' when 'project' then 'projects' else 'knowledge' end));
 end loop;
 return jsonb_build_object('page_key',page.page_key,'page_type',page.page_type,'url',page.url,'locales',page.locales,'ai_policy',page.ai_policy,
  'max_faq_items',page.max_faq_items,'config_revision',page.revision,'body',body,'_evidence',proof,'_editors',page.editors);
end $$;
create function hub.web_scope_faq(kind text,ref text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare r record;locale text;name text;data jsonb;item jsonb;items jsonb:='[]';question text;answer text;detail text;begin
 for r in select f.id identity_id,v.* from hub.faqs f join hub.faq_versions v on v.id=f.draft_version_id
  join hub.faq_questions q on q.question_key=v.question_key and q.status='approved'
  where f.scope_type=kind and f.scope_id=ref and f.state<>'WITHDRAWN' and v.ai_exposure<>'internal' and q.ai_exposure<>'internal' order by v.question_key,v.id loop
  if cardinality(r.fact_keys)>0 then continue;end if;
  data:='{}';foreach locale in array array['th','en'] loop
   select coalesce(nullif(public_name->>locale,''),public_name->>'th') into name from hub.brands where kind='brand' and public_brand_id=ref;
   name:=coalesce(name,'SENA');
   question:=replace(coalesce(nullif(r.question->>locale,''),r.question->>'th',''),'{brand}',name);
   answer:=replace(coalesce(nullif(r.short_answer->>locale,''),r.short_answer->>'th',''),'{brand}',name);
   detail:=replace(coalesce(nullif(r.detail->>locale,''),r.detail->>'th',''),'{brand}',name);
   data:=data||jsonb_build_object(locale,jsonb_build_object('question_key',r.question_key,'question',question,'short_answer',answer,'detail',detail,
    'answer_kind',r.answer_kind,'as_of',null,'as_of_label',null,'ai_exposure',r.ai_exposure,'is_fallback_locale',locale='en' and (nullif(r.question->>'en','') is null or nullif(r.short_answer->>'en','') is null)));
  end loop;
  item:=jsonb_build_object('_faq',true,'version_id',r.id,'question_key',r.question_key,'reviewed_facts','{"th":[],"en":[]}'::jsonb,'data',data,'ai_exposure',r.ai_exposure,
   'dependencies',jsonb_build_array(hub.web_dependency('faqs',jsonb_build_object('id',r.identity_id),'knowledge'),hub.web_dependency('faq_versions',jsonb_build_object('id',r.id),'knowledge'),hub.web_dependency('faq_questions',jsonb_build_object('question_key',r.question_key),'knowledge')));
  if r.state not in ('IN_REVIEW','PUBLISHED') then item:=item||'{"_issues":[{"code":"faq_not_submitted"}]}';end if;
  if data::text ~ '\{(project|brand|[a-z_]+\.[a-z_]+)\}' or (select count(*) from hub.faqs f where f.scope_type=kind and f.scope_id=ref and f.question_key=r.question_key and f.state<>'WITHDRAWN')>1 then
   item:=item||'{"_issues":[{"code":"faq_conflict_or_lint"}]}';end if;
  items:=items||jsonb_build_array(item);
 end loop;return items;
end $$;
-- Bounded trees reuse one walk for private proof, readiness and review checks.
create function hub.web_nodes(value jsonb) returns setof jsonb language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare x jsonb;begin
 return next value;
 if jsonb_typeof(value)='object' then for x in select v from jsonb_each(value) e(k,v) loop return query select * from hub.web_nodes(x);end loop;
 elsif jsonb_typeof(value)='array' then for x in select * from jsonb_array_elements(value) loop return query select * from hub.web_nodes(x);end loop;end if;
end $$;
create function hub.web_dependencies(value jsonb) returns setof jsonb language sql immutable set search_path=pg_catalog,pg_temp as $$
 select distinct n from hub.web_nodes(value) n where n ?& array['table','identity','hash','tab','editors']
$$;
create function hub.web_issues(value jsonb) returns jsonb language sql immutable set search_path=pg_catalog,pg_temp as $$
 select coalesce(jsonb_agg(distinct i),'[]') from hub.web_nodes(value) n cross join lateral jsonb_array_elements(case when jsonb_typeof(n->'_issues')='array' then n->'_issues' else '[]'::jsonb end) i
$$;
create function hub.web_assert_sources(value jsonb,level text,independent boolean default false) returns void language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare d jsonb;actor uuid:=hub.require_permission('knowledge',level);begin
 for d in select * from hub.web_dependencies(value) loop
  perform hub.require_permission(d->>'tab',level);
  if independent and d->'editors' ? actor::text then raise exception 'Source editors cannot publish their own version' using errcode='42501';end if;
 end loop;
 if independent and exists(select 1 from hub.web_nodes(value) n where n->'_editors' ? actor::text or n->>'reviewed_by'=actor::text or n->>'prepared_by'=actor::text) then
  raise exception 'Page editors cannot publish their own version' using errcode='42501';end if;
end $$;
create function hub.web_resolve(value jsonb,locale text,ai boolean default false,record_gaps boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;child jsonb;resolved jsonb;k text;d jsonb;source jsonb;current_slot jsonb;old_slot jsonb;missing text[]:='{}';begin
 if jsonb_typeof(value)='object' then
  if value ? '_locale' then return hub.web_resolve(coalesce(nullif(value#>array['data',locale],'null'),value#>'{data,th}'),locale,ai,record_gaps);end if;
  if value ? '_item' or value ? '_fact' or value ? '_faq' then
   if value->>'ai_exposure'='internal' or ai and value->>'ai_exposure'<>'open' then return null;end if;
   for d in select * from jsonb_array_elements(coalesce(value->'dependencies','[]')) loop
    if not coalesce(hub.web_source_available(d),false) then return null;end if;
    source:=hub.web_source(d->>'table',d->'identity');
    if ai and (source->>'ai_exposure'='web_only' or source->>'default_ai_exposure'='web_only') then return null;end if;
   end loop;
   if value ? '_fact' then
    current_slot:=hub.faq_fact_slot((value->>'project_id')::uuid,value->>'field_key',locale,null,false);
    old_slot:=value#>array['reviewed',locale];
    if current_slot is distinct from old_slot or not coalesce((current_slot->>'available')::boolean,false) or ai and current_slot->>'ai_exposure'<>'open' then return null;end if;
    return current_slot-'basis';
   elsif value ? '_faq' then
    for old_slot in select * from jsonb_array_elements(coalesce(value#>array['reviewed_facts',locale],'[]')) loop
     k:=old_slot->>'field_key';
     current_slot:=hub.faq_fact_slot((value->>'project_id')::uuid,k,locale,null,false);
     if current_slot is distinct from old_slot or not coalesce((current_slot->>'available')::boolean,false) or ai and current_slot->>'ai_exposure'<>'open' then missing:=array_append(missing,k);end if;
    end loop;
    if record_gaps and not ai and cardinality(missing)>0 and not exists(select 1 from hub.content_gaps where project_id=(select rem_project_id from hub.projects where id=(value->>'project_id')::uuid)
     and question_key=value->>'question_key' and gap_code='FAQ_FACT_MISSING' and state<>'resolved' and missing_fact_keys=missing) then
     perform hub.faq_sync_gap((value->>'project_id')::uuid,value->>'question_key',(select faq_id from hub.faq_versions where id=(value->>'version_id')::uuid),missing);end if;
    if cardinality(missing)>0 then return null;end if;
    return value#>array['data',locale];
   end if;
   source:=value->'data';
   if source->>'effective_from' is not null and (source->>'effective_from')::timestamptz>now()
    or source->>'effective_to' is not null and (source->>'effective_to')::timestamptz<=now()
    or source->>'valid_from' is not null and (source->>'valid_from')::date>(current_timestamp at time zone 'Asia/Bangkok')::date
    or source->>'valid_to' is not null and (source->>'valid_to')::date<(current_timestamp at time zone 'Asia/Bangkok')::date then return null;end if;
   return hub.web_resolve(source,locale,ai,record_gaps);
  end if;
  if value ? 'th' and not exists(select 1 from jsonb_object_keys(value) x where x not in ('th','en')) then return hub.web_localized(value,locale);end if;
  result:='{}';for k,child in select * from jsonb_each(value) where left(key,1)<>'_' loop
   resolved:=hub.web_resolve(child,locale,ai,record_gaps);result:=result||jsonb_build_object(k,resolved);
  end loop;return result;
 elsif jsonb_typeof(value)='array' then
  result:='[]';for child in select * from jsonb_array_elements(value) loop resolved:=hub.web_resolve(child,locale,ai,record_gaps);
   if resolved is not null and resolved<>'null'::jsonb then result:=result||jsonb_build_array(resolved);end if;end loop;return result;
 end if;return value;
end $$;

create function hub.web_output(snapshot jsonb,locale text,record_gaps boolean default false) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare body jsonb;opened jsonb;faqs jsonb;entities jsonb:='[]';x jsonb;hidden jsonb:='[]';result jsonb;max_faq integer:=(snapshot->>'max_faq_items')::integer;begin
 if locale not in ('th','en') or not snapshot->'locales' ? locale then raise exception 'Locale not configured' using errcode='P0002';end if;
 body:=(hub.web_limit_faq(hub.web_resolve(snapshot->'body',locale,false,record_gaps),max_faq)).value;
 opened:=hub.web_resolve(snapshot->'body',locale,true,false);
 select coalesce(jsonb_agg(n),'[]') into faqs from (select n from hub.web_nodes(body) n where n ?& array['question_key','question','short_answer'] limit max_faq) q;
 if snapshot->>'ai_policy'<>'no_ai' then
  select coalesce(jsonb_agg(jsonb_build_object('@type','Question','name',n->>'question','acceptedAnswer',jsonb_build_object('@type','Answer','text',n->>'short_answer'))),'[]') into entities
   from (select n from jsonb_array_elements(faqs) n where n->>'ai_exposure'='open' and exists(select 1 from hub.web_nodes(opened) a where a=n)) q;
  entities:=case when jsonb_array_length(entities)>0 then jsonb_build_array(jsonb_build_object('@type','FAQPage','mainEntity',entities)) else '[]'::jsonb end;
  for x in select n from hub.web_nodes(opened) n where n ?& array['public_project_id','fields'] loop
   entities:=entities||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('@type','Residence','identifier',x->>'public_project_id','name',x#>>'{fields,public_name}',
    'description',x#>>'{fields,short_description}')));end loop;
  for x in select n from hub.web_nodes(opened) n where n ?& array['public_commercial_type_id','public_name'] loop
   entities:=entities||jsonb_build_array(jsonb_build_object('@type','Product','identifier',x->>'public_commercial_type_id','name',x->'public_name'));end loop;
  for x in select n from hub.web_nodes(opened) n where n ?& array['provider','url','title'] loop
   entities:=entities||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('@type','VideoObject','name',x->'title','description',x->'description','contentUrl',x->>'url','uploadDate',x->'published_at')));end loop;
  if snapshot->>'page_type' in ('brand','corporate') then entities:=entities||jsonb_build_array(jsonb_build_object('@type','Organization','name',coalesce(opened#>>'{fields,public_name}','SENA'),'url',snapshot->>'url'));end if;
 end if;
 for x in select n from hub.web_nodes(snapshot->'body') n where n ? '_item' or n ? '_fact' or n ? '_faq' loop
  if hub.web_resolve(x,locale,false,false) is null then hidden:=hidden||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('reason','source_unavailable_or_changed',
   'question_key',x->>'question_key','field_key',x->>'field_key')));end if;end loop;
 result:=jsonb_build_object('page_key',snapshot->>'page_key','page_type',snapshot->>'page_type','url',snapshot->>'url','locale',locale,
  'is_fallback_locale',hub.web_fallback(snapshot->'body',locale) or exists(select 1 from hub.web_nodes(body) n where n->>'is_fallback_locale'='true'),
  'ai_policy',snapshot->>'ai_policy','content',body,'faq',faqs,'hidden',hidden,'json_ld',jsonb_build_object('@context','https://schema.org','@graph',entities));
 return result||jsonb_build_object('content_sha256',hub.web_hash(result));
end $$;
create function hub.web_limit_faq(inout value jsonb,inout remaining integer) language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare result jsonb;k text;child jsonb;limited record;begin
 if jsonb_typeof(value)='object' then
  -- Inline article FAQ references share the page budget with FAQ collections.
  if value ?& array['question_key','question','short_answer'] then
   if remaining=0 then value:=null;else remaining:=remaining-1;end if;return;
  end if;
  result:='{}';for k,child in select * from jsonb_each(value) loop
   if k='faq' and jsonb_typeof(child)='array' then
    select coalesce(jsonb_agg(v),'[]') into child from (select v from jsonb_array_elements(child) v limit remaining) rows;
    remaining:=remaining-jsonb_array_length(child);
   else select * into limited from hub.web_limit_faq(child,remaining);child:=limited.value;remaining:=limited.remaining;end if;
   result:=result||jsonb_build_object(k,child);
  end loop;value:=result;
 elsif jsonb_typeof(value)='array' then
  result:='[]';for child in select * from jsonb_array_elements(value) loop
   select * into limited from hub.web_limit_faq(child,remaining);remaining:=limited.remaining;result:=result||jsonb_build_array(limited.value);
  end loop;value:=result;
 end if;
end $$;
create function hub.web_changed_pages() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare page hub.web_pages;value jsonb;items jsonb:='[]';begin
 if (select count(*) from hub.web_pages)>100 then raise exception 'Website registry limit exceeded' using errcode='23514';end if;
 for page in select * from hub.web_pages order by page_key loop
  value:=hub.web_compose(page);
  value:=value||jsonb_build_object('json_ld',jsonb_build_object('th',hub.web_output(value,'th')->'json_ld',
   'en',case when 'en'=any(page.locales) then hub.web_output(value,'en')->'json_ld' end));
  if page.published_version_id is null or hub.web_hash(value) is distinct from (select content_sha256 from hub.entity_versions where id=page.published_version_id) then
   items:=items||jsonb_build_array(jsonb_build_object('snapshot',value,'previous_version_id',page.published_version_id,'hash',hub.web_hash(value),'issues',hub.web_issues(value)));
  end if;
 end loop;return items;
end $$;
create function hub.web_workspace() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('knowledge','view');
 return jsonb_build_object('pages',coalesce((select jsonb_agg(to_jsonb(w)-'last_output_hashes' order by page_key) from hub.web_pages w),'[]'),
  'publications',coalesce((select jsonb_agg(to_jsonb(r)) from (select id,digest,reason,state,created_at,created_by,published_at,published_by,jsonb_array_length(pages) page_count from hub.web_publications order by created_at desc limit 30) r),'[]'),
  'can_publish',hub.can('knowledge','approve') and hub.can_special('knowledge','knowledge.publish_web'));
end $$;
create function hub.web_page_save(key text,expected integer,config jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid:=hub.require_permission('knowledge','edit');page hub.web_pages;kind text:=split_part(key,':',1);ref text:=split_part(key,':',2);begin
 perform pg_advisory_xact_lock(hashtextextended('hub-web-publications',0));
 if config-array['url','locales','ai_policy','max_faq_items','project_ids']<>'{}' or key<>kind||':'||ref then raise exception 'Invalid page configuration' using errcode='23514';end if;
 perform hub.require_permission(case kind when 'project' then 'projects' when 'brand' then 'brands' else 'knowledge' end,'view');
 select * into page from hub.web_pages where page_key=key for update;
 if found then
  if page.revision is distinct from expected then raise exception 'Page configuration changed' using errcode='40001';end if;
 else
  if expected<>0 then raise exception 'Page not found' using errcode='P0002';end if;
  if (select count(*) from hub.web_pages)>=100 then raise exception 'Website registry limit reached' using errcode='23514';end if;
  insert into hub.web_pages(page_key,page_type,entity_ref,url) values(key,kind,ref,config->>'url') returning * into page;
 end if;
 update hub.web_pages set url=config->>'url',locales=array(select jsonb_array_elements_text(config->'locales')),
  project_ids=array(select jsonb_array_elements_text(config->'project_ids')),ai_policy=config->>'ai_policy',max_faq_items=(config->>'max_faq_items')::integer,
  revision=case when expected=0 then 1 else revision+1 end,editors=array[actor],updated_by=actor,updated_at=clock_timestamp() where id=page.id returning * into page;
 -- Validate referenced entities and source permissions before storing a registry change.
 perform hub.web_compose(page);return to_jsonb(page)-'last_output_hashes';
end $$;
create function hub.web_prepare(reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid:=hub.require_permission('knowledge','edit');pages jsonb;result hub.web_publications;begin
 perform pg_advisory_xact_lock(hashtextextended('hub-web-publications',0));
 pages:=hub.web_changed_pages();
 if jsonb_array_length(pages)=0 then raise exception 'No changed pages to review' using errcode='23514';end if;
 insert into hub.web_publications(pages,digest,reason,editors) values(pages,hub.web_hash(pages),btrim(reason),array[actor]) returning * into result;
 return jsonb_build_object('id',result.id,'digest',result.digest,'page_count',jsonb_array_length(pages));
end $$;
-- Private image mapping uses the existing permission-checked staff file route.
-- It is never part of a snapshot or public projection.
create function hub.web_preview_assets(snapshot jsonb) returns jsonb language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce(jsonb_object_agg('ast_'||coalesce(a.checksum,encode(sha256(convert_to(a.id::text,'UTF8')),'hex')),a.id),'{}')
 from hub.assets a where hub.can_read_asset(a.id) and exists(select 1 from hub.web_dependencies(snapshot) d
  where d->>'table'='assets' and d#>>'{identity,id}'=a.id::text and hub.web_source_available(d))
$$;
create function hub.web_publication_read(publication uuid,locale text default 'th') returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare batch hub.web_publications;item jsonb;pages jsonb:='[]';previous jsonb;eligible boolean;begin
 perform hub.require_permission('knowledge','view');select * into batch from hub.web_publications where id=publication;
 if not found then raise exception 'Publication not found' using errcode='P0002';end if;
 perform hub.web_assert_sources(batch.pages,'view');
 for item in select * from jsonb_array_elements(batch.pages) loop
  select payload into previous from hub.entity_versions where id=(item->>'previous_version_id')::uuid;
  pages:=pages||jsonb_build_array(jsonb_build_object('page_key',item#>>'{snapshot,page_key}','hash',item->>'hash','issues',item->'issues',
   'previous',case when previous is not null then hub.web_output(previous,case when previous->'locales' ? locale then locale else 'th' end) end,
   'preview',hub.web_output(item->'snapshot',case when item#>'{snapshot,locales}' ? locale then locale else 'th' end),'preview_assets',hub.web_preview_assets(item->'snapshot'),
   'resolved_phases',coalesce((select jsonb_agg(n->'data'->>'public_project_id') from hub.web_nodes(item->'snapshot') n where n->'data' ?& array['public_project_id','facts']),'[]'),
   'resolved_applicability',coalesce((select jsonb_agg(distinct jsonb_build_object('question_key',n->>'question_key','rem_project_ids',n->'resolved_project_ids'))
    from hub.web_nodes(item->'snapshot') n where n ? '_faq' and n ? 'resolved_project_ids'),'[]')));
 end loop;
 eligible:=hub.can('knowledge','approve') and hub.can_special('knowledge','knowledge.publish_web') and not hub.permission_actor()=any(batch.editors);
 if eligible then begin perform hub.web_assert_sources(batch.pages,'approve',true);exception when insufficient_privilege then eligible:=false;end;end if;
 return (to_jsonb(batch)-'pages')||jsonb_build_object('pages',pages,'can_publish',eligible);
end $$;
create function hub.web_record_change(page hub.web_pages,operation text) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare locale text;value jsonb;hashes jsonb:='{}';snapshot jsonb;begin
 select payload into snapshot from hub.entity_versions where id=page.published_version_id;
 foreach locale in array page.locales loop
  value:=case when snapshot is not null then hub.web_output(snapshot,locale) end;
  insert into hub.web_changes(page_key,locale,operation,content_sha256) values(page.page_key,locale,operation,value->>'content_sha256');
  hashes:=hashes||jsonb_build_object(locale,value->>'content_sha256');
 end loop;
 update hub.web_pages set last_output_hashes=hashes where id=page.id;
end $$;
create function hub.web_publish(publication uuid,expected_digest text) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid:=hub.require_permission('knowledge','approve');batch hub.web_publications;item jsonb;page hub.web_pages;version uuid;d jsonb;begin
 perform hub.require_special('knowledge','knowledge.publish_web');
 -- ponytail: one publication transaction for at most 100 pages. Source SHARE
 -- locks prevent a stale-check/pointer race; partition only if measured needed.
 perform pg_advisory_xact_lock(hashtextextended('hub-web-publications',0));
 perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));
 lock table hub.projects,hub.brands,hub.assets,hub.entity_assets,hub.brand_assets,hub.asset_links,hub.commercial_types,hub.commercial_type_versions,
  hub.commercial_type_assets,hub.project_prices,hub.project_price_versions,hub.project_disclosures,hub.project_sales_terms,hub.project_programmes,hub.project_progress,
  hub.project_commercial_versions,hub.project_facts,hub.project_buildings,hub.project_selling_points,hub.content_sections,hub.content_section_versions,
  hub.faqs,hub.faq_versions,hub.faq_questions,hub.faq_sources,hub.knowledge_reviews,hub.contacts,hub.project_features,hub.feature_catalog,hub.project_facilities,
  hub.facility_taxonomy,hub.project_places,hub.solar_estimates,hub.media_links,hub.media_link_targets,hub.articles,hub.article_versions,hub.article_links,
  hub.field_catalog,hub.content_translations,staging.rem_projects,staging.dw_projects in share row exclusive mode;
 perform hub.require_permission('knowledge','approve');perform hub.require_special('knowledge','knowledge.publish_web');
 select * into batch from hub.web_publications where id=publication for update;
 if not found then raise exception 'Publication not found' using errcode='P0002';end if;
 if batch.state<>'IN_REVIEW' or batch.digest is distinct from expected_digest or hub.web_hash(hub.web_changed_pages()) is distinct from batch.digest then
  raise exception 'Publication sources changed; prepare a new review' using errcode='40001';end if;
 if actor=any(batch.editors) then raise exception 'Batch preparer cannot publish' using errcode='42501';end if;
 perform hub.web_assert_sources(batch.pages,'approve',true);
 for item in select * from jsonb_array_elements(batch.pages) loop
  if jsonb_array_length(item->'issues')>0 then raise exception 'Publication readiness is incomplete' using errcode='23514';end if;
 end loop;
 for item in select * from jsonb_array_elements(batch.pages) loop
  select * into page from hub.web_pages where page_key=item#>>'{snapshot,page_key}' for update;
  insert into hub.entity_versions(entity_type,web_page_id,version_no,payload,content_sha256,publisher,change_reason)
   values('web_page',page.id,(select coalesce(max(version_no),0)+1 from hub.entity_versions where web_page_id=page.id),
    item->'snapshot'||jsonb_build_object('_publication',jsonb_build_object('prepared_by',batch.created_by,'approved_by',actor,'approved_at',clock_timestamp(),'batch_id',batch.id)),item->>'hash',actor,batch.reason) returning id into version;
  update hub.web_pages set published_version_id=version where id=page.id returning * into page;
  for d in select * from hub.web_dependencies(item->'snapshot') loop
   if d->>'table'='faq_versions' then
    update hub.faq_versions set state='PUBLISHED',approved_by=actor,approved_at=clock_timestamp() where id=(d#>>'{identity,id}')::uuid and state='IN_REVIEW';
    update hub.faqs set state='PUBLISHED',published_version_id=(d#>>'{identity,id}')::uuid where draft_version_id=(d#>>'{identity,id}')::uuid and state='IN_REVIEW';
   elsif d->>'table'='content_section_versions' then
    update hub.content_section_versions set state='PUBLISHED' where id=(d#>>'{identity,id}')::uuid and state='IN_REVIEW';
    update hub.content_sections set state='PUBLISHED',published_version_id=(d#>>'{identity,id}')::uuid where draft_version_id=(d#>>'{identity,id}')::uuid and state='IN_REVIEW';
   elsif d->>'table'='media_links' then
    update hub.media_links set state='PUBLISHED' where id=(d#>>'{identity,id}')::uuid and state in ('DRAFT','IN_REVIEW');
   end if;
  end loop;
  perform hub.web_record_change(page,'publish');
 end loop;
 update hub.web_publications set state='PUBLISHED',published_by=actor,published_at=clock_timestamp() where id=batch.id;
 return jsonb_build_object('id',batch.id,'state','PUBLISHED','page_count',jsonb_array_length(batch.pages));
end $$;
create function hub.web_history(key text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare value jsonb;begin
 perform hub.require_permission('knowledge','view');
 for value in select payload from hub.entity_versions where web_page_id=(select id from hub.web_pages where page_key=key) loop perform hub.web_assert_sources(value,'view');end loop;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'version_no',version_no,'content_sha256',content_sha256,'published_at',published_at,'publisher',publisher,'change_reason',change_reason) order by version_no desc)
  from hub.entity_versions where web_page_id=(select id from hub.web_pages where page_key=key)),'[]');
end $$;
create function hub.web_pointer(key text,expected uuid,target uuid,reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid:=hub.require_permission('knowledge','approve');page hub.web_pages;snapshot jsonb;begin
 perform hub.require_special('knowledge','knowledge.publish_web');perform pg_advisory_xact_lock(hashtextextended('hub-web-publications',0));
 perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));
 perform hub.require_permission('knowledge','approve');perform hub.require_special('knowledge','knowledge.publish_web');
 if length(btrim(reason)) not between 1 and 2000 then raise exception 'Reason required' using errcode='23514';end if;
 select * into page from hub.web_pages where page_key=key for update;
 if not found then raise exception 'Page not found' using errcode='P0002';end if;
 if page.published_version_id is distinct from expected then raise exception 'Publication pointer changed' using errcode='40001';end if;
 select payload into snapshot from hub.entity_versions where web_page_id=page.id and id=coalesce(target,expected);
 if snapshot is null then raise exception 'Version not found' using errcode='P0002';end if;
 perform hub.web_assert_sources(snapshot,'approve',target is not null);
 -- Reasons are audited without changing an immutable version.
 perform set_config('app.change_reason',reason,true);
 update hub.web_pages set published_version_id=target,updated_by=actor,updated_at=clock_timestamp() where id=page.id returning * into page;
 perform hub.web_record_change(page,case when target is null then 'withdraw' else 'rollback' end);
 return jsonb_build_object('page_key',key,'published_version_id',target);
end $$;

create function hub.web_version_preview(key text,version uuid,locale text default 'th') returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare snapshot jsonb;begin
 perform hub.require_permission('knowledge','view');
 select payload into snapshot from hub.entity_versions where id=version and web_page_id=(select id from hub.web_pages where page_key=key);
 if snapshot is null then raise exception 'Version not found' using errcode='P0002';end if;
 perform hub.web_assert_sources(snapshot,'view');return jsonb_build_object('preview',hub.web_output(snapshot,case when snapshot->'locales' ? locale then locale else 'th' end),'preview_assets',hub.web_preview_assets(snapshot));
end $$;

-- Keep the legacy asset reader, then permit bytes only for a currently visible
-- asset in an approved web snapshot. Storage details stay inside the HTTP server.
create or replace function hub.public_asset_file(public_id text) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.assets;page record;begin
 perform hub.require_public_reader();
 if public_id !~ '^ast_[a-f0-9]{64}$' then raise exception 'File not found' using errcode='P0002';end if;
 select * into a from hub.assets where coalesce(checksum,encode(sha256(convert_to(id::text,'UTF8')),'hex'))=substring(public_id from 5) and deleted_at is null;
 if not found then raise exception 'File not found' using errcode='P0002';end if;
 begin return public_api.asset_file(a.id);exception when no_data_found then null;end;
 if a.storage_path is not null then
  for page in select v.payload from hub.web_pages w join hub.entity_versions v on v.id=w.published_version_id loop
   if exists(select 1 from hub.web_nodes(hub.web_resolve(page.payload->'body','th',false,false)) n where n->>'public_asset_id'=public_id) then
    return jsonb_build_object('id',a.id,'storage_bucket',a.storage_bucket,'source_system',a.source_system,'storage_path',a.storage_path,
     'mime_type',a.mime_type,'original_filename',a.original_filename,'checksum',a.checksum,'file_size',a.file_size);end if;
  end loop;
 end if;
 raise exception 'File not found' using errcode='P0002';
end $$;
-- Add a count to the existing manager response without granting anyone a bit.
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.permission_catalog_read()'::regprocedure);
 d:=replace(d,'return jsonb_build_object(', 'return jsonb_build_object(''web_publisher_count'',(select count(*) from hub.user_account a join hub.account_permission p on p.account_id=a.id
  where a.status=''ACTIVE'' and a.hub_role in (''viewer'',''editor'',''publisher'',''admin'',''online_staff'') and p.tab=''knowledge'' and p.can_view and p.can_approve and ''knowledge.publish_web''=any(p.special_actions)),');
 if strpos(d,'''web_publisher_count''')=0 then raise exception 'Catalog count extension did not match';end if;execute d;
end $$;
create function hub.web_public_page(key text,locale text default 'th') returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare snapshot jsonb;begin
 perform hub.require_public_reader();select v.payload into snapshot from hub.web_pages w join hub.entity_versions v on v.id=w.published_version_id where w.page_key=key;
 if snapshot is null then raise exception 'Page not published' using errcode='P0002';end if;
 return hub.web_output(snapshot,locale,true);
end $$;
create function hub.web_public_changes(since bigint default 0) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare page hub.web_pages;locale text;value jsonb;changed boolean;begin
 perform hub.require_public_reader();
 if since<0 then raise exception 'Invalid change cursor' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('hub-web-publications',0));
 for page in select * from hub.web_pages where published_version_id is not null order by page_key loop
  changed:=false;foreach locale in array page.locales loop
   value:=hub.web_output((select payload from hub.entity_versions where id=page.published_version_id),locale,true);
   changed:=changed or page.last_output_hashes->>locale is distinct from value->>'content_sha256';
  end loop;if changed then perform hub.web_record_change(page,'visibility');end if;
 end loop;
 return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(c)-array['created_by','updated_by','created_at','updated_at'] order by cursor)
  from (select wc.cursor,wc.page_key,wc.locale,wc.operation,wc.content_sha256,wc.occurred_at from hub.web_changes wc where wc.cursor>since order by wc.cursor limit 1000) c),'[]'),
  'next_cursor',coalesce((select max(cursor) from (select cursor from hub.web_changes where cursor>since order by cursor limit 1000) c),since));
end $$;
create function hub.web_public_ai(kind text) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare page record;items jsonb:='[]';begin
 perform hub.require_public_reader();
 if kind not in ('llms','robots') then raise exception 'Invalid projection' using errcode='23514';end if;
 for page in select w.page_key,v.payload from hub.web_pages w join hub.entity_versions v on v.id=w.published_version_id order by w.page_key loop
  if kind='robots' then items:=items||jsonb_build_array(jsonb_build_object('url',page.payload->>'url','ai_policy',page.payload->>'ai_policy'));
  elsif page.payload->>'ai_policy'='open' then items:=items||jsonb_build_array(jsonb_build_object('url',page.payload->>'url','page_key',page.page_key,
   'content',(hub.web_limit_faq(hub.web_resolve(page.payload->'body','th',true,false),(page.payload->>'max_faq_items')::integer)).value));end if;
 end loop;return items;
end $$;

do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub' and p.proname like 'web_%' loop
  execute format('revoke all on function %s from public',f);
 end loop;
end $$;
grant execute on function hub.web_workspace(),hub.web_page_save(text,integer,jsonb),hub.web_prepare(text),hub.web_publication_read(uuid,text),
 hub.web_publish(uuid,text),hub.web_history(text),hub.web_version_preview(text,uuid,text),hub.web_pointer(text,uuid,uuid,text),hub.web_public_page(text,text),hub.web_public_changes(bigint),hub.web_public_ai(text) to hub_app;

commit;
