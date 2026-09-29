-- Marketing unit types are private content drafts, independent of immutable REM
-- model identities. Shared source references do not allocate units or prices.
begin;

create table hub.commercial_types (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references hub.projects,
  public_commercial_type_id text not null unique default ('ctyp_' || replace(gen_random_uuid()::text,'-','')),
  public_name jsonb not null default '{}' check (jsonb_typeof(public_name)='object'),
  description jsonb not null default '{}' check (jsonb_typeof(description)='object'),
  product_form text check (product_form in ('condominium','house','townhome','other')),
  area_min_sqm numeric check (area_min_sqm>0 and area_min_sqm<'Infinity'::numeric),
  area_max_sqm numeric check (area_max_sqm>0 and area_max_sqm<'Infinity'::numeric),
  bedrooms numeric check (bedrooms>=0 and bedrooms<'Infinity'::numeric),
  bathrooms numeric check (bathrooms>=0 and bathrooms<'Infinity'::numeric),
  kitchens numeric check (kitchens>=0 and kitchens<'Infinity'::numeric),
  storeys integer check (storeys>0), parking_spaces integer check (parking_spaces>=0),
  land_area_sqm numeric check (land_area_sqm>0 and land_area_sqm<'Infinity'::numeric),
  source_notes text not null default '' check (length(source_notes)<=4000),
  status text not null default 'draft' check (status='draft'),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null default nullif(current_setting('app.actor_id',true),'')::uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null default nullif(current_setting('app.actor_id',true),'')::uuid,
  deleted_at timestamptz,
  unique(project_id,id), check (area_min_sqm<=area_max_sqm)
);
create unique index commercial_type_name_per_project on hub.commercial_types(project_id,lower(btrim(public_name->>'th')))
  where deleted_at is null and coalesce(btrim(public_name->>'th'),'')<>'';

create table hub.commercial_type_sources (
  project_id uuid not null, commercial_type_id uuid not null, model_id uuid not null,
  link_kind text not null default 'reference' check (link_kind='reference'),
  classification_status text not null default 'unverified' check (classification_status='unverified'),
  primary key(commercial_type_id,model_id),
  foreign key(project_id,commercial_type_id) references hub.commercial_types(project_id,id),
  foreign key(project_id,model_id) references hub.model_types(project_id,id)
);
create index commercial_source_model_lookup on hub.commercial_type_sources(model_id);

-- Reuse file storage/rights records without placing unreviewed commercial media
-- in entity_assets, which feeds the existing public release contract.
create table hub.commercial_type_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null, commercial_type_id uuid not null,
  asset_id uuid not null references hub.assets,
  asset_role text not null check (asset_role in ('model_image','floor_plan','structural_plan')),
  alt_text jsonb not null check (jsonb_typeof(alt_text)='object'),
  title text not null check (btrim(title)<>'' and length(title)<=300),
  floor_label text not null default '' check(length(floor_label)<=100),
  plan_revision text not null default '' check(length(plan_revision)<=100),
  applicability_model_ids jsonb not null default '[]' check(jsonb_typeof(applicability_model_ids)='array'),
  display_order integer not null check(display_order>=0),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null default nullif(current_setting('app.actor_id',true),'')::uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null default nullif(current_setting('app.actor_id',true),'')::uuid,
  deleted_at timestamptz,
  foreign key(project_id,commercial_type_id) references hub.commercial_types(project_id,id)
);
create unique index commercial_active_asset_binding on hub.commercial_type_assets(commercial_type_id,asset_id,asset_role)
  where deleted_at is null;

do $$ declare table_name text; begin
  foreach table_name in array array['commercial_types','commercial_type_sources','commercial_type_assets'] loop
    execute format('alter table hub.%I enable row level security',table_name);
    execute format('create policy staff_read on hub.%I for select to admin,editor,publisher,viewer using(true)',table_name);
    execute format('create trigger audit_write after insert or update or delete on hub.%I for each row execute function audit.record_change()',table_name);
  end loop;
  foreach table_name in array array['commercial_types','commercial_type_assets'] loop
    execute format('create trigger touch before update on hub.%I for each row execute function hub.touch_record()',table_name);
  end loop;
end $$;
revoke all on hub.commercial_types,hub.commercial_type_sources,hub.commercial_type_assets from public,admin,editor,publisher,viewer,service_consumer;
grant select on hub.commercial_types,hub.commercial_type_sources,hub.commercial_type_assets to admin,editor,publisher,viewer;

create function hub.commercial_text_valid(value jsonb) returns boolean
language sql immutable set search_path=pg_catalog,pg_temp as $$
  select case when jsonb_typeof(value) is distinct from 'object' then false else not exists(
    select 1 from jsonb_each(value) item where item.key!~'^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$'
      or jsonb_typeof(item.value)<>'string' or length(item.value#>>'{}')>20000) end
$$;

create function hub.lock_commercial_project(project_uuid uuid,expected_stamp timestamptz) returns hub.projects
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects;
begin
  perform hub.require_actor(array['editor','publisher']);
  select * into p from hub.projects where id=project_uuid and deleted_at is null for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  if expected_stamp is null or expected_stamp<>p.updated_at then
    raise exception 'Draft changed; reload before saving' using errcode='40001';
  end if;
  return p;
end $$;

create function hub.apply_commercial_changes(project_uuid uuid,type_uuid uuid,changes jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare c hub.commercial_types; edited hub.commercial_types; name text; ids jsonb;
begin
  if jsonb_typeof(changes) is distinct from 'object' or changes='{}'::jsonb or exists(
    select 1 from jsonb_object_keys(changes) k where k not in ('public_name','description','product_form',
      'area_min_sqm','area_max_sqm','bedrooms','bathrooms','kitchens','storeys','parking_spaces','land_area_sqm','source_model_ids','source_notes')) then
    raise exception 'Only commercial draft fields may be changed' using errcode='23514';
  end if;
  foreach name in array array['public_name','description'] loop
    if changes?name and not hub.commercial_text_valid(changes->name) then
      raise exception 'Localized text must contain bounded locale strings' using errcode='23514';
    end if;
  end loop;
  if changes?'public_name' and coalesce(btrim(changes#>>'{public_name,th}'),'')='' then
    raise exception 'Thai marketing name is required' using errcode='23514';
  end if;
  foreach name in array array['area_min_sqm','area_max_sqm','bedrooms','bathrooms','kitchens','storeys','parking_spaces','land_area_sqm'] loop
    if changes?name and jsonb_typeof(changes->name) not in ('number','null') then
      raise exception 'Numeric draft fields require finite numbers or null' using errcode='23514';
    end if;
  end loop;
  if changes?'source_notes' and jsonb_typeof(changes->'source_notes') is distinct from 'string' then
    raise exception 'Source notes must be text' using errcode='23514';
  end if;
  if changes?'product_form' and jsonb_typeof(changes->'product_form') not in ('string','null') then
    raise exception 'Product form must be text or null' using errcode='23514';
  end if;
  select * into c from hub.commercial_types where id=type_uuid and project_id=project_uuid and deleted_at is null for update;
  if not found then raise exception 'Commercial type not found for project' using errcode='P0002'; end if;
  edited:=jsonb_populate_record(c,changes-'source_model_ids');
  update hub.commercial_types set public_name=edited.public_name,description=edited.description,product_form=edited.product_form,
    area_min_sqm=edited.area_min_sqm,area_max_sqm=edited.area_max_sqm,bedrooms=edited.bedrooms,bathrooms=edited.bathrooms,
    kitchens=edited.kitchens,storeys=edited.storeys,parking_spaces=edited.parking_spaces,land_area_sqm=edited.land_area_sqm,
    source_notes=edited.source_notes where id=c.id;
  if changes?'source_model_ids' then
    ids:=changes->'source_model_ids';
    if jsonb_typeof(ids) is distinct from 'array' then raise exception 'Source references must be an array' using errcode='23514'; end if;
    if jsonb_array_length(ids)>200 or exists(select 1 from jsonb_array_elements(ids) v where jsonb_typeof(v)<>'string')
      or (select count(*)<>count(distinct value) from jsonb_array_elements_text(ids)) then
      raise exception 'Source references must be unique bounded strings' using errcode='23514';
    end if;
    if exists(select 1 from jsonb_array_elements_text(ids) ref where not exists(select 1 from hub.model_types m
      where m.project_id=project_uuid and m.public_model_id=ref.value and m.deleted_at is null and m.match_status<>'REJECTED')) then
      raise exception 'Source model not found for project' using errcode='P0002';
    end if;
    if exists(select 1 from hub.commercial_type_assets a,jsonb_array_elements_text(a.applicability_model_ids) ref
      where a.commercial_type_id=c.id and a.deleted_at is null and not ids?ref.value) then
      raise exception 'Remove or rebind affected plans before removing their source references' using errcode='23514';
    end if;
    delete from hub.commercial_type_sources where commercial_type_id=c.id;
    insert into hub.commercial_type_sources(project_id,commercial_type_id,model_id)
      select project_uuid,c.id,m.id from hub.model_types m where m.project_id=project_uuid and ids?m.public_model_id;
  end if;
end $$;

create function hub.commercial_collection_readiness(type_uuid uuid) returns jsonb
language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare c hub.commercial_types; missing jsonb; expected_count integer; present_count integer; issues jsonb;
begin
  select * into c from hub.commercial_types where id=type_uuid and deleted_at is null;
  select count(*),count(*) filter(where present),coalesce(jsonb_agg(jsonb_build_object('field',field,'message',message)) filter(where not present),'[]'::jsonb)
    into expected_count,present_count,missing from (values
      ('public_name',coalesce(btrim(c.public_name->>'th'),'')<>'','ชื่อแบบขายภาษาไทย'),
      ('description',coalesce(btrim(c.description->>'th'),'')<>'','รายละเอียดแบบขายภาษาไทย'),
      ('product_form',c.product_form is not null,'ประเภทที่อยู่อาศัย'),
      ('area',c.area_min_sqm is not null and c.area_max_sqm is not null,'พื้นที่ใช้สอยต่ำสุดและสูงสุด'),
      ('bedrooms',c.bedrooms is not null,'จำนวนห้องนอน'),('bathrooms',c.bathrooms is not null,'จำนวนห้องน้ำ'),
      ('kitchens',c.kitchens is not null,'จำนวนห้องครัว'),
      ('source_model_ids',exists(select 1 from hub.commercial_type_sources s join hub.model_types m on m.id=s.model_id
        where s.commercial_type_id=c.id and m.deleted_at is null and m.match_status<>'REJECTED'),'รหัสแบบ REM ที่เกี่ยวข้อง'),
      ('model_image',exists(select 1 from hub.commercial_type_assets b join hub.assets a on a.id=b.asset_id
        where b.commercial_type_id=c.id and b.asset_role='model_image' and b.deleted_at is null and a.deleted_at is null),'ภาพแบบขาย'),
      ('floor_plan',exists(select 1 from hub.commercial_type_assets b join hub.assets a on a.id=b.asset_id
        where b.commercial_type_id=c.id and b.asset_role='floor_plan' and b.deleted_at is null and a.deleted_at is null),'แปลนแบบขาย')
    ) checks(field,present,message);
  select coalesce(jsonb_agg(jsonb_build_object('field','assets','binding_id',b.id,'message',
    case when a.deleted_at is not null then 'ไฟล์ถูกนำออกจากคลัง'
      when a.rights_status<>'approved' or (a.effective_from is not null and a.effective_from>now())
        or (a.effective_to is not null and a.effective_to<=now()) then 'สิทธิ์สื่อยังไม่พร้อมใช้งาน'
      else 'แปลนยังไม่ระบุฉบับหรือขอบเขตรหัสแบบต้นทาง' end)),'[]'::jsonb) into issues
    from hub.commercial_type_assets b join hub.assets a on a.id=b.asset_id where b.commercial_type_id=c.id and b.deleted_at is null
      and (a.deleted_at is not null or a.rights_status<>'approved' or (a.effective_from is not null and a.effective_from>now())
      or (a.effective_to is not null and a.effective_to<=now()) or
      (b.asset_role in ('floor_plan','structural_plan') and (btrim(b.plan_revision)='' or b.applicability_model_ids='[]'::jsonb)));
  if exists(select 1 from hub.commercial_type_sources s join hub.model_types m on m.id=s.model_id
    where s.commercial_type_id=c.id and (m.deleted_at is not null or m.match_status='REJECTED')) then
    issues:=issues||jsonb_build_array(jsonb_build_object('field','source_model_ids','message','มีรหัสต้นทางที่ถูกนำออกหรือปฏิเสธ ต้องตรวจสอบการอ้างอิง'));
  end if;
  return jsonb_build_object('collection',jsonb_build_object('present',present_count,'expected',expected_count),
    'missing',missing,'review_issues',issues||jsonb_build_array(jsonb_build_object('field','classification','message','การอ้างอิง REM ยังไม่ยืนยันการแบ่งยูนิต')),
    'publication_ready',false,'classification_status','unverified','review_status','not_reviewed');
end $$;

create function hub.commercial_types_payload(project_uuid uuid) returns jsonb
language sql stable set search_path=pg_catalog,pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object(
    'source_model_ids',coalesce((select jsonb_agg(m.public_model_id order by m.rem_model_id)
      from hub.commercial_type_sources s join hub.model_types m on m.id=s.model_id where s.commercial_type_id=c.id),'[]'::jsonb),
    'source_links',coalesce((select jsonb_agg(jsonb_build_object('public_model_id',m.public_model_id,'rem_model_id',m.rem_model_id,
      'model_name_rem',r.model_name_rem,'link_kind',s.link_kind,'classification_status',s.classification_status,
      'source_unavailable',m.deleted_at is not null or m.match_status='REJECTED',
      'shared_reference',exists(select 1 from hub.commercial_type_sources other join hub.commercial_types oc on oc.id=other.commercial_type_id
        where other.model_id=m.id and other.commercial_type_id<>c.id and oc.deleted_at is null)) order by m.rem_model_id)
      from hub.commercial_type_sources s join hub.model_types m on m.id=s.model_id
      join staging.rem_models r on r.rem_project_id=m.rem_project_id and r.rem_model_id=m.rem_model_id where s.commercial_type_id=c.id),'[]'::jsonb),
    'assets',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('binding_id',b.id,'asset_role',b.asset_role,'alt_text',b.alt_text,
      'title',b.title,'floor_label',b.floor_label,'plan_revision',b.plan_revision,'applicability_model_ids',b.applicability_model_ids,
      'display_order',b.display_order,'asset_effective_from',a.effective_from,'asset_effective_to',a.effective_to,
      'publication_eligible',false) order by b.display_order,b.id)
      from hub.commercial_type_assets b join hub.assets a on a.id=b.asset_id where b.commercial_type_id=c.id and b.deleted_at is null),'[]'::jsonb),
    'readiness',hub.commercial_collection_readiness(c.id)) order by c.created_at,c.id),'[]'::jsonb)
  from hub.commercial_types c where c.project_id=project_uuid and c.deleted_at is null
$$;

-- Extend staff detail only. Existing source models, immutable releases and public
-- draft_payload stay intact until commercial content review is implemented.
alter function hub.project_detail(text) rename to project_detail_before_commercial_types;
create function hub.project_detail(public_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare payload jsonb;
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  payload:=hub.project_detail_before_commercial_types(public_id);
  return payload||jsonb_build_object('commercial_types',hub.commercial_types_payload((payload->>'id')::uuid));
end $$;

create function hub.create_commercial_types(project_uuid uuid,items jsonb,expected_stamp timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects; item jsonb; type_uuid uuid;
begin
  p:=hub.lock_commercial_project(project_uuid,expected_stamp);
  if jsonb_typeof(items) is distinct from 'array' then raise exception 'Types must be an array' using errcode='23514'; end if;
  if jsonb_array_length(items) not between 1 and 50 then raise exception 'Create one to fifty types in a set' using errcode='23514'; end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item) is distinct from 'object' or not item?'public_name' then
      raise exception 'Every type requires a marketing name' using errcode='23514';
    end if;
    insert into hub.commercial_types(project_id) values(p.id) returning id into type_uuid;
    perform hub.apply_commercial_changes(p.id,type_uuid,item);
  end loop;
  update hub.projects set updated_at=clock_timestamp() where id=p.id;
  return hub.project_detail(p.public_project_id);
end $$;

create function hub.update_commercial_type(project_uuid uuid,type_public_id text,changes jsonb,expected_stamp timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects; type_uuid uuid;
begin
  p:=hub.lock_commercial_project(project_uuid,expected_stamp);
  select id into type_uuid from hub.commercial_types where project_id=p.id and public_commercial_type_id=type_public_id and deleted_at is null;
  if not found then raise exception 'Commercial type not found for project' using errcode='P0002'; end if;
  perform hub.apply_commercial_changes(p.id,type_uuid,changes);
  update hub.projects set updated_at=clock_timestamp() where id=p.id;
  return hub.project_detail(p.public_project_id);
end $$;

create function hub.bind_commercial_asset(project_uuid uuid,type_public_id text,metadata jsonb,expected_stamp timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects; type_uuid uuid; a hub.assets; refs jsonb; role_name text;
begin
  p:=hub.lock_commercial_project(project_uuid,expected_stamp);
  if jsonb_typeof(metadata) is distinct from 'object' or exists(select 1 from jsonb_object_keys(metadata) k
    where k not in ('asset_id','asset_role','alt_text','title','floor_label','plan_revision','applicability_model_ids')) then
    raise exception 'Invalid media fields' using errcode='23514';
  end if;
  if not hub.commercial_text_valid(metadata->'alt_text') or coalesce(btrim(metadata#>>'{alt_text,th}'),'')=''
    or jsonb_typeof(metadata->'title') is distinct from 'string' or coalesce(btrim(metadata->>'title'),'')='' then
    raise exception 'Media title and Thai alternative text are required' using errcode='23514';
  end if;
  if (metadata?'floor_label' and jsonb_typeof(metadata->'floor_label') is distinct from 'string')
    or (metadata?'plan_revision' and jsonb_typeof(metadata->'plan_revision') is distinct from 'string') then
    raise exception 'Plan labels must be text' using errcode='23514';
  end if;
  select id into type_uuid from hub.commercial_types where project_id=p.id and public_commercial_type_id=type_public_id and deleted_at is null for update;
  if not found then raise exception 'Commercial type not found for project' using errcode='P0002'; end if;
  select * into a from hub.assets where id=(metadata->>'asset_id')::uuid and deleted_at is null;
  if not found then raise exception 'Asset not found' using errcode='P0002'; end if;
  role_name:=metadata->>'asset_role';
  if role_name is null or role_name not in ('model_image','floor_plan','structural_plan')
    or (role_name='model_image' and a.mime_type not like 'image/%')
    or (role_name in ('floor_plan','structural_plan') and a.mime_type not like 'image/%' and a.mime_type<>'application/pdf') then
    raise exception 'Asset type does not match role' using errcode='23514';
  end if;
  refs:=coalesce(metadata->'applicability_model_ids','[]'::jsonb);
  if jsonb_typeof(refs) is distinct from 'array' then raise exception 'Applicability references must be an array' using errcode='23514'; end if;
  if jsonb_array_length(refs)>200 or (select count(*)<>count(distinct value) from jsonb_array_elements(refs))
    or exists(select 1 from jsonb_array_elements(refs) v where jsonb_typeof(v)<>'string') then
    raise exception 'Applicability references must be unique strings' using errcode='23514';
  end if;
  if exists(select 1 from jsonb_array_elements_text(refs) ref where not exists(select 1 from hub.commercial_type_sources s
    join hub.model_types m on m.id=s.model_id where s.commercial_type_id=type_uuid and m.public_model_id=ref.value
      and m.deleted_at is null and m.match_status<>'REJECTED')) then
    raise exception 'Plan reference must belong to this commercial type' using errcode='23514';
  end if;
  insert into hub.commercial_type_assets(project_id,commercial_type_id,asset_id,asset_role,alt_text,title,floor_label,plan_revision,applicability_model_ids,display_order)
    select p.id,type_uuid,a.id,role_name,metadata->'alt_text',metadata->>'title',coalesce(metadata->>'floor_label',''),
      coalesce(metadata->>'plan_revision',''),refs,coalesce(max(display_order),-1)+1
      from hub.commercial_type_assets where commercial_type_id=type_uuid and deleted_at is null;
  update hub.projects set updated_at=clock_timestamp() where id=p.id;
  return hub.project_detail(p.public_project_id);
end $$;

create function hub.unbind_commercial_asset(project_uuid uuid,type_public_id text,binding_uuid uuid,expected_stamp timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects; type_uuid uuid;
begin
  p:=hub.lock_commercial_project(project_uuid,expected_stamp);
  select id into type_uuid from hub.commercial_types where project_id=p.id and public_commercial_type_id=type_public_id and deleted_at is null for update;
  if not found then raise exception 'Commercial type not found for project' using errcode='P0002'; end if;
  update hub.commercial_type_assets set deleted_at=clock_timestamp()
    where id=binding_uuid and project_id=p.id and commercial_type_id=type_uuid and deleted_at is null;
  if not found then raise exception 'Binding not found for commercial type' using errcode='P0002'; end if;
  update hub.projects set updated_at=clock_timestamp() where id=p.id;
  return hub.project_detail(p.public_project_id);
end $$;

revoke all on function hub.commercial_text_valid(jsonb),hub.lock_commercial_project(uuid,timestamptz),
  hub.apply_commercial_changes(uuid,uuid,jsonb),hub.commercial_collection_readiness(uuid),hub.commercial_types_payload(uuid),
  hub.project_detail_before_commercial_types(text),hub.project_detail(text),hub.create_commercial_types(uuid,jsonb,timestamptz),
  hub.update_commercial_type(uuid,text,jsonb,timestamptz),hub.bind_commercial_asset(uuid,text,jsonb,timestamptz),
  hub.unbind_commercial_asset(uuid,text,uuid,timestamptz) from public,admin,editor,publisher,viewer,service_consumer;
grant execute on function hub.project_detail(text) to admin,editor,publisher,viewer;
grant execute on function hub.create_commercial_types(uuid,jsonb,timestamptz),hub.update_commercial_type(uuid,text,jsonb,timestamptz),
  hub.bind_commercial_asset(uuid,text,jsonb,timestamptz),hub.unbind_commercial_asset(uuid,text,uuid,timestamptz) to admin,editor,publisher;
commit;
