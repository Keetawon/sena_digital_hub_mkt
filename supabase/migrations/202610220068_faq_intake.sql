-- Phase 4 (K2): regenerable FAQ intake clusters and audited per-cluster decisions.
-- Additive only. Candidates, reviews, FAQs and accounts are never rewritten; every
-- created answer goes through Phase 2's hub.save_faq and nothing is published.
begin;
create table staging.faq_clusters (
 id uuid primary key default gen_random_uuid(),
 cluster_key text not null unique check(cluster_key ~ '^[0-9a-f]{64}$'),
 generation_sha256 text not null check(generation_sha256 ~ '^[0-9a-f]{64}$'),
 algorithm text not null check(btrim(algorithm)<>''),
 sort_key integer not null check(sort_key>0),
 template text not null,
 member_candidate_ids uuid[] not null check(cardinality(member_candidate_ids)>0),
 variants jsonb not null check(jsonb_typeof(variants)='array' and jsonb_array_length(variants)>0),
 answer_groups jsonb not null check(jsonb_typeof(answer_groups)='array'),
 project_ids text[] not null default '{}', brand_ids text[] not null default '{}',
 holds text[] not null default '{}' check(holds <@ array['numeric','commercial','programme_terms','phase_decision','mapping_conflict','prompt_injection','closed_project']),
 suggested_question_key text, suggested_level text not null check(suggested_level in ('corporate','brand','programme','project_group','project','unit_type')),
 suggested_kind text not null check(suggested_kind in ('text','fact','handoff','auto')),
 suggestion_score numeric, suggestion_basis text not null check(suggestion_basis in ('question_bank','heuristic')),
 revision integer not null default 1
);
create index faq_cluster_members on staging.faq_clusters using gin(member_candidate_ids);
create index faq_cluster_order on staging.faq_clusters(sort_key,id);

create table hub.faq_intake_decisions (
 id uuid primary key default gen_random_uuid(),
 cluster_id uuid not null references staging.faq_clusters,
 cluster_revision integer not null,
 decision text not null check(decision in ('answer_created','rejected','held','question_proposed')),
 candidate_ids uuid[] not null check(cardinality(candidate_ids)>0),
 faq_id uuid references hub.faqs, faq_version_no integer, question_key text,
 hold_code text check(hold_code in ('numeric','commercial','programme_terms','phase_decision','mapping_conflict','prompt_injection','closed_project','other')),
 note text check(char_length(note)<=2000),
 decided_by uuid not null, decided_at timestamptz not null default clock_timestamp(),
 check(decision<>'answer_created' or faq_id is not null),
 check(decision not in ('rejected','held') or btrim(coalesce(note,''))<>''),
 check(decision<>'held' or hold_code is not null),
 check(decision<>'question_proposed' or question_key is not null)
);
create index faq_intake_decision_cluster on hub.faq_intake_decisions(cluster_id,decided_at desc,id);

do $$ declare name text; begin
 foreach name in array array['staging.faq_clusters','hub.faq_intake_decisions'] loop
  execute format('alter table %s add column created_at timestamptz not null default clock_timestamp(),
    add column created_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid,
    add column updated_at timestamptz not null default clock_timestamp(),
    add column updated_by uuid default nullif(current_setting(''app.actor_id'',true),'''')::uuid',name);
  execute format('alter table %s enable row level security',name);
  execute format('alter table %s force row level security',name);
  execute format('create policy intake_owner on %s to %I using(true) with check(true)',name,current_user);
  execute format('revoke all on %s from public',name);
  execute format('create trigger intake_audit after insert or update or delete on %s for each row execute function audit.record_change()',name);
  execute format('create trigger intake_touch before update on %s for each row execute function hub.touch_record()',name);
 end loop;
end $$;
-- Decisions are an append-only audit trail.
create trigger intake_decision_immutable before update or delete on hub.faq_intake_decisions
 for each row execute function hub.reject_version_change();

-- Operator-only regeneration (scripts/generate-faq-clusters.py). Clusters with any
-- decision are frozen; their members are never regrouped. Undecided clusters are
-- derived data and are replaced as a whole.
create function staging.replace_faq_clusters(generation text,algorithm_name text,rows jsonb) returns jsonb
language plpgsql set search_path=pg_catalog,pg_temp as $$
declare removed integer; inserted integer; frozen integer; begin
 if generation !~ '^[0-9a-f]{64}$' or jsonb_typeof(rows)<>'array' then raise exception 'Invalid cluster generation' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended('faq-clusters',0));
 delete from staging.faq_clusters c where not exists(select 1 from hub.faq_intake_decisions d where d.cluster_id=c.id);
 get diagnostics removed=row_count;
 select count(*) into frozen from staging.faq_clusters;
 if exists(select 1 from jsonb_array_elements(rows) r cross join lateral jsonb_array_elements_text(r->'member_candidate_ids') m
   where exists(select 1 from staging.faq_clusters c where m::uuid=any(c.member_candidate_ids))) then
  raise exception 'A decided candidate cannot be regrouped' using errcode='23514'; end if;
 if exists(select 1 from jsonb_array_elements(rows) r cross join lateral jsonb_array_elements_text(r->'member_candidate_ids') m
   where not exists(select 1 from staging.knowledge_candidates k where k.id=m::uuid and k.kind='faq')) then
  raise exception 'Cluster members must be FAQ candidates' using errcode='23514'; end if;
 insert into staging.faq_clusters(cluster_key,generation_sha256,algorithm,sort_key,template,member_candidate_ids,variants,answer_groups,
  project_ids,brand_ids,holds,suggested_question_key,suggested_level,suggested_kind,suggestion_score,suggestion_basis)
 select r->>'cluster_key',generation,algorithm_name,frozen+(r->>'sort_key')::integer,r->>'template',
  array(select jsonb_array_elements_text(r->'member_candidate_ids')::uuid),r->'variants',r->'answer_groups',
  array(select jsonb_array_elements_text(r->'project_ids')),array(select jsonb_array_elements_text(r->'brand_ids')),
  array(select jsonb_array_elements_text(r->'holds')),r->>'suggested_question_key',r->>'suggested_level',r->>'suggested_kind',
  (r->>'suggestion_score')::numeric,r->>'suggestion_basis'
 from jsonb_array_elements(rows) r;
 get diagnostics inserted=row_count;
 return jsonb_build_object('removed',removed,'inserted',inserted,'frozen',frozen);
end $$;
revoke all on function staging.replace_faq_clusters(text,text,jsonb) from public;

create function hub.faq_intake_text(value text) returns text
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select btrim(regexp_replace(lower(normalize(regexp_replace(coalesce(value,''),'^[^—\n]{1,200}\s—\s',''),nfc)),'\s+',' ','g'))
$$;
create function hub.faq_intake_state(cluster uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce((select jsonb_build_object('state',case d.decision when 'answer_created' then 'decided' when 'rejected' then 'decided'
   when 'held' then 'held' else 'question_proposed' end,'decision',d.decision,'hold_code',d.hold_code,'faq_id',d.faq_id,
   'question_key',d.question_key,'decided_at',d.decided_at)
  from hub.faq_intake_decisions d where d.cluster_id=cluster order by d.decided_at desc,d.id desc limit 1),jsonb_build_object('state','open'))
$$;
create function hub.faq_intake_clusters(filters jsonb default '{}',after_sort integer default 0,page_size integer default 25) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare f jsonb:=coalesce(filters,'{}'); size integer:=least(greatest(coalesce(page_size,25),1),100); result jsonb; begin
 perform hub.require_permission('knowledge','view');
 if jsonb_typeof(f)<>'object' or exists(select 1 from jsonb_object_keys(f) k where k not in ('level','kind','hold','brand','state')) then
  raise exception 'Invalid intake filter' using errcode='23514'; end if;
 with base as (
  select c.*,hub.faq_intake_state(c.id) s from staging.faq_clusters c
 ), matched as (
  select * from base where (f->>'level' is null or suggested_level=f->>'level') and (f->>'kind' is null or suggested_kind=f->>'kind')
   and (f->>'hold' is null or (f->>'hold'='none' and cardinality(holds)=0) or f->>'hold'=any(holds))
   and (f->>'brand' is null or f->>'brand'=any(brand_ids)) and (f->>'state' is null or s->>'state'=f->>'state')
 ), page as (
  select * from matched where sort_key>coalesce(after_sort,0) order by sort_key limit size
 )
 select jsonb_build_object(
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'sort_key',p.sort_key,'revision',p.revision,'template',p.template,
    'question',p.variants->0->>'question','variant_count',jsonb_array_length(p.variants),'answer_group_count',jsonb_array_length(p.answer_groups),
    'project_ids',p.project_ids,'brand_ids',p.brand_ids,'holds',p.holds,'suggested_question_key',p.suggested_question_key,
    'suggested_level',p.suggested_level,'suggested_kind',p.suggested_kind,'suggestion_basis',p.suggestion_basis,'status',p.s) order by p.sort_key) from page p),'[]'),
  'next_after',(select case when count(*)=size then max(sort_key) end from page),
  'filtered_total',(select count(*) from matched),
  'counts',(select jsonb_build_object('total',count(*),'decided',count(*) filter(where s->>'state'='decided'),'held',count(*) filter(where s->>'state'='held'),
    'question_proposed',count(*) filter(where s->>'state'='question_proposed'),'open',count(*) filter(where s->>'state'='open')) from base),
  'brands',coalesce((select jsonb_agg(jsonb_build_object('id',b.rem_brand_id,'name',coalesce(h.public_name->>'th',b.brand_name_rem),'count',b.n) order by b.rem_brand_id)
    from (select x.rem_brand_id,max(r.brand_name_rem) brand_name_rem,count(*) n from base cross join lateral unnest(base.brand_ids) x(rem_brand_id)
     left join staging.rem_brands r on r.rem_brand_id=x.rem_brand_id group by x.rem_brand_id) b
    left join hub.brands h on h.rem_brand_id=b.rem_brand_id and h.deleted_at is null),'[]'),
  'generation',(select jsonb_build_object('generation_sha256',generation_sha256,'algorithm',algorithm,'generated_at',max(created_at))
    from staging.faq_clusters group by generation_sha256,algorithm order by max(created_at) desc limit 1)) into result;
 return result;
end $$;
create function hub.faq_intake_cluster(cluster uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare c staging.faq_clusters; begin
 perform hub.require_permission('knowledge','view');
 select * into c from staging.faq_clusters where id=cluster;
 if not found then raise exception 'Cluster not found' using errcode='P0002'; end if;
 return jsonb_build_object('id',c.id,'revision',c.revision,'sort_key',c.sort_key,'template',c.template,'holds',c.holds,
  'variants',c.variants,'answer_groups',c.answer_groups,'project_ids',c.project_ids,'brand_ids',c.brand_ids,
  'suggestion',jsonb_build_object('question_key',c.suggested_question_key,'level',c.suggested_level,'kind',c.suggested_kind,
   'score',c.suggestion_score,'basis',c.suggestion_basis,'question',(select to_jsonb(q) from hub.faq_questions q where q.question_key=c.suggested_question_key)),
  'status',hub.faq_intake_state(c.id),
  'projects',coalesce((select jsonb_agg(jsonb_build_object('id',p.rem_project_id,'name',p.project_name_rem,'rem_brand_id',p.rem_brand_id,
    'closed',hub.project_source_review(p.rem_project_id)->>'status_raw'='3') order by p.rem_project_id)
    from staging.rem_projects p where p.rem_project_id=any(c.project_ids)),'[]'),
  'brands',coalesce((select jsonb_agg(jsonb_build_object('rem_brand_id',r.rem_brand_id,'public_brand_id',h.public_brand_id,'name',coalesce(h.public_name->>'th',r.brand_name_rem)) order by r.rem_brand_id)
    from staging.rem_brands r left join hub.brands h on h.rem_brand_id=r.rem_brand_id and h.deleted_at is null where r.rem_brand_id=any(c.brand_ids)),'[]'),
  'existing_faqs',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'scope_type',f.scope_type,'scope_id',f.scope_id,'revision',f.revision,'state',f.state) order by f.scope_type,f.scope_id)
    from hub.faqs f where f.question_key=c.suggested_question_key and f.state<>'WITHDRAWN'),'[]'),
  'decisions',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'decision',d.decision,'hold_code',d.hold_code,'note',d.note,'faq_id',d.faq_id,
    'faq_version_no',d.faq_version_no,'question_key',d.question_key,'candidate_ids',d.candidate_ids,'decided_by',d.decided_by,'decided_at',d.decided_at) order by d.decided_at desc,d.id desc)
    from hub.faq_intake_decisions d where d.cluster_id=c.id),'[]'));
end $$;

create function hub.decide_faq_cluster(cluster uuid,expected integer,choice text,body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid; c staging.faq_clusters; prior jsonb; members uuid[]; answer jsonb; q hub.faq_questions; existing hub.faqs;
 target uuid; saved jsonb; scope text; ref text; applies text[]; selling text:='ราคา|โปรโมชั่น|โปรโมชัน|ส่วนลด|ค่าส่วนกลาง|ค่าเช่า|ดอกเบี้ย|ผ่อน|เงินดาวน์|เงินจอง|ห้องว่าง|ยูนิตว่าง|บาท|price|promotion|discount|deposit|rent|interest|available';
begin
 actor:=hub.require_permission('knowledge','edit');
 if jsonb_typeof(coalesce(body,'{}'))<>'object' then raise exception 'Invalid intake decision' using errcode='23514'; end if;
 select * into c from staging.faq_clusters where id=cluster for update;
 if not found then raise exception 'Cluster not found' using errcode='P0002'; end if;
 if c.revision is distinct from expected then raise exception 'Cluster changed' using errcode='40001'; end if;
 prior:=hub.faq_intake_state(c.id);
 if prior->>'state'='decided' then raise exception 'Cluster already decided' using errcode='23514'; end if;
 members:=case when jsonb_typeof(body->'candidate_ids')='array' then array(select jsonb_array_elements_text(body->'candidate_ids')::uuid) else c.member_candidate_ids end;
 if cardinality(members)=0 or not members <@ c.member_candidate_ids then raise exception 'Choose candidates from this cluster' using errcode='23514'; end if;

 if choice='reject' then
  if btrim(coalesce(body->>'note',''))='' then raise exception 'A rejection reason is required' using errcode='23514'; end if;
  insert into hub.faq_intake_decisions(cluster_id,cluster_revision,decision,candidate_ids,note,decided_by)
  values(c.id,c.revision,'rejected',members,body->>'note',actor);
 elsif choice='hold' then
  if btrim(coalesce(body->>'note',''))='' then raise exception 'A hold reason is required' using errcode='23514'; end if;
  insert into hub.faq_intake_decisions(cluster_id,cluster_revision,decision,candidate_ids,hold_code,note,decided_by)
  values(c.id,c.revision,'held',members,coalesce(body->>'hold_code','other'),body->>'note',actor);
 elsif choice='propose_question' then
  -- D6: Marketing proposes; the existing approve-level action activates it.
  if exists(select 1 from hub.faq_questions where question_key=body->>'question_key') then raise exception 'Question key already exists' using errcode='23514'; end if;
  perform hub.save_faq_question(body->>'question_key',0,coalesce(body->'question','{}'));
  insert into hub.faq_intake_decisions(cluster_id,cluster_revision,decision,candidate_ids,question_key,note,decided_by)
  values(c.id,c.revision,'question_proposed',members,body->>'question_key',body->>'note',actor);
 elsif choice='create' then
  answer:=coalesce(body->'answer','{}');
  if c.holds && array['prompt_injection','programme_terms'] then
   raise exception 'This cluster can only be rejected or held until its hold is resolved' using errcode='23514'; end if;
  select * into q from hub.faq_questions where question_key=answer->>'question_key' and status='approved';
  if not found then raise exception 'Choose a Manager-approved question' using errcode='23514'; end if;
  scope:=answer->>'scope_type'; ref:=answer->>'scope_id';
  applies:=coalesce(array(select jsonb_array_elements_text(answer->'applies_to_project_ids')),'{}');
  if scope<>'corporate' and cardinality(applies)=0 then raise exception 'Select explicit applicable REM phases' using errcode='23514'; end if;
  -- Commercial or numeric source text must be rewritten, never accepted unchanged.
  if c.holds && array['numeric','commercial'] and exists(select 1 from staging.knowledge_candidates k where k.id=any(members) and hub.faq_intake_text(k.evidence#>>'{short_answer,th}')<>''
    and hub.faq_intake_text(k.evidence#>>'{short_answer,th}') in (hub.faq_intake_text(answer#>>'{short_answer,th}'),hub.faq_intake_text(answer#>>'{detail,th}'))) then
   raise exception 'Commercial or numeric source text must be edited before saving' using errcode='23514'; end if;
  -- A closed REM phase never receives selling content.
  if exists(select 1 from unnest(applies||case when scope='project' then array[ref] else '{}'::text[] end) p where hub.project_source_review(p)->>'status_raw'='3')
   and (q.topic in ('commercial_terms','investment_context','buying_process','programmes')
    or concat_ws(' ',answer#>>'{question,th}',answer#>>'{short_answer,th}',answer#>>'{detail,th}') ~* selling) then
   raise exception 'A closed project cannot receive selling content' using errcode='23514'; end if;
  select * into existing from hub.faqs where question_key=q.question_key and scope_type=scope and scope_id=ref and state<>'WITHDRAWN' order by id limit 1;
  target:=nullif(body->>'faq_id','')::uuid;
  if existing.id is not null and target is distinct from existing.id then
   raise exception 'An answer for this question and scope already exists; add a version to it' using errcode='23514'; end if;
  if target is not null and existing.id is null then raise exception 'FAQ not found for this question and scope' using errcode='P0002'; end if;
  saved:=hub.save_faq(target,coalesce(existing.revision,0),
   (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(answer) where key in ('question_key','scope_type','scope_id','question','alt_questions',
    'short_answer','detail','answer_kind','fact_keys','applies_to_project_ids','review_due','effective_to','ai_exposure')));
  insert into hub.faq_sources(faq_id,candidate_id,cluster_id,source_url,source_ref,decided_by)
  select (saved->>'id')::uuid,k.id,c.id,k.source_url,k.source_ref,actor from staging.knowledge_candidates k where k.id=any(members) order by k.id;
  insert into hub.faq_intake_decisions(cluster_id,cluster_revision,decision,candidate_ids,faq_id,faq_version_no,question_key,note,decided_by)
  values(c.id,c.revision,'answer_created',members,(saved->>'id')::uuid,(saved#>>'{version,version_no}')::integer,q.question_key,body->>'note',actor);
 else
  raise exception 'Invalid intake decision' using errcode='23514';
 end if;
 update staging.faq_clusters set revision=revision+1 where id=c.id;
 return hub.faq_intake_cluster(c.id);
end $$;

revoke all on function hub.faq_intake_text(text),hub.faq_intake_state(uuid),hub.faq_intake_clusters(jsonb,integer,integer),
 hub.faq_intake_cluster(uuid),hub.decide_faq_cluster(uuid,integer,text,jsonb) from public;
grant execute on function hub.faq_intake_clusters(jsonb,integer,integer),hub.faq_intake_cluster(uuid),hub.decide_faq_cluster(uuid,integer,text,jsonb) to hub_app;
commit;
