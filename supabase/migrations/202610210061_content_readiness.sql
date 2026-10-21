begin;

create function hub.translation_complete(kind text,owner text,key text,value jsonb) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select btrim(coalesce(value->>'th',''))<>'' and btrim(coalesce(value->>'en',''))<>'' and exists(
  select 1 from hub.content_translations where owner_type=kind and owner_key=owner and field_key=key
   and translation_state='reviewed' and en_from_th_version=th_version
   and th_sha256=encode(sha256(convert_to(value->>'th','UTF8')),'hex') and reviewed_en=value->>'en')
$$;
create function hub.project_content_readiness(public_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects; field hub.field_catalog; entry jsonb; items jsonb:='[]'; complete boolean; required boolean; form text;
 text_value jsonb; section uuid; point hub.project_selling_points; points integer; fact hub.project_facts; fact_data jsonb; building hub.project_buildings;
begin
 perform hub.content_scope_access('project',public_id,'view');
 select * into p from hub.projects where public_project_id=public_id and deleted_at is null;
 select case when count(distinct product_form)=1 then min(product_form) end into form from hub.commercial_types where project_id=p.id and deleted_at is null;
 fact_data:=hub.project_content_facts(public_id);
 for field in select * from hub.field_catalog fc where status='active' and entity in ('project','section') order by fc.entity,fc.section,fc.sort,fc.field_key loop
  -- Corporate narrative has its own future page, not a project requirement.
  if field.field_key like 'section.corporate_%' then continue; end if;
  required:=coalesce(field.required_for->>form,field.required_for->>'all','optional')='required'
   or form is null and exists(select 1 from jsonb_each_text(field.required_for) where value='required');
  complete:=false;
  if field.entity='section' then
   select s.id,v.body into section,text_value from hub.content_sections s join lateral
    (select body from hub.content_section_versions where section_id=s.id order by version_no desc limit 1) v on true
    where scope_type='project' and scope_id=public_id and section_key=field.field_key and s.state<>'WITHDRAWN';
   complete:=coalesce(hub.translation_complete('section',section::text,field.field_key,text_value),false);
  elsif field.section='facts' then
   if field.source_policy='computed' then complete:=fact_data->'computed'->split_part(field.field_key,'.',2) is not null and fact_data->'computed'->split_part(field.field_key,'.',2)<>'null'::jsonb;
   elsif field.source_policy='rem' then complete:=nullif(fact_data#>>'{rem,project_status}','') is not null;
   else
    select * into fact from hub.project_facts where project_id=p.id and fact_key=field.field_key and grain='project';
    complete:=found and fact.as_of is not null and (fact.valid_to is null or fact.valid_to>=(current_timestamp at time zone 'Asia/Bangkok')::date)
     and (field.review_every_days is null or fact.as_of+field.review_every_days>=(current_timestamp at time zone 'Asia/Bangkok')::date);
   end if;
  else
   text_value:=to_jsonb(p)->split_part(field.field_key,'.',2);
   complete:=case when 'en'=any(field.locales_required) then hub.translation_complete('project',p.id::text,field.field_key,text_value)
    else btrim(coalesce(text_value->>'th',''))<>'' end;
  end if;
  items:=items||jsonb_build_array(jsonb_build_object('field_key',field.field_key,'label',field.label,'required',required,'complete',coalesce(complete,false),
   'owner_role',field.owner_role,'review_every_days',field.review_every_days,'surfaces',field.surfaces));
 end loop;
 select count(*) into points from (select distinct on(point_key) state from hub.project_selling_points where project_id=p.id order by point_key,revision desc) current_points where state<>'WITHDRAWN';
 items:=items||jsonb_build_array(jsonb_build_object('field_key','selling_point.count','label','{"th":"จุดขาย 3–6 ข้อ"}'::jsonb,'required',true,'complete',points between 3 and 6));
 for point in select * from (select distinct on(point_key) * from hub.project_selling_points where project_id=p.id order by point_key,revision desc) current_points where state<>'WITHDRAWN' loop
  for field in select * from hub.field_catalog where entity='selling_point' and status='active' and 'en'=any(locales_required) loop
   text_value:=to_jsonb(point)->split_part(field.field_key,'.',2);
   complete:=hub.translation_complete('selling_point',point.point_key::text,field.field_key,text_value);
   items:=items||jsonb_build_array(jsonb_build_object('field_key',field.field_key,'point_key',point.point_key,'label',field.label,
    'required',coalesce(field.required_for->>'all','optional')='required','complete',coalesce(complete,false)));
  end loop;
 end loop;
 for building in select * from hub.project_buildings where project_id=p.id loop
  select * into field from hub.field_catalog where field_key='building.name' and status='active';
  if found then items:=items||jsonb_build_array(jsonb_build_object('field_key',field.field_key,'building_key',building.building_key,
   'label',jsonb_build_object('th',coalesce(building.name->>'th','อาคาร')||' · ชื่อและภาษาอังกฤษ'),
   'required',field.required_for->>'all'='required','complete',hub.translation_complete('building',p.id::text||':'||building.building_key,field.field_key,building.name)));end if;
 end loop;
 return jsonb_build_object('items',items,'ready',not exists(select 1 from jsonb_array_elements(items) i where (i->>'required')::boolean and not(i->>'complete')::boolean),
  'required_missing',(select count(*) from jsonb_array_elements(items) i where (i->>'required')::boolean and not(i->>'complete')::boolean),
  'recommended_complete',(select count(*) from jsonb_array_elements(items) i where not(i->>'required')::boolean and(i->>'complete')::boolean),
  'mode','PRIVATE_DRAFT','published',false,'product_form',form);
end $$;
create function hub.project_content(public_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.content_scope_access('project',public_id,'view');
 return hub.project_content_facts(public_id)||hub.project_content_sections(public_id)||jsonb_build_object(
  'contacts',hub.content_contacts('project',public_id),'translations',hub.content_translation_list('projects',public_id),
  'readiness',hub.project_content_readiness(public_id));
end $$;
create function hub.faq_references() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('knowledge','view');
 -- Approved minimal name/code references; never draft facts, files or notes.
 return jsonb_build_object(
  'projects',coalesce((select jsonb_agg(jsonb_build_object('id',rem_project_id,'name',project_name_rem) order by rem_project_id) from staging.rem_projects),'[]'),
  'brands',coalesce((select jsonb_agg(jsonb_build_object('id',public_brand_id,'name',public_name->>'th') order by public_brand_id) from hub.brands where deleted_at is null),'[]'),
  'groups',coalesce((select jsonb_agg(jsonb_build_object('id',project_group_id,'name',coalesce(source_record->>'project_group_name',project_group_id)) order by project_group_id) from staging.dw_project_groups),'[]'),
  'unit_types',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.public_name->>'th','project_id',p.rem_project_id) order by c.id)
   from hub.commercial_types c join hub.projects p on p.id=c.project_id where c.deleted_at is null and p.deleted_at is null),'[]'));
end $$;
create function hub.submit_faq(faq uuid,expected integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare f hub.faqs; v hub.faq_versions; field hub.field_catalog; value jsonb; begin
 perform hub.require_permission('knowledge','edit');
 select * into f from hub.faqs where id=faq for update;
 if not found then raise exception 'FAQ not found' using errcode='P0002'; end if;
 if f.revision is distinct from expected then raise exception 'FAQ changed' using errcode='40001'; end if;
 select * into v from hub.faq_versions where faq_id=faq order by version_no desc limit 1 for update;
 if v.state<>'DRAFT' or f.state<>'DRAFT' then raise exception 'Only a current draft can be submitted' using errcode='23514'; end if;
 if not exists(select 1 from hub.faq_questions where question_key=f.question_key and status='approved') then raise exception 'Approved question required' using errcode='23514'; end if;
 for field in select * from hub.field_catalog where entity='faq' and status='active' and required_for->>'all'='required' loop
  value:=to_jsonb(v)->split_part(field.field_key,'.',2);
  if not hub.translation_complete('faq',faq::text,field.field_key,value) then raise exception 'Required Thai and reviewed English are incomplete' using errcode='23514'; end if;
 end loop;
 if f.scope_type<>'corporate' and cardinality(v.applies_to_project_ids)=0 then raise exception 'Explicit applicable phases required' using errcode='23514'; end if;
 if exists(select 1 from hub.faq_sources s join hub.knowledge_reviews r on r.candidate_id=s.candidate_id where s.faq_id=faq and r.decision<>'accepted') then
  raise exception 'A source was rejected; revise the draft first' using errcode='23514'; end if;
 update hub.faq_versions set state='IN_REVIEW',translations=(select coalesce(jsonb_object_agg(field_key,jsonb_build_object(
  'translation_state',translation_state,'en_from_th_version',en_from_th_version,'th_version',th_version,'reviewed_by',reviewed_by,'reviewed_at',reviewed_at)),'{}')
  from hub.content_translations where owner_type='faq' and owner_key=faq::text) where id=v.id;
 update hub.faqs set state='IN_REVIEW',revision=revision+1 where id=faq;
 return hub.faq_read(faq);
end $$;
create function hub.submit_content_section(kind text,ref text,key text,expected integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare s hub.content_sections; v hub.content_section_versions; begin
 perform hub.content_scope_access(kind,ref,'edit');
 select * into s from hub.content_sections where scope_type=kind and scope_id=ref and section_key=key for update;
 if not found then raise exception 'Section not found' using errcode='P0002'; end if;
 if s.revision is distinct from expected then raise exception 'Section changed' using errcode='40001'; end if;
 select * into v from hub.content_section_versions where section_id=s.id order by version_no desc limit 1 for update;
 if v.state<>'DRAFT' or s.state<>'DRAFT' then raise exception 'Only a current draft can be submitted' using errcode='23514'; end if;
 if not hub.translation_complete('section',s.id::text,key,v.body) then raise exception 'Reviewed English required' using errcode='23514'; end if;
 update hub.content_section_versions set state='IN_REVIEW',translations=(select coalesce(jsonb_object_agg(field_key,jsonb_build_object(
  'translation_state',translation_state,'en_from_th_version',en_from_th_version,'th_version',th_version,'reviewed_by',reviewed_by,'reviewed_at',reviewed_at)),'{}')
  from hub.content_translations where owner_type='section' and owner_key=s.id::text) where id=v.id;
 update hub.content_sections set state='IN_REVIEW',revision=revision+1 where id=s.id;
 return jsonb_build_object('id',s.id,'revision',s.revision+1,'state','IN_REVIEW','published',false);
end $$;

-- Existing intake commands keep their original guards and evidence changes.
-- Additional versions are appended only when a person makes a new decision.
alter function hub.review_knowledge_candidate(uuid,integer,text,text[],text,boolean,text,text) rename to review_knowledge_candidate_before_versions;
revoke all on function hub.review_knowledge_candidate_before_versions(uuid,integer,text,text[],text,boolean,text,text) from public,hub_app,editor,publisher,viewer,admin,agency,online_staff,service_consumer;
create function hub.review_knowledge_candidate(candidate uuid,expected_revision integer,choice text,projects text[],reason text,owned boolean,role_name text,alt_text text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb; f hub.faqs; s hub.content_sections; v uuid; actor uuid; next_version integer; begin
 actor:=hub.require_permission('knowledge','edit');
 result:=hub.review_knowledge_candidate_before_versions(candidate,expected_revision,choice,projects,reason,owned,role_name,alt_text);
 select * into f from hub.faqs where candidate_id=candidate for update;
 if found then
  if choice='accepted' then
   select coalesce(max(version_no),0)+1 into next_version from hub.faq_versions where faq_id=f.id;
   insert into hub.faq_versions(faq_id,version_no,question,alt_questions,short_answer,answer_kind,fact_keys,applies_to_project_ids,editors)
   values(f.id,next_version,f.canonical_question,f.alt_questions,f.short_answer,case when f.live_fact_key is null then 'text' else 'fact' end,
    case when f.live_fact_key is null then '{}'::text[] else array[f.live_fact_key] end,projects,array[actor]) returning id into v;
   update hub.faqs set draft_version_id=v,state='DRAFT',revision=revision+1 where id=f.id;
   if not exists(select 1 from hub.faq_sources where faq_id=f.id and candidate_id=candidate) then
    insert into hub.faq_sources(faq_id,candidate_id,source_ref,source_url,decided_by) values(f.id,candidate,f.source_ref,f.source_url,actor);end if;
  else
   update hub.faq_versions set state='WITHDRAWN' where faq_id=f.id and state in ('DRAFT','IN_REVIEW');
   update hub.faqs set state='WITHDRAWN',draft_version_id=null,revision=revision+1 where id=f.id;
  end if;
 end if;
 select * into s from hub.content_sections where candidate_id=candidate for update;
 if found then
  if choice='accepted' then
   select coalesce(max(version_no),0)+1 into next_version from hub.content_section_versions where section_id=s.id;
   insert into hub.content_section_versions(section_id,version_no,title,body,summary,applies_to_project_ids,source_ref,source_url,editors)
   values(s.id,next_version,s.title,s.body,s.summary,projects,s.source_ref,s.source_url,array[actor]) returning id into v;
   update hub.content_sections set draft_version_id=v,state='DRAFT',revision=revision+1 where id=s.id;
  else
   update hub.content_section_versions set state='WITHDRAWN' where section_id=s.id and state in ('DRAFT','IN_REVIEW');
   update hub.content_sections set state='WITHDRAWN',draft_version_id=null,revision=revision+1 where id=s.id;
  end if;
 end if;
 return result;
end $$;
revoke all on function hub.review_knowledge_candidate(uuid,integer,text,text[],text,boolean,text,text) from public;
grant execute on function hub.review_knowledge_candidate(uuid,integer,text,text[],text,boolean,text,text) to hub_app,editor,admin;

-- Future phases activate these registry rows as their guarded forms arrive.
-- Explicit Thai labels keep the registry useful now, without publishing data.
do $$ declare group_row record; item text; key text; label_th text; kind text; begin
 for group_row in select * from (values
  ('project','identity','slug:ชื่อในที่อยู่เว็บ:text|latitude:ละติจูด:number|longitude:ลองจิจูด:number|website_content:ข้อความอ้างอิงภายใน:rich|effective_from:เริ่มใช้ข้อมูล:date|effective_to:สิ้นสุดข้อมูล:date'),
  ('building','buildings','building_key:รหัสอาคาร:text|floors_above:จำนวนชั้น:number|has_rooftop:มีดาดฟ้า:bool|skip_floors:ชั้นที่ข้าม:list|unit_count:จำนวนยูนิต:number|rem_project_id:เฟสจาก REM:text'),
  ('contact','contacts','channel:ประเภทช่องทาง:enum|value:ข้อมูลติดต่อ:text|url:ลิงก์ติดต่อ:link|is_primary:ช่องทางหลัก:bool|sort:ลำดับ:number|shared_mailbox_confirmed:ยืนยันกล่องอีเมลส่วนกลาง:bool'),
  ('selling_point','narrative','icon_code:ไอคอน:enum|linked_feature_code:คุณสมบัติที่เกี่ยวข้อง:enum|linked_fact_keys:ข้อเท็จจริงที่เกี่ยวข้อง:list|sort:ลำดับ:number'),
  ('asset','media','media_category:หมวดสื่อ:enum|tags:ป้ายกำกับ:list|caption:คำบรรยาย:text|alt_text:ข้อความแทนภาพ:text|image_kind:ประเภทภาพ:enum|taken_at:วันที่ถ่าย:date|people:บุคคลในภาพ:enum|third_party_marks:เครื่องหมายบุคคลภายนอก:enum|credit:เครดิต:text|ai_suggestion:ข้อเสนอจาก AI:list|metadata_state:สถานะตรวจข้อมูล:enum'),
  ('media_tag','media','code:รหัสป้ายกำกับ:text|label:ชื่อป้ายกำกับ:text|tag_group:กลุ่มป้ายกำกับ:enum|allowed_categories:หมวดที่อนุญาต:list|status:สถานะ:enum'),
  ('asset_link','media','usage:การใช้งาน:enum|building_key:อาคาร:enum|floor_from:ชั้นเริ่ม:number|floor_to:ชั้นสิ้นสุด:number|room_tag:ห้อง:enum|sort:ลำดับ:number|is_primary:ภาพปก:bool|effective_from:เริ่มใช้:date|effective_to:สิ้นสุด:date'),
  ('media_requirement','media','per:ขอบเขตกฎ:enum|media_category:หมวดสื่อ:enum|tags:ป้ายกำกับ:list|min_count:จำนวนขั้นต่ำ:number|target_count:จำนวนเป้าหมาย:number|blocks_publish:จำเป็นต่อการเผยแพร่:bool|max_age_days:อายุสื่อสูงสุด:number'),
  ('media_link','media','provider:ผู้ให้บริการ:enum|kind:ประเภทเนื้อหา:enum|tour_kind:ประเภททัวร์:enum|url:ลิงก์:link|external_id:รหัสจากผู้ให้บริการ:text|embed_url:ลิงก์ฝังสื่อ:link|title:ชื่อสื่อ:text|description:รายละเอียด:rich|published_at:วันที่อัปโหลด:date|captured_at:วันที่ถ่าย:date|duration_sec:ความยาววินาที:number|aspect:สัดส่วนภาพ:enum|language:ภาษา:enum|subtitles:คำบรรยาย:list|channel_name:ชื่อช่อง:text|owner_type:เจ้าของสื่อ:enum|is_sponsored:สื่อสนับสนุน:bool|thumbnail_asset_id:ภาพปก:text|metadata_source:แหล่งข้อมูล:text|metadata_fetched_at:วันที่ดึงข้อมูล:date|link_status:สถานะลิงก์:enum|checked_at:วันที่ตรวจ:date|is_featured:สื่อแนะนำ:bool|sort:ลำดับ:number|state:สถานะ:enum|ai_exposure:การใช้กับ AI:enum'),
  ('commercial_type','unit_types','public_name:ชื่อแบบ:text|description:รายละเอียด:rich|product_form:รูปแบบที่อยู่อาศัย:enum|category:ประเภทแบบ:enum|special_rooms:ห้องพิเศษ:list|ceiling_height_m:ความสูงเพดาน:area|furniture_package:ชุดเฟอร์นิเจอร์:enum|highlights:จุดเด่น:rich|price_mode:วิธีแสดงราคา:enum|ai_exposure:การใช้กับ AI:enum|room_tag:ประเภทห้อง:enum|caption:คำบรรยายภาพ:text'),
  ('facility','facilities','display_name:ชื่อที่แสดง:text|location_label:ตำแหน่ง:text|size_sqm:พื้นที่ตารางเมตร:area|opening_hours:เวลาเปิดใช้:text|applies_to_project_ids:เฟสที่ใช้ร่วมกัน:list|status:สถานะ:enum|expected_open_date:วันที่คาดว่าจะเปิด:date'),
  ('feature','features','code:รหัสคุณสมบัติ:text|label:ชื่อคุณสมบัติ:text|explanation:คำอธิบาย:rich|category:หมวดคุณสมบัติ:enum|metric_defs:นิยามตัวชี้วัด:list|status:สถานะ:enum|detail:รายละเอียด:rich|metrics:ค่าตัวชี้วัด:list|commercial_type_id:แบบที่เกี่ยวข้อง:text|source_note:แหล่งข้อมูล:text'),
  ('solar_estimate','features','system_kw:กำลังระบบ:number|battery_kwh:ความจุแบตเตอรี่:number|usage_profile:รูปแบบการใช้:text|bill_before:ค่าไฟก่อนติดตั้ง:money|bill_after:ค่าไฟหลังติดตั้ง:money|saving_pct:สัดส่วนประหยัด:percent|assumptions:สมมติฐาน:rich|source_note:แหล่งข้อมูล:text|as_of:วันที่ข้อมูล:date'),
  ('place','places','category:ประเภทสถานที่:enum|ref_id:รหัสอ้างอิง:text|name:ชื่อสถานที่:text|distance_m:ระยะทางเมตร:number|distance_method:วิธีวัดระยะ:enum|travel_minutes:เวลาเดินทาง:number|travel_mode:วิธีเดินทาง:enum|status:สถานะ:enum|expected_open:กำหนดเปิด:date|as_of:วันที่ข้อมูล:date|show_on_web:แสดงบนเว็บ:bool|sort:ลำดับ:number'),
  ('price','prices','kind:ประเภทราคา:enum|commercial_type_id:แบบที่อ้างอิง:text|amount:ราคา:money|display_text:ข้อความราคา:text|basis:ที่มาราคา:text|condition_text:เงื่อนไข:rich|promotion_id:โปรโมชัน:text|valid_from:เริ่มใช้:date|valid_to:หมดอายุ:date|rem_min_available:ราคาต่ำสุดจาก REM:money|rem_as_of:วันที่ REM:date|approved_by:ผู้อนุมัติ:text|approved_at:วันอนุมัติ:date'),
  ('disclosure','legal','owner_company:บริษัทเจ้าของโครงการ:text|owner_address:ที่อยู่บริษัท:text|registered_capital:ทุนจดทะเบียน:money|paid_capital:ทุนชำระแล้ว:money|managing_director:กรรมการผู้จัดการ:text|legal_project_name:ชื่อโครงการตามกฎหมาย:text|location_text:ที่ตั้ง:text|land_area_sqwah:พื้นที่โครงการ:area|title_deeds:โฉนด:list|land_numbers:เลขที่ดิน:list|encumbrance:ภาระผูกพัน:enum|bank:ธนาคาร:text|building_description:รายละเอียดอาคาร:rich|eia_status:สถานะ EIA:enum|eia_approval_date:วันอนุมัติ EIA:date|construction_start_year:ปีเริ่มก่อสร้าง:number|construction_completion_year:ปีคาดว่าแล้วเสร็จ:number|notes:หมายเหตุ:rich|basis:ฐานหลักฐาน:enum|legal_document_asset_id:เอกสารกฎหมาย:text|legal_doc_ref:เลขอ้างอิงเอกสาร:text|legal_doc_date:วันที่เอกสาร:date|legal_reviewed_by:ผู้ตรวจด้านกฎหมาย:text|legal_reviewed_at:วันตรวจด้านกฎหมาย:date|override_reason:เหตุผลยืนยันข้อมูลต่าง:text'),
  ('promotion','prices','audience:กลุ่มเป้าหมาย:enum|targets:ขอบเขตโปรโมชัน:list|booking_from:เริ่มจอง:date|booking_to:สิ้นสุดจอง:date|transfer_from:เริ่มโอน:date|transfer_to:สิ้นสุดโอน:date|title:ชื่อโปรโมชัน:text|summary:สรุป:rich|conditions_public:เงื่อนไข:rich|legal_terms:ข้อกำหนด:rich|disclaimer:ข้อความกำกับ:text'),
  ('sales_term','sales','booking_fee:ค่าจอง:money|contract_fee:ค่าทำสัญญา:money|down_payment:เงินดาวน์:money|installment_from:ผ่อนเริ่มต้น:money|installment_basis:ที่มาค่างวด:text|interest_rate:อัตราดอกเบี้ย:percent|rate_period:ช่วงอัตราดอกเบี้ย:text|lender:ผู้ให้สินเชื่อ:text|conditions:เงื่อนไข:rich|valid_from:เริ่มใช้:date|valid_to:สิ้นสุด:date'),
  ('programme','programmes','programme_key:โครงการบริการ:enum|participating:เข้าร่วม:bool|monthly_from:รายเดือนเริ่มต้น:money|basis:ที่มา:text|units_offered:ยูนิตจาก REM:number|as_of:วันที่ข้อมูล:date'),
  ('construction_progress','progress','component:องค์ประกอบงาน:enum|percent:ความคืบหน้า:percent|as_of:วันที่ข้อมูล:date|source:แหล่งข้อมูล:enum'),
  ('faq_question','faq','question_key:รหัสคำถาม:text|topic:หัวข้อ:enum|default_level:ระดับเริ่มต้น:enum|question_template:แม่แบบคำถาม:text|alt_questions:คำถามอื่น:list|answer_kind:ประเภทคำตอบ:enum|fact_keys:ช่องข้อเท็จจริง:list|property_types:ประเภทที่อยู่อาศัย:list|is_core:คำถามหลัก:bool|show_on_project_pages:แสดงบนหน้าโครงการ:bool|web_sort:ลำดับบนเว็บ:number|status:สถานะ:enum'),
  ('faq','faq','question_key:คำถามมาตรฐาน:text|scope_type:ระดับคำตอบ:enum|scope_id:ขอบเขตคำตอบ:text|state:สถานะ:enum|pinned_on:หน้าที่ปักหมุด:list|answer_kind:ประเภทคำตอบ:enum|fact_keys:ช่องข้อเท็จจริง:list|applies_to_project_ids:เฟสที่ใช้:list|applicability_rule:กฎขอบเขต:list|review_due:กำหนดตรวจ:date|effective_to:สิ้นสุดคำตอบ:date|author:ผู้เขียน:text|approver:ผู้อนุมัติ:text'),
  ('content_gap','faq','state:สถานะช่องว่าง:enum|assignee:ผู้รับผิดชอบ:text|occurrences:จำนวนครั้ง:number|last_seen:พบล่าสุด:date|question_key:คำถาม:text|resolved_by_faq_id:คำตอบที่แก้ไข:text'),
  ('article','articles','slug:ชื่อในที่อยู่เว็บ:text|category:หมวดบทความ:enum|cover:ภาพปก:text|author:ผู้เขียน:text|tags:ป้ายกำกับ:list|state:สถานะ:enum|ai_exposure:การใช้กับ AI:enum|title:ชื่อบทความ:text|excerpt:บทนำ:rich|blocks:เนื้อหา:list|seo_title:ชื่อสำหรับค้นหา:text|seo_description:คำอธิบายสำหรับค้นหา:text|links:เนื้อหาที่เกี่ยวข้อง:list'),
  ('web_page','publication','page_key:รหัสหน้า:text|page_type:ประเภทหน้า:enum|entity_ref:ข้อมูลหลัก:text|url:ที่อยู่เว็บ:link|locales:ภาษา:list|ai_policy:นโยบาย AI:enum|max_faq_items:จำนวน FAQ สูงสุด:number|content_sha256:ลายนิ้วมือเนื้อหา:text')
 ) g(entity,section,fields) loop
  foreach item in array string_to_array(group_row.fields,'|') loop
   key:=split_part(item,':',1);label_th:=split_part(item,':',2);kind:=split_part(item,':',3);
   insert into hub.field_catalog(field_key,entity,section,label,value_kind,source_policy,default_ai_exposure,surfaces,status,help,validation)
   values(group_row.entity||'.'||key,group_row.entity,group_row.section,jsonb_build_object('th',label_th),kind,
    case when key like 'rem_%' or key='units_offered' then 'rem' else 'mkt' end,
    case when key in ('website_content','legal_document_asset_id','legal_doc_ref','legal_doc_date','ai_suggestion') then 'internal'
     when group_row.section in ('legal','sales','prices') or group_row.entity in ('contact','solar_estimate') then 'web_only' else 'open' end,
    case when key in ('website_content','legal_document_asset_id','legal_doc_ref','legal_doc_date','ai_suggestion') then array['hub_only'] else array['web.project.'||group_row.section] end,
    'planned',jsonb_build_object('th','เตรียมไว้สำหรับแบบฟอร์มในระยะถัดไป ยังไม่ใช้ตัดสินการเผยแพร่'),'{"ai_translation":false}')
   on conflict(field_key) do nothing;
  end loop;
 end loop;
end $$;

update hub.field_catalog set status='active',help=jsonb_build_object('th','ข้อมูลร่างสำหรับแบบฟอร์มในระยะนี้ ใช้งานตามสิทธิ์ของเนื้อหาต้นทาง')
 where status='planned' and entity in ('building','contact','selling_point','faq_question','faq');

-- Evidence, linkage and reference metadata is registered too. These fields are
-- private by default; a later phase must explicitly choose any public projection.
do $$ declare g record; item text; begin
 for g in select * from (values
  ('fact','facts','project_id:โครงการ|fact_key:ฟิลด์ข้อเท็จจริง|grain:ระดับข้อมูล|unit:หน่วย|source:แหล่งข้อมูล|rem_value:ค่าจาก REM|rem_as_of:วันที่ REM|override_reason:เหตุผลที่ใช้ค่าต่าง|as_of:วันที่ข้อมูล|valid_to:ใช้ได้ถึง|approved_by:ผู้อนุมัติ|approved_at:วันอนุมัติ|ai_exposure:การใช้กับ AI|basis:ที่มาของตัวเลข|unit_count_choice:แหล่งจำนวนยูนิต'),
  ('contact','contacts','scope_type:ประเภทขอบเขต|scope_id:ขอบเขต'),
  ('asset_link','media','target_type:ประเภทเป้าหมาย|target_id:เป้าหมาย'),
  ('media_link_target','media','media_link_id:สื่อภายนอก|target_type:ประเภทเป้าหมาย|target_id:เป้าหมาย'),
  ('facility_taxonomy','facilities','code:รหัสสิ่งอำนวยความสะดวก|label:ชื่อ|group:กลุ่ม|icon:ไอคอน'),
  ('ref_rail_line','places','code:รหัสสายรถไฟ|name:ชื่อสาย|status:สถานะ|source_ref:แหล่งอ้างอิง'),
  ('ref_rail_station','places','code:รหัสสถานี|line_code:สายรถไฟ|name:ชื่อสถานี|latitude:ละติจูด|longitude:ลองจิจูด|status:สถานะ|expected_open:กำหนดเปิด|source_ref:แหล่งอ้างอิง'),
  ('ref_expressway','places','code:รหัสทางด่วน|name:ชื่อทางด่วน|status:สถานะ|source_ref:แหล่งอ้างอิง'),
  ('ref_expressway_ramp','places','code:รหัสทางขึ้นลง|expressway_code:ทางด่วน|name:ชื่อทางขึ้นลง|latitude:ละติจูด|longitude:ลองจิจูด|status:สถานะ|source_ref:แหล่งอ้างอิง'),
  ('faq_source','faq','faq_id:คำตอบ|candidate_id:หลักฐานเดิม|cluster_id:กลุ่มหลักฐาน|source_ref:แหล่งอ้างอิง|url:ลิงก์หลักฐาน|decided_by:ผู้ตัดสินใจ|decided_at:วันตัดสินใจ'),
  ('faq_cluster','faq','suggested_key:คำถามที่เสนอ|suggested_level:ระดับที่เสนอ|suggested_kind:ประเภทที่เสนอ|holds:เหตุผลพักไว้|applicability:ขอบเขต'),
  ('translation','narrative','en_from_th_version:ฉบับไทยที่ใช้แปล|translation_state:สถานะคำแปล'),
  ('article_link','articles','article_id:บทความ|project_id:โครงการ|brand_id:แบรนด์|programme_key:โครงการบริการ'),
  ('sales_term','sales','approved_by:ผู้อนุมัติ|approved_at:วันอนุมัติ'),
  ('programme','programmes','approved_by:ผู้อนุมัติ|approved_at:วันอนุมัติ')
 ) x(entity,section,fields) loop
  foreach item in array string_to_array(g.fields,'|') loop
   insert into hub.field_catalog(field_key,entity,section,label,value_kind,source_policy,surfaces,default_ai_exposure,status,validation)
   values(g.entity||'.'||split_part(item,':',1),g.entity,g.section,jsonb_build_object('th',split_part(item,':',2)),
    'text',case when split_part(item,':',1) like 'rem_%' then 'rem' else 'mkt' end,array['hub_only'],'internal','planned','{"ai_translation":false}')
   on conflict(field_key) do nothing;
  end loop;
 end loop;
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub'
  and p.proname=any(array['translation_complete','project_content_readiness','project_content','faq_references','submit_faq','submit_content_section']) loop
  execute format('revoke all on function %s from public',f.signature);
  if f.proname<>'translation_complete' then execute format('grant execute on function %s to hub_app',f.signature); end if;
 end loop;
end $$;
commit;
