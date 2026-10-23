-- Phase 7 follows the merged Phase 6 migration 71.
-- Additive Phase 7 storage. No existing content, reviews or entitlements change.
begin;

alter table hub.project_facilities
 add column display_name jsonb not null default '{}' check(hub.content_locales(display_name,300)),
 add column location_label jsonb not null default '{}' check(hub.content_locales(location_label,1000)),
 add column size_sqm numeric check(size_sqm>0 and size_sqm<=10000000),
 add column opening_hours jsonb not null default '{}' check(hub.content_locales(opening_hours,1000)),
 add column applies_to_project_ids text[] not null default '{}',
 add column ai_exposure text not null default 'open' check(ai_exposure in ('open','web_only','internal')),
 add column revision integer not null default 1 check(revision>0),
 add column created_at timestamptz not null default clock_timestamp(),
 add column created_by uuid default nullif(current_setting('app.actor_id',true),'')::uuid;
alter table hub.facility_taxonomy
 add column group_code text not null default 'other' check(group_code ~ '^[a-z][a-z0-9_]{0,49}$'),
 add column icon_code text not null default 'building' check(icon_code ~ '^[a-z][a-z0-9_]{0,49}$'),
 add column revision integer not null default 1 check(revision>0),
 add column created_at timestamptz not null default clock_timestamp(),
 add column created_by uuid default nullif(current_setting('app.actor_id',true),'')::uuid,
 add column updated_at timestamptz not null default clock_timestamp(),
 add column updated_by uuid default nullif(current_setting('app.actor_id',true),'')::uuid;
create trigger facility_taxonomy_audit after insert or update or delete on hub.facility_taxonomy for each row execute function audit.record_change();
create trigger facility_taxonomy_touch before update on hub.facility_taxonomy for each row execute function hub.touch_record();

insert into hub.facility_taxonomy(code,name_th,name_en,sort_order,group_code,icon_code) values
 ('lobby','ล็อบบี้','Lobby',110,'service','building'),
 ('meeting_room','ห้องประชุม','Meeting room',120,'work','users'),
 ('sky_garden','สวนลอยฟ้า','Sky garden',130,'landscape','leaf'),
 ('rooftop','พื้นที่ดาดฟ้า','Rooftop',140,'recreation','sun'),
 ('jogging_track','ทางวิ่ง','Jogging track',150,'wellness','activity'),
 ('bbq','พื้นที่บาร์บีคิว','Barbecue area',160,'recreation','flame'),
 ('sauna','ซาวน่า','Sauna',170,'wellness','flame'),
 ('theater','ห้องชมภาพยนตร์','Theater',180,'recreation','film'),
 ('kids_zone','พื้นที่เด็ก','Kids zone',190,'recreation','users'),
 ('basketball','สนามบาสเกตบอล','Basketball court',200,'wellness','activity'),
 ('putt_golf','สนามพัตต์กอล์ฟ','Putting green',210,'wellness','flag'),
 ('multi_sport','สนามกีฬาอเนกประสงค์','Multi-sport court',220,'wellness','activity'),
 ('convenience_store','ร้านสะดวกซื้อ','Convenience store',230,'service','shopping_bag'),
 ('mailroom','ห้องจดหมาย','Mailroom',240,'service','mail'),
 ('juristic_office','สำนักงานนิติบุคคล','Juristic office',250,'service','building');
insert into hub.translation_glossary(term_key,term)
 select 'facility.'||code,jsonb_build_object('th',name_th,'en',name_en) from hub.facility_taxonomy
 on conflict(term_key) do nothing;
insert into hub.media_tags(code,label,tag_group,allowed_categories,status)
 select code,jsonb_build_object('th',name_th,'en',name_en),'facility',array['facility'],'active'
 from hub.facility_taxonomy on conflict(code) do nothing;

create function hub.c4_metric_defs_valid(defs jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare k text; d jsonb; begin
 if jsonb_typeof(defs) is distinct from 'object' or octet_length(defs::text)>16000 then return false;end if;
 for k,d in select * from jsonb_each(defs) loop
  if k !~ '^[a-z][a-z0-9_]{0,49}$' or jsonb_typeof(d) is distinct from 'object'
   or coalesce(d->>'type','') not in ('number','integer','text','enum')
   or not hub.content_locales(d->'label',200,true)
   or exists(select 1 from jsonb_object_keys(d) x where x not in ('label','type','unit','min','max','options','required'))
   or d ? 'required' and jsonb_typeof(d->'required')<>'boolean'
   or d ? 'unit' and (jsonb_typeof(d->'unit')<>'string' or length(d->>'unit')>50) then return false;end if;
  if d->>'type' in ('number','integer') then
   if d ? 'options' or d ? 'min' and jsonb_typeof(d->'min')<>'number' or d ? 'max' and jsonb_typeof(d->'max')<>'number' then return false;end if;
   if d ? 'min' and d ? 'max' and (d->>'min')::numeric>(d->>'max')::numeric then return false;end if;
  elsif d ? 'min' or d ? 'max' then return false;
  end if;
  if d->>'type'='enum' then
   if jsonb_typeof(d->'options') is distinct from 'array' or jsonb_array_length(d->'options') not between 1 and 30
    or exists(select 1 from jsonb_array_elements(d->'options') v where jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 100) then return false;end if;
  elsif d ? 'options' then return false;end if;
 end loop;
 return true;
end $$;
create function hub.c4_metrics_valid(defs jsonb,metrics jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare k text; d jsonb; v jsonb; n numeric; begin
 if not hub.c4_metric_defs_valid(defs) or jsonb_typeof(metrics) is distinct from 'object' or octet_length(metrics::text)>16000
  or exists(select 1 from jsonb_object_keys(metrics) x where not defs ? x) then return false;end if;
 for k,d in select * from jsonb_each(defs) loop
  v:=metrics->k;
  if v is null then if coalesce((d->>'required')::boolean,false) then return false;end if;continue;end if;
  if d->>'type' in ('number','integer') then
   if jsonb_typeof(v)<>'number' then return false;end if;
   n:=(v#>>'{}')::numeric;
   if abs(n)>1000000000000 or d->>'type'='integer' and n<>trunc(n)
    or d ? 'min' and n<(d->>'min')::numeric or d ? 'max' and n>(d->>'max')::numeric then return false;end if;
  elsif d->>'type'='enum' then
   if jsonb_typeof(v)<>'string' or not (d->'options') @> jsonb_build_array(v) then return false;end if;
  elsif not hub.content_locales(v,2000,true) then return false;
  end if;
 end loop;
 return true;
end $$;
revoke all on function hub.c4_metric_defs_valid(jsonb),hub.c4_metrics_valid(jsonb,jsonb) from public;

create table hub.feature_catalog (
 code text primary key check(code ~ '^[a-z][a-z0-9_]{0,79}$'),
 label jsonb not null check(hub.content_locales(label,300,true)),
 explanation jsonb not null default '{}' check(hub.content_locales(explanation,12000)),
 category text not null check(category in ('health','sustainability','smart','security','service','partnership')),
 metric_defs jsonb not null default '{}' check(hub.c4_metric_defs_valid(metric_defs)),
 active boolean not null default true, revision integer not null default 1 check(revision>0),
 ai_exposure text not null default 'open' check(ai_exposure in ('open','web_only','internal'))
);
create table hub.project_features (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references hub.projects,
 feature_code text not null references hub.feature_catalog,
 status text not null check(status in ('present','absent','planned','unknown')),
 detail jsonb not null default '{}' check(hub.content_locales(detail,12000)),
 metrics jsonb not null default '{}', commercial_type_id uuid references hub.commercial_types,
 source_note jsonb not null default '{}' check(hub.content_locales(source_note,2000)),
 revision integer not null default 1 check(revision>0),
 ai_exposure text not null default 'open' check(ai_exposure in ('open','web_only','internal')),
 unique nulls not distinct(project_id,feature_code,commercial_type_id)
);
create table hub.solar_estimates (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references hub.projects,
 system_kw numeric not null check(system_kw>0 and system_kw<=1000000),
 battery_kwh numeric check(battery_kwh>=0 and battery_kwh<=10000000),
 usage_profile jsonb not null check(hub.content_locales(usage_profile,2000,true)),
 bill_before numeric not null check(bill_before>=0 and bill_before<=1000000000),
 bill_after numeric not null check(bill_after>=0 and bill_after<=1000000000),
 saving_pct numeric not null check(saving_pct between 0 and 100),
 assumptions jsonb not null check(hub.content_locales(assumptions,12000,true)),
 source_note jsonb not null check(hub.content_locales(source_note,2000,true)), as_of date not null,
 state text not null default 'draft' check(state in ('draft','approved','withdrawn')),
 editors uuid[] not null default '{}', approved_by uuid, approved_at timestamptz,
 revision integer not null default 1 check(revision>0),
 ai_exposure text not null default 'web_only' check(ai_exposure in ('web_only','internal'))
);
create table hub.ref_rail_lines (
 code text primary key check(code ~ '^[A-Za-z0-9_-]{1,80}$'), name jsonb not null check(hub.content_locales(name,300,true)),
 status text check(status in ('operating','construction','planned')), source_ref text not null check(length(btrim(source_ref)) between 1 and 2000),
 as_of date, revision integer not null default 1 check(revision>0)
);
create table hub.ref_rail_stations (
 code text primary key check(code ~ '^[A-Za-z0-9_-]{1,80}$'), line_code text not null references hub.ref_rail_lines,
 name jsonb not null check(hub.content_locales(name,300,true)), latitude numeric check(latitude between 5 and 21), longitude numeric check(longitude between 97 and 106),
 status text not null check(status in ('operating','construction','planned')), expected_open date,
 source_ref text not null check(length(btrim(source_ref)) between 1 and 2000), as_of date not null,
 revision integer not null default 1 check(revision>0), check((latitude is null)=(longitude is null)),
 check(expected_open is null or status<>'operating')
);
create table hub.ref_expressways (
 code text primary key check(code ~ '^[A-Za-z0-9_-]{1,80}$'), name jsonb not null check(hub.content_locales(name,300,true)),
 status text check(status in ('operating','construction','planned')), source_ref text not null check(length(btrim(source_ref)) between 1 and 2000),
 as_of date, revision integer not null default 1 check(revision>0)
);
create table hub.ref_expressway_ramps (
 code text primary key check(code ~ '^[A-Za-z0-9_-]{1,80}$'), expressway_code text not null references hub.ref_expressways,
 name jsonb not null check(hub.content_locales(name,300,true)), latitude numeric check(latitude between 5 and 21), longitude numeric check(longitude between 97 and 106),
 status text not null check(status in ('operating','construction','planned')),
 source_ref text not null check(length(btrim(source_ref)) between 1 and 2000), as_of date not null,
 revision integer not null default 1 check(revision>0), check((latitude is null)=(longitude is null))
);
create table hub.project_places (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references hub.projects,
 category text not null check(category in ('rail','expressway','mall','school','university','hospital','airport','park','office','market')),
 ref_id text, name jsonb not null check(hub.content_locales(name,300,true)),
 distance_m numeric check(distance_m>=0 and distance_m<=2000000), distance_method text check(distance_method in ('road','straight_line')),
 travel_minutes numeric check(travel_minutes>=0 and travel_minutes<=1440), travel_mode text check(travel_mode in ('walk','car','rail','bus','bicycle','boat')),
 status text not null check(status in ('operating','construction','planned')), expected_open date, as_of date not null,
 show_on_web boolean not null default false, sort integer not null default 0 check(sort>=0),
 ai_exposure text not null default 'open' check(ai_exposure in ('open','web_only','internal')),
 revision integer not null default 1 check(revision>0),
 check((distance_m is null)=(distance_method is null)), check((travel_minutes is null)=(travel_mode is null)),
 check(expected_open is null or status<>'operating'), check(ref_id is null or category in ('rail','expressway'))
);

do $$ declare name text; begin
 foreach name in array array['feature_catalog','project_features','solar_estimates','project_places','ref_rail_lines','ref_rail_stations','ref_expressways','ref_expressway_ramps'] loop
  execute format('alter table hub.%I add column created_at timestamptz not null default clock_timestamp(),
   add column created_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid,
   add column updated_at timestamptz not null default clock_timestamp(),
   add column updated_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid',name);
  execute format('alter table hub.%I enable row level security',name);
  execute format('alter table hub.%I force row level security',name);
  execute format('create policy c4_owner on hub.%I to %I using(true) with check(true)',name,current_user);
  execute format('create policy c4_read on hub.%I for select to hub_app using(hub.can(''projects'',''view''))',name);
  execute format('grant select on hub.%I to hub_app',name);
  execute format('create trigger c4_audit after insert or update or delete on hub.%I for each row execute function audit.record_change()',name);
  execute format('create trigger c4_touch before update on hub.%I for each row execute function hub.touch_record()',name);
 end loop;
end $$;

-- Identities only, sourced from the operators. Q74 governs station/ramp intake.
insert into hub.ref_rail_lines(code,name,source_ref) values
 ('bts_sukhumvit','{"th":"บีทีเอส สายสุขุมวิท","en":"BTS Sukhumvit Line"}','https://www.bts.co.th/eng/info/info-history.html'),
 ('bts_silom','{"th":"บีทีเอส สายสีลม","en":"BTS Silom Line"}','https://www.bts.co.th/eng/info/info-history.html'),
 ('mrt_blue','{"th":"เอ็มอาร์ที สายสีน้ำเงิน","en":"MRT Blue Line"}','https://metro.bemplc.co.th/MRT-System-Map'),
 ('mrt_purple','{"th":"เอ็มอาร์ที สายสีม่วง","en":"MRT Purple Line"}','https://metro.bemplc.co.th/MRT-System-Map');

-- Definitions describe what Marketing records, never assert project presence.
insert into hub.feature_catalog(code,label,category,explanation,metric_defs)
select code,jsonb_build_object('th',th,'en',en),category,jsonb_build_object('th',detail),defs::jsonb from (values
 ('vmove','วีมูฟ','VMOVE','service','ระบุรายละเอียดบริการเดินทางที่โครงการยืนยัน','{}'),
 ('joint_venture','โครงการร่วมทุน','Joint venture','partnership','ระบุพันธมิตรจากหลักฐานของโครงการ','{"partner":{"type":"text","label":{"th":"พันธมิตร"},"required":true}}'),
 ('fresh_air','ระบบเติมอากาศ','Fresh air','health','ระบุระบบและขอบเขตพื้นที่ที่ติดตั้งจริง','{}'),
 ('pm25_filter','ระบบกรองฝุ่น PM2.5','PM2.5 filtration','health','ระบุระบบกรองและเงื่อนไขจากข้อมูลที่ยืนยัน','{}'),
 ('universal_design','การออกแบบเพื่อทุกคน','Universal design','health','ระบุองค์ประกอบและพื้นที่ที่รองรับการใช้งาน','{}'),
 ('low_carbon','การลดคาร์บอน','Low carbon','sustainability','ระบุค่าประมาณรายปี วิธีประเมินและแหล่งข้อมูล','{"tco2e_per_year":{"type":"number","label":{"th":"คาร์บอนที่ลดได้ต่อปี"},"unit":"tCO2e/year","min":0,"required":true},"method":{"type":"text","label":{"th":"วิธีประเมิน"},"required":true}}'),
 ('non_dee','นอนดี','','health','คำอธิบายแนวคิดนอนดีตามข้อมูลที่ Marketing ยืนยัน ชื่ออังกฤษรอ Q75','{}'),
 ('smart_camera','กล้องอัจฉริยะ','Smart camera','smart','ระบุความสามารถและพื้นที่ติดตั้ง','{}'),
 ('smart_app','แอปอัจฉริยะ','Smart app','smart','ระบุบริการและเงื่อนไขการใช้งานแอป','{}'),
 ('smart_home','ระบบบ้านอัจฉริยะ','Smart home','smart','ระบุอุปกรณ์และแบบที่อยู่อาศัยที่ติดตั้ง','{}'),
 ('smart_parking','ระบบจอดรถอัจฉริยะ','Smart parking','smart','ระบุระบบและเงื่อนไขการใช้งาน','{}'),
 ('bms','ระบบบริหารอาคาร','Building management system','smart','ระบุระบบบริหารอาคารที่ติดตั้ง','{}'),
 ('solar_rooftop','โซลาร์รูฟท็อป','Solar rooftop','sustainability','ระบุกำลังติดตั้งและแบตเตอรี่จากแหล่งข้อมูลที่ยืนยัน','{"system_kw":{"type":"number","label":{"th":"กำลังติดตั้ง"},"unit":"kW","min":0},"battery_kwh":{"type":"number","label":{"th":"ความจุแบตเตอรี่"},"unit":"kWh","min":0}}'),
 ('ev_charger','เครื่องชาร์จรถไฟฟ้า','EV charger','sustainability','ระบุจำนวน กำลังและชนิดหัวชาร์จ','{"count":{"type":"integer","label":{"th":"จำนวนเครื่อง"},"min":0},"power_kw":{"type":"number","label":{"th":"กำลังชาร์จ"},"unit":"kW","min":0},"current_type":{"type":"enum","label":{"th":"ชนิดกระแส"},"options":["AC","DC"]}}'),
 ('cctv','กล้องวงจรปิด','CCTV','security','ระบุพื้นที่และรายละเอียดระบบกล้อง','{}'),
 ('key_card','ระบบคีย์การ์ด','Key card','security','ระบุจุดควบคุมการเข้าออก','{}'),
 ('guard_24h','เจ้าหน้าที่รักษาความปลอดภัย 24 ชั่วโมง','24-hour security guard','security','ระบุขอบเขตบริการที่ยืนยัน','{}'),
 ('easy_pass','ระบบผ่านเข้าออก','Easy pass','security','ระบุระบบผ่านเข้าออกและเงื่อนไข','{}'),
 ('lift_lock','ระบบล็อกชั้นลิฟต์','Lift floor access control','security','ระบุชั้นและระบบควบคุมการเข้าถึง','{}')
) s(code,th,en,category,detail,defs);

commit;
