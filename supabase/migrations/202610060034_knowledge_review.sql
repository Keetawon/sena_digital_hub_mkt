-- Local pilot knowledge review. No existing RLS, readiness or publication changes.
begin;
create extension if not exists pg_trgm;

create table staging.knowledge_batches (
  manifest_sha256 text primary key check(manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest jsonb not null,
  imported_at timestamptz not null default now()
);
create trigger immutable_knowledge_batch before update or delete on staging.knowledge_batches
  for each row execute function hub.reject_version_change();

create table staging.knowledge_candidates (
  id uuid primary key default gen_random_uuid(),
  batch_sha256 text not null references staging.knowledge_batches,
  source_key text not null,
  kind text not null check(kind in ('section','faq','fact','facility','nearby','alias','asset','promotion','gap','programme')),
  project_ids text[] not null default '{}',
  programme_ids text[] not null default '{}',
  topic text not null,
  source_url text,
  source_ref text not null,
  evidence jsonb not null,
  holds text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique(batch_sha256,source_key)
);
create index knowledge_candidate_projects on staging.knowledge_candidates using gin(project_ids);
create index knowledge_candidate_alias_trgm on staging.knowledge_candidates using gin((evidence->>'normalized_alias') gin_trgm_ops) where kind='alias';
create trigger immutable_knowledge_candidate before update or delete on staging.knowledge_candidates
  for each row execute function hub.reject_version_change();

create table hub.knowledge_reviews (
  candidate_id uuid primary key references staging.knowledge_candidates,
  revision integer not null default 1,
  decision text not null check(decision in ('accepted','rejected','missing')),
  applies_to_project_ids text[] not null,
  note text not null check(btrim(note)<>''),
  sena_owned boolean not null default false,
  asset_role text,
  alt_th text,
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default clock_timestamp()
);
create table hub.content_sections (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null unique references staging.knowledge_candidates,
  scope_type text not null check(scope_type in ('brand','rem_project_group','project','unit_type','programme')),
  scope_id text not null,
  applies_to_project_ids text[] not null,
  topic text not null,
  title jsonb not null, body jsonb not null, summary jsonb not null default '{}',
  keywords text[] not null default '{}',
  source_url text, source_ref text not null,
  version integer not null default 1,
  status text not null default 'DRAFT' check(status='DRAFT'),
  reviewed_by uuid not null, reviewed_at timestamptz not null default clock_timestamp()
);
create table hub.faqs (
  id uuid primary key default gen_random_uuid(), candidate_id uuid not null unique references staging.knowledge_candidates,
  scope_type text not null, scope_id text not null, applies_to_project_ids text[] not null,
  topic text not null, canonical_question jsonb not null, alt_questions jsonb not null default '{}',
  short_answer jsonb not null, live_fact_key text, source_url text, source_ref text not null,
  version integer not null default 1, status text not null default 'DRAFT' check(status='DRAFT'),
  reviewed_by uuid not null, reviewed_at timestamptz not null default clock_timestamp()
);
create table hub.entity_aliases (
  id uuid primary key default gen_random_uuid(), candidate_id uuid not null references staging.knowledge_candidates,
  entity_type text not null check(entity_type in ('project','brand','rem_project_group','unit_type','programme','knowledge_term')),
  entity_id text not null, alias text not null, normalized_alias text not null, locale text not null default 'th',
  status text not null default 'DRAFT' check(status='DRAFT'), source_ref text not null,
  unique(candidate_id,entity_type,entity_id,normalized_alias)
);
create index knowledge_alias_trgm on hub.entity_aliases using gin(normalized_alias gin_trgm_ops);
create table hub.content_gaps (
  id uuid primary key default gen_random_uuid(), project_id text references staging.rem_projects,
  gap_code text not null, suggested_owner text not null default 'MKT project owner',
  candidate_id uuid references staging.knowledge_candidates,
  question_sha256 text, created_at timestamptz not null default now(),
  created_by uuid not null default nullif(current_setting('app.actor_id',true),'')::uuid
);
-- Facts remain typed review candidates, never implied approved by import.
create table hub.knowledge_fact_candidates (
  candidate_id uuid primary key references staging.knowledge_candidates,
  project_ids text[] not null, fact_key text not null,
  value_text text, value_number numeric, unit text, as_of timestamptz,
  valid_from timestamptz, valid_to timestamptz, owner_name text,
  status text not null default 'DRAFT' check(status='DRAFT'),
  reviewed_by uuid not null, reviewed_at timestamptz not null default clock_timestamp(),
  check(num_nonnulls(value_text,value_number)=1)
);
create table hub.knowledge_asset_links (
  candidate_id uuid primary key references staging.knowledge_candidates,
  asset_id uuid not null references hub.assets,
  review_revision integer not null,
  created_at timestamptz not null default now()
);
-- Exact cosine over a project-filtered preview subset. No public grants/index or HNSW.
-- real[] keeps the Windows embedded PostgreSQL pilot executable without an absent vector DLL.
create table rag.knowledge_preview_chunks (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references staging.knowledge_candidates,
  project_ids text[] not null, locale text not null,
  variant integer not null default 0,
  chunk_text text not null, keywords text[] not null,
  content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
  embedding_model text not null, embedding real[] not null,
  unique(candidate_id,locale,variant),
  check(cardinality(embedding)=1536)
);
create index knowledge_preview_scope on rag.knowledge_preview_chunks using gin(project_ids);
create table rag.project_fact_cards (
  rem_project_id text primary key references staging.rem_projects,
  batch_sha256 text not null references staging.knowledge_batches,
  payload jsonb not null,
  mode text not null default 'DRAFT_PREVIEW' check(mode='DRAFT_PREVIEW')
);

do $$ declare n text; s text; begin
  foreach s in array array['staging','hub','rag'] loop
    for n in select table_name from information_schema.tables where table_schema=s and
      table_name=any(array['knowledge_batches','knowledge_candidates','knowledge_reviews','content_sections','faqs','entity_aliases','content_gaps','knowledge_fact_candidates','knowledge_asset_links','knowledge_preview_chunks','project_fact_cards']) loop
      execute format('alter table %I.%I enable row level security',s,n);
      execute format('revoke all on %I.%I from public,service_consumer,agency,online_staff',s,n);
      execute format('grant select on %I.%I to editor,publisher,viewer,admin',s,n);
      execute format('create policy knowledge_staff_read on %I.%I for select to editor,publisher,viewer,admin using (true)',s,n);
      if s='hub' then execute format('create trigger audit_knowledge after insert or update or delete on %I.%I for each row execute function audit.record_change()',s,n); end if;
    end loop;
  end loop;
end $$;
grant usage on schema rag to editor,publisher,viewer,admin;

create function hub.review_knowledge_candidate(candidate uuid, expected_revision integer, choice text,
  projects text[], reason text, owned boolean, role_name text, alt_text text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid; c staging.knowledge_candidates; prior hub.knowledge_reviews; next_revision integer;
begin
  actor:=hub.require_actor(array['editor','admin']);
  if choice not in ('accepted','rejected','missing') or btrim(coalesce(reason,''))='' or projects is null then
    raise exception 'Review decision, scope and reason required' using errcode='23514'; end if;
  select * into c from staging.knowledge_candidates where id=candidate for update;
  if not found then raise exception 'Candidate not found' using errcode='P0002'; end if;
  select * into prior from hub.knowledge_reviews where candidate_id=candidate;
  if expected_revision is distinct from coalesce(prior.revision,0) then raise exception 'Review changed' using errcode='40001'; end if;
  if not projects <@ c.project_ids or exists(select 1 from unnest(projects) p where not exists(select 1 from staging.rem_projects r where r.rem_project_id=p)) then
    raise exception 'Scope must be selected from exact source projects' using errcode='23514'; end if;
  if choice='accepted' and (cardinality(projects)=0 and cardinality(c.programme_ids)=0 and not (c.kind='alias' and c.evidence->>'entity_type'='knowledge_term')) then
    raise exception 'Explicit applicability required' using errcode='23514'; end if;
  if choice='accepted' and c.holds && array['numeric_claim','commercial_text','mapping_conflict','prompt_injection','invalid_promotion','undated_promotion'] then
    raise exception 'Held claim requires a separate corrected candidate' using errcode='23514'; end if;
  if choice='accepted' and 'TPRAK'=any(projects) and c.kind in ('section','faq','fact','facility','nearby','asset','promotion','programme') then
    raise exception 'Closed shared phase cannot receive selling content or current facts' using errcode='23514'; end if;
  if choice='accepted' and c.kind='asset' and (role_name is null or role_name not in ('hero','gallery','master_plan','floor_plan','unit_plan','brochure','promotion_banner') or btrim(coalesce(alt_text,''))='') then
    raise exception 'Asset role and Thai alternative text required' using errcode='23514'; end if;
  next_revision:=coalesce(prior.revision,0)+1;
  perform set_config('app.change_reason',reason,true);
  insert into hub.knowledge_reviews(candidate_id,revision,decision,applies_to_project_ids,note,sena_owned,asset_role,alt_th,reviewed_by)
    values(candidate,next_revision,choice,projects,reason,coalesce(owned,false),role_name,alt_text,actor)
    on conflict(candidate_id) do update set revision=excluded.revision,decision=excluded.decision,
      applies_to_project_ids=excluded.applies_to_project_ids,note=excluded.note,sena_owned=excluded.sena_owned,
      asset_role=excluded.asset_role,alt_th=excluded.alt_th,reviewed_by=excluded.reviewed_by,reviewed_at=clock_timestamp();
  if choice='accepted' and c.kind='section' then
    insert into hub.content_sections(candidate_id,scope_type,scope_id,applies_to_project_ids,topic,title,body,summary,source_url,source_ref,reviewed_by)
      values(candidate,case when cardinality(c.programme_ids)>0 then 'programme' else 'project' end,
        coalesce(c.programme_ids[1],projects[1]),projects,c.topic,c.evidence->'title',c.evidence->'body',coalesce(c.evidence->'summary','{}'),c.source_url,c.source_ref,actor)
      on conflict(candidate_id) do update set applies_to_project_ids=excluded.applies_to_project_ids,reviewed_by=actor,reviewed_at=clock_timestamp(),version=hub.content_sections.version+1;
  elsif choice='accepted' and c.kind='faq' then
    insert into hub.faqs(candidate_id,scope_type,scope_id,applies_to_project_ids,topic,canonical_question,alt_questions,short_answer,live_fact_key,source_url,source_ref,reviewed_by)
      values(candidate,'project',projects[1],projects,c.topic,c.evidence->'canonical_question',coalesce(c.evidence->'alt_questions','{}'),c.evidence->'short_answer',c.evidence->>'live_fact_key',c.source_url,c.source_ref,actor)
      on conflict(candidate_id) do update set applies_to_project_ids=excluded.applies_to_project_ids,reviewed_by=actor,reviewed_at=clock_timestamp(),version=hub.faqs.version+1;
  elsif choice='accepted' and c.kind='alias' then
    if c.evidence->>'entity_type'='knowledge_term' and cardinality(projects)=0 then
      insert into hub.entity_aliases(candidate_id,entity_type,entity_id,alias,normalized_alias,locale,source_ref)
        values(candidate,'knowledge_term',coalesce(c.evidence->>'term_id',c.evidence#>>'{term,id}'),c.evidence->>'alias',c.evidence->>'normalized_alias',coalesce(c.evidence->>'locale','th'),c.source_ref) on conflict do nothing;
    else insert into hub.entity_aliases(candidate_id,entity_type,entity_id,alias,normalized_alias,locale,source_ref)
      select candidate,'project',p,c.evidence->>'alias',c.evidence->>'normalized_alias',coalesce(c.evidence->>'locale','th'),c.source_ref from unnest(projects) p on conflict do nothing;
    end if;
  elsif choice='accepted' and c.kind in ('fact','facility','nearby','programme') then
    insert into hub.knowledge_fact_candidates(candidate_id,project_ids,fact_key,value_text,owner_name,reviewed_by)
      values(candidate,projects,coalesce(c.evidence->>'fact_key',c.topic),coalesce(c.evidence->>'source_value','ยังไม่ทราบค่า'),c.evidence->>'owner',actor)
      on conflict(candidate_id) do update set project_ids=excluded.project_ids,reviewed_by=actor,reviewed_at=clock_timestamp();
  elsif choice='missing' then
    insert into hub.content_gaps(project_id,gap_code,candidate_id) values(projects[1],coalesce(c.evidence->>'gap_code','MKT_MISSING'),candidate);
  end if;
  return (select to_jsonb(r) from hub.knowledge_reviews r where candidate_id=candidate);
end $$;
revoke all on function hub.review_knowledge_candidate(uuid,integer,text,text[],text,boolean,text,text) from public;
grant execute on function hub.review_knowledge_candidate(uuid,integer,text,text[],text,boolean,text,text) to editor,admin;

create function hub.lock_knowledge_asset(candidate uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare c staging.knowledge_candidates; begin
  perform hub.require_actor(array['publisher']);
  select * into c from staging.knowledge_candidates where id=candidate and kind='asset' for update;
  if not found then raise exception 'Candidate not found' using errcode='P0002'; end if;
  return to_jsonb(c)||jsonb_build_object('review',(select to_jsonb(r) from hub.knowledge_reviews r where candidate_id=candidate));
end $$;
revoke all on function hub.lock_knowledge_asset(uuid) from public;
grant execute on function hub.lock_knowledge_asset(uuid) to publisher;

create function hub.knowledge_link_approved_asset(candidate uuid, asset uuid, expected_revision integer) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r hub.knowledge_reviews; c staging.knowledge_candidates; begin
  perform hub.require_actor(array['publisher']);
  select * into c from staging.knowledge_candidates where id=candidate for update;
  select * into r from hub.knowledge_reviews where candidate_id=candidate for update;
  if c.kind<>'asset' or r.decision is distinct from 'accepted' or not r.sena_owned or r.revision is distinct from expected_revision
    or cardinality(r.applies_to_project_ids)=0 or c.evidence->'classification'->>'people' is distinct from 'absent'
    or c.evidence->'classification'->>'third_party_marks' is distinct from 'absent'
    or c.evidence->'classification'->>'stock_imagery' is distinct from 'absent'
    or not exists(select 1 from hub.assets a where a.id=asset and a.checksum=c.evidence->>'sha256' and a.rights_status='approved') then
    raise exception 'Only confirmed unflagged SENA website assets qualify for bulk review' using errcode='23514'; end if;
  insert into hub.knowledge_asset_links(candidate_id,asset_id,review_revision) values(candidate,asset,expected_revision)
    on conflict(candidate_id) do update set asset_id=excluded.asset_id,review_revision=excluded.review_revision;
end $$;
revoke all on function hub.knowledge_link_approved_asset(uuid,uuid,integer) from public;
grant execute on function hub.knowledge_link_approved_asset(uuid,uuid,integer) to publisher;
commit;
