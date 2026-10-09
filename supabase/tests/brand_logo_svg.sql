-- Synthetic metadata only; API tests verify sanitization of actual SVG bytes.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select set_config('app.change_reason','Synthetic SVG logo test',true);
select set_config('test.svg_metadata',jsonb_build_object('original_filename','synthetic-logo.svg','mime_type','image/svg+xml',
  'storage_path',repeat('f1',32)||'.svg','checksum',repeat('f1',32),'file_size',256,
  'asset_type','image','width',512,'height',512,'language','th')::text,true);
insert into staging.rem_brands(rem_brand_id,brand_name_rem,source_updated_at,source_fingerprint)
values ('SQL-SVG-BRAND','Synthetic SVG test brand',now(),'synthetic-svg-brand');
set local role admin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true);
select set_config('test.svg_brand',hub.create_brand_from_rem('SQL-SVG-BRAND')::text,true);
set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select set_config('test.svg_first',hub.register_uploaded_asset(current_setting('test.svg_metadata')::jsonb)#>>'{asset,id}',true);
select set_config('test.svg_second',hub.register_uploaded_asset(current_setting('test.svg_metadata')::jsonb ||
  jsonb_build_object('checksum',repeat('f2',32),'storage_path',repeat('f2',32)||'.svg'))#>>'{asset,id}',true);
do $$
declare a jsonb := hub.asset_detail(current_setting('test.svg_first')::uuid);
begin
  assert a->>'rights_status'='pending', 'SVG did not start pending';
  assert a->>'mime_type'='image/svg+xml' and a->>'storage_path'=repeat('f1',32)||'.svg', 'SVG metadata was not registered';
  assert (hub.register_uploaded_asset(current_setting('test.svg_metadata')::jsonb)->>'reused')::boolean, 'SVG replay not reused';
  begin
    perform hub.register_uploaded_asset(current_setting('test.svg_metadata')::jsonb || '{"rights_status":"approved"}');
    raise exception 'SVG bypassed pending rights';
  exception when insufficient_privilege then null; end;
  begin
    perform hub.register_uploaded_asset(current_setting('test.svg_metadata')::jsonb || '{"width":null}');
    raise exception 'SVG dimensions not required';
  exception when check_violation then null; end;
  begin
    perform hub.review_asset(current_setting('test.svg_first')::uuid,(a->>'updated_at')::timestamptz,'approved','Synthetic evidence',null,null,'Self approval');
    raise exception 'Editor self-approved SVG';
  exception when insufficient_privilege then null; end;
end $$;
select hub.bind_brand_asset(id,current_setting('test.svg_first')::uuid,'logo_primary','{"th":"โลโก้ตัวอย่างหลัก"}',updated_at)
from hub.brands where id=current_setting('test.svg_brand')::uuid;
select hub.bind_brand_asset(id,current_setting('test.svg_first')::uuid,'logo_white','{"th":"Synthetic retained review binding"}',updated_at)
from hub.brands where id=current_setting('test.svg_brand')::uuid;
select hub.bind_brand_asset(id,current_setting('test.svg_second')::uuid,'logo_primary','{"th":"โลโก้ตัวอย่างทดแทน"}',updated_at)
from hub.brands where id=current_setting('test.svg_brand')::uuid;
do $$ begin
  assert exists(select 1 from hub.brand_assets where brand_id=current_setting('test.svg_brand')::uuid
    and asset_id=current_setting('test.svg_first')::uuid and deleted_at is not null), 'Replacement lost historical binding';
  assert (select count(*) from hub.brand_assets where brand_id=current_setting('test.svg_brand')::uuid
    and asset_role='logo_primary' and deleted_at is null)=1, 'Replacement left multiple current logos';
end $$;
set local role viewer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000003',true);
do $$ begin
  perform hub.asset_file(current_setting('test.svg_first')::uuid);
  begin perform hub.register_uploaded_asset(current_setting('test.svg_metadata')::jsonb);
    raise exception 'Viewer registered SVG'; exception when insufficient_privilege then null; end;
end $$;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  begin perform public_api.asset_file(current_setting('test.svg_first')::uuid);
    raise exception 'Consumer received unpublished SVG'; exception when no_data_found then null; end;
end $$;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$
declare asset_uuid uuid;
begin
  foreach asset_uuid in array array[current_setting('test.svg_first')::uuid,current_setting('test.svg_second')::uuid] loop
    perform hub.review_asset(asset_uuid,(select updated_at from hub.assets where id=asset_uuid),
      'approved','Shared synthetic logo evidence',null,null,'Batch synthetic logo review');
  end loop;
end $$;
reset role;
do $$ begin
  assert (select count(*) from hub.assets where id in (current_setting('test.svg_first')::uuid,current_setting('test.svg_second')::uuid)
    and rights_status='approved' and reviewed_by='00000000-0000-0000-0000-000000000002'::uuid
    and rights_notes='Shared synthetic logo evidence' and reviewed_at is not null)=2, 'Batch review lost a per-file rights record';
  assert (select count(*) from audit.change_log where table_name='hub.assets' and operation='UPDATE'
    and after_row->>'id' in (current_setting('test.svg_first'),current_setting('test.svg_second'))
    and before_row->>'rights_status'='pending' and after_row->>'rights_status'='approved'
    and reason='Batch synthetic logo review' and database_role='publisher')=2, 'Batch review needs one audit record per file';
  assert has_function_privilege('admin','hub.register_uploaded_asset(jsonb)','EXECUTE')
    and has_function_privilege('editor','hub.register_uploaded_asset(jsonb)','EXECUTE')
    and has_function_privilege('publisher','hub.register_uploaded_asset(jsonb)','EXECUTE')
    and not has_function_privilege('viewer','hub.register_uploaded_asset(jsonb)','EXECUTE')
    and not has_function_privilege('agency','hub.register_uploaded_asset(jsonb)','EXECUTE'), 'Upload permissions changed';
end $$;
rollback;
