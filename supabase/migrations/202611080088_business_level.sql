-- W5: fixed business references and additive brand membership. Existing content,
-- versions, publication history, accounts, grants and templates are untouched.
begin;

create table hub.businesses (
 code text primary key check(code ~ '^[a-z][a-z0-9_]{1,63}$'),
 label jsonb not null check(hub.content_locales(label,200,true))
);
create table hub.brand_business (
 brand_id uuid primary key references hub.brands(id),
 business_code text not null references hub.businesses(code),
 created_at timestamptz not null default clock_timestamp()
);
alter table hub.businesses enable row level security;
alter table hub.businesses force row level security;
alter table hub.brand_business enable row level security;
alter table hub.brand_business force row level security;
create policy business_owner on hub.businesses to current_user using(true) with check(true);
create policy business_owner on hub.brand_business to current_user using(true) with check(true);
revoke all on hub.businesses,hub.brand_business from public,hub_app,viewer,editor,publisher,admin,online_staff,agency,service_consumer;
create trigger business_audit after insert or update or delete on hub.businesses for each row execute function audit.record_change();
create trigger business_audit after insert or update or delete on hub.brand_business for each row execute function audit.record_change();
insert into hub.businesses(code,label) values('residential',jsonb_build_object('th','ที่อยู่อาศัย','en','Residential'));
insert into hub.brand_business(brand_id,business_code) select id,'residential' from hub.brands where deleted_at is null;

-- Closed creation hook; neither catalog nor relationship has a mutation RPC.
create function hub.business_assign_brand() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 insert into hub.brand_business(brand_id,business_code) values(new.id,'residential');return new;
end $$;
create trigger business_assign after insert on hub.brands for each row execute function hub.business_assign_brand();

create function hub.business_references() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.workspace_require();
 if not(hub.can('knowledge','view') or hub.can('brands','view') or hub.can('projects','view')) then
  raise exception 'Content view required' using errcode='42501';end if;
 return jsonb_build_object('items',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'label',label) order by code),'[]') from hub.businesses));
end $$;

-- Pure membership is never applicability and never grants descendant access.
create function hub.business_project_matches(code text,rem_id text) returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from hub.projects p join hub.brands b on b.id=p.brand_id and b.deleted_at is null
  join hub.brand_business m on m.brand_id=b.id where p.deleted_at is null and p.rem_project_id=rem_id and m.business_code=code)
$$;
create function hub.faq_scope_rank(kind text) returns integer language sql immutable set search_path=pg_catalog,pg_temp as $$
 select case kind when 'unit_type' then 7 when 'project' then 6 when 'project_group' then 5 when 'programme' then 4
  when 'brand' then 3 when 'business' then 2 when 'corporate' then 1 else 0 end
$$;

alter table hub.contacts drop constraint contacts_scope_type_check;
alter table hub.contacts add constraint contacts_scope_type_check check(scope_type in ('project','brand','business','corporate'));
alter table hub.content_sections drop constraint content_sections_scope_type_check;
alter table hub.content_sections add constraint content_sections_scope_type_check check(scope_type in ('corporate','business','brand','rem_project_group','project_group','project','unit_type','programme'));
alter table hub.faq_questions drop constraint faq_questions_default_level_check;
alter table hub.faq_questions add constraint faq_questions_default_level_check check(default_level in ('corporate','business','brand','programme','project_group','project','unit_type'));
alter table staging.faq_clusters drop constraint faq_clusters_suggested_level_check;
alter table staging.faq_clusters add constraint faq_clusters_suggested_level_check check(suggested_level in ('corporate','business','brand','programme','project_group','project','unit_type'));
alter table hub.web_pages drop constraint web_pages_page_type_check;
alter table hub.web_pages add constraint web_pages_page_type_check check(page_type in ('project','brand','business','programme','corporate','article','location'));

-- Every predecessor edit is finite and fails replay if its reviewed anchor moved.
-- Existing ACLs and W3/W4 guard additions survive CREATE OR REPLACE.
-- Normalize CRLF in older stored bodies before exact multiline anchor checks.

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.content_scope_tab(text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$('corporate','programme','project_group','unit_type')$old$,$new$('corporate','business','programme','project_group','unit_type')$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.content_scope_access(text,text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$or kind='corporate' and ref='sena'$old$,$new$or kind='business' and exists(select 1 from hub.businesses where code=ref)
 or kind='corporate' and ref='sena'$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.content_scope_allowed(text,text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$('project','brand','corporate','programme','project_group','unit_type')$old$,$new$('project','brand','business','corporate','programme','project_group','unit_type')$new$);
 execute d;
end $$;

-- A nonempty business rule is intersected with actual membership; an empty rule still matches nothing.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.faq_rule_projects(jsonb,text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$('corporate','brand','project_group','programme')$old$,$new$('corporate','business','brand','project_group','programme')$new$);
 d:=hub.content_definition_replace(d,$old$if kind='corporate' and ref<>'sena'$old$,$new$if kind='business' and not exists(select 1 from hub.businesses where code=ref)
  or kind='corporate' and ref<>'sena'$new$);
 d:=hub.content_definition_replace(d,$old$and (kind<>'brand' or b.public_brand_id=ref)$old$,$new$and (kind<>'business' or hub.business_project_matches(ref,p.rem_project_id))
  and (kind<>'brand' or b.public_brand_id=ref)$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.faq_applicability_preview(jsonb,text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$and (kind<>'brand' or b.public_brand_id=ref)$old$,$new$and (kind<>'business' or hub.business_project_matches(ref,p.rem_project_id))
    and (kind<>'brand' or b.public_brand_id=ref)$new$);
 execute d;
end $$;

-- Manual phase selections are explicit too, and cannot name a project outside the business.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.save_faq(uuid,integer,jsonb)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$('corporate','brand','programme','project_group','project','unit_type')$old$,$new$('corporate','business','brand','programme','project_group','project','unit_type')$new$);
 d:=hub.content_definition_replace(d,$old$if kind='corporate' and ref<>'sena'$old$,$new$if kind='business' and not exists(select 1 from hub.businesses where code=ref)
  or kind='corporate' and ref<>'sena'$new$);
 d:=hub.content_definition_replace(d,$old$if body->>'source_url' is not null$old$,$new$if kind='business' and exists(select 1 from unnest(coalesce(edited.applies_to_project_ids,'{}')) rem_id where not hub.business_project_matches(ref,rem_id)) then
  raise exception 'Applicable phase is outside this business' using errcode='23514';end if;
 if body->>'source_url' is not null$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.submit_faq(uuid,integer)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$if f.scope_type<>'corporate' and$old$,$new$if f.scope_type='business' and exists(select 1 from unnest(v.applies_to_project_ids) rem_id where not hub.business_project_matches(f.scope_id,rem_id)) then
   raise exception 'Business membership changed; save and preview again' using errcode='40001';end if;
  if f.scope_type<>'corporate' and$new$);
 execute d;
end $$;

-- Keep the existing corporate question-bank opt-in, explicit phase predicate, conflicts and exact approved/published version selection.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.compose_project_faq(uuid,text,text,boolean,boolean)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$case f.scope_type when 'unit_type' then 6 when 'project' then 5 when 'project_group' then 4 when 'programme' then 3 when 'brand' then 2 else 1 end$old$,$new$hub.faq_scope_rank(f.scope_type)$new$);
 d:=hub.content_definition_replace(d,$old$or f.scope_type='brand' and f.scope_id=brand_ref$old$,$new$or f.scope_type='business' and hub.business_project_matches(f.scope_id,p.rem_project_id)
     or f.scope_type='brand' and f.scope_id=brand_ref$new$);
 d:=hub.content_definition_replace(d,$old$top_rank<5$old$,$new$top_rank<hub.faq_scope_rank('project')$new$);
 execute d;
end $$;

-- Keep the existing corporate question-bank opt-in, explicit phase predicate, conflicts and exact approved/published version selection.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.publication_compose_faq(uuid,text,text,boolean,boolean)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$case f.scope_type when 'unit_type' then 6 when 'project' then 5 when 'project_group' then 4 when 'programme' then 3 when 'brand' then 2 else 1 end$old$,$new$hub.faq_scope_rank(f.scope_type)$new$);
 d:=hub.content_definition_replace(d,$old$or f.scope_type='brand' and f.scope_id=brand_ref$old$,$new$or f.scope_type='business' and hub.business_project_matches(f.scope_id,p.rem_project_id)
     or f.scope_type='brand' and f.scope_id=brand_ref$new$);
 d:=hub.content_definition_replace(d,$old$top_rank<5$old$,$new$top_rank<hub.faq_scope_rank('project')$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.faq_references()'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$return jsonb_build_object(
  'projects'$old$,$new$return jsonb_build_object(
  'businesses',(select coalesce(jsonb_agg(jsonb_build_object('id',code,'name',label->>'th','label',label) order by code),'[]') from hub.businesses),
  'projects'$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_name(text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$when 'brand' then$old$,$new$when 'business' then (select label from hub.businesses where code=ref)
  when 'brand' then$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_projects(text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$or kind='brand' and b.public_brand_id=ref$old$,$new$or kind='business' and hub.business_project_matches(ref,p.rem_project_id)
  or kind='brand' and b.public_brand_id=ref$new$);
 execute d;
end $$;

-- Knowledge-only FAQ uses minimal references, never a Projects View precondition.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_faq_scope_access(text,text,text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$elsif kind='brand' then$old$,$new$elsif kind='business' then select x into entry from jsonb_array_elements(refs->'businesses') x where x->>'id'=ref;
  elsif kind='brand' then$new$);
 d:=hub.content_definition_replace(d,$old$or kind='brand' and b.public_brand_id=ref$old$,$new$or kind='business' and hub.business_project_matches(ref,p.rem_project_id)
    or kind='brand' and b.public_brand_id=ref$new$);
 execute d;
end $$;

-- Only visible business nodes become parents. Brands-only readers retain independent roots; FAQ-only brand children remain minimal references.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_tree(text,text,text,text,integer)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$union all select 'brand',b.public_brand_id,b.public_name,case when hub.content_scope_allowed('corporate','sena','view') then 'corporate' end,
   case when hub.content_scope_allowed('corporate','sena','view') then 'sena' end,0,'unconfirmed',false,b.rem_brand_id from hub.brands b$old$,$new$union all select 'business',code,label,'corporate','sena',0,'unconfirmed',false,code from hub.businesses where hub.content_scope_allowed('business',code,'view')
  union all select 'brand',b.public_brand_id,b.public_name,case when hub.content_scope_allowed('business',m.business_code,'view') then 'business'
    when hub.content_scope_allowed('corporate','sena','view') then 'corporate' end,
   case when hub.content_scope_allowed('business',m.business_code,'view') then m.business_code
    when hub.content_scope_allowed('corporate','sena','view') then 'sena' end,0,'unconfirmed',false,b.rem_brand_id from hub.brands b left join hub.brand_business m on m.brand_id=b.id$new$);
 d:=hub.content_definition_replace(d,$old$union all select 'brand',b.public_brand_id,jsonb_build_object('th',x->>'name'),null,null,0,'unconfirmed',true,b.public_brand_id
   from hub.brands b join lateral$old$,$new$union all select 'brand',b.public_brand_id,jsonb_build_object('th',x->>'name'),
   case when hub.content_scope_allowed('business',m.business_code,'view') then 'business' end,
   case when hub.content_scope_allowed('business',m.business_code,'view') then m.business_code end,0,'unconfirmed',true,b.public_brand_id
   from hub.brands b left join hub.brand_business m on m.brand_id=b.id join lateral$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_search(text,integer)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$select distinct 'bud',$old$,$new$select 'business',code,label,code,jsonb_build_object('scope_type','business','scope_id',code) from hub.businesses
   where hub.content_scope_allowed('business',code,'view') and position(needle in lower(code||' '||label::text))>0
   union all
   select distinct 'bud',$new$);
 d:=hub.content_definition_replace(d,$old$when 'bud' then 3 else 4 end kind_order$old$,$new$when 'bud' then 3 when 'business' then 4 else 5 end kind_order$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_scope_matches(text,text,text[],text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$or kind='brand' and ref=b.public_brand_id$old$,$new$or kind='business' and hub.business_project_matches(ref,p.rem_project_id)
    or kind='brand' and ref=b.public_brand_id$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_faq_impact(uuid)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$-- Match the existing corporate composition opt-in$old$,$new$if f.scope_type='business' then ids:=array(select rem_id from unnest(ids) rem_id where hub.business_project_matches(f.scope_id,rem_id));end if;
 -- Match the existing corporate composition opt-in$new$);
 execute d;
end $$;

create function hub.business_cluster_matches(code text,projects text[],brands text[]) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from unnest(projects) rem_id where hub.business_project_matches(code,rem_id))
  or exists(select 1 from hub.brands b join hub.brand_business m on m.brand_id=b.id
   where b.deleted_at is null and b.rem_brand_id=any(brands) and m.business_code=code)
$$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_resolve(uuid,uuid,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$if kind='corporate' then ref:='sena';$old$,$new$if kind='business' then
  select min(code) into ref from hub.businesses where hub.business_cluster_matches(code,case when p.id is null then c.project_ids else array[p.rem_project_id] end,c.brand_ids) having count(*)=1;
  if ref is null then raise exception 'Cluster requires an explicit existing business context' using errcode='23514';end if;
 elsif kind='corporate' then ref:='sena';$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_faq(text,text,text,text,text,integer,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$case x.scope_type when 'project' then 5 when 'project_group' then 4 when 'programme' then 3 when 'brand' then 2 else 1 end priority$old$,$new$hub.faq_scope_rank(x.scope_type) priority$new$);
 d:=hub.content_definition_replace(d,$old$or x.scope_type='brand' and kind in$old$,$new$or x.scope_type='business' and kind in ('brand','programme','project_group','project','unit_type')
      and exists(select 1 from hub.projects bp where bp.id=any(scope_ids) and hub.business_project_matches(x.scope_id,bp.rem_project_id))
     or x.scope_type='brand' and kind in$new$);
 d:=hub.content_definition_replace(d,$old$and (scope_kind='corporate' or scope_kind='brand' and exists(select 1 from hub.brands b where b.public_brand_id=ref and b.rem_brand_id=any(c.brand_ids))$old$,$new$and (scope_kind='business' and hub.business_cluster_matches(ref,c.project_ids,c.brand_ids) or scope_kind='corporate' or scope_kind='brand' and exists(select 1 from hub.brands b where b.public_brand_id=ref and b.rem_brand_id=any(c.brand_ids))$new$);
 d:=hub.content_definition_replace(d,$old$and (scope_kind='corporate' or scope_kind='brand' and exists(select 1 from hub.brands b where b.public_brand_id=ref and b.rem_brand_id=any(x.brand_ids))$old$,$new$and (scope_kind='business' and hub.business_cluster_matches(ref,x.project_ids,x.brand_ids) or scope_kind='corporate' or scope_kind='brand' and exists(select 1 from hub.brands b where b.public_brand_id=ref and b.rem_brand_id=any(x.brand_ids))$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_preview(text,text,text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$('project','brand','corporate','programme')$old$,$new$('project','brand','business','corporate','programme')$new$);
 d:=hub.content_definition_replace(d,$old$'issues',hub.web_issues(snapshot)$old$,
  $new$'resolved_applicability',coalesce((select jsonb_agg(distinct jsonb_build_object('question_key',n->>'question_key','rem_project_ids',n->'resolved_project_ids'))
    from hub.web_nodes(snapshot) n where n ? '_faq' and n ? 'resolved_project_ids'),'[]'),
  'issues',hub.web_issues(snapshot)$new$);
 execute d;
end $$;

-- Business pages reuse existing section/contact editors and carry no invented required fields.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_page(text,text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$if kind in ('project','brand','corporate') then tabs$old$,$new$if kind in ('project','brand','business','corporate') then tabs$new$);
 d:=hub.content_definition_replace(d,$old$if kind in ('project','brand','corporate','programme') then$old$,$new$if kind in ('project','brand','business','corporate','programme') then$new$);
 execute d;
end $$;

-- The bounded own-scope inventory automatically selects business sections, contacts and FAQ; inherited or descendant drafts stay excluded.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.content_workflow_items(text,text,text,text,integer)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$('corporate','brand','project','programme','project_group','unit_type')$old$,$new$('corporate','business','brand','project','programme','project_group','unit_type')$new$);
 execute d;
end $$;

-- A business FAQ has its own Knowledge-owned shared page; descendant Projects
-- View is not a prerequisite for an otherwise eligible publication task.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.publication_task_native_ready(text,jsonb,jsonb)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,
  $old$if scope in ('brand','corporate','programme') then nodes:=hub.web_scope_faq(scope,source->>'scope_id');$old$,
  $new$if scope in ('brand','business','corporate','programme') then nodes:=hub.web_scope_faq(scope,source->>'scope_id');$new$);
 execute d;
end $$;

-- New catalog/association changes use audit.change_log. Relation history requires the current brand View; no account data or raw relationship payload escapes.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_history_contexts(text,jsonb)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$elsif page.page_type='programme' then$old$,$new$elsif page.page_type='business' then kind:='business';ref:=page.entity_ref;tab:='knowledge';
   elsif page.page_type='programme' then$new$);
 d:=hub.content_definition_replace(d,$old$elsif name in ('brands','brand_versions','brand_assets') then$old$,$new$elsif name='businesses' then kind:='business';ref:=r->>'code';tab:='knowledge';section:='identity';
  elsif name='brand_business' then
   select public_brand_id into ref from hub.brands where id=(r->>'brand_id')::uuid and deleted_at is null;
   if not hub.content_scope_allowed('brand',ref,'view') then return;end if;
   return query select c||jsonb_build_object('section_key','business') from hub.workspace_history_contexts('hub.brands',jsonb_build_object('id',r->'brand_id')) c;
   kind:='business';ref:=r->>'business_code';tab:='knowledge';section:='identity';
  elsif name in ('brands','brand_versions','brand_assets') then$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_history_fields(text,jsonb)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$keys:=case
$old$,$new$keys:=case
  when name='businesses' then array['code','label']
  when name='brand_business' then array['business_code']
$new$);
 execute d;
end $$;

-- Shared-page FAQ inheritance uses the same precedence and explicit applicability
-- as project composition. Only the finite caller graph chooses draft vs approved.
-- Approved candidates keep their saved phase set; current rule drift is attached
-- to that exact item rather than silently selecting a different approved scope.
-- The helper returns IDs, not content; its owning readers preserve source guards.
create function hub.business_scope_faq_rows(kind text,ref text,approved_only boolean)
returns table(faq_id uuid,version_id uuid,priority integer) language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare refs jsonb:='[]';begin
 perform hub.require_permission('knowledge','view');
 if kind in ('corporate','business','brand','programme','project_group','project','unit_type') then
  refs:=hub.workspace_faq_scope_access(kind,ref)->'projects';end if;
 return query with candidates as (
  select f.id faq_id,v.id version_id,v.question_key,hub.faq_scope_rank(f.scope_type) priority
  from hub.faqs f join lateral (select * from hub.faq_versions x where x.faq_id=f.id
   and (approved_only and x.state in ('APPROVED','PUBLISHED') or not approved_only and x.id=f.draft_version_id)
   order by x.version_no desc limit 1) v on true
  join hub.faq_questions q on q.question_key=v.question_key and q.status='approved'
  where (approved_only or f.state<>'WITHDRAWN') and v.ai_exposure<>'internal' and q.ai_exposure<>'internal'
   and (f.scope_type=kind and f.scope_id=ref
    or f.scope_type='corporate' and kind in ('business','brand','programme') and
     (cardinality(v.applies_to_project_ids)=0 and v.applicability_rule='{}'
      or exists(select 1 from jsonb_array_elements(refs) x where x->>'rem_project_id'=any(case when not approved_only and v.applicability_rule<>'{}'
       then hub.faq_rule_projects(v.applicability_rule,f.scope_type,f.scope_id) else v.applies_to_project_ids end)))
    or f.scope_type='business' and kind in ('brand','programme') and exists(
     select 1 from jsonb_array_elements(refs) x where hub.business_project_matches(f.scope_id,x->>'rem_project_id')
      and x->>'rem_project_id'=any(case when not approved_only and v.applicability_rule<>'{}' then hub.faq_rule_projects(v.applicability_rule,f.scope_type,f.scope_id) else v.applies_to_project_ids end)))
 ), ranked as(select c.*,max(c.priority) over(partition by c.question_key) top_priority from candidates c)
 select r.faq_id,r.version_id,r.priority from ranked r where r.priority=r.top_priority order by r.question_key,r.faq_id;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.web_source(text,jsonb)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$'field_catalog','content_translations'$old$,$new$'field_catalog','content_translations','businesses'$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.publication_certificate(text,jsonb,jsonb)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$('field_catalog','feature_catalog','facility_taxonomy','content_translations')$old$,$new$('field_catalog','feature_catalog','facility_taxonomy','content_translations','businesses')$new$);
 execute d;
end $$;

-- A prepared business FAQ keeps the exact approved phase set. Recheck only a
-- new publication attempt; retained snapshots keep their immutable evidence.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.publication_dependency_check(jsonb,boolean,boolean)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$if unchanged and dependency->>'hash'$old$,$new$if unchanged and dependency->>'table'='faq_versions'
  and coalesce(source->'applicability_rule','{}')<>'{}'
  and exists(select 1 from hub.faqs f where f.id=(source->>'faq_id')::uuid and f.scope_type='business') then
   if array(select distinct rem_id from jsonb_array_elements_text(source->'applies_to_project_ids') rem_id order by rem_id)
    is distinct from array(select distinct rem_id from unnest(hub.faq_rule_projects(source->'applicability_rule','business',
      (select f.scope_id from hub.faqs f where f.id=(source->>'faq_id')::uuid))) rem_id order by rem_id) then
    raise exception 'Approved business FAQ applicability changed; re-approval is required' using errcode='40001';end if;
  end if;
 if unchanged and dependency->>'hash'$new$);
 execute d;
end $$;

-- Both public approved composition and the separate private first-draft graph validate the fixed business reference.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.web_compose(hub.web_pages)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$perform hub.require_permission('knowledge','view');$old$,$new$perform hub.require_permission('knowledge','view');
 if page.page_type='business' then perform hub.content_scope_access('business',page.entity_ref,'view');
  proof:=jsonb_build_array(hub.web_dependency('businesses',jsonb_build_object('code',page.entity_ref),'knowledge'));end if;$new$);
 d:=hub.content_definition_replace(d,$old$-- Translation reviewers are authors for four-eyes even if their role changes.$old$,$new$if page.page_type='business' then body:=body||jsonb_build_object('business_code',page.entity_ref,'name',(select label from hub.businesses where code=page.entity_ref));end if;
 -- Translation reviewers are authors for four-eyes even if their role changes.$new$);
 execute d;
end $$;

-- Both public approved composition and the separate private first-draft graph validate the fixed business reference.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.content_preview_compose(hub.web_pages)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$perform hub.require_permission('knowledge','view');$old$,$new$perform hub.require_permission('knowledge','view');
 if page.page_type='business' then perform hub.content_scope_access('business',page.entity_ref,'view');
  proof:=jsonb_build_array(hub.web_dependency('businesses',jsonb_build_object('code',page.entity_ref),'knowledge'));end if;$new$);
 d:=hub.content_definition_replace(d,$old$-- Translation reviewers are authors for four-eyes even if their role changes.$old$,$new$if page.page_type='business' then body:=body||jsonb_build_object('business_code',page.entity_ref,'name',(select label from hub.businesses where code=page.entity_ref));end if;
 -- Translation reviewers are authors for four-eyes even if their role changes.$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.web_scope_faq(text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$for r in select f.id identity_id,v.* from hub.faqs f join lateral (select * from hub.faq_versions where faq_id=f.id and state in ('APPROVED','PUBLISHED') order by version_no desc limit 1) v on true
  join hub.faq_questions q on q.question_key=v.question_key and q.status='approved'
  where f.scope_type=kind and f.scope_id=ref and v.ai_exposure<>'internal' and q.ai_exposure<>'internal' order by v.question_key,v.id loop$old$,$new$for r in select f.id identity_id,f.scope_type source_kind,f.scope_id source_ref,v.*
   from hub.business_scope_faq_rows(kind,ref,true) picked join hub.faqs f on f.id=picked.faq_id
   join hub.faq_versions v on v.id=picked.version_id order by v.question_key,v.id loop$new$);
 d:=hub.content_definition_replace(d,$old$name:=coalesce(name,'SENA');$old$,$new$if kind='business' then select coalesce(nullif(label->>locale,''),label->>'th') into name from hub.businesses where code=ref;end if;
   name:=coalesce(name,'SENA');$new$);
 d:=hub.content_definition_replace(d,$old$if r.state not in$old$,$new$if r.source_kind='business' then item:=jsonb_set(item,'{dependencies}',item->'dependencies'||jsonb_build_array(hub.web_dependency('businesses',jsonb_build_object('code',r.source_ref),'knowledge')));end if;
   if r.state not in$new$);
 d:=hub.content_definition_replace(d,$old$'reviewed_facts','{"th":[],"en":[]}'::jsonb,'data',data$old$,
  $new$'reviewed_facts','{"th":[],"en":[]}'::jsonb,'resolved_project_ids',to_jsonb(r.applies_to_project_ids),'data',data$new$);
 d:=hub.content_definition_replace(d,$old$items:=items||jsonb_build_array(item);$old$,$new$if r.applicability_rule<>'{}' and
    array(select distinct rem_id from unnest(r.applies_to_project_ids) rem_id order by rem_id) is distinct from
    array(select distinct rem_id from unnest(hub.faq_rule_projects(r.applicability_rule,r.source_kind,r.source_ref)) rem_id order by rem_id) then
   item:=jsonb_set(item,'{_issues}',coalesce(item->'_issues','[]')||'[{"code":"faq_applicability_changed"}]'::jsonb);end if;
  items:=items||jsonb_build_array(item);$new$);
 d:=hub.content_definition_replace(d,$old$(select count(*) from hub.faqs f where f.scope_type=kind and f.scope_id=ref and f.question_key=r.question_key and exists(select 1 from hub.faq_versions approved where approved.faq_id=f.id and approved.state in ('APPROVED','PUBLISHED')))>1$old$,$new$(select count(*) from hub.business_scope_faq_rows(kind,ref,true) picked join hub.faq_versions fv on fv.id=picked.version_id where fv.question_key=r.question_key)>1$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.content_preview_scope_faq(text,text)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$for r in select f.id identity_id,v.* from hub.faqs f join hub.faq_versions v on v.id=f.draft_version_id
  join hub.faq_questions q on q.question_key=v.question_key and q.status='approved'
  where f.scope_type=kind and f.scope_id=ref and f.state<>'WITHDRAWN' and v.ai_exposure<>'internal' and q.ai_exposure<>'internal' order by v.question_key,v.id loop$old$,$new$for r in select f.id identity_id,f.scope_type source_kind,f.scope_id source_ref,v.*
   from hub.business_scope_faq_rows(kind,ref,false) picked join hub.faqs f on f.id=picked.faq_id
   join hub.faq_versions v on v.id=picked.version_id order by v.question_key,v.id loop$new$);
 d:=hub.content_definition_replace(d,$old$name:=coalesce(name,'SENA');$old$,$new$if kind='business' then select coalesce(nullif(label->>locale,''),label->>'th') into name from hub.businesses where code=ref;end if;
   name:=coalesce(name,'SENA');$new$);
 d:=hub.content_definition_replace(d,$old$if r.state not in$old$,$new$if r.source_kind='business' then item:=jsonb_set(item,'{dependencies}',item->'dependencies'||jsonb_build_array(hub.web_dependency('businesses',jsonb_build_object('code',r.source_ref),'knowledge')));end if;
   if r.state not in$new$);
 d:=hub.content_definition_replace(d,$old$'reviewed_facts','{"th":[],"en":[]}'::jsonb,'data',data$old$,
  $new$'reviewed_facts','{"th":[],"en":[]}'::jsonb,'resolved_project_ids',to_jsonb(case when r.applicability_rule<>'{}' then hub.faq_rule_projects(r.applicability_rule,r.source_kind,r.source_ref) else r.applies_to_project_ids end),'data',data$new$);
 d:=hub.content_definition_replace(d,$old$items:=items||jsonb_build_array(item);$old$,$new$if r.applicability_rule<>'{}' and
    array(select distinct rem_id from unnest(r.applies_to_project_ids) rem_id order by rem_id) is distinct from
    array(select distinct rem_id from unnest(hub.faq_rule_projects(r.applicability_rule,r.source_kind,r.source_ref)) rem_id order by rem_id) then
   item:=jsonb_set(item,'{_issues}',coalesce(item->'_issues','[]')||'[{"code":"faq_applicability_changed"}]'::jsonb);end if;
  items:=items||jsonb_build_array(item);$new$);
 d:=hub.content_definition_replace(d,$old$(select count(*) from hub.faqs f where f.scope_type=kind and f.scope_id=ref and f.question_key=r.question_key and f.state<>'WITHDRAWN')>1$old$,$new$(select count(*) from hub.business_scope_faq_rows(kind,ref,false) picked join hub.faq_versions fv on fv.id=picked.version_id where fv.question_key=r.question_key)>1$new$);
 execute d;
end $$;

-- Project FAQ evidence pins the business label alongside the exact FAQ version; no existing snapshot is recomposed or rewritten.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.web_faqs(uuid)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$select coalesce(jsonb_agg(d),'[]') into proof$old$,$new$if f.scope_type='business' then deps:=deps||jsonb_build_array(hub.web_dependency('businesses',jsonb_build_object('code',f.scope_id),'knowledge'));end if;
   select coalesce(jsonb_agg(d),'[]') into proof$new$);
 execute d;
end $$;

-- Project FAQ evidence pins the business label alongside the exact FAQ version; no existing snapshot is recomposed or rewritten.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.content_preview_faqs(uuid)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$select coalesce(jsonb_agg(d),'[]') into proof$old$,$new$if f.scope_type='business' then deps:=deps||jsonb_build_array(hub.web_dependency('businesses',jsonb_build_object('code',f.scope_id),'knowledge'));end if;
   select coalesce(jsonb_agg(d),'[]') into proof$new$);
 execute d;
end $$;

-- Exact saved assistant evidence; no new tool, proposal type or write authority.
alter table internal.assistant_citation drop constraint assistant_citation_entity_type_check;
alter table internal.assistant_citation add constraint assistant_citation_entity_type_check
 check(entity_type in ('project','brand','model','promotion','campaign','media_line','memo','naming_rule','business','faq','section'));
create function internal.assistant_saved_source(kind text,ref text,version text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare f hub.faqs;v hub.faq_versions;s hub.content_sections;sv hub.content_section_versions;b hub.businesses;
 target jsonb;fields jsonb;state text;stamp timestamptz;actual text;
 page hub.web_pages;snapshot hub.entity_versions;node jsonb;resolved jsonb;
 source_version text:=version;published boolean:=strpos(version,':')>0;
 today date:=(current_timestamp at time zone 'Asia/Bangkok')::date;
 uuid_pattern text:='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';begin
 perform internal.assistant_require_actor();
 if published then
  if kind not in ('faq','section') or version !~ ('^'||uuid_pattern||':'||uuid_pattern||'$') then
   raise exception 'Invalid published evidence' using errcode='P0002';end if;
  source_version:=split_part(version,':',2);
  select p.* into page from hub.web_pages p where p.published_version_id=split_part(version,':',1)::uuid
   and p.page_type='business' and p.ai_policy<>'no_ai';
  if page.id is null then raise exception 'Published evidence unavailable' using errcode='40001';end if;
  perform hub.content_scope_access('business',page.entity_ref,'view');
  select ev.* into snapshot from hub.entity_versions ev where ev.id=page.published_version_id and ev.web_page_id=page.id;
  if snapshot.payload->>'ai_policy'='no_ai' then raise exception 'Published evidence withheld' using errcode='42501';end if;
  select n into node from hub.web_nodes(snapshot.payload->'body') n
   where (kind='faq' and n ? '_faq' or kind='section' and n ? '_item') and exists(
    select 1 from jsonb_array_elements(coalesce(n->'dependencies','[]')) d
    where d->>'table'=case kind when 'faq' then 'faq_versions' else 'content_section_versions' end
     and d#>>'{identity,id}'=source_version) limit 1;
  if node is null then raise exception 'Source is not in the saved publication' using errcode='P0002';end if;
 end if;
 if kind='business' then
  perform hub.content_scope_access('business',ref,'view');select * into b from hub.businesses where code=ref;
  fields:=to_jsonb(b);actual:=hub.web_hash(fields);state:='REFERENCE';target:=hub.workspace_target('business',ref,'overview');
 elsif kind='faq' then
  perform hub.require_permission('knowledge','view');
  if ref !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'FAQ not found' using errcode='P0002';end if;
  perform hub.faq_read(ref::uuid);select * into f from hub.faqs where id=ref::uuid;
  target:=hub.workspace_faq_target(f.id);perform hub.workspace_faq_scope_access(target->>'level',target->>'id');
  select fv.* into v from hub.faq_versions fv where fv.faq_id=f.id and fv.state<>'WITHDRAWN'
   and (published and fv.id::text=source_version or not published and fv.id=f.draft_version_id);
  if v.id is null or f.state='WITHDRAWN' or v.effective_to<today or v.review_due<today
   or v.answer_kind<>'text' or cardinality(v.fact_keys)>0 then raise exception 'FAQ evidence unavailable' using errcode='P0002';end if;
  if v.ai_exposure<>'open' or not exists(select 1 from hub.faq_questions q where q.question_key=v.question_key
   and q.status='approved' and q.ai_exposure='open' and q.answer_kind='text') then
   raise exception 'FAQ evidence withheld' using errcode='42501';end if;
  actual:=v.id::text;state:=v.state;stamp:=v.updated_at;
  fields:=jsonb_build_object('question_key',v.question_key,'question',v.question,'short_answer',v.short_answer,'detail',v.detail,
   'answer_kind',v.answer_kind,'fact_keys',v.fact_keys,'scope_type',f.scope_type,'scope_id',f.scope_id);
 elsif kind='section' then
  if ref !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Section not found' using errcode='P0002';end if;
  select * into s from hub.content_sections where id=ref::uuid;
  if not found then raise exception 'Section not found' using errcode='P0002';end if;
  perform hub.content_scope_access(s.scope_type,s.scope_id,'view');
  if not hub.section_visible(s.id) then raise exception 'Section forbidden' using errcode='42501';end if;
  select csv.* into sv from hub.content_section_versions csv where csv.section_id=s.id and csv.state<>'WITHDRAWN'
   and (published and csv.id::text=source_version or not published and csv.id=s.draft_version_id);
  if sv.id is null or s.state='WITHDRAWN' then raise exception 'Section evidence unavailable' using errcode='P0002';end if;
  if sv.ai_exposure<>'open' or not exists(select 1 from hub.field_catalog fc where fc.field_key=sv.section_key
   and fc.status='active' and fc.default_ai_exposure='open' and fc.surfaces<>array['hub_only']) then
   raise exception 'Section evidence withheld' using errcode='42501';end if;
  actual:=sv.id::text;state:=sv.state;stamp:=sv.updated_at;
  fields:=jsonb_build_object('section_key',sv.section_key,'title',sv.title,'body',sv.body,'summary',sv.summary,'scope_type',s.scope_type,'scope_id',s.scope_id);
  target:=hub.workspace_field_target(s.scope_type,s.scope_id,s.section_key,jsonb_build_object('item',s.id,'version',sv.id));
 else raise exception 'Unsupported saved source' using errcode='23514';end if;
 if actual is distinct from source_version then raise exception 'Saved evidence changed' using errcode='40001';end if;
 if published then
  resolved:=hub.web_resolve(node,'th',true,false);
  if resolved is null or resolved='null'::jsonb then raise exception 'Published evidence unavailable' using errcode='P0002';end if;
  fields:=case kind when 'faq' then jsonb_build_object('question',resolved->'question','short_answer',resolved->'short_answer','detail',resolved->'detail')
   else jsonb_build_object('title',resolved->'title','body',resolved->'body','summary',resolved->'summary') end;
  actual:=version;state:='PUBLISHED';stamp:=snapshot.published_at;
  target:=target||jsonb_build_object('level','business','id',page.entity_ref);
 end if;
 return jsonb_build_object('entity_type',kind,'entity_id',ref,'version',actual,'visibility',
  case when kind='business' then 'REFERENCE' when published then 'PUBLISHED' else 'DRAFT' end,'as_of',stamp,'fields',fields,'target',target);
end $$;
create function internal.assistant_saved_source_visible(kind text,ref text,version text) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 if kind not in ('business','faq','section') then return true;end if;
 perform internal.assistant_saved_source(kind,ref,version);return true;
exception when insufficient_privilege or no_data_found or serialization_failure then return false;
end $$;

-- Bounded narrative candidates only; matching and numeric rejection use the
-- existing typed tool projection after exact caller/source checks.
create function internal.assistant_business_search(code text,visibility text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare item record;evidence jsonb;items jsonb:='[]';page hub.web_pages;snapshot hub.entity_versions;
begin
 perform internal.assistant_require_actor();
 perform hub.content_scope_access('business',code,'view');
 if visibility not in ('draft','published') or visibility is null then raise exception 'Invalid evidence visibility' using errcode='23514';end if;
 if visibility='draft' then
  for item in
   select 'section' kind,s.id::text ref,s.draft_version_id::text version from hub.content_sections s
    where s.scope_type='business' and s.scope_id=code and s.state<>'WITHDRAWN'
   union all
   select 'faq',f.id::text,r.version_id::text from hub.business_scope_faq_rows('business',code,false) r
    join hub.faqs f on f.id=r.faq_id join hub.faq_versions fv on fv.id=r.version_id
    where (select count(*) from hub.business_scope_faq_rows('business',code,false) other
      join hub.faq_versions ov on ov.id=other.version_id where ov.question_key=fv.question_key)=1
   order by kind,ref limit 200 loop
   begin
    evidence:=internal.assistant_saved_source(item.kind,item.ref,item.version);
    items:=items||jsonb_build_array(evidence);
   exception when insufficient_privilege or no_data_found or serialization_failure then null;end;
  end loop;
 else
  select p.* into page from hub.web_pages p where p.page_type='business' and p.entity_ref=code and p.ai_policy<>'no_ai';
  select ev.* into snapshot from hub.entity_versions ev where ev.id=page.published_version_id and ev.web_page_id=page.id;
  if snapshot.id is null or snapshot.payload->>'ai_policy'='no_ai' then return items;end if;
  for item in select distinct
    case d->>'table' when 'faq_versions' then 'faq' else 'section' end kind,
    case d->>'table' when 'faq_versions' then (select fv.faq_id::text from hub.faq_versions fv where fv.id=(d#>>'{identity,id}')::uuid)
     else (select sv.section_id::text from hub.content_section_versions sv where sv.id=(d#>>'{identity,id}')::uuid) end ref,
    snapshot.id::text||':'||(d#>>'{identity,id}') version
   from hub.web_dependencies(snapshot.payload) d where d->>'table' in ('faq_versions','content_section_versions')
   order by kind,ref limit 200 loop
   begin
    evidence:=internal.assistant_saved_source(item.kind,item.ref,item.version);
    items:=items||jsonb_build_array(evidence);
   exception when insufficient_privilege or no_data_found or serialization_failure then null;end;
  end loop;
 end if;
 return items;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('internal.assistant_can_source(text,text,boolean)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$when tool='search_content' and kind in('project','brand')$old$,$new$when tool='search_content' and kind in ('business','faq') then hub.can('knowledge','view')
 when tool='search_content' and kind='section' then hub.can('knowledge','view') or hub.can('projects','view') or hub.can('brands','view')
 when tool='search_content' and kind in('project','brand')$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('internal.assistant_access(text,text,boolean)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$('search_content','project',6),('search_content','brand',6)$old$,$new$('search_content','project',6),('search_content','brand',6),('search_content','business',6),('search_content','faq',6),('search_content','section',6)$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('internal.assistant_tool_record(uuid,jsonb)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$source->>'entity_type' not in('project','brand','model','promotion')$old$,$new$source->>'entity_type' not in('project','brand','model','promotion','business','faq','section')$new$);
 d:=hub.content_definition_replace(d,$old$insert into internal.assistant_citation($old$,$new$if source->>'entity_type' in ('business','faq','section') then perform internal.assistant_saved_source(source->>'entity_type',source->>'entity_id',source->>'version');end if; insert into internal.assistant_citation($new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('internal.assistant_citation_read(uuid,uuid)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$return to_jsonb(c);$old$,$new$return to_jsonb(c)||case when c.entity_type in ('business','faq','section') then jsonb_build_object('evidence',internal.assistant_saved_source(c.entity_type,c.entity_id,c.version)) else '{}'::jsonb end;$new$);
 execute d;
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('internal.assistant_run_read(uuid)'::regprocedure),chr(13),'');
 d:=hub.content_definition_replace(d,$old$where c.tool_id=t.id and not internal.assistant_can_source(t.tool_name,c.entity_type,
    coalesce(t.requires_finance,t.tool_name='find_campaigns'))$old$,$new$where c.tool_id=t.id and (not internal.assistant_can_source(t.tool_name,c.entity_type,
    coalesce(t.requires_finance,t.tool_name='find_campaigns')) or not internal.assistant_saved_source_visible(c.entity_type,c.entity_id,c.version))$new$);
 d:=hub.content_definition_replace(d,$old$and internal.assistant_can_source(t.tool_name,c.entity_type,coalesce(t.requires_finance,t.tool_name='find_campaigns')))$old$,$new$and internal.assistant_can_source(t.tool_name,c.entity_type,coalesce(t.requires_finance,t.tool_name='find_campaigns'))
  and internal.assistant_saved_source_visible(c.entity_type,c.entity_id,c.version))$new$);
 execute d;
end $$;

-- Ordinary business data reuses the existing draft DTOs and source guards.
-- Native section history is bounded here; the paginated workspace history keeps
-- the full audit timeline accessible through its established permission checks.
create function hub.business_content(code text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.content_scope_access('business',code,'view');
 return jsonb_build_object('scope_type','business','scope_id',code,
  'sections',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'section_key',s.section_key,'revision',s.revision,'state',s.state,'version',to_jsonb(v),
   'history',(select coalesce(jsonb_agg(to_jsonb(h) order by version_no desc),'[]') from
    (select * from hub.content_section_versions where section_id=s.id order by version_no desc limit 50) h)) order by s.section_key)
   from hub.content_sections s join lateral (select * from hub.content_section_versions where section_id=s.id order by version_no desc limit 1) v on true
   where s.scope_type='business' and s.scope_id=code),'[]'),
  'contacts',hub.content_contacts('business',code),
  'translations',coalesce((select jsonb_agg(t) from jsonb_array_elements(hub.content_translation_list('knowledge',code)) t
   where t->>'owner_type'='section' and exists(select 1 from hub.content_sections s where s.scope_type='business' and s.scope_id=code and s.id::text=t->>'owner_key')),'[]'));
end $$;

revoke all on function hub.business_assign_brand(),hub.business_references(),hub.business_content(text),hub.business_project_matches(text,text),
 hub.faq_scope_rank(text),hub.business_cluster_matches(text,text[],text[]),hub.business_scope_faq_rows(text,text,boolean),
 internal.assistant_saved_source(text,text,text),internal.assistant_saved_source_visible(text,text,text),internal.assistant_business_search(text,text)
 from public,hub_app,viewer,editor,publisher,admin,online_staff,agency,service_consumer;
grant execute on function hub.business_references(),hub.business_content(text),internal.assistant_business_search(text,text) to hub_app;
commit;
