-- Isolated synthetic fixtures; every record and audit event rolls back.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select set_config('app.change_reason','Synthetic model media checks',true);
insert into staging.rem_brands(rem_brand_id,brand_name_rem,source_fingerprint)
values ('MODEL-MEDIA-BRAND','Synthetic model media brand','synthetic');
insert into staging.rem_projects(rem_project_id,project_name_rem,rem_brand_id,source_fingerprint)
values ('MODEL-MEDIA-P1','Synthetic project one','MODEL-MEDIA-BRAND','synthetic'),
       ('MODEL-MEDIA-P2','Synthetic project two','MODEL-MEDIA-BRAND','synthetic');
insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_fingerprint)
values ('MODEL-MEDIA-P1','A1','Synthetic A1','synthetic'),('MODEL-MEDIA-P1','B1','Synthetic B1','synthetic'),
       ('MODEL-MEDIA-P2','A1','Other project A1','synthetic');
insert into hub.assets(id,original_filename,mime_type,public_url,rights_status,storage_bucket,storage_path,checksum,file_size)
values ('90900000-0000-0000-0000-000000000001','synthetic-model.jpg','image/jpeg','/v1/assets/90900000-0000-0000-0000-000000000001/file','approved','local-originals',repeat('9',64)||'.jpg',repeat('9',64),100),
       ('90900000-0000-0000-0000-000000000002','synthetic-plan.pdf','application/pdf','/v1/assets/90900000-0000-0000-0000-000000000002/file','pending','local-originals',repeat('8',64)||'.pdf',repeat('8',64),100);
set local role admin;
select set_config('test.mm_brand',hub.create_brand_from_rem('MODEL-MEDIA-BRAND')::text,true);
select hub.update_brand_draft(id,'{"public_name":{"th":"Synthetic model media brand"},"slug":"model-media-brand","description":{"th":"Synthetic brand"}}',updated_at)
from hub.brands where id=current_setting('test.mm_brand')::uuid;
select hub.bind_brand_asset(id,'90900000-0000-0000-0000-000000000001','logo_primary','{"th":"Synthetic logo"}',updated_at)
from hub.brands where id=current_setting('test.mm_brand')::uuid;
set local role publisher;
select hub.publish_brand(current_setting('test.mm_brand')::uuid,'Synthetic brand only');
set local role editor;
select set_config('test.mm_project',hub.create_project_from_rem('MODEL-MEDIA-P1')::text,true);
select set_config('test.mm_other',hub.create_project_from_rem('MODEL-MEDIA-P2')::text,true);
select set_config('test.mm_public',public_project_id,true) from hub.projects where id=current_setting('test.mm_project')::uuid;
select set_config('test.mm_model',public_model_id,true) from hub.model_types where project_id=current_setting('test.mm_project')::uuid and rem_model_id='A1';
select set_config('test.mm_second',public_model_id,true) from hub.model_types where project_id=current_setting('test.mm_project')::uuid and rem_model_id='B1';
select set_config('test.mm_foreign',public_model_id,true) from hub.model_types where project_id=current_setting('test.mm_other')::uuid;
select hub.assign_project_brand(id,current_setting('test.mm_brand')::uuid,updated_at) from hub.projects where id=current_setting('test.mm_project')::uuid;
select hub.patch_project(id,'{"public_name":{"th":"Synthetic marketing project"},"slug":"model-media-project","address":{"th":"Synthetic address"},"latitude":0,"longitude":0,"ad_disclaimer":{"th":"Synthetic only"}}',updated_at)
from hub.projects where id=current_setting('test.mm_project')::uuid;
do $$
declare p uuid:=current_setting('test.mm_project')::uuid; m text; stamp timestamptz; binding uuid; result jsonb;
begin
  for m in select public_model_id from hub.model_types where project_id=p loop
    perform hub.update_model(p,m,'{"bedrooms":1,"bathrooms":1,"usable_area_sqm":25}',(select updated_at from hub.projects where id=p));
    perform hub.review_model(p,m,(select updated_at from hub.projects where id=p),'CONFIRMED','Synthetic mapping only');
  end loop;
  perform hub.bind_project_asset(p,'90900000-0000-0000-0000-000000000001','hero','{"th":"Synthetic hero"}',(select updated_at from hub.projects where id=p));
  perform hub.bind_project_asset(p,'90900000-0000-0000-0000-000000000001','thumbnail','{"th":"Synthetic thumbnail"}',(select updated_at from hub.projects where id=p));
  select updated_at into stamp from hub.projects where id=p;
  begin perform hub.bind_model_asset(p,current_setting('test.mm_foreign'),'90900000-0000-0000-0000-000000000001','model_image','{"th":"Wrong project"}',stamp);
    raise exception 'Cross-project model accepted'; exception when no_data_found then null; end;
  begin perform hub.bind_model_asset(p,current_setting('test.mm_model'),'90900000-0000-0000-0000-000000000002','model_image','{"th":"PDF as image"}',stamp);
    raise exception 'Wrong model media MIME accepted'; exception when check_violation then null; end;
  perform hub.bind_model_asset(p,current_setting('test.mm_model'),'90900000-0000-0000-0000-000000000001','model_image','{"th":"Synthetic model photo"}',stamp);
  begin perform hub.bind_model_asset(p,current_setting('test.mm_model'),'90900000-0000-0000-0000-000000000002','floor_plan','{"th":"Stale request"}',stamp);
    raise exception 'Stale model binding accepted'; exception when serialization_failure then null; end;
  perform hub.bind_model_asset(p,current_setting('test.mm_model'),'90900000-0000-0000-0000-000000000002','floor_plan','{"th":"Synthetic layout PDF"}',(select updated_at from hub.projects where id=p));
  perform hub.bind_model_asset(p,current_setting('test.mm_model'),'90900000-0000-0000-0000-000000000001','floor_plan','{"th":"Synthetic second layout"}',(select updated_at from hub.projects where id=p));
  perform hub.bind_model_asset(p,current_setting('test.mm_second'),'90900000-0000-0000-0000-000000000001','model_image','{"th":"Shared model image"}',(select updated_at from hub.projects where id=p));
  perform hub.bind_project_asset(p,'90900000-0000-0000-0000-000000000002','master_plan','{"th":"Synthetic project master plan"}',(select updated_at from hub.projects where id=p));
  result:=hub.project_detail(current_setting('test.mm_public'));
  assert (select count(*) from jsonb_array_elements(result->'assets') a where a->>'public_model_id'=current_setting('test.mm_model'))=3, 'Multiple model media or association lost';
  assert not (result#>>'{readiness,ready}')::boolean, 'Pending model plan did not block publication';
  select id into binding from hub.entity_assets where project_id=p and model_id=(select id from hub.model_types where public_model_id=current_setting('test.mm_model')) and asset_role='model_image' and deleted_at is null;
  begin perform hub.unbind_project_asset(p,binding,(select updated_at from hub.projects where id=p));
    raise exception 'Project route removed model binding'; exception when no_data_found then null; end;
  begin perform hub.unbind_model_asset(p,current_setting('test.mm_second'),binding,(select updated_at from hub.projects where id=p));
    raise exception 'Other model removed binding'; exception when no_data_found then null; end;
  perform set_config('test.mm_binding',binding::text,true);
end $$;
set local role viewer;
do $$ begin
  begin perform hub.bind_model_asset(current_setting('test.mm_project')::uuid,current_setting('test.mm_model'),'90900000-0000-0000-0000-000000000001','model_image','{"th":"Denied"}',now());
    raise exception 'Viewer wrote media'; exception when insufficient_privilege then null; end;
end $$;
set local role service_consumer;
do $$ begin
  begin perform public_api.asset_file('90900000-0000-0000-0000-000000000002'); raise exception 'Draft model file leaked'; exception when no_data_found then null; end;
end $$;
set local role publisher;
select hub.review_asset(id,updated_at,'approved','Synthetic test PDF',null,null,'Synthetic review') from hub.assets where id='90900000-0000-0000-0000-000000000002';
select hub.publish_project(current_setting('test.mm_project')::uuid,'Synthetic project with model media');
set local role service_consumer;
select set_config('test.mm_payload',payload::text,true) from public_api.projects where public_project_id=current_setting('test.mm_public');
do $$ begin
  perform public_api.asset_file('90900000-0000-0000-0000-000000000002');
  assert exists(select 1 from jsonb_array_elements(current_setting('test.mm_payload')::jsonb->'assets') a where a->>'public_model_id'=current_setting('test.mm_model')), 'Published model association missing';
end $$;
set local role editor;
select hub.unbind_model_asset(id,current_setting('test.mm_model'),current_setting('test.mm_binding')::uuid,updated_at) from hub.projects where id=current_setting('test.mm_project')::uuid;
set local role service_consumer;
do $$ begin
  assert (select payload=current_setting('test.mm_payload')::jsonb from public_api.projects where public_project_id=current_setting('test.mm_public')), 'Draft removal mutated published model media';
end $$;
set local role editor;
select hub.review_model(id,current_setting('test.mm_second'),updated_at,'REJECTED','Synthetic exclusion') from hub.projects where id=current_setting('test.mm_project')::uuid;
do $$ begin
  assert exists(select 1 from jsonb_array_elements(hub.project_detail(current_setting('test.mm_public'))->'assets') a where a->>'public_model_id'=current_setting('test.mm_second')), 'Staff lost rejected model attachments';
end $$;
set local role publisher;
select hub.publish_project(current_setting('test.mm_project')::uuid,'Synthetic release excludes rejected model');
set local role service_consumer;
do $$ begin
  assert not exists(select 1 from public_api.projects p,jsonb_array_elements(p.payload->'assets') a where p.public_project_id=current_setting('test.mm_public') and a->>'public_model_id'=current_setting('test.mm_second')), 'Rejected model media entered new release';
end $$;
set local role publisher;
select hub.review_asset(id,updated_at,'revoked','Synthetic withdrawal',null,null,'Synthetic revocation') from hub.assets where id='90900000-0000-0000-0000-000000000002';
set local role service_consumer;
do $$ begin
  assert not exists(select 1 from public_api.projects where public_project_id=current_setting('test.mm_public')), 'Revoked model plan remained published';
  begin perform public_api.asset_file('90900000-0000-0000-0000-000000000002'); raise exception 'Revoked model file leaked'; exception when no_data_found then null; end;
end $$;
rollback;
