-- Synthetic Phase 5 source grain, expiry, history and media checks only.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select set_config('app.change_reason','Synthetic unit type and price checks',true);
insert into staging.rem_projects(rem_project_id,project_name_rem,source_fingerprint) values('UNIT-P5','Synthetic unit project','synthetic');
insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_fingerprint,source_record)
 values('UNIT-P5','A1-1','Source A1','synthetic','{"model_area":"25.5"}'),('UNIT-P5','A1-2','Source A1 other','synthetic','{"model_area":"28.5"}');
insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance,model_groups)
 values('UNIT-P5','{"project_id":"UNIT-P5"}',now(),repeat('a',64),'{}',
 '[{"project_model_key":"group-a","model_name":"Source group A","model_ids":["A1-1","A1-2"],"minimum_model_area":25.5,"maximum_model_area":28.5,"total_unit_count":100,"available_unit_count":7,"minimum_available_selling_price":2000000}]');
set local role hub_app;
select set_config('test.unit_project',hub.create_project_from_rem('UNIT-P5')::text,true);
select set_config('test.unit_public',public_project_id,true) from hub.projects where id=current_setting('test.unit_project')::uuid;
do $$ declare p hub.projects; data jsonb; item jsonb; code text; begin
 select * into p from hub.projects where id=current_setting('test.unit_project')::uuid;
 select public_model_id into code from hub.model_types where project_id=p.id and rem_model_id='A1-1';
 data:=hub.create_commercial_types(p.id,jsonb_build_array(jsonb_build_object('public_name','{"th":"Garden","en":"Garden"}'::jsonb,
  'description','{"th":"Garden house","en":"Garden house"}'::jsonb,'product_form','house','category','single_house','storeys',2,
  'price_mode','manual','source_model_ids',jsonb_build_array(code))),p.updated_at);
 item:=data->'commercial_types'->0;
 perform set_config('test.unit_id',item->>'id',true);perform set_config('test.unit_code',item->>'public_commercial_type_id',true);
 data:=hub.unit_type_workspace(p.public_project_id);
 assert jsonb_array_length(data#>'{source,groups}')=1,'Group was repeated per source model';
 assert data#>>'{source,groups,0,total_unit_count}'='100' and data#>>'{source,groups,0,available_unit_count}'='7','Snapshot counts lost';
 assert data#>>'{types,0,comparison,rem_min_available}'='2000000','Comparison source missing';
 assert data#>>'{types,0,bedrooms}' is null and data#>>'{types,0,bathrooms}' is null,'Rooms inferred from source';
 assert not(data#>'{types,0}')?'available_unit_count','Shared source count claimed as allocation';
 begin perform hub.update_commercial_type(p.id,item->>'public_commercial_type_id','{"price_mode":"rem_auto"}',(select updated_at from hub.projects where id=p.id));
  raise exception 'REM auto price enabled';exception when check_violation then null;end;
 begin perform hub.update_commercial_type(p.id,item->>'public_commercial_type_id','{"available_unit_count":3}',(select updated_at from hub.projects where id=p.id));
  raise exception 'Typed inventory accepted';exception when check_violation then null;end;
end $$;
reset role;
insert into hub.assets(id,original_filename,mime_type,public_url,rights_status,storage_bucket,storage_path,checksum,file_size,provenance,owner_id,ai_exposure,marketing_publication,media_category,metadata_state)
 values('95000000-0000-0000-0000-000000000001','synthetic-unit-plan.png','image/png','/v1/assets/95000000-0000-0000-0000-000000000001/file','approved','local-originals',repeat('f',64)||'.png',repeat('f',64),100,'upload','00000000-0000-0000-0000-000000000001','open',true,'unit_plan','confirmed'),
 ('95000000-0000-0000-0000-000000000002','synthetic-internal.png','image/png','/v1/assets/95000000-0000-0000-0000-000000000002/file','approved','local-originals',repeat('e',64)||'.png',repeat('e',64),100,'upload','00000000-0000-0000-0000-000000000001','internal',false,null,'needs_review');
set local role hub_app;
do $$ declare data jsonb; trans jsonb;p hub.projects;price_id uuid;begin
 select * into p from hub.projects where id=current_setting('test.unit_project')::uuid;
 data:=hub.bind_commercial_asset(p.id,current_setting('test.unit_code'),'{"asset_id":"95000000-0000-0000-0000-000000000001","asset_role":"floor_plan","alt_text":{"th":"Plan","en":"Plan"},"title":"Plan","floor_number":1,"room_tag":"living_room","caption":{"th":"Ground floor","en":"Ground floor"}}',p.updated_at);
 assert data#>>'{commercial_types,0,assets,0,floor_number}'='1','Structured plan floor lost';
 assert data#>>'{commercial_types,0,assets,0,caption,en}'='Ground floor','Bilingual caption lost';
 assert data#>>'{commercial_types,0,assets,0,room_tag}'='living_room','Room tag lost';
 perform hub.bind_commercial_asset(p.id,current_setting('test.unit_code'),'{"asset_id":"95000000-0000-0000-0000-000000000002","asset_role":"model_image","alt_text":{"th":"Internal"},"title":"Internal"}',(select updated_at from hub.projects where id=p.id));
 begin perform hub.bind_commercial_asset(p.id,current_setting('test.unit_code'),'{"asset_id":"95000000-0000-0000-0000-000000000001","asset_role":"model_image","alt_text":{"th":"Photo"},"title":"Photo","floor_number":3}',(select updated_at from hub.projects where id=p.id));
  raise exception 'Out of range floor accepted';exception when check_violation then null;end;
 for trans in select value from jsonb_array_elements(hub.content_translation_list('projects',p.public_project_id)) where value->>'owner_key'=current_setting('test.unit_id') and value->>'th_text'<>'' loop
  perform hub.review_content_translation((trans->>'id')::uuid,(trans->>'revision')::int,(trans->>'th_version')::int,trans->>'entered_en');
 end loop;
 perform hub.unit_type_review(p.public_project_id,current_setting('test.unit_code'),(select updated_at from hub.projects where id=p.id),'submit');
 data:=hub.save_project_price(p.public_project_id,null,(select updated_at from hub.projects where id=p.id),
  jsonb_build_object('kind','starting','commercial_type_id',current_setting('test.unit_id'),'amount',1800000,'basis_size_sqm',25.5,
   'display_text','{"th":"Starting","en":"Starting"}'::jsonb,'basis','{"th":"Garden type","en":"Garden type"}'::jsonb,
   'condition_text','{"th":"Selected units","en":"Selected units"}'::jsonb,'valid_from',current_date,'valid_to',current_date+60));
 price_id:=(data->>'price_id')::uuid;perform set_config('test.unit_price',price_id::text,true);
 data:=hub.unit_type_workspace(p.public_project_id);
 assert (data#>>'{prices,0,rem_difference}')::boolean,'REM difference warning missing';
 for trans in select value from jsonb_array_elements(hub.content_translation_list('projects',p.public_project_id)) where value->>'owner_key'=price_id::text loop
  assert trans->'job'='null'::jsonb,'Price text sent to AI';
  perform hub.review_content_translation((trans->>'id')::uuid,(trans->>'revision')::int,(trans->>'th_version')::int,trans->>'entered_en');
 end loop;
 perform hub.project_price_review(p.public_project_id,price_id,(select updated_at from hub.projects where id=p.id),'submit');
end $$;
-- Managers approve content independently of its author and the price difference.
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select hub.unit_type_review(current_setting('test.unit_public'),current_setting('test.unit_code'),(select updated_at from hub.projects where id=current_setting('test.unit_project')::uuid),'approve');
select hub.project_price_review(current_setting('test.unit_public'),current_setting('test.unit_price')::uuid,(select updated_at from hub.projects where id=current_setting('test.unit_project')::uuid),'approve');
reset role;
do $$ declare payload jsonb; frozen jsonb;item uuid:=current_setting('test.unit_id')::uuid;price uuid:=current_setting('test.unit_price')::uuid;p uuid:=current_setting('test.unit_project')::uuid;begin
 payload:=hub.project_current_prices(p);assert jsonb_array_length(payload)=1,'Difference blocked approved Marketing price';
 assert not(payload->0)?'rem_min_available' and not(payload->0)?'commercial_type_id','Private comparison escaped';
 select v.payload into frozen from hub.commercial_type_versions v where commercial_type_id=item;
 assert frozen#>>'{assets,0,public_asset_id}'='ast_'||repeat('f',64),'Asset public identity missing';
 assert jsonb_array_length(frozen->'assets')=1,'Internal asset escaped into the publishable snapshot';
 assert not(frozen#>'{assets,0}')?'id' and frozen#>>'{assets,0,caption,en}'='Ground floor','Private asset identity or lost caption';
 begin update hub.commercial_type_versions set payload='{}' where commercial_type_id=item;raise exception 'Frozen type edited';exception when check_violation then null;end;
 begin delete from hub.project_price_versions where price_id=price;raise exception 'Price history deleted';exception when check_violation then null;end;
 update hub.project_prices set valid_from=current_date-2,valid_to=current_date-1 where id=price;
 assert hub.project_current_prices(p)='[]','Expired price remains eligible';
 update hub.project_prices set valid_from=current_date,valid_to=current_date+60 where id=price;
 update hub.commercial_types set price_mode='hidden' where id=item;
 assert hub.project_current_prices(p)='[]','Hidden type price remains eligible';
 assert (select v.payload=frozen from hub.commercial_type_versions v where commercial_type_id=item),'Editing type rewrote prior approval';
 assert not exists(select 1 from hub.entity_versions where project_id=p),'Type approval published a website release';
 assert (select model_groups#>>'{0,total_unit_count}' from staging.dw_projects where rem_project_id='UNIT-P5')='100','Source counts were changed';
end $$;
rollback;
