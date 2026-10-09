-- Run after all migrations as migration owner. Synthetic fixtures roll back.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select set_config('app.change_reason','SQL source-selection fixture',true);
insert into staging.rem_projects(rem_project_id,project_name_rem,source_updated_at,source_fingerprint) values
  ('SQL-SOURCE-A','Synthetic project A',now(),'synthetic-a'),
  ('SQL-SOURCE-B','Synthetic project B',now(),'synthetic-b'),
  ('SQL-SOURCE-C','Synthetic unselected project',now(),'synthetic-c');
insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_updated_at,source_fingerprint) values
  ('SQL-SOURCE-A','A-1','Synthetic model A1',now(),'synthetic-a1'),
  ('SQL-SOURCE-B','B-1','Synthetic model B1',now(),'synthetic-b1');

insert into staging.rem_brands(rem_brand_id,brand_name_rem,source_updated_at,source_fingerprint)
values ('SQL-SOURCE-BRAND','Synthetic source test brand',now(),'synthetic-source-brand');
set local role admin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000005',true);
select set_config('test.fixture_brand',hub.create_brand_from_rem('SQL-SOURCE-BRAND')::text,true);
select hub.update_brand_draft(id,'{"public_name":{"th":"Synthetic source test brand"},"slug":"sql-source-brand","description":{"th":"Synthetic test brand only"}}',updated_at)
from hub.brands where id=current_setting('test.fixture_brand')::uuid;
select hub.bind_brand_asset(id,'10000000-0000-0000-0000-000000000002','logo_primary','{"th":"Synthetic logo"}',updated_at)
from hub.brands where id=current_setting('test.fixture_brand')::uuid;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select hub.publish_brand(current_setting('test.fixture_brand')::uuid,'Publish synthetic source fixture brand');
reset role;
update staging.rem_projects set rem_brand_id='SQL-SOURCE-BRAND' where rem_project_id in ('SQL-SOURCE-A','SQL-SOURCE-B','SQL-SOURCE-C');

set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select set_config('test.source_a',hub.create_project_from_rem('SQL-SOURCE-A')::text,true);
select set_config('test.source_b',hub.create_project_from_rem('SQL-SOURCE-B')::text,true);
select hub.assign_project_brand(id,current_setting('test.fixture_brand')::uuid,updated_at) from hub.projects where id in (current_setting('test.source_a')::uuid,current_setting('test.source_b')::uuid);
select set_config('test.source_public',public_project_id,true) from hub.projects where id=current_setting('test.source_a')::uuid;
select set_config('test.source_model',public_model_id,true) from hub.model_types where project_id=current_setting('test.source_a')::uuid;
select set_config('test.other_model',public_model_id,true) from hub.model_types where project_id=current_setting('test.source_b')::uuid;

do $$
declare detail jsonb := hub.project_detail(current_setting('test.source_public')); item jsonb;
begin
  assert detail->'publication_available'='false'::jsonb, 'Unpublished draft reported public availability';
  select value into item from jsonb_array_elements(hub.list_rem_projects()) where value->>'rem_project_id'='SQL-SOURCE-A';
  assert item->>'public_project_id'=current_setting('test.source_public') and (item->>'model_count')::int=1,
    'Source list must identify an already-selected project and model count';
  assert item->>'source_snapshot_at' is not null and item->>'source_fingerprint'='synthetic-a', 'Source provenance missing';
  assert exists(select 1 from jsonb_array_elements(hub.list_rem_projects()) where value->>'rem_project_id'='SQL-SOURCE-C'
    and value->>'public_project_id' is null), 'Unselected staged project missing';
  assert jsonb_array_length(hub.list_rem_models(current_setting('test.source_a')::uuid))=1, 'Source models crossed project boundary';
  assert detail#>>'{models,0,model_name_rem}'='Synthetic model A1' and detail#>>'{models,0,source_updated_at}' is not null
    and detail#>>'{models,0,source_snapshot_at}' is not null, 'Admin model source provenance missing';
  assert detail#>>'{models,0,match_method}'='ID' and detail#>>'{models,0,match_confidence}'='1'
    and detail#>>'{models,0,match_status}'='SUGGESTED' and detail#>>'{models,0,verified_by}' is null,
    'Exact source selection must still await human confirmation';
  begin
    perform hub.create_project_from_rem('SQL-SOURCE-A');
    raise exception 'Duplicate source project selected';
  exception when unique_violation then null; end;
  begin
    perform hub.create_project_from_rem('SQL-NOT-STAGED');
    raise exception 'Unstaged project created';
  exception when no_data_found then null; end;
  begin
    perform 1 from staging.rem_projects;
    raise exception 'Staff bypassed source function';
  exception when insufficient_privilege then null; end;
  assert not has_function_privilege(current_user,'hub.patch_model(uuid,jsonb)','EXECUTE')
    and not has_function_privilege(current_user,'hub.confirm_model(uuid)','EXECUTE'), 'Legacy mutation bypass remains';
  perform set_config('app.actor_id','',true);
  begin
    perform hub.list_rem_projects();
    raise exception 'Source list allowed missing actor';
  exception when insufficient_privilege then null; end;
  perform set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
end $$;

-- Simulate one additional staged source row becoming available after selection.
reset role;
insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_updated_at,source_fingerprint)
values ('SQL-SOURCE-A','A-2','Synthetic optional model A2',now(),'synthetic-a2');
set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
do $$
declare p uuid := current_setting('test.source_a')::uuid; ts timestamptz; detail jsonb;
begin
  select updated_at into ts from hub.projects where id=p;
  assert exists(select 1 from jsonb_array_elements(hub.list_rem_models(p)) where value->>'rem_model_id'='A-2'
    and value->>'public_model_id' is null), 'New staged model was automatically selected';
  begin
    perform hub.add_model_from_rem(p,'B-1',ts);
    raise exception 'Model selected from another REM project';
  exception when no_data_found then null; end;
  begin
    perform hub.update_model(p,current_setting('test.other_model'),'{"bedrooms":9}',ts);
    raise exception 'Cross-project model edited';
  exception when no_data_found then null; end;
  begin
    perform hub.review_model(p,current_setting('test.other_model'),ts,'CONFIRMED','Cross-project attempt');
    raise exception 'Cross-project model confirmed';
  exception when no_data_found then null; end;
  begin
    perform hub.update_model(p,current_setting('test.source_model'),'{"rem_model_id":"B-1"}',ts);
    raise exception 'Model source anchor changed';
  exception when insufficient_privilege then null; end;
  begin
    perform hub.update_model(p,current_setting('test.source_model'),'{"match_status":"CONFIRMED"}',ts);
    raise exception 'Draft patch self-confirmed mapping';
  exception when insufficient_privilege then null; end;
  detail := hub.add_model_from_rem(p,'A-2',ts);
  assert jsonb_array_length(detail->'models')=2, 'New source selection missing from returned detail';
  perform set_config('test.added_model',(select public_model_id from hub.model_types where project_id=p and rem_model_id='A-2'),true);
  begin
    perform hub.add_model_from_rem(p,'A-2',ts);
    raise exception 'Stale selection accepted';
  exception when serialization_failure then null; end;
  begin
    perform hub.update_model(p,current_setting('test.source_model'),'{"bedrooms":9}',ts);
    raise exception 'Stale model edit accepted';
  exception when serialization_failure then null; end;
  begin
    perform hub.review_model(p,current_setting('test.source_model'),ts,'CONFIRMED','Stale review');
    raise exception 'Stale human review accepted';
  exception when serialization_failure then null; end;
end $$;

do $$
declare p uuid := current_setting('test.source_a')::uuid; ts timestamptz;
begin
  select updated_at into ts from hub.projects where id=p;
  begin
    perform hub.add_model_from_rem(p,'A-2',ts);
    raise exception 'Duplicate model selected';
  exception when unique_violation then null; end;
  begin
    perform hub.review_model(p,current_setting('test.source_model'),ts,'SUGGESTED','Unsupported decision');
    raise exception 'Unsupported human decision accepted';
  exception when check_violation then null; end;
  begin
    perform hub.review_model(p,current_setting('test.source_model'),ts,'CONFIRMED','  ');
    raise exception 'Review without reason accepted';
  exception when check_violation then null; end;
end $$;

set local role viewer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000003',true);
do $$
declare p uuid := current_setting('test.source_a')::uuid; ts timestamptz;
begin
  perform hub.list_rem_projects();
  perform hub.list_rem_models(p);
  select updated_at into ts from hub.projects where id=p;
  begin perform hub.create_project_from_rem('SQL-SOURCE-C'); raise exception 'Viewer selected project';
    exception when insufficient_privilege then null; end;
  begin perform hub.add_model_from_rem(p,'A-2',ts); raise exception 'Viewer selected model';
    exception when insufficient_privilege then null; end;
  begin perform hub.update_model(p,current_setting('test.source_model'),'{"bedrooms":1}',ts); raise exception 'Viewer edited model';
    exception when insufficient_privilege then null; end;
  begin perform hub.review_model(p,current_setting('test.source_model'),ts,'CONFIRMED','Viewer attempt'); raise exception 'Viewer reviewed model';
    exception when insufficient_privilege then null; end;
end $$;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  begin perform hub.list_rem_projects(); raise exception 'Consumer listed staged projects';
    exception when insufficient_privilege then null; end;
  begin perform hub.list_rem_models(current_setting('test.source_a')::uuid); raise exception 'Consumer listed staged models';
    exception when insufficient_privilege then null; end;
  begin perform hub.review_model(current_setting('test.source_a')::uuid,current_setting('test.source_model'),now(),'CONFIRMED','Consumer attempt');
    raise exception 'Consumer reviewed model'; exception when insufficient_privilege then null; end;
end $$;

set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select hub.patch_project(current_setting('test.source_a')::uuid,
  '{"public_name":{"th":"Synthetic commercial project"},"slug":"sql-source-test","address":{"th":"Synthetic address"},"latitude":13.7563,"longitude":100.5018,"ad_disclaimer":{"th":"Synthetic test only"}}',
  (select updated_at from hub.projects where id=current_setting('test.source_a')::uuid));
select hub.update_model(current_setting('test.source_a')::uuid,current_setting('test.source_model'),
  '{"bedrooms":null,"bathrooms":null,"usable_area_sqm":null,"parking_spaces":null}',
  (select updated_at from hub.projects where id=current_setting('test.source_a')::uuid));
do $$ begin
  assert not (hub.project_readiness(current_setting('test.source_a')::uuid)->>'ready')::boolean, 'Nullable draft specs passed readiness';
end $$;
select hub.update_model(current_setting('test.source_a')::uuid,current_setting('test.source_model'),
  '{"bedrooms":2.5,"bathrooms":1,"usable_area_sqm":50,"parking_spaces":1}',
  (select updated_at from hub.projects where id=current_setting('test.source_a')::uuid));
do $$ begin
  assert exists(select 1 from jsonb_array_elements(hub.project_readiness(current_setting('test.source_a')::uuid)->'recommended')
    where value->>'field' like 'models.%.match_status' and not (value->>'passed')::boolean), 'Exact source match bypassed human confirmation';
end $$;
select hub.review_model(current_setting('test.source_a')::uuid,current_setting('test.source_model'),
  (select updated_at from hub.projects where id=current_setting('test.source_a')::uuid),'CONFIRMED','Human confirmed synthetic A1');
select hub.review_model(current_setting('test.source_a')::uuid,current_setting('test.added_model'),
  (select updated_at from hub.projects where id=current_setting('test.source_a')::uuid),'REJECTED','Human excluded unwanted A2');
select hub.bind_project_asset(current_setting('test.source_a')::uuid,'10000000-0000-0000-0000-000000000001','hero','{"th":"Synthetic image"}',
  (select updated_at from hub.projects where id=current_setting('test.source_a')::uuid));
select hub.bind_project_asset(current_setting('test.source_a')::uuid,'10000000-0000-0000-0000-000000000002','thumbnail','{"th":"Synthetic image"}',
  (select updated_at from hub.projects where id=current_setting('test.source_a')::uuid));
do $$
declare detail jsonb := hub.project_detail(current_setting('test.source_public')); item jsonb;
begin
  assert (detail#>>'{readiness,ready}')::boolean, 'Rejected unwanted model blocked complete confirmed model';
  assert jsonb_array_length(detail->'models')=2, 'Admin lost rejected mapping';
  assert jsonb_array_length(detail#>'{readiness,required}')=10, 'Required checklist changed unexpectedly';
  assert (select count(*) from jsonb_array_elements(detail#>'{readiness,recommended}') e where e->>'field' like 'models.%.match_status' or e->>'field' like 'models.%.specifications')=4, 'Each source model needs separate confirmation and specs items';
  assert (detail#>>'{readiness,percent}')::integer=floor(100.0*(detail#>>'{readiness,passed}')::integer/(detail#>>'{readiness,total}')::integer), 'Completeness denominator mismatch';
  assert detail#>>'{readiness,model_catalogue_complete}'='false', 'Rejected source model must keep catalogue incomplete';
  select value into item from jsonb_array_elements(detail->'models') where value->>'public_model_id'=current_setting('test.source_model');
  assert item->>'verified_by'='00000000-0000-0000-0000-000000000001' and item->>'verified_at' is not null, 'Human verification attribution missing';
end $$;

set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
select hub.publish_project(current_setting('test.source_a')::uuid,'Publish confirmed model only');
do $$ begin
  assert hub.project_detail(current_setting('test.source_public'))->'publication_available'='true'::jsonb,
    'Published release excluding rejected model reported unavailable';
end $$;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
select set_config('test.source_payload',payload::text,true) from public_api.projects where public_project_id=current_setting('test.source_public');
do $$ begin
  assert (select jsonb_array_length(payload->'models')=1 and payload#>>'{models,0,rem_model_id}'='A-1'
    and not (payload->'models'->0 ? 'verified_by') and not (payload->'models'->0 ? 'source_snapshot_at')
    from public_api.projects where public_project_id=current_setting('test.source_public')), 'New release included rejected model or admin metadata';
end $$;
set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select hub.update_model(current_setting('test.source_a')::uuid,current_setting('test.source_model'),'{"bedrooms":3}',
  (select updated_at from hub.projects where id=current_setting('test.source_a')::uuid));
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert (select payload=current_setting('test.source_payload')::jsonb from public_api.projects
    where public_project_id=current_setting('test.source_public')), 'Draft spec edit changed frozen public snapshot';
end $$;
set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select hub.review_model(current_setting('test.source_a')::uuid,current_setting('test.source_model'),
  (select updated_at from hub.projects where id=current_setting('test.source_a')::uuid),'REJECTED','Human revoked published A1');
do $$ begin
  assert (hub.project_readiness(current_setting('test.source_a')::uuid)->>'ready')::boolean, 'Models blocked required-only gate';
  assert hub.project_detail(current_setting('test.source_public'))->'publication_available'='false'::jsonb,
    'Rejected published mapping still reported available in admin';
  assert (select verified_by is null and verified_at is null from hub.model_types where public_model_id=current_setting('test.source_model')),
    'Rejection retained confirmation attribution';
end $$;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert not exists(select 1 from public_api.projects where public_project_id=current_setting('test.source_public')), 'Rejected published mapping stayed publicly available';
end $$;
set local role publisher;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000002',true);
do $$ begin
  begin
    perform hub.publish_project(current_setting('test.source_a')::uuid,'Synthetic publication with no eligible models');
    assert (select jsonb_array_length(v.payload->'models')=0 and v.payload->>'model_catalogue_complete'='false' from hub.entity_versions v join hub.projects p on p.published_version_id=v.id where p.public_project_id=current_setting('test.source_public'));
    raise exception 'rollback test publication' using errcode='P0004';
  exception when assert_failure then if SQLERRM<>'rollback test publication' then raise; end if; end;
end $$;
set local role editor;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select hub.review_model(current_setting('test.source_a')::uuid,current_setting('test.source_model'),
  (select updated_at from hub.projects where id=current_setting('test.source_a')::uuid),'CONFIRMED','Human reconfirmed A1');
do $$ begin
  assert hub.project_detail(current_setting('test.source_public'))->'publication_available'='true'::jsonb,
    'Reconfirmed published mapping reported unavailable in admin';
end $$;
set local role service_consumer;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  assert (select payload=current_setting('test.source_payload')::jsonb from public_api.projects
    where public_project_id=current_setting('test.source_public')), 'Reconfirmation changed historical snapshot';
end $$;
reset role;
do $$ begin
  assert exists(select 1 from audit.change_log where table_name='hub.model_types'
    and after_row->>'public_model_id'=current_setting('test.source_model') and after_row->>'match_status'='REJECTED'
    and actor='00000000-0000-0000-0000-000000000001'::uuid and reason='Human revoked published A1'), 'Human rejection audit missing';
end $$;
rollback;
select 'PASS: staged source selection, human matching, permissions, stale edits and publication isolation' as result;
