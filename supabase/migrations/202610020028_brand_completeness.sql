-- Reviewed source-prefilled drafts are local, confirmed, audited and never published here.
begin;
alter table hub.brands add column unconfirmed_source_names text[] not null default '{}',
  add column source_name_provenance jsonb not null default '{}' check(jsonb_typeof(source_name_provenance)='object');

create function hub.clear_source_name_flag() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  if new.public_name->'th' is distinct from old.public_name->'th' then new.unconfirmed_source_names:=array_remove(new.unconfirmed_source_names,'th');end if;
  if new.public_name->'en' is distinct from old.public_name->'en' then new.unconfirmed_source_names:=array_remove(new.unconfirmed_source_names,'en');end if;
  return new;
end $$;
create trigger clear_source_name_flag before update on hub.brands for each row execute function hub.clear_source_name_flag();

-- Staff metadata is kept out of publishable payloads and public export views.
alter function hub.brand_detail(text) rename to brand_detail_before_completeness;
create function hub.brand_detail(public_id text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;begin
  result:=hub.brand_detail_before_completeness(public_id);
  return result||(select jsonb_build_object('unconfirmed_source_names',b.unconfirmed_source_names,
    'source_name_provenance',b.source_name_provenance,'updated_by',b.updated_by) from hub.brands b where b.public_brand_id=public_id);
end $$;
create function hub.confirm_brand_source_names(brand_uuid uuid,expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare b hub.brands;begin
  perform hub.require_actor(array['editor']);
  select * into b from hub.brands where id=brand_uuid and deleted_at is null for update;
  if not found then raise exception 'Brand not found' using errcode='P0002';end if;
  if expected_updated_at is null or b.updated_at<>expected_updated_at then raise exception 'Brand changed; reload' using errcode='40001';end if;
  if cardinality(b.unconfirmed_source_names)>0 then
    perform set_config('app.change_reason','ยืนยันชื่อแบรนด์จากต้นทางโดยผู้แก้ไข',true);
    update hub.brands set unconfirmed_source_names='{}' where id=b.id;
  end if;
  return hub.brand_detail(b.public_brand_id);
end $$;

create function hub.brand_suggested_slug(name_en text) returns text language sql immutable set search_path=pg_catalog,pg_temp as $$
  select rtrim(left(btrim(regexp_replace(lower(coalesce(name_en,'')),'[^a-z0-9]+','-','g'),'-'),147),'-')
$$;
create function hub.brand_registration_rows(p_manifest text default null) returns jsonb
language sql stable set search_path=pg_catalog,pg_temp as $$
with source as (
  select s.*,b.public_brand_id,b.deleted_at as hub_deleted_at,
    coalesce((s.source_record->>'residential_project_count')::int,(select count(*)::int from staging.rem_projects p where p.rem_brand_id=s.rem_brand_id)) as residential_count,
    hub.brand_suggested_slug(s.brand_name_en_rem) as base_slug,
    exists(select 1 from staging.rem_brands other where other.rem_brand_id<>s.rem_brand_id and
      ((nullif(btrim(s.brand_name_rem),'') is not null and lower(regexp_replace(btrim(other.brand_name_rem),'\s+',' ','g'))=lower(regexp_replace(btrim(s.brand_name_rem),'\s+',' ','g')))
      or (nullif(btrim(s.brand_name_en_rem),'') is not null and lower(regexp_replace(btrim(other.brand_name_en_rem),'\s+',' ','g'))=lower(regexp_replace(btrim(s.brand_name_en_rem),'\s+',' ','g'))))) as duplicate_name
  from staging.rem_brands s left join hub.brands b using(rem_brand_id)
  where p_manifest is null or s.intake_manifest_sha256=p_manifest
), planned as (
  select s.*,array_remove(array[
    case when public_brand_id is not null then case when hub_deleted_at is null then 'already_created' else 'archived' end end,
    case when is_deleted is true then 'deleted' when is_deleted is null then 'unknown_status' end,
    case when nullif(btrim(brand_name_rem),'') is null then 'blank_name' end,
    case when duplicate_name then 'duplicate' end,
    case when residential_count<1 then 'no_residential_project' end],null) as reasons,
    case when base_slug='' then '' when exists(select 1 from hub.brands h where h.slug=s.base_slug and h.deleted_at is null)
      or exists(select 1 from staging.rem_brands other where other.rem_brand_id<>s.rem_brand_id and hub.brand_suggested_slug(other.brand_name_en_rem)=s.base_slug)
      then base_slug||'-rem-'||left(md5(rem_brand_id),8) else base_slug end as suggested_slug
  from source s
)
select coalesce(jsonb_agg(jsonb_build_object('rem_brand_id',rem_brand_id,'source_name_th',brand_name_rem,'source_name_en',brand_name_en_rem,
  'public_brand_id',case when hub_deleted_at is null then public_brand_id end,'residential_project_count',residential_count,
  'deletion_status',case when is_deleted is false then 'active' when is_deleted is true then 'deleted' else 'unknown' end,
  'reason_codes',reasons,'eligible',cardinality(reasons)=0,
  'public_name',jsonb_strip_nulls(jsonb_build_object('th',case when nullif(btrim(brand_name_rem),'') is not null then brand_name_rem end,
    'en',case when nullif(btrim(brand_name_en_rem),'') is not null then brand_name_en_rem end)),
  'suggested_slug',suggested_slug,'source_fingerprint',source_fingerprint,'manifest_sha256',intake_manifest_sha256) order by rem_brand_id),'[]') from planned
$$;

create function hub.brand_bulk_preview(p_manifest text default '1512ac0bac74f5356617458b30bf2079896cce18db54393b5244c136ae54f877') returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare rows jsonb;begin
  perform hub.residential_local();perform hub.require_actor(array['admin']);
  if p_manifest is null or p_manifest !~ '^[0-9a-f]{64}$' or not exists(select 1 from staging.intake_batches where manifest_sha256=p_manifest and manifest->>'contract_version'='rem-brand-master-test-v1') then
    raise exception 'Reviewed brand dictionary not found' using errcode='P0002';end if;
  rows:=hub.brand_registration_rows(p_manifest);
  return jsonb_build_object('manifest_sha256',p_manifest,'preview_sha256',encode(sha256(convert_to(jsonb_build_object('manifest',p_manifest,'rows',rows)::text,'UTF8')),'hex'),
    'rows',rows,'create_count',(select count(*) from jsonb_array_elements(rows) r where (r->>'eligible')::boolean));
end $$;
create table hub.brand_bulk_runs (
  preview_sha256 text primary key check(preview_sha256 ~ '^[0-9a-f]{64}$'),manifest_sha256 text not null references staging.intake_batches,
  preview jsonb not null,created_brand_ids uuid[] not null,created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null,change_reason text not null check(btrim(change_reason)<>'')
);
alter table hub.brand_bulk_runs enable row level security;
create trigger immutable_brand_bulk_runs before update or delete on hub.brand_bulk_runs for each row execute function hub.reject_version_change();
revoke all on hub.brand_bulk_runs from public,admin,editor,publisher,viewer,online_staff,agency,service_consumer;
create function hub.brand_bulk_create(p_manifest text,p_preview_sha256 text,p_confirmed boolean,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actor uuid;preview jsonb;r jsonb;brand_uuid uuid;ids uuid[]:='{}';receipt hub.brand_bulk_runs;begin
  perform hub.residential_local();actor:=hub.require_actor(array['admin']);
  if p_confirmed is distinct from true or nullif(btrim(p_reason),'') is null then raise exception 'Explicit confirmation and reason required' using errcode='22023';end if;
  -- ponytail: one small local dictionary; table locks serialize source drift and all brand edits during this short transaction.
  lock table staging.rem_brands in share mode;
  lock table hub.brands in share row exclusive mode;
  select * into receipt from hub.brand_bulk_runs where preview_sha256=p_preview_sha256;
  if found then
    if receipt.manifest_sha256 is distinct from p_manifest then raise exception 'Preview manifest mismatch' using errcode='40001';end if;
    return jsonb_build_object('created_count',0,'replayed',true,'previously_created_count',cardinality(receipt.created_brand_ids));
  end if;
  preview:=hub.brand_bulk_preview(p_manifest);
  if preview->>'preview_sha256' is distinct from p_preview_sha256 then raise exception 'Preview changed; review again' using errcode='40001';end if;
  perform set_config('app.change_reason',p_reason,true);
  for r in select value from jsonb_array_elements(preview->'rows') where (value->>'eligible')::boolean loop
    insert into hub.brands(rem_brand_id,public_name,slug,unconfirmed_source_names,source_name_provenance)
      values(r->>'rem_brand_id',r->'public_name',r->>'suggested_slug',array(select jsonb_object_keys(r->'public_name')),
        jsonb_build_object('manifest_sha256',p_manifest,'source_fingerprint',r->>'source_fingerprint','original_names',r->'public_name','prefilled_at',clock_timestamp())) returning id into brand_uuid;
    ids:=array_append(ids,brand_uuid);
  end loop;
  insert into hub.brand_bulk_runs(preview_sha256,manifest_sha256,preview,created_brand_ids,created_by,change_reason)
    values(p_preview_sha256,p_manifest,preview,ids,actor,p_reason);
  return jsonb_build_object('created_count',cardinality(ids),'replayed',false,'preview_sha256',p_preview_sha256);
end $$;

-- Match the existing UI comparison: marketing content/roles, excluding library evidence and source/audit metadata.
create function hub.brand_review_content(payload jsonb) returns jsonb language sql immutable set search_path=pg_catalog,pg_temp as $$
select jsonb_build_object('public_name',payload->'public_name','description',payload->'description','slug',payload->'slug','status',payload->'status',
 'assets',coalesce((select jsonb_agg(jsonb_build_object('id',a->'id','asset_role',a->'asset_role','is_primary',a->'is_primary','alt_text',a->'alt_text',
 'display_order',a->'display_order','public_url',a->'public_url','original_filename',a->'original_filename','mime_type',a->'mime_type','rights_status',a->'rights_status',
 'effective_from',a->'effective_from','effective_to',a->'effective_to') order by a->>'id',a->>'asset_role') from jsonb_array_elements(coalesce(payload->'assets','[]')) a),'[]'))
$$;
create function hub.brand_completeness() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare rows jsonb:='[]';s jsonb;b hub.brands;payload jsonb;ready jsonb;changed boolean;available boolean;checks jsonb;row_status text;begin
  perform hub.require_actor(array['editor','publisher','viewer']);
  for s in select value from jsonb_array_elements(hub.brand_registration_rows()) loop
    select * into b from hub.brands where rem_brand_id=s->>'rem_brand_id' and deleted_at is null;
    if not found then
      rows:=rows||jsonb_build_array(s||jsonb_build_object('status','not_created','name_th',s->>'source_name_th','name_en',s->>'source_name_en',
        'readiness',jsonb_build_object('ready',false,'percent',0,'missing','[]'::jsonb),'checks','{}'::jsonb,'optional_logos','[]'::jsonb,'updated_at',null,'updated_by',null));
      continue;
    end if;
    payload:=hub.brand_draft_payload(b.id);ready:=hub.brand_snapshot_readiness(payload);
    available:=exists(select 1 from public_api.brands where id=b.id);
    changed:=b.published_version_id is null or hub.brand_review_content(payload) is distinct from (select hub.brand_review_content(v.payload) from hub.brand_versions v where v.id=b.published_version_id);
    row_status:=case when available and changed then 'published_changes' when available then 'published' when (ready->>'ready')::boolean then 'ready' else 'missing_data' end;
    checks:=jsonb_build_object('name_th_confirmed',nullif(btrim(b.public_name->>'th'),'') is not null and not('th'=any(b.unconfirmed_source_names)),
      'description',not exists(select 1 from jsonb_array_elements(ready->'missing') m where m->>'field'='description.th'),
      'slug',not exists(select 1 from jsonb_array_elements(ready->'missing') m where m->>'field'='slug'),
      'primary_logo',not exists(select 1 from jsonb_array_elements(ready->'missing') m where m->>'field'='assets.logo_primary'),
      'logo_rights',jsonb_array_length(payload->'assets')>0 and not exists(select 1 from jsonb_array_elements(ready->'missing') m where m->>'field' like 'assets.%.rights'));
    rows:=rows||jsonb_build_array(s||jsonb_build_object('id',b.id,'public_brand_id',b.public_brand_id,'status',row_status,
      'name_th',b.public_name->>'th','name_en',b.public_name->>'en','readiness',ready,'checks',checks,
      'unconfirmed_source_names',b.unconfirmed_source_names,'publication_available',available,'has_unpublished_changes',changed,
      'optional_logos',(select coalesce(jsonb_agg(distinct a->>'asset_role' order by a->>'asset_role'),'[]') from jsonb_array_elements(payload->'assets') a where a->>'asset_role' in('logo_white','logo_mono','favicon')),
      'updated_at',b.updated_at,'updated_by',b.updated_by,'published_version_id',b.published_version_id));
  end loop;
  select coalesce(jsonb_agg(r order by case when r->>'status'='not_created' then 100 else jsonb_array_length(r#>'{readiness,missing}') end desc,r->>'rem_brand_id'),'[]') into rows from jsonb_array_elements(rows) r;
  return jsonb_build_object('rows',rows,'counts',jsonb_build_object('total',jsonb_array_length(rows),
    'missing_data',(select count(*) from jsonb_array_elements(rows) r where r->>'status'<>'not_created' and not(r#>>'{readiness,ready}')::boolean),
    'ready',(select count(*) from jsonb_array_elements(rows) r where r->>'status'<>'not_created' and (r#>>'{readiness,ready}')::boolean and (not(r->>'publication_available')::boolean or (r->>'has_unpublished_changes')::boolean)),
    'published',(select count(*) from jsonb_array_elements(rows) r where (r->>'publication_available')::boolean),
    'published_changes',(select count(*) from jsonb_array_elements(rows) r where r->>'status'='published_changes'),
    'not_created',(select count(*) from jsonb_array_elements(rows) r where r->>'status'='not_created')));
end $$;

revoke all on function hub.brand_detail_before_completeness(text),hub.clear_source_name_flag(),hub.brand_suggested_slug(text),hub.brand_registration_rows(text),
  hub.brand_review_content(jsonb),hub.brand_completeness(),hub.brand_bulk_preview(text),hub.brand_bulk_create(text,text,boolean,text),hub.confirm_brand_source_names(uuid,timestamptz),hub.brand_detail(text) from public;
revoke all on function hub.brand_detail_before_completeness(text) from editor,publisher,viewer,admin;
grant execute on function hub.brand_detail(text),hub.brand_completeness() to editor,publisher,viewer,admin;
grant execute on function hub.brand_bulk_preview(text),hub.brand_bulk_create(text,text,boolean,text) to admin;
grant execute on function hub.confirm_brand_source_names(uuid,timestamptz) to editor,admin;
comment on column hub.brands.unconfirmed_source_names is 'Staff-only source-prefill flags; actual locale edits or explicit human name confirmation clear them. Existing publication readiness is unchanged.';
commit;
