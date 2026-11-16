-- Disposable local database only. Every source/content change rolls back.
begin;
do $$ declare name text; rel regclass; begin
 foreach name in array array['writing_ai_settings','writing_ai_requests'] loop
  rel:=('hub.'||name)::regclass;
  assert (select relrowsecurity and relforcerowsecurity from pg_class where oid=rel),name||' lacks FORCE RLS';
  assert not has_table_privilege('hub_app',rel,'SELECT,INSERT,UPDATE,DELETE'),name||' permits direct access';
  assert exists(select 1 from pg_trigger where tgrelid=rel and tgname='writing_audit'),name||' lacks audit';
 end loop;
 assert not has_function_privilege('hub_app','hub.writing_aid_field_safe(text)','EXECUTE'),'field helper is public';
 assert not has_function_privilege('hub_app','hub.writing_aid_source(uuid,text)','EXECUTE'),'source helper is public';
 assert not has_function_privilege('hub_app','hub.writing_aid_input(uuid,integer,text,text,jsonb)','EXECUTE'),'raw input helper is public';
 assert not has_function_privilege('hub_app','hub.writing_aid_budget()','EXECUTE'),'unguarded budget read';
 assert not has_function_privilege('hub_app','hub.writing_aid_request_visible(hub.writing_ai_requests)','EXECUTE'),'visibility helper is public';
 assert not has_function_privilege('hub_app','hub.require_content_translation_scope(uuid,text)','EXECUTE'),'W6 scope helper is public';
 assert has_function_privilege('hub_app','hub.writing_aid_state(uuid)','EXECUTE');
 assert has_function_privilege('hub_app','hub.writing_aid_begin(uuid,integer,text,text,uuid,jsonb)','EXECUTE');
 assert has_function_privilege('hub_app','hub.writing_aid_finish(uuid,text,integer)','EXECUTE');
 assert not exists(select 1 from hub.field_catalog where ai_writing_enabled),'existing fields were automatically enabled';
 assert (select column_default='false' from information_schema.columns where table_schema='hub' and table_name='field_catalog' and column_name='ai_writing_enabled'),'registry flag is not default-off';
 assert not exists(select 1 from hub.field_catalog where ai_writing_enabled and not hub.writing_aid_field_safe(field_key));
 foreach name in array array['project.ad_disclaimer','project.address','project.public_name','project.common_fee',
  'section.investor_intro','contact.label','promotion.title','promotion.conditions_public','article.author','article.blocks'] loop
  assert not hub.writing_aid_field_safe(name),'hard exclusion was lost: '||name;
 end loop;
 insert into hub.field_catalog(field_key,entity,section,label,value_kind,source_policy)
 values('synthetic_writing.copy','synthetic_writing','narrative','{"th":"Synthetic only"}','text','mkt');
 assert not (select ai_writing_enabled from hub.field_catalog where field_key='synthetic_writing.copy'),'new flag must default off';
 assert (select provider_mode='stub' and model='stub-writing-v1' and monthly_cap_usd=0 and request_ceiling_usd=0 from hub.writing_ai_settings);
 assert not exists(select 1 from information_schema.columns where table_schema='hub' and table_name='writing_ai_requests'
  and column_name in ('text','input_text','output_text','proposal','prompt','credential','api_key')),'raw content/credential storage';
end $$;

select set_config('test.writing_project',public_project_id,true) from hub.projects where deleted_at is null order by id limit 1;
set local role hub_app;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
do $$ declare rev integer; saved jsonb; begin
 select coalesce(max(revision),0) into rev from hub.content_sections
  where scope_type='project' and scope_id=current_setting('test.writing_project') and section_key='section.project_intro';
 saved:=hub.save_content_section('project',current_setting('test.writing_project'),'section.project_intro',rev,
  '{"body":{"th":"Synthetic 20 homes {project}","en":"Synthetic 20 homes {project}"}}');
 begin update hub.writing_ai_settings set monthly_cap_usd=1; assert false,'cap directly editable'; exception when insufficient_privilege then null; end;
 begin perform * from hub.writing_ai_requests; assert false,'other actors usage is directly readable'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('test.writing_source',id::text,true),set_config('test.writing_revision',revision::text,true)
 from hub.content_translations where scope_id=current_setting('test.writing_project') and field_key='section.project_intro';
select set_config('test.writing_request',gen_random_uuid()::text,true);
select set_config('test.writing_fingerprint',md5(to_jsonb(t)::text),true)
 from hub.content_translations t where id=current_setting('test.writing_source')::uuid;

-- The eligible source is still off. Explicit opt-in is a registry decision.
set local role hub_app;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
do $$ begin
 assert not (hub.writing_aid_state(current_setting('test.writing_source')::uuid)->>'eligible')::boolean;
 begin perform hub.writing_aid_begin(current_setting('test.writing_source')::uuid,current_setting('test.writing_revision')::integer,'th','proofread',gen_random_uuid());
  assert false,'default-off field generated copy';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('test.writing_admin',id::text,true) from hub.user_account where hub_role='admin' and status='ACTIVE' order by id limit 1;
update hub.account_permission set special_actions=array_append(special_actions,'projects.manage_field_catalog')
 where account_id=current_setting('test.writing_admin')::uuid and tab='projects' and not 'projects.manage_field_catalog'=any(special_actions);
set local role hub_app;
select set_config('app.actor_id',current_setting('test.writing_admin'),true);
do $$ declare rev integer;begin
 select revision into rev from hub.field_catalog where field_key='section.project_intro';
 assert (hub.save_content_field('section.project_intro',rev,'{"ai_writing_enabled":true}')->>'ai_writing_enabled')::boolean;
 select revision into rev from hub.field_catalog where field_key='project.ad_disclaimer';
 begin perform hub.save_content_field('project.ad_disclaimer',rev,'{"ai_writing_enabled":true}');
  assert false,'forbidden registry opt-in accepted';exception when check_violation then null;end;
end $$;
reset role;

set local role hub_app;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000003',true);
do $$ declare source uuid:=current_setting('test.writing_source')::uuid; begin
 assert (hub.writing_aid_state(source)->>'eligible')::boolean,'neighbor view was denied';
 begin perform hub.writing_aid_begin(source,current_setting('test.writing_revision')::integer,'th','proofread',gen_random_uuid());
  assert false,'viewer generated copy'; exception when insufficient_privilege then null; end;
end $$;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
do $$ declare source uuid:=current_setting('test.writing_source')::uuid; rev integer:=current_setting('test.writing_revision')::integer;
 request uuid:=current_setting('test.writing_request')::uuid; result jsonb; begin
 result:=hub.writing_aid_begin(source,rev,'th','proofread',request);
 assert result->>'status'='ready' and result->>'input_text'='Synthetic 20 homes {project}';
 result:=hub.writing_aid_begin(source,rev,'th','proofread',request);
 assert result->>'status'='running' and (result->>'replayed')::boolean and not result?'input_text','ambiguous request regenerated';
 result:=hub.writing_aid_finish(request,null,1);
 assert result->>'status'='done' and (result->>'synthetic')::boolean;
 assert result->>'model'='stub-writing-v1' and result->>'input_tokens'='0' and result->>'output_tokens'='0';
 assert result->>'completed_at' is not null and not result?'proposal','proposal persisted';
 assert jsonb_array_length(hub.writing_aid_state(source)->'requests')=1;
 begin perform hub.writing_aid_begin(source,rev+1,'th','proofread',gen_random_uuid());
  assert false,'stale writing source accepted'; exception when serialization_failure then null; end;
end $$;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000003',true);
do $$ begin
 assert hub.writing_aid_state(current_setting('test.writing_source')::uuid)->'requests'='[]'::jsonb,'another actor usage leaked';
 begin perform hub.writing_aid_finish(current_setting('test.writing_request')::uuid,null,1);
  assert false,'another actor finished request'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 assert current_setting('test.writing_fingerprint')=(select md5(to_jsonb(t)::text) from hub.content_translations t
  where id=current_setting('test.writing_source')::uuid),'writing modified source content';
 assert not exists(select 1 from audit.change_log where table_name='hub.writing_ai_requests'
  and coalesce(after_row,before_row)->>'id'=current_setting('test.writing_request')
  and (coalesce(after_row,before_row)::text like '%Synthetic 20 homes%' or coalesce(after_row,before_row)?'input_text')),'audit contains raw writing text';
end $$;
rollback;
