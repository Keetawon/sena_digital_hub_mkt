-- Synthetic data only; every assertion runs inside a rolled-back transaction.
begin;
select set_config('app.actor_id','00000000-0000-0000-0000-000000000001',true);
insert into staging.rem_projects(rem_project_id,project_name_rem,source_fingerprint)
  values('SQL-FACILITIES','Facility test','synthetic');
set local role editor;
select set_config('test.facility_project',hub.create_project_from_rem('SQL-FACILITIES')::text,true);
do $$
declare p hub.projects; result jsonb; previous_revision timestamptz; before_row jsonb;
begin
  select * into p from hub.projects where id=current_setting('test.facility_project')::uuid;
  result:=hub.project_detail(p.public_project_id);
  assert result#>>'{facilities,collected_count}'='0';
  assert result#>>'{facilities,expected_count}'='6';
  assert jsonb_array_length(result#>'{facilities,missing}')=6;
  previous_revision:=p.updated_at;
  result:=hub.save_project_facility(p.id,'pool','{"status":"absent","description":{"th":"ไม่มีสระว่ายน้ำ","en":"No pool"},"evidence_note":"Synthetic owner supplied"}',p.updated_at);
  assert result#>>'{facilities,collected_count}'='1','Known absence must count as collected';
  assert jsonb_array_length(result#>'{facilities,missing}')=5;
  assert not (result->'facilities' ? 'percent'),'Collection is not an arbitrary score';
  select * into p from hub.projects where id=p.id;
  begin
    perform hub.save_project_facility(p.id,'fitness','{"status":"present"}',previous_revision);
    raise exception 'Stale update accepted';
  exception when serialization_failure then null; end;
  assert not exists(select 1 from hub.project_facilities where project_id=p.id and facility_code='fitness');
  before_row:=to_jsonb(p);
  begin
    perform hub.save_project_facility(p.id,'invented','{"status":"present"}',p.updated_at);
    raise exception 'Unknown vocabulary accepted';
  exception when check_violation then null; end;
  begin
    perform hub.save_project_facility(p.id,'pool','{"status":"present","description":{"th":true}}',p.updated_at);
    raise exception 'Nontext description accepted';
  exception when check_violation then null; end;
  begin
    perform hub.save_project_facility(p.id,'pool','{"status":"present","expected_open_date":"2027-01-01"}',p.updated_at);
    raise exception 'Opening date for unplanned accepted';
  exception when check_violation then null; end;
  begin
    perform hub.save_project_facility(p.id,'pool','{"status":"present","reviewed":true}',p.updated_at);
    raise exception 'Approval bypass accepted';
  exception when check_violation then null; end;
  assert (select to_jsonb(row)=before_row from hub.projects row where id=p.id),'Invalid write touched project';
  result:=hub.save_project_facility(p.id,'pool','{"status":"unknown"}',p.updated_at);
  assert result#>>'{facilities,collected_count}'='0','Unknown was confused with absence';
  select * into p from hub.projects where id=p.id;
  result:=hub.save_project_facility(p.id,'fitness','{"status":"planned","expected_open_date":"2027-01-01","location_note":"Tower A only","access_note":"Residents","evidence_note":"Draft plan"}',p.updated_at);
  assert result#>>'{facilities,collected_count}'='1';
  assert result#>>'{facilities,review_status}'='draft';
end $$;
set local role viewer;
do $$ declare p hub.projects; begin
  select * into p from hub.projects where id=current_setting('test.facility_project')::uuid;
  assert hub.project_detail(p.public_project_id)->'facilities' is not null;
  begin perform hub.save_project_facility(p.id,'pool','{"status":"present"}',p.updated_at);
    raise exception 'Viewer wrote'; exception when insufficient_privilege then null; end;
end $$;
set local role service_consumer;
do $$ begin
  begin perform count(*) from hub.project_facilities;
    raise exception 'Consumer read drafts'; exception when insufficient_privilege then null; end;
  begin perform hub.project_facility_payload(current_setting('test.facility_project')::uuid);
    raise exception 'Consumer called draft helper'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  assert not (hub.draft_payload(current_setting('test.facility_project')::uuid) ? 'facilities'), 'Unreviewed intake entered release payload';
  assert exists(select 1 from audit.change_log where table_name='hub.project_facilities'
    and after_row->>'project_id'=current_setting('test.facility_project') and actor is not null),'Missing actor audit';
end $$;
rollback;
