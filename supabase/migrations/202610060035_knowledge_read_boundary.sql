-- Keep the staging schema private; expose only authorized knowledge evidence.
begin;
create function hub.knowledge_candidate_rows() returns setof staging.knowledge_candidates
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher','viewer','admin']);
  return query select * from staging.knowledge_candidates;
end $$;
revoke all on function hub.knowledge_candidate_rows() from public;
grant execute on function hub.knowledge_candidate_rows() to editor,publisher,viewer,admin;
commit;
