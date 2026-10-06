-- Synthetic fixtures and audit events are rolled back together.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select set_config('app.change_reason','Synthetic project media collection checks',true);
insert into staging.rem_brands(rem_brand_id,brand_name_rem,source_fingerprint)
values ('MEDIA-COLLECTION-BRAND','Synthetic collection brand','synthetic');
insert into staging.rem_projects(rem_project_id,project_name_rem,rem_brand_id,source_fingerprint)
values ('MEDIA-COLLECTION-P1','Synthetic collection project','MEDIA-COLLECTION-BRAND','synthetic');
insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_fingerprint)
values ('MEDIA-COLLECTION-P1','A1','Synthetic A1','synthetic');
insert into hub.assets(id,original_filename,mime_type,public_url,rights_status,storage_bucket,storage_path,checksum,file_size)
values
 ('91300000-0000-0000-0000-000000000001','collection-first.jpg','image/jpeg','/v1/assets/91300000-0000-0000-0000-000000000001/file','approved','local-originals',repeat('d',64)||'.jpg',repeat('d',64),100),
 ('91300000-0000-0000-0000-000000000002','collection-second.jpg','image/jpeg','/v1/assets/91300000-0000-0000-0000-000000000002/file','pending','local-originals',repeat('e',64)||'.jpg',repeat('e',64),100),
 ('91300000-0000-0000-0000-000000000003','collection-first.pdf','application/pdf','/v1/assets/91300000-0000-0000-0000-000000000003/file','approved','local-originals',repeat('f',64)||'.pdf',repeat('f',64),100),
 ('91300000-0000-0000-0000-000000000004','collection-second.pdf','application/pdf','/v1/assets/91300000-0000-0000-0000-000000000004/file','approved','local-originals',repeat('1d',32)||'.pdf',repeat('1d',32),100);

-- Brand logo selection still replaces the previous logo; project collections do not.
set local role admin;
select set_config('test.pc_brand',hub.create_brand_from_rem('MEDIA-COLLECTION-BRAND')::text,true);
select hub.update_brand_draft(id,'{"public_name":{"th":"Synthetic media collection brand"},"slug":"media-collection-brand","description":{"th":"Synthetic brand"}}',updated_at)
from hub.brands where id=current_setting('test.pc_brand')::uuid;
select hub.bind_brand_asset(id,'91300000-0000-0000-0000-000000000002','logo_primary','{"th":"Old logo"}',updated_at)
from hub.brands where id=current_setting('test.pc_brand')::uuid;
select hub.bind_brand_asset(id,'91300000-0000-0000-0000-000000000001','logo_primary','{"th":"Current logo"}',updated_at)
from hub.brands where id=current_setting('test.pc_brand')::uuid;
do $$ begin
  assert (select count(*) from hub.brand_assets where brand_id=current_setting('test.pc_brand')::uuid
    and asset_role='logo_primary' and deleted_at is null)=1, 'Brand logo replacement changed';
end $$;
set local role publisher;
select hub.publish_brand(current_setting('test.pc_brand')::uuid,'Synthetic collection brand');
set local role editor;
select set_config('test.pc_project',hub.create_project_from_rem('MEDIA-COLLECTION-P1')::text,true);
select set_config('test.pc_public',public_project_id,true) from hub.projects where id=current_setting('test.pc_project')::uuid;
select set_config('test.pc_model',public_model_id,true) from hub.model_types where project_id=current_setting('test.pc_project')::uuid;
select hub.assign_project_brand(id,current_setting('test.pc_brand')::uuid,updated_at) from hub.projects where id=current_setting('test.pc_project')::uuid;
select hub.patch_project(id,'{"public_name":{"th":"Synthetic collection project"},"slug":"media-collection-project","address":{"th":"Synthetic address"},"latitude":13.7563,"longitude":100.5018,"ad_disclaimer":{"th":"Synthetic only"}}',updated_at)
from hub.projects where id=current_setting('test.pc_project')::uuid;
select hub.update_model(id,current_setting('test.pc_model'),'{"bedrooms":1,"bathrooms":1,"usable_area_sqm":25}',updated_at)
from hub.projects where id=current_setting('test.pc_project')::uuid;
select hub.review_model(id,current_setting('test.pc_model'),updated_at,'CONFIRMED','Synthetic mapping only')
from hub.projects where id=current_setting('test.pc_project')::uuid;

do $$
declare p uuid:=current_setting('test.pc_project')::uuid; role_name text; first_id uuid; second_id uuid;
  stamp timestamptz; before_retry jsonb; result jsonb;
begin
  foreach role_name in array array['hero','thumbnail','master_plan','floor_plan','brochure'] loop
    first_id:=case when role_name='brochure' then '91300000-0000-0000-0000-000000000003'::uuid else '91300000-0000-0000-0000-000000000001'::uuid end;
    second_id:=case when role_name='brochure' then '91300000-0000-0000-0000-000000000004'::uuid else '91300000-0000-0000-0000-000000000002'::uuid end;
    select updated_at into stamp from hub.projects where id=p;
    perform hub.bind_project_asset(p,first_id,role_name,'{"th":"First original caption"}',stamp);
    begin
      perform hub.bind_project_asset(p,second_id,role_name,'{"th":"Stale append"}',stamp);
      raise exception 'Stale collection append accepted'; exception when serialization_failure then null;
    end;
    perform hub.bind_project_asset(p,second_id,role_name,'{"th":"Second original caption"}',(select updated_at from hub.projects where id=p));
    assert (select count(*) from hub.entity_assets where project_id=p and model_id is null
      and asset_role=role_name and deleted_at is null)=2, 'Appending replaced an existing project attachment';
    assert (select count(*) from hub.entity_assets where project_id=p and model_id is null
      and asset_role=role_name and deleted_at is null and is_primary)=case when role_name in ('hero','thumbnail','brochure') then 1 else 0 end,
      'Primary compatibility marker changed';
    assert exists(select 1 from hub.entity_assets where project_id=p and model_id is null and asset_role=role_name
      and asset_id=first_id and deleted_at is null and alt_text->>'th'='First original caption'), 'Original caption was overwritten';
    -- A current-revision retry does not create/reorder rows or rewrite captions.
    before_retry:=hub.project_detail(current_setting('test.pc_public'));
    result:=hub.bind_project_asset(p,second_id,role_name,'{"th":"Retry must not overwrite caption"}',(select updated_at from hub.projects where id=p));
    assert result=before_retry, 'Duplicate project attachment changed metadata, order or revision';
    begin
      perform hub.bind_project_asset(p,first_id,role_name,'{"th":"Stale duplicate"}',stamp);
      raise exception 'Stale duplicate bypassed revision check'; exception when serialization_failure then null;
    end;
  end loop;
  result:=hub.project_detail(current_setting('test.pc_public'));
  assert jsonb_array_length(result->'assets')=10, 'Project response lost a role collection';
  assert (select count(distinct display_order) from hub.entity_assets where project_id=p and deleted_at is null)=10,
    'Appended project attachments lost deterministic ordering';
  assert (result#>>'{readiness,ready}')::boolean, 'Optional unapproved secondary image blocked publication';
  select updated_at into stamp from hub.projects where id=p;
  begin
    perform hub.bind_project_asset(p,'91300000-0000-0000-0000-000000000003','hero','{"th":"Wrong MIME"}',stamp);
    raise exception 'PDF accepted as project image'; exception when check_violation then null;
  end;
  begin
    perform hub.bind_project_asset(p,'91300000-0000-0000-0000-000000000001','brochure','{"th":"Wrong MIME"}',stamp);
    raise exception 'Image accepted as project brochure'; exception when check_violation then null;
  end;
  -- The shared implementation preserves canonical model scope and duplicate rejection.
  perform hub.bind_model_asset(p,current_setting('test.pc_model'),'91300000-0000-0000-0000-000000000001','model_image','{"th":"Model first"}',stamp);
  perform hub.bind_model_asset(p,current_setting('test.pc_model'),'91300000-0000-0000-0000-000000000002','model_image','{"th":"Model second"}',(select updated_at from hub.projects where id=p));
  begin
    perform hub.bind_model_asset(p,current_setting('test.pc_model'),'91300000-0000-0000-0000-000000000001','model_image','{"th":"Model duplicate"}',(select updated_at from hub.projects where id=p));
    raise exception 'Model duplicate behavior changed'; exception when unique_violation then null;
  end;
end $$;

set local role viewer;
do $$ begin
  begin
    perform hub.bind_project_asset(current_setting('test.pc_project')::uuid,'91300000-0000-0000-0000-000000000001','hero','{"th":"Denied"}',now());
    raise exception 'Viewer appended project media'; exception when insufficient_privilege then null;
  end;
  begin
    perform hub.unbind_project_asset(current_setting('test.pc_project')::uuid,'91300000-0000-0000-0000-000000000001',now());
    raise exception 'Viewer removed project media'; exception when insufficient_privilege then null;
  end;
end $$;
set local role service_consumer;
do $$ begin
  begin perform public_api.asset_file('91300000-0000-0000-0000-000000000002');
    raise exception 'Secondary draft image leaked'; exception when no_data_found then null;
  end;
end $$;
set local role publisher;
select hub.review_asset(id,updated_at,'approved','Synthetic image rights',null,null,'Synthetic collection review')
from hub.assets where id='91300000-0000-0000-0000-000000000002';
select hub.publish_project(current_setting('test.pc_project')::uuid,'Synthetic media collections release');
set local role service_consumer;
select set_config('test.pc_payload',payload::text,true) from public_api.projects where public_project_id=current_setting('test.pc_public');
do $$ begin
  assert jsonb_array_length(current_setting('test.pc_payload')::jsonb->'assets')=12, 'Published snapshot lost secondary attachments';
  perform public_api.asset_file('91300000-0000-0000-0000-000000000002');
  perform public_api.asset_file('91300000-0000-0000-0000-000000000004');
end $$;

-- Removing the first image promotes the next image without rewriting a release.
set local role editor;
do $$
declare p uuid:=current_setting('test.pc_project')::uuid; role_name text; binding uuid; stamp timestamptz;
begin
  foreach role_name in array array['hero','thumbnail','brochure'] loop
    select id into binding from hub.entity_assets where project_id=p and model_id is null
      and asset_role=role_name and is_primary and deleted_at is null;
    select updated_at into stamp from hub.projects where id=p;
    perform hub.unbind_project_asset(p,binding,stamp);
    assert (select count(*) from hub.entity_assets where project_id=p and model_id is null
      and asset_role=role_name and deleted_at is null)=1, 'Removing one attachment deleted siblings';
    assert exists(select 1 from hub.entity_assets where project_id=p and model_id is null
      and asset_role=role_name and deleted_at is null and is_primary and alt_text->>'th'='Second original caption'),
      'Removing first attachment did not promote the next';
    begin
      perform hub.unbind_project_asset(p,(select id from hub.entity_assets where project_id=p and model_id is null
        and asset_role=role_name and deleted_at is null),stamp);
      raise exception 'Stale removal accepted'; exception when serialization_failure then null;
    end;
  end loop;
  assert (hub.project_detail(current_setting('test.pc_public'))#>>'{readiness,ready}')::boolean,
    'Removing primary left a nonempty ready collection without primary';
end $$;
set local role service_consumer;
do $$ begin
  assert (select payload=current_setting('test.pc_payload')::jsonb from public_api.projects where public_project_id=current_setting('test.pc_public')),
    'Draft removal changed the selected publication';
end $$;
set local role publisher;
select hub.review_asset(id,updated_at,'revoked','Synthetic secondary withdrawal',null,null,'Synthetic collection withdrawal')
from hub.assets where id='91300000-0000-0000-0000-000000000004';
set local role service_consumer;
do $$ begin
  assert not exists(select 1 from public_api.projects where public_project_id=current_setting('test.pc_public')),
    'Revoked secondary brochure remained eligible in the publication';
  begin perform public_api.asset_file('91300000-0000-0000-0000-000000000004');
    raise exception 'Revoked secondary brochure leaked'; exception when no_data_found then null;
  end;
end $$;
rollback;
