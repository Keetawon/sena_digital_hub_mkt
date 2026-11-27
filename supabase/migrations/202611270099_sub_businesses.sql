-- Migration 0099: Add standalone group sub-businesses (solar, senx, ngernsod_jaidee)
-- and enable standalone non-residential business KM sections & FAQ submission without residential REM phases.

begin;

-- 1. Register the three group sub-businesses in hub.businesses
insert into hub.businesses (code, label)
values
  ('solar', jsonb_build_object('th', 'เสนา โซลาร์ เอนเนอร์ยี่', 'en', 'SENA Solar Energy')),
  ('senx', jsonb_build_object('th', 'เซ็น เอกซ์', 'en', 'SenX')),
  ('ngernsod_jaidee', jsonb_build_object('th', 'เงินสดใจดี', 'en', 'Ngernsod Jaidee'))
on conflict (code) do update
set label = excluded.label;

-- 2. Keep 'residential' first in catalog references while ordering sub-businesses deterministically
create or replace function hub.business_references()
returns jsonb
language plpgsql
stable security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  perform hub.workspace_require();
  if not (hub.can('knowledge', 'view') or hub.can('brands', 'view') or hub.can('projects', 'view')) then
    raise exception 'Content view required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'items',
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('code', code, 'label', label)
          order by
            case code
              when 'residential' then 0
              when 'solar' then 1
              when 'senx' then 2
              when 'ngernsod_jaidee' then 3
              else 4
            end,
            code
        ),
        '[]'::jsonb
      )
      from hub.businesses
    )
  );
end $$;

do $$
declare
  d text;
begin
  d := replace(pg_get_functiondef('hub.faq_references()'::regprocedure), chr(13), '');
  if position('order by code),''[]'') from hub.businesses' in d) > 0 then
    d := hub.content_definition_replace(
      d,
      $old$order by code),'[]') from hub.businesses$old$,
      $new$order by case code when 'residential' then 0 when 'solar' then 1 when 'senx' then 2 when 'ngernsod_jaidee' then 3 else 4 end, code),'[]') from hub.businesses$new$
    );
    execute d;
  end if;
end $$;

-- 3. Add dedicated KM narrative section keys for standalone sub-businesses (default ai_writing_enabled = false)
insert into hub.field_catalog (
  field_key, entity, section, sort, label, help, value_kind, unit,
  source_policy, source_ref, owner_role, locales_required, required_for,
  surfaces, default_ai_exposure, review_every_days, validation, faq_question_keys, status
)
values
  (
    'section.business_overview', 'section', 'narrative', 10,
    jsonb_build_object('th', 'แนะนำหน่วยธุรกิจและจุดเด่นหลัก', 'en', 'Business Overview & Key Strengths'),
    jsonb_build_object('th', 'ข้อมูลภาพรวมธุรกิจ จุดเด่น ความเชี่ยวชาญ และกลุ่มลูกค้าเป้าหมาย ต้องตรวจภาษาอังกฤษก่อนส่งอนุมัติ'),
    'rich', null, 'mkt', null, 'Marketing', array['th', 'en'], '{}'::jsonb,
    array['web.business.sections', 'jsonld', 'llms_txt', 'chatbot'], 'open', null,
    '{"max_length": 12000, "ai_translation": true}'::jsonb, '{}'::text[], 'active'
  ),
  (
    'section.business_services', 'section', 'narrative', 20,
    jsonb_build_object('th', 'บริการหลักและขอบเขตการให้บริการ', 'en', 'Core Services & Solutions'),
    jsonb_build_object('th', 'รายละเอียดบริการหลัก โซลูชัน และขอบเขตการดูแลลูกค้าของหน่วยธุรกิจ ต้องตรวจภาษาอังกฤษก่อนส่งอนุมัติ'),
    'rich', null, 'mkt', null, 'Marketing', array['th', 'en'], '{}'::jsonb,
    array['web.business.sections', 'jsonld', 'llms_txt', 'chatbot'], 'open', null,
    '{"max_length": 12000, "ai_translation": true}'::jsonb, '{}'::text[], 'active'
  ),
  (
    'section.business_packages', 'section', 'narrative', 30,
    jsonb_build_object('th', 'แพ็กเกจ ราคาเริ่มต้น และเงื่อนไขบริการ', 'en', 'Packages, Pricing & Service Terms'),
    jsonb_build_object('th', 'รายละเอียดแพ็กเกจ ประเภทผลิตภัณฑ์ อัตราหรือเงื่อนไขเบื้องต้นสำหรับสื่อสารบนเว็บและผู้ช่วย AI'),
    'rich', null, 'mkt', null, 'Marketing', array['th', 'en'], '{}'::jsonb,
    array['web.business.sections', 'jsonld', 'llms_txt', 'chatbot'], 'open', null,
    '{"max_length": 12000, "ai_translation": true}'::jsonb, '{}'::text[], 'active'
  ),
  (
    'section.business_process', 'section', 'narrative', 40,
    jsonb_build_object('th', 'คุณสมบัติ เอกสาร และขั้นตอนรับบริการ', 'en', 'Eligibility, Documents & Service Process'),
    jsonb_build_object('th', 'ขั้นตอนการสมัครหรือรับบริการ คุณสมบัติผู้รับบริการ และเอกสารที่ต้องเตรียม'),
    'rich', null, 'mkt', null, 'Marketing', array['th', 'en'], '{}'::jsonb,
    array['web.business.sections', 'jsonld', 'llms_txt', 'chatbot'], 'open', null,
    '{"max_length": 12000, "ai_translation": true}'::jsonb, '{}'::text[], 'active'
  ),
  (
    'section.business_warranty', 'section', 'narrative', 50,
    jsonb_build_object('th', 'การรับประกัน มาตรฐาน และการดูแลหลังการขาย', 'en', 'Warranty, Standards & After-Sales Care'),
    jsonb_build_object('th', 'มาตรฐานความปลอดภัย การกำกับดูแล การรับประกันอุปกรณ์/งานติดตั้ง และการดูแลหลังการขาย'),
    'rich', null, 'mkt', null, 'Marketing', array['th', 'en'], '{}'::jsonb,
    array['web.business.sections', 'jsonld', 'llms_txt', 'chatbot'], 'open', null,
    '{"max_length": 12000, "ai_translation": true}'::jsonb, '{}'::text[], 'active'
  )
on conflict (field_key) do update
set
  label = excluded.label,
  help = excluded.help,
  surfaces = excluded.surfaces,
  status = excluded.status;

-- Allow machine translation & admin opt-in writing aid for business narrative sections while preserving all upstream keys
do $$
declare
  d text;
begin
  d := replace(pg_get_functiondef('hub.translation_allowed(text)'::regprocedure), chr(13), '');
  if position('section.business_overview' in d) = 0 then
    d := hub.content_definition_replace(
      d,
      $old$'section.corporate_services',$old$,
      $new$'section.corporate_services','section.business_overview','section.business_services','section.business_packages','section.business_process','section.business_warranty',$new$
    );
    execute d;
  end if;

  d := replace(pg_get_functiondef('hub.writing_aid_field_safe(text)'::regprocedure), chr(13), '');
  if position('section.business_overview' in d) = 0 then
    d := hub.content_definition_replace(
      d,
      $old$'section.corporate_services',$old$,
      $new$'section.corporate_services','section.business_overview','section.business_services','section.business_packages','section.business_process','section.business_warranty',$new$
    );
    execute d;
  end if;
end $$;

-- Exclude section.business_* from residential project readiness checklists
do $$
declare
  d text;
begin
  d := replace(pg_get_functiondef('hub.project_content_readiness_before_media(text)'::regprocedure), chr(13), '');
  if position('fc.field_key not like ''section.business_%''' in d) = 0 then
    d := hub.content_definition_replace(
      d,
      $old$fc.field_key not like 'section.corporate_%'$old$,
      $new$fc.field_key not like 'section.corporate_%' and fc.field_key not like 'section.business_%'$new$
    );
    execute d;
  end if;
end $$;

-- 4. Allow standalone non-residential businesses (no brand_business rows) to submit FAQs without residential REM phases,
--    while keeping residential business FAQs requiring explicit phase selection.
do $$
declare
  d text;
begin
  d := replace(pg_get_functiondef('hub.submit_faq_before_scopes(uuid,integer)'::regprocedure), chr(13), '');
  if position('not exists(select 1 from hub.brand_business where business_code=f.scope_id)' in d) = 0 then
    d := hub.content_definition_replace(
      d,
      $old$if f.scope_type<>'corporate' and cardinality(v.applies_to_project_ids)=0 then raise exception 'Explicit applicable phases required' using errcode='23514'; end if;$old$,
      $new$if f.scope_type<>'corporate' and not (f.scope_type='business' and not exists(select 1 from hub.brand_business where business_code=f.scope_id)) and cardinality(v.applies_to_project_ids)=0 then raise exception 'Explicit applicable phases required' using errcode='23514'; end if;$new$
    );
    execute d;
  end if;
end $$;

-- 5. On standalone non-residential businesses, hide residential '{project}' template questions from the default FAQ list
--    unless explicitly requested by question_key or already answered on that business.
do $$
declare
  d text;
begin
  d := replace(pg_get_functiondef('hub.workspace_faq(text,text,text,text,text,integer,text)'::regprocedure), chr(13), '');
  if position('not (kind=''business'' and not exists(select 1 from hub.brand_business where business_code=ref)' in d) = 0 then
    d := hub.content_definition_replace(
      d,
      $old$for q in select bank.* from hub.faq_questions bank where bank.status='approved'
  and (selected_key is null or bank.question_key=selected_key) order by$old$,
      $new$for q in select bank.* from hub.faq_questions bank where bank.status='approved'
  and (selected_key is null or bank.question_key=selected_key)
  and not (kind='business' and not exists(select 1 from hub.brand_business where business_code=ref) and selected_key is null
   and bank.default_level='project' and position('{project}' in coalesce(bank.question_template->>'th',''))>0
   and not exists(select 1 from hub.faqs own_b where own_b.scope_type='business' and own_b.scope_id=ref and own_b.question_key=bank.question_key and own_b.state<>'WITHDRAWN')) order by$new$
    );
    execute d;
  end if;
end $$;

commit;
