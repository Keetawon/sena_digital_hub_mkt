begin;
-- Same checklist for an identity not yet created in Hub; no guessed draft values.
create function hub.source_project_readiness() returns table(rem_project_id text, readiness jsonb)
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher','viewer','admin']);
  return query select s.rem_project_id,hub.snapshot_readiness(jsonb_build_object('rem_project_id',s.rem_project_id,'models','[]'::jsonb,'assets','[]'::jsonb))
    from staging.rem_projects s where not exists(select 1 from hub.projects p where p.rem_project_id=s.rem_project_id and p.deleted_at is null);
end $$;
revoke all on function hub.source_project_readiness() from public;
grant execute on function hub.source_project_readiness() to editor,publisher,viewer,admin;
commit;
