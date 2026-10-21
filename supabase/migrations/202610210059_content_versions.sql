-- Version identities are additive; existing intake content/reviews remain intact.
begin;
create table hub.knowledge_topics (
 code text primary key, label jsonb not null, revision integer not null default 1
);
create table hub.faq_questions (
 question_key text primary key check(question_key ~ '^[a-z][a-z0-9_]{1,100}$'),
 topic text not null references hub.knowledge_topics, default_level text not null check(default_level in ('corporate','brand','programme','project_group','project','unit_type')),
 question_template jsonb not null, alt_questions jsonb not null default '{}',
 answer_kind text not null check(answer_kind in ('text','fact','handoff','auto')),
 fact_keys text[] not null default '{}', property_types text[] not null default '{}',
 is_core boolean not null default false, show_on_project_pages boolean not null default false, web_sort integer not null default 0,
 status text not null default 'proposed' check(status in ('proposed','approved','retired')),
 revision integer not null default 1, version_author uuid, approved_by uuid, approved_at timestamptz,
 ai_exposure text not null default 'open' check(ai_exposure in ('open','web_only','internal'))
);
create table hub.faq_question_versions (
 question_key text not null references hub.faq_questions, revision integer not null,
 payload jsonb not null, primary key(question_key,revision)
);

alter table hub.content_sections alter column candidate_id drop not null;
alter table hub.content_sections alter column title set default '{}';
alter table hub.content_sections alter column body set default '{}';
alter table hub.content_sections alter column applies_to_project_ids set default '{}';
alter table hub.content_sections alter column source_ref set default 'marketing';
alter table hub.content_sections alter column topic set default 'design';
alter table hub.content_sections drop constraint content_sections_scope_type_check;
alter table hub.content_sections add constraint content_sections_scope_type_check check(scope_type in ('corporate','brand','rem_project_group','project_group','project','unit_type','programme'));
alter table hub.content_sections add column section_key text references hub.field_catalog,
 add column state text not null default 'DRAFT' check(state in ('DRAFT','IN_REVIEW','PUBLISHED','WITHDRAWN')),
 add column revision integer not null default 1, add column draft_version_id uuid, add column published_version_id uuid;
create unique index content_section_identity on hub.content_sections(scope_type,scope_id,section_key) where section_key is not null;
create table hub.content_section_versions (
 id uuid primary key default gen_random_uuid(), section_id uuid not null references hub.content_sections,
 version_no integer not null check(version_no>0), section_key text references hub.field_catalog,
 title jsonb not null default '{}', body jsonb not null, summary jsonb not null default '{}',
 state text not null default 'DRAFT' check(state in ('DRAFT','IN_REVIEW','PUBLISHED','WITHDRAWN')),
 applies_to_project_ids text[] not null default '{}', source_ref text, source_url text,
 editors uuid[] not null default '{}', ai_exposure text not null default 'open' check(ai_exposure in ('open','web_only','internal')),
 unique(section_id,version_no)
);
alter table hub.content_sections add foreign key(draft_version_id) references hub.content_section_versions,
 add foreign key(published_version_id) references hub.content_section_versions;

alter table hub.faqs alter column candidate_id drop not null;
alter table hub.faqs alter column canonical_question set default '{}';
alter table hub.faqs alter column short_answer set default '{}';
alter table hub.faqs alter column applies_to_project_ids set default '{}';
alter table hub.faqs alter column source_ref set default 'marketing';
alter table hub.faqs add column question_key text references hub.faq_questions,
 add column state text not null default 'DRAFT' check(state in ('DRAFT','IN_REVIEW','PUBLISHED','WITHDRAWN')),
 add column revision integer not null default 1, add column draft_version_id uuid, add column published_version_id uuid,
 add column pinned_on text[] not null default '{}';
create table hub.faq_versions (
 id uuid primary key default gen_random_uuid(), faq_id uuid not null references hub.faqs,
 version_no integer not null check(version_no>0), question_key text references hub.faq_questions,
 question jsonb not null, alt_questions jsonb not null default '{}', short_answer jsonb not null, detail jsonb not null default '{}',
 answer_kind text not null check(answer_kind in ('text','fact','handoff','auto')), fact_keys text[] not null default '{}',
 applies_to_project_ids text[] not null default '{}', applicability_rule jsonb not null default '{}',
 state text not null default 'DRAFT' check(state in ('DRAFT','IN_REVIEW','PUBLISHED','WITHDRAWN')),
 review_due date, effective_to date, editors uuid[] not null default '{}', approved_by uuid, approved_at timestamptz,
 ai_exposure text not null default 'open' check(ai_exposure in ('open','web_only','internal')),
 unique(faq_id,version_no)
);
alter table hub.faqs add foreign key(draft_version_id) references hub.faq_versions,
 add foreign key(published_version_id) references hub.faq_versions;
create table hub.faq_sources (
 id uuid primary key default gen_random_uuid(), faq_id uuid not null references hub.faqs,
 candidate_id uuid references staging.knowledge_candidates, cluster_id uuid,
 source_url text, source_ref text not null, decided_by uuid, decided_at timestamptz not null default clock_timestamp(),
 revision integer not null default 1, check(candidate_id is not null or btrim(source_ref)<>'')
);

create function hub.section_visible(section uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce((select hub.can(case when scope_type='project' then 'projects' when scope_type='brand' then 'brands' else 'knowledge' end,'view')
  from hub.content_sections where id=section),false)
$$;
create function hub.content_version_guard() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'Content versions cannot be deleted' using errcode='23514'; end if;
 if old.state<>'DRAFT' and (to_jsonb(new)-array['state','updated_at','updated_by','approved_by','approved_at'])
  is distinct from (to_jsonb(old)-array['state','updated_at','updated_by','approved_by','approved_at']) then
  raise exception 'Submitted content is immutable' using errcode='23514'; end if;
 return new;
end $$;
do $$ declare name text; predicate text; begin
 foreach name in array array['knowledge_topics','faq_questions','faq_question_versions','content_section_versions','faq_versions','faq_sources'] loop
  execute format('alter table hub.%I add column created_at timestamptz not null default clock_timestamp(),
    add column created_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid,
    add column updated_at timestamptz not null default clock_timestamp(),
    add column updated_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid',name);
  execute format('alter table hub.%I enable row level security',name);
  execute format('alter table hub.%I force row level security',name);
  execute format('create policy content_owner on hub.%I to %I using(true) with check(true)',name,current_user);
  predicate:=case when name='content_section_versions' then 'hub.section_visible(section_id)' else 'hub.can(''knowledge'',''view'')' end;
  execute format('create policy content_read on hub.%I for select to hub_app using(%s)',name,predicate);
  execute format('grant select on hub.%I to hub_app',name);
  execute format('create trigger content_audit after insert or update or delete on hub.%I for each row execute function audit.record_change()',name);
  execute format('create trigger content_touch before update on hub.%I for each row execute function hub.touch_record()',name);
 end loop;
end $$;
create trigger content_immutable before update or delete on hub.content_section_versions for each row execute function hub.content_version_guard();
create trigger content_immutable before update or delete on hub.faq_versions for each row execute function hub.content_version_guard();
create trigger content_immutable before update or delete on hub.project_selling_points for each row execute function hub.content_version_guard();
create trigger content_immutable before update or delete on hub.faq_question_versions for each row execute function hub.reject_version_change();
revoke all on function hub.section_visible(uuid),hub.content_version_guard() from public;
grant execute on function hub.section_visible(uuid) to hub_app;

insert into hub.knowledge_topics(code,label) select code,jsonb_build_object('th',name) from (values
 ('identity','ข้อมูลโครงการ'),('brand','แบรนด์'),('design','แนวคิดและจุดเด่น'),('location','ทำเล'),('transport','การเดินทาง'),
 ('nearby','สถานที่ใกล้เคียง'),('facilities','สิ่งอำนวยความสะดวก'),('parking_security','ที่จอดรถและความปลอดภัย'),('unit_types','แบบห้องและแบบบ้าน'),
 ('sustainability','ความยั่งยืน'),('technology','เทคโนโลยี'),('buying_process','ขั้นตอนซื้อ'),('programmes','โครงการบริการ'),
 ('commercial_terms','เงื่อนไขการขาย'),('investment_context','ข้อมูลการลงทุน'),('contacts','ช่องทางติดต่อ'),('media_documents','สื่อและเอกสาร'),
 ('construction_progress','ความคืบหน้าก่อสร้าง')) t(code,name);

-- Seed proposals, never manufacture a Manager's approval.
insert into hub.faq_questions(question_key,topic,default_level,question_template,answer_kind,fact_keys,is_core,show_on_project_pages,web_sort)
select key,topic,'project',jsonb_build_object('th',question),kind,keys,true,true,n from (values
 ('project_overview','identity','{project} เป็นโครงการแบบใด','text',array[]::text[],1),
 ('project_location','location','{project} ตั้งอยู่ที่ไหน','text',array[]::text[],2),
 ('project_concept','design','{project} มีแนวคิดและจุดเด่นอะไร','text',array[]::text[],3),
 ('project_units','identity','{project} มีกี่ยูนิต','fact',array['project.unit_total'],4),
 ('project_facilities','facilities','{project} มีสิ่งอำนวยความสะดวกอะไร','text',array[]::text[],5),
 ('project_parking','parking_security','{project} มีที่จอดรถเท่าใด','fact',array['project.parking_regular','project.parking_pct_regular'],6),
 ('project_common_fee','commercial_terms','{project} มีค่าส่วนกลางเท่าใด','fact',array['project.common_fee'],7),
 ('project_availability','commercial_terms','{project} มีห้องหรือบ้านว่างหรือไม่','handoff',array[]::text[],8),
 ('project_installments','buying_process','{project} ผ่อนต่อเดือนเท่าใด','handoff',array[]::text[],9),
 ('project_contact','contacts','ติดต่อ {project} ได้อย่างไร','handoff',array[]::text[],10)
) q(key,topic,question,kind,keys,n);

-- Copy old drafts into new tables only. Do not UPDATE the old evidence rows.
insert into hub.content_section_versions(section_id,version_no,title,body,summary,applies_to_project_ids,source_ref,source_url,editors,
 created_at,created_by,updated_at,updated_by)
select id,1,title,body,summary,applies_to_project_ids,source_ref,source_url,array[reviewed_by],reviewed_at,reviewed_by,reviewed_at,reviewed_by from hub.content_sections;
insert into hub.faq_versions(faq_id,version_no,question,alt_questions,short_answer,answer_kind,fact_keys,applies_to_project_ids,editors,
 created_at,created_by,updated_at,updated_by)
select id,1,canonical_question,alt_questions,short_answer,case when live_fact_key is null then 'text' else 'fact' end,
 case when live_fact_key is null then '{}'::text[] else array[live_fact_key] end,applies_to_project_ids,array[reviewed_by],
 reviewed_at,reviewed_by,reviewed_at,reviewed_by from hub.faqs;
insert into hub.faq_sources(faq_id,candidate_id,source_url,source_ref,decided_by,decided_at,created_at,created_by,updated_at,updated_by)
select id,candidate_id,source_url,source_ref,reviewed_by,reviewed_at,reviewed_at,reviewed_by,reviewed_at,reviewed_by from hub.faqs;
insert into hub.faq_question_versions(question_key,revision,payload) select question_key,revision,to_jsonb(q) from hub.faq_questions q;

create function hub.content_locales(value jsonb,max_chars integer,require_th boolean default false) returns boolean
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select case when jsonb_typeof(value)='object' then not exists(select 1 from jsonb_each(value) where key not in ('th','en') or jsonb_typeof(value)<>'string'
  or char_length(value#>>'{}')>max_chars) and (not require_th or btrim(coalesce(value->>'th',''))<>'') else false end
$$;
create function hub.content_fact_keys(keys text[]) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select keys is not null and not exists(select 1 from unnest(keys) k where not exists(select 1 from hub.field_catalog where field_key=k and status='active' and section='facts' and entity='project'))
$$;
create function hub.faq_question_list() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('knowledge','view');
 return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(q) order by web_sort,question_key) from hub.faq_questions q),'[]'),
  'topics',(select jsonb_agg(to_jsonb(t) order by code) from hub.knowledge_topics t),
  'translations',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('editable',hub.translation_editable(t),'job',
   (select jsonb_build_object('status',status,'error_code',error_code,'model',model,'completed_at',completed_at) from hub.translation_jobs where translation_id=t.id and th_version=t.th_version)))
   from hub.content_translations t where owner_type='question' and source_tab='knowledge'),'[]'));
end $$;
create function hub.save_faq_question(key text,expected integer,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid; prior hub.faq_questions; edited hub.faq_questions; begin
 actor:=hub.require_permission('knowledge','edit');
 perform pg_advisory_xact_lock(hashtextextended('faq-question:'||key,0));
 select * into prior from hub.faq_questions where question_key=key for update;
 if coalesce(prior.revision,0) is distinct from expected then raise exception 'Question changed' using errcode='40001'; end if;
 if jsonb_typeof(body)<>'object' or exists(select 1 from jsonb_object_keys(body) k where k not in
 ('topic','default_level','question_template','alt_questions','answer_kind','fact_keys','property_types','is_core','show_on_project_pages','web_sort','ai_exposure')) then
  raise exception 'Invalid question fields' using errcode='23514'; end if;
 edited:=jsonb_populate_record(null::hub.faq_questions,body);
 if edited.topic is null or edited.default_level is null or edited.answer_kind is null or exists(select 1 from unnest(edited.property_types) p where p not in ('condominium','house','townhome') or p is null) then
  raise exception 'Question topic, scope, kind and controlled property types required' using errcode='23514'; end if;
 if not hub.content_locales(edited.question_template,1000,true) or not hub.content_locales(coalesce(edited.alt_questions,'{}'),4000)
  or not hub.content_fact_keys(coalesce(edited.fact_keys,'{}')) then raise exception 'Invalid question text or fact keys' using errcode='23514'; end if;
 if key in ('project_availability','project_installments') and edited.answer_kind<>'handoff' then raise exception 'Sales handoff required' using errcode='23514'; end if;
 insert into hub.faq_questions(question_key,topic,default_level,question_template,alt_questions,answer_kind,fact_keys,property_types,
  is_core,show_on_project_pages,web_sort,version_author,ai_exposure)
 values(key,edited.topic,edited.default_level,edited.question_template,coalesce(edited.alt_questions,'{}'),edited.answer_kind,coalesce(edited.fact_keys,'{}'),coalesce(edited.property_types,'{}'),
  coalesce(edited.is_core,false),coalesce(edited.show_on_project_pages,false),coalesce(edited.web_sort,0),actor,coalesce(edited.ai_exposure,'open'))
 on conflict(question_key) do update set topic=excluded.topic,default_level=excluded.default_level,question_template=excluded.question_template,
  alt_questions=excluded.alt_questions,answer_kind=excluded.answer_kind,fact_keys=excluded.fact_keys,property_types=excluded.property_types,is_core=excluded.is_core,
  show_on_project_pages=excluded.show_on_project_pages,web_sort=excluded.web_sort,version_author=actor,status='proposed',approved_by=null,approved_at=null,
  ai_exposure=excluded.ai_exposure,revision=hub.faq_questions.revision+1;
 insert into hub.faq_question_versions(question_key,revision,payload) select key,q.revision,to_jsonb(q) from hub.faq_questions q where question_key=key;
 return (select to_jsonb(q) from hub.faq_questions q where question_key=key);
end $$;
create function hub.approve_faq_question(key text,expected integer,decision text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid; prior hub.faq_questions; begin
 actor:=hub.require_permission('knowledge','approve');
 select * into prior from hub.faq_questions where question_key=key for update;
 if not found then raise exception 'Question not found' using errcode='P0002'; end if;
 if prior.revision is distinct from expected then raise exception 'Question changed' using errcode='40001'; end if;
 if prior.version_author=actor then raise exception 'The version editor cannot approve it' using errcode='42501'; end if;
 if decision not in ('approved','retired') then raise exception 'Invalid approval decision' using errcode='23514'; end if;
 update hub.faq_questions set status=decision,approved_by=actor,approved_at=clock_timestamp(),revision=revision+1 where question_key=key;
 insert into hub.faq_question_versions(question_key,revision,payload) select key,q.revision,to_jsonb(q) from hub.faq_questions q where question_key=key;
 return (select to_jsonb(q) from hub.faq_questions q where question_key=key);
end $$;

create function hub.project_content_sections(public_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare project uuid; begin
 perform hub.content_scope_access('project',public_id,'view');
 select id into project from hub.projects where public_project_id=public_id and deleted_at is null;
 return jsonb_build_object('sections',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'section_key',s.section_key,'revision',s.revision,'state',s.state,'version',to_jsonb(v),
  'history',(select jsonb_agg(to_jsonb(h) order by version_no desc) from hub.content_section_versions h where h.section_id=s.id)) order by s.section_key)
  from hub.content_sections s join lateral (select * from hub.content_section_versions where section_id=s.id order by version_no desc limit 1) v on true
  where s.scope_type='project' and s.scope_id=public_id),'[]'),
 'selling_points',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('history',(select jsonb_agg(to_jsonb(h) order by revision desc)
   from hub.project_selling_points h where h.project_id=project and h.point_key=v.point_key)) order by sort,point_key) from
  (select distinct on(point_key) * from hub.project_selling_points where project_id=project order by point_key,revision desc) v where state<>'WITHDRAWN'),'[]'));
end $$;
create function hub.save_content_section(kind text,ref text,key text,expected integer,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid; prior hub.content_sections; field hub.field_catalog; v uuid; new_id uuid; begin
 actor:=hub.content_scope_access(kind,ref,'edit');
 perform pg_advisory_xact_lock(hashtextextended('section:'||kind||':'||ref||':'||key,0));
 select * into field from hub.field_catalog where field_key=key and entity='section' and status='active';
 if not found then raise exception 'Section key not found' using errcode='P0002'; end if;
 select * into prior from hub.content_sections where scope_type=kind and scope_id=ref and section_key=key for update;
 if coalesce(prior.revision,0) is distinct from expected then raise exception 'Section changed' using errcode='40001'; end if;
 if jsonb_typeof(body)<>'object' or exists(select 1 from jsonb_object_keys(body) k where k not in ('body','ai_exposure','source_ref'))
  or not hub.content_locales(body->'body',12000,true) then raise exception 'Invalid section text' using errcode='23514'; end if;
 if prior.id is null then
  insert into hub.content_sections(scope_type,scope_id,section_key,reviewed_by) values(kind,ref,key,actor) returning id into new_id;
 else new_id:=prior.id; end if;
 insert into hub.content_section_versions(section_id,version_no,section_key,body,source_ref,editors,ai_exposure)
 values(new_id,coalesce(prior.revision,0)+1,key,body->'body',body->>'source_ref',array[actor],coalesce(body->>'ai_exposure',field.default_ai_exposure)) returning id into v;
 update hub.content_sections set draft_version_id=v,state='DRAFT',revision=coalesce(prior.revision,0)+1 where id=new_id;
 return (select jsonb_build_object('id',new_id,'revision',coalesce(prior.revision,0)+1,'version',to_jsonb(s)) from hub.content_section_versions s where id=v);
end $$;
create function hub.save_selling_point(public_id text,key uuid,expected integer,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare project uuid; prior hub.project_selling_points; edited hub.project_selling_points; next_key uuid; count_active integer; begin
 perform hub.content_scope_access('project',public_id,'edit');
 select id into project from hub.projects where public_project_id=public_id and deleted_at is null for update;
 next_key:=coalesce(key,gen_random_uuid());
 select * into prior from hub.project_selling_points where project_id=project and point_key=next_key order by revision desc limit 1;
 if coalesce(prior.revision,0) is distinct from expected then raise exception 'Selling point changed' using errcode='40001'; end if;
 if jsonb_typeof(body)<>'object' or exists(select 1 from jsonb_object_keys(body) k where k not in ('title','detail','icon_code','linked_feature_code','linked_fact_keys','sort','state','ai_exposure')) then
  raise exception 'Invalid selling point fields' using errcode='23514'; end if;
 edited:=jsonb_populate_record(null::hub.project_selling_points,body);
 if not hub.content_locales(edited.title,60,true) or not hub.content_locales(coalesce(edited.detail,'{}'),4000)
  or not hub.content_fact_keys(coalesce(edited.linked_fact_keys,'{}')) or coalesce(edited.state,'DRAFT') not in ('DRAFT','WITHDRAWN') then
  raise exception 'Invalid selling point' using errcode='23514'; end if;
 if edited.linked_feature_code is not null and edited.linked_feature_code not in ('vmove','joint_venture','fresh_air','pm25_filter','universal_design','low_carbon','non_dee','smart_camera','smart_app','smart_home','smart_parking','bms','solar_rooftop','ev_charger','cctv','key_card','guard_24h','easy_pass','lift_lock') then
  raise exception 'Choose a controlled feature' using errcode='23514'; end if;
 select count(*) into count_active from (select distinct on(point_key) point_key,state from hub.project_selling_points where project_id=project order by point_key,revision desc) p where state<>'WITHDRAWN' and point_key<>next_key;
 if coalesce(edited.state,'DRAFT')='DRAFT' and count_active>=6 then raise exception 'At most six selling points' using errcode='23514'; end if;
 insert into hub.project_selling_points(project_id,point_key,revision,title,detail,icon_code,linked_feature_code,linked_fact_keys,sort,state,ai_exposure)
 values(project,next_key,expected+1,edited.title,coalesce(edited.detail,'{}'),coalesce(edited.icon_code,'check'),edited.linked_feature_code,coalesce(edited.linked_fact_keys,'{}'),coalesce(edited.sort,0),coalesce(edited.state,'DRAFT'),coalesce(edited.ai_exposure,'open'));
 return (select to_jsonb(p) from hub.project_selling_points p where project_id=project and point_key=next_key and revision=expected+1);
end $$;

create function hub.faq_read(faq uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('knowledge','view');
 if faq is null then return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'question_key',f.question_key,'scope_type',f.scope_type,'scope_id',f.scope_id,
  'revision',f.revision,'state',f.state,'question',v.question,'short_answer',v.short_answer) order by f.scope_type,f.scope_id,f.id)
  from hub.faqs f left join lateral (select * from hub.faq_versions where faq_id=f.id order by version_no desc limit 1) v on true),'[]')); end if;
 if not exists(select 1 from hub.faqs where id=faq) then raise exception 'FAQ not found' using errcode='P0002'; end if;
 return (select jsonb_build_object('id',f.id,'question_key',f.question_key,'scope_type',f.scope_type,'scope_id',f.scope_id,'revision',f.revision,'state',f.state,
  'pinned_on',f.pinned_on,'version',(select to_jsonb(v) from hub.faq_versions v where faq_id=faq order by version_no desc limit 1),
  'history',coalesce((select jsonb_agg(to_jsonb(v) order by version_no desc) from hub.faq_versions v where faq_id=faq),'[]'),
  'sources',coalesce((select jsonb_agg(to_jsonb(s) order by created_at) from hub.faq_sources s where faq_id=faq),'[]')) from hub.faqs f where id=faq);
end $$;
create function hub.save_faq(faq uuid,expected integer,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid; prior hub.faqs; edited hub.faq_versions; q hub.faq_questions; next_id uuid; v uuid; kind text; ref text; begin
 actor:=hub.require_permission('knowledge','edit');
 select * into prior from hub.faqs where id=faq for update;
 if faq is not null and not found then raise exception 'FAQ not found' using errcode='P0002'; end if;
 if coalesce(prior.revision,0) is distinct from expected then raise exception 'FAQ changed' using errcode='40001'; end if;
 if jsonb_typeof(body)<>'object' or exists(select 1 from jsonb_object_keys(body) k where k not in
  ('question_key','scope_type','scope_id','question','alt_questions','short_answer','detail','answer_kind','fact_keys','applies_to_project_ids','applicability_rule','review_due','effective_to','ai_exposure','source_ref','source_url','candidate_id')) then
  raise exception 'Invalid FAQ fields' using errcode='23514'; end if;
 select * into q from hub.faq_questions where question_key=body->>'question_key' and status='approved';
 if not found then raise exception 'Choose a Manager-approved question' using errcode='23514'; end if;
 kind:=body->>'scope_type'; ref:=body->>'scope_id';
 if kind not in ('corporate','brand','programme','project_group','project','unit_type') or btrim(coalesce(ref,''))='' then raise exception 'Explicit FAQ scope required' using errcode='23514'; end if;
 if kind='corporate' and ref<>'sena' or kind='project' and not exists(select 1 from staging.rem_projects where rem_project_id=ref)
  or kind='brand' and not exists(select 1 from hub.brands where public_brand_id=ref and deleted_at is null)
  or kind='project_group' and not exists(select 1 from staging.dw_project_groups where project_group_id=ref)
  or kind='unit_type' and not exists(select 1 from hub.commercial_types where id::text=ref and deleted_at is null)
  or kind='programme' and ref not in ('LIVNEX','LIVNEX_GOLD','RENTNEX','RENTNEX_BENEFIT','RENTNEX_INVEST') then raise exception 'Unknown FAQ scope' using errcode='23514'; end if;
 if prior.id is not null and (prior.scope_type<>kind or prior.scope_id<>ref) then raise exception 'FAQ identity scope cannot change' using errcode='23514'; end if;
 edited:=jsonb_populate_record(null::hub.faq_versions,body);
 if edited.answer_kind is null or not hub.content_locales(edited.question,1000,true) or not hub.content_locales(edited.short_answer,300,true)
  or not hub.content_locales(coalesce(edited.alt_questions,'{}'),4000) or not hub.content_locales(coalesce(edited.detail,'{}'),12000)
  or not hub.content_fact_keys(coalesce(edited.fact_keys,'{}')) or edited.answer_kind<>q.answer_kind then raise exception 'Invalid FAQ text, kind or fact keys' using errcode='23514'; end if;
 if exists(select 1 from unnest(edited.applies_to_project_ids) p where not exists(select 1 from staging.rem_projects where rem_project_id=p))
  or kind='project' and edited.applies_to_project_ids is distinct from array[ref] then raise exception 'Select exact applicable REM phases' using errcode='23514'; end if;
 if coalesce(edited.applicability_rule,'{}')<>'{}' then raise exception 'Rule resolution is not enabled yet; select explicit phases' using errcode='23514'; end if;
 if body->>'source_url' is not null and (body->>'source_url' !~ '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$' or btrim(coalesce(body->>'source_ref',''))='') then
  raise exception 'Source URL requires HTTPS and an explicit reference' using errcode='23514'; end if;
 if edited.review_due is not null and edited.effective_to is not null and edited.review_due>edited.effective_to then raise exception 'Review must precede expiry' using errcode='23514'; end if;
 if prior.id is null then
  insert into hub.faqs(scope_type,scope_id,question_key,topic,reviewed_by) values(kind,ref,q.question_key,q.topic,actor) returning id into next_id;
 else next_id:=prior.id; end if;
 insert into hub.faq_versions(faq_id,version_no,question_key,question,alt_questions,short_answer,detail,answer_kind,fact_keys,applies_to_project_ids,applicability_rule,review_due,effective_to,editors,ai_exposure)
 values(next_id,expected+1,q.question_key,edited.question,coalesce(edited.alt_questions,'{}'),edited.short_answer,coalesce(edited.detail,'{}'),edited.answer_kind,coalesce(edited.fact_keys,'{}'),
  coalesce(edited.applies_to_project_ids,'{}'),'{}',edited.review_due,edited.effective_to,array[actor],coalesce(edited.ai_exposure,'open')) returning id into v;
 update hub.faqs set question_key=q.question_key,draft_version_id=v,state='DRAFT',revision=expected+1 where id=next_id;
 if btrim(coalesce(body->>'source_ref',''))<>'' then
  insert into hub.faq_sources(faq_id,candidate_id,source_ref,source_url,decided_by)
  values(next_id,(body->>'candidate_id')::uuid,body->>'source_ref',body->>'source_url',actor);
 end if;
 return hub.faq_read(next_id);
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hub'
  and p.proname=any(array['content_locales','content_fact_keys','faq_question_list','save_faq_question','approve_faq_question','project_content_sections','save_content_section','save_selling_point','faq_read','save_faq']) loop
  execute format('revoke all on function %s from public',f.signature);
  if f.proname not in ('content_locales','content_fact_keys') then execute format('grant execute on function %s to hub_app',f.signature); end if;
 end loop;
end $$;
commit;
