-- W6: additive object scope. Existing accounts, grants and content are unchanged.
begin;
create temporary table content_scope_existing_functions on commit drop as select oid from pg_proc;

create table hub.account_content_scope (
 account_id uuid not null references hub.user_account(id) on delete cascade,
 tab text not null references hub.permission_catalog(tab),level text not null,
 bu_ids text[] not null default '{}',project_ids text[] not null default '{}',
 revision bigint not null default 1 check(revision>0),updated_at timestamptz not null default clock_timestamp(),updated_by uuid,
 primary key(account_id,tab,level),
 check(tab in ('projects','brands','knowledge','promotions','releases')),
 check(level in ('view','edit','approve')),
 check(array_position(bu_ids,null) is null and array_position(project_ids,null) is null)
);
create table hub.content_scope_settings (
 singleton boolean primary key default true check(singleton),grace_days integer not null default 7 check(grace_days between 1 and 7),
 revision bigint not null default 1 check(revision>0),updated_at timestamptz not null default clock_timestamp(),updated_by uuid
);
create table hub.content_bu_run (
 id uuid primary key default gen_random_uuid(),status text not null check(status in ('ACCEPTED','REJECTED','FAILED')),
 source_watermark timestamptz,accepted_at timestamptz,recorded_at timestamptz not null default clock_timestamp(),
 digest text check(digest is null or digest ~ '^[a-f0-9]{64}$'),row_count integer not null default 0 check(row_count>=0),
 failure_code text check(failure_code is null or failure_code in ('empty','invalid_shape','invalid_project','duplicate_project','invalid_bu','invalid_timestamp','future_snapshot','old_snapshot','stale_refresh','read_failed')),
 captured_run_id uuid,captured_epoch bigint not null check(captured_epoch>=0),
 check((status='ACCEPTED' and source_watermark is not null and accepted_at is not null and digest is not null and row_count>0 and failure_code is null)
  or (status<>'ACCEPTED' and accepted_at is null and failure_code is not null))
);
create table hub.content_bu_membership (
 run_id uuid not null references hub.content_bu_run(id),project_id text not null check(length(btrim(project_id))>0),
 rem_bu_id text check(rem_bu_id is null or length(btrim(rem_bu_id))>0),rem_bu_code text,rem_bu_name text,
 rem_bu_is_active boolean,rem_bu_is_deleted boolean,source_snapshot_at timestamptz not null,project_status_code text,
 primary key(run_id,project_id)
);
create table hub.content_bu_membership_interval (
 id uuid primary key default gen_random_uuid(),
 project_id text not null check(length(btrim(project_id))>0),
 rem_bu_id text check(rem_bu_id is null or length(btrim(rem_bu_id))>0),
 rem_bu_code text,rem_bu_name text,rem_bu_is_active boolean,rem_bu_is_deleted boolean,
 valid_from timestamptz not null,valid_to timestamptz,
 source_snapshot_at timestamptz not null,
 opened_run_id uuid not null references hub.content_bu_run(id),
 closed_run_id uuid references hub.content_bu_run(id),
 check(source_snapshot_at<=valid_from),
 check(valid_to is null or valid_to>=valid_from),
 check((valid_to is null)=(closed_run_id is null))
);
create unique index content_bu_one_open_interval
 on hub.content_bu_membership_interval(project_id) where valid_to is null;

create table hub.content_bu_handover (
 id uuid primary key default gen_random_uuid(),project_id text not null check(length(btrim(project_id))>0),
 rem_bu_id text not null check(length(btrim(rem_bu_id))>0),started_at timestamptz not null,
 accepted_run_id uuid not null references hub.content_bu_run(id),closed_at timestamptz,
 unique(project_id,rem_bu_id,accepted_run_id),check(closed_at is null or closed_at>=started_at)
);
create table hub.content_scope_state (
 singleton boolean primary key default true check(singleton),accepted_run_id uuid references hub.content_bu_run(id),
 acceptance_epoch bigint not null default 0 check(acceptance_epoch>=0),authorization_epoch bigint not null default 0 check(authorization_epoch>=0)
);
do $$ declare t text;begin
 foreach t in array array['account_content_scope','content_scope_settings','content_bu_run','content_bu_membership','content_bu_membership_interval','content_bu_handover','content_scope_state'] loop
  execute format('alter table hub.%I enable row level security',t);
  execute format('alter table hub.%I force row level security',t);
  execute format('revoke all on hub.%I from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer',t);
  execute format('create policy scope_owner on hub.%I to %I using(true) with check(true)',t,current_user);
  execute format('create trigger scope_audit after insert or update or delete on hub.%I for each row execute function audit.record_change()',t);
 end loop;
end $$;
insert into hub.content_scope_settings(singleton) values(true);
insert into hub.content_scope_state(singleton) values(true);
-- Existing permission_event remains the sole effective-access history. Each event
-- has one account/project/tab/level; importer maintenance deduplicates by its key.
create unique index permission_scope_effect_key on hub.permission_event((after_value->>'event_key'))
 where action='CONTENT_SCOPE_EFFECT';

create function hub.content_scope_now() returns timestamptz language sql volatile
set search_path=pg_catalog,pg_temp as $$ select clock_timestamp() $$;
create function hub.content_scope_lock() returns void language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$ select pg_advisory_xact_lock_shared(hashtextextended('hub-account-decisions',0)) $$;
-- 0090 replaces this private hook; caller already holds the account/settings/state locks.
create function hub.content_scope_settle_deadlines() returns void language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$ begin return;end $$;
create function hub.content_scope_exclusive_lock() returns void language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));
 perform 1 from hub.content_scope_settings where singleton for update;
 perform 1 from hub.content_scope_state where singleton for update;
 perform hub.content_scope_settle_deadlines();
end $$;
create function hub.content_scope_projects(kind text,ref text) returns text[] language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select coalesce(array_agg(p.rem_project_id order by p.rem_project_id),'{}') from hub.projects p left join hub.brands b on b.id=p.brand_id
 where p.deleted_at is null and (
 kind='project' and p.public_project_id=ref or kind='brand' and b.public_brand_id=ref
 or kind='business' and exists(select 1 from hub.brand_business bb where bb.brand_id=b.id and bb.business_code=ref)
 or kind='corporate' and ref='sena'
 or kind='project_group' and exists(select 1 from staging.dw_projects d where d.rem_project_id=p.rem_project_id and d.source_record->>'rem_project_group_id'=ref)
 or kind='programme' and exists(select 1 from hub.project_programmes x where x.project_id=p.id and upper(x.programme_key)=ref and x.participating and x.state='approved')
 or kind='unit_type' and exists(select 1 from hub.commercial_types c where c.id::text=ref and c.project_id=p.id and c.deleted_at is null))
$$;
create function hub.content_account_project_allowed(account uuid,tab text,level text,rem_id text,at_time timestamptz) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare a hub.user_account;bits jsonb;s hub.account_content_scope;required text;run uuid;deadline timestamptz;days integer;begin
 if tab not in ('projects','brands','knowledge','promotions','releases') or level not in ('view','edit','approve') or rem_id is null or at_time is null then return false;end if;
 select * into a from hub.user_account where id=account;
 if a.status is distinct from 'ACTIVE' or a.hub_role not in ('viewer','editor','publisher','admin','online_staff') then return false;end if;
 bits:=hub.permission_projection(a)#>array['tabs',tab];
 if bits->'view' is distinct from 'true'::jsonb or bits->level is distinct from 'true'::jsonb then return false;end if;
 select st.accepted_run_id,r.source_watermark+make_interval(hours=>cfg.grace_days*24),cfg.grace_days into run,deadline,days
 from hub.content_scope_state st cross join hub.content_scope_settings cfg left join hub.content_bu_run r on r.id=st.accepted_run_id;
 foreach required in array case when level='view' then array['view'] else array['view',level] end loop
  select * into s from hub.account_content_scope x where x.account_id=account and x.tab=content_account_project_allowed.tab and x.level=required;
  if not found then continue;end if;
  if rem_id=any(s.project_ids) then continue;end if;
  if run is not null and at_time<deadline and exists(select 1 from hub.content_bu_membership m where m.run_id=run and m.project_id=rem_id and m.rem_bu_id is not null and
   (m.rem_bu_id=any(s.bu_ids) or exists(select 1 from hub.content_bu_handover h where h.project_id=rem_id and h.rem_bu_id=any(s.bu_ids)
     and h.started_at<=at_time and at_time<h.started_at+make_interval(hours=>days*24) and (h.closed_at is null or at_time<h.closed_at)))) then continue;end if;
  return false;
 end loop;
 return true;
end $$;
create function hub.content_project_allowed(tab text,level text,rem_project_id text) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.content_scope_lock();
 if rem_project_id is not null and tab in ('projects','brands','knowledge','promotions','releases')
  and level in ('view','edit','approve') and hub.content_unrestricted(tab,level) then return true;end if;
 return hub.content_account_project_allowed(hub.permission_actor(),tab,level,rem_project_id,hub.content_scope_now());
end $$;
create function hub.content_unrestricted(tab text,level text) returns boolean language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select hub.can(tab,level) and not exists(select 1 from hub.account_content_scope s where s.account_id=hub.permission_actor()
 and s.tab=content_unrestricted.tab and s.level=any(case when level='view' then array['view'] else array['view',level] end))
$$;
create function hub.require_content_project_set(tab text,level text,rem_project_ids text[],global_object boolean default false) returns void
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.content_scope_lock();perform hub.require_permission(tab,level);
 if hub.content_unrestricted(tab,level) then return;end if;
 if global_object and level='view' then return;end if;
 if global_object or coalesce(cardinality(rem_project_ids),0)=0 then raise exception 'Content scope denied' using errcode='42501';end if;
 if level='approve' then
  if not exists(select 1 from unnest(rem_project_ids) id where not hub.content_project_allowed(tab,level,id)) then return;end if;
 elsif exists(select 1 from unnest(rem_project_ids) id where hub.content_project_allowed(tab,level,id)) then return;
 end if;
 raise exception 'Content scope denied' using errcode='42501';
end $$;
create function hub.content_project_set_allowed(tab text,level text,ids text[],global_object boolean default false) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
begin perform hub.require_content_project_set(tab,level,ids,global_object);return true;
exception when insufficient_privilege or no_data_found then return false;end $$;
create function hub.require_content_project(project_uuid uuid,tab text,level text) returns void
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare ref text;begin
 perform hub.content_scope_lock();perform hub.require_permission(tab,level);
 select rem_project_id into ref from hub.projects where id=project_uuid and deleted_at is null;
 if ref is null then raise exception 'Project not found' using errcode='P0002';end if;
 perform hub.require_content_project_set(tab,level,array[ref]);
end $$;
create function hub.content_scope_fingerprint() returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare moment timestamptz:=hub.content_scope_now();state jsonb;boundary timestamptz;token text;begin
 select min(deadline) into boundary from (
 select r.source_watermark+make_interval(hours=>cfg.grace_days*24) deadline from hub.content_scope_state st
 join hub.content_bu_run r on r.id=st.accepted_run_id cross join hub.content_scope_settings cfg
 union all select h.started_at+make_interval(hours=>cfg.grace_days*24) from hub.content_bu_handover h cross join hub.content_scope_settings cfg where h.closed_at is null
 ) x where deadline>moment;
 select jsonb_build_array(hub.permission_actor(),hub.permission_rows(hub.permission_actor()),a.status,a.hub_role,a.legacy_hub_role,hub.permission_catalog_digest(),
 (select coalesce(jsonb_agg(to_jsonb(s) order by tab,level),'[]') from hub.account_content_scope s where account_id=a.id),
 to_jsonb(st),cfg.revision,cfg.grace_days,boundary) into state
 from hub.user_account a cross join hub.content_scope_state st cross join hub.content_scope_settings cfg where a.id=hub.permission_actor();
 token:=encode(sha256(convert_to(coalesce(state,'null')::text,'UTF8')),'hex');
 return jsonb_build_object('fingerprint',token,'expires_at',boundary);
end $$;

create function hub.content_scope_project_references() returns table(project_id text,project_name text)
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select ref,max(name) from (
 select rem_project_id ref,coalesce(public_name->>'th',rem_project_id) name from hub.projects where deleted_at is null
 union all select rem_project_id,coalesce(source_record->>'project_name',rem_project_id) from staging.dw_projects
 union all select rem_project_id,project_name_rem from staging.rem_projects
 union all select m.project_id,m.project_id from hub.content_bu_membership m join hub.content_scope_state s on s.accepted_run_id=m.run_id
 ) p group by ref
$$;
create function hub.content_scope_effects(account_ids uuid[] default null) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare moment timestamptz:=hub.content_scope_now();result jsonb;begin
 select coalesce(jsonb_agg(jsonb_build_object('account_id',a.id,'tab',t.tab,'level',l.level,'project_id',p.project_id)
 order by a.id,t.tab,l.level,p.project_id),'[]') into result
 from hub.user_account a cross join (values('projects'),('brands'),('knowledge'),('promotions'),('releases')) t(tab)
 cross join (values('view'),('edit'),('approve')) l(level) cross join hub.content_scope_project_references() p
 where (account_ids is null or a.id=any(account_ids)) and hub.content_account_project_allowed(a.id,t.tab,l.level,p.project_id,moment);
 return result;
end $$;
create function hub.content_scope_record_effects(before_rows jsonb,after_rows jsonb,reason text,effective_at timestamptz,run_id uuid default null) returns integer
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare x record;entry jsonb;event_key text;counted integer:=0;revision bigint;epoch bigint;begin
 if reason not in ('scope_change','base_change','settings_change','membership_accept','membership_stale','handover_end','account_status')
 or jsonb_typeof(before_rows)<>'array' or jsonb_typeof(after_rows)<>'array' or effective_at is null then raise exception 'Invalid scope effect' using errcode='23514';end if;
 select s.revision,st.authorization_epoch into revision,epoch from hub.content_scope_settings s cross join hub.content_scope_state st;
 for x in with old_rows as(select value from jsonb_array_elements(before_rows)),new_rows as(select value from jsonb_array_elements(after_rows))
 select value,'loss' direction from (select value from old_rows except select value from new_rows) lost
 union all select value,'gain' from (select value from new_rows except select value from old_rows) gained loop
  if exists(select 1 from jsonb_object_keys(x.value) k where k not in ('account_id','tab','level','project_id'))
   or x.value->>'tab' not in ('projects','brands','knowledge','promotions','releases') or x.value->>'level' not in ('view','edit','approve')
   or nullif(x.value->>'project_id','') is null then raise exception 'Invalid scope transition' using errcode='23514';end if;
  event_key:=encode(sha256(convert_to(jsonb_build_array(x.value,x.direction,reason,effective_at,run_id,revision)::text,'UTF8')),'hex');
  entry:=x.value||jsonb_build_object('kind','content_scope_effect','direction',x.direction,'reason',reason,'effective_at',effective_at,
    'observed_at',hub.content_scope_now(),'accepted_run_id',run_id,'settings_revision',revision,'authorization_epoch',epoch,'event_key',event_key);
  insert into hub.permission_event(account_id,actor_id,action,before_value,after_value)
   values((x.value->>'account_id')::uuid,hub.permission_actor(),'CONTENT_SCOPE_EFFECT','{}',entry) on conflict do nothing;
  if found then counted:=counted+1;end if;
 end loop;
 return counted;
end $$;

create function hub.content_scope_selection(scope jsonb) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare bus text[];projects text[];begin
 if jsonb_typeof(scope) is distinct from 'object' or exists(select 1 from jsonb_object_keys(scope) k where k not in ('mode','bu_ids','project_ids'))
 or scope->>'mode' is null or scope->>'mode' not in ('all','selected') or jsonb_typeof(scope->'bu_ids') is distinct from 'array' or jsonb_typeof(scope->'project_ids') is distinct from 'array'
 or jsonb_array_length(scope->'bu_ids')>1000 or jsonb_array_length(scope->'project_ids')>10000
 or exists(select 1 from jsonb_array_elements((scope->'bu_ids')||(scope->'project_ids')) x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}'))=0 or length(x#>>'{}')>200) then
  raise exception 'Invalid content scope selection' using errcode='23514',detail='permission_combination';end if;
 select coalesce(array_agg(distinct value order by value),'{}') into bus from jsonb_array_elements_text(scope->'bu_ids');
 select coalesce(array_agg(distinct value order by value),'{}') into projects from jsonb_array_elements_text(scope->'project_ids');
 if scope->>'mode'='all' and (cardinality(bus)>0 or cardinality(projects)>0) then raise exception 'All scope cannot contain selections' using errcode='23514';end if;
 if exists(select 1 from unnest(bus) b where not exists(select 1 from hub.content_bu_membership m join hub.content_scope_state st on st.accepted_run_id=m.run_id where m.rem_bu_id=b))
 or exists(select 1 from unnest(projects) p where not exists(select 1 from hub.content_scope_project_references() r where r.project_id=p)) then
  raise exception 'Unknown official scope reference' using errcode='23514';end if;
 return jsonb_build_object('mode',scope->>'mode','bu_ids',bus,'project_ids',projects);
end $$;
create function hub.content_scope_account_value(account uuid,tab text,level text) returns jsonb language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select coalesce((select jsonb_build_object('mode','selected','bu_ids',s.bu_ids,'project_ids',s.project_ids,'revision',s.revision)
 from hub.account_content_scope s where s.account_id=account and s.tab=content_scope_account_value.tab and s.level=content_scope_account_value.level),
 jsonb_build_object('mode','all','bu_ids','[]'::jsonb,'project_ids','[]'::jsonb,'revision',0))
$$;
-- Evaluate a proposed one-level scope without changing any table or actor GUC.
create function hub.content_scope_proposed(account uuid,tab text,level text,scope jsonb,action_level text default null) returns text[] language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare result text[]:='{}';p record;bits jsonb;required text;selection jsonb;allowed boolean;moment timestamptz:=hub.content_scope_now();deadline timestamptz;days integer;run uuid;begin
 action_level:=coalesce(action_level,level);
 select hub.permission_projection(a)#>array['tabs',tab] into bits from hub.user_account a where id=account;
 if bits->'view' is distinct from 'true'::jsonb or bits->action_level is distinct from 'true'::jsonb then return result;end if;
 select st.accepted_run_id,r.source_watermark+make_interval(hours=>cfg.grace_days*24),cfg.grace_days into run,deadline,days
 from hub.content_scope_state st cross join hub.content_scope_settings cfg left join hub.content_bu_run r on r.id=st.accepted_run_id;
 for p in select project_id from hub.content_scope_project_references() loop
  allowed:=true;
  foreach required in array case when action_level='view' then array['view'] else array['view',action_level] end loop
   selection:=case when required=level then scope else hub.content_scope_account_value(account,tab,required) end;
   if selection->>'mode'='all' or selection->'project_ids' ? p.project_id then continue;end if;
   if run is not null and moment<deadline and exists(select 1 from hub.content_bu_membership m where m.run_id=run and m.project_id=p.project_id and m.rem_bu_id is not null
    and (selection->'bu_ids' ? m.rem_bu_id or exists(select 1 from hub.content_bu_handover h where h.project_id=p.project_id and selection->'bu_ids' ? h.rem_bu_id
     and h.started_at<=moment and moment<h.started_at+make_interval(hours=>days*24) and (h.closed_at is null or moment<h.closed_at)))) then continue;end if;
   allowed:=false;exit;
  end loop;
  if allowed then result:=array_append(result,p.project_id);end if;
 end loop;return result;
end $$;
create function hub.content_scope_batch_preview(p jsonb) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare seed jsonb;targets jsonb:='[]';x jsonb;selection jsonb;before_scope jsonb;before_ids text[];after_ids text[];a hub.user_account;result jsonb;epoch jsonb;effects jsonb;action_level text;
 tab text:=p#>>'{change,tab}';level text:=p#>>'{change,level}';begin
 if not hub.account_admin() then raise exception 'Account administration required' using errcode='42501';end if;
 if tab not in ('projects','brands','knowledge','promotions','releases') or level not in ('view','edit','approve') or p#>>'{change,kind}' is distinct from 'content_scope'
 or exists(select 1 from jsonb_object_keys(p->'change') k where k not in ('kind','tab','level','scope')) then raise exception 'Invalid content scope change' using errcode='23514';end if;
 selection:=hub.content_scope_selection(p#>'{change,scope}');
 -- Reuse the existing selector, target bound and self/inactive/external exclusions.
 seed:=hub.permission_batch_preview(jsonb_set(p,'{change}',jsonb_build_object('kind','tab','tab',tab,'levels','[]'::jsonb)));
 for x in select value from jsonb_array_elements(seed->'targets') loop
  select * into a from hub.user_account where id=(x->>'account_id')::uuid;
  before_scope:=hub.content_scope_account_value(a.id,tab,level);
  select coalesce(array_agg(r.project_id order by r.project_id),'{}') into before_ids from hub.content_scope_project_references() r
   where hub.content_account_project_allowed(a.id,tab,level,r.project_id,hub.content_scope_now());
  effects:='{}';
  foreach action_level in array array['view','edit','approve'] loop
   select coalesce(array_agg(r.project_id order by r.project_id),'{}') into before_ids from hub.content_scope_project_references() r
    where hub.content_account_project_allowed(a.id,tab,action_level,r.project_id,hub.content_scope_now());
   after_ids:=hub.content_scope_proposed(a.id,tab,level,selection,action_level);
   effects:=effects||jsonb_build_object(action_level,jsonb_build_object('gained',array(select unnest(after_ids) except select unnest(before_ids) order by 1),
    'lost',array(select unnest(before_ids) except select unnest(after_ids) order by 1)));
  end loop;
  targets:=targets||jsonb_build_array(jsonb_build_object('account_id',a.id,'updated_at',a.updated_at,'display_name_th',a.display_name_th,'email',a.email,
   'before',before_scope,'after',selection,'changed',(before_scope-'revision') is distinct from selection,
   'gained',effects#>array[level,'gained'],'lost',effects#>array[level,'lost'],'effects',effects,
   'future_bu_members',selection->>'mode'='selected' and jsonb_array_length(selection->'bu_ids')>0));
 end loop;
 epoch:=hub.content_scope_fingerprint();
 result:=jsonb_build_object('kind','content_scope','tab',tab,'level',level,'catalog_digest',seed->'catalog_digest','targets',targets,'excluded',seed->'excluded',
  'change_count',(select count(*) from jsonb_array_elements(targets) t where (t->>'changed')::boolean),'scope_state',epoch);
 return result||jsonb_build_object('digest',encode(sha256(convert_to(jsonb_build_array(p,seed->'digest',result,
  (select to_jsonb(st) from hub.content_scope_state st),(select to_jsonb(cfg) from hub.content_scope_settings cfg))::text,'UTF8')),'hex'));
end $$;
create function hub.content_scope_batch_apply(p jsonb,expected_digest text) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare preview jsonb;x jsonb;selection jsonb;ids uuid[];before_rows jsonb;batch uuid:=gen_random_uuid();changed integer:=0;stamp timestamptz;begin
 perform hub.content_scope_exclusive_lock();
 if not hub.account_admin() then raise exception 'Account administration required' using errcode='42501';end if;
 preview:=hub.content_scope_batch_preview(p);
 select array_agg((t->>'account_id')::uuid) into ids from jsonb_array_elements((preview->'targets')||(preview->'excluded')) t;
 perform 1 from hub.user_account where id=any(ids) order by id for update;
 preview:=hub.content_scope_batch_preview(p);
 if expected_digest is distinct from preview->>'digest' then raise exception 'Permission preview changed' using errcode='40001',detail='permission_preview_stale';end if;
 before_rows:=hub.content_scope_effects(ids);stamp:=hub.content_scope_now();selection:=hub.content_scope_selection(p#>'{change,scope}');
 for x in select value from jsonb_array_elements(preview->'targets') where (value->>'changed')::boolean loop
  if selection->>'mode'='all' then delete from hub.account_content_scope where account_id=(x->>'account_id')::uuid and tab=preview->>'tab' and level=preview->>'level';
  else insert into hub.account_content_scope(account_id,tab,level,bu_ids,project_ids,updated_by)
   values((x->>'account_id')::uuid,preview->>'tab',preview->>'level',array(select jsonb_array_elements_text(selection->'bu_ids')),
    array(select jsonb_array_elements_text(selection->'project_ids')),hub.permission_actor())
   on conflict(account_id,tab,level) do update set bu_ids=excluded.bu_ids,project_ids=excluded.project_ids,revision=hub.account_content_scope.revision+1,updated_at=stamp,updated_by=excluded.updated_by;
  end if;
  insert into hub.permission_event(account_id,actor_id,action,before_value,after_value) values((x->>'account_id')::uuid,hub.permission_actor(),'CONTENT_SCOPE',x->'before',
   selection||jsonb_build_object('tab',preview->>'tab','level',preview->>'level','note',coalesce(p->>'note',''),'batch_id',batch));changed:=changed+1;
 end loop;
 if changed>0 then update hub.content_scope_state set authorization_epoch=authorization_epoch+1 where singleton;end if;
 perform hub.content_scope_record_effects(before_rows,hub.content_scope_effects(ids),'scope_change',stamp,(select accepted_run_id from hub.content_scope_state));
 return jsonb_build_object('batch_id',batch,'changed_count',changed,'items',(select coalesce(jsonb_agg(jsonb_build_object('account_id',t->'account_id','scope',
  hub.content_scope_account_value((t->>'account_id')::uuid,preview->>'tab',preview->>'level'))),'[]') from jsonb_array_elements(preview->'targets') t));
end $$;
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.preview_account_permissions(jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'return hub.permission_batch_preview(p);',
  $new$if p#>>'{change,kind}'='content_scope' then return hub.content_scope_batch_preview(p);end if;return hub.permission_batch_preview(p);$new$);execute d;
 d:=replace(pg_get_functiondef('hub.apply_account_permissions(jsonb,text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'preview:=hub.permission_batch_preview(p);',
  $new$if p#>>'{change,kind}'='content_scope' then return hub.content_scope_batch_apply(p,expected_digest);end if;preview:=hub.permission_batch_preview(p);$new$);execute d;
 d:=replace(pg_get_functiondef('hub.account_directory()'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'from hub.permission_event e)',
  $new$from hub.permission_event e where e.action<>'CONTENT_SCOPE_EFFECT')$new$);execute d;
end $$;

create function hub.content_scope_admin() returns uuid language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin
 if not hub.account_admin() or not exists(select 1 from hub.user_account where id=hub.permission_actor() and status='ACTIVE' and hub_role='admin') then
  raise exception 'Actual account administrator required' using errcode='42501';end if;
 return hub.permission_actor();
end $$;
create function hub.content_scope_history(account uuid,after_cursor text default null,page_size integer default 50) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare cursor_value jsonb;rows jsonb;last_row jsonb;begin
 if not hub.account_admin() then raise exception 'Account administration required' using errcode='42501';end if;
 if account is null or page_size is null or page_size not between 1 and 100 or length(after_cursor)>1024 then raise exception 'Exact account and bounded history required' using errcode='23514';end if;
 if not exists(select 1 from hub.user_account where id=account) then raise exception 'Unknown account' using errcode='P0002';end if;
 if after_cursor is not null then
  begin cursor_value:=after_cursor::jsonb;
   if jsonb_typeof(cursor_value) is distinct from 'array' or jsonb_array_length(cursor_value)<>3 or cursor_value->>0 is distinct from account::text
    or (cursor_value->>1)::timestamptz is null or (cursor_value->>2)::uuid is null then raise exception 'Invalid cursor' using errcode='23514';end if;
  exception when invalid_text_representation or datetime_field_overflow then raise exception 'Invalid history cursor' using errcode='23514';end;
 end if;
 select coalesce(jsonb_agg(item order by effective_at desc,id desc),'[]') into rows from (
 select e.id,(e.after_value->>'effective_at')::timestamptz effective_at,jsonb_build_object('id',e.id,'account_id',e.account_id,'kind','content_scope_effect',
  'tab',e.after_value->>'tab','level',e.after_value->>'level','project_id',e.after_value->>'project_id',
  'project_name',(select r.project_name from hub.content_scope_project_references() r where r.project_id=e.after_value->>'project_id'),
  'direction',e.after_value->>'direction','reason',e.after_value->>'reason','effective_at',e.after_value->'effective_at','observed_at',e.after_value->'observed_at',
  'accepted_run_id',e.after_value->'accepted_run_id','settings_revision',e.after_value->'settings_revision') item
 from hub.permission_event e where e.account_id=account and e.action='CONTENT_SCOPE_EFFECT'
 and e.after_value->>'kind'='content_scope_effect' and e.after_value->>'tab' in ('projects','brands','knowledge','promotions','releases')
 and e.after_value->>'level' in ('view','edit','approve') and e.after_value->>'direction' in ('gain','loss')
 and e.after_value->>'reason' in ('scope_change','base_change','settings_change','membership_accept','membership_stale','handover_end','account_status')
 and (cursor_value is null or ((e.after_value->>'effective_at')::timestamptz,e.id)<((cursor_value->>1)::timestamptz,(cursor_value->>2)::uuid))
 order by (e.after_value->>'effective_at')::timestamptz desc,e.id desc limit page_size+1) r;
 if jsonb_array_length(rows)>page_size then last_row:=rows->(page_size-1);rows:=rows-(page_size);end if;
 return jsonb_build_object('items',rows,'next_cursor',case when last_row is not null then jsonb_build_array(account,last_row->'effective_at',last_row->'id')::text end);
end $$;
create function hub.content_scopes_read(account uuid default null,reference_kind text default 'projects',bu text default null,query text default '',
 after_cursor text default null,page_size integer default 100,history_after text default null,history_size integer default 50) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare refs jsonb;scopes jsonb;last_row jsonb;begin
 if not hub.account_admin() then raise exception 'Account administration required' using errcode='42501';end if;
 if reference_kind not in ('projects','bus') or page_size is null or page_size not between 1 and 100 or length(query)>120 or length(after_cursor)>200
 or account is null and (history_after is not null or history_size<>50) then raise exception 'Invalid scope references query' using errcode='23514';end if;
 if account is not null and not exists(select 1 from hub.user_account where id=account) then raise exception 'Unknown account' using errcode='P0002';end if;
 if account is not null then select jsonb_agg(jsonb_build_object('tab',t.tab,'level',l.level,'scope',hub.content_scope_account_value(account,t.tab,l.level)) order by t.tab,l.level) into scopes
  from (values('projects'),('brands'),('knowledge'),('promotions'),('releases')) t(tab) cross join (values('view'),('edit'),('approve')) l(level);end if;
 if reference_kind='projects' then
  select coalesce(jsonb_agg(item order by id),'[]') into refs from (
   select r.project_id id,jsonb_build_object('id',r.project_id,'name',r.project_name,'rem_bu_id',m.rem_bu_id,'rem_bu_code',m.rem_bu_code,'rem_bu_name',m.rem_bu_name) item
   from hub.content_scope_project_references() r left join hub.content_bu_membership m on m.project_id=r.project_id
    and m.run_id=(select accepted_run_id from hub.content_scope_state)
   where (after_cursor is null or r.project_id>after_cursor) and (bu is null or m.rem_bu_id=bu)
    and (coalesce(query,'')='' or position(lower(query) in lower(r.project_id||' '||r.project_name))>0)
   order by r.project_id limit page_size+1) x;
 else
  select coalesce(jsonb_agg(item order by id),'[]') into refs from (
   select m.rem_bu_id id,jsonb_build_object('id',m.rem_bu_id,'rem_bu_code',min(m.rem_bu_code),'rem_bu_name',min(m.rem_bu_name)) item
   from hub.content_bu_membership m where m.run_id=(select accepted_run_id from hub.content_scope_state) and m.rem_bu_id is not null
    and (after_cursor is null or m.rem_bu_id>after_cursor) and (coalesce(query,'')='' or position(lower(query) in lower(concat_ws(' ',m.rem_bu_id,m.rem_bu_code,m.rem_bu_name)))>0)
   group by m.rem_bu_id order by m.rem_bu_id limit page_size+1) x;
 end if;
 if jsonb_array_length(refs)>page_size then last_row:=refs->(page_size-1);refs:=refs-page_size;end if;
 return jsonb_build_object('account_id',account,'scopes',scopes,'reference_kind',reference_kind,'items',refs,'next_cursor',last_row->>'id',
  'effective_history',case when account is not null then hub.content_scope_history(account,history_after,history_size) end);
end $$;
create function hub.content_bu_runs_read(after_cursor text default null,page_size integer default 50) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare cursor_value jsonb;rows jsonb;last_row jsonb;begin
 if not hub.account_admin() then raise exception 'Account administration required' using errcode='42501';end if;
 if page_size is null or page_size not between 1 and 100 or length(after_cursor)>500 then raise exception 'Invalid sync history query' using errcode='23514';end if;
 if after_cursor is not null then
  begin cursor_value:=after_cursor::jsonb;
   if jsonb_array_length(cursor_value)<>2 or (cursor_value->>0)::timestamptz is null or (cursor_value->>1)::uuid is null then raise exception 'Invalid cursor' using errcode='23514';end if;
  exception when invalid_text_representation or datetime_field_overflow then raise exception 'Invalid run cursor' using errcode='23514';end;
 end if;
 select coalesce(jsonb_agg(item order by recorded_at desc,id desc),'[]') into rows from (
 select r.id,r.recorded_at,jsonb_build_object('id',r.id,'status',r.status,'source_watermark',r.source_watermark,'accepted_at',r.accepted_at,
  'recorded_at',r.recorded_at,'row_count',r.row_count,'failure_code',r.failure_code,'current',st.accepted_run_id=r.id,
  'deadline',r.source_watermark+make_interval(hours=>cfg.grace_days*24)) item from hub.content_bu_run r cross join hub.content_scope_state st cross join hub.content_scope_settings cfg
 where cursor_value is null or (r.recorded_at,r.id)<((cursor_value->>0)::timestamptz,(cursor_value->>1)::uuid)
 order by r.recorded_at desc,r.id desc limit page_size+1) x;
 if jsonb_array_length(rows)>page_size then last_row:=rows->(page_size-1);rows:=rows-page_size;end if;
 return jsonb_build_object('items',rows,'next_cursor',case when last_row is not null then jsonb_build_array(last_row->'recorded_at',last_row->'id')::text end);
end $$;
create function hub.content_scope_settings_read() returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
begin perform hub.content_scope_admin();return (select jsonb_build_object('grace_days',grace_days,'revision',revision) from hub.content_scope_settings);end $$;
-- A private evaluator varies only the proposed grace value; authorization callers
-- always use the five-argument current-settings entry point above.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.content_account_project_allowed(uuid,text,text,text,timestamptz)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'FUNCTION hub.content_account_project_allowed(', 'FUNCTION hub.content_account_project_grace(');
 d:=hub.content_definition_replace(d,'at_time timestamp with time zone)', 'at_time timestamp with time zone, grace_override integer)');
 d:=hub.content_definition_replace(d,'content_account_project_allowed.tab','content_account_project_grace.tab');
 d:=hub.content_definition_replace(d,'cfg.grace_days','grace_override');execute d;
end $$;
create function hub.content_scope_settings_preview(days integer,expected_revision bigint) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare before_rows jsonb;after_rows jsonb;changes jsonb;result jsonb;moment timestamptz:=hub.content_scope_now();begin
 perform hub.content_scope_admin();
 if days is null or days not between 1 and 7 then raise exception 'Grace must be between one and seven days' using errcode='23514';end if;
 if expected_revision is distinct from (select revision from hub.content_scope_settings) then raise exception 'Settings changed' using errcode='40001',detail='permission_preview_stale';end if;
 before_rows:=hub.content_scope_effects();
 select coalesce(jsonb_agg(jsonb_build_object('account_id',a.id,'tab',t.tab,'level',l.level,'project_id',r.project_id) order by a.id,t.tab,l.level,r.project_id),'[]') into after_rows
 from hub.user_account a cross join (values('projects'),('brands'),('knowledge'),('promotions'),('releases')) t(tab)
 cross join (values('view'),('edit'),('approve')) l(level) cross join hub.content_scope_project_references() r
 where hub.content_account_project_grace(a.id,t.tab,l.level,r.project_id,moment,days);
 select coalesce(jsonb_agg(value||jsonb_build_object('direction',direction) order by value::text,direction),'[]') into changes from (
 select value,'loss' direction from (select value from jsonb_array_elements(before_rows) except select value from jsonb_array_elements(after_rows)) x
 union all select value,'gain' from (select value from jsonb_array_elements(after_rows) except select value from jsonb_array_elements(before_rows)) x) diff;
 result:=jsonb_build_object('grace_days',days,'revision',expected_revision,'change_count',jsonb_array_length(changes),
  'changes',(select coalesce(jsonb_agg(value),'[]') from (select value from jsonb_array_elements(changes) limit 100) c),'complete',jsonb_array_length(changes)<=100,
  'scope_state',hub.content_scope_fingerprint());
 return result||jsonb_build_object('digest',encode(sha256(convert_to(jsonb_build_array(result,changes,
  (select coalesce(jsonb_agg(jsonb_build_array(a.id,a.updated_at,hub.permission_rows(a.id)) order by a.id),'[]') from hub.user_account a),
  (select to_jsonb(st) from hub.content_scope_state st))::text,'UTF8')),'hex'));
end $$;
create function hub.content_scope_settings_apply(days integer,expected_revision bigint,expected_digest text) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare preview jsonb;before_rows jsonb;stamp timestamptz;begin
 perform hub.content_scope_exclusive_lock();perform hub.content_scope_admin();
 preview:=hub.content_scope_settings_preview(days,expected_revision);
 if expected_digest is distinct from preview->>'digest' then raise exception 'Settings preview changed' using errcode='40001',detail='permission_preview_stale';end if;
 before_rows:=hub.content_scope_effects();stamp:=hub.content_scope_now();
 if days is distinct from (select grace_days from hub.content_scope_settings) then
  update hub.content_scope_settings set grace_days=days,revision=revision+1,updated_at=stamp,updated_by=hub.permission_actor() where singleton;
  update hub.content_scope_state set authorization_epoch=authorization_epoch+1 where singleton;
  perform hub.content_scope_record_effects(before_rows,hub.content_scope_effects(),'settings_change',stamp,(select accepted_run_id from hub.content_scope_state));
 end if;
 return hub.content_scope_settings_read();
end $$;

-- Ownership resolvers are private and never filter their affected set by the
-- caller. Shared approval must see the complete current set, not a visible subset.
create function hub.content_faq_projects(faq uuid,version uuid default null) returns text[] language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare f hub.faqs;v hub.faq_versions;ids text[];begin
 select * into f from hub.faqs where id=faq;if not found then return '{}';end if;
 select * into v from hub.faq_versions where faq_id=faq and (version is null or id=version) order by version_no desc limit 1;
 if f.scope_type='project' then return array[f.scope_id];end if;
 if f.scope_type='unit_type' then return hub.content_scope_projects(f.scope_type,f.scope_id);end if;
 if coalesce(v.applicability_rule,'{}')<>'{}' then return hub.faq_rule_projects(v.applicability_rule,f.scope_type,f.scope_id);end if;
 if cardinality(v.applies_to_project_ids)>0 then
  select coalesce(array_agg(x order by x),'{}') into ids from unnest(v.applies_to_project_ids) x
   where x=any(hub.content_scope_projects(f.scope_type,f.scope_id));return ids;
 end if;
 if f.scope_type='corporate' and exists(select 1 from hub.faq_questions q where q.question_key=v.question_key and q.status='approved' and q.show_on_project_pages) then
  return hub.content_scope_projects('corporate','sena');end if;
 return '{}';
end $$;
create function hub.content_article_projects(article uuid,version uuid default null) returns text[] language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 with selected as(select v.* from hub.article_versions v where v.article_id=article and (version is null or v.id=version) order by v.version_no desc limit 1), refs as(
 select unnest(hub.content_scope_projects(l.kind,l.ref)) ref from hub.article_links l join selected v on v.id=l.version_id
 union select p.rem_project_id from selected v cross join lateral jsonb_each(v.blocks) locale cross join lateral hub.article_nodes(locale.value) n join hub.projects p on p.public_project_id=n.node#>>'{attrs,project_id}'
 where n.node->>'type' in ('projectCard','faqEmbed')
 ) select coalesce(array_agg(distinct ref order by ref),'{}') from refs
$$;
create function hub.content_asset_bindings(asset uuid) returns table(tab text,project_ids text[]) language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select 'projects',array[p.rem_project_id] from hub.entity_assets b join hub.projects p on p.id=b.project_id where b.asset_id=asset and b.deleted_at is null and p.deleted_at is null
 union all select 'projects',array[p.rem_project_id] from hub.commercial_type_assets b join hub.projects p on p.id=b.project_id where b.asset_id=asset and b.deleted_at is null and p.deleted_at is null
 union all select 'brands',hub.content_scope_projects('brand',b.public_brand_id) from hub.brand_assets ba join hub.brands b on b.id=ba.brand_id where ba.asset_id=asset and ba.deleted_at is null and b.deleted_at is null
 union all select case when l.target_type='promotion' then 'promotions' else 'projects' end,array[p.rem_project_id] from hub.asset_links l join hub.projects p on p.id=l.project_id where l.asset_id=asset and l.deleted_at is null and p.deleted_at is null
 union all select 'knowledge',coalesce(r.applies_to_project_ids,c.project_ids) from hub.knowledge_asset_links l join staging.knowledge_candidates c on c.id=l.candidate_id left join hub.knowledge_reviews r on r.candidate_id=c.id where l.asset_id=asset
 union all select 'projects',array[p.rem_project_id] from hub.projects p join hub.entity_versions v on v.id=p.published_version_id and v.project_id=p.id where p.deleted_at is null and
  (jsonb_path_exists(v.payload,'$.assets[*].id ? (@ == $asset)',jsonb_build_object('asset',asset::text)) or jsonb_path_exists(v.payload,'$.commercial_types[*].assets[*].id ? (@ == $asset)',jsonb_build_object('asset',asset::text)))
 union all select 'brands',hub.content_scope_projects('brand',b.public_brand_id) from hub.brands b join hub.brand_versions v on v.id=b.published_version_id and v.brand_id=b.id where b.deleted_at is null and jsonb_path_exists(v.payload,'$.assets[*].id ? (@ == $asset)',jsonb_build_object('asset',asset::text))
 union all select 'brands',hub.content_scope_projects('brand',b.public_brand_id) from hub.projects p join hub.entity_versions v on v.id=p.published_version_id join hub.brands b on b.id=p.brand_id where p.deleted_at is null and b.deleted_at is null and jsonb_path_exists(v.payload,'$.brand.assets[*].id ? (@ == $asset)',jsonb_build_object('asset',asset::text))
$$;
create function hub.content_asset_scope_allowed(asset uuid,level text) returns boolean language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare a hub.assets;b record;seen boolean:=false;begin
 select * into a from hub.assets where id=asset and deleted_at is null;if not found then return false;end if;
 for b in select tab,array_agg(distinct id) filter(where id is not null) ids from hub.content_asset_bindings(asset) x left join lateral unnest(x.project_ids) id on true group by tab loop
  seen:=true;
  if level='view' then
   if hub.content_project_set_allowed(b.tab,'view',coalesce(b.ids,'{}')) then
    if a.media_category is distinct from 'legal_document' or b.tab='projects' and
      (hub.content_project_set_allowed('projects','edit',b.ids) or hub.content_project_set_allowed('projects','approve',b.ids)) then return true;end if;
   end if;
  elsif not hub.content_project_set_allowed(b.tab,level,coalesce(b.ids,'{}')) then return false;end if;
 end loop;
 if seen then return level in ('edit','approve');end if;
 return a.provenance='upload' and a.owner_id=hub.permission_actor() and a.first_bound_at is null and
  case when level='view' then hub.can_upload_asset() else hub.can('projects',level) or hub.can('brands',level) or hub.can('knowledge',level) end;
end $$;
create function hub.content_source_projects(table_name text,row_data jsonb) returns text[] language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare ids text[];parent jsonb;begin
 case table_name
 when 'projects' then return array[row_data->>'rem_project_id'];
 when 'brands' then return hub.content_scope_projects('brand',row_data->>'public_brand_id');
 when 'businesses' then return hub.content_scope_projects('business',row_data->>'code');
 when 'brand_assets','brand_versions' then return hub.content_scope_projects('brand',(select public_brand_id from hub.brands where id=(row_data->>'brand_id')::uuid));
 when 'faqs' then return hub.content_faq_projects((row_data->>'id')::uuid);
 when 'faq_versions' then return hub.content_faq_projects((row_data->>'faq_id')::uuid,(row_data->>'id')::uuid);
 when 'faq_sources' then return hub.content_faq_projects((row_data->>'faq_id')::uuid);
 when 'content_sections' then
  if row_data->>'candidate_id' is not null and row_data->>'section_key' is null then
   return array(select jsonb_array_elements_text(row_data->'applies_to_project_ids'));end if;
  return hub.content_scope_projects(row_data->>'scope_type',row_data->>'scope_id');
 when 'contacts' then return hub.content_scope_projects(row_data->>'scope_type',row_data->>'scope_id');
 when 'content_section_versions' then select to_jsonb(s) into parent from hub.content_sections s where id=(row_data->>'section_id')::uuid;return hub.content_source_projects('content_sections',parent);
 when 'articles' then return hub.content_article_projects((row_data->>'id')::uuid);
 when 'article_versions','article_links' then return hub.content_article_projects((row_data->>'article_id')::uuid,case when table_name='article_versions' then (row_data->>'id')::uuid else (row_data->>'version_id')::uuid end);
 when 'public_promotions' then
  select coalesce(array_agg(p.rem_project_id order by p.rem_project_id),'{}') into ids from hub.promotion_target_projects((row_data->>'id')::uuid) t join hub.projects p on p.id=t.id;return ids;
 when 'promotion_versions' then
  return array(select p.rem_project_id from jsonb_array_elements_text(coalesce(row_data#>'{payload,target_project_ids}',jsonb_build_array(row_data#>>'{payload,public_project_id}'))) ref
   join hub.projects p on p.public_project_id=ref order by p.rem_project_id);
 when 'promotion_reviews' then
  parent:=nullif(row_data->'resolved_project_ids','null');
  if parent is null then
   select v.payload->'target_project_ids' into parent from hub.promotion_versions v
    where v.promotion_id=(row_data->>'promotion_id')::uuid and v.draft_revision=(row_data->>'review_revision')::integer
    order by v.version_no desc limit 1;
  end if;
  if parent is not null then
   return array(select p.rem_project_id from jsonb_array_elements_text(parent) ref join hub.projects p on p.public_project_id=ref order by p.rem_project_id);
  end if;
  if exists(select 1 from hub.public_promotions p where p.id=(row_data->>'promotion_id')::uuid and p.draft_revision=(row_data->>'review_revision')::integer) then
   return array(select p.rem_project_id from hub.promotion_target_projects((row_data->>'promotion_id')::uuid) t join hub.projects p on p.id=t.id order by p.rem_project_id);
  end if;
  return '{}';
 when 'web_pages' then
  if row_data->>'page_type'='article' then return hub.content_article_projects((select id from hub.articles where slug=row_data->>'entity_ref'));end if;
  if row_data->>'page_type'='project' then select coalesce(array_agg(p.rem_project_id),'{}') into ids from hub.projects p where row_data->'project_ids' ? p.public_project_id;return ids;end if;
  return hub.content_scope_projects(row_data->>'page_type',row_data->>'entity_ref');
 when 'commercial_type_versions' then select to_jsonb(c) into parent from hub.commercial_types c where id=(row_data->>'commercial_type_id')::uuid;return hub.content_source_projects('commercial_types',parent);
 when 'project_price_versions' then select to_jsonb(c) into parent from hub.project_prices c where id=(row_data->>'price_id')::uuid;return hub.content_source_projects('project_prices',parent);
 when 'project_commercial_versions' then return array[(select rem_project_id from hub.projects where id=(row_data->>'project_id')::uuid)];
 when 'knowledge_evaluation_reviews' then return array[(select rem_project_id from staging.knowledge_eval_questions where id=row_data->>'question_id')];
 when 'knowledge_asset_links','knowledge_reviews','entity_aliases','knowledge_fact_candidates' then
  select coalesce(r.applies_to_project_ids,c.project_ids) into ids from staging.knowledge_candidates c left join hub.knowledge_reviews r on r.candidate_id=c.id where c.id=(row_data->>'candidate_id')::uuid;return coalesce(ids,'{}');
 when 'knowledge_candidates','knowledge_preview_chunks' then return array(select jsonb_array_elements_text(row_data->'project_ids'));
 when 'content_gaps' then return array[row_data->>'project_id'];
 when 'project_progress_cache','project_progress_dirty' then return array[row_data->>'rem_project_id'];
 when 'knowledge_preview_releases','project_fact_cards' then return array[coalesce(row_data->>'rem_project_id',row_data->>'project_id')];
 when 'faq_clusters' then
  select coalesce(array_agg(distinct ref order by ref),'{}') into ids from (
   select jsonb_array_elements_text(row_data->'project_ids') ref union
   select p.rem_project_id from hub.projects p join hub.brands b on b.id=p.brand_id where row_data->'brand_ids' ? b.rem_brand_id and p.deleted_at is null) x;return ids;
 when 'faq_intake_decisions' then select to_jsonb(c) into parent from staging.faq_clusters c where id=(row_data->>'cluster_id')::uuid;return hub.content_source_projects('faq_clusters',parent);
 else
  if table_name in ('model_types','entity_assets','commercial_types','commercial_type_assets','project_facilities','project_facts','project_buildings','project_selling_points',
   'project_prices','project_disclosures','project_sales_terms','project_programmes','project_progress','project_features','project_places','solar_estimates','asset_links','media_links','media_link_targets',
   'media_jobs','website_asset_suggestions') then
   return array[(select rem_project_id from hub.projects where id=(row_data->>'project_id')::uuid)];
  elsif table_name='entity_versions' and row_data->>'entity_type'='web_page' then select to_jsonb(w) into parent from hub.web_pages w where id=(row_data->>'web_page_id')::uuid;return hub.content_source_projects('web_pages',parent);
  elsif table_name='entity_versions' then return array[(select rem_project_id from hub.projects where id=(row_data->>'project_id')::uuid)];
  elsif table_name in ('field_catalog','facility_taxonomy','feature_catalog','faq_questions','faq_question_versions','translation_glossary','media_tags','media_requirements','contact_domains','knowledge_topics','ref_rail_lines','ref_rail_stations','ref_expressways','ref_expressway_ramps') then return '{}';
  end if;
 end case;
 raise exception 'Unsupported scoped source' using errcode='23514';
end $$;
create function hub.require_content_source(table_name text,row_data jsonb,tab text,level text) returns void language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare ids text[];global_row boolean;begin
 if row_data is null or row_data='null'::jsonb then raise exception 'Content source not found' using errcode='P0002';end if;
 if table_name='assets' then
  if not hub.content_asset_scope_allowed((row_data->>'id')::uuid,level) then raise exception 'Asset scope denied' using errcode='42501';end if;return;
 end if;
 if table_name='content_translations' then
  perform hub.require_content_translation_scope((row_data->>'id')::uuid,level);return;
 end if;
 global_row:=table_name in ('field_catalog','facility_taxonomy','feature_catalog','faq_questions','faq_question_versions','translation_glossary','media_tags','media_requirements','contact_domains','knowledge_topics','ref_rail_lines','ref_rail_stations','ref_expressways','ref_expressway_ramps');
 ids:=hub.content_source_projects(table_name,row_data);
 perform hub.require_content_project_set(tab,level,ids,global_row);
end $$;
create function hub.content_source_allowed(table_name text,row_data jsonb,tab text,level text default 'view') returns boolean language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
begin perform hub.require_content_source(table_name,row_data,tab,level);return true;
exception when insufficient_privilege or no_data_found then return false;end $$;

-- Canonical source and FAQ authority stay separate. The latter never grants
-- Projects/Brands access to a Knowledge-only editor.
-- Retained media is authorized only through an exact immutable dependency and
-- its owning version's scope for that dependency's source tab. This does not
-- grant ordinary asset-library or file access to an unbound historical asset.
do $$ declare d text;table_key text;begin
 d:=replace(pg_get_functiondef('hub.publication_retained_media_source(jsonb)'::regprocedure),E'\r\n',E'\n');
 foreach table_key in array array['entity_versions','brand_versions','promotion_versions'] loop
  d:=hub.content_definition_replace(d,'select 1 from hub.'||table_key||' v where',
   'select 1 from hub.'||table_key||' v where hub.content_source_allowed('||quote_literal(table_key)||',to_jsonb(v),dependency->>''tab'') and');
 end loop;
 -- History checks web-page dependencies too. Re-entering retained-media lookup
 -- there would recurse. The exact immutable owning version above authorizes
 -- its retained media; keep every source tab and every non-media object check.
 d:=hub.content_definition_replace(d,
  $old$exists(select 1 from hub.workspace_history_contexts('hub.entity_versions',to_jsonb(v)))$old$,
  $new$not exists(select 1 from hub.web_dependencies(v.payload) source_dependency where not hub.can(source_dependency->>'tab','view'))
   and exists(select 1 from hub.workspace_history_contexts('hub.entity_versions',case when v.entity_type='web_page' then
    to_jsonb(v)||jsonb_build_object('payload',jsonb_build_object('dependencies',
     (select coalesce(jsonb_agg(source_dependency),'[]') from hub.web_dependencies(v.payload) source_dependency where source_dependency->>'table'<>'assets')))
    else to_jsonb(v) end))$new$);
 execute d;
end $$;
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.content_scope_access(text,text,text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'then return actor;end if;',
  $new$then
  perform hub.content_scope_lock();
  if not hub.content_unrestricted(hub.content_scope_tab(kind),level) then
   perform hub.require_content_project_set(hub.content_scope_tab(kind),level,hub.content_scope_projects(kind,ref));
  end if;
  return actor;end if;$new$);execute d;
 alter function hub.content_scope_access(text,text,text) volatile;
 d:=replace(pg_get_functiondef('hub.workspace_faq_scope_access(text,text,text,text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'perform hub.require_permission(''knowledge'',required_level);',
  $new$perform hub.require_permission('knowledge',required_level);
 perform hub.require_content_project_set('knowledge',required_level,case when kind='project' then
  array[(select rem_project_id from hub.projects where public_project_id=ref)] else hub.content_scope_projects(kind,ref) end);$new$);execute d;
 d:=replace(pg_get_functiondef('hub.content_workflow_source(text,jsonb,text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'return row_data||jsonb_build_object(',
  $new$perform hub.require_content_source(table_name,row_data,tab,level);return row_data||jsonb_build_object($new$);execute d;
 d:=replace(pg_get_functiondef('hub.publication_dependency_check(jsonb,boolean,boolean)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,$old$retained:=not unchanged and hub.publication_retained_media_source(dependency);$old$,
  $new$retained:=not unchanged and hub.publication_retained_media_source(dependency);
  if not (retained and dependency->>'table'='assets') then perform hub.require_content_source(dependency->>'table',source,dependency->>'tab','view');end if;$new$);execute d;
 d:=replace(pg_get_functiondef('hub.web_assert_sources(jsonb,text,boolean)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,$old$perform hub.require_permission(d->>'tab','view');$old$,
  $new$perform hub.require_permission(d->>'tab','view');
  if not (d->>'table'='assets' and (hub.content_asset_scope_allowed((d#>>'{identity,id}')::uuid,'view') or hub.publication_retained_media_source(d))) then perform hub.require_content_source(d->>'table',hub.web_source(d->>'table',d->'identity'),d->>'tab','view');end if;$new$);execute d;
 d:=replace(pg_get_functiondef('hub.can_read_asset(uuid)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'where a.id=asset_uuid and a.deleted_at is null',
  'where a.id=asset_uuid and a.deleted_at is null and hub.content_asset_scope_allowed(a.id,''view'')');execute d;
 d:=replace(pg_get_functiondef('hub.can_read_asset_before_media(uuid)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'where a.id=asset_uuid and a.deleted_at is null',
  'where a.id=asset_uuid and a.deleted_at is null and hub.content_asset_scope_allowed(a.id,''view'')');execute d;
 d:=replace(pg_get_functiondef('hub.media_require_asset_edit(uuid)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'perform hub.require_permission(''projects'',''edit'');',
  $new$perform hub.require_permission('projects','edit');if not hub.content_asset_scope_allowed(asset_uuid,'edit') then raise exception 'Asset scope denied' using errcode='42501';end if;$new$);execute d;
 d:=replace(pg_get_functiondef('hub.media_target(uuid,text,text,text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'if not hub.can(''projects'',level) then return false; end if;',
  $new$if not hub.can('projects',level) or not hub.content_project_allowed('projects',level,(select rem_project_id from hub.projects where id=project_uuid)) then return false;end if;$new$);execute d;
end $$;
create or replace function hub.section_visible(section uuid) returns boolean language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$ select coalesce((select case when candidate_id is not null and section_key is null then
 hub.content_project_set_allowed(hub.content_scope_tab(scope_type),'view',applies_to_project_ids)
 else hub.content_scope_allowed(scope_type,scope_id,'view') end from hub.content_sections where id=section),false) $$;

-- Exact finite entry-point wrappers preserve original validation, ACL and result
-- types. Private delegates are closed; no name/table/clock is supplied by a caller.
do $$ declare rule record;fn record;acl record;d text;delegate text;args text;body text;result_type text;roles text;begin
 for rule in select * from (values
  ('review_asset', $guard$perform hub.require_content_project_set('knowledge','approve',array(select distinct unnest(project_ids) from hub.content_asset_bindings(asset_uuid)));$guard$),
  ('list_rem_models', $guard$perform hub.require_content_project(project_uuid,'projects','view');$guard$),
  ('project_readiness', $guard$perform hub.require_content_project(project_uuid,'projects','view');$guard$),
  ('project_versions', $guard$perform hub.require_content_project(project_uuid,'projects','view');$guard$),
  ('patch_project', $guard$perform hub.require_content_project(project_uuid,'projects','edit');$guard$),
  ('add_model_from_rem', $guard$perform hub.require_content_project(project_uuid,'projects','edit');$guard$),
  ('update_model', $guard$perform hub.require_content_project(project_uuid,'projects','edit');$guard$),
  ('review_model', $guard$perform hub.require_content_project(project_uuid,'projects','edit');$guard$),
  ('prefill_project_from_dw', $guard$perform hub.require_content_project(project_uuid,'projects','edit');$guard$),
  ('bind_asset', $guard$perform hub.require_content_project(project_uuid,'projects','edit');$guard$),
  ('bind_scoped_asset', $guard$perform hub.require_content_project(project_uuid,'projects','edit');$guard$),
  ('unbind_scoped_asset', $guard$perform hub.require_content_project(project_uuid,'projects','edit');$guard$),
  ('lock_commercial_project', $guard$perform hub.require_content_project(project_uuid,'projects','edit');$guard$),
  ('save_project_facility', $guard$perform hub.require_content_project(project_uuid,'projects','edit');$guard$),
  ('bind_project_asset', $guard$perform hub.require_content_project(project_uuid,'projects','edit');$guard$),
  ('unbind_project_asset', $guard$perform hub.require_content_project(project_uuid,'projects','edit');$guard$),
  ('bind_model_asset', $guard$perform hub.require_content_project(project_uuid,'projects','edit');$guard$),
  ('unbind_model_asset', $guard$perform hub.require_content_project(project_uuid,'projects','edit');$guard$),
  ('create_commercial_types', $guard$perform hub.require_content_project(project_uuid,'projects','edit');$guard$),
  ('update_commercial_type', $guard$perform hub.require_content_project(project_uuid,'projects','edit');$guard$),
  ('bind_commercial_asset', $guard$perform hub.require_content_project(project_uuid,'projects','edit');$guard$),
  ('unbind_commercial_asset', $guard$perform hub.require_content_project(project_uuid,'projects','edit');$guard$),
  ('assign_project_brand', $guard$perform hub.require_content_project(project_uuid,'projects','edit');if brand_uuid is not null then perform hub.content_scope_access('brand',(select public_brand_id from hub.brands where id=brand_uuid),'view');end if;$guard$),
  ('assign_project_brand_before_project_intake', $guard$perform hub.require_content_project(project_uuid,'projects','edit');if brand_uuid is not null then perform hub.content_scope_access('brand',(select public_brand_id from hub.brands where id=brand_uuid),'view');end if;$guard$),
  ('patch_model', $guard$perform hub.require_content_project((select project_id from hub.model_types where id=model_uuid),'projects','edit');$guard$),
  ('confirm_model', $guard$perform hub.require_content_project((select project_id from hub.model_types where id=model_uuid),'projects','edit');$guard$),
  ('create_project_from_rem', $guard$perform hub.require_content_project_set('projects','edit',array[rem_id]);$guard$),
  ('project_detail', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('project_detail_before_commercial_types', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('project_detail_before_demo', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('project_detail_before_facilities', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('project_detail_before_gold_preview', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('project_content_facts', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('project_content_sections', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('project_content', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('project_content_readiness', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('unit_type_workspace', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('project_commercial_workspace', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('faq_composition', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('media_checklist', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('project_media', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('media_jobs_read', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('media_ai_state', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('c4_nearest_stations', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('c4_workspace', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('website_media_queue', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('website_content_sources', $guard$perform hub.content_scope_access('project',public_id,'view');$guard$),
  ('save_project_fact', $guard$perform hub.content_scope_access('project',public_id,'edit');$guard$),
  ('save_project_building', $guard$perform hub.content_scope_access('project',public_id,'edit');$guard$),
  ('save_selling_point', $guard$perform hub.content_scope_access('project',public_id,'edit');$guard$),
  ('save_project_price', $guard$perform hub.content_scope_access('project',public_id,'edit');$guard$),
  ('save_project_commercial', $guard$perform hub.content_scope_access('project',public_id,'edit');$guard$),
  ('media_save_asset', $guard$perform hub.content_scope_access('project',public_id,'edit');$guard$),
  ('media_link_save', $guard$perform hub.content_scope_access('project',public_id,'edit');$guard$),
  ('media_link_remove', $guard$perform hub.content_scope_access('project',public_id,'edit');$guard$),
  ('media_clip_save', $guard$perform hub.content_scope_access('project',public_id,'edit');$guard$),
  ('media_clip_check', $guard$perform hub.content_scope_access('project',public_id,'edit');$guard$),
  ('media_job_request', $guard$perform hub.content_scope_access('project',public_id,'edit');$guard$),
  ('c4_facility_save', $guard$perform hub.content_scope_access('project',public_id,'edit');$guard$),
  ('c4_item_save', $guard$perform hub.content_scope_access('project',public_id,'edit');$guard$),
  ('c4_facility_cover', $guard$perform hub.content_scope_access('project',public_id,'edit');$guard$),
  ('website_media_confirm', $guard$perform hub.content_scope_access('project',public_id,'edit');$guard$),
  ('unit_type_review', $guard$perform hub.content_scope_access('project',public_id,case when decision='submit' then 'edit' else 'approve' end);$guard$),
  ('project_price_review', $guard$perform hub.content_scope_access('project',public_id,case when decision='submit' then 'edit' else 'approve' end);$guard$),
  ('review_project_commercial', $guard$perform hub.content_scope_access('project',public_id,case when decision='submit' then 'edit' else 'approve' end);$guard$),
  ('c4_solar_review', $guard$perform hub.content_scope_access('project',public_id,'approve');$guard$),
  ('brand_detail', $guard$perform hub.content_scope_access('brand',public_id,'view');$guard$),
  ('brand_detail_before_completeness', $guard$perform hub.content_scope_access('brand',public_id,'view');$guard$),
  ('brand_versions', $guard$perform hub.content_scope_access('brand',(select public_brand_id from hub.brands where id=brand_uuid),'view');$guard$),
  ('update_brand_draft', $guard$perform hub.content_scope_access('brand',(select public_brand_id from hub.brands where id=brand_uuid),'edit');$guard$),
  ('bind_brand_asset', $guard$perform hub.content_scope_access('brand',(select public_brand_id from hub.brands where id=brand_uuid),'edit');$guard$),
  ('unbind_brand_asset', $guard$perform hub.content_scope_access('brand',(select public_brand_id from hub.brands where id=brand_uuid),'edit');$guard$),
  ('confirm_brand_source_names', $guard$perform hub.content_scope_access('brand',(select public_brand_id from hub.brands where id=brand_uuid),'edit');$guard$),
  ('create_brand_from_rem', $guard$perform hub.require_content_unrestricted('brands','view');$guard$),
  ('brand_bulk_preview', $guard$perform hub.require_content_unrestricted('brands','view');$guard$),
  ('brand_bulk_create', $guard$perform hub.require_content_unrestricted('brands','view');$guard$),
  ('resolve_brand_request', $guard$perform hub.require_content_unrestricted('brands','view');$guard$),
  ('request_brand', $guard$perform hub.require_content_project_set('brands','edit','{}',true);$guard$),
  ('save_faq_question', $guard$perform hub.require_content_project_set('knowledge','edit','{}',true);$guard$),
  ('approve_faq_question', $guard$perform hub.require_content_project_set('knowledge','approve','{}',true);$guard$),
  ('approve_glossary', $guard$perform hub.require_content_project_set('knowledge','approve','{}',true);$guard$),
  ('save_glossary', $guard$perform hub.require_content_project_set('knowledge','edit','{}',true);$guard$),
  ('require_field_admin', $guard$perform hub.require_content_unrestricted('projects','view');$guard$),
  ('save_content_field', $guard$perform hub.require_content_unrestricted('projects','view');$guard$),
  ('save_contact_domain', $guard$perform hub.require_content_unrestricted('projects','view');$guard$),
  ('media_tag_save', $guard$perform hub.require_content_project_set('projects','edit','{}',true);$guard$),
  ('media_requirement_save', $guard$perform hub.require_content_project_set('projects','approve','{}',true);$guard$),
  ('c4_reference_save', $guard$perform hub.require_content_project_set('projects','approve','{}',true);$guard$),
  ('media_tag_approve', $guard$perform hub.require_content_project_set('projects','approve','{}',true);$guard$),
  ('content_contacts', $guard$perform hub.content_scope_access(kind,ref,'view');$guard$),
  ('save_content_contact', $guard$perform hub.content_scope_access(kind,ref,'edit');$guard$),
  ('save_content_section', $guard$perform hub.content_scope_access(kind,ref,'edit');$guard$),
  ('submit_content_section', $guard$perform hub.content_scope_access(kind,ref,'edit');$guard$),
  ('submit_faq', $guard$perform hub.require_content_project_set('knowledge','edit',hub.content_faq_projects(faq));$guard$),
  ('review_knowledge_question', $guard$perform hub.require_content_project_set('knowledge','edit',array[(select rem_project_id from staging.knowledge_eval_questions where id=question_key)]);$guard$),
  ('knowledge_followup', $guard$perform hub.require_content_project_set('knowledge','view',array[rem_id]);$guard$),
  ('knowledge_model_catalogue', $guard$perform hub.require_content_project_set('knowledge','view',array[rem_id]);$guard$),
  ('publish_knowledge_preview', $guard$perform hub.require_content_project_set('knowledge','approve',array[rem_id]);$guard$),
  ('record_knowledge_gap', $guard$perform hub.require_content_project_set('knowledge','view',array[project]);$guard$),
  ('knowledge_preview_read', $guard$perform hub.require_content_project_set('knowledge','view',array[project]);$guard$),
  ('review_knowledge_candidate', $guard$perform hub.require_content_project_set('knowledge','edit',(select project_ids from staging.knowledge_candidates where id=candidate));perform hub.require_content_project_set('knowledge','edit',projects);$guard$),
  ('lock_knowledge_asset', $guard$perform hub.require_content_project_set('knowledge','approve',(select project_ids from staging.knowledge_candidates where id=candidate));$guard$),
  ('knowledge_link_approved_asset', $guard$perform hub.require_content_project_set('knowledge','approve',(select project_ids from staging.knowledge_candidates where id=candidate));$guard$),
  ('faq_gap_update', $guard$perform hub.require_content_project_set('knowledge','edit',array[(select project_id from hub.content_gaps where id=gap)]);$guard$),
  ('web_history', $guard$perform hub.require_content_source('web_pages',(select to_jsonb(w) from hub.web_pages w where page_key=key),'knowledge','view');$guard$),
  ('web_version_preview', $guard$perform hub.require_content_source('web_pages',(select to_jsonb(w) from hub.web_pages w where page_key=key),'knowledge','view');$guard$),
  ('web_pointer', $guard$perform hub.content_scope_exclusive_lock();perform hub.require_content_source('web_pages',(select to_jsonb(w) from hub.web_pages w where page_key=key),'knowledge','view');$guard$),
  ('publish_project', $guard$perform hub.content_scope_exclusive_lock();perform hub.require_content_project(project_uuid,'projects','view');$guard$),
  ('rollback_project', $guard$perform hub.content_scope_exclusive_lock();perform hub.require_content_project(project_uuid,'projects','view');$guard$),
  ('rollback_project_before_readiness_levels', $guard$perform hub.content_scope_exclusive_lock();perform hub.require_content_project(project_uuid,'projects','view');$guard$),
  ('withdraw_project', $guard$perform hub.content_scope_exclusive_lock();perform hub.require_content_project(project_uuid,'projects','view');$guard$),
  ('publish_brand', $guard$perform hub.content_scope_exclusive_lock();perform hub.content_scope_access('brand',(select public_brand_id from hub.brands where id=brand_uuid),'view');$guard$),
  ('rollback_brand', $guard$perform hub.content_scope_exclusive_lock();perform hub.content_scope_access('brand',(select public_brand_id from hub.brands where id=brand_uuid),'view');$guard$),
  ('withdraw_brand', $guard$perform hub.content_scope_exclusive_lock();perform hub.content_scope_access('brand',(select public_brand_id from hub.brands where id=brand_uuid),'view');$guard$)
 ) x(name,guard) loop
  select p.*,n.nspname into strict fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub' and p.proname=rule.name;
  if fn.prokind<>'f' or fn.proargnames is null and fn.pronargs>0 then raise exception 'Scoped wrapper signature changed: %',rule.name;end if;
  delegate:=rule.name||'_before_scopes';
  if length(delegate)>63 then raise exception 'Scoped delegate name too long';end if;
  select string_agg(quote_ident(fn.proargnames[i]),',' order by i) into args from generate_series(1,fn.pronargs) i;
  args:=coalesce(args,'');result_type:=pg_get_function_result(fn.oid);
  d:=replace(pg_get_functiondef(fn.oid),E'\r\n',E'\n');
  d:=hub.content_definition_replace(d,'FUNCTION hub.'||rule.name||'(','FUNCTION hub.'||delegate||'(');
  d:=replace(d,rule.name||'.',delegate||'.');execute d;
  execute format('revoke all on function hub.%I(%s) from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer',delegate,pg_get_function_identity_arguments(fn.oid));
  if fn.proretset then body:='begin '||rule.guard||' return query select * from hub.'||quote_ident(delegate)||'('||args||'); '||rule.guard||' return;end';
  elsif fn.prorettype='void'::regtype then body:='begin '||rule.guard||' perform hub.'||quote_ident(delegate)||'('||args||'); '||rule.guard||' return;end';
  else body:='declare scoped_result '||format_type(fn.prorettype,null)||';begin '||rule.guard||' scoped_result:=hub.'||quote_ident(delegate)||'('||args||'); '||rule.guard||' return scoped_result;end';end if;
  execute format('create or replace function hub.%I(%s) returns %s language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as %L',rule.name,pg_get_function_arguments(fn.oid),result_type,body);
 end loop;
end $$;

create function hub.require_content_unrestricted(tab text,level text) returns void language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
begin perform hub.content_scope_lock();perform hub.require_permission(tab,level);
 if not hub.content_unrestricted(tab,level) then raise exception 'Unrestricted scope required for global action' using errcode='42501';end if;end $$;
create function hub.require_content_translation_scope(translation uuid,level text) returns void language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare t hub.content_translations;data jsonb;table_name text;begin
 perform hub.content_scope_lock();select * into t from hub.content_translations where id=translation;
 if not found then raise exception 'Translation not found' using errcode='P0002';end if;
 perform hub.require_permission(t.source_tab,level);
 if t.owner_type='facility' then table_name:='project_facilities';select to_jsonb(x) into data from hub.project_facilities x
  where project_id=(t.row_ref->>'project_id')::uuid and facility_code=t.row_ref->>'facility_code';
 elsif t.owner_type='building' then table_name:='project_buildings';select to_jsonb(x) into data from hub.project_buildings x
  where project_id=(t.row_ref->>'project_id')::uuid and building_key=t.row_ref->>'building_key';
 elsif t.owner_type='selling_point' then table_name:='project_selling_points';select to_jsonb(x) into data from hub.project_selling_points x
  where project_id=(t.row_ref->>'project_id')::uuid and point_key=t.owner_key::uuid and revision=(t.row_ref->>'revision')::integer;
 elsif t.owner_type='project' then table_name:='projects';select to_jsonb(x) into data from hub.projects x where id=t.owner_key::uuid;
 elsif t.owner_type='brand' then table_name:='brands';select to_jsonb(x) into data from hub.brands x where id=t.owner_key::uuid;
 elsif t.owner_type='faq' then table_name:='faq_versions';select to_jsonb(x) into data from hub.faq_versions x where id=(t.row_ref->>'id')::uuid and faq_id=t.owner_key::uuid;
 elsif t.owner_type='section' then table_name:='content_section_versions';select to_jsonb(x) into data from hub.content_section_versions x where id=(t.row_ref->>'id')::uuid and section_id=t.owner_key::uuid;
 elsif t.owner_type='question' then table_name:='faq_questions';select to_jsonb(x) into data from hub.faq_questions x where question_key=t.owner_key;
 elsif t.owner_type='promotion' then table_name:='public_promotions';select to_jsonb(x) into data from hub.public_promotions x where id=t.owner_key::uuid;
 elsif t.owner_type='article' then table_name:='article_versions';select to_jsonb(x) into data from hub.article_versions x
  where id=(t.row_ref->>'id')::uuid and article_id=(t.row_ref->>'article_id')::uuid and article_id::text=split_part(t.owner_key,':',1);
 elsif t.owner_type='commercial_type' then table_name:='commercial_types';select to_jsonb(x) into data from hub.commercial_types x where id=t.owner_key::uuid;
 elsif t.owner_type='price' then table_name:='project_prices';select to_jsonb(x) into data from hub.project_prices x where id=t.owner_key::uuid;
 elsif t.owner_type='disclosure' then table_name:='project_disclosures';select to_jsonb(x) into data from hub.project_disclosures x where id=t.owner_key::uuid;
 elsif t.owner_type='sales_term' then table_name:='project_sales_terms';select to_jsonb(x) into data from hub.project_sales_terms x where id=t.owner_key::uuid;
 elsif t.owner_type='programme' then table_name:='project_programmes';select to_jsonb(x) into data from hub.project_programmes x where id=t.owner_key::uuid;
 elsif t.owner_type='construction_progress' then table_name:='project_progress';select to_jsonb(x) into data from hub.project_progress x where id=t.owner_key::uuid;
 elsif t.owner_type='solar_estimate' then table_name:='solar_estimates';select to_jsonb(x) into data from hub.solar_estimates x where id=t.owner_key::uuid;
 elsif t.owner_type='feature' then table_name:='project_features';select to_jsonb(x) into data from hub.project_features x where id=t.owner_key::uuid;
 elsif t.owner_type='place' then table_name:='project_places';select to_jsonb(x) into data from hub.project_places x where id=t.owner_key::uuid;
 else raise exception 'Unsupported translation owner' using errcode='42501';end if;
 perform hub.require_content_source(table_name,data,t.source_tab,level);
end $$;
create function hub.content_translation_scope_allowed(translation uuid,level text) returns boolean language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
begin perform hub.require_content_translation_scope(translation,level);return true;
exception when insufficient_privilege or no_data_found then return false;end $$;
create function hub.content_translation_requester_allowed(account uuid,translation uuid) returns boolean language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare previous text:=current_setting('app.actor_id',true);answer boolean;begin
 perform set_config('app.actor_id',coalesce(account::text,''),true);answer:=hub.content_translation_scope_allowed(translation,'edit');
 perform set_config('app.actor_id',coalesce(previous,''),true);return answer;
exception when others then perform set_config('app.actor_id',coalesce(previous,''),true);raise;end $$;
do $$ declare d text;signature text;begin
 d:=replace(pg_get_functiondef('hub.content_translation_list(text,text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'where source_tab=tab and scope_id=scope','where source_tab=tab and scope_id=scope and hub.content_translation_scope_allowed(t.id,''view'')');execute d;
 foreach signature in array array['hub.review_content_translation(uuid,integer,integer,text)','hub.retry_content_translation(uuid,integer)'] loop
  d:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
  d:=hub.content_definition_replace(d,'actor:=hub.require_permission(t.source_tab,''edit'');',
   'actor:=hub.require_permission(t.source_tab,''edit'');perform hub.require_content_translation_scope(t.id,''edit'');');execute d;
 end loop;
 foreach signature in array array['hub.claim_translation(uuid)','hub.finish_translation(uuid,uuid,text,text,text)'] loop
  d:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
  d:=hub.content_definition_replace(d,'not hub.translation_requester_allowed(j.requested_by,t.source_tab)',
   'not hub.translation_requester_allowed(j.requested_by,t.source_tab) or not hub.content_translation_requester_allowed(j.requested_by,t.id)');execute d;
 end loop;
end $$;

create function hub.content_row_visible(table_name text,row_data jsonb) returns boolean language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare tab text;parent jsonb;ids text[];project_ref text;begin
 if row_data is null then return false;end if;
 if table_name in ('field_catalog','contact_domains') then return hub.can('projects','view') or hub.can('brands','view') or hub.can('knowledge','view');
 elsif table_name='assets' then return hub.can_read_asset((row_data->>'id')::uuid);
 elsif table_name='content_translations' then return hub.content_translation_scope_allowed((row_data->>'id')::uuid,'view');
 elsif table_name='translation_jobs' then return hub.content_translation_scope_allowed((row_data->>'translation_id')::uuid,'view');
 elsif table_name='asset_media_tags' then return hub.can_read_asset((row_data->>'asset_id')::uuid);
 elsif table_name='commercial_type_sources' then select to_jsonb(c) into parent from hub.commercial_types c where id=(row_data->>'commercial_type_id')::uuid;return hub.content_row_visible('commercial_types',parent);
 elsif table_name in ('brand_requests','brand_bulk_runs') then return hub.content_unrestricted('brands','view');
 elsif table_name in ('knowledge_batches','knowledge_followup_batches','website_content_receipts') then return hub.content_unrestricted('knowledge','view');
 elsif table_name='knowledge_promotion_annotations' then return hub.content_source_allowed('knowledge_candidates',(select to_jsonb(c) from staging.knowledge_candidates c where id=(row_data->>'candidate_id')::uuid),'knowledge');
 elsif table_name='knowledge_eval_questions' then
  return hub.content_project_set_allowed('knowledge','view',case when row_data->'project_ids' is not null then array(select jsonb_array_elements_text(row_data->'project_ids')) else array[coalesce(row_data->>'project_id',row_data->>'rem_project_id')] end);
 elsif table_name='publication_release_members' then
  if not (hub.can('releases','view') or hub.can('knowledge','view')) then return false;end if;
  if row_data->>'entity_type'='project' then select to_jsonb(x) into parent from hub.projects x where id=(row_data->>'entity_id')::uuid;return hub.content_row_visible('projects',parent);
  elsif row_data->>'entity_type'='brand' then select to_jsonb(x) into parent from hub.brands x where id=(row_data->>'entity_id')::uuid;return hub.content_row_visible('brands',parent);
  elsif row_data->>'entity_type'='promotion' then select to_jsonb(x) into parent from hub.public_promotions x where id=(row_data->>'entity_id')::uuid;return hub.content_row_visible('public_promotions',parent);end if;return false;
 elsif table_name='publication_releases' then return (hub.can('releases','view') or hub.can('knowledge','view')) and not exists(select 1 from hub.publication_release_members m where m.release_id=(row_data->>'id')::uuid and not hub.content_row_visible('publication_release_members',to_jsonb(m)));
 elsif table_name='content_review_versions' then
  perform hub.content_workflow_source(row_data->>'kind',row_data->'identity','view');return true;
 elsif table_name in ('web_publications','web_changes') then return false;
 end if;
 tab:=case when table_name in ('brands','brand_assets','brand_versions') then 'brands'
  when table_name in ('public_promotions','promotion_versions','promotion_reviews') then 'promotions'
  when table_name in ('content_sections','contacts') then hub.content_scope_tab(row_data->>'scope_type')
  when table_name='content_section_versions' then (select hub.content_scope_tab(scope_type) from hub.content_sections where id=(row_data->>'section_id')::uuid)
  when table_name in ('faqs','faq_versions','faq_sources','faq_questions','faq_question_versions','translation_glossary','articles','article_versions','article_links','businesses','knowledge_topics',
   'knowledge_candidates','knowledge_reviews','knowledge_fact_candidates','knowledge_asset_links','knowledge_evaluation_reviews','entity_aliases','content_gaps','knowledge_preview_releases','knowledge_preview_chunks','project_fact_cards','faq_clusters','faq_intake_decisions','web_pages') then 'knowledge' else 'projects' end;
 if not hub.content_source_allowed(table_name,row_data,tab) then return false;end if;
 -- Raw rows containing descendant identifiers require every named source. The
 -- staff read projections separately return own content with filtered references.
 if table_name in ('faq_versions','content_section_versions','knowledge_candidates','knowledge_reviews','knowledge_fact_candidates','knowledge_preview_chunks','faq_clusters')
  or table_name='content_sections' and row_data->>'candidate_id' is not null and row_data->>'section_key' is null then
  ids:=hub.content_source_projects(table_name,row_data);
  foreach project_ref in array ids loop if not hub.content_project_allowed(tab,'view',project_ref) then return false;end if;end loop;
 end if;
 if table_name in ('project_disclosures','project_commercial_versions') and not
  (hub.content_source_allowed(table_name,row_data,'projects','edit') or hub.content_source_allowed(table_name,row_data,'projects','approve')) then return false;end if;
 return true;
exception when insufficient_privilege or no_data_found then return false;end $$;

-- Add restrictive predicates; original owner/operator/public policies and all
-- stronger legal/snapshot predicates remain. This grants no table or DML access.
do $$ declare r record;begin
 for r in select * from (values ('hub','projects'),('hub','model_types'),('hub','entity_assets'),('hub','entity_versions'),('hub','commercial_types'),('hub','commercial_type_sources'),('hub','commercial_type_assets'),('hub','facility_taxonomy'),('hub','project_facilities'),('hub','project_progress_cache'),('hub','project_progress_dirty'),('hub','brands'),('hub','brand_versions'),('hub','brand_assets'),('hub','brand_requests'),('hub','brand_bulk_runs'),('hub','assets'),('hub','public_promotions'),('hub','promotion_reviews'),('hub','promotion_versions'),('hub','publication_releases'),('hub','publication_release_members'),('hub','knowledge_reviews'),('hub','content_sections'),('hub','faqs'),('hub','entity_aliases'),('hub','content_gaps'),('hub','knowledge_fact_candidates'),('hub','knowledge_asset_links'),('hub','knowledge_evaluation_reviews'),('hub','knowledge_preview_releases'),('hub','field_catalog'),('hub','project_facts'),('hub','project_buildings'),('hub','project_selling_points'),('hub','contact_domains'),('hub','contacts'),('hub','knowledge_topics'),('hub','faq_questions'),('hub','faq_question_versions'),('hub','content_section_versions'),('hub','faq_versions'),('hub','faq_sources'),('hub','translation_glossary'),('hub','content_translations'),('hub','translation_jobs'),('hub','media_tags'),('hub','asset_media_tags'),('hub','asset_links'),('hub','media_requirements'),('hub','media_links'),('hub','media_link_targets'),('hub','media_jobs'),('hub','commercial_type_versions'),('hub','project_prices'),('hub','project_price_versions'),('hub','faq_intake_decisions'),('hub','project_disclosures'),('hub','project_sales_terms'),('hub','project_programmes'),('hub','project_progress'),('hub','project_commercial_versions'),('hub','feature_catalog'),('hub','project_features'),('hub','solar_estimates'),('hub','project_places'),('hub','ref_rail_lines'),('hub','ref_rail_stations'),('hub','ref_expressways'),('hub','ref_expressway_ramps'),('hub','articles'),('hub','article_versions'),('hub','article_links'),('hub','web_pages'),('hub','web_publications'),('hub','web_changes'),('hub','website_asset_suggestions'),('hub','content_review_versions'),('staging','knowledge_batches'),('staging','knowledge_candidates'),('staging','knowledge_followup_batches'),('staging','knowledge_eval_questions'),('staging','knowledge_promotion_annotations'),('staging','faq_clusters'),('staging','website_content_receipts'),('rag','knowledge_preview_chunks'),('rag','project_fact_cards')) x(schema_name,table_name) loop
  execute format('create policy content_object_scope on %I.%I as restrictive to hub_app,editor,publisher,viewer,admin,online_staff,agency using(hub.content_row_visible(%L,to_jsonb(%I))) with check(false)',r.schema_name,r.table_name,r.table_name,r.table_name);
 end loop;
end $$;

create function hub.content_project_rows(tab text) returns setof hub.projects language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$ select p.* from hub.projects p where hub.content_project_allowed(tab,'view',p.rem_project_id) $$;
create function hub.content_brand_rows(tab text) returns setof hub.brands language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$ select b.* from hub.brands b where hub.content_project_set_allowed(tab,'view',hub.content_scope_projects('brand',b.public_brand_id)) $$;
create function hub.content_rem_project_rows(tab text) returns setof staging.rem_projects language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$ select p.* from staging.rem_projects p where hub.content_project_allowed(tab,'view',p.rem_project_id) $$;
create function hub.content_rem_brand_rows() returns setof staging.rem_brands language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$ select b.* from staging.rem_brands b where hub.content_unrestricted('brands','view') or exists(
 select 1 from hub.brands h where h.rem_brand_id=b.rem_brand_id and h.deleted_at is null
 and hub.content_scope_allowed('brand',h.public_brand_id,'view')) or (
 not exists(select 1 from hub.brands h where h.rem_brand_id=b.rem_brand_id) and exists(
 select 1 from staging.rem_projects p where p.rem_brand_id=b.rem_brand_id and hub.content_project_allowed('brands','view',p.rem_project_id))) $$;
create function hub.content_progress_rows() returns setof hub.project_progress_cache language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$ select p.* from hub.project_progress_cache p where hub.content_project_allowed('projects','view',p.rem_project_id) $$;
create function hub.content_progress_dirty_rows() returns setof hub.project_progress_dirty language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$ select p.* from hub.project_progress_dirty p where hub.content_project_allowed('projects','view',p.rem_project_id) $$;
create function hub.content_faq_rows() returns setof hub.faqs language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$ select f.* from hub.faqs f where hub.content_source_allowed('faqs',to_jsonb(f),'knowledge') $$;
create function hub.content_article_rows() returns setof hub.articles language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$ select a.* from hub.articles a where hub.content_source_allowed('articles',to_jsonb(a),'knowledge') $$;
create function hub.content_promotion_rows() returns setof hub.public_promotions language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$ select p.* from hub.public_promotions p where hub.content_source_allowed('public_promotions',to_jsonb(p),'promotions') $$;
create function hub.content_candidate_rows() returns setof staging.knowledge_candidates language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$ select c.* from staging.knowledge_candidates c where hub.content_row_visible('knowledge_candidates',to_jsonb(c)) $$;
create function hub.content_cluster_rows() returns setof staging.faq_clusters language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$ select c.* from staging.faq_clusters c where hub.content_row_visible('faq_clusters',to_jsonb(c)) $$;

-- Scope before aggregation, facets, limits or pagination in this finite read set.
do $$ declare rule record;fn record;d text;changed text;matched integer;begin
 for rule in select * from (values
  ('list_rem_projects','hub.projects','hub.content_project_rows(''projects'')'),
  ('list_rem_projects','staging.rem_projects','hub.content_rem_project_rows(''projects'')'),
  ('source_project_readiness','hub.projects','hub.content_project_rows(''projects'')'),
  ('source_project_readiness','staging.rem_projects','hub.content_rem_project_rows(''projects'')'),
  ('list_rem_brands','hub.brands','hub.content_brand_rows(''brands'')'),
  ('list_rem_brands','staging.rem_projects','hub.content_rem_project_rows(''brands'')'),
  ('list_rem_brands','staging.rem_brands','hub.content_rem_brand_rows()'),
  ('list_brands','hub.brands','hub.content_brand_rows(''brands'')'),
  ('brand_completeness','hub.brands','hub.content_brand_rows(''brands'')'),
  ('brand_detail_before_completeness','hub.projects','hub.content_project_rows(''brands'')'),
  ('progress_inputs','hub.project_progress_cache','hub.content_progress_rows()'),
  ('progress_inputs','hub.project_progress_dirty','hub.content_progress_dirty_rows()'),
  ('faq_references','hub.projects','hub.content_project_rows(''knowledge'')'),
  ('faq_references','staging.rem_projects','hub.content_rem_project_rows(''knowledge'')'),
  ('faq_references','hub.brands','hub.content_brand_rows(''knowledge'')'),
  ('faq_coverage','hub.projects','hub.content_project_rows(''projects'')'),
  ('faq_gaps','hub.projects','hub.content_project_rows(''projects'')'),
  ('knowledge_candidate_rows','staging.knowledge_candidates','hub.content_candidate_rows()'),
  ('faq_intake_clusters','staging.faq_clusters','hub.content_cluster_rows()'),
  ('faq_intake_cluster','staging.faq_clusters','hub.content_cluster_rows()'),
  ('faq_intake_cluster','hub.faqs','hub.content_faq_rows()'),
  ('promotion_read','hub.public_promotions','hub.content_promotion_rows()'),
  ('release_candidates','hub.projects','hub.content_project_rows(''projects'')'),
  ('release_candidates','hub.brands','hub.content_brand_rows(''brands'')'),
  ('release_candidates','hub.public_promotions','hub.content_promotion_rows()'),
  ('publication_release_candidates','hub.projects','hub.content_project_rows(''projects'')'),
  ('publication_release_candidates','hub.brands','hub.content_brand_rows(''brands'')'),
  ('publication_release_candidates','hub.public_promotions','hub.content_promotion_rows()'),
  ('article_list','hub.articles','hub.content_article_rows()'),
  ('article_references','hub.projects','hub.content_project_rows(''knowledge'')'),
  ('article_references','hub.brands','hub.content_brand_rows(''knowledge'')'),
  ('website_media_projects','hub.projects','hub.content_project_rows(''projects'')')
 ) x(name,relation,replacement) loop
  matched:=0;
  for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub' and p.proname in (rule.name,rule.name||'_before_scopes') loop
   d:=replace(pg_get_functiondef(fn.oid),E'\r\n',E'\n');
   changed:=regexp_replace(d,'(from|join) ([[:space:]]*)'||replace(rule.relation,'.','\.')||'\M','\1 \2'||rule.replacement,'gi');
   if changed<>d then execute changed;matched:=matched+1;end if;
  end loop;
  if matched<>1 then raise exception 'Scoped read relation drift: %/% (%)',rule.name,rule.relation,matched;end if;
 end loop;
end $$;

create or replace function hub.workspace_project_bu() returns table(project_id uuid,rem_bu_id text,rem_bu_code text,rem_bu_name text,source_snapshot_at timestamptz)
language sql volatile security definer set search_path=pg_catalog,pg_temp as $$
 select p.id,m.rem_bu_id,m.rem_bu_code,m.rem_bu_name,m.source_snapshot_at from hub.projects p
 join hub.content_scope_state s on true join hub.content_bu_membership m on m.run_id=s.accepted_run_id and m.project_id=p.rem_project_id
 where p.deleted_at is null and hub.content_scope_allowed('project',p.public_project_id,'view')
$$;
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_scope_matches(text,text,text[],text,text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'left join staging.dw_projects d using(rem_project_id)',
  'left join hub.content_bu_membership d on d.project_id=p.rem_project_id and d.run_id=(select accepted_run_id from hub.content_scope_state)');
 d:=hub.content_definition_replace(d,'d.source_record->>''rem_bu_id''=bud','d.rem_bu_id=bud');execute d;
 d:=replace(pg_get_functiondef('hub.release_read(uuid)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'hub.can(hub.content_member_tab(m.entity_type),''view'')',
  'hub.can(hub.content_member_tab(m.entity_type),''view'') and hub.content_row_visible(''publication_release_members'',to_jsonb(m))');execute d;
 d:=replace(pg_get_functiondef('hub.publication_write_lock()'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,$old$perform pg_advisory_xact_lock(hashtextextended('hub-web-publications',0));
 perform pg_advisory_xact_lock(hashtextextended('hub-account-decisions',0));$old$,
  $new$perform hub.content_scope_exclusive_lock();
 perform pg_advisory_xact_lock(hashtextextended('hub-web-publications',0));$new$);execute d;
end $$;

-- Partial shared FAQ reads expose their own text and only authorized REM refs.
create function hub.content_scope_redact(value jsonb,tab text) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare result jsonb:='{}';entry record;visible jsonb;begin
 if jsonb_typeof(value)='array' then return coalesce((select jsonb_agg(hub.content_scope_redact(x,tab)) from jsonb_array_elements(value) x),'[]');end if;
 if jsonb_typeof(value) is distinct from 'object' then return value;end if;
 for entry in select * from jsonb_each(value) loop
  if entry.key in ('applies_to_project_ids','project_ids') and jsonb_typeof(entry.value)='array' then
   select coalesce(jsonb_agg(x),'[]') into visible from jsonb_array_elements(entry.value) x where jsonb_typeof(x)='string' and
    hub.content_project_allowed(tab,'view',coalesce((select rem_project_id from hub.projects where public_project_id=x#>>'{}' or id::text=x#>>'{}'),x#>>'{}'));
   result:=result||jsonb_build_object(entry.key,visible,'applicability_complete',visible=entry.value);
  else result:=result||jsonb_build_object(entry.key,hub.content_scope_redact(entry.value,tab));end if;
 end loop;return result;
end $$;
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.faq_read(uuid)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'from hub.faqs f','from hub.content_faq_rows() f');
 d:=hub.content_definition_replace(d,'if not exists(select 1 from hub.faqs where id=faq)',
  'if not exists(select 1 from hub.content_faq_rows() where id=faq)');
 d:=hub.content_definition_replace(d,'return (select jsonb_build_object(', 'return hub.content_scope_redact((select jsonb_build_object(');
 d:=hub.content_definition_replace(d,'from hub.content_faq_rows() f where id=faq);',
  'from hub.content_faq_rows() f where id=faq),''knowledge'');');execute d;
 d:=replace(pg_get_functiondef('hub.save_faq(uuid,integer,jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'edited:=jsonb_populate_record(null::hub.faq_versions,body);',
  $new$edited:=jsonb_populate_record(null::hub.faq_versions,body);
  if prior.id is not null then perform hub.require_content_project_set('knowledge','edit',hub.content_faq_projects(prior.id));end if;
  if coalesce(edited.applicability_rule,'{}')='{}' and prior.id is not null then
   edited.applies_to_project_ids:=array(select distinct x from unnest(coalesce(edited.applies_to_project_ids,'{}')||array(
    select unnest(v.applies_to_project_ids) from hub.faq_versions v where v.id=prior.draft_version_id)) x
    where x=any(coalesce(edited.applies_to_project_ids,'{}')) or not hub.content_project_allowed('knowledge','view',x));
  end if;$new$);
 d:=hub.content_definition_replace(d,'if prior.id is null then',
  $new$perform hub.require_content_project_set('knowledge','edit',case when kind='project' then array[ref]
   when kind='unit_type' then hub.content_scope_projects(kind,ref) when coalesce(edited.applicability_rule,'{}')<>'{}' then hub.faq_rule_projects(edited.applicability_rule,kind,ref)
   when cardinality(edited.applies_to_project_ids)>0 then edited.applies_to_project_ids
   when kind='corporate' and q.show_on_project_pages then hub.content_scope_projects('corporate','sena') else '{}'::text[] end);
  if prior.id is null then$new$);execute d;
end $$;

-- Exact logical-time snapshots are private evidence utilities, never authorization
-- entry points. Runtime policy callers always obtain trusted current time.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.content_scope_effects(uuid[])'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'FUNCTION hub.content_scope_effects(account_ids uuid[] DEFAULT NULL::uuid[])',
  'FUNCTION hub.content_scope_effects_at(account_ids uuid[], at_time timestamp with time zone)');
 d:=hub.content_definition_replace(d,'moment timestamptz:=hub.content_scope_now()','moment timestamptz:=at_time');execute d;
end $$;
create function hub.content_scope_epoch_changed() returns trigger language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.content_scope_exclusive_lock();
 update hub.content_scope_state set authorization_epoch=authorization_epoch+1 where singleton;
 return null;
end $$;
create trigger content_scope_grant_epoch after insert or update or delete on hub.account_permission for each statement execute function hub.content_scope_epoch_changed();
create trigger content_scope_identity_epoch after update of status,hub_role,legacy_hub_role on hub.user_account for each row
 when (old.status is distinct from new.status or old.hub_role is distinct from new.hub_role or old.legacy_hub_role is distinct from new.legacy_hub_role)
 execute function hub.content_scope_epoch_changed();

-- Existing account commands continue their original guards/writes. Independent
-- scope rows are never deleted by a template/grant operation. Record the complete
-- effective before/after only at the outer guarded command, in existing history.
do $$ declare name text;fn record;d text;begin
 foreach name in array array['configure_account_access','approve_account_access','decide_account','apply_account_permissions','accept_account_invite'] loop
  select p.* into strict fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub' and p.proname=name;
  d:=replace(pg_get_functiondef(fn.oid),E'\r\n',E'\n');
  d:=hub.content_definition_replace(d,'FUNCTION hub.'||name||'(','FUNCTION hub.'||name||'_before_scopes(');
  d:=replace(d,name||'.',name||'_before_scopes.');
  if name='decide_account' then
   d:=hub.content_definition_replace(d,'hub.configure_account_access(', 'hub.configure_account_access_before_scopes(');
   d:=hub.content_definition_replace(d,'hub.approve_account_access(', 'hub.approve_account_access_before_scopes(');
  end if;
  execute d;execute format('revoke all on function hub.%I(%s) from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer',name||'_before_scopes',pg_get_function_identity_arguments(fn.oid));
 end loop;
end $$;
create or replace function hub.configure_account_access(target uuid,p jsonb) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare prior jsonb;result jsonb;stamp timestamptz;begin
 perform hub.content_scope_exclusive_lock();if not hub.account_admin() then raise exception 'Account administration required' using errcode='42501';end if;
 stamp:=hub.content_scope_now();prior:=hub.content_scope_effects_at(array[target],stamp);
 result:=hub.configure_account_access_before_scopes(target,p);
 perform hub.content_scope_record_effects(prior,hub.content_scope_effects_at(array[target],stamp),'base_change',stamp,(select accepted_run_id from hub.content_scope_state));return result;
end $$;
create or replace function hub.approve_account_access(target uuid,p jsonb) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare prior jsonb;result jsonb;stamp timestamptz;begin
 perform hub.content_scope_exclusive_lock();if not hub.account_admin() then raise exception 'Account administration required' using errcode='42501';end if;
 stamp:=hub.content_scope_now();prior:=hub.content_scope_effects_at(array[target],stamp);
 result:=hub.approve_account_access_before_scopes(target,p);
 perform hub.content_scope_record_effects(prior,hub.content_scope_effects_at(array[target],stamp),'account_status',stamp,(select accepted_run_id from hub.content_scope_state));return result;
end $$;
create or replace function hub.decide_account(target uuid,action text,new_role text,agency text,note text,expected timestamptz) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare prior jsonb;result jsonb;stamp timestamptz;begin
 perform hub.content_scope_exclusive_lock();if not hub.account_admin() then raise exception 'Account administration required' using errcode='42501';end if;
 stamp:=hub.content_scope_now();prior:=hub.content_scope_effects_at(array[target],stamp);
 result:=hub.decide_account_before_scopes(target,action,new_role,agency,note,expected);
 perform hub.content_scope_record_effects(prior,hub.content_scope_effects_at(array[target],stamp),'account_status',stamp,(select accepted_run_id from hub.content_scope_state));return result;
end $$;
create or replace function hub.apply_account_permissions(p jsonb,expected_digest text) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare prior jsonb;result jsonb;stamp timestamptz;ids uuid[];preview jsonb;begin
 perform hub.content_scope_exclusive_lock();if not hub.account_admin() then raise exception 'Account administration required' using errcode='42501';end if;
 if p#>>'{change,kind}'='content_scope' then return hub.content_scope_batch_apply(p,expected_digest);end if;
 preview:=hub.permission_batch_preview(p);select array_agg((x->>'account_id')::uuid) into ids from jsonb_array_elements(preview->'targets') x;
 stamp:=hub.content_scope_now();prior:=hub.content_scope_effects_at(coalesce(ids,'{}'),stamp);
 result:=hub.apply_account_permissions_before_scopes(p,expected_digest);
 perform hub.content_scope_record_effects(prior,hub.content_scope_effects_at(coalesce(ids,'{}'),stamp),'base_change',stamp,(select accepted_run_id from hub.content_scope_state));return result;
end $$;
create or replace function hub.accept_account_invite(p jsonb) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare prior jsonb;result jsonb;stamp timestamptz;actor uuid:=hub.permission_actor();begin
 perform hub.content_scope_exclusive_lock();
 stamp:=hub.content_scope_now();prior:=hub.content_scope_effects_at(array[actor],stamp);
 result:=hub.accept_account_invite_before_scopes(p);
 perform hub.content_scope_record_effects(prior,hub.content_scope_effects_at(array[actor],stamp),'account_status',stamp,(select accepted_run_id from hub.content_scope_state));return result;
end $$;
create function hub.content_scope_identity() returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
begin
 if not exists(select 1 from hub.user_account where id=hub.permission_actor() and status='ACTIVE' and hub_role in ('viewer','editor','publisher','admin','online_staff')) then return null;end if;
 return hub.content_scope_fingerprint();
end $$;
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.content_scope_batch_apply(jsonb,text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'before_rows:=hub.content_scope_effects(ids);stamp:=hub.content_scope_now();',
  'stamp:=hub.content_scope_now();before_rows:=hub.content_scope_effects_at(ids,stamp);');
 d:=hub.content_definition_replace(d,'hub.content_scope_effects(ids),''scope_change''','hub.content_scope_effects_at(ids,stamp),''scope_change''');
 d:=hub.content_definition_replace(d,'return jsonb_build_object(''batch_id'',batch',
  $new$if preview#>>'{scope_state,expires_at}' is not null and hub.content_scope_now()>=(preview#>>'{scope_state,expires_at}')::timestamptz then raise exception 'Scope preview expired' using errcode='40001',detail='permission_preview_stale';end if;
 return jsonb_build_object('batch_id',batch$new$);execute d;
 d:=replace(pg_get_functiondef('hub.content_scope_settings_apply(integer,bigint,text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'before_rows:=hub.content_scope_effects();stamp:=hub.content_scope_now();',
  'stamp:=hub.content_scope_now();before_rows:=hub.content_scope_effects_at(null,stamp);');
 d:=hub.content_definition_replace(d,'hub.content_scope_effects(),''settings_change''','hub.content_scope_effects_at(null,stamp),''settings_change''');
 d:=hub.content_definition_replace(d,'return hub.content_scope_settings_read();',
  $new$if preview#>>'{scope_state,expires_at}' is not null and hub.content_scope_now()>=(preview#>>'{scope_state,expires_at}')::timestamptz then raise exception 'Settings preview expired' using errcode='40001',detail='permission_preview_stale';end if;
 return hub.content_scope_settings_read();$new$);execute d;
end $$;

-- Additional exact source entries preserve the ordinary commands' validators.
do $$ declare rule record;fn record;d text;delegate text;args text;body text;result_type text;begin
 for rule in select * from (values
  ('article_save',$g$perform hub.content_scope_lock();if article is not null then perform hub.require_content_source('articles',(select to_jsonb(a) from hub.articles a where id=article),'knowledge','edit');end if;$g$),
  ('article_submit',$g$perform hub.require_content_source('articles',(select to_jsonb(a) from hub.articles a where id=article),'knowledge','edit');$g$),
  ('article_review',$g$perform hub.require_content_source('articles',(select to_jsonb(a) from hub.articles a where id=article),'knowledge','approve');$g$),
  ('article_read',$g$perform hub.require_content_source('articles',(select to_jsonb(a) from hub.articles a where id=article),'knowledge','view');$g$),
  ('article_preview',$g$perform hub.require_content_source('articles',(select to_jsonb(a) from hub.articles a where id=article),'knowledge','view');$g$),
  ('content_workflow_submit',$g$perform hub.content_workflow_source(kind,identity,'edit');$g$),
  ('content_workflow_review',$g$perform hub.content_workflow_source(kind,identity,case when decision='withdraw' and kind='faq' and exists(select 1 from hub.faqs f join hub.faq_versions v on v.id=f.draft_version_id where f.id=(identity->>'id')::uuid and v.state in ('DRAFT','WITHDRAWN') and v.approved_by is null and v.created_by=hub.permission_actor()) then 'edit' else 'approve' end);$g$),
  ('content_workflow_save_approve',$g$perform hub.content_workflow_source(kind,identity,'edit');$g$),
  ('release_publish',$g$perform hub.content_scope_exclusive_lock();$g$),
  ('release_rollback',$g$perform hub.content_scope_exclusive_lock();$g$),
  ('publication_queue_publish',$g$perform hub.content_scope_exclusive_lock();$g$),
  ('web_prepare',$g$perform hub.content_scope_exclusive_lock();$g$),
  ('web_page_save',$g$perform hub.content_scope_lock();$g$),
  ('claim_translation',$g$perform hub.content_scope_lock();$g$),
  ('finish_translation',$g$perform hub.content_scope_lock();$g$),
  ('media_claim',$g$perform hub.content_scope_lock();$g$),
  ('media_finish',$g$perform hub.content_scope_lock();$g$)
 ) x(name,guard) loop
  select p.* into strict fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub' and p.proname=rule.name;
  delegate:=rule.name||'_before_scopes';d:=replace(pg_get_functiondef(fn.oid),E'\r\n',E'\n');
  d:=hub.content_definition_replace(d,'FUNCTION hub.'||rule.name||'(','FUNCTION hub.'||delegate||'(');
  d:=replace(d,rule.name||'.',delegate||'.');execute d;
  execute format('revoke all on function hub.%I(%s) from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer',delegate,pg_get_function_identity_arguments(fn.oid));
  select string_agg(quote_ident(fn.proargnames[i]),',' order by i) into args from generate_series(1,fn.pronargs) i;args:=coalesce(args,'');result_type:=pg_get_function_result(fn.oid);
  body:='declare scoped_result '||format_type(fn.prorettype,null)||';begin '||rule.guard||' scoped_result:=hub.'||quote_ident(delegate)||'('||args||'); '||rule.guard||' return scoped_result;end';
  execute format('create or replace function hub.%I(%s) returns %s language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as %L',rule.name,pg_get_function_arguments(fn.oid),result_type,body);
 end loop;
end $$;
-- A newly created article is checked using its saved owning scope in the same
-- transaction. Failure rolls back the ordinary writer, including translations.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.article_save(uuid,integer,jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'return scoped_result;',
  $new$perform hub.require_content_source('articles',(select to_jsonb(a) from hub.articles a where id=(scoped_result->>'id')::uuid),'knowledge','edit');return scoped_result;$new$);execute d;
 d:=replace(pg_get_functiondef('hub.media_job_allowed(hub.media_jobs)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'perform hub.require_permission(''projects'',''edit'');',
  'perform hub.require_permission(''projects'',''edit'');perform hub.require_content_project(job.project_id,''projects'',''edit'');');execute d;
end $$;

create function hub.content_gap_rows() returns setof hub.content_gaps language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$ select x.* from hub.content_gaps x where hub.content_project_set_allowed('knowledge','view',array[x.project_id]) $$;
-- Shared references are checked before every read aggregation. The original
-- source-only composer graph remains private for separate published consumers.
create function hub.content_media_link_rows() returns setof hub.media_links language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$ select x.* from hub.media_links x where hub.content_source_allowed('media_links',to_jsonb(x),'projects') $$;
create function hub.content_programme_rows(tab text) returns setof hub.project_programmes language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$ select x.* from hub.project_programmes x where hub.content_source_allowed('project_programmes',to_jsonb(x),tab) $$;
create function hub.content_unit_rows(tab text) returns setof hub.commercial_types language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$ select x.* from hub.commercial_types x where hub.content_source_allowed('commercial_types',to_jsonb(x),tab) $$;
do $$ declare rule record;fn record;d text;changed text;matched integer;begin
 for rule in select * from (values
  ('faq_references','hub.commercial_types','hub.content_unit_rows(''knowledge'')'),
  ('article_references','hub.project_programmes','hub.content_programme_rows(''projects'')'),
  ('article_references','hub.media_links','hub.content_media_link_rows()'),
  ('article_preview_before_scopes','hub.projects','hub.content_project_rows(''projects'')'),
  ('article_preview_before_scopes','hub.media_links','hub.content_media_link_rows()'),
  -- Keep question/id predicates beside the guard; avoid an all-FAQ scan per lookup.
  ('workspace_faq','hub.faqs','(select scoped_faq.* from hub.faqs scoped_faq where hub.content_source_allowed(''faqs'',to_jsonb(scoped_faq),''knowledge''))'),
  ('workspace_faq','staging.faq_clusters','hub.content_cluster_rows()'),
  ('workspace_page','hub.projects','hub.content_project_rows(''projects'')'),
  ('workspace_preview','hub.projects','hub.content_project_rows(''projects'')'),
  ('workspace_home','hub.projects','hub.content_project_rows(''projects'')'),
  ('workspace_home','hub.brands','hub.content_brand_rows(''brands'')'),
  ('workspace_home','hub.content_gaps','hub.content_gap_rows()')
 ) x(name,relation,replacement) loop
  select p.oid into strict fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub' and p.proname=rule.name;
  d:=replace(pg_get_functiondef(fn.oid),E'\r\n',E'\n');changed:=regexp_replace(d,'(from|join) ([[:space:]]*)'||replace(rule.relation,'.','\.')||'\M','\1 \2'||rule.replacement,'gi');
  if changed=d then raise exception 'Scoped reference relation drift: %/%',rule.name,rule.relation;end if;execute changed;
 end loop;
end $$;

-- Full applicability is used for authorization; display references are filtered.
-- A reference-only result never substitutes for source-tab content permission.
create function hub.content_article_node_projection(value jsonb) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare result jsonb:='{}';entry record;begin
 if jsonb_typeof(value)='array' then return coalesce((select jsonb_agg(v) from (select hub.content_article_node_projection(x) v from jsonb_array_elements(value) x) visible where v is not null),'[]');end if;
 if jsonb_typeof(value) is distinct from 'object' then return value;end if;
 if value->>'type' in ('projectCard','faqEmbed') and not hub.content_scope_allowed('project',value#>>'{attrs,project_id}','view') then
  return jsonb_build_object('type',value->>'type','attrs',case when value->>'type'='faqEmbed' then '{"project_id":"","question_key":""}'::jsonb else '{"project_id":""}'::jsonb end);end if;
 if value->>'type'='libraryImage' and not hub.can_read_asset((value#>>'{attrs,asset_id}')::uuid) then return '{"type":"libraryImage","attrs":{"asset_id":""}}'::jsonb;end if;
 if value->>'type'='mediaVideo' and not hub.content_source_allowed('media_links',(select to_jsonb(l) from hub.media_links l where id=(value#>>'{attrs,media_link_id}')::uuid),'projects') then return '{"type":"mediaVideo","attrs":{"media_link_id":""}}'::jsonb;end if;
 for entry in select * from jsonb_each(value) loop
  if entry.key='references' and jsonb_typeof(entry.value)='object' then
   result:=result||jsonb_build_object(entry.key,coalesce((select jsonb_object_agg(k,v) from jsonb_each(entry.value) x(k,v) where case split_part(k,':',1)
    when 'projectCard' then hub.content_scope_allowed('project',split_part(k,':',2),'view')
    when 'faqEmbed' then hub.content_scope_allowed('project',split_part(k,':',2),'view')
    when 'libraryImage' then hub.can_read_asset(split_part(k,':',2)::uuid)
    when 'mediaVideo' then hub.content_source_allowed('media_links',(select to_jsonb(m) from hub.media_links m where id=split_part(k,':',2)::uuid),'projects') else false end),'{}'));
  elsif entry.key='links' and jsonb_typeof(entry.value)='array' then
   result:=result||jsonb_build_object(entry.key,coalesce((select jsonb_agg(x) from jsonb_array_elements(entry.value) x where hub.article_reference_allowed(x->>'kind',x->>'ref')),'[]'));
  elsif entry.key='cover_asset_id' and entry.value<>'null'::jsonb and not hub.can_read_asset((entry.value#>>'{}')::uuid) then result:=result||jsonb_build_object(entry.key,null);
  else result:=result||jsonb_build_object(entry.key,hub.content_article_node_projection(entry.value));end if;
 end loop;return result;
end $$;
create function hub.content_article_version_visible(version uuid) returns boolean language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare v hub.article_versions;begin
 select * into v from hub.article_versions where id=version;if not found then return false;end if;
 return hub.content_article_node_projection(v.blocks)=v.blocks and
  (v.metadata->>'cover_asset_id' is null or hub.can_read_asset((v.metadata->>'cover_asset_id')::uuid)) and
  not exists(select 1 from hub.article_links l where l.version_id=v.id and not hub.article_reference_allowed(l.kind,l.ref));
end $$;
-- Private reference visibility is narrower than permission to edit shared text.
create function hub.content_promotion_reference_visible(kind text,ref text) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare rem_id text;brand_ref text;begin
 if ref is null then return false;end if;
 if kind='brand' then
  select public_brand_id into brand_ref from hub.brands where (id::text=ref or public_brand_id=ref) and deleted_at is null;
  return brand_ref is not null and hub.content_scope_allowed('brand',brand_ref,'view')
   and hub.content_project_set_allowed('promotions','view',hub.content_scope_projects('brand',brand_ref));
 elsif kind='project' then
  select rem_project_id into rem_id from hub.projects where (id::text=ref or public_project_id=ref) and deleted_at is null;
 elsif kind='commercial_type' then
  select p.rem_project_id into rem_id from hub.commercial_types c join hub.projects p on p.id=c.project_id
   where (c.id::text=ref or c.public_commercial_type_id=ref) and c.deleted_at is null and p.deleted_at is null;
 else return false;end if;
 return rem_id is not null and hub.content_project_allowed('promotions','view',rem_id)
  and hub.content_project_allowed('projects','view',rem_id);
end $$;

create or replace function hub.content_promotion_projection(value jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb:='{}';entry record;visible jsonb;complete boolean:=true;begin
 if jsonb_typeof(value)='array' then
  return coalesce((select jsonb_agg(hub.content_promotion_projection(x) order by ordinal)
   from jsonb_array_elements(value) with ordinality entries(x,ordinal)),'[]');end if;
 if jsonb_typeof(value) is distinct from 'object' then return value;end if;
 for entry in select * from jsonb_each(value) loop
  if entry.key='applicability_complete' then
   complete:=complete and entry.value is distinct from 'false'::jsonb;
  elsif entry.key in ('target_project_ids','resolved_project_ids','excluded_project_ids','draft_project_ids','published_project_ids') and jsonb_typeof(entry.value)='array' then
   select coalesce(jsonb_agg(x order by ordinal),'[]') into visible
    from jsonb_array_elements(entry.value) with ordinality entries(x,ordinal)
    where hub.content_promotion_reference_visible('project',x#>>'{}');
   complete:=complete and visible=entry.value;result:=result||jsonb_build_object(entry.key,visible);
  elsif entry.key in ('targets','public_targets') and jsonb_typeof(entry.value)='array' then
   select coalesce(jsonb_agg(x order by ordinal),'[]') into visible
    from jsonb_array_elements(entry.value) with ordinality entries(x,ordinal)
    where hub.content_promotion_reference_visible(x->>'type',coalesce(x->>'id',x->>'public_id'));
   complete:=complete and visible=entry.value;result:=result||jsonb_build_object(entry.key,visible);
  elsif entry.key='items' and value?'scope_hash' and jsonb_typeof(entry.value)='array' then
   select coalesce(jsonb_agg(x order by ordinal),'[]') into visible
    from jsonb_array_elements(entry.value) with ordinality entries(x,ordinal)
    where hub.content_promotion_reference_visible('project',coalesce(x->>'id',x->>'public_id'));
   complete:=complete and visible=entry.value;result:=result||jsonb_build_object(entry.key,visible);
  elsif entry.key='label' and value->>'kind'='brand' and value->>'brand_id' is not null
    and not hub.content_promotion_reference_visible('brand',value->>'brand_id') then
   complete:=false;result:=result||jsonb_build_object('label','{}'::jsonb);
  elsif entry.key in ('project_id','public_project_id','owning_brand_id','public_owning_brand_id','brand_id')
    and entry.value<>'null'::jsonb and not hub.content_promotion_reference_visible(
      case when entry.key in ('owning_brand_id','public_owning_brand_id','brand_id') then 'brand' else 'project' end,entry.value#>>'{}') then
   complete:=false;result:=result||jsonb_build_object(entry.key,null);
  else
   visible:=hub.content_promotion_projection(entry.value);
   if jsonb_typeof(visible)='object' and visible->'applicability_complete'='false'::jsonb then complete:=false;end if;
   result:=result||jsonb_build_object(entry.key,visible);
  end if;
 end loop;
 if not complete then result:=result||jsonb_build_object('applicability_complete',false);end if;
 return result;
end $$;

-- Only omitted inaccessible prior targets are restored. An arbitrary guessed
-- identifier supplied by a caller never gains a new reference exception.
create function hub.content_promotion_scope_input(p_id uuid,expected integer,proposed jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare prior hub.public_promotions;targets jsonb;excluded jsonb;owner_project uuid;owner_brand uuid;begin
 if p_id is not null then
  perform hub.promotion_scope_access(p_id,'view');
  select * into prior from hub.public_promotions where id=p_id;
  if expected is distinct from prior.draft_revision then raise exception 'Promotion revision changed' using errcode='40001';end if;
  owner_project:=prior.project_id;owner_brand:=prior.owning_brand_id;
 else
  owner_project:=(proposed->>'project_id')::uuid;owner_brand:=(proposed->>'owning_brand_id')::uuid;
  if (owner_project is null)=(owner_brand is null) then raise exception 'Invalid promotion ownership' using errcode='22023';end if;
  if not hub.content_promotion_reference_visible(case when owner_project is null then 'brand' else 'project' end,
   coalesce(owner_project,owner_brand)::text) then raise exception 'Promotion owner scope denied' using errcode='42501';end if;
 end if;
 targets:=coalesce(prior.targets,'[]');excluded:=to_jsonb(coalesce(prior.excluded_project_ids,'{}'::uuid[]));
 if proposed?'targets' then
  if jsonb_typeof(proposed->'targets') is distinct from 'array' then raise exception 'Invalid promotion targets' using errcode='22023';end if;
  perform hub.validate_promotion_targets(proposed->'targets');
  if exists(select 1 from jsonb_array_elements(proposed->'targets') x
   where not hub.content_promotion_reference_visible(x->>'type',x->>'id')) then
   raise exception 'Promotion target scope denied' using errcode='42501';end if;
  select coalesce(jsonb_agg(x order by ordinal),'[]') into targets from jsonb_array_elements(targets) with ordinality entries(x,ordinal)
   where not hub.content_promotion_reference_visible(x->>'type',x->>'id');
  targets:=(proposed->'targets')||targets;
 end if;
 if proposed?'excluded_project_ids' then
  if jsonb_typeof(proposed->'excluded_project_ids') is distinct from 'array' then raise exception 'Invalid promotion exclusions' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements_text(proposed->'excluded_project_ids') x
   where not hub.content_promotion_reference_visible('project',x)) then
   raise exception 'Promotion exclusion scope denied' using errcode='42501';end if;
  select coalesce(jsonb_agg(x order by ordinal),'[]') into excluded from jsonb_array_elements(excluded) with ordinality entries(x,ordinal)
   where not hub.content_promotion_reference_visible('project',x#>>'{}');
  excluded:=(proposed->'excluded_project_ids')||excluded;
 end if;
 perform hub.validate_promotion_scope(owner_project,owner_brand,targets,array(select x::uuid from jsonb_array_elements_text(excluded) x));
 return jsonb_build_object('project_id',owner_project,'owning_brand_id',owner_brand,'targets',targets,'excluded_project_ids',excluded);
end $$;


do $$ declare d text;name text;begin
 d:=replace(pg_get_functiondef('hub.project_permission_projection(jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'or hub.can(''brands'',''view'') then',
  $new$or hub.can('brands','view') and (nullif(payload->'brand','null') is null and nullif(payload->'brand_summary','null') is null or hub.content_scope_allowed('brand',coalesce(payload#>>'{brand,public_brand_id}',payload#>>'{brand_summary,public_brand_id}',(select public_brand_id from hub.brands where id::text=coalesce(payload#>>'{brand,id}',payload#>>'{brand_summary,id}'))),'view')) then$new$);execute d;
 foreach name in array array['article_read','article_preview'] loop
  d:=replace(pg_get_functiondef(('hub.'||name||case when name='article_read' then '(uuid)' else '(uuid,text)' end)::regprocedure),E'\r\n',E'\n');
  d:=hub.content_definition_replace(d,'return scoped_result;','return hub.content_article_node_projection(scoped_result);');execute d;
 end loop;
 d:=replace(pg_get_functiondef('hub.content_row_visible(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'if table_name in (''project_disclosures''',
  $new$if table_name='article_versions' and not hub.content_article_version_visible((row_data->>'id')::uuid) then return false;end if;
 if table_name='article_links' and not hub.article_reference_allowed(row_data->>'kind',row_data->>'ref') then return false;end if;
 if table_name in ('project_disclosures'$new$);execute d;
 d:=replace(pg_get_functiondef('hub.promotion_read(uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'from hub.content_promotion_rows() where','from hub.content_promotion_rows() public_promotions where');
 d:=hub.content_definition_replace(d,'return result;','return hub.content_promotion_projection(result);');execute d;
end $$;

-- Guard both old and proposed promotion applicability while retaining DATA/LEGAL,
-- revision, separation and N2 checks in the unchanged dispatcher.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.promotion_command(text,uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,E'\nbegin\n',
  $new$
begin

  if action in ('publish','withdraw','rollback') then perform hub.content_scope_exclusive_lock();else perform hub.content_scope_lock();end if;
  if p_id is not null then perform hub.require_content_source('public_promotions',(select to_jsonb(x) from hub.public_promotions x where id=p_id),'promotions',case when action='review' then 'approve' when action in ('publish','withdraw','rollback') then 'view' else 'edit' end);end if;$new$);
 -- The proposed complete set is checked on the ordinary save's result. A denial
 -- rolls back source rows, translation jobs and audit together.
 d:=hub.content_definition_replace(d,'return hub.promotion_read(r.id);',
  $new$perform hub.require_content_source('public_promotions',(select to_jsonb(x) from hub.public_promotions x where id=r.id),'promotions',case when action='review' then 'approve' when action in ('publish','withdraw','rollback') then 'view' else 'edit' end);return hub.promotion_read(r.id);$new$);execute d;
 d:=replace(pg_get_functiondef('hub.web_page_save(text,integer,jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'return scoped_result;',
  $new$perform hub.require_content_source('web_pages',scoped_result,'knowledge','edit');perform hub.web_assert_sources(hub.web_compose(jsonb_populate_record(null::hub.web_pages,scoped_result)),'view');return scoped_result;$new$);execute d;
end $$;

-- History uses the current exact owner and redacts reference fields from older
-- revisions independently. No audit row or source payload is changed.
-- History needs article authority, not the discarded editor payload containing
-- thirty versions and their translations. Keep the current-source checks on
-- both sides of the exact historical-reference work.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_history_contexts(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'perform hub.article_read(subject);',
  $new$perform hub.require_permission('knowledge','view');
  perform hub.require_content_source('articles',(select to_jsonb(a) from hub.articles a where id=subject),'knowledge','view');$new$);
 d:=hub.content_definition_replace(d,
  $old$where l.article_id=subject and p.deleted_at is null and hub.content_scope_allowed('project',p.public_project_id,'view');$old$,
  $new$where l.article_id=subject and p.deleted_at is null and hub.content_scope_allowed('project',p.public_project_id,'view');
  perform hub.require_content_source('articles',(select to_jsonb(a) from hub.articles a where id=subject),'knowledge','view');$new$);execute d;
end $$;
create function hub.content_history_source_visible(table_name text,value jsonb) returns boolean language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare table_key text:=split_part(table_name,'.',2);tab text;begin
 if value is null or value='null'::jsonb then return true;end if;
 if table_key='content_review_versions' then perform hub.content_workflow_source(value->>'kind',value->'identity','view');return true;end if;
 if table_key in ('web_publications','web_changes','publication_releases') then
  return exists(select 1 from hub.workspace_history_contexts(table_name,value));
 end if;
 if table_key in ('knowledge_batches','knowledge_followup_batches','website_content_receipts') then return hub.content_unrestricted('knowledge','view');end if;
 if table_key='brand_business' then return hub.content_project_set_allowed('knowledge','view',hub.content_scope_projects('business',value->>'business_code')) or hub.content_scope_allowed('brand',(select public_brand_id from hub.brands where id=(value->>'brand_id')::uuid),'view');end if;
 return hub.content_row_visible(table_key,value);
exception when insufficient_privilege or no_data_found or check_violation then return false;end $$;
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_history_visible(audit.change_log)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'return before_fields is distinct from after_fields or action<>''edit'';',
  $new$return (before_fields is distinct from after_fields or action<>'edit') and
    hub.content_history_source_visible(event.table_name,coalesce(nullif(event.after_row,'null'),event.before_row));$new$);execute d;
 d:=replace(pg_get_functiondef('hub.workspace_history_event(audit.change_log,jsonb,boolean)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'changed jsonb;result jsonb;begin',
  $new$changed jsonb;result jsonb;begin
  if not hub.content_history_source_visible(event.table_name,event.before_row) then old_fields:='{}';end if;
  if not hub.content_history_source_visible(event.table_name,event.after_row) then new_fields:='{}';end if;$new$);execute d;
end $$;

-- W2/W3 task selectors filter every native source before readiness or aggregation.
-- The source map is closed; no caller controls a relation name.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_native_rows()'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'FUNCTION hub.workspace_native_rows(','FUNCTION hub.workspace_native_rows_before_scopes(');execute d;
end $$;
create or replace function hub.workspace_native_rows() returns setof jsonb language sql volatile security definer
set search_path=pg_catalog,pg_temp as $$
 select case when r->>'kind'='promotion' then hub.content_promotion_projection(r)||
  jsonb_build_object('scope_type',context.kind,'scope_id',context.ref,
   'phases',(select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements_text(r->'phases') x
    where hub.content_project_allowed('promotions','view',x) and hub.content_project_allowed('projects','view',x)),
   'context',hub.workspace_context(context.kind,context.ref)||jsonb_build_object(
    'promotion',r->'item_id','item',r->'item_id','tab','promotions','field','promotion.title')) else r end
 from hub.workspace_native_rows_before_scopes() r
 left join lateral (
  select r->>'scope_type' kind,r->>'scope_id' ref,0 priority
   where r->>'kind'='promotion' and hub.content_promotion_reference_visible(r->>'scope_type',r->>'scope_id')
  union all
  select 'project',p.public_project_id,1 from hub.promotion_target_projects(
    case when r->>'kind'='promotion' then (r->>'item_id')::uuid end) target
   join hub.projects p on p.id=target.id where r->>'kind'='promotion'
    and hub.content_promotion_reference_visible('project',p.id::text)
  order by priority,ref limit 1
 ) context on true
 where case
  when r->>'kind'='promotion' then context.ref is not null and hub.promotion_scope_visible((r->>'item_id')::uuid)
  when r->>'kind'='glossary' then hub.can('knowledge','view')
  when r->>'table_name' is not null then hub.content_source_allowed(r->>'table_name',hub.web_source(r->>'table_name',r->'identity'),r->>'source_tab')
  else false end
$$;
-- Source records with affected sets are filtered before the older native CTE
-- invokes readiness. This avoids both hidden counts and a denied neighbour
-- turning an otherwise permitted home list into an exception.
do $$ declare rule record;d text;changed text;begin
 for rule in select * from (values
  ('hub.public_promotions','hub.content_promotion_rows()'),('hub.articles','hub.content_article_rows()'),
  ('hub.faqs','hub.content_faq_rows()')
 ) x(relation,replacement) loop
  d:=replace(pg_get_functiondef('hub.workspace_native_rows_before_scopes()'::regprocedure),E'\r\n',E'\n');
  changed:=regexp_replace(d,'(from|join) ([[:space:]]*)'||replace(rule.relation,'.','\.')||'\M','\1 \2'||rule.replacement,'gi');
  if changed=d then raise exception 'Native scoped source drift: %',rule.relation;end if;execute changed;
 end loop;
end $$;

-- Rule resolution keeps its full result, but evaluates project lookups only
-- after cheap membership predicates have identified possible matches.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.faq_rule_projects(jsonb,text,text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'where p.deleted_at is null', 'where case when p.deleted_at is null');
 d:=hub.content_definition_replace(d,$old$and (not rule?'product_forms' or rule->'product_forms' ? hub.faq_project_form(p.id))$old$,'');
 d:=hub.content_definition_replace(d,$old$and (kind<>'business' or hub.business_project_matches(ref,p.rem_project_id))$old$,'');
 d:=hub.content_definition_replace(d,$old$and x.state='approved'));$old$,
  $new$and x.state='approved')) then
   (not rule?'product_forms' or rule->'product_forms' ? hub.faq_project_form(p.id))
   and (kind<>'business' or hub.business_project_matches(ref,p.rem_project_id))
  else false end;$new$);execute d;
end $$;

-- Home needs the detailed media contexts, so compose readiness once instead of
-- building and discarding the older wrapper's media items. Keep both scope checks.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_project_readiness(text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'section text;media jsonb;', 'section text;media jsonb;project_context jsonb;');
 d:=hub.content_definition_replace(d,$old$context:=hub.workspace_context('project',public_id)$old$, 'context:=project_context');
 d:=hub.content_definition_replace(d,'media:=hub.media_checklist(public_id);','');
 d:=hub.content_definition_replace(d,'result:=hub.project_content_readiness(public_id);',
  $new$perform hub.content_scope_access('project',public_id,'view');
 result:=hub.project_content_readiness_before_media(public_id);
 media:=hub.media_checklist(public_id);
 project_context:=hub.workspace_context('project',public_id);
 result:=result||jsonb_build_object('media_recommended_score',media->'recommended_score',
  'required_missing',(result->>'required_missing')::integer+(media->>'required_missing')::integer,
  'ready',(result->>'ready')::boolean and (media->>'required_missing')::integer=0);$new$);
 d:=hub.content_definition_replace(d,'return result||jsonb_build_object(',
  $new$perform hub.content_scope_access('project',public_id,'view');return result||jsonb_build_object($new$);execute d;
 alter function hub.workspace_project_readiness(text) volatile;
 d:=replace(pg_get_functiondef('hub.workspace_home(text,text,integer,integer,text,uuid)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'readiness:=hub.workspace_project_readiness(p.public_project_id);',
  $new$if jsonb_array_length(projects)<page_offset or jsonb_array_length(projects)>=page_offset+page_size then
   readiness:=hub.project_content_readiness(p.public_project_id)-'items';
  else readiness:=hub.workspace_project_readiness(p.public_project_id);end if;$new$);execute d;
end $$;

-- Generic records outside the closed native-kind set cannot match this lookup.
-- Keep each item's current source, approval and publication checks unchanged.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_content_tasks(text,text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'else select n into native from hub.workspace_native_rows() n',
  $new$elsif kind in ('section','faq','unit_type','price','disclosure','sales_term','programme',
   'construction_progress','article','question','glossary','asset','solar','promotion') then
   select n into native from hub.workspace_native_rows() n$new$);execute d;
end $$;

-- Staff assistant evidence uses exact current source scope. This is additional
-- evidence validation only; its tools, proposals and write boundaries stay fixed.
create function internal.assistant_scoped_source(kind text,ref text,version text) returns boolean language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare row_data jsonb;begin
 perform hub.content_scope_lock();
 if kind in ('business','faq','section') then return internal.assistant_saved_source_visible(kind,ref,version);
 elsif kind='project' then return hub.content_scope_allowed('project',ref,'view');
 elsif kind='brand' then return hub.content_scope_allowed('brand',ref,'view');
 elsif kind='model' then
  return exists(select 1 from hub.model_types m join hub.projects p on p.id=m.project_id where (m.id::text=ref or m.public_model_id=ref) and hub.content_project_allowed('projects','view',p.rem_project_id));
 elsif kind='promotion' then select to_jsonb(p) into row_data from hub.public_promotions p where id::text=ref or code=ref;return hub.content_source_allowed('public_promotions',row_data,'promotions');
 end if;
 -- Existing Ads/Finance/Archive kinds retain their own independent guard.
 return kind in ('campaign','media_line','memo','naming_rule');
exception when insufficient_privilege or no_data_found then return false;end $$;
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('internal.assistant_access(text,text,boolean)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'jsonb_build_array(a.id,hub.permission_projection(a))','jsonb_build_array(a.id,hub.permission_projection(a),hub.content_scope_fingerprint())');
 d:=hub.content_definition_replace(d,'''proposal_fields'',fields)', '''proposal_fields'',fields,''scope'',hub.content_scope_fingerprint())');execute d;
 d:=replace(pg_get_functiondef('internal.assistant_content_version(text,text,uuid)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'where p.public_project_id=public_id and p.deleted_at is null and v.id=version_id',
  'where p.public_project_id=public_id and p.deleted_at is null and v.id=version_id and hub.content_scope_allowed(''project'',public_id,''view'')');
 d:=hub.content_definition_replace(d,'where b.public_brand_id=public_id and b.deleted_at is null and v.id=version_id',
  'where b.public_brand_id=public_id and b.deleted_at is null and v.id=version_id and hub.content_scope_allowed(''brand'',public_id,''view'')');execute d;
 d:=replace(pg_get_functiondef('internal.assistant_project_reference(text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'perform hub.require_permission(''promotions'',''view'');',
  'perform hub.require_permission(''promotions'',''view'');perform hub.require_content_project_set(''promotions'',''view'',hub.content_scope_projects(''project'',public_id));');execute d;
 d:=replace(pg_get_functiondef('internal.assistant_citation_read(uuid,uuid)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'return to_jsonb(c)',
  $new$if c.entity_type in ('business','faq','section') then perform internal.assistant_saved_source(c.entity_type,c.entity_id,c.version);
  elsif not internal.assistant_scoped_source(c.entity_type,c.entity_id,c.version) then raise exception 'Citation forbidden' using errcode='42501';end if;return to_jsonb(c)$new$);execute d;
 d:=replace(pg_get_functiondef('internal.assistant_tool_record(uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'insert into internal.assistant_citation(',
  $new$if not internal.assistant_scoped_source(source->>'entity_type',source->>'entity_id',source->>'version') then raise exception 'Citation forbidden' using errcode='42501';end if;insert into internal.assistant_citation($new$);execute d;
 d:=replace(pg_get_functiondef('internal.assistant_run_read(uuid)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'internal.assistant_saved_source_visible(c.entity_type,c.entity_id,c.version)','internal.assistant_scoped_source(c.entity_type,c.entity_id,c.version)');
 d:=hub.content_definition_replace(d,'hub.can(''projects'',''view'') then',
  'hub.can(''projects'',''view'') and (r.scope_project_id is null or hub.content_scope_allowed(''project'',r.scope_project_id,''view'')) then');execute d;
 d:=replace(pg_get_functiondef('internal.assistant_proposal_read(uuid)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'perform hub.require_permission(p.entity_type||''s'',''edit'');',
  'perform hub.require_permission(p.entity_type||''s'',''edit'');perform hub.content_scope_access(p.entity_type,case when p.entity_type=''project'' then (select public_project_id from hub.projects where id=p.entity_id) else (select public_brand_id from hub.brands where id=p.entity_id) end,''edit'');');execute d;
end $$;

create or replace function hub.article_reference_allowed(kind text,ref text) returns boolean
language sql volatile security definer set search_path=pg_catalog,pg_temp as $$
 select case kind when 'project' then exists(select 1 from hub.projects p where p.public_project_id=ref and p.deleted_at is null and hub.content_project_allowed('knowledge','view',p.rem_project_id))
 when 'brand' then exists(select 1 from hub.brands b where b.public_brand_id=ref and b.deleted_at is null and hub.content_project_set_allowed('knowledge','view',hub.content_scope_projects('brand',ref)))
 when 'programme' then hub.can('projects','view') and hub.content_project_set_allowed('projects','view',hub.content_scope_projects('programme',ref))
  and exists(select 1 from hub.project_programmes where programme_key=ref)
 else false end
$$;
-- Confirmed groups require every member's current source View. An excluded
-- member cannot leak through a page's phase array, name or aggregate count.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_confirmed_groups()'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'FUNCTION hub.workspace_confirmed_groups(','FUNCTION hub.workspace_confirmed_groups_before_scopes(');execute d;
end $$;
create or replace function hub.workspace_confirmed_groups() returns table(anchor text,members uuid[],page_key text)
language sql volatile security definer set search_path=pg_catalog,pg_temp as $$
 select g.* from hub.workspace_confirmed_groups_before_scopes() g where not exists(
  select 1 from unnest(g.members) member(project_id) left join hub.projects p on p.id=member.project_id where p.id is null or not hub.content_project_allowed('projects','view',p.rem_project_id))
$$;
-- Pure current reference predicates for the underlying read-only staging rows.
-- These policies do not grant staging access or change any staged value.
do $$ declare d text;table_name text;begin
 d:=replace(pg_get_functiondef('hub.content_row_visible(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'if table_name in (''field_catalog''',
  $new$if table_name in ('rem_projects','dw_projects') then return hub.content_project_allowed('projects','view',row_data->>'rem_project_id');
 elsif table_name='rem_brands' then return hub.content_unrestricted('brands','view') or exists(select 1 from staging.rem_projects p where p.rem_brand_id=row_data->>'rem_brand_id' and hub.content_project_allowed('brands','view',p.rem_project_id));
 elsif table_name='dw_project_groups' then return hub.content_project_set_allowed('projects','view',hub.content_scope_projects('project_group',row_data->>'project_group_id'));
 elsif table_name='source_offers' then return hub.content_unrestricted('promotions','view') or exists(select 1 from hub.public_promotions p where p.source_offer_key=row_data->>'source_offer_key' and hub.content_source_allowed('public_promotions',to_jsonb(p),'promotions'));
 elsif table_name in ('field_catalog'$new$);execute d;
 foreach table_name in array array['rem_projects','rem_brands','dw_projects','dw_project_groups','source_offers'] loop
  execute format('create policy content_object_scope on staging.%I as restrictive to hub_app,editor,publisher,viewer,admin,online_staff,agency using(hub.content_row_visible(%L,to_jsonb(%I))) with check(false)',table_name,table_name,table_name);
 end loop;
 d:=replace(pg_get_functiondef('hub.decide_faq_cluster(uuid,integer,text,jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'actor:=hub.require_permission(''knowledge'',''edit'');',
  $new$actor:=hub.require_permission('knowledge','edit');perform hub.require_content_source('faq_clusters',(select to_jsonb(scoped_cluster) from staging.faq_clusters scoped_cluster where scoped_cluster.id=cluster),'knowledge','edit');$new$);execute d;
 d:=replace(pg_get_functiondef('internal.assistant_proposal_create(jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'perform hub.residential_local();',
  $new$perform hub.content_scope_lock();perform hub.content_scope_access(p->>'entity_type',case when p->>'entity_type'='project' then (select public_project_id from hub.projects where id=(p->>'entity_id')::uuid) else (select public_brand_id from hub.brands where id=(p->>'entity_id')::uuid) end,'edit');perform hub.residential_local();$new$);execute d;
 d:=replace(pg_get_functiondef('internal.assistant_run_create(jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'perform hub.require_permission(''projects'',''view'');',
  $new$perform hub.require_permission('projects','view');perform hub.content_scope_access('project',p->>'scope_project_id','view');$new$);execute d;
 d:=replace(pg_get_functiondef('internal.assistant_run_finish(uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'hub.can(''projects'',''view'') then',
  'hub.can(''projects'',''view'') and (r.scope_project_id is null or hub.content_scope_allowed(''project'',r.scope_project_id,''view'')) then');execute d;
end $$;
-- Pre-lock worker entries that acquire lease/job rows. Their existing requester
-- and source revision guards then run inside the same scope serialization epoch.
do $$ declare signature text;d text;changed text;begin
 foreach signature in array array['hub.media_image_claim(uuid[])','hub.media_image_lease(uuid,uuid)','hub.media_image_begin(uuid,uuid)',
 'hub.media_image_wait(uuid,uuid)','hub.media_image_finish(uuid,uuid,jsonb,text,text,jsonb)','hub.website_media_claim(uuid[])',
 'hub.website_media_finish(uuid,uuid,jsonb,text,text,jsonb)'] loop
  d:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
  changed:=regexp_replace(d,'\mbegin\M','begin perform hub.content_scope_lock();','i');
  if changed=d then raise exception 'Worker scope lock anchor changed: %',signature;end if;execute changed;
 end loop;
end $$;


-- Keep full rule resolution private for save/review; preview reveals only the
-- current intersection of Knowledge and Projects references.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.faq_applicability_preview(jsonb,text,text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'FUNCTION hub.faq_applicability_preview(','FUNCTION hub.faq_applicability_preview_before_scopes(');execute d;
end $$;
create or replace function hub.faq_applicability_preview(rule jsonb,kind text,ref text) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
declare value jsonb;ids jsonb;begin
 value:=hub.faq_applicability_preview_before_scopes(rule,kind,ref);
 select coalesce(jsonb_agg(x),'[]') into ids from jsonb_array_elements(value->'project_ids') x where
  hub.content_project_allowed('projects','view',x#>>'{}') and hub.content_project_allowed('knowledge','view',x#>>'{}');
 return value||jsonb_build_object('project_ids',ids,'affected_count_complete',ids=value->'project_ids',
  'projects',(select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(value->'projects') x where ids ? (x->>'id')),
  'unresolved_forms',(select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(value->'unresolved_forms') x where
   hub.content_project_allowed('projects','view',x->>'id') and hub.content_project_allowed('knowledge','view',x->>'id')));
end $$;
do $$ declare d text;relation text;replacement text;changed text;begin
 for relation,replacement in select * from (values ('hub.projects','hub.content_project_rows(''promotions'')'),
  ('hub.brands','hub.content_brand_rows(''promotions'')'),('hub.commercial_types','hub.content_unit_rows(''promotions'')')) x loop
  d:=replace(pg_get_functiondef('hub.promotion_references()'::regprocedure),E'\r\n',E'\n');
  changed:=regexp_replace(d,'(from|join) ([[:space:]]*)'||replace(relation,'.','\.')||'\M','\1 \2'||replacement,'gi');
  if d=changed then raise exception 'Promotion reference scope anchor drift';end if;execute changed;
 end loop;
 d:=replace(pg_get_functiondef('hub.list_brand_requests()'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'where deleted_at is null','where deleted_at is null and hub.content_unrestricted(''brands'',''view'')');execute d;
 d:=replace(pg_get_functiondef('hub.workspace_scope_matches(text,text,text[],text,text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'FUNCTION hub.workspace_scope_matches(', 'FUNCTION hub.workspace_scope_matches_tab(');
 d:=hub.content_definition_replace(d,'brand text)', 'brand text, tab text)');
 -- Match the association and filters before checking each candidate's authority.
 d:=hub.content_definition_replace(d,'where p.deleted_at is null and', 'where case when p.deleted_at is null and');
 d:=hub.content_definition_replace(d,'and (brand is null or b.public_brand_id=brand))',
  'and (brand is null or b.public_brand_id=brand) then hub.content_project_allowed(tab,''view'',p.rem_project_id) else false end)');execute d;
 d:=replace(pg_get_functiondef('hub.workspace_scope_matches(text,text,text[],text,text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'where p.deleted_at is null and', 'where case when p.deleted_at is null and');
 d:=hub.content_definition_replace(d,'and (brand is null or b.public_brand_id=brand))',
  'and (brand is null or b.public_brand_id=brand) then hub.content_project_allowed(''projects'',''view'',p.rem_project_id) else false end)');execute d;
 d:=replace(pg_get_functiondef('hub.workspace_content_tasks(text,text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'hub.workspace_scope_matches(scope_type,scope_id,phases,bud,brand)',
  'hub.workspace_scope_matches_tab(scope_type,scope_id,phases,bud,brand,source->>''_tab'')');execute d;
 d:=replace(pg_get_functiondef('hub.publication_expiry_tasks(text,text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,$old$hub.workspace_scope_matches(r->>'scope_type',r->>'scope_id',array(select jsonb_array_elements_text(r->'phases')),bud,brand)$old$,
  $new$hub.workspace_scope_matches_tab(r->>'scope_type',r->>'scope_id',array(select jsonb_array_elements_text(r->'phases')),bud,brand,r->>'source_tab')$new$);execute d;
 d:=replace(pg_get_functiondef('hub.content_history_source_visible(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'return hub.content_row_visible(table_key,value);',
  $new$if table_key in ('faqs','faq_versions','faq_sources','articles','article_versions','article_links') then return hub.content_source_allowed(table_key,value,'knowledge');end if;
 return hub.content_row_visible(table_key,value);$new$);execute d;
 d:=replace(pg_get_functiondef('hub.workspace_history_event(audit.change_log,jsonb,boolean)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'changed jsonb;result jsonb;begin',
  $new$changed jsonb;result jsonb;begin
  old_fields:=hub.content_scope_redact(old_fields,context->>'source_tab');new_fields:=hub.content_scope_redact(new_fields,context->>'source_tab');
  if event.table_name in ('hub.articles','hub.article_versions','hub.article_links') then old_fields:=hub.content_article_node_projection(old_fields);new_fields:=hub.content_article_node_projection(new_fields);end if;$new$);execute d;
end $$;


-- The completeness selector starts from the REM brand dictionary. Filter that
-- reference source first; an excluded existing brand must never be relabelled
-- as a visible not-created row or counted through its source project total.
do $$ declare d text;relation text;replacement text;changed text;begin
 for relation,replacement in select * from (values ('hub.brands','hub.content_brand_rows(''brands'')'),
  ('staging.rem_projects','hub.content_rem_project_rows(''brands'')'),('staging.rem_brands','hub.content_rem_brand_rows()')) x loop
  d:=replace(pg_get_functiondef('hub.brand_registration_rows(text)'::regprocedure),E'\r\n',E'\n');
  changed:=regexp_replace(d,'(from|join) ([[:space:]]*)'||replace(relation,'.','\.')||'\M','\1 \2'||replacement,'gi');
  if changed=d then raise exception 'Brand registration scope anchor drift';end if;execute changed;
 end loop;
 d:=replace(pg_get_functiondef('hub.brand_registration_rows(text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'coalesce((s.source_record->>''residential_project_count'')::int,',
  'coalesce(case when hub.content_unrestricted(''brands'',''view'') then (s.source_record->>''residential_project_count'')::int end,');execute d;
end $$;

-- Preserve contextual promotions and business references under object scope.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.promotion_scope_access(uuid,text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'return actor;',
  $new$perform hub.require_content_source('public_promotions',to_jsonb(p),'promotions',level);return actor;$new$);execute d;
end $$;

create or replace function hub.promotion_scope_visible(p_id uuid) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
begin perform hub.promotion_scope_access(p_id,'view');return true;
exception when insufficient_privilege or no_data_found then return false;end $$;

create or replace function hub.promotion_resolve(scope jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare proposed jsonb;rows jsonb;ids jsonb;rem_ids text[];begin
 perform hub.require_permission('promotions','view');perform hub.content_scope_lock();
 if jsonb_typeof(scope) is distinct from 'object'
  or scope-array['promotion_id','expected_revision','project_id','owning_brand_id','targets','excluded_project_ids']<>'{}'
  or scope?'excluded_project_ids' and jsonb_typeof(scope->'excluded_project_ids') is distinct from 'array'
  or scope?'targets' and jsonb_typeof(scope->'targets') is distinct from 'array' then
  raise exception 'Invalid promotion scope' using errcode='22023';end if;
 if scope?'promotion_id' or scope?'expected_revision' then
  if jsonb_typeof(scope->'promotion_id') is distinct from 'string'
   or jsonb_typeof(scope->'expected_revision') is distinct from 'number'
   or scope->>'expected_revision' !~ '^[1-9][0-9]*$'
   or scope?'project_id' or scope?'owning_brand_id' then
   raise exception 'Invalid saved promotion scope' using errcode='22023';end if;
  proposed:=hub.content_promotion_scope_input((scope->>'promotion_id')::uuid,(scope->>'expected_revision')::integer,scope);
 else proposed:=hub.content_promotion_scope_input(null,null,scope);end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'public_id',p.public_project_id,'label',p.public_name) order by p.public_project_id),'[]'),
  coalesce(jsonb_agg(p.public_project_id order by p.public_project_id),'[]'),coalesce(array_agg(p.rem_project_id),'{}') into rows,ids,rem_ids
 from hub.promotion_scope_projects((proposed->>'project_id')::uuid,(proposed->>'owning_brand_id')::uuid,
  proposed->'targets',array(select x::uuid from jsonb_array_elements_text(proposed->'excluded_project_ids') x)) s
 join hub.projects p on p.id=s.id;
 perform hub.require_content_project_set('promotions','view',rem_ids);
 return hub.content_promotion_projection(jsonb_build_object('items',rows,'count',jsonb_array_length(rows),'scope_hash',hub.web_hash(ids)));
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.promotion_command(text,uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,$old$if action='create' then$old$,
  $new$if action='create' then
 p:=p||hub.content_promotion_scope_input(null,null,p);$new$);
 d:=hub.content_definition_replace(d,$old$if action='update' then
 merged:=hub.promotion_payload(r.id)$old$,
  $new$if action='update' then
 p:=p||(hub.content_promotion_scope_input(r.id,r.draft_revision,p)-array['project_id','owning_brand_id']);
 merged:=hub.promotion_payload(r.id)$new$);execute d;
 d:=replace(pg_get_functiondef('hub.promotion_read(uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'from hub.promotion_reviews where promotion_id=p.id and review_revision=p.draft_revision',
  $new$from hub.promotion_reviews where promotion_id=p.id and review_revision=p.draft_revision and hub.content_source_allowed('promotion_reviews',to_jsonb(promotion_reviews),'promotions')$new$);
 d:=hub.content_definition_replace(d,'from hub.promotion_reviews r where r.promotion_id=p.id)',
  $new$from hub.promotion_reviews r where r.promotion_id=p.id and hub.content_source_allowed('promotion_reviews',to_jsonb(r),'promotions'))$new$);
 d:=hub.content_definition_replace(d,'from hub.promotion_versions v where v.id=p.published_version_id)',
  $new$from hub.promotion_versions v where v.id=p.published_version_id and hub.content_source_allowed('promotion_versions',to_jsonb(v),'promotions'))$new$);
 d:=hub.content_definition_replace(d,'from hub.promotion_versions v where v.promotion_id=p.id)',
  $new$from hub.promotion_versions v where v.promotion_id=p.id and hub.content_source_allowed('promotion_versions',to_jsonb(v),'promotions'))$new$);execute d;
 d:=replace(pg_get_functiondef('hub.content_row_visible(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,$old$if not hub.content_source_allowed(table_name,row_data,tab) then return false;end if;$old$,
  $new$if not hub.content_source_allowed(table_name,row_data,tab) then return false;end if;
 if table_name in ('public_promotions','promotion_versions','promotion_reviews') and hub.content_promotion_projection(row_data)<>row_data then return false;end if;$new$);execute d;
 d:=replace(pg_get_functiondef('hub.business_references()'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'from hub.businesses)',
  $new$from hub.businesses where exists(select 1 from unnest(array['knowledge','brands','projects']) tab
   where hub.content_project_set_allowed(tab,'view',hub.content_scope_projects('business',code))))$new$);execute d;
end $$;


-- Promotion references require their own source-tab scope as well as the
-- promotion scope. Shared text access never reveals a hidden project identity.
do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.workspace_promotions(text,text,text,text,integer,integer,uuid)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'return result||jsonb_build_object(',
  'return hub.content_promotion_projection(result)||jsonb_build_object(');execute d;
 d:=replace(pg_get_functiondef('hub.workspace_promotion_suggestions(text,text,text,integer,integer,uuid,text)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'p.id=any(projects) and p.rem_project_id=any(k.project_ids)',
  $new$p.id=any(projects) and p.rem_project_id=any(k.project_ids)
    and hub.content_project_allowed('projects','view',p.rem_project_id)
    and hub.content_project_allowed('promotions','view',p.rem_project_id)
    and (k.evidence->>'source_kind'='sena_public_website' or hub.content_project_allowed('knowledge','view',p.rem_project_id))$new$);execute d;
end $$;

create or replace function hub.promotion_references() returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('promotions','view');
 return jsonb_build_object(
  'projects',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'public_id',p.public_project_id,'label',p.public_name) order by p.public_project_id)
   from hub.projects p where p.deleted_at is null and hub.content_promotion_reference_visible('project',p.id::text)),'[]'),
  'brands',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'public_id',b.public_brand_id,'label',b.public_name) order by b.public_brand_id)
   from hub.brands b where b.deleted_at is null and hub.content_promotion_reference_visible('brand',b.id::text)),'[]'),
  'commercial_types',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'public_id',c.public_commercial_type_id,'label',c.public_name,'project_id',p.public_project_id) order by c.public_commercial_type_id)
   from hub.commercial_types c join hub.projects p on p.id=c.project_id where c.deleted_at is null and p.deleted_at is null
    and hub.content_promotion_reference_visible('commercial_type',c.id::text)),'[]'));
end $$;

do $$ declare d text;begin
 d:=replace(pg_get_functiondef('hub.content_history_source_visible(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'return hub.content_row_visible(table_key,value);',
  $new$if table_key in ('public_promotions','promotion_versions','promotion_reviews') then
   return hub.promotion_scope_visible((case when table_key='public_promotions' then value->>'id' else value->>'promotion_id' end)::uuid)
    and hub.content_source_allowed(table_key,value,'promotions');end if;
 return hub.content_row_visible(table_key,value);$new$);execute d;
 d:=replace(pg_get_functiondef('hub.workspace_history_event(audit.change_log,jsonb,boolean)'::regprocedure),E'\r\n',E'\n');
 d:=hub.content_definition_replace(d,'changed jsonb;result jsonb;begin',
  $new$changed jsonb;result jsonb;begin
  if event.table_name in ('hub.public_promotions','hub.promotion_versions','hub.promotion_reviews') then
   old_fields:=hub.content_promotion_projection(old_fields);new_fields:=hub.content_promotion_projection(new_fields);end if;$new$);execute d;
end $$;

-- Close every newly introduced helper/delegate, including worker and dynamic
-- clones. Existing functions keep their reviewed ACL; only these five account
-- RPCs, caller identity and the boolean RLS facade get explicit app execution.
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('hub','internal') and not exists(select 1 from content_scope_existing_functions before where before.oid=p.oid) loop
  execute format('revoke all on function %s from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer,hub_translation_worker,hub_media_worker',f.signature);
 end loop;
end $$;
grant execute on function hub.content_scopes_read(uuid,text,text,text,text,integer,text,integer),hub.content_bu_runs_read(text,integer),
 hub.content_scope_settings_read(),hub.content_scope_settings_preview(integer,bigint),hub.content_scope_settings_apply(integer,bigint,text),hub.content_scope_identity() to hub_app;
grant execute on function hub.content_row_visible(text,jsonb) to hub_app,editor,publisher,viewer,admin,online_staff,agency;
commit;
