begin;

-- Assistant metadata stays private. Capabilities are checked in SQL before any
-- evidence or stored source identifiers leave the database.
create function internal.assistant_require_actor() returns uuid language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare actor uuid:=hub.permission_actor(); begin
 if not exists(select 1 from hub.user_account where id=actor and status='ACTIVE'
 and hub_role in('viewer','editor','publisher','admin','online_staff')) then
  raise exception 'Internal active account required' using errcode='42501'; end if;
 return actor;
end $$;
revoke all on function internal.assistant_require_actor() from public;

create function internal.assistant_can_source(tool text,kind text,finance_filters boolean default false)
returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce(case
 when tool in('get_project','find_projects','get_models') and kind='project' then hub.can('projects','view')
 when tool='get_brand' and kind='brand' then hub.can('brands','view')
 when tool='check_publish_readiness' and kind in('project','brand','promotion') then hub.can(kind||'s','view')
 when tool='search_content' and kind in('project','brand') then hub.can(kind||'s','view')
 when tool='get_promotions' and kind='promotion' then hub.can('promotions','view')
 when tool in('get_campaign','find_campaigns') and kind='campaign' then
  hub.can('registry','view') and (not finance_filters or hub.can('finance','view'))
 when tool='explain_name' and kind='naming_rule' then hub.can('registry','view')
 when tool='get_line_actuals' and kind='media_line' then hub.can('actuals','view')
 when tool='get_project_marketing' and kind='media_line' then hub.can('finance','view') and hub.can('actuals','view')
 when tool='search_documents' and kind='memo' then hub.can('archive','view')
 else false end,false)
$$;
revoke all on function internal.assistant_can_source(text,text,boolean) from public;

create function internal.assistant_access(tool text default null,kind text default null,finance_filters boolean default false)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid:=internal.assistant_require_actor(); fingerprint text; allowed jsonb; fields jsonb:='{}'; begin
 if tool is not null and not internal.assistant_can_source(tool,kind,finance_filters) then
  raise exception 'Assistant tool forbidden' using errcode='42501'; end if;
 select encode(sha256(convert_to(jsonb_build_array(a.id,hub.permission_projection(a))::text,'UTF8')),'hex')
 into fingerprint from hub.user_account a where id=actor;
 select coalesce(jsonb_agg(t.name order by t.ordinal),'[]') into allowed from (values
 ('get_project','project',1),('find_projects','project',2),('get_models','project',3),('get_brand','brand',4),
 ('check_publish_readiness','project',5),('check_publish_readiness','brand',5),('check_publish_readiness','promotion',5),
 ('search_content','project',6),('search_content','brand',6),('get_promotions','promotion',7),
 ('get_project_marketing','media_line',8),('get_campaign','campaign',9),('find_campaigns','campaign',10),
 ('get_line_actuals','media_line',11),('explain_name','naming_rule',12),('search_documents','memo',13)) t(name,kind,ordinal)
 where internal.assistant_can_source(t.name,t.kind,false);
 select coalesce(jsonb_agg(name order by ordinal),'[]') into allowed from
 (select value as name,min(ordinality) as ordinal from jsonb_array_elements(allowed) with ordinality group by value) x;
 if hub.can('projects','edit') then fields:=fields||'{"project":["meta_title.th","meta_description.th"]}'::jsonb; end if;
 if hub.can('brands','edit') then fields:=fields||'{"brand":["description.th"]}'::jsonb; end if;
 return jsonb_build_object('fingerprint',fingerprint,'allowed_tools',allowed,'proposal_fields',fields);
end $$;
revoke all on function internal.assistant_access(text,text,boolean) from public;

create function internal.assistant_content_version(kind text,public_id text,version_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform internal.assistant_require_actor();
 if kind='project' then
  perform hub.require_permission('projects','view');
  return (select jsonb_build_object('payload',hub.project_permission_projection(v.payload),'published_at',v.published_at)
   from hub.entity_versions v join hub.projects p on p.id=v.project_id
   where p.public_project_id=public_id and p.deleted_at is null and v.id=version_id);
 elsif kind='brand' then
  perform hub.require_permission('brands','view');
  return (select jsonb_build_object('payload',hub.asset_permission_projection(v.payload),'published_at',v.published_at)
   from hub.brand_versions v join hub.brands b on b.id=v.brand_id
   where b.public_brand_id=public_id and b.deleted_at is null and v.id=version_id);
 end if;
 raise exception 'Unknown content kind' using errcode='22023';
end $$;
revoke all on function internal.assistant_content_version(text,text,uuid) from public;

create function internal.assistant_project_reference(public_id text) returns uuid language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('promotions','view');
 return (select id from hub.projects where public_project_id=public_id and deleted_at is null);
end $$;
revoke all on function internal.assistant_project_reference(text) from public;

create function internal.assistant_campaign_codes(q text,agency text,month date,memo_no text,fee_po_ref text,maximum integer)
returns setof text language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform internal.assistant_access('find_campaigns','campaign',month is not null or memo_no is not null or fee_po_ref is not null);
 if maximum not between 1 and 10 or maximum is null then raise exception 'Invalid limit' using errcode='22023'; end if;
 return query select r.code from ads.campaign_registration r
 where (assistant_campaign_codes.agency is null or r.agency=assistant_campaign_codes.agency) and strpos(lower(r.code||' '||r.label),lower(q))>0
 and (assistant_campaign_codes.month is null and assistant_campaign_codes.memo_no is null and assistant_campaign_codes.fee_po_ref is null or exists(
  select 1 from ads.line_assignment a join ads.media_line l on l.id=a.line_id and l.state='ACTIVE'
  join ads.media_line_revision v on v.line_id=l.id and v.status='APPROVED'
  join ads.media_line_component c on c.revision_id=v.id left join ads.memo m on m.id=c.memo_id
  where a.code=r.code and a.status='ACTIVE' and a.acknowledged_revision_id=v.id
  and (assistant_campaign_codes.month is null or a.month=assistant_campaign_codes.month) and (assistant_campaign_codes.memo_no is null or m.memo_no=assistant_campaign_codes.memo_no)
  and (assistant_campaign_codes.fee_po_ref is null or c.fee_po_ref=assistant_campaign_codes.fee_po_ref))) order by r.code limit maximum;
end $$;
revoke all on function internal.assistant_campaign_codes(text,text,date,text,text,integer) from public;

create function internal.assistant_marketing_lines(rem_id text,month date) returns setof uuid
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform internal.assistant_access('get_project_marketing','media_line');
 return query select distinct l.id from ads.media_line l
 join ads.media_line_revision r on r.line_id=l.id and r.status='APPROVED'
 join ads.media_line_component c on c.revision_id=r.id where c.rem_project_id=rem_id and l.state='ACTIVE'
 and (l.month=assistant_marketing_lines.month or assistant_marketing_lines.month between l.period_start_month and l.period_end_month)
 order by l.id limit 10;
end $$;
revoke all on function internal.assistant_marketing_lines(text,date) from public;

-- NULL marks historical records whose filter inputs were deliberately not kept.
-- Such campaign citations conservatively require Finance V. No evidence UPDATE.
alter table internal.assistant_tool add column requires_finance boolean;
alter table internal.assistant_proposal drop constraint assistant_proposal_actor_role_check;
alter table internal.assistant_proposal add constraint assistant_proposal_actor_role_check
 check(actor_role in('viewer','editor','publisher','admin','online_staff'));

-- Preserve all established bounds/digests/locks while replacing role authority.
do $$ declare f regprocedure; definition text; begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='internal' and p.proname in('assistant_owned_run','assistant_run_create','assistant_run_finish',
 'assistant_proposal_create','assistant_proposal_apply') loop
  definition:=pg_get_functiondef(f);
  definition:=replace(definition,'hub.require_actor(array[''editor'',''publisher'',''viewer'',''admin'',''online_staff''])','internal.assistant_require_actor()');
  definition:=replace(definition,'hub.require_actor(array[''editor'',''publisher'',''admin''])','internal.assistant_require_actor()');
  definition:=replace(definition,' and actor_role=current_setting(''role'')','');
  definition:=replace(definition,'current_setting(''role'')','(select hub_role from hub.user_account where id=hub.permission_actor())');
  definition:=replace(definition,'perform hub.require_actor(array[''editor'',''admin'']);','perform hub.require_permission(''brands'',''edit'');');
  if f::text like '%assistant_proposal_create%' then
   definition:=replace(definition,'select to_jsonb(t) into target from hub.projects',
    'perform hub.require_permission(''projects'',''edit'');select to_jsonb(t) into target from hub.projects');
  elsif f::text like '%assistant_run_create%' then
   definition:=replace(definition,'insert into internal.assistant_run(',
    'if p->>''scope_project_id'' is not null then perform hub.require_permission(''projects'',''view''); end if; insert into internal.assistant_run(');
  elsif f::text like '%assistant_run_finish%' then
   definition:=replace(definition,'return to_jsonb(r);','return to_jsonb(r)-case when hub.can(''projects'',''view'') then ''_unused'' else ''scope_project_id'' end;');
  end if;
  execute definition;
 end loop;
end $$;

create or replace function internal.assistant_run_read(p_id uuid) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare r internal.assistant_run; begin
 r:=internal.assistant_owned_run(p_id);
 return (to_jsonb(r)-case when hub.can('projects','view') then '_unused' else 'scope_project_id' end)||jsonb_build_object(
 'tools',coalesce((select jsonb_agg(to_jsonb(t)-'requires_finance' order by t.created_at,t.id)
  from internal.assistant_tool t where t.run_id=r.id and not exists(select 1 from internal.assistant_citation c
   where c.tool_id=t.id and not internal.assistant_can_source(t.tool_name,c.entity_type,
    coalesce(t.requires_finance,t.tool_name='find_campaigns')))),'[]'),
 'citations',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at,c.id) from internal.assistant_citation c
  join internal.assistant_tool t on t.id=c.tool_id where c.run_id=r.id
  and internal.assistant_can_source(t.tool_name,c.entity_type,coalesce(t.requires_finance,t.tool_name='find_campaigns'))),'[]'));
end $$;

-- The recorder never stores prompts, tool arguments, facts, account rows or grids.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('internal.assistant_tool_record(uuid,jsonb)'::regprocedure);
 definition:=replace(definition,'''duration_ms'',''sources''','''duration_ms'',''sources'',''requires_finance''');
 definition:=regexp_replace(definition,
  'if jsonb_array_length\(p->''sources''\)>0 then.*?end if;end if;',
  'if p ? ''requires_finance'' and (jsonb_typeof(p->''requires_finance'')<>''boolean'' or (p->>''requires_finance'')::boolean and p->>''tool_name''<>''find_campaigns'') then raise exception ''Invalid filter provenance'' using errcode=''22023'';end if;', 's');
 definition:=replace(definition,'(run_id,tool_name,outcome,duration_ms)', '(run_id,tool_name,outcome,duration_ms,requires_finance)');
 definition:=replace(definition,'(p->>''duration_ms'')::integer) returning', '(p->>''duration_ms'')::integer,coalesce((p->>''requires_finance'')::boolean,false)) returning');
 definition:=replace(definition,'insert into internal.assistant_citation(',
  'if not internal.assistant_can_source(t.tool_name,source->>''entity_type'',t.requires_finance) then raise exception ''Source forbidden'' using errcode=''42501'';end if; insert into internal.assistant_citation(');
 execute definition;
end $$;

create or replace function internal.assistant_citation_read(p_run_id uuid,p_citation_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare c internal.assistant_citation; t internal.assistant_tool; begin
 perform internal.assistant_owned_run(p_run_id);
 select * into c from internal.assistant_citation where id=p_citation_id and run_id=p_run_id;
 if c.id is null then raise exception 'Citation not found' using errcode='P0002'; end if;
 select * into t from internal.assistant_tool where id=c.tool_id;
 if not internal.assistant_can_source(t.tool_name,c.entity_type,coalesce(t.requires_finance,t.tool_name='find_campaigns')) then
  raise exception 'Citation forbidden' using errcode='42501'; end if;
 return to_jsonb(c);
end $$;

create or replace function internal.assistant_proposal_read(p_id uuid) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare p internal.assistant_proposal; a internal.assistant_proposal_application; actor uuid; cid uuid; begin
 actor:=internal.assistant_require_actor();
 select * into p from internal.assistant_proposal where id=p_id and actor_id=actor;
 if p.id is null then raise exception 'Proposal not found' using errcode='P0002'; end if;
 perform hub.require_permission(p.entity_type||'s','edit');
 foreach cid in array p.citation_ids loop perform internal.assistant_citation_read(p.run_id,cid); end loop;
 select * into a from internal.assistant_proposal_application where proposal_id=p.id;
 return to_jsonb(p)||jsonb_build_object('status',case when a.id is not null then 'APPLIED'
  when p.expires_at<=clock_timestamp() then 'EXPIRED' else 'PROPOSED' end,'receipt',case when a.id is not null then to_jsonb(a) end);
end $$;

-- No direct app grants. UUID ownership remains defense-in-depth for future reads.
do $$ declare s text;t text;policy_name text; begin
 for s,t,policy_name in select * from (values
 ('internal','assistant_run','assistant_run_owner'),('internal','assistant_tool','assistant_tool_owner'),
 ('internal','assistant_citation','assistant_citation_owner'),('internal','assistant_proposal','assistant_proposal_owner'),
 ('internal','assistant_proposal_application','assistant_application_owner'),('audit','assistant_proposal_event','assistant_event_owner')) x loop
  execute format('drop policy %I on %I.%I',policy_name,s,t);
  execute format('create policy assistant_technical_owner on %I.%I to %I using(true) with check(true)',s,t,current_user);
  if t in('assistant_tool','assistant_citation') then
   execute format('create policy %I on %I.%I for select to hub_app,editor,publisher,viewer,admin,online_staff using(exists(select 1 from internal.assistant_run r where r.id=run_id and r.actor_id=hub.permission_actor()))',policy_name,s,t);
  else
   execute format('create policy %I on %I.%I for select to hub_app,editor,publisher,viewer,admin,online_staff using(actor_id=hub.permission_actor())',policy_name,s,t);
  end if;
  execute format('revoke all on %I.%I from hub_app',s,t);
 end loop;
end $$;
grant usage on schema internal to hub_app;
grant execute on function internal.assistant_run_create(jsonb),internal.assistant_run_read(uuid),
 internal.assistant_run_finish(uuid,jsonb),internal.assistant_tool_record(uuid,jsonb),
 internal.assistant_citation_read(uuid,uuid),internal.assistant_proposal_create(jsonb),
 internal.assistant_proposal_read(uuid),internal.assistant_proposal_apply(uuid,text),
 internal.assistant_access(text,text,boolean),internal.assistant_content_version(text,text,uuid),
 internal.assistant_project_reference(text),internal.assistant_campaign_codes(text,text,date,text,text,integer),
 internal.assistant_marketing_lines(text,date) to hub_app;
-- Legacy runtime probes use the same guarded entries; no role restores authority.
grant execute on function internal.assistant_access(text,text,boolean),internal.assistant_content_version(text,text,uuid),
 internal.assistant_project_reference(text),internal.assistant_campaign_codes(text,text,date,text,text,integer),
 internal.assistant_marketing_lines(text,date),internal.assistant_proposal_create(jsonb),
 internal.assistant_proposal_read(uuid),internal.assistant_proposal_apply(uuid,text) to viewer,editor,publisher,admin,online_staff;
commit;
