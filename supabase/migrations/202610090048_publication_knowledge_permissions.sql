begin;

-- Phase 3 keeps business validation, immutable revisions and transaction locks.
-- Only table-backed capabilities authorize internal publication/knowledge work.
create function hub.content_member_tab(kind text) returns text
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select case kind when 'project' then 'projects' when 'brand' then 'brands' when 'promotion' then 'promotions' end
$$;
revoke all on function hub.content_member_tab(text) from public;
grant execute on function hub.content_member_tab(text) to hub_app,editor,publisher,viewer,admin;

do $$ declare rule record; f record; definition text; matched integer;
begin
 for rule in select * from (values
  ('promotions','view',array['promotion_read']),
  ('releases','view',array['release_read','release_candidates']),
  ('releases','approve',array['release_publish','release_rollback']),
  ('knowledge','view',array['knowledge_candidate_rows','knowledge_followup','knowledge_model_catalogue','record_knowledge_gap']),
  ('knowledge','edit',array['review_knowledge_candidate','review_knowledge_candidate_before_hero','review_knowledge_question']),
  ('knowledge','approve',array['lock_knowledge_asset','knowledge_link_approved_asset','publish_knowledge_preview'])
 ) as r(tab,level,names) loop
  matched:=0;
  for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='hub' and p.proname=any(rule.names) loop
   definition:=pg_get_functiondef(f.oid);
   if definition !~ 'hub.require_actor\(array\[[^]]*\]\)' then raise exception 'Missing reviewed guard: %',f.proname; end if;
   execute regexp_replace(definition,'hub.require_actor\(array\[[^]]*\]\)',format('hub.require_permission(%L,%L)',rule.tab,rule.level),'g');
   matched:=matched+1;
  end loop;
  if matched<>cardinality(rule.names) then raise exception 'Incomplete publication guard set: %/%',rule.tab,rule.level; end if;
 end loop;
 select pg_get_functiondef('hub.promotion_command(text,uuid,jsonb)'::regprocedure) into definition;
 if strpos(definition,'hub.require_actor(case when action')=0 then raise exception 'Missing promotion dispatcher guard'; end if;
 execute replace(definition,'hub.require_actor(case when action in(''create'',''update'') then array[''editor'',''admin''] else array[''publisher''] end)',
   'hub.require_permission(''promotions'',case when action in(''create'',''update'') then ''edit'' else ''approve'' end)');
end $$;

-- Check the complete set, including synthetic demo publication, before locking
-- or writing any member. A single unticked approval aborts the whole transaction.
do $$ declare f regprocedure; definition text;
begin
 foreach f in array array['hub.release_publish(jsonb,text,boolean)'::regprocedure,'hub.release_rollback(uuid,text)'::regprocedure] loop
  definition:=pg_get_functiondef(f);
  if strpos(definition,'perform hub.lock_release_members(members);')=0 then raise exception 'Missing release member lock'; end if;
  execute replace(definition,'perform hub.lock_release_members(members);',
   'if exists(select 1 from jsonb_array_elements(members) item where not hub.can(hub.content_member_tab(item->>''entity_type''),''approve'')) then
      raise exception ''Permission denied for release member'' using errcode=''42501''; end if;
    perform hub.lock_release_members(members);');
 end loop;
 select pg_get_functiondef('hub.release_candidates(boolean)'::regprocedure) into definition;
 if strpos(definition,'order by kind,public_id loop')=0 then raise exception 'Missing release candidate loop'; end if;
 execute replace(definition,'order by kind,public_id loop',
  'order by kind,public_id loop
   if not hub.can(hub.content_member_tab(r.kind),''view'') then continue; end if;');
 -- A draft catalogue-completeness flag is Projects data. A Knowledge-only
 -- account gets unknown, so the existing preview hands specifications off.
 select pg_get_functiondef('hub.knowledge_model_catalogue(text)'::regprocedure) into definition;
 execute replace(definition,'perform hub.require_permission(''knowledge'',''view'');',
  'perform hub.require_permission(''knowledge'',''view'');
   if not hub.can(''projects'',''view'') then return null; end if;');
 -- Rights approval must not forge a knowledge binding to an invisible file.
 select pg_get_functiondef('hub.knowledge_link_approved_asset(uuid,uuid,integer)'::regprocedure) into definition;
 execute replace(definition,'perform hub.require_permission(''knowledge'',''approve'');',
  'perform hub.require_permission(''knowledge'',''approve''); perform hub.require_asset_access(asset);');
end $$;

create or replace function hub.release_read(p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
 perform hub.require_permission('releases','view');
 if p_id is null then return jsonb_build_object('items',coalesce((select jsonb_agg(hub.release_read(id) order by published_at desc,id)
   from hub.publication_releases),'[]'),'total',(select count(*) from hub.publication_releases)); end if;
 select to_jsonb(r)||jsonb_build_object('members',coalesce((select jsonb_agg(to_jsonb(m)-'release_id' order by entity_type,entity_id)
   from hub.publication_release_members m where release_id=r.id and hub.can(hub.content_member_tab(m.entity_type),'view')),'[]'))
 into result from hub.publication_releases r where id=p_id;
 if result is null then raise exception 'Release not found' using errcode='P0002'; end if;
 return result;
end $$;

-- Private preview snapshots stay immutable. Reads project their frozen payload
-- against current permissions; withdrawn bindings cannot keep exposing media.
create function hub.knowledge_preview_projection(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb:=payload; media jsonb;
begin
 if payload is null then return null; end if;
 if not hub.can('projects','view') and jsonb_typeof(payload->'fact_card')='object' then
  result:=jsonb_set(result,'{fact_card,model_catalogue_complete}','null'::jsonb);
 end if;
 select coalesce(jsonb_agg(item),'[]') into media from jsonb_array_elements(coalesce(payload->'assets','[]')) item
  where hub.can_read_asset((item->>'asset_id')::uuid);
 return result||jsonb_build_object('assets',media);
end $$;
create function hub.knowledge_preview_visible(payload jsonb) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select hub.knowledge_preview_projection(payload)=payload
$$;
create function hub.knowledge_preview_read(release_uuid uuid,project text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('knowledge','view');
 return (select hub.knowledge_preview_projection(payload) from hub.knowledge_preview_releases
  where id=release_uuid and rem_project_id=project);
end $$;
revoke all on function hub.knowledge_preview_projection(jsonb),hub.knowledge_preview_visible(jsonb),hub.knowledge_preview_read(uuid,text) from public;
grant execute on function hub.knowledge_preview_visible(jsonb),hub.knowledge_preview_read(uuid,text) to hub_app,editor,publisher,viewer,admin;

-- All internal storage remains FORCE RLS. Existing legacy grants are a ceiling
-- during rollout, with a restrictive conjunct even if another policy allows it.
do $$ declare rule record; tablename text;
begin
 for rule in select * from (values
  ('hub','promotions',array['public_promotions','promotion_reviews','promotion_versions']),
  ('hub','releases',array['publication_releases','publication_release_members']),
  ('staging','knowledge',array['knowledge_batches','knowledge_candidates','knowledge_followup_batches','knowledge_eval_questions','knowledge_promotion_annotations']),
  ('hub','knowledge',array['knowledge_reviews','content_sections','faqs','entity_aliases','content_gaps','knowledge_fact_candidates',
    'knowledge_asset_links','knowledge_evaluation_reviews','knowledge_preview_releases']),
  ('rag','knowledge',array['knowledge_preview_chunks','project_fact_cards'])
 ) as r(schema_name,tab,tables) loop
  foreach tablename in array rule.tables loop
   execute format('alter table %I.%I enable row level security',rule.schema_name,tablename);
   execute format('alter table %I.%I force row level security',rule.schema_name,tablename);
   execute format('create policy publication_owner on %I.%I to %I using(true) with check(true)',rule.schema_name,tablename,current_user);
   execute format('create policy publication_app_read on %I.%I for select to hub_app using(hub.can(%L,''view''))',rule.schema_name,tablename,rule.tab);
   execute format('create policy publication_permission on %I.%I as restrictive to hub_app,editor,publisher,viewer,admin,online_staff,agency using(hub.can(%L,''view'')) with check(false)',rule.schema_name,tablename,rule.tab);
   if rule.schema_name<>'staging' then execute format('grant select on %I.%I to hub_app',rule.schema_name,tablename); end if;
  end loop;
 end loop;
end $$;
grant usage on schema rag to hub_app;
create policy publication_member_permission on hub.publication_release_members as restrictive to hub_app,editor,publisher,viewer,admin
 using(hub.can(hub.content_member_tab(entity_type),'view')) with check(false);
create policy publication_preview_projection on hub.knowledge_preview_releases as restrictive to hub_app,editor,publisher,viewer,admin
 using(hub.knowledge_preview_visible(payload)) with check(false);

do $$ declare f record;
begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='hub' and p.proname=any(array['promotion_read','promotion_command','release_read','release_candidates','release_publish','release_rollback',
  'knowledge_candidate_rows','knowledge_followup','knowledge_model_catalogue','record_knowledge_gap','review_knowledge_candidate',
  'review_knowledge_question','lock_knowledge_asset','knowledge_link_approved_asset','publish_knowledge_preview'])
 loop execute format('grant execute on function %s to hub_app',f.signature); end loop;
end $$;

commit;
