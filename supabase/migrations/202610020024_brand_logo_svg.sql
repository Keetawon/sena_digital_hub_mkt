-- SVG bytes are sanitized before hashing and storage by the API. Registry rights,
-- actor checks, audit triggers and grants remain unchanged, including admin's ACL.
begin;

create or replace function hub.register_uploaded_asset(metadata jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare actor uuid; a hub.assets; asset_uuid uuid := gen_random_uuid(); extension text; reused boolean;
begin
  actor := hub.require_actor(array['editor','publisher']);
  if jsonb_typeof(metadata) is distinct from 'object' or exists (select 1 from jsonb_object_keys(metadata) k
    where k not in ('original_filename','mime_type','storage_path','checksum','file_size','asset_type','width','height','language')) then
    raise exception 'Only validated upload metadata may be registered' using errcode='42501';
  end if;
  a := jsonb_populate_record(null::hub.assets,metadata);
  extension := case a.mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
    when 'image/webp' then 'webp' when 'image/svg+xml' then 'svg' when 'application/pdf' then 'pdf' end;
  if extension is null or coalesce(btrim(a.original_filename),'')='' or length(a.original_filename)>255
    or a.checksum is null or a.checksum !~ '^[0-9a-f]{64}$'
    or a.storage_path is distinct from a.checksum || '.' || extension
    or a.file_size is null or a.file_size not between 1 and 10485760
    or a.asset_type is distinct from (case when extension='pdf' then 'document' else 'image' end)
    or (extension<>'pdf' and (a.width is null or a.height is null or a.width<=0 or a.height<=0))
    or (extension='pdf' and (a.width is not null or a.height is not null))
    or coalesce(a.language,'th')<>'th' then
    raise exception 'Invalid local upload metadata' using errcode='23514';
  end if;
  -- The upload writer uses this same transaction lock while installing bytes.
  perform pg_advisory_xact_lock(hashtextextended(a.checksum,0));
  insert into hub.assets(id,original_filename,mime_type,public_url,rights_status,asset_type,storage_bucket,
    storage_path,checksum,file_size,width,height,language,owner_id,provenance,source_system)
  values(asset_uuid,a.original_filename,a.mime_type,'/v1/assets/' || asset_uuid::text || '/file','pending',
    a.asset_type,'local-originals',a.storage_path,a.checksum,a.file_size,a.width,a.height,
    coalesce(a.language,'th'),actor,'upload','hub-local')
  on conflict (checksum) where deleted_at is null and checksum is not null do nothing
  returning * into a;
  reused := not found;
  if reused then
    -- A separate statement sees a concurrent uploader's committed winner under
    -- READ COMMITTED. Never UPDATE the winner: its rights and timestamps are intact.
    select * into a from hub.assets where checksum=metadata->>'checksum' and deleted_at is null;
  end if;
  return jsonb_build_object('asset',to_jsonb(a),'reused',reused);
end $$;

commit;
