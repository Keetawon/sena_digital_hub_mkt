-- Run as migration owner with ON_ERROR_STOP. Every test change is rolled back.
-- These are SQL contract checks for a local slice, not seven-project MVP acceptance.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select set_config('app.change_reason','SQL integration test fixture',true);
insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint)
values ('SQL-TEST-CORE','Synthetic SQL test project',now(),'synthetic-sql-test');
insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_updated_at,source_fingerprint)
values ('SQL-TEST-CORE','SQL-TEST-M1','Synthetic SQL test model',now(),'synthetic-sql-test');

insert into staging.rem_brands(rem_brand_id,brand_name_rem,source_updated_at,source_fingerprint)
values ('SQL-CORE-BRAND','Synthetic core test brand',now(),'synthetic-core-brand');
set local role admin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true);
select set_config('test.fixture_brand',hub.create_brand_from_rem('SQL-CORE-BRAND')::text,true);
select hub.update_brand_draft(id,'{"public_name":{"th":"Synthetic core brand"},"slug":"sql-core-brand","description":{"th":"Synthetic test brand only"}}',updated_at)
from hub.brands where id=current_setting('test.fixture_brand')::uuid;
select hub.bind_brand_asset(id,'10000000-0000-0000-0000-000000000002','logo_primary','{"th":"Synthetic logo"}',updated_at)
from hub.brands where id=current_setting('test.fixture_brand')::uuid;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select hub.publish_brand(current_setting('test.fixture_brand')::uuid,'Publish synthetic core fixture brand');
reset role;
update staging.rem_projects set rem_brand_id='SQL-CORE-BRAND' where rem_project_id in ('SQL-TEST-CORE');

set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select set_config('test.project_id',hub.create_project_from_rem('SQL-TEST-CORE')::text,true);
select hub.assign_project_brand(id,current_setting('test.fixture_brand')::uuid,updated_at) from hub.projects where id=current_setting('test.project_id')::uuid;
select set_config('test.public_id',public_project_id,true),set_config('test.model_id',m.id::text,true),
  set_config('test.public_model_id',m.public_model_id,true)
from hub.projects p join hub.model_types m on m.project_id=p.id
where p.id=current_setting('test.project_id')::uuid;

do $$
declare project_uuid uuid := current_setting('test.project_id')::uuid;
begin
  assert not (hub.project_readiness(project_uuid)->>'ready')::boolean, 'New drafts must be incomplete';
  begin
    perform hub.publish_project(project_uuid,'Editor attempt');
    raise exception 'Editor published';
  exception when insufficient_privilege then null; end;
  begin
    update hub.projects set published_version_id=null where id=project_uuid;
    raise exception 'Editor wrote publication pointer';
  exception when insufficient_privilege then null; end;
  begin
    update staging.rem_projects set project_name_rem='tampered' where rem_project_id='SQL-TEST-CORE';
    raise exception 'Editor changed source';
  exception when insufficient_privilege then null; end;
  begin
    perform hub.patch_project(project_uuid,'{"rem_project_id":"DEMO-001"}',(select updated_at from hub.projects where id=project_uuid));
    raise exception 'Source field patched';
  exception when insufficient_privilege then null; end;
end $$;

set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$
begin
  begin
    perform hub.publish_project(current_setting('test.project_id')::uuid,'Incomplete draft');
    raise exception 'Readiness gate allowed incomplete draft';
  exception when check_violation then null; end;
  assert not exists(select 1 from hub.entity_versions where project_id=current_setting('test.project_id')::uuid), 'Failed publish left a version';
end $$;

set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$
declare schema_name text;
begin
  assert not exists(select 1 from public_api.read_projects() where public_project_id=current_setting('test.public_id')), 'Draft leaked';
  foreach schema_name in array array['hub','staging','audit','internal','rag'] loop
    assert not has_schema_privilege(current_user,schema_name,'USAGE'), 'Consumer has private schema usage';
  end loop;
  begin
    perform 1 from hub.projects;
    raise exception 'Consumer read base table';
  exception when insufficient_privilege then null; end;
  begin
    perform hub.project_detail(current_setting('test.public_id'));
    raise exception 'Consumer called draft function';
  exception when insufficient_privilege then null; end;
end $$;

set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select hub.patch_project(current_setting('test.project_id')::uuid,
  '{"public_name":{"th":"ข้อมูลทดสอบ รุ่นหนึ่ง"},"slug":"sql-test-core","address":{"th":"ที่อยู่ทดสอบ"},"latitude":13.7563,"longitude":100.5018,"ad_disclaimer":{"th":"ข้อมูลทดสอบเท่านั้น"}}',
  (select updated_at from hub.projects where id=current_setting('test.project_id')::uuid));
select hub.update_model(current_setting('test.project_id')::uuid,current_setting('test.public_model_id'),
  '{"bedrooms":2.5,"bathrooms":1,"usable_area_sqm":50,"parking_spaces":1}',
  (select updated_at from hub.projects where id=current_setting('test.project_id')::uuid));
select hub.review_model(current_setting('test.project_id')::uuid,current_setting('test.public_model_id'),
  (select updated_at from hub.projects where id=current_setting('test.project_id')::uuid),'CONFIRMED','SQL test human review');
select hub.bind_project_asset(current_setting('test.project_id')::uuid,'10000000-0000-0000-0000-000000000001','hero','{"th":"ภาพทดสอบ"}',
  (select updated_at from hub.projects where id=current_setting('test.project_id')::uuid));
select hub.bind_project_asset(current_setting('test.project_id')::uuid,'10000000-0000-0000-0000-000000000002','thumbnail','{"th":"ภาพทดสอบ"}',
  (select updated_at from hub.projects where id=current_setting('test.project_id')::uuid));
do $$
begin
  assert (hub.project_readiness(current_setting('test.project_id')::uuid)->>'ready')::boolean, 'Complete draft blocked';
end $$;

select hub.patch_project(current_setting('test.project_id')::uuid,'{"latitude":0,"longitude":0}',
  (select updated_at from hub.projects where id=current_setting('test.project_id')::uuid));
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$ begin
  begin
    perform hub.publish_project(current_setting('test.project_id')::uuid,'Must reject zero coordinates');
    raise exception 'Zero coordinates passed the publication gate';
  exception when check_violation then null; end;
  assert not exists(select 1 from hub.entity_versions where project_id=current_setting('test.project_id')::uuid),
    'Coordinate rejection wrote a publication';
end $$;
set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select hub.patch_project(current_setting('test.project_id')::uuid,'{"latitude":13.7563,"longitude":100.5018}',
  (select updated_at from hub.projects where id=current_setting('test.project_id')::uuid));
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select set_config('test.version_1',hub.publish_project(current_setting('test.project_id')::uuid,'First SQL test publish')::text,true);
do $$ begin assert (hub.project_versions(current_setting('test.project_id')::uuid)->0->>'publisher')='00000000-0000-0000-0000-000000000002','Staff audit attribution missing'; end $$;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
select set_config('test.payload_1',payload::text,true) from public_api.read_projects() where public_project_id=current_setting('test.public_id');
do $$
begin
  assert (select version_no=1 and published_at is not null
    and payload#>>'{models,0,bedrooms}'='2.5' from public_api.read_projects() where public_project_id=current_setting('test.public_id')), 'Published metadata/model snapshot incorrect';
end $$;

set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select set_config('test.old_updated_at',updated_at::text,true) from hub.projects where id=current_setting('test.project_id')::uuid;
select hub.patch_project(current_setting('test.project_id')::uuid,'{"public_name":{"th":"ข้อมูลทดสอบ รุ่นสอง"}}',current_setting('test.old_updated_at')::timestamptz);
select hub.update_model(current_setting('test.project_id')::uuid,current_setting('test.public_model_id'),'{"bedrooms":3}',
  (select updated_at from hub.projects where id=current_setting('test.project_id')::uuid));
do $$
begin
  begin
    perform hub.patch_project(current_setting('test.project_id')::uuid,'{"slug":"stale-edit"}',current_setting('test.old_updated_at')::timestamptz);
    raise exception 'Stale edit accepted';
  exception when serialization_failure then null; end;
end $$;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$
begin
  assert (select payload=current_setting('test.payload_1')::jsonb from public_api.read_projects() where public_project_id=current_setting('test.public_id')), 'Draft edit changed public snapshot';
end $$;

set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select set_config('test.version_2',hub.publish_project(current_setting('test.project_id')::uuid,'Second SQL test publish')::text,true);
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$
begin
  assert (select version_no=2 and payload#>>'{models,0,bedrooms}'='3'
    and payload#>>'{public_name,th}'='ข้อมูลทดสอบ รุ่นสอง'
    from public_api.read_projects() where public_project_id=current_setting('test.public_id')), 'Publish mixed old/new fields';
end $$;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select hub.rollback_project(current_setting('test.project_id')::uuid,current_setting('test.version_1')::uuid,'Restore version one');
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$
begin
  assert (select payload=current_setting('test.payload_1')::jsonb from public_api.read_projects() where public_project_id=current_setting('test.public_id')), 'Rollback did not restore exact payload';
end $$;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select hub.withdraw_project(current_setting('test.project_id')::uuid,'SQL test withdrawal');
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert not exists(select 1 from public_api.read_projects() where public_project_id=current_setting('test.public_id')), 'Withdrawal leaked';
end $$;

-- Only the migration owner simulates a rights authority revocation. Editor/publisher
-- application roles cannot grant themselves asset rights or alter source mappings.
reset role;
update hub.assets set rights_status='revoked' where id='10000000-0000-0000-0000-000000000001';
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$ begin
  begin
    perform hub.rollback_project(current_setting('test.project_id')::uuid,current_setting('test.version_1')::uuid,'Attempt revoked asset');
    raise exception 'Rollback restored revoked asset';
  exception when check_violation then null; end;
end $$;
reset role;
update hub.assets set rights_status='approved' where id='10000000-0000-0000-0000-000000000001';
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select hub.rollback_project(current_setting('test.project_id')::uuid,current_setting('test.version_1')::uuid,'Restore eligible asset');
reset role;
update hub.assets set effective_to=now()-interval '1 second' where id='10000000-0000-0000-0000-000000000001';
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert not exists(select 1 from public_api.read_projects() where public_project_id=current_setting('test.public_id')), 'Expired asset stayed visible';
end $$;
reset role;
update hub.assets set effective_to=null where id='10000000-0000-0000-0000-000000000001';
update hub.model_types set match_status='REJECTED' where id=current_setting('test.model_id')::uuid;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert not exists(select 1 from public_api.read_projects() where public_project_id=current_setting('test.public_id')), 'Revoked model mapping stayed visible';
end $$;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$ begin
  begin
    perform hub.rollback_project(current_setting('test.project_id')::uuid,current_setting('test.version_1')::uuid,'Attempt rejected mapping');
    raise exception 'Rollback restored rejected mapping';
  exception when check_violation then null; end;
end $$;

set local role viewer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000003',true);
do $$ begin
  perform hub.project_detail(current_setting('test.public_id'));
  begin
    perform hub.review_model(current_setting('test.project_id')::uuid,current_setting('test.public_model_id'),
      (select updated_at from hub.projects where id=current_setting('test.project_id')::uuid),'CONFIRMED','Viewer attempt');
    raise exception 'Viewer changed mapping';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$ begin
  begin
    update hub.entity_versions set payload='{}' where id=current_setting('test.version_1')::uuid;
    raise exception 'Owner mutated immutable version';
  exception when check_violation then null; end;
  begin
    delete from hub.entity_versions where id=current_setting('test.version_2')::uuid;
    raise exception 'Owner deleted immutable version';
  exception when check_violation then null; end;
  assert exists(select 1 from audit.change_log where table_name='hub.projects'
    and after_row->>'id'=current_setting('test.project_id') and reason='SQL test withdrawal'
    and actor='00000000-0000-0000-0000-000000000002'::uuid), 'Publication audit missing actor/reason';
end $$;
rollback;
select 'PASS: core SQL role, readiness, immutable publication, rollback, revocation and audit checks' as result;
