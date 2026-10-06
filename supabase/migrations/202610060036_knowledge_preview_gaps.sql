begin;
create unique index knowledge_question_gap_unique on hub.content_gaps(project_id,gap_code,question_sha256) where question_sha256 is not null;
create function hub.record_knowledge_gap(project text, code text, question_hash text) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher','viewer','admin']);
  if code is distinct from 'NO_ANSWER' or question_hash is null or question_hash !~ '^[0-9a-f]{64}$'
    or not exists(select 1 from rag.project_fact_cards where rem_project_id=project) then
    raise exception 'Invalid preview gap' using errcode='23514'; end if;
  insert into hub.content_gaps(project_id,gap_code,question_sha256) values(project,code,question_hash) on conflict do nothing;
end $$;
revoke all on function hub.record_knowledge_gap(text,text,text) from public;
grant execute on function hub.record_knowledge_gap(text,text,text) to editor,publisher,viewer,admin;
commit;
