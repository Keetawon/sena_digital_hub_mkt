-- Phase 7 project commands and controlled references.
begin;

create function hub.c4_check_changes(body jsonb,allowed text[]) returns void
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
begin
 if jsonb_typeof(body) is distinct from 'object' or octet_length(body::text)>64000
  or exists(select 1 from jsonb_object_keys(body) k where not k=any(allowed)) then
  raise exception 'Invalid facility, feature or place fields' using errcode='23514';end if;
end $$;

create function hub.c4_project_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare defs jsonb;begin
 if tg_op='UPDATE' then
  if new.project_id<>old.project_id then raise exception 'Project identity is immutable' using errcode='23514';end if;
  new.revision:=old.revision+1;
 end if;
 if tg_table_name='project_facilities' then
  if exists(select 1 from unnest(new.applies_to_project_ids) k where not exists(select 1 from staging.rem_projects where rem_project_id=k))
   or cardinality(new.applies_to_project_ids)>200 or array_position(new.applies_to_project_ids,null) is not null then
   raise exception 'Select existing REM phases' using errcode='23514';end if;
 elsif tg_table_name='project_features' then
  select metric_defs into defs from hub.feature_catalog where code=new.feature_code and (active or exists(
   select 1 from hub.project_features where id=new.id and project_id=new.project_id and feature_code=new.feature_code)) for share;
  if defs is null or not (new.status in ('absent','unknown') and new.metrics='{}') and not hub.c4_metrics_valid(defs,new.metrics) then raise exception 'Metrics do not match the feature definition' using errcode='23514';end if;
  if new.commercial_type_id is not null and not exists(select 1 from hub.commercial_types where id=new.commercial_type_id and project_id=new.project_id and deleted_at is null) then
   raise exception 'Unit type belongs to another project' using errcode='23514';end if;
 elsif tg_table_name='project_places' then
  if new.as_of>current_date then raise exception 'Source date cannot be in the future' using errcode='23514';end if;
  if new.ref_id is not null and not(case new.category
   when 'rail' then exists(select 1 from hub.ref_rail_stations where code=new.ref_id)
   when 'expressway' then exists(select 1 from hub.ref_expressway_ramps where code=new.ref_id)
   else false end) then raise exception 'Place reference does not match the category' using errcode='23514';end if;
 elsif tg_table_name='solar_estimates' then
  if new.as_of>current_date then raise exception 'Source date cannot be in the future' using errcode='23514';end if;
  if tg_op='UPDATE' and old.state<>'draft' and
   (to_jsonb(new)-array['state','revision','updated_at','updated_by']) is distinct from
   (to_jsonb(old)-array['state','revision','updated_at','updated_by']) then
   raise exception 'Approved scenarios are immutable; create a new scenario' using errcode='23514';end if;
  if tg_op='INSERT' or new.state='draft' then
   new.editors:=array(select distinct x from unnest(new.editors||array[hub.permission_actor()]) x where x is not null);
   new.approved_at:=null;new.approved_by:=null;
  end if;
 end if;
 update hub.projects set updated_at=clock_timestamp() where id=new.project_id;
 return new;
end $$;
do $$ declare name text;begin
 foreach name in array array['project_facilities','project_features','solar_estimates','project_places'] loop
  execute format('create trigger c4_guard before insert or update on hub.%I for each row execute function hub.c4_project_guard()',name);
 end loop;
end $$;

create function hub.c4_facility_save(public_id text,code text,expected integer,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p uuid; f hub.project_facilities; edited hub.project_facilities;begin
 p:=hub.media_project(public_id,'edit');perform 1 from hub.projects where id=p for update;
 perform hub.c4_check_changes(body,array['status','description','location_note','access_note','evidence_note','expected_open_date',
  'display_name','location_label','size_sqm','opening_hours','applies_to_project_ids','ai_exposure']);
 select * into f from hub.project_facilities where project_id=p and facility_code=code for update;
 if coalesce(f.revision,0) is distinct from expected then raise exception 'Facility changed' using errcode='40001';end if;
 if not exists(select 1 from hub.facility_taxonomy t where t.code=c4_facility_save.code and (active or f.project_id is not null)) then raise exception 'Unknown facility' using errcode='23514';end if;
 if f.project_id is null then f:=jsonb_populate_record(null::hub.project_facilities,'{"description":{},"location_note":"","access_note":"","evidence_note":"","display_name":{},"location_label":{},"opening_hours":{},"applies_to_project_ids":[],"ai_exposure":"open"}');end if;
 edited:=jsonb_populate_record(f,body);
 if not hub.content_locales(edited.description,4000) or edited.expected_open_date is not null and edited.status<>'planned' then
  raise exception 'Invalid facility description or opening date' using errcode='23514';end if;
 insert into hub.project_facilities(project_id,facility_code,status,description,location_note,access_note,evidence_note,expected_open_date,
  display_name,location_label,size_sqm,opening_hours,applies_to_project_ids,ai_exposure)
 values(p,code,edited.status,edited.description,edited.location_note,edited.access_note,edited.evidence_note,edited.expected_open_date,
  edited.display_name,edited.location_label,edited.size_sqm,edited.opening_hours,edited.applies_to_project_ids,edited.ai_exposure)
 on conflict(project_id,facility_code) do update set status=excluded.status,description=excluded.description,location_note=excluded.location_note,
  access_note=excluded.access_note,evidence_note=excluded.evidence_note,expected_open_date=excluded.expected_open_date,
  display_name=excluded.display_name,location_label=excluded.location_label,size_sqm=excluded.size_sqm,opening_hours=excluded.opening_hours,
  applies_to_project_ids=excluded.applies_to_project_ids,ai_exposure=excluded.ai_exposure returning * into edited;
 update hub.projects set updated_at=clock_timestamp() where id=p;
 return to_jsonb(edited);
end $$;

create function hub.c4_item_save(public_id text,kind text,item uuid,expected integer,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p uuid; table_name text; prior jsonb; result jsonb; f hub.project_features; s hub.solar_estimates; l hub.project_places;begin
 p:=hub.media_project(public_id,'edit');perform 1 from hub.projects where id=p for update;
 table_name:=case kind when 'features' then 'project_features' when 'solar' then 'solar_estimates' when 'places' then 'project_places' end;
 if table_name is null or item is null then raise exception 'Invalid project item' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('c4-item:'||item::text,0));
 execute format('select to_jsonb(r) from hub.%I r where id=$1 for update',table_name) into prior using item;
 if prior is not null and (prior->>'project_id')::uuid<>p then raise exception 'Project item not found' using errcode='P0002';end if;
 if coalesce((prior->>'revision')::integer,0) is distinct from expected then raise exception 'Project item changed' using errcode='40001';end if;
 if kind='features' then
  perform hub.c4_check_changes(body,array['feature_code','status','detail','metrics','commercial_type_id','source_note','ai_exposure']);
  f:=jsonb_populate_record(null::hub.project_features,coalesce(prior,'{"detail":{},"metrics":{},"source_note":{},"ai_exposure":"open"}')||body);
  insert into hub.project_features(id,project_id,feature_code,status,detail,metrics,commercial_type_id,source_note,ai_exposure)
   values(item,p,f.feature_code,f.status,f.detail,f.metrics,f.commercial_type_id,f.source_note,f.ai_exposure)
   on conflict(id) do update set feature_code=excluded.feature_code,status=excluded.status,detail=excluded.detail,metrics=excluded.metrics,
    commercial_type_id=excluded.commercial_type_id,source_note=excluded.source_note,ai_exposure=excluded.ai_exposure;
 elsif kind='solar' then
  perform hub.c4_check_changes(body,array['system_kw','battery_kwh','usage_profile','bill_before','bill_after','saving_pct','assumptions','source_note','as_of','ai_exposure']);
  if prior is not null and prior->>'state'<>'draft' then raise exception 'Create a new scenario to revise approved figures' using errcode='23514';end if;
  s:=jsonb_populate_record(null::hub.solar_estimates,coalesce(prior,'{"ai_exposure":"web_only"}')||body);
  insert into hub.solar_estimates(id,project_id,system_kw,battery_kwh,usage_profile,bill_before,bill_after,saving_pct,assumptions,source_note,as_of,ai_exposure)
   values(item,p,s.system_kw,s.battery_kwh,s.usage_profile,s.bill_before,s.bill_after,s.saving_pct,s.assumptions,s.source_note,s.as_of,s.ai_exposure)
   on conflict(id) do update set system_kw=excluded.system_kw,battery_kwh=excluded.battery_kwh,usage_profile=excluded.usage_profile,
    bill_before=excluded.bill_before,bill_after=excluded.bill_after,saving_pct=excluded.saving_pct,assumptions=excluded.assumptions,
    source_note=excluded.source_note,as_of=excluded.as_of,ai_exposure=excluded.ai_exposure;
 else
  perform hub.c4_check_changes(body,array['category','ref_id','name','distance_m','distance_method','travel_minutes','travel_mode','status','expected_open','as_of','show_on_web','sort','ai_exposure']);
  l:=jsonb_populate_record(null::hub.project_places,coalesce(prior,'{"show_on_web":false,"sort":0,"ai_exposure":"open"}')||body);
  insert into hub.project_places(id,project_id,category,ref_id,name,distance_m,distance_method,travel_minutes,travel_mode,status,expected_open,as_of,show_on_web,sort,ai_exposure)
   values(item,p,l.category,l.ref_id,l.name,l.distance_m,l.distance_method,l.travel_minutes,l.travel_mode,l.status,l.expected_open,l.as_of,l.show_on_web,l.sort,l.ai_exposure)
   on conflict(id) do update set category=excluded.category,ref_id=excluded.ref_id,name=excluded.name,distance_m=excluded.distance_m,
    distance_method=excluded.distance_method,travel_minutes=excluded.travel_minutes,travel_mode=excluded.travel_mode,status=excluded.status,
    expected_open=excluded.expected_open,as_of=excluded.as_of,show_on_web=excluded.show_on_web,sort=excluded.sort,ai_exposure=excluded.ai_exposure;
 end if;
 update hub.projects set updated_at=clock_timestamp() where id=p;
 execute format('select to_jsonb(r) from hub.%I r where id=$1',table_name) into result using item;
 return result;
end $$;

create function hub.c4_solar_review(public_id text,item uuid,expected integer,decision text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p uuid; actor uuid; s hub.solar_estimates;begin
 p:=hub.media_project(public_id,'approve');actor:=hub.permission_actor();perform 1 from hub.projects where id=p for update;
 select * into s from hub.solar_estimates where id=item and project_id=p for update;
 if not found then raise exception 'Scenario not found' using errcode='P0002';end if;
 if s.revision is distinct from expected then raise exception 'Scenario changed' using errcode='40001';end if;
 if decision='approve' then
  if s.state<>'draft' then raise exception 'Only a draft can be approved' using errcode='23514';end if;
  if actor=any(s.editors) then raise exception 'Another person must approve this scenario' using errcode='42501';end if;
  update hub.solar_estimates set state='approved',approved_by=actor,approved_at=clock_timestamp() where id=item returning * into s;
 elsif decision='withdraw' and s.state='approved' then
  update hub.solar_estimates set state='withdrawn' where id=item returning * into s;
 else raise exception 'Invalid scenario decision' using errcode='23514';end if;
 update hub.projects set updated_at=clock_timestamp() where id=p;
 return to_jsonb(s);
end $$;

create function hub.c4_reference_save(kind text,key text,expected integer,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare name text; prior jsonb; edited jsonb; cols text[]; names text; expressions text; assignments text; result jsonb;begin
 perform hub.require_permission('projects','approve');
 name:=case kind when 'rail_lines' then 'ref_rail_lines' when 'rail_stations' then 'ref_rail_stations'
  when 'expressways' then 'ref_expressways' when 'expressway_ramps' then 'ref_expressway_ramps'
  when 'features' then 'feature_catalog' when 'facilities' then 'facility_taxonomy' end;
 if name is null or key !~ '^[A-Za-z0-9_-]{1,80}$' then raise exception 'Invalid reference kind or code' using errcode='23514';end if;
 cols:=case kind when 'features' then array['label','explanation','category','metric_defs','active','ai_exposure']
  when 'facilities' then array['name_th','name_en','group_code','icon_code','sort_order','active','required_in_intake']
  when 'rail_stations' then array['name','line_code','latitude','longitude','status','expected_open','source_ref','as_of']
  when 'expressway_ramps' then array['name','expressway_code','latitude','longitude','status','source_ref','as_of']
  else array['name','status','source_ref','as_of'] end;
 perform hub.c4_check_changes(body,cols);
 perform pg_advisory_xact_lock(hashtextextended('c4-reference:'||name||':'||key,0));
 execute format('select to_jsonb(r) from hub.%I r where code=$1 for update',name) into prior using key;
 if coalesce((prior->>'revision')::integer,0) is distinct from expected then raise exception 'Reference changed' using errcode='40001';end if;
 edited:=coalesce(prior,case kind when 'features' then '{"explanation":{},"metric_defs":{},"active":true,"ai_exposure":"open"}'::jsonb
  when 'facilities' then '{"group_code":"other","icon_code":"building","sort_order":0,"active":true,"required_in_intake":false}'::jsonb else '{}'::jsonb end)||body;
 if kind='features' then
  if not hub.c4_metric_defs_valid(edited->'metric_defs') or exists(select 1 from hub.project_features where feature_code=key
   and not(status in ('absent','unknown') and metrics='{}') and not hub.c4_metrics_valid(edited->'metric_defs',metrics)) then
   raise exception 'Definition conflicts with saved project metrics' using errcode='23514';end if;
  if key='non_dee' and btrim(coalesce(edited->'label'->>'en',''))<>'' and not exists(select 1 from hub.translation_glossary
   where term_key='feature.non_dee' and status='active' and term->>'en'=edited->'label'->>'en') then
   raise exception 'Official English name awaits glossary approval (Q75)' using errcode='23514';end if;
 elsif kind='facilities' then
  if length(btrim(coalesce(edited->>'name_th',''))) not between 1 and 300 or length(btrim(coalesce(edited->>'name_en',''))) not between 1 and 300 then
   raise exception 'Thai and English facility names are required' using errcode='23514';end if;
 elsif (edited->>'as_of')::date>current_date then raise exception 'Source date cannot be in the future' using errcode='23514';end if;
 select string_agg(format('%I',c),','),string_agg(format('r.%I',c),','),string_agg(format('%I=excluded.%I',c,c),',')
  into names,expressions,assignments from unnest(cols) c;
 execute format('insert into hub.%I as target(code,%s) select $1,%s from jsonb_populate_record(null::hub.%I,$2) r
  on conflict(code) do update set %s,revision=target.revision+1 returning to_jsonb(target)',name,names,expressions,name,assignments)
  into result using key,edited;
 -- A new facility can be tagged immediately under the existing approved vocabulary.
 -- Existing media-tag decisions and glossary entries are never overwritten.
 if kind='facilities' then
  insert into hub.media_tags(code,label,tag_group,allowed_categories,status)
   values(key,jsonb_build_object('th',edited->>'name_th','en',edited->>'name_en'),'facility',array['facility'],'active') on conflict(code) do nothing;
  insert into hub.translation_glossary(term_key,term)
   values('facility.'||key,jsonb_build_object('th',edited->>'name_th','en',edited->>'name_en')) on conflict(term_key) do nothing;
 end if;
 return result;
end $$;

create function hub.c4_references() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('projects','view');
 return jsonb_build_object(
  'rail_lines',(select coalesce(jsonb_agg(to_jsonb(r) order by code),'[]') from hub.ref_rail_lines r),
  'rail_stations',(select coalesce(jsonb_agg(to_jsonb(r) order by line_code,code),'[]') from hub.ref_rail_stations r),
  'expressways',(select coalesce(jsonb_agg(to_jsonb(r) order by code),'[]') from hub.ref_expressways r),
  'expressway_ramps',(select coalesce(jsonb_agg(to_jsonb(r) order by expressway_code,code),'[]') from hub.ref_expressway_ramps r),
  'features',(select coalesce(jsonb_agg(to_jsonb(r) order by category,code),'[]') from hub.feature_catalog r),
  'facilities',(select coalesce(jsonb_agg(to_jsonb(r) order by sort_order,code),'[]') from hub.facility_taxonomy r));
end $$;

create function hub.c4_nearest_stations(public_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects;begin
 perform hub.content_scope_access('project',public_id,'view');select * into p from hub.projects where public_project_id=public_id;
 if p.latitude is null or p.longitude is null then return '[]';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('code',code,'line_code',line_code,'name',name,'status',status,'expected_open',expected_open,
   'as_of',as_of,'distance_method','straight_line','distance_m',round(distance::numeric)) order by distance,code) from (
  select s.*,6371000*acos(least(1::double precision,greatest(-1::double precision,
   sin(radians(p.latitude::double precision))*sin(radians(s.latitude::double precision))+
   cos(radians(p.latitude::double precision))*cos(radians(s.latitude::double precision))*cos(radians((p.longitude-s.longitude)::double precision))))) distance
  from hub.ref_rail_stations s where s.latitude is not null and s.longitude is not null order by distance,s.code limit 5
 ) suggestions),'[]');
end $$;

create function hub.c4_workspace(public_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare p uuid;begin
 p:=hub.media_project(public_id,'view');
 return jsonb_build_object('project',(select jsonb_build_object('id',id,'public_project_id',public_project_id,'name',public_name,'updated_at',updated_at) from hub.projects where id=p),
  'facilities',(select coalesce(jsonb_agg(to_jsonb(t)||coalesce(to_jsonb(f),'{"status":"unknown","revision":0,"description":{},"display_name":{},"location_label":{},"opening_hours":{},"applies_to_project_ids":[],"ai_exposure":"open"}') order by t.sort_order,t.code),'[]')
   from hub.facility_taxonomy t left join hub.project_facilities f on f.project_id=p and f.facility_code=t.code where t.active or f.project_id is not null),
  'features',(select coalesce(jsonb_agg(to_jsonb(f) order by feature_code,id),'[]') from hub.project_features f where project_id=p),
  'solar',(select coalesce(jsonb_agg(to_jsonb(s) order by as_of desc,id),'[]') from hub.solar_estimates s where project_id=p),
  'places',(select coalesce(jsonb_agg(to_jsonb(l) order by sort,id),'[]') from hub.project_places l where project_id=p),
  'unit_types',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',public_name) order by id),'[]') from hub.commercial_types where project_id=p and deleted_at is null),
  'phases',(select coalesce(jsonb_agg(jsonb_build_object('id',rem_project_id,'name',project_name_rem) order by rem_project_id),'[]') from staging.rem_projects),
  'references',hub.c4_references(),'nearest_stations',hub.c4_nearest_stations(public_id),
  'translations',hub.content_translation_list('projects',public_id),'media',hub.project_media(public_id));
end $$;

revoke all on function hub.c4_check_changes(jsonb,text[]),hub.c4_project_guard(),hub.c4_facility_save(text,text,integer,jsonb),
 hub.c4_item_save(text,text,uuid,integer,jsonb),hub.c4_solar_review(text,uuid,integer,text),hub.c4_reference_save(text,text,integer,jsonb),
 hub.c4_references(),hub.c4_nearest_stations(text),hub.c4_workspace(text) from public;
grant execute on function hub.c4_facility_save(text,text,integer,jsonb),hub.c4_item_save(text,text,uuid,integer,jsonb),
 hub.c4_solar_review(text,uuid,integer,text),hub.c4_reference_save(text,text,integer,jsonb),hub.c4_references(),hub.c4_nearest_stations(text),hub.c4_workspace(text) to hub_app;
commit;
