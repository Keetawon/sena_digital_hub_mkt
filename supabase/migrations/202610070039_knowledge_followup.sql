begin;
create table staging.knowledge_followup_batches (
  manifest_sha256 text primary key check(manifest_sha256 ~ '^[0-9a-f]{64}$'), manifest jsonb not null, imported_at timestamptz not null default now()
);
create table staging.knowledge_eval_questions (
  id text primary key, batch_sha256 text not null references staging.knowledge_followup_batches,
  rem_project_id text not null references staging.rem_projects, question text not null, expected_answer text not null,
  candidate_ids uuid[] not null check(cardinality(candidate_ids)>0), split text not null check(split in ('tuning','held_out')),
  holds text[] not null, source_refs text[] not null, status text not null default 'DRAFT_MKT_TO_VERIFY' check(status='DRAFT_MKT_TO_VERIFY')
);
create table staging.knowledge_promotion_annotations (
  candidate_id uuid primary key references staging.knowledge_candidates, batch_sha256 text not null references staging.knowledge_followup_batches,
  cluster_id text not null, category text not null check(category in ('promotion','text_not_promotion')),
  phash text not null, cluster_size integer not null check(cluster_size>0), ocr_end_date date,
  likely_expired boolean not null, date_unknown boolean not null
);
create table hub.knowledge_evaluation_reviews (
  question_id text primary key references staging.knowledge_eval_questions, revision integer not null,
  decision text not null check(decision in ('verified','rejected')), expected_answer text not null,
  note text not null, reviewed_at timestamptz not null default clock_timestamp(), reviewed_by uuid not null
);
create table hub.knowledge_preview_releases (
  id uuid primary key default gen_random_uuid(), rem_project_id text not null references staging.rem_projects,
  payload jsonb not null, reason text not null, created_at timestamptz not null default clock_timestamp(), created_by uuid not null
);
do $$ declare name text; begin
  foreach name in array array['knowledge_followup_batches','knowledge_eval_questions','knowledge_promotion_annotations'] loop
    execute format('alter table staging.%I enable row level security',name);
    execute format('create trigger immutable_followup before update or delete on staging.%I for each row execute function hub.reject_version_change()',name);
  end loop;
  foreach name in array array['knowledge_evaluation_reviews','knowledge_preview_releases'] loop
    execute format('alter table hub.%I enable row level security',name);
    execute format('grant select on hub.%I to editor,publisher,viewer,admin',name);
    execute format('create policy knowledge_followup_staff on hub.%I for select to editor,publisher,viewer,admin using(true)',name);
    execute format('create trigger audit_followup after insert or update or delete on hub.%I for each row execute function audit.record_change()',name);
  end loop;
end $$;
create trigger immutable_preview_release before update or delete on hub.knowledge_preview_releases for each row execute function hub.reject_version_change();

-- Evidence holds stay immutable; a reviewed exact phase can resolve the staff queue hold.
create function hub.knowledge_question_holds(question_key text) returns text[]
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce(array(select h from unnest(q.holds) h where h<>'needs_phase_decision' or exists(
   select 1 from unnest(q.candidate_ids) cid left join hub.knowledge_reviews r on r.candidate_id=cid
   where r.decision is distinct from 'accepted' or not coalesce(q.rem_project_id=any(r.applies_to_project_ids),false))), '{}')
 from staging.knowledge_eval_questions q where q.id=question_key
$$;
revoke all on function hub.knowledge_question_holds(text) from public;

create function hub.knowledge_followup(rem_id text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher','viewer','admin']);
  return jsonb_build_object('questions',coalesce((select jsonb_agg(to_jsonb(q)||jsonb_build_object('review',to_jsonb(r),'source_holds',q.holds,'holds',hub.knowledge_question_holds(q.id)) order by q.id)
    from staging.knowledge_eval_questions q left join hub.knowledge_evaluation_reviews r on r.question_id=q.id where q.rem_project_id=rem_id),'[]'),
    'promotions',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('likely_expired',coalesce(a.ocr_end_date<(now() at time zone 'Asia/Bangkok')::date,false)))
    from staging.knowledge_promotion_annotations a join staging.knowledge_candidates c on c.id=a.candidate_id where rem_id=any(c.project_ids)),'[]'),
    'preview_releases',coalesce((select jsonb_agg(jsonb_build_object('id',id,'created_at',created_at,'created_by',created_by) order by created_at desc)
      from hub.knowledge_preview_releases where rem_project_id=rem_id),'[]'));
end $$;
revoke all on function hub.knowledge_followup(text) from public;
grant execute on function hub.knowledge_followup(text) to editor,publisher,viewer,admin;

create function hub.review_knowledge_question(question_key text,expected_revision integer,choice text,answer text,reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid; prior hub.knowledge_evaluation_reviews; question staging.knowledge_eval_questions; result jsonb;
begin
  actor:=hub.require_actor(array['editor','admin']);
  if choice not in ('verified','rejected') or btrim(coalesce(answer,''))='' or btrim(coalesce(reason,''))='' then raise exception 'ต้องระบุผลตรวจ คำตอบ และเหตุผล' using errcode='23514'; end if;
  select * into question from staging.knowledge_eval_questions where id=question_key for update;
  if not found then raise exception 'ไม่พบคำถาม' using errcode='P0002'; end if;
  select * into prior from hub.knowledge_evaluation_reviews where question_id=question_key;
  if coalesce(prior.revision,0)<>expected_revision then raise exception 'ผลตรวจเปลี่ยนแล้ว กรุณาโหลดใหม่' using errcode='40001'; end if;
  if choice='verified' and cardinality(hub.knowledge_question_holds(question_key))>0 then raise exception 'คำถามยังมีขอบเขตหรือข้อขัดแย้งที่ต้องแก้ก่อน' using errcode='23514'; end if;
  perform set_config('app.change_reason',reason,true);
  insert into hub.knowledge_evaluation_reviews values(question_key,expected_revision+1,choice,answer,reason,clock_timestamp(),actor)
    on conflict(question_id) do update set revision=excluded.revision,decision=excluded.decision,expected_answer=excluded.expected_answer,note=excluded.note,reviewed_at=excluded.reviewed_at,reviewed_by=excluded.reviewed_by returning to_jsonb(knowledge_evaluation_reviews) into result;
  return result;
end $$;
revoke all on function hub.review_knowledge_question(text,integer,text,text,text) from public;
grant execute on function hub.review_knowledge_question(text,integer,text,text,text) to editor,admin;

-- One explicitly selected primary hero per exact project/phase; imported suggestions remain evidence.
alter function hub.review_knowledge_candidate(uuid,integer,text,text[],text,boolean,text,text) rename to review_knowledge_candidate_before_hero;
revoke all on function hub.review_knowledge_candidate_before_hero(uuid,integer,text,text[],text,boolean,text,text) from public,editor,admin;
create function hub.review_knowledge_candidate(candidate uuid,expected_revision integer,choice text,projects text[],reason text,owned boolean,role_name text,alt_text text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare pid text;
begin
  perform hub.require_actor(array['editor','admin']);
  if role_name is not null and exists(select 1 from staging.knowledge_candidates where id=candidate and kind<>'asset') then
    raise exception 'บทบาทไฟล์ใช้ได้เฉพาะรายการสื่อ' using errcode='23514'; end if;
  for pid in select distinct p from unnest(projects||coalesce((select applies_to_project_ids from hub.knowledge_reviews where candidate_id=candidate),'{}')) p order by p loop
    perform pg_advisory_xact_lock(hashtextextended('knowledge-preview:'||pid,0));
  end loop;
  if choice='accepted' and role_name='hero' and exists(select 1 from hub.knowledge_reviews where candidate_id<>candidate
    and decision='accepted' and asset_role='hero' and applies_to_project_ids && projects) then
    raise exception 'เลือกภาพหลักได้หนึ่งภาพต่อโครงการ เปลี่ยนภาพเดิมเป็นแกลเลอรีก่อน' using errcode='23514';
  end if;
  return hub.review_knowledge_candidate_before_hero(candidate,expected_revision,choice,projects,reason,owned,role_name,alt_text);
end $$;
revoke all on function hub.review_knowledge_candidate(uuid,integer,text,text[],text,boolean,text,text) from public;
grant execute on function hub.review_knowledge_candidate(uuid,integer,text,text[],text,boolean,text,text) to editor,admin;

create function hub.publish_knowledge_preview(rem_id text,expected jsonb,reason text) returns uuid
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid; actual jsonb; media jsonb; sections jsonb; chunks jsonb; card jsonb; result uuid;
begin
  actor:=hub.require_actor(array['publisher']);
  if btrim(coalesce(reason,''))='' then raise exception 'ต้องระบุเหตุผล' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended('knowledge-preview:'||rem_id,0));
  select payload||jsonb_build_object('model_catalogue_complete',hub.knowledge_model_catalogue(rem_id)) into card from rag.project_fact_cards where rem_project_id=rem_id;
  if not found then raise exception 'ไม่พบโครงการนำร่อง' using errcode='P0002'; end if;
  if card#>>'{status,raw}'='3' then raise exception 'โครงการปิดแล้ว ใช้เป็นกรณีทดสอบการส่งต่อเท่านั้น' using errcode='23514'; end if;
  perform 1 from hub.knowledge_reviews r where rem_id=any(r.applies_to_project_ids) for update;
  select coalesce(jsonb_object_agg(candidate_id::text,revision),'{}') into actual from hub.knowledge_reviews where rem_id=any(applies_to_project_ids) and decision='accepted';
  if actual<>expected then raise exception 'ผลตรวจเปลี่ยนแล้ว กรุณาตรวจพรีวิวใหม่' using errcode='40001'; end if;
  if (select count(*) from hub.knowledge_reviews r join staging.knowledge_candidates c on c.id=r.candidate_id
      where c.kind='asset' and rem_id=any(r.applies_to_project_ids) and r.decision='accepted' and r.asset_role='hero')<>1 then
    raise exception 'ต้องมีภาพหลักที่ MKT เลือกหนึ่งภาพต่อโครงการ' using errcode='23514'; end if;
  perform 1 from hub.assets a join hub.knowledge_asset_links l on l.asset_id=a.id join hub.knowledge_reviews r on r.candidate_id=l.candidate_id
    where rem_id=any(r.applies_to_project_ids) and r.decision='accepted' order by a.id for update of a;
  if exists(select 1 from staging.knowledge_candidates c join hub.knowledge_reviews r on r.candidate_id=c.id
    left join hub.knowledge_asset_links l on l.candidate_id=c.id left join hub.assets a on a.id=l.asset_id
    where rem_id=any(r.applies_to_project_ids) and r.decision='accepted' and c.kind='asset'
      and (l.review_revision<>r.revision or a.id is null or a.deleted_at is not null or a.rights_status<>'approved'
        or a.effective_from>now() or a.effective_to<=now())) then raise exception 'ไฟล์ที่เลือกยังไม่มีสิทธิ์ปัจจุบันที่อนุมัติ' using errcode='23514'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('candidate_id',c.id,'kind',c.kind,'evidence',c.evidence,'source_ref',c.source_ref,'source_url',c.source_url,'batch_sha256',c.batch_sha256)),'[]') into sections
    from staging.knowledge_candidates c join hub.knowledge_reviews r on r.candidate_id=c.id where rem_id=any(r.applies_to_project_ids) and r.decision='accepted' and c.kind in ('section','faq');
  if jsonb_array_length(sections)=0 then raise exception 'ยังไม่มีเนื้อหาหรือคำถามที่ตรวจรับแล้ว' using errcode='23514'; end if;
  if exists(select 1 from jsonb_array_elements(sections) c where not exists(select 1 from rag.knowledge_preview_chunks k where k.candidate_id=(c->>'candidate_id')::uuid and rem_id=any(k.project_ids))) then
    raise exception 'บางรายการยังไม่มีดัชนีสำหรับระยะที่เลือก ต้องเตรียมดัชนีก่อน' using errcode='23514'; end if;
  select coalesce(jsonb_agg(to_jsonb(k)||c),'[]') into chunks from rag.knowledge_preview_chunks k join jsonb_array_elements(sections) c on (c->>'candidate_id')::uuid=k.candidate_id where rem_id=any(k.project_ids);
  select coalesce(jsonb_agg(jsonb_build_object('candidate_id',r.candidate_id,'asset_id',l.asset_id,'role',r.asset_role,'alt_th',r.alt_th)),'[]') into media from hub.knowledge_reviews r
    join hub.knowledge_asset_links l on l.candidate_id=r.candidate_id where rem_id=any(r.applies_to_project_ids) and r.decision='accepted';
  perform set_config('app.change_reason',reason,true);
  insert into hub.knowledge_preview_releases(rem_project_id,payload,reason,created_by)
    values(rem_id,jsonb_build_object('mode','PRIVATE_PREVIEW','fact_card',card,'reviews',actual,'sections',sections,'chunks',chunks,'assets',media),reason,actor) returning id into result;
  return result;
end $$;
revoke all on function hub.publish_knowledge_preview(text,jsonb,text) from public;
grant execute on function hub.publish_knowledge_preview(text,jsonb,text) to publisher;
commit;
