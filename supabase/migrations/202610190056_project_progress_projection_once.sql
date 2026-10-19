-- Composite .* expansion evaluates its function once for each output column.
-- Keep the same guarded projection, but evaluate it once for each cached row.
begin;

create or replace function hub.progress_inputs() returns setof hub.project_progress_cache
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform hub.require_permission('projects','view');
 perform hub.refresh_project_progress(array(select rem_project_id from hub.project_progress_dirty union
  select rem_project_id from hub.project_progress_cache where valid_until<=now()));
 return query select projected.* from hub.project_progress_cache c
 cross join lateral hub.progress_permission_projection(c) projected
 order by c.rem_project_id;
end $$;

commit;
