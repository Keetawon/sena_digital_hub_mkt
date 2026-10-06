-- Product owner decision, 7 October 2026. Existing publications are not rewritten.
begin;

create function hub.model_specs_complete(item jsonb) returns boolean
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select coalesce(btrim(item#>>'{public_name,th}'),'')<>''
   and item->>'bedrooms' is not null and item->>'bathrooms' is not null
   and coalesce((item->>'usable_area_sqm')::numeric,0)>0
$$;
create function hub.model_publishable(payload jsonb,item jsonb) returns boolean
language sql stable set search_path=pg_catalog,pg_temp as $$
 select coalesce(item->>'match_status','')='CONFIRMED' and hub.model_specs_complete(item)
   and exists(select 1 from hub.model_types m join staging.rem_models s
     on s.rem_project_id=m.rem_project_id and s.rem_model_id=m.rem_model_id
     where m.id=(item->>'id')::uuid and m.project_id=(payload->>'id')::uuid
       and m.rem_model_id=item->>'rem_model_id' and m.match_status='CONFIRMED' and m.deleted_at is null
       and coalesce(s.source_record->>'isDeleted',s.source_record->>'is_deleted','false')<>'true')
$$;
create function hub.model_catalogue_complete(payload jsonb) returns boolean
language sql stable set search_path=pg_catalog,pg_temp as $$
 select not exists(select 1 from staging.rem_models s
   where s.rem_project_id=payload->>'rem_project_id'
     and coalesce(s.source_record->>'isDeleted',s.source_record->>'is_deleted','false')<>'true'
     and not exists(select 1 from jsonb_array_elements(coalesce(payload->'models','[]')) m
       where m->>'rem_model_id'=s.rem_model_id and hub.model_publishable(payload,m)))
$$;
create function hub.project_media_current(item jsonb) returns boolean
language sql stable set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from hub.assets a where a.id=(item->>'id')::uuid
   and a.rights_status='approved' and a.deleted_at is null
   and (a.effective_from is null or a.effective_from<=now()) and (a.effective_to is null or a.effective_to>now()))
   and (item->>'effective_from' is null or (item->>'effective_from')::timestamptz<=now())
   and (item->>'effective_to' is null or (item->>'effective_to')::timestamptz>now())
$$;

create or replace function hub.snapshot_readiness(payload jsonb) returns jsonb
language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare required jsonb:='[]'; recommended jsonb:='[]'; missing jsonb; excluded jsonb:='[]';
  item jsonb; source_model record; field_name text; role_name text; ok boolean; model jsonb; confirmed boolean; specs boolean;
  project_uuid uuid:=(payload->>'id')::uuid; rem_id text:=payload->>'rem_project_id'; facilities jsonb;
  total integer; passed integer;
begin
  foreach field_name in array array['public_name','address','ad_disclaimer'] loop
    required:=required||jsonb_build_array(jsonb_build_object('field',field_name||'.th','group','core',
      'message',case field_name when 'public_name' then 'ชื่อสาธารณะภาษาไทย' when 'address' then 'ที่อยู่ภาษาไทย' else 'ข้อความกำกับโฆษณาภาษาไทย' end,
      'passed',coalesce(btrim(payload#>>array[field_name,'th']),'')<>''));
  end loop;
  required:=required||jsonb_build_array(jsonb_build_object('field','slug','group','core','message','ชื่ออ้างอิง slug ถูกต้อง',
    'passed',coalesce(payload->>'slug','')~'^[a-z0-9]+(-[a-z0-9]+)*$'));
  foreach field_name in array array['latitude','longitude'] loop
    ok:=false;
    if jsonb_typeof(payload->field_name)='number' then
      ok:=(payload->>field_name)::numeric between case field_name when 'latitude' then 5 else 97 end and case field_name when 'latitude' then 21 else 106 end;
    end if;
    required:=required||jsonb_build_array(jsonb_build_object('field',field_name,'group','core',
      'message',case when ok then 'พิกัดอยู่ในประเทศไทย' else 'พิกัดอยู่นอกประเทศไทย ตรวจละติจูดและลองจิจูด' end,'passed',ok));
  end loop;
  required:=required||jsonb_build_array(jsonb_build_object('field','effective_to','group','core','message','ข้อมูลยังไม่หมดอายุ',
    'passed',payload->>'effective_to' is null or (payload->>'effective_to')::timestamptz>now()));
  foreach role_name in array array['hero','thumbnail'] loop
    select exists(select 1 from jsonb_array_elements(coalesce(payload->'assets','[]')) a where a->>'asset_role'=role_name
      and coalesce((a->>'is_primary')::boolean,false) and a->>'public_model_id' is null and hub.project_media_current(a)) into ok;
    required:=required||jsonb_build_array(jsonb_build_object('field','assets.'||role_name,'group','media',
      'message',case role_name when 'hero' then 'ภาพหลักและสิทธิ์ปัจจุบันที่อนุมัติ' else 'ภาพย่อและสิทธิ์ปัจจุบันที่อนุมัติ' end,'passed',ok));
  end loop;
  select exists(select 1 from hub.projects p join staging.rem_projects s using(rem_project_id)
    join hub.brands b on b.id=(snapshot_readiness.payload->>'brand_id')::uuid
    join hub.brand_versions v on v.id=(snapshot_readiness.payload->>'brand_version_id')::uuid and v.brand_id=b.id
    join public_api.brands current_brand on current_brand.id=b.id
    where p.id=project_uuid and b.rem_brand_id=s.rem_brand_id and v.payload->>'rem_brand_id'=b.rem_brand_id)
    and coalesce((hub.brand_snapshot_readiness(snapshot_readiness.payload->'brand')->>'ready')::boolean,false) into ok;
  required:=required||jsonb_build_array(jsonb_build_object('field','brand_id','group','brand',
    'message','แบรนด์เผยแพร่แล้วและตรงกับ REM','passed',ok));

  for source_model in select s.*,m.id as hub_id,m.public_model_id from staging.rem_models s left join hub.model_types m
    on m.project_id=project_uuid and m.rem_model_id=s.rem_model_id and m.deleted_at is null
    where s.rem_project_id=rem_id and coalesce(s.source_record->>'isDeleted',s.source_record->>'is_deleted','false')<>'true'
    order by s.rem_model_id loop
    select e into model from jsonb_array_elements(coalesce(payload->'models','[]')) e where e->>'rem_model_id'=source_model.rem_model_id limit 1;
    confirmed:=coalesce(model->>'match_status','')='CONFIRMED' and exists(select 1 from hub.model_types m
      where m.id=source_model.hub_id and m.match_status='CONFIRMED');
    specs:=hub.model_specs_complete(coalesce(model,(select to_jsonb(m) from hub.model_types m where m.id=source_model.hub_id)));
    foreach field_name in array array['match_status','specifications'] loop
      recommended:=recommended||jsonb_build_array(jsonb_build_object('field','models.'||coalesce(source_model.hub_id::text,source_model.rem_model_id)||'.'||field_name,
        'group','models','message',source_model.model_name_rem||' · '||case field_name when 'match_status' then 'ยืนยันการจับคู่ REM' else 'ชื่อไทย ห้องนอน ห้องน้ำ และพื้นที่ใช้สอยครบ' end,
        'passed',case field_name when 'match_status' then confirmed else specs end));
    end loop;
    if not (confirmed and hub.model_specs_complete(model)) then
      excluded:=excluded||jsonb_build_array(jsonb_build_object('rem_model_id',source_model.rem_model_id,'name',source_model.model_name_rem,
        'public_model_id',source_model.public_model_id,'reason',case when not confirmed then 'ยังไม่ยืนยันการจับคู่ REM' else 'ข้อมูลจำเป็นยังไม่ครบ' end));
    else
      recommended:=recommended||jsonb_build_array(jsonb_build_object('field','models.'||source_model.hub_id||'.plans','group','models',
        'message',source_model.model_name_rem||' · แปลนแบบห้อง','passed',exists(select 1 from jsonb_array_elements(coalesce(payload->'assets','[]')) a
          where a->>'public_model_id'=source_model.public_model_id and a->>'asset_role' in ('unit_plan','floor_plan') and hub.project_media_current(a))));
    end if;
  end loop;
  foreach role_name in array array['master_plan','gallery'] loop
    recommended:=recommended||jsonb_build_array(jsonb_build_object('field','assets.'||role_name,'group','media',
      'message',case role_name when 'master_plan' then 'ผังโครงการ' else 'ภาพแกลเลอรี' end,'passed',exists(select 1 from jsonb_array_elements(coalesce(payload->'assets','[]')) a
        where a->>'asset_role'=role_name and a->>'public_model_id' is null and hub.project_media_current(a))));
  end loop;
  facilities:=hub.project_facility_payload(project_uuid);
  for item in select value from jsonb_array_elements(facilities->'items') where (value->>'required')::boolean loop
    recommended:=recommended||jsonb_build_array(jsonb_build_object('field','facilities.'||(item->>'code'),'group','extra','message','ระบุสถานะ'||(item->>'name_th'),
      'passed',item->>'status' in ('present','absent','planned')));
  end loop;
  foreach field_name in array array['nearby','knowledge'] loop
    select exists(select 1 from staging.knowledge_candidates c join hub.knowledge_reviews r on r.candidate_id=c.id
      where rem_id=any(r.applies_to_project_ids) and r.decision='accepted' and case field_name when 'nearby' then c.kind='nearby' else c.kind in ('section','faq') end) into ok;
    recommended:=recommended||jsonb_build_array(jsonb_build_object('field',field_name,'group','extra',
      'message',case field_name when 'nearby' then 'สถานที่ใกล้เคียงที่ตรวจแล้ว' else 'ความรู้ที่ตรวจแล้ว' end,'passed',ok));
  end loop;
  select coalesce(jsonb_agg(e),'[]') into missing from jsonb_array_elements(required) e where not coalesce((e->>'passed')::boolean,false);
  total:=jsonb_array_length(required)+jsonb_array_length(recommended);
  select count(*) into passed from jsonb_array_elements(required||recommended) e where (e->>'passed')::boolean;
  return jsonb_build_object('ready',jsonb_array_length(missing)=0,'missing',missing,'required',required,'recommended',recommended,
    'passed',passed,'total',total,'percent',floor(100.0*passed/greatest(total,1)),'excluded_models',excluded,'model_catalogue_complete',hub.model_catalogue_complete(payload));
end $$;

create function hub.freeze_project_catalogue() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
declare models jsonb; media jsonb; complete boolean;
begin
  select coalesce(jsonb_agg(m),'[]') into models from jsonb_array_elements(coalesce(new.payload->'models','[]')) m where hub.model_publishable(new.payload,m);
  complete:=hub.model_catalogue_complete(new.payload||jsonb_build_object('models',models));
  select coalesce(jsonb_agg(a),'[]') into media from jsonb_array_elements(coalesce(new.payload->'assets','[]')) a
    where hub.project_media_current(a) and (a->>'public_model_id' is null or exists(select 1 from jsonb_array_elements(models) m where m->>'public_model_id'=a->>'public_model_id'));
  new.payload:=new.payload||jsonb_build_object('models',models,'assets',media,'model_catalogue_complete',complete);
  return new;
end $$;
create trigger freeze_project_catalogue before insert on hub.entity_versions for each row execute function hub.freeze_project_catalogue();

-- Rollback must still reject revoked identities/rights already contained in an old version.
-- This is snapshot safety, not a minimum/all-model publication requirement.
alter function hub.rollback_project(uuid,uuid,text) rename to rollback_project_before_readiness_levels;
revoke all on function hub.rollback_project_before_readiness_levels(uuid,uuid,text) from public,publisher;
create function hub.rollback_project(project_uuid uuid,version_uuid uuid,reason text) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare snapshot jsonb;
begin
  perform hub.require_actor(array['publisher']);
  perform 1 from hub.projects where id=project_uuid for update;
  select payload into snapshot from hub.entity_versions where id=version_uuid and project_id=project_uuid;
  if exists(select 1 from jsonb_array_elements(coalesce(snapshot->'models','[]')) old_model left join hub.model_types m on m.id=(old_model->>'id')::uuid
    where m.id is null or m.project_id<>project_uuid or m.rem_model_id<>old_model->>'rem_model_id' or m.deleted_at is not null or m.match_status<>'CONFIRMED')
    or exists(select 1 from jsonb_array_elements(coalesce(snapshot->'assets','[]')) a where not hub.project_media_current(a)) then
    raise exception 'เวอร์ชันเดิมมีการจับคู่หรือสิทธิ์ที่ถูกเพิกถอน' using errcode='23514';
  end if;
  perform hub.rollback_project_before_readiness_levels(project_uuid,version_uuid,reason);
end $$;
revoke all on function hub.rollback_project(uuid,uuid,text) from public;
grant execute on function hub.rollback_project(uuid,uuid,text) to publisher;

create function hub.knowledge_model_catalogue(rem_id text) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare project hub.projects; result boolean;
begin
  perform hub.require_actor(array['editor','publisher','viewer','admin']);
  select * into project from hub.projects where rem_project_id=rem_id and deleted_at is null;
  if not found then return not exists(select 1 from staging.rem_models s where s.rem_project_id=rem_id and coalesce(s.source_record->>'isDeleted','false')<>'true'); end if;
  if project.published_version_id is not null then select (payload->>'model_catalogue_complete')::boolean into result from hub.entity_versions where id=project.published_version_id; return result; end if;
  return hub.model_catalogue_complete(hub.draft_payload(project.id));
end $$;
revoke all on function hub.knowledge_model_catalogue(text) from public;
grant execute on function hub.knowledge_model_catalogue(text) to editor,publisher,viewer,admin;
revoke all on function hub.model_specs_complete(jsonb),hub.model_publishable(jsonb,jsonb),hub.model_catalogue_complete(jsonb),hub.project_media_current(jsonb),hub.freeze_project_catalogue() from public;

create or replace view hub_export.project_published with(security_barrier=true) as
select p.payload->>'rem_project_id' as rem_project_id,p.public_project_id,
  p.payload#>>'{public_name,th}' as public_name_th,p.payload#>>'{public_name,en}' as public_name_en,
  p.payload->>'slug' as slug,anchor.published_version_id,p.published_at,
  array(select distinct logo->>'asset_role' from jsonb_array_elements(coalesce(p.payload#>'{brand,assets}','[]')) logo
    where logo->>'asset_role' in ('logo_primary','logo_white','logo_mono','favicon') order by 1) as logo_roles_present,
  (p.payload->>'model_catalogue_complete')::boolean as model_catalogue_complete
from public_api.projects p join hub.projects anchor using(public_project_id);
comment on column hub_export.project_published.model_catalogue_complete is 'Frozen publication catalogue completeness; NULL for older versions without this field. No current-draft backfill.';
commit;
