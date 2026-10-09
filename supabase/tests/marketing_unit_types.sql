-- Synthetic grouping/splitting examples only; no HYABC data is changed.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select set_config('app.change_reason','Synthetic marketing unit type contract',true);
insert into staging.rem_projects(rem_project_id,project_name_rem,source_fingerprint)
values('COMMERCIAL-P1','Synthetic commercial project','synthetic'),('COMMERCIAL-P2','Other synthetic project','synthetic');
insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_fingerprint)
values('COMMERCIAL-P1','A1-1','Synthetic A1-1','synthetic'),('COMMERCIAL-P1','A1-2R','Synthetic A1-2R','synthetic'),
  ('COMMERCIAL-P1','LEGACY-01','Synthetic acquired model','synthetic'),('COMMERCIAL-P2','A1-1','Other project A1','synthetic');
insert into hub.assets(id,original_filename,mime_type,public_url,rights_status,storage_bucket,storage_path,checksum,file_size)
values('91000000-0000-0000-0000-000000000001','synthetic-photo.jpg','image/jpeg','/v1/assets/91000000-0000-0000-0000-000000000001/file','approved','local-originals',repeat('c',64)||'.jpg',repeat('c',64),100),
  ('91000000-0000-0000-0000-000000000002','synthetic-plan.pdf','application/pdf','/v1/assets/91000000-0000-0000-0000-000000000002/file','pending','local-originals',repeat('d',64)||'.pdf',repeat('d',64),100),
  ('91000000-0000-0000-0000-000000000003','synthetic-plan-2.pdf','application/pdf','/v1/assets/91000000-0000-0000-0000-000000000003/file','approved','local-originals',repeat('e',64)||'.pdf',repeat('e',64),100);
update hub.assets set provenance='upload',owner_id='00000000-0000-0000-0000-000000000001'
where id in('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000003');
set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select set_config('test.ct_project',hub.create_project_from_rem('COMMERCIAL-P1')::text,true);
select set_config('test.ct_other',hub.create_project_from_rem('COMMERCIAL-P2')::text,true);
select set_config('test.ct_public',public_project_id,true) from hub.projects where id=current_setting('test.ct_project')::uuid;
select set_config('test.ct_a1',public_model_id,true) from hub.model_types where project_id=current_setting('test.ct_project')::uuid and rem_model_id='A1-1';
select set_config('test.ct_a2',public_model_id,true) from hub.model_types where project_id=current_setting('test.ct_project')::uuid and rem_model_id='A1-2R';
select set_config('test.ct_legacy',public_model_id,true) from hub.model_types where project_id=current_setting('test.ct_project')::uuid and rem_model_id='LEGACY-01';
select set_config('test.ct_foreign',public_model_id,true) from hub.model_types where project_id=current_setting('test.ct_other')::uuid;
reset role;
select set_config('test.ct_before_models',(select jsonb_agg(to_jsonb(m) order by m.id)::text from hub.model_types m where project_id=current_setting('test.ct_project')::uuid),true);
select set_config('test.ct_before_sources',(select jsonb_agg(to_jsonb(m) order by m.rem_model_id)::text from staging.rem_models m where rem_project_id='COMMERCIAL-P1'),true);
select set_config('test.ct_before_payload',hub.draft_payload(current_setting('test.ct_project')::uuid)::text,true);
select set_config('test.ct_before_versions',(select count(*)::text from hub.entity_versions),true);
set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
do $$
declare p uuid:=current_setting('test.ct_project')::uuid; stamp timestamptz; result jsonb; c jsonb; before_count integer;
begin
  select updated_at into stamp from hub.projects where id=p;
  result:=hub.create_commercial_types(p,jsonb_build_array(
    jsonb_build_object('public_name',jsonb_build_object('th','Synthetic Type A1'),'source_model_ids',jsonb_build_array(current_setting('test.ct_a1'),current_setting('test.ct_a2'))),
    jsonb_build_object('public_name',jsonb_build_object('th','Synthetic Garden'),'source_model_ids',jsonb_build_array(current_setting('test.ct_legacy'))),
    jsonb_build_object('public_name',jsonb_build_object('th','Synthetic Family'),'source_model_ids',jsonb_build_array(current_setting('test.ct_legacy')))),stamp);
  assert jsonb_array_length(result->'commercial_types')=3,'Atomic set lost types';
  select value into c from jsonb_array_elements(result->'commercial_types') where value#>>'{public_name,th}'='Synthetic Type A1';
  perform set_config('test.ct_type',c->>'public_commercial_type_id',true);
  perform set_config('test.ct_uuid',c->>'id',true);
  assert jsonb_array_length(c->'source_links')=2,'Grouped REM codes were lost';
  assert (c#>>'{readiness,collection,present}')::int=2 and (c#>>'{readiness,collection,expected}')::int=10,'Collection is not actual present/expected counts';
  assert (select count(*) from jsonb_array_elements(result->'commercial_types') item,jsonb_array_elements(item->'source_links') ref where (ref->>'shared_reference')::boolean)=2,'Coarse shared references not disclosed';
  assert not exists(select 1 from jsonb_array_elements(result->'commercial_types') item where item->>'status'<>'draft'
    or (item#>>'{readiness,publication_ready}')::boolean or item?'available_unit_count' or item?'price'),'Drafts claimed review or inventory';
  begin perform hub.update_commercial_type(p,current_setting('test.ct_type'),'{"bedrooms":1}',stamp);
    raise exception 'Stale project revision accepted'; exception when serialization_failure then null; end;
  select updated_at into stamp from hub.projects where id=p;
  select count(*) into before_count from hub.commercial_types where project_id=p;
  begin perform hub.create_commercial_types(p,jsonb_build_array(
    jsonb_build_object('public_name',jsonb_build_object('th','Must roll back')),
    jsonb_build_object('public_name',jsonb_build_object('th','Wrong project'),'source_model_ids',jsonb_build_array(current_setting('test.ct_foreign')))),stamp);
    raise exception 'Cross-project reference accepted'; exception when no_data_found then null; end;
  assert (select count(*) from hub.commercial_types where project_id=p)=before_count,'Partial failed set persisted';
  assert (select updated_at=stamp from hub.projects where id=p),'Failed set touched project';
  begin perform hub.create_commercial_types(p,'[{"public_name":{"th":"Duplicate set"}},{"public_name":{"th":"Duplicate set"}}]',stamp);
    raise exception 'Duplicate named set accepted'; exception when unique_violation then null; end;
  assert (select count(*) from hub.commercial_types where project_id=p)=before_count,'Duplicate set partially persisted';
  begin perform hub.update_commercial_type(current_setting('test.ct_other')::uuid,current_setting('test.ct_type'),'{"bedrooms":1}',(select updated_at from hub.projects where id=current_setting('test.ct_other')::uuid));
    raise exception 'Other project edited type'; exception when no_data_found then null; end;
  begin perform hub.update_commercial_type(p,current_setting('test.ct_type'),'{"status":"approved"}',stamp);
    raise exception 'Client approved draft'; exception when check_violation then null; end;
  begin perform hub.update_commercial_type(p,current_setting('test.ct_type'),'{"area_min_sqm":50,"area_max_sqm":20}',stamp);
    raise exception 'Reversed area accepted'; exception when check_violation then null; end;
  begin perform hub.update_commercial_type(p,current_setting('test.ct_type'),'{"bedrooms":"NaN"}',stamp);
    raise exception 'Non-finite area accepted'; exception when check_violation then null; end;
  begin perform hub.update_commercial_type(p,current_setting('test.ct_type'),jsonb_build_object('source_model_ids',jsonb_build_array(current_setting('test.ct_a1'),current_setting('test.ct_a1'))),stamp);
    raise exception 'Duplicate source references accepted'; exception when check_violation then null; end;
  perform hub.update_commercial_type(p,current_setting('test.ct_type'),'{"description":{"th":"Synthetic description"},"product_form":"house","area_min_sqm":100,"area_max_sqm":120,"bedrooms":3,"bathrooms":2,"kitchens":1,"storeys":2,"parking_spaces":0,"land_area_sqm":160}',stamp);
  perform hub.create_commercial_types(p,'[{"public_name":{"th":"Acquired pending source"},"source_model_ids":[],"source_notes":"Synthetic acquisition documents; mapping pending"}]',(select updated_at from hub.projects where id=p));
end $$;

do $$
declare p uuid:=current_setting('test.ct_project')::uuid; stamp timestamptz; metadata jsonb; result jsonb; c jsonb; binding uuid;
begin
  select updated_at into stamp from hub.projects where id=p;
  metadata:=jsonb_build_object('asset_id','91000000-0000-0000-0000-000000000002','asset_role','floor_plan','alt_text',jsonb_build_object('th','Synthetic first floor'),
    'title','Synthetic first-floor plan','floor_label','1','plan_revision','R1','applicability_model_ids',jsonb_build_array(current_setting('test.ct_a1')));
  begin perform hub.bind_commercial_asset(p,current_setting('test.ct_type'),metadata||'{"asset_role":"model_image"}',stamp);
    raise exception 'PDF accepted as model image'; exception when check_violation then null; end;
  begin perform hub.bind_commercial_asset(p,current_setting('test.ct_type'),metadata||jsonb_build_object('applicability_model_ids',jsonb_build_array(current_setting('test.ct_legacy'))),stamp);
    raise exception 'Plan referenced another commercial type source'; exception when check_violation then null; end;
  begin perform hub.bind_commercial_asset(p,current_setting('test.ct_type'),metadata||'{"alt_text":{"th":" "}}',stamp);
    raise exception 'Blank alternative text accepted'; exception when check_violation then null; end;
  perform hub.bind_commercial_asset(p,current_setting('test.ct_type'),metadata,stamp);
  begin perform hub.bind_commercial_asset(p,current_setting('test.ct_type'),metadata,stamp);
    raise exception 'Stale asset write accepted'; exception when serialization_failure then null; end;
  select updated_at into stamp from hub.projects where id=p;
  begin perform hub.bind_commercial_asset(p,current_setting('test.ct_type'),metadata,stamp);
    raise exception 'Duplicate active asset accepted'; exception when unique_violation then null; end;
  perform hub.bind_commercial_asset(p,current_setting('test.ct_type'),metadata||'{"asset_id":"91000000-0000-0000-0000-000000000003","title":"Synthetic second floor","floor_label":"2"}',stamp);
  result:=hub.bind_commercial_asset(p,current_setting('test.ct_type'),metadata||'{"asset_id":"91000000-0000-0000-0000-000000000001","asset_role":"model_image","title":"Synthetic model image"}',(select updated_at from hub.projects where id=p));
  select value into c from jsonb_array_elements(result->'commercial_types') where value->>'public_commercial_type_id'=current_setting('test.ct_type');
  assert jsonb_array_length(c->'assets')=3,'Multiple image/plan bindings lost';
  assert (c#>>'{readiness,collection,present}')::int=10,'Collected fields did not count honestly';
  assert jsonb_array_length(c#>'{readiness,review_issues}')>=2,'Pending rights or unresolved classification hidden';
  assert not (c#>>'{readiness,publication_ready}')::boolean,'Complete collection falsely approved publication';
  select id into binding from hub.commercial_type_assets where commercial_type_id=current_setting('test.ct_uuid')::uuid and asset_role='floor_plan' and asset_id='91000000-0000-0000-0000-000000000002';
  perform set_config('test.ct_binding',binding::text,true);
  begin perform hub.update_commercial_type(p,current_setting('test.ct_type'),'{"source_model_ids":[]}',(select updated_at from hub.projects where id=p));
    raise exception 'Removed source still referenced by plan'; exception when check_violation then null; end;
  begin perform hub.unbind_commercial_asset(current_setting('test.ct_other')::uuid,current_setting('test.ct_type'),binding,(select updated_at from hub.projects where id=current_setting('test.ct_other')::uuid));
    raise exception 'Other project unbound media'; exception when no_data_found then null; end;
  begin perform hub.unbind_model_asset(p,current_setting('test.ct_a1'),binding,(select updated_at from hub.projects where id=p));
    raise exception 'Technical model route removed commercial binding'; exception when no_data_found then null; end;
end $$;

set local role viewer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000003',true);
do $$ begin
  assert jsonb_array_length(hub.project_detail(current_setting('test.ct_public'))->'commercial_types')=4,'Viewer cannot inspect drafts';
  begin perform hub.create_commercial_types(current_setting('test.ct_project')::uuid,'[{"public_name":{"th":"Denied"}}]',now());
    raise exception 'Viewer wrote type'; exception when insufficient_privilege then null; end;
  begin perform hub.bind_commercial_asset(current_setting('test.ct_project')::uuid,current_setting('test.ct_type'),'{}',now());
    raise exception 'Viewer wrote binding'; exception when insufficient_privilege then null; end;
end $$;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  begin perform hub.project_detail(current_setting('test.ct_public')); raise exception 'Consumer read commercial drafts'; exception when insufficient_privilege then null; end;
  begin perform 1 from hub.commercial_types; raise exception 'Consumer read draft table'; exception when insufficient_privilege then null; end;
  begin perform public_api.asset_file('91000000-0000-0000-0000-000000000002'); raise exception 'Draft PDF leaked'; exception when no_data_found then null; end;
  begin perform public_api.asset_file('91000000-0000-0000-0000-000000000001'); raise exception 'Approved but unpublished draft image leaked'; exception when no_data_found then null; end;
end $$;
set local role admin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true);
select hub.update_commercial_type(id,current_setting('test.ct_type'),'{"source_notes":"Admin can edit content but cannot approve classification"}',updated_at)
from hub.projects where id=current_setting('test.ct_project')::uuid;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select hub.review_asset(id,updated_at,'revoked','Synthetic revocation',null,null,'Synthetic withdrawal') from hub.assets where id='91000000-0000-0000-0000-000000000002';
do $$ begin
 begin perform hub.update_commercial_type(id,current_setting('test.ct_type'),'{"source_notes":"Denied publisher edit"}',updated_at)
 from hub.projects where id=current_setting('test.ct_project')::uuid;
 raise exception 'Publisher edited a commercial draft'; exception when insufficient_privilege then null; end;
end $$;
set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select hub.unbind_commercial_asset(id,current_setting('test.ct_type'),current_setting('test.ct_binding')::uuid,updated_at)
from hub.projects where id=current_setting('test.ct_project')::uuid;
do $$ begin
  begin update hub.commercial_types set status='draft' where id=current_setting('test.ct_uuid')::uuid;
    raise exception 'Direct unaudited edit allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  assert (select jsonb_agg(to_jsonb(m) order by m.id) from hub.model_types m where project_id=current_setting('test.ct_project')::uuid)=current_setting('test.ct_before_models')::jsonb,'Technical model identity or review changed';
  assert (select jsonb_agg(to_jsonb(m) order by m.rem_model_id) from staging.rem_models m where rem_project_id='COMMERCIAL-P1')=current_setting('test.ct_before_sources')::jsonb,'REM source changed';
  assert hub.draft_payload(current_setting('test.ct_project')::uuid)=current_setting('test.ct_before_payload')::jsonb,'Private drafts entered existing public contract';
  assert (select count(*) from hub.entity_versions)=current_setting('test.ct_before_versions')::int,'Private content auto-published';
  assert exists(select 1 from audit.change_log where table_name='hub.commercial_types' and after_row->>'id'=current_setting('test.ct_uuid')),'Commercial writes lack audit';
  assert exists(select 1 from audit.change_log where table_name='hub.commercial_type_sources' and after_row->>'commercial_type_id'=current_setting('test.ct_uuid')),'Reference writes lack audit';
  assert exists(select 1 from audit.change_log where table_name='hub.commercial_type_assets' and after_row->>'id'=current_setting('test.ct_binding')),'Media writes lack audit';
end $$;
rollback;
