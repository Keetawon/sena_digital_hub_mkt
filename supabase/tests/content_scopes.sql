-- W6 actual app-role boundaries; transactions leave accounts/scopes unchanged.
begin;
do $$ declare name text;begin
 foreach name in array array['hub.account_content_scope','hub.content_scope_settings','hub.content_scope_state','hub.content_bu_run','hub.content_bu_membership','hub.content_bu_membership_interval','hub.content_bu_handover'] loop
  assert (select relrowsecurity and relforcerowsecurity from pg_class where oid=name::regclass),name;
  assert not has_table_privilege('hub_app',name,'SELECT,INSERT,UPDATE,DELETE'),name;
  assert not has_table_privilege('agency',name,'SELECT,INSERT,UPDATE,DELETE'),name;
  assert exists(select 1 from pg_trigger where tgrelid=name::regclass and tgname='scope_audit'),name;
 end loop;
 assert not exists(select 1 from pg_constraint where conrelid='hub.account_content_scope'::regclass and confrelid='hub.account_permission'::regclass);
 assert (select grace_days between 1 and 7 from hub.content_scope_settings);
 foreach name in array array['hub.content_scope_now()','hub.content_scope_settle_deadlines()','hub.content_scope_exclusive_lock()','hub.content_scope_lock()',
  'hub.content_account_project_allowed(uuid,text,text,text,timestamptz)','hub.require_content_translation_scope(uuid,text)',
  'hub.content_scope_effects(uuid[])','hub.content_scope_effects_at(uuid[],timestamptz)',
  'hub.content_scope_record_effects(jsonb,jsonb,text,timestamptz,uuid)','hub.content_source_projects(text,jsonb)',
  'hub.content_scope_history(uuid,text,integer)','internal.assistant_scoped_source(text,text,text)'] loop
  assert not has_function_privilege('hub_app',name,'execute'),name;
  assert not has_function_privilege('viewer',name,'execute'),name;
  assert not has_function_privilege('agency',name,'execute'),name;
  assert not has_function_privilege('service_consumer',name,'execute'),name;
 end loop;
 foreach name in array array['hub.content_scopes_read(uuid,text,text,text,text,integer,text,integer)','hub.content_bu_runs_read(text,integer)',
  'hub.content_scope_settings_read()','hub.content_scope_settings_preview(integer,bigint)','hub.content_scope_settings_apply(integer,bigint,text)','hub.content_scope_identity()'] loop
  assert has_function_privilege('hub_app',name,'execute'),name;
  assert not has_function_privilege('agency',name,'execute'),name;
 end loop;
 foreach name in array array['hub.projects','hub.brands','hub.assets','hub.faq_versions','hub.article_versions','hub.project_progress_cache',
  'hub.content_review_versions','staging.knowledge_candidates','rag.knowledge_preview_chunks','staging.rem_projects','staging.dw_projects'] loop
  assert exists(select 1 from pg_policy where polrelid=name::regclass and polname='content_object_scope' and not polpermissive),name;
 end loop;
 assert (select count(*) from pg_policy where polname='content_object_scope')>=90;
end $$;
select set_config('test.scope_actor',gen_random_uuid()::text,true),set_config('test.scope_manager',gen_random_uuid()::text,true);
insert into hub.user_account(id,email,status,hub_role) values
 (current_setting('test.scope_actor')::uuid,current_setting('test.scope_actor')||'@example.test','ACTIVE','viewer'),
 (current_setting('test.scope_manager')::uuid,current_setting('test.scope_manager')||'@example.test','ACTIVE','admin');
select set_config('test.scope_project',(select public_project_id from hub.projects where deleted_at is null order by public_project_id limit 1),true);
select set_config('test.scope_project_id',(select rem_project_id from hub.projects where public_project_id=current_setting('test.scope_project')),true);
select set_config('test.scope_before',(select count(*)::text from audit.change_log),true);
set local role hub_app;
select set_config('app.actor_id',current_setting('test.scope_actor'),true);
do $$ declare value jsonb;begin
 assert not (select rolsuper or rolbypassrls from pg_roles where rolname=current_user);
 assert hub.project_detail(current_setting('test.scope_project')) is not null;
 value:=hub.content_scope_identity();assert value?'fingerprint' and value?'expires_at';
 assert not(value?'bu_ids' or value?'project_ids' or value?'account_id');
 begin perform hub.content_scopes_read();raise exception 'Scope references allowed without account authority';exception when insufficient_privilege then null;end;
 begin perform hub.content_scope_settings_read();raise exception 'Settings allowed without actual Admin';exception when insufficient_privilege then null;end;
 begin perform hub.content_scope_now();raise exception 'Private clock exposed';exception when insufficient_privilege then null;end;
 begin insert into hub.account_content_scope(account_id,tab,level) values(current_setting('app.actor_id')::uuid,'projects','view');raise exception 'Direct scope write allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin assert (select count(*)::text from audit.change_log)=current_setting('test.scope_before');end $$;
insert into hub.account_content_scope(account_id,tab,level) values(current_setting('test.scope_actor')::uuid,'projects','view');
set local role hub_app;
select set_config('app.actor_id',current_setting('test.scope_actor'),true);
do $$ begin
 assert not exists(select 1 from hub.projects where public_project_id=current_setting('test.scope_project'));
 begin perform hub.project_detail(current_setting('test.scope_project'));raise exception 'Selected-empty detail allowed';exception when insufficient_privilege then null;end;
end $$;
select set_config('app.actor_id',current_setting('test.scope_manager'),true);
do $$ declare value jsonb;begin
 value:=hub.content_scopes_read(current_setting('test.scope_actor')::uuid);assert jsonb_array_length(value->'scopes')=15;
 assert not(value?'permissions' or value?'payload');
 assert hub.content_scope_settings_read()->>'grace_days' is not null;
end $$;
reset role;
update hub.account_content_scope set project_ids=array[current_setting('test.scope_project_id')] where account_id=current_setting('test.scope_actor')::uuid;
set local role hub_app;
select set_config('app.actor_id',current_setting('test.scope_actor'),true);
do $$ begin assert hub.project_detail(current_setting('test.scope_project')) is not null;end $$;
reset role;
rollback;
