-- Phase A: inclusive Thailand bounds; all other readiness checks and grants stay intact.
begin;

create or replace function hub.snapshot_readiness(payload jsonb) returns jsonb
language plpgsql stable set search_path = pg_catalog, pg_temp as $$
declare missing jsonb := '[]'; item jsonb; field_name text; role_name text;
begin
  foreach field_name in array array['public_name','address','ad_disclaimer'] loop
    if coalesce(btrim(payload #>> array[field_name,'th']), '') = '' then
      missing := missing || jsonb_build_array(jsonb_build_object('field',field_name || '.th','message','กรอกข้อมูลภาษาไทย'));
    end if;
  end loop;
  if coalesce(payload->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    missing := missing || '[{"field":"slug","message":"ระบุ slug เป็นตัวอักษรอังกฤษพิมพ์เล็ก ตัวเลข และขีดกลาง"}]';
  end if;
  foreach field_name in array array['latitude','longitude'] loop
    if payload->>field_name is null then
      missing := missing || jsonb_build_array(jsonb_build_object('field',field_name,'message','ระบุพิกัด'));
    elsif jsonb_typeof(payload->field_name) <> 'number' or not (
      (payload->>field_name)::numeric between
        case field_name when 'latitude' then 5.0 else 97.0 end and
        case field_name when 'latitude' then 21.0 else 106.0 end) then
      missing := missing || jsonb_build_array(jsonb_build_object('field',field_name,
        'message','พิกัดอยู่นอกประเทศไทย ตรวจละติจูดและลองจิจูด'));
    end if;
  end loop;
  if (payload->>'effective_to')::timestamptz <= now() then
    missing := missing || '[{"field":"effective_to","message":"ข้อมูลหมดอายุแล้ว"}]';
  end if;
  if jsonb_array_length(coalesce(payload->'models','[]')) = 0 then
    missing := missing || '[{"field":"models","message":"เลือกแบบจาก REM อย่างน้อยหนึ่งแบบ"}]';
  end if;
  for item in select value from jsonb_array_elements(coalesce(payload->'models','[]')) loop
    if coalesce(item->>'match_status','') <> 'CONFIRMED' or not exists (
      select 1 from hub.model_types m where m.id = (item->>'id')::uuid
        and m.project_id = (payload->>'id')::uuid and m.rem_model_id = item->>'rem_model_id'
        and m.match_status = 'CONFIRMED' and m.deleted_at is null) then
      missing := missing || jsonb_build_array(jsonb_build_object('field','models.' || (item->>'id') || '.match_status','message','ยืนยันการจับคู่แบบกับ REM'));
    end if;
    if coalesce(btrim(item#>>'{public_name,th}'),'') = '' or item->>'bedrooms' is null
      or item->>'bathrooms' is null or coalesce((item->>'usable_area_sqm')::numeric,0) <= 0 then
      missing := missing || jsonb_build_array(jsonb_build_object('field','models.' || (item->>'id') || '.specifications','message','กรอกชื่อไทย ห้องนอน ห้องน้ำ และพื้นที่ใช้สอย'));
    end if;
  end loop;
  foreach role_name in array array['hero','thumbnail'] loop
    if not exists (select 1 from jsonb_array_elements(coalesce(payload->'assets','[]')) a
      where a->>'asset_role' = role_name and (a->>'is_primary')::boolean) then
      missing := missing || jsonb_build_array(jsonb_build_object('field','assets.' || role_name,'message','เลือกรูป ' || role_name));
    end if;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(payload->'assets','[]')) loop
    if not exists (select 1 from hub.assets a where a.id = (item->>'id')::uuid
      and a.rights_status = 'approved' and a.deleted_at is null
      and (a.effective_from is null or a.effective_from <= now())
      and (a.effective_to is null or a.effective_to > now()))
      or (item->>'effective_from')::timestamptz > now() or (item->>'effective_to')::timestamptz <= now() then
      missing := missing || jsonb_build_array(jsonb_build_object('field','assets.' || (item->>'id') || '.rights','message','รูปยังไม่ได้รับอนุมัติหรือสิทธิ์ใช้งานหมดอายุ'));
    end if;
  end loop;
  if not exists(select 1 from hub.projects p join staging.rem_projects s using(rem_project_id)
    join hub.brands b on b.id=(snapshot_readiness.payload->>'brand_id')::uuid
    join hub.brand_versions v on v.id=(snapshot_readiness.payload->>'brand_version_id')::uuid and v.brand_id=b.id
    join public_api.brands current_brand on current_brand.id=b.id
    where p.id=(snapshot_readiness.payload->>'id')::uuid and b.rem_brand_id=s.rem_brand_id
      and v.payload->>'rem_brand_id'=b.rem_brand_id)
    or not (hub.brand_snapshot_readiness(payload->'brand')->>'ready')::boolean then
    missing := missing || '[{"field":"brand_id","message":"เลือกแบรนด์ที่ตรงกับ REM และเผยแพร่แบรนด์พร้อมโลโก้ที่มีสิทธิ์ใช้งาน"}]';
  end if;
  return jsonb_build_object('ready', jsonb_array_length(missing)=0, 'missing', missing,
    'percent', greatest(0, 100 - jsonb_array_length(missing)*10));
end $$;

commit;
