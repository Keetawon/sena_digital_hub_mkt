-- W3: read projections and explicit runtime decisions. No existing content is rewritten.
begin;

create function hub.workspace_admin() returns uuid language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare actor uuid:=hub.permission_actor();begin
 if not exists(select 1 from hub.user_account where id=actor and status='ACTIVE' and hub_role='admin') then
  raise exception 'Actual administrator required' using errcode='42501';end if;
 return actor;
end $$;

-- Canonical scope validation, shared with 0082. Later business/BU changes extend this authority.
create or replace function hub.content_scope_tab(kind text) returns text language sql immutable
set search_path=pg_catalog,pg_temp as $$
 select case when kind='project' then 'projects' when kind='brand' then 'brands'
  when kind in ('corporate','programme','project_group','unit_type') then 'knowledge' end
$$;
create or replace function hub.content_scope_access(kind text,ref text,level text) returns uuid
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;begin
 actor:=hub.require_permission(hub.content_scope_tab(kind),level);
 if kind='project' and exists(select 1 from hub.projects where public_project_id=ref and deleted_at is null)
 or kind='brand' and exists(select 1 from hub.brands where public_brand_id=ref and deleted_at is null)
 or kind='corporate' and ref='sena'
 or kind='programme' and ref in ('LIVNEX','LIVNEX_GOLD','RENTNEX','RENTNEX_BENEFIT','RENTNEX_INVEST')
 or kind='project_group' and exists(select 1 from staging.dw_project_groups where project_group_id=ref)
 or kind='unit_type' and exists(select 1 from hub.commercial_types c join hub.projects p on p.id=c.project_id
  where c.id::text=ref and c.deleted_at is null and p.deleted_at is null)
 then return actor;end if;
 raise exception 'Content scope not found' using errcode='P0002';
end $$;
create or replace function hub.content_scope_allowed(kind text,ref text,level text default 'view') returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 if kind is null or ref is null or level is null or kind not in ('project','brand','corporate','programme','project_group','unit_type')
 or level not in ('view','edit','approve') then return false;end if;
 perform hub.content_scope_access(kind,ref,level);return true;
exception when insufficient_privilege or no_data_found then return false;
end $$;

create function hub.workspace_target(kind text,ref text,tab text,extra jsonb default '{}') returns jsonb
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select jsonb_strip_nulls(jsonb_build_object('level',kind,'id',ref,'tab',tab)||extra)
$$;
create function hub.workspace_actor(actor uuid) returns jsonb language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('id',a.id,'name',a.display_name_th) from hub.user_account a
 where a.id=actor and a.anonymised_at is null
$$;

-- Only an explicitly published page composition can establish a website grouping.
-- DW dictionaries remain evidence. No anchor, brand or phase is inferred.
create function hub.workspace_confirmed_groups() returns table(anchor text,members uuid[],page_key text)
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare w record; refs text[]; ids uuid[]; candidates jsonb:='[]'; item jsonb;begin
 if not hub.can('projects','view') or not hub.can('knowledge','view') then return;end if;
 for w in select p.*,v.payload from hub.web_pages p join hub.entity_versions v on v.id=p.published_version_id
  and v.web_page_id=p.id and v.entity_type='web_page'
  where p.page_type='project' and cardinality(p.project_ids)>1
  and v.payload->>'config_revision'=p.revision::text and v.payload#>>'{_publication,approved_by}' is not null loop
  select array_agg(n->'data'->>'public_project_id' order by n->'data'->>'public_project_id') into refs
   from jsonb_array_elements(w.payload#>'{body,phases}') n;
  if refs is null or refs is distinct from array(select x from unnest(w.project_ids) x order by x)
   or cardinality(refs)<>(select count(distinct x) from unnest(refs) x) or not w.entity_ref=any(refs) then continue;end if;
  select array_agg(p.id order by p.public_project_id) into ids from hub.projects p
   where p.public_project_id=any(refs) and p.deleted_at is null and hub.content_scope_allowed('project',p.public_project_id,'view');
  if cardinality(ids) is distinct from cardinality(refs) or
   (select count(distinct coalesce(p.brand_id::text,'')) from hub.projects p where p.id=any(ids))<>1 then continue;end if;
  begin perform hub.web_assert_sources(w.payload,'view');exception when insufficient_privilege then continue;end;
  candidates:=candidates||jsonb_build_array(jsonb_build_object('anchor',w.entity_ref,'members',ids,'page_key',w.page_key));
 end loop;
 for item in select value from jsonb_array_elements(candidates) loop
  if exists(select 1 from jsonb_array_elements(candidates) other where other->>'page_key'<>item->>'page_key'
   and exists(select 1 from jsonb_array_elements_text(item->'members') x where other->'members' ? x)) then continue;end if;
  anchor:=item->>'anchor';members:=array(select value::uuid from jsonb_array_elements_text(item->'members'));
  page_key:=item->>'page_key';return next;
 end loop;
end $$;

create function hub.workspace_projects(kind text,ref text) returns uuid[] language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare result uuid[];begin
 perform hub.content_scope_access(kind,ref,'view');
 if kind='project' then
  select g.members into result from hub.workspace_confirmed_groups() g where exists(
   select 1 from hub.projects p where p.public_project_id=ref and p.id=any(g.members));
  if result is not null then return result;end if;
 end if;
 select coalesce(array_agg(p.id order by p.public_project_id),'{}') into result from hub.projects p
 left join hub.brands b on b.id=p.brand_id
 where p.deleted_at is null and hub.content_scope_allowed('project',p.public_project_id,'view') and
 (kind='project' and p.public_project_id=ref or kind='brand' and b.public_brand_id=ref or kind='corporate'
  or kind='programme' and exists(select 1 from hub.project_programmes x where x.project_id=p.id and upper(x.programme_key)=ref and x.participating)
  or kind='project_group' and exists(select 1 from staging.dw_projects d where d.rem_project_id=p.rem_project_id and d.source_record->>'rem_project_group_id'=ref)
  or kind='unit_type' and exists(select 1 from hub.commercial_types c where c.project_id=p.id and c.id::text=ref and c.deleted_at is null));
 return result;
end $$;
create function hub.workspace_name(kind text,ref text) returns jsonb language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select coalesce(case kind
  when 'project' then (select public_name from hub.projects where public_project_id=ref and deleted_at is null)
  when 'brand' then (select public_name from hub.brands where public_brand_id=ref and deleted_at is null)
  when 'unit_type' then (select public_name from hub.commercial_types where id::text=ref and deleted_at is null)
  when 'project_group' then (select jsonb_build_object('th',coalesce(source_record->>'project_group_name',project_group_id)) from staging.dw_project_groups where project_group_id=ref)
  when 'programme' then jsonb_build_object('th','{"LIVNEX":"LivNex","LIVNEX_GOLD":"LivNex Gold","RENTNEX":"RentNex","RENTNEX_BENEFIT":"RentNex Benefit","RENTNEX_INVEST":"RentNex Invest"}'::jsonb->>ref)
  end,jsonb_build_object('th',case when kind='corporate' then 'SENA' else ref end))
$$;
create function hub.workspace_phase(kind text,ref text,phase text) returns hub.projects language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare ids uuid[]:=hub.workspace_projects(kind,ref);p hub.projects;begin
 if phase is not null then select * into p from hub.projects where id=any(ids) and rem_project_id=phase;
 elsif kind='project' then select * into p from hub.projects where id=any(ids) and public_project_id=ref;
 elsif kind='unit_type' then select x.* into p from hub.projects x join hub.commercial_types c on c.project_id=x.id where x.id=any(ids) and c.id::text=ref;
 end if;
 if phase is not null and p.id is null then raise exception 'Phase not available for this page' using errcode='P0002';end if;
 return p;
end $$;

create function hub.workspace_tree(parent_kind text default null,parent_ref text default null,query text default '',after_key text default null,page_size integer default 50)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare rows jsonb;programmes jsonb:='[]';faq_refs jsonb;begin
 if page_size is null or page_size not between 1 and 100 or length(coalesce(query,''))>200
 or (parent_kind is null)<>(parent_ref is null) or length(coalesce(after_key,''))>220 then raise exception 'Invalid tree query' using errcode='23514';end if;
 if not (hub.can('projects','view') or hub.can('brands','view') or hub.can('knowledge','view')) then raise exception 'Content view required' using errcode='42501';end if;
 if parent_kind is not null and not hub.content_scope_allowed(parent_kind,parent_ref,'view') then perform hub.workspace_faq_scope_access(parent_kind,parent_ref);end if;
 faq_refs:=case when hub.can('knowledge','view') then hub.faq_references() else '{}'::jsonb end;
 with groups as materialized(select * from hub.workspace_confirmed_groups()), nodes as (
  select 'corporate' kind,'sena' ref,hub.workspace_name('corporate','sena') name,null::text parent_type,null::text parent_id,0 phases,'unconfirmed' grouping,false faq_only,'sena' code
   where hub.content_scope_allowed('corporate','sena','view')
  union all select 'brand',b.public_brand_id,b.public_name,case when hub.content_scope_allowed('corporate','sena','view') then 'corporate' end,
   case when hub.content_scope_allowed('corporate','sena','view') then 'sena' end,0,'unconfirmed',false,b.rem_brand_id from hub.brands b
   where b.deleted_at is null and hub.content_scope_allowed('brand',b.public_brand_id,'view')
  union all select 'project',p.public_project_id,p.public_name,case when hub.content_scope_allowed('brand',b.public_brand_id,'view') then 'brand' end,
   case when hub.content_scope_allowed('brand',b.public_brand_id,'view') then b.public_brand_id end,coalesce(cardinality(g.members),1),case when g.anchor is null then 'unconfirmed' else 'confirmed' end,false,p.rem_project_id
   from hub.projects p left join hub.brands b on b.id=p.brand_id left join groups g on g.anchor=p.public_project_id
   where p.deleted_at is null and hub.content_scope_allowed('project',p.public_project_id,'view')
   and not exists(select 1 from groups x where p.id=any(x.members) and x.anchor<>p.public_project_id)
  union all select 'project',p.public_project_id,jsonb_build_object('th',x->>'name'),null,null,0,'unconfirmed',true,p.rem_project_id
   from hub.projects p join lateral jsonb_array_elements(faq_refs->'projects') x on x->>'id'=p.rem_project_id
   where p.deleted_at is null and not hub.content_scope_allowed('project',p.public_project_id,'view')
    and hub.workspace_faq_scope_allowed('project',p.public_project_id,'view')
  union all select 'brand',b.public_brand_id,jsonb_build_object('th',x->>'name'),null,null,0,'unconfirmed',true,b.public_brand_id
   from hub.brands b join lateral jsonb_array_elements(faq_refs->'brands') x on x->>'id'=b.public_brand_id
   where b.deleted_at is null and not hub.content_scope_allowed('brand',b.public_brand_id,'view')
    and hub.workspace_faq_scope_allowed('brand',b.public_brand_id,'view')
 ), filtered as(select n.*,kind||':'||ref key from nodes n where
  (parent_kind is null and (coalesce(query,'')<>'' or parent_type is null) or parent_type=parent_kind and parent_id=parent_ref)
  and (coalesce(query,'')='' or position(lower(query) in lower(coalesce(name->>'th','')||' '||coalesce(name->>'en','')||' '||ref||' '||coalesce(code,'')))>0)
  and (after_key is null or kind||':'||ref>after_key) order by kind||':'||ref limit page_size+1)
 select coalesce(jsonb_agg(jsonb_build_object('key',key,'kind',kind,'ref',ref,'name',name,'code',code,'faq_only',faq_only,'target',hub.workspace_target(kind,ref,case when faq_only then 'faq' else 'overview' end),
  'parent',case when parent_type is not null then jsonb_build_object('kind',parent_type,'ref',parent_id) end,
  'has_children',coalesce(query,'')='' and exists(select 1 from nodes child where child.parent_type=filtered.kind and child.parent_id=filtered.ref),
  'visible_phase_count',phases,'grouping',jsonb_build_object('state',grouping,'group_ref',case when grouping='confirmed' then ref end,
   'review_href',case when kind='project' and not faq_only and grouping='unconfirmed' and hub.can('knowledge','view') then '/faq?tab=publication' end)) order by key),'[]') into rows from filtered;
 if parent_kind is null then
  select coalesce(jsonb_agg(jsonb_build_object('key','programme:'||x,'kind','programme','ref',x,'name',hub.workspace_name('programme',x),
   'target',hub.workspace_target('programme',x,'overview'),'parent',null,'has_children',false,'visible_phase_count',0,
   'grouping',jsonb_build_object('state','unconfirmed','group_ref',null)) order by x),'[]') into programmes
   from unnest(array['LIVNEX','LIVNEX_GOLD','RENTNEX','RENTNEX_BENEFIT','RENTNEX_INVEST']) x where hub.content_scope_allowed('programme',x,'view')
    and (coalesce(query,'')='' or position(lower(query) in lower(x||' '||coalesce(hub.workspace_name('programme',x)->>'th','')))>0);
 end if;
 return jsonb_build_object('items',case when jsonb_array_length(rows)>page_size then rows-(jsonb_array_length(rows)-1) else rows end,'programmes',programmes,
  'next_cursor',case when jsonb_array_length(rows)>page_size then rows->(page_size-1)->>'key' end);
end $$;

-- The three existing narrative mappings are the only direct-use text candidates.
create function hub.website_text_key(item_kind text) returns text language sql immutable set search_path=pg_catalog,pg_temp as $$
 select case item_kind when 'concept' then 'section.concept_detail' when 'concept_name' then 'section.concept_name' when 'description' then 'section.project_intro' end
$$;
create function hub.website_text_numeric(value text) returns boolean language sql immutable set search_path=pg_catalog,pg_temp as $$
 select coalesce(value ~ '[[:digit:]]' or value ~ U&'[\0E50-\0E59]',false)
$$;
create function hub.website_text_latest(project uuid,candidate uuid) returns audit.change_log language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select l from audit.change_log l where l.table_name='hub.website_text_decision'
 and l.after_row->>'project_id'=project::text and l.after_row->>'candidate_id'=candidate::text order by l.id desc limit 1
$$;
create index workspace_website_decisions on audit.change_log((after_row->>'project_id'),(after_row->>'candidate_id'),id desc)
 where table_name='hub.website_text_decision';
create or replace function hub.website_content_sources(public_id text) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare p hub.projects;begin
 select * into p from hub.projects where id=hub.media_project(public_id,'view');
 return coalesce((select jsonb_agg(jsonb_build_object('id',k.id,'kind',k.evidence->>'website_item_kind','value',k.evidence->'website_value',
  'source',k.evidence->'website_source','wiring',k.evidence->'website_wiring','holds',k.holds,
  'section_key',hub.website_text_key(k.evidence->>'website_item_kind'),'decision_id',l.id::text,'decision',l.after_row->>'decision',
  'can_use',hub.content_scope_allowed('project',public_id,'edit') and hub.website_text_key(k.evidence->>'website_item_kind') is not null
   and jsonb_typeof(k.evidence->'website_value')='string' and not hub.website_text_numeric(k.evidence->>'website_value')
   and not k.holds && array['commercial_text','prompt_injection','invalid_promotion'],
  'requires_manual_entry',hub.website_text_key(k.evidence->>'website_item_kind') is null or hub.website_text_numeric(k.evidence->>'website_value')) order by k.source_key)
  from staging.knowledge_candidates k left join lateral hub.website_text_latest(p.id,k.id) l on true
  where k.project_ids @> array[p.rem_project_id] and k.evidence->>'source_kind'='sena_public_website' and k.evidence ? 'website_item_kind'
  and (k.evidence->>'website_item_kind'<>'disclosures' or hub.can('projects','edit') or hub.can('projects','approve'))),'[]');
end $$;
create function hub.website_text_decide(public_id text,candidate uuid,expected_decision_id bigint,decision text,expected_revision integer,changes jsonb,reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;p hub.projects;k staging.knowledge_candidates;last_event audit.change_log;key text;url text;body jsonb;prior hub.content_sections;saved jsonb;event bigint;begin
 actor:=hub.content_scope_access('project',public_id,'edit');select * into p from hub.projects where public_project_id=public_id and deleted_at is null;
 if decision is null or decision not in ('use','edit_use','reject') or length(coalesce(reason,''))>2000
 or jsonb_typeof(coalesce(changes,'{}'))<>'object' then raise exception 'Invalid website decision' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('website-text:'||p.id||':'||candidate,0));
 select * into k from staging.knowledge_candidates where id=candidate and p.rem_project_id=any(project_ids)
  and evidence->>'source_kind'='sena_public_website' and evidence ? 'website_item_kind';
 if not found then raise exception 'Website candidate not found' using errcode='P0002';end if;
 key:=hub.website_text_key(k.evidence->>'website_item_kind');url:=k.evidence#>>'{website_source,page_url}';
 if url is null or url !~ '^https://([A-Za-z0-9-]+\.)?sena\.co\.th/' or decision<>'reject' and
  (key is null or jsonb_typeof(k.evidence->'website_value')<>'string') then
  raise exception 'This source is evidence for manual entry' using errcode='23514';end if;
 select * into last_event from hub.website_text_latest(p.id,k.id);
 if last_event.id is distinct from expected_decision_id then raise exception 'Website decision changed' using errcode='40001';end if;
 if decision='reject' then
  if btrim(coalesce(reason,''))='' or coalesce(changes,'{}')<>'{}' or expected_revision is not null then
   raise exception 'Rejection needs a reason and no draft changes' using errcode='23514';end if;
 else
  if expected_revision is null or expected_revision<0 or coalesce(changes,'{}')-array['body','ai_exposure']<>'{}'
   or k.holds && array['commercial_text','prompt_injection','invalid_promotion'] then raise exception 'Invalid section decision' using errcode='23514';end if;
  select * into prior from hub.content_sections where scope_type='project' and scope_id=public_id and section_key=key;
  if decision='use' then
   if coalesce(changes,'{}')<>'{}' or hub.website_text_numeric(k.evidence->>'website_value') then
    raise exception 'Numeric evidence requires manual entry' using errcode='23514';end if;
   select coalesce(v.body,'{}') into body from hub.content_section_versions v where v.id=prior.draft_version_id;
   body:=jsonb_build_object('body',coalesce(body,'{}')||jsonb_build_object('th',k.evidence->>'website_value'),
    'ai_exposure',coalesce((select ai_exposure from hub.content_section_versions where id=prior.draft_version_id),'internal'));
  else
   body:=changes;
   if jsonb_typeof(body->'body') is distinct from 'object' then raise exception 'Edited section text required' using errcode='23514';end if;
   if hub.website_text_numeric(k.evidence->>'website_value') and
    hub.faq_intake_text(body#>>'{body,th}')=hub.faq_intake_text(k.evidence->>'website_value') then
    raise exception 'Numeric evidence cannot be accepted unchanged' using errcode='23514';end if;
  end if;
  perform set_config('app.change_reason',coalesce(reason,''),true);
  saved:=hub.save_content_section('project',public_id,key,expected_revision,body||jsonb_build_object('source_ref',url));
 end if;
 insert into audit.change_log(actor,database_role,table_name,operation,before_row,after_row,reason)
 values(actor,current_setting('role'),'hub.website_text_decision','INSERT',last_event.after_row,
  jsonb_build_object('schema_version',1,'candidate_id',candidate,'project_id',p.id,'public_project_id',public_id,'section_key',key,'decision',decision,
   'section_id',saved->'id','version_id',saved#>'{version,id}','version_no',saved#>'{version,version_no}','source_url',url),nullif(btrim(reason),'')) returning id into event;
 return jsonb_build_object('decision_id',event::text,'decision',decision,'section_key',key,'saved',saved);
end $$;

-- N7 closes every legacy FAQ mutation, including the old rejection-withdraw side effect.
alter function hub.review_knowledge_candidate(uuid,integer,text,text[],text,boolean,text,text) rename to review_knowledge_candidate_before_workspace;
revoke all on function hub.review_knowledge_candidate_before_workspace(uuid,integer,text,text[],text,boolean,text,text)
 from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer;
create function hub.review_knowledge_candidate(candidate uuid,expected_revision integer,choice text,projects text[],reason text,owned boolean,role_name text,alt_text text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('knowledge','edit');
 if exists(select 1 from staging.knowledge_candidates where id=candidate and kind='faq') then
  raise exception 'Legacy FAQ candidates are read-only; use the keyed FAQ intake command' using errcode='23514';end if;
 return hub.review_knowledge_candidate_before_workspace(candidate,expected_revision,choice,projects,reason,owned,role_name,alt_text);
end $$;
revoke all on function hub.review_knowledge_candidate(uuid,integer,text,text[],text,boolean,text,text) from public;
grant execute on function hub.review_knowledge_candidate(uuid,integer,text,text[],text,boolean,text,text) to hub_app,editor,admin;

create function hub.workspace_legacy_faq_candidates(candidates uuid[]) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.workspace_admin();perform hub.require_permission('knowledge','view');
 if candidates is null or cardinality(candidates)>500 then raise exception 'Invalid candidate list' using errcode='23514';end if;
 return coalesce((select jsonb_object_agg(k.id::text,jsonb_build_object('read_only',true,'cluster_ids',
  coalesce((select jsonb_agg(c.id order by c.sort_key,c.id) from staging.faq_clusters c where k.id=any(c.member_candidate_ids)),'[]')))
  from hub.knowledge_candidate_rows() k where k.id=any(candidates) and k.kind='faq'),'{}');
end $$;

-- FAQ owns its text and minimal reference names independently of source tabs.
-- W6 extends this finite Knowledge-object boundary and faq_references filtering;
-- it must not delegate Knowledge authority to Projects/Brands grants.
create function hub.workspace_faq_scope_access(kind text,ref text,phase text default null,required_level text default 'view') returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare refs jsonb;entry jsonb;projects jsonb;selected jsonb;name jsonb;scope_ref text:=ref;group_ids uuid[];begin
 perform hub.require_permission('knowledge','view');
 if required_level is null or required_level not in ('view','edit','approve') then raise exception 'Invalid FAQ level' using errcode='23514';end if;
 perform hub.require_permission('knowledge',required_level);refs:=hub.faq_references();
 if kind='project' then
  select x into entry from hub.projects p join lateral jsonb_array_elements(refs->'projects') x on x->>'id'=p.rem_project_id
   where p.public_project_id=ref and p.deleted_at is null;scope_ref:=entry->>'id';
  if hub.content_scope_allowed('project',ref,'view') then group_ids:=hub.workspace_projects('project',ref);end if;
 elsif kind='brand' then select x into entry from jsonb_array_elements(refs->'brands') x where x->>'id'=ref;
 elsif kind='unit_type' then select x into entry from jsonb_array_elements(refs->'unit_types') x where x->>'id'=ref;
 elsif kind='project_group' then select x into entry from jsonb_array_elements(refs->'groups') x where x->>'id'=ref;
 elsif kind='corporate' and ref='sena' or kind='programme' and ref in ('LIVNEX','LIVNEX_GOLD','RENTNEX','RENTNEX_BENEFIT','RENTNEX_INVEST') then
  entry:=jsonb_build_object('id',ref,'name',hub.workspace_name(kind,ref)->>'th');
 end if;
 if entry is null then raise exception 'FAQ scope not found' using errcode='P0002';end if;
 name:=jsonb_build_object('th',coalesce(entry->>'name',ref));
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'rem_project_id',p.rem_project_id,'public_project_id',p.public_project_id,
  'name',jsonb_build_object('th',x->>'name')) order by p.public_project_id),'[]') into projects
 from hub.projects p join lateral jsonb_array_elements(refs->'projects') x on x->>'id'=p.rem_project_id
 left join hub.brands b on b.id=p.brand_id where p.deleted_at is null and
  (kind='project' and (p.public_project_id=ref or p.id=any(group_ids)) or kind='brand' and b.public_brand_id=ref or kind='corporate'
   or kind='unit_type' and p.rem_project_id=entry->>'project_id'
   or kind='programme' and exists(select 1 from hub.project_programmes z where z.project_id=p.id and upper(z.programme_key)=ref and z.participating)
   or kind='project_group' and exists(select 1 from staging.dw_projects z where z.rem_project_id=p.rem_project_id and z.source_record->>'rem_project_group_id'=ref));
 if phase is not null then select x into selected from jsonb_array_elements(projects) x where x->>'rem_project_id'=phase;
 elsif kind='project' then select x into selected from jsonb_array_elements(projects) x where x->>'public_project_id'=ref;
 elsif kind='unit_type' then select x into selected from jsonb_array_elements(projects) x where x->>'rem_project_id'=entry->>'project_id';end if;
 if (phase is not null or kind in ('project','unit_type')) and selected is null then raise exception 'FAQ phase not found' using errcode='P0002';end if;
 if kind='project' then scope_ref:=selected->>'rem_project_id';end if;
 return jsonb_build_object('scope_type',kind,'scope_id',scope_ref,'name',name,'projects',projects,'selected',selected);
end $$;
create function hub.workspace_faq_scope_allowed(kind text,ref text,required_level text default 'view') returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin perform hub.workspace_faq_scope_access(kind,ref,null,required_level);return true;
exception when insufficient_privilege or no_data_found then return false;
end $$;

-- Extend 0082 discovery without changing its signature, ranking, limits or ACL.
-- A hidden source contributes only the existing Knowledge reference name/code.
create or replace function hub.workspace_search(query text,page_size integer default 20) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare needle text:=lower(btrim(query));result jsonb;faq_refs jsonb;begin
 perform hub.workspace_require();
 if query is null or length(query)>120 or page_size is null or page_size not between 1 and 30 then raise exception 'Invalid workspace search' using errcode='23514';end if;
 if needle='' then return jsonb_build_object('items','[]'::jsonb);end if;
 faq_refs:=case when hub.can('knowledge','view') then hub.faq_references() else '{}'::jsonb end;
 with candidates as (
  select 'project' kind,p.public_project_id ref,p.public_name label,p.rem_project_id code,
   jsonb_build_object('project',p.public_project_id) context
  from hub.projects p where p.deleted_at is null and hub.content_scope_allowed('project',p.public_project_id,'view')
   and position(needle in lower(p.public_name::text||' '||p.public_project_id||' '||p.rem_project_id))>0
  union all
  select 'brand',b.public_brand_id,b.public_name,b.rem_brand_id,jsonb_build_object('brand',b.public_brand_id)
  from hub.brands b where b.deleted_at is null and hub.content_scope_allowed('brand',b.public_brand_id,'view')
   and position(needle in lower(b.public_name::text||' '||b.public_brand_id||' '||b.rem_brand_id))>0
  union all
  select 'project',p.public_project_id,jsonb_build_object('th',x->>'name'),p.rem_project_id,jsonb_build_object('project',p.public_project_id,'tab','faq')
  from hub.projects p join lateral jsonb_array_elements(faq_refs->'projects') x on x->>'id'=p.rem_project_id
  where p.deleted_at is null and not hub.content_scope_allowed('project',p.public_project_id,'view')
   and hub.workspace_faq_scope_allowed('project',p.public_project_id,'view')
   and position(needle in lower(coalesce(x->>'name','')||' '||p.public_project_id||' '||p.rem_project_id))>0
  union all
  select 'brand',b.public_brand_id,jsonb_build_object('th',x->>'name'),b.public_brand_id,jsonb_build_object('brand',b.public_brand_id,'tab','faq')
  from hub.brands b join lateral jsonb_array_elements(faq_refs->'brands') x on x->>'id'=b.public_brand_id
  where b.deleted_at is null and not hub.content_scope_allowed('brand',b.public_brand_id,'view')
   and hub.workspace_faq_scope_allowed('brand',b.public_brand_id,'view')
   and position(needle in lower(coalesce(x->>'name','')||' '||b.public_brand_id))>0
  union all
  select distinct 'bud',b.rem_bu_id,jsonb_build_object('th',coalesce(b.rem_bu_name,b.rem_bu_id)),b.rem_bu_code,jsonb_build_object('bud',b.rem_bu_id)
  from hub.workspace_project_bu() b where b.rem_bu_id is not null
   and position(needle in lower(concat_ws(' ',b.rem_bu_id,b.rem_bu_code,b.rem_bu_name)))>0
  union all
  select 'question',q.question_key,q.question_template,q.question_key,jsonb_build_object('tab','bank','question',q.question_key)
  from hub.faq_questions q where hub.can('knowledge','view') and q.status='approved'
   and position(needle in lower(q.question_key||' '||q.question_template::text||' '||q.alt_questions::text))>0
 ), ranked as (
  select *,row_number() over(partition by kind order by case when lower(ref)=needle or lower(code)=needle then 0
   when lower(label->>'th')=needle or lower(label->>'en')=needle then 1 else 2 end,ref) rank_in_kind,
   case kind when 'project' then 1 when 'brand' then 2 when 'bud' then 3 else 4 end kind_order from candidates
 ), bounded as (select * from ranked order by rank_in_kind,kind_order,ref limit page_size)
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'ref',ref,'label',label,'code',code,'context',context) order by rank_in_kind,kind_order,ref),'[]') into result from bounded;
 return jsonb_build_object('items',result);
end $$;

create function hub.workspace_faq_target(faq uuid) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare f hub.faqs;ref text;kind text;begin
 perform hub.require_permission('knowledge','view');
 if not hub.workspace_faq_allowed(faq) then raise exception 'FAQ access denied' using errcode='42501';end if;
 select * into f from hub.faqs where id=faq;
 if not found then raise exception 'FAQ not found' using errcode='P0002';end if;
 kind:=case when f.scope_type='rem_project_group' then 'project_group' else f.scope_type end;ref:=f.scope_id;
 if kind='project' then select public_project_id into ref from hub.projects where rem_project_id=f.scope_id and deleted_at is null;end if;
 perform hub.workspace_faq_scope_access(kind,ref);
 return hub.workspace_target(kind,ref,'faq',jsonb_build_object('phase',case when kind='project' then f.scope_id end,'question_key',f.question_key,'item',f.id));
end $$;
create function hub.workspace_faq_visible(faq uuid) returns boolean language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin perform hub.workspace_faq_target(faq);return true;
exception when insufficient_privilege or no_data_found then return false;
end $$;
create function hub.workspace_faq_impact(faq uuid) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare f hub.faqs;v hub.faq_versions;ids text[];visible integer;begin
 select * into f from hub.faqs where id=faq;select * into v from hub.faq_versions where faq_id=faq order by version_no desc limit 1;
 ids:=case when v.applicability_rule<>'{}' then hub.faq_rule_projects(v.applicability_rule,f.scope_type,f.scope_id) else v.applies_to_project_ids end;
 -- Match the existing corporate composition opt-in; an empty list alone is not global.
 if f.scope_type='corporate' and coalesce(cardinality(ids),0)=0 and coalesce(v.applicability_rule,'{}')='{}'
  and exists(select 1 from hub.faq_questions q where q.question_key=f.question_key and q.status='approved' and q.show_on_project_pages) then
  select array_agg(rem_project_id) into ids from hub.projects where deleted_at is null;
 end if;
 select count(*) into visible from hub.projects p where p.rem_project_id=any(ids) and p.deleted_at is null
  and exists(select 1 from jsonb_array_elements(hub.faq_references()->'projects') x where x->>'id'=p.rem_project_id);
 return jsonb_build_object('affected_project_count',visible,'affected_count_complete',visible=coalesce(cardinality(ids),0));
end $$;

create function hub.workspace_resolve(faq uuid default null,cluster uuid default null,phase text default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare c staging.faq_clusters;p hub.projects;ref text;kind text;target jsonb;begin
 perform hub.require_permission('knowledge','view');
 if (faq is null)=(cluster is null) then raise exception 'Choose exactly one reference' using errcode='23514';end if;
 if faq is not null then
  target:=hub.workspace_faq_target(faq);
  if phase is not null then
   if target->>'phase' is not null and target->>'phase'<>phase then raise exception 'FAQ phase does not match' using errcode='23514';end if;
   perform hub.workspace_faq_scope_access(target->>'level',target->>'id',phase);
   target:=target||jsonb_build_object('phase',phase);
  end if;
  return target;
 end if;
 perform hub.faq_intake_cluster(cluster);
 select * into c from staging.faq_clusters where id=cluster;
 if not found then raise exception 'Cluster not found' using errcode='P0002';end if;
 if phase is not null then
  select * into p from hub.projects where rem_project_id=phase and deleted_at is null and phase=any(c.project_ids);
  if p.id is null then raise exception 'Cluster phase not found' using errcode='P0002';end if;
  perform hub.workspace_faq_scope_access('project',p.public_project_id,phase);
 end if;
 kind:=c.suggested_level;
 if kind='corporate' then ref:='sena';
 elsif kind='brand' and p.id is not null then select public_brand_id into ref from hub.brands where id=p.brand_id and rem_brand_id=any(c.brand_ids) and deleted_at is null;
 elsif kind='brand' and cardinality(c.brand_ids)=1 then select public_brand_id into ref from hub.brands where rem_brand_id=c.brand_ids[1] and deleted_at is null;
 elsif kind='project' and p.id is not null then ref:=p.public_project_id;
 elsif kind='project' and cardinality(c.project_ids)=1 then
  select * into p from hub.projects where rem_project_id=c.project_ids[1] and deleted_at is null;ref:=p.public_project_id;
 else raise exception 'Cluster requires an explicit existing page context' using errcode='23514';end if;
 perform hub.workspace_faq_scope_access(kind,ref,p.rem_project_id);
 return hub.workspace_target(kind,ref,'faq',jsonb_build_object('phase',p.rem_project_id,'question_key',c.suggested_question_key,'item',c.id,'section','intake'));
end $$;

create function hub.workspace_field_target(kind text,ref text,field_key text,context jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare section text;tab text:='data';begin
 select fc.section into section from hub.field_catalog fc where fc.field_key=workspace_field_target.field_key;
 if field_key like 'selling_point.%' then section:='narrative';
 elsif field_key like 'building.%' then section:='buildings';
 elsif field_key='section.investor_intro' then section:='investor';
 elsif field_key like 'section.%' then section:='narrative';
 elsif field_key like 'contact.%' then section:='contacts';
 elsif field_key like 'disclosure.%' or field_key like 'sales_term.%' or field_key like 'programme.%' or field_key like 'construction_progress.%' then section:='commercial';
 elsif field_key like 'price.%' then tab:='unit-types';section:='prices';
 elsif field_key like 'commercial_type.%' then tab:='unit-types';section:='types';
 elsif field_key like 'facility.%' then section:='facilities';
 elsif field_key like 'feature.%' or field_key like 'solar_estimate.%' then section:='features';
 elsif field_key like 'place.%' then section:='places';
 elsif field_key like 'asset.%' then tab:='media';section:='coverage';end if;
 return hub.workspace_target(kind,ref,tab,jsonb_build_object('section',coalesce(section,'identity'),'field',field_key)||context);
end $$;

create function hub.workspace_faq(kind text,ref text,phase text default null,query text default '',after_key text default null,page_size integer default 50,locale text default 'th')
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects;scope_kind text:=kind;scope_ref text:=ref;composed jsonb:='{}';cell jsonb;resolved jsonb;q hub.faq_questions;
 own hub.faqs;f hub.faqs;v hub.faq_versions;source jsonb;target jsonb;facts jsonb;clusters jsonb;item jsonb;items jsonb:='[]';unmatched jsonb:='[]';
 display_state text;state text;key text;selected_key text:=case when after_key like 'q:%' then substr(after_key,3) end;rows_count integer:=0;form text;scope_ids uuid[];ancestor record;ancestor_rank integer;matches integer;faq_scope jsonb;source_view boolean;begin
 faq_scope:=hub.workspace_faq_scope_access(kind,ref,phase);
 if page_size is null or page_size not between 1 and 100 or length(coalesce(query,''))>200 or locale is null or locale not in ('th','en')
 or length(coalesce(after_key,''))>120 or after_key like 'u:%' and after_key !~ '^u:[0-9]{10}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 or selected_key is not null and (selected_key !~ '^[a-z][a-z0-9_]{1,100}$' or coalesce(query,'')<>'')
 then raise exception 'Invalid FAQ query' using errcode='23514';end if;
 select * into p from hub.projects where id=(faq_scope#>>'{selected,id}')::uuid;
 scope_ids:=array(select (x->>'id')::uuid from jsonb_array_elements(faq_scope->'projects') x);
 scope_ref:=faq_scope->>'scope_id';source_view:=p.id is not null and hub.content_scope_allowed('project',p.public_project_id,'view');
 if source_view then
  composed:=hub.compose_project_faq(p.id,locale,case when kind='unit_type' then (select public_commercial_type_id from hub.commercial_types where id::text=ref) end,false,false);
  form:=hub.faq_project_form(p.id);
 end if;
 -- Cursors 0:/1:/2: page questions; u: pages unmatched clusters. q:<key> is
 -- an exact approved-question selection, with identical scope/phase authority.
 for q in select bank.* from hub.faq_questions bank where bank.status='approved'
  and (selected_key is null or bank.question_key=selected_key) order by
  case when bank.is_core and not exists(select 1 from jsonb_array_elements(coalesce(composed->'cells','[]')) c where c->>'question_key'=bank.question_key and c->>'faq_id' is not null)
   and not exists(select 1 from hub.faqs a where a.question_key=bank.question_key and a.scope_type=scope_kind and a.scope_id=scope_ref and a.state<>'WITHDRAWN') then 0
   when bank.is_core then 1 else 2 end,bank.web_sort,bank.question_key loop
  key:=(case when q.is_core and not exists(select 1 from jsonb_array_elements(coalesce(composed->'cells','[]')) c where c->>'question_key'=q.question_key and c->>'faq_id' is not null)
   and not exists(select 1 from hub.faqs a where a.question_key=q.question_key and a.scope_type=scope_kind and a.scope_id=scope_ref and a.state<>'WITHDRAWN') then '0:'
   when q.is_core then '1:' else '2:' end)||lpad((q.web_sort+100000)::text,7,'0')||':'||q.question_key;
  if selected_key is null and after_key is not null and key<=after_key then continue;end if;
  own:=null;f:=null;v:=null;resolved:=null;source:=null;target:=null;facts:='[]';
  select a.* into own from hub.faqs a where a.question_key=q.question_key and a.scope_type=scope_kind and a.scope_id=scope_ref and a.state<>'WITHDRAWN' order by a.id limit 1;
  select value into cell from jsonb_array_elements(coalesce(composed->'cells','[]')) where value->>'question_key'=q.question_key;
  select value into resolved from jsonb_array_elements(coalesce(composed->'items','[]')) where value->>'question_key'=q.question_key;
  if kind not in ('project','unit_type') then cell:=null;resolved:=null;end if;
  if kind in ('project','unit_type') and cell->>'faq_id' is not null then select * into f from hub.faqs where id=(cell->>'faq_id')::uuid;
  elsif own.id is not null then f:=own;
  elsif kind<>'project' or not source_view then
   -- Text-only FAQ selection does not compose source facts. A selected phase
   -- never promotes its project override onto a brand or programme page.
   ancestor_rank:=0;matches:=0;
   for ancestor in select x.*,case x.scope_type when 'project' then 5 when 'project_group' then 4 when 'programme' then 3 when 'brand' then 2 else 1 end priority
    from hub.faqs x join lateral(select * from hub.faq_versions z where z.faq_id=x.id and z.state<>'WITHDRAWN' order by version_no desc limit 1) av on true
    where x.question_key=q.question_key and x.state<>'WITHDRAWN' and hub.workspace_faq_visible(x.id) and
    (x.scope_type='corporate' and kind<>'corporate' and (kind not in ('project','unit_type') or q.show_on_project_pages)
     or x.scope_type='brand' and kind in ('programme','project_group','project','unit_type') and p.id is not null and exists(select 1 from hub.brands b where b.id=p.brand_id and b.public_brand_id=x.scope_id)
     or x.scope_type='programme' and kind in ('project_group','project','unit_type') and p.id is not null
     or x.scope_type='project_group' and kind in ('project','unit_type') and exists(select 1 from staging.dw_projects d where d.rem_project_id=p.rem_project_id and d.source_record->>'rem_project_group_id'=x.scope_id)
     or x.scope_type='project' and kind='unit_type' and x.scope_id=p.rem_project_id)
    and (x.scope_type='corporate' and cardinality(av.applies_to_project_ids)=0 and av.applicability_rule='{}'
     or exists(select 1 from hub.projects ap where ap.id=any(scope_ids) and ap.rem_project_id=any(case when av.applicability_rule<>'{}'
       then hub.faq_rule_projects(av.applicability_rule,x.scope_type,x.scope_id) else av.applies_to_project_ids end)))
    order by priority desc,x.id loop
    if ancestor_rank=0 then ancestor_rank:=ancestor.priority;select * into f from hub.faqs where id=ancestor.id;end if;
    if ancestor.priority=ancestor_rank then matches:=matches+1;end if;
   end loop;
   if matches>1 then f:=null;cell:=jsonb_build_object('state','hold','reason','same_level_conflict');end if;
  end if;
  if kind not in ('project','unit_type') and coalesce(cell->>'reason','')<>'same_level_conflict' then cell:=null;resolved:=null;end if;
  if (cell->>'reason'='same_level_conflict') or (select count(*) from hub.faqs x where x.question_key=q.question_key and x.scope_type=scope_kind and x.scope_id=scope_ref and x.state<>'WITHDRAWN')>1 then
   f:=null;own:=null;resolved:=null;cell:=jsonb_build_object('state','hold','reason','same_level_conflict');end if;
  if f.id is not null and not hub.workspace_faq_visible(f.id) then f:=null;resolved:=null;cell:=null;end if;
  if f.id is not null then
   select fv.* into v from hub.faq_versions fv where fv.faq_id=f.id and fv.state<>'WITHDRAWN' order by fv.version_no desc limit 1;
   target:=hub.workspace_faq_target(f.id);
   source:=jsonb_build_object('scope_type',f.scope_type,'scope_id',f.scope_id,'name',hub.workspace_faq_scope_access(target->>'level',target->>'id')->'name','target',target)||hub.workspace_faq_impact(f.id);
  end if;
  if source_view then
   select coalesce(jsonb_agg(slot||jsonb_build_object('target',hub.workspace_field_target('project',p.public_project_id,k,
    jsonb_build_object('phase',p.rem_project_id,'unit_type',coalesce(slot->>'public_commercial_type_id',case when kind='unit_type' then (select public_commercial_type_id from hub.commercial_types where id::text=ref) end),
     'item',(select price.id from hub.project_prices price where price.public_price_id=slot->>'public_price_id' and price.project_id=p.id)))) order by k),'[]') into facts
   from (select distinct unnest(q.fact_keys||coalesce(v.fact_keys,'{}')) k) keys cross join lateral
    (select hub.faq_fact_slot(p.id,k,locale,case when kind='unit_type' then (select public_commercial_type_id from hub.commercial_types where id::text=ref) end,false) slot) value;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'state',hub.faq_intake_state(c.id)->>'state','holds',c.holds,
   'question_key',c.suggested_question_key,'suggested_level',c.suggested_level,
   'target',hub.workspace_target(kind,ref,'faq',jsonb_build_object('phase',p.rem_project_id,'question_key',q.question_key,'item',c.id,'section','intake'))) order by c.sort_key,c.id),'[]') into clusters
   from staging.faq_clusters c where c.suggested_question_key=q.question_key and c.suggested_level=scope_kind
   and (scope_kind='corporate' or scope_kind='brand' and exists(select 1 from hub.brands b where b.public_brand_id=ref and b.rem_brand_id=any(c.brand_ids)) or p.rem_project_id=any(c.project_ids))
   and hub.faq_intake_state(c.id)->>'state' in ('open','held','question_proposed');
  state:=coalesce(cell->>'state',case when v.id is not null then lower(v.state) else 'missing' end);
  display_state:=case when state='not_applicable' then 'not_applicable' when state='waiting_for_fact' then 'waiting_for_fact'
   when state='hold' then 'hold' when v.answer_kind='handoff' then 'handoff' when own.id is not null then 'own'
   when f.id is not null then 'inherited' when jsonb_array_length(clusters)>0 then 'legacy_suggestion' else 'missing' end;
  if source_view and cardinality(q.property_types)>0 and (form is null or not form=any(q.property_types)) then
   display_state:=case when form is null then 'hold' else 'not_applicable' end;
  end if;
  if coalesce(query,'')<>'' and position(lower(query) in lower(q.question_key||' '||coalesce(q.question_template->>locale,'')||' '||coalesce(q.question_template->>'th','')||' '||
   coalesce(v.short_answer->>locale,'')||' '||coalesce(v.short_answer->>'th','')))=0 then continue;end if;
  item:=jsonb_build_object('cursor',key,'question_key',q.question_key,'label',q.question_template,'is_core',q.is_core,'answer_kind',coalesce(v.answer_kind,q.answer_kind),
   'display_state',display_state,'content_state',v.state,'own_answer',case when own.id is not null then jsonb_build_object('id',own.id,'revision',own.revision,'version_id',own.draft_version_id,'state',own.state) end,
   'effective_answer',case when v.id is not null then jsonb_build_object('id',f.id,'revision',f.revision,'version_id',v.id,'question',v.question,'short_answer',v.short_answer,'detail',v.detail,
    'rendered',resolved,'source',source,'author',hub.workspace_actor(v.created_by),'approver',hub.workspace_actor(v.approved_by)) end,
   'facts',facts,'legacy_clusters',clusters,'applicability',jsonb_build_object('state',case when display_state='not_applicable' then 'not_applicable' when display_state='hold' then 'unknown' else 'applicable' end,'reason',cell->'reason'),
   'targets',jsonb_strip_nulls(jsonb_build_object('create_override',case when hub.workspace_faq_scope_allowed(kind,ref,'edit') and own.id is null and display_state not in ('not_applicable','hold') then hub.workspace_target(kind,ref,'faq',jsonb_build_object('phase',p.rem_project_id,'question_key',q.question_key,'section','new')) end,
    'edit_source',case when f.id is not null and hub.workspace_faq_scope_allowed(target->>'level',target->>'id','edit') then target end)));
  items:=items||jsonb_build_array(item);rows_count:=rows_count+1;exit when rows_count>page_size;
 end loop;
 -- Unmatched/held proposals have no approved question row. Keep their existing
 -- intake workflow reachable without exposing variants, answers or other scopes.
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'cursor',c.cursor,'label',jsonb_build_object('th',c.template),
  'question_key',coalesce(c.suggested_question_key,hub.faq_intake_state(c.id)->>'question_key'),'state',hub.faq_intake_state(c.id)->>'state','holds',c.holds,
  'target',hub.workspace_target(kind,ref,'faq',jsonb_build_object('phase',p.rem_project_id,'question_key',coalesce(c.suggested_question_key,hub.faq_intake_state(c.id)->>'question_key'),'item',c.id,'section','intake'))) order by c.cursor),'[]') into unmatched
 from (select x.*,'u:'||lpad(x.sort_key::text,10,'0')||':'||x.id::text cursor from staging.faq_clusters x
  where selected_key is null and not exists(select 1 from hub.faq_questions bank where bank.question_key=x.suggested_question_key and bank.status='approved')
   and x.suggested_level=scope_kind
   and (scope_kind='corporate' or scope_kind='brand' and exists(select 1 from hub.brands b where b.public_brand_id=ref and b.rem_brand_id=any(x.brand_ids)) or p.rem_project_id=any(x.project_ids))
   and hub.faq_intake_state(x.id)->>'state' in ('open','held','question_proposed')
   and (coalesce(query,'')='' or position(lower(query) in lower(x.template||' '||coalesce(x.suggested_question_key,'')))>0)
   and (after_key is null or after_key not like 'u:%' or 'u:'||lpad(x.sort_key::text,10,'0')||':'||x.id::text>after_key)
  order by x.sort_key,x.id limit page_size+1) c;
 return jsonb_build_object('page_scope',jsonb_build_object('type',scope_kind,'id',scope_ref),'selected_phase',p.rem_project_id,
  'items',case when rows_count>page_size then items-(rows_count-1) else items end,
  'next_cursor',case when rows_count>page_size then items->(page_size-1)->>'cursor' end,
  'unmatched_clusters',case when jsonb_array_length(unmatched)>page_size then unmatched-(jsonb_array_length(unmatched)-1) else unmatched end,
  'unmatched_next_cursor',case when jsonb_array_length(unmatched)>page_size then unmatched->(page_size-1)->>'cursor' end);
end $$;

create function hub.workspace_preview(kind text,ref text,phase text default null,locale text default 'th') returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare page hub.web_pages;p hub.projects;ids uuid[];public_id text;snapshot jsonb;begin
 perform hub.content_scope_access(kind,ref,'view');perform hub.require_permission('knowledge','view');
 if kind not in ('project','brand','corporate','programme') or locale is null or locale not in ('th','en') then
  raise exception 'Unsupported workspace preview' using errcode='23514';end if;
 p:=hub.workspace_phase(kind,ref,phase);ids:=hub.workspace_projects(kind,ref);
 select * into page from hub.web_pages w where w.page_type=kind and w.entity_ref=case when kind='project'
  then coalesce((select g.anchor from hub.workspace_confirmed_groups() g where p.id=any(g.members)),ref) else ref end order by w.page_key limit 1;
 if page.id is null then
  page:=jsonb_populate_record(null::hub.web_pages,jsonb_build_object('page_key',kind||':'||ref,'page_type',kind,'entity_ref',ref,
   'url','/preview/'||kind||'/'||ref,'locales',array['th','en'],'ai_policy','no_ai','max_faq_items',20,'revision',1,'editors','[]'::jsonb,
   'project_ids',case when kind='project' then (select coalesce(jsonb_agg(public_project_id order by public_project_id),'[]') from hub.projects where id=any(ids)) else '[]'::jsonb end));
 end if;
 -- Validate the entire saved page before any optional selected-phase projection.
 foreach public_id in array page.project_ids loop perform hub.content_scope_access('project',public_id,'view');end loop;
 if kind='project' and phase is not null then page.project_ids:=array[p.public_project_id];end if;
 if not locale=any(page.locales) then raise exception 'Locale not configured' using errcode='P0002';end if;
 snapshot:=hub.web_compose(page);perform hub.web_assert_sources(snapshot,'view');
 return jsonb_build_object('mode','PRIVATE_DRAFT','saved',false,'preview',hub.web_output(snapshot,locale,false),
  'issues',hub.web_issues(snapshot),'preview_assets',hub.web_preview_assets(snapshot));
end $$;

create function hub.workspace_page(kind text,ref text,phase text default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects;ids uuid[];phases jsonb;tabs jsonb:='["overview"]';sections jsonb:='[]';required jsonb:='[]';recommended jsonb:='[]';tasks jsonb:='[]';
 readiness jsonb;media jsonb;item jsonb;target jsonb;field text;section text;entry jsonb;s record;r record;preview jsonb;changes jsonb:='[]';published_at timestamptz;
 today date:=(current_timestamp at time zone 'Asia/Bangkok')::date;group_ref text;faq_scope jsonb;begin
 if not hub.content_scope_allowed(kind,ref,'view') or kind='unit_type' and not exists(select 1 from hub.commercial_types c join hub.projects x on x.id=c.project_id
  where c.id::text=ref and c.deleted_at is null and hub.content_scope_allowed('project',x.public_project_id,'view')) then
  faq_scope:=hub.workspace_faq_scope_access(kind,ref,phase);
  return jsonb_build_object('entity',jsonb_build_object('kind',kind,'ref',ref,'name',faq_scope->'name',
   'scope_type',kind,'scope_id',faq_scope->>'scope_id'),'faq_only',true,
   'phases',(select coalesce(jsonb_agg(x-'id'),'[]') from jsonb_array_elements(faq_scope->'projects') x),
   'selected_phase',faq_scope#>>'{selected,rem_project_id}','tabs',jsonb_build_array('faq','history'),'sections','[]'::jsonb,
   'overview',jsonb_build_object('readiness',jsonb_build_object('required','[]'::jsonb,'recommended','[]'::jsonb),
    'tasks','[]'::jsonb,'changes_since_publication','[]'::jsonb,'preview_target',null));
 end if;
 perform hub.content_scope_access(kind,ref,'view');ids:=hub.workspace_projects(kind,ref);p:=hub.workspace_phase(kind,ref,phase);
 if kind='project' then select g.anchor into group_ref from hub.workspace_confirmed_groups() g where p.id=any(g.members);end if;
 select coalesce(jsonb_agg(jsonb_build_object('rem_project_id',rem_project_id,'public_project_id',public_project_id,'name',public_name) order by public_project_id),'[]') into phases
  from hub.projects where id=any(ids);
 if kind in ('project','brand','corporate') then tabs:=tabs||'"data"'::jsonb;end if;
 if kind='project' then tabs:=tabs||'"unit-types"'::jsonb||'"media"'::jsonb;
 elsif kind='brand' then tabs:=tabs||'"media"'::jsonb;end if;
 if hub.can('knowledge','view') then tabs:=tabs||'"faq"'::jsonb;end if;tabs:=tabs||'"history"'::jsonb;
 if p.id is not null then
  readiness:=hub.project_content_readiness_before_media(p.public_project_id);media:=hub.media_checklist(p.public_project_id);
  for item in select value from jsonb_array_elements(coalesce(readiness->'items','[]')) loop
   if (item->>'complete')::boolean then continue;end if;
   field:=item->>'field_key';target:=hub.workspace_field_target('project',p.public_project_id,field,
    jsonb_build_object('phase',p.rem_project_id,'item',item->>'point_key','building',item->>'building_key'));
   entry:=jsonb_build_object('code',field,'label',item->'label','state','missing','target',target);
   if (item->>'required')::boolean then required:=required||jsonb_build_array(entry);else recommended:=recommended||jsonb_build_array(entry);end if;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(media->'items','[]')) loop
   if (item->>'complete')::boolean then continue;end if;
   target:=hub.workspace_target('project',p.public_project_id,'media',jsonb_build_object('phase',p.rem_project_id,'section','coverage','media_slot',
    jsonb_build_object('rule_key',item->>'rule_key','media_category',item->>'media_category','target_type',item#>>'{context,target_type}',
     'target_key',item#>>'{context,target_key}','floor',item->'floor','tags',item->'tags','usage',item#>>'{context,usage}',
     'media_role',case when item->>'rule_key' in ('hero','thumbnail') then item->>'rule_key' end)));
   entry:=jsonb_build_object('code',item->>'rule_key','label',item->'label','state','missing','target',target);
   if (item->>'blocks_publish')::boolean and not(item->>'minimum_met')::boolean then required:=required||jsonb_build_array(entry);else recommended:=recommended||jsonb_build_array(entry);end if;
  end loop;
  -- Reuse each existing writer's readiness; preserve the public type identity for its wizard.
  for s in select c.id,c.public_commercial_type_id,hub.unit_type_readiness(c.id) readiness,null::date due,upper(c.status) state,c.public_name label,'commercial_type.public_name' field from hub.commercial_types c
    where c.project_id=p.id and c.deleted_at is null
   union all select price.id,c.public_commercial_type_id,hub.project_price_readiness(price.id),price.valid_to,upper(price.state),price.display_text,'price.amount' from hub.project_prices price
    join hub.commercial_types c on c.id=price.commercial_type_id where price.project_id=p.id and c.deleted_at is null and price.state<>'withdrawn' loop
   if s.state in ('IN_REVIEW','RETURNED') then tasks:=tasks||jsonb_build_array(jsonb_build_object('code',s.field,'label',s.label,'state',s.state,
    'target',hub.workspace_field_target('project',p.public_project_id,s.field,jsonb_build_object('phase',p.rem_project_id,'item',s.id,'unit_type',s.public_commercial_type_id))));end if;
   for item in select value from jsonb_array_elements(s.readiness->'items') loop
    if (item->>'complete')::boolean then continue;end if;
    target:=hub.workspace_field_target('project',p.public_project_id,item->>'field_key',jsonb_build_object('phase',p.rem_project_id,'item',s.id,'unit_type',s.public_commercial_type_id));
    entry:=jsonb_build_object('code',item->>'field_key','label',item->'label','state','missing','target',target);
    if (item->>'required')::boolean then required:=required||jsonb_build_array(entry);else recommended:=recommended||jsonb_build_array(entry);end if;
   end loop;
   if s.due<=today+30 then
    tasks:=tasks||jsonb_build_array(jsonb_build_object('code','price.valid_to','label',(select label from hub.field_catalog where field_key='price.valid_to'),
     'state',case when s.due<today then 'expired' else 'expiring' end,'due',s.due,'target',hub.workspace_field_target('project',p.public_project_id,'price.valid_to',
      jsonb_build_object('phase',p.rem_project_id,'item',s.id,'unit_type',s.public_commercial_type_id))));end if;
  end loop;
  for s in select key kind,value records from jsonb_each(hub.project_commercial_workspace(p.public_project_id)->'records') loop
   for r in select value data from jsonb_array_elements(s.records) loop
    if upper(r.data->>'state') in ('IN_REVIEW','RETURNED') then
     field:=hub.project_commercial_entity(s.kind)||'.'||case s.kind when 'disclosures' then 'owner_company' when 'sales-terms' then 'conditions' else 'as_of' end;
     tasks:=tasks||jsonb_build_array(jsonb_build_object('code',field,'label',(select label from hub.field_catalog where field_key=field),'state',upper(r.data->>'state'),
      'target',hub.workspace_field_target('project',p.public_project_id,field,jsonb_build_object('phase',p.rem_project_id,'item',r.data->>'id','kind',s.kind))));end if;
    for item in select value from jsonb_array_elements(r.data#>'{readiness,items}') loop
     if (item->>'complete')::boolean then continue;end if;
     target:=hub.workspace_field_target('project',p.public_project_id,item->>'field_key',jsonb_build_object('phase',p.rem_project_id,'item',r.data->>'id','kind',s.kind));
     required:=required||jsonb_build_array(jsonb_build_object('code',item->>'field_key','label',item->'label','state','missing','target',target));
    end loop;
   end loop;
  end loop;
  for s in select f.fact_key,f.grain,case when f.grain like 'building:%' then substr(f.grain,10) end building_key,least(f.valid_to,f.as_of+c.review_every_days) due,c.label from hub.project_facts f
   join hub.field_catalog c on c.field_key=f.fact_key where f.project_id=p.id and least(f.valid_to,f.as_of+c.review_every_days)<=today+30 loop
   tasks:=tasks||jsonb_build_array(jsonb_build_object('code',s.fact_key,'label',s.label,'state',case when s.due<today then 'expired' else 'expiring' end,'due',s.due,
    'target',hub.workspace_field_target('project',p.public_project_id,s.fact_key,jsonb_build_object('phase',p.rem_project_id,'grain',s.grain,'building',s.building_key))));
  end loop;
  for s in with bindings as (
   select a.id binding,a.asset_id,a.asset_role usage,'project'::text target_type,p.id::text target_key,null::integer floor,a.effective_to from hub.entity_assets a
    where a.project_id=p.id and a.model_id is null and a.deleted_at is null
   union all select a.id,a.asset_id,a.asset_role,'commercial_type',a.commercial_type_id::text,a.floor_number,null::timestamptz from hub.commercial_type_assets a where a.project_id=p.id and a.deleted_at is null
   union all select a.id,a.asset_id,a.usage,a.target_type,a.target_key,a.floor_from,a.effective_to from hub.asset_links a where a.project_id=p.id and a.deleted_at is null and hub.media_target(p.id,a.target_type,a.target_key,'view'))
   select b.*,a.media_category,a.original_filename,least(a.effective_to,b.effective_to) due from bindings b join hub.assets a on a.id=b.asset_id
    where a.deleted_at is null and hub.can_read_asset(a.id) and least(a.effective_to,b.effective_to)<=now()+interval '30 days' loop
   tasks:=tasks||jsonb_build_array(jsonb_build_object('code','asset.effective_to','label',jsonb_build_object('th',s.original_filename),
    'state',case when s.due<=now() then 'expired' else 'expiring' end,'due',s.due,'target',hub.workspace_target('project',p.public_project_id,'media',
     jsonb_build_object('phase',p.rem_project_id,'section','coverage','item',s.binding,'asset_id',s.asset_id,'media_role',case when s.usage in ('hero','thumbnail') then s.usage end,
      'media_slot',jsonb_build_object('rule_key',s.usage,'media_category',s.media_category,'target_type',s.target_type,'target_key',s.target_key,'floor',s.floor,'tags','[]'::jsonb,'usage',s.usage)))));
  end loop;
 end if;
 if kind='brand' then
  readiness:=hub.brand_detail(ref)->'readiness';
  for item in select value from jsonb_array_elements(coalesce(readiness->'missing','[]')) loop
   field:=item->>'field';
   if field like 'assets.%' then
    target:=hub.workspace_target('brand',ref,'media',jsonb_build_object('section','coverage','field',field,'media_role','logo_primary',
     'asset_id',case when split_part(field,'.',2) ~ '^[0-9a-fA-F-]{36}$' then split_part(field,'.',2) end));
   else target:=hub.workspace_field_target('brand',ref,'brand.'||split_part(field,'.',1));end if;
   required:=required||jsonb_build_array(jsonb_build_object('code',field,'label',jsonb_build_object('th',item->>'message'),'state','missing','target',target));
  end loop;
  for s in select a.id,a.original_filename,b.id binding,b.asset_role,least(a.effective_to,b.effective_to) due
   from hub.brands root join hub.brand_assets b on b.brand_id=root.id join hub.assets a on a.id=b.asset_id
   where root.public_brand_id=ref and b.deleted_at is null and a.deleted_at is null and hub.can_read_asset(a.id)
    and least(a.effective_to,b.effective_to)<=now()+interval '30 days' loop
   tasks:=tasks||jsonb_build_array(jsonb_build_object('code','asset.effective_to','label',jsonb_build_object('th',s.original_filename),
    'state',case when s.due<=now() then 'expired' else 'expiring' end,'due',s.due,'target',hub.workspace_target('brand',ref,'media',
     jsonb_build_object('section','coverage','item',s.binding,'asset_id',s.id,'media_role',s.asset_role))));
  end loop;
 end if;
 for s in select cs.*,v.state version_state from hub.content_sections cs left join hub.content_section_versions v on v.id=cs.draft_version_id
  where cs.scope_type=kind and cs.scope_id=case when kind='project' then p.public_project_id else ref end and cs.section_key is not null order by cs.section_key loop
  target:=hub.workspace_field_target(kind,case when kind='project' then p.public_project_id else ref end,s.section_key,jsonb_build_object('phase',p.rem_project_id,'item',s.id));
  entry:=jsonb_build_object('key',s.section_key,'label',(select label from hub.field_catalog where field_key=s.section_key),'tab','data','state',coalesce(s.version_state,s.state),'revision',s.revision,'target',target,
   'suggestion_count',case when p.id is null then 0 else (select count(*) from staging.knowledge_candidates k where p.rem_project_id=any(k.project_ids)
     and k.evidence->>'source_kind'='sena_public_website' and hub.website_text_key(k.evidence->>'website_item_kind')=s.section_key) end);
  sections:=sections||jsonb_build_array(entry);
  if coalesce(s.version_state,s.state) in ('RETURNED','IN_REVIEW') then tasks:=tasks||jsonb_build_array(jsonb_build_object('code',s.section_key,'state',coalesce(s.version_state,s.state),'target',target));end if;
 end loop;
 if p.id is not null and hub.can('knowledge','view') then
  for item in select value from jsonb_array_elements(hub.compose_project_faq(p.id,'th',null,false,false)->'cells') loop
   if item->>'state' in ('waiting_for_fact','missing','hold') then
    tasks:=tasks||jsonb_build_array(jsonb_build_object('code',item->>'question_key','label',jsonb_build_object('th',item->>'question_label'),'state',item->>'state',
     'target',hub.workspace_target('project',p.public_project_id,'faq',jsonb_build_object('phase',p.rem_project_id,'question_key',item->>'question_key'))));end if;
  end loop;
 end if;
 if hub.can('knowledge','view') then
  for s in select f.id,f.question_key,v.question,v.state from hub.faqs f join hub.faq_versions v on v.id=f.draft_version_id
   where f.scope_type=kind and f.scope_id=case when kind='project' then p.rem_project_id else ref end
    and v.state in ('IN_REVIEW','RETURNED') and hub.workspace_faq_visible(f.id) loop
   tasks:=tasks||jsonb_build_array(jsonb_build_object('code',s.question_key,'label',s.question,'state',s.state,'target',hub.workspace_faq_target(s.id)));
  end loop;
 end if;
 if hub.can('knowledge','view') then
  for s in select w.page_key,v.id,v.payload,v.published_at from hub.web_pages w join hub.entity_versions v on v.id=w.published_version_id
   where w.page_type=kind and w.entity_ref=coalesce(group_ref,ref) order by w.page_key limit 1 loop
   begin
    perform hub.web_assert_sources(s.payload,'view');
    preview:=hub.workspace_target(kind,ref,'overview',jsonb_build_object('section','preview','web_page',s.page_key,'version',s.id));
    published_at:=s.published_at;
   exception when insufficient_privilege then preview:=null;end;
  end loop;
  if kind in ('project','brand','corporate','programme') then
   preview:=hub.workspace_target(kind,ref,'overview',jsonb_build_object('section','preview','phase',p.rem_project_id));
  end if;
 end if;
 if published_at is null and kind='project' then select max(v.published_at) into published_at from hub.projects x join hub.entity_versions v on v.id=x.published_version_id where x.id=any(ids);
 elsif published_at is null and kind='brand' then select v.published_at into published_at from hub.brands b join hub.brand_versions v on v.id=b.published_version_id where b.public_brand_id=ref;end if;
 select coalesce(jsonb_agg(value),'[]') into changes from jsonb_array_elements(hub.content_history(kind,ref,null,50)->'items')
  where published_at is null or (value->>'occurred_at')::timestamptz>published_at;
 return jsonb_build_object('entity',jsonb_build_object('kind',kind,'ref',ref,'name',hub.workspace_name(kind,coalesce(group_ref,ref)),'scope_type',kind,
  'scope_id',case when kind='project' then p.rem_project_id else ref end,'grouping',case when kind='project' then jsonb_build_object(
   'state',case when group_ref is null then 'unconfirmed' else 'confirmed' end,'group_ref',group_ref,
   'review_href',case when group_ref is null and hub.can('knowledge','view') then '/faq?tab=publication' end) end),
  'phases',phases,'selected_phase',p.rem_project_id,'tabs',tabs,'sections',sections,
  'overview',jsonb_build_object('readiness',jsonb_build_object('required',required,'recommended',recommended),'tasks',tasks,'changes_since_publication',changes,'preview_target',preview));
end $$;

-- Every context is resolved from a closed content-table set, then current source access.
create function hub.workspace_history_contexts(table_name text,row_data jsonb) returns setof jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare r jsonb:=row_data;kind text;ref text;tab text;section text;subject uuid;project uuid;ids uuid[];target jsonb;child jsonb;
 f hub.faqs;s hub.content_sections;page hub.web_pages;article_version uuid;faq_scope jsonb;faq_owned boolean:=false;phase_ref text;name text:=replace(table_name,'hub.','');begin
 if row_data is null or table_name not like 'hub.%' then return;end if;
 if name in ('publication_releases','web_publications') then
  if name='publication_releases' then
   for child in select to_jsonb(m) from hub.publication_release_members m where release_id=(r->>'id')::uuid loop
    return query select * from hub.workspace_history_contexts('hub.publication_release_members',child);end loop;
  else
   for child in select value from jsonb_array_elements(coalesce(r->'pages','[]')) loop
    select * into page from hub.web_pages where page_key=child#>>'{snapshot,page_key}';
    if page.id is not null then return query select * from hub.workspace_history_contexts('hub.web_pages',to_jsonb(page));end if;
   end loop;
  end if;return;
 elsif name='publication_release_members' then
  if r->>'entity_type'='project' then select to_jsonb(p) into child from hub.projects p where id=(r->>'entity_id')::uuid;
  elsif r->>'entity_type'='brand' then select to_jsonb(b) into child from hub.brands b where id=(r->>'entity_id')::uuid;
  elsif r->>'entity_type'='promotion' then select to_jsonb(p) into child from hub.public_promotions p where id=(r->>'entity_id')::uuid;end if;
  return query select c||jsonb_build_object('section_key','publication') from hub.workspace_history_contexts(
   case r->>'entity_type' when 'project' then 'hub.projects' when 'brand' then 'hub.brands' when 'promotion' then 'hub.public_promotions' end,child) c;return;
 elsif name in ('web_pages','web_changes') or name='entity_versions' and r->>'entity_type'='web_page' then
  select * into page from hub.web_pages where (name='web_pages' and id=(r->>'id')::uuid)
   or (name='web_changes' and page_key=r->>'page_key') or (name='entity_versions' and id=(r->>'web_page_id')::uuid);
  if page.id is null or not hub.can('knowledge','view') then return;end if;
  if name='entity_versions' then perform hub.web_assert_sources(r->'payload','view');end if;
  if page.page_type='project' then
   for child in select to_jsonb(p) from hub.projects p where p.public_project_id=any(page.project_ids) and p.deleted_at is null loop
    return query select c||jsonb_build_object('section_key','publication') from hub.workspace_history_contexts('hub.projects',child) c;
   end loop;return;
  elsif page.page_type='brand' then kind:='brand';ref:=page.entity_ref;tab:='brands';
  elsif page.page_type='programme' then kind:='programme';ref:=page.entity_ref;tab:='knowledge';
  else kind:='corporate';ref:='sena';tab:='knowledge';end if;section:='publication';
 elsif name in ('projects','model_types','entity_assets','commercial_types','commercial_type_sources','commercial_type_assets','commercial_type_versions',
  'project_facts','project_buildings','project_selling_points','project_facilities','project_features','solar_estimates','project_places',
  'project_prices','project_price_versions','project_disclosures','project_sales_terms','project_programmes','project_progress','project_commercial_versions','entity_versions','website_text_decision',
  'asset_links','media_links','media_link_targets') then
  project:=(case when name='projects' then r->>'id' else r->>'project_id' end)::uuid;kind:='project';tab:='projects';
  select public_project_id into ref from hub.projects where id=project and deleted_at is null;
  if name in ('project_disclosures','project_commercial_versions') and not (hub.can('projects','edit') or hub.can('projects','approve')) then return;end if;
  if name in ('asset_links','media_link_targets') and not hub.media_target(project,r->>'target_type',r->>'target_key','view') then return;end if;
  if name in ('entity_assets','commercial_type_assets','asset_links') and not hub.can_read_asset((r->>'asset_id')::uuid) then return;end if;
  section:=case when name like '%price%' or name like 'commercial_type%' or name='model_types' then 'unit-types'
   when name like '%asset%' or name like 'media_%' then 'media' when name='entity_versions' then 'publication'
   when name='project_facts' then 'facts' when name='project_buildings' then 'buildings' when name='project_selling_points' then 'narrative'
   when name in ('project_facilities','project_features','solar_estimates','project_places') then 'amenities'
   when name='website_text_decision' then r->>'section_key' else 'identity' end;
 elsif name in ('brands','brand_versions','brand_assets') then
  subject:=(case when name='brands' then r->>'id' else r->>'brand_id' end)::uuid;kind:='brand';tab:='brands';
  select public_brand_id into ref from hub.brands where id=subject and deleted_at is null;
  if name='brand_assets' and not hub.can_read_asset((r->>'asset_id')::uuid) then return;end if;
  section:=case when name='brand_assets' then 'media' when name='brand_versions' then 'publication' else 'identity' end;
 elsif name in ('contacts','content_sections','content_section_versions') then
  if name='contacts' then kind:=r->>'scope_type';ref:=r->>'scope_id';section:='contacts';
  else
   select * into s from hub.content_sections where id=(case when name='content_sections' then r->>'id' else r->>'section_id' end)::uuid;
   kind:=case when s.scope_type='rem_project_group' then 'project_group' else s.scope_type end;ref:=s.scope_id;section:=coalesce(s.section_key,'narrative');
   if kind='project' and s.section_key is null then select public_project_id into ref from hub.projects where rem_project_id=s.scope_id and deleted_at is null;end if;
  end if;tab:=hub.content_scope_tab(kind);
 elsif name in ('faqs','faq_versions','faq_sources','faq_intake_decisions') then
  subject:=(case when name='faqs' then r->>'id' else r->>'faq_id' end)::uuid;
  if subject is null and name='faq_intake_decisions' then
   perform hub.faq_intake_cluster((r->>'cluster_id')::uuid);
   for phase_ref in select null::text union select unnest(c.project_ids) from staging.faq_clusters c where c.id=(r->>'cluster_id')::uuid loop
    begin
     target:=hub.workspace_resolve(null,(r->>'cluster_id')::uuid,phase_ref);
     faq_scope:=hub.workspace_faq_scope_access(target->>'level',target->>'id',target->>'phase');
     return next jsonb_build_object('kind',target->>'level','ref',target->>'id','name',faq_scope->'name','source_tab','knowledge','section_key','faq','faq_owned',true,
      'project_ids',array(select (x->>'id')::uuid from jsonb_array_elements(faq_scope->'projects') x),'target',target);
    exception when insufficient_privilege or no_data_found or check_violation then null;end;
   end loop;return;
  end if;
  if subject is null then return;end if;
  target:=hub.workspace_faq_target(subject);kind:=target->>'level';ref:=target->>'id';tab:='knowledge';section:='faq';faq_owned:=true;
 elsif name in ('faq_questions','faq_question_versions') then kind:='corporate';ref:='sena';tab:='knowledge';section:='faq';
 elsif name='content_gaps' then
  select id,public_project_id into project,ref from hub.projects where rem_project_id=r->>'project_id' and deleted_at is null;
  kind:='project';tab:='knowledge';section:='faq';
 elsif name='content_translations' then
  tab:=r->>'source_tab';section:=r->>'field_key';
  if r->>'owner_type'='faq' then target:=hub.workspace_faq_target((r->>'owner_key')::uuid);kind:=target->>'level';ref:=target->>'id';faq_owned:=true;
  elsif r->>'owner_type'='section' then
   select * into s from hub.content_sections where id=(r->>'owner_key')::uuid;kind:=s.scope_type;ref:=s.scope_id;
  elsif tab='projects' then kind:='project';ref:=r->>'scope_id';
  elsif tab='brands' then kind:='brand';ref:=r->>'scope_id';
  elsif r->>'owner_type'='article' then
   select to_jsonb(a) into child from hub.articles a where id=(r#>>'{row_ref,article_id}')::uuid;
   return query select c||jsonb_build_object('section_key',section) from hub.workspace_history_contexts('hub.articles',child) c;return;
  else return;end if;
 elsif name in ('articles','article_versions','article_links') then
  subject:=(case when name='articles' then r->>'id' else r->>'article_id' end)::uuid;
  if not exists(select 1 from hub.articles where id=subject) then return;end if;
  perform hub.article_read(subject);
  article_version:=case when name='article_versions' then (r->>'id')::uuid when name='article_links' then (r->>'version_id')::uuid
   else (select draft_version_id from hub.articles where id=subject) end;
  if jsonb_array_length(hub.article_reference_issues(article_version))>0 or exists(select 1 from hub.article_links l where l.version_id=article_version
   and not hub.content_scope_allowed(l.kind,l.ref,'view')) then return;end if;
  kind:='corporate';ref:='sena';tab:='knowledge';section:='articles';
  select coalesce(array_agg(distinct p.id),'{}') into ids from hub.projects p join hub.article_links l on
   l.kind='project' and l.ref=p.public_project_id or l.kind='brand' and exists(select 1 from hub.brands b where b.id=p.brand_id and b.public_brand_id=l.ref)
   where l.article_id=subject and p.deleted_at is null and hub.content_scope_allowed('project',p.public_project_id,'view');
 elsif name in ('public_promotions','promotion_reviews','promotion_versions') then
  subject:=(case when name='public_promotions' then r->>'id' else r->>'promotion_id' end)::uuid;
  if not hub.can('promotions','view') then return;end if;
  perform hub.promotion_read(subject,'{}');
  select coalesce(array_agg(p.id),'{}') into ids from hub.promotion_target_projects(subject) p where hub.content_scope_allowed('project',p.public_id,'view');
  select p.id,p.public_project_id into project,ref from hub.projects p join hub.public_promotions x on x.project_id=p.id where x.id=subject and p.deleted_at is null;
  kind:=case when project is null then 'corporate' else 'project' end;ref:=coalesce(ref,'sena');tab:='promotions';section:='promotions';
 elsif name in ('assets','asset_media_tags','knowledge_asset_links') then
  subject:=(case when name='assets' then r->>'id' else r->>'asset_id' end)::uuid;
  if not hub.can_read_asset(subject) then return;end if;
  select p.id,p.public_project_id into project,ref from hub.projects p where p.deleted_at is null and hub.content_scope_allowed('project',p.public_project_id,'view') and
   (exists(select 1 from hub.entity_assets a where a.project_id=p.id and a.asset_id=subject and a.deleted_at is null)
    or exists(select 1 from hub.asset_links a where a.project_id=p.id and a.asset_id=subject and a.deleted_at is null and hub.media_target(p.id,a.target_type,a.target_key,'view'))
    or exists(select 1 from hub.commercial_type_assets a where a.project_id=p.id and a.asset_id=subject and a.deleted_at is null)) order by p.public_project_id limit 1;
  if project is not null then kind:='project';tab:='projects';
  else select b.public_brand_id into ref from hub.brands b join hub.brand_assets a on a.brand_id=b.id
   where a.asset_id=subject and a.deleted_at is null and b.deleted_at is null and hub.content_scope_allowed('brand',b.public_brand_id,'view') order by b.public_brand_id limit 1;
   kind:='brand';tab:='brands';end if;section:='media';
 elsif name='entity_aliases' then
  kind:=case r->>'entity_type' when 'rem_project_group' then 'project_group' else r->>'entity_type' end;ref:=r->>'entity_id';tab:='knowledge';section:='identity';
  if kind='project' then select public_project_id into ref from hub.projects where rem_project_id=ref and deleted_at is null;end if;
 elsif name='knowledge_fact_candidates' then
  for child in select to_jsonb(p) from hub.projects p where r->'project_ids' ? p.rem_project_id and p.deleted_at is null and hub.can('knowledge','view') loop
   return query select c||jsonb_build_object('source_tab','knowledge','section_key','facts') from hub.workspace_history_contexts('hub.projects',child) c;end loop;return;
 else return;end if;
 if ref is null or not hub.can(tab,'view') then return;end if;
 if faq_owned then
  faq_scope:=hub.workspace_faq_scope_access(kind,ref);
  ids:=array(select (x->>'id')::uuid from jsonb_array_elements(faq_scope->'projects') x);
 else
  if not hub.content_scope_allowed(kind,ref,'view') then return;end if;
  ids:=coalesce(ids,hub.workspace_projects(kind,ref));
 end if;
 return next jsonb_build_object('kind',kind,'ref',ref,'name',case when faq_owned then faq_scope->'name' else hub.workspace_name(kind,ref) end,
  'source_tab',tab,'section_key',section,'faq_owned',faq_owned,
  'project_ids',ids,'target',coalesce(target,hub.workspace_target(kind,ref,'history',jsonb_build_object('section',section,'item',r->>'id'))));
exception when insufficient_privilege or no_data_found then return;
end $$;

-- Explicit per-table field lists: nested snapshots never escape as raw payloads.
create function hub.workspace_history_fields(table_name text,value jsonb) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare name text:=replace(table_name,'hub.','');keys text[];result jsonb;payload jsonb;begin
 if value is null then return null;end if;
 keys:=case
 when name in ('projects','brands','model_types') then array['public_name','description','address','ad_disclaimer','slug','status','meta_title','meta_description','short_description','website_content',
  'latitude','longitude','bedrooms','bathrooms','usable_area_sqm','parking_spaces','match_status','effective_from','effective_to','deleted_at','published_version_id']
 when name in ('content_sections','content_section_versions') then array['section_key','title','body','summary','state','source_ref','source_url','ai_exposure','version_no','revision']
 when name in ('faqs','faq_versions') then array['question_key','scope_type','scope_id','question','canonical_question','alt_questions','short_answer','detail','answer_kind','fact_keys','state','review_due','effective_to','ai_exposure','version_no','revision']
 when name in ('faq_questions','faq_question_versions') then array['question_key','topic','question_template','alt_questions','answer_kind','fact_keys','property_types','default_level','is_core','show_on_project_pages','status','revision']
 when name='faq_sources' then array['source_url','source_ref']
 when name='faq_intake_decisions' then array['decision','hold_code','note','question_key','faq_version_no']
 when name='content_gaps' then array['question_key','gap_code','state','missing_fact_keys','revision']
 when name='contacts' then array['channel','value','url','label','is_primary','sort','ai_exposure','revision']
 when name='project_facts' then array['fact_key','grain','value_text','value_number','value_bool','value_date','value_list','unit','source','rem_value','rem_as_of','override_reason','basis','as_of','valid_to','ai_exposure','revision']
 when name='project_buildings' then array['building_key','name','floors_above','has_rooftop','skip_floors','unit_count','source','source_ref','source_as_of','revision']
 when name='project_selling_points' then array['point_key','title','detail','icon_code','linked_feature_code','linked_fact_keys','sort','state','ai_exposure','revision']
 when name='commercial_types' then array['public_name','description','product_form','area_min_sqm','area_max_sqm','bedrooms','bathrooms','kitchens','storeys','parking_spaces','land_area_sqm','highlights','state','source_notes','revision']
 when name='commercial_type_sources' then array['model_id','link_kind','classification_status']
 when name in ('project_facilities','project_features','solar_estimates','project_places') then array['facility_code','feature_code','status','display_name','description','location_label','size_sqm','opening_hours','state','name','category','latitude','longitude','distance_km','duration_minutes','sort','as_of','monthly_saving','annual_saving','revision']
 when name='project_prices' then array['kind','amount','display_text','basis','condition_text','valid_from','valid_to','state','revision']
 when name in ('project_disclosures','project_sales_terms','project_programmes','project_progress') then
  hub.project_commercial_fields(case name when 'project_disclosures' then 'disclosures' when 'project_sales_terms' then 'sales-terms' when 'project_programmes' then 'programmes' else 'construction' end)||array['state','revision']
 when name='content_translations' then array['field_key','entered_en','reviewed_en','translation_state','th_version','en_from_th_version','revision']
 when name in ('assets','asset_media_tags') then array['original_filename','mime_type','rights_status','alt_text','caption','credit','media_category','tags','tag_code','effective_from','effective_to','revision','deleted_at']
 when name in ('entity_assets','brand_assets','commercial_type_assets','asset_links','knowledge_asset_links','media_link_targets') then array['asset_id','asset_role','alt_text','title','floor_label','plan_revision','display_order','target_type','target_key','usage','is_primary','building_key','floor_from','floor_to','room_tag','effective_from','effective_to','ai_exposure','revision','deleted_at']
 when name='media_links' then array['provider','kind','tour_kind','url','title','description','captured_at','duration_sec','aspect','language','subtitles','channel_name','owner_type','is_sponsored','is_featured','sort','state','ai_exposure','revision']
 when name in ('articles','article_versions') then array['slug','category','title','excerpt','seo_title','seo_description','author','tags','blocks','state','ai_exposure','version_no','revision']
 when name='article_links' then array['kind','ref']
 when name in ('public_promotions','promotion_versions') then array['title','summary','conditions_public','legal_terms','disclaimer','audience','starts_at','ends_at','booking_from','booking_to','transfer_from','transfer_to','state','revision','version_no']
 when name='promotion_reviews' then array['review_revision','review_type','decision','evidence','change_reason']
 when name in ('publication_releases','publication_release_members','web_pages','web_publications','web_changes','entity_versions','brand_versions','commercial_type_versions','project_price_versions','project_commercial_versions') then
  array['version_no','revision','kind','state','status','operation','url','locales','ai_policy','max_faq_items','published_version_id','before_version_id','after_version_id','change_reason','reason','rollback_reason']
 when name='website_text_decision' then array['decision','section_key','source_url','version_no']
 when name='entity_aliases' then array['alias','locale','status']
 when name='knowledge_fact_candidates' then array['fact_key','value_text','value_number','unit','as_of','valid_from','valid_to','status']
 else '{}'::text[] end;
 select coalesce(jsonb_object_agg(k,v),'{}') into result from jsonb_each(value) x(k,v) where k=any(keys);
 if name in ('entity_versions','brand_versions') and value ? 'payload' and coalesce(value->>'entity_type','project')<>'web_page' then
  payload:=case when name='entity_versions' then hub.project_permission_projection(value->'payload') else hub.asset_permission_projection(value->'payload') end;
  select coalesce(jsonb_object_agg(k,v),'{}') into payload from jsonb_each(payload) x(k,v) where k in ('public_name','description','address','ad_disclaimer','slug','status','meta_title','meta_description','short_description');
  result:=result||jsonb_build_object('snapshot',payload);
 elsif name='faq_question_versions' and value ? 'payload' then
  result:=result||jsonb_build_object('snapshot',hub.workspace_history_fields('hub.faq_questions',value->'payload'));
 elsif name in ('commercial_type_versions','project_price_versions','project_commercial_versions') and value ? 'payload' then
  result:=result||jsonb_build_object('snapshot',hub.workspace_history_fields(case name when 'commercial_type_versions' then 'hub.commercial_types' when 'project_price_versions' then 'hub.project_prices'
   else 'hub.'||hub.project_commercial_table(value->>'kind') end,value->'payload'));
 end if;
 return result;
end $$;

create function hub.workspace_history_action(event audit.change_log) returns text language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare before_state text:=upper(coalesce(event.before_row->>'state',event.before_row->>'status',event.before_row->>'rights_status',event.before_row->>'decision',''));
 after_state text:=upper(coalesce(event.after_row->>'state',event.after_row->>'status',event.after_row->>'rights_status',event.after_row->>'decision',''));
 self_approved boolean:=coalesce(event.after_row->>'self_approved'='true' or event.after_row->'editors' ? (event.after_row->>'approved_by'),false);begin
 if event.table_name='hub.web_changes' then return case event.after_row->>'operation' when 'rollback' then 'rollback' when 'withdraw' then 'withdraw' else 'publish' end;end if;
 if event.table_name in ('hub.entity_versions','hub.brand_versions','hub.promotion_versions','hub.publication_release_members') and event.operation='INSERT' then return 'publish';end if;
 if event.table_name in ('hub.projects','hub.brands') and event.operation='UPDATE'
  and event.before_row->>'published_version_id' is distinct from event.after_row->>'published_version_id' then
  if event.after_row->>'published_version_id' is null then return 'withdraw';end if;
  -- A new publication always creates a new version. Re-selecting an earlier
  -- persisted publication pointer is rollback evidence, without timestamp inference.
  if exists(select 1 from audit.change_log prior where prior.id<event.id and prior.table_name=event.table_name
   and prior.after_row->>'id'=event.after_row->>'id' and prior.after_row->>'published_version_id'=event.after_row->>'published_version_id') then return 'rollback';end if;
  return 'publish';
 end if;
 if after_state<>before_state then
  if after_state='IN_REVIEW' then return 'submit';
  elsif after_state in ('APPROVED','APPROVE') then return case when self_approved then 'self_approve' else 'approve' end;
  elsif after_state in ('RETURNED','REJECTED') then return 'return';
  elsif after_state in ('WITHDRAWN','REVOKED') then return 'withdraw';
  elsif after_state='ROLLED_BACK' then return 'rollback';
  elsif after_state='PUBLISHED' then return 'publish';end if;
 end if;
 if event.after_row->>'approved_by' is not null and event.before_row->>'approved_by' is distinct from event.after_row->>'approved_by' then
  return case when self_approved then 'self_approve' else 'approve' end;end if;
 return 'edit';
end $$;
create function hub.workspace_history_visible(event audit.change_log) returns boolean language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare before_fields jsonb:=hub.workspace_history_fields(event.table_name,event.before_row);
 after_fields jsonb:=hub.workspace_history_fields(event.table_name,event.after_row);action text:=hub.workspace_history_action(event);begin
 -- Parent pointer/state mirrors have their own immutable-version event.
 if event.operation='UPDATE' and event.table_name in ('hub.faqs','hub.content_sections','hub.articles')
  and before_fields-array['state','revision'] is not distinct from after_fields-array['state','revision'] then return false;end if;
 if event.operation='UPDATE' and event.table_name in ('hub.projects','hub.brands') and action='publish'
  and before_fields-'published_version_id' is not distinct from after_fields-'published_version_id' then return false;end if;
 return before_fields is distinct from after_fields or action<>'edit';
end $$;
create function hub.workspace_history_event(event audit.change_log,context jsonb,detail boolean default false) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare old_fields jsonb:=hub.workspace_history_fields(event.table_name,event.before_row);new_fields jsonb:=hub.workspace_history_fields(event.table_name,event.after_row);
 changed jsonb;result jsonb;begin
 select coalesce(jsonb_agg(k order by k),'[]') into changed from (select key k from jsonb_object_keys(coalesce(old_fields,'{}')||coalesce(new_fields,'{}')) key) keys
  where old_fields->k is distinct from new_fields->k;
 result:=jsonb_build_object('audit_id',event.id::text,'occurred_at',event.occurred_at,'actor',hub.workspace_actor(event.actor),'action',hub.workspace_history_action(event),
  'entity',jsonb_build_object('kind',context->>'kind','ref',context->>'ref','name',context->'name'),'source_tab',context->>'source_tab','section_key',context->>'section_key',
  'reason',event.reason,'version',jsonb_build_object('id',coalesce(event.after_row->>'version_id',event.after_row->>'id'),
   'number',coalesce(event.after_row->'version_no',event.after_row->'revision'),'state',event.after_row->>'state'),
  'target',context->'target','diff_available',jsonb_array_length(changed)>0);
 if detail then result:=result||jsonb_build_object('before',old_fields,'after',new_fields,'changed_field_keys',changed);end if;
 return result;
end $$;
create function hub.workspace_history_matches(context jsonb,kind text,ref text) returns boolean language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare p uuid;begin
 if (not hub.content_scope_allowed(kind,ref,'view') or kind='unit_type' and not exists(select 1 from hub.commercial_types c join hub.projects x on x.id=c.project_id
  where c.id::text=ref and c.deleted_at is null and hub.content_scope_allowed('project',x.public_project_id,'view')))
  and not coalesce((context->>'faq_owned')::boolean,false) then return false;end if;
 if context->>'kind'=kind and context->>'ref'=ref then return true;end if;
 if kind='project' then
  select id into p from hub.projects where public_project_id=ref and deleted_at is null;
  return context->'project_ids' ? p::text;
 end if;return false;
end $$;
create function hub.content_history(kind text,ref text,before_id bigint default null,page_size integer default 50) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare rows jsonb;begin
 if not hub.content_scope_allowed(kind,ref,'view') then perform hub.workspace_faq_scope_access(kind,ref);end if;
 if page_size is null or page_size not between 1 and 100 or before_id<=0 then raise exception 'Invalid history page' using errcode='23514';end if;
 select coalesce(jsonb_agg(item order by id desc),'[]') into rows from (
  select l.id,hub.workspace_history_event(l,c) item from audit.change_log l
  join lateral (select distinct on (x->>'kind',x->>'ref') x c from hub.workspace_history_contexts(l.table_name,coalesce(l.after_row,l.before_row)) x
   where hub.workspace_history_matches(x,kind,ref) limit 1) contexts on true
  where (before_id is null or l.id<before_id) and hub.workspace_history_visible(l)
  order by l.id desc limit page_size+1) events;
 return jsonb_build_object('items',case when jsonb_array_length(rows)>page_size then rows-(jsonb_array_length(rows)-1) else rows end,
  'next_cursor',case when jsonb_array_length(rows)>page_size then rows->(page_size-1)->>'audit_id' end);
end $$;
create function hub.content_history_event(kind text,ref text,event_id bigint) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare event audit.change_log;context jsonb;begin
 if not hub.content_scope_allowed(kind,ref,'view') then perform hub.workspace_faq_scope_access(kind,ref);end if;
 select * into event from audit.change_log where id=event_id;
 select value into context from hub.workspace_history_contexts(event.table_name,coalesce(event.after_row,event.before_row)) value
  where hub.workspace_history_matches(value,kind,ref) limit 1;
 if context is null or not hub.workspace_history_visible(event) then raise exception 'History event not found' using errcode='P0002';end if;
 return hub.workspace_history_event(event,context,true);
end $$;
create function hub.content_activity(filters jsonb default '{}',before_id bigint default null,page_size integer default 50) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare rows jsonb;project uuid;begin
 perform hub.workspace_admin();perform hub.workspace_require();
 if jsonb_typeof(filters)<>'object' or filters-array['actor_id','project','rem_bu_id','date_from','date_to']<>'{}'
 or page_size is null or page_size not between 1 and 100 or before_id<=0
 or (filters->>'date_from')::timestamptz>(filters->>'date_to')::timestamptz then raise exception 'Invalid activity filters' using errcode='23514';end if;
 if filters ? 'project' then
  perform hub.content_scope_access('project',filters->>'project','view');select id into project from hub.projects where public_project_id=filters->>'project';end if;
 select coalesce(jsonb_agg(item order by id desc),'[]') into rows from (
  select l.id,hub.workspace_history_event(l,c) item from audit.change_log l
  join lateral (select value c from hub.workspace_history_contexts(l.table_name,coalesce(l.after_row,l.before_row)) value
   where (project is null or value->'project_ids' ? project::text)
   and (not filters?'rem_bu_id' or exists(select 1 from hub.workspace_project_bu() b where b.rem_bu_id=filters->>'rem_bu_id' and value->'project_ids' ? b.project_id::text))
   order by value->>'kind',value->>'ref' limit 1) contexts on true
  where (before_id is null or l.id<before_id) and (not filters?'actor_id' or l.actor=(filters->>'actor_id')::uuid)
  and (not filters?'date_from' or l.occurred_at>=(filters->>'date_from')::timestamptz)
  and (not filters?'date_to' or l.occurred_at<=(filters->>'date_to')::timestamptz)
  and hub.workspace_history_visible(l)
  order by l.id desc limit page_size+1) events;
 return jsonb_build_object('items',case when jsonb_array_length(rows)>page_size then rows-(jsonb_array_length(rows)-1) else rows end,
  'next_cursor',case when jsonb_array_length(rows)>page_size then rows->(page_size-1)->>'audit_id' end);
end $$;

do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub'
  and (p.proname in ('workspace_admin','workspace_target','workspace_actor','workspace_confirmed_groups','workspace_projects','workspace_name','workspace_phase',
   'workspace_tree','workspace_page','workspace_preview','workspace_faq','workspace_faq_scope_access','workspace_faq_scope_allowed','workspace_faq_target','workspace_faq_visible','workspace_faq_impact','workspace_field_target','workspace_resolve',
   'workspace_legacy_faq_candidates','workspace_history_contexts','workspace_history_fields','workspace_history_action','workspace_history_visible','workspace_history_event','workspace_history_matches',
   'content_history','content_history_event','content_activity','website_text_key','website_text_numeric','website_text_latest','website_text_decide','content_scope_allowed')) loop
  execute format('revoke all on function %s from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer',f);
 end loop;
end $$;
grant execute on function hub.workspace_tree(text,text,text,text,integer),hub.workspace_page(text,text,text),hub.workspace_faq(text,text,text,text,text,integer,text),
 hub.workspace_preview(text,text,text,text),
 hub.workspace_resolve(uuid,uuid,text),hub.workspace_legacy_faq_candidates(uuid[]),hub.content_history(text,text,bigint,integer),hub.content_history_event(text,text,bigint),
 hub.content_activity(jsonb,bigint,integer),hub.website_text_decide(text,uuid,bigint,text,integer,jsonb,text) to hub_app;
commit;
