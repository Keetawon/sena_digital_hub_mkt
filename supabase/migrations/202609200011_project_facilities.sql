-- Marketing intake only. These drafts are deliberately absent from public releases
-- until the catalogue review/publication contract is implemented.
begin;

create table hub.facility_taxonomy (
  code text primary key, name_th text not null, name_en text not null,
  required_in_intake boolean not null default false, sort_order integer not null,
  active boolean not null default true
);
insert into hub.facility_taxonomy(code,name_th,name_en,required_in_intake,sort_order) values
  ('pool','สระว่ายน้ำ','Swimming pool',true,10),
  ('fitness','ฟิตเนส','Fitness center',true,20),
  ('garden','สวนส่วนกลาง','Shared garden',true,30),
  ('security','ระบบรักษาความปลอดภัย','Security',true,40),
  ('coworking','พื้นที่ทำงานร่วม','Coworking space',true,50),
  ('playground','สนามเด็กเล่น','Playground',true,60),
  ('clubhouse','คลับเฮาส์','Clubhouse',false,70),
  ('laundry','ห้องซักผ้าส่วนกลาง','Shared laundry',false,80),
  ('pet_area','พื้นที่สำหรับสัตว์เลี้ยง','Pet area',false,90),
  ('visitor_parking','ที่จอดรถผู้มาติดต่อ','Visitor parking',false,100);

create table hub.project_facilities (
  project_id uuid not null references hub.projects(id),
  facility_code text not null references hub.facility_taxonomy(code),
  status text not null check(status in ('present','absent','planned','unknown')),
  description jsonb not null default '{}' check(jsonb_typeof(description)='object'),
  location_note text not null default '' check(length(location_note)<=2000),
  access_note text not null default '' check(length(access_note)<=2000),
  evidence_note text not null default '' check(length(evidence_note)<=2000),
  expected_open_date date,
  updated_at timestamptz not null default clock_timestamp(), updated_by uuid,
  primary key(project_id,facility_code)
);
create trigger touch before update on hub.project_facilities
  for each row execute function hub.touch_record();
create trigger audit_write after insert or update or delete on hub.project_facilities
  for each row execute function audit.record_change();
alter table hub.facility_taxonomy enable row level security;
alter table hub.project_facilities enable row level security;
create policy staff_read on hub.facility_taxonomy for select to editor,publisher,viewer,admin using(true);
create policy staff_read on hub.project_facilities for select to editor,publisher,viewer,admin using(true);
revoke all on hub.facility_taxonomy,hub.project_facilities from public,editor,publisher,viewer,admin,service_consumer;
grant select on hub.facility_taxonomy,hub.project_facilities to editor,publisher,viewer,admin;

create function hub.project_facility_payload(project_uuid uuid) returns jsonb
language sql stable set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object('review_status','draft','checklist_version',1,
    'expected_count',count(*) filter(where t.required_in_intake),
    'collected_count',count(*) filter(where t.required_in_intake and f.status in ('present','absent','planned')),
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'code',t.code,'name_th',t.name_th,'name_en',t.name_en,'required',t.required_in_intake,
      'status',coalesce(f.status,'unknown'),'description',coalesce(f.description,'{}'::jsonb),
      'location_note',coalesce(f.location_note,''),'access_note',coalesce(f.access_note,''),
      'evidence_note',coalesce(f.evidence_note,''),'expected_open_date',f.expected_open_date,
      'updated_at',f.updated_at,'updated_by',f.updated_by) order by t.sort_order,t.code),'[]'::jsonb),
    'missing',coalesce(jsonb_agg(jsonb_build_object('field','facilities.'||t.code,
      'message','ระบุสถานะ'||t.name_th) order by t.sort_order,t.code)
      filter(where t.required_in_intake and (f.status is null or f.status='unknown')),'[]'::jsonb))
  from hub.facility_taxonomy t left join hub.project_facilities f
    on f.facility_code=t.code and f.project_id=project_uuid where t.active
$$;
revoke all on function hub.project_facility_payload(uuid) from public,editor,publisher,viewer,admin,service_consumer;

alter function hub.project_detail(text) rename to project_detail_before_facilities;
revoke all on function hub.project_detail_before_facilities(text) from public,editor,publisher,viewer,admin,service_consumer;
create function hub.project_detail(public_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare payload jsonb;
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  payload:=hub.project_detail_before_facilities(public_id);
  return payload||jsonb_build_object('facilities',hub.project_facility_payload((payload->>'id')::uuid));
end $$;
revoke all on function hub.project_detail(text) from public,editor,publisher,viewer,admin,service_consumer;
grant execute on function hub.project_detail(text) to editor,publisher,viewer,admin;

create function hub.save_project_facility(project_uuid uuid,code text,body jsonb,expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects; actor uuid; key text; description_value jsonb;
begin
  actor:=hub.require_actor(array['editor','publisher']);
  select * into p from hub.projects where id=project_uuid and deleted_at is null for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  if expected_updated_at is null or p.updated_at<>expected_updated_at then
    raise exception 'Draft changed; reload before saving' using errcode='40001';
  end if;
  if not exists(select 1 from hub.facility_taxonomy t where t.code=save_project_facility.code and t.active) then
    raise exception 'Unknown facility code' using errcode='23514';
  end if;
  if jsonb_typeof(body) is distinct from 'object' or body->>'status' is null
    or body->>'status' not in ('present','absent','planned','unknown') then
    raise exception 'Facility status is required' using errcode='23514';
  end if;
  if exists(select 1 from jsonb_object_keys(body) k where k not in
    ('status','description','location_note','access_note','evidence_note','expected_open_date')) then
    raise exception 'Unknown facility field' using errcode='23514';
  end if;
  description_value:=coalesce(body->'description','{}'::jsonb);
  if jsonb_typeof(description_value) is distinct from 'object' then
    raise exception 'Invalid description' using errcode='23514';
  end if;
  if exists(select 1 from jsonb_each(description_value) e where jsonb_typeof(e.value)<>'string'
    or length(e.value#>>'{}')>4000 or e.key !~ '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$') then
    raise exception 'Invalid localized description' using errcode='23514';
  end if;
  foreach key in array array['location_note','access_note','evidence_note'] loop
    if body ? key and (jsonb_typeof(body->key) is distinct from 'string' or length(body->>key)>2000) then
      raise exception 'Invalid facility detail' using errcode='23514';
    end if;
  end loop;
  if body->>'expected_open_date' is not null and (body->>'status'<>'planned'
    or jsonb_typeof(body->'expected_open_date')<>'string'
    or body->>'expected_open_date' !~ '^\d{4}-\d{2}-\d{2}$') then
    raise exception 'Opening date applies to planned facilities only' using errcode='23514';
  end if;
  insert into hub.project_facilities(project_id,facility_code,status,description,location_note,access_note,evidence_note,expected_open_date,updated_by)
    values(p.id,code,body->>'status',description_value,coalesce(body->>'location_note',''),
      coalesce(body->>'access_note',''),coalesce(body->>'evidence_note',''),(body->>'expected_open_date')::date,actor)
    on conflict(project_id,facility_code) do update set status=excluded.status,description=excluded.description,
      location_note=excluded.location_note,access_note=excluded.access_note,evidence_note=excluded.evidence_note,
      expected_open_date=excluded.expected_open_date;
  update hub.projects set updated_at=clock_timestamp() where id=p.id;
  return hub.project_detail(p.public_project_id);
end $$;
revoke all on function hub.save_project_facility(uuid,text,jsonb,timestamptz) from public,editor,publisher,viewer,admin,service_consumer;
grant execute on function hub.save_project_facility(uuid,text,jsonb,timestamptz) to editor,publisher,admin;
commit;
