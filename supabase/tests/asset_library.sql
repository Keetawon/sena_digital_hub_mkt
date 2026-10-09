-- Registry/access tests only: API tests validate file bytes. All fixtures roll back.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select set_config('app.change_reason','SQL asset-library fixture',true);
insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint) values
  ('SQL-ASSET-A','Synthetic asset project A',now(),'synthetic-asset-a'),
  ('SQL-ASSET-B','Synthetic asset project B',now(),'synthetic-asset-b');
insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_updated_at,source_fingerprint)
  select rem_project_id,'M1','Synthetic asset model',now(),'synthetic-asset-model'
  from staging.rem_projects where rem_project_id in ('SQL-ASSET-A','SQL-ASSET-B');
select set_config('test.upload_image',jsonb_build_object('original_filename','synthetic-image.jpg','mime_type','image/jpeg',
  'storage_path',repeat('a',64)||'.jpg','checksum',repeat('a',64),'file_size',100,'asset_type','image','width',10,'height',10)::text,true);
select set_config('test.upload_second',jsonb_build_object('original_filename','synthetic-second.png','mime_type','image/png',
  'storage_path',repeat('b',64)||'.png','checksum',repeat('b',64),'file_size',100,'asset_type','image','width',10,'height',10)::text,true);
select set_config('test.upload_pdf',jsonb_build_object('original_filename','synthetic-brochure.pdf','mime_type','application/pdf',
  'storage_path',repeat('c',64)||'.pdf','checksum',repeat('c',64),'file_size',100,'asset_type','document')::text,true);

insert into staging.rem_brands(rem_brand_id,brand_name_rem,source_updated_at,source_fingerprint)
values ('SQL-ASSET-BRAND','Synthetic asset test brand',now(),'synthetic-asset-brand');
set local role admin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true);
select set_config('test.fixture_brand',hub.create_brand_from_rem('SQL-ASSET-BRAND')::text,true);
select hub.update_brand_draft(id,'{"public_name":{"th":"Synthetic asset brand"},"slug":"sql-asset-brand","description":{"th":"Synthetic test brand only"}}',updated_at)
from hub.brands where id=current_setting('test.fixture_brand')::uuid;
select hub.bind_brand_asset(id,'10000000-0000-0000-0000-000000000002','logo_primary','{"th":"Synthetic logo"}',updated_at)
from hub.brands where id=current_setting('test.fixture_brand')::uuid;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select hub.publish_brand(current_setting('test.fixture_brand')::uuid,'Publish synthetic asset fixture brand');
reset role;
update staging.rem_projects set rem_brand_id='SQL-ASSET-BRAND' where rem_project_id in ('SQL-ASSET-A','SQL-ASSET-B');

set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select set_config('test.image_id',hub.register_uploaded_asset(current_setting('test.upload_image')::jsonb)#>>'{asset,id}',true);
select set_config('test.second_id',hub.register_uploaded_asset(current_setting('test.upload_second')::jsonb)#>>'{asset,id}',true);
select set_config('test.pdf_id',hub.register_uploaded_asset(current_setting('test.upload_pdf')::jsonb)#>>'{asset,id}',true);
do $$
declare a jsonb := hub.asset_detail(current_setting('test.image_id')::uuid); result jsonb;
begin
  assert a->>'rights_status'='pending' and a->>'owner_id'='00000000-0000-0000-0000-000000000001'
    and a->>'source_system'='hub-local' and a->>'storage_bucket'='local-originals', 'New upload identity or pending state incorrect';
  assert a->>'public_url'='/v1/assets/' || current_setting('test.image_id') || '/file', 'File URL is not guarded';
  assert hub.asset_file(current_setting('test.image_id')::uuid)->>'checksum'=repeat('a',64), 'Staff cannot preview pending file';
  assert exists(select 1 from jsonb_array_elements(hub.list_assets()) where value->>'id'=current_setting('test.image_id')), 'Library omitted upload';
  result := hub.register_uploaded_asset(current_setting('test.upload_image')::jsonb || '{"original_filename":"duplicate-name.jpg"}');
  assert (result->>'reused')::boolean and result->'asset'=a, 'Duplicate changed existing metadata';
  begin perform hub.register_uploaded_asset(current_setting('test.upload_image')::jsonb || '{"rights_status":"approved"}');
    raise exception 'Uploader granted rights'; exception when insufficient_privilege then null; end;
  begin perform hub.register_uploaded_asset(current_setting('test.upload_image')::jsonb || '{"storage_path":"../private.jpg"}');
    raise exception 'Path traversal metadata accepted'; exception when check_violation then null; end;
  begin perform hub.register_uploaded_asset(current_setting('test.upload_image')::jsonb || '{"file_size":10485761}');
    raise exception 'Oversize upload accepted'; exception when check_violation then null; end;
  begin perform hub.register_uploaded_asset(current_setting('test.upload_image')::jsonb || '{"mime_type":"image/svg+xml"}');
    raise exception 'Active upload format accepted'; exception when check_violation then null; end;
  begin perform hub.review_asset(current_setting('test.image_id')::uuid,(a->>'updated_at')::timestamptz,'approved','Self approval',null,null,'Editor attempt');
    raise exception 'Editor approved asset'; exception when insufficient_privilege then null; end;
  assert not has_function_privilege(current_user,'hub.bind_asset(uuid,uuid,text,jsonb)','EXECUTE'), 'Legacy binding bypass remains';
end $$;

-- Build two ready draft projects that reuse one registry object in two roles.
do $$
declare source_id text; p uuid; public_id text; model_id text; suffix text;
begin
  foreach source_id in array array['SQL-ASSET-A','SQL-ASSET-B'] loop
    p := hub.create_project_from_rem(source_id);
    perform hub.assign_project_brand(p,current_setting('test.fixture_brand')::uuid,(select updated_at from hub.projects where id=p));
    suffix := case source_id when 'SQL-ASSET-A' then 'a' else 'b' end;
    select public_project_id into public_id from hub.projects where id=p;
    perform set_config('test.asset_project_'||suffix,p::text,true);
    perform set_config('test.asset_public_'||suffix,public_id,true);
    perform hub.patch_project(p,jsonb_build_object('public_name',jsonb_build_object('th','Synthetic commercial project'),'slug','sql-asset-'||suffix,'address',jsonb_build_object('th','Synthetic address'),
      'latitude',13.7563,'longitude',100.5018,'ad_disclaimer',jsonb_build_object('th','Synthetic only')),(select updated_at from hub.projects where id=p));
    select public_model_id into model_id from hub.model_types where project_id=p;
    perform hub.update_model(p,model_id,'{"bedrooms":2,"bathrooms":1,"usable_area_sqm":50}',(select updated_at from hub.projects where id=p));
    perform hub.review_model(p,model_id,(select updated_at from hub.projects where id=p),'CONFIRMED','Synthetic human mapping');
    perform hub.bind_project_asset(p,current_setting('test.image_id')::uuid,'hero','{"th":"Synthetic hero"}',(select updated_at from hub.projects where id=p));
    perform hub.bind_project_asset(p,current_setting('test.image_id')::uuid,'thumbnail','{"th":"Synthetic thumbnail"}',(select updated_at from hub.projects where id=p));
  end loop;
end $$;
do $$
declare p uuid := current_setting('test.asset_project_a')::uuid; ts timestamptz;
begin
  select updated_at into ts from hub.projects where id=p;
  assert not (hub.project_readiness(p)->>'ready')::boolean, 'Pending image did not block publication';
  begin perform hub.bind_project_asset(p,current_setting('test.pdf_id')::uuid,'hero','{"th":"Wrong role"}',ts);
    raise exception 'PDF bound as image'; exception when check_violation then null; end;
  begin perform hub.bind_project_asset(p,current_setting('test.image_id')::uuid,'brochure','{"th":"Wrong role"}',ts);
    raise exception 'Image bound as PDF'; exception when check_violation then null; end;
  begin perform hub.bind_project_asset(p,current_setting('test.image_id')::uuid,'floor_plan','{"th":" "}',ts);
    raise exception 'Blank Thai alt accepted'; exception when check_violation then null; end;
  begin perform hub.unbind_project_asset(p,(select id from hub.entity_assets where project_id=current_setting('test.asset_project_b')::uuid limit 1),ts);
    raise exception 'Cross-project binding removed'; exception when no_data_found then null; end;
  perform hub.bind_project_asset(p,current_setting('test.pdf_id')::uuid,'floor_plan','{"th":"Synthetic PDF floor plan"}',ts);
  assert exists(select 1 from hub.entity_assets where project_id=p and asset_role='floor_plan'
    and asset_id=current_setting('test.pdf_id')::uuid and deleted_at is null), 'PDF floor plan was not bound';
  select updated_at into ts from hub.projects where id=p;
  perform hub.bind_project_asset(p,current_setting('test.pdf_id')::uuid,'brochure','{"th":"Synthetic brochure"}',ts);
  -- Retain one authorized binding while moving this file between roles.
  perform hub.unbind_project_asset(p,(select id from hub.entity_assets where project_id=p and asset_role='floor_plan' and deleted_at is null),
    (select updated_at from hub.projects where id=p));
  begin perform hub.bind_project_asset(p,current_setting('test.image_id')::uuid,'floor_plan','{"th":"Stale edit"}',ts);
    raise exception 'Stale binding accepted'; exception when serialization_failure then null; end;
  begin perform hub.unbind_project_asset(p,(select id from hub.entity_assets where project_id=p and asset_role='brochure' and deleted_at is null),ts);
    raise exception 'Stale unbind accepted'; exception when serialization_failure then null; end;
end $$;

-- Another reviewer cannot see someone else's unbound upload. Put the future
-- replacement in a separate unpublished fixture before requesting rights review.
select hub.bind_project_asset(id,current_setting('test.second_id')::uuid,'floor_plan','{"th":"Synthetic review intake"}',updated_at)
from hub.projects where rem_project_id='DEMO-001';

set local role viewer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000003',true);
do $$ begin
  perform hub.list_assets();
  perform hub.asset_file(current_setting('test.image_id')::uuid);
  begin perform hub.register_uploaded_asset(current_setting('test.upload_image')::jsonb); raise exception 'Viewer uploaded';
    exception when insufficient_privilege then null; end;
  begin perform hub.bind_project_asset(current_setting('test.asset_project_a')::uuid,current_setting('test.image_id')::uuid,'hero','{"th":"Viewer"}',now());
    raise exception 'Viewer bound asset'; exception when insufficient_privilege then null; end;
end $$;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  begin perform hub.list_assets(); raise exception 'Consumer listed private library'; exception when insufficient_privilege then null; end;
  begin perform hub.asset_file(current_setting('test.image_id')::uuid); raise exception 'Consumer previewed draft'; exception when insufficient_privilege then null; end;
  begin perform public_api.asset_file(current_setting('test.image_id')::uuid); raise exception 'Pending draft file leaked'; exception when no_data_found then null; end;
end $$;

set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$
declare asset_uuid uuid; ts timestamptz;
begin
  select updated_at into ts from hub.assets where id=current_setting('test.image_id')::uuid;
  begin perform hub.review_asset(current_setting('test.image_id')::uuid,ts,'approved',' ',null,null,'Blank notes');
    raise exception 'Approval lacked rights notes'; exception when check_violation then null; end;
  begin perform hub.review_asset(current_setting('test.image_id')::uuid,ts,'approved','Original test illustration',null,null,' ');
    raise exception 'Approval lacked reason'; exception when check_violation then null; end;
  begin perform hub.review_asset(current_setting('test.image_id')::uuid,ts,'approved','Original test illustration',now(),now()-interval '1 day','Invalid window');
    raise exception 'Reversed validity accepted'; exception when check_violation then null; end;
  begin perform hub.review_asset(current_setting('test.image_id')::uuid,ts,'approved','Original test illustration',null,now()-interval '1 day','Expired approval');
    raise exception 'Expired approval accepted'; exception when check_violation then null; end;
  foreach asset_uuid in array array[current_setting('test.image_id')::uuid,current_setting('test.second_id')::uuid,current_setting('test.pdf_id')::uuid] loop
    perform hub.review_asset(asset_uuid,(select updated_at from hub.assets where id=asset_uuid),'approved','Original synthetic content',null,null,'Human reviewed local rights');
  end loop;
  begin perform hub.review_asset(current_setting('test.image_id')::uuid,ts,'revoked','Synthetic revocation',null,null,'Stale review');
    raise exception 'Stale rights review accepted'; exception when serialization_failure then null; end;
  assert (hub.asset_detail(current_setting('test.image_id')::uuid)->>'reviewed_by')='00000000-0000-0000-0000-000000000002', 'Review actor missing';
  assert (hub.register_uploaded_asset(current_setting('test.upload_image')::jsonb)->'asset')=hub.asset_detail(current_setting('test.image_id')::uuid),
    'Duplicate upload changed approved registry state';
end $$;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  begin perform public_api.asset_file(current_setting('test.image_id')::uuid); raise exception 'Approved unpublished file leaked'; exception when no_data_found then null; end;
  begin perform public_api.asset_file(current_setting('test.second_id')::uuid); raise exception 'Approved unbound file leaked'; exception when no_data_found then null; end;
end $$;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select set_config('test.asset_version',hub.publish_project(current_setting('test.asset_project_a')::uuid,'Publish asset test A')::text,true);
select hub.publish_project(current_setting('test.asset_project_b')::uuid,'Publish reused asset test B');
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
select set_config('test.asset_payload',payload::text,true) from public_api.projects where public_project_id=current_setting('test.asset_public_a');
do $$ begin
  assert public_api.asset_file(current_setting('test.image_id')::uuid)->>'checksum'=repeat('a',64), 'Published image inaccessible';
  assert public_api.asset_file(current_setting('test.pdf_id')::uuid)->>'mime_type'='application/pdf', 'Published brochure inaccessible';
  assert not exists(select 1 from public_api.projects p,jsonb_array_elements(p.payload->'assets') item
    where p.public_project_id=current_setting('test.asset_public_a') and (item ? 'storage_path' or item ? 'rights_notes' or item ? 'reviewed_by')),
    'Private registry metadata entered public snapshot';
end $$;

-- Replacing/unbinding drafts must not retarget or delete bytes from a selected version.
set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select hub.bind_project_asset(current_setting('test.asset_project_a')::uuid,current_setting('test.second_id')::uuid,'hero','{"th":"Replacement"}',
  (select updated_at from hub.projects where id=current_setting('test.asset_project_a')::uuid));
select hub.unbind_project_asset(current_setting('test.asset_project_a')::uuid,
  (select id from hub.entity_assets where project_id=current_setting('test.asset_project_a')::uuid and asset_role='brochure' and deleted_at is null),
  (select updated_at from hub.projects where id=current_setting('test.asset_project_a')::uuid));
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert (select payload=current_setting('test.asset_payload')::jsonb from public_api.projects where public_project_id=current_setting('test.asset_public_a')),
    'Draft binding edit mutated selected publication';
  perform public_api.asset_file(current_setting('test.pdf_id')::uuid);
  begin perform public_api.asset_file(current_setting('test.second_id')::uuid); raise exception 'Draft replacement file leaked'; exception when no_data_found then null; end;
end $$;

-- One revocation invalidates every current release that references this registry object.
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select hub.review_asset(current_setting('test.image_id')::uuid,(select updated_at from hub.assets where id=current_setting('test.image_id')::uuid),
  'revoked','Synthetic rights withdrawn',null,null,'Revoke shared published image');
do $$ begin
  assert hub.project_detail(current_setting('test.asset_public_a'))->'publication_available'='false'::jsonb
    and hub.project_detail(current_setting('test.asset_public_b'))->'publication_available'='false'::jsonb, 'Shared revocation did not invalidate both projects';
  begin perform hub.rollback_project(current_setting('test.asset_project_a')::uuid,current_setting('test.asset_version')::uuid,'Attempt revoked asset rollback');
    raise exception 'Rollback revived revoked asset'; exception when check_violation then null; end;
end $$;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  begin perform public_api.asset_file(current_setting('test.image_id')::uuid); raise exception 'Revoked image file leaked'; exception when no_data_found then null; end;
  begin perform public_api.asset_file(current_setting('test.pdf_id')::uuid); raise exception 'File leaked through ineligible publication'; exception when no_data_found then null; end;
end $$;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select hub.review_asset(current_setting('test.image_id')::uuid,(select updated_at from hub.assets where id=current_setting('test.image_id')::uuid),
  'approved','Original synthetic content',now()+interval '1 day',null,'Future rights start');
do $$ begin
  assert hub.project_detail(current_setting('test.asset_public_b'))->'publication_available'='false'::jsonb, 'Future rights became available early';
  assert exists(select 1 from jsonb_array_elements(hub.project_detail(current_setting('test.asset_public_b'))->'assets') item
    where item->>'asset_effective_from' is not null and item->>'effective_from' is null
      and item->>'updated_at' is not null), 'Admin mixed registry rights validity with binding dates';
end $$;
select hub.review_asset(current_setting('test.image_id')::uuid,(select updated_at from hub.assets where id=current_setting('test.image_id')::uuid),
  'approved','Original synthetic content',null,null,'Restore current rights');
select hub.publish_project(current_setting('test.asset_project_a')::uuid,'Publish replacement without brochure');
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  perform public_api.asset_file(current_setting('test.second_id')::uuid);
  perform public_api.asset_file(current_setting('test.image_id')::uuid);
  begin perform public_api.asset_file(current_setting('test.pdf_id')::uuid); raise exception 'Unreferenced historical file leaked'; exception when no_data_found then null; end;
end $$;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select hub.withdraw_project(current_setting('test.asset_project_a')::uuid,'Withdraw replacement');
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  begin perform public_api.asset_file(current_setting('test.second_id')::uuid); raise exception 'Withdrawn publication file leaked'; exception when no_data_found then null; end;
  perform public_api.asset_file(current_setting('test.image_id')::uuid);
end $$;
reset role;
update hub.assets set effective_to=now()-interval '1 second' where id=current_setting('test.image_id')::uuid;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  begin perform public_api.asset_file(current_setting('test.image_id')::uuid); raise exception 'Expired registry file leaked'; exception when no_data_found then null; end;
end $$;
reset role;
do $$ begin
  assert exists(select 1 from audit.change_log where table_name='hub.assets' and after_row->>'id'=current_setting('test.image_id')
    and after_row->>'rights_status'='revoked' and after_row->>'review_reason'='Revoke shared published image'
    and actor='00000000-0000-0000-0000-000000000002'::uuid and reason='Revoke shared published image'), 'Rights audit missing';
  assert (select payload=current_setting('test.asset_payload')::jsonb from hub.entity_versions where id=current_setting('test.asset_version')::uuid),
    'Rights or binding edits changed immutable version';
end $$;
rollback;
select 'PASS: upload registry, dedup, rights, binding concurrency and published file eligibility' as result;
