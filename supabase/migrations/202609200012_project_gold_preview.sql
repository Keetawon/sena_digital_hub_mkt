-- Show safe Gold defaults in an unsaved editor form without mutating on read.
-- The preview and explicit prefill action share one conservative calculation.
begin;

create function hub.gold_project_prefill_changes(project_uuid uuid) returns jsonb
language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare p hub.projects; defaults jsonb; changes jsonb := '{}';
  field_name text; locale text; path text[]; current_value jsonb; candidate jsonb;
  merged jsonb; edited boolean; legacy_name boolean; rem_name text;
begin
  select * into p from hub.projects where id=project_uuid and deleted_at is null;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  defaults := hub.gold_project_defaults(p.rem_project_id);
  select project_name_rem into rem_name from staging.rem_projects where rem_project_id=p.rem_project_id;
  legacy_name := p.name_source='rem_default' and p.public_name=jsonb_build_object('th',rem_name);
  foreach field_name in array array['public_name','address'] loop
    merged := to_jsonb(p)->field_name;
    foreach locale in array array['th','en'] loop
      path := array[field_name,locale];
      current_value := to_jsonb(p)#>path;
      candidate := defaults#>path;
      -- Serializing an untouched missing locale as an empty input is not an edit.
      -- A nonempty value later cleared still has an audit transition and is protected.
      select exists(select 1 from audit.change_log a where a.table_name='hub.projects'
        and a.after_row->>'id'=p.id::text and a.before_row is not null
        and nullif(btrim(a.before_row#>>path),'') is distinct from nullif(btrim(a.after_row#>>path),'')) into edited;
      if candidate is not null and candidate<>'null'::jsonb and not edited
        and (coalesce(btrim(current_value#>>'{}'),'')='' or (field_name='public_name' and legacy_name)) then
        merged := merged || jsonb_build_object(locale,candidate);
      end if;
    end loop;
    if merged is distinct from to_jsonb(p)->field_name then changes := changes || jsonb_build_object(field_name,merged); end if;
  end loop;
  if p.latitude is null and p.longitude is null and defaults ? 'latitude' and defaults ? 'longitude' then
    select exists(select 1 from audit.change_log a where a.table_name='hub.projects'
      and a.after_row->>'id'=p.id::text and a.before_row is not null
      and (a.before_row->'latitude' is distinct from a.after_row->'latitude'
        or a.before_row->'longitude' is distinct from a.after_row->'longitude')) into edited;
    if not edited then
      changes := changes || jsonb_build_object('latitude',defaults->'latitude','longitude',defaults->'longitude');
    end if;
  end if;
  return changes;
end $$;
revoke all on function hub.gold_project_prefill_changes(uuid) from public,admin,editor,publisher,viewer,service_consumer;

create or replace function hub.prefill_project_from_dw(project_uuid uuid, expected_updated_at timestamptz, expected_fingerprint text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p hub.projects; source staging.dw_projects; changes jsonb;
begin
  perform hub.require_actor(array['editor','publisher']);
  select * into p from hub.projects where id=project_uuid and deleted_at is null for update;
  if not found then raise exception 'Project not found' using errcode='P0002'; end if;
  if expected_updated_at is null or p.updated_at<>expected_updated_at then
    raise exception 'Draft changed; reload before prefilling' using errcode='40001';
  end if;
  select * into source from staging.dw_projects where rem_project_id=p.rem_project_id for share;
  if not found then raise exception 'Reviewed gold.dim_project snapshot not available' using errcode='P0002'; end if;
  if expected_fingerprint is null or source.source_fingerprint<>expected_fingerprint then
    raise exception 'DW snapshot changed; review current defaults' using errcode='40001';
  end if;
  changes := hub.gold_project_prefill_changes(p.id);
  if changes<>'{}'::jsonb then
    perform set_config('app.change_reason','Apply reviewed gold.dim_project defaults: '||source.source_fingerprint,true);
    update hub.projects set
      public_name=coalesce(changes->'public_name',public_name),address=coalesce(changes->'address',address),
      latitude=coalesce((changes->>'latitude')::numeric,latitude),
      longitude=coalesce((changes->>'longitude')::numeric,longitude),
      name_source=case when changes ? 'public_name' and name_source<>'marketing_override' then 'dw_default' else name_source end
      where id=p.id;
  end if;
  return hub.project_detail(p.public_project_id);
end $$;

-- Retain the existing commercial-type and facility serializers in their chain.
alter function hub.project_detail(text) rename to project_detail_before_gold_preview;
revoke all on function hub.project_detail_before_gold_preview(text) from public,admin,editor,publisher,viewer,service_consumer;
create function hub.project_detail(public_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare payload jsonb;
begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  payload := hub.project_detail_before_gold_preview(public_id);
  return payload || jsonb_build_object('gold_prefill_changes',hub.gold_project_prefill_changes((payload->>'id')::uuid));
end $$;
revoke all on function hub.project_detail(text) from public,admin,editor,publisher,viewer,service_consumer;
grant execute on function hub.project_detail(text) to admin,editor,publisher,viewer;

commit;
