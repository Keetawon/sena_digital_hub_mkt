-- C5. Structured drafts and frozen reviews per REM project. No public release.
begin;
create table hub.project_disclosures (
 owner_company jsonb not null default '{}' check(hub.content_locales(owner_company,4000)),
 owner_address jsonb not null default '{}' check(hub.content_locales(owner_address,4000)),
 registered_capital numeric(14,2) check(registered_capital>=0 and registered_capital<'Infinity'::numeric),
 paid_capital numeric(14,2) check(paid_capital>=0 and paid_capital<'Infinity'::numeric),
 managing_director jsonb not null default '{}' check(hub.content_locales(managing_director,4000)),
 legal_project_name jsonb not null default '{}' check(hub.content_locales(legal_project_name,4000)),
 location_text jsonb not null default '{}' check(hub.content_locales(location_text,4000)),
 land_area_sqwah numeric(14,2) check(land_area_sqwah>=0 and land_area_sqwah<'Infinity'::numeric),
 title_deeds text[] not null default '{}' check(cardinality(title_deeds)<=100),
 land_numbers text[] not null default '{}' check(cardinality(land_numbers)<=100),
 encumbrance text check(encumbrance in ('none','mortgage')),
 bank jsonb not null default '{}' check(hub.content_locales(bank,4000)),
 building_description jsonb not null default '{}' check(hub.content_locales(building_description,4000)),
 building_count integer check(building_count between 0 and 10000), unit_total integer check(unit_total between 0 and 1000000),
 eia_status text check(eia_status in ('not_required','pending','approved')), eia_approval_date date,
 construction_start_year integer check(construction_start_year between 1900 and 2200),
 construction_completion_year integer check(construction_completion_year between 1900 and 2200),
 notes jsonb not null default '{}' check(hub.content_locales(notes,4000)),
 basis text not null default 'mkt_entered' check(basis in ('mkt_entered','legal_document','legal_approved')),
 legal_document_asset_id uuid references hub.assets, legal_doc_ref text check(length(legal_doc_ref)<=4000), legal_doc_date date,
 legal_reviewed_by text check(length(legal_reviewed_by)<=4000), legal_reviewed_at date,
 override_reason text check(length(override_reason)<=4000),
 check(paid_capital<=registered_capital),check(construction_completion_year>=construction_start_year)
);
create table hub.project_sales_terms (
 booking_fee numeric(14,2) check(booking_fee>=0 and booking_fee<'Infinity'::numeric),
 contract_fee numeric(14,2) check(contract_fee>=0 and contract_fee<'Infinity'::numeric),
 down_payment numeric(14,2) check(down_payment>=0 and down_payment<'Infinity'::numeric),
 installment_from numeric(14,2) check(installment_from>=0 and installment_from<'Infinity'::numeric),
 installment_basis jsonb not null default '{}' check(hub.content_locales(installment_basis,4000)),
 interest_rate numeric check(interest_rate between 0 and 100),
 rate_period jsonb not null default '{}' check(hub.content_locales(rate_period,4000)),
 lender jsonb not null default '{}' check(hub.content_locales(lender,4000)),
 conditions jsonb not null default '{}' check(hub.content_locales(conditions,4000)),
 valid_from date not null,valid_to date not null,check(valid_to>=valid_from)
);
create table hub.project_programmes (
 programme_key text not null check(programme_key ~ '^[a-z][a-z0-9_-]{0,79}$'), participating boolean,
 monthly_from numeric(14,2) check(monthly_from>=0 and monthly_from<'Infinity'::numeric),
 basis jsonb not null default '{}' check(hub.content_locales(basis,4000)),
 units_offered integer check(units_offered is null), as_of date not null
);
create table hub.project_progress (
 component text not null check(component in ('overall','structure','architecture','systems','landscape','other')),
 percent numeric not null check(percent between 0 and 100),as_of date not null,
 source text not null check(source in ('construction','mkt'))
);

create function hub.project_commercial_table(kind text) returns text
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
begin
 case kind when 'disclosures' then return 'project_disclosures'; when 'sales-terms' then return 'project_sales_terms';
 when 'programmes' then return 'project_programmes'; when 'construction' then return 'project_progress';
 else raise exception 'Unknown project record type' using errcode='23514';end case;
end $$;
create function hub.project_commercial_entity(kind text) returns text
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select case kind when 'disclosures' then 'disclosure' when 'sales-terms' then 'sales_term'
 when 'programmes' then 'programme' when 'construction' then 'construction_progress' end
$$;
create function hub.project_commercial_fields(kind text) returns text[]
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select array['ai_exposure']||case kind
 when 'disclosures' then array['owner_company','owner_address','registered_capital','paid_capital','managing_director','legal_project_name',
  'location_text','land_area_sqwah','title_deeds','land_numbers','encumbrance','bank','building_description','building_count','unit_total',
  'eia_status','eia_approval_date','construction_start_year','construction_completion_year','notes','basis','legal_document_asset_id',
  'legal_doc_ref','legal_doc_date','legal_reviewed_by','legal_reviewed_at','override_reason']
 when 'sales-terms' then array['booking_fee','contract_fee','down_payment','installment_from','installment_basis','interest_rate','rate_period','lender','conditions','valid_from','valid_to']
 when 'programmes' then array['programme_key','participating','monthly_from','basis','units_offered','as_of']
 when 'construction' then array['component','percent','as_of','source'] end
$$;

do $$ declare t text;begin
 foreach t in array array['project_disclosures','project_sales_terms','project_programmes','project_progress'] loop
  execute format('alter table hub.%I add column id uuid primary key default gen_random_uuid(),
   add column project_id uuid not null references hub.projects,
   add column public_content_id text not null unique default (''content_''||replace(gen_random_uuid()::text,''-'','''')),
   add column ai_exposure text not null default ''web_only'' check(ai_exposure in (''open'',''web_only'',''internal'')),
   add column state text not null default ''draft'' check(state in (''draft'',''in_review'',''approved'',''withdrawn'')),
   add column revision integer not null default 1 check(revision>0),add column editors uuid[] not null default ''{}'',
   add column approved_by uuid,add column approved_at timestamptz',t);
 end loop;
end $$;
create unique index disclosure_project on hub.project_disclosures(project_id);
create unique index sales_terms_project on hub.project_sales_terms(project_id);
create unique index programme_project on hub.project_programmes(project_id,programme_key);
create unique index construction_project on hub.project_progress(project_id,component);
create table hub.project_commercial_versions (
 id uuid primary key default gen_random_uuid(),project_id uuid not null references hub.projects,
 kind text not null check(kind in ('disclosures','sales-terms','programmes','construction')),record_id uuid not null,
 revision integer not null check(revision>0),payload jsonb not null,source_snapshot jsonb not null,editors uuid[] not null,
 state text not null default 'in_review' check(state in ('in_review','approved','returned','withdrawn')),
 approved_by uuid,approved_at timestamptz,unique(kind,record_id,revision)
);
do $$ declare t text;predicate text;begin
 foreach t in array array['project_disclosures','project_sales_terms','project_programmes','project_progress','project_commercial_versions'] loop
  execute format('alter table hub.%I add column created_at timestamptz not null default clock_timestamp(),
   add column created_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid,
   add column updated_at timestamptz not null default clock_timestamp(),
   add column updated_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid',t);
  execute format('alter table hub.%I enable row level security',t);execute format('alter table hub.%I force row level security',t);
  execute format('create policy commercial_owner on hub.%I to %I using(true) with check(true)',t,current_user);
  predicate:=case when t in ('project_disclosures','project_commercial_versions') then '(hub.can(''projects'',''edit'') or hub.can(''projects'',''approve''))' else 'hub.can(''projects'',''view'')' end;
  execute format('create policy commercial_read on hub.%I for select to hub_app using(%s)',t,predicate);
  execute format('grant select on hub.%I to hub_app',t);
  execute format('create trigger commercial_audit after insert or update or delete on hub.%I for each row execute function audit.record_change()',t);
  execute format('create trigger commercial_touch before update on hub.%I for each row execute function hub.touch_record()',t);
 end loop;
end $$;
create trigger commercial_immutable before update or delete on hub.project_commercial_versions for each row execute function hub.unit_version_guard();

-- Explicit output boundary; evidence and Legal reviewer identities never leave Hub.
create function hub.project_commercial_public(payload jsonb) returns jsonb
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select payload-array['legal_document_asset_id','legal_doc_ref','legal_doc_date','legal_reviewed_by','legal_reviewed_at','override_reason']
$$;
create function hub.project_commercial_snapshot(kind text,record_uuid uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare row_data jsonb;begin
 execute format('select to_jsonb(r) from hub.%I r where id=$1',hub.project_commercial_table(kind)) into row_data using record_uuid;
 return (select jsonb_object_agg(k,v) from jsonb_each(row_data) e(k,v) where k=any(hub.project_commercial_fields(kind)||array['public_content_id']));
end $$;
create function hub.project_disclosure_comparison(project_uuid uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('land_area_sqwah',(select value_number from hub.project_facts where project_id=project_uuid and grain='project' and fact_key='project.land_area_sqwah'),
  'unit_total',(select value_number from hub.project_facts where project_id=project_uuid and grain='project' and fact_key='project.unit_total'),
  'building_count',(select nullif(count(*),0) from hub.project_buildings where project_id=project_uuid),
  'building_units',(select case when count(*)>0 and bool_and(unit_count is not null) then sum(unit_count) end from hub.project_buildings where project_id=project_uuid),
  'buildings',(select coalesce(jsonb_agg(jsonb_build_object('name',name,'floors_above',floors_above,'unit_count',unit_count) order by building_key),'[]') from hub.project_buildings where project_id=project_uuid))
$$;
create function hub.project_commercial_readiness(kind text,record_uuid uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare row_data jsonb;body jsonb;comparison jsonb;items jsonb:='[]';key text;f hub.field_catalog;complete boolean;required boolean;
begin
 execute format('select to_jsonb(r) from hub.%I r where id=$1',hub.project_commercial_table(kind)) into row_data using record_uuid;
 if row_data is null then raise exception 'Project record not found' using errcode='P0002';end if;
 body:=hub.project_commercial_snapshot(kind,record_uuid);
 for f in select * from hub.field_catalog where entity=hub.project_commercial_entity(kind) and status='active' and 'en'=any(locales_required) loop
  key:=split_part(f.field_key,'.',2);required:=f.required_for->>'all'='required' or nullif(btrim(body#>>array[key,'th']),'') is not null;
  complete:=not required or hub.translation_complete(hub.project_commercial_entity(kind),record_uuid::text,f.field_key,body->key);
  items:=items||jsonb_build_array(jsonb_build_object('field_key',f.field_key,'label',f.label,'complete',coalesce(complete,false)));
 end loop;
 if kind='disclosures' then
  comparison:=hub.project_disclosure_comparison((row_data->>'project_id')::uuid);
  foreach key in array array['land_area_sqwah','unit_total','building_count'] loop
   complete:=body->>key is not null and comparison->>key is not null and (body->>key)::numeric=(comparison->>key)::numeric;
   if key='unit_total' and comparison->>'building_units' is not null then complete:=complete and (body->>key)::numeric=(comparison->>'building_units')::numeric;end if;
   items:=items||jsonb_build_array(jsonb_build_object('field_key','disclosure.'||key,'label',jsonb_build_object('th',case key when 'land_area_sqwah' then 'พื้นที่ตรงกับข้อเท็จจริง' when 'unit_total' then 'จำนวนยูนิตตรงกับข้อเท็จจริงและอาคาร' else 'จำนวนอาคารตรงกับทะเบียนอาคาร' end),
    'complete',body->>key is not null and (coalesce(complete,false) or nullif(btrim(body->>'override_reason'),'') is not null),'mismatch',not coalesce(complete,false)));
  end loop;
  complete:=body->>'registered_capital' is not null and body->>'paid_capital' is not null and jsonb_array_length(body->'title_deeds')>0 and jsonb_array_length(body->'land_numbers')>0
   and body->>'encumbrance' is not null and (body->>'encumbrance'<>'mortgage' or nullif(btrim(body#>>'{bank,th}'),'') is not null)
   and body->>'eia_status' is not null and (body->>'eia_status'<>'approved' or body->>'eia_approval_date' is not null)
   and body->>'construction_start_year' is not null and body->>'construction_completion_year' is not null;
  items:=items||jsonb_build_array(jsonb_build_object('field_key','disclosure.details','label','{"th":"ข้อมูลตามกฎหมายครบถ้วน"}'::jsonb,'complete',coalesce(complete,false)));
  complete:=body->>'basis'='mkt_entered' or (body->>'legal_document_asset_id' is not null and nullif(btrim(body->>'legal_doc_ref'),'') is not null and body->>'legal_doc_date' is not null);
  if body->>'basis'='legal_approved' then complete:=complete and nullif(btrim(body->>'legal_reviewed_by'),'') is not null and body->>'legal_reviewed_at' is not null;end if;
  if body->>'legal_document_asset_id' is not null then complete:=complete and exists(select 1 from hub.assets where id=(body->>'legal_document_asset_id')::uuid and media_category='legal_document' and deleted_at is null and ai_exposure='internal' and not marketing_publication);end if;
  items:=items||jsonb_build_array(jsonb_build_object('field_key','disclosure.evidence','label','{"th":"หลักฐานและการตรวจด้านกฎหมาย"}'::jsonb,'complete',coalesce(complete,false)));
 elsif kind='sales-terms' then
  complete:=coalesce(body->>'booking_fee',body->>'contract_fee',body->>'down_payment',body->>'installment_from',body->>'interest_rate') is not null
   and (body->>'valid_to')::date>=(current_timestamp at time zone 'Asia/Bangkok')::date
   and (body->>'installment_from' is null or nullif(btrim(body#>>'{installment_basis,th}'),'') is not null)
   and (body->>'interest_rate' is null or (nullif(btrim(body#>>'{rate_period,th}'),'') is not null and nullif(btrim(body#>>'{lender,th}'),'') is not null));
  items:=items||jsonb_build_array(jsonb_build_object('field_key','sales_term.validity','label','{"th":"เงื่อนไขยังมีผลและระบุฐานค่างวด/อัตราดอกเบี้ย"}'::jsonb,'complete',coalesce(complete,false)));
 elsif kind='programmes' then
  complete:=body->>'participating' is not null and (body->>'as_of')::date<=(current_timestamp at time zone 'Asia/Bangkok')::date
   and (body->>'monthly_from' is null or ((body->>'participating')::boolean and nullif(btrim(body#>>'{basis,th}'),'') is not null));
  items:=items||jsonb_build_array(jsonb_build_object('field_key','programme.as_of','label','{"th":"ยืนยันการเข้าร่วมและวันที่ข้อมูล"}'::jsonb,'complete',coalesce(complete,false)));
 else
  items:=items||jsonb_build_array(jsonb_build_object('field_key','construction_progress.as_of','label','{"th":"วันที่ข้อมูลไม่อยู่ในอนาคต"}'::jsonb,'complete',(body->>'as_of')::date<=(current_timestamp at time zone 'Asia/Bangkok')::date));
 end if;
 return jsonb_build_object('items',items,'ready',not exists(select 1 from jsonb_array_elements(items) i where not coalesce((i->>'complete')::boolean,false)));
end $$;

create function hub.save_project_commercial(public_id text,kind text,record_uuid uuid,expected_stamp timestamptz,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;p hub.projects;prior jsonb;key uuid;table_name text;cols text;field text;asset_uuid uuid;
begin
 actor:=hub.require_permission('projects','edit');table_name:=hub.project_commercial_table(kind);
 select * into p from hub.projects where public_project_id=public_id and deleted_at is null for update;
 if not found then raise exception 'Project not found' using errcode='P0002';end if;
 if expected_stamp is distinct from p.updated_at then raise exception 'Project changed' using errcode='40001';end if;
 if jsonb_typeof(body) is distinct from 'object' or exists(select 1 from jsonb_object_keys(body) k where not k=any(hub.project_commercial_fields(kind))) then raise exception 'Invalid project fields' using errcode='23514';end if;
 if record_uuid is not null then
  execute format('select to_jsonb(r) from hub.%I r where id=$1 and project_id=$2 for update',table_name) into prior using record_uuid,p.id;
  if prior is null then raise exception 'Project record not found' using errcode='P0002';end if;
  if prior->>'state'='in_review' then raise exception 'Return the submitted record before editing' using errcode='23514';end if;
 end if;
 foreach field in array array['registered_capital','paid_capital','land_area_sqwah','building_count','unit_total','construction_start_year','construction_completion_year','booking_fee','contract_fee','down_payment','installment_from','interest_rate','monthly_from','percent'] loop
  if body->field is not null and body->field<>'null'::jsonb and jsonb_typeof(body->field)<>'number' then raise exception 'Use finite numbers' using errcode='23514';end if;
 end loop;
 if body?'participating' and jsonb_typeof(body->'participating') not in ('boolean','null') then raise exception 'Use a participation boolean or unknown' using errcode='23514';end if;
 if kind='disclosures' then
  foreach field in array array['title_deeds','land_numbers'] loop
   if body?field and (jsonb_typeof(body->field)<>'array' or jsonb_array_length(body->field)>100) then raise exception 'Invalid land references' using errcode='23514';end if;
   if exists(select 1 from jsonb_array_elements(coalesce(body->field,'[]')) v where jsonb_typeof(v)<>'string') then raise exception 'Land references must preserve text identifiers' using errcode='23514';end if;
  end loop;
  if exists(select 1 from jsonb_array_elements_text(coalesce(body->'title_deeds','[]')||coalesce(body->'land_numbers','[]')) v where nullif(btrim(v),'') is null or length(v)>200) then raise exception 'Invalid land reference' using errcode='23514';end if;
  asset_uuid:=(body->>'legal_document_asset_id')::uuid;
  if asset_uuid is not null then
   perform hub.require_asset_access(asset_uuid);
   perform 1 from hub.assets where id=asset_uuid and media_category='legal_document' and ai_exposure='internal' and not marketing_publication and deleted_at is null for update;
   if not found then raise exception 'Select a private Legal document' using errcode='23514';end if;
  end if;
 end if;
 key:=coalesce(record_uuid,gen_random_uuid());
 select string_agg(format('%I',k),',') into cols from unnest(hub.project_commercial_fields(kind)) k where body?k;
 if cols is null then raise exception 'No project fields' using errcode='23514';end if;
 if prior is null then
  execute format('insert into hub.%I(id,project_id,editors,%s) select $2,$3,array[$4],%s from jsonb_populate_record(null::hub.%I,$1)',table_name,cols,cols,table_name) using body,key,p.id,actor;
 else
  execute format('update hub.%I set (%s)=(select %s from jsonb_populate_record(null::hub.%I,$1)),state=''draft'',revision=revision+1,
   approved_by=null,approved_at=null,editors=array(select distinct e from unnest(editors||array[created_by,$3]) e where e is not null) where id=$2',table_name,cols,cols,table_name) using body,key,actor;
 end if;
 if asset_uuid is not null and not exists(select 1 from hub.asset_links where project_id=p.id and target_type='disclosure' and target_key=key::text and asset_id=asset_uuid and deleted_at is null) then
  perform hub.media_link_save(public_id,gen_random_uuid(),0,jsonb_build_object('asset_id',asset_uuid,'target_type','disclosure','target_key',key,'usage','evidence','ai_exposure','internal'));
 end if;
 update hub.projects set updated_at=clock_timestamp() where id=p.id;
 return jsonb_build_object('id',key,'updated_at',(select updated_at from hub.projects where id=p.id));
end $$;

create function hub.review_project_commercial(public_id text,kind text,record_uuid uuid,expected_stamp timestamptz,decision text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;p hub.projects;r jsonb;v hub.project_commercial_versions;table_name text;new_state text;author_ids uuid[];
begin
 if decision not in ('submit','approve','return','withdraw') then raise exception 'Invalid decision' using errcode='23514';end if;
 actor:=hub.require_permission('projects',case when decision='submit' then 'edit' else 'approve' end);table_name:=hub.project_commercial_table(kind);
 select * into p from hub.projects where public_project_id=public_id and deleted_at is null for update;
 if not found then raise exception 'Project not found' using errcode='P0002';end if;
 if expected_stamp is distinct from p.updated_at then raise exception 'Project changed' using errcode='40001';end if;
 execute format('select to_jsonb(r) from hub.%I r where id=$1 and project_id=$2 for update',table_name) into r using record_uuid,p.id;
 if r is null then raise exception 'Project record not found' using errcode='P0002';end if;
 if decision='submit' then
  if r->>'state'<>'draft' or not(hub.project_commercial_readiness(kind,record_uuid)->>'ready')::boolean then raise exception 'Complete the record and reviewed English before submission' using errcode='23514';end if;
  select array_agg(distinct value::uuid) into author_ids from jsonb_array_elements_text(r->'editors'||jsonb_build_array(actor,r->>'created_by')) where value is not null;
  insert into hub.project_commercial_versions(project_id,kind,record_id,revision,payload,source_snapshot,editors)
   values(p.id,kind,record_uuid,(r->>'revision')::integer,hub.project_commercial_snapshot(kind,record_uuid),
    case when kind='disclosures' then hub.project_disclosure_comparison(p.id) else '{}'::jsonb end,author_ids);
  new_state:='in_review';
 elsif decision in ('approve','return') then
  select * into v from hub.project_commercial_versions x where x.kind=review_project_commercial.kind and record_id=record_uuid and revision=(r->>'revision')::integer for update;
  if r->>'state'<>'in_review' or v.state is distinct from 'in_review' then raise exception 'No submitted revision' using errcode='23514';end if;
  if decision='approve' and actor=any(v.editors) then raise exception 'Another person must approve this revision' using errcode='42501';end if;
  if decision='approve' and not(hub.project_commercial_readiness(kind,record_uuid)->>'ready')::boolean then raise exception 'Record expired or source facts changed' using errcode='23514';end if;
  update hub.project_commercial_versions set state=case when decision='approve' then 'approved' else 'returned' end,
   approved_by=case when decision='approve' then actor end,approved_at=case when decision='approve' then clock_timestamp() end where id=v.id;
  new_state:=case when decision='approve' then 'approved' else 'draft' end;
 else
  if r->>'state'<>'approved' then raise exception 'Only approved records can be withdrawn' using errcode='23514';end if;
  update hub.project_commercial_versions x set state='withdrawn' where x.kind=review_project_commercial.kind and record_id=record_uuid and state='approved';
  new_state:='withdrawn';
 end if;
 execute format('update hub.%I set state=$2,revision=revision+case when $3=''return'' then 1 else 0 end,
  approved_by=case when $2=''approved'' then $4 end,approved_at=case when $2=''approved'' then clock_timestamp() end where id=$1',table_name) using record_uuid,new_state,decision,actor;
 update hub.projects set updated_at=clock_timestamp() where id=p.id;
 return jsonb_build_object('id',record_uuid,'updated_at',(select updated_at from hub.projects where id=p.id));
end $$;

-- Private composition helper for Phase 8: live validity and source checks apply.
create function hub.project_current_commercial(project_uuid uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare kind text;r record;items jsonb:='{}';rows jsonb;begin
 foreach kind in array array['disclosures','sales-terms','programmes','construction'] loop
  rows:='[]';
  for r in execute format('select c.id,c.ai_exposure,v.payload from hub.%I c join hub.project_commercial_versions v on v.record_id=c.id and v.kind=$2 and v.revision=c.revision and v.state=''approved'' where c.project_id=$1 and c.state=''approved'' and c.ai_exposure<>''internal'' order by c.public_content_id',hub.project_commercial_table(kind)) using project_uuid,kind loop
   if (hub.project_commercial_readiness(kind,r.id)->>'ready')::boolean
    and (kind<>'sales-terms' or (r.payload->>'valid_from')::date<=(current_timestamp at time zone 'Asia/Bangkok')::date) then rows:=rows||jsonb_build_array(hub.project_commercial_public(r.payload));end if;
  end loop;
  items:=items||jsonb_build_object(kind,rows);
 end loop;
 return items;
end $$;

create function hub.project_commercial_workspace(public_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
<<workspace>>
declare p hub.projects;kind text;r record;items jsonb:='{}';rows jsonb;history jsonb;private_access boolean;begin
 perform hub.require_permission('projects','view');
 select * into p from hub.projects where public_project_id=public_id and deleted_at is null;
 if not found then raise exception 'Project not found' using errcode='P0002';end if;
 private_access:=hub.can('projects','edit') or hub.can('projects','approve');
 foreach kind in array array['disclosures','sales-terms','programmes','construction'] loop
  rows:='[]';
  for r in execute format('select to_jsonb(c) data from hub.%I c where project_id=$1 order by created_at,id',hub.project_commercial_table(kind)) using p.id loop
   select coalesce(jsonb_agg((to_jsonb(v)-'source_snapshot')||jsonb_build_object('payload',case when private_access then v.payload else hub.project_commercial_public(v.payload) end) order by revision desc),'[]') into history
    from hub.project_commercial_versions v where v.kind=workspace.kind and record_id=(r.data->>'id')::uuid;
   rows:=rows||jsonb_build_array((case when private_access then r.data else hub.project_commercial_public(r.data) end)||jsonb_build_object('readiness',hub.project_commercial_readiness(kind,(r.data->>'id')::uuid),'history',history));
  end loop;
  items:=items||jsonb_build_object(kind,rows);
 end loop;
 return jsonb_build_object('project',jsonb_build_object('public_project_id',p.public_project_id,'public_name',p.public_name,'updated_at',p.updated_at),
  'records',items,'comparison',hub.project_disclosure_comparison(p.id),
  'translations',hub.content_translation_list('projects',public_id),
  'legal_documents',case when private_access then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'filename',a.original_filename)) from hub.assets a where a.media_category='legal_document' and hub.can_read_asset(a.id)),'[]') else '[]'::jsonb end);
end $$;

-- Extend the reviewed target dispatcher without changing existing target guards.
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.media_target(uuid,text,text,text)'::regprocedure);
 d:=replace(d,'-- The owning phases add guarded reference cases;',
  'when ''disclosure'' then return exists(select 1 from hub.project_disclosures where project_id=project_uuid and id::text=key);
  -- The owning phases add guarded reference cases;');execute d;
end $$;

-- Legal/finance English is entered and reviewed manually. No provider jobs.
update hub.field_catalog set status='active',validation=validation||'{"ai_translation":false,"max_length":4000}'::jsonb,
 help=jsonb_build_object('th','ข้อมูลต่อโครงการ / เฟสนี้ ค่าว่างหมายถึงยังไม่ทราบ ต้องส่งตรวจและให้ผู้อนุมัติคนอื่นยืนยันก่อนใช้บนเว็บไซต์')
 where entity in ('disclosure','sales_term','programme','construction_progress');
insert into hub.field_catalog(field_key,entity,section,label,value_kind,source_policy,default_ai_exposure,surfaces,status,help,validation)
 values('disclosure.building_count','disclosure','legal','{"th":"จำนวนอาคารที่ระบุ"}','number','legal','web_only',array['web.disclosure'],'active','{"th":"ตรวจเทียบกับทะเบียนอาคารและรายละเอียดอาคารที่กรอก"}','{"min":0}'),
 ('disclosure.unit_total','disclosure','legal','{"th":"จำนวนยูนิตที่ระบุ"}','number','legal','web_only',array['web.disclosure'],'active','{"th":"ตรวจเทียบกับข้อเท็จจริงและจำนวนยูนิตในอาคาร"}','{"min":0}');
update hub.field_catalog set locales_required=array['th','en'],required_for=jsonb_build_object('all',case when field_key in
 ('disclosure.owner_company','disclosure.owner_address','disclosure.managing_director','disclosure.legal_project_name','disclosure.location_text','disclosure.building_description','sales_term.conditions') then 'required' else 'optional' end)
 where field_key=any(array['disclosure.owner_company','disclosure.owner_address','disclosure.managing_director','disclosure.legal_project_name','disclosure.location_text','disclosure.building_description','disclosure.bank','disclosure.notes',
 'sales_term.installment_basis','sales_term.rate_period','sales_term.lender','sales_term.conditions','programme.basis']);
update hub.field_catalog set source_policy='legal',default_ai_exposure='web_only' where entity='disclosure';
update hub.field_catalog set source_policy='finance',default_ai_exposure='web_only' where entity='sales_term';
update hub.field_catalog set source_policy='rem',default_ai_exposure='internal',surfaces=array['hub_only'],help='{"th":"รอ IT ยืนยันฟิลด์จาก REM ยังไม่มีข้อมูล ห้ามกรอกเอง"}' where field_key='programme.units_offered';
update hub.field_catalog set default_ai_exposure='internal',surfaces=array['hub_only'] where field_key in ('disclosure.legal_document_asset_id','disclosure.legal_doc_ref','disclosure.legal_doc_date','disclosure.legal_reviewed_by','disclosure.legal_reviewed_at','disclosure.override_reason');
update hub.field_catalog set status='active' where field_key='section.investor_intro';

create function hub.track_project_commercial_translation() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare kind text;f hub.field_catalog;value jsonb:=to_jsonb(new);prior jsonb:='{}';scope text;key text;begin
 kind:=case tg_table_name when 'project_disclosures' then 'disclosure' when 'project_sales_terms' then 'sales_term' when 'project_programmes' then 'programme' else 'construction_progress' end;
 if tg_op='UPDATE' then prior:=to_jsonb(old);end if;
 select public_project_id into scope from hub.projects where id=new.project_id;
 for f in select * from hub.field_catalog where entity=kind and 'en'=any(locales_required) loop
  key:=split_part(f.field_key,'.',2);
  if value->key is distinct from prior->key then perform hub.sync_content_translation(kind,new.id::text,f.field_key,'projects',scope,jsonb_build_object('id',new.id,'project_id',new.project_id),value->key);end if;
 end loop;
 return new;
end $$;
do $$ declare t text;d text;begin
 foreach t in array array['project_disclosures','project_sales_terms','project_programmes','project_progress'] loop
  execute format('create trigger commercial_translation after insert or update on hub.%I for each row execute function hub.track_project_commercial_translation()',t);
 end loop;
 d:=pg_get_functiondef('hub.translation_editable(hub.content_translations)'::regprocedure);
 d:=replace(d,'return t.owner_type in',
  'if t.owner_type in (''disclosure'',''sales_term'',''programme'',''construction_progress'') then
   return exists(select 1 from hub.project_disclosures where t.owner_type=''disclosure'' and id=t.owner_key::uuid and state<>''in_review'')
    or exists(select 1 from hub.project_sales_terms where t.owner_type=''sales_term'' and id=t.owner_key::uuid and state<>''in_review'')
    or exists(select 1 from hub.project_programmes where t.owner_type=''programme'' and id=t.owner_key::uuid and state<>''in_review'');end if;
   return t.owner_type in');execute d;
 d:=pg_get_functiondef('hub.review_content_translation(uuid,integer,integer,text)'::regprocedure);
 d:=replace(d,'''commercial_type'',''price'') then','''commercial_type'',''price'',''disclosure'',''sales_term'',''programme'') then');
 d:=replace(d,'else raise exception ''Unsupported translation target''',
  'elsif t.owner_type in (''disclosure'',''sales_term'',''programme'') then
   table_name:=case t.owner_type when ''disclosure'' then ''project_disclosures'' when ''sales_term'' then ''project_sales_terms'' else ''project_programmes'' end;
   if not exists(select 1 from hub.field_catalog where field_key=t.field_key and entity=t.owner_type and ''en''=any(locales_required)) then raise exception ''Invalid project translation'' using errcode=''23514'';end if;
   execute format(''update hub.%I set %I=jsonb_set(%I,''''{en}'''',to_jsonb($1::text),true),state=''''draft'''',revision=revision+1,approved_by=null,approved_at=null,
    editors=array(select distinct e from unnest(editors||array[created_by,$3]) e where e is not null) where id=$2'',table_name,col,col) using english,t.owner_key::uuid,actor;
   update hub.projects set updated_at=clock_timestamp() where id=(t.row_ref->>''project_id'')::uuid;
   else raise exception ''Unsupported translation target''');execute d;
end $$;

do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub' and p.proname=any(array[
  'project_commercial_table','project_commercial_entity','project_commercial_fields','project_commercial_public','project_commercial_snapshot','project_disclosure_comparison',
  'project_commercial_readiness','save_project_commercial','review_project_commercial','project_current_commercial','project_commercial_workspace','track_project_commercial_translation']) loop
  execute format('revoke all on function %s from public',f);
 end loop;
end $$;
grant execute on function hub.save_project_commercial(text,text,uuid,timestamptz,jsonb),hub.review_project_commercial(text,text,uuid,timestamptz,text),hub.project_commercial_workspace(text) to hub_app;
comment on table hub.project_progress is 'C5 construction progress only. Independent from project content-readiness caches.';
comment on column hub.project_programmes.units_offered is 'REM source contract pending IT. Must remain NULL.';
commit;
