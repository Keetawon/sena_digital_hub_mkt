-- Phase 5: retained commercial identities, frozen review versions and private
-- REM comparisons. Existing website releases are deliberately untouched.
begin;

alter table hub.commercial_types drop constraint commercial_types_status_check;
alter table hub.commercial_types
 add constraint commercial_types_status_check check(status in ('draft','in_review','approved','withdrawn')),
 add column category text check(category in ('studio','1br','1br_plus','2br','3br','duplex','single_house','twin_house','townhome','shophouse')),
 add column special_rooms text[] not null default '{}' check(special_rooms <@ array['maid_room','multipurpose','family_area','double_living','walk_in_closet']::text[] and cardinality(special_rooms)<=5),
 add column ceiling_height_m numeric check(ceiling_height_m>0 and ceiling_height_m<=30),
 add column furniture_package text check(furniture_package in ('full','partial','none')),
 add column highlights jsonb not null default '{}' check(hub.commercial_text_valid(highlights)),
 add column price_mode text not null default 'hidden' check(price_mode in ('manual','hidden','rem_auto')),
 add constraint commercial_rem_auto_disabled check(price_mode<>'rem_auto'),
 add column ai_exposure text not null default 'open' check(ai_exposure in ('open','web_only','internal')),
 add column revision integer not null default 1,
 add column editors uuid[] not null default '{}',
 add column approved_by uuid,
 add column approved_at timestamptz;
alter table hub.commercial_type_assets
 add column room_tag text references hub.media_tags(code),
 add column caption jsonb not null default '{}' check(hub.commercial_text_valid(caption)),
 add column floor_number integer check(floor_number between 1 and 200);

create table hub.commercial_type_versions (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references hub.projects,
 commercial_type_id uuid not null,
 revision integer not null check(revision>0),
 payload jsonb not null,
 source_snapshot jsonb not null,
 editors uuid[] not null,
 state text not null default 'in_review' check(state in ('in_review','approved','returned','withdrawn')),
 approved_by uuid, approved_at timestamptz,
 foreign key(project_id,commercial_type_id) references hub.commercial_types(project_id,id),
 unique(commercial_type_id,revision)
);

create function hub.unit_version_guard() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'Review history is immutable' using errcode='23514'; end if;
 if (to_jsonb(new)-array['state','approved_by','approved_at','updated_at','updated_by'])
  is distinct from (to_jsonb(old)-array['state','approved_by','approved_at','updated_at','updated_by']) then
  raise exception 'Submitted payload is immutable' using errcode='23514';
 end if;
 return new;
end $$;

create function hub.unit_type_changed(type_uuid uuid) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare c hub.commercial_types; actor uuid:=hub.permission_actor(); begin
 select * into c from hub.commercial_types where id=type_uuid for update;
 if c.status='in_review' then raise exception 'Return the submitted type before editing' using errcode='23514'; end if;
 update hub.commercial_types set status='draft',revision=revision+1,approved_by=null,approved_at=null,
  editors=array(select distinct e from unnest(c.editors||case when cardinality(c.editors)=0 then array[c.created_by,c.updated_by] else '{}'::uuid[] end||array[actor]) e where e is not null)
 where id=type_uuid;
end $$;

create function hub.unit_type_content_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if tg_op='INSERT' then
  new.editors:=array(select e from unnest(array[new.created_by,hub.permission_actor()]) e where e is not null);
 elsif (to_jsonb(new)-array['status','revision','editors','approved_by','approved_at','updated_at','updated_by'])
  is distinct from (to_jsonb(old)-array['status','revision','editors','approved_by','approved_at','updated_at','updated_by']) then
  if old.status='in_review' then raise exception 'Return the submitted type before editing' using errcode='23514'; end if;
  new.status:='draft';new.revision:=old.revision+1;new.approved_by:=null;new.approved_at:=null;
  new.editors:=array(select distinct e from unnest(old.editors||case when cardinality(old.editors)=0 then array[old.created_by,old.updated_by] else '{}'::uuid[] end||array[hub.permission_actor()]) e where e is not null);
 end if;
 return new;
end $$;
create trigger unit_type_content before insert or update on hub.commercial_types for each row execute function hub.unit_type_content_guard();

create function hub.unit_type_asset_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if new.deleted_at is null and new.room_tag is not null and not exists(select 1 from hub.media_tags where code=new.room_tag and tag_group='room' and status='active') then
  raise exception 'Choose an active room tag' using errcode='23514'; end if;
 if new.deleted_at is null and new.floor_number is not null and not exists(select 1 from hub.commercial_types where id=new.commercial_type_id and storeys>=new.floor_number) then
  raise exception 'Plan floor is outside this type' using errcode='23514'; end if;
 perform hub.unit_type_changed(new.commercial_type_id);
 return new;
end $$;
create trigger unit_type_asset before insert or update on hub.commercial_type_assets for each row execute function hub.unit_type_asset_guard();

-- Extend the existing bounded mutators, retaining their asset/scope guards.
do $$ declare definition text; before_definition text; begin
 definition:=pg_get_functiondef('hub.apply_commercial_changes(uuid,uuid,jsonb)'::regprocedure);before_definition:=definition;
 definition:=replace(definition,'''source_model_ids'',''source_notes''',
  '''source_model_ids'',''source_notes'',''category'',''special_rooms'',''ceiling_height_m'',''furniture_package'',''highlights'',''price_mode'',''ai_exposure''');
 definition:=replace(definition,'array[''public_name'',''description'']','array[''public_name'',''description'',''highlights'']');
 definition:=replace(definition,'edited:=jsonb_populate_record(c,changes-''source_model_ids'');',
  'edited:=jsonb_populate_record(c,changes-''source_model_ids'');
   if exists(select 1 from hub.commercial_type_assets where commercial_type_id=c.id and deleted_at is null and floor_number is not null and (edited.storeys is null or floor_number>edited.storeys))
    or exists(select 1 from hub.asset_links where project_id=c.project_id and target_type=''commercial_type'' and target_key=c.id::text and deleted_at is null and floor_from is not null
     and (edited.storeys is null or coalesce(floor_to,floor_from)>edited.storeys)) then raise exception ''Remove affected plans before reducing storeys'' using errcode=''23514'';end if;');
 definition:=replace(definition,'source_notes=edited.source_notes where id=c.id;',
  'source_notes=edited.source_notes,category=edited.category,special_rooms=edited.special_rooms,ceiling_height_m=edited.ceiling_height_m,
   furniture_package=edited.furniture_package,highlights=edited.highlights,price_mode=edited.price_mode,ai_exposure=edited.ai_exposure where id=c.id;');
 -- A mapping-only change still creates a new content revision.
 definition:=replace(definition,'ids:=changes->''source_model_ids'';', 'perform hub.unit_type_changed(c.id); ids:=changes->''source_model_ids'';');
 if definition=before_definition then raise exception 'Commercial mutator extension did not apply'; end if;execute definition;
 definition:=pg_get_functiondef('hub.bind_commercial_asset(uuid,text,jsonb,timestamptz)'::regprocedure);before_definition:=definition;
 definition:=replace(definition,'''plan_revision'',''applicability_model_ids''', '''plan_revision'',''applicability_model_ids'',''room_tag'',''caption'',''floor_number''');
 definition:=replace(definition,'applicability_model_ids,display_order)', 'applicability_model_ids,display_order,room_tag,caption,floor_number)');
 definition:=replace(definition,'refs,coalesce(max(display_order),-1)+1', 'refs,coalesce(max(display_order),-1)+1,metadata->>''room_tag'',coalesce(metadata->''caption'',''{}''),(metadata->>''floor_number'')::integer');
 if definition=before_definition then raise exception 'Commercial binding extension did not apply'; end if;execute definition;
 definition:=pg_get_functiondef('hub.commercial_types_payload(uuid)'::regprocedure);
 definition:=replace(definition,'''title'',b.title,', '''room_tag'',b.room_tag,''caption'',b.caption,''floor_number'',b.floor_number,''title'',b.title,');execute definition;
 definition:=pg_get_functiondef('hub.media_checklist(text)'::regprocedure);
 definition:=replace(definition,'''commercial_type'',commercial_type_id::text,asset_role,null,null,null,null,null from hub.commercial_type_assets',
  '''commercial_type'',commercial_type_id::text,case asset_role when ''floor_plan'' then ''unit_plan'' when ''model_image'' then ''interior'' else asset_role end,floor_number,floor_number,null,null,room_tag from hub.commercial_type_assets');execute definition;
 -- Serialize editorial tour/target changes with the type's snapshot transaction.
 definition:=pg_get_functiondef('hub.media_clip_save(text,uuid,integer,jsonb)'::regprocedure);
 definition:=replace(definition,'project_uuid:=hub.media_project(public_id,''edit'');',
  'project_uuid:=hub.media_project(public_id,''edit'');perform 1 from hub.projects where id=project_uuid for update;');execute definition;
 -- Serialize editorial tour/target changes with the type's snapshot transaction.
 definition:=pg_get_functiondef('hub.media_clip_save(text,uuid,integer,jsonb)'::regprocedure);
 definition:=replace(definition,'project_uuid:=hub.media_project(public_id,''edit'');',
  'project_uuid:=hub.media_project(public_id,''edit'');perform 1 from hub.projects where id=project_uuid for update;');execute definition;
end $$;

create function hub.unit_source_comparison(project_uuid uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 with p as (select * from hub.projects where id=project_uuid and deleted_at is null),
 latest_groups as (select distinct on(e.source_id) e.source_id,e.record,e.outcome,e.recorded_at from staging.project_intake_evidence e,p
  where e.rem_project_id=p.rem_project_id and e.kind='gold_models' order by e.source_id,e.id desc),
 groups as (
  select source_id,record,recorded_at as as_of,outcome from latest_groups
  union all select g->>'project_model_key',g,d.source_snapshot_at,'baseline' from p join staging.dw_projects d using(rem_project_id),jsonb_array_elements(d.model_groups) g
   where not exists(select 1 from latest_groups e where e.source_id=g->>'project_model_key')
 ), models as (
  select m.public_model_id,m.rem_model_id,r.model_name_rem,m.match_status,
   case when e.id is not null then e.record else r.source_record end as raw,
   coalesce(e.recorded_at,r.source_snapshot_at) as as_of,
   m.deleted_at is not null or m.match_status='REJECTED' or coalesce(e.outcome in ('missing','deleted'),false) as unavailable
  from p join hub.model_types m on m.project_id=p.id join staging.rem_models r on r.rem_project_id=m.rem_project_id and r.rem_model_id=m.rem_model_id
  left join lateral(select id,record,recorded_at,outcome from staging.project_intake_evidence where kind='models' and rem_project_id=m.rem_project_id and source_id=m.rem_model_id order by id desc limit 1) e on true
 )
 select jsonb_build_object('models',coalesce((select jsonb_agg(jsonb_build_object('public_model_id',m.public_model_id,'rem_model_id',m.rem_model_id,
  'name',m.model_name_rem,'area_raw',coalesce(m.raw->'ModelArea',m.raw->'model_area'),'as_of',m.as_of,'unavailable',m.unavailable) order by m.rem_model_id) from models m),'[]'),
 'groups',coalesce((select jsonb_agg(jsonb_build_object('group_key',g.source_id,'name',g.record->'model_name','model_ids',g.record->'model_ids',
  'public_model_ids',(select coalesce(jsonb_agg(m.public_model_id order by m.rem_model_id),'[]') from models m where g.record->'model_ids'?m.rem_model_id),
  'area_min',hub.content_number(g.record->>'minimum_model_area'),'area_max',hub.content_number(g.record->>'maximum_model_area'),
  'total_unit_count',hub.content_number(g.record->>'total_unit_count'),'available_unit_count',hub.content_number(g.record->>'available_unit_count'),
  'rem_min_available',hub.content_number(g.record->>'minimum_available_selling_price'),'as_of',coalesce(g.record->>'source_snapshot_at',g.as_of::text),
  'unavailable',g.outcome in ('missing','deleted'), 'grain','dw_model_group') order by g.source_id) from groups g),'[]'),
 'allocation_verified',false,'availability_handoff','กรุณาสอบถามฝ่ายขายเรื่องห้องหรือบ้านว่าง','rem_auto_enabled',false)
$$;

create function hub.unit_type_readiness(type_uuid uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare c hub.commercial_types; f hub.field_catalog; value jsonb; complete boolean; items jsonb:='[]'; begin
 select * into c from hub.commercial_types where id=type_uuid and deleted_at is null;
 if not found then raise exception 'Unit type not found' using errcode='P0002'; end if;
 for f in select * from hub.field_catalog where entity='commercial_type' and status='active' and field_key not in ('commercial_type.room_tag','commercial_type.caption') order by sort,field_key loop
  value:=to_jsonb(c)->split_part(f.field_key,'.',2);
  complete:=value is not null and value<>'null'::jsonb and value not in ('{}'::jsonb,'[]'::jsonb,'""'::jsonb);
  if 'en'=any(f.locales_required) then complete:=hub.translation_complete('commercial_type',c.id::text,f.field_key,value); end if;
  items:=items||jsonb_build_array(jsonb_build_object('field_key',f.field_key,'label',f.label,'required',coalesce(f.required_for->>c.product_form,f.required_for->>'all','optional')='required','complete',coalesce(complete,false)));
 end loop;
 return jsonb_build_object('items',items,'ready',not exists(select 1 from jsonb_array_elements(items) i where (i->>'required')::boolean and not(i->>'complete')::boolean),
  'recommended',hub.commercial_collection_readiness(c.id)->'missing','media_blocks_publish',false);
end $$;

create function hub.unit_type_snapshot(type_uuid uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('public_commercial_type_id',c.public_commercial_type_id,'public_name',c.public_name,'description',c.description,
  'product_form',c.product_form,'category',c.category,'area_min_sqm',c.area_min_sqm,'area_max_sqm',c.area_max_sqm,
  'bedrooms',c.bedrooms,'bathrooms',c.bathrooms,'kitchens',c.kitchens,'storeys',c.storeys,'parking_spaces',c.parking_spaces,'land_area_sqm',c.land_area_sqm,
  'special_rooms',c.special_rooms,'ceiling_height_m',c.ceiling_height_m,'furniture_package',c.furniture_package,'highlights',c.highlights,
  'price_mode',c.price_mode,'ai_exposure',c.ai_exposure,
  'assets',coalesce((select jsonb_agg(hub.public_content_payload('asset',to_jsonb(a)||jsonb_build_object('asset_role',b.asset_role,'alt_text',b.alt_text))||
   jsonb_build_object('caption',b.caption,'room_tag',b.room_tag,'floor_label',b.floor_label,'floor_number',b.floor_number,'ai_exposure',a.ai_exposure) order by b.display_order,b.id)
   from hub.commercial_type_assets b join hub.assets a on a.id=b.asset_id where b.commercial_type_id=c.id and b.deleted_at is null and a.deleted_at is null
    and b.asset_role<>'structural_plan' and a.media_category is distinct from 'legal_document' and a.ai_exposure<>'internal' and a.rights_status='approved'
    and a.marketing_publication and a.metadata_state='confirmed'
    and (a.effective_from is null or a.effective_from<=current_timestamp) and (a.effective_to is null or a.effective_to>current_timestamp)),'[]'),
  'tours',coalesce((select jsonb_agg(jsonb_build_object('url',l.url,'embed_url',l.embed_url,'title',l.title,'description',l.description,
   'provider',l.provider,'kind',l.kind,'ai_exposure',l.ai_exposure) order by l.sort,l.id) from hub.media_links l join hub.media_link_targets t on t.media_link_id=l.id
   where t.target_type='commercial_type' and t.target_key=c.id::text and l.project_id=c.project_id and l.state<>'WITHDRAWN' and l.link_status='ok' and l.ai_exposure<>'internal'),'[]'))
 from hub.commercial_types c where c.id=type_uuid and c.deleted_at is null
$$;

create index unit_clip_editor_lookup on audit.change_log((after_row->>'id')) where table_name='hub.media_links' and actor is not null;

create function hub.unit_type_review(public_id text,type_public_id text,expected_stamp timestamptz,decision text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid; p hub.projects;c hub.commercial_types;v hub.commercial_type_versions;authors uuid[];begin
 if decision not in ('submit','approve','return','withdraw') then raise exception 'Invalid type decision' using errcode='23514';end if;
 actor:=hub.require_permission('projects',case when decision='submit' then 'edit' else 'approve' end);
 select * into p from hub.projects where public_project_id=public_id and deleted_at is null for update;
 if not found then raise exception 'Project not found' using errcode='P0002';end if;
 if expected_stamp is distinct from p.updated_at then raise exception 'Project changed' using errcode='40001';end if;
 select * into c from hub.commercial_types where project_id=p.id and public_commercial_type_id=type_public_id and deleted_at is null for update;
 if not found then raise exception 'Unit type not found' using errcode='P0002';end if;
 if decision='submit' then
  if c.status<>'draft' or not(hub.unit_type_readiness(c.id)->>'ready')::boolean then raise exception 'Complete required type fields and reviewed English before submission' using errcode='23514';end if;
  authors:=c.editors||case when cardinality(c.editors)=0 then array[c.created_by,c.updated_by] else '{}'::uuid[] end||array[actor];
  -- A reused tour can contain text written before it was linked to this type.
  -- Include its editorial authors; automatic status checks do not author text.
  authors:=authors||array(select distinct a.actor from audit.change_log a join hub.media_link_targets t on t.media_link_id::text=a.after_row->>'id'
   where a.table_name='hub.media_links' and a.actor is not null and t.target_type='commercial_type' and t.target_key=c.id::text
    and exists(select 1 from unnest(array['title','description','url','provider','kind','ai_exposure']) k
     where a.after_row->k is distinct from a.before_row->k));
  insert into hub.commercial_type_versions(project_id,commercial_type_id,revision,payload,source_snapshot,editors)
   values(p.id,c.id,c.revision,hub.unit_type_snapshot(c.id),jsonb_build_object('comparison',hub.unit_source_comparison(p.id),'source_model_ids',
    (select source_model_ids from jsonb_to_recordset(hub.commercial_types_payload(p.id)) as x(id uuid,source_model_ids jsonb) where id=c.id)),
    array(select distinct e from unnest(authors) e where e is not null));
  update hub.commercial_types set status='in_review' where id=c.id;
 elsif decision in ('approve','return') then
  select * into v from hub.commercial_type_versions where commercial_type_id=c.id and revision=c.revision for update;
  if c.status<>'in_review' or v.state<>'in_review' or v.id is null then raise exception 'No submitted type revision' using errcode='23514';end if;
  if decision='approve' and actor=any(v.editors) then raise exception 'Another person must approve this revision' using errcode='42501';end if;
  if decision='approve' and not(hub.unit_type_readiness(c.id)->>'ready')::boolean then raise exception 'Required fields changed; return for editing' using errcode='23514';end if;
  update hub.commercial_type_versions set state=case when decision='approve' then 'approved' else 'returned' end,
   approved_by=case when decision='approve' then actor end,approved_at=case when decision='approve' then clock_timestamp() end where id=v.id;
  update hub.commercial_types set status=case when decision='approve' then 'approved' else 'draft' end,
   revision=revision+case when decision='return' then 1 else 0 end,approved_by=case when decision='approve' then actor end,
   approved_at=case when decision='approve' then clock_timestamp() end where id=c.id;
 else
  if c.status<>'approved' then raise exception 'Only approved types can be withdrawn' using errcode='23514';end if;
  update hub.commercial_type_versions set state='withdrawn' where commercial_type_id=c.id and state='approved';
  update hub.commercial_types set status='withdrawn',approved_by=null,approved_at=null where id=c.id;
 end if;
 update hub.projects set updated_at=clock_timestamp() where id=p.id;
 return hub.project_detail(public_id);
end $$;

-- Required text uses the same translation review workflow as project content.
update hub.field_catalog set status='active',help=jsonb_build_object('th','ข้อมูลแบบห้องหรือแบบบ้านของ Marketing ผ่านผู้ตรวจคนละคนก่อนนำไปจัดหน้าเว็บไซต์'),
 required_for=jsonb_build_object('all',case when field_key in ('commercial_type.public_name','commercial_type.description','commercial_type.category','commercial_type.product_form') then 'required' else 'recommended' end),
 locales_required=case when field_key in ('commercial_type.public_name','commercial_type.description','commercial_type.highlights','commercial_type.caption') then array['th','en'] else array[]::text[] end,
 validation=validation||jsonb_build_object('ai_translation',field_key in ('commercial_type.public_name','commercial_type.description','commercial_type.highlights')),
 surfaces=array['web.unit_type'],default_ai_exposure='open'
 where entity='commercial_type';

-- Keep prior dispatch branches byte-for-byte; append only this new owner kind.
do $$ declare d text;begin
 d:=pg_get_functiondef('hub.translation_allowed(text)'::regprocedure);
 d:=replace(d,'''question.alt_questions'']','''question.alt_questions'',''commercial_type.public_name'',''commercial_type.description'',''commercial_type.highlights'']');execute d;
 d:=pg_get_functiondef('hub.translation_source_allowed(text,text)'::regprocedure);
 d:=replace(d,'''selling_point'',''building'')','''selling_point'',''building'',''commercial_type'')');execute d;
 d:=pg_get_functiondef('hub.track_content_translation()'::regprocedure);
 d:=replace(d,'else raise exception ''Unsupported translation source''',
  'elsif tg_table_name=''commercial_types'' then kind:=''commercial_type'';owner:=data->>''id'';tab:=''projects'';
   select public_project_id into scope from hub.projects where id=(data->>''project_id'')::uuid;
   keys:=array[''public_name'',''description'',''highlights''];ref:=jsonb_build_object(''id'',owner,''project_id'',data->''project_id'');
   else raise exception ''Unsupported translation source''');
 d:=replace(d,'if tg_op=''UPDATE'' and data->column_name is not distinct from previous->column_name then continue; end if;',
  'if tg_op=''UPDATE'' and data->column_name is not distinct from previous->column_name
    and (kind<>''commercial_type'' or exists(select 1 from hub.content_translations where owner_type=kind and owner_key=owner and field_key=kind||''.''||key)) then continue; end if;');execute d;
 d:=pg_get_functiondef('hub.translation_editable(hub.content_translations)'::regprocedure);
 d:=replace(d,'return t.owner_type in', 'if t.owner_type=''commercial_type'' then return exists(select 1 from hub.commercial_types where id=t.owner_key::uuid and deleted_at is null and status<>''in_review'');end if; return t.owner_type in');execute d;
 d:=pg_get_functiondef('hub.review_content_translation(uuid,integer,integer,text)'::regprocedure);
 d:=replace(d,'''facility'',''building'',''selling_point'') then','''facility'',''building'',''selling_point'',''commercial_type'') then');
 d:=replace(d,'else raise exception ''Unsupported translation target''',
  'elsif t.owner_type=''commercial_type'' then
   if col not in (''public_name'',''description'',''highlights'') then raise exception ''Invalid type text'' using errcode=''23514'';end if;
   execute format(''update hub.commercial_types set %I=jsonb_set(%I,''''{en}'''',to_jsonb($1::text),true) where id=$2'',col,col) using english,t.owner_key::uuid;
   update hub.projects set updated_at=clock_timestamp() where id=(t.row_ref->>''project_id'')::uuid;
   else raise exception ''Unsupported translation target''');execute d;
end $$;
create trigger content_translation after insert or update on hub.commercial_types for each row execute function hub.track_content_translation();

do $$ declare name text;begin
 foreach name in array array['commercial_type_versions'] loop
  execute format('alter table hub.%I add column created_at timestamptz not null default clock_timestamp(),add column created_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid,
   add column updated_at timestamptz not null default clock_timestamp(),add column updated_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid',name);
  execute format('alter table hub.%I enable row level security',name);execute format('alter table hub.%I force row level security',name);
  execute format('create policy unit_owner on hub.%I to %I using(true) with check(true)',name,current_user);
  execute format('create policy unit_read on hub.%I for select to hub_app using(hub.can(''projects'',''view''))',name);
  execute format('grant select on hub.%I to hub_app',name);
  execute format('create trigger unit_audit after insert or update or delete on hub.%I for each row execute function audit.record_change()',name);
  execute format('create trigger unit_touch before update on hub.%I for each row execute function hub.touch_record()',name);
  execute format('create trigger unit_immutable before update or delete on hub.%I for each row execute function hub.unit_version_guard()',name);
 end loop;
end $$;
revoke all on function hub.unit_version_guard(),hub.unit_type_changed(uuid),hub.unit_type_content_guard(),hub.unit_type_asset_guard(),
 hub.unit_source_comparison(uuid),hub.unit_type_readiness(uuid),hub.unit_type_snapshot(uuid),hub.unit_type_review(text,text,timestamptz,text) from public;
grant execute on function hub.unit_type_review(text,text,timestamptz,text) to hub_app;
commit;
