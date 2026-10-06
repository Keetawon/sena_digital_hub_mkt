-- Optional DW dictionary: private provenance, no Hub identity or publication changes.
begin;
create table staging.dw_project_groups (
  project_group_id text primary key check(btrim(project_group_id)<>''),
  source_record jsonb not null,
  manifest_sha256 text not null references staging.intake_batches,
  first_seen_at timestamptz not null default now()
);
create table staging.project_group_evidence (
  id bigint generated always as identity primary key,
  manifest_sha256 text not null references staging.intake_batches,
  project_group_id text not null,
  outcome text not null check(outcome in ('new','changed','missing')),
  record jsonb,
  previous_record jsonb,
  recorded_at timestamptz not null default now(),
  unique(manifest_sha256,project_group_id)
);
create index project_group_latest on staging.project_group_evidence(project_group_id,id desc);
create trigger immutable_dw_project_groups before update or delete on staging.dw_project_groups
  for each row execute function hub.reject_version_change();
create trigger immutable_project_group_evidence before update or delete on staging.project_group_evidence
  for each row execute function hub.reject_version_change();
revoke all on staging.dw_project_groups,staging.project_group_evidence from public,admin,editor,publisher,viewer,service_consumer,online_staff,agency;
revoke all on sequence staging.project_group_evidence_id_seq from public,admin,editor,publisher,viewer,service_consumer,online_staff,agency;

create function hub.enrich_progress_group() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare gid text; r staging.dw_project_groups; latest staging.project_group_evidence; fields jsonb; issues jsonb:='[]';
begin
  gid:=new.summary->>'marketing_project_group_id';
  select * into r from staging.dw_project_groups where project_group_id=gid;
  select * into latest from staging.project_group_evidence where project_group_id=gid order by id desc limit 1;
  if gid is not null and r.project_group_id is null then
    issues:=issues||'"MARKETING_GROUP_MISSING"'::jsonb;
  elsif r.source_record->'project_id_set' <> 'null'::jsonb and not (r.source_record->'project_id_set' ? new.rem_project_id) then
    issues:=issues||'"GROUP_MEMBERSHIP_MISMATCH"'::jsonb;
  end if;
  fields:=jsonb_build_object('marketing_project_group_id',gid,
    'marketing_group_name_th',r.source_record->'project_name_th','marketing_group_name_en',r.source_record->'project_name_en',
    'group_provenance',case when r.project_group_id is not null then jsonb_build_object('manifest_sha256',r.manifest_sha256,
      'source_snapshot_at',r.source_record->'source_snapshot_at','first_seen_at',r.first_seen_at) end,
    'group_evidence_status',latest.outcome,'group_issues',issues,
    'group_mismatch',gid is not null and new.summary->>'rem_project_group_id' is not null and gid<>new.summary->>'rem_project_group_id',
    'group_status',case when new.summary->>'group_status'='conflict' then 'conflict' when gid is not null then 'marketing_reference' else 'missing' end);
  new.summary:=new.summary||fields;
  new.source:=new.source||fields||jsonb_build_object('rem_project_group_id',new.summary->'rem_project_group_id');
  return new;
end $$;
-- PostgreSQL fires same-kind triggers by name: enrich after the existing summarizer.
create trigger zz_group_names before insert or update on hub.project_progress_cache
  for each row execute function hub.enrich_progress_group();
create trigger progress_dirty after insert on staging.dw_project_groups
  for each row execute function hub.mark_project_progress_dirty();
create trigger progress_dirty after insert on staging.project_group_evidence
  for each row execute function hub.mark_project_progress_dirty();
revoke all on function hub.enrich_progress_group() from public;
select hub.refresh_project_progress(array(select rem_project_id from staging.rem_projects));
commit;
