-- C5 uses disposable synthetic rows; never reads or writes a working project.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
insert into staging.rem_projects(rem_project_id,project_name_rem,source_fingerprint)
 values('C5-SQL-SYNTHETIC','Synthetic C5 project','synthetic-c5');
set local role hub_app;
select set_config('test.c5_project',hub.create_project_from_rem('C5-SQL-SYNTHETIC')::text,true);
select set_config('test.c5_public',public_project_id,true) from hub.projects where id=current_setting('test.c5_project')::uuid;
select set_config('test.c5_record',hub.save_project_commercial(public_project_id,'construction',null,updated_at,
 jsonb_build_object('component','structure','percent',37.5,'as_of',current_date,'source','construction','ai_exposure','web_only'))->>'id',true)
 from hub.projects where id=current_setting('test.c5_project')::uuid;
select hub.review_project_commercial(public_project_id,'construction',current_setting('test.c5_record')::uuid,updated_at,'submit')
 from hub.projects where id=current_setting('test.c5_project')::uuid;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select hub.review_project_commercial(public_project_id,'construction',current_setting('test.c5_record')::uuid,updated_at,'approve')
 from hub.projects where id=current_setting('test.c5_project')::uuid;
reset role;
do $$ declare result jsonb;t text;begin
 result:=hub.project_current_commercial(current_setting('test.c5_project')::uuid);
 assert jsonb_array_length(result->'construction')=1,'Approved construction snapshot missing';
 assert result#>>'{construction,0,percent}'='37.5','Construction percentage changed';
 assert result#>>'{construction,0,public_content_id}' like 'content_%','Private UUID leaked';
 assert not(result#>'{construction,0}'?'id'),'Private record identity leaked';
 foreach t in array array['project_disclosures','project_sales_terms','project_programmes','project_progress','project_commercial_versions'] loop
  assert(select relrowsecurity and relforcerowsecurity from pg_class where oid=('hub.'||t)::regclass),'C5 table lacks FORCE RLS';
  assert not has_table_privilege('hub_app','hub.'||t,'INSERT,UPDATE,DELETE'),'Direct C5 writes granted';
 end loop;
 begin
  update hub.project_commercial_versions set payload=payload||'{"percent":99}' where record_id=current_setting('test.c5_record')::uuid;
  raise exception 'Frozen review payload was writable';
 exception when check_violation then null;end;
 assert hub.project_commercial_public('{"public_content_id":"content_test","owner_company":{"th":"Synthetic"},"legal_document_asset_id":"00000000-0000-0000-0000-000000000001","legal_doc_ref":"private","legal_reviewed_by":"private","override_reason":"private"}')
  ='{"public_content_id":"content_test","owner_company":{"th":"Synthetic"}}'::jsonb,'Legal evidence leaked';
 assert not hub.translation_allowed('section.investor_intro') and not hub.translation_allowed('disclosure.owner_company')
  and not hub.translation_allowed('sales_term.conditions') and not hub.translation_allowed('promotion.legal_terms'),'Restricted text sent to AI';
end $$;
set local role hub_app;
select set_config('app.content_review_reason','Synthetic commercial withdrawal',true);
select hub.review_project_commercial(public_project_id,'construction',current_setting('test.c5_record')::uuid,updated_at,'withdraw')
 from hub.projects where id=current_setting('test.c5_project')::uuid;
select set_config('app.content_review_reason','',true);
reset role;
do $$ begin
 assert hub.project_current_commercial(current_setting('test.c5_project')::uuid)->'construction'='[]'::jsonb,'Withdrawn snapshot is still eligible';
end $$;
rollback;
