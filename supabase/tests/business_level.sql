-- W5 is additive: read-only catalog, closed helpers and unchanged source authority.
begin;
do $$ declare name text;begin
 assert (select count(*)=4 from hub.businesses);
 assert (select label->>'en'='Residential' and length(label->>'th')>0 from hub.businesses where code='residential');
 assert (select label->>'en'='SENA Solar Energy' and label->>'th'='เสนา โซลาร์ เอนเนอร์ยี่' from hub.businesses where code='solar');
 assert (select label->>'en'='SenX' and label->>'th'='เซ็น เอกซ์' from hub.businesses where code='senx');
 assert (select label->>'en'='Ngernsod Jaidee' and label->>'th'='เงินสดใจดี' from hub.businesses where code='ngernsod_jaidee');
 assert not exists(select 1 from hub.brands b where b.deleted_at is null and not exists(select 1 from hub.brand_business m where m.brand_id=b.id and m.business_code='residential'));
 foreach name in array array['hub.businesses','hub.brand_business'] loop
  assert (select relrowsecurity and relforcerowsecurity from pg_class where oid=name::regclass),name;
  assert not has_table_privilege('hub_app',name,'SELECT,INSERT,UPDATE,DELETE'),name;
  assert exists(select 1 from pg_trigger where tgrelid=name::regclass and tgname='business_audit'),name;
  assert exists(select 1 from pg_policy where polrelid=name::regclass and polname='business_owner' and polroles=array[(select relowner from pg_class where oid=name::regclass)]),name;
 end loop;
 assert has_function_privilege('hub_app','hub.business_references()','execute');
 assert has_function_privilege('hub_app','hub.business_content(text)','execute');
 foreach name in array array['hub.business_assign_brand()','hub.business_project_matches(text,text)','hub.faq_scope_rank(text)',
  'hub.business_cluster_matches(text,text[],text[])','hub.business_scope_faq_rows(text,text,boolean)',
  'internal.assistant_saved_source(text,text,text)','internal.assistant_saved_source_visible(text,text,text)'] loop
  assert not has_function_privilege('hub_app',name,'execute'),name;
  assert not has_function_privilege('agency',name,'execute'),name;
  assert not has_function_privilege('service_consumer',name,'execute'),name;
 end loop;
 assert array[hub.faq_scope_rank('unit_type'),hub.faq_scope_rank('project'),hub.faq_scope_rank('project_group'),hub.faq_scope_rank('programme'),hub.faq_scope_rank('brand'),hub.faq_scope_rank('business'),hub.faq_scope_rank('corporate')]=array[7,6,5,4,3,2,1];
 assert hub.workspace_history_fields('hub.businesses','{"code":"residential","label":{"en":"Residential"},"account":"hidden"}')='{"code":"residential","label":{"en":"Residential"}}'::jsonb;
 assert hub.workspace_history_fields('hub.brand_business','{"brand_id":"hidden","business_code":"residential","actor":"hidden"}')='{"business_code":"residential"}'::jsonb;
 assert hub.workspace_history_fields('hub.account_permission','{"account_id":"hidden"}')='{}'::jsonb;
 assert hub.publication_certificate('businesses','{"code":"residential"}','{"code":"residential"}')='{"registry":true}'::jsonb;
 begin perform hub.content_workflow_table('business');raise exception 'Fixed catalog became an editable workflow kind';exception when check_violation then null;end;
end $$;
select set_config('test.business_audit_count',(select count(*)::text from audit.change_log),true);
update hub.account_permission set can_view=false,can_edit=false,can_approve=false,special_actions='{}'
 where account_id='00000000-0000-0000-0000-000000000003' and tab in ('projects','brands');
select set_config('test.business_audit_count',(select count(*)::text from audit.change_log),true);
set local role hub_app;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000003',true);
do $$ declare value jsonb;begin
 value:=hub.business_references();assert jsonb_array_length(value->'items')=4;
 assert value#>>'{items,0,code}'='residential';assert not(value#>'{items,0}' ? 'brands');
 assert value#>>'{items,1,code}'='solar' and value#>>'{items,2,code}'='senx' and value#>>'{items,3,code}'='ngernsod_jaidee';
 value:=hub.workspace_page('business','residential');assert value#>>'{entity,kind}'='business';
 assert value->'phases'='[]'::jsonb;assert value#>'{overview,readiness,required}'='[]'::jsonb;
 assert hub.workspace_page('business','solar')#>>'{entity,name,th}'='เสนา โซลาร์ เอนเนอร์ยี่';
 assert hub.workspace_page('business','senx')#>>'{entity,name,th}'='เซ็น เอกซ์';
 assert hub.workspace_page('business','ngernsod_jaidee')#>>'{entity,name,th}'='เงินสดใจดี';
 assert hub.workspace_faq('business','residential')->'items' is not null;
 assert jsonb_array_length(hub.workspace_faq('business','solar')->'items')=0;
 assert hub.content_history('business','residential')->'items' is not null;
 assert hub.content_workflow_items('business','residential')->>'next_cursor' is null;
 assert exists(select 1 from jsonb_array_elements(hub.workspace_search('Residential',30)->'items') x where x->>'kind'='business' and x->>'ref'='residential');
 begin perform hub.workspace_page('business','unknown');raise exception 'Unknown business allowed';exception when no_data_found then null;end;
 begin insert into hub.businesses values('invented','{"th":"Synthetic"}');raise exception 'Catalog write allowed';exception when insufficient_privilege then null;end;
 begin update hub.businesses set label='{"th":"Changed"}' where code='residential';raise exception 'Catalog rename allowed';exception when insufficient_privilege then null;end;
 begin delete from hub.brand_business;raise exception 'Relationship write allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin assert (select count(*)::text from audit.change_log)=current_setting('test.business_audit_count');end $$;
rollback;
