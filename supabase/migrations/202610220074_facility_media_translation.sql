-- Phase 7 integration with the delivered media and translation workflows.
begin;

-- Preserve the delivered dispatch branches and append the owning Phase 7 cases.
-- Fail closed if an upstream contract changes before the final rebase.
do $patch$ declare r record; d text;begin
 for r in select * from (values
 ('hub.translation_allowed(text)',
  $old$'commercial_type.highlights']$old$,
  $new$'commercial_type.highlights','facility.display_name','facility.location_label','facility.opening_hours','feature.detail','place.name']$new$),
 ('hub.translation_source_allowed(text,text)',
  $old$'building','commercial_type')$old$,
  $new$'building','commercial_type','feature','place')$new$),
 ('hub.track_content_translation()',
  $old$keys:=array['description'];ref:=$old$,
  $new$keys:=array['description','display_name','location_label','opening_hours'];ref:=$new$),
 ('hub.track_content_translation()',
  $old$else raise exception 'Unsupported translation source'$old$,
  $new$elsif tg_table_name in ('project_features','project_places','solar_estimates') then
   kind:=case tg_table_name when 'project_features' then 'feature' when 'project_places' then 'place' else 'solar_estimate' end;
   owner:=data->>'id';tab:='projects';select public_project_id into scope from hub.projects where id=(data->>'project_id')::uuid;
   keys:=case kind when 'feature' then array['detail','source_note'] when 'place' then array['name'] else array['usage_profile','assumptions','source_note'] end;
   ref:=jsonb_build_object('id',owner,'project_id',data->'project_id');
   else raise exception 'Unsupported translation source'$new$),
 ('hub.translation_editable(hub.content_translations)',
  $old$return t.owner_type in$old$,
  $new$if t.owner_type='solar_estimate' then return exists(select 1 from hub.solar_estimates where id=t.owner_key::uuid and state='draft');end if;
   if t.owner_type='feature' then return exists(select 1 from hub.project_features where id=t.owner_key::uuid);end if;
   if t.owner_type='place' then return exists(select 1 from hub.project_places where id=t.owner_key::uuid);end if;
   return t.owner_type in$new$),
 ('hub.review_content_translation(uuid,integer,integer,text)',
  $old$'commercial_type','price','disclosure','sales_term','programme') then$old$,
  $new$'commercial_type','price','disclosure','sales_term','programme','feature','place','solar_estimate') then$new$),
 ('hub.review_content_translation(uuid,integer,integer,text)',
  $old$elsif t.owner_type='facility' then update hub.project_facilities set description=jsonb_set(description,'{en}',to_jsonb(english),true)
  where project_id=(t.row_ref->>'project_id')::uuid and facility_code=t.row_ref->>'facility_code';$old$,
  $new$elsif t.owner_type='facility' then
   if col not in ('description','display_name','location_label','opening_hours') then raise exception 'Invalid facility text' using errcode='23514';end if;
   execute format('update hub.project_facilities set %I=jsonb_set(%I,''{en}'',to_jsonb($1::text),true) where project_id=$2 and facility_code=$3',col,col)
    using english,(t.row_ref->>'project_id')::uuid,t.row_ref->>'facility_code';$new$),
 ('hub.review_content_translation(uuid,integer,integer,text)',
  $old$else raise exception 'Unsupported translation target'$old$,
  $new$elsif t.owner_type in ('feature','place','solar_estimate') then
   if not(t.owner_type='feature' and col in ('detail','source_note') or t.owner_type='place' and col='name'
    or t.owner_type='solar_estimate' and col in ('usage_profile','assumptions','source_note')) then raise exception 'Invalid project text' using errcode='23514';end if;
   table_name:=case t.owner_type when 'feature' then 'project_features' when 'place' then 'project_places' else 'solar_estimates' end;
   execute format('update hub.%I set %I=jsonb_set(%I,''{en}'',to_jsonb($1::text),true) where id=$2',table_name,col,col) using english,t.owner_key::uuid;
   else raise exception 'Unsupported translation target'$new$),
 ('hub.media_target(uuid,text,text,text)',
  $old$else return false;$old$,
  $new$when 'feature' then return exists(select 1 from hub.project_features where project_id=project_uuid and id::text=key);
   when 'place' then return exists(select 1 from hub.project_places where project_id=project_uuid and id::text=key);
   else return false;$new$),
 ('hub.project_media(text)',
  $old$'context',jsonb_build_object($old$,
  $new$'context',jsonb_build_object(
   'features',(select coalesce(jsonb_agg(jsonb_build_object('key',f.id,'label',c.label,'status',f.status) order by f.feature_code,f.id),'[]')
    from hub.project_features f join hub.feature_catalog c on c.code=f.feature_code where f.project_id=p.id),
   'places',(select coalesce(jsonb_agg(jsonb_build_object('key',id,'label',name,'status',status) order by sort,id),'[]')
    from hub.project_places where project_id=p.id),$new$)
 ) x(signature,needle,replacement) loop
  d:=replace(pg_get_functiondef(r.signature::regprocedure),chr(13)||chr(10),chr(10));
  if position(r.needle in d)=0 then raise exception 'Phase 7 dependency changed: %',r.signature;end if;
  execute replace(d,r.needle,r.replacement);
 end loop;
end $patch$;
create trigger content_translation after insert or update on hub.project_features for each row execute function hub.track_content_translation();
create trigger content_translation after insert or update on hub.project_places for each row execute function hub.track_content_translation();
create trigger content_translation after insert or update on hub.solar_estimates for each row execute function hub.track_content_translation();

-- Register only additional fields; reuse the Phase 2 identity and display keys.
do $$ declare g record; item text;begin
 for g in select * from (values
  ('facility_taxonomy','facilities','sort_order:ลำดับ:number|active:เปิดให้เลือกใช้:bool|required_in_intake:ต้องตอบในแบบเก็บข้อมูล:bool'),
  ('feature','features','active:เปิดให้เลือกใช้:bool|ai_exposure:การใช้กับ AI:enum'),
  ('solar_estimate','features','ai_exposure:การเผยแพร่สถานการณ์:enum|state:สถานะการอนุมัติ:enum'),
  ('ref_rail_line','places','as_of:วันที่ข้อมูล:date'),('ref_rail_station','places','as_of:วันที่ข้อมูล:date'),
  ('ref_expressway','places','as_of:วันที่ข้อมูล:date'),('ref_expressway_ramp','places','as_of:วันที่ข้อมูล:date')
 ) x(entity,section,fields) loop
  foreach item in array string_to_array(g.fields,'|') loop
   insert into hub.field_catalog(field_key,entity,section,label,value_kind,source_policy,surfaces,default_ai_exposure,status,validation)
   values(g.entity||'.'||split_part(item,':',1),g.entity,g.section,jsonb_build_object('th',split_part(item,':',2)),
    split_part(item,':',3),'mkt',array['hub_only'],'internal','planned','{"ai_translation":false}') on conflict(field_key) do nothing;
  end loop;
 end loop;
end $$;

update hub.field_catalog set status='active',
 help=jsonb_build_object('th','Marketing บันทึกข้อมูลที่มีแหล่งอ้างอิง ค่าว่างคือยังไม่ทราบ ตรวจภาษาอังกฤษก่อนนำไปเผยแพร่'),
 locales_required=case when field_key in ('facility.display_name','facility.location_label','facility.opening_hours','facility.description','feature.detail','place.name',
  'solar_estimate.usage_profile','solar_estimate.assumptions','solar_estimate.source_note') then array['th','en'] else '{}'::text[] end,
 validation=validation||jsonb_build_object('ai_translation',field_key in ('facility.display_name','facility.location_label','facility.opening_hours','facility.description','feature.detail','place.name'),
  'max_length',case when field_key in ('facility.display_name','feature.label','place.name') then 300 when field_key in ('facility.location_label','facility.opening_hours') then 1000
   when field_key in ('feature.detail','feature.explanation','solar_estimate.assumptions') then 12000 else 2000 end),
 required_for='{"all":"recommended"}'
 where entity in ('facility','facility_taxonomy','feature','solar_estimate','place','ref_rail_line','ref_rail_station','ref_expressway','ref_expressway_ramp');
update hub.field_catalog set validation=validation||'{"max_length":4000}' where field_key='facility.description';
update hub.field_catalog set default_ai_exposure='internal',surfaces=array['hub_only'],validation=validation||'{"ai_translation":false}'
 where field_key in ('feature.source_note','feature.metric_defs','feature.commercial_type_id','facility.applies_to_project_ids','place.ref_id');
update hub.field_catalog set default_ai_exposure='web_only',surfaces=array['web.project.features'],validation=validation||'{"ai_translation":false}',
 help='{"th":"Marketing กรอกสถานการณ์ประมาณการพร้อมแหล่งข้อมูล ผู้ตรวจคนละคนอนุมัติก่อนใช้ ไม่คำนวณผลประหยัดและไม่ส่งข้อมูลการเงินไป AI"}'
 where entity='solar_estimate';

update hub.field_catalog f set unit=u.unit from (values
 ('solar_estimate.system_kw','kW'),('solar_estimate.battery_kwh','kWh'),
 ('solar_estimate.bill_before','บาท'),('solar_estimate.bill_after','บาท'),
 ('solar_estimate.saving_pct','%'),('place.travel_minutes','นาที')
) u(field_key,unit) where f.field_key=u.field_key;

-- Select a cover atomically using the original media commands. Both observed
-- revisions are checked; a stale choice cannot silently replace another editor's cover.
create function hub.c4_facility_cover(public_id text,code text,link_uuid uuid,expected integer,previous_cover uuid,previous_revision integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p uuid; selected hub.asset_links; prior hub.asset_links;begin
 p:=hub.media_project(public_id,'edit');
 perform pg_advisory_xact_lock(hashtextextended('media-project:'||p::text,0));
 select * into selected from hub.asset_links where id=link_uuid and project_id=p and target_type='facility' and target_key=code and deleted_at is null for update;
 if not found then raise exception 'Facility photo not found' using errcode='P0002';end if;
 if selected.revision is distinct from expected then raise exception 'Photo changed' using errcode='40001';end if;
 select * into prior from hub.asset_links where project_id=p and target_type='facility' and target_key=code and is_primary and deleted_at is null for update;
 if prior.id is distinct from previous_cover or coalesce(prior.revision,0) is distinct from previous_revision then raise exception 'Cover changed' using errcode='40001';end if;
 if prior.id=selected.id then return to_jsonb(selected);end if;
 if prior.id is not null then perform hub.media_link_save(public_id,prior.id,prior.revision,'{"is_primary":false}');end if;
 return hub.media_link_save(public_id,selected.id,selected.revision,'{"is_primary":true}');
end $$;
revoke all on function hub.c4_facility_cover(text,text,uuid,integer,uuid,integer) from public;
grant execute on function hub.c4_facility_cover(text,text,uuid,integer,uuid,integer) to hub_app;
commit;
