-- Synthetic Gold snapshots only. No source connection, all rows roll back.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
select set_config('app.change_reason','Synthetic Gold prefill test',true);
insert into staging.rem_projects(rem_project_id,project_name_rem,source_fingerprint) values
  ('SQL-GOLD-A','Official A','synthetic-a'),('SQL-GOLD-B','Official B','synthetic-b'),
  ('SQL-GOLD-LEGACY','Official legacy','synthetic-legacy'),
  ('SQL-GOLD-SERIALIZED','Official serialized','synthetic-serialized');
insert into staging.rem_models(rem_project_id,rem_model_id,model_name_rem,source_fingerprint)
  values('SQL-GOLD-A','A1','Official model','synthetic-model');
insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance,model_groups)
  values('SQL-GOLD-A','{"project_id":"SQL-GOLD-A","commercial_brand":"Synthetic brand","rem_project_group_id":"GROUP-A",
    "project_name":"Official A","project_name_eng":"Official English A",
    "commercial_project_name":"Commercial Thai A","commercial_project_name_eng":"Commercial English A",
    "moo":0,"soi":" Lane ","road":"","district":"District","province":"Province","postcode":"00120",
    "soi_eng":"English Lane","district_eng":"English District","latitude":0,"longitude":100,
    "has_valid_coordinates":true,"project_identity_conflict":false}',
    now(),repeat('a',64),'{"synthetic_test":true}',
    '[{"project_id":"SQL-GOLD-A","model_name":"A group","model_ids":["A1"],"model_count":1}]');

-- Simulates a draft created before migration 008, without any Marketing edits.
insert into hub.projects(rem_project_id,public_name,name_source)
  values('SQL-GOLD-LEGACY','{"th":"Official legacy"}','rem_default');
insert into hub.projects(rem_project_id,public_name,name_source)
  values('SQL-GOLD-SERIALIZED','{"th":"Original Thai"}','rem_default');
insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance)
  values('SQL-GOLD-LEGACY','{"project_id":"SQL-GOLD-LEGACY","commercial_project_name":"Commercial legacy",
    "commercial_project_name_eng":"English legacy","road":"Road","road_eng":"English Road",
    "postcode":"00001","latitude":10,"longitude":100}',now(),repeat('b',64),'{"synthetic_test":true}');
insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance)
  values('SQL-GOLD-SERIALIZED','{"project_id":"SQL-GOLD-SERIALIZED","commercial_project_name":"Source Thai",
    "commercial_project_name_eng":"Default English","road":"Source Road","road_eng":"Source English Road",
    "postcode":"00123","latitude":null,"longitude":null,"has_valid_coordinates":false}',
    now(),repeat('d',64),'{"synthetic_test":true}');

set local role editor;
select set_config('test.gold_a',hub.create_project_from_rem('SQL-GOLD-A')::text,true);
select set_config('test.gold_b',hub.create_project_from_rem('SQL-GOLD-B')::text,true);
select set_config('test.gold_legacy',id::text,true) from hub.projects where rem_project_id='SQL-GOLD-LEGACY';
select set_config('test.gold_serialized',id::text,true) from hub.projects where rem_project_id='SQL-GOLD-SERIALIZED';
do $$
declare p hub.projects; detail jsonb; legacy hub.projects; result jsonb; preview jsonb;
begin
  select * into p from hub.projects where id=current_setting('test.gold_a')::uuid;
  detail := hub.project_detail(p.public_project_id);
  assert p.public_name='{"th":"Commercial Thai A","en":"Commercial English A"}'::jsonb
    and p.name_source='dw_default', 'Commercial defaults silently fell back to official names';
  assert p.address='{"th":"0 Lane District Province 00120","en":"English Lane English District 00120"}'::jsonb,
    'Components, zero, whitespace or shared postcode were lost';
  assert p.latitude=0 and p.longitude=100, 'Valid coordinate pair including zero missing';
  assert detail#>>'{gold_source,record,project_id}'='SQL-GOLD-A'
    and detail#>>'{gold_source,model_groups,0,model_ids,0}'='A1', 'Private staff Gold source missing';
  assert detail ? 'commercial_types' and detail ? 'facilities', 'Gold preview dropped existing staff serializers';
  assert detail->'gold_prefill_changes'='{}'::jsonb, 'Already initialized draft has spurious defaults';
  assert exists(select 1 from jsonb_array_elements(hub.list_rem_projects()) item
    where item->>'rem_project_id'='SQL-GOLD-A' and item#>>'{gold_source,source_relation}'='gold.dim_project'),
    'Picker cannot preview the actual Gold snapshot';
  assert detail#>>'{models,0,match_status}'='SUGGESTED' and detail#>>'{models,0,verified_by}' is null
    and detail#>>'{models,0,usable_area_sqm}' is null, 'Gold prefill inferred or confirmed model facts';
  select * into p from hub.projects where id=current_setting('test.gold_b')::uuid;
  assert p.public_name='{}'::jsonb and p.address='{}'::jsonb and p.latitude is null and p.name_source='unset',
    'Missing Gold must stay empty, never masquerade as commercial defaults';
  begin
    perform hub.prefill_project_from_dw(p.id,p.updated_at,repeat('a',64));
    raise exception 'Missing Gold accepted';
  exception when no_data_found then null; end;
  select * into legacy from hub.projects where id=current_setting('test.gold_legacy')::uuid;
  preview := hub.project_detail(legacy.public_project_id)->'gold_prefill_changes';
  assert preview#>>'{public_name,en}'='English legacy' and preview#>>'{address,en}'='English Road 00001'
    and preview->>'latitude'='10', 'Read-only preview omitted eligible source values';
  assert (select updated_at=legacy.updated_at and public_name=legacy.public_name and address=legacy.address
    from hub.projects where id=legacy.id), 'Reading Gold defaults mutated the saved draft';
  begin
    perform hub.prefill_project_from_dw(legacy.id,legacy.updated_at,repeat('c',64));
    raise exception 'Stale source accepted';
  exception when serialization_failure then null; end;
  begin
    perform hub.prefill_project_from_dw(legacy.id,legacy.updated_at-interval '1 second',repeat('b',64));
    raise exception 'Stale draft accepted';
  exception when serialization_failure then null; end;
  result := hub.prefill_project_from_dw(legacy.id,legacy.updated_at,repeat('b',64));
  assert result->'public_name'=preview->'public_name' and result->'address'=preview->'address'
    and result->'latitude'=preview->'latitude' and result->'longitude'=preview->'longitude',
    'Preview and explicit prefill disagree';
  assert result#>>'{public_name,th}'='Commercial legacy' and result#>>'{public_name,en}'='English legacy'
    and result#>>'{address,en}'='English Road 00001' and result->>'name_source'='dw_default',
    'Untouched legacy defaults were not upgraded explicitly';
  select * into legacy from hub.projects where id=legacy.id;
  perform hub.prefill_project_from_dw(legacy.id,legacy.updated_at,repeat('b',64));
  assert (select updated_at=legacy.updated_at from hub.projects where id=legacy.id), 'No-op prefill changed draft revision';
  perform hub.patch_project(legacy.id,'{"public_name":{"th":"Marketing edit","en":"","zh":"Preserved locale"},
    "address":{"th":"","en":"Custom English"},"latitude":null,"longitude":null}',legacy.updated_at);
  select * into legacy from hub.projects where id=legacy.id;
  result := hub.prefill_project_from_dw(legacy.id,legacy.updated_at,repeat('b',64));
  assert result#>>'{public_name,th}'='Marketing edit' and result#>>'{public_name,en}'=''
    and result#>>'{public_name,zh}'='Preserved locale' and result->>'name_source'='marketing_override',
    'Prefill overwrote a name or lost another language';
  assert result#>>'{address,th}'='' and result#>>'{address,en}'='Custom English'
    and result->'latitude'='null'::jsonb and result->'longitude'='null'::jsonb,
    'Prefill restored values that an editor deliberately cleared';
  assert result->'gold_prefill_changes'='{}'::jsonb, 'Preview restored deliberately cleared values';
  begin perform hub.patch_project(legacy.id,'{"gold_source":{}}',legacy.updated_at);
    raise exception 'Staff changed readonly Gold'; exception when insufficient_privilege then null; end;
  begin perform 1 from staging.dw_projects; raise exception 'Staff directly read private source';
    exception when insufficient_privilege then null; end;

  -- The form used to serialize missing locales as empty strings on unrelated saves.
  -- This must not prevent new defaults, nor undo a genuine Marketing name edit.
  select * into p from hub.projects where id=current_setting('test.gold_serialized')::uuid;
  perform hub.patch_project(p.id,'{"public_name":{"th":"Marketing Thai","en":"","zh":"Keep locale"},
    "address":{"th":" ","en":""}}',p.updated_at);
  select * into p from hub.projects where id=p.id;
  preview := hub.project_detail(p.public_project_id)->'gold_prefill_changes';
  assert preview#>>'{public_name,th}'='Marketing Thai' and preview#>>'{public_name,en}'='Default English'
    and preview#>>'{public_name,zh}'='Keep locale', 'Empty serialization blocked defaults or overwrote edited wording';
  assert preview#>>'{address,th}'='Source Road 00123' and preview#>>'{address,en}'='Source English Road 00123',
    'Untouched blank address was treated as a deliberate clear';
  assert not (preview ? 'latitude' or preview ? 'longitude'), 'Missing coordinates became fabricated values';
  -- Saving preview through the normal form remains an ordinary unreviewed draft edit.
  result := hub.patch_project(p.id,preview,p.updated_at);
  assert result->'public_name'=preview->'public_name' and result->'address'=preview->'address'
    and result->'gold_prefill_changes'='{}'::jsonb and result->'published_version_id'='null'::jsonb,
    'Saving the preview changed provenance boundary or retained stale suggestions';
end $$;

reset role;
-- A partial Hub coordinate edit must not combine two different locations.
update hub.projects set latitude=20,longitude=null where id=current_setting('test.gold_b')::uuid;
insert into staging.dw_projects(rem_project_id,source_record,source_snapshot_at,source_fingerprint,provenance)
  values('SQL-GOLD-B','{"project_id":"SQL-GOLD-B","latitude":10,"longitude":100}',now(),repeat('c',64),'{"synthetic_test":true}');
set local role editor;
do $$ declare p hub.projects; result jsonb; begin
  select * into p from hub.projects where id=current_setting('test.gold_b')::uuid;
  result := hub.prefill_project_from_dw(p.id,p.updated_at,repeat('c',64));
  assert result->>'latitude'='20' and result->'longitude'='null'::jsonb, 'Prefill combined unrelated coordinate components';
end $$;
reset role;
do $$
declare p uuid:=current_setting('test.gold_a')::uuid; defaults jsonb;
begin
  assert not (hub.draft_payload(p) ? 'gold_source'), 'Raw Gold entered publishable payload';
  assert not (hub.draft_payload(p) ? 'gold_prefill_changes'), 'Gold preview entered publishable payload';
  update staging.dw_projects set source_record=source_record||'{"latitude":null,"longitude":100}'::jsonb
    where rem_project_id='SQL-GOLD-A';
  defaults := hub.gold_project_defaults('SQL-GOLD-A');
  assert not (defaults ? 'latitude' or defaults ? 'longitude'), 'Partial coordinate pair copied';
  update staging.dw_projects set source_record=source_record||'{"latitude":0,"longitude":100,"has_valid_coordinates":false}'::jsonb
    where rem_project_id='SQL-GOLD-A';
  assert not (hub.gold_project_defaults('SQL-GOLD-A') ? 'latitude'), 'Explicit invalid coordinates copied';
  update staging.dw_projects set source_record=source_record||'{"latitude":"bad","longitude":100,"has_valid_coordinates":true}'::jsonb
    where rem_project_id='SQL-GOLD-A';
  assert not (hub.gold_project_defaults('SQL-GOLD-A') ? 'latitude'), 'Invalid coordinate text copied';
  update staging.dw_projects set source_record=source_record||'{"project_identity_conflict":true}'::jsonb
    where rem_project_id='SQL-GOLD-A';
  assert hub.gold_project_defaults('SQL-GOLD-A')='{}'::jsonb, 'Conflicting identity supplied defaults';
end $$;
set local role viewer;
do $$ begin
  begin perform hub.prefill_project_from_dw(current_setting('test.gold_a')::uuid,now(),repeat('a',64));
    raise exception 'Viewer changed draft'; exception when insufficient_privilege then null; end;
  assert not has_function_privilege(current_user,'hub.gold_project_source(text)','execute')
    and not has_function_privilege(current_user,'hub.gold_project_defaults(text)','execute')
    and not has_function_privilege(current_user,'hub.gold_project_prefill_changes(uuid)','execute')
    and not has_function_privilege(current_user,'hub.project_detail_before_gold_preview(text)','execute'), 'Private helper exposed';
end $$;
set local role service_consumer;
do $$ begin
  begin perform hub.list_rem_projects(); raise exception 'Consumer read source'; exception when insufficient_privilege then null; end;
  begin perform hub.prefill_project_from_dw(current_setting('test.gold_a')::uuid,now(),repeat('a',64));
    raise exception 'Consumer changed draft'; exception when insufficient_privilege then null; end;
end $$;
rollback;
select 'PASS: bilingual Gold preview/defaults, blank serialization, source revision, deliberate-clear protection and private provenance' as result;
