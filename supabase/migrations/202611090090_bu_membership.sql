-- W6: fixture-tested BU refresh protocol. Hosted source enablement is separate.
-- All importing/maintenance functions are private. Read projections never settle.
begin;
create temporary table bu_membership_existing_functions on commit drop as select oid from pg_proc;
alter table hub.content_scope_state add column deadlines_settled_at timestamptz;

-- The settlement cursor is operational, not authorization state. It must not
-- invalidate a reviewed confirmation merely because the apply hook advanced it.
-- Canonical UTC also makes fingerprints independent of caller session TimeZone.
do $$ declare signature text;definition text;begin
 foreach signature in array array['hub.content_scope_fingerprint()',
  'hub.content_scope_batch_preview(jsonb)','hub.content_scope_settings_preview(integer,bigint)'] loop
  definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
  if (length(definition)-length(replace(definition,'to_jsonb(st)','')))/length('to_jsonb(st)')<>1 then
   raise exception 'Expected one authorization-state projection in %',signature;end if;
  definition:=hub.content_definition_replace(definition,'to_jsonb(st)','(to_jsonb(st)-''deadlines_settled_at'')');
  execute definition;
  execute format('alter function %s set TimeZone to %L',signature,'UTC');
 end loop;
end $$;

create or replace function hub.content_scope_settle_deadlines() returns void
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare moment timestamptz:=hub.content_scope_now();cursor_at timestamptz;run uuid;accepted timestamptz;
 days integer;boundary record;before_rows jsonb;after_rows jsonb;affected_accounts uuid[];
begin
 -- The caller already owns the exclusive account/settings/state locks from 0089.
 -- Never call content_scope_exclusive_lock here: its hook is this function.
 select s.deadlines_settled_at,s.accepted_run_id,r.accepted_at,c.grace_days
 into cursor_at,run,accepted,days from hub.content_scope_state s cross join hub.content_scope_settings c
 left join hub.content_bu_run r on r.id=s.accepted_run_id;
 cursor_at:=coalesce(cursor_at,accepted,moment);
 if moment<cursor_at then return;end if;
 if run is not null then
  select coalesce(array_agg(distinct account_id),'{}') into affected_accounts from hub.account_content_scope where cardinality(bu_ids)>0;
  for boundary in
   select deadline,case when bool_or(reason='membership_stale') then 'membership_stale' else 'handover_end' end reason
   from (
    select r.source_watermark+make_interval(hours=>days*24) deadline,'membership_stale' reason from hub.content_bu_run r where r.id=run
    union all select h.started_at+make_interval(hours=>days*24),'handover_end' from hub.content_bu_handover h
     where h.closed_at is null or h.closed_at>h.started_at+make_interval(hours=>days*24)
   ) d where deadline>cursor_at and deadline<=moment group by deadline order by deadline
  loop
   before_rows:=hub.content_scope_effects_at(affected_accounts,boundary.deadline-interval '1 microsecond');
   after_rows:=hub.content_scope_effects_at(affected_accounts,boundary.deadline);
   perform hub.content_scope_record_effects(before_rows,after_rows,boundary.reason,boundary.deadline,run);
  end loop;
 end if;
 if cursor_at is distinct from moment or (select deadlines_settled_at is null from hub.content_scope_state) then
  update hub.content_scope_state set deadlines_settled_at=moment where singleton;
 end if;
end $$;

create function hub.content_bu_capture() returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.content_scope_lock();
 return (select jsonb_build_object('accepted_run_id',accepted_run_id,'acceptance_epoch',acceptance_epoch) from hub.content_scope_state);
end $$;

-- Validation is repeated inside acceptance using the trusted acceptance clock.
-- Canonical digest is a sorted array of exact eight-value arrays; timestamps are UTC.
create function hub.content_bu_validate(rows jsonb,moment timestamptz) returns jsonb
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare row_value jsonb;key text;stamp timestamptz;watermark timestamptz;canonical jsonb:='[]';ids text[]:='{}';
 normalized jsonb;ordered jsonb;code text;
begin
 if moment is null or not isfinite(moment) or jsonb_typeof(rows) is distinct from 'array' then return jsonb_build_object('failure_code','invalid_shape');end if;
 if jsonb_array_length(rows)=0 then return jsonb_build_object('failure_code','empty');end if;
 for row_value in select value from jsonb_array_elements(rows) loop
  if jsonb_typeof(row_value) is distinct from 'object' or (select count(*) from jsonb_object_keys(row_value))<>8
   or not row_value ?& array['project_id','rem_bu_id','rem_bu_code','rem_bu_name','rem_bu_is_active','rem_bu_is_deleted','source_snapshot_at','project_status_code'] then
   return jsonb_build_object('failure_code','invalid_shape');end if;
  if jsonb_typeof(row_value->'project_id') is distinct from 'string' or row_value->>'project_id' ~ '^[[:space:]]*$' then
   return jsonb_build_object('failure_code','invalid_project');end if;
  if row_value->>'project_id'=any(ids) then return jsonb_build_object('failure_code','duplicate_project');end if;
  ids:=array_append(ids,row_value->>'project_id');
  foreach key in array array['rem_bu_id','rem_bu_code','rem_bu_name','project_status_code'] loop
   if jsonb_typeof(row_value->key) not in ('string','null') then return jsonb_build_object('failure_code','invalid_bu');end if;
  end loop;
  if row_value->>'rem_bu_id' is not null and row_value->>'rem_bu_id' ~ '^[[:space:]]*$' then return jsonb_build_object('failure_code','invalid_bu');end if;
  foreach key in array array['rem_bu_is_active','rem_bu_is_deleted'] loop
   if jsonb_typeof(row_value->key) not in ('boolean','null') then return jsonb_build_object('failure_code','invalid_bu');end if;
  end loop;
  if jsonb_typeof(row_value->'source_snapshot_at') is distinct from 'string'
   or row_value->>'source_snapshot_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then return jsonb_build_object('failure_code','invalid_timestamp');end if;
  begin stamp:=(row_value->>'source_snapshot_at')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('failure_code','invalid_timestamp');end;
  if stamp is null or not isfinite(stamp) then return jsonb_build_object('failure_code','invalid_timestamp');end if;
  if stamp>moment then return jsonb_build_object('failure_code','future_snapshot');end if;
  if stamp<moment-interval '48 hours' then return jsonb_build_object('failure_code','old_snapshot');end if;
  watermark:=least(watermark,stamp);
  normalized:=row_value||jsonb_build_object('source_snapshot_at',to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  canonical:=canonical||jsonb_build_array(normalized);
 end loop;
 select jsonb_agg(value order by (value->>'project_id') collate "C") into canonical from jsonb_array_elements(canonical);
 select jsonb_agg(jsonb_build_array(value->'project_id',value->'rem_bu_id',value->'rem_bu_code',value->'rem_bu_name',
  value->'rem_bu_is_active',value->'rem_bu_is_deleted',value->'source_snapshot_at',value->'project_status_code') order by (value->>'project_id') collate "C")
 into ordered from jsonb_array_elements(canonical);
 return jsonb_build_object('rows',canonical,'source_watermark',watermark,'digest',encode(sha256(convert_to(ordered::text,'UTF8')),'hex'));
end $$;

create function hub.content_bu_reject(captured_run uuid,captured_epoch bigint,code text,row_count integer default 0) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare run uuid;epoch bigint;result uuid;moment timestamptz;status text;
begin
 perform hub.content_scope_exclusive_lock();moment:=hub.content_scope_now();
 if captured_epoch is null or captured_epoch<0 or row_count is null or row_count<0
  or code is null or code not in ('empty','invalid_shape','invalid_project','duplicate_project','invalid_bu','invalid_timestamp','future_snapshot','old_snapshot','stale_refresh','read_failed') then
  raise exception 'Invalid refresh result' using errcode='23514';end if;
 select accepted_run_id,acceptance_epoch into run,epoch from hub.content_scope_state;
 if captured_run is distinct from run or captured_epoch<>epoch then code:='stale_refresh';end if;
 status:=case when code='read_failed' then 'FAILED' else 'REJECTED' end;
 insert into hub.content_bu_run(status,recorded_at,failure_code,row_count,captured_run_id,captured_epoch)
 values(status,moment,code,row_count,captured_run,captured_epoch) returning id into result;
 return jsonb_build_object('status',status,'run_id',result,'accepted_run_id',run,'acceptance_epoch',epoch,
  'failure_code',code,'requires_reread',code='stale_refresh');
end $$;

-- Include the union of old/new references in BOTH sides of the comparison, so
-- adding/removing an unknown ID cannot invent a gain/loss for an unrestricted
-- account or a still-valid explicit project exception.
create function hub.content_bu_effects_at(moment timestamptz,extra_ids text[]) returns jsonb
language sql volatile security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('account_id',a.id,'tab',t.tab,'level',l.level,'project_id',p.id)
  order by a.id,t.tab,l.level,p.id),'[]')
 from hub.user_account a cross join (values('projects'),('brands'),('knowledge'),('promotions'),('releases')) t(tab)
 cross join (values('view'),('edit'),('approve')) l(level)
 cross join (select project_id id from hub.content_scope_project_references() union select unnest(extra_ids)) p
 where exists(select 1 from hub.account_content_scope s where s.account_id=a.id and s.tab=t.tab and cardinality(s.bu_ids)>0)
 and hub.content_account_project_allowed(a.id,t.tab,l.level,p.id,moment)
$$;

create function hub.content_bu_accept(rows jsonb,captured_run uuid,captured_epoch bigint) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare current_run uuid;epoch bigint;moment timestamptz;checked jsonb;result uuid;before_rows jsonb;
 refs text[];counted integer;old_digest text;
begin
 perform hub.content_scope_exclusive_lock();moment:=hub.content_scope_now();
 if captured_epoch is null or captured_epoch<0 then raise exception 'Captured refresh epoch required' using errcode='23514';end if;
 select accepted_run_id,acceptance_epoch into current_run,epoch from hub.content_scope_state;
 counted:=case when jsonb_typeof(rows)='array' then jsonb_array_length(rows) else 0 end;
 if captured_run is distinct from current_run or captured_epoch<>epoch then
  return hub.content_bu_reject(captured_run,captured_epoch,'stale_refresh',counted);end if;
 checked:=hub.content_bu_validate(rows,moment);
 if checked?'failure_code' then return hub.content_bu_reject(captured_run,captured_epoch,checked->>'failure_code',counted);end if;
 select digest into old_digest from hub.content_bu_run where id=current_run;
 if checked->>'digest'=old_digest then
  return jsonb_build_object('status','UNCHANGED','run_id',current_run,'accepted_run_id',current_run,'acceptance_epoch',epoch,
   'source_watermark',checked->'source_watermark','row_count',counted,'requires_reread',false);
 end if;
 select array_agg(id) into refs from (select project_id id from hub.content_scope_project_references()
  union select value->>'project_id' from jsonb_array_elements(checked->'rows')) all_refs;
 before_rows:=hub.content_bu_effects_at(moment,refs);
 insert into hub.content_bu_run(status,source_watermark,accepted_at,recorded_at,digest,row_count,captured_run_id,captured_epoch)
 values('ACCEPTED',(checked->>'source_watermark')::timestamptz,moment,moment,checked->>'digest',counted,captured_run,captured_epoch) returning id into result;
 insert into hub.content_bu_membership(run_id,project_id,rem_bu_id,rem_bu_code,rem_bu_name,rem_bu_is_active,rem_bu_is_deleted,source_snapshot_at,project_status_code)
 select result,x.project_id,x.rem_bu_id,x.rem_bu_code,x.rem_bu_name,x.rem_bu_is_active,x.rem_bu_is_deleted,x.source_snapshot_at,x.project_status_code
 from jsonb_to_recordset(checked->'rows') x(project_id text,rem_bu_id text,rem_bu_code text,rem_bu_name text,
  rem_bu_is_active boolean,rem_bu_is_deleted boolean,source_snapshot_at timestamptz,project_status_code text);
 -- Preserve dated membership changes separately from accepted snapshots.
update hub.content_bu_membership_interval i
 set valid_to=moment,closed_run_id=result
 where i.valid_to is null and not exists(
  select 1 from hub.content_bu_membership m
  where m.run_id=result and m.project_id=i.project_id
   and (m.rem_bu_id,m.rem_bu_code,m.rem_bu_name,m.rem_bu_is_active,m.rem_bu_is_deleted)
    is not distinct from
    (i.rem_bu_id,i.rem_bu_code,i.rem_bu_name,i.rem_bu_is_active,i.rem_bu_is_deleted));
insert into hub.content_bu_membership_interval(
 project_id,rem_bu_id,rem_bu_code,rem_bu_name,rem_bu_is_active,rem_bu_is_deleted,
 valid_from,source_snapshot_at,opened_run_id)
 select m.project_id,m.rem_bu_id,m.rem_bu_code,m.rem_bu_name,
  m.rem_bu_is_active,m.rem_bu_is_deleted,moment,m.source_snapshot_at,result
 from hub.content_bu_membership m where m.run_id=result
  and not exists(select 1 from hub.content_bu_membership_interval i
   where i.project_id=m.project_id and i.valid_to is null);
 -- Only a non-null A -> non-null B creates handover. Labels/status never revoke.
 insert into hub.content_bu_handover(project_id,rem_bu_id,started_at,accepted_run_id)
 select old.project_id,old.rem_bu_id,moment,result from hub.content_bu_membership old
 join hub.content_bu_membership fresh on fresh.run_id=result and fresh.project_id=old.project_id
 where old.run_id=current_run and old.rem_bu_id is not null and fresh.rem_bu_id is not null and old.rem_bu_id<>fresh.rem_bu_id;
 update hub.content_bu_handover h set closed_at=moment where h.closed_at is null
 and not exists(select 1 from hub.content_bu_membership m where m.run_id=result and m.project_id=h.project_id and m.rem_bu_id is not null);
 update hub.content_scope_state set accepted_run_id=result,acceptance_epoch=epoch+1,
  authorization_epoch=authorization_epoch+1,deadlines_settled_at=moment where singleton;
 perform hub.content_scope_record_effects(before_rows,hub.content_bu_effects_at(moment,refs),'membership_accept',moment,result);
 return jsonb_build_object('status','ACCEPTED','run_id',result,'accepted_run_id',result,'acceptance_epoch',epoch+1,
  'source_watermark',checked->'source_watermark','row_count',counted,'requires_reread',false);
end $$;

create function hub.content_bu_maintain() returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.content_scope_exclusive_lock();
 return (select jsonb_build_object('accepted_run_id',accepted_run_id,'settled_at',deadlines_settled_at) from hub.content_scope_state);
end $$;

-- Caller-only finite notices. No other account selections, raw history, source
-- content or exception detail is exposed. This function is deliberately read-only.
create function hub.content_bu_notices(project_ref text default null,page_size integer default 20) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid:=hub.permission_actor();manager boolean;moment timestamptz;
 run hub.content_bu_run;cfg hub.content_scope_settings;deadline timestamptz;warning timestamptz;depends boolean;
 project_rem text;items jsonb:='[]';last_failure hub.content_bu_run;kind text;move record;item jsonb;ref text;tab text;
begin
 perform hub.content_scope_lock();
 moment:=hub.content_scope_now();
 if not exists(select 1 from hub.user_account where id=actor and status='ACTIVE' and hub_role in ('viewer','editor','publisher','admin','online_staff')) then
  raise exception 'Active staff account required' using errcode='42501';end if;
 if page_size is null or page_size not between 1 and 100 or project_ref is not null and (length(project_ref)=0 or length(project_ref)>200) then
  raise exception 'Invalid notice query' using errcode='23514';end if;
 manager:=hub.account_admin();
 if project_ref is not null then
  select p.rem_project_id into project_rem from hub.projects p where p.public_project_id=project_ref and p.deleted_at is null;
  if project_rem is null or not (hub.content_scope_allowed('project',project_ref,'view')
   or hub.workspace_faq_scope_allowed('project',project_ref,'view')) then raise exception 'Project notice denied' using errcode='42501';end if;
 end if;
 select r.* into run from hub.content_scope_state s join hub.content_bu_run r on r.id=s.accepted_run_id;
 select * into cfg from hub.content_scope_settings;
 if manager then
  select * into last_failure from hub.content_bu_run r where r.status<>'ACCEPTED' and (run.id is null or r.recorded_at>=run.accepted_at)
   order by r.recorded_at desc,r.id desc limit 1;
  if last_failure.id is not null then
   items:=items||jsonb_build_array(jsonb_build_object('id','run:'||last_failure.id,'kind','sync_failed','failure_code',last_failure.failure_code,
    'observed_at',last_failure.recorded_at,'deadline',null,'project_ref',null,'href','/admin/accounts','manager',true));
  elsif run.id is null then
   items:=items||jsonb_build_array(jsonb_build_object('id','missing','kind','sync_missing','observed_at',null,'deadline',null,'project_ref',null,'href','/admin/accounts','manager',true));
  end if;
 end if;
 if run.id is not null then
  deadline:=run.source_watermark+make_interval(hours=>cfg.grace_days*24);
  warning:=greatest(run.source_watermark,deadline-interval '48 hours');
  select exists(select 1 from hub.account_content_scope s cross join hub.content_scope_project_references() p
   where s.account_id=actor and cardinality(s.bu_ids)>0 and (project_rem is null or p.project_id=project_rem)
   and hub.content_account_project_allowed(actor,s.tab,s.level,p.project_id,least(moment,deadline-interval '1 microsecond'))
   and not hub.content_account_project_allowed(actor,s.tab,s.level,p.project_id,deadline)) into depends;
  kind:=case when moment>=deadline then 'stale_expired' when moment>=warning then 'stale_warning'
   when manager and moment>run.source_watermark+interval '48 hours' then 'stale_data' end;
  if kind is not null and (manager or depends) then
   items:=items||jsonb_build_array(jsonb_build_object('id','stale:'||run.id||':'||cfg.revision||':'||kind,'kind',kind,
    'source_snapshot_at',run.source_watermark,'observed_at',null,'deadline',deadline,'project_ref',project_ref,
    'href',case when manager then '/admin/accounts' end,'manager',manager));
  end if;
  for move in
   select h.*,moved.rem_bu_id destination_bu,least(h.started_at+make_interval(hours=>cfg.grace_days*24),deadline) cutoff
   from hub.content_bu_handover h join hub.content_bu_membership m on m.run_id=run.id and m.project_id=h.project_id and m.rem_bu_id is not null
   join hub.content_bu_membership moved on moved.run_id=h.accepted_run_id and moved.project_id=h.project_id
   where h.closed_at is null and (project_rem is null or h.project_id=project_rem)
    and moment<h.started_at+make_interval(hours=>cfg.grace_days*48)
    and (project_rem is not null or manager or exists(select 1 from hub.account_content_scope s where s.account_id=actor and (h.rem_bu_id=any(s.bu_ids) or moved.rem_bu_id=any(s.bu_ids))
      and hub.content_account_project_allowed(actor,s.tab,s.level,h.project_id,least(moment,least(h.started_at+make_interval(hours=>cfg.grace_days*24),deadline)-interval '1 microsecond'))))
   order by h.started_at desc,h.id desc limit page_size+1
  loop
   ref:=null;tab:=null;
   select p.public_project_id into ref from hub.projects p where p.rem_project_id=move.project_id and p.deleted_at is null;
   if ref is not null and hub.content_scope_allowed('project',ref,'view') then tab:='overview';
   elsif ref is not null and hub.workspace_faq_scope_allowed('project',ref,'view') then tab:='faq';
   else ref:=null;end if;
   item:=jsonb_build_object('id','move:'||move.id,'kind','handover','started_at',move.started_at,'deadline',move.started_at+make_interval(hours=>cfg.grace_days*24),
    'membership_deadline',deadline,'expired',moment>=move.started_at+make_interval(hours=>cfg.grace_days*24),'project_ref',ref,'tab',tab,'href',case when manager then '/admin/accounts' end,'manager',manager);
   items:=items||jsonb_build_array(item);
  end loop;
 end if;
 return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinal),'[]') from jsonb_array_elements(items) with ordinality t(value,ordinal) where ordinal<=page_size),
  'has_more',jsonb_array_length(items)>page_size);
end $$;

-- No runtime role receives import/maintenance/clock/effect helper access.
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='hub' and not exists(select 1 from bu_membership_existing_functions old where old.oid=p.oid) loop
  execute format('revoke all on function %s from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer',f.signature);
 end loop;
end $$;
revoke all on function hub.content_scope_settle_deadlines() from public,hub_app,editor,publisher,viewer,admin,online_staff,agency,service_consumer;
grant execute on function hub.content_bu_notices(text,integer) to hub_app;
commit;
