begin;

-- User commands are capability guarded. Technical owners retain private helper
-- access; neither the SQL role nor the user-management flag authorizes data.
grant execute on function hub.can(text,text),hub.can_special(text,text),hub.permission_actor(),
 hub.require_permission(text,text),hub.require_special(text,text) to ads_finance_writer,ads_actuals_writer;

-- Deferred consistency triggers fire after the command's definer context ends.
-- They may read only their fixed rows, never return data or accept RPC calls.
alter function ads.finance_invariant() security definer;

-- Change guards in place to retain every financial validation and lock.
do $migration$ declare definition text;
begin
 select pg_get_functiondef('ads.finance_command(text,jsonb)'::regprocedure) into definition;
 if strpos(definition,'actor:=hub.require_actor(array[''online_staff'',''admin'']);')=0 then raise exception 'Missing finance guard'; end if;
 definition:=replace(definition,'actor:=hub.require_actor(array[''online_staff'',''admin'']);','actor:=hub.require_permission(''finance'',''view'');');
 definition:=replace(definition,'perform pg_advisory_xact_lock(1560015);',$guard$
 perform pg_advisory_xact_lock(1560015);
 if action in ('memo_identifier_review','memo_identifier_retire','correction_review','correction_retire') then
  perform hub.require_special('finance','finance.review_identifiers_corrections');
 elsif action in ('memo_confirm','revision_confirm','line_archive','assignment_create','assignment_replace','assignment_end','assignment_acknowledge',
  'correction_apply','ad_account_version_confirm','channel_account_version_confirm','ad_account_version_close','channel_account_version_close',
  'commitment_activate','commitment_suspend','card_batch_confirm','card_batch_replace','cost_allocate') then
  perform hub.require_permission('finance','approve');
 elsif action in ('statement_create','statement_update') then
  -- Read under the same global finance lock. Revoking confirmation needs A too.
  if payload->>'review_status'='CONFIRMED' or (action='statement_update' and exists(
   select 1 from ads.card_statement_control where id=(payload->>'id')::uuid and review_status='CONFIRMED')) then
   perform hub.require_permission('finance','approve');
  else perform hub.require_permission('finance','edit'); end if;
 elsif action in ('memo_create','memo_update','memo_identifier_propose','line_create','revision_create','revision_update','correction_create',
  'ledger_import','card_import','ad_account_create','channel_account_create','ad_account_version_create','channel_account_version_create',
  'commitment_create','commitment_revise','commitment_cover_create','commitment_occurrence_create','cost_classify') then
  perform hub.require_permission('finance','edit');
 else raise exception 'Unknown finance action' using errcode='22023'; end if;
$guard$);
 definition:=replace(definition,'hub.require_actor(array[''admin''])','hub.require_special(''finance'',''finance.review_identifiers_corrections'')');
 execute definition;
 select pg_get_functiondef('ads.finance_read(text,text,jsonb)'::regprocedure) into definition;
 if strpos(definition,'hub.require_actor(array[''online_staff'',''admin''])')=0 then raise exception 'Missing finance read guard'; end if;
 definition:=replace(definition,'hub.require_actor(array[''online_staff'',''admin''])','hub.require_permission(''finance'',''view'')');
 definition:=replace(definition,'select to_jsonb(s) from ads.scope_code s','select case when hub.can(''registry'',''view'') then to_jsonb(s) else jsonb_build_object(''scope_id'',s.scope_id,''scope_code'',s.scope_code,''label_th'',s.label_th) end from ads.scope_code s');
 execute definition;
end $migration$;

-- Display attribution is table-backed; it never grants the workflow permission.
alter table ads.finding_workflow drop constraint finding_workflow_owner_role_check;
alter table ads.finding_workflow add constraint finding_workflow_owner_role_check
 check(owner_role in ('online_staff','admin','editor','publisher','viewer'));
create function hub.workflow_actor_label() returns text language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select hub_role from hub.user_account where id=hub.permission_actor() and status='ACTIVE'
  and hub_role in ('online_staff','admin','editor','publisher','viewer')
$$;
revoke all on function hub.workflow_actor_label() from public;
grant execute on function hub.workflow_actor_label() to ads_actuals_writer;

-- Cross-tab cached Finance payloads never leave Actuals when Finance V is off.
-- Known raw source objects get an allowlist; outer response/workflow keys remain.
create function hub.operations_projection(value jsonb) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $$
declare result jsonb; item record; allowed text[];
begin
 if value is null then return null; end if;
 if jsonb_typeof(value)='array' then
  select coalesce(jsonb_agg(hub.operations_projection(v) order by ord),'[]') into result
  from jsonb_array_elements(value) with ordinality as x(v,ord); return result;
 elsif jsonb_typeof(value)<>'object' then return value; end if;
 if not hub.can('finance','view') then
  if value ? 'approved_gross' then
   allowed:=array['line_source','line_key','hub_line_id','scope_id','scope_code','agency','month','quality_codes'];
  elsif value ? 'approved_month_gross' then
   allowed:=array['line_source','line_key','month','platform_media_spend','platform_spend_basis','platform_data_through',
    'attributed_leads','lead_definition_version','leads_data_through','media_cpl','campaign_count','unresolved_context_count',
    'quality_codes','platform_source_snapshot_at','rem_source_snapshot_at','dimension'];
  end if;
 end if;
 if value ? 'binding_name_id' and value ? 'campaign_id'
  and not(hub.can('registry','view') and hub.can('finance','view')) then
  -- Cached bridge rows mix platform observations with Registry bindings and
  -- Finance assignments. Keep source observations and minimal name/code refs;
  -- mixed matching/provenance evidence needs both source tabs to be visible.
  allowed:=array['environment','contract_version','snapshot_id','snapshot_at','platform','account_id','campaign_id',
   'month','line_source','line_key','observed_code','observed_name','registration_code','agency',
   'platform_source_snapshot_at','observed_at','source_kind'];
  if hub.can('registry','view') then allowed:=allowed||array['name_id','scope_id','binding_name_id']; end if;
  if hub.can('finance','view') then allowed:=allowed||array['revision_key','assignment_id','correction_target_id','candidate_line_keys']; end if;
 end if;
 result:='{}';
 for item in select * from jsonb_each(value) loop
  if allowed is not null and not item.key=any(allowed) then continue; end if;
  if item.key in ('expected','observed','context_refs') and value ? 'finding_key'
   and not(hub.can('finance','view') and hub.can('registry','view') and hub.can('actuals','view')) then
   result:=result||jsonb_build_object(item.key,'{}'::jsonb); continue;
  end if;
  if item.key='meta' and not hub.can('actuals','view') then
   result:=result||jsonb_build_object('meta',item.value-array['control_totals','source_watermarks','context_changed']); continue;
  end if;
  if item.key='control_totals' and jsonb_typeof(item.value)='object' and not hub.can('finance','view') then
   result:=result||jsonb_build_object(item.key,item.value-array['card_cash','card_monthly','coverage_by_basis']); continue;
  end if;
  if item.key='source_link' and not hub.can('finance','view') then continue; end if;
  if item.key in ('reference','partial_reference') and not hub.can('finance','view') and item.value#>>'{}' ~ '://' then continue; end if;
  result:=result||jsonb_build_object(item.key,hub.operations_projection(item.value));
 end loop;
 return result;
end $$;
revoke all on function hub.operations_projection(jsonb) from public;
grant execute on function hub.operations_projection(jsonb) to ads_actuals_writer;

do $migration$ declare definition text;
begin
 select pg_get_functiondef('ads.actuals_read(text,text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'perform hub.require_actor(array[''online_staff'',''admin'']);',
  $g$perform hub.require_permission(case resource when 'actuals' then 'actuals' when 'findings' then 'exceptions' when 'document-tracking' then 'documents' end,'view');$g$);
 -- All response return sites, including detail and list, are projected in SQL.
 definition:=regexp_replace(definition,'return (jsonb_build_object\([^;]+);','return hub.operations_projection(\1);','g');
 execute definition;
 select pg_get_functiondef('ads.actuals_command(text,text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'actor:=hub.require_actor(array[''online_staff'',''admin'']);',
  $g$actor:=hub.require_permission(case action when 'workflow' then 'exceptions' when 'follow-up' then 'documents' end,'edit');$g$);
 definition:=replace(definition,'then current_setting(''role'')','then hub.workflow_actor_label()');
 execute definition;
end $migration$;

-- Archive has a separate approval boundary. Worker entry points are unchanged
-- here and remain technical, for the Phase 6 worker/ETL audit.
do $migration$ declare f record; definition text;
begin
 for f in select oid,proname from pg_proc where pronamespace='ads'::regnamespace
 and proname=any(array['archive_fixtures','archive_read','archive_receive','archive_search','archive_command','archive_access']) loop
  definition:=pg_get_functiondef(f.oid);
  if f.proname in ('archive_fixtures','archive_search') then
   definition:=replace(definition,'hub.require_actor(array[''online_staff'',''admin''])','hub.require_permission(''archive'',''view'')');
  elsif f.proname='archive_read' then
   definition:=replace(definition,'perform hub.require_actor(array[''online_staff'',''admin'',''ads_document_worker'']);',
    $g$if current_setting('role')='ads_document_worker' then perform hub.require_actor(array['ads_document_worker']); else perform hub.require_permission('archive','view'); end if;$g$);
  elsif f.proname='archive_receive' then
   definition:=replace(definition,'hub.require_actor(array[''online_staff'',''admin''])','hub.require_permission(''archive'',''edit'')');
  elsif f.proname='archive_command' then
   definition:=replace(definition,'actor:=hub.require_actor(case when action=''hold'' then array[''admin''] else array[''online_staff'',''admin''] end);',$g$
    actor:=hub.require_permission('archive','view');
    if action='hold' then perform hub.require_special('archive','archive.legal_hold');
    elsif action='apply' then
     perform hub.require_permission('archive','approve'); perform hub.require_permission('finance','edit');
     if p->>'mode'='CARD_CREATE' then perform hub.require_permission('finance','approve'); end if;
    elsif action in ('retry','confirm') then perform hub.require_permission('archive','edit');
    else raise exception 'Unknown archive action' using errcode='22023'; end if;
   $g$);
  elsif f.proname='archive_access' then
   -- Insert-only technical audit. No data reads and no admin impersonation;
   -- original_actor_id must equal the server transaction's identity.
   definition:=replace(definition,'actor:=hub.require_actor(array[''admin'']);',
    $g$actor:=hub.permission_actor(); if actor is null then raise exception 'Audit actor required' using errcode='42501'; end if;$g$);
  end if;
  if f.proname='archive_search' then
   definition:=replace(definition,'m.subject,m.requesting_bud',
    'case when hub.can(''finance'',''view'') then m.subject else c.corrected_result#>>''{fields,subject}'' end subject,m.requesting_bud');
   definition:=replace(definition,'m.record_status memo_record_status',
    'case when hub.can(''finance'',''view'') then m.record_status end memo_record_status');
   definition:=replace(definition,'where memo_id=m.id and status=''CONFIRMED'' and lower(identifier)',
    'where hub.can(''finance'',''view'') and memo_id=m.id and status=''CONFIRMED'' and lower(identifier)');
  end if;
  execute definition;
 end loop;
end $migration$;

-- No new direct human/table grants: bounded RPCs are the only app surface.
-- Restrictive policies prevent the surviving legacy SELECT ACLs bypassing V.
do $$ declare r record; tab text;
begin
 for r in select n.nspname schema_name,c.relname table_name from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind='r' and (
  (n.nspname='ads' and c.relname in ('memo','memo_identifier','media_line','media_line_revision','media_line_component','line_budget_item','correction','correction_target','line_assignment','document_requirement','ad_account','channel_account','account_mapping','recurring_commitment','commitment_version','commitment_memo_cover','commitment_occurrence','card_statement_control','cost_record','cost_allocation_set','cost_allocation','finding_workflow','finding_history','document_follow_up'))
  or(n.nspname='staging' and (c.relname in ('ads_ledger_batch','ads_ledger_row','ads_card_batch','ads_card_row') or c.relname like 'ads_actuals_%'))
  or(n.nspname='ads' and c.relname like 'archive_%') or(n.nspname='audit' and c.relname='archive_access')) loop
  tab:=case when r.table_name like 'archive_%' then 'archive' when r.table_name='document_follow_up' then 'documents'
   when r.table_name in ('finding_workflow','finding_history','ads_actuals_finding') then 'exceptions'
   when r.table_name like 'ads_actuals_%' then 'actuals' else 'finance' end;
  execute format('alter table %I.%I force row level security',r.schema_name,r.table_name);
  execute format('create policy operations_owner on %I.%I to %I using(true) with check(true)',r.schema_name,r.table_name,current_user);
  execute format('create policy operations_permission on %I.%I as restrictive to hub_app,editor,publisher,viewer,admin,online_staff,agency using(hub.can(%L,''view'')) with check(false)',r.schema_name,r.table_name,tab);
 end loop;
end $$;

grant execute on function ads.finance_read(text,text,jsonb),ads.finance_command(text,jsonb),
 ads.actuals_read(text,text,jsonb),ads.actuals_command(text,text,jsonb),
 ads.archive_fixtures(),ads.archive_read(uuid,jsonb),ads.archive_receive(jsonb),
 ads.archive_command(text,uuid,jsonb),ads.archive_search(text,jsonb),ads.archive_access(jsonb) to hub_app;
commit;
