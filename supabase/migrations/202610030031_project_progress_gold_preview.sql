-- Preserve the existing Gold preview alongside the new receipt metadata.
-- Migration 0030 was already applied to the disposable test cluster and remains immutable.
begin;
create or replace function hub.list_rem_projects() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'rem_project_id',s.rem_project_id,'project_name_rem',s.project_name_rem,
    'rem_brand_id',s.rem_brand_id,'rem_company_id',s.rem_company_id,'brand_name_rem',b.brand_name_rem,'company_name_rem',c.company_name_rem,
    'source_updated_at',s.source_updated_at,'source_snapshot_at',s.source_snapshot_at,'source_fingerprint',s.source_fingerprint,
    'source_record',s.source_record,'intake_manifest_sha256',s.intake_manifest_sha256,
    'first_seen_at',to_jsonb(s)->'first_seen_at',
    'mirror_imported_at',(select min(i.imported_at) from staging.intake_batches i
      where i.manifest_sha256=s.intake_manifest_sha256
        or i.datasets->'projects'->'rows' @> jsonb_build_array(jsonb_build_object('record',jsonb_build_object('project_id',s.rem_project_id)))),
    'model_count',(select count(*) from staging.rem_models m where m.rem_project_id=s.rem_project_id),
    'public_project_id',p.public_project_id,'gold_source',hub.gold_project_source(s.rem_project_id)) order by s.rem_project_id),'[]')
    from staging.rem_projects s left join hub.projects p using(rem_project_id)
    left join staging.rem_brands b using(rem_brand_id) left join staging.rem_companies c using(rem_company_id));
end $$;
commit;
