-- Additive Phase 2 storage. No existing content, review or account rows change.
begin;

create table hub.field_catalog (
 field_key text primary key check(field_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
 entity text not null, section text not null, sort integer not null default 0,
 label jsonb not null, help jsonb not null default '{}',
 value_kind text not null check(value_kind in ('text','rich','number','money','percent','area','enum','bool','date','list','link')),
 unit text, source_policy text not null check(source_policy in ('mkt','rem','rem_override','legal','finance','computed')),
 source_ref text, owner_role text not null default 'Marketing', locales_required text[] not null default '{}',
 required_for jsonb not null default '{"all":"optional"}', surfaces text[] not null default '{}',
 default_ai_exposure text not null default 'open' check(default_ai_exposure in ('open','web_only','internal')),
 review_every_days integer check(review_every_days>0), validation jsonb not null default '{}',
 faq_question_keys text[] not null default '{}', status text not null default 'active' check(status in ('active','planned','retired')),
 revision integer not null default 1 check(revision>0),
 check(locales_required <@ array['th','en']), check(jsonb_typeof(label)='object' and jsonb_typeof(help)='object')
);
create table hub.project_facts (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references hub.projects,
 fact_key text not null references hub.field_catalog, grain text not null default 'project',
 value_text jsonb, value_number numeric, value_bool boolean, value_date date, value_list jsonb,
 unit text, source text not null check(source in ('rem','mkt','legal','finance','computed')),
 rem_value jsonb, rem_as_of timestamptz, override_reason text, basis jsonb not null default '{}',
 as_of date, valid_to date, approved_by uuid, approved_at timestamptz,
 ai_exposure text not null check(ai_exposure in ('open','web_only','internal')),
 revision integer not null default 1 check(revision>0),
 unique(project_id,fact_key,grain),
 check(num_nonnulls(value_text,value_number,value_bool,value_date,value_list)=1),
 check(value_text is null or jsonb_typeof(value_text)='object'),
 check(value_list is null or jsonb_typeof(value_list)='array'),
 check(valid_to is null or as_of is null or valid_to>=as_of),
 check(grain='project' or grain ~ '^(phase|building):[^[:space:]]+$')
);
create table hub.project_buildings (
 project_id uuid not null references hub.projects, building_key text not null check(building_key ~ '^[A-Za-z0-9_-]{1,100}$'),
 name jsonb not null, floors_above integer check(floors_above>0), has_rooftop boolean,
 skip_floors integer[] not null default '{}', unit_count integer check(unit_count>=0),
 rem_project_id text not null references staging.rem_projects, source text not null default 'mkt' check(source in ('mkt','rem')),
 source_ref text, source_as_of timestamptz, ai_exposure text not null default 'open' check(ai_exposure in ('open','web_only','internal')),
 revision integer not null default 1 check(revision>0), primary key(project_id,building_key),
 check(jsonb_typeof(name)='object')
);
-- Each save appends a point revision. The latest revision is the current draft.
create table hub.project_selling_points (
 project_id uuid not null references hub.projects, point_key uuid not null default gen_random_uuid(),
 revision integer not null check(revision>0), title jsonb not null, detail jsonb not null default '{}',
 icon_code text not null default 'check', linked_feature_code text, linked_fact_keys text[] not null default '{}',
 sort integer not null default 0, state text not null default 'DRAFT' check(state in ('DRAFT','IN_REVIEW','PUBLISHED','WITHDRAWN')),
 ai_exposure text not null default 'open' check(ai_exposure in ('open','web_only','internal')),
 primary key(project_id,point_key,revision),
 check(char_length(coalesce(title->>'th',''))<=60 and char_length(coalesce(title->>'en',''))<=60)
);
create table hub.contact_domains (
 domain text primary key check(domain ~ '^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$'),
 revision integer not null default 1, status text not null default 'active' check(status in ('active','retired'))
);
create table hub.contacts (
 id uuid primary key default gen_random_uuid(), scope_type text not null check(scope_type in ('project','brand','corporate')),
 scope_id text not null, channel text not null check(channel in ('phone','call_center_ext','line_oa','facebook','instagram','tiktok','youtube','website','email','messenger')),
 value text not null check(btrim(value)<>''), url text, label jsonb not null default '{}',
 shared_mailbox_confirmed boolean not null default false, is_primary boolean not null default false, sort integer not null default 0,
 ai_exposure text not null default 'web_only' check(ai_exposure in ('open','web_only','internal')),
 revision integer not null default 1 check(revision>0),
 check(channel<>'email' or shared_mailbox_confirmed), check(jsonb_typeof(label)='object')
);
create unique index contacts_one_primary on hub.contacts(scope_type,scope_id,channel) where is_primary;

-- Catalog metadata is safe to share across authorized content editors. Values
-- and source evidence still require their own tab in every reader/command.
create function hub.content_scope_tab(kind text) returns text
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select case kind when 'project' then 'projects' when 'brand' then 'brands' when 'corporate' then 'knowledge' end
$$;
create function hub.content_scope_access(kind text,ref text,level text) returns uuid
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid; begin
 actor:=hub.require_permission(hub.content_scope_tab(kind),level);
 if kind='project' and not exists(select 1 from hub.projects where public_project_id=ref and deleted_at is null)
 or kind='brand' and not exists(select 1 from hub.brands where public_brand_id=ref and deleted_at is null)
 or kind='corporate' and ref<>'sena' then raise exception 'Content scope not found' using errcode='P0002'; end if;
 return actor;
end $$;
create function hub.require_field_admin() returns uuid
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid; begin
 actor:=hub.require_special('projects','projects.manage_field_catalog');
 if not exists(select 1 from hub.user_account where id=actor and hub_role='admin' and status='ACTIVE') then
  raise exception 'Registry administration requires an authorized admin' using errcode='42501'; end if;
 return actor;
end $$;
-- Catalog addition changes no effective account entitlement or template.
update hub.permission_catalog set special_actions=array_append(special_actions,'projects.manage_field_catalog'),
 special_labels=special_labels||'{"projects.manage_field_catalog":"จัดการทะเบียนฟิลด์ (ผู้ดูแลระบบ)"}'::jsonb where tab='projects';

do $$ declare name text; predicate text; begin
 foreach name in array array['field_catalog','project_facts','project_buildings','project_selling_points','contact_domains','contacts'] loop
  execute format('alter table hub.%I add column created_at timestamptz not null default clock_timestamp(),
    add column created_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid,
    add column updated_at timestamptz not null default clock_timestamp(),
    add column updated_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid',name);
  execute format('alter table hub.%I enable row level security',name);
  execute format('alter table hub.%I force row level security',name);
  execute format('create policy content_owner on hub.%I to %I using(true) with check(true)',name,current_user);
  predicate:=case when name in ('field_catalog','contact_domains') then 'hub.can(''projects'',''view'') or hub.can(''brands'',''view'') or hub.can(''knowledge'',''view'')'
   when name='contacts' then 'hub.can(hub.content_scope_tab(scope_type),''view'')' else 'hub.can(''projects'',''view'')' end;
  execute format('create policy content_read on hub.%I for select to hub_app using(%s)',name,predicate);
  execute format('grant select on hub.%I to hub_app',name);
  execute format('create trigger content_audit after insert or update or delete on hub.%I for each row execute function audit.record_change()',name);
  execute format('create trigger content_touch before update on hub.%I for each row execute function hub.touch_record()',name);
 end loop;
end $$;
revoke all on function hub.content_scope_tab(text),hub.content_scope_access(text,text,text),hub.require_field_admin() from public;
grant execute on function hub.content_scope_tab(text) to hub_app;

insert into hub.field_catalog(field_key,entity,section,sort,label,help,value_kind,unit,source_policy,source_ref,required_for,surfaces,review_every_days,default_ai_exposure,validation)
select 'project.'||key,'project','facts',ordinality::integer,jsonb_build_object('th',label),jsonb_build_object('th',help),kind,unit,policy,ref,
 '{"all":"recommended"}',array['web.project.facts','chatbot','jsonld'],cadence,exposure,validation::jsonb
from unnest(array[
 'land_area_sqwah','unit_total','project_status','phase_count','building_count','floors_max','parking_regular','parking_tandem','parking_pct_regular','parking_pct_total','common_fee','sinking_fund','rental_yield_gross_pct'
]) with ordinality k(key,ordinality) join (values
 ('land_area_sqwah','พื้นที่โครงการ','แสดงไร่–งาน–ตารางวา เก็บค่าเป็นตารางวา; ระบุเหตุผลเมื่อแก้ค่าจาก REM','area','sq_wah','rem_override','dim_project.area_rai/area_ngan/area_square_wah',null::integer,'open','{"min":0}'),
 ('unit_total','จำนวนยูนิตทั้งหมด','ตรวจเทียบจำนวนโครงการกับจำนวนยูนิตที่นับจาก REM และยืนยันค่าที่เลือก','number','unit','rem_override','dim_project.total_unit/total_unit_count',null,'open','{"min":1,"integer":true,"confirmation":true}'),
 ('project_status','สถานะโครงการ','อ่านจากสำเนา REM เท่านั้น ค่าว่างหมายถึงยังไม่ทราบ','text',null,'rem','dim_project.project_status_detail',null,'open','{}'),
 ('phase_count','จำนวนเฟส','คำนวณจากสมาชิกกลุ่มในสำเนา DW ไม่ใช่จำนวนที่พิมพ์เอง','number','phase','computed',null,null,'open','{}'),
 ('building_count','จำนวนอาคาร','คำนวณจากรายการอาคารที่บันทึก; ยังไม่มีรายการหมายถึงยังไม่ทราบ','number','building','computed',null,null,'open','{}'),
 ('floors_max','จำนวนชั้นสูงสุด','คำนวณจากอาคารที่มีข้อมูลครบ','number','floor','computed',null,null,'open','{}'),
 ('parking_regular','ที่จอดรถปกติ','จำนวนช่องจอด ไม่รวมจอดซ้อนคัน','number','space','mkt',null,null,'open','{"min":0,"integer":true}'),
 ('parking_tandem','ที่จอดรถซ้อนคัน','ระบุ 0 เฉพาะเมื่อยืนยันว่าไม่มี; ค่าว่างคือยังไม่ทราบ','number','space','mkt',null,null,'open','{"min":0,"integer":true}'),
 ('parking_pct_regular','สัดส่วนที่จอดรถปกติ','ช่องจอดปกติ ÷ จำนวนยูนิตที่ยืนยัน × 100','percent','percent','computed',null,null,'open','{}'),
 ('parking_pct_total','สัดส่วนที่จอดรถรวม','ช่องจอดปกติและซ้อนคัน ÷ จำนวนยูนิตที่ยืนยัน × 100','percent','percent','computed',null,null,'open','{}'),
 ('common_fee','ค่าส่วนกลาง','คอนโด: บาท/ตร.ม./เดือน; บ้าน: บาท/ตร.ว./เดือน ต้องระบุหน่วยและวันที่ข้อมูล','money',null,'mkt',null,180,'open','{"min":0,"units":["THB/sqm/month","THB/sq_wah/month"]}'),
 ('sinking_fund','เงินกองทุนส่วนกลาง','ระบุหน่วย เงื่อนไข และวันที่ข้อมูลจาก Marketing','money',null,'mkt',null,180,'open','{"min":0,"units":["THB/sqm","THB/sq_wah","THB/unit"]}'),
 ('rental_yield_gross_pct','ประมาณการผลตอบแทนค่าเช่า','ค่าเช่าคาดหมายต่อปี ÷ ราคา ณ วันที่ระบุ; ประมาณการ ไม่รับประกัน','percent','percent','mkt',null,60,'web_only','{"min":0,"basis_required":true,"disclaimer":"ประมาณการ ไม่รับประกัน"}')
) f(key,label,help,kind,unit,policy,ref,cadence,exposure,validation) using(key);

insert into hub.field_catalog(field_key,entity,section,sort,label,help,value_kind,source_policy,locales_required,required_for,surfaces,validation)
select 'section.'||key,'section','narrative',ordinality::integer,jsonb_build_object('th',label),'{"th":"ข้อความการตลาดสำหรับเผยแพร่ ต้องตรวจภาษาอังกฤษก่อนนับว่าครบ"}',
 'rich','mkt',array['th','en'],jsonb_build_object('all',case when required then 'required' else 'recommended' end),array['web.project.sections','jsonld','llms_txt','chatbot'],
 jsonb_build_object('max_length',12000,'ai_translation',true)
from (values ('project_intro','แนะนำโครงการ',true,1),('selling_summary','สรุปจุดขาย',true,2),('concept_name','ชื่อแนวคิด',true,3),
 ('concept_detail','รายละเอียดแนวคิด',false,4),('investor_intro','ข้อมูลสำหรับผู้ลงทุน',false,5),('location_summary','ภาพรวมทำเล',false,6),
 ('corporate_intro','แนะนำองค์กร',false,7),('corporate_services','บริการขององค์กร',false,8)) s(key,label,required,ordinality);
update hub.field_catalog set status='planned',default_ai_exposure='web_only',surfaces=array['web.project.sections'],validation='{"max_length":12000,"ai_translation":false}' where field_key='section.investor_intro';

insert into hub.field_catalog(field_key,entity,section,sort,label,value_kind,source_policy,locales_required,required_for,surfaces,validation)
select entity||'.'||key,entity,section,sort,jsonb_build_object('th',label),kind,'mkt',array['th','en'],jsonb_build_object('all',required),surfaces,
 jsonb_build_object('max_length',limit_chars,'ai_translation',ai_allowed)
from (values
 ('project','public_name','identity',1,'ชื่อโครงการ','text','required',array['web.project.identity','jsonld','chatbot'],300,true),
 ('project','address','identity',2,'ที่อยู่โครงการ','text','required',array['web.project.identity','jsonld','chatbot'],2000,true),
 ('project','ad_disclaimer','identity',3,'ข้อความกำกับโฆษณา','text','required',array['web.project.identity'],4000,false),
 ('project','meta_title','seo',1,'ชื่อเรื่องในผลค้นหา','text','recommended',array['web.project.seo'],500,true),
 ('project','meta_description','seo',2,'คำอธิบายในผลค้นหา','text','recommended',array['web.project.seo'],2000,true),
 ('brand','public_name','identity',1,'ชื่อแบรนด์','text','required',array['web.brand.identity','jsonld','chatbot'],300,true),
 ('brand','description','narrative',2,'เรื่องราวแบรนด์','rich','required',array['web.brand.sections','jsonld','chatbot'],12000,true),
 ('facility','description','facilities',1,'รายละเอียดสิ่งอำนวยความสะดวก','text','recommended',array['web.project.facilities','chatbot'],4000,true),
 ('selling_point','title','narrative',1,'หัวข้อจุดขาย','text','required',array['web.project.selling_points','jsonld','chatbot'],60,true),
 ('selling_point','detail','narrative',2,'รายละเอียดจุดขาย','rich','required',array['web.project.selling_points','jsonld','chatbot'],4000,true),
 ('building','name','buildings',1,'ชื่ออาคาร','text','required',array['web.project.buildings'],300,true),
 ('contact','label','contacts',1,'ชื่อช่องทางติดต่อ','text','recommended',array['web.project.contacts'],300,false),
 ('faq','question','faq',1,'คำถาม','text','required',array['web.project.faq','jsonld','chatbot'],1000,true),
 ('faq','alt_questions','faq',2,'คำถามรูปแบบอื่น','list','optional',array['chatbot'],4000,true),
 ('faq','short_answer','faq',3,'คำตอบสั้น','text','required',array['web.project.faq','jsonld','chatbot'],300,true),
 ('faq','detail','faq',4,'คำตอบเพิ่มเติม','rich','recommended',array['web.project.faq','chatbot'],12000,true),
 ('question','question_template','faq',1,'แม่แบบคำถามมาตรฐาน','text','required',array['hub_only'],1000,true),
 ('question','alt_questions','faq',2,'คำถามมาตรฐานรูปแบบอื่น','list','optional',array['hub_only'],4000,true)
) s(entity,key,section,sort,label,kind,required,surfaces,limit_chars,ai_allowed);

-- No guessed company-domain allowlist. The registry administrator records the
-- approved domains before the first email contact; personal mail is never valid.
create function hub.content_fields() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 if not(hub.can('projects','view') or hub.can('brands','view') or hub.can('knowledge','view')) then
  raise exception 'Permission denied' using errcode='42501'; end if;
 return jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(f) order by entity,section,sort,field_key),'[]') from hub.field_catalog f where status<>'retired'),
  'email_domains',(select coalesce(jsonb_agg(domain order by domain),'[]') from hub.contact_domains where status='active'),
  'can_manage',hub.can_special('projects','projects.manage_field_catalog') and exists(select 1 from hub.user_account where id=hub.permission_actor() and hub_role='admin'));
end $$;
create function hub.save_content_field(key text,expected integer,changes jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare prior hub.field_catalog; edited hub.field_catalog; begin
 perform hub.require_field_admin();
 select * into prior from hub.field_catalog where field_key=key for update;
 if not found then raise exception 'Field not found' using errcode='P0002'; end if;
 if prior.revision is distinct from expected then raise exception 'Field changed' using errcode='40001'; end if;
 if jsonb_typeof(changes)<>'object' or exists(select 1 from jsonb_object_keys(changes) k where k not in
  ('label','help','sort','owner_role','required_for','review_every_days','status','faq_question_keys')) then
  raise exception 'Invalid field changes' using errcode='23514'; end if;
 edited:=jsonb_populate_record(prior,changes);
 if exists(select 1 from jsonb_each_text(edited.required_for) where value not in ('required','recommended','optional')) then
  raise exception 'Invalid requirement' using errcode='23514'; end if;
 update hub.field_catalog set label=edited.label,help=edited.help,sort=edited.sort,owner_role=edited.owner_role,
  required_for=edited.required_for,review_every_days=edited.review_every_days,status=edited.status,
  faq_question_keys=edited.faq_question_keys,revision=revision+1 where field_key=key;
 return (select to_jsonb(f) from hub.field_catalog f where field_key=key);
end $$;
create function hub.save_contact_domain(domain_name text,expected integer,next_status text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare prior hub.contact_domains; begin
 perform hub.require_field_admin();
 perform pg_advisory_xact_lock(hashtextextended('contact-domain:'||domain_name,0));
 select * into prior from hub.contact_domains where domain=domain_name for update;
 if coalesce(prior.revision,0) is distinct from expected then raise exception 'Domain changed' using errcode='40001'; end if;
 if domain_name<>lower(btrim(domain_name)) or domain_name=any(array['gmail.com','outlook.com','hotmail.com','yahoo.com','icloud.com','live.com']) then
  raise exception 'Company-owned domain required' using errcode='23514'; end if;
 insert into hub.contact_domains(domain,status) values(domain_name,next_status)
 on conflict(domain) do update set status=excluded.status,revision=hub.contact_domains.revision+1;
 return (select to_jsonb(d) from hub.contact_domains d where domain=domain_name);
end $$;

create function hub.content_number(value text) returns numeric
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select case when value ~ '^[0-9]+(\.[0-9]+)?$' then value::numeric end
$$;
create function hub.content_rem_values(project uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare d staging.dw_projects; land numeric; begin
 select s.* into d from staging.dw_projects s join hub.projects p using(rem_project_id) where p.id=project;
 if not found then return '{}'::jsonb; end if;
 if d.source_record->>'area_rai' is not null and d.source_record->>'area_ngan' is not null and d.source_record->>'area_square_wah' is not null then
  land:=hub.content_number(d.source_record->>'area_rai')*400+hub.content_number(d.source_record->>'area_ngan')*100+hub.content_number(d.source_record->>'area_square_wah');
 end if;
 return jsonb_build_object('as_of',d.source_snapshot_at,'land_area_sqwah',land,
  'unit_total',hub.content_number(d.source_record->>'total_unit'),'unit_counted',hub.content_number(d.source_record->>'total_unit_count'),
  'project_status',coalesce(d.source_record->>'project_status_detail',d.source_record->>'project_status_code'),
  'group_id',d.source_record->>'rem_project_group_id',
  'buildings',case when jsonb_typeof(d.source_record->'buildings')='array' then d.source_record->'buildings' else '[]'::jsonb end);
end $$;
create function hub.project_content_facts(public_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects; rem jsonb; units numeric; regular numeric; tandem numeric; buildings integer; floors integer; phases integer;
begin
 perform hub.content_scope_access('project',public_id,'view');
 select * into p from hub.projects where public_project_id=public_id and deleted_at is null;
 rem:=hub.content_rem_values(p.id);
 select value_number into units from hub.project_facts where project_id=p.id and fact_key='project.unit_total' and grain='project';
 select value_number into regular from hub.project_facts where project_id=p.id and fact_key='project.parking_regular' and grain='project';
 select value_number into tandem from hub.project_facts where project_id=p.id and fact_key='project.parking_tandem' and grain='project';
 select nullif(count(*),0),case when count(*) filter(where floors_above is null)=0 then max(floors_above) end into buildings,floors from hub.project_buildings where project_id=p.id;
 if nullif(rem->>'group_id','') is not null then
  select count(*) into phases from staging.dw_projects where source_record->>'rem_project_group_id'=rem->>'group_id';
 end if;
 return jsonb_build_object('rem',rem,'facts',coalesce((select jsonb_agg(to_jsonb(f) order by fact_key,grain) from hub.project_facts f where project_id=p.id),'[]'),
  'computed',jsonb_build_object('phase_count',phases,'building_count',buildings,'floors_max',floors,
    'parking_pct_regular',round(regular/nullif(units,0)*100,2),'parking_pct_total',round((regular+tandem)/nullif(units,0)*100,2)),
  'buildings',coalesce((select jsonb_agg(to_jsonb(b) order by building_key) from hub.project_buildings b where project_id=p.id),'[]'));
end $$;
create function hub.save_project_fact(public_id text,key text,grain_name text,expected integer,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects; f hub.field_catalog; prior hub.project_facts; edited hub.project_facts; rem jsonb; rem_number numeric; selected_count text;
begin
 perform hub.content_scope_access('project',public_id,'edit');
 select * into p from hub.projects where public_project_id=public_id and deleted_at is null for update;
 select * into f from hub.field_catalog where field_key=key and entity='project' and section='facts' and status='active';
 if not found or f.source_policy not in ('mkt','rem_override') then raise exception 'Fact is not editable' using errcode='23514'; end if;
 if grain_name<>'project' and grain_name<>'phase:'||p.rem_project_id and not exists(select 1 from hub.project_buildings where project_id=p.id and 'building:'||building_key=grain_name) then
  raise exception 'Grain must belong to this REM phase' using errcode='23514'; end if;
 select * into prior from hub.project_facts where project_id=p.id and fact_key=key and grain=grain_name for update;
 if coalesce(prior.revision,0) is distinct from expected then raise exception 'Fact changed' using errcode='40001'; end if;
 if jsonb_typeof(body)<>'object' or exists(select 1 from jsonb_object_keys(body) k where k not in
  ('value_text','value_number','value_bool','value_date','value_list','unit','override_reason','as_of','valid_to','ai_exposure','basis','unit_count_choice')) then
  raise exception 'Invalid fact fields' using errcode='23514'; end if;
 edited:=jsonb_populate_record(null::hub.project_facts,body);
 if num_nonnulls(edited.value_text,edited.value_number,edited.value_bool,edited.value_date,edited.value_list)<>1
  or f.value_kind in ('number','money','percent','area') and edited.value_number is null then
  raise exception 'Exactly one correctly typed fact value required' using errcode='23514'; end if;
 if edited.value_number::text in ('NaN','Infinity','-Infinity') or edited.value_number<(f.validation->>'min')::numeric or coalesce((f.validation->>'integer')::boolean,false) and trunc(edited.value_number)<>edited.value_number then
  raise exception 'Invalid fact number' using errcode='23514'; end if;
 if f.validation?'units' and not(f.validation->'units' ? coalesce(edited.unit,'')) then raise exception 'Select the applicable unit' using errcode='23514'; end if;
 if edited.as_of is null then raise exception 'Fact measurement date required' using errcode='23514'; end if;
 rem:=hub.content_rem_values(p.id); rem_number:=(rem->>split_part(key,'.',2))::numeric;
 if grain_name like 'building:%' then
  rem_number:=null;
  if key='project.unit_total' then
   select (b->>'unit_count')::numeric into rem_number from jsonb_array_elements(coalesce(rem->'buildings','[]')) b where 'building:'||(b->>'building_key')=grain_name;
  end if;
  rem:=rem||jsonb_build_object('unit_total',rem_number,'unit_counted',null);
 end if;
 if key='project.unit_total' then
  selected_count:=body->>'unit_count_choice';
  if selected_count not in ('rem_total','rem_counted','marketing') or selected_count is null then raise exception 'Confirm the unit-count source' using errcode='23514'; end if;
  if selected_count='rem_counted' then rem_number:=(rem->>'unit_counted')::numeric; end if;
  if selected_count in ('rem_total','rem_counted') and (rem_number is null or rem_number<>edited.value_number) then raise exception 'Selected REM count does not match' using errcode='23514'; end if;
 end if;
 if f.source_policy='rem_override' and rem_number is not null and rem_number is distinct from edited.value_number
  and btrim(coalesce(edited.override_reason,''))='' then raise exception 'REM override reason required' using errcode='23514'; end if;
 if key='project.rental_yield_gross_pct' and (jsonb_typeof(edited.basis)<>'object' or btrim(coalesce(edited.basis->>'th',''))='' or
   hub.content_number(edited.basis->>'expected_annual_rent') is null or coalesce(hub.content_number(edited.basis->>'price'),0)<=0 or
   abs(edited.value_number-round(hub.content_number(edited.basis->>'expected_annual_rent')/hub.content_number(edited.basis->>'price')*100,2))>0.01) then
  raise exception 'Yield needs expected annual rent, price and basis' using errcode='23514'; end if;
 insert into hub.project_facts(project_id,fact_key,grain,value_text,value_number,value_bool,value_date,value_list,unit,source,rem_value,rem_as_of,
  override_reason,basis,as_of,valid_to,ai_exposure)
 values(p.id,key,grain_name,edited.value_text,edited.value_number,edited.value_bool,edited.value_date,edited.value_list,coalesce(f.unit,edited.unit),
  case when f.source_policy='rem_override' and rem_number=edited.value_number then 'rem' else 'mkt' end,
  case when key='project.unit_total' then jsonb_build_object('total',rem->'unit_total','counted',rem->'unit_counted','choice',selected_count) else to_jsonb(rem_number) end,
  (rem->>'as_of')::timestamptz,edited.override_reason,coalesce(edited.basis,'{}'),edited.as_of,edited.valid_to,coalesce(edited.ai_exposure,f.default_ai_exposure))
 on conflict(project_id,fact_key,grain) do update set value_text=excluded.value_text,value_number=excluded.value_number,value_bool=excluded.value_bool,
  value_date=excluded.value_date,value_list=excluded.value_list,unit=excluded.unit,source=excluded.source,rem_value=excluded.rem_value,rem_as_of=excluded.rem_as_of,
  override_reason=excluded.override_reason,basis=excluded.basis,as_of=excluded.as_of,valid_to=excluded.valid_to,ai_exposure=excluded.ai_exposure,
  approved_by=null,approved_at=null,revision=hub.project_facts.revision+1;
 return (select to_jsonb(v) from hub.project_facts v where project_id=p.id and fact_key=key and grain=grain_name);
end $$;

create function hub.save_project_building(public_id text,key text,expected integer,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects; prior hub.project_buildings; edited hub.project_buildings; rem jsonb; source_building jsonb; begin
 perform hub.content_scope_access('project',public_id,'edit');
 select * into p from hub.projects where public_project_id=public_id and deleted_at is null for update;
 select * into prior from hub.project_buildings where project_id=p.id and building_key=key for update;
 if coalesce(prior.revision,0) is distinct from expected then raise exception 'Building changed' using errcode='40001'; end if;
 if jsonb_typeof(body)<>'object' or exists(select 1 from jsonb_object_keys(body) k where k not in ('name','floors_above','has_rooftop','skip_floors','unit_count','ai_exposure','use_rem')) then
  raise exception 'Invalid building fields' using errcode='23514'; end if;
 edited:=jsonb_populate_record(null::hub.project_buildings,body);
 if body->>'use_rem'='true' then
  rem:=hub.content_rem_values(p.id);
  select item into source_building from jsonb_array_elements(coalesce(rem->'buildings','[]')) item where item->>'building_key'=key;
  if source_building is null then raise exception 'Building is absent from the current DW snapshot' using errcode='23514'; end if;
  edited:=jsonb_populate_record(edited,source_building);
 end if;
 if not hub.content_locales(edited.name,300,true) or exists(select 1 from unnest(edited.skip_floors) f where f is null or f<1 or f>edited.floors_above)
  or cardinality(edited.skip_floors)<>(select count(distinct f) from unnest(edited.skip_floors) f) then raise exception 'Invalid building details' using errcode='23514'; end if;
 insert into hub.project_buildings(project_id,building_key,name,floors_above,has_rooftop,skip_floors,unit_count,rem_project_id,ai_exposure,source,source_ref,source_as_of)
 values(p.id,key,edited.name,edited.floors_above,edited.has_rooftop,coalesce(edited.skip_floors,'{}'),edited.unit_count,p.rem_project_id,coalesce(edited.ai_exposure,'open'),
  case when source_building is not null then 'rem' else 'mkt' end,case when source_building is not null then 'DW snapshot buildings: '||key end,(rem->>'as_of')::timestamptz)
 on conflict(project_id,building_key) do update set name=excluded.name,floors_above=excluded.floors_above,has_rooftop=excluded.has_rooftop,
  skip_floors=excluded.skip_floors,unit_count=excluded.unit_count,ai_exposure=excluded.ai_exposure,source=excluded.source,source_ref=excluded.source_ref,
  source_as_of=excluded.source_as_of,revision=hub.project_buildings.revision+1;
 return (select to_jsonb(b) from hub.project_buildings b where project_id=p.id and building_key=key);
end $$;

create function hub.content_contacts(kind text,ref text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.content_scope_access(kind,ref,'view');
 return coalesce((select jsonb_agg(to_jsonb(c) order by channel,sort,id) from hub.contacts c where scope_type=kind and scope_id=ref),'[]');
end $$;
create function hub.save_content_contact(kind text,ref text,contact uuid,expected integer,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare prior hub.contacts; edited hub.contacts; host text; result uuid; begin
 perform hub.content_scope_access(kind,ref,'edit');
 perform pg_advisory_xact_lock(hashtextextended('contact:'||kind||':'||ref,0));
 select * into prior from hub.contacts where id=contact and scope_type=kind and scope_id=ref for update;
 if contact is not null and not found then raise exception 'Contact not found' using errcode='P0002'; end if;
 if coalesce(prior.revision,0) is distinct from expected then raise exception 'Contact changed' using errcode='40001'; end if;
 if jsonb_typeof(body)<>'object' or exists(select 1 from jsonb_object_keys(body) k where k not in
  ('channel','value','url','label','shared_mailbox_confirmed','is_primary','sort','ai_exposure')) then raise exception 'Invalid contact fields' using errcode='23514'; end if;
 edited:=jsonb_populate_record(null::hub.contacts,body);
 if edited.channel is null or btrim(coalesce(edited.value,''))='' or not hub.content_locales(coalesce(edited.label,'{}'),300) then
  raise exception 'Contact channel, value and valid label required' using errcode='23514'; end if;
 if edited.channel='email' then
  if not coalesce(edited.shared_mailbox_confirmed,false) or edited.value !~ '^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$'
   or not exists(select 1 from hub.contact_domains where domain=lower(split_part(edited.value,'@',2)) and status='active') then
   raise exception 'Confirmed company shared mailbox on an approved domain required' using errcode='23514'; end if;
  if edited.url is not null and edited.url<>'mailto:'||edited.value then raise exception 'Email URL must match mailbox' using errcode='23514'; end if;
 elsif edited.channel in ('phone','call_center_ext') then
  if edited.value !~ '^[+0-9 ()-]{2,50}$' or edited.url is not null and edited.url !~ '^tel:[+0-9-]+$' then raise exception 'Invalid telephone' using errcode='23514'; end if;
 else
  if edited.url is null or edited.url !~ '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$' then raise exception 'HTTPS contact URL required' using errcode='23514'; end if;
  host:=lower(split_part(split_part(edited.url,'/',3),':',1));
  if edited.channel='line_oa' and host not in ('line.me','lin.ee')
   or edited.channel='facebook' and host not in ('facebook.com','www.facebook.com','fb.com')
   or edited.channel='instagram' and host not in ('instagram.com','www.instagram.com')
   or edited.channel='tiktok' and host not in ('tiktok.com','www.tiktok.com')
   or edited.channel='youtube' and host not in ('youtube.com','www.youtube.com','youtu.be')
   or edited.channel='messenger' and host not in ('m.me','messenger.com','www.messenger.com') then raise exception 'URL does not match channel' using errcode='23514'; end if;
 end if;
 result:=coalesce(contact,gen_random_uuid());
 insert into hub.contacts(id,scope_type,scope_id,channel,value,url,label,shared_mailbox_confirmed,is_primary,sort,ai_exposure)
 values(result,kind,ref,edited.channel,edited.value,edited.url,coalesce(edited.label,'{}'),coalesce(edited.shared_mailbox_confirmed,false),coalesce(edited.is_primary,false),coalesce(edited.sort,0),coalesce(edited.ai_exposure,'web_only'))
 on conflict(id) do update set channel=excluded.channel,value=excluded.value,url=excluded.url,label=excluded.label,
  shared_mailbox_confirmed=excluded.shared_mailbox_confirmed,is_primary=excluded.is_primary,sort=excluded.sort,ai_exposure=excluded.ai_exposure,revision=hub.contacts.revision+1;
 return (select to_jsonb(c) from hub.contacts c where id=result);
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='hub' and p.proname=any(array['content_fields','save_content_field','save_contact_domain','content_number','content_rem_values',
   'project_content_facts','save_project_fact','save_project_building','content_contacts','save_content_contact']) loop
  execute format('revoke all on function %s from public',f.signature);
  if f.proname not in ('content_number','content_rem_values') then execute format('grant execute on function %s to hub_app',f.signature); end if;
 end loop;
end $$;
commit;
