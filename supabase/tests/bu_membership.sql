-- Real role denial and atomic BU refresh; private fake clock rolls back.
begin;
create or replace function hub.content_scope_now() returns timestamptz language sql volatile
set search_path=pg_catalog,pg_temp as $$ select timestamptz '2032-01-01T00:00:00Z' $$;
update hub.content_scope_state set deadlines_settled_at=null;

create function pg_temp.bu_rows(bu text default 'exact-A',stamp timestamptz default '2032-01-01T00:00:00Z') returns jsonb
language sql as $$ select jsonb_build_array(jsonb_build_object('project_id','00001','rem_bu_id',bu,'rem_bu_code',' Same code ',
 'rem_bu_name',' Exact name ','rem_bu_is_active',false,'rem_bu_is_deleted',true,'source_snapshot_at',stamp,'project_status_code','3'),
 jsonb_build_object('project_id','00002','rem_bu_id','exact-B','rem_bu_code',' Same code ',
 'rem_bu_name',null,'rem_bu_is_active',null,'rem_bu_is_deleted',null,'source_snapshot_at',stamp,'project_status_code',null)) $$;
create function pg_temp.bu_accept(rows jsonb) returns jsonb language plpgsql as $$
declare token jsonb;begin token:=hub.content_bu_capture();return hub.content_bu_accept(rows,(token->>'accepted_run_id')::uuid,(token->>'acceptance_epoch')::bigint);end $$;

select set_config('test.bu_actor',gen_random_uuid()::text,true),set_config('test.bu_manager',gen_random_uuid()::text,true),
 set_config('test.bu_exception',gen_random_uuid()::text,true);
insert into hub.user_account(id,email,status,hub_role) values
 (current_setting('test.bu_actor')::uuid,current_setting('test.bu_actor')||'@example.test','ACTIVE','viewer'),
 (current_setting('test.bu_manager')::uuid,current_setting('test.bu_manager')||'@example.test','ACTIVE','admin'),
 (current_setting('test.bu_exception')::uuid,current_setting('test.bu_exception')||'@example.test','ACTIVE','viewer');
insert into hub.account_content_scope(account_id,tab,level,bu_ids,project_ids) values
 (current_setting('test.bu_actor')::uuid,'projects','view',array['exact-A'],'{}'),
 (current_setting('test.bu_exception')::uuid,'projects','view',array['exact-A'],array['00001']);
create temporary table bu_unchanged as select
 (select jsonb_agg(to_jsonb(a) order by id) from hub.user_account a) accounts,
 (select jsonb_agg(to_jsonb(p) order by account_id,tab) from hub.account_permission p) grants,
 (select jsonb_agg(to_jsonb(t) order by code) from hub.permission_template t) templates,
 (select jsonb_agg(to_jsonb(p) order by id) from hub.projects p) content,
 (select jsonb_agg(to_jsonb(p) order by rem_project_id) from staging.dw_projects p) staging;

do $$ declare f text;value jsonb;before_state jsonb;first_token jsonb;other_token jsonb;run uuid;begin
 foreach f in array array['hub.content_bu_capture()','hub.content_bu_validate(jsonb,timestamptz)',
  'hub.content_bu_reject(uuid,bigint,text,integer)','hub.content_bu_accept(jsonb,uuid,bigint)',
  'hub.content_bu_effects_at(timestamptz,text[])','hub.content_bu_maintain()','hub.content_scope_settle_deadlines()'] loop
  assert not has_function_privilege('hub_app',f,'execute'),f;
  assert not has_function_privilege('admin',f,'execute'),f;
  assert not has_function_privilege('service_consumer',f,'execute'),f;
 end loop;
 assert has_function_privilege('hub_app','hub.content_bu_notices(text,integer)','execute');
 assert not has_function_privilege('viewer','hub.content_bu_notices(text,integer)','execute');
 foreach f in array array['hub.content_scope_fingerprint()','hub.content_scope_batch_preview(jsonb)',
  'hub.content_scope_settings_preview(integer,bigint)'] loop
  assert (select 'TimeZone=UTC'=any(proconfig) and 'search_path=pg_catalog, pg_temp'=any(proconfig) from pg_proc where oid=f::regprocedure),f;
 end loop;
 first_token:=hub.content_bu_capture();other_token:=hub.content_bu_capture();
 value:=hub.content_bu_accept(pg_temp.bu_rows(),(other_token->>'accepted_run_id')::uuid,(other_token->>'acceptance_epoch')::bigint);
 assert value->>'status'='ACCEPTED';run:=(value->>'run_id')::uuid;
 assert hub.content_account_project_allowed(current_setting('test.bu_actor')::uuid,'projects','view','00001',hub.content_scope_now());
 assert not hub.content_account_project_allowed(current_setting('test.bu_actor')::uuid,'projects','view','00002',hub.content_scope_now());
 assert (select rem_bu_is_active=false and rem_bu_is_deleted=true and project_status_code='3' and rem_bu_code=' Same code '
  from hub.content_bu_membership where run_id=run and project_id='00001');
 select to_jsonb(s)-'deadlines_settled_at' into before_state from hub.content_scope_state s;
 value:=hub.content_bu_accept(pg_temp.bu_rows('late-stale-value'),(first_token->>'accepted_run_id')::uuid,(first_token->>'acceptance_epoch')::bigint);
 assert value->>'failure_code'='stale_refresh' and (value->>'requires_reread')::boolean;
 assert (select to_jsonb(s)-'deadlines_settled_at' from hub.content_scope_state s)=before_state;
 assert pg_temp.bu_accept(pg_temp.bu_rows())->>'status'='UNCHANGED';
 assert (select to_jsonb(s)-'deadlines_settled_at' from hub.content_scope_state s)=before_state;
 assert pg_temp.bu_accept('[]')->>'failure_code'='empty';
 assert pg_temp.bu_accept(pg_temp.bu_rows()||jsonb_build_array(pg_temp.bu_rows()->0))->>'failure_code'='duplicate_project';
 assert pg_temp.bu_accept(jsonb_set(pg_temp.bu_rows(),'{1,source_snapshot_at}','null'))->>'failure_code'='invalid_timestamp';
 assert pg_temp.bu_accept(jsonb_set(pg_temp.bu_rows(),'{1,source_snapshot_at}',to_jsonb('2032-01-01T00:00:00.000001Z'::text)))->>'failure_code'='future_snapshot';
 assert pg_temp.bu_accept(jsonb_set(pg_temp.bu_rows(),'{1,source_snapshot_at}',to_jsonb('2031-12-29T23:59:59.999999Z'::text)))->>'failure_code'='old_snapshot';
 assert (select to_jsonb(s)-'deadlines_settled_at' from hub.content_scope_state s)=before_state;
 assert (select count(*) from hub.content_bu_membership where run_id=run)=2;
end $$;

create or replace function hub.content_scope_now() returns timestamptz language sql volatile
set search_path=pg_catalog,pg_temp as $$ select timestamptz '2032-01-06T00:00:00Z' $$;
select set_config('test.bu_audit',(select count(*)::text from audit.change_log),true);
set local role hub_app;
select set_config('app.actor_id',current_setting('test.bu_actor'),true);
do $$ declare value jsonb;begin
 assert not (select rolsuper or rolbypassrls from pg_roles where rolname=current_user);
 value:=hub.content_bu_notices();assert value->'items'->0->>'kind'='stale_warning';
 assert not value::text like '%'||current_setting('test.bu_manager')||'%';
 begin perform hub.content_bu_capture();raise exception 'App captured worker epoch';exception when insufficient_privilege then null;end;
 begin perform hub.content_bu_accept('[]',null,0);raise exception 'App imported BU rows';exception when insufficient_privilege then null;end;
 begin perform hub.content_bu_maintain();raise exception 'App ran maintenance';exception when insufficient_privilege then null;end;
 begin perform hub.content_scope_now();raise exception 'App set or read private clock';exception when insufficient_privilege then null;end;
 begin perform * from hub.content_bu_membership;raise exception 'Raw membership leaked';exception when insufficient_privilege then null;end;
end $$;
select set_config('app.actor_id',current_setting('test.bu_exception'),true);
do $$ begin assert jsonb_array_length(hub.content_bu_notices()->'items')=0;end $$;
reset role;
do $$ begin assert (select count(*)::text from audit.change_log)=current_setting('test.bu_audit');end $$;

create or replace function hub.content_scope_now() returns timestamptz language sql volatile
set search_path=pg_catalog,pg_temp as $$ select timestamptz '2032-01-08T00:00:00Z' $$;
do $$ declare count_before bigint;begin
 -- Exact end-exclusive authorization does not wait for a maintenance tick.
 assert not hub.content_account_project_allowed(current_setting('test.bu_actor')::uuid,'projects','view','00001',hub.content_scope_now());
 assert hub.content_account_project_allowed(current_setting('test.bu_exception')::uuid,'projects','view','00001',hub.content_scope_now());
 assert hub.content_account_project_allowed(current_setting('test.bu_manager')::uuid,'projects','view','00001',hub.content_scope_now());
 perform hub.content_bu_maintain();
 assert (select count(*) from hub.permission_event where action='CONTENT_SCOPE_EFFECT' and account_id=current_setting('test.bu_actor')::uuid
  and after_value->>'reason'='membership_stale' and after_value->>'direction'='loss')=1, 'Expected exactly one stale membership loss';
 select count(*) into count_before from hub.permission_event where action='CONTENT_SCOPE_EFFECT';
 perform hub.content_bu_maintain();
 assert (select count(*) from hub.permission_event where action='CONTENT_SCOPE_EFFECT')=count_before;
 assert pg_temp.bu_accept(pg_temp.bu_rows('exact-A','2032-01-08T00:00:00Z'))->>'status'='ACCEPTED';
 assert hub.content_account_project_allowed(current_setting('test.bu_actor')::uuid,'projects','view','00001',hub.content_scope_now());
 assert pg_temp.bu_accept(pg_temp.bu_rows('exact-B','2032-01-08T00:00:00Z'))->>'status'='ACCEPTED';
 assert hub.content_account_project_allowed(current_setting('test.bu_actor')::uuid,'projects','view','00001',hub.content_scope_now());
 assert (select count(*) from hub.content_bu_handover where project_id='00001' and rem_bu_id='exact-A' and closed_at is null)=1;
 -- NULL means no BUD and closes old handover immediately; explicit project remains.
 assert pg_temp.bu_accept(pg_temp.bu_rows(null,'2032-01-08T00:00:00Z'))->>'status'='ACCEPTED';
 assert not hub.content_account_project_allowed(current_setting('test.bu_actor')::uuid,'projects','view','00001',hub.content_scope_now());
 assert hub.content_account_project_allowed(current_setting('test.bu_exception')::uuid,'projects','view','00001',hub.content_scope_now());
 assert not exists(select 1 from hub.content_bu_handover where project_id='00001' and closed_at is null);
end $$;

do $$ declare prior record;begin
 select * into prior from bu_unchanged;
 assert prior.accounts is not distinct from (select jsonb_agg(to_jsonb(a) order by id) from hub.user_account a), 'Membership changed accounts';
 assert prior.grants is not distinct from (select jsonb_agg(to_jsonb(p) order by account_id,tab) from hub.account_permission p), 'Membership changed grants';
 assert prior.templates is not distinct from (select jsonb_agg(to_jsonb(t) order by code) from hub.permission_template t), 'Membership changed templates';
 assert prior.content is not distinct from (select jsonb_agg(to_jsonb(p) order by id) from hub.projects p), 'Membership changed content';
 assert prior.staging is not distinct from (select jsonb_agg(to_jsonb(p) order by rem_project_id) from staging.dw_projects p), 'Membership changed staging';
end $$;
rollback;
