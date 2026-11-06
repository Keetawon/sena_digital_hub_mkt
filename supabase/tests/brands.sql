-- Synthetic brand/company identity, role and immutable publication contracts.
begin;
select pg_temp.w4_confirm_seed_media();
select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true);
select set_config('app.change_reason','SQL brand fixture',true);
insert into staging.rem_brands(rem_brand_id,brand_name_rem,brand_name_en_rem,source_updated_at,source_fingerprint) values
  ('000-SQL-BRAND-A','Synthetic brand one','Synthetic English brand',now(),'synthetic-brand-a'),
  ('000-SQL-BRAND-B','Synthetic brand two',null,now(),'synthetic-brand-b');
insert into staging.rem_companies(rem_company_id,company_name_rem,source_updated_at,source_fingerprint) values
  ('SQL-COMPANY-A','Synthetic company A',now(),'synthetic-company-a'),
  ('SQL-COMPANY-B','Synthetic company B',now(),'synthetic-company-b');
insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint,rem_brand_id,rem_company_id) values
  ('SQL-BRAND-P1','Synthetic brand project one',now(),'synthetic-p1','000-SQL-BRAND-A','SQL-COMPANY-A'),
  ('SQL-BRAND-P2','Synthetic brand project two',now(),'synthetic-p2','000-SQL-BRAND-A','SQL-COMPANY-B'),
  ('SQL-BRAND-P3','Synthetic different brand project',now(),'synthetic-p3','000-SQL-BRAND-B','UNRESOLVED-COMPANY'),
  ('SQL-BRAND-P4','Synthetic missing brand project',now(),'synthetic-p4',null,null);
insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_updated_at,source_fingerprint)
values ('SQL-BRAND-P1','M1','Synthetic model',now(),'synthetic-model');
set local role admin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true);
select set_config('test.brand_a',hub.create_brand_from_rem('000-SQL-BRAND-A')::text,true);
select set_config('test.brand_b',hub.create_brand_from_rem('000-SQL-BRAND-B')::text,true);
select set_config('test.brand_public',public_brand_id,true) from hub.brands where id=current_setting('test.brand_a')::uuid;
do $$ begin
  assert not has_schema_privilege(current_user,'staging','USAGE'), 'Admin can edit source mirrors';
  begin update staging.rem_brands set brand_name_rem='Override' where rem_brand_id='000-SQL-BRAND-A';
    raise exception 'Admin edited REM brand'; exception when insufficient_privilege then null; end;
  begin perform hub.publish_brand(current_setting('test.brand_a')::uuid,'Admin publish'); raise exception 'Admin published brand';
    exception when insufficient_privilege then null; end;
  begin perform hub.review_asset('10000000-0000-0000-0000-000000000001',now(),'approved','Admin rights',null,null,'Admin review');
    raise exception 'Admin approved rights'; exception when insufficient_privilege then null; end;
  assert hub.brand_detail(current_setting('test.brand_public'))#>>'{source,rem_brand_id}'='000-SQL-BRAND-A', 'Source ID lost leading zeros';
  assert exists(select 1 from jsonb_array_elements(hub.brand_detail(current_setting('test.brand_public'))#>'{readiness,missing}')
    where value->>'field'='description.th'), 'Brand description not required by readiness';
  assert exists(select 1 from jsonb_array_elements(hub.list_rem_brands()) where value->>'public_brand_id'=current_setting('test.brand_public')), 'Source brand list omitted selected brand';
  assert exists(select 1 from jsonb_array_elements(hub.list_brands()) where value->>'public_brand_id'=current_setting('test.brand_public')), 'Staff list omitted draft brand';
end $$;
select hub.update_brand_draft(id,'{"slug":"sql-brand-one","description":{"th":"Synthetic description one"}}',updated_at)
from hub.brands where id=current_setting('test.brand_a')::uuid;
select set_config('test.brand_logo',hub.register_uploaded_asset(jsonb_build_object('original_filename','synthetic-logo.png','mime_type','image/png',
  'asset_type','image','storage_path',repeat('d',64)||'.png','checksum',repeat('d',64),'file_size',100,'width',10,'height',10))#>>'{asset,id}',true);
select set_config('test.brand_logo_2',hub.register_uploaded_asset(jsonb_build_object('original_filename','synthetic-logo-two.png','mime_type','image/png',
  'asset_type','image','storage_path',repeat('e',64)||'.png','checksum',repeat('e',64),'file_size',100,'width',10,'height',10))#>>'{asset,id}',true);
select hub.bind_brand_asset(id,current_setting('test.brand_logo')::uuid,'logo_primary','{"th":"Synthetic logo"}',updated_at)
from hub.brands where id=current_setting('test.brand_a')::uuid;
-- Give the later replacement an authorized draft binding before another actor
-- reviews or reuses it; unbound uploads are private to their uploader.
select hub.bind_brand_asset(id,current_setting('test.brand_logo_2')::uuid,'logo_primary','{"th":"Synthetic review intake"}',updated_at)
from hub.brands where id=current_setting('test.brand_b')::uuid;
set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
do $$
declare b uuid := current_setting('test.brand_a')::uuid; ts timestamptz;
begin
  select updated_at into ts from hub.brands where id=b;
  begin perform hub.create_brand_from_rem('000-SQL-BRAND-B'); raise exception 'Editor created brand'; exception when insufficient_privilege then null; end;
  begin perform hub.update_brand_draft(b,'{"rem_brand_id":"000-SQL-BRAND-B"}',ts); raise exception 'Editor changed source anchor'; exception when insufficient_privilege then null; end;
  begin update hub.brands set published_version_id=null where id=b; raise exception 'Editor wrote brand pointer'; exception when insufficient_privilege then null; end;
  begin perform hub.bind_brand_asset(b,current_setting('test.brand_logo')::uuid,'logo_white','{"th":""}',ts);
    raise exception 'Blank logo alt accepted'; exception when check_violation then null; end;
  perform hub.update_brand_draft(b,'{"public_name":{"th":"Synthetic brand one","en":"Preserved English name"}}',ts);
  begin perform hub.update_brand_draft(b,'{"slug":"stale-brand"}',ts); raise exception 'Stale brand edit accepted'; exception when serialization_failure then null; end;
  begin perform hub.bind_brand_asset(b,current_setting('test.brand_logo')::uuid,'favicon','{"th":"Stale"}',ts);
    raise exception 'Stale brand binding accepted'; exception when serialization_failure then null; end;
end $$;
select set_config('test.brand_request',(hub.request_brand('Request source B','000-SQL-BRAND-B','Need existing source brand')->>'id'),true);
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$ begin
  begin perform hub.update_brand_draft(current_setting('test.brand_a')::uuid,'{"slug":"publisher-edit"}',
    (select updated_at from hub.brands where id=current_setting('test.brand_a')::uuid)); raise exception 'Publisher edited brand draft'; exception when insufficient_privilege then null; end;
  begin perform pg_temp.w4_publish('brand',current_setting('test.brand_a')::uuid,'Pending logo'); raise exception 'Brand published pending logo'; exception when check_violation then null; end;
end $$;
select hub.review_asset(id,updated_at,'approved','Original synthetic logo',null,null,'Publisher checked logo rights')
from hub.assets where id in(current_setting('test.brand_logo')::uuid,current_setting('test.brand_logo_2')::uuid);
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert not exists(select 1 from public_api.read_brands() where public_brand_id=current_setting('test.brand_public')), 'Draft brand leaked';
  begin perform hub.list_brands(); raise exception 'Consumer read brand drafts'; exception when insufficient_privilege then null; end;
  begin perform public_api.asset_file(pg_temp.public_asset_id(current_setting('test.brand_logo')::uuid)); raise exception 'Unpublished logo leaked'; exception when no_data_found then null; end;
end $$;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select pg_temp.w4_confirm_media(current_setting('test.brand_logo')::uuid,'promotion_ad','{"th":"Synthetic logo"}');
select set_config('test.brand_v1',pg_temp.w4_publish('brand',current_setting('test.brand_a')::uuid,'Publish synthetic brand one')::text,true);
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  perform public_api.asset_file(pg_temp.public_asset_id(current_setting('test.brand_logo')::uuid));
end $$;

set local role admin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true);
do $$
declare r uuid := current_setting('test.brand_request')::uuid; ts timestamptz;
begin
  select updated_at into ts from hub.brand_requests where id=r;
  begin perform hub.resolve_brand_request(r,current_setting('test.brand_a')::uuid,'resolved','Wrong source',ts);
    raise exception 'Request resolved to unrelated brand'; exception when check_violation then null; end;
  perform hub.resolve_brand_request(r,current_setting('test.brand_b')::uuid,'resolved','Created exact source brand',ts);
  begin perform hub.resolve_brand_request(r,null,'rejected','Stale request',ts); raise exception 'Stale request resolution accepted';
    exception when serialization_failure then null; end;
  assert exists(select 1 from jsonb_array_elements(hub.list_brand_requests()) where value->>'id'=r::text and value->>'status'='resolved'), 'Resolved request missing';
end $$;
set local role viewer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000003',true);
do $$ begin
  perform hub.brand_detail(current_setting('test.brand_public'));
  perform hub.brand_versions(current_setting('test.brand_a')::uuid);
  begin perform hub.request_brand('Viewer request',null,'Viewer attempt'); raise exception 'Viewer requested brand'; exception when insufficient_privilege then null; end;
end $$;

set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select set_config('test.brand_project',hub.create_project_from_rem('SQL-BRAND-P1')::text,true);
select set_config('test.brand_project_b',hub.create_project_from_rem('SQL-BRAND-P2')::text,true);
select set_config('test.brand_project_c',hub.create_project_from_rem('SQL-BRAND-P3')::text,true);
select set_config('test.brand_project_d',hub.create_project_from_rem('SQL-BRAND-P4')::text,true);
select set_config('test.brand_project_public',public_project_id,true) from hub.projects where id=current_setting('test.brand_project')::uuid;
do $$
declare p uuid := current_setting('test.brand_project')::uuid;
begin
  assert hub.project_detail(current_setting('test.brand_project_public'))->'brand_id'='null'::jsonb, 'Source selection silently assigned brand';
  begin perform hub.assign_project_brand(p,current_setting('test.brand_b')::uuid,(select updated_at from hub.projects where id=p));
    raise exception 'Project assigned unrelated source brand'; exception when check_violation then null; end;
  begin perform hub.assign_project_brand(current_setting('test.brand_project_d')::uuid,current_setting('test.brand_a')::uuid,
    (select updated_at from hub.projects where id=current_setting('test.brand_project_d')::uuid));
    raise exception 'Project without source brand assigned arbitrarily'; exception when check_violation then null; end;
  perform hub.assign_project_brand(current_setting('test.brand_project_c')::uuid,current_setting('test.brand_b')::uuid,
    (select updated_at from hub.projects where id=current_setting('test.brand_project_c')::uuid));
  assert not (hub.project_readiness(current_setting('test.brand_project_c')::uuid)->>'ready')::boolean, 'Unpublished brand accepted for project publication';
end $$;
select hub.patch_project(id,'{"public_name":{"th":"Synthetic commercial project"},"slug":"sql-branded-project","address":{"th":"Synthetic address"},"latitude":13.7563,"longitude":100.5018,"ad_disclaimer":{"th":"Synthetic only"}}',updated_at)
from hub.projects where id=current_setting('test.brand_project')::uuid;
select hub.update_model(p.id,m.public_model_id,'{"bedrooms":2,"bathrooms":1,"usable_area_sqm":50}',p.updated_at)
from hub.projects p join hub.model_types m on m.project_id=p.id where p.id=current_setting('test.brand_project')::uuid;
select hub.review_model(p.id,m.public_model_id,p.updated_at,'CONFIRMED','Synthetic source check')
from hub.projects p join hub.model_types m on m.project_id=p.id where p.id=current_setting('test.brand_project')::uuid;
select hub.bind_project_asset(id,'10000000-0000-0000-0000-000000000001','hero','{"th":"Synthetic hero"}',updated_at)
from hub.projects where id=current_setting('test.brand_project')::uuid;
select hub.bind_project_asset(id,'10000000-0000-0000-0000-000000000002','thumbnail','{"th":"Synthetic thumbnail"}',updated_at)
from hub.projects where id=current_setting('test.brand_project')::uuid;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$ begin
  begin perform pg_temp.w4_publish('project',current_setting('test.brand_project')::uuid,'Missing brand'); raise exception 'Otherwise-complete project published without brand';
    exception when check_violation then null; end;
end $$;
set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select hub.assign_project_brand(id,current_setting('test.brand_a')::uuid,updated_at) from hub.projects
where id in(current_setting('test.brand_project')::uuid,current_setting('test.brand_project_b')::uuid);
do $$
declare b jsonb := hub.brand_detail(current_setting('test.brand_public'));
begin
  assert jsonb_array_length(b->'projects')=2, 'Brand did not group both project companies';
  assert exists(select 1 from jsonb_array_elements(b->'projects') where value#>>'{source,company_name_rem}'='Synthetic company A')
    and exists(select 1 from jsonb_array_elements(b->'projects') where value#>>'{source,company_name_rem}'='Synthetic company B'), 'Brand and company were conflated';
end $$;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select set_config('test.branded_project_v1',pg_temp.w4_publish('project',current_setting('test.brand_project')::uuid,'Publish branded project')::text,true);
select set_config('test.branded_payload_raw',payload::text,true) from hub.entity_versions where id=current_setting('test.branded_project_v1')::uuid;
do $$ begin assert (hub.project_versions(current_setting('test.brand_project')::uuid)->0#>>'{payload,source,company_name_rem}')='Synthetic company A','Staff company provenance lost'; end $$;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
select set_config('test.branded_payload',payload::text,true) from public_api.read_projects() where public_project_id=current_setting('test.brand_project_public');
do $$ begin
  assert (select payload#>>'{brand,public_brand_id}'=current_setting('test.brand_public') and payload#>>'{brand,version_no}'='1'
    and not (payload ? 'source') and not (payload ? 'brand_version_id') from public_api.read_projects() where public_project_id=current_setting('test.brand_project_public')),
    'Project did not freeze public brand identity or leaked private provenance';
end $$;

-- A changed brand draft and then a new brand release must not rewrite project v1.
set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select hub.update_brand_draft(id,'{"public_name":{"th":"Synthetic brand two"},"description":{"th":"Changed description"}}',updated_at)
from hub.brands where id=current_setting('test.brand_a')::uuid;
select hub.bind_brand_asset(id,current_setting('test.brand_logo_2')::uuid,'logo_primary','{"th":"New synthetic logo"}',updated_at)
from hub.brands where id=current_setting('test.brand_a')::uuid;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert (select payload#>>'{public_name,th}'='Synthetic brand one' from public_api.read_brands() where public_brand_id=current_setting('test.brand_public')), 'Brand draft leaked';
end $$;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select pg_temp.w4_confirm_media(current_setting('test.brand_logo_2')::uuid,'promotion_ad','{"th":"New synthetic logo"}');
select set_config('test.brand_v2',pg_temp.w4_publish('brand',current_setting('test.brand_a')::uuid,'Publish changed brand')::text,true);
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert (select payload=current_setting('test.branded_payload')::jsonb from public_api.read_projects() where public_project_id=current_setting('test.brand_project_public')),
    'Republished brand rewrote old project snapshot';
  perform public_api.asset_file(pg_temp.public_asset_id(current_setting('test.brand_logo')::uuid));
  perform public_api.asset_file(pg_temp.public_asset_id(current_setting('test.brand_logo_2')::uuid));
end $$;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select hub.review_asset(id,updated_at,'revoked','Synthetic withdrawn permission',null,null,'Revoke old frozen logo') from hub.assets where id=current_setting('test.brand_logo')::uuid;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert exists(select 1 from public_api.read_brands() where public_brand_id=current_setting('test.brand_public')), 'Old logo incorrectly invalidated new brand snapshot';
  assert not exists(select 1 from public_api.read_projects() where public_project_id=current_setting('test.brand_project_public')), 'Old frozen logo rights were ignored';
  begin perform public_api.asset_file(pg_temp.public_asset_id(current_setting('test.brand_logo')::uuid)); raise exception 'Revoked frozen logo leaked'; exception when no_data_found then null; end;
end $$;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$ begin
  begin perform pg_temp.w4_rollback('project',current_setting('test.brand_project')::uuid,current_setting('test.branded_project_v1')::uuid,'Invalid old logo rollback');
    raise exception 'Project rollback revived invalid frozen logo'; exception when check_violation then null; end;
end $$;
select hub.review_asset(id,updated_at,'approved','Original synthetic permission',null,null,'Restore old logo') from hub.assets where id=current_setting('test.brand_logo')::uuid;
select pg_temp.w4_publish('project',current_setting('test.brand_project')::uuid,'Adopt current published brand');
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert (select payload#>>'{brand,version_no}'='2' from public_api.read_projects() where public_project_id=current_setting('test.brand_project_public')), 'New project version did not adopt brand v2';
  begin perform public_api.asset_file(pg_temp.public_asset_id(current_setting('test.brand_logo')::uuid)); raise exception 'Unreferenced old logo leaked'; exception when no_data_found then null; end;
end $$;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select pg_temp.w4_withdraw('brand',current_setting('test.brand_a')::uuid,'Withdraw dependent brand');
do $$ begin
  assert hub.project_detail(current_setting('test.brand_project_public'))->'publication_available'='false'::jsonb, 'Withdrawn brand did not invalidate project';
end $$;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  begin perform public_api.asset_file(pg_temp.public_asset_id(current_setting('test.brand_logo_2')::uuid)); raise exception 'Withdrawn brand logo leaked'; exception when no_data_found then null; end;
end $$;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$ begin
 assert not hub.can_read_asset(current_setting('test.brand_logo')::uuid),
  'Fixture must exercise a retained logo without any current draft or published binding';
end $$;
select pg_temp.w4_rollback('brand',current_setting('test.brand_a')::uuid,current_setting('test.brand_v1')::uuid,'Restore brand v1');
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert (select payload#>>'{brand,version_no}'='2' from public_api.read_projects() where public_project_id=current_setting('test.brand_project_public')), 'Brand rollback changed frozen project version';
  perform public_api.asset_file(pg_temp.public_asset_id(current_setting('test.brand_logo_2')::uuid));
end $$;
reset role;
-- Draft reassignment cannot change a frozen publication. Current source changes,
-- however, invalidate an old brand mapping until the mismatch is resolved.
do $$ declare dependency jsonb;original text:=current_setting('app.actor_id',true);begin
 select d into strict dependency from hub.brand_versions v
  cross join lateral jsonb_array_elements(v.review_evidence->'dependencies') d
  where v.id=current_setting('test.brand_v1')::uuid and d->>'table'='assets'
   and d#>>'{identity,id}'=current_setting('test.brand_logo');
 perform set_config('app.actor_id',pg_temp.w4_actor('publisher')::text,true);
 assert hub.publication_retained_media_source(dependency),'Exact approved retained asset lost its source authority';
 assert not hub.publication_retained_media_source(dependency||jsonb_build_object('hash',repeat('0',64))),
  'Altered retained certificate gained source authority';
 perform set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
 assert not hub.publication_retained_media_source(dependency),'Retained asset authority bypassed source View';
 perform set_config('app.actor_id',coalesce(original,''),true);
end $$;
update hub.projects set brand_id=current_setting('test.brand_b')::uuid where id=current_setting('test.brand_project')::uuid;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert exists(select 1 from public_api.read_projects() where public_project_id=current_setting('test.brand_project_public')), 'Draft brand change invalidated frozen reference';
end $$;
reset role;
update hub.projects set brand_id=current_setting('test.brand_a')::uuid where id=current_setting('test.brand_project')::uuid;
update staging.rem_projects set rem_brand_id='000-SQL-BRAND-B' where rem_project_id='SQL-BRAND-P1';
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert not exists(select 1 from public_api.read_projects() where public_project_id=current_setting('test.brand_project_public')), 'Source brand drift left mismatched publication visible';
  begin perform public_api.asset_file(pg_temp.public_asset_id(current_setting('test.brand_logo_2')::uuid)); raise exception 'Mismatched source publication exposed frozen logo'; exception when no_data_found then null; end;
end $$;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$ begin
  begin perform pg_temp.w4_rollback('project',current_setting('test.brand_project')::uuid,current_setting('test.branded_project_v1')::uuid,'Source mismatch rollback');
    raise exception 'Rollback accepted changed source brand'; exception when check_violation then null; end;
end $$;
reset role;
update staging.rem_projects set rem_brand_id=null where rem_project_id='SQL-BRAND-P1';
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert not exists(select 1 from public_api.read_projects() where public_project_id=current_setting('test.brand_project_public')), 'Missing source brand remained visible';
end $$;
reset role;
update staging.rem_projects set rem_brand_id='000-SQL-BRAND-A' where rem_project_id='SQL-BRAND-P1';
update hub.assets set effective_to=now()-interval '1 second' where id=current_setting('test.brand_logo_2')::uuid;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert exists(select 1 from public_api.read_brands() where public_brand_id=current_setting('test.brand_public'))
    and not exists(select 1 from public_api.read_projects() where public_project_id=current_setting('test.brand_project_public')), 'Expired frozen logo was ignored';
end $$;
reset role;
update hub.assets set effective_to=null where id=current_setting('test.brand_logo_2')::uuid;
update hub.assets set effective_to=now()-interval '1 second' where id=current_setting('test.brand_logo')::uuid;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert not exists(select 1 from public_api.read_brands() where public_brand_id=current_setting('test.brand_public'))
    and not exists(select 1 from public_api.read_projects() where public_project_id=current_setting('test.brand_project_public')), 'Invalid current brand did not block dependent project';
end $$;
reset role;
update hub.assets set effective_to=null where id=current_setting('test.brand_logo')::uuid;
update staging.rem_brands set is_deleted=true where rem_brand_id='000-SQL-BRAND-A';
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert not exists(select 1 from public_api.read_brands() where public_brand_id=current_setting('test.brand_public'))
    and not exists(select 1 from public_api.read_projects() where public_project_id=current_setting('test.brand_project_public')), 'Disabled source brand remained available';
  begin perform public_api.asset_file(pg_temp.public_asset_id(current_setting('test.brand_logo_2')::uuid)); raise exception 'Disabled source brand file leaked'; exception when no_data_found then null; end;
end $$;
reset role;
do $$ begin
  begin update hub.brand_versions set payload='{}' where id=current_setting('test.brand_v1')::uuid; raise exception 'Brand version mutated'; exception when check_violation then null; end;
  begin delete from hub.brand_versions where id=current_setting('test.brand_v2')::uuid; raise exception 'Brand version deleted'; exception when check_violation then null; end;
  assert exists(select 1 from audit.change_log where table_name='hub.brands' and after_row->>'id'=current_setting('test.brand_a')
    and reason='Withdraw dependent brand' and database_role='hub_app'
    and actor=pg_temp.w4_actor('publisher')), 'Brand publication audit missing';
  assert (select payload=current_setting('test.branded_payload_raw')::jsonb from hub.entity_versions where id=current_setting('test.branded_project_v1')::uuid), 'Historical project snapshot changed';
end $$;
rollback;
select 'PASS: brand ownership, permissions, source mapping, logo rights and immutable dependent publication' as result;
